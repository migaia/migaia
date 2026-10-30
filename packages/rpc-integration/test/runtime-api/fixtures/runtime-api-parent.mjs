import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
import assert from 'node:assert/strict'
import process from 'node:process'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { createRpcHost } from '@migaia/rpc-host'
import { isRpcErrorInstance, RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-host/contract'
import { idempotencyFeature } from '@migaia/rpc-host/plugins/idempotency'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

/** Every receipt is emitted by the actual selected runtime, never by a Node stand-in. */
const runtime = typeof Deno !== 'undefined' ? Deno.args[0] : process.argv[2]
/** Process and Worker use their public transport plugins in the actual runtime. */
const mode = typeof Deno !== 'undefined' ? Deno.args[1] : process.argv[3]
/** The parent host; only a successfully constructed host is closed. */
let host
/** Expected business refusal remains classified separately from transport or cleanup failures. */
const reports = []
try {
  /** The child transport selected by mode; the child runs the shared business providers. */
  const child =
    mode === 'thread'
      ? threadPlugin({
          name: 'fixture-child',
          spawn: { entry: new URL('./runtime-api-worker.mjs', import.meta.url) }
        })
      : processPlugin({
          name: 'fixture-child',
          spawn: { entry: new URL('./runtime-api-process.mjs', import.meta.url) }
        })
  host = await createRpcHost({
    self: { name: 'parent-2', instanceId: 'parent-2' },
    plugins: [rpcFeaturesPlugin({ features: { idempotency: idempotencyFeature() } }), child],
    report: (error) =>
      reports.push({
        source: error?.source,
        code: error?.code,
        name: error?.name,
        message: String(error?.message ?? '').slice(0, 160)
      })
  })
  /** The namespace of the one child; untargeted calls select it as the sole direct peer. */
  const ns = mode === 'thread' ? host.thread : host.process
  /** Initial evidence is an asserted real business result, not merely a successful handshake. */
  const group = await Promise.resolve()
    .then(() =>
      ns.group([{ method: 'value' }, { method: 'fail' }, { method: 'value' }], {
        orderKey: 'group'
      })
    )
    .catch((error) => ({ rejected: error.code }))
  assert.deepEqual(
    Array.isArray(group) ? group.map((step) => step.state) : group,
    ['success', 'failure', 'not-executed'],
    'actual native group must execute once with complete fail-stop report'
  )
  assert.equal(await ns.request('count'), 1)
  assert.equal(
    await ns.request('value', undefined, { orderKey: 'key', idempotencyKey: 'sealed' }),
    2
  )
  assert.equal(
    await ns.request('value', undefined, { orderKey: 'key', idempotencyKey: 'sealed' }),
    2
  )
  assert.equal((await ns.outcome('sealed')).state, 'done')
  const holding = ns.request('hold', undefined, {
    orderKey: 'same',
    cancel: 'before-start',
    idempotencyKey: 'holding'
  })
  /** Read-only lookup observes the actual provider start; no caller in-flight count substitutes it. */
  for (let attempt = 0; (await ns.outcome('holding')).state !== 'pending'; attempt++) {
    assert.ok(attempt < 100)
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  const controller = new AbortController()
  const cancelled = ns
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
  for (let attempt = 0; (await ns.outcome('cancelled')).state !== 'pending'; attempt++) {
    assert.ok(attempt < 100)
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  controller.abort()
  assert.deepEqual(await cancelled, { code: 'CANCELLED' })
  assert.equal(await ns.request('release'), 7)
  assert.equal(await holding, 42)
  assert.equal(
    await ns.request('count'),
    3,
    'native queued cancellation has zero business execution'
  )
  await ns.notify('value', undefined, {
    orderKey: 'notify',
    cancel: 'before-start',
    idempotencyKey: 'notified'
  })
  for (let attempt = 0; (await ns.outcome('notified')).state !== 'done'; attempt++) {
    assert.ok(attempt < 100)
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  const streamController = new AbortController()
  const stream = ns.stream('values', undefined, {
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
    'native provider context contains both admitted generations'
  )
  streamController.abort()
  const returned = await stream.return()
  assert.equal(returned.done, true)
  assert.deepEqual({ ...returned.value }, { final: 99, aborted: false })
  const final = await ns.outcome('streamed')
  assert.equal(final.state, 'done')
  assert.equal(final.outcome.completion.ok, true)
  assert.deepEqual({ ...final.outcome.completion.result }, { final: 99, aborted: false })
  /** Default Worker clone and process inline both leave the caller's original backing usable. */
  const backing = new Uint8Array([9, 1, 2, 8]).buffer
  const copied = await ns.request('echo', {
    backing,
    first: new Uint8Array(backing, 1, 2),
    second: new Uint8Array(backing, 2, 1)
  })
  assert.equal(backing.byteLength, 4)
  assert.ok(copied.backing instanceof ArrayBuffer)
  assert.ok(copied.first instanceof Uint8Array)
  if (mode === 'thread') {
    /** Negotiated native clone retains aliases and the complete original backing across the Worker. */
    assert.equal(copied.first.buffer, copied.second.buffer)
    assert.equal(copied.first.buffer, copied.backing)
    assert.deepEqual([...new Uint8Array(copied.first.buffer)], [9, 1, 2, 8])
  } else {
    /** Process inline views retain independent backings and mask bytes outside each visible view. */
    assert.notEqual(copied.first.buffer, copied.second.buffer)
    assert.equal(new Uint8Array(copied.first.buffer)[0], 0)
    assert.equal(new Uint8Array(copied.second.buffer)[0], 0)
  }
  assert.deepEqual([...copied.first], [1, 2])
  assert.deepEqual([...copied.second], [2])
  assert.equal(copied.first.byteOffset, 1)
  assert.deepEqual([...new Uint8Array(copied.backing)], [9, 1, 2, 8])
  assert.deepEqual([...new Uint8Array(backing)], [9, 1, 2, 8])
  const beforeTransfer = await ns.request('binaryCount')
  await assert.rejects(
    async () => ns.request('echo', backing, { transfer: [backing] }),
    (error) => {
      assert.ok(error instanceof Error)
      assert.equal(isRpcErrorInstance(error), true)
      assert.equal(error.source, RPC_CORE_ERROR_SOURCE)
      // Process carriers reject any transfer list as configuration; Workers lack the native capability.
      assert.equal(
        error.code,
        mode === 'process' ? RpcCoreErrorCode.invalidConfig : RpcCoreErrorCode.capabilityUnsupported
      )
      return true
    },
    'default native carrier preserves its own transfer rejection'
  )
  assert.equal(backing.byteLength, 4)
  assert.equal(
    await ns.request('binaryCount'),
    beforeTransfer,
    'rejected transfer reaches no business'
  )
  /** Both supported cancellation controls keep started native business and its same-key lease alive. */
  for (const control of ['signal', 'deadline']) {
    const startedController = new AbortController()
    const pending = ns
      .request('holdOrdinary', undefined, {
        orderKey: 'ordinary-held',
        ...(control === 'signal' ? { signal: startedController.signal } : { timeout: { ms: 100 } })
      })
      .catch((error) => error)
    for (let attempt = 0; !(await ns.request('ordinaryState')).started; attempt++) {
      assert.ok(attempt < 100)
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    if (control === 'signal') startedController.abort(new Error('native-started-abort'))
    const failure = await pending
    assert.equal(failure.code, control === 'signal' ? 'CANCELLED' : 'DEADLINE_EXCEEDED')
    for (let attempt = 0; !(await ns.request('ordinaryState')).aborted; attempt++) {
      assert.ok(attempt < 100)
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    const before = (await ns.request('ordinaryState')).followed
    let completed = false
    const follower = ns
      .request('follower', undefined, { orderKey: 'ordinary-held' })
      .then((value) => {
        completed = true
        return value
      })
    await ns.request('ordinaryState', undefined, { orderKey: 'other-key' })
    assert.equal(completed, false, 'cancelled native handler retains its started lease')
    assert.equal((await ns.request('ordinaryState')).followed, before)
    await ns.request('ordinaryRelease', undefined, { orderKey: 'release-key' })
    assert.equal(await follower, before + 1)
  }
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
        'context-generation',
        'portable-binary-copy',
        'default-transfer-refusal',
        'started-signal-lease',
        'started-deadline-lease'
      ],
      effects: await ns.request('count'),
      reports
    })
  )
} finally {
  await host?.close()
}
if (runtime === 'deno') Deno.exit(0)
else process.exit(0)
