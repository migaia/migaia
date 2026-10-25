/** Original verifier rejection and token privacy use the actual current native auth installation. */
import { expect, it } from 'vitest'
import { createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'
import { RpcWireHandshakeStep } from '@migaia/rpc-contract/protocol'
import { NativeSocketAuth } from './fixtures/native-socket-auth.js'

it('rejects verifier failure with fixed wire error and no token in diagnostics', async () => {
  /** The original adversarial credential remains local fixture data on the real native recipe. */
  const token = 'secret-token-only-in-hello'
  /** The public hosts and original Process carrier supply readiness, reports and actual wire bytes. */
  const fixture = new NativeSocketAuth()
  await fixture.listen(() => {
    throw new Error(token)
  })
  try {
    /** Both outcomes come from actual public client startup and native server admission. */
    const attempts = await Promise.allSettled([
      fixture.connect(token).then(() => undefined),
      fixture.connection
    ])
    expect(attempts.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    /** The canonical framer reads actual original raw writes without recreating wire admission. */
    const frames: string[] = []
    /** Only a real rejection frame can satisfy the original fixed-wire-error assertion. */
    const decoder = createRpcStreamFrameDecoder({
      onFrame: (bytes) => {
        frames.push(new TextDecoder().decode(bytes))
      },
      onError: (error) => {
        throw error
      }
    })
    for (const write of fixture.writes) decoder.push(write)
    /**
     * Current bilateral negotiation may write more frames; the original rejecting wire fact
     * remains.
     */
    const rejectText = frames.find((text) => JSON.parse(text).step === RpcWireHandshakeStep.reject)
    expect(rejectText).toContain('PROCESS_CHANNEL_AUTH_REJECTED')
    expect(rejectText).not.toContain(token)
    expect(JSON.stringify(fixture.reports)).not.toContain(token)
    expect(fixture.reports).toEqual([
      expect.objectContaining({
        source: 'rpc.transport.process',
        code: 'PROCESS_CHANNEL_AUTH_REJECTED'
      })
    ])
  } finally {
    await fixture.close()
  }
})
