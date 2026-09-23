/**
 * Single owner of the dist-freshness Vitest wiring. Package configs call `withDistFreshness`
 * instead of repeating the global setup path, so the guard cannot be registered inconsistently.
 */
import { fileURLToPath } from 'node:url'

/** Absolute path of the global setup module, stable regardless of which package loads it. */
export const distFreshnessGlobalSetup = fileURLToPath(
  new URL('./dist-freshness.global-setup.mjs', import.meta.url)
)

/**
 * Returns a copy of a Vitest/Vite config with the dist-freshness global setup appended, preserving
 * every existing field and any global setup the package already declares.
 * @template {Record<string, any>} TConfig
 * @param {TConfig} [config]
 * @returns {TConfig & { test: Record<string, any> }}
 */
export const withDistFreshness = (config = /** @type {TConfig} */ ({})) => {
  /** Existing global setup entries, normalised to an array. */
  const existing = config.test?.globalSetup
  return {
    ...config,
    test: {
      ...config.test,
      globalSetup: [...(existing === undefined ? [] : [existing].flat()), distFreshnessGlobalSetup]
    }
  }
}
