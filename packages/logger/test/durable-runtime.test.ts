import { describe, expect, it } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileLogStore } from '../src/plugins/durable/file.js'

/** These subprocesses load the emitted entry with the selected runtime's real SQLite builtin. */
const fixture = fileURLToPath(new URL('./fixtures/durable-runtime.ts', import.meta.url))
/** Only the current operating system is proved by these runtime combinations. */
const runtimes = [
  ['node', []],
  ['bun', []],
  ['deno', ['run', '-A']]
] as const
for (const [runtime, flags] of runtimes) {
  /** A missing executable is an unverified environment, never a passing runtime claim. */
  const available =
    (spawnSync(runtime, ['--version']).error as NodeJS.ErrnoException | undefined)?.code !==
    'ENOENT'
  const suite = available ? describe : describe.skip
  suite(`${runtime} native SQLite${available ? '' : ' (unverified: executable missing)'}`, () => {
    it('commits ten records, reopens them, and assigns eleven', async () => {
      const directory = await mkdtemp(join(tmpdir(), `logger-${runtime}-`))
      try {
        const output = execFileSync(
          runtime,
          [...flags, fixture, 'verify', join(directory, 'log.sqlite')],
          { encoding: 'utf8' }
        )
        expect(JSON.parse(output.trim())).toEqual({ records: 10, next: 11, pending: 9 })
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
    it('rejects a second process while the connection owns the file lock', async () => {
      const directory = await mkdtemp(join(tmpdir(), `logger-${runtime}-lock-`))
      const path = join(directory, 'log.sqlite')
      const store = await fileLogStore(path)
      try {
        const output = execFileSync(runtime, [...flags, fixture, 'locked', path], {
          encoding: 'utf8'
        })
        expect(JSON.parse(output.trim())).toEqual({ code: 'LOG_STORE_LOCKED' })
      } finally {
        await store.dispose()
        await rm(directory, { recursive: true, force: true })
      }
    })
  })
}

it('reopens committed records and releases the engine lock after abrupt process death', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logger-crash-'))
  const path = join(directory, 'log.sqlite')
  try {
    const result = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      const child = spawn('node', [fixture, 'crash-committed', path], { stdio: 'ignore' })
      child.on('exit', (code, signal) => resolve({ code, signal }))
    })
    expect(result.signal).toBe('SIGKILL')
    const store = await fileLogStore(path)
    expect((await store.read(1, 10)).map((record) => record.seq)).toEqual([1, 2, 3])
    expect(await store.append([{ kind: 'after', payload: null }])).toEqual([4])
    await store.dispose()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('never exposes a partial batch after a process is interrupted during append', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'logger-batch-crash-'))
  const path = join(directory, 'log.sqlite')
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('node', [fixture, 'crash-batch', path], {
        stdio: ['ignore', 'pipe', 'pipe']
      })
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('ready')) child.kill('SIGKILL')
      })
      child.on('error', reject)
      child.on('exit', () => resolve())
    })
    const store = await fileLogStore(path)
    const high = await store.lastSeq()
    expect([0, 10000]).toContain(high)
    expect((await store.read(1, 10001)).length).toBe(high)
    await store.dispose()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
