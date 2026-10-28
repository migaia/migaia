/**
 * Defines package error-detail data without depending on Host options, runners or error
 * construction.
 */
/** Generic structured detail carried by a PluginHost boundary error. */
export type IPluginHostErrorDetail = Readonly<Record<string, unknown>>
