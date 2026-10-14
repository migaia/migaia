import { createRuntime } from './runtime.class.js'
import type { IRuntime } from './types.js'

/**
 * Default shared runtime for `defaultRuntime.signal/computed/effect` and `createStore()` without an
 * explicit runtime. Use `createRuntime()` when isolation is required.
 *
 * Construction is a module-load side effect, so this runtime lives in a separate module. When it
 * lived in `runtime.class.ts`, importing `Runtime` also constructed an unwanted runtime. That
 * conflicted with per-request ownership and prevented tree shaking because construction is a
 * function call.
 *
 * `architecture.test.ts` checks that the kernel entry's transitive imports exclude this module.
 * Import this module or `defaultRuntime` explicitly when using the convenience API.
 */
export const defaultRuntime: IRuntime = createRuntime()
