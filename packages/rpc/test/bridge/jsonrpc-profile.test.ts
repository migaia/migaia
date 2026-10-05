import { describe, expect, it } from 'vitest'
import vectors from '../../schema/vectors/jsonrpc-bridge.json'
import { bridgeFixture, flush, request } from './fixture.js'

describe('JSON-RPC profile boundary', () => {
  it.each(vectors.inbound)(
    '[A9] applies inbound vector $id without affecting a second connection',
    async (vector) => {
      const fixture = bridgeFixture()
      const other = bridgeFixture()
      const channel = await fixture.open()
      const otherChannel = await other.open()
      const responses: unknown[] = []
      const terminals: unknown[] = []
      channel.transport.subscribe((message) => responses.push(JSON.parse(message.data as string)))
      channel.transport.onTransportError?.((error) => terminals.push(error))
      await channel.transport.send(JSON.stringify(request('pending')))
      fixture.deliver(vector.value)
      await flush()
      if (vector.action === 'close') {
        expect(fixture.closes).toBe(1)
        expect(terminals).toHaveLength(1)
        expect(terminals[0]).toMatchObject({ code: vector.code })
        if ('causeCode' in vector)
          expect(terminals[0]).toMatchObject({
            cause: { source: 'jsonrpc-2.0', code: vector.causeCode }
          })
        expect(responses).toEqual([])
      } else {
        expect(fixture.closes).toBe(0)
        if (vector.action === 'report') {
          expect(fixture.reports).toHaveLength(1)
          expect(fixture.reports[0]).toMatchObject({ code: vector.code })
          expect(responses).toEqual([])
          fixture.deliver({ jsonrpc: '2.0', id: 'pending', result: 'still works' })
        }
        expect(responses).toHaveLength(1)
        if (vector.action === 'settle') {
          /** The saved request binds every accepted singleton or batch member to its exact result. */
          const member = Array.isArray(vector.value) ? vector.value[0]! : vector.value
          expect(responses[0]).toMatchObject({ id: 'pending', data: { payload: member.result } })
          expect(fixture.reports).toEqual([])
          expect(terminals).toEqual([])
        }
        await channel.close()
      }
      const unaffected: unknown[] = []
      otherChannel.transport.subscribe((message) =>
        unaffected.push(JSON.parse(message.data as string))
      )
      await otherChannel.transport.send(JSON.stringify(request('other')))
      other.deliver({ jsonrpc: '2.0', id: 'other', result: 'independent' })
      expect(unaffected).toMatchObject([{ id: 'other', data: { payload: 'independent' } }])
      await otherChannel.close()
    }
  )
  it('[A10] rejects transfer through a Promise as native TypeError before any business byte', async () => {
    const fixture = bridgeFixture()
    const channel = await fixture.open()
    let sending: void | Promise<void> = undefined
    expect(() => {
      sending = channel.transport.send(JSON.stringify(request('transfer')), { transfer: [{}] })
    }).not.toThrow()
    expect(sending).toBeInstanceOf(Promise)
    await expect(sending).rejects.toMatchObject({
      name: 'TypeError',
      source: '@migaia/rpc/bridge/jsonrpc',
      code: 'JSONRPC_PROFILE_INVALID'
    })
    expect(fixture.messages).toHaveLength(1)
    await channel.close()
  })
  it('[A10] rejects invalid args, streams and unmapped variation without writing business bytes', async () => {
    const fixture = bridgeFixture()
    const channel = await fixture.open()
    await expect(
      channel.transport.send(JSON.stringify(request('args', 'p.f.request', {}, { named: true })))
    ).rejects.toMatchObject({ code: 'JSONRPC_PROFILE_INVALID' })
    const variation = {
      kind: 'variation',
      id: 'ping',
      data: {
        route: {
          profile: 'migaia.rpc.route',
          type: 'variation',
          applicationVersion: 'app',
          senderId: 'client',
          targetId: 'peer',
          sentAt: 0,
          variation: 'ping'
        }
      }
    }
    await expect(channel.transport.send(JSON.stringify(variation))).rejects.toMatchObject({
      code: 'JSONRPC_PROFILE_INVALID'
    })
    expect(fixture.messages).toHaveLength(1)
    await channel.close()
  })
})
