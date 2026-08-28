/** Public scope leaf barrel; exports are projections of canonical scope implementations. */
export {
  createLifecycleScope,
  type ILifecycleScope,
  type ILifecycleScopeOptions
} from './lifecycle-scope.js'
export {
  createSyncLifecycleScope,
  type ISyncLifecycleScope,
  type ISyncLifecycleScopeOptions,
  type ISyncReleaseDescriptor
} from './sync-lifecycle-scope.js'
export {
  createProvisionalScope,
  type IProvisionalScope,
  type IProvisionalScopeOptions
} from './provisional-scope.js'
