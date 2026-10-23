import {
  defineFeature,
  definePlugin,
  type IPluginHandle,
  type IPluginConstraint
} from '@migaia/plugin-host'
import type { IRpcContext } from '@migaia/rpc-host'
import { DependencyAction, DependencyPolicy } from '@migaia/capability/graph/dependency'
import { withTimeout } from '@migaia/utils/promise'
import { createTrayError } from '../../errors.js'
import { TrayErrorCode } from '../../error-code.js'
import { TrayInternal } from '../constants.js'
import { createTrayPlugin } from './client.js'
import { createChildTopics } from './topics.js'
import type { ITrayRuntimeHost, ITrayRuntimeOutlet } from '../runtime.js'
import type { IAnyTrayHost, ITrayInstanceInfo } from '../typing.js'
import type { ITrayInvocation } from '../remote.js'
/** One child generation initializes once; PluginHost's dependency plan owns business cleanup order. */
export function createChildDispatcher(
  definition: IAnyTrayHost,
  host: ITrayRuntimeHost,
  outlet: () => ITrayRuntimeOutlet,
  exit: (error?: unknown) => void,
  report: (error: unknown) => void
): IPluginConstraint<any, any, any> {
  /** Handles are name-addressed PluginHost views, never another connection registry. */
  const handles = new Map<string, IPluginHandle<IPluginConstraint<any, any>>>()
  /**
   * The admitted name inventory identifies business plugins; it does not duplicate install
   * ordering.
   */
  const installed: string[] = []
  /** One local business topic hub belongs to this dispatcher generation. */
  const topics = createChildTopics(outlet, report)
  /** Init admission stays closed after failure or shutdown; a new native generation gets a new Host. */
  let initialized = false
  /** Repeated cleanup callers share the same PluginHost removal sequence. */
  let shutdown: Promise<void> | undefined
  /** Resolve only declared Feature paths and preserve the Feature receiver on invocation. */
  const invoke = (input: ITrayInvocation, context?: IRpcContext): unknown => {
    /** Path components are the DSL's plugin, Feature and method namespaces. */
    const [plugin, feature, method, extra] = input.path.split('.')
    if (
      extra ||
      !plugin ||
      !feature ||
      !method ||
      !definition.exposes.includes(`${plugin}.${feature}`)
    )
      throw createTrayError(TrayErrorCode.pathNotExposed)
    /** PluginHost owns live Feature availability and registration identity. */
    const target = handles.get(plugin)?.getFeature(feature) as Record<string, unknown> | undefined
    if (!target || typeof target[method] !== 'function')
      throw createTrayError(TrayErrorCode.pathNotExposed)
    return (target as Record<string, (payload: unknown, context?: IRpcContext) => unknown>)[
      method
    ]!(input.payload, context)
  }
  return definePlugin({
    name: TrayInternal.childPlugin,
    features: {
      control: defineFeature(() => ({
        /** Validate before user plugins are created; one dispatcher belongs to one generation. */
        init: async (input: ITrayInstanceInfo<string, unknown>) => {
          if (initialized || input.host !== definition.name)
            throw createTrayError(TrayErrorCode.childStateInvalid)
          initialized = true
          /** Validator output is local application data, not another wire transfer. */
          const info = Object.freeze({
            ...input,
            config: definition.config ? definition.config(input.config) : input.config
          })
          /** Feature dependencies refer to this exact per-init plugin definition. */
          const client = createTrayPlugin(outlet, info, exit, topics, definition)
          /** Parent never invokes this DSL factory; execution belongs entirely to the child. */
          const plugins = definition.plugins(info, client)
          /** Internal plugin names cannot be shadowed by business plugins. */
          if (
            plugins.some((plugin: IPluginConstraint<any>) =>
              [TrayInternal.childPlugin, TrayInternal.clientPlugin, TrayInternal.relayPlugin].some(
                (name) => name === plugin.name
              )
            )
          )
            throw createTrayError(TrayErrorCode.reservedName)
          /** PluginHost performs one transaction and owns rollback of a failed batch. */
          const batch = [client, ...plugins]
          const views = await host.use(...batch)
          batch.forEach((plugin, index) => {
            handles.set(plugin.name, views[index] as IPluginHandle<IPluginConstraint<any, any>>)
            installed.push(plugin.name)
          })
          return undefined
        },
        invoke,
        stream: (input: ITrayInvocation, context?: IRpcContext) => invoke(input, context),
        /** Business events stay separate from the parent's read-only lifecycle channel. */
        deliver: topics.deliver,
        /** Bounded logical wait lets the caller terminate a hung realm; cleanup keeps its owner. */
        shutdown: async ({ graceMs }: { graceMs: number }) => {
          shutdown ??= (async () => {
            topics.close()
            for (const name of [...installed].reverse()) {
              if (!handles.has(name)) continue
              const result = await host.unUse(name, { policy: DependencyPolicy.cascade })
              for (const step of result.affected.steps) {
                if (step.action !== DependencyAction.release) continue
                handles.delete(step.name)
                const index = installed.indexOf(step.name)
                if (index >= 0) installed.splice(index, 1)
              }
              if (!result.ok) for (const error of result.errors) report(error)
            }
            installed.length = 0
          })()
          try {
            await withTimeout(() => shutdown!, { timeoutMs: graceMs, report })
          } catch (error) {
            report(error)
            throw error
          }
        }
      }))
    },
    install: () => ({})
  })
}
