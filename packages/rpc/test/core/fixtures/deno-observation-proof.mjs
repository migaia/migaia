import assert from 'node:assert/strict'
import { snapshot } from '../../../bench/observe.mjs'

/** Real Deno file loading must precede the observation assertions, without a source overlay. */
const api = await import('../../../dist/threads/index.js')
assert.equal(typeof api.createThreadPeer, 'function')
/** Compatibility zeroes cannot be reported as measured native thread or event-loop fields. */
const observed = snapshot()
assert.ok(observed.loaded.length > 0)
assert.ok(observed.loaded.every((row) => row.loadedSHA256 === row.diskSHA256))
assert.equal(observed.elu, null, '[A37] Deno compatibility ELU zero is unavailable')
assert.equal(observed.threadId, null, '[A37] Deno compatibility threadId zero is unavailable')
assert.equal(observed.isolateRole, 'parent')
console.log(JSON.stringify({ ...observed, runtime: Deno.version }))
