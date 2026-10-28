import { expect } from 'vitest'
import { createDynamicCapabilityGraph } from '@migaia/capability/graph/dynamic'
import { PluginHost, defineFeature, definePlugin, type IPluginHostCore } from '@migaia/plugin-host'
import { openComposition } from '@migaia/plugin-host/composition'
import { createHost } from '../src/host/index.ts'

export class RuntimeHost extends PluginHost<Record<string, never>, string> {}

export class AsyncRuntimeHost extends RuntimeHost {
  runValue(value: string): Promise<void> {
    return Promise.resolve(this.runPipeline(value, () => undefined))
  }
}

export class CountingRuntimeHost extends RuntimeHost {
  /** Counts raw disposal calls so concurrent managed/raw disposal remains observable. */
  disposeCalls = 0

  /** Delegates raw disposal while retaining its call count. */
  override dispose() {
    this.disposeCalls += 1
    return super.dispose()
  }
}

export const hostOptions = (
  plugins: readonly unknown[] = [],
  create: () => RuntimeHost = () =>
    new RuntimeHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })
) => ({
  create,
  plugins: plugins as never,
  mutationAdmissionMs: 100,
  quiescenceMs: 100,
  shutdown: { mode: 'bounded' as const }
})

export const plugin = (name: string, providers: readonly string[] = []) =>
  ({
    name,
    features: {
      value: defineFeature(
        () => ({}),
        Object.fromEntries(
          providers.map((provider) => [
            provider,
            definePlugin({
              name: provider,
              features: { value: defineFeature(() => ({})) },
              install: () => ({})
            }).getFeature('value')
          ])
        )
      )
    },
    install: (core: IPluginHostCore<string>) => {
      core.onDispose(() => undefined)
      return { [name]: name }
    }
  }) as never

export const graphId = (id: string) => id as never

export const graphNode = (
  id: string,
  dependencies: readonly string[] = [],
  value: unknown = id
) => ({
  id: id as never,
  kind: 'executable-closure',
  dependencies: dependencies.map((provider) => ({
    provider: provider as never,
    required: true as const
  })),
  start: () => ({ value, release: () => undefined })
})

export const graphBatch = {
  startBatch: (entries: readonly { readonly definition: ReturnType<typeof graphNode> }[]) =>
    entries.map((entry) => entry.definition.start()),
  releaseBatch: async (
    entries: readonly { readonly instance: { readonly release: () => void } }[],
    fence: Promise<void>
  ) => {
    await fence
    for (const entry of [...entries].reverse()) entry.instance.release()
  }
} as unknown as Parameters<typeof createDynamicCapabilityGraph>[0]

export type IRuntimeCase = Readonly<{ readonly id: string; readonly run: () => Promise<void> }>

export type IRaceHost = Awaited<ReturnType<typeof createHost<RuntimeHost, readonly never[]>>>

export type IRaceOperation = Readonly<{
  readonly label: string
  readonly run: () => Promise<unknown>
}>

export async function runHostMutationRace(
  operations: (
    host: IRaceHost,
    raw: CountingRuntimeHost,
    tracked: (name: string) => unknown
  ) => readonly IRaceOperation[],
  initialNames: readonly string[],
  expectClosed = false,
  expectedFacadeState: 'terminal' | 'failed' = 'terminal',
  expectedPlugins?: readonly string[],
  expectedRevisionDelta?: readonly [number, number]
): Promise<void> {
  const installs = new Map<string, number>()
  const disposals = new Map<string, number>()
  const tracked = (name: string) => {
    return {
      name,
      install: (core: IPluginHostCore<string>) => {
        installs.set(name, (installs.get(name) ?? 0) + 1)
        core.onDispose(() => {
          disposals.set(name, (disposals.get(name) ?? 0) + 1)
        })
        return { [name]: name }
      }
    }
  }
  let raw: CountingRuntimeHost | undefined
  const raceHost = await createHost({
    ...hostOptions(initialNames.map((name) => tracked(name))),
    create: () => {
      raw = new CountingRuntimeHost({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      return raw
    }
  })
  const rawHost = raw!
  const initialRevision = rawHost.revision
  const raceOperations = operations(raceHost, rawHost, tracked)
  const results = await Promise.allSettled(raceOperations.map(({ run }) => run()))
  const committedViews: { readonly plugins: readonly string[] }[] = []
  for (const [index, result] of results.entries()) {
    const operation = raceOperations[index]
    expect(operation).toBeDefined()
    if (result.status === 'rejected') {
      expect(result.reason, operation?.label).toMatchObject({
        code: expect.any(String)
      })
    } else {
      expect(result.value, operation?.label).toBeDefined()
      if (result.value && typeof result.value === 'object' && 'view' in result.value)
        committedViews.push(
          (result.value as { readonly view: { readonly plugins: readonly string[] } }).view
        )
    }
  }
  if (expectClosed) {
    expect(() => raceHost.plugins).toThrow()
    for (const view of committedViews) expect(() => view.plugins).toThrow()
  } else {
    for (const view of committedViews) expect(view.plugins).toEqual(raceHost.plugins)
    expect(raceHost.plugins).toEqual(expectedPlugins)
    expect(rawHost.revision, `initial=${initialRevision}`).toBe(
      initialRevision + expectedRevisionDelta![0]
    )
  }
  const preDisposeRevision = rawHost.revision
  const managedDisposal = raceHost.dispose()
  const managedResult = await managedDisposal
  expect(managedResult.state).toBe('terminal')
  if (expectedFacadeState === 'failed') expect(['terminal', 'failed']).toContain(raceHost.state)
  else expect(raceHost.state).toBe('terminal')
  expect(raceHost.isActive).toBe(false)
  expect(rawHost.revision).toBeGreaterThanOrEqual(initialRevision)
  if (expectedRevisionDelta !== undefined)
    expect(rawHost.revision).toBeGreaterThanOrEqual(initialRevision + expectedRevisionDelta[0])
  expect(preDisposeRevision).toBeGreaterThanOrEqual(initialRevision)
  expect(rawHost.disposeCalls).toBeGreaterThan(0)
  expect(() => openComposition(rawHost).getCurrentSnapshot()).toThrow()
  const terminalRevision = rawHost.revision
  await raceHost.dispose()
  expect(rawHost.revision).toBe(terminalRevision)
  for (const [name, count] of installs) expect(disposals.get(name) ?? 0).toBe(count)
  for (const view of committedViews) expect(() => view.plugins).toThrow()
}
