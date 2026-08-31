import * as EventSubscriber from '../src/index.js'
import { readFileSync } from 'node:fs'
import {
  createEventChannel,
  createEventHub,
  type IEventAbortSignal,
  type IEventSubscriber
} from '../src/index.js'
import { describe, expect, it } from 'vitest'
import * as SubscriberEntry from '../src/subscriber.js'

describe('public exports', () => {
  it('ES-T182 exposes subscription helpers through the focused subscriber entry', () => {
    expect(SubscriberEntry.subscribeOnce).toBe(EventSubscriber.subscribeOnce)
    expect(SubscriberEntry.subscribeUntil).toBe(EventSubscriber.subscribeUntil)
    expect(SubscriberEntry.subscribeSubscriber).toBe(EventSubscriber.subscribeSubscriber)
  })

  it('ES-T16 exposes one root with all runtime helpers', () => {
    expect(EventSubscriber.createEventChannel).toBeTypeOf('function')
    expect(EventSubscriber.createEventHub).toBeTypeOf('function')
    expect(EventSubscriber.invokeParallelSettled).toBeTypeOf('function')
    expect(EventSubscriber.invokeParallel).toBeTypeOf('function')
    expect(EventSubscriber.invokeSerialSettled).toBeTypeOf('function')
    expect(EventSubscriber.invokeSerial).toBeTypeOf('function')
    expect(EventSubscriber.invokeTaskSettled).toBeTypeOf('function')
    expect(EventSubscriber.invokeTask).toBeTypeOf('function')
    expect('publishParallelSettled' in EventSubscriber).toBe(false)
    expect('publishParallel' in EventSubscriber).toBe(false)
    expect('publishSerialSettled' in EventSubscriber).toBe(false)
    expect('publishSerial' in EventSubscriber).toBe(false)
    expect('publishTaskSettled' in EventSubscriber).toBe(false)
    expect('publishTask' in EventSubscriber).toBe(false)
    expect(EventSubscriber.subscribeOnce).toBeTypeOf('function')
    expect(EventSubscriber.subscribeUntil).toBeTypeOf('function')
    expect('createCanonicalChannel' in EventSubscriber).toBe(false)
    expect('getCapability' in EventSubscriber).toBe(false)
  })

  it('ES-T01 keeps public type contracts structural and payload-associated', () => {
    class Subscriber implements IEventSubscriber<number, string> {
      handle(event: { value: number }): string {
        return String(event.value)
      }
    }
    const channel = createEventChannel<number, string>()
    channel.subscribe((event) => new Subscriber().handle(event))
    createEventHub<{ message: string }>({
      report: (failure) => {
        const message: string = failure.event.value
        void message
      }
    })
    const signal: IEventAbortSignal = {
      aborted: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
    channel.subscribeUntil(signal, () => 'ok')
    expect(channel.size).toBe(2)

    const typeNegativeCases = (): void => {
      // @ts-expect-error listener must be callable
      channel.subscribe(123)
      const typedHub = createEventHub<{ message: string }>()
      // @ts-expect-error key payload association must reject a number
      typedHub.publish('message', 123)
      const finite = createEventHub<{ alpha: number; beta: string }>()
      const finiteChain = finite.subscribe('alpha', (event) => {
        const value: number = event.value
        void value
      })
      finiteChain.subscribe('beta', (event) => {
        const value: string = event.value
        void value
      })
      // @ts-expect-error finite chain rejects a repeated key while an independent chain permits it
      finiteChain.subscribe('alpha', () => undefined)
      const dynamic = createEventHub<Record<string, number>>()
      dynamic.subscribe('runtime-key', () => undefined).subscribe('runtime-key', () => undefined)
    }
    void typeNegativeCases
  })

  it('ES-T48 accepts the host AbortSignal structure without lifecycle runtime import', () => {
    const channel = createEventChannel<number>()
    const nativeSignal: IEventAbortSignal = new AbortController().signal
    const stop = channel.subscribeUntil(nativeSignal, () => undefined)
    expect(nativeSignal.aborted).toBe(false)
    stop()
  })

  it('ES-T110 keeps implementation-only handle factory out of root exports', () => {
    expect('createSubscriptionHandle' in EventSubscriber).toBe(false)
    expect('ISubscriptionHandle' in EventSubscriber).toBe(false)
    const sourceRoot = new URL('../src/', import.meta.url)
    const source = ['internal/subscription.ts', 'channel.ts', 'hub.ts']
      .map((file) => readFileSync(new URL(file, sourceRoot), 'utf8'))
      .join('\n')
    expect(source.match(/createRawSubscriptionOwner/g)?.length).toBeGreaterThanOrEqual(3)
    expect(source).not.toMatch(/hub\.subscribe\(/)
    expect(source).not.toMatch(/\.(bind|call|apply)\(/)
    expect(source).not.toMatch(/export\s+(?:const|function)\s+registerRaw/)
  })
})
