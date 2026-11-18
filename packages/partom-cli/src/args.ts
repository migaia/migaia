import { serializeCause } from './errors.ts'

/** Version printed by `--version` and used to name the materialized doctor runner. */
export const PARTOM_VERSION = '0.0.1'

/** Exit codes: success, problems found, configuration or environment error. */
export const ExitCode = { ok: 0, problems: 1, environment: 2 } as const

/** Parsed command line. */
export type IArgs = {
  readonly positional: readonly string[]
  readonly flags: ReadonlyMap<string, string | true>
}

/** Flags that take a value. */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--only',
  '--browser',
  '--config',
  '--out',
  '--project',
  '--port'
])

/** Parses argv into positional arguments and flags. */
export function parseArgs(argv: readonly string[]): IArgs {
  /** Positional arguments. */
  const positional: string[] = []
  /** Flags. */
  const flags = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    /** Current token. */
    const token = argv[index] as string
    if (!token.startsWith('--')) positional.push(token)
    else if (VALUE_FLAGS.has(token)) {
      flags.set(token, argv[index + 1] ?? '')
      index += 1
    } else flags.set(token, true)
  }
  return { positional, flags }
}

/** String flag value. */
export function flag(args: IArgs, name: string): string | undefined {
  /** Raw value. */
  const value = args.flags.get(name)
  return typeof value === 'string' ? value : undefined
}

/** Prints a command failure as JSON on stderr and returns the environment exit code. */
export function failureExit(error: unknown): number {
  console.error(JSON.stringify({ error: serializeCause(error) }))
  return ExitCode.environment
}
