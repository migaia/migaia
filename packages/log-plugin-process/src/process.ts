import { detectServerRuntime } from '@migaia/utils'
import type { ILogPlugin } from '@migaia/log-host/plugin'
import { ProcessGroup, processGroups } from './group.ts'
import { PROCESS_PLUGIN_NAME } from './state-constants.ts'
import type { IProcessCapability, IProcessPluginConfig, IProcessPolicy } from './typing.ts'

/** The peer's configured installation core retains the public process config value types. */
type IProcessCore = Parameters<
  ILogPlugin<Record<string, never>, IProcessPluginConfig>['install']
>[0]

/** A reusable plugin definition captures the borrowed capability but no installed group state. */
class ProcessPlugin implements ILogPlugin<Record<string, never>, IProcessPluginConfig> {
  /** The canonical peer owns one registration of this name per host. */
  readonly name = PROCESS_PLUGIN_NAME
  /** Only policy enters the peer's owned config; borrowed process identity is never cloned. */
  readonly config: IProcessPluginConfig
  /** Explicit injection or recognized server process remains the original object. */
  #process: IProcessCapability | undefined

  /** Capture process identity separately from its configurable policy fields. */
  constructor(options: IProcessPluginConfig) {
    const { process, ...policy } = options
    this.config = policy
    this.#process =
      process ??
      (detectServerRuntime() === undefined
        ? undefined
        : (globalThis as unknown as { process?: IProcessCapability }).process)
  }

  /** Join or initialize only this capability's compatible group and register canonical cleanup. */
  install(core: IProcessCore): Record<string, never> {
    if (!this.#process) return {}
    /** Normalize the peer-owned snapshot through its configured public shape, without casts. */
    const policy = processPolicy(core.config.get())
    /** Exact capability identity selects the existing listener/scheduler domain. */
    let group = processGroups.get(this.#process)
    if (!group) {
      group = new ProcessGroup(this.#process, policy, core.scheduler)
      group.initialize()
      processGroups.set(this.#process, group)
    }
    group.add(core, policy)
    /** Capture the exact group so cleanup cannot accidentally address another process domain. */
    const installedGroup = group
    core.onDispose(() => installedGroup.remove(core))
    return {}
  }
}

/**
 * Fixed policy defaults preserve capture and graceful-exit behavior independently of core
 * overloads.
 */
function processPolicy(options: IProcessPluginConfig): IProcessPolicy {
  return {
    captureCrashes: options.captureCrashes ?? true,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? 3000,
    interceptProcessExit: options.interceptProcessExit ?? false
  }
}

/** Install signal/crash integration with per-process shared listeners and borrowed capabilities. */
export function processPlugin(
  options: IProcessPluginConfig = {}
): ILogPlugin<Record<string, never>, IProcessPluginConfig> {
  return new ProcessPlugin(options)
}
