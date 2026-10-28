/** Preserve accepted schema snapshots through the actual public namespace and cold flow hook. */
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowPlugin, HostObservationKind } from '@migaia/rpc-host/sdk'
import type { IRpcSessionView } from '@migaia/rpc-contract/interfaces'
import { expect, it } from 'vitest'
import { coreMemoryServer } from './core-fixture.ts'

it('advertises current namespace schemas and idempotency only at a fresh accepted handshake', async () => {
  /** The gateway's canonical directory includes current forward targets and held declarations. */
  const server = coreMemoryServer('router')
  /** Only the public host creates the receiving native owner and its physical namespace. */
  const router = await createRpcHost(server.options)
  /** Every observer installs before transport and retains actual accepted readonly Session views. */
  const observe = async (name: string) => {
    /** A later directory refresh cannot mutate the original handshake snapshot. */
    const descriptions: IRpcSessionView[] = []
    /** This flow has no execution capability; it receives only canonical accepted metadata. */
    const feature = defineFlowPlugin({
      name: `${name}-directory`,
      setup: () => ({
        observe(event) {
          if (event.kind === HostObservationKind.peerReady)
            descriptions.push(event.data as IRpcSessionView)
        }
      })
    })
    /** The existing fixture installs this genuine cold flow before its connecting transport. */
    const connected = await server.connect(name, { plugins: [feature] })
    return { host: connected.host, descriptions }
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
      router.memory.peers.provider!.api as unknown as Readonly<{
        value(payload?: unknown): Promise<unknown>
      }>
    ).value
    router.provide({ held })
    expect(
      [...before.descriptions[0]!.methods.values()].find(
        (entry) => entry.name === 'provider.api.value'
      )
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
          [...after.descriptions[0]!.methods.values()].find(
            (entry) => entry.name === 'provider.api.value'
          )
        ).toMatchObject({
          idempotent: false,
          input: { type: 'string' },
          output: { type: 'string' }
        })
        expect(
          [...after.descriptions[0]!.methods.values()].find((entry) => entry.name === 'held')
        ).toMatchObject({ idempotent: true, input: { type: 'number' } })
        expect(before.descriptions).toHaveLength(1)
        expect(await after.host.memory.send('router', 'provider.api.value', 'current')).toBe(
          'current'
        )
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
