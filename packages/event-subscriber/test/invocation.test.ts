import { describe, expect, it, vi } from 'vitest'
import {
  EventSubscriberErrorCode,
  createEventChannel,
  invokeEachLive,
  withSnapshotEntries
} from '../src/index.js'

describe('public invocation helpers', () => {
  it('ES-T163 closes each snapshot invocation after one use or completion', () => {
    const channel = createEventChannel<number, string>()
    channel.subscribe((event) => `first:${event.value}`)
    channel.subscribe((event) => `second:${event.value}`)

    let entries: readonly { invoke(): string | PromiseLike<string> }[] = []
    withSnapshotEntries(channel, 4, (captured) => {
      entries = captured
      expect(captured).toHaveLength(2)
      expect(captured[0]!.invoke()).toBe('first:4')
      expect(() => captured[0]!.invoke()).toThrowError(
        expect.objectContaining({ code: EventSubscriberErrorCode.invocationClosed })
      )
    })
    expect(() => entries[1]!.invoke()).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invocationClosed })
    )
  })

  it('ES-T164 keeps live invocation visitation append-visible and releases on visitor failure', () => {
    const channel = createEventChannel<number, string>()
    const seen: string[] = []
    const first = vi.fn(() => {
      channel.subscribe(() => 'late')
      return 'first'
    })
    channel.subscribe(first)

    invokeEachLive(channel, 1, (invocation) => {
      seen.push(invocation.invoke() as string)
    })
    expect(seen).toEqual(['first', 'late'])

    const failure = new Error('visitor failed')
    expect(() =>
      invokeEachLive(channel, 1, () => {
        throw failure
      })
    ).toThrow(failure)
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('ES-T165 closes a live entry after invoke and after visitor cleanup', () => {
    const channel = createEventChannel<number, string>()
    channel.subscribe(() => 'value')
    let captured: { invoke(): string | PromiseLike<string> } | undefined

    invokeEachLive(channel, 1, (invocation) => {
      captured = invocation
      expect(invocation.invoke()).toBe('value')
    })
    expect(() => captured!.invoke()).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invocationClosed })
    )

    const failure = new Error('live visitor failure')
    expect(() =>
      invokeEachLive(channel, 1, (invocation) => {
        captured = invocation
        throw failure
      })
    ).toThrow(failure)
    expect(() => captured!.invoke()).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invocationClosed })
    )
  })

  it('ES-T166 preserves off/add epoch boundaries while retaining already-appended entries', () => {
    const channel = createEventChannel<number, string>()
    const seen: string[] = []
    let releaseInitial!: () => void
    releaseInitial = channel.subscribe(() => 'initial')
    invokeEachLive(channel, 1, (invocation) => {
      seen.push(invocation.invoke() as string)
      releaseInitial()
      channel.subscribe(() => 'after-off')
    })
    expect(seen).toEqual(['initial'])

    const second = createEventChannel<number, string>()
    let releaseAdded!: () => void
    second.subscribe(() => {
      releaseAdded = second.subscribe(() => 'appended')
      return 'first'
    })
    invokeEachLive(second, 1, (invocation) => {
      const result = invocation.invoke() as string
      seen.push(result)
      if (result === 'appended') releaseAdded()
    })
    expect(seen).toEqual(['initial', 'first', 'appended'])
  })

  it('ES-T167 keeps clear from revisiting removed registrations in later passes', () => {
    const channel = createEventChannel<number, string>()
    const seen: string[] = []
    channel.subscribe(() => 'first')
    channel.subscribe(() => 'second')
    invokeEachLive(channel, 1, (invocation) => {
      seen.push(`outer:${invocation.invoke() as string}`)
      if (seen.length === 1) {
        channel.clear()
      }
    })
    expect(seen).toEqual(['outer:first', 'outer:second'])
    invokeEachLive(channel, 1, (invocation) => {
      seen.push(`later:${invocation.invoke() as string}`)
    })
    expect(seen).toEqual(['outer:first', 'outer:second'])
  })

  it('ES-T171 keeps nested live passes independently ordered', () => {
    const channel = createEventChannel<number, string>()
    const seen: string[] = []
    channel.subscribe(() => 'first')
    invokeEachLive(channel, 1, (invocation) => {
      seen.push(`outer:${invocation.invoke() as string}`)
      invokeEachLive(channel, 1, (nested) => {
        seen.push(`nested:${nested.invoke() as string}`)
      })
    })
    expect(seen).toEqual(['outer:first', 'nested:first'])
  })

  it('ES-T173 MRC-C-T03 reports one failed projection after snapshot completion', () => {
    const report = vi.fn()
    const seen: unknown[] = []
    const channel = createEventChannel<
      { readonly data: { readonly leaf: number } },
      void,
      { readonly readPath: 'data.leaf'; readonly alias: 'resource' }
    >({ valueConfig: { readPath: 'data.leaf', alias: 'resource' }, report })
    channel.subscribe((event) => {
      seen.push(event.resource)
    })

    withSnapshotEntries(channel, {} as never, (entries) => {
      entries[0]!.invoke()
    })

    expect(seen).toEqual([undefined])
    expect(report).toHaveBeenCalledOnce()
    expect(report.mock.calls[0]![0].error).toMatchObject({
      code: EventSubscriberErrorCode.valueProjectionFailed
    })
  })

  it('ES-T174 MRC-C-T04 isolates default handles and keeps release idempotent', () => {
    const channel = createEventChannel<number>()
    const listener = vi.fn()
    const firstRelease = channel.subscribe(listener)
    const secondRelease = channel.subscribe(listener)

    expect(channel.size).toBe(2)
    firstRelease()
    firstRelease()
    expect(channel.size).toBe(1)
    channel.publish(1)
    expect(listener).toHaveBeenCalledOnce()

    secondRelease()
    secondRelease()
    expect(channel.size).toBe(0)
  })

  it('ES-T175 MRC-C-T03 exposes a nested addition to both active live passes', () => {
    const channel = createEventChannel<number, string>()
    const seen: string[] = []
    let added = false
    channel.subscribe(() => 'first')

    invokeEachLive(channel, 1, (invocation) => {
      seen.push(`outer:${invocation.invoke() as string}`)
      if (added) return
      added = true
      channel.subscribe(() => 'added')
      invokeEachLive(channel, 1, (nested) => {
        seen.push(`nested:${nested.invoke() as string}`)
      })
    })

    expect(seen).toEqual(['outer:first', 'nested:first', 'nested:added', 'outer:added'])
  })

  it('ES-T178 keeps native recursion through 256 and spills synchronously at 257', () => {
    for (const target of [255, 256, 257]) {
      const channel = createEventChannel<number>()
      const seen: number[] = []
      let active = 0
      let maximumActive = 0
      channel.subscribe((event) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        seen.push(event.value)
        if (event.value < target) channel.publish(event.value + 1)
        active -= 1
      })

      expect(() => channel.publish(0)).not.toThrow()
      expect(seen).toEqual(Array.from({ length: target + 1 }, (_, index) => index))
      expect(maximumActive).toBeLessThanOrEqual(256)
    }
  })

  it('ES-T179 preserves child call order and full descendant subtrees before the next listener', () => {
    const channel = createEventChannel<number>()
    const seen: string[] = []
    channel.subscribe((event) => {
      seen.push(`first-start:${event.value}`)
      if (event.value === 0) {
        channel.publish(1)
        channel.publish(2)
      }
      seen.push(`first-end:${event.value}`)
    })
    channel.subscribe((event) => {
      seen.push(`second:${event.value}`)
    })

    channel.publish(0)

    expect(seen).toEqual([
      'first-start:0',
      'first-start:1',
      'first-end:1',
      'second:1',
      'first-start:2',
      'first-end:2',
      'second:2',
      'first-end:0',
      'second:0'
    ])
  })

  it('ES-T180 applies one exact budget to self-loop and two-node cycles at 100, 10000, and 100000', () => {
    for (const publishBudget of [100, 10_000, 100_000]) {
      const channel = createEventChannel<number>({ publishBudget })
      channel.subscribe((event) => channel.publish(event.value))

      expect(() => channel.publish(1)).toThrowError(
        expect.objectContaining({
          code: EventSubscriberErrorCode.publishFailed,
          detail: expect.objectContaining({ processed: publishBudget, remaining: 0 })
        })
      )
    }

    const twoNode = createEventChannel<number>({ publishBudget: 100 })
    twoNode.subscribe((event) => {
      if (event.value === 1) twoNode.publish(2)
    })
    twoNode.subscribe((event) => {
      if (event.value === 2) twoNode.publish(1)
    })
    expect(() => twoNode.publish(1)).toThrowError(
      expect.objectContaining({
        detail: expect.objectContaining({ processed: 100, remaining: 0 })
      })
    )
  })

  it('ES-T181 retains failure identity with exhaustion and resets the next root transaction', () => {
    const channel = createEventChannel<number>({ publishBudget: 1 })
    const failure = new Error('listener failed')
    channel.subscribe(() => {
      throw failure
    })
    channel.subscribe(() => undefined)

    let thrown: unknown
    try {
      channel.publish(1)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({
      code: EventSubscriberErrorCode.publishFailed,
      detail: expect.objectContaining({
        processed: 1,
        remaining: 0,
        causalSummary: [failure]
      })
    })
    expect((thrown as AggregateError).errors[0]).toBe(failure)

    channel.clear()
    channel.subscribe(() => undefined)
    expect(() => channel.publish(2)).not.toThrow()
  })

  it('ES-T168 filters live entries by task selector', () => {
    const channel = createEventChannel<number, string>()
    const seen: string[] = []
    channel.subscribe(() => 'selected', { taskId: 'selected' })
    channel.subscribe(() => 'other', { taskId: 'other' })
    invokeEachLive(channel.filterTaskId('selected'), 1, (invocation) => {
      seen.push(invocation.invoke() as string)
    })
    expect(seen).toEqual(['selected'])
  })

  it('ES-T169 reports one projection diagnostic for a completed snapshot batch', () => {
    let reads = 0
    const report = vi.fn()
    const channel = createEventChannel<
      { readonly data: { readonly leaf: number } },
      void,
      undefined,
      { readonly readPath: 'data.leaf'; readonly alias: 'resource' }
    >({ valueConfig: { readPath: 'data.leaf', alias: 'resource' }, report })
    const value = {
      data: {
        get leaf(): number {
          reads += 1
          return 7
        }
      }
    }
    channel.subscribe((event) => expect(event.resource).toBe(7))
    channel.subscribe((event) => expect(event.resource).toBe(7))

    withSnapshotEntries(channel, value, (entries) => {
      for (const invocation of entries) invocation.invoke()
    })
    expect(reads).toBe(1)
    expect(report).not.toHaveBeenCalled()
  })

  it('ES-T170 applies listener-all identity removal without exposing channel ownership', () => {
    const channel = createEventChannel<number, void>({ removalPolicy: 'listener-all' })
    const listener = vi.fn()
    const release = channel.subscribe(listener)
    channel.subscribe(listener)
    release()
    channel.publish(1)
    expect(listener).not.toHaveBeenCalled()
  })

  it('ES-T176 bounds recursive cycles with one synchronous partial-delivery error', () => {
    const channel = createEventChannel<number>({ publishBudget: 3 })
    let calls = 0
    channel.subscribe((event) => {
      calls += 1
      channel.publish(event.value)
    })

    expect(() => channel.publish(1)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.publishFailed,
        detail: expect.objectContaining({ processed: 3, remaining: 0 })
      })
    )
    expect(calls).toBe(3)
  })

  it('ES-T177 bounds queued cycles and clears transaction state for the next publish', () => {
    const channel = createEventChannel<number>({ dispatchPolicy: 'queued', publishBudget: 2 })
    channel.subscribe((event) => channel.publish(event.value))

    expect(() => channel.publish(1)).toThrowError(
      expect.objectContaining({
        detail: expect.objectContaining({ processed: 2, remaining: 0 })
      })
    )
    expect(() => channel.publish(1)).toThrowError(
      expect.objectContaining({
        detail: expect.objectContaining({ processed: 2, remaining: 0 })
      })
    )
  })
})
