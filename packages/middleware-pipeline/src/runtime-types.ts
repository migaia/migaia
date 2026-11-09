import type { IAbortSignal } from '@migaia/utils/promise'
import {
  MiddlewarePipelineGeneratorSignals,
  type IGeneratorMiddlewareSignals,
  type IMiddlewarePipelineViolationHandler,
  type MiddlewarePipelineNext
} from './state-constants.ts'
type IGeneratorUndefinedSignal<
  TValue,
  TSignals extends IGeneratorMiddlewareSignals
> = undefined extends TValue ? TSignals['undefined'] : never

/** One frozen context shared by stages and done only when this run has an effective abort signal. */
export type IMiddlewarePipelineContext = {
  /**
   * Host-owned effective signal after run-level override; running work must cooperate with
   * cancellation.
   */
  readonly signal: IAbortSignal
}
/** Per-run controls. Omitted controls reuse the construction defaults without creating a controller. */
export type IMiddlewarePipelineControlOptions = {
  /** Overrides the construction signal when supplied; undefined falls back to that default. */
  readonly signal?: IAbortSignal
}
/**
 * Synchronous stage receiving the current value and optional signal context. The first next(value)
 * only submits a value; downstream starts after this stage returns normally. No next short-circuits
 * the run without done. A throw prevents downstream entry; duplicate/late next calls report a
 * violation.
 */
export type ISyncMiddlewareStage<TValue> = (
  value: TValue,
  next: (value: TValue) => void,
  context?: IMiddlewarePipelineContext
) => void
/**
 * Async onion stage: the first next(value) starts downstream immediately and returns its promise.
 * Await next for before/after ordering. The runner still waits for started downstream when next is
 * not awaited, and reports duplicate/late calls without starting another traversal. Not calling
 * next short-circuits; independent stage/downstream failures use the configured composition
 * policy.
 */
export type IAsyncMiddlewareStage<TValue, TResult = void> = (
  value: TValue,
  next: (value: TValue) => Promise<TResult>,
  context?: IMiddlewarePipelineContext
) => void | Promise<unknown>
/**
 * Synchronous generator stage drained completely before downstream starts. Yields remain local: a
 * normal returned value continues, continue selects the last yield (or input when no yield), halt
 * or an implicit undefined return stops, and the undefined signal explicitly forwards undefined.
 * Use the runner's configured control symbols; cancellation during iteration drains iterator
 * cleanup.
 */
export type IGeneratorMiddlewareStage<
  TValue,
  TSignals extends IGeneratorMiddlewareSignals = typeof MiddlewarePipelineGeneratorSignals
> = (
  value: TValue,
  context?: IMiddlewarePipelineContext
) => Generator<
  TValue | IGeneratorUndefinedSignal<TValue, TSignals>,
  | TValue
  | IGeneratorUndefinedSignal<TValue, TSignals>
  | TSignals['halt']
  | TSignals['continue']
  | undefined,
  void
>
/**
 * Async generator stage whose iterations finish before the next stage begins. Terminal control
 * meanings match the synchronous generator stage; ordinary yields do not publish downstream values.
 * The runner awaits iteration and cancellation cleanup. A payload domain containing undefined is
 * required to forward an explicit undefined signal; failures reject the run with originals
 * retained.
 */
export type IAsyncGeneratorMiddlewareStage<
  TValue,
  TSignals extends IGeneratorMiddlewareSignals = typeof MiddlewarePipelineGeneratorSignals
> = (
  value: TValue,
  context?: IMiddlewarePipelineContext
) => AsyncGenerator<
  TValue | IGeneratorUndefinedSignal<TValue, TSignals>,
  | TValue
  | IGeneratorUndefinedSignal<TValue, TSignals>
  | TSignals['halt']
  | TSignals['continue']
  | undefined,
  void
>
export type IMiddlewarePipelineOptions = {
  /** Fixed construction policy for accepted downstream submissions. */
  readonly next?: MiddlewarePipelineNext
  readonly onViolation: IMiddlewarePipelineViolationHandler
  readonly assertActive?: () => void
  /** Host-owned error construction for the stage+downstream failure case. */
  readonly combineStageAndDownstreamError?: (stage: unknown, downstream: unknown) => unknown
  readonly signal?: IAbortSignal
}
