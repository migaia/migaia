import { describe, expect, it } from 'vitest'
import { remoteHarness } from './fixture.js'

describe('A6 logical idempotency key', () => {
  it('keeps an explicit key through retry dispatch and core send', async () => {
    let factoryCalls = 0
    const observed: { key?: string; idempotent: boolean; generation: number }[] = []
    const fixture = remoteHarness({
      keyFactory() {
        factoryCalls += 1
        return 'factory-key'
      },
      retryPort: {
        dispatch(input) {
          observed.push({
            key: input.key,
            idempotent: input.idempotent,
            generation: input.generation
          })
          return input.sendOnce({ expectedGeneration: input.generation, key: input.key })
        }
      }
    })
    await fixture.registration.prepareGeneration(new AbortController().signal, fixture.own)
    await expect(
      fixture.registration.invokeRequest('p.f.request', ['x'], { idempotencyKey: 'explicit' })
    ).resolves.toBe('result')
    expect(factoryCalls).toBe(0)
    expect(observed).toEqual([{ key: 'explicit', idempotent: true, generation: 1 }])
    expect(fixture.sends.at(-1)?.options).toMatchObject({ idempotencyKey: 'explicit' })
  })

  it('rejects an invalid explicit key as the original core error before dispatch', async () => {
    let dispatches = 0
    const fixture = remoteHarness({
      retryPort: {
        dispatch() {
          dispatches += 1
          return Promise.resolve('never')
        }
      }
    })
    await fixture.registration.prepareGeneration(new AbortController().signal, fixture.own)
    const response = fixture.registration.invokeRequest('p.f.request', [], {
      idempotencyKey: 'bad key'
    })
    await expect(response).rejects.toMatchObject({ code: 'CONTRACT_INVALID' })
    expect(dispatches).toBe(0)
    expect(fixture.sends).toHaveLength(1)
  })

  it('keeps keyFactory exceptions as rejected Promise values', async () => {
    const failure = new Error('factory')
    const fixture = remoteHarness({
      keyFactory() {
        throw failure
      }
    })
    await fixture.registration.prepareGeneration(new AbortController().signal, fixture.own)
    const response = fixture.registration.invokeRequest('p.f.request', [])
    await expect(response).rejects.toBe(failure)
    expect(fixture.sends).toHaveLength(1)
  })
})
