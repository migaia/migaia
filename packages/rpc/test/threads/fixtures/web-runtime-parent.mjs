import { createBunThreadLauncher } from '../../../dist/threads/adapters/bun.js'
import { createDenoThreadLauncher } from '../../../dist/threads/adapters/deno.js'

/** This script runs in each actual runtime; results preserve unsupported exit semantics. */
const runtime = typeof Deno === 'object' ? 'deno' : 'bun'
/** Evidence never derives capability strength from a close event. */
const launcher = (runtime === 'deno' ? createDenoThreadLauncher : createBunThreadLauncher)({
  report: (error) => diagnostics.push(String(error?.message ?? error))
})
/** Only fixture diagnostics are written to stdout. */
const diagnostics = []
/** Runtime path is an absolute URL, matching production entry admission. */
const entry = new URL('./web-runtime-worker.mjs', import.meta.url).href
/** The raw counter intentionally stays outside portable spec.data and the RPC contract. */
const counter = new Int32Array(new SharedArrayBuffer(4))
/** Adapter launch installs error observation synchronously. */
const handle = await launcher.launch({ entry }, { signal: new AbortController().signal })
/** Pending actual-exit observation remains unresolved without a runtime proof. */
let exited = false
void handle.exited.then(() => {
  exited = true
})
/** This fixture sends raw lifecycle data independently of the RPC bootstrap. */
const mode = runtime === 'deno' ? Deno.args[0] : process.argv[2]
handle.port.postMessage(mode === 'busy' ? { mode, counter: counter.buffer } : { mode }, undefined)
/** Initial execution establishes that the fixture actually entered its selected path. */
await new Promise((resolve) => setTimeout(resolve, 100))
/** Last work before terminate establishes the ordering against its immediate return. */
const before = Atomics.load(counter, 0)
handle.terminate()
/** A post-terminate observation distinguishes stopped work from an early close marker. */
await new Promise((resolve) => setTimeout(resolve, 100))
/** The adapter reports honest current evidence and never releases an exited receipt. */
console.log(
  JSON.stringify({
    runtime,
    mode,
    capabilities: launcher.capabilities,
    before,
    after: Atomics.load(counter, 0),
    exited,
    diagnostics,
    hostAlive: true
  })
)
if (runtime === 'deno') Deno.exit(0)
else process.exit(0)
