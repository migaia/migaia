import { describe, expect, it } from 'vitest'
import { remoteHarness } from './fixture.js'

describe('A9 remote stream dispatch', () => {
  it.each(['generator', 'asyncGenerator'] as const)(
    '%s opens the stream only at first next and never sends a request',
    async (mode) => {
      const fixture = remoteHarness()
      await fixture.registration.prepareGeneration(new AbortController().signal, fixture.own)
      const iterator = fixture.registration.invokeStream(`p.f.${mode}`, [])
      expect(fixture.calls).not.toContain('stream.open')
      await expect(iterator.next()).resolves.toEqual({ value: 'item', done: false })
      expect(fixture.calls.filter((call) => call === 'stream.open')).toHaveLength(1)
      expect(fixture.sends.map((entry) => entry.method)).toEqual(['migaia.remote.describe'])
    }
  )

  it('rejects stream-only forbidden idempotency options before guard or open', async () => {
    let guards = 0
    const fixture = remoteHarness({
      callGuard: {
        beforeDispatch() {
          guards += 1
        }
      }
    })
    await fixture.registration.prepareGeneration(new AbortController().signal, fixture.own)
    const iterator = fixture.registration.invokeStream('p.f.generator', [], {
      idempotencyKey: 'key'
    })
    await expect(iterator.next()).rejects.toMatchObject({ code: 'REMOTE_CONTRACT_INVALID' })
    expect(guards).toBe(0)
    expect(fixture.calls).not.toContain('stream.open')
  })
})
