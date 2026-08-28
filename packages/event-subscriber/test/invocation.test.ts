import { describe, expect, it, vi } from 'vitest'
import {
  EventSubscriberErrorCode,
  createEventChannel,
  invokeEachLive,
  invokeSnapshotEntries
} from '../src/index.js'

describe('public invocation helpers', () => {
  it('ES-T163 closes each snapshot invocation after one use or completion', () => {
    const channel = createEventChannel<number, string>()
    channel.subscribe((event) => `first:${event.value}`)
    channel.subscribe((event) => `second:${event.value}`)

    const batch = invokeSnapshotEntries(channel, 4)
    expect(batch.entries).toHaveLength(2)
    expect(batch.entries[0]!.invoke()).toBe('first:4')
    expect(() => batch.entries[0]!.invoke()).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invocationClosed })
    )
    batch.complete()
    expect(() => batch.entries[1]!.invoke()).toThrowError(
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

    const batch = invokeSnapshotEntries(channel, {} as never)
    batch.entries[0]!.invoke()
    batch.complete()
    batch.complete()

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

    const batch = invokeSnapshotEntries(channel, value)
    for (const invocation of batch.entries) invocation.invoke()
    batch.complete()
    batch.complete()
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
})
