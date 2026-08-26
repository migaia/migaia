import type { IWebRpcEndpointModule } from '../core.js'

/** Provider module tokens registered by the provider feature without importing that feature back. */
const nativeProviderModules = new WeakSet<object>()

/** Claims minted only while the inventory processes a registered native provider module. */
const nativeProviderClaimAuthorities = new WeakSet<object>()

/** Registers the package-owned provider token at the provider feature boundary. */
export function registerNativeProviderModule(module: IWebRpcEndpointModule): void {
  nativeProviderModules.add(module)
}

/** Checks whether a source token is the package-owned native provider token. */
export function isNativeProviderModule(module: unknown): boolean {
  return typeof module === 'object' && module !== null && nativeProviderModules.has(module)
}

/** Mints claim authority only for the already-admitted native provider definition. */
export function registerNativeProviderClaimAuthority(claims: unknown): void {
  if (typeof claims === 'object' && claims !== null) nativeProviderClaimAuthorities.add(claims)
}

/** Reads native provider claim authority without exposing a minting operation. */
export function hasNativeProviderClaimAuthority(claims: unknown): boolean {
  return typeof claims === 'object' && claims !== null && nativeProviderClaimAuthorities.has(claims)
}
