import {
  resolveAdapterEntry,
  retainAdapterRuntimeFlags
} from '@migaia/rpc-core/adapter/internal-advanced'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { invalidThreadConfig } from './error.js'
import { ThreadErrorText } from './error-text.js'
import type { IThreadRuntimeResource } from './runtime-types.js'
import { threadRuntimeResource } from './runtime-resource.js'
import type {
  IRuntimeThreadPeerOptions,
  IRuntimeThreadShortSpawn,
  IRuntimeThreadSpawn
} from './runtime-peer.js'

/** Only entry shorthand is expanded; full deployment objects and callbacks keep their old path. */
export function isShortThreadSpawn(spawn: IRuntimeThreadPeerOptions['spawn']): boolean {
  return (
    spawn === true ||
    typeof spawn === 'string' ||
    spawn instanceof URL ||
    (spawn !== null && typeof spawn === 'object' && 'entry' in spawn)
  )
}

/**
 * Expand ordinary entry configuration into the existing complete deployment source. Runtime
 * adapters stay lazy; Core owns entry policy, supervision owns budget and lifecycle, and each
 * adapter owns native bootstrap. The original Peer options object is never reconstructed.
 */
export async function expandThreadSpawn(
  options: IRuntimeThreadPeerOptions,
  runtime: IThreadRuntimeResource
): Promise<IRuntimeThreadSpawn> {
  /** Caller-selected fields override defaults only for this one short source. */
  const source: IRuntimeThreadShortSpawn =
    typeof options.spawn === 'object' && !(options.spawn instanceof URL)
      ? (options.spawn as IRuntimeThreadShortSpawn)
      : { entry: options.spawn as true | string | URL }
  /** Bun's Node compatibility globals must never select Node's launcher ahead of Bun's adapter. */
  const bun = Reflect.get(globalThis, 'Bun')
  /** Deno mainModule is already an exact absolute module URL. */
  const deno = Reflect.get(globalThis, 'Deno') as { mainModule?: string } | undefined
  /** Browser callers must pass an exact URL; no main-module or stack-trace inference exists there. */
  const node = typeof process !== 'undefined' && process.versions?.node !== undefined
  if (!bun && !deno && !node && !(source.entry instanceof URL))
    invalidThreadConfig('spawn', ThreadErrorText.browserEntryRequired)
  /** Native runtime snapshots feed one Core-owned entry policy rather than duplicate checks. */
  let mainEntry: URL | undefined
  /** Node and Bun inherit runtime flags through their existing Worker implementation. */
  let execArgv: readonly string[] | undefined
  /** Electron self-execution requires an explicit entry rather than guessing its application. */
  let electron = false
  /** Native single executable applications do not expose a reusable main module. */
  let singleBinary = false
  /** Absolute filesystem entries are encoded by the native owner, even without a main module. */
  let selectedEntry = source.entry
  if (deno?.mainModule) mainEntry = new URL(deno.mainModule)
  if (node || bun || deno) {
    /** These standard native path operations are loaded only by the runtime that needs them. */
    const [{ resolve, isAbsolute }, { pathToFileURL }] = await Promise.all([
      import('node:path'),
      import('node:url')
    ])
    if (typeof selectedEntry === 'string' && isAbsolute(selectedEntry))
      selectedEntry = pathToFileURL(selectedEntry)
    if (!deno) {
      if (process.argv[1]) mainEntry = pathToFileURL(resolve(process.argv[1]))
      execArgv = process.execArgv
      electron = Boolean(process.versions?.electron)
      if (!bun) singleBinary = Boolean(process.getBuiltinModule?.('node:sea')?.isSea?.())
    }
  }
  /** URL is exact; relative strings use mainEntry unless an explicit base was supplied. */
  const entry = resolveAdapterEntry(selectedEntry, {
    mainEntry,
    base: source.base,
    execArgv,
    electron,
    singleBinary,
    selfAllowed: Boolean(bun || deno || node)
  })
  /** Background failures retain reporting even when the caller needs only an entry. */
  const report = source.report ?? options.report ?? console.error
  /** One scheduler owns budget timing and the default channel factory. */
  const scheduler = source.scheduler ?? systemScheduler
  /** Different entries retain loader/runtime flags while dropping the parent's entry controller. */
  const runtimeFlags = source.entry === true ? execArgv : retainAdapterRuntimeFlags(execArgv ?? [])
  /** A supplied pair stays untouched; otherwise acquire only this runtime's missing operations. */
  let launcher = source.launcher
  /** Channel construction remains owned by the existing runtime adapter. */
  let channelFactory = source.channelFactory
  if (!launcher || !channelFactory) {
    if (bun) {
      /** Bun's adapter preserves its actual Web Worker lifecycle limitations. */
      const adapter = await import('./adapters/bun.js')
      launcher ??= adapter.createBunThreadLauncher({ report })
      channelFactory ??= adapter.createBunThreadChannelFactory({ scheduler })
    } else if (deno) {
      /** Deno's adapter preserves its actual Web Worker lifecycle limitations. */
      const adapter = await import('./adapters/deno.js')
      launcher ??= adapter.createDenoThreadLauncher({ report })
      channelFactory ??= adapter.createDenoThreadChannelFactory({ scheduler })
    } else if (node) {
      /** Node's public adapter keeps native Worker construction and exit observation canonical. */
      const adapter = await import('./adapters/node.js')
      launcher ??=
        runtime === threadRuntimeResource
          ? adapter.createNodeThreadLauncher({ execArgv: runtimeFlags })
          : (await import('./node-launcher.js')).createAdapterNodeThreadLauncher(runtime, {
              execArgv: runtimeFlags
            })
      channelFactory ??= adapter.createNodeThreadChannelFactory({ scheduler })
    } else {
      /** Browser URLs stay URLs in the existing native Worker construction path. */
      const adapter = await import('./adapters/browser.js')
      launcher ??= adapter.createBrowserThreadLauncher({ report })
      channelFactory ??= adapter.createBrowserThreadChannelFactory({ scheduler })
    }
  }
  return {
    spec: { entry, name: source.name, data: source.data, limits: source.limits },
    launcher,
    channelFactory,
    scheduler,
    budget: source.budget ?? createUnitBudget({ kind: 'thread', maxUnits: 1, scheduler }),
    report,
    health: source.health,
    supervisor: { ...source.supervisor, isolation: source.supervisor?.isolation ?? 'best-effort' },
    keyFactory: source.keyFactory,
    retryPort: source.retryPort
  }
}
