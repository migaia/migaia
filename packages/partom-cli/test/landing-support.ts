import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUN, FIXTURES } from './run.ts'

/** CLI source entry run through Bun. */
export const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts')
/** TypeScript compiler of this package. */
export const TSC = join(import.meta.dirname, '..', 'node_modules', '.bin', 'tsc')

/** Result of one process run. */
export type ILandingRun = {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** One uncertain item of a usage report. */
export type IUsageItem = {
  readonly reason: string
  readonly line: number
  readonly detail?: string
}

/** Report printed by `partom extract --usage`. */
export type IUsageReport = {
  readonly pages: { readonly blueprint: string | null; readonly seeds: Record<string, unknown> }[]
  readonly written: string[]
  readonly unchanged: string[]
  readonly takenOver: string[]
  readonly failed: string[]
  readonly uncertain: IUsageItem[]
  readonly summary: {
    readonly usageNodes: number
    readonly usageConverted: number
    readonly blackboxes: number
  }
}

/**
 * A copy of the orders-admin fixture next to the other fixtures, so its relative imports and the
 * repository's packages resolve through this package's `node_modules`.
 */
export class LandingProject {
  /** Project directory. */
  readonly dir: string
  /** Command that runs `partom`: the source CLI through Bun, or the compiled executable. */
  readonly #command: readonly string[]

  /** Copies the fixture; `command` defaults to the source CLI. */
  constructor(prefix: string, command: readonly string[] = [BUN, CLI]) {
    this.dir = mkdtempSync(join(FIXTURES, prefix))
    cpSync(join(FIXTURES, 'orders-admin'), this.dir, { recursive: true })
    this.#command = command
  }

  /** Path inside the project. */
  path(file: string): string {
    return join(this.dir, file)
  }

  /** Text of a project file. */
  read(file: string): string {
    return readFileSync(this.path(file), 'utf8')
  }

  /** Writes a project file. */
  write(file: string, text: string): void {
    writeFileSync(this.path(file), text)
  }

  /** The shadcn component files, as paths relative to the project (`components/ui/*.tsx`). */
  componentFiles(): string[] {
    return readdirSync(this.path('components/ui'))
      .filter((name) => name.endsWith('.tsx'))
      .sort()
      .map((name) => `components/ui/${name}`)
  }

  /** Runs `partom` in the project. */
  partom(args: readonly string[], env: Readonly<Record<string, string>> = {}): ILandingRun {
    return this.run(this.#command[0] as string, [...this.#command.slice(1), ...args], env)
  }

  /** Runs a TypeScript file of the project with Bun. */
  bun(file: string): ILandingRun {
    return this.run(BUN, [file])
  }

  /** Type-checks the project with its own tsconfig. */
  tsc(): ILandingRun {
    return this.run(TSC, ['--noEmit', '-p', 'tsconfig.json'])
  }

  /**
   * Applies the simulated review with `review/apply.ts`: the JSON Patch of
   * `review/source.patch.json` on the generated blueprint (part-host's patch implementation) and
   * the reviewed effects.
   */
  applyReview(): ILandingRun {
    return this.bun('review/apply.ts')
  }

  /** Removes the copy. */
  remove(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }

  /** Runs a process in the project directory. */
  run(
    command: string,
    args: readonly string[],
    env: Readonly<Record<string, string>> = {}
  ): ILandingRun {
    /** Child result. */
    const result = spawnSync(command, [...args], {
      cwd: this.dir,
      encoding: 'utf8',
      timeout: 300000,
      env: { ...process.env, ...env }
    })
    return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
  }
}

/** Last JSON line printed on stdout. */
export function lastJson<T>(run: ILandingRun): T {
  return JSON.parse(run.stdout.trim().split('\n').pop() as string) as T
}

/** Generic blueprint node view used by the assertions. */
export type ITestNode = {
  readonly tag: string
  readonly id?: string
  readonly facets?: {
    readonly props?: Record<string, unknown>
    readonly events?: Record<string, { readonly handler: string }>
  }
  readonly children?: readonly ITestNode[]
  readonly template?: { readonly rowKey: string; readonly node: ITestNode }
}

/** Every node of a tree in depth-first order, template nodes included; depth is the tree depth. */
export function nodesOf(node: ITestNode, found: ITestNode[] = []): ITestNode[] {
  found.push(node)
  for (const child of node.children ?? []) nodesOf(child, found)
  if (node.template !== undefined) nodesOf(node.template.node, found)
  return found
}
