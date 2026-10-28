import type { IPluginHostDisposalResult, IPluginResource } from '@migaia/plugin-host'
import type {
  ILogEntry,
  ILogFailure,
  ILogPluginCore,
  IRawEntryInput,
  IShutdownReason
} from './typing.ts'
import type { LogHost } from './host.ts'
import { logCoreOwner } from './state-constants.ts'

/** Canonical peer fields are added after these plain domain descriptors are admitted. */
export type ILogDomainCore = Omit<ILogPluginCore, 'config' | 'lifecycle' | 'onDispose'> & {
  readonly [logCoreOwner]: LogHost
}

/** Acquire peer rollback ownership before a domain registration escapes the installation. */
function ownCoreRegistration(core: Pick<ILogPluginCore, 'onDispose'>, off: () => void): () => void {
  try {
    core.onDispose(off)
    return off
  } catch (error) {
    off()
    throw error
  }
}

/** Shared prototype methods use the peer core receiver and its copied private owner reference. */
export class LogPluginCore {
  /** The peer owns registration authority and supplies these fields to the method receiver. */
  declare readonly [logCoreOwner]: LogHost
  /** Resource registration remains canonical rather than a second domain-owned lifecycle. */
  declare onDispose: (resource: IPluginResource) => void
  /** Produce a plain data core without allocating per-method host-capturing closures. */
  static create(owner: LogHost): ILogDomainCore {
    return {
      [logCoreOwner]: owner,
      ctx: owner.ctx,
      scheduler: owner.scheduler,
      log: LogPluginCore.prototype.log,
      dispatchRaw: LogPluginCore.prototype.dispatchRaw,
      useSink: LogPluginCore.prototype.useSink,
      onFailure: LogPluginCore.prototype.onFailure,
      reportFailure: LogPluginCore.prototype.reportFailure,
      defer: LogPluginCore.prototype.defer,
      onFlush: LogPluginCore.prototype.onFlush,
      flush: LogPluginCore.prototype.flush,
      onShutdown: LogPluginCore.prototype.onShutdown,
      shutdown: LogPluginCore.prototype.shutdown
    }
  }
  /** Standard dispatch stays inside the host's nonthrowing runtime boundary. */
  log(tag: string, message: string, ...args: unknown[]): void {
    this[logCoreOwner].log(tag, message, ...args)
  }
  /** Explicit entries share the same synchronous capture and asynchronous queue. */
  dispatchRaw(input: IRawEntryInput): void {
    this[logCoreOwner].dispatchRaw(input)
  }
  /** The current installation owns sink revocation through peer resource cleanup. */
  useSink(sink: (entry: ILogEntry) => void | Promise<void>): () => void {
    return ownCoreRegistration(this, this[logCoreOwner].useSink(sink))
  }
  /** Failure observer registration is released with this plugin. */
  onFailure(fn: (failure: ILogFailure) => void): () => void {
    return ownCoreRegistration(this, this[logCoreOwner].onFailure(fn))
  }
  /** Route a plugin-owned diagnostic through the exact host failure policy. */
  reportFailure(failure: ILogFailure): void {
    this[logCoreOwner].reportFailure(failure)
  }
  /** Deferred plugin work joins the same bounded flush barrier. */
  defer(task: () => void | Promise<void>): void {
    this[logCoreOwner].defer(task)
  }
  /** The current installation owns its buffer drain callback. */
  onFlush(fn: () => void | Promise<void>): () => void {
    return ownCoreRegistration(this, this[logCoreOwner].onFlush(fn))
  }
  /** All plugins drain the same host rather than creating independent barriers. */
  flush(): Promise<void> {
    return this[logCoreOwner].flush()
  }
  /** Shutdown callbacks remain available until the installation's resources are revoked. */
  onShutdown(fn: (reason: IShutdownReason) => void | Promise<void>): () => void {
    return ownCoreRegistration(this, this[logCoreOwner].onShutdown(fn))
  }
  /** Terminal completion retains the host's exact singleflight Promise identity. */
  shutdown(reason: IShutdownReason): Promise<IPluginHostDisposalResult> {
    return this[logCoreOwner].shutdown(reason)
  }
}
