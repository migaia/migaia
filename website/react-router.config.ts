import type { Config } from '@react-router/dev/config'
import routeManifest from './src/generated/manifests/routes.json'

/**
 * Configures the documentation app as a static React Router build. Every path
 * comes from the generated canonical route manifest before prerendering.
 */
export default {
  ssr: false,
  prerender: ['/', '/en', '/zh', ...routeManifest.entries.map((entry) => entry.path)]
} satisfies Config
