import { defineFeature, definePlugin, type IDefinedPluginConstraint } from '@migaia/plugin-host'
import type { IFeature } from '@migaia/plugin-host'
import { normalizeRemoteContract, type IRemoteContract } from './contract.js'
import { RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'
import { createRemoteGenerationHolder, createRemoteRegistration } from './proxy.js'
import type { IRemotePluginHostPort, IRemoteProxyOptions } from './types.js'

/** A healthy replacement gets three bounded enable attempts before reporting. */
const MAX_ENABLE_ATTEMPTS = 3
/** Each failed enable doubles this initial scheduler delay. */
const ENABLE_RETRY_BASE_MS = 10

/** Plugin mode binds one declared contract to one PluginHost registration. */
export type IRemotePluginOptions<TUnit, TSpec> = IRemoteProxyOptions<TUnit, TSpec> &
  Readonly<{ name: string; contract: IRemoteContract; host: IRemotePluginHostPort }>

/** Runtime Feature names come from a validated description, so their type remains dynamic. */
export type IRemotePluginDefinition = IDefinedPluginConstraint<
  object,
  never,
  Record<string, never>,
  Record<string, unknown>,
  Record<string, never>,
  string,
  Record<string, IFeature<object, object, Record<never, never>>>
>

/** Creates a PluginHost definition whose setup owns one neutral remote generation holder. */
export function createRemotePlugin<TUnit, TSpec>(
  options: IRemotePluginOptions<TUnit, TSpec>
): IRemotePluginDefinition {
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
    name: options.name,
    features,
    setup: async (context) => {
      const registration = createRemoteRegistration(options)
      const holder = createRemoteGenerationHolder(registration, options.report)
      context.onDispose(() => holder.release())
      await holder.prepareInitial(context.operation.signal)
      /** Registered after the first description so disposal runs subscription cleanup first. */
      let subscribed = true
      let suspended = false
      let running = false
      let pending = false
      /** Failed enable attempts belong to the currently prepared generation. */
      let enableAttempts = 0
      /** A scheduled retry is cancelled on success or registration disposal. */
      let retryTask: { cancel(): void } | undefined
      const reconcile = async (): Promise<void> => {
        if (!subscribed || context.lifecycle.signal.aborted) return
        if (registration.events.current().active && retryTask) return
        if (!registration.events.current().active) {
          retryTask?.cancel()
          retryTask = undefined
          if (!suspended) {
            try {
              await options.host.disable(options.name, { policy: 'suspend' })
              if (!subscribed || context.lifecycle.signal.aborted) return
              suspended = true
            } catch (error) {
              options.report(error)
              return
            }
          }
          if (options.binding.supervisor.state !== 'ready') return
          try {
            await holder.prepareRebind(context.lifecycle.signal)
            if (!subscribed || context.lifecycle.signal.aborted) return
            enableAttempts = 0
          } catch {
            return // The holder reports a failed replacement and keeps the proxy revoked.
          }
        }
        if (!suspended || enableAttempts >= MAX_ENABLE_ATTEMPTS) return
        try {
          await options.host.enable(options.name)
          suspended = false
          enableAttempts = 0
          retryTask?.cancel()
          retryTask = undefined
        } catch (error) {
          enableAttempts += 1
          if (enableAttempts >= MAX_ENABLE_ATTEMPTS) {
            options.report(error)
            return
          }
          retryTask?.cancel()
          retryTask = options.binding.scheduler.schedule(
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
          })().catch(options.report)
        })
      }
      const unsubscribe = options.binding.supervisor.subscribe((event) => {
        if (event.type === 'exit' || event.type === 'switched') schedule()
        if (event.type === 'state' && event.to === 'ready') schedule()
      })
      context.onDispose(() => {
        subscribed = false
        retryTask?.cancel()
        unsubscribe()
      })
      return holder
    },
    featureExpose: (_core, holder) => {
      const proxies = holder.registration.featureProxies()
      return Object.freeze({ getProxy: (name: string) => proxies[name]! })
    },
    install: () => ({})
  })
  return definition as unknown as IRemotePluginDefinition
}
