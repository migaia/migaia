/** Original provider input snapshots are observed through real public Hosts and directories. */
import { createRpcHost } from '@migaia/rpc-host'
import { expect, it } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

// RPC-TEST-366FF2AC3AFB-C006-A002: public directory retains the original captured provider count.
it('retains one captured provider after public source mutation', async () => {
  /** The actual native listener performs no acquisition during cold configuration construction. */
  const server = coreMemoryServer('provider-snapshot-host')
  /** Later source mutation must not replace the originally captured provider. */
  const providerMap = { echo: (): unknown => 'snapshot' }
  /**
   * Public provide retains its supported own-data configuration instead of a retired private
   * getter.
   */
  const host = await createRpcHost({
    ...server.options,
    provide: providerMap
  })
  /** A genuine client observes the captured provider through its accepted public directory. */
  let client: Awaited<ReturnType<typeof server.connect>> | undefined
  try {
    providerMap.echo = () => ({ ok: false, message: 'mutated', code: 'MUTATED' })
    client = await server.connect('snapshot-client')
    expect(Object.keys(client.host.memory.peers['provider-snapshot-host']!)).toHaveLength(1)
    expect(await client.host.memory.send('provider-snapshot-host', 'echo')).toBe('snapshot')
  } finally {
    await client?.host.close()
    await host.close()
  }
})

// RPC-TEST-366FF2AC3AFB-C011-A002: all three captured providers remain publicly callable.
it('retains three captured providers and their results after public source mutation', async () => {
  /** These original functions enter the public catalog as supported own data descriptors. */
  const providerMap = { alpha: (): unknown => 'alpha', beta: () => 'beta', gamma: () => 'gamma' }
  /** A real public listener publishes exactly the captured methods to an accepted client. */
  const server = coreMemoryServer('provider-entry-snapshot-host')
  /** The actual public boundary uses one ordinary provider map without invoking accessors. */
  const host = await createRpcHost({
    ...server.options,
    provide: providerMap
  })
  /** The client directory supplies the public registration-count witness. */
  let client: Awaited<ReturnType<typeof server.connect>> | undefined
  try {
    Object.defineProperty(providerMap, 'alpha', {
      configurable: true,
      enumerable: true,
      value: () => ({ mutated: true })
    })
    client = await server.connect('entry-snapshot-client')
    expect(Object.keys(client.host.memory.peers['provider-entry-snapshot-host']!)).toHaveLength(3)
    expect(await client.host.memory.send('provider-entry-snapshot-host', 'alpha')).toBe('alpha')
    expect(await client.host.memory.send('provider-entry-snapshot-host', 'beta')).toBe('beta')
    expect(await client.host.memory.send('provider-entry-snapshot-host', 'gamma')).toBe('gamma')
  } finally {
    await client?.host.close()
    await host.close()
  }
})
