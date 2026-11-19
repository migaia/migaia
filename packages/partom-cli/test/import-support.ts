import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUN, FIXTURES } from './run.ts'

/** CLI source entry run through Bun. */
const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts')
/** TypeScript compiler of this package. */
const TSC = join(import.meta.dirname, '..', 'node_modules', '.bin', 'tsc')

/** Strict compiler options matching the repository base config. */
const TSCONFIG = {
  compilerOptions: {
    target: 'ES2024',
    module: 'esnext',
    moduleResolution: 'bundler',
    allowImportingTsExtensions: true,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    lib: ['ES2024', 'DOM'],
    types: []
  },
  include: ['src']
}

/** Result of one process run. */
export type IProcess = { readonly code: number; readonly stdout: string; readonly stderr: string }

/**
 * A temporary project inside the fixtures directory, so generated code resolves `zod` and the part
 * packages through this package's `node_modules`.
 */
export class TempProject {
  /** Project directory. */
  readonly dir: string

  /** Creates the directory with a strict tsconfig. */
  constructor(prefix: string) {
    this.dir = mkdtempSync(join(FIXTURES, prefix))
    this.write('tsconfig.json', JSON.stringify(TSCONFIG))
  }

  /** Writes a file of the project. */
  write(path: string, text: string): void {
    writeFileSync(join(this.dir, path), text)
  }

  /** Runs the CLI from source in the project. */
  partom(args: readonly string[]): IProcess {
    return this.#run(BUN, [CLI, ...args])
  }

  /** Runs a TypeScript file of the project with Bun. */
  bun(file: string, env: Readonly<Record<string, string>> = {}): IProcess {
    return this.#run(BUN, [file], env)
  }

  /** Type-checks the project's `src` with the strict config. */
  tsc(): IProcess {
    return this.#run(TSC, ['--noEmit', '-p', 'tsconfig.json'])
  }

  /** Removes the project. */
  remove(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }

  /** Runs a process in the project directory. */
  #run(
    command: string,
    args: readonly string[],
    env: Readonly<Record<string, string>> = {}
  ): IProcess {
    /** Child result. */
    const result = spawnSync(command, [...args], {
      cwd: this.dir,
      encoding: 'utf8',
      timeout: 240000,
      env: { ...process.env, ...env }
    })
    return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
  }
}
