import { expect, it } from 'vitest'

import { execFileSync, spawn, spawnSync } from 'node:child_process'

import { mkdtemp, rm } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { fileURLToPath } from 'node:url'

import { fileLogStore } from '../src/file.ts'
/** These subprocesses load the emitted entry with the selected runtime's real SQLite builtin. */
const fixture = fileURLToPath(new URL('./fixtures/durable-runtime.ts', import.meta.url))
/** Only the current operating system is proved by these runtime combinations. */
const runtimes = [
  ['node', []],
  ['bun', []],
  ['deno', ['run', '-A']]
] as const
for (const [runtime, flags] of runtimes) {
  /** Missing executables remain explicitly skipped environmental evidence. */
  const available =
    (spawnSync(runtime, ['--version']).error as NodeJS.ErrnoException | undefined)?.code !==
    'ENOENT'
  /** Select the original skip policy without an ambiguous leading-parenthesis expression. */
  const registerRuntimeCase = available ? it : it.skip
  registerRuntimeCase(
    `${runtime} native SQLite${available ? '' : ' (unverified: executable missing)'} commits ten records, reopens them, and assigns eleven`,
    () => durableCase1(runtime, flags)
  )
  registerRuntimeCase(
    `${runtime} native SQLite${available ? '' : ' (unverified: executable missing)'} rejects a second process while the connection owns the file lock`,
    () => durableCase2(runtime, flags)
  )
}

it(
  'reopens committed records and releases the engine lock after abrupt process death',
  durableCase3
)

it('never exposes a partial batch after a process is interrupted during append', durableCase4)

/** Preserve the migrated durable case and every original assertion. */
async function durableCase1(runtime: string, flags: readonly string[]): Promise<void> {
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
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase2(runtime: string, flags: readonly string[]): Promise<void> {
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
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase3(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'logger-crash-'))
  const path = join(directory, 'log.sqlite')
  try {
    const result = spawnSync('node', [fixture, 'crash-committed', path], { stdio: 'ignore' })
    expect(result.signal).toBe('SIGKILL')
    const store = await fileLogStore(path)
    expect((await store.read(1, 10)).map((record) => record.seq)).toEqual([1, 2, 3])
    expect(await store.append([{ kind: 'after', payload: null }])).toEqual([4])
    await store.dispose()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Preserve the migrated durable case and every original assertion. */
async function durableCase4(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'logger-batch-crash-'))
  const path = join(directory, 'log.sqlite')
  try {
    await new InterruptedBatch(fixture, path).completion
    const store = await fileLogStore(path)
    const high = await store.lastSeq()
    expect([0, 10000]).toContain(high)
    expect((await store.read(1, 10001)).length).toBe(high)
    await store.dispose()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Own exactly the original child events while interrupting after its real readiness output. */
class InterruptedBatch {
  /** This fixture alone owns the native child it interrupts. */
  readonly #child: ReturnType<typeof spawn>
  /** The original completion resolves on child exit and rejects on spawn failure. */
  readonly completion: Promise<void>
  /** Resolver is captured before native event delivery begins. */
  #resolve: (() => void) | undefined
  /** Spawn errors retain their original identity as Promise rejections. */
  #reject: ((error: unknown) => void) | undefined
  /** Start the same original subprocess and attach equivalent event receipts. */
  constructor(fixture: string, path: string) {
    this.completion = new Promise<void>(this.#capture)
    this.#child = spawn('node', [fixture, 'crash-batch', path], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.#child.stdout!.on('data', this.#data)
    this.#child.on('error', this.#error)
    this.#child.on('exit', this.#exit)
  }
  /** The Promise constructor supplies the same two native completion functions. */
  readonly #capture = (resolve: () => void, reject: (error: unknown) => void): void => {
    this.#resolve = resolve
    this.#reject = reject
  }
  /** The kill remains tied to actual child output rather than a timer or fake storage path. */
  readonly #data = (chunk: unknown): void => {
    if (String(chunk).includes('ready')) this.#child.kill('SIGKILL')
  }
  /** Native spawn failure is never swallowed by the fixture. */
  readonly #error = (error: unknown): void => {
    this.#reject!(error)
  }
  /** The original test inspected committed storage only after actual process exit. */
  readonly #exit = (): void => {
    this.#resolve!()
  }
}
