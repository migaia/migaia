/**
 * Stable install labels belong here; lifecycle and dependency state values retain their native
 * owners.
 */
export const PluginHostInstallText = {
  /** Failed batches without an admitted first entry retain the historical diagnostic fallback. */
  unknownName: 'unknown',
  /** Unnamed local Feature dependencies use this diagnostic label at native pipeline admission. */
  localFeature: '<local dependency>',
  /** Plain-data admission identifies the install result with the original public error wording. */
  installRecord: 'plugin install',
  /** Plain-data admission identifies descriptor expose output with the original error wording. */
  exposeRecord: 'plugin expose'
} as const

/** Only these captured own-data hooks may appear on a returned plugin descriptor. */
export const PluginHostDescriptorHook = {
  /** Runs the admitted plugin installation hook after Features become ready. */
  install: 'install',
  /** Supplies explicitly published extensions after installation resolves. */
  expose: 'expose',
  /** Supplies Feature-only capability methods before Feature factories run. */
  featureExpose: 'featureExpose'
} as const
