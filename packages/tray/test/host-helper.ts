import * as composition from '@migaia/plugin-host/composition'
import { openComposition } from '@migaia/plugin-host/composition'
import { afterEach, vi } from 'vitest'
import {
  PluginHost,
  defineFeature,
  definePlugin,
  type IPluginHostCore,
  type IPluginPreparedAdmissions
} from '@migaia/plugin-host'

/** Real provenance remains owned by PluginHost; this test only observes the public protocol read. */
const actualOpenComposition = composition.openComposition

/** Replaces the existing reader seam for this fixture's concrete host, preserving every other read. */
export function overrideCompositionPortForTest(
  target: object,
  port: ReturnType<typeof openComposition>
): void {
  vi.spyOn(composition, 'openComposition').mockImplementation((host) =>
    host === target ? port : actualOpenComposition(host)
  )
}

/** Protocol observation must not leak into another test. */
afterEach(() => {
  vi.restoreAllMocks()
})

type ITestCore = Record<string, never>

export class TestHost extends PluginHost<ITestCore, string> {}

export class AsyncTestHost extends PluginHost<ITestCore, string> {
  runValue(value: string): Promise<void> {
    return Promise.resolve(this.runPipeline(value, () => undefined))
  }
}

/**
 * Observes publication through the public composition reader fixture. The wrapped port delegates to
 * the canonical producer and keeps revision as a live getter, rather than a spread-time snapshot.
 */
export class PublicationBarrierHost extends TestHost {
  observeCommit: (() => void) | undefined

  constructor(options: ConstructorParameters<typeof TestHost>[0]) {
    super(options)
    const port = openComposition(this)
    overrideCompositionPortForTest(
      this,
      Object.freeze({
        createPluginAdmission: port.createPluginAdmission,
        createDataOrderSlot: port.createDataOrderSlot,
        retireDataOrderSlot: port.retireDataOrderSlot,
        prepareAdmissions: port.prepareAdmissions,
        discardPreparedAdmissions: port.discardPreparedAdmissions,
        prepareUnUseBatch: port.prepareUnUseBatch,
        commitPreparedUnUseBatch: port.commitPreparedUnUseBatch,
        getCurrentSnapshot: port.getCurrentSnapshot,
        get revision() {
          return port.revision
        },
        commitPreparedAdmissions: (prepared: IPluginPreparedAdmissions) => {
          const receipts = port.commitPreparedAdmissions(prepared)
          this.observeCommit?.()
          return receipts
        }
      })
    )
  }
}

export const options = (
  plugins: readonly unknown[],
  create: () => TestHost = () =>
    new TestHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })
) => ({
  create,
  plugins: plugins as never,
  mutationAdmissionMs: 100,
  quiescenceMs: 100,
  shutdown: { mode: 'bounded' as const }
})

/** Creates raw descriptors whose lifecycle edges come from trusted Feature references. */
export const plugin = (name: string, providers: readonly string[] = [], events: string[] = []) => ({
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
    events.push(`install:${name}`)
    core.onDispose(() => {
      events.push(`dispose:${name}`)
    })
    return { [name]: name }
  }
})
