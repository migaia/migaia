import { getDefaultRuntime } from './default-runtime-provider.ts'
import type { IRuntime } from './types.ts'

/**
 * Default shared runtime for `defaultRuntime.signal/computed/effect` and `createStore()` without an
 * explicit runtime. Use `createRuntime()` when isolation is required.
 *
 * This root convenience binding resolves at module load; pure extension consumers use the provider
 * only on explicit first use. Both entries share the exact same runtime. When it lived in
 * `runtime.class.ts`, importing `Runtime` also constructed an unwanted runtime. That conflicted
 * with per-request ownership and prevented tree shaking because construction is a function call.
 *
 * `architecture.test.ts` checks that the kernel entry's transitive imports exclude this module.
 * Import this module or `defaultRuntime` explicitly when using the convenience API.
 */
export const defaultRuntime: IRuntime = getDefaultRuntime()
