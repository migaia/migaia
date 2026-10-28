import { expect, it } from 'vitest'
import { serializeErrorChain, UTILS_SOURCE } from '@migaia/utils/error'
import { createLogHost } from '../src/index.ts'
import { projectLogEntry } from '../src/plugin.ts'
import { formatFeature } from '../src/features/format.ts'
import { CaptureOutput } from './fixtures/output.ts'

/** JSON output preserves full canonical chains while excluding enumerable native private fields. */
async function canonicalProjection(): Promise<void> {
  /** The original cause carries package identity that must survive every structured output. */
  const original = Object.assign(new TypeError('cause'), {
    source: UTILS_SOURCE,
    code: 'INVALID_ARGUMENT'
  })
  /** Native aggregate and cause identities remain untouched on the source entry. */
  const error = Object.assign(new AggregateError([original], 'aggregate', { cause: original }), {
    privateField: 'fixture-private'
  })
  /** Default JSON and explicit JSON must share the same single projection owner. */
  const defaultOutput = new CaptureOutput({ name: 'default' })
  /** Explicit formatting must not introduce a second error serializer. */
  const explicitOutput = new CaptureOutput({
    name: 'explicit',
    features: [formatFeature({ format: 'json' })]
  })
  /** Native input errors are supplied explicitly, keeping args empty to isolate the error field. */
  const host = createLogHost({ plugins: [defaultOutput.plugin(), explicitOutput.plugin()] })
  host.dispatchRaw({
    tag: 'error',
    message: 'error',
    error: { name: error.name, message: error.message, stack: error.stack, raw: error },
    args: []
  })
  await host.flush()
  for (const output of [defaultOutput, explicitOutput]) {
    /** Each real output observes the original raw native object beside its structured text. */
    const record = output.records[0]
    expect(record.entry.error?.raw).toBe(error)
    expect(record.text).toBe(JSON.stringify(projectLogEntry(record.entry)))
    expect(record.text).not.toContain('privateField')
    expect(record.text).not.toContain('"raw"')
    expect(JSON.parse(record.text).error).toEqual(serializeErrorChain(error))
    expect(record.text).toContain(UTILS_SOURCE)
    expect(record.text).toContain(JSON.stringify(original.stack).slice(1, -1))
  }
  await host.shutdown('manual')
}
it(
  'shares full native error-chain projection across default and explicit JSON',
  canonicalProjection
)
