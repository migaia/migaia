import { createMutationQueue } from '@migaia/lifecycle'
import { ReplaceStrategy } from '@migaia/supervision'
import type { IProcessHandle, IProcessSpec } from '@migaia/supervision/process'
import { systemScheduler } from '@migaia/utils/scheduler'
import { defaultRpcId } from '../../core/internal/id.js'
import { normalizeRemoteHostCatalog } from '../../remote/contract.js'
import { createRemoteRetryPort } from '../../remote/retry.js'
import type { IRemoteRetryPort } from '../../remote/types.js'
import { createRemoteHost, type IRemoteHostHandle } from '../../remote/host.js'
import {
  createConnectProcessBinding,
  createSpawnProcessBinding,
  reportSafely,
  type IProcessPluginBinding
} from '../plugin/binding.js'
import type { IProcessConnectionHandle } from '../plugin/types.js'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import { createProcessResilience } from '../resilience/index.js'
import type { IProcessRegistration } from '../resilience/types.js'
import { hostCleanupFailure, invalidHostOption } from './error.js'
import type { IProcessHost, IProcessHostOptions } from './types.js'

/** A candidate retains only its remote owner and the canonical process binding. */
type IHostCandidate = Readonly<{
  id: string
  binding: IHostBinding
  remote: IRemoteHostHandle
  registration: IProcessRegistration
  ready(): Promise<void>
  markReady(): void
  cancelPreparation(): void
  releaseRemote(): Promise<void>
  close(): Promise<void>
}>

/** Both deployments use the same neutral remote boundary without granting borrowed PID access. */
type IHostBinding = IProcessPluginBinding<
  IProcessHandle | IProcessConnectionHandle,
  IProcessSpec | string
>

/** Replace strategies are checked synchronously before any launch, drain, or pool invalidation. */
function validateStrategy(strategy: ReplaceStrategy, field: string): void {
  if (strategy !== ReplaceStrategy.stopThenStart && strategy !== ReplaceStrategy.startThenSwitch)
    invalidHostOption(field)
}

/** Create a stable process Host facade; only remote owns RPC dispatch and generation rebinds. */
export function createProcessHost<THandle extends IProcessHandle = IProcessHandle>(
  options: IProcessHostOptions<THandle>
): IProcessHost {
  /** Catalog validation precedes all governor and process resource creation. */
  const catalog = normalizeRemoteHostCatalog(options.catalog)
  if (!options.deployment || !['spawn', 'connect'].includes(options.deployment.kind))
    invalidHostOption('deployment.kind')
  if (typeof options.endpointFactory !== 'function') invalidHostOption('endpointFactory')
  if (typeof options.report !== 'function') invalidHostOption('report')
  if (options.shutdownSignal && typeof options.shutdownSignal.subscribe !== 'function')
    invalidHostOption('shutdownSignal')
  if (options.replaceStrategy !== undefined) {
    if (options.deployment.kind !== 'spawn') invalidHostOption('replaceStrategy')
    validateStrategy(options.replaceStrategy, 'replaceStrategy')
  }
  /** Scheduler identity is canonical across binding, mutation admission and default governance. */
  const suppliedScheduler = options.deployment.supervision?.scheduler
  if (options.scheduler && suppliedScheduler && options.scheduler !== suppliedScheduler)
    invalidHostOption('scheduler')
  /** Use the established channel clock for all supervision and drain work. */
  const scheduler = options.scheduler ?? suppliedScheduler ?? systemScheduler
  /** The current deployment retains the exact spec and pool until an explicit replacement. */
  let deployment = {
    ...options.deployment,
    supervision: { ...options.deployment.supervision, scheduler }
  } as IProcessHostOptions<THandle>['deployment']
  /** Binding construction validates spec/bootstrap without launching or acquiring a unit. */
  const bind = (next: typeof deployment): IHostBinding =>
    (next.kind === 'spawn'
      ? createSpawnProcessBinding(next, options.report, true)
      : createConnectProcessBinding(next, options.report)) as IHostBinding
  /** Initial admission must finish before creating the default governor. */
  const initialBinding = bind(deployment)
  /** A supplied governor remains caller owned through every replacement and release. */
  const resilience =
    options.resilience ?? createProcessResilience({ scheduler, report: options.report })
  /** Candidate membership is resource ownership, not a second supervision state machine. */
  const candidates = new Set<IHostCandidate>()
  /** Queued validated bindings have not acquired a handle or published a remote candidate. */
  const prepared = new Set<IHostBinding>()
  /** The existing lifecycle queue executes every replacement and manual restart in call order. */
  const mutations = createMutationQueue({ scheduler })
  /** Gate new calls immediately, before asynchronous draining begins. */
  let closed = false
  /** Explicit release has one stable Promise shared with repeated calls. */
  let releasing: Promise<void> | undefined
  /** Signals stay subscribed until real release completion so a second signal can escalate. */
  let unsubscribeSignal: (() => void) | undefined
  /** Stop-first readiness joins the actual replacement Promise instead of stale initial ready. */
  let inGap = false
  /** Only the active stop-first operation is joined by callers observing its ready gap. */
  let gapReplacement: Promise<IProcessHost> | undefined

  /** Assemble one remote owner and attach its unique governance identity before first launch. */
  const candidate = (binding: IHostBinding, next: typeof deployment): IHostCandidate => {
    /** A fresh ID prevents old terminal diagnostics from contaminating the next guard. */
    const id = defaultRpcId()
    /** Cleanup preserves both drain and remote failures while remote retains endpoint ownership. */
    let remoteRelease: Promise<void> | undefined
    /** Registration and remote cleanup share one completion even when release races replacement. */
    let candidateClose: Promise<void> | undefined
    /** Publication distinguishes a live draining endpoint from a cancellable preparation. */
    let published = false
    /** One canonical retry port settles logical requests before this candidate's drain completes. */
    let retry = options.retryPort
    /** Join logical settlement through the same canonical retry owner without changing its Promise. */
    const retryPort: IRemoteRetryPort = {
      dispatch(input) {
        retry ??= createRemoteRetryPort({
          events: input.events,
          scheduler: binding.scheduler,
          report: options.report
        })
        return binding.trackRequest(() => retry!.dispatch(input))
      }
    }
    /** RPC description, generation cancellation and transport ownership remain with remote. */
    const remote = createRemoteHost({
      catalog,
      binding,
      endpointFactory: async (channel, signal) => {
        /** Factory ownership transfers only after binding health and drain admission succeed. */
        const endpoint = await options.endpointFactory(channel, signal)
        try {
          return binding.bindEndpoint(channel, endpoint)
        } catch (error) {
          try {
            await endpoint.endpoint.dispose()
          } catch (cleanupError) {
            reportSafely(options.report, cleanupError)
          }
          throw error
        }
      },
      report: options.report,
      keyFactory: options.keyFactory,
      retryPort,
      callGuard: resilience.callGuard(id),
      ...(next.kind === 'spawn'
        ? { callDeadlineCapMs: next.supervision.spec.limits?.callWallTimeMs }
        : {})
    })
    /** Liquidation releases only this remote owner; it must not recursively close the governor. */
    const releaseRemote = (): Promise<void> =>
      (remoteRelease ??= (async () => {
        /** Cleanup failures are independent and must all remain reachable. */
        const errors: unknown[] = []
        try {
          await binding.drainCurrent()
        } catch (error) {
          errors.push(error)
        }
        try {
          await remote.release()
        } catch (error) {
          errors.push(error)
        }
        if (errors.length) throw hostCleanupFailure(errors)
      })())
    /** Terminal policy follows this candidate's unique identity and canonical supervisor port. */
    const registration = resilience.attachRegistration(
      id,
      {
        ownership: next.kind === 'spawn' ? 'spawn-owned' : 'connection-borrowed',
        health: binding.health,
        supervisor: binding.registrationSupervisor
      },
      { kind: 'standalone-host', release: releaseRemote }
    )
    /** This resource record is removed only after registration cleanup settles. */
    const owned: IHostCandidate = {
      id,
      binding,
      remote,
      registration,
      releaseRemote,
      ready: () =>
        remote.ready().then(() => {
          published = true
        }),
      markReady: () => {
        published = true
      },
      cancelPreparation: () => {
        if (!published) void remote.release().catch((error) => reportSafely(options.report, error))
      },
      close: () =>
        (candidateClose ??= (async () => {
          /** Both phases must run even when the first fails. */
          const errors: unknown[] = []
          try {
            await releaseRemote()
          } catch (error) {
            errors.push(error)
          }
          try {
            await registration.close()
          } catch (error) {
            errors.push(error)
          } finally {
            candidates.delete(owned)
          }
          if (errors.length) throw hostCleanupFailure(errors)
        })())
    }
    candidates.add(owned)
    return owned
  }
  /** Publishing current is the only facade switch and happens after remote description succeeds. */
  let current = candidate(initialBinding, deployment)

  /** Closed and liquidated facades cannot create candidates or invalidate prewarm pools. */
  const requireOpen = (): void => {
    if (closed) throw createProcessError(RpcProcessErrorCode.hostClosed)
    /** Tombstones are read from their existing owner instead of cached by the facade. */
    const snapshot = resilience.inspect(current.id)
    if (snapshot?.liquidated)
      throw createProcessError(RpcProcessErrorCode.liquidated, snapshot.reason)
  }

  /** Every method sees the same current pointer and the same immediate release gate. */
  const facade: IProcessHost = Object.freeze({
    /** Join remote description, including the current stop-first gap when present. */
    ready() {
      requireOpen()
      return inGap && gapReplacement ? gapReplacement.then(() => undefined) : current.ready()
    },
    /** Delegate catalog installation to the selected remote Host without replaying prior use. */
    use(name, config) {
      requireOpen()
      /** Capture this operation's owner so late results cannot mark a newer candidate ready. */
      const selected = current
      return selected.remote.use(name, config).then((features) => {
        selected.markReady()
        return features
      })
    },
    /** Removal and dependency policy are owned by the remote target Host. */
    unUse(name, removal) {
      requireOpen()
      const selected = current
      return selected.remote.unUse(name, removal).then((result) => {
        selected.markReady()
        return result
      })
    },
    /** Return the actual target's inspection instead of maintaining local plugin state. */
    inspect() {
      requireOpen()
      const selected = current
      return selected.remote.inspect().then((result) => {
        selected.markReady()
        return result
      })
    },
    inspectRegistration: () => resilience.inspect(current.id),
    /** Manual restart preserves the registration and joins the replacement queue. */
    restart() {
      requireOpen()
      return mutations.enqueue(() => {
        requireOpen()
        return current.registration.restart()
      })
    },
    /** Validate synchronously, then start one fully described replacement in FIFO order. */
    replace(replacement = {}) {
      requireOpen()
      if (deployment.kind !== 'spawn') invalidHostOption('deployment.kind')
      /** Caller strategy overrides the descriptor/default strategy for this operation only. */
      const strategy =
        replacement.strategy ?? options.replaceStrategy ?? ReplaceStrategy.stopThenStart
      validateStrategy(strategy, 'strategy')
      /**
       * Build an idle binding for synchronous upstream spec/token validation; launch remains
       * queued.
       */
      const next = {
        ...deployment,
        supervision: {
          ...deployment.supervision,
          spec: replacement.spec ?? deployment.supervision.spec,
          prewarm: undefined
        }
      }
      /** No lease or process action occurs while this validated binding is waiting in the queue. */
      const binding = bind(next)
      prepared.add(binding)
      /** Each call gets its own queued result rather than merging later specs into an earlier task. */
      const task = mutations.enqueue(async () => {
        /** Failed preparation owns only its own candidate, never the serving old Host. */
        let fresh: IHostCandidate | undefined
        try {
          // Allow enqueue to return its Promise before installing that same active readiness join.
          await Promise.resolve()
          requireOpen()
          gapReplacement = task
          /** Old ownership is retained until the selected strategy permits retirement. */
          const old = current
          /** The old pool must be invalidated according to the actual current deployment. */
          const oldDeployment = deployment
          if (strategy === ReplaceStrategy.stopThenStart) {
            inGap = true
            await old.close()
            requireOpen()
          }
          if (oldDeployment.kind === 'spawn') oldDeployment.supervision.prewarm?.invalidate()
          prepared.delete(binding)
          fresh = candidate(binding, next)
          await fresh.ready()
          requireOpen()
          current = fresh
          deployment = next
          if (strategy === ReplaceStrategy.startThenSwitch) {
            try {
              await old.close()
            } catch (error) {
              reportSafely(options.report, error)
            }
          }
          return facade
        } catch (error) {
          try {
            if (fresh) await fresh.close()
            else await binding.supervisor.dispose()
          } catch (cleanupError) {
            reportSafely(options.report, cleanupError)
          }
          throw error
        } finally {
          prepared.delete(binding)
          inGap = false
        }
      })
      return task
    },
    /** Gate immediately, cancel preparation, join queued work, then release only owned governance. */
    release() {
      if (releasing) return releasing
      closed = true
      /** Candidate cancellation cannot wait for an unresponsive describe before release can join. */
      const closing = [...candidates].map((entry) => {
        entry.cancelPreparation()
        return entry.close()
      })
      /** Queued idle bindings own no remote session but still need their supervisor scopes closed. */
      const idle = [...prepared].map((binding) => binding.supervisor.dispose())
      releasing = (async () => {
        /** The final queue record joins every earlier mutation without running another command. */
        const outcomes = await Promise.allSettled([
          ...closing,
          ...idle,
          mutations.enqueue(() => undefined)
        ])
        /** Preserve independent cleanup failures rather than replacing the first. */
        const errors = outcomes.flatMap((outcome) =>
          outcome.status === 'rejected' ? [outcome.reason] : []
        )
        if (!options.resilience) {
          try {
            await resilience.close()
          } catch (error) {
            errors.push(error)
          }
        }
        unsubscribeSignal?.()
        if (errors.length) throw hostCleanupFailure(errors)
      })()
      return releasing
    }
  })
  unsubscribeSignal = options.shutdownSignal?.subscribe(() => {
    if (releasing) {
      try {
        current.binding.forceCurrent?.()
      } catch (error) {
        reportSafely(options.report, error)
      }
    } else void facade.release().catch((error) => reportSafely(options.report, error))
  })
  return facade
}
