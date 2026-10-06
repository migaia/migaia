import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { connected } from './fixture.js'
import { RUNTIME_API_CAPABILITIES } from '../../src/remote/runtime-api/constants.js'
import { readRuntimePeerConnection } from '../../src/remote/runtime-api/peer.js'
import { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'

/**
 * Both source offers explicitly request the normative profile, independently of unfinished
 * defaults.
 */
const capabilities = [...RUNTIME_API_CAPABILITIES, 'portable-binary@1']

for (const cancellation of ['signal', 'deadline'] as const) {
  it(`[A84][A66][A68] ${cancellation} during binary fingerprint seals cancellation before its terminal`, async () => {
    /** Any business entry would contradict the original before-start cancellation winner. */
    let calls = 0
    const fixture = await connected({}, { echo: () => ++calls }, capabilities, capabilities)
    /**
     * The real digest executes first; this gate only selects the supported async preparation
     * window.
     */
    const subtle = globalThis.crypto.subtle
    const digest = subtle.digest
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let preparing!: () => void
    const reached = new Promise<void>((resolve) => {
      preparing = resolve
    })
    const hash = vi.spyOn(subtle, 'digest').mockImplementation(async (...args) => {
      const result = await Reflect.apply(digest, subtle, args)
      preparing()
      await held
      return result
    })
    /** Observe actual native abort calls; the spy delegates the original implementation unchanged. */
    const aborted = vi.spyOn(AbortController.prototype, 'abort')
    const controller = new AbortController()
    const reason = new Error('binary-fingerprint-before-start-fixture')
    const key = `binary-fingerprint-${cancellation}`
    const call = fixture.peers[0]
      .request('echo', new Uint8Array([1]).buffer, {
        cancel: 'before-start',
        idempotencyKey: key,
        signal: controller.signal,
        ...(cancellation === 'deadline' ? { timeoutMs: 20 } : {})
      })
      .catch((error: unknown) => error)
    try {
      await reached
      assert.equal(
        (await fixture.peers[0].outcome(key)).state,
        'unknown',
        '[A68] pre-claim preparation is not pending'
      )
      if (cancellation === 'signal') controller.abort(reason)
      await vi.waitFor(() =>
        assert.ok(
          aborted.mock.calls.some(([value]) =>
            cancellation === 'deadline'
              ? (value as { code?: string } | undefined)?.code === RpcCoreErrorCode.deadlineExceeded
              : (value as { code?: string } | undefined)?.code === RpcCoreErrorCode.cancelled
          )
        )
      )
      /** A real read roundtrip follows the cancel intent while hashing remains held. */
      await fixture.peers[0].outcome(key)
      release()
      const failure = await call
      assert.equal(
        (failure as { code?: string }).code,
        cancellation === 'deadline' ? RpcCoreErrorCode.deadlineExceeded : RpcCoreErrorCode.cancelled
      )
      assert.equal(calls, 0)
      /** Receipt of the final terminal is the barrier: its original store must already be sealed. */
      const outcome = await fixture.peers[0].outcome(key)
      assert.equal(
        outcome.state,
        'done',
        '[A68] a completed cancellation cannot remain permanently unknown'
      )
      if (outcome.state === 'done') {
        assert.equal(outcome.outcome.completion.ok, false)
        if (!outcome.outcome.completion.ok)
          assert.equal(outcome.outcome.completion.error.code, (failure as { code?: string }).code)
      }
    } finally {
      release()
      await call
      aborted.mockRestore()
      hash.mockRestore()
      await fixture.close()
    }
  })
}

it.each(['buffer', 'uint8array'] as const)(
  '[A84] inline %s preserves its real bytes and Uint8Array view boundary',
  async (kind) => {
    /** Inline view restoration must not disclose prefix or suffix bytes from the caller's backing. */
    const backing = new Uint8Array([9, 8, 7, 6]).buffer
    /** The real business value enters canonical normalization, codec, receiver and provider. */
    const input = kind === 'buffer' ? backing : new Uint8Array(backing, 1, 2)
    const fixture = await connected(
      {},
      { echo: (value: unknown) => value },
      capabilities,
      capabilities
    )
    try {
      const result = await fixture.peers[0].request('echo', input).catch((error: unknown) => error)
      if (kind === 'buffer') {
        assert.ok(
          result instanceof ArrayBuffer,
          '[A84] ArrayBuffer cannot be rejected or converted to a descriptor'
        )
        assert.deepEqual([...new Uint8Array(result)], [9, 8, 7, 6])
      } else {
        assert.ok(
          result instanceof Uint8Array,
          '[A84] the typed result must contain bytes, not a legacy descriptor'
        )
        assert.equal(result.byteOffset, 1)
        assert.deepEqual([...result], [8, 7])
        assert.deepEqual([...new Uint8Array(result.buffer)], [0, 8, 7])
      }
      assert.notEqual(result, input, '[A84] inline restoration materializes its own business value')
    } finally {
      await fixture.close()
    }
  }
)

it('[A84] a binary result needs no binary request payload, and tag-shaped business data stays ordinary', async () => {
  const fixture = await connected(
    {},
    {
      bytes: () => new Uint8Array([1, 2]),
      echo: (value: unknown) => value
    },
    capabilities,
    capabilities
  )
  try {
    const result = await fixture.peers[0].request('bytes')
    assert.ok(result instanceof Uint8Array, '[A84] result restoration cannot depend on input bytes')
    assert.deepEqual([...result], [1, 2])
    /** These shapes are business values, never an untagged manifest or native reference. */
    const collision = {
      array: ['buffer', 0],
      object: {
        profile: 'migaia.rpc.portable-binary/1',
        storage: 'native',
        envelope: null,
        backings: []
      }
    }
    assert.deepEqual(
      JSON.parse(JSON.stringify(await fixture.peers[0].request('echo', collision))),
      collision
    )
  } finally {
    await fixture.close()
  }
})

it('[A84] notify, stream, group and sealed outcome restore bytes through their original owners', async () => {
  /** Original provider invocation supplies an independent receiver-side observation. */
  const received: unknown[] = []
  const fixture = await connected(
    {},
    {
      receive: (value: unknown) => {
        received.push(value)
      },
      bytes: () => new Uint8Array([3, 4]),
      values: async function* () {
        yield new Uint8Array([5, 6])
      }
    },
    capabilities,
    capabilities
  )
  try {
    await fixture.peers[0].notify('receive', new Uint8Array([1, 2]))
    await vi.waitFor(() => assert.equal(received.length, 1))
    assert.ok(
      received[0] instanceof Uint8Array,
      '[A84] a physical-only notify still restores provider bytes'
    )
    const stream = fixture.peers[0].stream('values')
    const item = await stream.next()
    assert.ok(item.value instanceof Uint8Array, '[A84] stream items retain their real binary type')
    assert.deepEqual([...item.value], [5, 6])
    await stream.return!(undefined)
    const group = await fixture.peers[0].group([{ method: 'bytes' }], {
      idempotencyKey: 'binary-result'
    })
    assert.equal(group[0]!.state, 'success')
    assert.ok(group[0]!.state === 'success' && group[0]!.result instanceof Uint8Array)
    const outcome = await fixture.peers[0].outcome('binary-result')
    assert.equal(outcome.state, 'done')
    assert.ok(outcome.state === 'done' && outcome.outcome.completion.ok)
    if (outcome.state === 'done' && outcome.outcome.completion.ok) {
      const results = outcome.outcome.completion.result as readonly {
        state: string
        result: unknown
      }[]
      assert.ok(
        results[0]!.result instanceof Uint8Array,
        '[A84] stored outcomes are restored once, not double-tagged'
      )
    }
  } finally {
    await fixture.close()
  }
})

it('[A84][A74] missing bilateral portable-binary rejects native input before send or provider', async () => {
  let effects = 0
  const fixture = await connected(
    {},
    { echo: () => ++effects },
    capabilities,
    RUNTIME_API_CAPABILITIES.filter((value) => value !== 'portable-binary@1')
  )
  const send = vi.spyOn(readRuntimePeerConnection(fixture.peers[0]).channel.transport, 'send')
  try {
    const result = await Promise.resolve()
      .then(() => fixture.peers[0].request('echo', new Uint8Array([1])))
      .catch((error: unknown) => error)
    assert.equal(
      (result as { code?: string })?.code,
      RpcCoreErrorCode.capabilityUnsupported,
      '[A84] do not silently send a bytes descriptor to a foreign peer'
    )
    assert.equal(send.mock.calls.length, 0)
    assert.equal(effects, 0)
  } finally {
    send.mockRestore()
    await fixture.close()
  }
})

it.each(['request', 'notify', 'stream', 'group'] as const)(
  '[A87] %s explicit empty transfer cannot be ignored when the native profile is absent',
  async (mode) => {
    let effects = 0
    const fixture = await connected(
      {},
      {
        echo: () => {
          effects++
          return 1
        },
        values: async function* () {
          effects++
          yield 1
        }
      },
      RUNTIME_API_CAPABILITIES,
      RUNTIME_API_CAPABILITIES
    )
    const send = vi.spyOn(readRuntimePeerConnection(fixture.peers[0]).channel.transport, 'send')
    try {
      const result = await Promise.resolve()
        .then<unknown>(() => {
          if (mode === 'stream')
            return fixture.peers[0].stream('values', undefined, { transfer: [] }).next()
          if (mode === 'group')
            return fixture.peers[0].group([{ method: 'echo' }], { transfer: [] })
          return fixture.peers[0][mode]('echo', undefined, { transfer: [] })
        })
        .catch((error: unknown) => error)
      assert.equal((result as { code?: string })?.code, RpcCoreErrorCode.capabilityUnsupported)
      assert.equal(send.mock.calls.length, 0)
      assert.equal(effects, 0)
    } finally {
      send.mockRestore()
      await fixture.close()
    }
  }
)

it.each(['buffer-bytes', 'view-offset'] as const)(
  '[A84][A68] keyed %s differences cannot replay a previous binary operation',
  async (kind) => {
    /** Distinct binary semantics must conflict before a second provider invocation. */
    let effects = 0
    const fixture = await connected(
      {},
      {
        echo: (value: unknown) => {
          effects++
          return value
        }
      },
      capabilities,
      capabilities
    )
    /** The second value differs in full buffer data or in the guaranteed view offset. */
    const first =
      kind === 'buffer-bytes'
        ? new Uint8Array([1]).buffer
        : new Uint8Array(new ArrayBuffer(1), 0, 1)
    const second =
      kind === 'buffer-bytes'
        ? new Uint8Array([2]).buffer
        : new Uint8Array(new ArrayBuffer(2), 1, 1)
    try {
      await fixture.peers[0].request('echo', first, { idempotencyKey: 'binary-operation' })
      const result = await fixture.peers[0]
        .request('echo', second, { idempotencyKey: 'binary-operation' })
        .catch((error: unknown) => error)
      assert.equal(
        (result as { code?: string })?.code,
        RpcCoreErrorCode.contractInvalid,
        '[A68] native bytes/type/view metadata belong to the original operation fingerprint'
      )
      assert.equal(effects, 1)
    } finally {
      await fixture.close()
    }
  }
)

it('[A84][A68] a sealed binary completion keeps its own bytes after the provider mutates its returned value', async () => {
  /** The real provider deliberately retains its business buffer after successful completion. */
  const bytes = new Uint8Array([1, 2])
  const fixture = await connected({}, { bytes: () => bytes }, capabilities, capabilities)
  try {
    const first = await fixture.peers[0].request('bytes', undefined, {
      idempotencyKey: 'sealed-bytes'
    })
    assert.ok(first instanceof Uint8Array)
    bytes[0] = 9
    const outcome = await fixture.peers[0].outcome('sealed-bytes')
    assert.ok(outcome.state === 'done' && outcome.outcome.completion.ok)
    if (outcome.state === 'done' && outcome.outcome.completion.ok) {
      const stored = outcome.outcome.completion.result
      assert.ok(stored instanceof Uint8Array)
      assert.deepEqual(
        [...stored],
        [1, 2],
        '[A68] a completed provider cannot mutate the original sealed outcome'
      )
    }
  } finally {
    await fixture.close()
  }
})

it('[A84][A68] native ArrayBuffer bytes cannot evade the original memory outcome retention budget', async () => {
  /**
   * This valid scalar result is below the physical limit but above the existing 1 MiB cache
   * ceiling.
   */
  const buffer = new ArrayBuffer(2 * 1024 * 1024)
  const fixture = await connected({}, { bytes: () => buffer }, capabilities, capabilities)
  try {
    const result = await fixture.peers[0].request('bytes', undefined, {
      idempotencyKey: 'large-binary-result'
    })
    assert.ok(result instanceof ArrayBuffer)
    assert.equal(result.byteLength, buffer.byteLength)
    const outcome = await fixture.peers[0].outcome('large-binary-result')
    assert.equal(
      outcome.state,
      'unknown',
      '[A68] an over-budget native result is not silently retained as a zero-byte object'
    )
    assert.equal(outcome.store.kind, 'memory')
  } finally {
    await fixture.close()
  }
})

it('[A84][A93] the canonical runtime source offer carries portable binary without a custom capability switch', async () => {
  /** Both original source offers use the exact capabilities supplied by the canonical assembly. */
  const fixture = await connected(
    {},
    { echo: (value: unknown) => value },
    RUNTIME_API_CAPABILITIES,
    RUNTIME_API_CAPABILITIES
  )
  try {
    const backing = new Uint8Array([1, 2]).buffer
    const result = await fixture.peers[0].request('echo', backing).catch((error: unknown) => error)
    assert.ok(
      result instanceof ArrayBuffer,
      '[A84] default negotiated peers expose actual binary bytes'
    )
    assert.deepEqual([...new Uint8Array(result)], [1, 2])
  } finally {
    await fixture.close()
  }
})

it('[A84][A59] async binary fingerprint preparation keeps its admitted FIFO place', async () => {
  /** Both requests use the same original order owner; only the first needs an actual backing hash. */
  const executions: string[] = []
  const fixture = await connected(
    {},
    {
      echo: (value: unknown) => {
        executions.push(value instanceof ArrayBuffer ? 'first' : 'second')
        return 1
      }
    },
    capabilities,
    capabilities
  )
  const subtle = globalThis.crypto.subtle
  const digest = subtle.digest
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let preparing!: () => void
  const started = new Promise<void>((resolve) => {
    preparing = resolve
  })
  const hash = vi.spyOn(subtle, 'digest').mockImplementation(async (...args) => {
    const result = await Reflect.apply(digest, subtle, args)
    preparing()
    await held
    return result
  })
  const first = fixture.peers[0].request('echo', new Uint8Array([1]).buffer, {
    orderKey: 'binary-fifo',
    idempotencyKey: 'binary-first'
  })
  let second: Promise<unknown> | undefined
  let queue: ReturnType<typeof vi.spyOn> | undefined
  try {
    await started
    /** Observing the actual enqueue proves arrival; no clock or queue implementation is replaced. */
    queue = vi.spyOn(ProviderAdmissionRegistry.prototype, 'enqueueOrder')
    second = fixture.peers[0].request('echo', 2, { orderKey: 'binary-fifo' })
    await vi.waitFor(() => assert.equal(queue!.mock.calls.length, 1))
    release()
    await Promise.all([first, second])
    assert.deepEqual(
      executions,
      ['first', 'second'],
      '[A59] a later request cannot pass binary preparation'
    )
  } finally {
    release()
    await Promise.allSettled([first, ...(second ? [second] : [])])
    queue?.mockRestore()
    hash.mockRestore()
    await fixture.close()
  }
})
