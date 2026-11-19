import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUN, FIXTURES, type IRun } from './run.ts'

/** CLI source entry. */
const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts')

/** Parent of working copies; inside the package so project packages resolve from its node_modules. */
const WORK = join(import.meta.dirname, '.release-work')

/** Catalog app entry. */
const CATALOG = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'apps',
  'part-catalog',
  'src',
  'main.ts'
)

/** A git working copy of the release fixture, tagged `v1`. */
export class WorkProject {
  /** Absolute directory. */
  readonly dir: string

  /** Copies the fixture, commits it and tags `v1`. */
  constructor() {
    mkdirSync(WORK, { recursive: true })
    this.dir = mkdtempSync(join(WORK, 'project-'))
    cpSync(join(FIXTURES, 'release'), this.dir, { recursive: true })
    this.git(['init', '-q'])
    this.commit('v1')
    this.git(['tag', 'v1'])
  }

  /** Runs git in the copy and returns stdout. */
  git(args: readonly string[]): string {
    return spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: this.dir,
      encoding: 'utf8'
    }).stdout
  }

  /** Stages everything and commits. */
  commit(message: string): void {
    this.git(['add', '-A'])
    this.git(['commit', '-qm', message])
  }

  /** Reads a file of the copy. */
  read(path: string): string {
    return readFileSync(join(this.dir, path), 'utf8')
  }

  /** Writes a file of the copy. */
  write(path: string, text: string): void {
    writeFileSync(join(this.dir, path), text)
  }

  /** Reads a JSON file of the copy. */
  json<T>(path: string): T {
    return JSON.parse(this.read(path)) as T
  }

  /** Runs the CLI synchronously in the copy. */
  run(args: readonly string[], env: Record<string, string> = {}): IRun {
    /** Child result. */
    const result = spawnSync(BUN, [CLI, ...args], {
      cwd: this.dir,
      encoding: 'utf8',
      timeout: 240000,
      env: { ...process.env, PARTOM_TOKEN: '', ...env }
    })
    return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
  }

  /** Runs the CLI without blocking the event loop (for in-process fake services). */
  runAsync(args: readonly string[], env: Record<string, string> = {}): Promise<IRun> {
    /** Child process. */
    const child = spawn(BUN, [CLI, ...args], {
      cwd: this.dir,
      env: { ...process.env, PARTOM_TOKEN: '', ...env }
    })
    /** Collected output. */
    const output = { stdout: '', stderr: '' }
    child.stdout.on('data', (chunk: Buffer) => void (output.stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => void (output.stderr += chunk.toString()))
    return new Promise((resolve) =>
      child.once('exit', (code) => resolve({ code: code ?? -1, ...output }))
    )
  }

  /** Removes the copy. */
  remove(): void {
    rmSync(this.dir, { recursive: true, force: true })
    if (readdirSync(WORK).length === 0) rmSync(WORK, { recursive: true, force: true })
  }
}

/** A running catalog. */
export type IRunningCatalog = {
  readonly url: string
  readonly data: string
  readonly child: ChildProcess
  stop(): Promise<void>
}

/** Starts the catalog app on a random port; `projectDir` lets it build draft modules. */
export async function startCatalog(projectDir: string): Promise<IRunningCatalog> {
  /** Data directory. */
  const data = mkdtempSync(join(tmpdir(), 'release-catalog-'))
  /** Server process. */
  const child = spawn(
    BUN,
    [CATALOG, 'serve', '--data', data, '--port', '0', '--project-dir', projectDir],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  /** First stdout line. */
  const url = await new Promise<string>((resolve, reject) => {
    child.stdout?.once('data', (chunk: Buffer) =>
      resolve((JSON.parse(chunk.toString().split('\n')[0] as string) as { url: string }).url)
    )
    child.once('exit', (code) => reject(new Error(`catalog exited ${code}`)))
  })
  return {
    url,
    data,
    child,
    stop: async () => {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await new Promise((resolve) => child.once('exit', resolve))
    }
  }
}

/** Creates a catalog token for project `orders`. */
export function catalogToken(data: string, envs: string, scope: 'read' | 'write'): string {
  return spawnSync(
    BUN,
    [
      CATALOG,
      'token',
      'create',
      '--project',
      'orders',
      '--envs',
      envs,
      '--scope',
      scope,
      '--actor',
      'alice',
      '--data',
      data
    ],
    { encoding: 'utf8' }
  ).stdout.trim()
}

/** Last JSON line of a run's stdout. */
export function lastJson<T>(text: string): T {
  return JSON.parse(text.trim().split('\n').pop() as string) as T
}
