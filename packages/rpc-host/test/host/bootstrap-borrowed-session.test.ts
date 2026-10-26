import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { coreMemoryServer } from './core-fixture.js'

// RPC-TEST-B2526C80E8FC-C004: retain original borrowed-session lifetime through actual SDK handles.
it('lends the actual listener session with disposal confined to that peer', async () => {
  /** The original installed native listener lends only its canonical Session lookup authority. */
  const server = coreMemoryServer('borrowed-server')
  /** One actual root Host owns both accepted Sessions and their unchanged namespace calls. */
  const host = await createRpcHost(server.options)
  /** Two real clients expose independently callable original providers. */
  const first = await server.connect('first', { provide: { value: () => 1 } })
  /** The surviving client retains its own physical pair and Session after its sibling closes. */
  const second = await server.connect('second', { provide: { value: () => 2 } })
  try {
    /** Only successful canonical lookups contribute membership; two attempted connects do not. */
    const accepted = [
      server.lookup(first.host.self.instanceId),
      server.lookup(second.host.self.instanceId)
    ].filter((receipt) => receipt !== undefined)
    // RPC-TEST-B2526C80E8FC-C004-A001: both accepted handles come from the actual Table index.
    expect(accepted).toHaveLength(2)
    // A002's retired endpoint-constructor count is archived under BC3, without a substitute counter.
    await accepted[0]!.handle.close()
    // A departed name rejects with its own departure reason; only that Session is affected.
    await expect(host.memory.send('first', 'value')).rejects.toMatchObject({
      code: 'ENDPOINT_DISPOSED'
    })
    // RPC-TEST-B2526C80E8FC-C004-A004: its independently owned sibling remains callable.
    expect(await host.memory.send('second', 'value')).toBe(2)
    // RPC-TEST-B2526C80E8FC-C004-A005: closing the borrowed handle releases its actual physical end.
    expect(first.pair[0].closed).toBe(true)
    // RPC-TEST-B2526C80E8FC-C004-A006: no sibling physical ownership is transferred.
    expect(second.pair[0].closed).toBe(false)
  } finally {
    await first.host.close()
    await second.host.close()
    await host.close()
  }
})
