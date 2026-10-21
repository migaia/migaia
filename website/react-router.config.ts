import type { Config } from '@react-router/dev/config'
import libraryIndex from './src/generated/manifests/library-index.json'
import routeManifest from './src/generated/manifests/routes.json'
import { LOCALES } from './app/route-contract.ts'
import { siteBase } from './site-base.ts'

/** Retired `/<locale>/<library>` URLs, prerendered as redirect pages so old links keep working. */
const legacyLibraryPaths = LOCALES.flatMap((locale) =>
  libraryIndex.libraries.map((library) => `/${locale}/${library.slug}`)
)

/**
 * Configures the documentation app as a static React Router build. Every path comes from the
 * generated canonical route manifest before prerendering.
 */
export default {
  ssr: false,
  basename: siteBase,
  prerender: [
    '/',
    '/en',
    '/zh',
    ...routeManifest.entries.map((entry) => entry.path),
    ...legacyLibraryPaths
  ]
} satisfies Config
