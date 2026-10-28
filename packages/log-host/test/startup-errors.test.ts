import { expect, it } from 'vitest'
import { createLogHost } from '../src/index.ts'
import * as sdk from '../src/plugin.ts'
import { formatFeature } from '../src/features/format.ts'
import { thresholdFeature } from '../src/features/threshold.ts'
import { uuidFeature } from '../src/features/uuid.ts'
import type { ILogOutputRecord, ILogFeature } from '../src/typing.ts'
import { CaptureOutput } from './fixtures/output.ts'
import type { ILogEntry } from '../src/typing.ts'

/** Public third-party format deliberately uses a kind different from the built-in format. */
function otherFormat() {
  return sdk.defineLogFeature({ kind: 'custom-format', phase: 'format', format: customText })
}
/** A deterministic text makes selected descriptor identity observable independently of entry JSON. */
function customText(): string {
  return 'custom'
}
/** Startup-only output fixtures never need to deliver a record. */
function ignoreDelivery(): void {}
/** Reject a second host format even though its kind differs from the first one's kind. */
function duplicateHostFormats(): void {
  expect(() =>
    createLogHost({ features: [formatFeature({ format: 'json' }), otherFormat()] })
  ).toThrowError(expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' }))
}
/** Output scope duplicate admission uses the same identity and path as other scope errors. */
function duplicateOutputFormats(): void {
  expect(() =>
    sdk.defineOutputPlugin({
      name: 'output',
      batchable: true,
      defaultFormat: 'json',
      features: [formatFeature({ format: 'json' }), otherFormat()],
      deliver: ignoreDelivery
    })
  ).toThrowError(expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' }))
}

/** The capture fixture observes selected text and descriptor identity from real output delivery. */
class FormatCapture {
  /** All records preserve the output factory's declared text format. */
  readonly records: ILogOutputRecord[] = []
  /** Selected descriptor identity must survive the host priority resolver unchanged. */
  selected: ILogFeature | undefined
  /** Build a normal output scope containing exactly one custom format. */
  plugin(feature: Extract<ILogFeature, { phase: 'format' }>) {
    return sdk.defineOutputPlugin({
      name: 'output',
      batchable: true,
      defaultFormat: 'json',
      features: [feature],
      deliver: (records, context) => this.receive(records, context.format)
    })
  }
  /** Keep the observation loop outside the factory callback. */
  receive(records: readonly ILogOutputRecord[], format: ILogFeature): void {
    this.records.push(...records)
    this.selected = format
  }
}
/** Cross-scope formats remain legal, with every output format overriding the host's format. */
async function outputOverridesDifferentKind(): Promise<void> {
  /** The factory returns the exact descriptor that delivery must later expose. */
  const feature = otherFormat()
  /** Independent observations avoid inferring selection merely from total record count. */
  const capture = new FormatCapture()
  /** Each scope has one format; their different kinds do not prevent overriding. */
  const host = createLogHost({
    features: [formatFeature({ format: 'json' })],
    plugins: [capture.plugin(feature)]
  })
  host.log('info', 'message')
  await host.flush()
  expect(capture.records).toHaveLength(1)
  expect(capture.records[0].text).toBe('custom')
  expect(capture.selected).toBe(feature)
  await host.shutdown('manual')
}

/** Existing scope rejection cases remain intact beside the phase-level uniqueness requirement. */
function malformedHostOptions(): void {
  expect(() => createLogHost({ maxPending: 0 })).toThrowError(
    expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' })
  )
  expect(() => createLogHost({ features: [thresholdFeature(), thresholdFeature()] })).toThrowError(
    expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' })
  )
  expect(() =>
    sdk.defineOutputPlugin({
      name: 'entry-output',
      batchable: true,
      defaultFormat: 'json',
      features: [uuidFeature()],
      deliver: ignoreDelivery
    })
  ).toThrowError(expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' }))
}

it('rejects distinct-kind duplicate host formats', duplicateHostFormats)
it('rejects distinct-kind duplicate output formats', duplicateOutputFormats)
it('uses output format across different host/output kinds', outputOverridesDifferentKind)
it('rejects malformed options and output-local entry features', malformedHostOptions)

/** Plain complete literals and shallow copies cannot manufacture the private descriptor identity. */
function forgedDescriptors(): void {
  /** A complete callable shape still lacks the factory-issued runtime identity. */
  const literal = { kind: 'forged', phase: 'entry', stage: identityEntry } as unknown as ILogFeature
  /** Copying a real descriptor does not copy its private registry registration. */
  const original = sdk.defineLogFeature({ kind: 'original', phase: 'entry', stage: identityEntry })
  for (const feature of [literal, { ...original }])
    expect(() => createLogHost({ features: [feature] })).toThrowError(
      expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' })
    )
}
/** An identity stage keeps negative descriptor admission fixtures behaviorally complete. */
function identityEntry(entry: ILogEntry): ILogEntry {
  return entry
}

/** The caller may mutate its input definition after issuance without changing the issued policy. */
async function immutableDefinitionSnapshot(): Promise<void> {
  /** The input remains caller-owned and deliberately mutable after factory return. */
  const definition = { kind: 'snapshot', phase: 'entry' as const, stage: originalMessage }
  /** Both visible descriptor fields and private normalized behavior must capture this revision. */
  const feature = sdk.defineLogFeature(definition)
  definition.stage = replacementMessage
  expect(Object.isFrozen(feature)).toBe(true)
  expect(Object.isFrozen(definition)).toBe(false)
  /** Transport output observes behavior through the real host feature pipeline. */
  const output = new CaptureOutput()
  /** Factory-issued entry processing runs once before output consumption. */
  const host = createLogHost({ features: [feature], plugins: [output.plugin()] })
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
  features(): readonly ILogFeature[] {
    return [
      sdk.defineLogFeature({
        kind: 'entry-count',
        phase: 'entry',
        stage: (entry) => this.enter(entry)
      }),
      sdk.defineLogFeature({ kind: 'gate-count', phase: 'gate', accept: () => this.accept() }),
      sdk.defineLogFeature({ kind: 'ignored-format', phase: 'format', format: () => this.format() })
    ]
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
  const host = createLogHost({ features: output.features(), plugins: [output.plugin()] })
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
      features: [formatFeature({ format: 'json' })],
      deliver: ignoreDelivery
    })
  ).toThrowError(expect.objectContaining({ source: 'logging', code: 'INVALID_OPTION' }))
}

it(
  'skips host format while preserving entry and gate work for entry-only output',
  entryOnlyIgnoresHostFormat
)
it('rejects output-local format on entry-only output at creation', entryOnlyRejectsLocalFormat)
