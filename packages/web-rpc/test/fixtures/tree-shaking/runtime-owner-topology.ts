/** Exact full/root runtime owners registered under one canonical kernel after construction. */
export const fullRuntimeOwnerKeys = Object.freeze([
  'chunk-assembler',
  'control-ping',
  'discovery-registry',
  'discovery-replay',
  'hook-registry',
  'inbound-identity',
  'kernel',
  'outbound-pipeline',
  'pending-registry',
  'provider-admission',
  'provider-controllers',
  'provider-executor',
  'provider-registry',
  'replay-window',
  'request-replay',
  'resource-scope',
  'time-port',
  'variation-coordinator'
] as const)

/** Exact outbound/client allocation closure; no concrete inbound feature owner is present. */
export const clientRuntimeOwnerKeys = Object.freeze([
  'hook-registry',
  'inbound-identity',
  'kernel',
  'outbound-pipeline',
  'pending-registry',
  'replay-window',
  'resource-scope',
  'time-port',
  'variation-coordinator'
] as const)

/** Exact provider allocation closure including its inseparable security owners. */
export const providerRuntimeOwnerKeys = Object.freeze([
  'hook-registry',
  'inbound-identity',
  'kernel',
  'outbound-pipeline',
  'pending-registry',
  'provider-admission',
  'provider-controllers',
  'provider-executor',
  'provider-registry',
  'replay-window',
  'request-replay',
  'resource-scope',
  'time-port',
  'variation-coordinator'
] as const)

/** Core composition uses the same outbound-only owner closure as the client preset. */
export const coreRuntimeOwnerKeys = clientRuntimeOwnerKeys

/** Custom composition of every first-party feature uses the same closure as the full preset. */
export const customRuntimeOwnerKeys = fullRuntimeOwnerKeys
