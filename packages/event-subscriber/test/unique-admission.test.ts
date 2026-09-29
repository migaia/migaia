import { describe, expect, it } from 'vitest'
import { createEventChannel, EventAdmissionPolicy, EventSubscriberErrorCode } from '../src/index.js'

describe('channel admission policies', () => {
  it('ES-T189 ESUA A8 exports the stable admission modes without a sync error policy', () => {
    expect(EventAdmissionPolicy).toEqual({ multiple: 'multiple', unique: 'unique' })
  })

  it('ES-T190 ESUA A9 rejects an invalid mode and preserves default duplicate and throw behavior', () => {
    /** Runtime validation must reject a value that TypeScript already excludes. */
    let invalid: unknown
    try {
      // @ts-expect-error invalid policy is also rejected at runtime
      createEventChannel<number>({ admissionPolicy: 'x' })
    } catch (error) {
      invalid = error
    }
    expect(invalid).toBeInstanceOf(TypeError)
    expect(invalid).toMatchObject({ code: EventSubscriberErrorCode.invalidOptions })
    expect(() => {
      // @ts-expect-error null is an invalid runtime option, not the default mode
      createEventChannel<number>({ admissionPolicy: null })
    }).toThrowError(TypeError)

    /** The default mode still owns one registration per subscription. */
    const channel = createEventChannel<number>()
    const listener = () => undefined
    channel.subscribe(listener)
    channel.subscribe(listener)
    expect(channel.size).toBe(2)

    /** Synchronous listener failures still leave the package as aggregate publish failures. */
    const failure = new Error('fixture listener failure')
    channel.subscribe(() => {
      throw failure
    })
    try {
      channel.publish(1)
      throw new Error('publish should fail')
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect(error).toMatchObject({ code: EventSubscriberErrorCode.publishFailed })
      expect((error as AggregateError).errors).toContain(failure)
    }
  })
})
