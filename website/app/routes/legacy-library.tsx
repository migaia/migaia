import { data, redirect } from 'react-router'
import { LIBRARY_INDEX } from '../library-descriptions.js'
import { domainPath, LOCALES, type ILocale } from '../route-contract.js'

type ILegacyLibraryRouteProps = {
  readonly params: { readonly lang?: string; readonly library?: string }
}

/**
 * Sends a retired `/<locale>/<library>` link to that library's page under `/<locale>/docs`.
 * Unknown locales or libraries stay a 404 so this route never invents pages.
 */
export function loader({ params }: ILegacyLibraryRouteProps) {
  /** Locale segment, accepted only when it is one of the public locales. */
  const locale = LOCALES.find((entry) => entry === params.lang) as ILocale | undefined
  /** True when the second segment names a published library. */
  const knownLibrary = LIBRARY_INDEX.some((entry) => entry.slug === params.library)
  if (!locale || !params.library || !knownLibrary) throw data(null, { status: 404 })
  throw redirect(domainPath(locale, params.library))
}

/** The loader always redirects or throws; this component only keeps the route a page route. */
export default function LegacyLibrary() {
  return null
}
