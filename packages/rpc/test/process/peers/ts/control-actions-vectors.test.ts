import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { normalizeRpcEnvelope, RpcRouteProfile } from '@migaia/rpc/contract'
import {
  abort,
  connect,
  createEndpoint,
  hooks,
  ping,
  type IRpcHookEvent,
  type IRpcTransport
} from '@migaia/rpc/core'
import { createMemoryTransportPair } from '@migaia/rpc/core/adapters/memory'

/** Published controls drive production variation dispatch, never a local action-name switch oracle. */
type IControlVector = { id: string; variation: string; payload: unknown; action: string }
/** Each published control retains its own test identity and expected semantic action. */
const vectors = JSON.parse(
  readFileSync(new URL('../../../../schema/vectors/control.json', import.meta.url), 'utf8')
) as { cases: IControlVector[] }

describe('public control action vectors', () => {
  it.each(vectors.cases)('$id -> $action', async (vector) => {
    /** The raw peer supplies prescribed vector inputs; production owns their interpretation. */
    const [clientWire, serverWire] = createMemoryTransportPair()
    /** Exact output controls let ping and pong prove correlation rather than just write completion. */
    const sent: unknown[] = []
    /** Hook values independently identify close, invalid close and unknown-control semantics. */
    const events: IRpcHookEvent[] = []
    /** Request metadata binds the abort fixture to one real active provider execution. */
    let request: ReturnType<typeof normalizeRpcEnvelope> | undefined
    /** Provider readiness avoids racing an injected abort before execution begins. */
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    /** Original deserialized provider reason is observed before its task returns. */
    let reason: unknown
    /** Remote abort settles provider observation even when no response is sent to the raw caller. */
    let observed!: () => void
    const aborted = new Promise<void>((resolve) => {
      observed = resolve
    })
    const clientCapture: IRpcTransport = {
      ...clientWire,
      send(value, options) {
        const frame = normalizeRpcEnvelope(value)
        if (frame.kind === 'request') request = frame
        return clientWire.send(value, options)
      }
    }
    /** A pong vector is inserted in the production responder's correlated reply payload. */
    const serverCapture: IRpcTransport = {
      ...serverWire,
      send(value, options) {
        const frame = normalizeRpcEnvelope(value)
        const output =
          vector.action === 'pong' &&
          frame.kind === 'variation' &&
          frame.data.route.variation === 'pong'
            ? { ...frame, data: { ...frame.data, payload: vector.payload } }
            : value
        sent.push(output)
        return serverWire.send(output, options)
      }
    }
    const server = await createEndpoint({
      id: 'server',
      transport: serverCapture,
      middlewares: [
        connect({ transport: serverCapture }),
        abort(),
        ping(),
        hooks({ listeners: (event) => void events.push(event) })
      ]
    })
    const client = await createEndpoint({
      id: 'client',
      transport: clientCapture,
      middlewares: [connect({ transport: clientCapture }), abort(), ping()]
    })
    try {
      if (vector.action === 'abort') {
        server.provide('slow', async (context) => {
          started()
          await new Promise<void>((resolve) =>
            context.signal.addEventListener(
              'abort',
              () => {
                reason = context.signal.reason
                observed()
                resolve()
              },
              { once: true }
            )
          )
          return context.success('aborted')
        })
        const result = client.send('server', 'slow', null, { timeoutMs: false })
        void result.catch(() => undefined)
        await ready
        expect(request?.kind).toBe('request')
        if (request?.kind !== 'request') return
        await clientWire.send({
          kind: 'variation',
          id: request.id,
          data: {
            route: { ...request.data.route, type: 'variation', variation: vector.variation },
            payload: vector.payload
          }
        })
        await aborted
        expect(reason).toBeInstanceOf(RangeError)
        expect(reason).toMatchObject(vector.payload as Record<string, unknown>)
        return
      }
      if (vector.action === 'pong') {
        expect(await client.ping('server', 'server', { timeoutMs: 1000 })).toBe(true)
        expect(
          sent
            .map((value) => normalizeRpcEnvelope(value))
            .filter((frame) => frame.kind === 'variation')
        ).toEqual([
          expect.objectContaining({
            data: expect.objectContaining({
              route: expect.objectContaining({ variation: vector.variation }),
              payload: vector.payload
            })
          })
        ])
        return
      }
      /**
       * Literal envelopes are oracle inputs only; the executable peer uses public sends
       * exclusively.
       */
      const frame = {
        kind: 'variation',
        id: vector.id,
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'variation',
            applicationVersion: '1.0.0',
            senderId: 'client',
            targetId: 'server',
            receiverId: 'server',
            sentAt: Date.now(),
            variation: vector.variation
          },
          payload: vector.payload
        }
      }
      await clientWire.send(frame)
      if (vector.action === 'ping')
        await vi.waitFor(() =>
          expect(
            sent
              .map((value) => normalizeRpcEnvelope(value))
              .filter((value) => value.kind === 'variation')
          ).toEqual([
            expect.objectContaining({
              id: vector.id,
              data: expect.objectContaining({
                route: expect.objectContaining({
                  variation: 'pong',
                  senderId: 'server',
                  targetId: 'client'
                })
              })
            })
          ])
        )
      if (vector.action === 'close')
        await vi.waitFor(() =>
          expect(events.filter((event) => event.name === 'control.close')).toEqual([
            expect.objectContaining({
              requesterId: 'client',
              durationMs: (vector.payload as { drainMs: number }).drainMs
            })
          ])
        )
      if (vector.action === 'report') {
        await vi.waitFor(() =>
          expect(events.filter((event) => event.name === 'failure')).toEqual([
            expect.objectContaining({ code: 'PROTOCOL_INVALID' })
          ])
        )
        expect(events.filter((event) => event.name === 'control.close')).toEqual([])
      }
      if (vector.action === 'warn') {
        await clientWire.send({ ...frame, id: `${vector.id}-duplicate` })
        await vi.waitFor(() =>
          expect(events.filter((event) => event.name === 'protocol.unknown-field')).toEqual([
            expect.objectContaining({ field: `variation:${vector.variation}` })
          ])
        )
        expect(events.filter((event) => event.name === 'failure')).toEqual([])
      }
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
})
