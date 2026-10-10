import assert from 'node:assert/strict'
import {
  createDenoThreadLauncher,
  createDenoThreadChannelFactory
} from '../../../dist/threads/adapters/deno.js'
import { runWebBinaryQualification } from '../r14-web-binary.mjs'

/** Actual Deno Workers execute the same canonical/native business path as the Web qualification. */
const receipt = await runWebBinaryQualification(
  createDenoThreadLauncher,
  createDenoThreadChannelFactory
)
assert.deepEqual(receipt.copy, {
  senderLength: 4,
  buffer: true,
  view: true,
  alias: true,
  offset: 1,
  bytes: [9, 1, 2, 8]
})
assert.deepEqual(receipt.transfer, {
  senderLength: 0,
  firstLength: 0,
  secondLength: 0,
  alias: true,
  bytes: [9, 1, 2, 8]
})
assert.deepEqual(receipt.streamed, { beforeNext: 2, senderLength: 0, buffer: true, bytes: [3, 4] })
assert.deepEqual(receipt.grouped, { senderLength: 0, state: 'success', buffer: true, alias: true })
assert.deepEqual(receipt.notify, { senderLength: 0 })
assert.equal(receipt.count, 6)
assert.deepEqual(receipt.failures, [])
/**
 * All classified closing diagnostics are preserved; only the supported cancellation lifecycle
 * signal is accepted.
 */
for (const event of receipt.closing) {
  assert.equal(event.phase, 'closing')
  assert.equal(event.source, '@migaia/rpc/core')
  assert.equal(event.code, 'CANCELLED')
  assert.equal(event.name, 'AbortError')
}
console.log(JSON.stringify(receipt))
Deno.exit(0)
