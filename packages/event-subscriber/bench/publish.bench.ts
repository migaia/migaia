import assert from 'node:assert/strict'
import type { createEventChannel } from '../dist/index.js'

/** Builds the same distinct empty listener fan-out used by micro-hub S3. */
export function createPublishFixture(
  createChannel: typeof createEventChannel,
  listeners: number,
  instrumented: boolean
) {
  /** Queued dispatch matches the event plugin while keeping the channel cost isolated. */
  const channel = createChannel<number>({ dispatchPolicy: 'queued' })
  /** Caller-visible release handles stay reachable until the fixture is disposed. */
  const releases: (() => void)[] = []
  /** Independent instrumentation proves actual fan-out without counting in timed listeners. */
  let calls = 0
  /** Count publishes only in the independent instrumentation round. */
  let operationCalls = 0
  /** Observed prefix demonstrates registration order in the instrumentation round. */
  const sequence: number[] = []
  for (let index = 0; index < listeners; index++) {
    releases.push(
      channel.subscribe(
        instrumented
          ? () => {
              calls++
              if (sequence.length < 64) sequence.push(index)
            }
          : () => undefined
      )
    )
  }
  return {
    update: instrumented
      ? (value: number): void => {
          operationCalls++
          channel.publish(value)
        }
      : (value: number): void => channel.publish(value),
    inspect: (operations: number) => {
      assert.equal(channel.size, listeners)
      if (instrumented) {
        assert.equal(operationCalls, operations)
        assert.equal(calls, operations * listeners)
      }
      return {
        operationCalls,
        listenerCalls: calls,
        expectedListenerCalls: operations * listeners,
        sequence
      }
    },
    dispose: (): void => {
      for (const release of releases) release()
      assert.equal(channel.size, 0)
    }
  }
}
