import type { IAbortSignal } from '@migaia/lifecycle'
import type { IRemoteBinding } from '../types.js'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import type { IFeature } from '@migaia/plugin-host'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import { normalizeRemoteContract } from '../contract.js'
import { RpcRemoteLayerErrorCode } from '../error-code.js'
import { createRemoteLayerError } from '../error.js'
import type { IRemotePluginDefinition, IRemotePluginOptions } from '../plugin.js'
import {
  createRemoteGenerationHolder,
  createRemoteRegistration,
  type IRemoteGenerationHolder,
  type IRemoteRegistration,
  type IRemoteRuntimeRegistration
} from '../proxy.js'

/** A healthy replacement gets three bounded enable attempts before reporting. */
const MAX_ENABLE_ATTEMPTS = 3
/** Each failed enable doubles this initial scheduler delay. */
const ENABLE_RETRY_BASE_MS = 10

/** Package-internal lifecycle observations let a facade reject stale definition commands. */
type IRemoteAssemblyLifecycle = Readonly<{
  /** Process reverse registration transfers one prevalidated holder instead of describing twice. */
  preparedHolder?: IRemoteGenerationHolder
  onInstalled?(): void | Promise<void>
  onReleased?(): void | Promise<void>
}>

/** Reuse the original coalesced supervisor observer for legacy and runtime generations. */
export function observeRemoteGenerations<TUnit, TSpec>(
  holder: IRemoteGenerationHolder<IRemoteRegistration | IRemoteRuntimeRegistration>,
  binding: IRemoteBinding<TUnit, TSpec>,
  signal: IAbortSignal,
  report: (error: unknown) => void,
  visibility?: Readonly<{ disable(): Promise<unknown>; enable(): Promise<unknown> }>
): () => void {
  /** Only the canonical registration owns current, departure and readiness. */
  const registration = holder.registration
  /** Disposal ends this original subscription before any in-progress reconcile can publish. */
  let subscribed = true
  /** Legacy Host visibility follows the original enable/disable owner, without runtime state copies. */
  let suspended = false
  /** One coalesced task drains all observations through the same original holder. */
  let running = false
  /** A new supervisor observation requests another pass while preparation is already running. */
  let pending = false
  /** Failed enable attempts belong to the currently prepared generation. */
  let enableAttempts = 0
  /** A scheduled retry is cancelled on success or registration disposal. */
  let retryTask: { cancel(): void } | undefined
  /** Prepare only a genuinely ready supervisor generation and recover legacy Host visibility. */
  const reconcile = async (): Promise<void> => {
    if (!subscribed || signal.aborted) return
    if (registration.events.current().active && retryTask) return
    if (!registration.events.current().active) {
      retryTask?.cancel()
      retryTask = undefined
      if (!suspended && visibility) {
        try {
          await visibility.disable()
          if (!subscribed || signal.aborted) return
          suspended = true
        } catch (error) {
          report(error)
          return
        }
      }
      if (binding.supervisor.state !== 'ready') return
      try {
        await holder.prepareRebind(signal)
        if (!subscribed || signal.aborted) return
        enableAttempts = 0
      } catch {
        return // The holder reports a failed replacement and keeps the proxy revoked.
      }
    }
    if (!visibility || !suspended || enableAttempts >= MAX_ENABLE_ATTEMPTS) return
    try {
      await visibility.enable()
      suspended = false
      enableAttempts = 0
      retryTask?.cancel()
      retryTask = undefined
    } catch (error) {
      enableAttempts += 1
      if (enableAttempts >= MAX_ENABLE_ATTEMPTS) {
        report(error)
        return
      }
      retryTask?.cancel()
      retryTask = binding.scheduler.schedule(
        () => {
          retryTask = undefined
          schedule()
        },
        ENABLE_RETRY_BASE_MS * 2 ** (enableAttempts - 1)
      )
    }
  }
  /** Coalesces concurrent supervisor observations without a second lifecycle queue. */
  const schedule = (): void => {
    pending = true
    if (running) return
    running = true
    queueMicrotask(() => {
      void (async () => {
        try {
          while (pending && subscribed) {
            pending = false
            await reconcile()
          }
        } finally {
          running = false
        }
      })().catch(report)
    })
  }
  /** Canonical lifecycle transitions are the sole trigger for cold generation preparation. */
  const unsubscribe = binding.supervisor.subscribe((event) => {
    if (event.type === 'exit' || event.type === 'switched') schedule()
    if (event.type === 'state' && event.to === 'ready') schedule()
  })
  return () => {
    subscribed = false
    retryTask?.cancel()
    unsubscribe()
  }
}

/** Builds one trusted definition before PluginHost freezes its package-owned metadata. */
export function assembleRemotePluginDefinition<TUnit, TSpec, TMetadata extends object = object>(
  options: IRemotePluginOptions<TUnit, TSpec>,
  metadata?: TMetadata,
  lifecycle?: IRemoteAssemblyLifecycle
): IRemotePluginDefinition & TMetadata {
  const contract = normalizeRemoteContract(options.contract)
  if (options.name !== contract.plugin)
    throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid, undefined, {
      path: '$.name'
    })
  /** Each Feature reads the setup-aware exposure, never an unprepared binding. */
  const features: Record<string, IFeature<object, object, Record<never, never>>> = Object.create(
    null
  ) as Record<string, IFeature<object, object, Record<never, never>>>
  for (const featureName of Object.keys(contract.features))
    features[featureName] = defineFeature(
      (core: {
        featureExpose: {
          getProxy(name: string): Readonly<Record<string, (...args: unknown[]) => unknown>>
        }
      }) => core.featureExpose.getProxy(featureName)
    )
  const definition = definePlugin({
    ...metadata,
    name: options.name,
    features,
    setup: async (context) => {
      const registration =
        lifecycle?.preparedHolder?.registration ?? createRemoteRegistration(options)
      const holder =
        lifecycle?.preparedHolder ?? createRemoteGenerationHolder(registration, options.report)
      context.onDispose(() => holder.release())
      if (lifecycle?.preparedHolder) {
        if (context.operation.signal.aborted) throw resolveAbortReason(context.operation.signal)
      } else await holder.prepareInitial(context.operation.signal)
      /** Registered after first preparation so observation cleanup runs before holder release. */
      context.onDispose(
        observeRemoteGenerations(
          holder,
          options.binding,
          context.lifecycle.signal,
          options.report,
          {
            disable: () => options.host.disable(options.name, { policy: 'suspend' }),
            enable: () => options.host.enable(options.name)
          }
        )
      )
      context.onDispose(() => lifecycle?.onReleased?.())
      return holder
    },
    featureExpose: (_core, holder) => {
      const proxies = holder.registration.featureProxies()
      return Object.freeze({ getProxy: (name: string) => proxies[name]! })
    },
    install: () => {
      /** Borrowed process governance may transfer after preparation, before publishing features. */
      const installed = lifecycle?.onInstalled?.()
      return installed === undefined ? {} : installed.then(() => ({}))
    }
  })
  return definition as unknown as IRemotePluginDefinition & TMetadata
}
