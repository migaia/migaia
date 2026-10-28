import { describe, expect, it, vi } from 'vitest'
import { defineFeature, definePlugin, PluginHost, readPluginDependencies } from '../src/index.ts'
import { openComposition } from '../src/composition-entry.ts'
import * as admissionRuntime from '../src/admission-runtime.ts'

/** Creates an unbounded Host so admission and ordering need no scheduler timing. */
const createHost = (): PluginHost<Record<string, never>> =>
  new PluginHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })

/** Builds direct and nested references while recording accidental lifecycle evaluation. */
const createDefinitions = () => {
  /** Any lifecycle call during dependency reading violates the projection-only contract. */
  const calls = { factory: 0, setup: 0, install: 0 }
  /** Captures actual Host installation order for the canonical projection assertion. */
  const order: string[] = []
  /** Creates one provider whose Feature exposes its name. */
  const provider = <const TName extends string>(name: TName) =>
    definePlugin({
      name,
      features: {
        value: defineFeature(() => {
          calls.factory += 1
          return { value: name }
        })
      },
      install: () => {
        calls.install += 1
        order.push(name)
        return {}
      }
    })
  /** Required and optional references share p; q remains optional and r is nested locally. */
  const p = provider('p')
  /** Optional provider demonstrates that absence does not strengthen its edge. */
  const q = provider('q')
  /** Provider reached only through a local Feature dependency. */
  const r = provider('r')
  /** Direct required edge appears before its optional duplicate. */
  const required = defineFeature(() => ({ value: true }), { p: p.getFeature('value') })
  /** Optional duplicate must not weaken p or strengthen q. */
  const optional = defineFeature(() => ({ value: true }), {
    p: p.getFeature('value', { optional: true }),
    q: q.getFeature('value', { optional: true })
  })
  /** This Feature is absent from plugin roots and must still contribute its r reference. */
  const nested = defineFeature(() => ({ value: true }), { r: r.getFeature('value') })
  /** Local closure connects the nested Feature to the plugin roots. */
  const local = defineFeature(() => ({ value: true }), { nested })
  /** Raw and minted inputs share identical roots and lifecycle hooks. */
  const descriptor = {
    name: 'consumer',
    features: { required, optional, local },
    setup: () => {
      calls.setup += 1
      return undefined
    },
    install: () => {
      calls.install += 1
      order.push('consumer')
      return {}
    }
  }
  return { calls, order, p, q, r, descriptor, consumer: definePlugin(descriptor) }
}

/** First-reference order and required-wins strength are the public projection. */
const expected = [
  { provider: 'p', required: true },
  { provider: 'q', required: false },
  { provider: 'r', required: true }
] as const

describe('readPluginDependencies', () => {
  it('reads minted inputs, merges strength and follows local closures without running hooks', () => {
    /** Shared graph with two p references and a nested r reference. */
    const definitions = createDefinitions()
    expect(readPluginDependencies(definitions.consumer)).toEqual(expected)
    expect(definitions.calls).toEqual({ factory: 0, setup: 0, install: 0 })
  })

  it('reads the equivalent valid raw descriptor through canonical admission', () => {
    /** Raw input must admit the same supported Feature graph as definePlugin. */
    const definitions = createDefinitions()
    expect(readPluginDependencies(definitions.descriptor)).toEqual(expected)
    expect(definitions.calls).toEqual({ factory: 0, setup: 0, install: 0 })
  })

  it('preserves the native error shape thrown by canonical admission for an invalid descriptor', async () => {
    /** Invalid name is rejected by the canonical producer before installation. */
    const descriptor = { name: '', install: () => ({}) }
    /** Admission is read only; Host cleanup still belongs to this test. */
    const host = createHost()
    /** Keeps canonical validation unchanged while observing the error it actually throws. */
    const canonicalSnapshot = admissionRuntime.snapshotPluginDefinitions
    /** The reader must retain the same error allocation emitted by its producer. */
    let original: unknown
    /** Producer stack is captured before reader error handling can replace or rewrite it. */
    let originalStack: string | undefined
    /** Existing module export is the observation point; no production seam is introduced. */
    const snapshot = vi
      .spyOn(admissionRuntime, 'snapshotPluginDefinitions')
      .mockImplementation((plugins, trustedReader) => {
        try {
          return canonicalSnapshot(plugins, trustedReader)
        } catch (error) {
          original = error
          originalStack = (error as Error).stack
          throw error
        }
      })
    try {
      /** Captures each independent validation error without assuming they are one allocation. */
      const capture = (read: () => unknown): unknown => {
        try {
          read()
        } catch (error) {
          return error
        }
        return undefined
      }
      /** Canonical producer defines the expected native type and boundary metadata. */
      const admittedError = capture(() => openComposition(host).createPluginAdmission(descriptor))
      /** Public reader must pass its canonical validation error through without wrapping. */
      const readerError = capture(() => readPluginDependencies(descriptor))
      expect(admittedError).toBeInstanceOf(TypeError)
      expect(readerError).toBeInstanceOf(TypeError)
      expect(readerError).toMatchObject({
        name: (admittedError as Error).name,
        message: (admittedError as Error).message,
        source: (admittedError as Error & { source: string }).source,
        code: (admittedError as Error & { code: string }).code
      })
      expect((readerError as Error).stack).toEqual(expect.any(String))
      expect((readerError as Error).stack!.length).toBeGreaterThan(0)
      expect(readerError).toBe(original)
      expect((readerError as Error).stack).toBe(originalStack)
    } finally {
      snapshot.mockRestore()
      await host.dispose()
    }
  })

  it('reads the captured admission without re-reading its stateful features getter', async () => {
    /** Provider references in the first snapshot must survive later descriptor changes. */
    const definitions = createDefinitions()
    /** Counts admission snapshots; a second read deliberately removes all references. */
    let getterCalls = 0
    /** Valid raw descriptor uses the existing supported getter admission path. */
    const descriptor = {
      name: 'consumer',
      get features() {
        getterCalls += 1
        return getterCalls === 1 ? definitions.descriptor.features : {}
      },
      install: () => ({})
    }
    /** Owns the opaque admission token used by the public reader. */
    const host = createHost()
    try {
      /** Canonical producer captures the first Feature record. */
      const admission = openComposition(host).createPluginAdmission(descriptor)
      expect(getterCalls).toBe(1)
      expect(readPluginDependencies(admission)).toEqual(expected)
      expect(getterCalls).toBe(1)
      expect(definitions.calls).toEqual({ factory: 0, setup: 0, install: 0 })
    } finally {
      await host.dispose()
    }
  })

  it('keeps Host provider ordering through the same dependency projection', async () => {
    /** Reverse publication order proves the shared extractor still drives Host installation. */
    const definitions = createDefinitions()
    /** Host owns installed Features and must be disposed after the assertion. */
    const host = createHost()
    try {
      await host.use(definitions.consumer, definitions.r, definitions.q, definitions.p)
      expect(definitions.order).toEqual(['r', 'q', 'p', 'consumer'])
      expect(readPluginDependencies(definitions.consumer)).toEqual(expected)
    } finally {
      await host.dispose()
    }
  })
})
