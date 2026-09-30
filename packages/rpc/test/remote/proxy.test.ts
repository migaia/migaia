import { describe, expect, it } from 'vitest'
import { RpcRemoteLayerErrorCode } from '../../src/remote/error-code.js'
import { createRemoteGenerationHolder } from '../../src/remote/proxy.js'
import { remoteHarness } from './fixture.js'

describe('A2 remote generation proxy', () => {
  it('describes before publishing, revokes on leave, then rebinds the same proxy', async () => {
    const fixture = remoteHarness()
    const signal = new AbortController().signal
    const first = await fixture.registration.prepareGeneration(signal, fixture.own)
    expect(first).toBe(1)
    expect(fixture.calls).toEqual(['channel.open', 'endpoint.create'])
    expect(fixture.sends.map((entry) => entry.method)).toEqual(['migaia.remote.describe'])
    const proxy = fixture.registration.featureProxies().f!.request!
    await expect(proxy(['first'])).resolves.toBe('result')
    const leaves: string[] = []
    fixture.registration.events.onLeave(1, () => leaves.push('leave'))
    fixture.emit({ type: 'exit', generation: 1, reason: 'crashed', error: 'gone' })
    expect(leaves).toEqual(['leave'])
    expect(fixture.registration.events.current()).toEqual({ generation: 1, active: false })
    await expect(proxy(['closed'])).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.closed,
      detail: { generation: 1 },
      cause: 'gone'
    })
    const ready = fixture.registration.events.whenReady(1)
    fixture.nextGeneration()
    await fixture.registration.prepareGeneration(signal, fixture.own)
    await expect(ready).resolves.toBe(2)
    await expect(proxy(['second'])).resolves.toBe('result')
    expect(fixture.sends.map((entry) => entry.method)).toEqual([
      'migaia.remote.describe',
      'p.f.request',
      'migaia.remote.describe',
      'p.f.request'
    ])
    await fixture.registration.release()
    expect(fixture.calls.filter((entry) => entry === 'endpoint.dispose')).toHaveLength(2)
    expect(fixture.calls.filter((entry) => entry === 'channel.close')).toHaveLength(2)
  })

  it('rejects scheduler mismatch before endpoint construction', async () => {
    const fixture = remoteHarness({}, true)
    await expect(
      fixture.registration.prepareGeneration(new AbortController().signal, fixture.own)
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(fixture.calls).not.toContain('endpoint.create')
  })

  it('runs guard before the unavailable-generation gate and reports listener errors', async () => {
    const guardError = new Error('guard')
    const fixture = remoteHarness({
      callGuard: {
        beforeDispatch() {
          throw guardError
        }
      }
    })
    const proxy = fixture.registration.featureProxies().f!.request!
    await expect(proxy([])).rejects.toBe(guardError)
    expect(fixture.sends).toHaveLength(0)
    await fixture.registration.prepareGeneration(new AbortController().signal, fixture.own)
    fixture.registration.events.onLeave(1, () => {
      throw new Error('listener')
    })
    fixture.emit({ type: 'exit', generation: 1, reason: 'crashed' })
    expect(fixture.calls.some((entry) => entry.includes('report:Error: listener'))).toBe(true)
  })

  it('shares one holder between first preparation and replacement cleanup', async () => {
    const fixture = remoteHarness()
    const reports: unknown[] = []
    const holder = createRemoteGenerationHolder(fixture.registration, (error) =>
      reports.push(error)
    )
    await holder.prepareInitial(new AbortController().signal)
    fixture.emit({ type: 'exit', generation: 1, reason: 'crashed' })
    fixture.nextGeneration()
    await holder.prepareRebind(new AbortController().signal)
    await holder.release()
    expect(reports).toEqual([])
    expect(fixture.calls.filter((entry) => entry === 'endpoint.dispose')).toHaveLength(2)
    expect(fixture.calls.filter((entry) => entry === 'channel.close')).toHaveLength(2)
  })
})
