/** Loads the optional Pagefind runtime only after a user requests search. */
export async function loadSearchIndex(): Promise<unknown> {
  /** Resolved under Vite's base so a sub-path deployment loads its own Pagefind bundle. */
  const pagefindPath: string = `${import.meta.env.BASE_URL}pagefind/pagefind.js`
  return import(/* @vite-ignore */ pagefindPath)
}

/**
 * Window event that asks the shell header to open the command palette. Lets page content (the
 * docs-home hero) open search without holding a reference to header state.
 */
export const OPEN_SEARCH_EVENT = 'migaia:open-search'

/** Opens the site command palette from anywhere on the page. */
export function requestSearch(): void {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))
}
