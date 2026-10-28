import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMicroHub, defineContract, event, getMicroHub, request } from '../src/index.ts'
import { events } from '../src/events/index.ts'

/** Releases the singleton and restores real clocks between independent app lifetimes. */
afterEach(async () => {
  vi.useRealTimers()
  try {
    await getMicroHub().dispose()
  } catch (error) {
    if ((error as { code?: string }).code !== 'HUB_NOT_CREATED') throw error
  }
})

describe('events and requests', () => {
  it('delivers events in order and releases listeners at unsubscribe and disconnect', async () => {
    /** Event-only contract used by both applications. */
    const contract = defineContract('notifications', {
      version: 1,
      events: { changed: event<number>() }
    })
    /** Hub owning both app lifetimes. */
    const hub = createMicroHub({ plugins: [events()] })
    /** Publisher retaining ownership across listener removal. */
    const owner = hub.connect('owner').own(contract)
    /** Consumer whose remaining listener is released on disconnect. */
    const consumer = hub.connect('consumer')
    /** Actual delivery sequence across emits. */
    const seen: string[] = []
    /** Explicitly removable first subscription. */
    const stop = consumer.use(contract).events.changed.on((value) => seen.push(`first:${value}`))
    consumer.use(contract).events.changed.on((value) => seen.push(`second:${value}`))
    owner.events.changed.emit(1)
    stop()
    stop()
    owner.events.changed.emit(2)
    await consumer.disconnect()
    owner.events.changed.emit(3)
    expect(seen).toEqual(['first:1', 'second:1', 'second:2'])
  })

  it('reports listener failures and still delivers to the next listener', () => {
    /** Reporter receives the aggregate preserving the original listener error. */
    const report = vi.fn()
    /** Concrete listener failure preserved through the event boundary. */
    const failure = new Error('listener failed')
    /** Next listener must remain reachable after a prior failure. */
    const listener = vi.fn()
    /** Shared event contract. */
    const contract = defineContract('failures', { version: 1, events: { changed: event() } })
    /** Live owner and event subscriptions. */
    const owned = createMicroHub({ plugins: [events()], report })
      .connect('owner')
      .own(contract)
    owned.events.changed.on(() => {
      throw failure
    })
    owned.events.changed.on(listener)
    expect(() => owned.events.changed.emit(undefined)).not.toThrow()
    expect(listener).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ errors: [failure] }))
  })

  it('bounds queued event reentrancy and reports exhausted delivery', () => {
    /** Reporter records the bounded feedback loop's diagnostic. */
    const report = vi.fn()
    /** Recursive event contract. */
    const contract = defineContract('feedback', {
      version: 1,
      events: { changed: event<number>() }
    })
    /** Owner emits back into the currently draining channel. */
    const owned = createMicroHub({ plugins: [events({ publishBudget: 3 })], report })
      .connect('owner')
      .own(contract)
    /** Values prove queued delivery stops at the configured budget. */
    const seen: number[] = []
    owned.events.changed.on((value) => {
      seen.push(value)
      owned.events.changed.emit(value + 1)
    })
    owned.events.changed.emit(1)
    expect(seen).toEqual([1, 2, 3])
    expect(report).toHaveBeenCalledOnce()
    expect(report.mock.calls[0]?.[0]).toMatchObject({ code: 'PUBLISH_FAILED' })
  })

  it('routes a request to its single named handler and supports replacing it', async () => {
    /** Two request names must select different handlers rather than broadcast. */
    const contract = defineContract('tasks', {
      version: 1,
      requests: { double: request<number, number>(), label: request<number, string>() }
    })
    /** Hub and apps sharing the request channels. */
    const hub = createMicroHub({ plugins: [events()] })
    /** Handler ownership. */
    const owned = hub.connect('owner').own(contract)
    /** Caller view remains stable while a handler is replaced. */
    const view = hub.connect('caller').use(contract)
    /** Explicit unregistration permits a new handler with the same request name. */
    const stop = owned.handle('double', (input) => input * 2)
    owned.handle('label', async (input) => `value:${input}`)
    await expect(view.requests.double(4)).resolves.toBe(8)
    await expect(view.requests.label(4)).resolves.toBe('value:4')
    expect(() => owned.handle('double', (input) => input)).toThrow(
      expect.objectContaining({ code: 'HANDLER_DUPLICATED' })
    )
    stop()
    stop()
    owned.handle('double', (input) => input * 3)
    await expect(view.requests.double(4)).resolves.toBe(12)
  })

  it('rejects an unknown handler name and requests without an owner', async () => {
    /** One declared request limits the valid handler names. */
    const contract = defineContract('absent', {
      version: 1,
      requests: { value: request<void, number>() }
    })
    /** Hub keeps the owner and caller in one realm. */
    const hub = createMicroHub({ plugins: [events()] })
    /** Caller is allowed to use the contract before its owner mounts. */
    const view = hub.connect('caller').use(contract)
    await expect(view.requests.value(undefined)).rejects.toMatchObject({
      source: 'micro-frontend.hub',
      code: 'OWNER_ABSENT'
    })
    /** Owner validates names at the handler registration boundary. */
    const owned = hub.connect('owner').own(contract)
    expect(() => owned.handle('missing' as 'value', () => 1)).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
  })

  it('waits only for the requested handler and dispatches when it appears', async () => {
    /** Separate names ensure unrelated registration cannot satisfy the waiter. */
    const contract = defineContract('late', {
      version: 1,
      requests: { wanted: request<number, number>(), other: request<void, number>() }
    })
    /** Hub contains a caller that arrives before the owner. */
    const hub = createMicroHub({ plugins: [events()] })
    /** Pending call is registered before ownership exists. */
    const pending = hub.connect('caller').use(contract).requests.wanted(4, { waitForOwner: 1000 })
    /** Late owner adds an unrelated handler first. */
    const owned = hub.connect('owner').own(contract)
    owned.handle('other', () => 0)
    owned.handle('wanted', (input) => input + 1)
    await expect(pending).resolves.toBe(5)
  })

  it('rejects an elapsed owner wait with the hub timeout contract', async () => {
    vi.useFakeTimers()
    /** Owner intentionally never arrives. */
    const contract = defineContract('deadline', { version: 1, requests: { value: request() } })
    /** Waiter under a deterministic deadline. */
    const pending = createMicroHub({ plugins: [events()] })
      .connect('caller')
      .use(contract)
      .requests.value(undefined, { waitForOwner: 20 })
    /** Attach rejection assertion before advancing the deadline. */
    const rejection = expect(pending).rejects.toMatchObject({ code: 'OWNER_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(20)
    await rejection
  })

  it('cancels an owner wait when the caller disconnects', async () => {
    /** Contract stays unowned for this app lifetime. */
    const contract = defineContract('cancelwait', { version: 1, requests: { value: request() } })
    /** Caller owns its pending-wait cleanup. */
    const app = createMicroHub({ plugins: [events()] }).connect('caller')
    /** Rejection observer is attached before synchronous disconnect cleanup. */
    const rejection = expect(
      app.use(contract).requests.value(undefined, { waitForOwner: 1000 })
    ).rejects.toMatchObject({ code: 'APP_DISCONNECTED' })
    await app.disconnect()
    await rejection
  })

  it('does not start a waited request after the caller disconnects in the registration turn', async () => {
    /** Handler registration resumes waiting requests in a later microtask. */
    const contract = defineContract('registrationrace', {
      version: 1,
      requests: { value: request<void, number>() }
    })
    /** Hub coordinates both apps during the same synchronous turn. */
    const hub = createMicroHub({ plugins: [events()] })
    /** Caller disconnects after its wait resolves but before dispatch. */
    const caller = hub.connect('caller')
    /** Pending wait must check the caller again before invoking this handler. */
    const handler = vi.fn(() => 1)
    /** Observe rejection before disconnect can reject the request. */
    const rejection = expect(
      caller.use(contract).requests.value(undefined, { waitForOwner: 1000 })
    ).rejects.toMatchObject({ code: 'APP_DISCONNECTED' })
    hub.connect('owner').own(contract).handle('value', handler)
    await caller.disconnect()
    await rejection
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns OWNER_ABSENT when a newly registered handler leaves before wait dispatch', async () => {
    /** Owner release can happen in the registration turn. */
    const contract = defineContract('ownerrace', {
      version: 1,
      requests: { value: request<void, number>() }
    })
    /** Hub contains the pending caller. */
    const hub = createMicroHub({ plugins: [events()] })
    /** Wait cannot leak event-subscriber's task-selection error. */
    const pending = hub
      .connect('caller')
      .use(contract)
      .requests.value(undefined, { waitForOwner: 1000 })
    /** Owner exits before the async caller resumes. */
    const owned = hub.connect('owner').own(contract)
    owned.handle('value', () => 1)
    owned.release()
    await expect(pending).rejects.toMatchObject({
      source: 'micro-frontend.hub',
      code: 'OWNER_ABSENT'
    })
  })

  it('rejects in-flight requests on owner release and ignores the late result', async () => {
    /** The handler remains pending until after its ownership ends. */
    const contract = defineContract('ownerleaves', {
      version: 1,
      requests: { value: request<void, number>() }
    })
    /** Hub and ownership being released. */
    const hub = createMicroHub({ plugins: [events()] })
    /** Resolver simulates a late transport completion. */
    let resolve!: (value: number) => void
    /** Result outlives the owner but must not revive the request. */
    const result = new Promise<number>((done) => {
      resolve = done
    })
    /** Owned handler returns a still-pending result. */
    const owned = hub.connect('owner').own(contract)
    owned.handle('value', () => result)
    /** Caller observes owner loss rather than hanging forever. */
    const rejection = expect(
      hub.connect('caller').use(contract).requests.value(undefined)
    ).rejects.toMatchObject({ code: 'OWNER_GONE' })
    owned.release()
    resolve(10)
    await rejection
  })

  it('preserves a handler failure in the task aggregate', async () => {
    /** Concrete original error must remain reachable to the caller. */
    const failure = new Error('task failed')
    /** One request with a rejecting handler. */
    const contract = defineContract('taskfailure', { version: 1, requests: { value: request() } })
    /** Hub used to route the failure. */
    const hub = createMicroHub({ plugins: [events()] })
    hub
      .connect('owner')
      .own(contract)
      .handle('value', async () => {
        throw failure
      })
    await expect(
      hub.connect('caller').use(contract).requests.value(undefined)
    ).rejects.toMatchObject({
      code: 'PUBLISH_FAILED',
      errors: [failure]
    })
  })
})
