import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin, type IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import { describe, expect, it, vi } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'
import { readRpcDefinition } from '../../dist/sdk/metadata.js'
import { RpcLifecycleError, RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { deserializeRpcError } from '../../dist/host/error-wire-metadata.js'
import { attachErrorIdentity } from '@migaia/utils/error'

/** Borrow actual native control authority without adding a business or control execution facade. */
async function controlListener(name: string) {
  /** The existing native memory fixture continues to own both physical endpoints. */
  const server = coreMemoryServer(name)
  /** SDK identity supplies the original physical acquisition callback without duplicating it. */
  const original = readRpcDefinition(server.transport)
  if (original?.kind !== 'transport') return expect.unreachable()
  /** Capturing this install port observes the real SessionTable control owner. */
  const observed: { context?: IRpcTransportSetupContext } = {}
  /** This remains an actual native transport, lending only its original SDK setup context. */
  const transport = defineTransportPlugin({
    ...original.definition,
    open(context) {
      observed.context = context
      return original.definition.open(context)
    }
  })
  /** The public Host constructs the sole native runtime and commits this original listener. */
  const host = await createRpcHost({ ...server.options, plugins: [transport] })
  if (!observed.context) return expect.unreachable()
  return { host, server, context: observed.context }
}

/** Public fanout maps retain tagged keys; lifecycle controls use the genuine SDK Session port. */
describe('composed sendAll/pingAll fanout contract', () => {
  it('sendAll keys results by the tagged fanoutDeliveryKey shape and tolerates a __proto__ target', async () => {
    /** Two actual peers select the public fanout branch instead of the single-peer scalar branch. */
    const listener = coreMemoryServer('client')
    /** Declared return typing narrows the genuine public scalar/fanout union without a wrapper. */
    const client = await createRpcHost<{ echo(value: string): string }>(listener.options)
    /** The unusual name remains the accepted target identity and the only successful provider. */
    const server = await listener.connect('__proto__', { provide: { echo: (value) => value } })
    /** A genuine method-less peer preserves fanout while leaving the original fulfilled keys exact. */
    const unavailable = await listener.connect('unavailable')
    try {
      /** Places this same broadcast under the transport namespace. */
      const result = await client.memory.request('echo', 'value')
      if (!result || typeof result !== 'object') return expect.unreachable()
      const { fulfilled, rejected } = result
      expect(Object.getPrototypeOf(fulfilled)).toBeNull()
      expect(Object.getPrototypeOf(rejected)).toBeNull()
      const key = JSON.stringify(['target', '__proto__'])
      expect(Object.keys(fulfilled)).toEqual([key])
      expect(fulfilled[key]).toBe('value')
      // The hostile target id must never have mutated the accumulator's own prototype.
      expect(Object.getPrototypeOf(fulfilled)).toBeNull()
    } finally {
      await Promise.all([client.close(), server.host.close(), unavailable.host.close()])
    }
  })

  it('SDK control ping retains the accepted __proto__ target identity', async () => {
    /** Move lifecycle control to the real transport setup port, outside business fanout. */
    const client = await controlListener('client-ping-fanout')
    /** Native acceptance and lookup must retain the unusual original peer identity. */
    const server = await client.server.connect('__proto__')
    try {
      /** The native SDK returns this exact accepted Session handle, never a forged control target. */
      const selected = client.context.lookup('__proto__')
      expect(selected?.view.name).toBe('__proto__')
      expect(selected?.view.peerId).toBe('__proto__')
      if (!selected) return expect.unreachable()
      await expect(client.context.ping(selected.handle)).resolves.toBeUndefined()
    } finally {
      await Promise.all([client.host.close(), server.host.close()])
    }
  })

  it('pingAll rethrows a RpcLifecycleError instead of folding it into the per-target result', async () => {
    /** The supported native control call retains lifecycle rejection after actual Host shutdown. */
    const client = await controlListener('client-disposed-fanout')
    /** Real admission supplies the original handle before the Session is retired. */
    const server = await client.server.connect('unreachable')
    try {
      const selected = client.context.lookup('unreachable')
      if (!selected) return expect.unreachable()
      await client.host.close()
      /** The original retained handle reaches its closed Session's own rejected control Promise. */
      await expect(client.context.ping(selected.handle)).rejects.toBeInstanceOf(RpcLifecycleError)
    } finally {
      await Promise.all([client.host.close(), server.host.close()])
    }
  })

  it('sendAll rethrows a RpcLifecycleError instead of resolving with per-target rejections', async () => {
    /** The cold listener introduces a genuine namespace without fabricating unreachable targets. */
    const listener = coreMemoryServer('client-disposed-send-fanout')
    const client = await createRpcHost(listener.options)
    /** The held genuine projection survives native unpublication only as a retired callable. */
    const namespace = client.memory
    await client.close()
    await expect(namespace.request('echo', 'value')).rejects.toBeInstanceOf(RpcLifecycleError)
  })

  it.each(['class', 'constructor', 'tag', 'decode'] as const)(
    '%s forged lifecycle failure cannot close the endpoint or escape fanout as its own lifecycle decision',
    async (kind) => {
      /**
       * This public constructor legitimately describes caller-owned lifecycle errors, without
       * minting Core authority.
       */
      const example = new RpcLifecycleError('external lifecycle fixture')
      /** The constructor remains reachable through ordinary error observation too. */
      const Constructor = example.constructor as typeof RpcLifecycleError
      /** Public fields remain diagnostic data for the tag/decode variants. */
      const wire = {
        source: RPC_CORE_ERROR_SOURCE,
        code: RpcCoreErrorCode.endpointDisposed,
        name: 'RpcLifecycleError',
        message: 'external lifecycle fixture',
        stack: 'external lifecycle stack'
      }
      /** These are all public construction paths; none calls Core's private factory. */
      const forged =
        kind === 'class'
          ? example
          : kind === 'constructor'
            ? new Constructor(wire.message)
            : kind === 'decode'
              ? deserializeRpcError(wire)
              : attachErrorIdentity(new Error(wire.message), {
                  source: wire.source,
                  code: wire.code
                })
      /** The actual transport reports this failure during a real endpoint send. */
      const listener = coreMemoryServer('forged-lifecycle-client')
      /** Both actual targets keep this request on its real multi-peer fanout branch. */
      const client = await createRpcHost<{ value(payload: null): number }>(listener.options)
      /** Native handshake finishes before the original business writer injects its caller error. */
      const provider = await listener.connect('provider', { provide: { value: () => 1 } })
      /** This independent accepted target prevents the single-peer scalar shortcut. */
      const healthy = await listener.connect('healthy', { provide: { value: () => 2 } })
      /** Count only genuine physical business writes, leaving control and cleanup unchanged. */
      let sends = 0
      /** The original stable arrow retains its genuine native receiver and cleanup behavior. */
      const write = provider.pair[0].write
      /** Only a real post-handshake call write fails; native close still reaches its original IO. */
      const writing = vi.spyOn(provider.pair[0], 'write').mockImplementation((frame, options) => {
        if (frame.kind === 'message' && (frame.data as { kind?: unknown }).kind === 'call') {
          sends++
          throw forged
        }
        return write(frame, options)
      })
      try {
        /** A caller-owned lifecycle diagnostic cannot become a Core close decision. */
        const result = await client.memory.request('value', null)
        if (!result || typeof result !== 'object') return expect.unreachable()
        const failure = result.rejected[JSON.stringify(['target', 'provider'])] as Error
        expect(failure).toMatchObject({ code: RpcCoreErrorCode.transport, cause: forged })
        expect(sends).toBe(1)
        /** The same endpoint remains active and admits another physical send. */
        await client.memory.request('value', null)
        expect(sends).toBe(2)
      } finally {
        writing.mockRestore()
        await Promise.all([client.close(), provider.host.close(), healthy.host.close()])
      }
    }
  )
})
