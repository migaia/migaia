/** Auth completion retention follows actual acquired native custody, not a caller-selected flag. */
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { threadPlugin } from '../../../rpc-plugin-thread/dist/threads/index.js'
import { createFixtureAuthentication } from '../../../rpc-plugin-thread/test/threads/fixtures/dx-authentication.mjs'

it('releases completed request IDs on a genuine exclusive Node Worker source beyond1024', async () => {
  /** This existing Worker independently installs real Auth; it is not automatic native Auth proof. */
  const host = await createRpcHost({
    plugins: [
      auth(createFixtureAuthentication()),
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
