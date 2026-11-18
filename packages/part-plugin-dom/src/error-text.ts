/** Stable messages for errors thrown by the part DOM plugin. */
export const PartDomErrorText = {
  /** Custom event without namespace. */
  customEventUnnamespaced: (name: string): string =>
    `custom event "${name}" must be prefixed as plugin:event`,
  /** Missing constructable style sheets. */
  stylesheetUnsupported: 'constructable style sheets are not available in this environment'
} as const
