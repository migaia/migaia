import { CapabilityLevel, IsolationMode } from './constants.js'
import { SupervisionErrorCode } from './error-code.js'
import { SupervisionErrorText } from './error-text.js'
import { createSupervisionError } from './errors.js'

/** Admits only guaranteed capabilities in required mode and records weaker ones in best effort. */
export function admitCapabilities(
  requirements: readonly string[],
  capabilities: Readonly<Record<string, CapabilityLevel>>,
  isolation: IsolationMode,
  kind: string
): { readonly degraded: readonly string[]; readonly diagnostics: readonly Error[] } {
  const degraded: string[] = []
  const diagnostics: Error[] = []
  for (const capability of new Set(requirements)) {
    const level = capabilities[capability] ?? CapabilityLevel.unsupported
    if (level === CapabilityLevel.enforced || level === CapabilityLevel.monitored) continue
    const error = createSupervisionError(
      Error,
      SupervisionErrorCode.capabilityUnsupported,
      SupervisionErrorText.capabilityUnsupported,
      { detail: { capability, level, kind } }
    )
    if (isolation === IsolationMode.required) throw error
    degraded.push(capability)
    diagnostics.push(error)
  }
  return { degraded, diagnostics }
}
