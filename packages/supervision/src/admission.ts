import { invalidOption } from './options.js'
import { SupervisionField } from './text.js'
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
  // IsolationMode contains exactly two compile-time modes.
  if (!Object.values(IsolationMode).includes(isolation)) invalidOption(SupervisionField.isolation)
  /** Ordered weaker capabilities become the public degradation snapshot. */
  const degraded: string[] = []
  /** Each weaker capability reports its original coded diagnostic once at start. */
  const diagnostics: Error[] = []
  for (const capability of new Set(requirements)) {
    /** Missing declarations provide no guarantee. */
    const level = capabilities[capability] ?? CapabilityLevel.unsupported
    if (level === CapabilityLevel.enforced || level === CapabilityLevel.monitored) continue
    /** Admission preserves the native diagnostic and its capability details. */
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
