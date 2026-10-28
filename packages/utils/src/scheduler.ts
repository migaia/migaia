/** Runtime scheduler boundary; deterministic test controls belong to the explicit testing entry. */
export { deferTask, systemScheduler, systemWallClock } from './internal/scheduler.ts'
export type { IScheduledTask, IScheduler, IWallClock } from './internal/scheduler.ts'

export {
  AsyncTaskStrategy,
  asyncTask,
  isAsyncTaskSupported,
  resolveAsyncTaskStrategy,
  yieldToHost
} from './internal/async-task.ts'
export type {
  IAsyncTaskContext,
  IAsyncTaskOptions,
  IConcreteAsyncTaskStrategy
} from './internal/async-task.ts'
export { timeSlice, timeSliceMap, timeSliceReduce } from './internal/time-slice.ts'
export type { ITimeSliceOptions, ITimeSliceReport } from './internal/time-slice.ts'
export { coalesce, debounce, repeat, throttle } from './internal/rate.ts'
export type {
  ICoalescedFunction,
  IControlledFunction,
  IDebounceOptions,
  IRepeatContext,
  IRepeatHandle,
  IRepeatOptions,
  IThrottleOptions
} from './internal/rate.ts'
