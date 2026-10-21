import { log } from './log.js'
import { createResource } from '@migaia/resource'
import { createStore } from '@migaia/store-light'
import { debounce } from '@migaia/utils/scheduler'
import { onceAsync } from '@migaia/utils/function'
import type { ILocale } from './route-contract.js'

/** Resolved data of one Pagefind result. */
export type IPagefindHit = {
  readonly url: string
  readonly excerpt: string
  readonly meta: { readonly title?: string }
}

/** Subset of the Pagefind runtime this palette calls. */
type IPagefind = {
  /** Sets init options; `language` picks the per-locale index before the next search loads it. */
  readonly options: (options: { readonly language: ILocale }) => Promise<void>
  /** Drops the loaded index so the next `options` + `search` loads another language. */
  readonly destroy: () => Promise<void>
  readonly search: (query: string) => Promise<{
    readonly results: readonly { readonly data: () => Promise<IPagefindHit> }[]
  } | null>
}

/** Loads the optional Pagefind runtime only after a user requests search. */
export async function loadSearchIndex(): Promise<unknown> {
  /** Resolved under Vite's base so a sub-path deployment loads its own Pagefind bundle. */
  const pagefindPath: string = `${import.meta.env.BASE_URL}pagefind/pagefind.js`
  return import(/* @vite-ignore */ pagefindPath)
}

/** Loads once per page, retaining a null fallback after the first reported index failure. */
export const loadPagefind = onceAsync(() =>
  loadSearchIndex().then(
    (module) => module as IPagefind,
    (error: unknown) => {
      log.error(error)
      return null
    }
  )
)

/** Maximum page hits kept visible in the keyboard palette. */
const MAX_PAGE_RESULTS = 8
/** Quiet input interval retained from the existing search interaction. */
const SEARCH_DEBOUNCE_MS = 120
/** Language currently configured on Pagefind's page-level module. */
const indexLocaleRef: { current: ILocale | undefined } = { current: undefined }

/** Owns one open palette's debounced input and cancellable query resource. */
export function createSearchQuery(locale: ILocale) {
  /** Reactive input is read before the fetcher's first await to track replacement. */
  const needle = createStore({ query: '' })
  /** Resource generations own publication and cancel replaced requests. */
  const resource = createResource(
    () =>
      async (ctx): Promise<readonly IPagefindHit[]> => {
        /** This synchronous read establishes the query dependency. */
        const query = needle.query
        if (!query) return []
        try {
          /** Optional index falls back to the always-available library list. */
          const pagefind = await loadPagefind()
          if (ctx.signal.aborted || !pagefind) return []
          if (indexLocaleRef.current !== locale) {
            await pagefind.destroy()
            if (ctx.signal.aborted) return []
            await pagefind.options({ language: locale })
            if (ctx.signal.aborted) return []
            indexLocaleRef.current = locale
          }
          /** Pagefind has no cancellation input; stop consumption after each awaited boundary. */
          const response = await pagefind.search(query)
          if (ctx.signal.aborted) return []
          /** Only materialize the visible result limit. */
          const hits = await Promise.all(
            (response?.results ?? []).slice(0, MAX_PAGE_RESULTS).map((result) => result.data())
          )
          return ctx.signal.aborted ? [] : hits
        } catch (error) {
          if (!ctx.signal.aborted) log.error(error)
          throw error
        }
      },
    { runtime: needle.$runtime }
  )
  /** Only settled input changes can start a replacement query. */
  const setInput = debounce(
    (value: string) => needle.$set({ query: value.trim() }),
    SEARCH_DEBOUNCE_MS
  )
  return {
    locale,
    needle,
    resource,
    setInput,
    /** Closes input admission before stopping the resource and its reactive input. */
    dispose() {
      setInput.cancel()
      resource.dispose()
      void needle.$dispose().catch((error: unknown) => log.error(error))
    }
  }
}
