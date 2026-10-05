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
    removeA()
    removeB()
    const watch = outlet.watch()
    const pending = watch.next()
    publisher.publish(event, (error) => reports.push(error))
    assert.deepEqual(await pending, { done: false, value: event })
    const finishing = watch.next()
    await watch.return!()
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
  } finally {
    for (const host of hosts) await host.dispose()
    channels.close()
  }
})
