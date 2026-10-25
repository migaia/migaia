/** Original verifier principal failures use actual current Process/native authentication owners. */
import { describe, expect, it } from 'vitest'
import { NativeSocketAuth } from './fixtures/native-socket-auth.js'

describe('process socket principal admission', () => {
  it.each(['', { unexpected: true }] as const)(
    'refuses a principal that is not a nonempty string',
    async (principal) => {
      /** Real public roots retain native verification, readiness and exact original failure objects. */
      const fixture = new NativeSocketAuth()
      await fixture.listen(() => principal as string)
      try {
        /** The actual server readiness/error outlet independently observes native admission. */
        const rejected = fixture.connection.then(
          () => undefined,
          (error: unknown) => error
        )
        /** Success has no asserted payload; avoid formatting a disposed Host proxy on a real RED. */
        const opening = fixture.connect('token').then(() => undefined)
        await expect(opening).rejects.toBeDefined()
        await expect(rejected).resolves.toMatchObject({ code: 'PROCESS_CHANNEL_AUTH_REJECTED' })
      } finally {
        await fixture.close()
      }
    }
  )
})
