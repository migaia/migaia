import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  measurePortableStreamValue,
  normalizeRpcEnvelope,
  RpcRouteProfile,
  RpcStreamEvent,
  RpcStreamLimit,
  RpcStreamViolation
} from '../../src/contract/index.js'
import { normalizeStreamPayload } from '../../src/contract/v1/stream.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { connect } from '../../src/core/middleware/connect.js'
import { streamRoots } from './fixture.js'

/** Language-neutral sequence cases are executed against the actual consumer or producer owner. */
type ISequenceVector = {
  readonly id: string
  readonly role: 'consumer' | 'producer'
  readonly onPull?: readonly Readonly<{ event: 'item' | 'end'; seq: number; value: string }>[]
  readonly expectNext?: readonly Readonly<{
    done?: boolean
    value?: string
    error?: Readonly<{ code: string; violation: string; pointer: string }>
  }>[]
  readonly values?: readonly string[]
  readonly actions?: readonly ('next' | 'return')[]
  readonly expect?: readonly Readonly<{ done: boolean; value: string }>[]
  readonly clientFrames: readonly string[]
  readonly peerFrames?: readonly string[]
  readonly providerFrames?: readonly string[]
  readonly cleanupCount?: number
}

/** Select the semantic event name without treating a transport wrapper as a stream frame. */
function frameEvent(value: unknown): string | undefined {
  const frame = value as { kind?: string; data?: { payload?: { event?: string } } }
  return frame.kind === 'request'
    ? 'request'
    : frame.kind === 'stream'
      ? frame.data?.payload?.event
      : undefined
}

/** A13 consumer vectors supply one peer response for each on-wire pull. */
async function runConsumerVector(vector: ISequenceVector): Promise<void> {
  const [clientTransport, peer] = createMemoryTransportPair()
  const clientFrames: string[] = []
  const peerFrames: string[] = []
  const responses = [...(vector.onPull ?? [])]
  const send = (id: string, payload: Readonly<{ event: string; seq: number; value?: string }>) => {
    peerFrames.push(payload.event)
    void peer.send({
      kind: 'stream',
      id,
      data: {
        route: {
          profile: RpcRouteProfile,
          type: 'stream',
          applicationVersion: '1',
          senderId: 'peer',
          targetId: 'client',
          sentAt: 0
        },
        payload
      }
    })
  }
  const release = peer.subscribe(({ data }) => {
    const event = frameEvent(data)
    if (event) clientFrames.push(event)
    const frame = data as { id?: string }
    if (!frame.id) return
    if (event === 'request') send(frame.id, { event: 'open', seq: 0 })
    if (event === 'pull') {
      const response = responses.shift()
      if (response) send(frame.id, response)
    }
    if (event === 'cancel') send(frame.id, { event: 'cancelled', seq: 0 })
  })
  const client = await createComposedEndpoint(
    {
      id: 'client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    },
    streamRoots()
  )
  try {
    const iterator = client.stream.open('peer', vector.id, null)
    for (const expected of vector.expectNext ?? []) {
      if (expected.error) await expect(iterator.next()).rejects.toMatchObject(expected.error)
      else expect(await iterator.next()).toEqual(expected)
    }
    for (let index = 0; index < 3; index += 1) await Promise.resolve()
    expect(clientFrames, vector.id).toEqual(vector.clientFrames)
    expect(peerFrames, vector.id).toEqual(vector.peerFrames)
    expect(responses, vector.id).toHaveLength(0)
  } finally {
    release()
    await client.dispose()
  }
}

/** A13 producer vector verifies cancellation frames and one iterator cleanup. */
async function runProducerVector(vector: ISequenceVector): Promise<void> {
  const [clientTransport, serverTransport] = createMemoryTransportPair()
  const clientFrames: string[] = []
  const providerFrames: string[] = []
  const releaseClient = serverTransport.subscribe(({ data }) => {
    const event = frameEvent(data)
    if (event) clientFrames.push(event)
  })
  const releaseProvider = clientTransport.subscribe(({ data }) => {
    const event = frameEvent(data)
    if (event) providerFrames.push(event)
  })
  const server = await createComposedEndpoint(
    {
      id: 'server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })]
    },
    streamRoots()
  )
  const client = await createComposedEndpoint(
    {
      id: 'client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    },
    streamRoots()
  )
  let cleaned = 0
  server.stream.provide(vector.id, function* () {
    try {
      yield* vector.values ?? []
    } finally {
      cleaned += 1
    }
  })
  try {
    const iterator = client.stream.open('server', vector.id, null)
    for (const [index, action] of (vector.actions ?? []).entries()) {
      const actual = action === 'next' ? await iterator.next() : await iterator.return?.('local')
      expect(actual, `${vector.id}:${index}`).toEqual(vector.expect?.[index])
    }
    expect(cleaned, vector.id).toBe(vector.cleanupCount)
    expect(clientFrames, vector.id).toEqual(vector.clientFrames)
    expect(providerFrames, vector.id).toEqual(vector.providerFrames)
  } finally {
    releaseClient()
    releaseProvider()
    await client.dispose()
    await server.dispose()
  }
}

/** Current vectors retain exact malformed stream-route classification on the new baseline. */
describe('streaming A13 1.1 vectors', () => {
  it('rejects a stream envelope with a request route using the current vector', () => {
    const vectors = JSON.parse(
      readFileSync(new URL('../../schema/vectors/stream.json', import.meta.url), 'utf8')
    )
    const example = vectors.envelope.reclassified
    expect(() => normalizeRpcEnvelope(example.value)).toThrow(
      expect.objectContaining({
        violation: vectors.envelope.reclassified.violation,
        pointer: vectors.envelope.reclassified.pointer
      })
    )
  })

  it('runs portable payload and byte vectors against the reference contract', () => {
    const vectors = JSON.parse(
      readFileSync(new URL('../../schema/vectors/stream.json', import.meta.url), 'utf8')
    )
    const schema = JSON.parse(
      readFileSync(new URL('../../schema/stream.schema.json', import.meta.url), 'utf8')
    )
    expect(schema['x-migaia-limits']).toEqual(RpcStreamLimit)
    expect(schema.properties.event.enum).toEqual(Object.values(RpcStreamEvent))
    expect(schema['x-migaia-violations']).toEqual(Object.values(RpcStreamViolation))
    for (const item of vectors.payload) {
      if (item.valid) expect(normalizeStreamPayload(item.value)).toEqual(item.value)
      else
        expect(() => normalizeStreamPayload(item.value)).toThrow(
          expect.objectContaining({
            code: 'INVALID_STREAM',
            violation: item.violation,
            pointer: item.pointer
          })
        )
    }
    for (const item of vectors.measure)
      expect(measurePortableStreamValue(item.value), item.id).toBe(item.bytes)
    expect(normalizeRpcEnvelope(vectors.envelope.valid).kind).toBe('stream')
  })

  it('executes every role and sequence step against the TypeScript stream runtime', async () => {
    const vectors = JSON.parse(
      readFileSync(new URL('../../schema/vectors/stream.json', import.meta.url), 'utf8')
    ) as { sequences: readonly ISequenceVector[] }
    expect(new Set(vectors.sequences.map((item) => item.role))).toEqual(
      new Set(['consumer', 'producer'])
    )
    for (const vector of vectors.sequences)
      if (vector.role === 'consumer') await runConsumerVector(vector)
      else await runProducerVector(vector)
  })
})
