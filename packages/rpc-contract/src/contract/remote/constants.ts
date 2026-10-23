import { RpcRuntimeStreamPrefix } from '../framing/v1.js'

/** Reserved method namespace shared by plugin and host remote endpoints. */
export const RemoteMethodName = {
  /** Required v2 application directory is generated from the actual registered method routes. */
  runtimeDescribe: 'migaia.remote.runtime.describe',
  /** Distinct internal stream wire routes share the original provider registry with scalar routes. */
  runtimeStreamPrefix: RpcRuntimeStreamPrefix,
  /** Automatic application methods cannot impersonate the reserved library control namespace. */
  runtimeNamespace: 'migaia.remote.',
  /** Reserved request to install a declared remote Host plugin. */ hostUse:
    'migaia.remote.host.use',
  /** Reserved request to plan/remove an adopted remote Host registration. */ hostUnUse:
    'migaia.remote.host.unUse',
  /** Reserved query for safe remote catalog state. */ hostInspect: 'migaia.remote.host.inspect'
} as const

/** Bounded shape diagnostics share the established trace-character budget. */
export const REMOTE_SHAPE_DETAIL_PATH_CHARS = 256

/** Untrusted routing keys use this fixed diagnostic segment instead of their input text. */
export const REMOTE_INVALID_PATH_SEGMENT = '<invalid-key>'
