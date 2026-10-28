/** Original runtime-wire business vectors execute through genuine native Host namespaces. */
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { createRpcHost } from '@migaia/rpc-host'
import { batchFeature } from '@migaia/rpc-host/plugins/batch'
import { idempotencyFeature, type IRpcOutcomeLookup } from '@migaia/rpc-host/plugins/idempotency'
import limits from '@migaia/rpc-host/plugins/limits'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import {
  createRpcByteCarrier,
  defineTransportPlugin,
  RPC_STREAM_MAX_FRAME_BYTES,
  RpcEventByteIO,
  RpcJsonCarrierCodec
} from '@migaia/rpc-host/sdk'
import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'
import { it, vi } from 'vitest'
import { CallTable } from '../../dist/call/table.js'
import { ProviderAdmissionRegistry } from '../../dist/features/limits/provider-admission.js'
import { SessionTable } from '../../dist/session/table.js'
import { coreMemoryServer } from '../host/core-fixture.ts'

// The original 16MiB result and 500ms deadline remain exact.
/** Both capture and final encoding failures must seal the same genuine completed group exactly once. */
async function assertOversizedGroupResult(encoding: 'ascii' | 'unicode'): Promise<void> {
  /** Only this original provider changes the real execution count. */
  let effects = 0
  /** Real native streams lend the SDK its actual physical length-framing boundary. */
  const streams = { upstream: new PassThrough(), downstream: new PassThrough() }
  /** Real diagnostics remain visible without replacing or decoding the terminal. */
  const failures: unknown[] = []
  /** This listener supplies canonical native attach authority without a second RPC runtime. */
  const server = coreMemoryServer('child', 'child-1')
  /** The genuine provider installs its complete store before the real source can connect. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [idempotencyFeature(), server.transport],
    provide: {
      large: () => {
        effects++
        return encoding === 'ascii' ? 'x'.repeat(16 * 1024 * 1024) : '保'.repeat(6 * 1024 * 1024)
      }
    },
    report: (error) => failures.push(error)
  })
  /** Both actual stream owners close the same borrowed native endpoints idempotently. */
  const physical = {
    report: (error: unknown) => failures.push(error),
    closedError: () => new Error('runtime wire byte fixture closed'),
    close: () => {
      streams.upstream.destroy()
      streams.downstream.destroy()
    }
  }
  /** The provider's original byte carrier and codec retain the real frame byte ceiling. */
  const left = createRpcByteCarrier({
    id: 'runtime-wire-provider',
    io: new RpcEventByteIO(streams.upstream, streams.downstream, physical.close, physical).value,
    report: physical.report
  })
  /** The caller's independent codec/framer is the actual receiving media owner. */
  const right = createRpcByteCarrier({
    id: 'runtime-wire-caller',
    io: new RpcEventByteIO(streams.downstream, streams.upstream, physical.close, physical).value,
    report: physical.report
  })
  /** Both subscriptions begin before either genuine handshake completion is awaited. */
  const transport = defineTransportPlugin({
    name: 'runtime-wire-byte-caller',
    namespace: 'memory',
    open: async (context) => {
      /** These are the two original Session receipts, never synthetic readiness. */
      const accepted = server.accept(left)
      /** The caller's own native context acquires the opposite physical resource. */
      const connected = context.attach(right)
      await Promise.all([accepted.ready, connected.ready])
      return { dispose: physical.close }
    }
  })
  /** The public namespace originates the same keyed atomic group under a complete timeout. */
  const client = await createRpcHost({
    self: { name: 'parent', instanceId: 'parent-1' },
    plugins: [idempotencyFeature(), transport],
    report: physical.report
  })
  try {
    await assert.rejects(
      client.memory.group([{ method: 'large' }], {
        timeout: timeoutFeature({ ms: 500 }),
        idempotencyKey: 'large-result'
      }),
      { code: 'PAYLOAD_INVALID' },
      'exact terminal failure must arrive before the caller deadline'
    )
    assert.equal(effects, 1, 'executed business is never rolled back or retried')
    /** The real namespace extension queries the same originally sealed provider store. */
    const outcome = await client.memory.outcome('large-result', {
      timeout: timeoutFeature({ ms: 500 })
    })
    assert('state' in outcome)
    assert.equal(outcome.state, 'done')
    if (outcome.state !== 'done' || outcome.outcome.completion.ok)
      assert.fail('actual failed group completion must be retained')
    /** Changes only flat error representation; the original public code/stack remain exact. */
    const error = outcome.outcome.completion.error
    assert.equal(error.nodes[error.root]!.code, 'PAYLOAD_INVALID')
    assert.ok(error.nodes[error.root]!.stack)
  } finally {
    await Promise.all([client.close(), host.close()])
  }
}

it('oversized complete group result fails PAYLOAD_INVALID and seals that failure instead of hanging', () =>
  assertOversizedGroupResult('ascii'))

it('oversized Unicode group result fails at actual encoding and seals PAYLOAD_INVALID', () =>
  assertOversizedGroupResult('unicode'))

// Exact dispositions apply only to old local step shapes.
it.each(['options', 'target', 'mode', 'empty', 'getter', 'revoked'] as const)(
  'local group %s preserves current step admission before real physical send or provider effect',
  async (shape) => {
    /** This original provider count separates local refusal from actual successful business. */
    let calls = 0
    /** Only the original deliberately supplied getter can change this count. */
    let reads = 0
    /** The original public source establishes one authentic bilateral session. */
    const server = coreMemoryServer('child', 'child-1')
    /** No optional validation facade or alternate provider is installed. */
    const host = await createRpcHost({
      ...server.options,
      provide: {
        first: () => {
          calls++
          return 42
        }
      }
    })
    /** The same real caller namespace owns all six original local stimuli. */
    const client = await server.connect('parent', {}, 'parent-1')
    /** This pass-through spy observes the sole original physical writer after handshake. */
    const send = vi.spyOn(client.pair[1], 'write')
    /** The original revoked-array stimulus must never become successful business. */
    const revoked = Proxy.revocable([], {})
    revoked.revoke()
    /** Unknown metadata and accessor records are deliberately the original inputs, unchanged. */
    const steps =
      shape === 'empty'
        ? []
        : shape === 'revoked'
          ? revoked.proxy
          : shape === 'getter'
            ? [
                Object.defineProperty({}, 'method', {
                  enumerable: true,
                  get: () => {
                    reads++
                    return 'first'
                  }
                })
              ]
            : [{ method: 'first', [shape]: shape === 'options' ? {} : 'other' }]
    try {
      if (shape === 'empty' || shape === 'revoked') {
        await assert.rejects(async () => client.host.memory.group(steps as never), {
          code: 'INVALID_CONFIG'
        })
        assert.equal(send.mock.calls.length, 0)
        assert.equal(calls, 0)
        assert.equal(reads, 0)
      } else {
        /** Explicitly permits these four old step shapes; these are new-behavior assertions. */
        const result = await client.host.memory.group(steps as never)
        assert.deepEqual(result, [{ state: 'success', result: 42 }])
        assert.equal(send.mock.calls.length, 1)
        assert.equal(calls, 1)
        if (shape === 'getter') assert.ok(reads > 0)
        else assert.equal(reads, 0)
      }
    } finally {
      send.mockRestore()
      await Promise.all([client.host.close(), host.close()])
    }
  }
)

// Retires v1 response grammar; the complete-tuple oracle survives.
it('a mismatched response cannot settle a new task that requires the full authenticated generation tuple', async () => {
  /** The original provider holds only its actual business completion. */
  const blocked = deferred<void>()
  /** Real provider entry precedes every attempted shadow completion. */
  let started = false
  /** The real public provider announces the original child generation before any request. */
  const server = coreMemoryServer('child', 'child-1')
  /** No alternative dispatch or settlement path participates in this fixture. */
  const host = await createRpcHost({
    ...server.options,
    provide: {
      hold: async () => {
        started = true
        await blocked.promise
        return 42
      }
    }
  })
  /** Genuine handshake acceptance binds the original parent to this exact native connection. */
  const client = await server.connect('parent', {}, 'parent-1')
  /** The pass-through original settlement owner proves each actual shadow was processed. */
  const dispatch = vi.spyOn(CallTable.prototype, 'accept')
  /** Only successful settlement changes this original public observable. */
  let settled = false
  /** The real caller retains one true pending request while generation-only shadows arrive. */
  const running = client.host.memory
    .request('hold', undefined, { orderKey: 'same', timeout: false })
    .then((value) => {
      settled = true
      return value
    })
  void running.catch(() => undefined)
  try {
    await vi.waitFor(() => assert.equal(started, true))
    /** Identity media already retains the original semantic write; no observer decode occurs. */
    const envelope = client.pair[1].written.find(
      (frame) => frame.kind === 'call' && frame.task.method === 'hold'
    )
    assert(envelope?.kind === 'call')
    // This fixed two-field domain is the compile-time complete generation pair in IRpcTask.
    for (const field of ['callerGeneration', 'targetGeneration'] as const) {
      /** Only this generation value differs; id, method, caller and actual source stay original. */
      const shadow: IRpcEnvelope = {
        profile: envelope.profile,
        kind: 'result',
        id: envelope.id,
        task: {
          ...envelope.task,
          [field]: { ...envelope.task[field], value: envelope.task[field].value + 1 }
        },
        route: {
          applicationVersion: '1.0',
          senderId: 'child-1',
          targetId: 'parent-1',
          receiverId: 'parent-1',
          sentAt: 0
        },
        result: 'legacy-poison'
      }
      await client.pair[0].write({ kind: 'message', data: shadow })
      await vi.waitFor(() => assert.ok(dispatch.mock.calls.some(([, frame]) => frame === shadow)))
      /** This is the authentic owner's returned refusal, not a test's simulated correlation rule. */
      const index = dispatch.mock.calls.findIndex(([, frame]) => frame === shadow)
      assert.equal(dispatch.mock.results[index]!.value, false)
      assert.equal(
        settled,
        false,
        'authenticated method/id matching lacks the required generation association'
      )
    }
    blocked.resolve()
    assert.equal(await running, 42)
  } finally {
    blocked.resolve()
    await Promise.all([client.host.close(), host.close()])
    await running.catch(() => undefined)
    dispatch.mockRestore()
  }
})

// Physical notification completion and actual store lifetime differ.
it('notify send completion precedes business completion while its before-start receipt and keyed outcome stay live', async () => {
  /** The original provider alone controls its real terminal boundary. */
  const blocked = deferred<void>()
  /** The genuine provider context lends this actual cancellation signal. */
  let signal: IAbortSignal | undefined
  /** Both original report channels contribute to the same unchanged zero-failures oracle. */
  const failures: unknown[] = []
  /** The provider's canonical listener remains the sole native attach owner. */
  const server = coreMemoryServer('child', 'child-1')
  /** Only the complete optional idempotency owner implements claim and outcome behavior. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [idempotencyFeature(), server.transport],
    provide: {
      hold: async (_payload, context) => {
        signal = context.signal
        await blocked.promise
        return 42
      }
    },
    report: (error) => failures.push(error)
  })
  /** The caller installs the same native outcome extension, without a Peer compatibility layer. */
  const client = await server.connect(
    'parent',
    { plugins: [idempotencyFeature()], report: (error) => failures.push(error) },
    'parent-1'
  )
  /** Before-start intent is supplied by the original ordinary AbortController. */
  const control = new AbortController()
  try {
    /** The dynamic test connection erases the cold extension type, not its actual implementation. */
    const lookup = Reflect.get(client.host.memory, 'outcome') as IRpcOutcomeLookup
    await client.host.memory.notify('hold', undefined, {
      orderKey: 'same',
      cancel: 'before-start',
      signal: control.signal,
      idempotencyKey: 'notify-key'
    })
    await vi.waitFor(() => assert.ok(signal))
    /** No query is allowed to execute or join the held notification. */
    const pending = await lookup('notify-key')
    assert('state' in pending)
    assert.equal(
      pending.state,
      'pending',
      'public notify Promise cannot pretend that business already finished'
    )
    control.abort(new Error('started notification intent'))
    assert.equal(signal!.aborted, false)
    blocked.resolve()
    await vi.waitFor(async () => {
      /** The genuine query reads the original store, not a fixture-side completion flag. */
      const outcome = await lookup('notify-key')
      assert('state' in outcome)
      assert.equal(outcome.state, 'done')
    })
    /** A fresh public read must still expose the same original successful completion. */
    const done = await lookup('notify-key')
    assert('state' in done)
    if (done.state !== 'done') assert.fail('actual notification completion must be retained')
    assert.equal(done.outcome.completion.ok, true)
    assert.equal(failures.length, 0)
  } finally {
    blocked.resolve()
    await Promise.all([client.host.close(), host.close()])
  }
})

// Refuse only the original physical writer after genuine admission.
it('before-start notify rejects a failed physical write after send admission instead of leaving its public Promise pending', async () => {
  /** No business may run after the original native writer refuses its first request. */
  let effects = 0
  /** This authentic source acquires the sole physical channel used below. */
  const server = coreMemoryServer('child', 'child-1')
  /** The public original provider is the only operation that can change effects. */
  const host = await createRpcHost({
    ...server.options,
    provide: {
      value: () => {
        effects++
        return 42
      }
    }
  })
  /** Actual handshakes complete before the one original native send fails. */
  const client = await server.connect('parent', {}, 'parent-1')
  /** The same original native reason must remain the public TRANSPORT cause. */
  const failure = new Error('fixture physical write rejected')
  /** A single original writer failure leaves all cleanup and other media calls genuine. */
  const send = vi.spyOn(client.pair[1], 'write').mockRejectedValueOnce(failure)
  /** The original public Promise is observed immediately, including the failure path. */
  const state: { settlement: 'pending' | 'resolved' | 'rejected'; rejection?: unknown } = {
    settlement: 'pending'
  }
  try {
    void client.host.memory.notify('value', undefined, { cancel: 'before-start' }).then(
      () => {
        state.settlement = 'resolved'
      },
      (error: unknown) => {
        state.settlement = 'rejected'
        state.rejection = error
      }
    )
    await vi.waitFor(() =>
      assert.equal(
        state.settlement,
        'rejected',
        'failed physical completion rejects the original send Promise'
      )
    )
    assert.equal(Reflect.get(state.rejection as object, 'code'), 'TRANSPORT')
    assert.equal(Reflect.get(state.rejection as object, 'cause'), failure)
    assert.equal(effects, 0)
  } finally {
    send.mockRestore()
    await Promise.all([client.host.close(), host.close()])
  }
})

// Read actual ready before dispatch, never a descriptive fake Peer.
it('genuine bilateral describe binds each peer generation before business dispatch', async () => {
  /** Existing original attachment returns the true Session readiness receipt. */
  const attaching = vi.spyOn(SessionTable.prototype, 'attach')
  /** Only the current native listener accepts the public caller. */
  const server = coreMemoryServer('child', 'child-1')
  /** The announced provider remains the original value42 business method. */
  const host = await createRpcHost({ ...server.options, provide: { value: () => 42 } })
  /** Both real native attachments and handshake promises finish before this call returns. */
  const client = await server.connect('parent', {}, 'parent-1')
  try {
    /** Identify the actual caller attachment by its original physical resource, without an index. */
    const index = attaching.mock.calls.findIndex(([, carrier]) => carrier === client.pair[1])
    assert(index >= 0)
    /** The exact accepted view comes from the original method's unmodified returned handle. */
    const remote = await attaching.mock.results[index]!.value.ready
    assert.deepEqual(
      { ...remote.generation },
      { kind: 'session', value: 0, providerId: 'child-1' },
      'the accepted identity contains the actual first connection generation'
    )
    assert.equal(await client.host.memory.request('value'), 42)
  } finally {
    await Promise.all([client.host.close(), host.close()])
    attaching.mockRestore()
  }
})

// Original provider order, values, native error family and suffix stay.
it('a real namespace group executes through the original provider and returns fail-stop outcomes', async () => {
  /** Only original application entry records these ordered effects. */
  const effects: string[] = []
  /** The actual native listener publishes the same three original methods. */
  const server = coreMemoryServer('child', 'child-1')
  /** There is no group executor in this receiver; the genuine Host owns all fail-stop behavior. */
  const host = await createRpcHost({
    ...server.options,
    provide: {
      first: () => {
        effects.push('first')
        return 42
      },
      fail: () => {
        throw new RangeError('fixture group failure')
      },
      last: () => {
        effects.push('last')
        return 7
      }
    }
  })
  /** The public caller holds only the actual namespace's receiver-free callable. */
  const client = await server.connect('parent', {}, 'parent-1')
  try {
    /** Removes Peer placement; this is the same real Host group call mode. */
    const group = client.host.memory.group
    assert.equal(typeof group, 'function', 'the genuine namespace exposes group')
    /** Every original method and its original declared order remain unchanged. */
    const result = await group([{ method: 'first' }, { method: 'fail' }, { method: 'last' }])
    assert(Array.isArray(result))
    assert.deepEqual(
      result.map((step: { state: string }) => step.state),
      ['success', 'failure', 'not-executed']
    )
    assert.equal(result[0]!.state, 'success')
    assert.equal(result[1]!.state, 'failure')
    if (result[0]!.state === 'success') assert.equal(result[0]!.result, 42)
    if (result[1]!.state === 'failure') {
      /** Flat error graph keeps the exact native class and nonempty original stack. */
      const error = result[1]!.error
      assert.equal(error.nodes[error.root]!.name, 'RangeError')
      assert.ok(error.nodes[error.root]!.stack)
    }
    assert.deepEqual(effects, ['first'])
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

// The same optional quota owner releases real ordered task leases.
it('real ordered requests share provider leases; queued cancel wins and started cancel cannot abort business', async () => {
  /** Only the actual provider completion can release the original started business. */
  const blocked = deferred<void>()
  /** The three original application methods are the only writers of this ordered trace. */
  const effects: string[] = []
  /** The original provider context lends its real started operation signal. */
  let signal: IAbortSignal | undefined
  /** A pass-through spy observes the actual installed optional limits registry. */
  const admitting = vi.spyOn(ProviderAdmissionRegistry.prototype, 'acquireMany')
  /** Authentic bilateral source admission establishes the original generation and task domains. */
  const server = coreMemoryServer('child', 'child-1')
  /** The complete limits feature owns the original pending/running lease counts. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [limits(), server.transport],
    provide: {
      hold: async (_payload, context) => {
        effects.push('hold')
        signal = context.signal
        await blocked.promise
        return 42
      },
      queued: () => {
        effects.push('queued')
        return 7
      },
      other: () => {
        effects.push('other')
        return 9
      }
    }
  })
  /** The genuine public caller uses no middleware or Peer compatibility facade. */
  const client = await server.connect('parent', {}, 'parent-1')
  /** Original started and queued intents remain separate ordinary native controllers. */
  const firstControl = new AbortController()
  /** The queued intent must withdraw its own lease without invoking business. */
  const queuedControl = new AbortController()
  /** Observe all original operations even if a subsequent assertion fails. */
  const pending: Promise<unknown>[] = []
  try {
    /** Only the real Host executes and settles this first original same-key request. */
    const first = client.host.memory.request('hold', undefined, {
      orderKey: 'same',
      cancel: 'before-start',
      signal: firstControl.signal
    })
    pending.push(first.catch((error: unknown) => error))
    await vi.waitFor(() => assert.deepEqual(effects, ['hold']))
    /** The second original request shares the exact provider-side FIFO rather than a fixture queue. */
    const queued = client.host.memory.request('queued', undefined, {
      orderKey: 'same',
      cancel: 'before-start',
      signal: queuedControl.signal
    })
    /** Keep the original public cancellation code and the original rejection assertion observable. */
    const rejected = assert.rejects(queued, (error: unknown) => {
      assert.equal(Reflect.get(error as object, 'code'), 'CANCELLED')
      return true
    })
    pending.push(rejected.catch((error: unknown) => error))
    /** A different original key executes on this same real provider while the first remains held. */
    const other = client.host.memory.request('other', undefined, {
      orderKey: 'different',
      cancel: 'before-start'
    })
    pending.push(other.catch((error: unknown) => error))
    assert.equal(await other, 9)
    /** The original installed registry, not a fabricated scalar, supplies both pending leases. */
    const admission = admitting.mock.contexts.find(
      (owner): owner is ProviderAdmissionRegistry => owner instanceof ProviderAdmissionRegistry
    )
    assert(admission)
    await vi.waitFor(() => assert.equal(admission.size, 2))
    assert.deepEqual(effects, ['hold', 'other'], 'same key remains queued; another key executes')
    queuedControl.abort(new Error('queued fixture intent'))
    await rejected
    firstControl.abort(new Error('started fixture intent'))
    await vi.waitFor(() => assert.equal(admission.size, 1))
    assert.equal(signal!.aborted, false, 'the final original provider start defeats caller abort')
    blocked.resolve()
    assert.equal(await first, 42)
    await vi.waitFor(() => assert.equal(admission.size, 0))
    assert.deepEqual(effects, ['hold', 'other'])
  } finally {
    blocked.resolve()
    await Promise.all(pending)
    await Promise.all([client.host.close(), host.close()])
    admitting.mockRestore()
  }
})

// Only actual store queries prove unknown/pending/done without effects.
it('real outcome lookup observes the original pending claim and complete sealed group without executing business', async () => {
  /** The original provider hold alone controls its real keyed terminal. */
  const blocked = deferred<void>()
  /** Only genuine application entry can change the original business count. */
  let effects = 0
  /** This actual native listener supplies the original logical child provider address. */
  const server = coreMemoryServer('child', 'child-1')
  /** The genuine default memory store retains its original epoch and continuity facts. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [idempotencyFeature(), server.transport],
    provide: {
      hold: async () => {
        effects++
        await blocked.promise
        return 42
      }
    }
  })
  /** Outcome is the real installed namespace extension, not a locally generated store facade. */
  const client = await server.connect('parent', { plugins: [idempotencyFeature()] }, 'parent-1')
  /** Cleanup observes the one genuine operation even after an assertion failure. */
  const pending: Promise<unknown>[] = []
  try {
    assert.equal(
      typeof Reflect.get(client.host.memory, 'outcome'),
      'function',
      'the genuine namespace exposes the read-only query'
    )
    /** Cold dynamic connection typing alone erases this actual installed extension signature. */
    const lookup = Reflect.get(client.host.memory, 'outcome') as IRpcOutcomeLookup
    /** No earlier lookup or business invocation may manufacture this original missing key. */
    const unknown = await lookup('absent')
    assert('state' in unknown)
    assert.equal(unknown.state, 'unknown')
    assert.equal(unknown.store.kind, 'memory')
    assert.equal(unknown.store.continuity, 'retained')
    assert.ok(unknown.store.epoch)
    /** The original one-member group alone claims the key and reaches the actual hold provider. */
    const running = client.host.memory.group([{ method: 'hold' }], { idempotencyKey: 'key' })
    pending.push(running.catch((error: unknown) => error))
    await vi.waitFor(() => assert.equal(effects, 1))
    /** This read cannot execute or join the still-held original claim. */
    const current = await lookup('key')
    assert('state' in current)
    assert.equal(current.state, 'pending')
    assert.equal(effects, 1, 'querying an existing pending claim cannot execute or join business')
    blocked.resolve()
    await running
    /** The public query must read the original complete group and the same actual memory epoch. */
    const done = await lookup('key')
    assert('state' in done)
    assert.equal(done.state, 'done')
    assert.equal(done.store.kind, 'memory')
    assert.equal(done.store.epoch, unknown.store.epoch)
    if (done.state !== 'done') assert.fail('actual group completion must be retained')
    assert.equal(done.outcome.completion.ok, true)
    if (!done.outcome.completion.ok) assert.fail('actual group completion must succeed')
    assert.ok(Array.isArray(done.outcome.completion.result))
    /** Only the exact current group-list refinement is needed after the original array assertion. */
    const result = done.outcome.completion.result as readonly { state: string; result?: unknown }[]
    assert.deepEqual(
      result.map((step) => step.state),
      ['success']
    )
    assert.equal(Reflect.get(result[0]!, 'result'), 42)
    assert.equal(done.outcome.targetGeneration.providerId, 'child-1')
    assert.equal(effects, 1)
  } finally {
    blocked.resolve()
    await Promise.all(pending)
    await Promise.all([client.host.close(), host.close()])
  }
})

// Only the removed private512selector changes to the real media ceiling.
it('rejects an ordinary oversized byte frame during capture with its original RangeError and sends its survivor', async () => {
  /** The provider alone proves which original ordinary requests actually reached business. */
  const calls: string[] = []
  /** Reuse the original runtime-wire pair of native streams, not a second frame queue. */
  const streams = { upstream: new PassThrough(), downstream: new PassThrough() }
  /** The same real public listener owns provider Session attachment and accepted identity. */
  const server = coreMemoryServer('ordinary-oversize-provider')
  /** Only optional physical Batch is needed; no chunk transformation changes the oversize input. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [batchFeature(), server.transport],
    provide: {
      echo: (value: string) => {
        calls.push(value)
        return value
      }
    }
  })
  /** Both byte owners share only original native physical cleanup, as in the existing wire case. */
  const physical = {
    report: () => undefined,
    closedError: () => new Error('ordinary oversize byte fixture closed'),
    close: () => {
      streams.upstream.destroy()
      streams.downstream.destroy()
    }
  }
  /** The unmodified SDK codec and byte framer admit and write the actual provider traffic. */
  const left = createRpcByteCarrier({
    id: 'ordinary-oversize-provider-carrier',
    io: new RpcEventByteIO(streams.upstream, streams.downstream, physical.close, physical).value,
    codec: new RpcJsonCarrierCodec(),
    report: physical.report
  })
  /** Lets this original codec reject its real JSON byte size before physical framing. */
  const right = createRpcByteCarrier({
    id: 'ordinary-oversize-caller-carrier',
    io: new RpcEventByteIO(streams.downstream, streams.upstream, physical.close, physical).value,
    codec: new RpcJsonCarrierCodec(),
    report: physical.report
  })
  /** The genuine native install subscribes both original carriers before waiting for readiness. */
  const transport = defineTransportPlugin({
    name: 'ordinary-oversize-byte-caller',
    namespace: 'memory',
    open: async (context) => {
      /** The existing provider listener owns the accepted physical Session handle. */
      const accepted = server.accept(left)
      /** The caller install owns the opposite original attachment and its readiness receipt. */
      const connected = context.attach(right)
      await Promise.all([accepted.ready, connected.ready])
      return { dispose: physical.close }
    }
  })
  /** All three logical operations use this same real public namespace and native Batch lane. */
  const client = await createRpcHost({
    self: { name: 'ordinary-oversize-caller', instanceId: 'ordinary-oversize-caller' },
    plugins: [batchFeature(), transport],
    report: physical.report
  })
  /** The original capture rejection stays observable without executing another encoding path. */
  const preparing = vi.spyOn(right.codec, 'prepare')
  /** Default spies retain actual once-only codec, carrier and native stream results unchanged. */
  const encoded = vi.spyOn(right.codec, 'encode')
  /** Carrier attempts contain only the two valid frames after earlier capture admission. */
  const sending = vi.spyOn(right, 'write')
  /** This native PassThrough is the original actual byte writer, not a synthesized physical sink. */
  const writing = vi.spyOn(streams.upstream, 'write')
  /** Caller rejections are observed immediately and joined even if a later assertion fails. */
  const pending: Promise<unknown>[] = []
  try {
    /** Native Writable corking holds its own callback and bytes; no fixture queue is introduced. */
    streams.upstream.cork()
    /** The first actual small request enters that held native writer before the queued inputs. */
    const first = client.memory
      .send('ordinary-oversize-provider', 'echo', 'first')
      .catch((error: unknown) => error)
    pending.push(first)
    await vi.waitFor(() => assert.equal(writing.mock.calls.length, 1))
    /** Ordinary valid ASCII exceeds the fixed native16MiB ceiling without artificial expansion. */
    const oversized = client.memory
      .send('ordinary-oversize-provider', 'echo', 'x'.repeat(RPC_STREAM_MAX_FRAME_BYTES + 1))
      .catch((error: unknown) => error)
    pending.push(oversized)
    /** The actual second preparation rejects this ordinary input before encoding or the writer. */
    await vi.waitFor(() => assert.equal(preparing.mock.calls.length, 2))
    assert.equal(encoded.mock.calls.length, 1)
    /** One smaller ordinary call follows the oversized member in the same real source lane. */
    const survivor = client.memory
      .send('ordinary-oversize-provider', 'echo', 'survivor')
      .catch((error: unknown) => error)
    pending.push(survivor)
    await vi.waitFor(() => assert.equal(encoded.mock.calls.length, 2))
    assert.equal(writing.mock.calls.length, 1)
    assert.deepEqual(calls, [])
    /** Releasing the original native callback drains the first request and its surviving sibling. */
    streams.upstream.uncork()
    /** Preserves the capture RangeError itself without manufacturing an IO wrapper. */
    const failure = await oversized
    assert.ok(failure instanceof RangeError)
    assert.equal(Reflect.get(failure, 'code'), RpcContractErrorCode.frameLimitExceeded)
    /** Borrow the already-rejected original prepare Promise; no second capture execution occurs. */
    const captureFailure = await Promise.resolve(preparing.mock.results[1]!.value).catch(
      (error: unknown) => error
    )
    assert.equal(failure, captureFailure)
    assert.equal(await first, 'first')
    assert.equal(await survivor, 'survivor')
    assert.deepEqual(calls, ['first', 'survivor'])
    assert.equal(writing.mock.calls.length, 2, 'oversized ordinary frame never reaches native IO')
    assert.equal(
      sending.mock.calls.length,
      2,
      'only the two valid frames reach the physical carrier'
    )
  } finally {
    streams.upstream.uncork()
    preparing.mockRestore()
    encoded.mockRestore()
    sending.mockRestore()
    writing.mockRestore()
    await Promise.all([client.close(), host.close()])
    await Promise.all(pending)
  }
})
