import { describe, expect, it } from 'vitest'
import { defineHost, definePlugin } from '../src/index.ts'

/** Original definition-owned observations are deliberately absent from the thin native result. */
type IObservations = { events: string[]; receivers: object[] }
/** Installation records its actual receiver rather than a wrapper-created replacement. */
function capturedInstall(this: IObservations): { owner: object } {
  this.events.push('installed')
  this.receivers.push(this)
  return { owner: this }
}
/** A fresh plain definition supplies getters and lifecycle methods with an observable receiver. */
function definitionSource() {
  return {
    events: [] as string[],
    receivers: [] as object[],
    get name(): string {
      this.events.push('name')
      return 'capture'
    },
    get install(): typeof capturedInstall {
      this.events.push('install')
      return capturedInstall
    },
    get metadata(): object {
      this.events.push('metadata')
      return { ignored: true }
    },
    dispose(): void {
      this.events.push('disposed')
      this.receivers.push(this)
    }
  }
}
/** Raw and native entry points read the same fields once and invoke original hooks on the source. */
async function captureParity(): Promise<void> {
  /** Getter and receiver observations belong to the original authoring object. */
  const nativeSource = definitionSource()
  /** This captured identity must not execute an installer during definition. */
  const native = definePlugin(nativeSource)
  expect(nativeSource.events).toEqual(['name', 'install'])
  expect(Reflect.ownKeys(native)).toEqual(['name', 'config', 'activation', 'getFeature'])
  expect(Object.isFrozen(native)).toBe(true)
  expect(native.config).toEqual({})
  expect(Object.isFrozen(native.config)).toBe(true)
  /** Plain hooks must work on a genuine core-only Host. */
  const nativeHost = defineHost()
  const [nativeHandle] = await nativeHost.use(native)
  expect(nativeHandle.extensions.owner).toBe(nativeSource)
  await nativeHost.dispose()
  expect(nativeSource.events).toEqual(['name', 'install', 'installed', 'disposed'])
  expect(nativeSource.receivers).toEqual([nativeSource, nativeSource])
  /** An independent raw input supplies the same admission-order control. */
  const rawSource = definitionSource()
  /** The raw route must use canonical admission rather than a copied native result. */
  const rawHost = defineHost()
  const [rawHandle] = await rawHost.use(rawSource)
  expect(rawHandle.extensions.owner).toBe(rawSource)
  await rawHost.dispose()
  expect(rawSource.events).toEqual(nativeSource.events)
  expect(rawSource.receivers).toEqual([rawSource, rawSource])
}
/** Both boundaries retain the original getter failure on the native TypeError cause. */
async function getterCause(): Promise<void> {
  /** Wrapping must retain this exact primary getter failure. */
  const original = new Error('captured getter fixture')
  /** A real accessor failure exercises both supported input boundaries. */
  const source = {
    get name(): string {
      throw original
    }
  }
  expect(() => definePlugin(source as never)).toThrowError(
    expect.objectContaining({
      name: 'TypeError',
      source: 'plugin.host',
      code: 'INVALID_OPTION',
      cause: original
    })
  )
  /** Invalid admission must fail before this real Host can acquire a registration. */
  const host = defineHost()
  try {
    expect(() => host.use(source as never)).toThrowError(
      expect.objectContaining({
        name: 'TypeError',
        source: 'plugin.host',
        code: 'INVALID_OPTION',
        cause: original
      })
    )
  } finally {
    await host.dispose()
  }
}
/** Name and expose validation precede native or raw acquisition with the same public messages. */
async function validationParity(): Promise<void> {
  /** Invalid admission must fail before this real Host can acquire a registration. */
  const host = defineHost()
  // Exactly three fixed invalid inputs cover the changed name and expose admission contracts.
  /** Exact messages distinguish the changed name rules from expose-shape validation. */
  const inputs = [
    {
      definition: { name: '', install: capturedInstall },
      message: 'plugin name must be a non-empty string'
    },
    {
      definition: { name: 'invalid.name', install: capturedInstall },
      message: 'plugin name must not contain "."'
    },
    {
      definition: { name: 'invalid-expose', install: capturedInstall, featureExpose: 1 },
      message: '[plugin-host] plugin featureExpose must be an object or function'
    }
  ] as const
  try {
    for (const input of inputs) {
      expect(() => definePlugin(input.definition as never)).toThrowError(
        expect.objectContaining({
          name: 'TypeError',
          source: 'plugin.host',
          code: 'INVALID_OPTION',
          message: input.message
        })
      )
      expect(() => host.use(input.definition as never)).toThrowError(
        expect.objectContaining({
          name: 'TypeError',
          source: 'plugin.host',
          code: 'INVALID_OPTION',
          message: input.message
        })
      )
    }
  } finally {
    await host.dispose()
  }
}
/**
 * Descriptor factories retain their original per-registration lifecycle rather than definition-time
 * execution.
 */
class DescriptorProbe {
  /** The two hosts must each create exactly one descriptor. */
  factories = 0
  /** Definition capture and repeated reads must not invoke an installer. */
  installs = 0
  /** A descriptor forwards installation to this explicit observation owner. */
  describe() {
    this.factories += 1
    return { install: () => this.install() }
  }
  /** Each actual registration contributes one installation effect. */
  install() {
    this.installs += 1
    return { value: 1 }
  }
}
/** Reusing a native identity across hosts does not share a descriptor or execute one eagerly. */
async function descriptorLifetime(): Promise<void> {
  /** Descriptor creation and installation effects are counted independently. */
  const probe = new DescriptorProbe()
  /** One trusted definition is deliberately reused across two independent registrations. */
  const definition = definePlugin('descriptor', () => probe.describe())
  expect([probe.factories, probe.installs]).toEqual([0, 0])
  /** Independent owners must materialize their own descriptors from the same definition. */
  const first = defineHost(),
    second = defineHost()
  try {
    await first.use(definition)
    await second.use(definition)
    expect([probe.factories, probe.installs]).toEqual([2, 2])
  } finally {
    await first.dispose()
    await second.dispose()
  }
}
/** Register the concrete capture and error-contract cases without nested fixture factories. */
function cases(): void {
  it(
    'preserves raw/native getter order, thin keys, empty config and original receivers',
    captureParity
  )
  it('retains original getter errors at both admission boundaries', getterCause)
  it('shares exact name and feature-expose failures before acquisition', validationParity)
  it('runs descriptor factories once per registration and never during capture', descriptorLifetime)
}
describe('definition capture', cases)
