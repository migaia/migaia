import { describe, expect, it } from 'vitest';
import {
  createRuntime,
  ReactiveTracePhase,
  ReactiveTraceType,
  type IRuntimeTraceEvent
} from '../src/index.js';
import { ReactiveTraceReason } from '../src/runtime/trace-constants.js';
import { createFieldSource } from '../src/runtime/source.js';

type IObserverRunEvent = Extract<
  IRuntimeTraceEvent,
  { readonly type: typeof ReactiveTraceType.observerRun }
>;

/** Selects observer-run events so source/dependency diagnostics do not affect span assertions. */
function observerRunEvents(events: readonly IRuntimeTraceEvent[]): IObserverRunEvent[] {
  return events.filter(
    (event): event is IObserverRunEvent => event.type === ReactiveTraceType.observerRun
  );
}

describe('RT28 diagnostic failures preserve graph commit', () => {
  it('RT28-T01: Signal setter commits value/version and dirties every subscriber after clock failure', () => {
    const events: IRuntimeTraceEvent[] = [];
    const reported: unknown[] = [];
    const scheduled: Array<() => void> = [];
    const timestampError = new Error('signal timestamp failed');
    let failTimestamp = false;
    const runtime = createRuntime({
      adapter: {
        timestamp: () => {
          if (failTimestamp) throw timestampError;
          return 100;
        }
      },
      onError: (error) => reported.push(error),
      onTrace: (event) => events.push(event)
    });
    runtime.setSchedulerStrategy((flush) => {
      scheduled.push(flush);
    });
    const source = runtime.signal(0);
    const computed = runtime.computed(() => source.value * 2);
    const values: number[] = [];
    const stop = runtime.effect(() => {
      values.push(computed.value);
    });
    const previousVersion = (source as unknown as { readonly version: number }).version;

    failTimestamp = true;
    expect(() => {
      source.value = 1;
    }).not.toThrow();
    failTimestamp = false;

    expect(source.peek()).toBe(1);
    expect((source as unknown as { readonly version: number }).version).toBeGreaterThan(
      previousVersion
    );
    scheduled.shift()?.();

    expect(values).toEqual([0, 2]);
    expect(runtime.flush()).toBe('completed');
    expect(scheduled).toHaveLength(0);
    expect(reported).toContain(timestampError);
    expect(
      events.some(
        (event) =>
          event.type === ReactiveTraceType.observableChange &&
          event.reason === ReactiveTraceReason.set &&
          event.timestamp === 0
      )
    ).toBe(true);
    const observerTraces = observerRunEvents(events);
    expect(observerTraces).toHaveLength(8);
    expect(observerTraces.filter((event) => event.phase === ReactiveTracePhase.start)).toHaveLength(
      4
    );
    expect(observerTraces.filter((event) => event.phase === ReactiveTracePhase.end)).toHaveLength(
      4
    );
    expect(observerTraces.filter((event) => event.phase === ReactiveTracePhase.error)).toHaveLength(
      0
    );

    stop();
    source.dispose();
    computed.dispose();
  });

  it('RT28-T02: dependency trace clock failure does not abort Computed or Effect graph admission', () => {
    const reported: unknown[] = [];
    const timestampError = new Error('dependency timestamp failed');
    let timestampCalls = 0;
    const runtime = createRuntime({
      adapter: {
        timestamp: () => {
          timestampCalls++;
          if (timestampCalls === 2) throw timestampError;
          return 200;
        }
      },
      onError: (error) => reported.push(error),
      onTrace: () => {}
    });
    const source = runtime.signal(1);
    let computedRuns = 0;
    const computed = runtime.computed(() => {
      computedRuns++;
      return source.value + 1;
    });

    expect(() => computed.peek()).not.toThrow();
    expect(computed.peek()).toBe(2);
    expect(computedRuns).toBe(1);
    expect(source.subs).toHaveLength(1);
    expect(reported).toContain(timestampError);

    source.value = 2;
    expect(computed.peek()).toBe(3);
    expect(computedRuns).toBe(2);

    timestampCalls = 0;
    let effectRuns = 0;
    const stop = runtime.effect(() => {
      effectRuns++;
      void computed.value;
    });
    expect(effectRuns).toBe(1);
    expect(computed.subs).toHaveLength(1);
    stop();
    computed.dispose();
    source.dispose();
  });

  it('RT28-T03: trace clock, sink, and reporter failures cannot replace setter semantics', () => {
    const timestampError = new Error('setter timestamp failed');
    const sinkError = new Error('setter trace sink failed');
    const reporterError = new Error('setter reporter failed');
    let failTimestamp = false;
    const runtime = createRuntime({
      adapter: {
        timestamp: () => {
          if (failTimestamp) throw timestampError;
          return 300;
        },
        reportError: () => {
          throw reporterError;
        }
      },
      onTrace: () => {
        throw sinkError;
      }
    });
    const source = runtime.signal(0);
    let runs = 0;
    const stop = runtime.effect(() => {
      runs++;
      void source.value;
    });
    const previousVersion = (source as unknown as { readonly version: number }).version;
    failTimestamp = true;

    expect(() => {
      source.value = 1;
    }).not.toThrow();
    expect(source.peek()).toBe(1);
    expect((source as unknown as { readonly version: number }).version).toBeGreaterThan(
      previousVersion
    );
    expect(runs).toBe(1);
    expect(runtime.flush()).toBe('completed');

    stop();
    source.dispose();
  });

  it('RT28-T04: Runtime source publish continues dirty propagation after observable trace failure', () => {
    const scheduled: Array<() => void> = [];
    const timestampError = new Error('source timestamp failed');
    let failTimestamp = false;
    const runtime = createRuntime({
      adapter: {
        timestamp: () => {
          if (failTimestamp) throw timestampError;
          return 400;
        }
      },
      onTrace: () => {}
    });
    runtime.setSchedulerStrategy((flush) => {
      scheduled.push(flush);
    });
    const source = createFieldSource(runtime, 'round28-source');
    let runs = 0;
    const stop = runtime.effect(() => {
      source.track();
      runs++;
    });

    failTimestamp = true;
    expect(() => source.notify()).not.toThrow();
    failTimestamp = false;
    expect(runs).toBe(1);
    scheduled.shift()?.();
    expect(runs).toBe(2);
    expect(runtime.flush()).toBe('completed');

    stop();
    source.dispose();
  });
});
