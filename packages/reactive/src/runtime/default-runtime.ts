import { createRuntime, type Runtime } from './runtime.class.js'

/**
 * Default shared runtime for convenience calls such as `signal()` or `createStore()` without an
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
export const defaultRuntime: Runtime = createRuntime()
