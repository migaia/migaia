import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Fixture imports use RPC's declared dependencies rather than incidental root hoisting. */
const rpcParentURL = new URL('../../../src/core/index.ts', import.meta.url).href
/** Limit package anchoring to scratch fixtures; package modules keep their own dependency scope. */
const fixtureRootURL = new URL('../', import.meta.url).href

/**
 * Resolve fixture workspace dependencies from RPC and relative .js imports from TS source. Package
 * exports and conditions remain the native resolver's responsibility.
 *
 * @param {string} specifier The original import specifier.
 * @param {import('node:module').ResolveHookContext} context Native resolution context.
 * @param {import('node:module').ResolveHook} nextResolve The next native resolver.
 * @returns {ReturnType<import('node:module').ResolveHook>} The unchanged native resolution result.
 */
export function resolve(specifier, context, nextResolve) {
  if (
    specifier.startsWith('@migaia/') &&
    context.parentURL?.startsWith(fixtureRootURL) &&
    !context.parentURL.includes('/packages/')
  ) {
    return nextResolve(specifier, { ...context, parentURL: rpcParentURL })
  }
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    specifier.endsWith('.js') &&
    context.parentURL?.startsWith('file:')
  ) {
    const source = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(source))) return nextResolve(source.href, context)
  }
  return nextResolve(specifier, context)
}
