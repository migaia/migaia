import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bridgeFixture, flush } from './fixture.js'
import { objectFixtureEndpoint } from './json-object-fixture.js'
import { objectGoldenCase } from './json-object-golden-fixture.js'

/** Each retained base frame and inner observation is compared individually after implementation. */
type IGoldenEntry = Readonly<{ frame: string; result: unknown }>

/** Observe prototypes, freeze, key order and negative zero independently of JSON wire text. */
function observeInner(value: unknown): unknown {
  if (value === null || typeof value !== 'object')
    return typeof value === 'number' && Object.is(value, -0) ? { negativeZero: true } : value
  if (Array.isArray(value))
    return {
      array: value.map((item) => observeInner(item)),
      frozen: Object.isFrozen(value)
    }
  return {
    keys: Object.keys(value),
    prototype: Object.getPrototypeOf(value) === null ? 'null' : 'plain',
    frozen: Object.isFrozen(value),
    entries: Object.keys(value).map((key) => [
      key,
      observeInner((value as Record<string, unknown>)[key])
    ])
  }
}

describe('I21 C2 fixed-seed frame equivalence', () => {
  it('[EQ1] compares every physical frame and inner result for 10000 seeded payloads', async () => {
    /** Two independently assembled endpoints differ only by the public fallback middleware. */
    const fixtures = [bridgeFixture(), bridgeFixture()]
    /** Both negotiated channels use identical peer contract, clocks and deterministic IDs. */
    const channels = await Promise.all(fixtures.map((fixture) => fixture.open()))
    /** The first endpoint exercises default production admission; the second stays public string. */
    const endpoints = await Promise.all(
      channels.map((channel, index) => objectFixtureEndpoint(channel, { fallback: index === 1 }))
    )
    /** One cross-revision digest covers each equal business frame in order, excluding hello. */
    const digest = createHash('sha256')
    /**
     * The same frozen fixture runs against base 44f6296 first; candidate consumes its actual
     * output.
     */
    const baseline = process.env.I21_GOLDEN_INPUT
      ? (JSON.parse(readFileSync(process.env.I21_GOLDEN_INPUT, 'utf8')) as IGoldenEntry[])
      : undefined
    /** Output is optional, requested only by the explicitly scheduled pre/post evidence run. */
    const captured: IGoldenEntry[] = []
    if (baseline) expect(baseline).toHaveLength(10000)
    try {
      for (let index = 0; index < 10000; index++) {
        /** Each endpoint receives an independent user graph with the same alias shape. */
        const pending = endpoints.map((endpoint) =>
          endpoint.send('peer', 'p.f.request', objectGoldenCase(index).args, { timeoutMs: 100 })
        )
        await flush()
        /** Exact bytes, including field order, escaping and Content-Length, decide equivalence. */
        const frames = fixtures.map((fixture) => fixture.writes.at(-1)!)
        expect(Buffer.from(frames[0]!)).toEqual(Buffer.from(frames[1]!))
        digest.update(frames[0]!)
        for (const fixture of fixtures)
          fixture.deliver({
            jsonrpc: '2.0',
            id: fixture.messages.at(-1)!.id,
            result: objectGoldenCase(index).result
          })
        /** Inner result equality separately catches changes hidden by matching outbound bytes. */
        const results = await Promise.all(pending)
        expect(results[0]).toEqual(results[1])
        /** Data aliasing cannot be observed through JSON text; assert separate inner references. */
        if (objectGoldenCase(index).alias) {
          expect(Object.is(((results[0] as unknown[])[2] as unknown[])[2], -0)).toBe(false)
          const record = (results[0] as unknown[])[0] as Record<string, unknown>
          expect(record.z).not.toBe(record.a)
          expect(record.z).not.toBe((results[0] as unknown[])[1])
        }
        const entry = {
          frame: Buffer.from(frames[0]!).toString('base64'),
          result: observeInner(results[0])
        }
        if (baseline) expect(entry).toEqual(baseline[index])
        if (process.env.I21_GOLDEN_OUTPUT) captured.push(entry)
      }
      expect(fixtures.map((fixture) => fixture.messages.length)).toEqual([10001, 10001])
      if (process.env.I21_GOLDEN_OUTPUT)
        writeFileSync(process.env.I21_GOLDEN_OUTPUT, JSON.stringify(captured))
      console.log(`I21_EQ1 frames=10000 seed=0x21c2 sha256=${digest.digest('hex')}`)
    } finally {
      await Promise.all(endpoints.map((endpoint) => endpoint.dispose()))
      await Promise.all(channels.map((channel) => channel.close()))
    }
  }, 120000)
})
