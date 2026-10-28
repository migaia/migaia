/** Credential verification follows the receiver-free contract used by other Auth callbacks. */
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins'
import { coreMemoryServer } from '../../host/core-fixture.ts'

it('calls verifyCredentials without a receiver through a public connection', async () => {
  /** A normal function exposes the receiver chosen by the production call site. */
  const receivers: unknown[] = []
  /** The public handshake must retain the same credential argument and principal result. */
  function verifyCredentials(this: unknown, value: unknown) {
    receivers.push(this)
    expect(value).toBe('receiver-token')
    return { principalId: 'receiver-principal' }
  }
  /** Both hosts use the existing native transport fixture rather than a synthetic Auth runner. */
  const server = coreMemoryServer('receiver-server')
  /** Host-level Auth verifies the real client hello before business calls are admitted. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [authFeature({ verifyCredentials }), ...server.options.plugins],
    provide: { echo: (value) => value }
  })
  /** Cleanup owns a client only after its public construction has completed. */
  let client: Awaited<ReturnType<typeof server.connect>> | undefined
  try {
    client = await server.connect('receiver-client', {
      plugins: [authFeature({ credentials: 'receiver-token' })]
    })
    expect(await client.host.memory.send('receiver-server', 'echo', 42)).toBe(42)
    expect(receivers).not.toHaveLength(0)
    for (const receiver of receivers) expect(receiver).toBeUndefined()
  } finally {
    await Promise.all([client?.host.close(), host.close()])
  }
})
