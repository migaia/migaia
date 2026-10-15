/** Public error boundary; identity attachment and range validation remain implementation details. */
export {
  LIFECYCLE_SOURCE,
  createLifecycleError,
  createLifecycleFailure,
  createLifecycleTypeError,
  createErrorCollector,
  containAsyncRejection,
  type ILifecycleError,
  type IErrorCollector
} from './errors.js'
