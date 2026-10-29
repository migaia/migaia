import { expect, it } from 'vitest'
import { createLogHost } from '../src/index.ts'
import * as sdk from '../src/plugin.ts'
import { formatFeature } from '../src/features/format.ts'
import { thresholdFeature } from '../src/features/threshold.ts'
import { uuidFeature } from '../src/features/uuid.ts'
import type { ILogOutputRecord, ILogFeature, ILogFeatureRecord, ILogFormat } from '../src/typing.ts'
import { CaptureOutput } from './fixtures/output.ts'
import type { ILogEntry } from '../src/typing.ts'

/** Public third-party text is independent of the record key used to declare it. */
function otherFormat() {
  return sdk.defineLogFeature({ phase: 'format', format: customText })
}
/** Deterministic text makes installed format selection observable independently of entry JSON. */
function customText(): string {
  return 'custom'
}
/** Startup-only output fixtures never need to deliver a record. */
function ignoreDelivery(): void {}
/** Distinct host keys both survive, so a text output rejects the second effective format. */
function duplicateHostFormats(): void {
  /** Constructing cold declarations is valid before an output's effective scope exists. */
  const policy = sdk.defineLogPlugin({
    name: 'policy',
    features: { format: formatFeature({ format: 'json' }), otherFormat: otherFormat() }
  })
  /** The singular format slot belongs to an installed output after key overrides. */
  const output = new CaptureOutput()
  expect(() => createLogHost({ plugins: [policy, output.plugin()] })).toThrowError(
    expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' })
  )
}
/** Local singular-slot validation runs at actual installation rather than cold definition. */
function duplicateOutputFormats(): void {
  /** Both declarations remain native features while they await an installing host. */
  const output = sdk.defineOutputPlugin({
    name: 'output',
    batchable: true,
    defaultFormat: 'json',
    features: { format: formatFeature({ format: 'json' }), otherFormat: otherFormat() },
    deliver: ignoreDelivery
  })
  expect(() => createLogHost({ plugins: [output] })).toThrowError(
    expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' })
  )
}

/** The capture fixture observes selected text and the installed formatter from real output delivery. */
class FormatCapture {
  /** All records preserve the output factory's declared text format. */
  readonly records: ILogOutputRecord[] = []
  /** Installed formatter metadata makes selection observable without exposing token fields. */
  selected: ILogFormat | undefined
  /** Build a normal output scope containing exactly one custom format. */
  plugin(feature: ILogFeature) {
    return sdk.defineOutputPlugin({
      name: 'output',
      batchable: true,
      defaultFormat: 'json',
      features: { format: feature },
      deliver: (records, context) => this.receive(records, context.format)
    })
  }
  /** Keep the observation loop outside the factory callback. */
  receive(records: readonly ILogOutputRecord[], format: ILogFormat): void {
    this.records.push(...records)
    this.selected = format
  }
}
/** A local record key replaces precisely the matching host-wide record key. */
async function outputOverridesSameKey(): Promise<void> {
  /** The cold native token selects the installed formatter observed through delivery. */
  const feature = otherFormat()
  /** Independent observations avoid inferring selection merely from total record count. */
  const capture = new FormatCapture()
  /** Both declarations use the format key, leaving one effective installed formatter. */
  const host = createLogHost({
    plugins: [
      sdk.defineLogPlugin({
        name: 'policy',
        features: { format: formatFeature({ format: 'json' }) }
      }),
      capture.plugin(feature)
    ]
  })
  host.log('info', 'message')
  await host.flush()
  expect(capture.records).toHaveLength(1)
  expect(capture.records[0].text).toBe('custom')
  expect(capture.selected?.format).toBe(customText)
  expect(capture.selected?.phase).toBe('format')
  expect(capture.selected).not.toBe(feature)
  await host.shutdown('manual')
}

/** Existing scope rejection cases remain intact beside the phase-level uniqueness requirement. */
function malformedHostOptions(): void {
  expect(() => createLogHost({ maxPending: 0 })).toThrowError(
    expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' })
  )
  expect(() =>
    createLogHost({
      plugins: [
        sdk.defineLogPlugin({ name: 'first-policy', features: { threshold: thresholdFeature() } }),
        sdk.defineLogPlugin({ name: 'second-policy', features: { threshold: thresholdFeature() } })
      ]
    })
  ).toThrowError(expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' }))
  expect(() =>
    sdk.defineOutputPlugin({
      name: 'entry-output',
      batchable: true,
      defaultFormat: 'json',
      features: { uuid: uuidFeature() },
      deliver: ignoreDelivery
    })
  ).toThrowError(expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' }))
}

it('rejects multiple effective host formats at output installation', duplicateHostFormats)
it('rejects multiple effective local formats at output installation', duplicateOutputFormats)
it('uses output format for the same host/output record key', outputOverridesSameKey)
it('rejects malformed options and output-local entry features', malformedHostOptions)

/** A local format with a different key supplements the host format rather than replacing it. */
function differentFormatKeysConflict(): void {
  /** The host key and output key deliberately differ while both select the format phase. */
  const policy = sdk.defineLogPlugin({ name: 'policy', features: { hostFormat: otherFormat() } })
  /** The cold output is valid until its host-wide defaults become known during installation. */
  const output = sdk.defineOutputPlugin({
    name: 'output',
    batchable: true,
    defaultFormat: 'json',
    features: { localFormat: formatFeature({ format: 'plain' }) },
    deliver: ignoreDelivery
  })
  expect(() => createLogHost({ plugins: [policy, output] })).toThrowError(
    expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' })
  )
}
it(
  'BC6 rejects distinct-key host and output formats at actual installation',
  differentFormatKeysConflict
)

/** Plain complete literals and shallow copies cannot manufacture native feature identity. */
function forgedDescriptors(): void {
  /** A complete callable shape still lacks plugin-host native identity. */
  const literal = { phase: 'entry', stage: identityEntry } as unknown as ILogFeature
  /** Copying a native feature does not copy plugin-host issuance. */
  const original = sdk.defineLogFeature({ phase: 'entry', stage: identityEntry })
  for (const feature of [literal, { ...original }])
    expect(() =>
      createLogHost({
        plugins: [sdk.defineLogPlugin({ name: 'policy', features: { feature: feature } })]
      })
    ).toThrowError(
      expect.objectContaining({
        source: 'logging',
        code: 'INVALID_OPTION',
        cause: expect.objectContaining({
          source: 'plugin.host',
          code: 'INVALID_OPTION',
          stack: expect.any(String)
        })
      })
    )
}
/** An identity stage keeps negative descriptor admission fixtures behaviorally complete. */
function identityEntry(entry: ILogEntry): ILogEntry {
  return entry
}

/** The caller may mutate its input definition after issuance without changing the issued policy. */
async function immutableDefinitionSnapshot(): Promise<void> {
  /** The input remains caller-owned and deliberately mutable after factory return. */
  const definition = { phase: 'entry' as const, stage: originalMessage }
  /** The installed implementation must capture this definition revision without token fields. */
  const feature = sdk.defineLogFeature(definition)
  definition.stage = replacementMessage
  expect(Object.isFrozen(feature)).toBe(true)
  expect(Object.isFrozen(definition)).toBe(false)
  /** Transport output observes behavior through the real host feature pipeline. */
  const output = new CaptureOutput()
  /** Factory-issued entry processing runs once before output consumption. */
  const host = createLogHost({
    plugins: [
      sdk.defineLogPlugin({ name: 'policy', features: { feature: feature } }),
      output.plugin()
    ]
  })
  host.log('info', 'input')
  await host.flush()
  expect(output.records[0].entry.message).toBe('original-definition')
  await host.shutdown('manual')
}
/** The initially issued callback has a distinct observable result. */
function originalMessage(entry: ILogEntry): ILogEntry {
  return { ...entry, message: 'original-definition' }
}
/** A later caller mutation would be visible if the private implementation borrowed caller state. */
function replacementMessage(entry: ILogEntry): ILogEntry {
  return { ...entry, message: 'replacement-definition' }
}
it('rejects complete forged and copied descriptors with the same identity', forgedDescriptors)
it('snapshots caller-owned definitions without freezing their input', immutableDefinitionSnapshot)

/** A10: JavaScript arrays are rejected rather than silently losing their requested policies. */
function rejectArrayDeclarations(): void {
  /** Even an empty array uses the retired declaration form and must be rejected. */
  for (const features of [[], [thresholdFeature()]]) {
    expect(() =>
      sdk.defineLogPlugin({
        name: 'array-carrier',
        features: features as unknown as ILogFeatureRecord
      })
    ).toThrowError(expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' }))
    expect(() =>
      sdk.defineOutputPlugin({
        name: 'array-output',
        batchable: true,
        defaultFormat: 'json',
        features: features as unknown as ILogFeatureRecord,
        deliver: ignoreDelivery
      })
    ).toThrowError(expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' }))
  }
}
it('A10 rejects array feature declarations on carriers and outputs', rejectArrayDeclarations)

/** An entry-only transport observes neither host text nor a fabricated format context. */
class EntryOnlyOutput {
  /** Host entry processing must still run exactly once for this output. */
  entries = 0
  /** Output gates retain their ordinary invocation boundary. */
  gates = 0
  /** An ignored host formatter must never run for this transport. */
  formats = 0
  /** Only the public entry-only record shape is retained. */
  readonly records: Array<Pick<ILogOutputRecord, 'entry'>> = []
  /** Context keys make the absence of a dummy format independently observable. */
  readonly contexts: object[] = []
  /** Real issued entry, gate and format policies exercise every relevant phase. */
  features(): ILogFeatureRecord {
    return {
      entry: sdk.defineLogFeature({
        phase: 'entry',
        stage: (entry) => this.enter(entry)
      }),
      gate: sdk.defineLogFeature({ phase: 'gate', accept: () => this.accept() }),
      format: sdk.defineLogFeature({ phase: 'format', format: () => this.format() })
    }
  }
  /** This normal public definition deliberately has no defaultFormat. */
  plugin() {
    return sdk.defineOutputPlugin({
      name: 'entry-only',
      batchable: true,
      consumesText: false,
      deliver: (records, context) => this.receive(records, context)
    })
  }
  /** Host entry features remain independent of text consumption. */
  enter(entry: ILogEntry): ILogEntry {
    this.entries++
    return entry
  }
  /** An accepting gate proves that skipping formatting does not skip gate policy. */
  accept(): boolean {
    this.gates++
    return true
  }
  /** An accidental format invocation fails before the output could receive any entry. */
  format(): never {
    this.formats++
    throw new Error('entry-only transport must not format text')
  }
  /** Capture the real public transport values without manufacturing compatibility fields. */
  receive(
    records: readonly Pick<ILogOutputRecord, 'entry'>[],
    context: { signal: AbortSignal }
  ): void {
    this.records.push(...records)
    this.contexts.push(context)
  }
}

/** Host defaults cannot force text creation for a transport that does not consume it. */
async function entryOnlyIgnoresHostFormat(): Promise<void> {
  /** The fixture observes entry, gate, format and final records separately. */
  const output = new EntryOnlyOutput()
  /** Every host policy is installed through the actual factory boundary. */
  const host = createLogHost({
    plugins: [sdk.defineLogPlugin({ name: 'policy', features: output.features() }), output.plugin()]
  })
  host.log('info', 'unformatted')
  await host.flush()
  expect(output.entries).toBe(1)
  expect(output.gates).toBe(1)
  expect(output.formats).toBe(0)
  expect(output.records).toHaveLength(1)
  expect(output.records[0].entry.message).toBe('unformatted')
  expect(Object.keys(output.records[0])).toEqual(['entry'])
  expect(Object.keys(output.contexts[0])).toEqual(['signal'])
  await host.shutdown('manual')
}

/** Output-local text policies contradict an explicitly entry-only transport definition. */
function entryOnlyRejectsLocalFormat(): void {
  expect(() =>
    sdk.defineOutputPlugin({
      name: 'invalid-entry-only',
      batchable: true,
      consumesText: false,
      features: { format: formatFeature({ format: 'json' }) },
      deliver: ignoreDelivery
    })
  ).toThrowError(expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' }))
}

it(
  'skips host format while preserving entry and gate work for entry-only output',
  entryOnlyIgnoresHostFormat
)
it('rejects output-local format on entry-only output at creation', entryOnlyRejectsLocalFormat)
