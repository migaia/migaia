/**
 * Publishes the complete timeout and retry call-feature factories through the package feature
 * entry. The implementations own their call policies; this entry only defines the supported export
 * boundary.
 */
export { retry, type IRetryFeatureOptions } from './retry.js'
export { timeout, type ITimeoutFeatureOptions } from './timeout.js'
