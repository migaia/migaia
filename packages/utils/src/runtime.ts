/** Runtime markers remain host-independent so adapters share one server-runtime precedence. */
export const ServerRuntime = {
  /** Deno's own version marker takes precedence over its Node compatibility globals. */
  deno: 'deno',
  /** Either the Bun global object or Bun's process-version marker identifies Bun. */
  bun: 'bun',
  /** Node is selected only when neither Deno nor Bun supplied its own marker. */
  node: 'node'
} as const

/** The public server-runtime domain does not expose any host-specific type declarations. */
export type ServerRuntime = keyof typeof ServerRuntime

/** Electron adapters use one normalized domain rather than the host's historical browser label. */
export const ElectronProcessType = {
  /** Electron's browser process is the application main process. */
  main: 'main',
  /** Renderer processes own their own Electron renderer environment. */
  renderer: 'renderer',
  /** Utility processes use the Electron utility-process environment. */
  utility: 'utility'
} as const

/** Electron process classification is absent outside a recognized Electron process. */
export type ElectronProcessType = keyof typeof ElectronProcessType

/** Browser adapters use these names for the global scope that owns their native resources. */
export const GlobalScopeKind = {
  /** A Window instance identifies a browser document global. */
  window: 'window',
  /** A DedicatedWorkerGlobalScope instance identifies a single-owner worker global. */
  'dedicated-worker': 'dedicated-worker',
  /** A SharedWorkerGlobalScope instance identifies a shared worker global. */
  'shared-worker': 'shared-worker',
  /** A ServiceWorkerGlobalScope instance identifies a service worker global. */
  'service-worker': 'service-worker'
} as const

/** Scope names depend only on ES-level constructor checks, never DOM declarations. */
export type GlobalScopeKind = keyof typeof GlobalScopeKind

/** Native scope constructors are used only for their instance relation and are never constructed. */
type IGlobalScopeConstructor = abstract new (...args: never[]) => object

/** Read-only structural host markers keep Node, Deno, Electron and DOM types out of declarations. */
type IRuntimeGlobals = {
  readonly Deno?: { readonly version?: { readonly deno?: unknown } }
  readonly Bun?: unknown
  readonly process?: {
    readonly versions?: {
      readonly deno?: unknown
      readonly bun?: unknown
      readonly node?: unknown
      readonly electron?: unknown
    }
    readonly type?: unknown
  }
  readonly Window?: IGlobalScopeConstructor
  readonly DedicatedWorkerGlobalScope?: IGlobalScopeConstructor
  readonly SharedWorkerGlobalScope?: IGlobalScopeConstructor
  readonly ServiceWorkerGlobalScope?: IGlobalScopeConstructor
}

/** Electron retains this historical host spelling for the application main process. */
const ELECTRON_MAIN_PROCESS_MARKER = 'browser'

/** Reads current host markers with Deno, Bun, then Node precedence; no host module is loaded. */
export function detectServerRuntime(): ServerRuntime | undefined {
  /** Markers are read anew on every invocation so changed globals cannot leave a stale result. */
  const host = globalThis as unknown as IRuntimeGlobals
  /** Deno's explicit version distinguishes its Node-compatible process global. */
  const denoVersion = host.Deno?.version?.deno
  if (typeof denoVersion === 'string' && denoVersion.length > 0) return ServerRuntime.deno
  /** Bun can identify itself without installing a process compatibility global. */
  const bun = host.Bun
  if (typeof bun === 'object' && bun !== null) return ServerRuntime.bun
  /** Process version fields are shared by Node and Bun's compatibility environment. */
  const versions = host.process?.versions
  /** Bun's process marker remains sufficient when the Bun global is unavailable. */
  const bunVersion = versions?.bun
  if (typeof bunVersion === 'string' && bunVersion.length > 0) return ServerRuntime.bun
  /** Node is the final supported server runtime rather than a browser-global fallback. */
  const nodeVersion = versions?.node
  return typeof nodeVersion === 'string' && nodeVersion.length > 0 ? ServerRuntime.node : undefined
}

/** Reads Electron's current process marker; ordinary Node process types never count as Electron. */
export function detectElectronProcessType(): ElectronProcessType | undefined {
  /** Capture this invocation's process object without importing the process host module. */
  const process = (globalThis as unknown as IRuntimeGlobals).process
  if (process?.versions?.electron === undefined) return undefined
  if (process.type === ELECTRON_MAIN_PROCESS_MARKER) return ElectronProcessType.main
  if (process.type === ElectronProcessType.renderer) return ElectronProcessType.renderer
  if (process.type === ElectronProcessType.utility) return ElectronProcessType.utility
  return undefined
}

/** Identifies the current browser global instance, excluding recognized server runtimes first. */
export function detectGlobalScope(): GlobalScopeKind | undefined {
  if (detectServerRuntime() !== undefined) return undefined
  /** Browser scope constructors are optional and are read from the current global object. */
  const host = globalThis as unknown as IRuntimeGlobals
  /** A present constructor alone cannot classify an unrelated global object. */
  const windowScope = host.Window
  if (typeof windowScope === 'function' && globalThis instanceof windowScope)
    return GlobalScopeKind.window
  /** Dedicated workers have a distinct instance relation from other worker kinds. */
  const dedicatedScope = host.DedicatedWorkerGlobalScope
  if (typeof dedicatedScope === 'function' && globalThis instanceof dedicatedScope)
    return GlobalScopeKind['dedicated-worker']
  /** Shared workers cannot be inferred from the mere presence of worker APIs. */
  const sharedScope = host.SharedWorkerGlobalScope
  if (typeof sharedScope === 'function' && globalThis instanceof sharedScope)
    return GlobalScopeKind['shared-worker']
  /** Service-worker scope is checked last after the three earlier explicit instance relations. */
  const serviceScope = host.ServiceWorkerGlobalScope
  if (typeof serviceScope === 'function' && globalThis instanceof serviceScope)
    return GlobalScopeKind['service-worker']
  return undefined
}
