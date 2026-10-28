/** Validates the shell-free process schema in source order without scanning growing key lists. */
import { PROCESS_KIND, NUL_CHARACTER, limitField, nestedField, ProcessField } from './text.js'
import { SupervisionErrorCode } from '../error-code.js'
import { SupervisionErrorText } from '../error-text.js'
import { createSupervisionError } from '../errors.js'
import { BootstrapVia, ProcessLimit, StderrMode, StdinMode, StdoutMode } from './constants.js'
import type { IProcessSpec } from './types.js'

/** Rejects one named field without interpolating its value or bootstrap payload. */
export function invalidProcessOption(field: string, range = false): never {
  throw createSupervisionError(
    range ? RangeError : TypeError,
    SupervisionErrorCode.invalidOption,
    SupervisionErrorText.invalidOption,
    { detail: { field, kind: PROCESS_KIND } }
  )
}

/** Requires an object with only the named contract fields. */
function closedRecord(
  value: unknown,
  field: string,
  allowed?: readonly string[]
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    invalidProcessOption(field)
  /** Open environment sets skip closed-schema membership checks entirely. */
  const record = value as Record<string, unknown>
  // Closed lists contain at most nine fields, fixed by the process spec declarations below.
  if (allowed)
    for (const key of Object.keys(record))
      if (!allowed.includes(key)) invalidProcessOption(nestedField(field, key))
  return record
}

/** Checks one nonempty NUL-free command argument or path. */
function nonemptyString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.includes(NUL_CHARACTER))
    invalidProcessOption(field)
}

/** Checks every element without exposing its contents in diagnostics. */
function stringArray(value: unknown, field: string): void {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || entry.includes(NUL_CHARACTER))
  )
    invalidProcessOption(field)
}

/** Checks a finite positive limit and identifies range failures as RangeError. */
function positiveLimit(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    invalidProcessOption(field, true)
}

/** Validates the closed, shell-free specification before any launch or replacement. */
export function validateProcessSpec(value: unknown): asserts value is IProcessSpec {
  /** The top-level specification has nine fixed fields. */
  const spec = closedRecord(value, '', [
    ProcessField.command,
    ProcessField.args,
    ProcessField.cwd,
    ProcessField.tmpDir,
    ProcessField.env,
    ProcessField.stdio,
    ProcessField.limits,
    ProcessField.permissions,
    ProcessField.bootstrap
  ])
  nonemptyString(spec.command, ProcessField.command)
  stringArray(spec.args, ProcessField.args)
  if (spec.cwd !== undefined) nonemptyString(spec.cwd, ProcessField.cwd)
  if (spec.tmpDir !== undefined) nonemptyString(spec.tmpDir, ProcessField.tmpDir)
  /** Environment keys are fixed, but its set record accepts arbitrary variable names. */
  const env = closedRecord(spec.env, ProcessField.env, [ProcessField.inherit, ProcessField.set])
  stringArray(env.inherit, ProcessField.envInherit)
  /** Every environment value is checked once, independent of environment key count. */
  const set = closedRecord(env.set, ProcessField.envSet)
  for (const value of Object.values(set))
    if (typeof value !== 'string') invalidProcessOption(ProcessField.envSet)
  /** Three fixed stream selections use the package-owned mode constants. */
  const stdio = closedRecord(spec.stdio, ProcessField.stdio, [
    ProcessField.stdin,
    ProcessField.stdout,
    ProcessField.stderr
  ])
  // StdinMode/StdoutMode/StderrMode have respectively 2/3/2 compile-time values.
  if (!Object.values(StdinMode).includes(stdio.stdin as StdinMode))
    invalidProcessOption(ProcessField.stdioStdin)
  if (!Object.values(StdoutMode).includes(stdio.stdout as StdoutMode))
    invalidProcessOption(ProcessField.stdioStdout)
  if (!Object.values(StderrMode).includes(stdio.stderr as StderrMode))
    invalidProcessOption(ProcessField.stdioStderr)
  if (spec.limits !== undefined) {
    /** Three fixed limit names preserve their original validation order. */
    const limits = closedRecord(spec.limits, ProcessField.limits, Object.values(ProcessLimit))
    // ProcessLimit defines exactly three compile-time limit fields.
    for (const field of Object.values(ProcessLimit))
      if (limits[field] !== undefined) positiveLimit(limits[field], limitField(field))
  }
  if (spec.permissions !== undefined) stringArray(spec.permissions, ProcessField.permissions)
  if (spec.bootstrap !== undefined) {
    /** The payload is validated without including secret bytes in diagnostics. */
    const bootstrap = closedRecord(spec.bootstrap, ProcessField.bootstrap, [
      ProcessField.via,
      ProcessField.fd,
      ProcessField.payload
    ])
    if (!(bootstrap.payload instanceof Uint8Array))
      invalidProcessOption(ProcessField.bootstrapPayload)
    if (bootstrap.via === BootstrapVia.stdin) {
      if (stdio.stdin !== StdinMode.channel || bootstrap.fd !== undefined)
        invalidProcessOption(ProcessField.bootstrapVia)
    } else if (bootstrap.via === BootstrapVia.fd) {
      if (!Number.isInteger(bootstrap.fd) || (bootstrap.fd as number) < 3)
        invalidProcessOption(ProcessField.bootstrapFd, true)
    } else invalidProcessOption(ProcessField.bootstrapVia)
  }
}
