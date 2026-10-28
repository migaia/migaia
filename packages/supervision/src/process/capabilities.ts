import { PROCESS_KIND, capabilityField } from './text.ts'
import { CapabilityLevel, StandardCapability } from '../index.ts'
import { SupervisionErrorCode } from '../error-code.ts'
import { SupervisionErrorText } from '../error-text.ts'
import { createSupervisionError } from '../errors.ts'
import { BootstrapVia, ProcessCapability } from './constants.ts'
import type { IProcessSpec } from './types.ts'

/** Only these two fixed process limits support monitored enforcement. */
const monitored = new Set<string>([ProcessCapability.memoryLimit, ProcessCapability.cpuTimeLimit])
/** All seven fixed process capability keys are admitted by the declaration validator. */
const known = new Set<string>([
  StandardCapability.termination,
  StandardCapability.faultIsolation,
  ...Object.values(ProcessCapability)
])

/** Infers exactly the capabilities a specification requests. */
export function processRequirements(spec: IProcessSpec): readonly string[] {
  /** At most seven capabilities are emitted from the fixed specification fields. */
  const required: string[] = [StandardCapability.termination, StandardCapability.faultIsolation]
  if (spec.limits?.memoryBytes !== undefined) required.push(ProcessCapability.memoryLimit)
  if (spec.limits?.cpuTimeMs !== undefined) required.push(ProcessCapability.cpuTimeLimit)
  if (spec.permissions?.length) required.push(ProcessCapability.permissions)
  if (spec.bootstrap?.via === BootstrapVia.stdin) required.push(ProcessCapability.bootstrapStdin)
  if (spec.bootstrap?.via === BootstrapVia.fd) required.push(ProcessCapability.bootstrapFd)
  return required
}

/** Rejects capability grades that cannot fulfil their named guarantee. */
export function validateCapabilityDeclaration(
  capabilities: Readonly<Record<string, string>>
): void {
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
        { detail: { field: capabilityField(name), kind: PROCESS_KIND } }
      )
  }
}
