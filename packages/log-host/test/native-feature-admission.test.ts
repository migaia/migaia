import { expect, it } from 'vitest'
import { defineFeature } from '@migaia/plugin-host'
import { createLogHost } from '../src/index.ts'
import { defineLogFeature, defineLogPlugin, defineOutputPlugin } from '../src/plugin.ts'
import { thresholdFeature } from '../src/features/index.ts'
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
  expect(() =>
    defineLogPlugin({
      name: 'mixed',
      features: { plain, threshold: thresholdFeature() }
    } as unknown as Parameters<typeof defineLogPlugin>[0])
  ).toThrowError(invalidOption)
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
