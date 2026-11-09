import type { IMiddlewarePipelineMode, MiddlewarePipelineNext } from '@migaia/middleware-pipeline'
import type { IPipelineSpecOptions, IPipelineStageHandle } from './pipeline-spec.ts'
import type { IRegistration } from './registry.ts'
import type { IPipelineCollectionPort, IPipelinePorts } from './named-pipeline-types.ts'
import type { IInstallBatchContext } from './install-runtime.ts'
/** Core-owned execution surface; optional runner implementations satisfy it structurally. */
export type IHostPipelineEntry<TDomainCore extends object, TValue> = Readonly<{
  laneKey: PropertyKey
  mode: IMiddlewarePipelineMode
  key: object
  next: MiddlewarePipelineNext
  registration?: IRegistration<TDomainCore, TValue>
  owner: Readonly<{
    use(stage: Function): IPipelineStageHandle
    run(value: TValue, done: (value: TValue) => unknown): unknown
  }>
  register(
    stage: Function,
    owner?: IRegistration<TDomainCore, TValue>,
    kind?: IMiddlewarePipelineMode
  ): IPipelineStageHandle
  run(value: TValue, done: (value: TValue) => unknown): unknown
  runVoid(value: TValue, done: (value: TValue) => void): void | Promise<void>
  runSync<TResult>(value: TValue, done: (value: TValue) => TResult): TResult | undefined
  runAsync<TResult>(
    value: TValue,
    done: (value: TValue) => Promise<TResult>
  ): Promise<TResult | undefined>
}>
/** Installed modes supply this constructor through the core extension slot, never a reverse import. */
export type IHostPipelineEntryConstructor = new <TDomainCore extends object, TValue>(
  collection: IPipelineCollectionPort<TDomainCore, TValue>,
  ports: IPipelinePorts<TValue>,
  key: PropertyKey,
  options: IPipelineSpecOptions,
  legacy?: boolean,
  registration?: IRegistration<TDomainCore, TValue>
) => IHostPipelineEntry<TDomainCore, TValue>
/** Default and named collections share the same core-owned invocation boundary. */
export type IHostPipelineCollection<TDomainCore extends object, TValue> = Readonly<{
  default: IHostPipelineEntry<TDomainCore, TValue>
  depth: number
  keys(): readonly object[]
  prepare?(
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>
  ): void
  owner(
    name: string,
    request?: import('./define-host.ts').IHostCoreConstructionRequest
  ): IHostPipelineEntry<TDomainCore, TValue>['owner']
  registration(
    name: string,
    registration: IRegistration<TDomainCore, TValue>,
    batch?: IInstallBatchContext<TDomainCore, TValue>,
    feature?: string
  ): object
}>
