import { type RouteConfig, index, route } from '@react-router/dev/routes'

/**
 * Defines the single route authority used by type generation and static pre-rendering, including
 * the nested API probe route.
 */
export default [
  index('routes/home.tsx'),
  route(':lang', 'routes/language.tsx'),
  route(':lang/docs/*', 'routes/docs.tsx', { id: 'routes/docs' }),
  route(':lang/guides/*', 'routes/docs.tsx', { id: 'routes/guides' }),
  route(':lang/architecture/*', 'routes/docs.tsx', { id: 'routes/architecture' })
] satisfies RouteConfig
