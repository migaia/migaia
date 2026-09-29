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
    { detail: { field, kind: 'process' } }
  )
}

/** Requires an object with only the named contract fields. */
function closedRecord(
  value: unknown,
  field: string,
  allowed: readonly string[]
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    invalidProcessOption(field)
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record))
    if (!allowed.includes(key)) invalidProcessOption(field ? `${field}.${key}` : key)
  return record
}

/** Checks one nonempty NUL-free command argument or path. */
function nonemptyString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0'))
    invalidProcessOption(field)
}

/** Checks every element without exposing its contents in diagnostics. */
function stringArray(value: unknown, field: string): void {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || entry.includes('\0'))
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
  const spec = closedRecord(value, '', [
    'command',
    'args',
    'cwd',
    'tmpDir',
    'env',
    'stdio',
    'limits',
    'permissions',
    'bootstrap'
  ])
  nonemptyString(spec.command, 'command')
  stringArray(spec.args, 'args')
  if (spec.cwd !== undefined) nonemptyString(spec.cwd, 'cwd')
  if (spec.tmpDir !== undefined) nonemptyString(spec.tmpDir, 'tmpDir')
  const env = closedRecord(spec.env, 'env', ['inherit', 'set'])
  stringArray(env.inherit, 'env.inherit')
  const set = closedRecord(env.set, 'env.set', Object.keys(env.set ?? {}))
  for (const value of Object.values(set))
    if (typeof value !== 'string') invalidProcessOption('env.set')
  const stdio = closedRecord(spec.stdio, 'stdio', ['stdin', 'stdout', 'stderr'])
  if (!Object.values(StdinMode).includes(stdio.stdin as StdinMode))
    invalidProcessOption('stdio.stdin')
  if (!Object.values(StdoutMode).includes(stdio.stdout as StdoutMode))
    invalidProcessOption('stdio.stdout')
  if (!Object.values(StderrMode).includes(stdio.stderr as StderrMode))
    invalidProcessOption('stdio.stderr')
  if (spec.limits !== undefined) {
    const limits = closedRecord(spec.limits, 'limits', Object.values(ProcessLimit))
    for (const field of Object.values(ProcessLimit))
      if (limits[field] !== undefined) positiveLimit(limits[field], `limits.${field}`)
  }
  if (spec.permissions !== undefined) stringArray(spec.permissions, 'permissions')
  if (spec.bootstrap !== undefined) {
    const bootstrap = closedRecord(spec.bootstrap, 'bootstrap', ['via', 'fd', 'payload'])
    if (!(bootstrap.payload instanceof Uint8Array)) invalidProcessOption('bootstrap.payload')
    if (bootstrap.via === BootstrapVia.stdin) {
      if (stdio.stdin !== StdinMode.channel || bootstrap.fd !== undefined)
        invalidProcessOption('bootstrap.via')
    } else if (bootstrap.via === BootstrapVia.fd) {
      if (!Number.isInteger(bootstrap.fd) || (bootstrap.fd as number) < 3)
        invalidProcessOption('bootstrap.fd', true)
    } else invalidProcessOption('bootstrap.via')
  }
}
