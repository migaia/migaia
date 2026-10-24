import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { it, expect } from 'vitest'
/** Original runtime executables consume the same built public entries and real service. */
const execute = promisify(execFile)
for (const runtime of ['node', 'bun', 'deno'] as const) {
  for (const adapter of ['pg', 'postgres-js'] as const) {
    it(runtime + ' executes real ' + adapter + ' through built public entries', async () => {
      const args =
        runtime === 'deno'
          ? [
              'run',
              '--node-modules-dir=manual',
              '--allow-env',
              '--allow-net',
              '--allow-read',
              '--allow-sys'
            ]
          : []
      const { stdout } = await execute(runtime, [...args, 'test/runtime.mts', adapter], {
        env: process.env
      })
      expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toMatchObject({
        adapter,
        status: 'PASS',
        groups: ['kv', 'records', 'transaction', 'sql', 'vector', 'copy']
      })
    })
  }
}
it('runs the native Bun adapter when available or reports its exact environment boundary', async () => {
  const { stdout } = await execute('bun', ['test/runtime.mts', 'bun'], { env: process.env })
  const result = JSON.parse(stdout.trim().split('\n').at(-1)!)
  expect(result.adapter).toBe('bun')
  if (result.status === 'PASS')
    expect(result.groups).toEqual(['kv', 'records', 'transaction', 'sql', 'vector', 'copy'])
  else
    expect(result).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'Bun >=1.4.4 required; installed 1.4.3 rejects before I/O'
    })
})
