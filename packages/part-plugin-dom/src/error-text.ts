/** Stable messages for errors thrown by the part DOM plugin. */
export const PartDomErrorText = {
  /** Custom event without namespace. */
  customEventUnnamespaced: (name: string): string =>
    `custom event "${name}" must be prefixed as plugin:event`,
  /** Missing constructable style sheets. */
  stylesheetUnsupported: 'constructable style sheets are not available in this environment',
  /** Modifier missing from the catalog. */
  modifierUnavailable: (id: string): string => `modifier "${id}" is not available`,
  /** Modifier code threw. */
  modifierFailed: (id: string): string => `modifier "${id}" failed`,
  /** Placement modifier on a delegated subscription. */
  modifierPlacementDelegated: (id: string): string =>
    `modifier "${id}" moves the listener and cannot be used on template rows`
} as const
