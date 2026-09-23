/**
 * Vitest global setup: refuses to run a package's tests against stale workspace build output.
 *
 * Registered by `withDistFreshness` in every package's Vitest config, so it guards every Vitest
 * entry point — package `test` scripts, direct `vitest run --root packages/<name>` acceptance
 * commands, and coverage custody's capture — not only the ones that happen to build first.
 */
import { assertClosureFresh } from './dist-stamp.mjs'

/**
 * Asserts the dist closure of the project under test before any test file loads.
 * @param {{ config: { root: string } }} project Vitest test project; only its root is read
 * @returns {void}
 * @throws {Error} `DIST_STALE` listing every package that must be rebuilt
 */
export const setup = (project) => {
  assertClosureFresh(project.config.root)
}
