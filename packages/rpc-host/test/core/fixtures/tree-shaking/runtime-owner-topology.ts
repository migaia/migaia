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
  'stream-consumer-registry',
  'stream-owner',
  'time-port',
  'variation-coordinator'
] as const)
