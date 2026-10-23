import {
  createCoroutineSupervisor,
  type ICoroutineHandle,
  type ICoroutineSpec,
  type ICoroutineSupervisorOptions
} from '@migaia/supervision/coroutine'
import { BudgetOverflow, createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { hostRethrowReporter } from '@migaia/utils/promise'
import {
  IpcReporterContext,
  createAdapterBindingDrain,
  defineMessageAdapter,
  createEventTargetMessageResource,
  createAdapterMessageHandshakeBudget,
  createAdapterId,
  MessageResourceEvent,
  type IAdapterDefinition,
  type IMessageAdapterPort,
  type IRemoteBinding,
  type IRuntimePeerSourceContext,
  type IRuntimePeerSourceResult
} from '@migaia/rpc-host/plugin'
import type { IAbortSignal } from '@migaia/utils/promise'
import {
  portOf,
  registerCoroutineReporter,
  wrapCoroutineTask,
  type ICoroutineConnect,
  type ICoroutineMessagePort,
  type ICoroutineUserTask
} from './coroutine-task.js'

/**
 * Only the EventTarget branch is exposed to the canonical resource; native Emitter APIs stay
 * hidden.
 */
type ICoroutineEventTargetPort = Extract<IMessageAdapterPort, { addEventListener: unknown }>

/** Preparation borrows local identity and one handshake budget without a complete Peer factory. */
export type ICoroutineBindingPreparation = Readonly<{
  context: IRuntimePeerSourceContext
  connectTimeoutMs?: number
}>

/** The actual binding retains its original native supervisor and per-generation drain methods. */
export type ICoroutineBinding = IRemoteBinding<
  ICoroutineHandle<ICoroutineMessagePort>,
  ICoroutineSpec<ICoroutineMessagePort>
> &
  Readonly<{
    bindEndpoint: ReturnType<typeof createAdapterBindingDrain>['wrap']
    trackRequest: ReturnType<typeof createAdapterBindingDrain>['trackCurrent']
    drainCurrent: ReturnType<typeof createAdapterBindingDrain>['drainCurrent']
  }>

/** Coroutine policy borrows the existing profile's admission and cooperative teardown options. */
export type ICoroutineSupervisorPolicy = Readonly<
  Partial<
    Pick<
      ICoroutineSupervisorOptions<ICoroutineMessagePort>,
      'restart' | 'terminalPolicy' | 'startupTimeoutMs' | 'stop' | 'budget' | 'heartbeat'
    >
  >
>

/**
 * Hide EventEmitter methods so the canonical recipe selects EventTarget. Native delivery starts
 * once, immediately after the first capture/message listener exists.
 */
export function startOnListen(port: ICoroutineMessagePort): ICoroutineEventTargetPort {
  /** Optional physical observers retain their original port receiver through arrow operations. */
  const observed = port as ICoroutineMessagePort &
    Pick<ICoroutineEventTargetPort, 'observe' | 'onError'>
  /** Only native port activation belongs here; capture and replay remain resource-owned. */
  let started = false
  return Object.freeze({
    observe: observed.observe
      ? (options: Parameters<NonNullable<ICoroutineEventTargetPort['observe']>>[0]) =>
          observed.observe!(options)
      : undefined,
    onError: observed.onError
      ? (listener: (error: unknown) => void) => observed.onError!(listener)
      : undefined,
    postMessage: (message: unknown, transfer?: readonly unknown[]) =>
      port.postMessage(message, transfer),
    addEventListener: (type: string, listener: (event: any) => void) => {
      port.addEventListener(type, listener)
      if (type === MessageResourceEvent.message && !started) {
        started = true
        port.start()
      }
    },
    removeEventListener: (type: string, listener: (event: any) => void) =>
      port.removeEventListener(type, listener)
  })
}

/** One message recipe reuses Core's automatic identity, capture, ACK and Peer assembly. */
const coroutineMessageAdapter = defineMessageAdapter<ICoroutineConnect>({
  open: (connect) => startOnListen(portOf(connect))
})

/** Both plugin modes use the same canonical recipe, without an alternate child constructor. */
export function getCoroutineMessageAdapter(): IAdapterDefinition<ICoroutineConnect, 'thread'> {
  return coroutineMessageAdapter
}

/** Build only the coroutine profile and its original binding/drain operations. */
export function createCoroutineBinding(
  preparation: ICoroutineBindingPreparation,
  task: ICoroutineUserTask,
  report: (error: unknown) => void,
  policy?: ICoroutineSupervisorPolicy
): ICoroutineBinding {
  /** The original profile and message resources share one supported scheduler. */
  const scheduler = systemScheduler
  /** Requests and provider teardown retain the canonical remote binding drain. */
  const drain = createAdapterBindingDrain(scheduler, report)
  /** Each parent plugin defaults to one lease; explicit shared budgets keep caller ownership. */
  const budget =
    policy?.budget ??
    createUnitBudget({ kind: 'coroutine', maxUnits: 1, overflow: BudgetOverflow.reject })
  /** The existing supervisor owns generation, startup, restart, termination and late reap. */
  const supervisor = createCoroutineSupervisor<ICoroutineMessagePort>({
    ...policy,
    id: createAdapterId(),
    spec: { task: wrapCoroutineTask(task, report) },
    scheduler,
    budget,
    report,
    stop: {
      ...policy?.stop,
      beforeTerminate: async (unit, signal, remainingMs) => {
        await drain.drainCurrent({ drainMs: remainingMs() })
        if (!signal.aborted) await policy?.stop?.beforeTerminate?.(unit, signal, remainingMs)
      }
    }
  })
  registerCoroutineReporter(supervisor, report)
  return {
    ownership: 'owned',
    supervisor,
    scheduler,
    bindEndpoint: drain.wrap,
    trackRequest: drain.trackCurrent,
    drainCurrent: drain.drainCurrent,
    openChannel: async (unit, signal) => {
      /** The task exposes its native parent port before opening its child-mode plugin. */
      const port = await unit.exposed
      return openCoroutineConnection(port, preparation, signal, report)
    }
  }
}

/**
 * Reuse the original symmetric identity/ACK exchange without adopting a parent announcement as
 * self.
 */
export async function openCoroutineConnection(
  port: ICoroutineMessagePort,
  preparation: ICoroutineBindingPreparation,
  signal: IAbortSignal | undefined,
  report: (error: unknown) => void
): Promise<IRuntimePeerSourceResult> {
  /** Every physical generation uses the original supported monotonic scheduler. */
  const scheduler = systemScheduler
  /** Parent startup selects the same EventTarget resource as the child message recipe. */
  const resource = createEventTargetMessageResource(startOnListen(port))
  try {
    /** Canonical identity comes from the exact preparation also used by managed describe. */
    /** A restarted task receives a fresh budget shared by its own initial and ACK waits. */
    const handshakeBudget = createAdapterMessageHandshakeBudget(
      scheduler,
      preparation.connectTimeoutMs
    )
    const peerId = await resource.exchangeIdentity(preparation.context, signal, handshakeBudget)
    return await resource.open({
      peerId,
      scheduler,
      offer: preparation.context.capabilities,
      control: rpcMessageCapabilityControl,
      signal,
      handshakeBudget
    })
  } catch (primary) {
    try {
      await resource.close()
    } catch (cleanup) {
      try {
        report(cleanup)
      } catch (failure) {
        hostRethrowReporter(failure, IpcReporterContext)
      }
    }
    throw primary
  }
}
