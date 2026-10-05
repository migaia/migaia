import assert from 'node:assert/strict'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createProcessPeer,
  createProcessTransport,
  createNativeProcessOffer
} from '../../../dist/process/index.js'
import { createThreadPeer } from '../../../dist/threads/index.js'
import { createNodeProcessLauncher } from '../../../dist/process/adapters/node-child-process.js'
import { createBunProcessLauncher } from '../../../dist/process/adapters/bun-spawn.js'
import { createDenoProcessLauncher } from '../../../dist/process/adapters/deno-command.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../../dist/threads/adapters/node.js'
import {
  createBunThreadLauncher,
  createBunThreadChannelFactory
} from '../../../dist/threads/adapters/bun.js'
import {
  createDenoThreadLauncher,
  createDenoThreadChannelFactory
} from '../../../dist/threads/adapters/deno.js'

/** Every receipt is emitted by the actual selected runtime, never by a Node stand-in. */
const runtime = process.argv[2]
/** Process and Worker use their original independent native carrier owners. */
const mode = process.argv[3]
/** The test owns its native handle separately from the borrowed callable Peer. */
let handle
let peer
const token = 'u25-native-fixture-token'
/** Expected business refusal remains classified separately from transport or cleanup failures. */
const reports = []
try {
  peer = await (mode === 'process' ? createProcessPeer : createThreadPeer)({
    self: { name: 'u25-parent', instanceId: 'u25-parent' },
    spawn: async (context) => {
      if (mode === 'thread') {
        const launcher = (
          runtime === 'node'
            ? createNodeThreadLauncher
            : runtime === 'bun'
              ? createBunThreadLauncher
              : createDenoThreadLauncher
        )({ runtimeApi: context, report: () => undefined })
        const entry = new URL('./runtime-u25-worker.mjs', import.meta.url)
        handle = await launcher.launch(
          { entry: runtime === 'node' ? fileURLToPath(entry) : entry.href, name: 'u25-child' },
          { signal: new AbortController().signal }
        )
        return (
          runtime === 'node'
            ? createNodeThreadChannelFactory
            : runtime === 'bun'
              ? createBunThreadChannelFactory
              : createDenoThreadChannelFactory
        )({ scheduler: systemScheduler }).open(handle, new AbortController().signal)
      }
      const launcher = (
        runtime === 'node'
          ? createNodeProcessLauncher
          : runtime === 'bun'
            ? createBunProcessLauncher
            : createDenoProcessLauncher
      )({ runtimeApiBootstrap: { name: 'u25-child', parentInstanceId: context.self.instanceId } })
      const entry = fileURLToPath(new URL('./runtime-u25-process.mjs', import.meta.url))
      handle = await launcher.launch(
        {
          command: process.execPath,
          args: runtime === 'deno' ? ['run', '-A', entry] : [entry],
          env: { inherit: ['PATH'], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
          bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
        },
        { signal: new AbortController().signal, output: () => undefined }
      )
      return createProcessTransport(handle.channel, {
        role: 'initiator',
        peerId: handle.runtimeApiIdentity.instanceId,
        offer: createNativeProcessOffer({
          peer: { id: context.self.instanceId, runtime },
          auth: token,
          capabilities: context.capabilities
        }),
        ipc: { connectionId: 'u25-native', sessionId: 'u25-native', log: () => undefined },
        report: () => undefined
      })
    },
    report: (error) =>
      reports.push({
        source: error?.source,
        code: error?.code,
        name: error?.name,
        message: String(error?.message ?? '').slice(0, 160)
      })
  })
  /** Initial evidence is an asserted real business result, not merely a successful handshake. */
  const group = await Promise.resolve()
    .then(() =>
      peer.group([{ method: 'value' }, { method: 'fail' }, { method: 'value' }], {
        orderKey: 'group'
      })
    )
    .catch((error) => ({ rejected: error.code }))
  assert.deepEqual(
    Array.isArray(group) ? group.map((step) => step.state) : group,
    ['success', 'failure', 'not-executed'],
    '[A65][A74] actual native group must execute once with complete fail-stop report'
  )
  assert.equal(await peer.request('count'), 1)
  assert.equal(
    await peer.request('value', undefined, { orderKey: 'key', idempotencyKey: 'sealed' }),
    2
  )
  assert.equal(
    await peer.request('value', undefined, { orderKey: 'key', idempotencyKey: 'sealed' }),
    2
  )
  assert.equal((await peer.outcome('sealed')).state, 'done')
  const holding = peer.request('hold', undefined, {
    orderKey: 'same',
    cancel: 'before-start',
    idempotencyKey: 'holding'
  })
  /** Read-only lookup observes the actual provider start; no caller in-flight count substitutes it. */
  for (let attempt = 0; (await peer.outcome('holding')).state !== 'pending'; attempt++) {
    assert.ok(attempt < 100)
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  const controller = new AbortController()
  const cancelled = peer
    .request('value', undefined, {
      orderKey: 'same',
      cancel: 'before-start',
      signal: controller.signal,
      idempotencyKey: 'cancelled'
    })
    .then(
      (value) => ({ value }),
      (error) => ({ code: error.code })
    )
  for (let attempt = 0; (await peer.outcome('cancelled')).state !== 'pending'; attempt++) {
    assert.ok(attempt < 100)
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  controller.abort()
  assert.deepEqual(await cancelled, { code: 'CANCELLED' })
  assert.equal(await peer.request('release'), 7)
  assert.equal(await holding, 42)
  assert.equal(
    await peer.request('count'),
    3,
    '[A66] native queued cancellation has zero business execution'
  )
  await peer.notify('value', undefined, {
    orderKey: 'notify',
    cancel: 'before-start',
    idempotencyKey: 'notified'
  })
  for (let attempt = 0; (await peer.outcome('notified')).state !== 'done'; attempt++) {
    assert.ok(attempt < 100)
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  const streamController = new AbortController()
  const stream = peer.stream('values', undefined, {
    orderKey: 'stream',
    cancel: 'before-start',
    signal: streamController.signal,
    idempotencyKey: 'streamed'
  })
  const first = await stream.next()
  assert.equal(first.done, false)
  assert.equal(first.value.value, 1)
  assert.ok(
    first.value.caller && first.value.target,
    '[A71] native provider context contains both admitted generations'
  )
  streamController.abort()
  const returned = await stream.return()
  assert.equal(returned.done, true)
  assert.deepEqual({ ...returned.value }, { final: 99, aborted: false })
  const final = await peer.outcome('streamed')
  assert.equal(final.state, 'done')
  assert.equal(final.outcome.completion.ok, true)
  assert.deepEqual({ ...final.outcome.completion.result }, { final: 99, aborted: false })
  console.log(
    JSON.stringify({
      runtime,
      mode,
      cases: [
        'group-fail-stop',
        'key-replay',
        'outcome',
        'ordered-queued-cancel',
        'notify-terminal',
        'stream-discard',
        'context-generation'
      ],
      effects: await peer.request('count'),
      reports
    })
  )
} finally {
  try {
    await peer?.close()
  } finally {
    handle?.terminate(mode === 'process' ? 'force' : undefined)
    if (mode === 'process' || runtime === 'node') await handle?.exited
  }
}
if (runtime === 'deno') Deno.exit(0)
else process.exit(0)
