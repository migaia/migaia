import { type RouteConfig, index, route } from '@react-router/dev/routes'

/**
 * Defines the single route authority used by type generation and static pre-rendering. Every
 * library page lives under `/:lang/docs/*`; guides and API reference share one library sidebar.
 */
export default [
  index('routes/home.tsx'),
  route(':lang', 'routes/language.tsx'),
  // Retired `/<locale>/<library>` links redirect to the library page under `/<locale>/docs`.
  route(':lang/:library', 'routes/legacy-library.tsx'),
  route(':lang/docs/*', 'routes/docs.tsx', { id: 'routes/docs' })
] satisfies RouteConfig
