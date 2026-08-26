import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ModelState = {
  absent: 'absent',
  configChanged: 'config-changed',
  pending: 'pending',
  failed: 'failed',
  runningLease: 'running-lease',
  runningNoLease: 'running-no-lease',
  complete: 'complete',
  stale: 'stale'
} as const

type IModelState = (typeof ModelState)[keyof typeof ModelState]

const ModelOperation = {
  ensure: 'ensure',
  acquire: 'acquire',
  renew: 'renew',
  issueManifest: 'issue-manifest',
  commitNonterminal: 'commit-nonterminal',
  retryReceipt: 'retry-receipt',
  successorAcquire: 'successor-acquire',
  commitFinal: 'commit-final',
  fail: 'fail',
  rotate: 'rotate',
  open: 'open',
  read: 'read',
  commit: 'commit'
} as const

type IModelOperation = (typeof ModelOperation)[keyof typeof ModelOperation]

const ModelInvariant = {
  atomicProjection: 'atomic-projection',
  generationReadiness: 'generation-readiness',
  boundedBackfill: 'bounded-backfill',
  leaseReceiptFencing: 'lease-receipt-fencing',
  rawFirewall: 'raw-firewall'
} as const

type IModelInvariant = (typeof ModelInvariant)[keyof typeof ModelInvariant]

type IModelTransition = {
  readonly id: string
  readonly from: readonly IModelState[]
  readonly operation: IModelOperation
  readonly to: IModelState
  readonly guards: readonly string[]
  readonly reads: readonly string[]
  readonly writes: readonly string[]
  readonly invariants: readonly IModelInvariant[]
}

type ITransitionFixture = {
  readonly version: number
  readonly states: readonly IModelState[]
  readonly operations: readonly IModelOperation[]
  readonly fields: readonly string[]
  readonly transitions: readonly IModelTransition[]
}

type ITransitionResult =
  | { readonly accepted: true; readonly state: IModelState; readonly writes: readonly string[] }
  | { readonly accepted: false; readonly state: IModelState; readonly writes: readonly [] }

/** Reads the B00 model independently from production IndexedDB implementation state. */
const readFixture = (): ITransitionFixture =>
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '..', 'fixtures', 'indexed-db-transition-model.json'),
      'utf8'
    )
  ) as ITransitionFixture

/** Returns true when one transition explicitly declares an invariant. */
const ownsInvariant = (transition: IModelTransition, invariant: IModelInvariant): boolean =>
  transition.invariants.includes(invariant)

/** Validates schema, coverage, atomic sets, and cross-invariant declarations fail closed. */
const validateFixture = (fixture: ITransitionFixture): void => {
  expect(fixture.version).toBe(1)
  expect(new Set(fixture.states)).toEqual(new Set(Object.values(ModelState)))
  expect(new Set(fixture.operations)).toEqual(new Set(Object.values(ModelOperation)))
  expect(new Set(fixture.transitions.map((transition) => transition.id)).size).toBe(
    fixture.transitions.length
  )
  const knownStates = new Set(fixture.states)
  const knownOperations = new Set(fixture.operations)
  const knownFields = new Set(fixture.fields)
  const knownInvariants = new Set(Object.values(ModelInvariant))
  const ownedPairs = new Set<string>()
  for (const transition of fixture.transitions) {
    if (transition.from.length === 0) throw new Error(`missing source state: ${transition.id}`)
    if (!knownStates.has(transition.to)) throw new Error(`unknown target state: ${transition.id}`)
    if (!knownOperations.has(transition.operation))
      throw new Error(`unknown operation: ${transition.id}`)
    for (const state of transition.from)
      if (!knownStates.has(state)) throw new Error(`unknown source state: ${transition.id}`)
      else {
        const pair = `${state}:${transition.operation}`
        if (ownedPairs.has(pair)) throw new Error(`ambiguous transition pair: ${pair}`)
        ownedPairs.add(pair)
      }
    for (const field of [...transition.reads, ...transition.writes])
      if (!knownFields.has(field)) throw new Error(`unknown field ${field}: ${transition.id}`)
    for (const invariant of transition.invariants)
      if (!knownInvariants.has(invariant))
        throw new Error(`unknown invariant ${invariant}: ${transition.id}`)
    if (transition.reads.length === 0)
      throw new Error(`transition has no atomic read set: ${transition.id}`)
    if (
      transition.writes.some((field) =>
        ['sidecar', 'counters', 'checkpoint', 'recordRevisions'].includes(field)
      ) &&
      !ownsInvariant(transition, ModelInvariant.atomicProjection)
    )
      throw new Error(`projection invariant omitted: ${transition.id}`)
    if (
      transition.writes.some((field) => ['counters', 'checkpoint'].includes(field)) &&
      !ownsInvariant(transition, ModelInvariant.boundedBackfill)
    )
      throw new Error(`bounded backfill invariant omitted: ${transition.id}`)
    if (
      transition.writes.some((field) =>
        ['generationMetadata', 'currentPointer', 'readiness'].includes(field)
      ) &&
      !ownsInvariant(transition, ModelInvariant.generationReadiness)
    )
      throw new Error(`generation invariant omitted: ${transition.id}`)
    if (
      transition.writes.some((field) =>
        ['ownerToken', 'heartbeatRevision', 'leaseDuration', 'manifest', 'retryReceipt'].includes(
          field
        )
      ) &&
      !ownsInvariant(transition, ModelInvariant.leaseReceiptFencing)
    )
      throw new Error(`lease/receipt invariant omitted: ${transition.id}`)
    if (transition.operation === ModelOperation.rotate) {
      if (!ownsInvariant(transition, ModelInvariant.rawFirewall))
        throw new Error(`raw firewall invariant omitted: ${transition.id}`)
      if (!transition.writes.includes('migrationCheckpoint'))
        throw new Error(`raw firewall checkpoint invalidation omitted: ${transition.id}`)
    }
    if (transition.operation === ModelOperation.retryReceipt && transition.writes.length !== 0)
      throw new Error(`receipt retry must be read-only: ${transition.id}`)
  }
}

/** Applies only a listed transition; every absent pair returns an immutable no-write rejection. */
const applyTransition = (
  fixture: ITransitionFixture,
  state: IModelState,
  operation: IModelOperation
): ITransitionResult => {
  const transition = fixture.transitions.find(
    (candidate) => candidate.operation === operation && candidate.from.includes(state)
  )
  return transition === undefined
    ? { accepted: false, state, writes: [] }
    : { accepted: true, state: transition.to, writes: transition.writes }
}

describe('SWV2-T51 IndexedDB five-invariant transition model', () => {
  it('enumerates every legal transition with explicit atomic read/write ownership', () => {
    const fixture = readFixture()
    validateFixture(fixture)
    expect(new Set(fixture.transitions.flatMap((transition) => transition.invariants))).toEqual(
      new Set(Object.values(ModelInvariant))
    )
    for (const transition of fixture.transitions) {
      for (const state of transition.from) {
        const result = applyTransition(fixture, state, transition.operation)
        expect(result.accepted, transition.id).toBe(true)
        expect(result.state, transition.id).toBe(transition.to)
        expect(result.writes, transition.id).toEqual(transition.writes)
      }
    }
  })

  it('rejects every unlisted state/operation pair without a write set', () => {
    const fixture = readFixture()
    for (const state of fixture.states) {
      for (const operation of fixture.operations) {
        const listed = fixture.transitions.some(
          (transition) => transition.operation === operation && transition.from.includes(state)
        )
        const result = applyTransition(fixture, state, operation)
        expect(result.accepted, `${state}:${operation}`).toBe(listed)
        if (!listed) expect(result).toEqual({ accepted: false, state, writes: [] })
      }
    }
    for (const terminal of [ModelState.complete, ModelState.stale] as const) {
      for (const operation of [
        ModelOperation.open,
        ModelOperation.read,
        ModelOperation.commit,
        ModelOperation.fail
      ])
        expect(applyTransition(fixture, terminal, operation)).toEqual({
          accepted: false,
          state: terminal,
          writes: []
        })
    }
  })

  it('fails validation for unknown fields and implicit cross-invariant writes', () => {
    const fixture = readFixture()
    const unknownField: ITransitionFixture = {
      ...fixture,
      transitions: fixture.transitions.map((transition, index) =>
        index === 0
          ? { ...transition, writes: [...transition.writes, 'surpriseField'] }
          : transition
      )
    }
    expect(() => validateFixture(unknownField)).toThrow('unknown field surpriseField')

    const missingFirewall: ITransitionFixture = {
      ...fixture,
      transitions: fixture.transitions.map((transition) =>
        transition.operation === ModelOperation.rotate
          ? {
              ...transition,
              invariants: transition.invariants.filter(
                (invariant) => invariant !== ModelInvariant.rawFirewall
              )
            }
          : transition
      )
    }
    expect(() => validateFixture(missingFirewall)).toThrow('raw firewall invariant omitted')
  })
})
