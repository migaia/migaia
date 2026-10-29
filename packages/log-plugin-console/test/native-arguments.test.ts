import { defineLogPlugin } from '@migaia/log-host/plugin'
import { expect, it } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { formatFeature } from '@migaia/log-host/features'
import { defineLogFeature } from '@migaia/log-host/plugin'
import { consolePlugin, prettyFeature } from '../src/index.ts'
import { MemoryConsole, MemoryStdout } from './fixtures.ts'

/** Prefix formatting must never invoke native payload coercion before console sees its arguments. */
async function originalNativeArguments(): Promise<void> {
  /** This original object would fail any accidental String/JSON coercion path. */
  const object = {
    answer: 42,
    toString(): never {
      throw new Error('object was coerced')
    }
  }
  /** The host preserves its legacy shallow meta copy beside the original args metadata. */
  const meta = { request: 'original' }
  /** The exact original Error is passed as a separate final native argument. */
  const error = new Error('original-native-error')
  for (const color of ['always', 'never'] as const) {
    // Exactly two declared color policies are checked; no growable domain is sorted or rescanned.
    /** A fake console captures the argument list without invoking platform inspection. */
    const console = new MemoryConsole()
    /** The installed pretty implementation chooses native argument delivery. */
    const feature = prettyFeature({ color, timestamp: false })
    /** A host-level JSON format is overridden by this output's explicit pretty format. */
    const host = createLogHost({
      plugins: [
        defineLogPlugin({
          name: 'policy',
          features: { format: formatFeature({ format: 'json' }) }
        }),
        consolePlugin({ console, stdout: new MemoryStdout(), features: { format: feature } })
      ]
    })
    host.dispatchRaw({
      tag: 'info',
      message: 'object=%o',
      args: [object, meta],
      meta,
      error: { name: error.name, message: error.message, stack: error.stack, raw: error }
    })
    host.dispatchRaw({
      tag: 'info',
      message: 'meta',
      args: [object],
      meta,
      error: { name: error.name, message: error.message, stack: error.stack, raw: error }
    })
    await host.flush()
    expect(console.logs).toHaveLength(2)
    expect(console.logs[0]).toHaveLength(5)
    expect(console.logs[0][1]).toBe(object)
    expect(console.logs[0][2]).toBe(meta)
    expect(console.logs[0][3]).toEqual(meta)
    expect(console.logs[0][3]).not.toBe(meta)
    expect(console.logs[0][4]).toBe(error)
    expect(console.logs[1]).toHaveLength(4)
    expect(console.logs[1][1]).toBe(object)
    expect(console.logs[1][2]).toEqual(meta)
    expect(console.logs[1][2]).not.toBe(meta)
    expect(console.logs[1][3]).toBe(error)
    expect(String(console.logs[0][0])).toContain('object=%o')
    await host.shutdown('manual')
  }
}
it(
  'keeps message placeholders, object/meta order and original Error identity in pretty output',
  originalNativeArguments
)

/** Third-party text that resembles pretty output never grants native rendering authority. */
async function nonPrettyText(): Promise<void> {
  /** This descriptor has legitimate host identity but no console-owned pretty identity. */
  const thirdParty = defineLogFeature({
    phase: 'format',
    format: () => '[INFO] fake-pretty'
  })
  for (const feature of [
    formatFeature({ format: 'json' }),
    formatFeature({ format: 'plain' }),
    thirdParty
  ]) {
    // Three explicitly declared format alternatives are a fixed test domain.
    /** One output observes exactly one selected formatting policy. */
    const console = new MemoryConsole()
    /** The native object must not become another argument on any ordinary text path. */
    const host = createLogHost({
      plugins: [consolePlugin({ console, features: { format: feature } })]
    })
    host.log('info', 'ordinary', { value: true })
    await host.flush()
    expect(console.logs[0]).toHaveLength(1)
    if (feature === thirdParty) expect(console.logs[0]).toEqual(['[INFO] fake-pretty'])
    await host.shutdown('manual')
  }
}
it('sends only record.text for JSON, plain and third-party format descriptors', nonPrettyText)
