import assert from 'node:assert/strict'
import { it } from 'vitest'
import * as runtimeOutlet from '../../src/remote/runtime-api/outlet.js'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import { runtimeSources, runtimeTestHost } from './fixture.js'

it('[A53][A54] one original outlet publisher snapshots listeners and closes bounded watch iterators', async () => {
  /** Real Host registrations mint the publisher; structural facades cannot replace its ownership. */
  const hosts = [
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    }),
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
  ] as const
  const channels = runtimeSources()
  /** These original listener failures retain exact identity and are reported once each. */
  const failure = new Error('event listener fixture failure')
  const late = new Error('event thenable fixture failure')
  const reports: unknown[] = []
  try {
    await Promise.all(
      hosts.map((host, index) =>
        host.use(
          createThreadPlugin({
            name: 'remote',
            connect: channels.sources[index]!,
            report: (error) => reports.push(error)
          })
        )
      )
    )
    /** Query-only type erasure permits semantic RED before the event API exists. */
    const outlet = hosts[0].thread! as unknown as {
      on(name: string, listener: (event: unknown) => unknown): () => void
      watch(): AsyncIterableIterator<unknown>
    }
    assert.equal(
      typeof outlet.on,
      'function',
      '[A53] the original outlet owns passive event subscriptions'
    )
    const read = Reflect.get(runtimeOutlet, 'readRuntimeOutletEvents') as (value: object) => {
      publish(
        event: {
          type: string
          name: string
          generation: number
          instanceId: string
          timestamp: number
          clock: string
        },
        report: (error: unknown) => void
      ): void
    }
    /**
     * Only listener-adapter assertions inject fixed safe facts; native fact origins are tested
     * separately.
     */
    const publisher = read(outlet)
    assert.throws(
      () => outlet.on('unknown-event', () => undefined),
      { code: 'INVALID_CONFIG' },
      '[A53] unsupported event names cannot create subscriptions'
    )
    assert.throws(() => outlet.on('ready', undefined as unknown as (event: unknown) => unknown), {
      code: 'INVALID_CONFIG'
    })
    const sequence: string[] = []
    let removeA: () => void = () => undefined
    let removeB: () => void = () => undefined
    removeA = outlet.on('ready', () => {
      sequence.push('A')
      removeA()
      removeB()
      outlet.on('ready', () => sequence.push('D'))
    })
    removeB = outlet.on('ready', () => {
      sequence.push('B')
      throw failure
    })
    outlet.on('ready', () => {
      sequence.push('C')
      return Promise.reject(late)
    })
    const event = {
      type: 'ready',
      name: 'remote',
      generation: 1,
      instanceId: 'first',
      timestamp: 1,
      clock: 'scheduler'
    }
    publisher.publish(event, (error) => reports.push(error))
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(sequence, ['A', 'B', 'C'])
    publisher.publish(event, (error) => reports.push(error))
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(sequence, ['A', 'B', 'C', 'C', 'D'])
    assert.equal(reports.filter((error) => error === failure).length, 1)
    assert.equal(reports.filter((error) => error === late).length, 2)
    /** A returned then getter can fail before assimilation; the original failure must be reported. */
    const getterFailure = new RangeError('event then getter fixture failure')
    const removeGetter = outlet.on(
      'ready',
      () =>
        new Proxy(
          {},
          {
            get: (_target, property) => {
              if (property === 'then') throw getterFailure
              return undefined
            }
          }
        )
    )
    publisher.publish(event, (error) => reports.push(error))
    removeGetter()
    assert.equal(reports.filter((error) => error === getterFailure).length, 1)
    removeA()
    removeB()
    const watch = outlet.watch()
    const pending = watch.next()
    publisher.publish(event, (error) => reports.push(error))
    assert.deepEqual(await pending, { done: false, value: event })
    const finishing = watch.next()
    await watch.return!()
    /** Buffered events preserve publication order when the consumer was not already awaiting next. */
    const buffered = outlet.watch()
    assert.equal(buffered[Symbol.asyncIterator](), buffered)
    publisher.publish({ ...event, timestamp: 10 }, (error) => reports.push(error))
    publisher.publish({ ...event, timestamp: 11 }, (error) => reports.push(error))
    assert.equal(Reflect.get((await buffered.next()).value as object, 'timestamp'), 10)
    assert.equal(Reflect.get((await buffered.next()).value as object, 'timestamp'), 11)
    await buffered.return!()
    assert.deepEqual(await buffered.next(), { done: true, value: undefined })
    assert.deepEqual(await finishing, { done: true, value: undefined })
    await watch.return!()
    const thrown = outlet.watch()
    const waiting = thrown.next()
    const pendingFailure = assert.rejects(waiting, (error) => error === failure)
    await assert.rejects(thrown.throw!(failure), (error) => error === failure)
    await pendingFailure
    /** Undefined is a valid thrown value; pending reads must reject rather than look closed. */
    const undefinedThrow = outlet.watch()
    const undefinedRead = undefinedThrow.next().then(
      () => ({ rejected: false }),
      (error: unknown) => ({ rejected: true, error })
    )
    await undefinedThrow.throw!(undefined).catch(() => undefined)
    assert.deepEqual(await undefinedRead, { rejected: true, error: undefined })
    const slow = outlet.watch()
    for (let index = 0; index < 101; index += 1)
      publisher.publish({ ...event, timestamp: index }, (error) => reports.push(error))
    await assert.rejects(slow.next(), {
      source: '@migaia/rpc/remote',
      code: 'RUNTIME_EVENT_OVERFLOW'
    })
    assert.equal(
      reports.filter(
        (error) =>
          error &&
          typeof error === 'object' &&
          Reflect.get(error, 'code') === 'RUNTIME_EVENT_OVERFLOW'
      ).length,
      1
    )
    const closing = outlet.watch()
    const closed = closing.next()
    await hosts[0].dispose()
    assert.deepEqual(await closed, { done: true, value: undefined })
    /** Closed subscriptions and newly created watches never revive the retired publisher. */
    const afterClose = outlet.watch()
    assert.deepEqual(await afterClose.next(), { done: true, value: undefined })
    const unsubscribeClosed = outlet.on('ready', () =>
      assert.fail('[A53] closed publisher revived')
    )
    unsubscribeClosed()
    publisher.publish(event, (error) => reports.push(error))
  } finally {
    for (const host of hosts) await host.dispose()
    channels.close()
  }
})
