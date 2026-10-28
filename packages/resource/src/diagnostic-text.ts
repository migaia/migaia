/** Owns stable Resource diagnostic names shared with the reactive runtime. */
export const ResourceDiagnosticText = {
  /** Labels the Resource-owned state signal in reactive diagnostics. */
  state(debugName: string): string {
    return `${debugName}.state`
  },
  /** Labels the external-subscription effect while preserving its Resource owner name. */
  subscribe(debugName: string): string {
    return `${debugName}.subscribe`
  },
  /** Labels a selected computed while preserving its Resource owner name. */
  select(debugName: string): string {
    return `${debugName}.select`
  }
}
