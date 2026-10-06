import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { MessageChannel } from 'node:worker_threads'
import { it } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../src/threads/adapters/node.js'
import { threadWebPort } from '../../src/threads/channel.js'
import type { IThreadWebPort } from '../../src/threads/types.js'

/** The genuine Worker reports native bytes through its own parentPort. */
const entry = fileURLToPath(new URL('./fixtures/transfer-echo-worker.mjs', import.meta.url))

it('[A86] original Node launcher/channel forwards the transfer list to a real Worker', async () => {
  const handle = await createNodeThreadLauncher().launch(
    { entry },
    { signal: new AbortController().signal }
  )
  const channel = await createNodeThreadChannelFactory({ scheduler: systemScheduler }).open(
    handle,
    new AbortController().signal
  )
  let received!: (value: unknown) => void
  const message = new Promise<unknown>((resolve) => {
    received = resolve
  })
  const remove = channel.transport.subscribe((value) => received(value.data))
  const backing = new Uint8Array([9, 1, 2, 8]).buffer
  try {
    await channel.transport.send(backing, { transfer: [backing] })
    assert.equal(
      backing.byteLength,
      0,
      '[A86] the parent shim must pass the real original list to Worker.postMessage'
    )
    assert.deepEqual(await message, { bytes: [9, 1, 2, 8], length: 4 })
  } finally {
    remove()
    await channel.close()
    handle.terminate()
    await handle.exited
  }
})

it('[A86] EventTarget thread adaptation forwards transfer to the actual native postMessage boundary', async () => {
  const ports = new MessageChannel()
  const message = new Promise<unknown>((resolve) => ports.port2.once('message', resolve))
  const port = threadWebPort(ports.port1 as unknown as IThreadWebPort)
  const backing = new Uint8Array([1, 2]).buffer
  try {
    port.postMessage(backing, [backing])
    assert.equal(
      backing.byteLength,
      0,
      '[A86] EventTarget adaptation must not erase an explicit original transfer list'
    )
    const value = await message
    assert.ok(value instanceof ArrayBuffer)
    assert.deepEqual([...new Uint8Array(value)], [1, 2])
  } finally {
    ports.port1.close()
    ports.port2.close()
  }
})
