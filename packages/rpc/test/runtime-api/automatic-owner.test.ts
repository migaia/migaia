import assert from 'node:assert/strict'
import { MessageChannel } from 'node:worker_threads'
import { it } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createAutomaticWebThreadPeer } from '../../src/threads/automatic-peer.js'
import { createWebThreadChannel } from '../../src/threads/channel.js'
import {
  createThreadRuntimeBootstrap,
  readThreadRuntimeAcknowledgement
} from '../../src/threads/bootstrap.js'
import { createWebThreadBootstrapHandoff } from '../../src/threads/receive-handoff.js'
import { ThreadBootstrap } from '../../src/threads/constants.js'
import { createRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import { createAutomaticProcessPeer } from '../../src/process/automatic-peer.js'
import type { IThreadWebPort } from '../../src/threads/types.js'
import { PROCESS_RUNTIME_API_ENV_VERSION } from '../../src/process/constants.js'

it('[A2][A3][A17] automatic EventTarget handoff preserves real business and original parent identity', async () => {
  /**
   * Native ports deliver the bootstrap and all later business frames through real EventTarget
   * callbacks.
   */
  const ports = new MessageChannel()
  const failures: unknown[] = []
  const child = createAutomaticWebThreadPeer(
    { provide: { double: (value: number) => value * 2 }, report: (error) => failures.push(error) },
    ports.port2 as unknown as IThreadWebPort
  )
  const parent = await createRuntimePeer({
    self: { name: 'automatic-parent', instanceId: 'automatic-parent-instance' },
    connect: async (context) => {
      const bootstrap = createThreadRuntimeBootstrap(
        'automatic-child',
        'automatic-child-instance',
        {
          ...context,
          capabilities: context.capabilities
        }
      )
      /** Parent preparation waits for the genuine child's accepted offer before activating receive. */
      let acknowledge!: () => void
      const acknowledged = new Promise<void>((resolve) => {
        acknowledge = resolve
      })
      /** The original parent capture consumes only the private acknowledgement before dispatch. */
      const handoff = createWebThreadBootstrapHandoff(ports.port1 as unknown as IThreadWebPort, {
        consume: (message) => {
          if (Reflect.get(message as object, 'kind') !== ThreadBootstrap.runtimeAcknowledged)
            return false
          readThreadRuntimeAcknowledgement(message)
          acknowledge()
          return true
        }
      })
      ports.port1.postMessage({
        kind: ThreadBootstrap.data,
        peerId: bootstrap.self.instanceId,
        runtimeApi: bootstrap
      })
      await acknowledged
      return createWebThreadChannel(
        handoff.port,
        bootstrap.self.instanceId,
        {
          scheduler: systemScheduler,
          capabilities: context.capabilities
        },
        handoff
      )
    },
    report: (error) => failures.push(error)
  })
  const accepted = await child
  try {
    assert.equal(await parent.request('double', 21), 42)
    assert.equal(accepted.self.name, 'automatic-child')
    assert.equal(accepted.self.instanceId, 'automatic-child-instance')
    assert.equal(failures.length, 0)
    const closing = accepted.close()
    assert.equal(accepted.close(), closing)
    await closing
  } finally {
    await parent.close()
    await accepted.close()
    ports.port1.close()
    ports.port2.close()
  }
})

it('[A1][A3] automatic Web source rejects explicit sources and malformed bootstrap without publication', async () => {
  const ports = new MessageChannel()
  let calls = 0
  try {
    await assert.rejects(
      createAutomaticWebThreadPeer(
        {
          connect: async () => {
            calls++
            throw new Error('source must not execute')
          },
          report: () => undefined
        },
        ports.port2 as unknown as IThreadWebPort
      ),
      { code: 'INVALID_CONFIG' }
    )
    assert.equal(calls, 0)
    const rejected = createAutomaticWebThreadPeer(
      { report: () => undefined },
      ports.port2 as unknown as IThreadWebPort
    )
    const observed = assert.rejects(rejected, { code: 'INVALID_CONFIG' })
    ports.port1.postMessage({ kind: ThreadBootstrap.data, peerId: 'child', runtimeApi: null })
    await observed
  } finally {
    ports.port1.close()
    ports.port2.close()
  }
})

it('[A1][A3] automatic process failure closes its original channel and reports cleanup once', async () => {
  let opens = 0
  let closes = 0
  const cleanup = new RangeError('automatic-process cleanup fixture')
  const reported: unknown[] = []
  /** Marker and explicit-source rejection happen before the one process reader is claimed. */
  const platform = {
    marker: 'unsupported',
    runtime: 'node',
    open: async () => {
      opens++
      return {
        channel: {
          kind: 'byte' as const,
          write: async () => undefined,
          onData: () => () => undefined,
          onClose: () => () => undefined,
          close: async () => {
            closes++
            throw cleanup
          }
        }
      }
    }
  }
  await assert.rejects(
    createAutomaticProcessPeer({ report: (error) => reported.push(error) }, platform),
    { code: 'INVALID_CONFIG' }
  )
  assert.equal(opens, 0)
  await assert.rejects(
    createAutomaticProcessPeer(
      { report: (error) => reported.push(error) },
      { ...platform, marker: PROCESS_RUNTIME_API_ENV_VERSION }
    ),
    { code: 'INVALID_CONFIG' }
  )
  assert.equal(opens, 1)
  assert.equal(closes, 1)
  assert.deepEqual(reported, [cleanup])
  await assert.rejects(
    createAutomaticProcessPeer(
      { report: () => undefined },
      { ...platform, marker: PROCESS_RUNTIME_API_ENV_VERSION }
    ),
    { code: 'INVALID_CONFIG' }
  )
  assert.equal(opens, 1, '[A3] failed bootstrap never permits a second process reader')
})
