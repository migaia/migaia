import type { IMiddlewarePipelineMode } from './state-constants.ts'
import type { INormalizedPipelineOptions } from './create-pipeline.ts'
import type { IMiddlewarePipelineControlOptions } from './runtime-types.ts'
/** Opaque mode identity exposes only its stable execution key. */
export type IPipelineModeObject<TMode extends IMiddlewarePipelineMode> = Readonly<{ key: TMode }>
/** Private mode behavior stays outside the core import graph. */
export type IPipelineModeImplementation = Readonly<{
  key: IMiddlewarePipelineMode
  run(
    options: INormalizedPipelineOptions,
    stages: readonly unknown[],
    value: unknown,
    done: unknown,
    control: IMiddlewarePipelineControlOptions | undefined
  ): void | Promise<void>
  lift(from: IMiddlewarePipelineMode, stage: unknown, options: INormalizedPipelineOptions): unknown
}>
/** Canonical identity table; importing the core does not install any mode. */
const modes = new WeakMap<object, IPipelineModeImplementation>()
/** Register an internal implementation while publishing only a frozen key. */
export function definePipelineMode<const TMode extends IMiddlewarePipelineMode>(
  implementation: IPipelineModeImplementation & { key: TMode }
): IPipelineModeObject<TMode> {
  const mode = Object.freeze({ key: implementation.key })
  modes.set(mode, implementation)
  return mode
}
/** Foreign structural copies never gain runner authority. */
export function readPipelineMode(value: unknown): IPipelineModeImplementation | undefined {
  return modes.get(value as object)
}
