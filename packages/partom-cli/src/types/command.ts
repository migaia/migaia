/** `partom types [--out <file>] [--check]`: writes or checks the project's registry `.d.ts`. */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { ExitCode, flag, type IArgs } from '../args.ts'
import { PartCliErrorCode } from '../error-code.ts'
import { createPartCliError, PartCliText } from '../errors.ts'
import { generatedText, WriteOutcome, writeGenerated } from '../import/ownership.ts'
import { runDoctorJson } from '../preview/doctor-child.ts'
import type { ITypesData } from './collect.ts'
import { typesBody } from './emit.ts'

/** Default output file, relative to the project. */
const DEFAULT_OUT = 'partom-env.d.ts'

/**
 * Runs the doctor child with `--types`, then writes the declaration file or compares it in
 * `--check` mode. Doctor errors do not stop generation (blueprints with static errors are left out
 * and named on stderr); a configuration failure of the child exits 2 without writing.
 */
export async function typesCommand(args: IArgs): Promise<number> {
  /** Project directory. */
  const dir = resolve(flag(args, '--project') ?? process.cwd())
  /** Doctor child result. */
  const outcome = await runDoctorJson(dir, flag(args, '--config'), ['--types', '--blueprints'])
  if (!outcome.ok)
    throw createPartCliError(
      PartCliErrorCode.configInvalid,
      outcome.failure.message,
      outcome.failure
    )
  /** Collected type data. */
  const data = outcome.result.types as ITypesData
  for (const entry of (outcome.result.blueprints ?? []) as {
    id: string
    issues: { severity: string }[]
  }[])
    if (entry.issues.some((issue) => issue.severity === 'error'))
      console.error(PartCliText.typesSkipped(entry.id))
  /** Output file. */
  const out = resolve(dir, flag(args, '--out') ?? DEFAULT_OUT)
  /** Declaration body. */
  const body = typesBody(data)
  if (args.flags.has('--check')) {
    /** Whether the file is current. */
    const current = existsSync(out) && readFileSync(out, 'utf8') === generatedText(body)
    if (!current) console.error(PartCliText.typesStale(out))
    return current ? ExitCode.ok : ExitCode.problems
  }
  /** Write outcome. */
  const outcomeWrite = writeGenerated(dirname(out), basename(out), body)
  if (outcomeWrite === WriteOutcome.takenOver) {
    console.error(PartCliText.typesTakenOver(out))
    return ExitCode.problems
  }
  return ExitCode.ok
}
