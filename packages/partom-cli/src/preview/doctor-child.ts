import type { IIssue } from '@migaia/part-contract'
import { doctorChildCommand } from '../delegate.ts'
import { DoctorText } from '../doctor-text.ts'
import { PartCliErrorCode } from '../error-code.ts'
import { createPartCliError, PartCliText } from '../errors.ts'

/** One blueprint as reported by `partom doctor --json --blueprints`. */
export type IDoctorBlueprint = {
  readonly id: string
  readonly file: string
  readonly issues: readonly IIssue[]
}

/** Failure of a doctor child: its error object from stderr, or a generic one. */
export type IDoctorFailure = {
  readonly code: string
  readonly message: string
}

/** Outcome of one doctor child run. */
export type IDoctorOutcome =
  | { readonly ok: true; readonly blueprints: readonly IDoctorBlueprint[] }
  | { readonly ok: false; readonly failure: IDoctorFailure }

/** Last non-empty line of a stream's text. */
function lastLine(text: string): string {
  /** Lines with content. */
  const lines = text.trim().split('\n')
  return lines[lines.length - 1] ?? ''
}

/** Parses the error printed by a failing child (`{ error: { code, message } }`). */
function failureOf(stderr: string): IDoctorFailure {
  try {
    /** Printed error. */
    const parsed = JSON.parse(lastLine(stderr)) as { error?: { code?: unknown; message?: unknown } }
    return {
      code:
        typeof parsed.error?.code === 'string' ? parsed.error.code : DoctorText.loadFallbackCode,
      message: typeof parsed.error?.message === 'string' ? parsed.error.message : ''
    }
  } catch {
    // Unparseable stderr (a crash before JSON output) is still a failed child; keep its text.
    return { code: PartCliErrorCode.harnessFailed, message: lastLine(stderr) }
  }
}

/**
 * Runs `partom doctor --json --blueprints` in a child process in the project directory. Exit code 0
 * or 1 yields the blueprint list; exit code 2 (configuration or dependency error) or any other
 * ending yields the child's error.
 */
export async function runDoctorChild(
  projectDir: string,
  config: string | undefined
): Promise<IDoctorOutcome> {
  /** Child command line. */
  const { cmd, env } = await doctorChildCommand([
    '--json',
    '--blueprints',
    ...(config === undefined ? [] : ['--config', config])
  ])
  /** Child process. */
  const child = Bun.spawn([...cmd], { cwd: projectDir, env, stdout: 'pipe', stderr: 'pipe' })
  /** Output texts and exit code. */
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ])
  if (code !== 0 && code !== 1) return { ok: false, failure: failureOf(stderr) }
  try {
    /** Parsed result. */
    const parsed = JSON.parse(lastLine(stdout)) as { blueprints?: IDoctorBlueprint[] }
    if (!Array.isArray(parsed.blueprints)) throw new TypeError(PartCliText.doctorChildFailed)
    return { ok: true, blueprints: parsed.blueprints }
  } catch (cause) {
    // Wrong output from the child is reported to the page like any other failed rebuild.
    return {
      ok: false,
      failure: {
        code: PartCliErrorCode.harnessFailed,
        message: createPartCliError(
          PartCliErrorCode.harnessFailed,
          PartCliText.doctorChildFailed,
          cause
        ).message
      }
    }
  }
}
