// 错误码是公开 API 的一部分（`docs/contracts/error-codes.md`）：调用方要能按 code 分支，
// 就必须从包入口拿得到常量，而不是自己抄一份字符串字面量。
export { ResourceErrorCode, type IResourceErrorCode } from './error-code.js'
export { RESOURCE_SOURCE, type IResourceError } from './errors.js'
export { ResourceStatus, type IResourceStatus } from './state-constants.js'

export {
  Resource,
  type IResourceCacheSnapshot,
  type IResourceFetcher,
  type IResourceFetchStatus,
  type IResourceOptions,
  type IResourceRetryPolicy,
  type IResourceState
} from './resource.class.js'
