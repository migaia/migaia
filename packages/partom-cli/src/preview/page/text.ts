/** Visible texts of the preview pages; English, shown to the developer running `partom preview`. */
export const PreviewText = {
  /** Document title of the home page. */
  homeTitle: 'partom preview',
  /** Heading of the home page. */
  homeHeading: 'Blueprints',
  /** Home line when the config matches no blueprint. */
  homeEmpty: 'The config matches no blueprint.',
  /** Issue counts after a blueprint link. */
  counts: (errors: number, warnings: number): string => `${errors} errors, ${warnings} warnings`,
  /** Overlay heading of the error group. */
  errors: 'Errors',
  /** Overlay heading of the warning group. */
  warnings: 'Warnings',
  /** Overlay note when static errors stop the mount. */
  skipped: 'Not mounted: the blueprint has static errors (as in partom doctor).',
  /** Overlay heading of a failed rebuild. */
  buildError: 'Rebuild failed; showing the last good version.',
  /** Overlay line of one issue. */
  issue: (rule: string, address: string, messageKey: string): string =>
    `${rule} at ${address}: ${messageKey}`
} as const
