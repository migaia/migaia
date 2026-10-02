import assert from 'node:assert/strict'
import { createBunThreadLauncher } from '../../../dist/threads/adapters/bun.js'
import { createDenoThreadLauncher } from '../../../dist/threads/adapters/deno.js'

/** The fixture runs in each actual platform, with the normal runtime Worker constructor. */
const deno = typeof Deno === 'object'
/** Error cancellation must be observable on the native event after the production listener. */
const prevented = []
/** Bun emits non-cancelable errors; observe the native method call independently from its flag. */
const preventCalls = []
/** Local reports prove the uncaught Worker error reached the production observer once. */
const reported = []
/** Record the native boundary beneath both bootstrap and RPC port shims. */
const posted = []
/** The fixture only adds observation; Worker construction and event delivery remain native. */
class ObservedWorker extends globalThis.Worker {
  /** Forward all arguments to the actual runtime and record the final transfer argument. */
  postMessage(message, transfer) {
    posted.push(transfer)
    return super.postMessage(message, transfer)
  }
  /** Inspect cancellation after the launcher's native Worker error listener has run. */
  addEventListener(type, listener, options) {
    if (type !== 'error') return super.addEventListener(type, listener, options)
    return super.addEventListener(
      type,
      (event) => {
        /** Preserve actual native cancellation semantics while counting the required invocation. */
        const preventDefault = event.preventDefault
        /** Only this event's production listener may increment its cancellation count. */
        let calls = 0
        event.preventDefault = () => {
          calls += 1
          Reflect.apply(preventDefault, event, [])
        }
        listener(event)
        prevented.push(event.defaultPrevented)
        preventCalls.push(calls)
      },
      options
    )
  }
}
/** Platform factory keeps unsupported termination and exit-observation declarations unchanged. */
const launcher = (deno ? createDenoThreadLauncher : createBunThreadLauncher)({
  Worker: ObservedWorker,
  report: (error) => reported.push(error)
})
/** Native bootstrap acknowledgement precedes the worker's deliberately uncaught error. */
const handle = await launcher.launch(
  { entry: new URL('./web-error-worker.mjs', import.meta.url).href },
  { signal: new AbortController().signal }
)
await handle.prepared
/** A bounded native wait allows the error event to reach the production listener. */
const until = Date.now() + 2000
while (prevented.length === 0 && Date.now() < until)
  await new Promise((resolve) => setTimeout(resolve, 5))
assert.deepEqual(preventCalls, [1])
if (deno) assert.deepEqual(prevented, [true])
assert.equal(reported.length, 1)
assert.ok(posted.length > 0)
assert.ok(posted.every((transfer) => transfer === undefined))
assert.equal(launcher.capabilities.termination, 'unsupported')
handle.terminate()
console.log(
  JSON.stringify({
    runtime: deno ? `deno ${Deno.version.deno}` : `bun ${Bun.version}`,
    hostAlive: true,
    prevented,
    preventCalls,
    reports: reported.length,
    nativePosts: posted.length,
    termination: launcher.capabilities.termination
  })
)
// Unsupported exit observation is not promoted to an actual-exit receipt by fixture shutdown.
if (deno) Deno.exit(0)
else process.exit(0)
