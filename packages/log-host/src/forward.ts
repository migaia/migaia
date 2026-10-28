import type { ILogHost, ILogEntry, ILogPlugin, ILogPluginCore } from './typing.ts'
import type { LogHost } from './host.ts'
import { logHostOwners } from './host-registry.ts'
import {
  logCoreOwner,
  LogPluginName,
  LogEntryDataKey,
  LogFailureSource
} from './state-constants.ts'
import type { ILogDomainCore } from './core.ts'
import { createLogError } from './errors.ts'
import { LogHostErrorCode } from './error-code.ts'
import { LogHostErrorText } from './error-text.ts'

/** Installed edges are indexed by real owner identity; removal cannot retain source hosts. */
const forwardEdges = new WeakMap<LogHost, ReadonlySet<LogHost>>()
/** Private factory provenance allows host configuration admission before peer install wrapping. */
const forwardDefinitions = new WeakMap<
  object,
  readonly Pick<ILogHost, 'ctx' | 'dispatchRaw' | 'flush'>[]
>()

/** Host-owned configuration errors leave through their approved logging semantic identity. */
export function validateForwardPlugin(source: LogHost, plugin: object): void {
  /** Only this package's real factory grants forwarding topology configuration authority. */
  const targets = forwardDefinitions.get(plugin)
  if (!targets) return
  for (const target of targets) {
    /** Real owners make every supported edge available to the same cycle traversal. */
    const owner = logHostOwners.get(target)
    if (owner === source)
      throw createLogError(
        LogHostErrorCode.forwardSelf,
        LogHostErrorText.forwardSelf(source.ctx.id)
      )
    if (owner && canReach(owner, source))
      throw createLogError(
        LogHostErrorCode.forwardCycle,
        LogHostErrorText.forwardCycle(source.ctx.id)
      )
  }
}

/** Visit each reachable host once instead of recursively rescanning shared forwarding branches. */
function canReach(start: LogHost, target: LogHost): boolean {
  /** This explicit traversal remains linear in visited hosts and their installed edges. */
  const pending = [start]
  /** Shared branches never reenter a previously examined host. */
  const visited = new Set<LogHost>()
  for (let cursor = 0; cursor < pending.length; cursor++) {
    /** Queue cursors avoid copying the remaining growable graph frontier. */
    const current = pending[cursor]
    if (current === target) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const next of forwardEdges.get(current) ?? []) if (!visited.has(next)) pending.push(next)
  }
  return false
}

/** Forwarding owns entry transfer, target drain and graph revocation for one installation. */
class ForwardInstallation {
  /** Original registration core retains the source failure policy. */
  #core: ILogPluginCore
  /** Targets retain their public facade rather than a separate forwarding compatibility layer. */
  #targets: readonly Pick<ILogHost, 'ctx' | 'dispatchRaw' | 'flush'>[]
  /** Graph entries are revoked with the source registration. */
  #source: LogHost
  /** Validate all edges before publishing any of them. */
  constructor(
    core: ILogPluginCore,
    targets: readonly Pick<ILogHost, 'ctx' | 'dispatchRaw' | 'flush'>[]
  ) {
    this.#core = core
    this.#source = (core as ILogPluginCore & ILogDomainCore)[logCoreOwner]
    /** Repeated targets collapse by owner identity as in the previous forwarding owner. */
    const owners = new Set<LogHost>()
    /** Target context identity preserves first-registration deduplication for structural facades. */
    const selectedIds = new Set<string>()
    /** Preserve each first target's declaration order. */
    const selected: Pick<ILogHost, 'ctx' | 'dispatchRaw' | 'flush'>[] = []
    for (const target of targets) {
      /** Only a real host has a cycle-checkable ownership graph. */
      const owner = logHostOwners.get(target)
      if (owner === this.#source)
        throw createLogError(
          LogHostErrorCode.forwardSelf,
          LogHostErrorText.forwardSelf(core.ctx.id)
        )
      if (owner && canReach(owner, this.#source))
        throw createLogError(
          LogHostErrorCode.forwardCycle,
          LogHostErrorText.forwardCycle(core.ctx.id)
        )
      if (!selectedIds.has(target.ctx.id)) {
        if (owner) owners.add(owner)
        selectedIds.add(target.ctx.id)
        selected.push(target)
      }
    }
    this.#targets = selected
    forwardEdges.set(this.#source, owners)
  }
  /** Each target receives the same logical message and native payload identities through its host. */
  forward(entry: ILogEntry): void {
    /** Public display topics follow the original source/target topic ordering. */
    const prior = entry.data[LogEntryDataKey.topicChain] as readonly string[] | undefined
    /** Source topic starts the display path only when a prior hop has not already supplied one. */
    const topics = prior?.length ? prior : this.#core.ctx.topic ? [this.#core.ctx.topic] : []
    for (const target of this.#targets) {
      try {
        target.dispatchRaw({
          tag: entry.tag,
          message: entry.message,
          args: entry.args,
          context: entry.context,
          meta: entry.meta,
          error: entry.error,
          data: {
            ...entry.data,
            [LogEntryDataKey.topicChain]: target.ctx.topic ? [...topics, target.ctx.topic] : topics
          }
        })
      } catch (error) {
        this.#core.reportFailure({ source: LogFailureSource.forward, error })
      }
    }
  }
  /** Source flushing also drains its acyclic targets, preserving forwarding completion semantics. */
  async flush(): Promise<void> {
    for (const target of this.#targets) {
      try {
        await target.flush()
      } catch (error) {
        this.#core.reportFailure({ source: LogFailureSource.forward, error })
      }
    }
  }
  /** Revocation removes graph authority and drops retained targets without touching target hosts. */
  release(): void {
    forwardEdges.delete(this.#source)
    this.#targets = []
  }
}

/** One forwarding plugin is one graph-edge registration owned by the canonical plugin lifecycle. */
class ForwardPlugin implements ILogPlugin {
  /** Stable identity prevents multiple overlapping forwarding registrations on one host. */
  readonly name = LogPluginName.forward
  /** Snapshot target declarations before installation can observe caller mutation. */
  #targets: readonly Pick<ILogHost, 'ctx' | 'dispatchRaw' | 'flush'>[]
  /** Capture only targets; side effects begin under peer installation ownership. */
  constructor(targets: readonly Pick<ILogHost, 'ctx' | 'dispatchRaw' | 'flush'>[]) {
    this.#targets = [...targets]
    forwardDefinitions.set(this, this.#targets)
  }
  /** Register graph rollback before sink/flusher acquisition can fail. */
  install(core: ILogPluginCore): Record<string, never> {
    /** Named installation state provides shared methods for every lifecycle callback. */
    const installation = new ForwardInstallation(core, this.#targets)
    core.onDispose(() => installation.release())
    core.useSink((entry) => installation.forward(entry))
    core.onFlush(() => installation.flush())
    return {}
  }
}

/** Forward processed entries to other hosts after rejecting self-links and multi-hop cycles. */
export function forwardPlugin(options: {
  targets: readonly Pick<ILogHost, 'ctx' | 'dispatchRaw' | 'flush'>[]
}): ILogPlugin {
  return new ForwardPlugin(options.targets)
}
