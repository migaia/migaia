import assert from 'node:assert/strict'
import { listenKeys, map } from 'nanostores'
import { subscribeWithSelector } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'
import { createMicroHub, defineContract, keyed } from '../dist/index.js'
import { state } from '../dist/state/index.js'
import { createGlobalState, type IGlobalStateSnapshot } from './baselines/global-state.js'
import type { IBenchFixture, ILibrary, IObservation, IParameters } from './types.js'

/** State scenarios share numeric fields so each library performs the same application update. */
type IStateScenario = 'S1' | 'S2' | 'S5'

/** Native state operations adapted only at the measurement boundary. */
type IStateBackend = {
  /** Performs one scenario update with a different value supplied by the harness. */
  update(value: number): void
  /** Reads the complete final numeric state outside the timed region. */
  snapshot(): IGlobalStateSnapshot
  /** Reads the value observed by one application listener in the instrumented round. */
  read(field: string): number
  /** Registers a field consumer; global-state and S5 nanostores deliberately broadcast. */
  subscribe(field: string, listener: () => void, app: number): () => void
  /** Registers the additional whole-state consumer required only by S2. */
  subscribeAll(listener: () => void): () => void
  /** Releases all state and app resources owned by this sample. */
  dispose(): Promise<void>
}

/** Stable fixture names and failure messages belong to this measurement module. */
const StateBenchText = {
  /** Contract identity is reusable after the previous isolated sample's hub is disposed. */
  contract: 'bench-state',
  /** Entity contract uses the real keyed capability rather than a flat-object replacement. */
  entitiesContract: 'bench-entities',
  /** S2 has one subscriber that observes all changed fields. */
  allListener: 'all-fields',
  /** A state scene admits only its four explicitly selected libraries. */
  unsupportedLibrary: 'Unsupported library for a state benchmark',
  /** Every submitted update must execute in the separate instrumented round. */
  operationCount: 'Instrumented state update count differs from the harness count',
  /** Listener work must match the documented native subscription semantics. */
  listenerCount: 'Instrumented listener count differs from the scenario semantics',
  /** Each instrumented listener retains its own count, including zero-call subscriptions. */
  perListenerCount: 'A listener received an unexpected number of state notifications',
  /** Whole-state snapshots must contain exactly the original field/entity membership. */
  fieldCount: 'Final state changed the scenario field count',
  /** All changed fields must contain the supplied value, while untouched fields stay zero. */
  finalValue: 'Final state differs from the submitted numeric updates'
} as const

/** Bounded observed prefix proves ordering without million-entry instrumentation allocations. */
const SEQUENCE_LIMIT = 256

/** Assigns deterministic field ids shared by all flat-state libraries. */
const fieldName = (index: number): string => `field-${index}`

/** Assigns deterministic entity ids; S5 targets the middle id rather than a special first entry. */
const entityName = (index: number): string => `entity-${index}`

/** Identifies the same app and consumer position independently of the measured library. */
const listenerName = (app: number, subscriber: number): string =>
  `app-${app}-listener-${subscriber}`

/** Names real micro-hub apps without adding an unmeasured extra owner application. */
const appName = (index: number): string => `bench-app-${index}`

/** Builds a single equivalent patch for libraries whose native update API takes a dictionary. */
const patchOf = (fields: readonly string[], value: number): Record<string, number> =>
  Object.fromEntries(fields.map((field) => [field, value]))

/** Creates micro-hub's public command/readable path from the built package only. */
function createMicroBackend(
  scenario: IStateScenario,
  initial: IGlobalStateSnapshot,
  changed: readonly string[],
  appCount: number,
  failures: unknown[]
): IStateBackend {
  /** Hub and every connected app belong exclusively to this sample. */
  const hub = createMicroHub({ plugins: [state()], report: (error) => failures.push(error) })
  /** The first measured app also owns the contract; there is no additional owner-only app. */
  const apps = Array.from({ length: appCount }, (_, index) => hub.connect(appName(index)))
  if (scenario === 'S5') {
    /** Keyed state owns one atom per entity id, matching the package's advertised entity path. */
    const contract = defineContract(StateBenchText.entitiesContract, {
      version: 1,
      state: { entities: keyed<number>() },
      commands: { write: (_current, patch: Record<string, number>) => ({ entities: patch }) }
    })
    /** Owner seeds the table before any measured subscriber or update exists. */
    const owner = apps[0]!.own(contract)
    owner.commands.write(initial)
    return {
      update: (value) => void owner.commands.write(patchOf(changed, value)),
      snapshot: () =>
        Object.fromEntries(
          owner.state.entities.ids.get().map((id) => [id, owner.state.entities.at(id).get()!])
        ),
      read: (field) => owner.state.entities.at(field).get()!,
      subscribe: (field, listener) => owner.state.entities.at(field).subscribe(listener),
      subscribeAll: (listener) =>
        owner
          .select((current) => current.entities.ids.map((id) => current.entities.get(id)))
          .subscribe(listener),
      dispose: () => hub.dispose()
    }
  }
  /** Flat-field contracts preserve the same F or K top-level values as every baseline. */
  const contract = defineContract(StateBenchText.contract, {
    version: 1,
    state: { ...initial },
    commands: { write: (_current, patch: Record<string, number>) => patch }
  })
  /** Owner commands issue one patch for every S1 or S2 update. */
  const owner = apps[0]!.own(contract)
  /** Each actual app subscribes through its own public view. */
  const views = apps.map((app) => app.use(contract))
  return {
    update: (value) => void owner.commands.write(patchOf(changed, value)),
    snapshot: () =>
      Object.fromEntries(Object.keys(initial).map((field) => [field, owner.state[field]!.get()])),
    read: (field) => owner.state[field]!.get(),
    subscribe: (field, listener, app) => views[app]!.state[field]!.subscribe(listener),
    subscribeAll: (listener) =>
      owner
        .select((current) => Object.values(current).reduce((sum, value) => sum + value, 0))
        .subscribe(listener),
    dispose: () => hub.dispose()
  }
}

/** Adapts each baseline's native state API without adding production routing to that library. */
function createBaselineBackend(
  scenario: IStateScenario,
  library: ILibrary,
  initial: IGlobalStateSnapshot,
  changed: readonly string[]
): IStateBackend {
  if (library === 'nanostores') {
    /** S1/S2 use listenKeys; S5 intentionally uses the map.listen baseline named in the prompt. */
    const store = map<Record<string, number>>({ ...initial })
    return {
      update:
        scenario === 'S2'
          ? (value) => store.set(patchOf(changed, value))
          : (value) => store.setKey(changed[0]!, value),
      snapshot: () => store.get(),
      read: (field) => store.get()[field]!,
      subscribe: (field, listener) =>
        scenario === 'S5' ? store.listen(listener) : listenKeys(store, [field], listener),
      subscribeAll: (listener) => store.listen(listener),
      dispose: async () => undefined
    }
  }
  if (library === 'zustand') {
    /** Selector middleware is required so field consumers receive only their selected changes. */
    const store = createStore(subscribeWithSelector((): Record<string, number> => ({ ...initial })))
    return {
      update: (value) => store.setState(patchOf(changed, value)),
      snapshot: () => store.getState(),
      read: (field) => store.getState()[field]!,
      subscribe: (field, listener) => store.subscribe((current) => current[field], listener),
      subscribeAll: (listener) => store.subscribe(listener),
      dispose: async () => undefined
    }
  }
  assert.equal(library, 'global-state', StateBenchText.unsupportedLibrary)
  /** Whole-state broadcast stays deliberately coarse rather than adding a selector facade. */
  const store = createGlobalState(initial)
  return {
    update: (value) => store.setGlobalState(patchOf(changed, value)),
    snapshot: () => store.getState(),
    read: (field) => store.getState()[field]!,
    subscribe: (_field, listener) => store.subscribe(listener),
    subscribeAll: (listener) => store.subscribe(listener),
    dispose: async () => store.dispose()
  }
}

/**
 * Creates one isolated S1/S2/S5 sample. The root harness owns warmup, alternating order and clocks.
 * Instrumented closures count and record notifications; timing closures contain no counters.
 */
export async function createStateFixture(
  scenario: IStateScenario,
  library: ILibrary,
  parameters: IParameters,
  instrumented: boolean
): Promise<IBenchFixture> {
  /** Field/table membership remains fixed throughout the sample. */
  const count = scenario === 'S5' ? parameters.entities! : parameters.fields!
  /** Flat fields and keyed entities use deterministic distinct naming schemes. */
  const names = Array.from({ length: count }, (_, index) =>
    scenario === 'S5' ? entityName(index) : fieldName(index)
  )
  /** All libraries start with the same zero values; setup cost is outside measurement. */
  const initial: IGlobalStateSnapshot = Object.fromEntries(names.map((field) => [field, 0]))
  /** S1/S5 update one key; S2 updates every field in one native call or command. */
  const changed = scenario === 'S2' ? names : [names[scenario === 'S5' ? 5000 : 0]!]
  /** App ownership is real for micro-hub and grouping metadata for the standalone baselines. */
  const appCount = scenario === 'S1' ? parameters.apps! : 1
  /** Reporter failures invalidate this sample rather than becoming invisible background errors. */
  const failures: unknown[] = []
  /** Library-specific state instance owns every primitive used by this sample. */
  const backend =
    library === 'micro-hub'
      ? createMicroBackend(scenario, initial, changed, appCount, failures)
      : createBaselineBackend(scenario, library, initial, changed)
  /** Idempotent unsubscribe handles are retained only until sample disposal. */
  const stops: (() => void)[] = []
  /** Expected notification routing is derived from the selected native API, not measured counts. */
  const expected = new Map<string, boolean>()
  /** Actual per-listener counters exist only in the separate instrumented round. */
  const perListener: Record<string, number> = {}
  /** Actual registration-order observations are emitted verbatim for batch/order evidence. */
  const sequence: string[] = []
  /** Number of submitted instrumented updates since the harness ended warmup. */
  let operationCalls = 0
  /** Number of actual application listener invocations since warmup. */
  let listenerCalls = 0
  /** Registers one native subscription with either an instrumented or empty timing callback. */
  const subscribe = (label: string, field: string, app: number): void => {
    expected.set(
      label,
      library === 'global-state' ||
        (scenario === 'S5' && library === 'nanostores') ||
        changed.includes(field)
    )
    if (instrumented) {
      perListener[label] = 0
      stops.push(
        backend.subscribe(
          field,
          () => {
            listenerCalls++
            perListener[label]!++
            if (sequence.length < SEQUENCE_LIMIT) sequence.push(`${label}:${backend.read(field)}`)
          },
          app
        )
      )
    } else {
      stops.push(backend.subscribe(field, () => undefined, app))
    }
  }
  if (scenario === 'S1') {
    for (let app = 0; app < appCount; app++) {
      for (let subscriber = 0; subscriber < parameters.subscribersPerApp!; subscriber++) {
        subscribe(
          listenerName(app, subscriber),
          names[(app * parameters.subscribersPerApp! + subscriber) % count]!,
          app
        )
      }
    }
  } else {
    for (let index = 0; index < names.length; index++) {
      subscribe(listenerName(0, index), names[index]!, 0)
    }
  }
  if (scenario === 'S2') {
    expected.set(StateBenchText.allListener, true)
    if (instrumented) {
      perListener[StateBenchText.allListener] = 0
      stops.push(
        backend.subscribeAll(() => {
          listenerCalls++
          perListener[StateBenchText.allListener]!++
          if (sequence.length < SEQUENCE_LIMIT) {
            sequence.push(
              `${StateBenchText.allListener}:${Object.values(backend.snapshot()).join(',')}`
            )
          }
        })
      )
    } else {
      stops.push(backend.subscribeAll(() => undefined))
    }
  }
  /** Updates with a changed value; no operation counter exists in the timing closure. */
  const update = instrumented
    ? (value: number): void => {
        operationCalls++
        backend.update(value)
      }
    : backend.update
  return {
    update,
    // Every library crosses the same Promise fence so reactive notification work stays timed.
    settle: () => Promise.resolve(),
    resetEvidence: () => {
      operationCalls = 0
      listenerCalls = 0
      sequence.length = 0
      if (instrumented) for (const label of Object.keys(perListener)) perListener[label] = 0
    },
    inspect: (expectedOperations, lastValue): IObservation => {
      if (failures.length > 0) throw failures[0]
      /** Complete final state is read after timing, with no measured callback counters added. */
      const finalState = backend.snapshot()
      assert.equal(Object.keys(finalState).length, names.length, StateBenchText.fieldCount)
      for (const field of names) {
        assert.equal(
          finalState[field],
          changed.includes(field) ? lastValue : 0,
          StateBenchText.finalValue
        )
      }
      /** Number of native application callbacks owed by each submitted effective update. */
      const expectedPerOperation = [...expected.values()].filter(Boolean).length
      if (instrumented) {
        assert.equal(operationCalls, expectedOperations, StateBenchText.operationCount)
        assert.equal(
          listenerCalls,
          expectedPerOperation * expectedOperations,
          StateBenchText.listenerCount
        )
        for (const [label, notified] of expected) {
          assert.equal(
            perListener[label],
            notified ? expectedOperations : 0,
            StateBenchText.perListenerCount
          )
        }
      }
      return {
        operationCalls,
        listenerCalls,
        expectedListenerCalls: expectedPerOperation * expectedOperations,
        sequence: [...sequence],
        ...(instrumented ? { perListener: { ...perListener } } : {}),
        finalState,
        activeSubscriptions: stops.length
      }
    },
    dispose: async () => {
      for (const stop of stops) stop()
      stops.length = 0
      await backend.dispose()
    }
  }
}
