/** Stable server runtime names consumed by native host adapters. */
const ServerRuntime = {
  deno: 'deno',
  bun: 'bun',
  node: 'node'
} as const

/** Server runtime names follow the detection priority of their corresponding globals. */
type ServerRuntime = keyof typeof ServerRuntime

/**
 * Identifies the running server runtime without importing any host APIs. Deno takes precedence over
 * Bun and Node compatibility globals; browsers return undefined.
 */
export function detectServerRuntime(): ServerRuntime | undefined {
  /** Structural host view keeps public declarations independent of Node and Deno types. */
  const host = globalThis as typeof globalThis & {
    readonly Deno?: unknown
    readonly process?: { readonly versions?: { readonly bun?: string; readonly node?: string } }
  }
  if (host.Deno !== undefined) return ServerRuntime.deno
  if (host.process?.versions?.bun) return ServerRuntime.bun
  if (host.process?.versions?.node) return ServerRuntime.node
  return undefined
}
