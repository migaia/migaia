import { PartCliErrorCode } from '../error-code.ts'
import { createPartCliError } from '../errors.ts'
import { runDoctorJson } from '../preview/doctor-child.ts'
import type { IReleaseData } from './collect.ts'

/**
 * Runs the doctor child in one release mode and returns its data. A child that fails (config or
 * dependency error) throws CONFIG_INVALID with the child's error on `cause`.
 */
export async function releaseData(
  dir: string,
  config: string | undefined,
  flags: readonly string[]
): Promise<IReleaseData> {
  /** Child outcome. */
  const outcome = await runDoctorJson(dir, config, flags)
  if (!outcome.ok)
    throw createPartCliError(
      PartCliErrorCode.configInvalid,
      outcome.failure.message,
      outcome.failure
    )
  return outcome.result as unknown as IReleaseData
}

/** The release project name, or RELEASE_CONFIG_MISSING. */
export function releaseProject(data: IReleaseData, message: string): string {
  if (typeof data.release.project !== 'string' || data.release.project === '')
    throw createPartCliError(PartCliErrorCode.releaseConfigMissing, message)
  return data.release.project
}
