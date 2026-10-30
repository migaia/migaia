/** Public host ownership is global; every RPC invocation is projected under a transport namespace. */
import type { IHostHandle } from '@migaia/plugin-host'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcHostPlugin, IRpcTransportPlugin, IRpcNamespacePlugin } from '../sdk/types.ts'
import type { IRpcProvide, IRpcProvideOptions } from '../dispatch/types.ts'
import type { IRpcProviderDeclaration } from '@migaia/rpc-contract/protocol'
import type { IRpcNamespace, IRpcIntersection } from '../namespace/types.ts'
import type { IRpcSelf } from './identity.ts'
import type { IRpcWarning } from './warning.ts'

/** Cold host admission contains no concrete timeout, retry, authentication or quota configuration. */
export type IRpcHostOptions<
  TPlugins extends readonly IRpcHostPlugin[] = readonly IRpcHostPlugin[]
> = Readonly<{
  plugins: TPlugins
  provide?: IRpcProvide
  /** Local declarations announce schema and idempotency; business validation belongs to schema. */
  contract?: IRpcProviderDeclaration
  self?: IRpcSelf
  /** Each forwarding host bounds its own absolute forwarding ordinal before downstream handoff. */
  forward?: Readonly<{ maxHops?: number }>
  /** Every supported physical Session owns its closing byte quota and complete grace deadline. */
  keepalive?: Readonly<{ maxBytes?: number; timeoutMs?: number }>
  report?(error: unknown): void
  /** Receives each warning before SDK subscribers; console.warn runs only when both are absent. */
  onWarning?(warning: IRpcWarning): void
  signal?: IAbortSignal
}>

/** Runtime construction also serves an ordinary native host without creating a second plugin-host. */
export type IRpcRuntimeOptions = Omit<IRpcHostOptions, 'plugins'>

/** Root lifetime methods cannot be replaced by an inferred dynamic namespace. */
type IRpcHostRoot<TRemote, TPlugins extends readonly IRpcHostPlugin[]> = Readonly<{
  self: IRpcSelf
  /** Each batch is atomic and returns this same Host with its added namespace types. */
  use<const TAdded extends readonly IRpcHostPlugin[]>(
    ...plugins: TAdded
  ): Promise<IRpcHost<TRemote, readonly [...TPlugins, ...TAdded]>>
  /** Native dependency-aware removal closes the transport's Sessions before deleting its group. */
  unUse: IHostHandle<Record<never, never>, never, readonly []>['unUse']
  provide(input: IRpcProvide, options?: IRpcProvideOptions): void
  close(reason?: unknown): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}>

/** Only actual cold transports introduce namespaces; flow plugins contribute to their own scope. */
type IRpcNamespaceNames<TPlugin> = TPlugin extends IRpcTransportPlugin<infer N, object> ? N : never
/** Shared erased metadata correlates complete flow/transport extensions with the selected namespace. */
type IRpcNamespaceExtensions<TPlugin, N extends string> =
  TPlugin extends IRpcNamespacePlugin<infer Scope, infer E> ? (N extends Scope ? E : never) : never
/** Closing calls exist only when the installed transport explicitly declares native write support. */
type IRpcNamespaceClosing<TPlugin, N extends string> =
  TPlugin extends IRpcTransportPlugin<infer Scope, object, infer A>
    ? N extends Scope
      ? A
      : never
    : never

/** Correlate remote call types and genuine plugin extension types inside each installed namespace. */
export type IRpcHost<
  TRemote = Record<never, never>,
  TPlugins extends readonly IRpcHostPlugin[] = readonly IRpcHostPlugin[]
> = IRpcHostRoot<TRemote, TPlugins> &
  Readonly<{
    [N in IRpcNamespaceNames<TPlugins[number]>]: IRpcNamespace<
      TRemote,
      IRpcNamespaceClosing<TPlugins[number], N>
    > &
      IRpcIntersection<IRpcNamespaceExtensions<TPlugins[number], N>>
  }>
