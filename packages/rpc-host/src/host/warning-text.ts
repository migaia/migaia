/** Stable public warning text belongs to Host, independently from error/report contracts. */
export const HostWarningText = {
  /** A trusted parent name takes precedence over an explicitly configured child display name. */
  selfIgnored: (parentName: string, ignoredName: string): string =>
    `self.name will be ignored: parent name ${JSON.stringify(parentName)}, configured name ${JSON.stringify(ignoredName)}`
} as const
