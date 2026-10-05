import assert from 'node:assert/strict'
import { it } from 'vitest'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import { readRuntimeOutletConnection } from '../../src/remote/runtime-api/outlet.js'
import { runtimeSources, runtimeTestHost } from './fixture.js'

it('[A41][A42] target queries return safe promises and apply source/name/direction filters before business dispatch', async () => {
  /** Genuine Hosts retain the original committed registration and ready indexes. */
  const hosts = [
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    }),
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
  ] as const
  /** Real transport sends independently expose hidden query RPC or lifecycle mutation. */
  const channels = runtimeSources()
  /** Each original send is observed without replacing its native behavior. */
  let frames = 0
  for (const transport of channels.transports) {
    const send = transport.send
    transport.send = (...args) => {
      frames += 1
      return Reflect.apply(send, transport, args)
    }
  }
  try {
    await Promise.all(
      hosts.map((host, index) =>
        host.use(
          createThreadPlugin({
            name: 'remote',
            self: { name: `side-${index}`, instanceId: `side-${index}` },
            connect: channels.sources[index]!,
            provide: { echo: (value: unknown) => value },
            report: () => undefined
          })
        )
      )
    )
    /** The public query must match the original Peer's own selected connection projection. */
    const outlet = hosts[0].thread!
    const connection = readRuntimeOutletConnection(outlet, 'remote')!
    assert.ok(connection)
    const before = frames
    const pending = outlet.get('remote')
    assert.ok(pending instanceof Promise, '[A41] get is an asynchronous safe query')
    const detail = await pending
    /** Different cold reads have distinct observation times but the same owner fields and values. */
    const comparable = (value: unknown) =>
      JSON.parse(JSON.stringify(value, (key, item) => (key === 'observedAt' ? undefined : item)))
    assert.deepEqual(
      comparable(detail),
      comparable((await connection.peer.describe()).connections[0])
    )
    assert.deepEqual(comparable(await outlet.get('side-1')), comparable(detail))
    assert.deepEqual(
      comparable(JSON.parse(await outlet.get('remote', { format: 'json' }))),
      comparable(detail)
    )
    for (const format of ['yaml', 'toml'] as const)
      assert.equal(typeof (await outlet.get('remote', { format })), 'string')
    assert.equal(
      (
        await outlet.list({
          filter: { name: { exact: 'remote' }, kind: 'connect', direction: 'connect' }
        })
      ).connections.length,
      1
    )
    assert.equal((await outlet.list({ filter: { name: { exact: 'rem' } } })).connections.length, 0)
    assert.equal(
      (await outlet.list({ filter: { name: { prefix: 'rem' }, kind: 'spawn' } })).connections
        .length,
      0
    )
    assert.equal((await outlet.list({ filter: { name: { prefix: 'rem' } } })).connections.length, 1)
    for (const filter of [
      { state: 'invented' },
      { kind: 'spawned' },
      { name: { exact: 'remote', prefix: 'rem' } }
    ])
      await assert.rejects(outlet.list({ filter } as never), { code: 'INVALID_CONFIG' })
    await assert.rejects(outlet.get('missing'), { code: 'TARGET_UNKNOWN' })
    assert.equal(
      frames,
      before,
      '[A41] all query formats and filters send zero hidden management frames'
    )
    assert.equal(await outlet.request('remote', 'echo', 42), 42)
  } finally {
    for (const host of hosts) await host.dispose()
    channels.close()
  }
})
