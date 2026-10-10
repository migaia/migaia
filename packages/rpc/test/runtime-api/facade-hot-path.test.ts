import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { it, vi } from 'vitest'
import { connected } from './fixture.js'
import { readRuntimePeerEndpoint } from '../../src/remote/runtime-api/peer.js'
import { readEndpointOwner } from '../../src/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../src/core/endpoint-kernel.js'
import type { ProviderRegistry } from '../../src/core/internal/provider.js'
import { RpcSerializationError } from '../../src/core/errors.js'
import * as portable from '../../src/contract/normalize.js'
import vectors from '../../schema/vectors/runtime-api.json'
import {
  createRuntimeRequestInput,
  retainRuntimeRequestInput,
  readRuntimeRequestInput,
  isRuntimeRequestInput,
  createRuntimeRequestOutboundEnvelope,
  isRuntimeOutboundEnvelope,
  isOutboundEnvelope
} from '../../src/core/internal/outbound-envelope.js'

/** Independent native execution counts delivered facades without mocking canonical dispatch. */
const execute = promisify(execFile)
/** The fixture completes actual business before any contract counter assertion. */
const entry = fileURLToPath(new URL('./fixtures/facade-hot-path-counters.mjs', import.meta.url))

for (const carrier of ['stdio-framed', 'worker'] as const) {
  it(`[A37][R15][D19] ${carrier} request adds no facade payload traversal or closure`, async () => {
    const result = await execute(process.execPath, [entry, carrier], {
      env: { ...process.env, IPC_BENCH_STEM: `/tmp/rpc-facade-contract-${randomUUID()}` }
    })
    const observed = JSON.parse(result.stdout) as {
      requests: number
      payloadValue: number
      requestClosure: number
      runtimeInput: number
    }
    assert.equal(observed.requests, 20, '[A37] the genuine public Peer completed every request')
    assert.equal(
      observed.runtimeInput,
      20,
      '[BC11] Core captures each logical request exactly once'
    )
    assert.equal(
      observed.payloadValue,
      0,
      '[D19] canonical dispatch owns payload normalization; the facade cannot add another traversal'
    )
    assert.equal(
      observed.requestClosure,
      0,
      '[R15] the request facade cannot allocate a new closure'
    )
  })
}

for (const carrier of ['stdio-framed', 'worker'] as const) {
  it(`[A37][D19] Deno ${carrier} keeps scalar dispatch outside binary and materialization work`, async () => {
    const result = await execute('deno', ['run', '-A', entry, carrier], {
      env: { ...process.env, IPC_BENCH_STEM: `/tmp/rpc-deno-facade-${randomUUID()}` }
    })
    /** Loaded witnesses prove the zero counters belong to present, instrumented owner functions. */
    const observed = JSON.parse(result.stdout) as {
      requests: number
      payloadValue: number
      requestClosure: number
      runtimeEnvelope: number
      runtimeInput: number
      binaryPrepare: number
      materialize: number
      loaded: {
        url: string
        diskSHA256: string
        loadedSHA256: string
        diagnosticOverlay: boolean
      }[]
    }
    assert.equal(observed.requests, 20)
    assert.equal(observed.payloadValue, 0, '[D19] Deno does not add facade payload walks')
    assert.equal(observed.requestClosure, 0, '[R15] Deno uses the original cold dispatcher')
    assert.equal(
      observed.runtimeInput,
      20,
      '[BC11] Core captures each logical request exactly once'
    )
    assert.equal(
      observed.runtimeEnvelope,
      40,
      '[D19] only outgoing and untrusted incoming admission'
    )
    assert.equal(observed.binaryPrepare, 0, '[K272] scalar calls do not prepare binary manifests')
    assert.equal(
      observed.materialize,
      0,
      '[K273] scalar runtime calls do not materialize JSON again'
    )
    for (const suffix of [
      '/contract/runtime-api/normalize-envelope.js',
      '/contract/runtime-api/binary-capture.js',
      '/core/internal/outbound-envelope.js'
    ]) {
      const witness = observed.loaded.find((row) => row.url.endsWith(suffix))
      assert.ok(witness, `[D19] actual loader witness required for ${suffix}`)
      assert.equal(witness.diagnosticOverlay, true)
      assert.notEqual(witness.loadedSHA256, witness.diskSHA256)
    }
    assert.ok(
      observed.loaded.some((row) => row.url.endsWith('/remote/runtime-api/managed-peer.js'))
    )
    for (const suffix of ['/remote/runtime-api/peer.js', '/core/internal/runtime-call.js']) {
      const witness = observed.loaded.find((row) => row.url.endsWith(suffix))
      assert.ok(witness, `[BC11] actual moved owner or raw facade must load for ${suffix}`)
      assert.equal(witness.diagnosticOverlay, false)
      assert.equal(witness.loadedSHA256, witness.diskSHA256)
    }
    assert.equal(
      observed.loaded.some((row) => row.url.endsWith('/contract/runtime-api/binary.js')),
      false,
      '[A27] scalar dispatch does not load the heavy binary codec'
    )
  })
}

it('[A37][R15] managed request retains native drain without a per-call facade closure', async () => {
  const result = await execute(process.execPath, [entry, 'worker'], {
    env: { ...process.env, IPC_BENCH_STEM: `/tmp/rpc-facade-closure-${randomUUID()}` }
  })
  const observed = JSON.parse(result.stdout) as { requests: number; requestClosure: number }
  assert.equal(observed.requests, 20)
  assert.equal(observed.requestClosure, 0, '[R15] native drain must use the cold dispatcher')
})

it('[A37][D19] canonical runtime sender does not normalize its owned envelope again', async () => {
  const result = await execute(process.execPath, [entry, 'stdio-framed'], {
    env: { ...process.env, IPC_BENCH_STEM: `/tmp/rpc-runtime-owned-${randomUUID()}` }
  })
  const observed = JSON.parse(result.stdout) as { requests: number; runtimeEnvelope: number }
  assert.equal(observed.requests, 20)
  assert.equal(
    observed.runtimeEnvelope,
    40,
    '[D19] each request has one outbound snapshot and one untrusted inbound admission'
  )
})

it('[A37][R15][D47] a synchronous business provider has no asynchronous facade adapter', async () => {
  const fixture = await connected({}, { echo: (value) => value })
  try {
    for (let index = 0; index < 20; index++)
      assert.equal(await fixture.peers[0].request('echo', 'complete'), 'complete')
    /** Canonical provenance observes the exact callback already used by real provider execution. */
    const registry = readEndpointOwner<ProviderRegistry>(
      readRuntimePeerEndpoint(fixture.peers[1]).endpoint,
      EndpointOwnerKey.providerRegistry
    )
    const provider = registry!.providers.get('echo')!
    assert.equal(
      provider.constructor.name,
      'Function',
      '[R15] scalar adapter cannot create a Promise'
    )
  } finally {
    await fixture.close()
  }
})

it('[D47] result prototype failure retains payload classification and its local original cause', async () => {
  /** This supported failure occurs during portable result admission, after business returns. */
  const original = new RangeError('result prototype failure')
  const value = new Proxy(
    {},
    {
      getPrototypeOf: () => {
        throw original
      }
    }
  )
  const fixture = await connected({}, { result: () => value })
  try {
    await assert.rejects(fixture.peers[0].request('result'), (error: unknown) => {
      assert.equal(Reflect.get(error as object, 'code'), 'PAYLOAD_INVALID')
      assert.equal(JSON.stringify(error).includes(original.message), false)
      return true
    })
    /** Canonical local reporting retains the original trap; child wire summaries still sanitize it. */
    const reported = fixture.failures.find(
      (error) => error instanceof RpcSerializationError
    ) as RpcSerializationError & { cause: { cause: unknown } }
    assert.equal(reported.cause.cause, original)
  } finally {
    await fixture.close()
  }
})

it('[A37][D19] non-binary public request performs one outbound payload admission', async () => {
  const fixture = await connected({}, { accepted: () => 42 })
  /** Only the exact business marker is counted; ready-directory and result work are excluded. */
  const normalize = vi.spyOn(portable, 'normalizePortable')
  try {
    assert.equal(await fixture.peers[0].request('accepted', { marker: 'logical-input' }), 42)
    const walks = normalize.mock.calls.filter(
      ([value]) =>
        typeof value === 'object' &&
        value !== null &&
        Reflect.get(value, 'marker') === 'logical-input'
    )
    assert.equal(
      walks.length,
      2,
      '[D19] one outgoing admission and one untrusted receiver admission'
    )
  } finally {
    normalize.mockRestore()
    await fixture.close()
  }
})

it('[D47] foreign thenable resolves before portable result admission and reads then once', async () => {
  /** A business thenable is assimilated, so its own prototype is never a portable result. */
  let reads = 0
  const value = new Proxy(
    {},
    {
      getPrototypeOf: () => {
        throw new RangeError('thenable prototype is not a result')
      },
      get: (_target, property) => {
        if (property !== 'then') return undefined
        reads++
        return (resolve: (value: unknown) => void) => resolve(42)
      }
    }
  )
  const fixture = await connected({}, { result: () => value })
  try {
    assert.equal(await fixture.peers[0].request('result'), 42)
    assert.equal(reads, 1)
  } finally {
    await fixture.close()
  }
})

it('[D19] immutable outbound proof admits only the exact original logical input', () => {
  const header = vectors.valid[0]!
  assert.equal(header.kind, 'runtime-call')
  const method = Reflect.get(header, 'task').method as string
  const input = createRuntimeRequestInput(method, { marker: 'owned' }, true)
  const options = retainRuntimeRequestInput({}, input)
  assert.equal(readRuntimeRequestInput(options, method, input.payload), input)
  assert.equal(readRuntimeRequestInput(options, 'another-method', input.payload), undefined)
  assert.equal(readRuntimeRequestInput(options, method, { marker: 'owned' }), undefined)
  const copied = Object.freeze({ ...input })
  assert.equal(isRuntimeRequestInput(copied), false)
  const envelope = createRuntimeRequestOutboundEnvelope(header, input)
  assert.equal(isRuntimeOutboundEnvelope(envelope), true)
  assert.equal(isRuntimeOutboundEnvelope(Object.freeze({ ...envelope })), false)
  assert.equal(isOutboundEnvelope(envelope), false)
  assert.equal(isRuntimeRequestInput(envelope), false)
  assert.throws(() => createRuntimeRequestOutboundEnvelope({ ...header, task: null }, input))
})
