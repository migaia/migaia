/** Loads the optional Pagefind runtime only after a user requests search. */
export async function loadSearchIndex(): Promise<unknown> {
  const pagefindPath: string = '/pagefind/pagefind.js'
  return import(/* @vite-ignore */ pagefindPath)
}
