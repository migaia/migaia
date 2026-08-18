import * as EventSubscriber from '../src/index.js';
import {
  createEventChannel,
  createEventHub,
  type IEventAbortSignal,
  type IEventSubscriber
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('public exports', () => {
  it('ES-T16 exposes one root with all runtime helpers', () => {
    expect(EventSubscriber.createEventChannel).toBeTypeOf('function');
    expect(EventSubscriber.createEventHub).toBeTypeOf('function');
    expect(EventSubscriber.publishParallel).toBeTypeOf('function');
    expect(EventSubscriber.publishSerial).toBeTypeOf('function');
    expect(EventSubscriber.publishTask).toBeTypeOf('function');
    expect(EventSubscriber.subscribeOnce).toBeTypeOf('function');
    expect(EventSubscriber.subscribeUntil).toBeTypeOf('function');
    expect('createCanonicalChannel' in EventSubscriber).toBe(false);
    expect('getCapability' in EventSubscriber).toBe(false);
  });

  it('ES-T01 keeps public type contracts structural and payload-associated', () => {
    class Subscriber implements IEventSubscriber<number, string> {
      handle(event: { value: number }): string {
        return String(event.value);
      }
    }
    const channel = createEventChannel<number, string>();
    channel.subscribe((event) => new Subscriber().handle(event));
    createEventHub<{ message: string }>({
      report: (failure) => {
        const message: string = failure.event.value;
        void message;
      }
    });
    const signal: IEventAbortSignal = {
      aborted: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    };
    channel.subscribeUntil(signal, () => 'ok');
    expect(channel.size).toBe(2);

    const typeNegativeCases = (): void => {
      // @ts-expect-error listener must be callable
      channel.subscribe(123);
      const typedHub = createEventHub<{ message: string }>();
      // @ts-expect-error key payload association must reject a number
      typedHub.publish('message', 123);
    };
    void typeNegativeCases;
  });

  it('ES-T48 accepts the host AbortSignal structure without lifecycle runtime import', () => {
    const channel = createEventChannel<number>();
    const nativeSignal: IEventAbortSignal = new AbortController().signal;
    const stop = channel.subscribeUntil(nativeSignal, () => undefined);
    expect(nativeSignal.aborted).toBe(false);
    stop();
  });
});
