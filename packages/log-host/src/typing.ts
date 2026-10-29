import type { IAsyncMiddlewareStage } from '@migaia/middleware-pipeline'
import type {
  IFeature,
  IFeatureRecord,
  IHostHandle,
  IMergePluginExts,
  IPlugin,
  IPluginConfig,
  IPluginConstraint,
  IPluginHandleTuple,
  IPluginHostCore,
  IPluginHostDisposalResult,
  IPluginHostOptions
} from '@migaia/plugin-host'
import type { ISerializedErrorChain } from '@migaia/utils/error'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IFeatureImplementation, ILogFeatureRuntime } from './feature-metadata.ts'
import type { LogLevel, LogHostStatus } from './state-constants.ts'

/** Native identity is retained for console inspection; structured output uses the projection. */
export type IErrorInfo = { name: string; message: string; stack?: string | undefined; raw: Error }
/** One entry owns its shallow containers while nested user objects retain their identity. */
export type ILogEntry = {
  readonly id: string
  readonly tag: string
  readonly time: Date
  readonly message: string
  readonly args: readonly unknown[]
  readonly meta?: Record<string, unknown> | undefined
  readonly context: readonly string[]
  readonly error?: IErrorInfo | undefined
  readonly data: Record<string, unknown>
}
/** Explicit entry input cannot override the host-generated identity. */
export type IRawEntryInput = Partial<Omit<ILogEntry, 'id'>> & { tag: string; message: string }
/** Failure provenance identifies the owner phase rather than replacing the original error. */
export type ILogFailure = {
  readonly source: 'defer' | 'hook' | 'sink' | 'pipeline' | 'flush' | 'forward' | 'shutdown'
  readonly error: unknown
}
/** Shutdown causes preserve the process and manual trigger domains. */
export type IShutdownReason = 'signal' | 'uncaughtException' | 'unhandledRejection' | 'manual'
/** Frozen construction context is shared by every plugin of a host. */
export type ILogContext = Readonly<{
  id: string
  options: Readonly<Record<string, unknown>>
  path: readonly string[]
  topic: string
  createdAt: Date
  env: Readonly<{ isTTY: boolean; isCI: boolean }>
}>
/** Plugin registration and lifecycle authority remains owned by plugin-host. */
export type ILogPluginCore = Pick<
  IPluginHostCore<ILogEntry>,
  'config' | 'lifecycle' | 'onDispose'
> & {
  readonly ctx: ILogContext
  readonly scheduler: IScheduler
  log(tag: string, message: string, ...args: unknown[]): void
  dispatchRaw(input: IRawEntryInput): void
  useSink(sink: (entry: ILogEntry) => void | Promise<void>): () => void
  onFailure(fn: (failure: ILogFailure) => void): () => void
  reportFailure(failure: ILogFailure): void
  defer(task: () => void | Promise<void>): void
  onFlush(fn: () => void | Promise<void>): () => void
  flush(): Promise<void>
  onShutdown(fn: (reason: IShutdownReason) => void | Promise<void>): () => void
  shutdown(reason: IShutdownReason): Promise<IPluginHostDisposalResult>
}
/** Exact peer generic axes preserve custom extensions, configurations and declared features. */
export type ILogPlugin<
  O extends Record<string, unknown> = Record<string, never>,
  C extends IPluginConfig = IPluginConfig,
  F extends IFeatureRecord = Record<never, never>,
  E extends object = Record<never, never>
> = IPlugin<ILogPluginCore, O, C, Record<never, never>, F, E>
/** Plugin tuples retain each member's actual declaration instead of erasing extensions. */
export type ILogPluginConstraint = IPluginConstraint<any>
/** The peer owns extension intersection and overloaded method inference. */
export type IPluginExtensions<P extends readonly ILogPluginConstraint[]> = IMergePluginExts<P>
/** Third-party features implement exactly one of the supported public processing stages. */
export type ILogFeatureDefinition =
  | {
      phase: 'entry'
      stage(entry: ILogEntry): ILogEntry | undefined | Promise<ILogEntry | undefined>
    }
  | { phase: 'gate'; accept(entry: ILogEntry): boolean }
  | {
      phase: 'format'
      format(entry: ILogEntry): string
      paint?(tag: string, text: string): string
      dim?(text: string): string
      arguments?(entry: ILogEntry, isTTY: boolean): unknown[]
    }
/** Log definitions retain plugin-host's opaque identity and exact per-installation controls. */
export type ILogFeature<C extends object = Record<never, never>> = IFeature<
  Record<never, never>,
  ILogFeatureRuntime<C>
>
/** Plugin-host aliases retain exact feature output inference. */
export type ILogFeatureRecord = Readonly<Record<string, ILogFeature<any>>>
/** Installed format observations carry behavior without exposing a feature definition token. */
export type ILogFormat = Extract<IFeatureImplementation, { phase: 'format' }>
/** Merge separately named controls without erasing the empty-feature case. */
type IUnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I
) => void
  ? I
  : never
/** Controls use plugin and record names so host-wide and local policies can coexist. */
export type ILogControlExtensions<
  N extends string,
  F extends ILogFeatureRecord
> = keyof F extends never
  ? Record<never, never>
  : IUnionToIntersection<
      {
        [A in keyof F & string]: F[A] extends ILogFeature<infer C>
          ? {
              [M in keyof C & string as `${N}_${A}_${M}`]: C[M]
            }
          : never
      }[keyof F & string]
    > &
      Record<never, never>
/** Output projection replaces only errors, preserving the established entry wire shape. */
export type ILogProjectedEntry = Omit<ILogEntry, 'error'> & {
  readonly error?: ISerializedErrorChain | undefined
}
/** Output records carry the native entry beside the selected formatted text. */
export type ILogOutputRecord = Readonly<{ entry: ILogEntry; text: string }>
/** Standard severity methods are present only when levelPlugin is installed. */
export type ILevelPluginExt = {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  fatal(...args: unknown[]): void
  atLevel(level: LogLevel, entry: IRawEntryInput): void
}
/** Host creation captures capabilities and plugin declarations synchronously. */
export type ILogHostOptions<P extends readonly ILogPluginConstraint[] = readonly []> = {
  readonly plugins?: P
  readonly context?: readonly string[]
  readonly topic?: string
  readonly maxPending?: number
  readonly scheduler?: IScheduler
  readonly randomUUID?: () => string
  readonly report?: (error: unknown) => void
  readonly execution?: IPluginHostOptions['execution']
}
/** The frozen facade exposes host methods and the initially installed plugin extensions. */
export type ILogHost<P extends readonly ILogPluginConstraint[] = readonly []> = Readonly<{
  ctx: ILogContext
  config: IHostHandle<ILogPluginCore, ILogEntry, P>['config']
  status: LogHostStatus
  log(tag: string, message: string, ...args: unknown[]): void
  dispatchRaw(input: IRawEntryInput): void
  usePipeline(stage: IAsyncMiddlewareStage<ILogEntry>): () => void
  onFailure(fn: (failure: ILogFailure) => void): () => void
  onShutdown(fn: (reason: IShutdownReason) => void | Promise<void>): () => void
  flush(): Promise<void>
  shutdown(reason: IShutdownReason): Promise<IPluginHostDisposalResult>
  use<const NewP extends readonly ILogPluginConstraint[]>(
    ...plugins: NewP
  ): Promise<IPluginHandleTuple<NewP>>
  unUse: IHostHandle<ILogPluginCore, ILogEntry, P>['unUse']
}> &
  IPluginExtensions<P>
