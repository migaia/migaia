import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { it, vi } from 'vitest'
import { createEndpoint } from '../../src/core/index.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { streamRoots } from '../streaming/fixture.js'
import { createDiscoveryFeature } from '../../src/core/features/discovery.js'
import { createBroadcastChannelTransport } from '../../src/browser/adapters/broadcast-channel.js'
import { authentication } from '../../src/core/middleware/authentication.js'
import { connect } from '../../src/core/middleware/connect.js'
import { readAuthenticationEnvelope } from '../../src/core/middleware/authentication-envelope.js'
import { RpcAuthenticationControl } from '../../src/core/internal/authentication-replay.js'
import { RpcEnvelopeKind, RpcRouteType } from '../../src/contract/index.js'
import { MessageChannel } from 'node:worker_threads'
import { createNodeMessagePortTransport } from '../../src/core/adapters/message-port.js'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { installPlugin } from '../core/middleware/helpers.js'
import type { IRpcAuthenticationCapability } from '../../src/core/typing.js'

/** Fixture controls model a lost physical reply and observe the original codec boundary only. */
type IParticipantOptions = { dropResponse?: boolean; decode?: (value: unknown) => unknown }

/** Fixture signatures cover exact physical values and never use a production credential. */
function signature(value: unknown): string {
  return createHmac('sha256', 'u40-public-fixture').update(JSON.stringify(value)).digest('hex')
}

/** Each installation has its own nonce while all participants share the same fixture signer. */
function signed() {
  return authentication({
    sign: (value) => ({ value, signature: signature(value) }),
    verify: (value) => {
      const frame = value as { value: unknown; signature: string }
      assert.equal(frame.signature, signature(frame.value))
      return frame.value
    }
  })
}

/** Real channels carry null-source messages through the production broadcast adapter. */
async function participant(
  channelName: string,
  id: string,
  execute?: (data: unknown) => unknown,
  options?: IParticipantOptions
) {
  const channel = new BroadcastChannel(channelName)
  const transport = createBroadcastChannelTransport(channel)
  const frames: any[] = []
  const failures: any[] = []
  const send = transport.send
  transport.send = (value, options) => {
    frames.push(value)
    if (
      dropResponse &&
      (readAuthenticationEnvelope((value as any).value).payload as any)?.kind ===
        RpcEnvelopeKind.response
    )
      return
    return send(value, options)
  }
  /** A dropped old reply witnesses business execution before receiver replacement. */
  const dropResponse = options?.dropResponse
  const endpoint = await createEndpoint({
    id,
    transport,
    middlewares: [connect({ transport }), signed()],
    ...(options?.decode ? { codec: { ...identityCodecV1, decode: options.decode } } : {}),
    ...(execute
      ? { provider: { echo: async (context) => context.success(await execute(context.data)) } }
      : {})
  })
  endpoint.hooks.on((event) => {
    if (event.name === 'failure') failures.push(event.error)
  })
  return { endpoint, channel, frames, failures }
}

/** Disposal retains the original endpoint owner and closes only this fixture's real channel. */
async function close(value: { endpoint: { dispose(): Promise<void> }; channel: BroadcastChannel }) {
  await value.endpoint.dispose()
  value.channel.close()
}

/** Selects actual authenticated business writes independently of their result promises. */
function business(frames: any[]) {
  return frames.find(
    (frame) =>
      (readAuthenticationEnvelope(frame.value).payload as any)?.kind === RpcEnvelopeKind.request
  )
}

/** Counts discovery on the same physical carrier as business traffic. */
function queries(frames: any[]) {
  return frames.filter(
    (frame) =>
      (readAuthenticationEnvelope(frame.value).payload as any)?.data?.route?.type ===
      RpcRouteType.discoveryQuery
  )
}

it('[A31/A34] a new sender nonce works and an already accepted old frame stays rejected', async () => {
  const name = randomUUID()
  let calls = 0
  const server = await participant(name, 'server', (data) => {
    calls += 1
    return data
  })
  let client = await participant(name, 'client')
  try {
    assert.equal(await client.endpoint.send('server', 'echo', 'old'), 'old')
    const frame = business(client.frames)
    const firstNonce = readAuthenticationEnvelope(frame.value).nonce
    await close(client)
    client = await participant(name, 'client')
    assert.equal(await client.endpoint.send('server', 'echo', 'new'), 'new')
    assert.notEqual(readAuthenticationEnvelope(business(client.frames).value).nonce, firstNonce)
    const before = server.failures.length
    client.channel.postMessage(frame)
    await vi.waitFor(() => assert.equal(server.failures.length, before + 1))
    assert.equal(calls, 2)
    assert.equal(server.failures.at(-1).code, 'AUTHENTICATION_FAILED')
  } finally {
    await close(client)
    await close(server)
  }
})

it('[A30/A33] authenticated streams address two distinct receivers with the same logical client name', async () => {
  /** Real discovery suffixes distinguish clients; logical sender names intentionally coincide. */
  const name = randomUUID()
  const make = async (id: string, uniqueTargetId?: string) => {
    const channel = new BroadcastChannel(name)
    const transport = createBroadcastChannelTransport(channel)
    const selected = streamRoots()
    const endpoint = await createComposedEndpoint(
      {
        id,
        transport,
        middlewares: [
          connect({
            transport,
            uniqueTargetId,
            useBaseIdVerifyOnly: false,
            identifier: () => true
          }),
          signed()
        ]
      },
      {
        ...selected,
        'first-party-discovery': createDiscoveryFeature(selected['first-party-outbound'])
      }
    )
    return { endpoint, channel }
  }
  const server = await make('server')
  const alpha = await make('client', 'alpha')
  const beta = await make('client', 'beta')
  let calls = 0
  server.endpoint.stream.provide('echo', async function* (value) {
    assert.ok(typeof value === 'string')
    calls += 1
    yield value
    return value
  })
  try {
    const a = alpha.endpoint.stream.open('server', 'echo', 'alpha', { timeoutMs: 250 })
    const b = beta.endpoint.stream.open('server', 'echo', 'beta', { timeoutMs: 250 })
    /** Assert both observable yields directly; a failed open need not enter its generator body. */
    const first = await Promise.allSettled([a.next(), b.next()])
    assert.deepEqual(
      first,
      [
        { status: 'fulfilled', value: { done: false, value: 'alpha' } },
        { status: 'fulfilled', value: { done: false, value: 'beta' } }
      ],
      '[A30] both streams must yield through receiver-specific signed reply frames'
    )
    assert.deepEqual(await Promise.all([a.next(), b.next()]), [
      { done: true, value: 'alpha' },
      { done: true, value: 'beta' }
    ])
    assert.equal(calls, 2)
  } finally {
    await close(alpha)
    await close(beta)
    await close(server)
  }
})

it('[A32/A34] a signed unknown challenge is rejected before the business codec runs', async () => {
  const name = randomUUID()
  let decodes = 0
  let calls = 0
  const server = await participant(
    name,
    'server',
    (data) => {
      calls += 1
      return data
    },
    {
      decode: (value) => {
        decodes += 1
        return value
      }
    }
  )
  const client = await participant(name, 'client')
  try {
    await client.endpoint.send('server', 'echo', 'first')
    const original = business(client.frames)
    const value = { ...original.value, challenge: '0'.repeat(32) }
    const before = decodes
    client.channel.postMessage({ value, signature: signature(value) })
    await vi.waitFor(() => assert.equal(server.failures.at(-1)?.reason, 'SESSION_UNKNOWN'))
    assert.equal(decodes, before)
    assert.equal(calls, 1)
    assert.equal(server.failures.at(-1).source, '@migaia/rpc/core')
    assert.equal(server.failures.at(-1).name, 'RpcAuthenticationError')
  } finally {
    await close(client)
    await close(server)
  }
})

it('[A33] replaying an executed request at a replacement cannot execute it again', async () => {
  const name = randomUUID()
  let calls = 0
  const client = await participant(name, 'client')
  let server = await participant(
    name,
    'server',
    (data) => {
      calls += 1
      return data
    },
    { dropResponse: true }
  )
  try {
    /** Immediate observation retains the original bare endpoint's deadline settlement. */
    const pending = client.endpoint
      .send('server', 'echo', 'F', { timeoutMs: 150 })
      .catch((error) => error)
    await vi.waitFor(() => assert.equal(calls, 1))
    const frame = business(client.frames)
    await close(server)
    server = await participant(name, 'server', (data) => {
      calls += 1
      return data
    })
    client.channel.postMessage(frame)
    await vi.waitFor(() => assert.equal(server.failures.at(-1)?.reason, 'SESSION_UNKNOWN'))
    const failure = await pending
    assert.ok(failure instanceof Error)
    assert.equal(Reflect.get(failure, 'code'), 'DEADLINE_EXCEEDED')
    assert.equal(
      client.frames.filter(
        (value) =>
          (readAuthenticationEnvelope(value.value).payload as any)?.kind === RpcEnvelopeKind.request
      ).length,
      1
    )
    assert.equal(calls, 1, '[A33] an executed logical request is never automatically resent')
  } finally {
    await close(client)
    await close(server)
  }
})

it('[A35] a resident signed query returns the same challenge without business execution', async () => {
  const name = randomUUID()
  let calls = 0
  const server = await participant(name, 'server', (data) => {
    calls += 1
    return data
  })
  const client = await participant(name, 'client')
  try {
    await client.endpoint.send('server', 'echo', 'first')
    const response = server.frames.find(
      (frame) =>
        readAuthenticationEnvelope(frame.value).control === RpcAuthenticationControl.response
    )
    const original = readAuthenticationEnvelope(response.value).challenge
    const count = server.frames.length
    client.channel.postMessage(queries(client.frames)[0])
    await vi.waitFor(() => assert.ok(server.frames.length > count))
    assert.equal(readAuthenticationEnvelope(server.frames.at(-1).value).challenge, original)
    assert.equal(calls, 1)
  } finally {
    await close(client)
    await close(server)
  }
})

it('[A34/A35/A36] a full visited SIEVE table permits eviction and rediscovery never duplicates business', async () => {
  const name = randomUUID()
  let calls = 0
  const server = await participant(name, 'server', (data) => {
    calls += 1
    return data
  })
  const clients: Awaited<ReturnType<typeof participant>>[] = []
  try {
    for (let index = 0; index < 65; index += 1) {
      /** Every entry is visited; touching the first again cannot move the SIEVE hand. */
      if (index === 64)
        assert.equal(await clients[0]!.endpoint.send('server', 'echo', 'touch'), 'touch')
      const client = await participant(name, `client-${index}`)
      clients.push(client)
      assert.equal(await client.endpoint.send('server', 'echo', index), index)
    }
    const retained = clients[1]!
    const retainedFailures = server.failures.length
    retained.channel.postMessage(business(retained.frames))
    await vi.waitFor(() => assert.equal(server.failures.length, retainedFailures + 1))
    assert.equal(
      server.failures.at(-1).message,
      'Authentication frame was replayed',
      '[A36] the hand advances past its evicted starting slot'
    )
    const first = clients[0]!
    const oldFrame = business(first.frames)
    const oldChallenge = readAuthenticationEnvelope(oldFrame.value).challenge
    const before = server.failures.length
    first.channel.postMessage(oldFrame)
    await vi.waitFor(() => assert.equal(server.failures.length, before + 1))
    assert.equal(
      server.failures.at(-1).reason,
      'SESSION_UNKNOWN',
      '[A36] exactly 64 slots exclude the first sender'
    )
    assert.equal(calls, 66)
    /** Replayed queries rotate evicted nonces without submitting any business frame. */
    for (const client of clients) client.channel.postMessage(queries(client.frames)[0])
    await vi.waitFor(() =>
      assert.ok(
        server.frames.filter(
          (frame) =>
            readAuthenticationEnvelope(frame.value).control === RpcAuthenticationControl.response
        ).length >= 130
      )
    )
    const response = server.frames
      .filter(
        (frame) =>
          readAuthenticationEnvelope(frame.value).echoNonce ===
            readAuthenticationEnvelope(oldFrame.value).nonce &&
          readAuthenticationEnvelope(frame.value).control === RpcAuthenticationControl.response
      )
      .at(-1)
    assert.notEqual(readAuthenticationEnvelope(response.value).challenge, oldChallenge)
    assert.equal(calls, 66, '[A36] pressure cannot execute providers')
    /** Old wire bytes remain invalid independently of discovery response collection timing. */
    const afterPressure = server.failures.length
    first.channel.postMessage(oldFrame)
    await vi.waitFor(() => assert.equal(server.failures.length, afterPressure + 1))
    assert.equal(server.failures.at(-1).reason, 'SESSION_UNKNOWN')
    assert.equal(
      await first.endpoint.send('server', 'echo', 'fresh-after-pressure', { timeoutMs: 300 }),
      'fresh-after-pressure'
    )
    assert.equal(calls, 67, '[A36] only the fresh logical call executes once')
  } finally {
    for (const client of clients) await close(client)
    await close(server)
  }
}, 15_000)

it('[A40/R13] 48 active sessions survive replay churn with a business frame between each 16 insertions', async () => {
  /** Genuine clients keep their established challenge through four complete one-shot batches. */
  const name = randomUUID()
  let calls = 0
  const server = await participant(name, 'server', (data) => {
    calls += 1
    return data
  })
  const clients: Awaited<ReturnType<typeof participant>>[] = []
  try {
    for (let index = 0; index < 48; index++) {
      const client = await participant(name, `active-${index}`)
      clients.push(client)
      assert.equal(await client.endpoint.send('server', 'echo', index), index)
    }
    /** Old signed queries are captured with the real transform owner and contain no business data. */
    const queryPayload = readAuthenticationEnvelope(queries(clients[0]!.frames)[0].value).payload
    const oneShots: any[] = []
    for (let index = 0; index < 32; index++) {
      const sender = installPlugin(signed()).get(
        'authenticationCapability'
      ) as IRpcAuthenticationCapability
      oneShots.push(
        await sender.protect(queryPayload, {
          direction: 'outbound',
          endpointId: 'active-0',
          platform: 'BroadcastChannel'
        })
      )
    }
    /** Observe signed discovery replies by nonce without a production table-inspection hook. */
    const challengeFor = (nonce: string) =>
      server.frames
        .map((frame) => readAuthenticationEnvelope(frame.value))
        .filter(
          (frame) =>
            frame.control === RpcAuthenticationControl.response && frame.echoNonce === nonce
        )
        .at(-1)?.challenge
    const original = new Map(
      clients.map((client) => {
        const frame = readAuthenticationEnvelope(business(client.frames).value)
        return [frame.nonce, frame.challenge]
      })
    )
    const queryCounts = clients.map((client) => queries(client.frames).length)
    const firstOneShotChallenges = new Map<string, string | undefined>()
    for (let round = 0; round < 4; round++) {
      const batch = oneShots.slice((round % 2) * 16, (round % 2) * 16 + 16)
      const before = server.frames.filter(
        (frame) =>
          readAuthenticationEnvelope(frame.value).control === RpcAuthenticationControl.response
      ).length
      for (const frame of batch) clients[0]!.channel.postMessage(frame)
      await vi.waitFor(() =>
        assert.equal(
          server.frames.filter(
            (frame) =>
              readAuthenticationEnvelope(frame.value).control === RpcAuthenticationControl.response
          ).length,
          before + 16
        )
      )
      for (const frame of batch) {
        const nonce = readAuthenticationEnvelope(frame.value).nonce
        if (round < 2) firstOneShotChallenges.set(nonce, challengeFor(nonce))
        else
          assert.notEqual(
            challengeFor(nonce),
            firstOneShotChallenges.get(nonce),
            '[A40] every revisited one-shot was evicted and receives fresh randomness'
          )
      }
      const results = await Promise.all(
        clients.map((client, index) => client.endpoint.send('server', 'echo', `${round}:${index}`))
      )
      assert.deepEqual(
        results,
        clients.map((_, index) => `${round}:${index}`)
      )
      for (const [nonce, challenge] of original) assert.equal(challengeFor(nonce), challenge)
      assert.deepEqual(
        clients.map((client) => queries(client.frames).length),
        queryCounts,
        '[A40] no legitimate session needs rediscovery'
      )
      assert.equal(server.failures.filter((error) => error.reason === 'SESSION_UNKNOWN').length, 0)
      assert.equal(calls, 48 * (round + 2), '[A40] queries and churn never execute a provider')
    }
  } finally {
    for (const client of clients) await close(client)
    await close(server)
  }
}, 15_000)

it('[A38] tampered nonce and challenge fail signature verification before execution', async () => {
  const name = randomUUID()
  let calls = 0
  const server = await participant(name, 'server', (data) => {
    calls += 1
    return data
  })
  const client = await participant(name, 'client')
  try {
    await client.endpoint.send('server', 'echo', 'first')
    const frame = business(client.frames)
    for (const field of ['nonce', 'challenge'] as const) {
      const before = server.failures.length
      client.channel.postMessage({ ...frame, value: { ...frame.value, [field]: '0'.repeat(32) } })
      await vi.waitFor(() => assert.equal(server.failures.length, before + 1))
      assert.equal(server.failures.at(-1).code, 'AUTHENTICATION_FAILED')
      assert.equal(calls, 1)
    }
  } finally {
    await close(client)
    await close(server)
  }
})

it('[A38/A39] signed session-unknown replay only refreshes the next send; tampering does nothing', async () => {
  const name = randomUUID()
  let calls = 0
  const client = await participant(name, 'client')
  let server = await participant(name, 'server', (data) => {
    calls += 1
    return data
  })
  try {
    await client.endpoint.send('server', 'echo', 'first')
    await close(server)
    server = await participant(name, 'server', (data) => {
      calls += 1
      return data
    })
    await assert.rejects(client.endpoint.send('server', 'echo', 'stale', { timeoutMs: 50 }))
    const control = server.frames.find(
      (frame) =>
        readAuthenticationEnvelope(frame.value).control === RpcAuthenticationControl.unknown
    )
    assert.ok(control)
    assert.equal(readAuthenticationEnvelope(control.value).payload, undefined)
    await client.endpoint.send('server', 'echo', 'fresh')
    const queryCount = queries(client.frames).length
    const before = client.failures.length
    server.channel.postMessage({ ...control, value: { ...control.value, receiverId: 'tampered' } })
    await vi.waitFor(() => assert.equal(client.failures.length, before + 1))
    await client.endpoint.send('server', 'echo', 'after-tamper')
    assert.equal(queries(client.frames).length, queryCount)
    const writes = client.frames.length
    server.channel.postMessage(control)
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    assert.equal(client.frames.length, writes, '[A39] control replay never initiates a send')
    assert.equal(calls, 3)
    await client.endpoint.send('server', 'echo', 'after-control-replay')
    assert.equal(queries(client.frames).length, queryCount + 1)
    assert.equal(calls, 4)
  } finally {
    await close(client)
    await close(server)
  }
})

it.each([false, true])(
  '[A37] exclusive or real-source multiplexed frames stay unchanged (source=%s)',
  async (source) => {
    const { port1, port2 } = new MessageChannel()
    const bases = [createNodeMessagePortTransport(port1), createNodeMessagePortTransport(port2)]
    const frames: any[] = []
    /** Diagnostics distinguish a rejected fixture source from production authentication failure. */
    const proofs: unknown[] = []
    const failures: unknown[] = []
    const transports = bases.map((base, index) => {
      const send = base.send
      return {
        platform: base.platform,
        ownership: base.ownership,
        topology: base.topology,
        subscribe: base.subscribe,
        ...(source
          ? {
              topology: 'multiplexed' as const,
              sourceProof: (value: unknown) => {
                proofs.push({
                  index,
                  object: typeof value === 'object' && value !== null,
                  matches: value === bases[1 - index]
                })
                return value === bases[1 - index]
              },
              subscribe: (listener: Parameters<typeof base.subscribe>[0]) =>
                base.subscribe((message) => listener({ ...message, source: bases[1 - index] }))
            }
          : {}),
        send: (value: unknown) => {
          frames.push(value)
          return send(value)
        }
      }
    })
    const server = await createEndpoint({
      id: 'server',
      transport: transports[1]!,
      middlewares: [
        connect({
          transport: transports[1]!,
          ...(source
            ? {
                useBaseIdVerifyOnly: false,
                identifier: (context) => context.source === bases[0]
              }
            : {})
        }),
        signed()
      ],
      provider: { echo: (context) => context.success(context.data) }
    })
    const client = await createEndpoint({
      id: 'client',
      transport: transports[0]!,
      middlewares: [
        connect({
          transport: transports[0]!,
          ...(source
            ? {
                useBaseIdVerifyOnly: false,
                identifier: (context) => context.source === bases[1]
              }
            : {})
        }),
        signed()
      ]
    })
    for (const endpoint of [client, server])
      endpoint.hooks.on((event) => {
        if (event.name === 'failure')
          failures.push({ code: event.code, message: (event.error as Error)?.message })
      })
    try {
      assert.equal(
        await client.send('server', 'echo', 'one').catch((error) => {
          assert.fail(
            JSON.stringify({
              error: error.code,
              proofs,
              failures,
              frames: frames.map((frame) => {
                const inner = readAuthenticationEnvelope(frame.value)
                return {
                  counter: inner.counter,
                  challenge: inner.challenge,
                  payload: inner.payload
                }
              })
            })
          )
        }),
        'one'
      )
      assert.equal(await client.send('server', 'echo', 'two'), 'two')
      const counters = new Map<string, bigint>()
      for (const frame of frames) {
        const inner = readAuthenticationEnvelope(frame.value)
        assert.deepEqual(Object.keys(frame.value).sort(), [
          'authentication',
          'counter',
          'nonce',
          'payload',
          'version'
        ])
        assert.equal(BigInt(inner.counter), (counters.get(inner.nonce) ?? 0n) + 1n)
        counters.set(inner.nonce, BigInt(inner.counter))
        assert.equal(inner.challenge, undefined)
      }
    } finally {
      await client.dispose()
      await server.dispose()
      port1.close()
      port2.close()
    }
  }
)

it('[A30] two authenticated BroadcastChannel clients execute independently', async () => {
  const name = randomUUID()
  const calls: unknown[] = []
  const server = await participant(name, 'server', (data) => {
    calls.push(data)
    return data
  })
  const clients = [await participant(name, 'alpha'), await participant(name, 'beta')]
  try {
    const outcomes = await Promise.allSettled(
      clients.map((client, index) =>
        client.endpoint.send('server', 'echo', index, { timeoutMs: 150 })
      )
    )
    assert.deepEqual(outcomes, [
      { status: 'fulfilled', value: 0 },
      { status: 'fulfilled', value: 1 }
    ])
    assert.deepEqual(calls.sort(), [0, 1])
  } finally {
    for (const client of clients) await close(client)
    await close(server)
  }
})

it('[A32/A33] a restarted receiver rejects the stale business frame without replaying it', async () => {
  const name = randomUUID()
  const client = await participant(name, 'client')
  let oldCalls = 0
  let newCalls = 0
  let server = await participant(name, 'server', (data) => {
    oldCalls += 1
    return data
  })
  try {
    assert.equal(await client.endpoint.send('server', 'echo', 'first'), 'first')
    await close(server)
    server = await participant(name, 'server', (data) => {
      newCalls += 1
      return data
    })
    await assert.rejects(client.endpoint.send('server', 'echo', 'stale', { timeoutMs: 50 }))
    assert.equal(newCalls, 0, '[A32] a new receiver never executes the old challenge')
    await vi.waitFor(() =>
      assert.ok(
        server.frames.some((frame) => JSON.stringify(frame.value).includes('session-unknown'))
      )
    )
    assert.equal(await client.endpoint.send('server', 'echo', 'fresh', { timeoutMs: 150 }), 'fresh')
    assert.equal(oldCalls, 1)
    assert.equal(newCalls, 1, '[A33] the rejected logical call is never automatically resent')
  } finally {
    await close(client)
    await close(server)
  }
})

it('[A33] notify reports an unknown session without retransmission and the next dispatch rediscovers once', async () => {
  /** Notification keeps its original fire-and-forget owner, including failure reporting. */
  const name = randomUUID()
  let calls = 0
  let server = await participant(name, 'server', (data) => {
    calls += 1
    return data
  })
  const client = await participant(name, 'client')
  try {
    client.endpoint.dispatch('server', 'echo', 'first')
    await vi.waitFor(() => assert.equal(calls, 1))
    await close(server)
    server = await participant(name, 'server', (data) => {
      calls += 1
      return data
    })
    client.endpoint.dispatch('server', 'echo', 'stale')
    await vi.waitFor(() => assert.equal(server.failures.at(-1)?.reason, 'SESSION_UNKNOWN'))
    assert.equal(
      server.frames.filter(
        (frame) =>
          readAuthenticationEnvelope(frame.value).control === RpcAuthenticationControl.unknown
      ).length,
      1
    )
    assert.equal(calls, 1)
    const before = queries(client.frames).length
    client.endpoint.dispatch('server', 'echo', 'fresh')
    await vi.waitFor(() => assert.equal(calls, 2))
    assert.equal(queries(client.frames).length, before + 1)
    assert.equal(
      client.frames.filter(
        (frame) =>
          (readAuthenticationEnvelope(frame.value).payload as any)?.kind === RpcEnvelopeKind.request
      ).length,
      3
    )
    assert.equal(server.failures[0]?.source, '@migaia/rpc/core')
    assert.equal(server.failures[0]?.code, 'AUTHENTICATION_FAILED')
  } finally {
    await close(client)
    await close(server)
  }
})

/** Stream replies use the same original stream, provider and physical authentication owners. */
it('[A33] authenticated BroadcastChannel streams retain their original credit and terminal path', async () => {
  /** Two genuine channels expose the supported source-less stream path. */
  const name = randomUUID()
  let serverChannel = new BroadcastChannel(name)
  const clientChannel = new BroadcastChannel(name)
  const serverTransport = createBroadcastChannelTransport(serverChannel)
  const clientTransport = createBroadcastChannelTransport(clientChannel)
  /** Actual stream-open writes expose any forbidden retransmission after receiver replacement. */
  const clientFrames: any[] = []
  const send = clientTransport.send
  clientTransport.send = (value, options) => {
    clientFrames.push(value)
    return send(value, options)
  }
  /** Source-less authentication selects the existing discovery owner beside the stream owner. */
  const roots = () => {
    const selected = streamRoots()
    return {
      ...selected,
      'first-party-discovery': createDiscoveryFeature(selected['first-party-outbound'])
    }
  }
  let server = await createComposedEndpoint(
    {
      id: 'server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), signed()]
    },
    roots()
  )
  const client = await createComposedEndpoint(
    {
      id: 'client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), signed()]
    },
    roots()
  )
  /** Counts business entry, separately from the existing stream credits. */
  let calls = 0
  server.stream.provide('sequence', async function* () {
    calls += 1
    yield 'chunk'
    return 'done'
  })
  try {
    /** The original deadline bounds a real failure rather than hanging this discriminating case. */
    const iterator = client.stream.open('server', 'sequence', null, { timeoutMs: 250 })
    assert.deepEqual(await iterator.next(), { done: false, value: 'chunk' })
    assert.deepEqual(await iterator.next(), { done: true, value: 'done' })
    assert.deepEqual(await iterator.next(), { done: true, value: undefined })
    assert.equal(calls, 1)
    /** An accepted stream loses its real receiver before the next credit reaches that receiver. */
    const interrupted = client.stream.open('server', 'sequence', null, { timeoutMs: 250 })
    assert.deepEqual(await interrupted.next(), { done: false, value: 'chunk' })
    assert.equal(calls, 2)
    await server.dispose()
    serverChannel.close()
    serverChannel = new BroadcastChannel(name)
    const replacementTransport = createBroadcastChannelTransport(serverChannel)
    server = await createComposedEndpoint(
      {
        id: 'server',
        transport: replacementTransport,
        middlewares: [connect({ transport: replacementTransport }), signed()]
      },
      roots()
    )
    let replacementCalls = 0
    const failures: any[] = []
    server.hooks.on((event) => {
      if (event.name === 'failure') failures.push(event.error)
    })
    server.stream.provide('sequence', async function* () {
      replacementCalls += 1
      yield 'fresh-chunk'
      return 'fresh-done'
    })
    const failure = await interrupted.next().catch((error) => error)
    assert.ok(failure instanceof Error)
    assert.equal(Reflect.get(failure, 'code'), 'DEADLINE_EXCEEDED')
    await assert.rejects(interrupted.next(), (error) => error === failure)
    assert.equal(failures[0]?.reason, 'SESSION_UNKNOWN')
    assert.equal(
      replacementCalls,
      0,
      '[A33] neither unknown control nor old stream credits execute a provider'
    )
    const before = queries(clientFrames).length
    const fresh = client.stream.open('server', 'sequence', null, { timeoutMs: 250 })
    assert.deepEqual(await fresh.next(), { done: false, value: 'fresh-chunk' })
    assert.deepEqual(await fresh.next(), { done: true, value: 'fresh-done' })
    assert.equal(queries(clientFrames).length, before + 1)
    assert.equal(replacementCalls, 1)
    assert.equal(
      clientFrames.filter(
        (frame) =>
          (readAuthenticationEnvelope(frame.value).payload as any)?.kind === RpcEnvelopeKind.request
      ).length,
      3,
      '[A33] only three explicit opens are written'
    )
  } finally {
    await client.dispose()
    await server.dispose()
    clientChannel.close()
    serverChannel.close()
  }
})
