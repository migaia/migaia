import { strict as assert } from 'node:assert'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import { defineFeature } from '@migaia/plugin-host'
import {
  batchFeature,
  filterFeature,
  formatFeature,
  retryFeature,
  thresholdFeature,
  timeoutFeature,
  uuidFeature
} from '../../src/features/index.ts'
import { defineLogFeature } from '../../src/plugin.ts'
import { prettyFeature } from '@migaia/log-plugin-console'
import type { ILogEntry } from '../../src/typing.ts'

/** Each failure retains enough context to distinguish native identity from a factory-input failure. */
type IObservation = {
  acceptance: 'A1' | 'A8'
  factory: string
  source: string
  code: string
  name: string
  reason: string
  message: string
}
/** This public entry implementation leaves the logical entry unchanged. */
function keepEntry(entry: ILogEntry): ILogEntry {
  return entry
}
/** The gate is deliberately non-filtering so native admission is the only observed behavior. */
function acceptEntry(): boolean {
  return true
}
/** Distinct constant text proves the public format constructor accepts the intended definition. */
function formatEntry(): string {
  return 'native-identity-fixture'
}

/** Classify fixture-only failures without confusing a nonzero import/build exit with expected RED. */
function observation(
  acceptance: IObservation['acceptance'],
  factory: string,
  error: unknown
): IObservation {
  /** Expected baseline errors contain no user payloads, credentials, or remote URLs. */
  const record =
    error !== null && typeof error === 'object' ? (error as Record<string, unknown>) : {}
  return {
    acceptance,
    factory,
    source: typeof record.source === 'string' ? record.source : 'fixture.assertion',
    code: typeof record.code === 'string' ? record.code : 'N/A',
    name: typeof record.name === 'string' ? record.name : typeof error,
    reason: 'N/A — no package-local reason enum',
    message: typeof record.message === 'string' ? record.message : String(error)
  }
}

/** Case selection allows two focused base observations without changing the assertion body. */
const requested = new Set((process.argv[2] ?? 'A1,A8').split(','))
/**
 * New no-name third-party definitions have no baseline call shape; base probes existing built-ins
 * only.
 */
const baseline = process.argv[3] === 'baseline'
/** Every supported factory is a cold call; no host, queue, lifecycle, or transport is created. */
const factories = {
  threshold: () => thresholdFeature(),
  filter: () => filterFeature(),
  uuid: () => uuidFeature(),
  format: () => formatFeature({ format: 'json' }),
  batch: () => batchFeature(),
  retry: () => retryFeature({ attempts: 2 }),
  timeout: () => timeoutFeature({ ms: 100 }),
  pretty: () => prettyFeature(),
  thirdPartyEntry: () => defineLogFeature({ phase: 'entry', stage: keepEntry }),
  thirdPartyGate: () => defineLogFeature({ phase: 'gate', accept: acceptEntry }),
  thirdPartyFormat: () => defineLogFeature({ phase: 'format', format: formatEntry })
}
/**
 * All failed factory cases are retained, so an early identity mismatch cannot hide later opacity
 * failures.
 */
const failures: IObservation[] = []
/**
 * Successful-case counts distinguish actual assertions from a fixture that never exercised its
 * subjects.
 */
const checked = { A1: 0, A8: 0 }
// The eleven source-declared factories are a compile-time bound.
for (const [name, factory] of Object.entries(factories)) {
  if (baseline && name.startsWith('thirdParty')) continue
  /** A factory's own input rejection remains separate from native exact-object admission. */
  let feature: object
  try {
    feature = factory()
  } catch (error) {
    if (requested.has('A1')) failures.push(observation('A1', name, error))
    continue
  }
  if (requested.has('A1')) {
    checked.A1++
    try {
      assert.equal(
        inspectFeatures({ selected: feature as ReturnType<typeof thresholdFeature> }).roots
          .selected,
        feature
      )
    } catch (error) {
      failures.push(observation('A1', name, error))
    }
  }
  if (requested.has('A8')) {
    checked.A8++
    try {
      assert.equal(Object.isFrozen(feature), true)
      assert.deepEqual(Reflect.ownKeys(feature), [])
    } catch (error) {
      failures.push(observation('A8', name, error))
    }
  }
}
if (requested.has('A1')) {
  /** Exact native identity remains necessary even when all native tokens are opaque empty objects. */
  const native = defineFeature(() => ({}))
  assert.equal(inspectFeatures({ native }).roots.native, native)
  for (const forged of [{}, { ...native }, new Proxy(native, {})]) {
    // Three explicit counterfeit forms are fixed by A1's existing contract.
    checked.A1++
    try {
      assert.throws(() => inspectFeatures({ forged: forged as typeof native }))
    } catch (error) {
      failures.push(observation('A1', 'literal/spread/wrapper', error))
    }
  }
}
console.log(JSON.stringify({ requested: [...requested], checked, failures }))
assert.equal(failures.length, 0, `${[...requested].join(',')} native definition acceptance failed`)
