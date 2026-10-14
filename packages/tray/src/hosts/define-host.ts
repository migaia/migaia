import { isUrlObject, readUrlHref, type IUrlLike } from '@migaia/utils'
import { TrayErrorCode } from '../error-code.js'
import { createTrayError } from '../errors.js'
import { TrayHostField, TrayInternal, TrayRestartMode, TrayRuntime } from './constants.js'
import { readRoutingPolicy, type ITrayRoutingPolicy } from './routing-policy.js'
import type {
  IAnyTrayHost,
  ITrayExposePath,
  ITrayHost,
  ITrayHostDefinition,
  ITrayPlugins
} from './typing.js'

/** Runtime authority belongs to the exact frozen object returned by defineTrayHost. */
const hosts = new WeakSet<object>()
/** Internal plugin names cannot be declared as business exposure. */
const reservedPlugins = new Set<string>([
  TrayInternal.childPlugin,
  TrayInternal.clientPlugin,
  TrayInternal.relayPlugin
])

/** Reads only own data and rejects accessors before any caller code can run. */
function readData(source: object, field: string): unknown {
  /** Own descriptor separates absent fields from forbidden accessors. */
  const descriptor = Object.getOwnPropertyDescriptor(source, field)
  if (!descriptor) return undefined
  if (!('value' in descriptor)) throw createTrayError(TrayErrorCode.hostInvalid)
  return descriptor.value
}

/** Rejects non-record options; nested option snapshots use the same own-data boundary. */
function readRecord(value: unknown): object {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw createTrayError(TrayErrorCode.hostInvalid)
  return value
}

/** Copies declaration arrays as own data without invoking element getters or custom iterators. */
function copyArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw createTrayError(TrayErrorCode.hostInvalid)
  /** Only ordinary own elements enter the immutable host definition. */
  const snapshot: unknown[] = []
  for (let i = 0; i < value.length; i++) snapshot.push(readData(value, String(i)))
  return snapshot
}

/** Copies finite numeric native options, rejecting invalid values at the DSL boundary. */
function copyNumbers(source: object, fields: readonly string[]): Record<string, number> {
  /** Owned record prevents caller mutation from changing a later launch. */
  const snapshot: Record<string, number> = {}
  for (const field of fields) {
    /** One descriptor read per accepted numeric option. */
    const value = readData(source, field)
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw createTrayError(TrayErrorCode.hostInvalid)
    snapshot[field] = value
  }
  return snapshot
}

/** Validates the host DSL, snapshots options and arrays, and never invokes plugins or config. */
export function defineTrayHost<
  const TName extends string,
  const TPlugins extends ITrayPlugins,
  const TExposes extends ITrayExposePath<TPlugins>,
  const TRouting extends readonly ITrayRoutingPolicy[] = readonly [],
  TConfig = undefined
>(
  definition: ITrayHostDefinition<TName, TConfig, TPlugins, TExposes, TRouting>
): ITrayHost<TName, TConfig, TPlugins, TExposes, TRouting> {
  /** Caller descriptor is used only to take this immutable definition snapshot. */
  const source = readRecord(definition)
  /** Every admitted field is captured once without running accessor code. */
  const fields = Object.fromEntries(
    [
      TrayHostField.name,
      TrayHostField.runtime,
      TrayHostField.entry,
      TrayHostField.config,
      TrayHostField.plugins,
      TrayHostField.exposes,
      TrayHostField.supervisor,
      TrayHostField.limits,
      TrayHostField.sandbox,
      TrayHostField.routing
    ].map((key) => [key, readData(source, key)])
  )
  /** Runtime omission is the only default; every other family must be explicit. */
  const runtime = fields.runtime === undefined ? TrayRuntime.coroutine : fields.runtime
  if (
    typeof fields.name !== 'string' ||
    fields.name.length === 0 ||
    !Object.values(TrayRuntime).includes(runtime as never) ||
    typeof fields.plugins !== 'function' ||
    (fields.config !== undefined && typeof fields.config !== 'function') ||
    !Array.isArray(fields.exposes)
  )
    throw createTrayError(TrayErrorCode.hostInvalid)
  if (
    runtime === TrayRuntime.coroutine
      ? fields.entry !== undefined
      : !(
          isUrlObject(fields.entry) ||
          (typeof fields.entry === 'string' && fields.entry.length > 0)
        )
  )
    throw createTrayError(TrayErrorCode.hostInvalid)
  if (
    (fields.limits !== undefined && runtime !== TrayRuntime.thread) ||
    (fields.sandbox !== undefined && runtime !== TrayRuntime.process)
  )
    throw createTrayError(TrayErrorCode.hostInvalid)
  /** Exposes are exact plugin.Feature paths, with unique values and no internal prefix. */
  const exposes: string[] = []
  for (const expose of copyArray(fields.exposes)) {
    if (typeof expose !== 'string' || !/^[^.]+\.[^.]+$/.test(expose) || exposes.includes(expose))
      throw createTrayError(TrayErrorCode.hostInvalid)
    if (reservedPlugins.has(expose.split('.')[0]!))
      throw createTrayError(TrayErrorCode.reservedName)
    exposes.push(expose)
  }
  /** Routing identities are copied as data before their private authority is checked. */
  const routing = fields.routing === undefined ? undefined : copyArray(fields.routing)
  if (routing !== undefined) {
    for (const policy of routing)
      if (!readRoutingPolicy(policy)) throw createTrayError(TrayErrorCode.hostInvalid)
  }
  /** Mutable top-level options and arrays are replaced with package-owned frozen snapshots. */
  const snapshot: Record<string, unknown> = {
    name: fields.name,
    runtime,
    plugins: fields.plugins,
    exposes: Object.freeze(exposes)
  }
  if (fields.entry !== undefined) snapshot.entry = readUrlHref(fields.entry as IUrlLike)
  if (fields.config !== undefined) snapshot.config = fields.config
  if (routing !== undefined) snapshot.routing = Object.freeze(routing)
  if (fields.limits !== undefined) {
    /** Native thread limits have one supported numeric field. */
    const limits = copyNumbers(readRecord(fields.limits), [TrayHostField.heapBytes])
    if (limits.heapBytes === 0) throw createTrayError(TrayErrorCode.hostInvalid)
    snapshot.limits = Object.freeze(limits)
  }
  if (fields.sandbox !== undefined) {
    /** Command transformation is captured without running the external launcher hook. */
    const sandbox = readRecord(fields.sandbox)
    /** A named wrapper provides diagnostics while retaining the native command contract. */
    const name = readData(sandbox, TrayHostField.name)
    /** The pure callback reference is stable even if the caller edits its descriptor. */
    const wrap = readData(sandbox, TrayHostField.wrap)
    if (typeof name !== 'string' || !name || typeof wrap !== 'function')
      throw createTrayError(TrayErrorCode.hostInvalid)
    snapshot.sandbox = Object.freeze({ name, wrap })
  }
  if (fields.supervisor !== undefined) {
    /** Supervisor projection is an immutable native-policy subset. */
    const supervisor = readRecord(fields.supervisor)
    /** Startup timeout is shared by all three runtime families. */
    const policy: Record<string, unknown> = copyNumbers(supervisor, [
      TrayHostField.startupTimeoutMs
    ])
    /** Restart is optional and forwarded under its native name. */
    const restart = readData(supervisor, TrayHostField.restart)
    if (restart !== undefined) {
      /** Restart options are copied once; maxRestarts is never renamed. */
      const options = readRecord(restart)
      /** Native restart modes have no Tray-specific extension. */
      const mode = readData(options, TrayHostField.mode)
      if (mode !== undefined && !Object.values(TrayRestartMode).includes(mode as never))
        throw createTrayError(TrayErrorCode.hostInvalid)
      /** Numeric budgets and delays are kept separate from the string mode. */
      const numbers: Record<string, unknown> = copyNumbers(options, [
        TrayHostField.maxRestarts,
        TrayHostField.windowMs,
        TrayHostField.initialDelayMs
      ])
      if (mode !== undefined) numbers.mode = mode
      policy.restart = Object.freeze(numbers)
    }
    snapshot.supervisor = Object.freeze(policy)
  }
  /** Definition identity becomes trusted only after its entire snapshot is complete. */
  const host = Object.freeze(snapshot) as ITrayHost<TName, TConfig, TPlugins, TExposes, TRouting>
  hosts.add(host)
  return host
}

/** Returns the exact trusted DSL, rejecting structural copies at every host boundary. */
export function readHost(value: unknown): IAnyTrayHost {
  if (!hosts.has(value as object)) throw createTrayError(TrayErrorCode.hostInvalid)
  return value as IAnyTrayHost
}
