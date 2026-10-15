/**
 * Public URL prefix the static site is built for, with leading and trailing slash. Local dev and
 * tests use `/`; the container build sets `WEBSITE_BASE=/migaia/`. Vite `base` and React Router
 * `basename` both use this value because React Router's prerender server requires the basename to
 * start with the Vite base.
 */
export const siteBase: string = (() => {
  /** Prefix segments without surrounding slashes; empty means the site root. */
  const segments = (process.env.WEBSITE_BASE ?? '').replace(/^\/+|\/+$/g, '')
  return segments ? `/${segments}/` : '/'
})()
