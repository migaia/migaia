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

/** Acquires history on the first palette mount; failures disable only this enhancement. */
export function createSearchHistory() {
  /** Store is client-owned and never created during prerendering. */
  const store = createStore<IHistoryState>({ entries: [], status: 'loading', feedback: 'idle' })
  /** Closed owners cannot publish late hydration or persistence feedback. */
  let closed = false
  /** IndexedDB and persist are acquired together and released independently. */
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
        if (!closed) store.$set({ status: 'ready' })
      },
      (error: unknown) => {
        if (closed) return
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
    if (closed || store.status !== 'ready' || store.feedback === 'saving' || !handle) return
    /** No subsequent edit is admitted until this snapshot's flush settles. */
    const previous = store.entries
    store.$set({ entries, feedback: 'saving' })
    try {
      await handle.flush()
      if (!closed) store.$set({ feedback })
    } catch (error) {
      if (closed) return
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
    },
    /** Stops publication immediately, then releases every owner even if cleanup fails. */
    dispose(): void {
      closed = true
      void (async () => {
        try {
          await handle?.disposeAsync()
        } catch (error) {
          log.error(error)
        }
        try {
          await host?.dispose()
        } catch (error) {
          log.error(error)
        }
        try {
          await store.$dispose()
        } catch (error) {
          log.error(error)
        }
      })()
    }
  }
}
