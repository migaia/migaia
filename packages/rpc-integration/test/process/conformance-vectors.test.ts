import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { evidence, peers } from './fixtures/conformance-business.js'
import { normalizeRpcFrame } from '@migaia/rpc-contract/protocol'
/** R17 current semantic vectors are independent of the retired v1 TS endpoint runner. */
const vectors = JSON.parse(
  readFileSync(new URL('../../schema/vectors/core-profile.json', import.meta.url), 'utf8')
) as {
  valid: Array<{ id: string; frame: unknown }>
  invalid: Array<{ id: string; frame: unknown }>
  unknownIgnored: Array<{ id: string; baseline: unknown; frame: unknown; pointer: string }>
}
/** Every current case must appear in each real independent peer's complete selftest receipt. */
const requiredIds = [...vectors.valid, ...vectors.invalid, ...vectors.unknownIgnored].map(
  ({ id }) => id
)

beforeAll(async () => {
  const { admitConformanceToolchains } = await import(
    new URL(
      '../../../rpc-plugin-process/test/process/fixtures/conformance-toolchains.mjs',
      import.meta.url
    ).href
  )
  const receipt = admitConformanceToolchains()
  writeFileSync(join(evidence, 'vectors-toolchains.json'), JSON.stringify(receipt, null, 2))
  if (!receipt.accepted) throw new Error(JSON.stringify(receipt))
})

describe('published vectors evaluated by independent language owners', () => {
  for (const peer of peers.slice(0, 3))
    it(`${peer.language} executes each applicable case oracle and retains its raw receipt`, () => {
      /** Complete native selftests retain known-field errors, error graphs and wire-byte oracles. */
      const args = peer.language === 'python' ? peer.args.slice(0, 2) : peer.args.slice(0, 1)
      /** Failed children keep their actual raw output before the original exception leaves the test. */
      let output: string
      try {
        output = execFileSync(
          peer.command,
          [
            ...args,
            '--selftest',
            '--vectors',
            new URL('../../schema/vectors', import.meta.url).pathname
          ],
          {
            encoding: 'utf8',
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
            timeout: 30000
          }
        )
      } catch (error) {
        /**
         * Node's configured UTF-8 child boundary carries the captured streams on its original
         * error.
         */
        const captured = error as { stdout?: string; stderr?: string }
        writeFileSync(join(evidence, `vectors-${peer.language}.log`), captured.stdout ?? '')
        writeFileSync(join(evidence, `vectors-${peer.language}.stderr.log`), captured.stderr ?? '')
        throw error
      }
      writeFileSync(join(evidence, `vectors-${peer.language}.log`), output)
      expect(output).not.toMatch(/^FAIL /m)
      expect(output).toMatch(/failed=0/)
      const rows = output.split('\n')
      for (const id of requiredIds)
        expect(
          rows.some(
            (line) =>
              (line.startsWith('PASS ') || (id === 'absent' && line.startsWith('SKIP '))) &&
              (line === 'PASS ' + id ||
                line.endsWith('/' + id) ||
                line.includes('/' + id + '/') ||
                (id === 'absent' && line.includes('/absent:')))
          ),
          `${peer.language} missing applicable vector ${id}`
        ).toBe(true)
      /** Only the explicitly identified non-value thrown case may be skipped. */
      for (const row of rows.filter((line) => line.startsWith('SKIP ')))
        expect(row).toContain('absent')
    }, 30000)
  it('TS reference executes every current semantic vector through the public Contract', () => {
    for (const { id, frame } of vectors.valid) expect(normalizeRpcFrame(frame), id).toBe(frame)
    for (const { id, frame } of vectors.invalid)
      expect(() => normalizeRpcFrame(frame), id).toThrow()
    for (const { id, frame, baseline, pointer } of vectors.unknownIgnored) {
      expect(normalizeRpcFrame(baseline), id).toBe(baseline)
      const normalized = normalizeRpcFrame(frame)
      expect(normalized, id).toBe(frame)
      let target: unknown = normalized
      for (const key of pointer.split('/').slice(1)) target = Reflect.get(target as object, key)
      expect(Object.hasOwn(target as object, 'futureA'), id).toBe(true)
      expect(Object.hasOwn(target as object, 'futureB'), id).toBe(true)
      Reflect.deleteProperty(target as object, 'futureA')
      Reflect.deleteProperty(target as object, 'futureB')
      expect(normalized, id).toEqual(baseline)
    }
  })
})
