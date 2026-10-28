import { expect, it } from 'vitest'
import { createLogHost } from '../src/index.ts'
import { filterFeature } from '../src/features/filter.ts'
import { uuidFeature } from '../src/features/uuid.ts'
import { formatFeature } from '../src/features/format.ts'
import { projectLogEntry } from '../src/plugin.ts'
import type { ILogEntry } from '../src/typing.ts'
import { CaptureOutput, messageOf } from './fixtures/output.ts'

/** Initial predicates remain installed when an added registration is removed. */
async function mutableFilters(): Promise<void> {
  /** Two independently owned registrations exercise rejection and idempotent revocation. */
  const feature = filterFeature({ filters: [rejectInitial] })
  /** Output observation is independent of filter implementation internals. */
  const output = new CaptureOutput()
  /** Shared host-level policy applies before formatting and output delivery. */
  const host = createLogHost({ features: [feature], plugins: [output.plugin()] })
  /** Only this added occurrence is revoked by its returned handle. */
  const off = feature.add(rejectAdded)
  host.log('info', 'initial')
  host.log('info', 'added')
  host.log('info', 'allowed')
  await host.flush()
  expect(output.records.map(messageOf)).toEqual(['allowed'])
  off()
  off()
  host.log('info', 'initial')
  host.log('info', 'added')
  await host.flush()
  expect(output.records.map(messageOf)).toEqual(['allowed', 'added'])
  await host.shutdown('manual')
}
/** The original filter remains a separately owned registration. */
function rejectInitial(entry: ILogEntry): boolean {
  return entry.message !== 'initial'
}
/** The added filter's removal must not erase the original predicate. */
function rejectAdded(entry: ILogEntry): boolean {
  return entry.message !== 'added'
}

/** UUID generation belongs to each host while its display flag remains descriptor configuration. */
async function uuidDisplay(): Promise<void> {
  /** Both flags need separate observations rather than one shared total-count assertion. */
  for (const display of [false, true]) {
    /** Built-in entry descriptors retain the callable entry shape promised by the public union. */
    const feature = uuidFeature({ display })
    expect(feature.phase).toBe('entry')
    expect(feature).toHaveProperty('stage', expect.any(Function))
    /** Stable injected identity makes accidental global generation visible. */
    const output = new CaptureOutput()
    /** Each host independently owns its generator and display policy. */
    const host = createLogHost({
      randomUUID: fixedUUID,
      features: [feature],
      plugins: [output.plugin()]
    })
    host.log('info', 'uuid')
    await host.flush()
    expect(output.records[0].entry.data).toMatchObject({ uuid: 'injected', uuidDisplay: display })
    await host.shutdown('manual')
  }
}
/**
 * A deterministic injected identity is sufficient to distinguish this host from the global
 * generator.
 */
function fixedUUID(): string {
  return 'injected'
}

/** Both built-in format paths have independent observable baselines. */
async function builtinFormats(): Promise<void> {
  /** Structured JSON must use the shared projection rather than a second serializer. */
  const json = new CaptureOutput({ name: 'json', features: [formatFeature({ format: 'json' })] })
  /** Plain output retains the uncolored textual prefix and original argument text. */
  const plain = new CaptureOutput({ name: 'plain', features: [formatFeature({ format: 'plain' })] })
  /** Explicit input time makes the plain baseline deterministic. */
  const host = createLogHost({ plugins: [json.plugin(), plain.plugin()] })
  host.dispatchRaw({
    tag: 'info',
    message: 'message',
    time: new Date(0),
    context: ['fixture'],
    args: ['argument']
  })
  await host.flush()
  expect(json.records[0].text).toBe(JSON.stringify(projectLogEntry(json.records[0].entry)))
  expect(plain.records[0].text).toBe('[1970-01-01T00:00:00.000Z] [INFO] (fixture) message argument')
  await host.shutdown('manual')
}
it('retains initial filters when added registrations are revoked', mutableFilters)
it('uses injected UUIDs independently of their display flag', uuidDisplay)
it('renders JSON and uncolored plain text from canonical formats', builtinFormats)
