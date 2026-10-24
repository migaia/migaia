import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import { ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE } from '../error-code.js'
import { RpcProcessErrorText } from '../error-text.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { readAdapterAbortReason as resolveAbortReason } from '@migaia/rpc-host/plugin'
import { createAdapterId as defaultRpcId } from '@migaia/rpc-host/plugin'
import { IpcReporterContext } from '@migaia/rpc-host/plugin'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import {
  createSupervisor,
  createUnitBudget,
  TerminationMode,
  type ISupervisor,
  type IUnitLauncher,
  type ISupervisorBaseOptions,
  type IUnitProfile
} from '@migaia/supervision'
import {
  createProcessSupervisor,
  DrainedStream,
  type IProcessHandle,
  type IProcessSpec
} from '@migaia/supervision/process'
import type { IRemoteBinding, IRemoteChannel } from '@migaia/rpc-host/plugin'
import type { IRemoteServeEndpoint, IAdapterManagedDeployment } from '@migaia/rpc-host/plugin'
import type { IRpcHandshakeOffer } from '@migaia/rpc-contract'
import { RpcCapability } from '@migaia/rpc-contract'
import { RpcProcessErrorCode } from '../error-code.js'

import { createNativeProcessOffer } from '../offer.js'
import {
  DEFAULT_HEALTH_FAILURE_THRESHOLD,
  DEFAULT_HEALTH_INTERVAL_MS,
  DEFAULT_HEALTH_TIMEOUT_MS
} from '../resilience/constants.js'
import { createAdapterBindingDrain as createRemoteBindingDrain } from '@migaia/rpc-host/plugin'
import type { IProcessRegistrationSupervisorPort } from '../resilience/types.js'
import type { IProcessByteChannel, IProcessMessageChannel } from '../types.js'
import {
  ProcessConnectionProfile,
  ProcessPluginChannelKind,
  ProcessPluginWire
} from './constants.js'
import type {
  IConnectProcessPluginDeployment,
  IProcessConnectionHandle,
  IProcessPluginEstablish,
  IProcessPluginSession,
  ISpawnProcessPluginDeployment
} from './types.js'

/** A default peer label names the facade without claiming a specific runtime. */
const PROCESS_PLUGIN_PEER_RUNTIME = 'process'

/** Client bindings keep their process-specific governance hooks package-local. */
export type IProcessPluginBinding<TUnit extends object, TSpec> = IRemoteBinding<TUnit, TSpec> &
  Readonly<{
    supervisor: ISupervisor<TUnit, TSpec>
    health: 'ping' | 'custom' | 'none'
    registrationSupervisor: IProcessRegistrationSupervisorPort
    /** Owned bindings alone can escalate a live handle during shutdown. */
    forceCurrent?(): void
    /** Preserve logical request Promise identity while joining the canonical drain barrier. */
    trackRequest: NonNullable<IRemoteBinding<TUnit, TSpec>['trackRequest']>
    bindEndpoint: NonNullable<IAdapterManagedDeployment['bindEndpoint']>
    drainCurrent(options?: Readonly<{ hostRemainingMs?: number; drainMs?: number }>): Promise<void>
  }>

/** Project the canonical supervisor without storing another lifecycle or restart policy. */
export function registrationSupervisor<TUnit, TSpec>(
  supervisor: ISupervisor<TUnit, TSpec>
): IProcessRegistrationSupervisorPort {
  return {
    restart: () => supervisor.restart(),
    inspect: () => supervisor.inspect(),
    dispose: () => supervisor.dispose(),
    onTerminal: (listener) =>
      supervisor.subscribe((event) => {
        if (event.type === 'terminal') listener(event)
      })
  }
}

/** Reports secondary diagnostics without replacing the error that triggered cleanup. */
export function reportSafely(report: (error: unknown) => void, error: unknown): void {
  try {
    report(error)
  } catch (reporterError) {
    hostRethrowReporter(reporterError, IpcReporterContext)
  }
}

/** Rejects one invalid process option before launcher, dialer, or host work begins. */
export function invalidOption(field: string): never {
  throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
    attachErrorIdentity(new TypeError(RpcProcessErrorText.pluginInvalidOption), {
      source: RPC_PROCESS_ERROR_SOURCE,
      code: RpcProcessErrorCode.pluginInvalidOption,
      ...(originalDetail ? { detail: originalDetail } : {})
    }))({ field })
}

/** Creates one native offer per binding, retaining its token without platform inference. */
function defaultProcessOffer(token: string | undefined): IRpcHandshakeOffer {
  return createNativeProcessOffer({
    peer: { id: defaultRpcId(), runtime: PROCESS_PLUGIN_PEER_RUNTIME },
    ...(token === undefined ? {} : { auth: token })
  })
}

/** Native default health may only inspect the proposal that establish will receive. */
function requirePingCapabilities(capabilities: readonly string[]): void {
  if (!Array.isArray(capabilities) || !capabilities.includes(RpcCapability.ping))
    throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
      attachErrorIdentity(new TypeError(RpcProcessErrorText.resilienceInvalidOption), {
        source: RPC_PROCESS_ERROR_SOURCE,
        code: RpcProcessErrorCode.resilienceInvalidOption,
        ...(originalDetail ? { detail: originalDetail } : {})
      }))({
      field: 'deployment.offer.capabilities'
    })
}

/** A ready endpoint must support the capability that the supervisor will probe. */
export function requirePingEndpoint(channel: IRemoteChannel, endpoint: IRemoteServeEndpoint): void {
  requirePingCapabilities(channel.agreement.capabilities)
  if (typeof endpoint.endpoint.ping !== 'function')
    throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
      attachErrorIdentity(new TypeError(RpcProcessErrorText.resilienceInvalidOption), {
        source: RPC_PROCESS_ERROR_SOURCE,
        code: RpcProcessErrorCode.resilienceInvalidOption,
        ...(originalDetail ? { detail: originalDetail } : {})
      }))({
      field: 'endpointFactory'
    })
}

/** One supervisor check delegates to the endpoint installed for its current unit. */
export async function checkNativePing(
  ready: Readonly<{ channel: IRemoteChannel; endpoint: IRemoteServeEndpoint }> | undefined,
  signal: IAbortSignal
): Promise<void> {
  if (!ready) return
  const passed = await ready.endpoint.endpoint.ping(ready.channel.peerId, undefined, {
    timeoutMs: false,
    signal
  })
  if (passed) return
  if (signal.aborted) throw resolveAbortReason(signal)
  throw attachErrorIdentity(new Error(RpcProcessErrorText.healthPingFailed), {
    source: RPC_PROCESS_ERROR_SOURCE,
    code: RpcProcessErrorCode.healthPingFailed
  })
}

/** Ensures a bootstrap secret is exactly the token supplied to the authenticated adapter. */
function sameUtf8(value: Uint8Array, token: string): boolean {
  // Invalid bootstrap bytes are a deployment mismatch, not an untagged property access error.
  if (!(value instanceof Uint8Array)) return false
  /** The token comparison owns no copy of any malformed caller payload. */
  const expected = new TextEncoder().encode(token)
  if (value.length !== expected.length) return false
  for (let index = 0; index < value.length; index += 1)
    if (value[index] !== expected[index]) return false
  return true
}

/** Rejects deployment mismatches without embedding a token or payload in diagnostics. */
export function validateSpawnProcessPluginDeployment<THandle extends IProcessHandle>(
  deployment: ISpawnProcessPluginDeployment<THandle>,
  specField = 'supervision.spec'
): void {
  if (!deployment || deployment.kind !== 'spawn' || !deployment.supervision)
    invalidOption('deployment.kind')
  if (deployment.channelKind === ProcessPluginChannelKind.messagePort) {
    if (deployment.wire !== undefined) invalidOption('deployment.wire')
    return
  }
  if (deployment.channelKind !== ProcessPluginChannelKind.byte)
    invalidOption('deployment.channelKind')
  if (deployment.wire !== ProcessPluginWire.native && deployment.wire !== ProcessPluginWire.jsonrpc)
    invalidOption('deployment.wire')
  if (typeof deployment.token !== 'string' || deployment.token.length === 0)
    invalidOption('deployment.token')
  const bootstrap = deployment.supervision.spec.bootstrap
  if (!bootstrap || !sameUtf8(bootstrap.payload, deployment.token))
    invalidOption(`${specField}.bootstrap`)
  if (bootstrap.via !== 'stdin' && bootstrap.via !== 'fd')
    invalidOption(`${specField}.bootstrap.via`)
}

/** The single active generation owns one stderr reader subscription and reports listener failures. */
type IProcessStderrSource = Readonly<{
  emit(chunk: Uint8Array): void
  subscribe(next: (chunk: Uint8Array) => void): () => void
}>

/** The active generation alone can subscribe to stderr blocks after its channel is ready. */
/** Allocate one generation stderr subscriber before installing behavior callbacks. */
function processStderrSourceState(report: (error: unknown) => void) {
  /** A closed channel removes its subscription; pre-handshake blocks are not buffered. */
  const listener = undefined as ((chunk: Uint8Array) => void) | undefined

  return { listener, report }
}

/** Own one generation stderr subscriber; callbacks access only this explicit instance. */
class ProcessStderrSource {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof processStderrSourceState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IProcessStderrSource
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(report: (error: unknown) => void) {
    this.#state = processStderrSourceState(report)

    this.value = {
      emit: (chunk: Uint8Array): void => {
        try {
          ;(0, this.#state.listener)?.(chunk)
        } catch (error) {
          reportSafely(this.#state.report, error)
        }
      },
      subscribe: (next: (chunk: Uint8Array) => void): (() => void) => {
        if (this.#state.listener) invalidOption('ipc.stderr')
        this.#state.listener = next
        return () => {
          if (this.#state.listener === next) this.#state.listener = undefined
        }
      }
    }
  }
}

/** Construct the single owner for one generation stderr subscriber. */
function createStderrSource(report: (error: unknown) => void): IProcessStderrSource {
  return new ProcessStderrSource(report).value
}

/** A channel adapter receives one immutable session and the binding's scheduler identity. */
async function establishGeneration(
  raw: IProcessByteChannel | IProcessMessageChannel,
  _wire: ProcessPluginWire | undefined,
  establish: IProcessPluginEstablish,
  signal: INativeAbortSignal,
  scheduler: IScheduler,
  session: IProcessPluginSession,
  token: string | undefined,
  offer: IRpcHandshakeOffer,
  stderr: (listener: (chunk: Uint8Array) => void) => () => void,
  report: (error: unknown) => void,
  closeRaw: () => Promise<void>
): Promise<IRemoteChannel> {
  if (signal.aborted) {
    try {
      await closeRaw()
    } catch (error) {
      reportSafely(report, error)
    }
    throw resolveAbortReason(signal)
  }
  let channel: IRemoteChannel
  try {
    channel = await establish(raw, {
      signal,
      role: 'initiator',
      session,
      scheduler,
      ...(token === undefined ? {} : { token }),
      offer,
      stderr
    })
  } catch (error) {
    try {
      await closeRaw()
    } catch (cleanupError) {
      reportSafely(report, cleanupError)
    }
    throw error
  }
  if (
    channel.scheduler !== scheduler ||
    channel.agreement.source !==
      (raw.kind === ProcessPluginChannelKind.byte ? 'negotiated' : 'static')
  ) {
    try {
      await channel.close()
    } catch (error) {
      reportSafely(report, error)
    }
    invalidOption('deployment.establish')
  }
  /** Core constructors carry their own exact facts; a custom returned transport is never marked. */
  return channel
}

/** Maps an owned process supervisor into the one remote binding contract. */
/** Allocate one native process supervisor binding before installing behavior callbacks. */
function spawnProcessBindingState<THandle extends IProcessHandle>(
  deployment: ISpawnProcessPluginDeployment<THandle>,
  report: (error: unknown) => void,
  trackOwned = false
) {
  validateSpawnProcessPluginDeployment(deployment)
  /** Every generation receives the same caller proposal or one binding-owned default. */
  const offer = deployment.offer ?? defaultProcessOffer(deployment.token)
  /** Caller health has precedence; bridge has no native ping contract. */
  const health = deployment.supervision.health
    ? 'custom'
    : deployment.wire === ProcessPluginWire.jsonrpc
      ? 'none'
      : 'ping'
  if (health === 'ping') requirePingCapabilities(offer.capabilities)
  /** Endpoints are keyed by actual supervisor handles, never by a stale generation number. */
  const channels = new WeakMap<IRemoteChannel, THandle>()
  /** Each genuine native handle retains its own prepared channel and endpoint until adoption. */
  const readyEndpoints = new WeakMap<
    THandle,
    Readonly<{ channel: IRemoteChannel; endpoint: IRemoteServeEndpoint }>
  >()
  /** The configured supervisor clock owns all deadlines and drain timing for this binding. */
  const scheduler = deployment.supervision.scheduler ?? systemScheduler
  /** The existing remote binding drain tracks admitted work across the native generation lifetime. */
  const drain = createRemoteBindingDrain(scheduler, (error) => reportSafely(report, error))
  /** The existing stderr source retains diagnostics for this binding and closes with its owner. */
  const stderr = createStderrSource(report)
  /** The caller output hook remains attached alongside the canonical stderr observer. */
  const callerOutput = deployment.supervision.output?.onChunk
  /** Retain only a live owned unit; a borrowed binding has no corresponding termination port. */
  const currentHandle = undefined as THandle | undefined
  /** Escalation is idempotent per actual handle, including repeated shutdown signals. */
  const forced = new WeakSet<THandle>()

  return {
    offer,
    health: health as IProcessPluginBinding<THandle, IProcessSpec>['health'],
    channels,
    readyEndpoints,
    scheduler,
    drain,
    stderr,
    callerOutput,
    currentHandle,
    forced,
    deployment,
    report,
    trackOwned
  }
}

/** Own one native process supervisor binding; callbacks access only this explicit instance. */
class SpawnProcessBinding<THandle extends IProcessHandle> {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof spawnProcessBindingState<THandle>>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IProcessPluginBinding<THandle, IProcessSpec>
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(
    deployment: ISpawnProcessPluginDeployment<THandle>,
    report: (error: unknown) => void,
    trackOwned = false
  ) {
    this.#state = spawnProcessBindingState(deployment, report, trackOwned)
    const supervisor = createProcessSupervisor({
      ...this.#state.deployment.supervision,
      scheduler: this.#state.scheduler,
      stop: {
        ...this.#state.deployment.supervision.stop,
        beforeTerminate: async (unit, signal, remainingMs) => {
          /** The selected original endpoint receives the exact remaining grace, not a Host budget. */
          await this.#state.drain.drainCurrent({ drainMs: remainingMs() })
          if (!signal.aborted)
            await this.#state.deployment.supervision.stop?.beforeTerminate?.(
              unit,
              signal,
              remainingMs
            )
        }
      },
      ...(this.#state.trackOwned
        ? {
            ready: async (unit: THandle, signal: IAbortSignal) => {
              this.#state.currentHandle = unit
              void unit.exited.then(
                () => {
                  if (this.#state.currentHandle === unit) this.#state.currentHandle = undefined
                },
                (error) => reportSafely(this.#state.report, error)
              )
              await this.#state.deployment.supervision.ready?.(unit, signal)
            }
          }
        : {}),
      ...(this.#state.health === 'ping'
        ? {
            health: {
              check: (unit: THandle, signal: IAbortSignal) =>
                checkNativePing(this.#state.readyEndpoints.get(unit), signal),
              intervalMs: DEFAULT_HEALTH_INTERVAL_MS,
              timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
              failureThreshold: DEFAULT_HEALTH_FAILURE_THRESHOLD
            }
          }
        : {}),
      output: {
        ...this.#state.deployment.supervision.output,
        onChunk: (stream, chunk) => {
          try {
            ;(0, this.#state.callerOutput)?.(stream, chunk)
          } catch (error) {
            reportSafely(this.#state.report, error)
          }
          if (stream === DrainedStream.stderr) this.#state.stderr.emit(chunk)
        }
      }
    })
    this.value = {
      ownership: 'owned',
      supervisor,
      scheduler: this.#state.scheduler,
      health: this.#state.health,
      registrationSupervisor: registrationSupervisor(supervisor),
      trackRequest: this.#state.drain.trackCurrent,
      forceCurrent: () => {
        if (!this.#state.currentHandle || this.#state.forced.has(this.#state.currentHandle)) return
        const unit = this.#state.currentHandle
        this.#state.forced.add(unit)
        // Retire through the existing stop command before exit, so it is not classified as a new
        // unexpected departure with another force teardown. The command still awaits real exited.
        void supervisor.stop().catch((error) => reportSafely(this.#state.report, error))
        unit.terminate(TerminationMode.force)
      },
      drainCurrent: (options) =>
        supervisor.state === 'ready' ? this.#state.drain.drainCurrent(options) : Promise.resolve(),
      bindEndpoint: (channel, endpoint, onExecution) => {
        if (this.#state.health === 'ping') requirePingEndpoint(channel, endpoint)
        const unit = this.#state.channels.get(channel)
        if (!unit) invalidOption('deployment.establish')
        const tracked = this.#state.drain.wrap(channel, endpoint, onExecution)
        this.#state.readyEndpoints.set(unit, { channel, endpoint: tracked })
        return tracked
      },
      openChannel: async (unit, signal) => {
        const raw = await this.#state.deployment.rawChannel(unit, signal)
        if (raw.kind !== this.#state.deployment.channelKind) {
          await raw.close()
          invalidOption('deployment.channelKind')
        }
        const session: IProcessPluginSession = Object.freeze({
          connectionId: defaultRpcId(),
          sessionId: defaultRpcId(),
          processId: unit.identity.fingerprint
        })
        const channel = await establishGeneration(
          raw,
          this.#state.deployment.wire,
          this.#state.deployment.establish,
          signal,
          this.#state.scheduler,
          session,
          this.#state.deployment.token,
          this.#state.offer,
          this.#state.stderr.subscribe,
          this.#state.report,
          () => Promise.resolve(raw.close())
        )
        this.#state.channels.set(channel, unit)
        return channel
      }
    }
  }
}

/** Construct the single owner for one native process supervisor binding. */
export function createSpawnProcessBinding<THandle extends IProcessHandle>(
  deployment: ISpawnProcessPluginDeployment<THandle>,
  report: (error: unknown) => void,
  trackOwned = false
): IProcessPluginBinding<THandle, IProcessSpec> {
  return new SpawnProcessBinding<THandle>(deployment, report, trackOwned).value
}

/** Converts an external socket into a local unit whose exit waits for physical close. */
/** Allocate one external physical connection close receipt before installing behavior callbacks. */
function processConnectionHandleState(raw: IProcessByteChannel) {
  /** The physical close notification settles the local session budget lease. */
  let settleExit!: (value: Readonly<{ reason: unknown }>) => void
  /**
   * One shared terminal Promise preserves native exit identity for every observer of this
   * generation.
   */
  const exited = new Promise<Readonly<{ reason: unknown }>>((resolve) => {
    settleExit = resolve
  })
  /** A close Promise is shared across supervisor stop, endpoint disposal, and EOF. */
  const closing = undefined as Promise<void> | undefined

  return { settleExit, exited, closing, raw, unsubscribe: undefined as unknown as () => void }
}

/** Own one external physical connection close receipt; callbacks access only this explicit instance. */
class ProcessConnectionHandle {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof processConnectionHandleState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IProcessConnectionHandle
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(raw: IProcessByteChannel) {
    this.#state = processConnectionHandleState(raw)
    this.#state.unsubscribe = () => undefined
    this.#state.unsubscribe = this.#state.raw.onClose((reason) => {
      ;(0, this.#state.unsubscribe)()
      ;(0, this.#state.settleExit)({ reason })
    })
    this.value = {
      identity: Object.freeze({ fingerprint: defaultRpcId() }),
      exited: this.#state.exited,
      channel: this.#state.raw,
      close: () =>
        (this.#state.closing ??= Promise.resolve(this.#state.raw.close()).then(() => {
          ;(0, this.#state.unsubscribe)()
          ;(0, this.#state.settleExit)({ reason: undefined })
        }))
    }
  }
}

/** Construct the single owner for one external physical connection close receipt. */
function createConnectionHandle(raw: IProcessByteChannel): IProcessConnectionHandle {
  return new ProcessConnectionHandle(raw).value
}

/** Borrowed socket and adopted channel units share the same local close-only supervision profile. */
export type IProcessConnectionUnit = Pick<IProcessConnectionHandle, 'identity' | 'exited' | 'close'>

/**
 * Reuse process plugin supervision without dialing or inventing another borrowed lifecycle state
 * machine.
 */
export function createProcessConnectionSupervisor<THandle extends IProcessConnectionUnit>(
  address: string,
  scheduler: IScheduler,
  report: (error: unknown) => void,
  launcher: IUnitLauncher<string, THandle>,
  supervision: Pick<
    ISupervisorBaseOptions<THandle>,
    'restart' | 'startupTimeoutMs' | 'stop' | 'terminalPolicy' | 'scheduler' | 'health'
  > = {}
): ISupervisor<THandle, string> {
  /** Local socket supervision owns a single connection unit, independently of service quota. */
  const budget = createUnitBudget({ kind: ProcessConnectionProfile.kind, maxUnits: 1, scheduler })
  /** Both borrowed and adopted units retire through their close handle without PID access. */
  const profile: IUnitProfile<string, THandle, Readonly<{ reason: unknown }>> = {
    kind: ProcessConnectionProfile.kind,
    gracefulTermination: true,
    requirements: () => [],
    validateSpec(address) {
      if (typeof address !== 'string' || address.length === 0) invalidOption('deployment.address')
    },
    terminate(handle) {
      void handle.close().catch((error: unknown) => reportSafely(report, error))
    },
    classifyExit(status) {
      return status.reason === undefined
        ? { reason: 'exited' }
        : { reason: 'crashed', cause: status.reason }
    }
  }
  return createSupervisor({
    id: defaultRpcId(),
    spec: address,
    budget,
    scheduler,
    report,
    ...supervision,
    profile,
    launcher
  })
}

/** Maps a borrowed external process to an owned, single-session socket supervisor. */
/** Allocate one borrowed process connection binding before installing behavior callbacks. */
function connectProcessBindingState(
  deployment: IConnectProcessPluginDeployment,
  report: (error: unknown) => void
) {
  if (
    !deployment ||
    deployment.kind !== 'connect' ||
    typeof deployment.address !== 'string' ||
    deployment.address.length === 0
  )
    invalidOption('deployment.address')
  if (typeof deployment.token !== 'string' || deployment.token.length === 0)
    invalidOption('deployment.token')
  if (deployment.wire !== undefined && !Object.values(ProcessPluginWire).includes(deployment.wire))
    invalidOption('deployment.wire')
  /** A borrowed session keeps one stable proposal across reconnect generations. */
  const offer = deployment.offer ?? defaultProcessOffer(deployment.token)
  /** Explicit health overrides the wire default; JSON-RPC has no native ping contract. */
  const health = deployment.supervision?.health
    ? 'custom'
    : deployment.wire === ProcessPluginWire.jsonrpc
      ? 'none'
      : 'ping'
  if (health === 'ping') requirePingCapabilities(offer.capabilities)
  /** Endpoints are keyed by actual supervisor handles, never by a stale generation number. */
  const channels = new WeakMap<IRemoteChannel, IProcessConnectionHandle>()
  /** Each genuine native handle retains its own prepared channel and endpoint until adoption. */
  const readyEndpoints = new WeakMap<
    IProcessConnectionHandle,
    Readonly<{ channel: IRemoteChannel; endpoint: IRemoteServeEndpoint }>
  >()
  /** The configured supervisor clock owns all deadlines and drain timing for this binding. */
  const scheduler = deployment.supervision?.scheduler ?? systemScheduler
  /** The existing remote binding drain tracks admitted work across the native generation lifetime. */
  const drain = createRemoteBindingDrain(scheduler, (error) => reportSafely(report, error))

  return {
    offer,
    health: health as IProcessPluginBinding<IProcessConnectionHandle, string>['health'],
    channels,
    readyEndpoints,
    scheduler,
    drain,
    deployment,
    report
  }
}

/** Own one borrowed process connection binding; callbacks access only this explicit instance. */
class ConnectProcessBinding {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof connectProcessBindingState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IProcessPluginBinding<IProcessConnectionHandle, string>
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(deployment: IConnectProcessPluginDeployment, report: (error: unknown) => void) {
    this.#state = connectProcessBindingState(deployment, report)
    const supervisor = createProcessConnectionSupervisor(
      this.#state.deployment.address,
      this.#state.scheduler,
      this.#state.report,
      {
        capabilities: {},
        launch: async (address, context) => {
          const raw = await this.#state.deployment.dial(address, context.signal)
          if (context.signal.aborted) {
            await raw.close()
            throw resolveAbortReason(context.signal)
          }
          return createConnectionHandle(raw)
        }
      },
      {
        ...this.#state.deployment.supervision,
        ...(this.#state.health === 'ping'
          ? {
              health: {
                check: (unit: IProcessConnectionHandle, signal: IAbortSignal) =>
                  checkNativePing(this.#state.readyEndpoints.get(unit), signal),
                intervalMs: DEFAULT_HEALTH_INTERVAL_MS,
                timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
                failureThreshold: DEFAULT_HEALTH_FAILURE_THRESHOLD
              }
            }
          : {})
      }
    )
    this.value = {
      ownership: 'owned',
      supervisor,
      scheduler: this.#state.scheduler,
      health: this.#state.health,
      registrationSupervisor: registrationSupervisor(supervisor),
      trackRequest: this.#state.drain.trackCurrent,
      drainCurrent: (options) =>
        supervisor.state === 'ready' ? this.#state.drain.drainCurrent(options) : Promise.resolve(),
      bindEndpoint: (channel, endpoint, onExecution) => {
        if (this.#state.health === 'ping') requirePingEndpoint(channel, endpoint)
        const unit = this.#state.channels.get(channel)
        if (!unit) invalidOption('deployment.establish')
        const tracked = this.#state.drain.wrap(channel, endpoint, onExecution)
        this.#state.readyEndpoints.set(unit, { channel, endpoint: tracked })
        return tracked
      },
      openChannel: async (unit, signal) => {
        const session: IProcessPluginSession = Object.freeze({
          connectionId: defaultRpcId(),
          sessionId: unit.identity.fingerprint
        })
        const channel = await establishGeneration(
          unit.channel,
          this.#state.deployment.wire,
          this.#state.deployment.establish,
          signal,
          this.#state.scheduler,
          session,
          this.#state.deployment.token,
          this.#state.offer,
          () => () => undefined,
          this.#state.report,
          unit.close
        )
        this.#state.channels.set(channel, unit)
        return channel
      }
    }
  }
}

/** Construct the single owner for one borrowed process connection binding. */
export function createConnectProcessBinding(
  deployment: IConnectProcessPluginDeployment,
  report: (error: unknown) => void
): IProcessPluginBinding<IProcessConnectionHandle, string> {
  return new ConnectProcessBinding(deployment, report).value
}

/** One internal entry point keeps processHost on the same spawn and connect ownership paths. */
export function createProcessBinding<THandle extends IProcessHandle>(
  deployment: ISpawnProcessPluginDeployment<THandle>,
  report: (error: unknown) => void
): IRemoteBinding<THandle, IProcessSpec>
export function createProcessBinding(
  deployment: IConnectProcessPluginDeployment,
  report: (error: unknown) => void
): IRemoteBinding<IProcessConnectionHandle, string>
export function createProcessBinding<THandle extends IProcessHandle>(
  deployment: ISpawnProcessPluginDeployment<THandle> | IConnectProcessPluginDeployment,
  report: (error: unknown) => void
): IRemoteBinding<THandle, IProcessSpec> | IRemoteBinding<IProcessConnectionHandle, string> {
  return deployment.kind === 'spawn'
    ? createSpawnProcessBinding(deployment, report)
    : createConnectProcessBinding(deployment, report)
}
