import { log } from './log.js'
import { createStore } from '@migaia/store-light'
import { persist } from '@migaia/store-persist/light'
import { indexedDbHost } from '@migaia/storage-web/indexed-db'
import type { ILocale } from './route-contract.js'

/** Explicitly submitted query; language partitions the reader's local history. */
export type IHistoryEntry = { locale: ILocale; query: string }
/** History availability is independent of the optional search index. */
type IHistoryStatus = 'loading' | 'ready' | 'unavailable'
/** Feedback describes only the latest operation whose flush has settled. */
type IHistoryFeedback = 'idle' | 'saving' | 'saved' | 'deleted' | 'failed'
/** Persistent data and transient UI feedback share one browser-owned Store. */
type IHistoryState = {
  entries: IHistoryEntry[]
  status: IHistoryStatus
  feedback: IHistoryFeedback
}
/** Dedicated database leaves language and theme preferences in localStorage. */
export const HISTORY_DATABASE = 'migaia-website-history'
/** Versioned archive key for the submitted-query list. */
const HISTORY_KEY = 'history-v1'
/** Each language retains its own most recent queries. */
const HISTORY_LIMIT = 20
/** Oversized input remains searchable but is not kept as a local history entry. */
const HISTORY_QUERY_LIMIT = 200

/** Creates the history owner; failures disable only this enhancement. */
function createSearchHistory() {
  /** Store is client-owned and never created during prerendering. */
  const store = createStore<IHistoryState>({ entries: [], status: 'loading', feedback: 'idle' })
  /** IndexedDB host backing the persisted history. */
  let host: ReturnType<typeof indexedDbHost> | undefined
  /** Attachment owns archive hydration and serialized writes. */
  let handle: ReturnType<typeof persist> | undefined
  try {
    host = indexedDbHost({ dbName: HISTORY_DATABASE })
    handle = persist(store, {
      key: HISTORY_KEY,
      storage: host,
      version: 1,
      partialize: (state) => ({ entries: state.entries })
    })
    void handle.ready.then(
      () => {
        store.$set({ status: 'ready' })
      },
      (error: unknown) => {
        log.error(error)
        store.$set({ status: 'unavailable' })
      }
    )
  } catch (error) {
    log.error(error)
    store.$set({ status: 'unavailable' })
  }

  /** Flushes an explicit change; failed deletion restores only its own still-current snapshot. */
  async function commit(entries: IHistoryEntry[], feedback: 'saved' | 'deleted'): Promise<void> {
    if (store.status !== 'ready' || store.feedback === 'saving' || !handle) return
    /** No subsequent edit is admitted until this snapshot's flush settles. */
    const previous = store.entries
    store.$set({ entries, feedback: 'saving' })
    try {
      await handle.flush()
      store.$set({ feedback })
    } catch (error) {
      log.error(error)
      store.$set({ entries: previous, feedback: 'failed' })
    }
  }

  return {
    store,
    /** Records only explicit submissions, preserving the other language's full partition. */
    record(locale: ILocale, input: string): Promise<void> {
      /** Trimming defines both display and deduplication identity. */
      const query = input.trim()
      if (!query || query.length > HISTORY_QUERY_LIMIT) return Promise.resolve()
      /** Newest query moves to the front of its own bounded language list. */
      const local = [
        { locale, query },
        ...store.entries.filter((entry) => entry.locale === locale && entry.query !== query)
      ].slice(0, HISTORY_LIMIT)
      return commit(
        [...local, ...store.entries.filter((entry) => entry.locale !== locale)],
        'saved'
      )
    },
    /** Removes one entry after an explicit reader action. */
    remove(locale: ILocale, query: string): Promise<void> {
      return commit(
        store.entries.filter((entry) => entry.locale !== locale || entry.query !== query),
        'deleted'
      )
    },
    /** Clears the active language without changing the other language's entries. */
    clear(locale: ILocale): Promise<void> {
      return commit(
        store.entries.filter((entry) => entry.locale !== locale),
        'deleted'
      )
    }
  }
}

/** History owner type, derived from its factory. */
export type ISearchHistory = ReturnType<typeof createSearchHistory>

/** Page-lifetime owner: started in the background after load and shared by every palette open. */
let pageHistory: ISearchHistory | undefined

/**
 * Returns the page's history owner, creating it on first call. The shell calls this when the page
 * goes idle so IndexedDB is already read by the time the reader opens search; the palette reuses
 * the same owner. It lives as long as the page, so it is never disposed.
 */
export function pageSearchHistory(): ISearchHistory {
  pageHistory ??= createSearchHistory()
  return pageHistory
}
