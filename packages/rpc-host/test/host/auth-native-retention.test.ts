import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
/** Default completed-ID release and invalid retention use actual native Worker sources. */
import { expect, it } from 'vitest'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { threadPlugin } from '../../../rpc-plugin-thread/dist/threads/index.js'
import { createFixtureAuthentication } from '../../../rpc-plugin-thread/test/threads/fixtures/dx-authentication.mjs'

it('releases default completed request IDs beyond1024 on a genuine native Node Worker source', async () => {
  /** This existing Worker independently installs real Auth; it is not automatic native Auth proof. */
  const host = await createRpcHost({
    plugins: [
      rpcFeaturesPlugin({ features: { auth: authFeature(createFixtureAuthentication()) } }),
      threadPlugin({
        name: 'thread',
        spawn: {
          entry: new URL(
            '../../../rpc-plugin-thread/test/threads/fixtures/dx-signed-worker.mjs',
            import.meta.url
          ),
          data: { signed: true }
        }
      })
    ]
  })
  try {
    for (let index = 0; index < 1025; index++) {
      /** Each new call reaches the original provider and completes before the next one starts. */
      const buffer = new Uint8Array([7]).buffer
      expect(await host.thread.send('thread', 'bytes.inspect', buffer)).toEqual({
        length: 1,
        first: 7
      })
    }
    /** The actual Worker business counter rules out replayed or fabricated local responses. */
    expect(await host.thread.send('thread', 'bytes.calls')).toBe(1025)
  } finally {
    await host.close()
  }
}, 15_000)

it('preserves invalid connection retention as the public native Worker configuration failure', async () => {
  /** Unexpected successful construction must still release its actual public Host and Worker. */
  let host: Pick<IRpcHost, 'close'> | undefined
  try {
    await expect(
      createRpcHost({
        plugins: [
          rpcFeaturesPlugin({ features: { auth: authFeature(createFixtureAuthentication()) } }),
          threadPlugin({
            name: 'thread',
            connect: { retain: 0 },
            spawn: {
              entry: new URL(
                '../../../rpc-plugin-thread/test/threads/fixtures/dx-signed-worker.mjs',
                import.meta.url
              ),
              data: { signed: true }
            }
          })
        ]
      }).then((created) => {
        host = created
      })
    ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'INVALID_CONFIG' })
  } finally {
    await host?.close()
  }
})
