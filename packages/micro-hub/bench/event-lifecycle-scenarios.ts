import assert from 'node:assert/strict'
import { setMaxListeners } from 'node:events'
import mitt from 'mitt'
import { createMicroHub, defineContract, event } from '../dist/index.js'
import { events } from '../dist/events/index.js'
import { state } from '../dist/state/index.js'
import type { IBenchFixture, ILibrary, IObservation } from './types.js'

/** One payload event is shared by all S3/S4 implementations without a projection layer. */
const EVENT_NAME = 'pulse'
/** Evidence keeps only this observed prefix; retaining millions of strings would distort heap use. */
const SEQUENCE_LIMIT = 64
/** Ten distinct plain fields are subscribed during each S6 application lifetime. */
const LIFECYCLE_FIELDS = Array.from({ length: 10 }, (_, index) => `field${index}`)
/** This temporary writer changes every field after instrumented cycles to reveal ghost callbacks. */
const CHECKER_APP = 'bench-lifecycle-checker'

/** Common payload callback; native EventTarget adapts its CustomEvent detail at the boundary. */
type IPayloadListener = (value: number) => void
/** Lifecycle fields remain numeric so the final public snapshots can be checked directly. */
type ILifecycleValues = Record<string, number>

/**
 * Creates one S3 event fixture, also used by S4 to add subscriptions after its baseline heap
 * sample. Timing listeners are distinct empty functions; only instrumented fixtures maintain
 * evidence.
 */
export async function createEventFixture(
  library: ILibrary,
  parameters: { listeners: number; capacity?: number },
  instrumented: boolean
): Promise<IBenchFixture> {
  /** Public unsubscriptions remain reachable equally for every implementation until disposal. */
  const stops: (() => void)[] = []
  /** Current installed listeners determine expected fan-out and memory-fixture liveness. */
  let listenerCount = 0
  /** Executed publishes, populated only in the independent instrumentation round. */
  let operationCalls = 0
  /** Observed callback invocations, populated only in the instrumentation round. */
  let listenerCalls = 0
  /** Bounded observed registration-order prefix from the instrumentation round. */
  const sequence: string[] = []
  /** Per-listener delivery totals distinguish correct fan-out from equal aggregate counts. */
  let perListener: Record<string, number> = {}
  /** Last value really passed to the emitter, retained independently of execution counters. */
  let lastPublished: number | undefined
  /** Last value received by an instrumented listener rather than inferred from the input. */
  let lastObserved: number | undefined
  /** Normalized subscriber boundary selected once outside every measured publish loop. */
  let register: (listener: IPayloadListener) => () => void
  /** Native emitter operation selected once outside every measured publish loop. */
  let publish: (value: number) => void
  /** Optional fixture-wide lifetime; only micro-hub needs asynchronous host disposal. */
  let disposeHost: () => void | Promise<void> = () => undefined

  if (library === 'micro-hub') {
    /** S4 reserves its full capacity before installing any listeners. */
    const capacity = Math.max(10_000, parameters.capacity ?? parameters.listeners)
    /** Event-only contract keeps state machinery out of event-throughput and subscription memory. */
    const contract = defineContract('bench-events', {
      version: 1,
      events: { [EVENT_NAME]: event<number>() }
    })
    /** One sender and one subscribing application share a single realm-local hub. */
    const hub = createMicroHub({ plugins: [events({ publishBudget: capacity })] })
    /** Sole publisher owns the contract throughout the fixture. */
    const owned = hub.connect('bench-events-sender').own(contract)
    /** All subscriptions belong to a separate app lifecycle. */
    const channel = hub.connect('bench-events-listener').use(contract).events[EVENT_NAME]
    register = (listener) => channel.on(listener)
    publish = (value) => owned.events[EVENT_NAME].emit(value)
    disposeHost = () => hub.dispose()
  } else if (library === 'mitt') {
    /** Mitt receives the same numeric payload through its ordinary public on/emit/off API. */
    const emitter = mitt<Record<typeof EVENT_NAME, number>>()
    register = (listener) => {
      emitter.on(EVENT_NAME, listener)
      return () => emitter.off(EVENT_NAME, listener)
    }
    publish = (value) => emitter.emit(EVENT_NAME, value)
    disposeHost = () => emitter.all.clear()
  } else {
    assert.equal(library, 'event-target')
    /** Native same-realm target; its Node warning threshold is unrelated to supported fan-out. */
    const target = new EventTarget()
    setMaxListeners(0, target)
    register = (listener) => {
      /** Native events carry the equivalent numeric payload on CustomEvent.detail. */
      const nativeListener = (received: Event): void =>
        listener((received as CustomEvent<number>).detail)
      target.addEventListener(EVENT_NAME, nativeListener)
      return () => target.removeEventListener(EVENT_NAME, nativeListener)
    }
    publish = (value) =>
      target.dispatchEvent(new CustomEvent<number>(EVENT_NAME, { detail: value }))
  }

  /** Adds distinct callbacks after setup, allowing S4 to exclude the shared emitter/app baseline. */
  const addSubscriptions = (count: number): void => {
    assert.ok(Number.isSafeInteger(count) && count >= 0)
    if (library === 'micro-hub') {
      assert.ok(
        listenerCount + count <= Math.max(10_000, parameters.capacity ?? parameters.listeners)
      )
    }
    for (let offset = 0; offset < count; offset++) {
      /** Stable registration identity is independent of the callback execution count. */
      const label = `listener${listenerCount + offset}`
      /** Every timed callback has its own identity, so EventTarget cannot deduplicate registration. */
      const listener: IPayloadListener = instrumented
        ? (value) => {
            listenerCalls++
            perListener[label] = (perListener[label] ?? 0) + 1
            if (sequence.length < SEQUENCE_LIMIT) sequence.push(`${label}:${value}`)
            lastObserved = value
          }
        : () => undefined
      stops.push(register(listener))
    }
    listenerCount += count
  }
  addSubscriptions(parameters.listeners)

  /** Timing performs the real emitter operation without callback or operation counters. */
  const emit = (value: number): void => {
    lastPublished = value
    publish(value)
  }

  return {
    update: instrumented
      ? (value) => {
          operationCalls++
          emit(value)
        }
      : emit,
    settle: async () => undefined,
    addSubscriptions,
    resetEvidence: () => {
      operationCalls = 0
      listenerCalls = 0
      sequence.length = 0
      perListener = {}
      lastObserved = undefined
      lastPublished = undefined
    },
    inspect: (expectedOperations, lastValue): IObservation => {
      /** Expected fan-out follows the number of actual installed subscribers in this fixture. */
      const expectedListenerCalls = expectedOperations * listenerCount
      if (expectedOperations > 0) assert.equal(lastPublished, lastValue)
      if (instrumented) {
        assert.equal(operationCalls, expectedOperations)
        assert.equal(listenerCalls, expectedListenerCalls)
        if (expectedOperations > 0 && listenerCount > 0) assert.equal(lastObserved, lastValue)
        for (let index = 0; index < listenerCount; index++) {
          assert.equal(perListener[`listener${index}`] ?? 0, expectedOperations)
        }
      }
      return {
        operationCalls,
        listenerCalls,
        expectedListenerCalls,
        sequence: [...sequence],
        perListener: { ...perListener },
        finalState: { lastPublished: lastPublished ?? null, lastObserved: lastObserved ?? null },
        activeSubscriptions: stops.length
      }
    },
    dispose: async () => {
      for (const stop of stops) stop()
      stops.length = 0
      await disposeHost()
    }
  }
}

/**
 * Creates S6: each update performs exactly one connect/use/ten-subscriptions/disconnect cycle.
 * Instrumented settle writes all ten fields once after the cycles to detect surviving callbacks.
 */
export async function createLifecycleFixture(
  parameters: { cycles: number },
  instrumented: boolean
): Promise<IBenchFixture> {
  /** Numeric initial values let a final public command distinguish every leaked field subscriber. */
  const initial: ILifecycleValues = Object.fromEntries(LIFECYCLE_FIELDS.map((field) => [field, 0]))
  /** Canonical shared state outlives each short-lived consumer application. */
  const contract = defineContract('bench-lifecycle', {
    version: 1,
    state: initial,
    writers: [CHECKER_APP],
    commands: {
      write: (_current, value: number) =>
        Object.fromEntries(LIFECYCLE_FIELDS.map((field) => [field, value]))
    }
  })
  /** Single hub intentionally survives all cycles so plugin-host queue cost remains in scope. */
  const hub = createMicroHub({ plugins: [state()] })
  /** Completed cycles are counted only in the instrumentation round. */
  let operationCalls = 0
  /** Registration calls prove all ten requested subscriptions were actually installed each cycle. */
  let subscriptionsCreated = 0
  /** Any callback after final sentinel mutation is a surviving disconnected subscription. */
  let listenerCalls = 0
  /** Bounded observed callback prefix records a concrete ghost identity if lifecycle cleanup fails. */
  const sequence: string[] = []
  /** Actual per-subscription callbacks are retained only in the instrumentation round. */
  let perListener: Record<string, number> = {}
  /** Last completed cycle value identifies the final mutation without counting timed operations. */
  let lastCycle: number | undefined
  /** Public snapshots captured by the instrumented writer before it disconnects. */
  let observedState: ILifecycleValues | undefined
  /** Tracks whether the no-ghost assertion has been exercised after the most recent cycle. */
  let inspectedCycle: number | undefined

  return {
    update: async (value) => {
      /** The app's real disconnect promise, rather than a synthetic scope, closes each cycle. */
      const app = hub.connect(`bench-lifecycle-${value}`)
      try {
        /** Public use and readable subscription are part of the measured application path. */
        const view = app.use(contract)
        for (const field of LIFECYCLE_FIELDS) {
          /** Every registration owns a distinct callback identity in both timing modes. */
          const listener = instrumented
            ? () => {
                /** Callback identity proves which disconnected app and field survived cleanup. */
                const label = `${value}:${field}`
                listenerCalls++
                perListener[label] = (perListener[label] ?? 0) + 1
                if (sequence.length < SEQUENCE_LIMIT) sequence.push(label)
              }
            : () => undefined
          view.state[field]!.subscribe(listener)
          if (instrumented) subscriptionsCreated++
        }
      } finally {
        await app.disconnect()
      }
      lastCycle = value
      if (instrumented) operationCalls++
    },
    settle: async () => {
      if (!instrumented || lastCycle === undefined || inspectedCycle === lastCycle) return
      /**
       * An authorized writer probes liveness through the public command path after all consumers
       * leave.
       */
      const checker = hub.connect(CHECKER_APP)
      try {
        /** Final public view is read before its checker app disconnects. */
        const view = checker.use(contract)
        view.commands.write(lastCycle + 1)
        await Promise.resolve()
        await Promise.resolve()
        observedState = Object.fromEntries(
          LIFECYCLE_FIELDS.map((field) => [field, view.state[field]!.get()])
        )
        inspectedCycle = lastCycle
      } finally {
        await checker.disconnect()
      }
    },
    resetEvidence: () => {
      operationCalls = 0
      subscriptionsCreated = 0
      listenerCalls = 0
      sequence.length = 0
      perListener = {}
      inspectedCycle = undefined
      observedState = undefined
    },
    inspect: (expectedOperations, lastValue): IObservation => {
      assert.equal(hub.apps.length, 0)
      if (expectedOperations > 0) assert.equal(lastCycle, lastValue)
      if (instrumented) {
        assert.equal(operationCalls, expectedOperations)
        assert.equal(subscriptionsCreated, expectedOperations * LIFECYCLE_FIELDS.length)
        if (expectedOperations > 0) {
          assert.equal(inspectedCycle, lastCycle)
          for (const field of LIFECYCLE_FIELDS) assert.equal(observedState?.[field], lastValue + 1)
        }
        assert.equal(listenerCalls, 0)
      }
      return {
        operationCalls,
        listenerCalls,
        expectedListenerCalls: 0,
        sequence: [...sequence],
        perListener: { ...perListener },
        finalState: {
          apps: hub.apps,
          lastCycle: lastCycle ?? null,
          observedState: observedState ?? null,
          requestedCycles: parameters.cycles
        },
        activeSubscriptions: listenerCalls
      }
    },
    dispose: () => hub.dispose()
  }
}
