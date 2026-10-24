import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

/** All supported runtimes consume the same built public cache and semantic entries. */
for (const runtime of ['node', 'bun', 'deno']) {
  it('executes built cache and semantic behavior in ' + runtime, () => {
    const args =
      runtime === 'deno'
        ? [
            'run',
            '--node-modules-dir=manual',
            '--allow-env',
            '--allow-read',
            '--allow-net',
            '--allow-sys'
          ]
        : []
    const output = execFileSync('rtk', ['proxy', runtime, ...args, 'test/runtime.mts'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    expect(JSON.parse(output.trim().split('\n').at(-1)!)).toEqual({
      status: 'PASS',
      groups: ['cache', 'semantic']
    })
  })
}
