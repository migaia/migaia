import assert from 'node:assert/strict'
import {
  createBunThreadLauncher,
  createBunThreadChannelFactory
} from '../../../dist/threads/adapters/bun.js'
import { runWebBinaryQualification } from '../web-binary.ts'

/** Actual Bun Workers execute the same canonical/native business path as the Web qualification. */
const receipt = await runWebBinaryQualification(
  createBunThreadLauncher,
  createBunThreadChannelFactory
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
process.stdout.write(JSON.stringify(receipt) + '\n')
