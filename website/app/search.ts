/** Loads the optional Pagefind runtime only after a user requests search. */
export async function loadSearchIndex(): Promise<unknown> {
  /** Resolved under Vite's base so a sub-path deployment loads its own Pagefind bundle. */
  const pagefindPath: string = `${import.meta.env.BASE_URL}pagefind/pagefind.js`
  return import(/* @vite-ignore */ pagefindPath)
}
