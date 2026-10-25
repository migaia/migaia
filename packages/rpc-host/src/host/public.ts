/** Public host ownership is global; every RPC invocation is projected under a transport namespace. */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcHostPlugin, IRpcTransportPlugin, IRpcNamespacePlugin } from '../sdk/types.js'
import type { IRpcProvide, IRpcProvideOptions } from '../dispatch/types.js'
import type { IRpcProviderDeclaration } from '@migaia/rpc-contract/protocol'
import type { IRpcNamespace, IRpcIntersection } from '../namespace/types.js'
import type { IRpcSelf } from './identity.js'

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
  report?(error: unknown): void
  signal?: IAbortSignal
}>

/** Runtime construction also serves an ordinary native host without creating a second plugin-host. */
export type IRpcRuntimeOptions = Omit<IRpcHostOptions, 'plugins'>

/** Root lifetime methods cannot be replaced by an inferred dynamic namespace. */
type IRpcHostRoot = Readonly<{
  self: IRpcSelf
  provide(input: IRpcProvide, options?: IRpcProvideOptions): void
  close(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}>

/** Only actual cold transports introduce namespaces; flow plugins contribute to their own scope. */
type IRpcNamespaceNames<TPlugin> = TPlugin extends IRpcTransportPlugin<infer N, object> ? N : never
/** Shared erased metadata correlates complete flow/transport extensions with the selected namespace. */
type IRpcNamespaceExtensions<TPlugin, N extends string> =
  TPlugin extends IRpcNamespacePlugin<infer Scope, infer E> ? (N extends Scope ? E : never) : never

/** Correlate remote call types and genuine plugin extension types inside each installed namespace. */
export type IRpcHost<
  TRemote = Record<never, never>,
  TPlugins extends readonly IRpcHostPlugin[] = readonly IRpcHostPlugin[]
> = IRpcHostRoot &
  Readonly<{
    [N in IRpcNamespaceNames<TPlugins[number]>]: IRpcNamespace<TRemote> &
      IRpcIntersection<IRpcNamespaceExtensions<TPlugins[number], N>>
  }>
