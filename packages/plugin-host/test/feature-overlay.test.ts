import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  FeatureOverlay,
  type IFeatureOverlaySelection,
  type IFeatureOverlayEntry
} from '../src/feature-overlay-notifications.ts'
import { defineHost } from '../src/define-host.ts'
import { definePlugin } from '../src/define-plugin.ts'
import { featuresModule } from '../src/modules/features/index.ts'

/** Fixed fixture vocabulary mirrors a consumer's compile-time constant role domain. */
const Role = {
  first: Symbol('first'),
  second: Symbol('second'),
  singular: Symbol('singular')
} as const
/** Installed values carry their original domain projection. */
type IValue = { role: symbol; repeatable: boolean; id: number }
/** Original intrinsics permit independent observation without adding a production test API. */
const originalHas = Set.prototype.has
/** The real bucket iterator remains the source of every observed global entry. */
const originalValues = Map.prototype.values
/** Fixed acceptance observations are written only when the test caller requests an artifact. */
const observations: object[] = []
/** Publish the actual measured counters without a second execution or production diagnostic API. */
afterAll(() => {
  if (process.env.MIGAIA_OVERLAY_COUNTER_REPORT)
    writeFileSync(
      process.env.MIGAIA_OVERLAY_COUNTER_REPORT,
      JSON.stringify(observations, null, 2) + '\n'
    )
})
/** Only the currently executing compiler is observed; native admission/disposal is excluded. */
let active: Counts | undefined
/** Callback results and compiler work have independently counted owners. */
class Counts {
  /** Actual native consumer notifications after the measured global commit. */
  callbacks = 0
  /** Complete output entries materialized across consumers. */
  output = 0
  /** Global entries actually yielded by published role buckets. */
  entries = 0
  /** Constant-time role checks include disabled buckets without visiting their entries. */
  buckets = 0
  /** Disabled role entries must remain absent from this per-role observation. */
  readonly visited = new Map<symbol, number>()
  /** Native callback is the sole output counter. */
  accept(entries: readonly IFeatureOverlayEntry<IValue>[]): void {
    this.callbacks += 1
    this.output += entries.length
  }
  /** Observe actual yielded values, preserving their identities and installation order. */
  visit(value: unknown): void {
    if (!value || typeof value !== 'object' || !('role' in value)) return
    if (value.role !== Role.first && value.role !== Role.second && value.role !== Role.singular)
      return
    this.entries += 1
    this.visited.set(value.role, (this.visited.get(value.role) ?? 0) + 1)
  }
}
/** Count published-role membership checks only while the inherited compiler runs. */
function countedHas(this: Set<unknown>, value: unknown): boolean {
  if (active && (value === Role.first || value === Role.second || value === Role.singular))
    active.buckets += 1
  return Reflect.apply(originalHas, this, [value])
}
/** Count entries the actual bucket iterator yields; disabled buckets never invoke it. */
function* countedValues<K, V>(this: Map<K, V>): MapIterator<V> {
  for (const value of Reflect.apply(originalValues, this, [])) {
    active?.visit(value)
    yield value
  }
}
/** A fixture subclass scopes observation around the inherited implementation, without replacing it. */
class ObservedOverlay extends FeatureOverlay<IValue> {
  /** Measured work belongs to this overlay's current global-change operation. */
  readonly counts = new Counts()
  /** Project consumer-owned metadata once at admission. */
  constructor() {
    super(roleOf)
  }
  /** The original compiler returns every actual consumer result unchanged. */
  override compile(local: readonly IFeatureOverlaySelection<IValue>[] = []) {
    active = this.counts
    try {
      return super.compile(local)
    } finally {
      active = undefined
    }
  }
}
/** Counter fixtures never add metadata or create an alternate feature identity authority. */
function roleOf(value: IValue) {
  return value
}
/** Every case restores native intrinsics even when an assertion fails. */
afterEach(() => {
  active = undefined
  vi.restoreAllMocks()
})

/** Exercise one committed native change with independently sized globals and consumers. */
async function measure(n: number, m: number, scenario: string): Promise<void> {
  /** Native publication, rollback and cleanup remain under their real installation owner. */
  const host = defineHost({ modules: [featuresModule] as const })
  /** Local declarations are copied once by the real consume boundary. */
  const overlay = new ObservedOverlay()
  /** A scenario supplies local declarations rather than changing the compiler. */
  const local: IFeatureOverlaySelection<IValue>[] = []
  if (scenario === 'all-disabled') local.push({ role: Role.first, value: false })
  if (scenario === 'mixed') local.push({ role: Role.second, value: false })
  if (scenario === 'singular-replace')
    local.push({ alias: 'local', value: { role: Role.singular, repeatable: false, id: -1 } })
  if (scenario === 'same-key')
    local.push({ alias: 'global-0', value: { role: Role.first, repeatable: true, id: -1 } })
  try {
    for (let index = 0; index < m; index += 1)
      await host.use(
        definePlugin({
          name: `consumer-${index}`,
          install(core) {
            overlay.consume(core, local, (entries) => overlay.counts.accept(entries))
            return {}
          }
        })
      )
    /** Reset initial consumer publications before observing this one global change. */
    overlay.counts.callbacks = 0
    overlay.counts.output = 0
    overlay.counts.entries = 0
    overlay.counts.buckets = 0
    overlay.counts.visited.clear()
    /** Uniqueness is per repeatable role; every global alias in this fixture is distinct. */
    const entries: IFeatureOverlayEntry<IValue>[] = []
    for (let index = 0; index < n; index += 1)
      entries.push({
        alias: `global-${index}`,
        value: {
          id: index,
          role:
            scenario === 'singular-replace' && index === 0
              ? Role.singular
              : scenario === 'mixed' && index % 2
                ? Role.second
                : Role.first,
          repeatable: !(scenario === 'singular-replace' && index === 0)
        }
      })
    vi.spyOn(Set.prototype, 'has').mockImplementation(countedHas)
    vi.spyOn(Map.prototype, 'values').mockImplementation(countedValues)
    await host.use(
      definePlugin({
        name: 'provider',
        install(core) {
          overlay.provide(core, entries)
          return {}
        }
      })
    )
    expect(overlay.counts.callbacks).toBe(m)
    if (scenario === 'all-disabled') {
      expect(overlay.counts.output).toBe(0)
      expect(overlay.counts.entries).toBe(0)
    }
    if (scenario === 'mixed') expect(overlay.counts.visited.get(Role.second) ?? 0).toBe(0)
    if (scenario === 'singular-replace')
      expect(overlay.counts.visited.get(Role.singular) ?? 0).toBe(0)
    /**
     * Entry visits plus callbacks are output-sensitive; role lookups have their separate fixed
     * bound.
     */
    const totalVisits = overlay.counts.entries + overlay.counts.callbacks
    /** All consumer declarations are charged, including output-suppressing local overrides. */
    const L = m * local.length
    expect(totalVisits).toBeLessThanOrEqual(n + m + L + overlay.counts.output)
    // Three roles are fixed by Role above, independent of n and m.
    expect(overlay.counts.buckets).toBeLessThanOrEqual(3 * m)
    observations.push({
      n,
      m,
      scenario,
      entriesVisited: overlay.counts.entries,
      bucketsVisited: overlay.counts.buckets,
      callbacks: overlay.counts.callbacks,
      L,
      K: overlay.counts.output,
      totalVisits
    })
    console.info(
      JSON.stringify({
        n,
        m,
        scenario,
        entriesVisited: overlay.counts.entries,
        bucketsVisited: overlay.counts.buckets,
        callbacks: overlay.counts.callbacks,
        L,
        K: overlay.counts.output,
        totalVisits
      })
    )
  } finally {
    vi.restoreAllMocks()
    await host.dispose()
  }
}

describe('feature overlay native propagation', registerLifecycleCases)
/** Cache callback deliberately owns no domain behavior in the projection-count case. */
function accept(_entries: readonly IFeatureOverlayEntry<IValue>[]): void {}

/** Exercise rejects duplicate repeatable aliases atomically and releases reservations on removal. */
function verifyAliasReservations() {
  /** Pure entry uses the same inherited rule implementation as notifications. */
  const overlay = new FeatureOverlay<IValue>(roleOf)
  /** Original installed object survives every successful compilation by identity. */
  const value = { role: Role.first, repeatable: true, id: 1 }
  /** Exact receipts distinguish failed reservations from a committed provider. */
  const first = {},
    rejected = {},
    replacement = {}
  overlay.prepare(first, [{ alias: 'same', value }])
  overlay.commit(first)
  expect(() =>
    overlay.prepare(rejected, [
      { alias: 'unused', value },
      { alias: 'same', value }
    ])
  ).toThrowError(expect.objectContaining({ source: 'plugin.host', code: 'FEATURE_ROLE_CONFLICT' }))
  expect(overlay.commit(rejected)).toBe(false)
  overlay.prepare(replacement, [{ alias: 'unused', value }])
  overlay.commit(replacement)
  expect(overlay.compile()).toHaveLength(2)
  expect(overlay.remove(first)).toBe(true)
  expect(overlay.remove(first)).toBe(false)
  overlay.prepare({}, [{ alias: 'same', value }])
}

/** Exercise reuses normalized local declarations across global notifications. */
async function verifyLocalNormalization() {
  /** Projection counts separate consumer normalization from global provider admission. */
  const projections = { count: 0 }
  /** One local array is captured by the real consume boundary. */
  const overlay = new FeatureOverlay<IValue>((value) => {
    projections.count += 1
    return value
  })
  /** Native lifetime owns all consumers and providers. */
  const host = defineHost({ modules: [featuresModule] as const })
  try {
    await host.use(
      definePlugin({
        name: 'consumer',
        install(core) {
          overlay.consume(
            core,
            [{ alias: 'local', value: { role: Role.second, repeatable: true, id: -1 } }],
            accept
          )
          return {}
        }
      })
    )
    await host.use(
      definePlugin({
        name: 'first',
        install(core) {
          overlay.provide(core, [
            { alias: 'first', value: { role: Role.first, repeatable: true, id: 1 } }
          ])
          return {}
        }
      })
    )
    await host.use(
      definePlugin({
        name: 'second',
        install(core) {
          overlay.provide(core, [
            { alias: 'second', value: { role: Role.first, repeatable: true, id: 2 } }
          ])
          return {}
        }
      })
    )
    expect(projections.count).toBe(3)
  } finally {
    await host.dispose()
  }
}

/** A mutable local list is read afresh on every compile; a frozen list keeps its normalization. */
function verifyMutableLocalList() {
  /** Projection count shows when a local list is normalized again. */
  const projections = { count: 0 }
  const overlay = new FeatureOverlay<IValue>((value) => {
    projections.count += 1
    return value
  })
  /** A caller-owned array that changes between compiles. */
  const local: IFeatureOverlaySelection<IValue>[] = [
    { alias: 'a', value: { role: Role.second, repeatable: true, id: 1 } }
  ]
  expect(overlay.compile(local).map((entry) => entry.alias)).toEqual(['a'])
  local.push({ alias: 'b', value: { role: Role.second, repeatable: true, id: 2 } })
  expect(overlay.compile(local).map((entry) => entry.alias)).toEqual(['a', 'b'])
  /** A frozen list cannot change, so its normalization is reused. */
  const frozen = Object.freeze([...local])
  projections.count = 0
  overlay.compile(frozen)
  overlay.compile(frozen)
  expect(projections.count).toBe(2)
}

/** Register named cases without nested callback components. */
function registerLifecycleCases(): void {
  // These three sizes and five scenarios are the fixed acceptance matrix, not runtime configuration.
  for (const n of [1, 16, 256])
    for (const m of [1, 16, 256])
      for (const scenario of [
        'all-inherit',
        'all-disabled',
        'mixed',
        'singular-replace',
        'same-key'
      ])
        it(`${scenario} globals=${n} consumers=${m}`, async () => {
          await measure(n, m, scenario)
        })

  it(
    'rejects duplicate repeatable aliases atomically and releases reservations on removal',
    verifyAliasReservations
  )

  it('reuses normalized local declarations across global notifications', verifyLocalNormalization)

  it('reads a mutable local list afresh and caches a frozen one', verifyMutableLocalList)
}
