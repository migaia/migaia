/**
 * Expands entry-only Worker recipes using shared entry resolution and runtime-flag retention.
 * Caller-selected launcher, supervision budget and scheduler fields remain unchanged.
 */
import {
  isUrlObject,
  detectServerRuntime,
  detectElectronProcessType,
  ServerRuntime,
  type IUrlLike
} from '@migaia/utils'
import { resolveRpcEntry, retainRpcRuntimeFlags } from '@migaia/rpc-host/sdk'
import type { IThreadSpawn } from './source.ts'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { invalidThreadConfig } from './error.ts'
import { ThreadErrorText } from './error-text.ts'
import type { IThreadRuntimeResource } from './runtime-types.ts'
/** Entry-only recipes fill only missing native launcher, budget and clock fields. */
export type IThreadShortSpawn = Readonly<{
  entry: true | IUrlLike
  base?: IUrlLike
  name?: IThreadSpawn['spec']['name']
  data?: IThreadSpawn['spec']['data']
  limits?: IThreadSpawn['spec']['limits']
}> &
  Partial<Omit<IThreadSpawn, 'spec'>>
/** Expansion borrows installation diagnostics without rebuilding caller-selected native policy. */
type IThreadExpansionOptions = Readonly<{
  spawn?: IThreadSpawn | IThreadShortSpawn | true | IUrlLike
  report?(error: unknown): void
}>

/** Only entry shorthand is expanded; full deployment objects and callbacks keep their old path. */
export function isShortThreadSpawn(spawn: IThreadExpansionOptions['spawn']): boolean {
  return (
    spawn === true ||
    typeof spawn === 'string' ||
    isUrlObject(spawn) ||
    (spawn !== null && typeof spawn === 'object' && 'entry' in spawn)
  )
}

/**
 * Expand ordinary entry configuration into the existing complete deployment source. Runtime
 * adapters stay lazy; Core owns entry policy, supervision owns budget and lifecycle, and each
 * adapter owns native bootstrap. The original Peer options object is never reconstructed.
 */
export async function expandThreadSpawn(
  options: IThreadExpansionOptions,
  runtime: IThreadRuntimeResource,
  reportDefault: (error: unknown) => void
): Promise<IThreadSpawn> {
  /** Caller-selected fields override defaults only for this one short source. */
  const source: IThreadShortSpawn =
    typeof options.spawn === 'object' && !isUrlObject(options.spawn)
      ? (options.spawn as IThreadShortSpawn)
      : { entry: options.spawn as true | IUrlLike }
  /** Canonical precedence prevents Bun's Node compatibility markers selecting Node mechanics. */
  const runtimeKind = detectServerRuntime()
  const bun = runtimeKind === ServerRuntime.bun
  const deno =
    runtimeKind === ServerRuntime.deno
      ? (Reflect.get(globalThis, 'Deno') as { mainModule?: string })
      : undefined
  const node = runtimeKind === ServerRuntime.node
  /**
   * Private protocol fixtures retain exact URL expansion; the public native factory rejects
   * browsers.
   */
  if (runtimeKind === undefined && !isUrlObject(source.entry))
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
      electron = detectElectronProcessType() !== undefined
      if (!bun) singleBinary = Boolean(process.getBuiltinModule?.('node:sea')?.isSea?.())
    }
  }
  /** URL is exact; relative strings use mainEntry unless an explicit base was supplied. */
  const entry = resolveRpcEntry(selectedEntry, {
    mainEntry,
    base: source.base,
    execArgv,
    electron,
    singleBinary,
    selfAllowed: Boolean(bun || deno || node)
  })
  /** Background failures retain reporting even when the caller needs only an entry. */
  const report = source.report ?? options.report ?? reportDefault
  /** One scheduler owns budget timing and the default channel factory. */
  const scheduler = source.scheduler ?? systemScheduler
  /** Different entries retain loader/runtime flags while dropping the parent's entry controller. */
  const runtimeFlags = source.entry === true ? execArgv : retainRpcRuntimeFlags(execArgv ?? [])
  /** A supplied pair stays untouched; otherwise acquire only this runtime's missing operations. */
  let launcher = source.launcher
  /** Channel construction remains owned by the existing runtime adapter. */
  let channelFactory = source.channelFactory
  if (!launcher || !channelFactory) {
    if (bun || deno || !node) {
      /** The single Web owner declares each host's own exit capability; only Bun observes close. */
      const adapter = await import('./web-launcher.ts')
      launcher ??= adapter.createWebThreadLauncher({ report })
      channelFactory ??= adapter.createWebThreadChannelFactory({ scheduler, report })
    } else {
      /** Node's public adapter keeps native Worker construction and exit observation canonical. */
      const adapter = await import('./node-launcher.ts')
      launcher ??= adapter.createNodeThreadLauncher({ execArgv: runtimeFlags, report }, runtime)
      channelFactory ??= adapter.createNodeThreadChannelFactory({ scheduler, report })
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
    supervisor: { ...source.supervisor, isolation: source.supervisor?.isolation ?? 'best-effort' }
  }
}
