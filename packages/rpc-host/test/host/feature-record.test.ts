/** Native records and plain call data prove the intentionally broken Feature boundary. */
import { describe, expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { timeoutFeature, retryFeature } from '@migaia/rpc-host/features'
import {
  defineTransportPlugin,
  defineFlowFeature,
  HostObservationKind,
  type IRpcFlowInstallation
} from '@migaia/rpc-host/sdk'
import type { IRpcAttempt, IRpcObservation } from '@migaia/rpc-contract/interfaces'
import { FeatureScope } from '../../src/feature/scope.ts'
import { coreMemoryServer } from './core-fixture.ts'

/** Empty native transports acquire no resources while exercising genuine Feature installation. */
function openEmptyTransport() {
  return { dispose: disposeEmptyTransport }
}

/** No resource was acquired by the empty transport. */
function disposeEmptyTransport(): void {}

/** Business success exposes the actual installed policy without introducing a new call seam. */
function resolveAttempt(): Promise<number> {
  return Promise.resolve(7)
}

/** A native token cannot expose the methods belonging to its registration-local output. */
async function nativeOutputsKeepCallerNames(): Promise<void> {
  /** Caller aliases deliberately differ from the fixed timeout/retry role names. */
  const budget = timeoutFeature({ ms: 100 })
  /** The retry token stays opaque independently of its execution policy. */
  const replay = retryFeature({ attempts: 1 })
  expect(Object.getOwnPropertyNames(budget)).toEqual([])
  expect(Object.getOwnPropertyNames(replay)).toEqual([])
  /** Every root is installed by the actual declaring native transport plugin. */
  const transport = defineTransportPlugin({
    name: 'record-test',
    namespace: 'local',
    features: { budget, replay },
    open: openEmptyTransport
  })
  /** The public RPC host exposes the plugin's installed controls, never token fields. */
  const host = await createRpcHost({
    self: { name: 'record-test', instanceId: 'record-test' },
    plugins: [transport]
  })
  try {
    /** Native output inference preserves the caller-selected alias. */
    const execution = host.local.features.budget
    expect(execution).not.toBe(budget)
    expect(typeof execution.run).toBe('function')
    expect(typeof host.local.features.replay.run).toBe('function')
    expect(
      await execution.run({ signal: new AbortController().signal, invoke: resolveAttempt })
    ).toBe(7)
  } finally {
    await host.close()
  }
}

/** Role identity remains independent of record keys, including two aliases for one token. */
function duplicateRolesStillFail(): void {
  /** One actual native role occurs under two unrelated caller aliases. */
  const budget = timeoutFeature({ ms: 100 })
  expect(() =>
    defineTransportPlugin({
      name: 'duplicate-role-test',
      namespace: 'local',
      features: { primary: budget, secondary: budget },
      open: openEmptyTransport
    })
  ).toThrowError(expect.objectContaining({ code: 'FEATURE_COMBINATION_CONFLICT' }))
}

/** Hand-written descriptors cannot enter a native record through structural role fields. */
function structuralFeaturesAreRejected(): void {
  expect(() =>
    defineTransportPlugin({
      name: 'forged-role-test',
      namespace: 'local',
      // @ts-expect-error A structural execution object is not a native Feature token.
      features: { budget: { kind: 'timeout', run: resolveAttempt } },
      open: openEmptyTransport
    })
  ).toThrowError(expect.objectContaining({ source: 'plugin.host', code: 'INVALID_OPTION' }))
}

/** Plain timeout data creates no token and expires before admitting physical work. */
async function plainCallDataOwnsNoFeature(): Promise<void> {
  /** An unconfigured scope can apply a per-call data override without an installation. */
  const scope = new FeatureScope()
  /** The original attempt is admitted only if its selected budget allows a send. */
  const attempt: IRpcAttempt<number> = {
    signal: new AbortController().signal,
    invoke: resolveAttempt
  }
  await expect(scope.execute('local', { timeout: { ms: 0 } }, attempt)).rejects.toMatchObject({
    code: 'DEADLINE_EXCEEDED'
  })
  expect(await scope.execute('local', { timeout: false, retry: false }, attempt)).toBe(7)
  /** A timeout token has no duration field and cannot impersonate plain option data. */
  const token = timeoutFeature({ ms: 100 })
  expect(() =>
    scope.resolve('local', {
      // @ts-expect-error Per-call overrides carry parameters, never native Features.
      timeout: token
    })
  ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
}

/** Observe real peer admission and namespace publication through one feature's actual output. */
class FeatureCallbackWitness {
  /** The label distinguishes phase order independently from caller aliases. */
  readonly #name: string
  /** Namespace publication records only this test's concrete transport namespace. */
  readonly #publications: string[]
  /** Actual peer-ready observations record each selected callback invocation. */
  readonly #observations: string[]

  /** Retain the local business witnesses without creating another transport fixture. */
  constructor(name: string, publications: string[], observations: string[]) {
    this.#name = name
    this.#publications = publications
    this.#observations = observations
  }

  /** Native setup lends callbacks owned by this witness, without adding intervention stages. */
  readonly setup = (): IRpcFlowInstallation => ({
    observe: this.#observe,
    namespaceExtensions: this.#publish
  })

  /** Only genuine peer admission can satisfy the observation-order assertion. */
  readonly #observe = (event: IRpcObservation): void => {
    if (event.kind === HostObservationKind.peerReady && event.namespace === 'memory')
      this.#observations.push(this.#name)
  }

  /** Publish no extra API; the actual namespace factory invocation is the observable result. */
  readonly #publish = (namespace: string): Record<never, never> => {
    if (namespace === 'memory') this.#publications.push(this.#name)
    return {}
  }
}

/** Reversing caller keys cannot reorder callbacks owned by two explicit feature phases. */
async function callbacksFollowExplicitPhases(reverse: boolean): Promise<void> {
  /** The native namespace publication boundary records both extension factories. */
  const publications: string[] = []
  /** Real peer readiness records both observers after the transport is published. */
  const observations: string[] = []
  /** The earlier phase remains first even when its caller alias is enumerated last. */
  const early = defineFlowFeature({
    name: 'phase-order-early',
    phase: 100,
    setup: new FeatureCallbackWitness('early', publications, observations).setup
  })
  /** This later phase has no dependency edge that could accidentally hide record ordering. */
  const late = defineFlowFeature({
    name: 'phase-order-late',
    phase: 200,
    setup: new FeatureCallbackWitness('late', publications, observations).setup
  })
  /** Both permutations install the same definitions through a genuine transport feature record. */
  const features = reverse ? { after: late, before: early } : { before: early, after: late }
  /** Existing memory transport supplies actual native installation and peer-ready events. */
  const server = coreMemoryServer('phase-order-server', undefined, 'memory', features)
  /** Both namespace extension factories run during the real public host's publication. */
  const host = await createRpcHost(server.options)
  try {
    expect(publications).toEqual(['early', 'late'])
    /** Handshake admission, rather than a manually emitted observation, drives both callbacks. */
    const client = await server.connect('phase-order-client')
    try {
      expect(observations).toEqual(['early', 'late'])
    } finally {
      await client.host.close()
    }
  } finally {
    await host.close()
  }
}

describe('RPC native feature records', registerRecordCases)

/** Stable case IDs bind candidate preflight to each intentional public boundary change. */
function registerRecordCases(): void {
  it('A1 A4 BC1 BC2 BC4: native outputs retain caller aliases', nativeOutputsKeepCallerNames)
  it('A1: duplicate roles fail independently of caller aliases', duplicateRolesStillFail)
  it('A1: structural feature descriptors are rejected', structuralFeaturesAreRejected)
  it('A2 BC3: calls use plain parameters and false', plainCallDataOwnsNoFeature)
  it.each([false, true])(
    'A3 BC5: callback phases ignore caller record order %s',
    callbacksFollowExplicitPhases
  )
}
