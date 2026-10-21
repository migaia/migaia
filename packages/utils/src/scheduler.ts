/** Runtime scheduler boundary; deterministic test controls belong to the explicit testing entry. */
export { deferTask, systemScheduler, systemWallClock } from './internal/scheduler.js'
export type { IScheduledTask, IScheduler, IWallClock } from './internal/scheduler.js'

export {
  AsyncTaskStrategy,
  asyncTask,
  isAsyncTaskSupported,
  resolveAsyncTaskStrategy,
  yieldToHost
} from './internal/async-task.js'
export type {
  IAsyncTaskContext,
  IAsyncTaskOptions,
  IConcreteAsyncTaskStrategy
} from './internal/async-task.js'
export { timeSlice, timeSliceMap, timeSliceReduce } from './internal/time-slice.js'
export type { ITimeSliceOptions, ITimeSliceReport } from './internal/time-slice.js'
export { coalesce, debounce, repeat, throttle } from './internal/rate.js'
export type {
  ICoalescedFunction,
  IControlledFunction,
  IDebounceOptions,
  IRepeatContext,
  IRepeatHandle,
  IRepeatOptions,
  IThrottleOptions
} from './internal/rate.js'
