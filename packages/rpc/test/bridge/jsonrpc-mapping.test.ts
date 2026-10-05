import { describe, expect, it } from 'vitest'
import { serializeRpcError } from '../../src/contract/error.js'
import { bridgeEndpoint, bridgeFixture, flush, request } from './fixture.js'

describe('JSON-RPC envelope mapping', () => {
  it.each(['response-first', 'abort-first'])(
    '[A6] retains core settlement for %s same-tick response/abort delivery',
    async (order) => {
      const fixture = bridgeFixture()
      const channel = await fixture.open()
      const endpoint = await bridgeEndpoint(channel)
      const controller = new AbortController()
      try {
        const pending = endpoint.send('peer', 'p.f.request', [], {
          signal: controller.signal,
          timeoutMs: 100
        })
        await flush()
        const id = fixture.messages[1]!.id
        const respond = () => fixture.deliver({ jsonrpc: '2.0', id, result: 'response-won' })
        const cancel = () => controller.abort(new Error('abort-won'))
        if (order === 'response-first') {
          respond()
          cancel()
        } else {
          cancel()
          respond()
        }
        /** The required batch object path admits the first event synchronously to the core owner. */
        if (order === 'response-first') await expect(pending).resolves.toBe('response-won')
        else await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
        await flush()
        expect(
          fixture.messages.filter((message) => message.method === 'migaia.cancel').length
        ).toBeLessThanOrEqual(1)
        const next = endpoint.send('peer', 'p.f.request', [], { timeoutMs: 100 })
        await flush()
        fixture.deliver({ jsonrpc: '2.0', id: fixture.messages.at(-1)!.id, result: 'next' })
        await expect(next).resolves.toBe('next')
      } finally {
        await endpoint.dispose()
        await channel.close()
      }
    }
  )
  it('[A5] preserves ids, reverses routes, handles null and projects exact metadata', async () => {
    const fixture = bridgeFixture()
    const channel = await fixture.open()
    const responses: unknown[] = []
    channel.transport.subscribe((message) => responses.push(JSON.parse(message.data as string)))
    await channel.transport.send(
      JSON.stringify(
        request(
          'first',
          'p.f.request',
          { timeoutMs: 9, trace: 'trace-value', idempotencyKey: 'one-key', receiverId: 'rx' },
          ['你好']
        )
      )
    )
    await channel.transport.send(JSON.stringify(request('second', 'p.f.plain', {}, [null])))
    await channel.transport.send(
      JSON.stringify(request('third', 'p.f.plain', { idempotencyKey: 'explicit-key' }))
    )
    await channel.transport.send(
      JSON.stringify(
        request('one-way', 'p.f.request', { dispatchOnly: true, timeoutMs: 5, trace: 'omit-me' })
      )
    )
    expect(fixture.messages.slice(1)).toEqual([
      {
        jsonrpc: '2.0',
        id: 'first',
        method: 'migaia.invoke',
        params: {
          method: 'p.f.request',
          args: ['你好'],
          meta: { timeoutMs: 9, trace: 'trace-value', idempotencyKey: 'one-key' }
        }
      },
      {
        jsonrpc: '2.0',
        id: 'second',
        method: 'migaia.invoke',
        params: { method: 'p.f.plain', args: [null] }
      },
      {
        jsonrpc: '2.0',
        id: 'third',
        method: 'migaia.invoke',
        params: { method: 'p.f.plain', args: [], meta: { idempotencyKey: 'explicit-key' } }
      },
      { jsonrpc: '2.0', method: 'migaia.invoke', params: { method: 'p.f.request', args: [] } }
    ])
    fixture.deliver({ jsonrpc: '2.0', id: 'second', result: null })
    fixture.deliver({ jsonrpc: '2.0', id: 'first', result: 'first-value' })
    expect(responses).toMatchObject([
      { id: 'second', ok: true, data: { payload: null } },
      {
        id: 'first',
        ok: true,
        data: {
          payload: 'first-value',
          route: {
            type: 'response',
            senderId: 'peer',
            targetId: 'client',
            receiverId: 'client',
            method: 'p.f.request',
            sentAt: 123
          }
        }
      }
    ])
    fixture.deliver({ jsonrpc: '2.0', id: 'first', result: 'duplicate' })
    fixture.deliver({ jsonrpc: '2.0', id: 'unknown', result: 'unknown' })
    expect(responses).toHaveLength(2)
    expect(fixture.reports).toHaveLength(2)
    await channel.close()
  })
  it('[A5] preserves Host control method names and args through invoke', async () => {
    const fixture = bridgeFixture()
    const channel = await fixture.open({
      target: {
        kind: 'host',
        catalog: {
          p:
            fixture.options.target.kind === 'plugin'
              ? fixture.options.target.contract
              : ({} as never)
        }
      }
    })
    for (const [id, method, args] of [
      ['use', 'migaia.remote.host.use', ['p']],
      ['unUse', 'migaia.remote.host.unUse', ['p', { policy: 'suspend' }]],
      ['inspect', 'migaia.remote.host.inspect', []]
    ] as const)
      await channel.transport.send(JSON.stringify(request(id, method, {}, args)))
    expect(fixture.messages.slice(1).map((message) => message.params)).toEqual([
      { method: 'migaia.remote.host.use', args: ['p'] },
      { method: 'migaia.remote.host.unUse', args: ['p', { policy: 'suspend' }] },
      { method: 'migaia.remote.host.inspect', args: [] }
    ])
    await channel.close()
  })
  it('[A6] sends one cancel after invoke, reports late response once, and keeps the next call usable', async () => {
    const fixture = bridgeFixture()
    const channel = await fixture.open()
    const responses: unknown[] = []
    channel.transport.subscribe((message) => responses.push(JSON.parse(message.data as string)))
    await channel.transport.send(JSON.stringify(request('cancelled')))
    const reason = serializeRpcError(new Error('abort cause'), { report: () => undefined })
    const cancel = {
      kind: 'variation',
      id: 'cancelled',
      data: {
        route: {
          profile: 'migaia.rpc.route',
          type: 'variation',
          applicationVersion: 'app',
          senderId: 'client',
          targetId: 'peer',
          sentAt: 0,
          variation: 'abort'
        },
        payload: reason
      }
    }
    await channel.transport.send(JSON.stringify(cancel))
    await channel.transport.send(JSON.stringify(cancel))
    expect(fixture.messages.slice(1).map((message) => message.method)).toEqual([
      'migaia.invoke',
      'migaia.cancel'
    ])
    expect(fixture.messages[2]).toEqual({
      jsonrpc: '2.0',
      method: 'migaia.cancel',
      params: { id: 'cancelled', reason }
    })
    fixture.deliver({ jsonrpc: '2.0', id: 'cancelled', result: 'too late' })
    expect(fixture.reports).toHaveLength(1)
    expect(responses).toEqual([])
    await channel.transport.send(JSON.stringify(request('next')))
    fixture.deliver({ jsonrpc: '2.0', id: 'next', result: 'works' })
    expect(responses).toMatchObject([{ id: 'next', data: { payload: 'works' } }])
    expect(fixture.closes).toBe(0)
    await channel.close()
  })
  it('[A5/A6] core gate preserves one-way ids and caller abort/deadline settlement', async () => {
    const fixture = bridgeFixture()
    const channel = await fixture.open()
    const endpoint = await bridgeEndpoint(channel)
    try {
      const controller = new AbortController()
      const aborted = endpoint.send('peer', 'p.f.request', ['abort'], {
        signal: controller.signal,
        timeoutMs: 100
      })
      await flush()
      controller.abort(new Error('original abort'))
      await expect(aborted).rejects.toMatchObject({ code: 'CANCELLED' })
      await flush()
      const timed = endpoint.send('peer', 'p.f.request', ['timeout'], { timeoutMs: 30 })
      await flush()
      fixture.scheduler.advance(30)
      await expect(timed).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      await flush()
      await endpoint.sendOneWay('peer', 'p.f.request', ['one-way'])
      const invoke = fixture.messages.filter((message) => message.method === 'migaia.invoke')
      const cancels = fixture.messages.filter((message) => message.method === 'migaia.cancel')
      expect(invoke).toHaveLength(3)
      expect(cancels).toHaveLength(2)
      expect(invoke[2]).not.toHaveProperty('id')
      for (const cancel of cancels) {
        const id = (cancel.params as { id: string }).id
        expect(fixture.messages.findIndex((message) => message.id === id)).toBeLessThan(
          fixture.messages.indexOf(cancel)
        )
      }
      expect(fixture.messages.filter((message) => message.method === '$/cancelRequest')).toEqual([])
    } finally {
      await endpoint.dispose()
      await channel.close()
    }
  })
})
