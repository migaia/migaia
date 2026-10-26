/**
 * Connects real spawn/connect supervisors and acquired Process carriers to SDK member generations
 * and controls. Native exit, stderr and cleanup stay here; Host owns RPC admission and calls.
 */
import { deferred, hostRethrowReporter, type IAbortSignal } from '@migaia/utils/promise'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import {
  createSupervisor,
  SupervisorEventType,
  createUnitBudget,
  type ISupervisor,
  type ILaunchContext,
  type IUnitLauncher,
  type ISupervisorBaseOptions,
  type IUnitProfile,
  type ISupervisorEvent
} from '@migaia/supervision'
import {
  createProcessSupervisor,
  DrainedStream,
  type IProcessHandle,
  type IProcessSpec
} from '@migaia/supervision/process'
import {
  RpcMemberGeneration,
  RpcNativeMembers,
  withRpcLaunchFacts,
  rpcMemberConnectionDetail,
  rpcMemberResources,
  defaultRpcId,
  RpcMemberSourceKind,
  RpcMemberConnectionDirection,
  IpcReporterContext,
  resolveAbortReason,
  markRpcCarrierAdmissionFailure,
  type IRpcTransportSetupContext,
  type IRpcNativeMemberRecord,
  type IRpcMemberNativeUnit,
  type IRpcNativePoolEvents
} from '@migaia/rpc-host/sdk'
import type { IRpcSessionHandle, IRpcSessionView } from '@migaia/rpc-contract/interfaces'
import { RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'
import { createProcessCleanupError, createProcessError } from '../error.js'
import { createProcessCarrier } from '../carrier.js'
import {
  acceptProcessConnectionBootstrap,
  openProcessConnectionBootstrap
} from '../connection-bootstrap.js'
import { PROCESS_CONNECTION_RUNTIME, PROCESS_NAMESPACE } from '../constants.js'
import type { IRpcConnectionContext } from '@migaia/rpc-contract/interfaces'
import type { IProcessByteChannel, IProcessMessageChannel } from '../types.js'
import {
  DEFAULT_HEALTH_FAILURE_THRESHOLD,
  DEFAULT_HEALTH_INTERVAL_MS,
  DEFAULT_HEALTH_TIMEOUT_MS
} from '../resilience/constants.js'
import { ProcessConnectionProfile } from './constants.js'
import type {
  IProcessFeature,
  IConnectProcessPluginDeployment,
  IProcessConnectionHandle,
  ISpawnProcessPluginDeployment
} from './types.js'

/** Secondary diagnostics never replace the native error that triggered rollback. */
export function reportSafely(report: (error: unknown) => void, error: unknown): void {
  try {
    report(error)
  } catch (failure) {
    hostRethrowReporter(failure, IpcReporterContext)
  }
}
/** Reject one supported native recipe mismatch before acquiring its execution unit. */
export function invalidOption(field: string): never {
  throw createProcessError(RpcProcessErrorCode.pluginInvalidOption, undefined, { field })
}
/** The original launch token must match the spec's actual private bootstrap bytes. */
function sameUtf8(value: Uint8Array, token: string): boolean {
  if (!(value instanceof Uint8Array)) return false
  /** The comparison captures no malformed source text or secret diagnostic. */
  const expected = new TextEncoder().encode(token)
  if (value.length !== expected.length) return false
  for (let index = 0; index < value.length; index++)
    if (value[index] !== expected[index]) return false
  return true
}
/** Native bytes need a matching private bootstrap; whole-message custom sources do not invent one. */
export function validateSpawnProcessPluginDeployment<THandle extends IProcessHandle>(
  source: ISpawnProcessPluginDeployment<THandle>,
  specField = 'supervision.spec'
): void {
  if (!source || source.kind !== 'spawn' || !source.supervision) invalidOption('deployment.kind')
  if (source.channelKind === 'message') return
  if (source.channelKind !== 'byte') invalidOption('deployment.channelKind')
  if (!source.token) invalidOption('deployment.token')
  /** The original spec, rather than a peer claim, supplies private launch data. */
  const bootstrap = source.supervision.spec.bootstrap
  if (!bootstrap || !sameUtf8(bootstrap.payload, source.token))
    invalidOption(`${specField}.bootstrap`)
  if (bootstrap.via !== 'stdin' && bootstrap.via !== 'fd')
    invalidOption(`${specField}.bootstrap.via`)
}
/** One actual generation forwards stderr without retaining pre-attachment bytes. */
class ProcessStderrSource {
  /** Exactly one active connection owns this original native output subscription. */
  #listener: ((chunk: Uint8Array) => void) | undefined
  /** Reporter failures follow the same utils terminal reporting path. */
  readonly #report: (error: unknown) => void
  /** Native supervision owns the emitter; this object owns only its current observer. */
  constructor(report: (error: unknown) => void) {
    this.#report = report
  }
  /** Caller output and native draining remain independent from the optional log observer. */
  readonly emit = (chunk: Uint8Array): void => {
    try {
      this.#listener?.(chunk)
    } catch (error) {
      reportSafely(this.#report, error)
    }
  }
  /** A stale remover cannot detach a later connection's original listener. */
  readonly subscribe = (listener: (chunk: Uint8Array) => void): (() => void) => {
    if (this.#listener) invalidOption('ipc.stderr')
    this.#listener = listener
    return () => {
      if (this.#listener === listener) this.#listener = undefined
    }
  }
}
/** The original supervisor borrows accepted Session controls and exact launch facts, never a Peer. */
type IProcessSupervisorPorts<TUnit extends object, TSpec> = Readonly<{
  providerId: string
  health(unit: TUnit, signal: IAbortSignal): Promise<void>
  drain(unit: TUnit, remainingMs: number): Promise<void>
  close(unit: TUnit): Promise<void>
  launch(
    launcher: IUnitLauncher<TSpec, TUnit>,
    spec: TSpec,
    context: ILaunchContext
  ): Promise<TUnit>
}>
/** Native recipes supply their actual supervisor and raw resource acquisition to the one SDK owner. */
type IProcessBindingOptions<TUnit extends object, TSpec> = Readonly<{
  context: IRpcTransportSetupContext
  name: string
  /** Only an explicitly configured logical child name enters native bootstrap facts. */
  childName?: string
  kind: 'spawn' | 'connect'
  scheduler: IScheduler
  features?: readonly IProcessFeature[]
  events?: IRpcNativePoolEvents
  create(ports: IProcessSupervisorPorts<TUnit, TSpec>): ISupervisor<TUnit, TSpec>
  openRaw(unit: TUnit, signal: IAbortSignal): Promise<IProcessByteChannel | IProcessMessageChannel>
  expectedPeerId?(unit: TUnit): string
  /** Only a launched native process can supply its physical PID to redacted IPC diagnostics. */
  processId?(unit: TUnit): string
  /** A native execution unit supplies its actual exit fact without waiting in the transport. */
  terminalReason?(unit: TUnit): Promise<unknown>
  prepareReplacement?(spec: unknown): TSpec
  stderr?: (listener: (chunk: Uint8Array) => void) => () => void
  /** Original native source configuration supplies its connection token only to private admission. */
  token?: string
}>

/** Process owns native acquisition/control; SDK alone owns generation publish/rebind/rollback. */
export class ProcessBinding<TUnit extends object, TSpec> {
  /** Immutable native acquisition ports and the real installed host context. */
  readonly #options: IProcessBindingOptions<TUnit, TSpec>
  /** A stable source issuer is distinct from a caller's native supervisor id. */
  readonly #providerId = defaultRpcId()
  /** First accepted private identity remains the original pool registration name after native stop. */
  #memberName: string | undefined
  /** Health keeps the exact accepted receipt, including its closed state, until native retirement. */
  readonly #sessions = new WeakMap<TUnit, IRpcSessionHandle>()
  /** Cold resource reads retain the selected actual native unit and accepted directory receipt. */
  #accepted: Readonly<{ unit: TUnit; view: IRpcSessionView }> | undefined
  /** Later native terminal facts update only this registration's last actually accepted handle. */
  #lastSession: IRpcSessionHandle | undefined
  /** Native lifetime, stop grace and budget remain exclusively with this original supervisor. */
  readonly supervisor: ISupervisor<TUnit, TSpec>
  /** One shared algorithm owns all accepted/rebind/rollback/leave behavior. */
  readonly generation: RpcMemberGeneration<TUnit, TSpec>
  /** Public controls borrow this same registration, not a new member registry. */
  readonly members: RpcNativeMembers<'process'> | undefined
  /** One actual registration is sufficient for this installed source. */
  readonly record: IRpcNativeMemberRecord

  /** Initialize native supervision before publishing any accepted member or control surface. */
  constructor(options: IProcessBindingOptions<TUnit, TSpec>) {
    this.#options = options
    this.supervisor = options.create({
      providerId: this.#providerId,
      health: this.#health,
      drain: this.#drain,
      close: this.#closeSession,
      launch: this.#launch
    })
    this.generation = new RpcMemberGeneration({
      context: options.context,
      signal: options.context.signal,
      report: options.context.report,
      binding: {
        ownership: 'owned',
        supervisor: this.supervisor,
        scheduler: options.scheduler,
        openCarrier: this.#openCarrier
      },
      beforeRelease: () => this.supervisor.stop(),
      onReady: (view, generation, unit, session) => {
        this.#accepted = { unit, view }
        this.#memberName ??= view.name
        this.#lastSession = session
        this.#sessions.set(unit, session)
        if (options.events) {
          options.events.ready(this.record, view, generation)
          options.events.changed()
        } else this.members!.publishReady(this.record, view, generation)
      },
      onNative: this.#native
    })
    /** Private member names come from the actual accepted native identity without pool aliases. */
    const identity = { options, owner: this }
    this.record = {
      get name() {
        return identity.owner.#memberName ?? identity.options.name
      },
      ownership: options.kind === 'spawn' ? 'owned' : 'borrowed',
      supervisor: this.supervisor as ISupervisor<unknown, unknown>,
      current: () => this.generation.current(),
      whenReady: () => this.generation.rebind(),
      prepareReplacement: options.prepareReplacement,
      describe: this.#describe,
      now: () => options.scheduler.now()
    }
    this.members = options.events
      ? undefined
      : new RpcNativeMembers({
          kind: 'process',
          self: options.context.self,
          report: options.context.report,
          source: {
            values: () => [this.record],
            byName: (name) => (name === this.record.name ? this.record : undefined),
            byInstance: (id) =>
              id === this.generation.current().session?.peerId ? this.record : undefined
          }
        })
  }
  /** Actual supervision terminal state mints Process policy before updating its original handle. */
  readonly #native = (
    event: ISupervisorEvent<TUnit>,
    current: ReturnType<RpcMemberGeneration<TUnit, TSpec>['current']>
  ): void => {
    if (event.type === SupervisorEventType.terminal && this.#lastSession) {
      /** Raw exit errors do not imply terminal admission; only this explicit native event does. */
      const reason = markRpcCarrierAdmissionFailure(
        createProcessError(RpcProcessErrorCode.terminalCall, event.error, {
          registrationId: this.#options.name
        })
      )
      void this.#options.context
        .detach(this.#lastSession, reason)
        .catch(this.#options.context.report)
    }
    if (this.#accepted?.view !== this.generation.current().session) this.#accepted = undefined
    if (this.#options.events) this.#options.events.native(this.record, event, current)
    else this.members!.publishNative(this.record, event, current)
  }
  /** Preserve custom launcher context identity while lending actual parent and generation facts. */
  readonly #launch = (
    launcher: IUnitLauncher<TSpec, TUnit>,
    spec: TSpec,
    context: ILaunchContext
  ): Promise<TUnit> => {
    /** Only host supplies the current parent identity; the bootstrap parent record remains closed. */
    const self = this.#options.context.self()
    /** One explicit invocation holds only original data and native launcher authority. */
    const operation = { launcher, spec, context }
    return withRpcLaunchFacts(
      context,
      {
        parent: { name: self.name, instanceId: self.instanceId },
        ...(this.#options.childName === undefined ? {} : { childName: this.#options.childName }),
        generation: {
          kind: 'restart',
          value: context.executionGeneration ?? 0,
          providerId: this.#providerId
        }
      },
      () => operation.launcher.launch(operation.spec, operation.context)
    )
  }
  /** Supervision remains the only health clock; absent readiness does not probe another unit. */
  readonly #health = async (unit: TUnit, signal: IAbortSignal): Promise<void> => {
    /** Even a closed exact receipt is retained so its next native health check correctly fails. */
    const session = this.#sessions.get(unit)
    if (session) await this.#options.context.ping(session, { timeoutMs: false, signal })
  }
  /** Drain only this original unit with the supervisor's already-decreasing grace. */
  readonly #drain = async (unit: TUnit, remainingMs: number): Promise<void> => {
    /** No mutable name lookup can redirect shutdown to a replacement execution. */
    const session = this.#sessions.get(unit)
    if (session) await this.#options.context.drain(session, remainingMs)
  }
  /** The same accepted Session finishes closing before its actual execution unit is terminated. */
  readonly #closeSession = async (unit: TUnit): Promise<void> => {
    /** Retain the original receipt even if a same-name replacement is already published. */
    const session = this.#sessions.get(unit)
    if (session) await this.#options.context.detach(session)
  }
  /** Adopt one original native channel and roll it back if carrier construction fails. */
  readonly #openCarrier = async (unit: TUnit, signal: IAbortSignal) => {
    /** Acquired raw IO stays with this exact native execution unit. */
    let raw = await this.#options.openRaw(unit, signal)
    try {
      if (signal.aborted) throw resolveAbortReason(signal)
      /**
       * Only native byte connections perform token admission; custom messages retain their own
       * trust.
       */
      let connectionContext: IRpcConnectionContext | undefined
      if (raw.kind === 'byte') {
        /** Every native byte recipe was checked for this original configured token before launch. */
        const token = this.#options.token!
        /**
         * Original native cancellation and the original scheduler own complete connection
         * admission.
         */
        const options = {
          signal,
          scheduler: this.#options.scheduler,
          report: this.#options.context.report
        }
        /** Parent/child proof and external socket proof share the same native bootstrap owner. */
        const admitted =
          this.#options.kind === 'connect'
            ? await openProcessConnectionBootstrap(
                raw,
                token,
                {
                  id: this.#options.context.self().instanceId,
                  runtime: PROCESS_CONNECTION_RUNTIME
                },
                options
              )
            : await acceptProcessConnectionBootstrap(
                raw,
                { token, expectedPeerId: this.#options.expectedPeerId?.(unit) },
                options
              )
        raw = admitted.channel
        connectionContext = admitted.connectionContext
      }
      /** Nonsecret labels are separate from both native PID and the original launch credential. */
      const id = defaultRpcId()
      return {
        carrier: createProcessCarrier(raw, this.#options.context, {
          id,
          terminalReason: this.#options.terminalReason
            ? () => this.#options.terminalReason!(unit)
            : undefined,
          features: this.#options.features,
          ipc: {
            connectionId: id,
            sessionId: id,
            processId: this.#options.processId?.(unit),
            stderr: this.#options.stderr,
            log: () => undefined
          }
        }),
        connectionContext,
        localSourceFacts: {
          expectedPeerId: this.#options.expectedPeerId?.(unit),
          sessionId: id,
          isExclusive: raw.kind === 'byte' ? raw.isExclusive : undefined
        }
      }
    } catch (error) {
      try {
        await raw.close()
      } catch (cleanup) {
        reportSafely(this.#options.context.report, cleanup)
      }
      throw error
    }
  }
  /** Cold overview projects only the captured native unit and never samples its successor. */
  readonly #describe = async () => {
    /** A single accepted receipt determines all subsequent native sampling and retirement checks. */
    const view = this.generation.current().session
    /** Undefined is meaningful when startup has not accepted a native unit yet. */
    const selected = this.#accepted?.view === view ? this.#accepted : undefined
    /** Preserve the original supervisor snapshot before any asynchronous sampler operation. */
    const snapshot = this.supervisor.inspect()
    /** One local record carries the exact captured execution identity across the sampler await. */
    const selection = { owner: this, selected, view }
    /** Optional native fields are read by their original shared projector; no data is fabricated. */
    const resources = await rpcMemberResources(
      selected?.unit as IRpcMemberNativeUnit | undefined,
      'process',
      () => this.#options.scheduler.now(),
      this.#options.context.report,
      () =>
        selection.owner.#accepted === selection.selected &&
        selection.owner.generation.current().session === selection.view
    )
    return [
      rpcMemberConnectionDetail(
        {
          kind:
            this.#options.kind === 'spawn'
              ? RpcMemberSourceKind.spawn
              : RpcMemberSourceKind.connect,
          direction:
            this.#options.kind === 'spawn'
              ? RpcMemberConnectionDirection.spawned
              : RpcMemberConnectionDirection.connect,
          carrier: this.#providerId,
          ...(view
            ? {
                description: {
                  self: { name: view.name, instanceId: view.peerId, generation: view.generation },
                  methods: [...view.methods.values()]
                }
              }
            : {})
        },
        snapshot.state,
        {
          supervisor: snapshot,
          resources,
          observedAt: this.#options.scheduler.now(),
          report: this.#options.context.report
        }
      )
    ]
  }
  /** Join native stop and accepted Session retirement before releasing passive observers. */
  async close(): Promise<void> {
    try {
      await this.generation.close()
    } finally {
      this.#accepted = undefined
      this.#lastSession = undefined
      this.members?.close()
    }
  }
}

/** One readonly native recipe borrows the actual source, clock and existing Session-control ports. */
type IProcessSpawnRecipe<THandle extends IProcessHandle> = Readonly<{
  source: ISpawnProcessPluginDeployment<THandle>
  context: IRpcTransportSetupContext
  stderr: ProcessStderrSource
  scheduler: IScheduler
  ports: IProcessSupervisorPorts<THandle, IProcessSpec>
}>

/** Preserve drain and caller-hook order, then join Session closing before actual native stop. */
async function beforeProcessTerminate<TUnit>(
  ports: Readonly<{
    drain(unit: TUnit, remainingMs: number): Promise<void>
    close(unit: TUnit): Promise<void>
  }>,
  unit: TUnit,
  signal: AbortSignal,
  remainingMs: () => number,
  stop?: Readonly<{
    beforeTerminate?(unit: TUnit, signal: AbortSignal, remainingMs: () => number): unknown
  }>
): Promise<void> {
  /** Independent drain/hook and close failures keep their original order and exact objects. */
  const errors: unknown[] = []
  try {
    await ports.drain(unit, remainingMs())
    if (!signal.aborted) await stop?.beforeTerminate?.(unit, signal, remainingMs)
  } catch (error) {
    errors.push(error)
  }
  try {
    await ports.close(unit)
  } catch (error) {
    errors.push(error)
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw createProcessCleanupError(errors)
}

/** Caller output runs before forwarding the same stderr chunk to its original optional log owner. */
function processSpawnOutput<THandle extends IProcessHandle>(
  recipe: IProcessSpawnRecipe<THandle>,
  stream: DrainedStream,
  chunk: Uint8Array
): void {
  try {
    recipe.source.supervision.output?.onChunk?.(stream, chunk)
  } catch (error) {
    reportSafely(recipe.context.report, error)
  }
  if (stream === DrainedStream.stderr) recipe.stderr.emit(chunk)
}

/**
 * Native callbacks retain their actual launcher receivers, prewarm identity and original stop
 * order.
 */
function createSpawnProcessSupervisor<THandle extends IProcessHandle>(
  recipe: IProcessSpawnRecipe<THandle>
): ISupervisor<THandle, IProcessSpec> {
  return createProcessSupervisor({
    ...recipe.source.supervision,
    scheduler: recipe.scheduler,
    launcher:
      recipe.source.supervision.prewarm !== undefined
        ? recipe.source.supervision.launcher
        : {
            capabilities: recipe.source.supervision.launcher.capabilities,
            launch: (spec, launchContext) =>
              recipe.ports.launch(recipe.source.supervision.launcher, spec, launchContext),
            ...(recipe.source.supervision.launcher.probe
              ? { probe: (record) => recipe.source.supervision.launcher.probe!(record) }
              : {}),
            ...(recipe.source.supervision.launcher.terminateRecord
              ? {
                  terminateRecord: (record) =>
                    recipe.source.supervision.launcher.terminateRecord!(record)
                }
              : {})
          },
    health: recipe.source.supervision.health ?? {
      check: recipe.ports.health,
      intervalMs: DEFAULT_HEALTH_INTERVAL_MS,
      timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
      failureThreshold: DEFAULT_HEALTH_FAILURE_THRESHOLD
    },
    stop: {
      ...recipe.source.supervision.stop,
      beforeTerminate: (unit, signal, remainingMs) =>
        beforeProcessTerminate(
          recipe.ports,
          unit,
          signal,
          remainingMs,
          recipe.source.supervision.stop
        )
    },
    output: {
      ...recipe.source.supervision.output,
      onChunk: (stream, chunk) => processSpawnOutput(recipe, stream, chunk)
    }
  })
}

/** Retain the original process spec, native stop hook, output reader and default health policy. */
export function createSpawnProcessBinding<THandle extends IProcessHandle>(
  source: ISpawnProcessPluginDeployment<THandle>,
  context: IRpcTransportSetupContext,
  name: string | undefined,
  features?: readonly IProcessFeature[],
  events?: IRpcNativePoolEvents
): ProcessBinding<THandle, IProcessSpec> {
  validateSpawnProcessPluginDeployment(source)
  /** One original native emitter forwards stderr alongside the caller's output observer. */
  const stderr = new ProcessStderrSource(context.report)
  /** All native deadlines retain this supervisor's selected monotonic clock. */
  const scheduler = source.supervision.scheduler ?? systemScheduler
  /** One explicit native recipe keeps callbacks below the enclosing-context limit. */
  const native = { source, context, stderr, scheduler }
  return new ProcessBinding({
    context,
    name: name ?? PROCESS_NAMESPACE,
    childName: name,
    features,
    events,
    scheduler,
    kind: 'spawn',
    token: source.token,
    terminalReason: (unit) =>
      unit.exited.then((exit) =>
        createProcessError(RpcProcessErrorCode.channelClosed, exit, {
          exitCode: exit.code,
          signal: exit.signal
        })
      ),
    stderr: stderr.subscribe,
    openRaw: async (unit, signal) => {
      /** Full native recipes retain the original physical-kind admission and rollback. */
      const raw = await source.rawChannel(unit, signal)
      if (raw.kind !== source.channelKind) {
        await raw.close()
        invalidOption('deployment.channelKind')
      }
      return raw
    },
    expectedPeerId: source.channelKind === 'byte' ? (unit) => unit.identity.fingerprint : undefined,
    processId: (unit) => String(unit.identity.pid),
    prepareReplacement: (spec) => spec as IProcessSpec,
    create: (ports) => createSpawnProcessSupervisor({ ...native, ports })
  })
}

/** A local socket unit shares the original native close and exit receipt across all borrowers. */
class ProcessConnectionHandle {
  /** One physical socket remains the unique connection resource. */
  readonly #raw: IProcessByteChannel
  /** Native EOF and explicit close settle the same original execution receipt. */
  readonly #exit = deferred<Readonly<{ reason: unknown }>>()
  /** Repeated supervisor termination and Session close share this cleanup Promise. */
  #closing: Promise<void> | undefined
  /** Exact native observer is detached at terminal completion. */
  #remove: (() => void) | undefined
  /** The original native supervisor only receives this raw local execution handle. */
  readonly value: IProcessConnectionHandle
  /** Subscribe before publishing a handle, preserving synchronous already-closed notification. */
  constructor(raw: IProcessByteChannel) {
    this.#raw = raw
    this.#remove = raw.onClose((reason) => {
      this.#remove?.()
      this.#exit.resolve({ reason })
    })
    this.value = {
      identity: { fingerprint: defaultRpcId() },
      exited: this.#exit.promise,
      channel: raw,
      close: this.#close
    }
  }
  /** Closing retains physical close failure and releases its exact EOF observer once. */
  readonly #close = (): Promise<void> =>
    (this.#closing ??= Promise.resolve(this.#raw.close()).then(() => {
      this.#remove?.()
      this.#exit.resolve({ reason: undefined })
    }))
}
/** Borrowed local connection supervision has no authority to kill the remote process. */
export type IProcessConnectionUnit = Pick<IProcessConnectionHandle, 'identity' | 'exited' | 'close'>
/** Preserve synchronous close throws; only the original Promise rejection becomes a diagnostic. */
function terminateProcessConnection(
  handle: IProcessConnectionUnit,
  report: (error: unknown) => void
): void {
  void handle.close().catch((error) => reportSafely(report, error))
}

/** Reuse the original one-unit native socket supervisor and its actual exit classification. */
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
  /** A local connection consumes exactly one native unit lease. */
  const budget = createUnitBudget({ kind: ProcessConnectionProfile.kind, maxUnits: 1, scheduler })
  /** Native socket close and exit classification retain their original policy and error cause. */
  const profile: IUnitProfile<string, THandle, Readonly<{ reason: unknown }>> = {
    kind: ProcessConnectionProfile.kind,
    gracefulTermination: true,
    requirements: () => [],
    validateSpec(value) {
      if (!value) invalidOption('deployment.address')
    },
    terminate(handle) {
      terminateProcessConnection(handle, report)
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
/** One native connect recipe retains the same dialer, clock and borrowed control ports. */
type IProcessConnectRecipe = Readonly<{
  source: IConnectProcessPluginDeployment
  context: IRpcTransportSetupContext
  scheduler: IScheduler
  ports: IProcessSupervisorPorts<IProcessConnectionHandle, string>
}>

/** A cancelled dial closes its original acquired socket before propagating the same reason. */
async function launchProcessConnection(
  recipe: IProcessConnectRecipe,
  address: string,
  launchContext: ILaunchContext
): Promise<IProcessConnectionHandle> {
  /** Acquisition calls the original dialer with its original source receiver and signal. */
  const raw = await recipe.source.dial(address, launchContext.signal)
  if (launchContext.signal.aborted) {
    await raw.close()
    throw resolveAbortReason(launchContext.signal)
  }
  return new ProcessConnectionHandle(raw).value
}

/** Native redial and drain callbacks borrow only their original readonly connection recipe. */
function createConnectProcessSupervisor(
  recipe: IProcessConnectRecipe
): ISupervisor<IProcessConnectionHandle, string> {
  return createProcessConnectionSupervisor(
    recipe.source.address,
    recipe.scheduler,
    recipe.context.report,
    {
      capabilities: {},
      launch: (address, launchContext) => launchProcessConnection(recipe, address, launchContext)
    },
    {
      ...recipe.source.supervision,
      health: recipe.source.supervision?.health ?? {
        check: recipe.ports.health,
        intervalMs: DEFAULT_HEALTH_INTERVAL_MS,
        timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
        failureThreshold: DEFAULT_HEALTH_FAILURE_THRESHOLD
      },
      stop: {
        ...recipe.source.supervision?.stop,
        beforeTerminate: (unit, signal, remainingMs) =>
          beforeProcessTerminate(
            recipe.ports,
            unit,
            signal,
            remainingMs,
            recipe.source.supervision?.stop
          )
      }
    }
  )
}

/** Connect and redial retain the real dialer's address, signal, connection budget and stop grace. */
export function createConnectProcessBinding(
  source: IConnectProcessPluginDeployment,
  context: IRpcTransportSetupContext,
  name: string,
  features?: readonly IProcessFeature[],
  events?: IRpcNativePoolEvents
): ProcessBinding<IProcessConnectionHandle, string> {
  if (!source || source.kind !== 'connect' || !source.address) invalidOption('deployment.address')
  if (!source.token) invalidOption('deployment.token')
  /** Native redial and health share the same original scheduler. */
  const scheduler = source.supervision?.scheduler ?? systemScheduler
  /** One explicit native recipe retains the original dialer receiver and selected clock. */
  const native = { source, context, scheduler }
  return new ProcessBinding({
    context,
    name,
    features,
    events,
    scheduler,
    kind: 'connect',
    token: source.token,
    openRaw: async (unit) => unit.channel,
    create: (ports) => createConnectProcessSupervisor({ ...native, ports })
  })
}
