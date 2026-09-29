import { CapabilityLevel, StandardCapability } from '../index.js'
import { SupervisionErrorCode } from '../error-code.js'
import { SupervisionErrorText } from '../error-text.js'
import { createSupervisionError } from '../errors.js'
import { ProcessCapability } from './constants.js'
import type { IProcessSpec } from './types.js'

/** Infers exactly the capabilities a specification requests. */
export function processRequirements(spec: IProcessSpec): readonly string[] {
  const required: string[] = [StandardCapability.termination, StandardCapability.faultIsolation]
  if (spec.limits?.memoryBytes !== undefined) required.push(ProcessCapability.memoryLimit)
  if (spec.limits?.cpuTimeMs !== undefined) required.push(ProcessCapability.cpuTimeLimit)
  if (spec.permissions?.length) required.push(ProcessCapability.permissions)
  if (spec.bootstrap?.via === 'stdin') required.push(ProcessCapability.bootstrapStdin)
  if (spec.bootstrap?.via === 'fd') required.push(ProcessCapability.bootstrapFd)
  return required
}

/** Rejects capability grades that cannot fulfil their named guarantee. */
export function validateCapabilityDeclaration(
  capabilities: Readonly<Record<string, string>>
): void {
  const monitored = new Set<string>([ProcessCapability.memoryLimit, ProcessCapability.cpuTimeLimit])
  const known = new Set<string>([
    StandardCapability.termination,
    StandardCapability.faultIsolation,
    ...Object.values(ProcessCapability)
  ])
  for (const [name, level] of Object.entries(capabilities)) {
    if (
      !known.has(name) ||
      (level !== CapabilityLevel.enforced &&
        level !== CapabilityLevel.unsupported &&
        !(monitored.has(name) && level === CapabilityLevel.monitored))
    )
      throw createSupervisionError(
        TypeError,
        SupervisionErrorCode.invalidOption,
        SupervisionErrorText.invalidOption,
        { detail: { field: `launcher.capabilities.${name}`, kind: 'process' } }
      )
  }
}
