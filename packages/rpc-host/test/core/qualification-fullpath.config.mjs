import { mergeConfig } from 'vitest/config'
import configuration from '../../vitest.config.js'

/** Reuses the ordinary package configuration without adding its untyped loader to test types. */
export default mergeConfig(configuration, {
  test: { setupFiles: [new URL('./qualification-fullpath-setup.ts', import.meta.url).pathname] }
})
