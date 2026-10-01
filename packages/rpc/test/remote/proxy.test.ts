import { describe, expect, it, vi } from 'vitest'
import { RpcRemoteLayerErrorCode } from '../../src/remote/error-code.js'
import { createRemoteGenerationHolder, createRemoteRegistration } from '../../src/remote/proxy.js'
import { remoteHarness } from './fixture.js'

describe('A2 remote generation proxy', () => {
  it('[A8] uses the default retry port for a sent idempotent request', async () => {
    const fixture = remoteHarness()
    const originalSend = fixture.served.endpoint.send
    /** The first generation leaves while its provider result remains unsettled. */
    let rejectFirst: ((reason: unknown) => void) | undefined
    fixture.served.endpoint.send = async (peer, method, params, options) => {
      if (method === 'p.f.request' && !rejectFirst)
        return new Promise((_, reject) => {
          rejectFirst = reject
        })
      return originalSend(peer, method, params, options)
    }
    await fixture.registration.prepareGeneration(new AbortController().signal, fixture.own)
    const result = fixture.registration.invokeRequest('p.f.request', [])
    fixture.emit({ type: 'exit', generation: 1, reason: 'crashed', error: new Error('gone') })
    fixture.nextGeneration()
    await fixture.registration.prepareGeneration(new AbortController().signal, fixture.own)
    await expect(result).resolves.toBe('result')
    expect(fixture.sends.filter((entry) => entry.method === 'p.f.request')).toHaveLength(1)
    rejectFirst?.(new Error('late failure'))
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
    expect(fixture.calls.filter((entry) => entry.startsWith('report:'))).toHaveLength(1)
    await fixture.registration.release()
  })

  it('[A9] settles a sent request when release leaves its active generation', async () => {
    const fixture = remoteHarness()
    const send = fixture.served.endpoint.send
    fixture.served.endpoint.send = async (peer, method, params, options) =>
      method === 'p.f.request' ? new Promise(() => undefined) : send(peer, method, params, options)
    await fixture.registration.prepareGeneration(new AbortController().signal, fixture.own)
    const result = fixture.registration.invokeRequest('p.f.request', [])
    const release = fixture.registration.release()
    await expect(result).rejects.toMatchObject({ code: 'REMOTE_RESULT_UNKNOWN' })
    await release
  })

  it('describes before publishing, revokes on leave, then rebinds the same proxy', async () => {
    const fixture = remoteHarness()
    const signal = new AbortController().signal
    const first = await fixture.registration.prepareGeneration(signal, fixture.own)
    expect(first).toBe(1)
    expect(fixture.calls).toEqual(['channel.open', 'endpoint.create'])
    expect(fixture.sends.map((entry) => entry.method)).toEqual(['migaia.remote.describe'])
    expect(fixture.sends[0]?.options).toMatchObject({ signal })
    const proxy = fixture.registration.featureProxies().f!.request!
    await expect(proxy(['first'])).resolves.toBe('result')
    const leaves: string[] = []
    fixture.registration.events.onLeave(1, () => {
      leaves.push('leave')
      fixture.calls.push('leave.listener')
    })
    fixture.emit({ type: 'exit', generation: 1, reason: 'crashed', error: 'gone' })
    expect(leaves).toEqual(['leave'])
    expect(fixture.calls.indexOf('leave.listener')).toBeLessThan(
      fixture.calls.indexOf('endpoint.dispose')
    )
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

  it('rejects a generation that exits during describe and closes its candidate', async () => {
    /** The gate holds the describe response until the supervisor reports an exit. */
    let releaseDescribe: (() => void) | undefined
    const describeGate = new Promise<void>((resolve) => {
      releaseDescribe = resolve
    })
    let enteredDescribe: (() => void) | undefined
    const describing = new Promise<void>((resolve) => {
      enteredDescribe = resolve
    })
    const fixture = remoteHarness()
    const send = fixture.served.endpoint.send
    fixture.served.endpoint.send = async (peer, method, data, options) => {
      if (method === 'migaia.remote.describe') {
        enteredDescribe?.()
        await describeGate
      }
      return send(peer, method, data, options)
    }
    const ready = fixture.registration.events.whenReady(0)
    const pending = fixture.registration.prepareGeneration(
      new AbortController().signal,
      fixture.own
    )
    await describing
    fixture.emit({ type: 'exit', generation: 1, reason: 'crashed', error: 'gone' })
    releaseDescribe?.()
    await expect(pending).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.closed,
      detail: { generation: 1 }
    })
    expect(fixture.registration.events.current().active).toBe(false)
    expect(fixture.calls).toContain('endpoint.dispose')
    expect(fixture.calls).toContain('channel.close')
    await fixture.registration.release()
    await expect(ready).rejects.toMatchObject({ code: RpcRemoteLayerErrorCode.closed })
  })

  it('closes a channel returned after release before endpoint construction', async () => {
    const fixture = remoteHarness()
    /** The opening gate models a channel delivered after the registration is released. */
    let deliverChannel: (() => void) | undefined
    let opening: (() => void) | undefined
    const opened = new Promise<void>((resolve) => {
      opening = resolve
    })
    const gate = new Promise<void>((resolve) => {
      deliverChannel = resolve
    })
    const registration = createRemoteRegistration({
      contract: fixture.registration.contract,
      binding: {
        ...fixture.binding,
        async openChannel() {
          opening?.()
          await gate
          return fixture.channel
        }
      },
      endpointFactory: async () => fixture.served,
      report: () => undefined
    })
    const holder = createRemoteGenerationHolder(registration, () => undefined)
    const pending = holder.prepareInitial(new AbortController().signal)
    await opened
    await holder.release()
    deliverChannel?.()
    await expect(pending).rejects.toMatchObject({ code: RpcRemoteLayerErrorCode.closed })
    expect(fixture.calls.filter((call) => call === 'channel.close')).toHaveLength(1)
    expect(fixture.calls).not.toContain('endpoint.dispose')
  })

  it('disposes a late endpoint and channel after setup cancellation', async () => {
    const fixture = remoteHarness()
    const controller = new AbortController()
    /** Endpoint construction pauses after the channel was acquired. */
    let deliverEndpoint: (() => void) | undefined
    let constructing: (() => void) | undefined
    const entered = new Promise<void>((resolve) => {
      constructing = resolve
    })
    const gate = new Promise<void>((resolve) => {
      deliverEndpoint = resolve
    })
    const registration = createRemoteRegistration({
      contract: fixture.registration.contract,
      binding: fixture.binding,
      endpointFactory: async () => {
        constructing?.()
        await gate
        return fixture.served
      },
      report: () => undefined
    })
    const holder = createRemoteGenerationHolder(registration, () => undefined)
    const pending = holder.prepareInitial(controller.signal)
    await entered
    controller.abort(new Error('setup cancelled'))
    deliverEndpoint?.()
    await expect(pending).rejects.toThrow('setup cancelled')
    expect(fixture.calls.filter((call) => call === 'endpoint.dispose')).toHaveLength(1)
    expect(fixture.calls.filter((call) => call === 'channel.close')).toHaveLength(1)
    await holder.release()
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

  it('retains a departing group until closure finishes, then keeps only the current generation', async () => {
    const fixture = remoteHarness()
    /** The first endpoint remains open until the test explicitly completes its close. */
    let finishClose: (() => void) | undefined
    const closeGate = new Promise<void>((resolve) => {
      finishClose = resolve
    })
    const dispose = fixture.served.endpoint.dispose
    fixture.served.endpoint.dispose = async () => {
      await closeGate
      await dispose()
    }
    const holder = createRemoteGenerationHolder(fixture.registration, () => undefined)
    await holder.prepareInitial(new AbortController().signal)
    expect(holder.retainedResourceCount()).toBe(2)
    fixture.emit({ type: 'exit', generation: 1, reason: 'crashed' })
    expect(holder.retainedResourceCount()).toBe(2)
    finishClose?.()
    await fixture.registration.whenClosed(1)
    await Promise.resolve()
    expect(holder.retainedResourceCount()).toBe(0)

    for (let generation = 2; generation <= 6; generation += 1) {
      fixture.nextGeneration()
      await holder.prepareRebind(new AbortController().signal)
      expect(holder.retainedResourceCount()).toBe(2)
      if (generation === 6) break
      fixture.emit({ type: 'exit', generation, reason: 'crashed' })
      await fixture.registration.whenClosed(generation)
      await Promise.resolve()
    }
    await holder.release()
    expect(holder.retainedResourceCount()).toBe(0)
  })

  it('preserves every old leave reason by identity until release, then reports closed', async () => {
    const fixture = remoteHarness()
    const holder = createRemoteGenerationHolder(fixture.registration, () => undefined)
    /** Each reason represents one distinct supervisor exit object. */
    const reasons = Array.from({ length: 5 }, (_, index) => new Error(`exit ${index + 1}`))
    for (const [index, reason] of reasons.entries()) {
      const generation = index + 1
      if (generation === 1) await holder.prepareInitial(new AbortController().signal)
      else {
        fixture.nextGeneration()
        await holder.prepareRebind(new AbortController().signal)
      }
      fixture.emit({ type: 'exit', generation, reason: 'crashed', error: reason })
      await fixture.registration.whenClosed(generation)
    }
    expect(fixture.registration.departedReasonCount()).toBe(5)
    for (const [index, reason] of reasons.entries()) {
      const seen = await new Promise<unknown>((resolve) => {
        fixture.registration.events.onLeave(index + 1, resolve)
      })
      expect(seen).toBe(reason)
    }
    await holder.release()
    expect(fixture.registration.departedReasonCount()).toBe(0)
    const afterRelease = await new Promise<unknown>((resolve) => {
      fixture.registration.events.onLeave(1, resolve)
    })
    expect(afterRelease).toMatchObject({ code: RpcRemoteLayerErrorCode.closed })
    expect(afterRelease).not.toBe(reasons[0])
  })

  it('caps request and stream deadlines while one-way sends without call options', async () => {
    const fixture = remoteHarness()
    const streamOpen = vi.spyOn(fixture.served.stream!, 'open')
    const registration = createRemoteRegistration({
      contract: fixture.registration.contract,
      binding: fixture.binding,
      endpointFactory: async () => fixture.served,
      callDeadlineCapMs: 50,
      report: () => undefined
    })
    await registration.prepareGeneration(new AbortController().signal, () => undefined)
    await registration.invokeRequest('p.f.request', [], { timeoutMs: 90 })
    await registration.invokeRequest('p.f.request', [], { timeoutMs: 20 })
    expect(fixture.sends.slice(-2).map((entry) => entry.options)).toMatchObject([
      { timeoutMs: 50 },
      { timeoutMs: 20 }
    ])
    const stream = registration.invokeStream('p.f.generator', [], { timeoutMs: 90 })
    await stream.next()
    expect(fixture.calls).toContain('stream.open')
    expect(streamOpen).toHaveBeenCalledWith('peer', 'p.f.generator', [], { timeoutMs: 50 })
    const beforeOneWay = fixture.sends.length
    await registration.invokeOneWay('p.f.oneWay', [])
    expect(fixture.calls).toContain('oneWay.send')
    expect(fixture.sends).toHaveLength(beforeOneWay)
    await expect(
      registration.featureProxies().f!.oneWay!([], { timeoutMs: 1 }) as Promise<unknown>
    ).rejects.toMatchObject({ code: RpcRemoteLayerErrorCode.contractInvalid })
    await registration.release()
  })

  it('rejects readiness on terminal and release without reviving an old generation', async () => {
    const fixture = remoteHarness()
    const waiting = fixture.registration.events.whenReady(0)
    fixture.emit({ type: 'terminal', entry: 1, error: new Error('budget exhausted') })
    await expect(waiting).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.startFailed,
      detail: { state: 'terminal' }
    })
    await fixture.registration.release()
    await expect(fixture.registration.events.whenReady(0)).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.closed
    })
  })

  it('codes native aggregate errors from release and rebind rollback', async () => {
    const fixture = remoteHarness()
    const releaseFailure = new Error('release failed')
    const reports: unknown[] = []
    const registration = createRemoteRegistration({
      contract: fixture.registration.contract,
      binding: {
        ...fixture.binding,
        async openChannel() {
          return {
            ...fixture.channel,
            async close() {
              throw releaseFailure
            }
          }
        }
      },
      endpointFactory: async () => fixture.served,
      report: (error) => reports.push(error)
    })
    const holder = createRemoteGenerationHolder(registration, (error) => reports.push(error))
    await holder.prepareInitial(new AbortController().signal)
    const release = await holder.release().catch((error: unknown) => error)
    expect(release).toBeInstanceOf(AggregateError)
    expect(release).toMatchObject({ code: RpcRemoteLayerErrorCode.closed })
    expect((release as AggregateError).errors).toContain(releaseFailure)

    const next = remoteHarness()
    const primary = new Error('replacement failed')
    const rollbackFailure = new Error('rollback failed')
    let opens = 0
    let factories = 0
    const second = createRemoteRegistration({
      contract: next.registration.contract,
      binding: {
        ...next.binding,
        async openChannel() {
          opens += 1
          return {
            ...next.channel,
            async close() {
              if (opens === 2) throw rollbackFailure
            }
          }
        }
      },
      endpointFactory: async () => {
        factories += 1
        if (factories === 2) throw primary
        return next.served
      },
      report: (error) => reports.push(error)
    })
    const replacement = createRemoteGenerationHolder(second, (error) => reports.push(error))
    await replacement.prepareInitial(new AbortController().signal)
    next.emit({ type: 'exit', generation: 1, reason: 'crashed' })
    next.nextGeneration()
    await expect(replacement.prepareRebind(new AbortController().signal)).rejects.toBe(primary)
    const rollback = reports.find(
      (error) =>
        error instanceof AggregateError &&
        (error as AggregateError & { code?: string }).code === RpcRemoteLayerErrorCode.startFailed
    ) as AggregateError | undefined
    expect(rollback?.errors).toEqual([primary, rollbackFailure])
    await replacement.release()
  })
})
