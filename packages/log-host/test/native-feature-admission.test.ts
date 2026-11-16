import { expect, it } from 'vitest'
import { defineFeature } from '@migaia/plugin-host/features'
import { createLogHost } from '../src/index.ts'
import { defineLogFeature, defineLogPlugin, defineOutputPlugin } from '../src/plugin.ts'
import {
  batchFeature,
  formatFeature,
  thresholdFeature,
  uuidFeature
} from '../src/features/index.ts'
import type { ILogFeatureDefinition, ILogOutputRecord } from '../src/typing.ts'

/** Public admission failures keep the log error domain and its option code. */
const invalidOption = expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' })

/** An entry-only sink that keeps delivered messages for assertions. */
class EntrySink {
  /** Messages in delivery order. */
  readonly messages: string[] = []
  /** Record each delivered entry message. */
  receive(records: readonly Pick<ILogOutputRecord, 'entry'>[]): void {
    for (const record of records) this.messages.push(record.entry.message)
  }
}

it('rejects a missing or incomplete third-party feature definition', () => {
  expect(() => defineLogFeature(undefined as unknown as ILogFeatureDefinition)).toThrowError(
    invalidOption
  )
  expect(() =>
    defineLogFeature({ phase: 'format' } as unknown as ILogFeatureDefinition)
  ).toThrowError(invalidOption)
})

it('rejects ordinary native features in a log plugin record', () => {
  /** A plain plugin-host feature with no log metadata. */
  const plain = defineFeature(() => ({ value: 1 }))
  /** The record is native-valid, so the definition is accepted and installation rejects it. */
  const mixed = defineLogPlugin({
    name: 'mixed',
    features: { plain, threshold: thresholdFeature() }
  } as unknown as Parameters<typeof defineLogPlugin>[0])
  expect(() => createLogHost({ plugins: [mixed] })).toThrowError(invalidOption)
})

/** Counts the resource-owning callbacks of an output that installation must reject first. */
class RejectedOutput {
  /** Application installer calls; zero proves admission ran before any output resource opened. */
  installs = 0
  /** Transport calls; a rejected output never receives a record. */
  deliveries = 0
  /** Define one output whose feature record or fallback breaks an installation rule. */
  plugin(options: Record<string, unknown>) {
    return defineOutputPlugin({
      name: 'rejected',
      batchable: true,
      defaultFormat: 'json',
      ...options,
      install: () => this.install(),
      deliver: () => this.deliver()
    } as unknown as Parameters<typeof defineOutputPlugin>[0])
  }
  /** Record an application installer call. */
  install(): Record<never, never> {
    this.installs++
    return {}
  }
  /** Record a transport call. */
  deliver(): void {
    this.deliveries++
  }
}

it('rejects output feature-role violations at installation, before the output opens', () => {
  /** Each case breaks exactly one of the four record rules. */
  const cases: Record<string, unknown>[] = [
    { features: { uuid: uuidFeature() } },
    { features: { first: batchFeature(), second: batchFeature() } },
    {
      consumesText: false,
      defaultFormat: undefined,
      features: { format: formatFeature({ format: 'json' }) }
    },
    { defaultFormat: thresholdFeature() }
  ]
  for (const options of cases) {
    /** The definition call itself is accepted for every case. */
    const rejected = new RejectedOutput()
    /** Cold definition of the offending output. */
    const plugin = rejected.plugin(options)
    expect(() => createLogHost({ plugins: [plugin] })).toThrowError(invalidOption)
    expect(rejected.installs).toBe(0)
    expect(rejected.deliveries).toBe(0)
  }
})

it('rejects a repeated singular role in a host-wide record at installation', () => {
  /** Two batch policies under different keys occupy the same singular role. */
  const policy = defineLogPlugin({
    name: 'policy',
    features: { first: batchFeature(), second: batchFeature() }
  })
  expect(() => createLogHost({ plugins: [policy] })).toThrowError(invalidOption)
})

it('applies a host-wide gate to an entry-only output and exposes its control', async () => {
  /** Host-wide policy holds one threshold gate. */
  const policy = defineLogPlugin({
    name: 'policy',
    features: { threshold: thresholdFeature({ level: 'info' }) }
  })
  /** The entry-only sink observes what the host-wide gate lets through. */
  const sink = new EntrySink()
  /** Entry-only output with no local features inherits the host-wide gate. */
  const output = defineOutputPlugin({
    name: 'entries',
    batchable: false,
    consumesText: false,
    deliver: (records) => sink.receive(records)
  })
  /** Host under test. */
  const host = createLogHost({ plugins: [policy, output] })
  expect(typeof host.policy_threshold_setLevel).toBe('function')
  host.log('debug', 'dropped')
  host.log('info', 'kept')
  await host.flush()
  expect(sink.messages).toEqual(['kept'])
  await host.shutdown('manual')
})

it('lets an entry-only output use gates but not a text format', async () => {
  expect(() =>
    defineOutputPlugin({
      name: 'entries',
      batchable: false,
      consumesText: false,
      defaultFormat: 'json',
      deliver: () => undefined
    } as unknown as Parameters<typeof defineOutputPlugin>[0])
  ).toThrowError(invalidOption)
  /** The entry-only sink observes its own local gate. */
  const sink = new EntrySink()
  /** A local non-format feature is admitted on an entry-only output. */
  const output = defineOutputPlugin({
    name: 'gated',
    batchable: false,
    consumesText: false,
    features: { threshold: thresholdFeature({ level: 'warn' }) },
    deliver: (records) => sink.receive(records)
  })
  /** Host under test with only the gated entry output. */
  const host = createLogHost({ plugins: [output] })
  host.log('info', 'dropped')
  host.log('warn', 'kept')
  await host.flush()
  expect(sink.messages).toEqual(['kept'])
  await host.shutdown('manual')
})
