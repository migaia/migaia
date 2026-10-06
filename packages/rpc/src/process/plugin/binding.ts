import { resolveAbortReason } from '../../core/internal/async-control.js'
import { defaultRpcId } from '../../core/internal/id.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
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
import type { IAbortSignal } from '@migaia/lifecycle'
import type { IRemoteBinding, IRemoteChannel } from '../../remote/types.js'
import type { IRemoteServeEndpoint } from '../../remote/types.js'
import type { IRpcHandshakeOffer } from '../../contract/handshake.js'
import { RpcCapability } from '../../contract/wire-constants.js'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import { createNativeProcessOffer } from '../offer.js'
import {
  DEFAULT_HEALTH_FAILURE_THRESHOLD,
  DEFAULT_HEALTH_INTERVAL_MS,
  DEFAULT_HEALTH_TIMEOUT_MS
} from '../resilience/constants.js'
import { createRemoteBindingDrain } from '../../remote/internal/binding-drain.js'
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
    bindEndpoint(channel: IRemoteChannel, endpoint: IRemoteServeEndpoint): IRemoteServeEndpoint
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
  throw createProcessError(RpcProcessErrorCode.pluginInvalidOption, undefined, { field })
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
    throw createProcessError(RpcProcessErrorCode.resilienceInvalidOption, undefined, {
      field: 'deployment.offer.capabilities'
    })
}

/** A ready endpoint must support the capability that the supervisor will probe. */
export function requirePingEndpoint(channel: IRemoteChannel, endpoint: IRemoteServeEndpoint): void {
  requirePingCapabilities(channel.agreement.capabilities)
  if (typeof endpoint.endpoint.ping !== 'function')
    throw createProcessError(RpcProcessErrorCode.resilienceInvalidOption, undefined, {
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
  throw createProcessError(RpcProcessErrorCode.healthPingFailed)
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
  if (deployment.wire === ProcessPluginWire.jsonrpc && bootstrap.via !== 'fd')
    invalidOption(`${specField}.bootstrap.via`)
  if (
    deployment.wire === ProcessPluginWire.native &&
    bootstrap.via !== 'stdin' &&
    bootstrap.via !== 'fd'
  )
    invalidOption(`${specField}.bootstrap.via`)
}

/** The active generation alone can subscribe to stderr blocks after its channel is ready. */
function createStderrSource(report: (error: unknown) => void) {
  /** A closed channel removes its subscription; pre-handshake blocks are not buffered. */
  let listener: ((chunk: Uint8Array) => void) | undefined
  return {
    emit(chunk: Uint8Array): void {
      try {
        listener?.(chunk)
      } catch (error) {
        reportSafely(report, error)
      }
    },
    subscribe(next: (chunk: Uint8Array) => void): () => void {
      if (listener) invalidOption('ipc.stderr')
      listener = next
      return () => {
        if (listener === next) listener = undefined
      }
    }
  }
}

/** A channel adapter receives one immutable session and the binding's scheduler identity. */
async function establishGeneration(
  raw: IProcessByteChannel | IProcessMessageChannel,
  establish: IProcessPluginEstablish,
  signal: IAbortSignal,
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
  return channel
}

/** Maps an owned process supervisor into the one remote binding contract. */
export function createSpawnProcessBinding<THandle extends IProcessHandle>(
  deployment: ISpawnProcessPluginDeployment<THandle>,
  report: (error: unknown) => void,
  trackOwned = false
): IProcessPluginBinding<THandle, IProcessSpec> {
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
  const readyEndpoints = new WeakMap<
    THandle,
    Readonly<{ channel: IRemoteChannel; endpoint: IRemoteServeEndpoint }>
  >()
  const scheduler = deployment.supervision.scheduler ?? systemScheduler
  const drain = createRemoteBindingDrain(scheduler, (error) => reportSafely(report, error))
  const stderr = createStderrSource(report)
  const callerOutput = deployment.supervision.output?.onChunk
  /** Retain only a live owned unit; a borrowed binding has no corresponding termination port. */
  let currentHandle: THandle | undefined
  /** Escalation is idempotent per actual handle, including repeated shutdown signals. */
  const forced = new WeakSet<THandle>()
  const supervisor = createProcessSupervisor({
    ...deployment.supervision,
    scheduler,
    stop: {
      ...deployment.supervision.stop,
      beforeTerminate: async (unit, signal, remainingMs) => {
        /** The selected original endpoint receives the exact remaining grace, not a Host budget. */
        await drain.drainCurrent({ drainMs: remainingMs() })
        if (!signal.aborted)
          await deployment.supervision.stop?.beforeTerminate?.(unit, signal, remainingMs)
      }
    },
    ...(trackOwned
      ? {
          async ready(unit: THandle, signal: IAbortSignal) {
            currentHandle = unit
            void unit.exited.then(
              () => {
                if (currentHandle === unit) currentHandle = undefined
              },
              (error) => reportSafely(report, error)
            )
            await deployment.supervision.ready?.(unit, signal)
          }
        }
      : {}),
    ...(health === 'ping'
      ? {
          health: {
            check: (unit: THandle, signal: IAbortSignal) =>
              checkNativePing(readyEndpoints.get(unit), signal),
            intervalMs: DEFAULT_HEALTH_INTERVAL_MS,
            timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
            failureThreshold: DEFAULT_HEALTH_FAILURE_THRESHOLD
          }
        }
      : {}),
    output: {
      ...deployment.supervision.output,
      onChunk(stream, chunk) {
        try {
          callerOutput?.(stream, chunk)
        } catch (error) {
          reportSafely(report, error)
        }
        if (stream === DrainedStream.stderr) stderr.emit(chunk)
      }
    }
  })
  return {
    ownership: 'owned',
    supervisor,
    scheduler,
    health,
    registrationSupervisor: registrationSupervisor(supervisor),
    trackRequest: drain.trackCurrent,
    forceCurrent() {
      if (!currentHandle || forced.has(currentHandle)) return
      const unit = currentHandle
      forced.add(unit)
      // Retire through the existing stop command before exit, so it is not classified as a new
      // unexpected departure with another force teardown. The command still awaits real exited.
      void supervisor.stop().catch((error) => reportSafely(report, error))
      unit.terminate(TerminationMode.force)
    },
    drainCurrent: (options) =>
      supervisor.state === 'ready' ? drain.drainCurrent(options) : Promise.resolve(),
    bindEndpoint(channel, endpoint) {
      if (health === 'ping') requirePingEndpoint(channel, endpoint)
      const unit = channels.get(channel)
      if (!unit) invalidOption('deployment.establish')
      const tracked = drain.wrap(channel, endpoint)
      readyEndpoints.set(unit, { channel, endpoint: tracked })
      return tracked
    },
    async openChannel(unit, signal) {
      const raw = await deployment.rawChannel(unit, signal)
      if (raw.kind !== deployment.channelKind) {
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
        deployment.establish,
        signal,
        scheduler,
        session,
        deployment.token,
        offer,
        stderr.subscribe,
        report,
        () => Promise.resolve(raw.close())
      )
      channels.set(channel, unit)
      return channel
    }
  }
}

/** Converts an external socket into a local unit whose exit waits for physical close. */
function createConnectionHandle(raw: IProcessByteChannel): IProcessConnectionHandle {
  /** The physical close notification settles the local session budget lease. */
  let settleExit!: (value: Readonly<{ reason: unknown }>) => void
  const exited = new Promise<Readonly<{ reason: unknown }>>((resolve) => {
    settleExit = resolve
  })
  /** A close Promise is shared across supervisor stop, endpoint disposal, and EOF. */
  let closing: Promise<void> | undefined
  /** A closed dialer may notify synchronously during subscription. */
  let unsubscribe: () => void = () => undefined
  unsubscribe = raw.onClose((reason) => {
    unsubscribe()
    settleExit({ reason })
  })
  return {
    identity: Object.freeze({ fingerprint: defaultRpcId() }),
    exited,
    channel: raw,
    close: () =>
      (closing ??= Promise.resolve(raw.close()).then(() => {
        unsubscribe()
        settleExit({ reason: undefined })
      }))
  }
}

/** Borrowed socket and adopted channel units share the same local close-only supervision profile. */
export type IProcessConnectionUnit = Pick<IProcessConnectionHandle, 'identity' | 'exited' | 'close'>

/** Reuse PP2 supervision without dialing or inventing another borrowed lifecycle state machine. */
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
export function createConnectProcessBinding(
  deployment: IConnectProcessPluginDeployment,
  report: (error: unknown) => void
): IProcessPluginBinding<IProcessConnectionHandle, string> {
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
  const channels = new WeakMap<IRemoteChannel, IProcessConnectionHandle>()
  const readyEndpoints = new WeakMap<
    IProcessConnectionHandle,
    Readonly<{ channel: IRemoteChannel; endpoint: IRemoteServeEndpoint }>
  >()
  const scheduler = deployment.supervision?.scheduler ?? systemScheduler
  const drain = createRemoteBindingDrain(scheduler, (error) => reportSafely(report, error))
  const supervisor = createProcessConnectionSupervisor(
    deployment.address,
    scheduler,
    report,
    {
      capabilities: {},
      async launch(address, context) {
        const raw = await deployment.dial(address, context.signal)
        if (context.signal.aborted) {
          await raw.close()
          throw resolveAbortReason(context.signal)
        }
        return createConnectionHandle(raw)
      }
    },
    {
      ...deployment.supervision,
      ...(health === 'ping'
        ? {
            health: {
              check: (unit: IProcessConnectionHandle, signal: IAbortSignal) =>
                checkNativePing(readyEndpoints.get(unit), signal),
              intervalMs: DEFAULT_HEALTH_INTERVAL_MS,
              timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
              failureThreshold: DEFAULT_HEALTH_FAILURE_THRESHOLD
            }
          }
        : {})
    }
  )
  return {
    ownership: 'owned',
    supervisor,
    scheduler,
    health,
    registrationSupervisor: registrationSupervisor(supervisor),
    trackRequest: drain.trackCurrent,
    drainCurrent: (options) =>
      supervisor.state === 'ready' ? drain.drainCurrent(options) : Promise.resolve(),
    bindEndpoint(channel, endpoint) {
      if (health === 'ping') requirePingEndpoint(channel, endpoint)
      const unit = channels.get(channel)
      if (!unit) invalidOption('deployment.establish')
      const tracked = drain.wrap(channel, endpoint)
      readyEndpoints.set(unit, { channel, endpoint: tracked })
      return tracked
    },
    async openChannel(unit, signal) {
      const session: IProcessPluginSession = Object.freeze({
        connectionId: defaultRpcId(),
        sessionId: unit.identity.fingerprint
      })
      const channel = await establishGeneration(
        unit.channel,
        deployment.establish,
        signal,
        scheduler,
        session,
        deployment.token,
        offer,
        () => () => undefined,
        report,
        unit.close
      )
      channels.set(channel, unit)
      return channel
    }
  }
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
