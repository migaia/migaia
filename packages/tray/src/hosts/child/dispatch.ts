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
): ChildDispatcher {
  return new ChildDispatcher(definition, host, outlet, exit, report)
}
/** Owns one accepted child generation while PluginHost retains business installation and cleanup. */
class ChildDispatcher {
  /** Original branded DSL definition owns exposed business paths. */
  readonly #definition: IAnyTrayHost
  /** Plain native Host remains the canonical plugin transaction owner. */
  readonly #host: ITrayRuntimeHost
  /** Current accepted outlet is borrowed for child-to-parent operations. */
  readonly #outlet: () => ITrayRuntimeOutlet
  /** Original task exit port is passed to the child client unchanged. */
  readonly #exit: (error?: unknown) => void
  /** Cleanup failures remain contained by the original reporter. */
  readonly #report: (error: unknown) => void
  /** Handles retain exact PluginHost registration identity. */
  readonly #handles = new Map<string, IPluginHandle<IPluginConstraint<any, any>>>()
  /** Membership deletion is O(1); iteration keeps original admission order. */
  readonly #installed = new Set<string>()
  /** Local topic fan-out belongs only to this child generation. */
  readonly #topics: ReturnType<typeof createChildTopics>
  /** Failed init never reopens admission within the same generation. */
  #initialized = false
  /** Repeated shutdown callers share the original removal promise. */
  #shutdown: Promise<void> | undefined
  /** Genuine plugin definition installs the same control Feature on the plain child Host. */
  readonly plugin: IPluginConstraint<any, any, any>
  /** Capture native ownership and construct the original generation control definition. */
  constructor(
    definition: IAnyTrayHost,
    host: ITrayRuntimeHost,
    outlet: () => ITrayRuntimeOutlet,
    exit: (error?: unknown) => void,
    report: (error: unknown) => void
  ) {
    this.#definition = definition
    this.#host = host
    this.#outlet = outlet
    this.#exit = exit
    this.#report = report
    this.#topics = createChildTopics(outlet, report)
    this.plugin = definePlugin({
      name: TrayInternal.childPlugin,
      features: {
        control: defineFeature(() => ({
          init: this.#init,
          invoke: this.#invoke,
          stream: this.#stream,
          /** Business events stay separate from the parent's read-only lifecycle channel. */
          deliver: this.#topics.deliver,
          shutdown: this.#shutdownControl
        }))
      },
      install: () => ({})
    })
  }
  /** Validate before user plugins are created; one dispatcher belongs to one generation. */
  readonly #init = async (input: ITrayInstanceInfo<string, unknown>): Promise<void> => {
    if (this.#initialized || input.host !== this.#definition.name)
      throw createTrayError(TrayErrorCode.childStateInvalid)
    this.#initialized = true
    /** Validator output is local application data, not another wire transfer. */
    const info = Object.freeze({
      ...input,
      config: this.#definition.config ? this.#definition.config(input.config) : input.config
    })
    /** Feature dependencies refer to this exact per-init plugin definition. */
    const client = createTrayPlugin(this.#outlet, info, this.#exit, this.#topics, this.#definition)
    /** Parent never invokes this DSL factory; execution belongs entirely to the child. */
    const plugins = this.#definition.plugins(info, client)
    if (plugins.some(this.#hasReservedName)) throw createTrayError(TrayErrorCode.reservedName)
    /** PluginHost performs one transaction and owns rollback of a failed batch. */
    const batch = [client, ...plugins]
    const views = await this.#host.use(...batch)
    batch.forEach((plugin, index) => {
      this.#handles.set(plugin.name, views[index] as IPluginHandle<IPluginConstraint<any, any>>)
      this.#installed.add(plugin.name)
    })
    return undefined
  }
  /** Preserve short-circuit name getter reads against the same fixed three internal names. */
  #hasReservedName(plugin: IPluginConstraint<any>): boolean {
    /** This compile-time three-name list retains its original order before any name getter read. */
    const reserved = [
      TrayInternal.childPlugin,
      TrayInternal.clientPlugin,
      TrayInternal.relayPlugin
    ] as const
    return reserved.some((name) => name === plugin.name)
  }
  /** Streaming keeps its separate bound callable while borrowing the original invocation job. */
  readonly #stream = (input: ITrayInvocation, context?: IRpcContext): unknown =>
    this.#invoke(input, context)
  /** Bounded logical wait lets the caller terminate a hung realm; cleanup keeps its owner. */
  readonly #shutdownControl = async ({ graceMs }: { graceMs: number }): Promise<void> => {
    /** Cleanup starts before the caller's logical deadline is validated or awaited. */
    const shutdown = this.shutdown()
    try {
      await withTimeout(() => shutdown, { timeoutMs: graceMs, report: this.#report })
    } catch (error) {
      this.#report(error)
      throw error
    }
  }
  /** Share the original business cleanup, including rejection, without adding a realm deadline. */
  readonly shutdown = (): Promise<void> => {
    this.#shutdown ??= this.#removeInstalled()
    return this.#shutdown
  }
  /** Remove business plugins and their client in the original reverse dependency order. */
  #removeInstalled = async (): Promise<void> => {
    this.#topics.close()
    for (const name of [...this.#installed].reverse()) {
      if (!this.#handles.has(name)) continue
      const result = await this.#host.unUse(name, { policy: DependencyPolicy.cascade })
      for (const step of result.affected.steps) {
        if (step.action !== DependencyAction.release) continue
        this.#handles.delete(step.name)
        this.#installed.delete(step.name)
      }
      if (!result.ok) for (const error of result.errors) this.#report(error)
    }
    this.#installed.clear()
  }
  /** Resolve only declared live Feature paths, preserving the receiver of each method. */
  #invoke = (input: ITrayInvocation, context?: IRpcContext): unknown => {
    /** Path components are the DSL's plugin, Feature and method namespaces. */
    const [plugin, feature, method, extra] = input.path.split('.')
    if (
      extra ||
      !plugin ||
      !feature ||
      !method ||
      !this.#definition.exposes.includes(`${plugin}.${feature}`)
    )
      throw createTrayError(TrayErrorCode.pathNotExposed)
    /** PluginHost owns live Feature availability and registration identity. */
    const target = this.#handles.get(plugin)?.getFeature(feature) as
      | Record<string, unknown>
      | undefined
    if (!target || typeof target[method] !== 'function')
      throw createTrayError(TrayErrorCode.pathNotExposed)
    return (target as Record<string, (payload: unknown, context?: IRpcContext) => unknown>)[
      method
    ]!(input.payload, context)
  }
}
