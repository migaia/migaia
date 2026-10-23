import { RpcControl } from '@migaia/rpc-contract'
import { deferred } from '@migaia/utils/promise'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '../../dist/index.js'
import { defineFeaturePlugin, defineTransportPlugin } from '../../dist/plugin/index.js'
import { createAdapterDeployment } from '../../dist/runtime-adapter/deployment.js'
import type { IRuntimePeerDescription } from '../../dist/remote/runtime-api/description.js'
import { memoryServer } from './fixture.js'

/** Fully drain only the concrete returned iterators used by these business assertions. */
async function items(value: AsyncIterable<unknown>) {
  const result: unknown[] = []
  for await (const item of value) result.push(item)
  return result
}

describe('RPC host', () => {
  it('rejects invalid native definition identities and cardinalities before physical opening', () => {
    let opens = 0
    const transport = defineTransportPlugin({
      name: 'transport',
      mode: 'connect',
      deployment: createAdapterDeployment({
        open: async () => {
          opens += 1
          throw new Error('unexpected open')
        }
      })
    })
    const feature = defineFeaturePlugin({ name: 'feature' })
    for (const [plugins, code] of [
      [[], 'HOST_TRANSPORT_MISSING'],
      [[feature], 'HOST_TRANSPORT_MISSING'],
      [[transport, transport], 'HOST_TRANSPORT_DUPLICATE'],
      [[Object.freeze({ ...transport })], 'HOST_PLUGIN_INVALID'],
      [
        [
          transport,
          defineFeaturePlugin({
            name: 'a',
            assemble: async () => {
              throw new Error('unused')
            }
          }),
          defineFeaturePlugin({
            name: 'b',
            assemble: async () => {
              throw new Error('unused')
            }
          })
        ],
        'HOST_ASSEMBLER_DUPLICATE'
      ],
      [[transport, feature, feature], 'HOST_FEATURE_DUPLICATE']
    ] as const)
      expect(() => createRpcHost({ plugins: plugins as never })).toThrowError(
        expect.objectContaining({ name: 'TypeError', code, source: 'rpc.endpoint' })
      )
    expect(opens).toBe(0)
  })

  it('uses scalar single-target calls and null-prototype zero/multiple-target settlements', async () => {
    const server = memoryServer('server')
    const host = await createRpcHost({
      ...server.options,
      provide: { reverse: (value: string) => [...value].reverse().join('') }
    })
    try {
      expect(await host.request('value')).toEqual({ fulfilled: {}, rejected: {} })
      const zero = await host.group([])
      expect(Object.getPrototypeOf((zero as { fulfilled: object }).fulfilled)).toBeNull()
      const first = await server.connect('first', {
        provide: {
          value: (value?: unknown) => value ?? 1,
          sequence: async function* () {
            yield 1
            yield 2
          }
        }
      })
      try {
        expect(await host.request('value', 4)).toBe(4)
        expect(await first.host.request('reverse', 'abc')).toBe('cba')
        expect(await items(host.stream('sequence') as AsyncIterable<unknown>)).toEqual([1, 2])
        const second = await server.connect('second', {
          provide: {
            value: () => 9,
            sequence: async function* () {
              yield 9
            }
          }
        })
        try {
          expect(await host.request('value')).toEqual({
            fulfilled: { '["target","first"]': 1, '["target","second"]': 9 },
            rejected: {}
          })
          expect(await host.send('first', 'value', 7)).toBe(7)
          await expect(host.send('nobody', 'value')).rejects.toMatchObject({
            code: 'TARGET_UNKNOWN'
          })
          const streams = host.stream('sequence') as {
            fulfilled: Record<string, AsyncIterable<unknown>>
          }
          expect(await items(streams.fulfilled['["target","first"]']!)).toEqual([1, 2])
          expect(await items(streams.fulfilled['["target","second"]']!)).toEqual([9])
        } finally {
          await second.host.close()
        }
      } finally {
        await first.host.close()
      }
    } finally {
      await host.close()
    }
  })

  it('forwards namespace and held capabilities through the canonical provider owner', async () => {
    const b = memoryServer('b')
    const host = await createRpcHost(b.options)
    const c = await b.connect('c', {
      provide: { render: (value: unknown) => ({ rendered: value }) }
    })
    try {
      const held = host.peers.c!.render!
      host.provide({ render: held })
      const a = await b.connect('a')
      try {
        expect(await a.host.send('b', 'c.render', 42)).toEqual({ rendered: 42 })
        expect(await a.host.send('b', 'render', 7)).toEqual({ rendered: 7 })
        await expect(a.host.send('c', 'render', 1)).rejects.toMatchObject({
          code: 'TARGET_UNKNOWN'
        })
        await expect(a.host.send('b', 'c.missing', 1)).rejects.toMatchObject({
          code: 'PROVIDER_NOT_FOUND'
        })
        await expect(a.host.send('b', 'nobody.render', 1)).rejects.toMatchObject({
          code: 'TARGET_UNKNOWN'
        })
        await c.host.close()
        await expect(a.host.send('b', 'c.render', 1)).rejects.toMatchObject({
          code: 'TARGET_UNKNOWN'
        })
        const replacement = await b.connect('c', { provide: { render: () => 'new' } }, 'c-new')
        try {
          await expect(held()).rejects.toMatchObject({ code: 'TARGET_UNKNOWN' })
          expect(await host.peers.c!.render!()).toBe('new')
        } finally {
          await replacement.host.close()
        }
      } finally {
        await a.host.close()
      }
    } finally {
      await c.host.close()
      await host.close()
    }
  })

  it('rejects a live same-name newcomer while the original remains callable', async () => {
    const server = memoryServer('server')
    const host = await createRpcHost(server.options)
    const first = await server.connect('client', { provide: { value: () => 1 } }, 'original')
    try {
      await expect(
        server.connect('client', { provide: { value: () => 2 } }, 'duplicate')
      ).rejects.toMatchObject({ code: 'HOST_PEER_NAME_DUPLICATE' })
      expect(await host.send('client', 'value')).toBe(1)
    } finally {
      await first.host.close()
      await host.close()
    }
  })
  it('refuses a colliding physical identity without retiring the original session or its calls', async () => {
    /** The original accepted client keeps one actual provider operation in progress. */
    const entered = deferred<void>()
    /** Only the original provider controls completion of its pending operation. */
    const resumed = deferred<void>()
    /** A real listener owns both physical attempts and its one endpoint inventory. */
    const server = memoryServer('identity-server')
    /** The first accepted session must survive the later source admission failure. */
    const host = await createRpcHost(server.options)
    /** Display names differ, so this is physical-id admission rather than same-name arbitration. */
    const first = await server.connect(
      'original-name',
      {
        provide: {
          value: () => 'original',
          pending: async () => {
            entered.resolve()
            await resumed.promise
            return 'original-completion'
          }
        }
      },
      'shared-physical-id'
    )
    /** Observe either settlement immediately without swallowing a failure from the final oracle. */
    const pending = host.send('original-name', 'pending').then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )
    try {
      await entered.promise
      await expect(
        server.connect(
          'different-name',
          { provide: { value: () => 'candidate' } },
          'shared-physical-id'
        )
      ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'CAPABILITY_CONFLICT' })
      expect(Object.keys(host.peers)).toEqual(['original-name'])
      expect(await host.send('original-name', 'value')).toBe('original')
      resumed.resolve()
      expect(await pending).toEqual({ value: 'original-completion' })
    } finally {
      resumed.resolve()
      await first.host.close()
      await host.close()
    }
  })
  it('rolls back assembled members in reverse opening order and preserves the assembly failure', async () => {
    const first = memoryServer('member-first')
    const second = memoryServer('member-second')
    const firstHost = await createRpcHost(first.options)
    const secondHost = await createRpcHost(second.options)
    const closed: number[] = []
    const cleanup = new Error('second member cleanup')
    const primary = new Error('assembler rejected')
    const reports: unknown[] = []
    let opened = 0
    const transport = defineTransportPlugin({
      name: 'members',
      mode: 'connect',
      deployment: createAdapterDeployment({
        open: async (context) => {
          const index = opened++
          const channel = await [first, second][index]!.open(context)
          return {
            ...channel,
            close: async () => {
              closed.push(index)
              await channel.close()
              if (index === 1) throw cleanup
            }
          }
        }
      })
    })
    const assembler = defineFeaturePlugin({
      name: 'assembler',
      assemble: async ({ openMember }) => {
        await openMember()
        await openMember()
        throw primary
      }
    })
    try {
      await expect(
        createRpcHost({
          self: { name: 'assembled', instanceId: 'assembled' },
          plugins: [transport, assembler],
          report: (error) => {
            reports.push(error)
          }
        })
      ).rejects.toBe(primary)
      expect(closed).toEqual([1, 0])
      expect(
        reports.some((error) => error instanceof AggregateError && error.errors.includes(cleanup))
      ).toBe(true)
    } finally {
      await firstHost.close()
      await secondHost.close()
    }
  })

  it('reclaims a silent same-name session with one ping and rejects a third concurrent candidate', async () => {
    const server = memoryServer('server', 'server', 60)
    const host = await createRpcHost(server.options)
    const first = await server.connect(
      'client',
      { provide: { value: () => 1, pending: () => new Promise(() => undefined) } },
      'old-client'
    )
    const exits: unknown[] = []
    host.on('exit', (event) => exits.push(event))
    const oldCall = host.send('client', 'pending').catch((error) => error)
    const original = first.pair[0].send
    let pings = 0
    let observed!: () => void
    const pingStarted = new Promise<void>((resolve) => {
      observed = resolve
    })
    vi.spyOn(first.pair[0], 'send').mockImplementation((frame, options) => {
      const variation = (frame as { data?: { route?: { variation?: string } } })?.data?.route
        ?.variation
      if (variation === RpcControl.ping) {
        pings += 1
        observed()
      }
      return original(frame, options)
    })
    vi.spyOn(first.pair[1], 'send').mockImplementation(() => undefined)
    try {
      const replacement = server.connect('client', { provide: { value: () => 2 } }, 'new-client')
      await pingStarted
      await expect(server.connect('client', {}, 'third-client')).rejects.toMatchObject({
        code: 'HOST_PEER_NAME_DUPLICATE'
      })
      const second = await replacement
      try {
        expect(pings).toBe(1)
        expect(first.pair[0].closed).toBe(true)
        expect(exits).toHaveLength(1)
        expect(await host.send('client', 'value')).toBe(2)
        expect(await oldCall).toMatchObject({ code: 'ENDPOINT_DISPOSED' })
      } finally {
        await second.host.close()
      }
    } finally {
      vi.restoreAllMocks()
      await first.host.close()
      await host.close()
    }
  })

  it('accepts a same-name successor of a physically closed session without probing it', async () => {
    const server = memoryServer('closed-server')
    const host = await createRpcHost(server.options)
    const first = await server.connect('client', { provide: { value: () => 1 } }, 'closed-first')
    const original = first.pair[0].send
    const pings: unknown[] = []
    vi.spyOn(first.pair[0], 'send').mockImplementation((frame, options) => {
      if (
        (frame as { data?: { route?: { variation?: string } } })?.data?.route?.variation ===
        RpcControl.ping
      )
        pings.push(frame)
      return original(frame, options)
    })
    try {
      await first.host.close()
      expect(first.pair[0].closed).toBe(true)
      const second = await server.connect(
        'client',
        { provide: { value: () => 2 } },
        'closed-second'
      )
      try {
        expect(await host.send('client', 'value')).toBe(2)
        expect(pings).toHaveLength(0)
      } finally {
        await second.host.close()
      }
    } finally {
      vi.restoreAllMocks()
      await first.host.close()
      await host.close()
    }
  })

  it('advertises current namespace schemas and idempotency only at a fresh accepted handshake', async () => {
    const server = memoryServer('router')
    const router = await createRpcHost(server.options)
    /** Every observer uses a real feature hook and actual accepted wire description. */
    const observe = async (name: string) => {
      const descriptions: IRuntimePeerDescription[] = []
      const feature = defineFeaturePlugin({
        name: `${name}-directory`,
        setup(context) {
          context.onDispose(
            context.directories.onAccepted((directory) => descriptions.push(directory))
          )
          descriptions.push(...context.directories.current())
        }
      })
      const plugin = defineTransportPlugin({
        name: `${name}-transport`,
        mode: 'connect',
        deployment: createAdapterDeployment({ open: (context) => server.open(context) })
      })
      const host = await createRpcHost({
        self: { name, instanceId: name },
        plugins: [plugin, feature],
        report: () => undefined
      })
      return { host, descriptions }
    }
    const first = await server.connect(
      'provider',
      {
        provide: { api: { value: (value: unknown) => value } },
        contract: {
          schemaVersion: 1,
          plugin: 'api',
          features: {
            shape: {
              methods: {
                value: {
                  mode: 'request',
                  idempotent: true,
                  input: { type: 'number' },
                  output: { type: 'number' }
                }
              }
            }
          }
        }
      },
      'provider-first'
    )
    const before = await observe('before')
    try {
      const held = (
        router.peers.provider.api as unknown as Readonly<{
          value(payload?: unknown): Promise<unknown>
        }>
      ).value
      router.provide({ held })
      expect(
        before.descriptions[0]!.methods.find((entry) => entry.name === 'provider.api.value')
      ).toMatchObject({ idempotent: true, input: { type: 'number' }, output: { type: 'number' } })
      await first.host.close()
      const second = await server.connect(
        'provider',
        {
          provide: { api: { value: (value: unknown) => value } },
          contract: {
            schemaVersion: 1,
            plugin: 'api',
            features: {
              shape: {
                methods: {
                  value: {
                    mode: 'request',
                    idempotent: false,
                    input: { type: 'string' },
                    output: { type: 'string' }
                  }
                }
              }
            }
          }
        },
        'provider-second'
      )
      try {
        const after = await observe('after')
        try {
          expect(
            after.descriptions[0]!.methods.find((entry) => entry.name === 'provider.api.value')
          ).toMatchObject({
            idempotent: false,
            input: { type: 'string' },
            output: { type: 'string' }
          })
          expect(
            after.descriptions[0]!.methods.find((entry) => entry.name === 'held')
          ).toMatchObject({ idempotent: true, input: { type: 'number' } })
          expect(before.descriptions).toHaveLength(1)
          expect(await after.host.send('router', 'provider.api.value', 'current')).toBe('current')
        } finally {
          await after.host.close()
        }
      } finally {
        await second.host.close()
      }
    } finally {
      await before.host.close()
      await first.host.close()
      await router.close()
    }
  })
})
