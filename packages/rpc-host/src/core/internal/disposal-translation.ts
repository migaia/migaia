import { createRpcLifecycleError, type IRpcCleanupError, RpcLifecycleError } from '../errors.js'
import { PluginHostDisposalNodeKind, readPluginHostDisposalProvenance } from '@migaia/plugin-host'
import { attachSecondaryErrors } from '@migaia/utils/error'

import { RpcCoreErrorText } from '../error-text.js'

/** Stable PluginHost cleanup-group label retained in the endpoint diagnostic contract. */
const HOST_RESOURCE_DISPOSER_LABEL = 'resource disposer'

/** Reads an explicit resource record without treating arbitrary error causes as containers. */
const isCleanupRecord = (
  value: unknown
): value is { readonly resource: string; readonly error: unknown } =>
  Boolean(
    value &&
    typeof value === 'object' &&
    'resource' in value &&
    'error' in value &&
    typeof (value as { readonly resource?: unknown }).resource === 'string'
  )

/** Recognizes only a wrapper carrying PluginHost's package-owned provenance symbol. */
const isPluginHostResourceWrapper = (
  value: unknown
): value is Error & { readonly cause: unknown } =>
  value instanceof Error &&
  readPluginHostDisposalProvenance(value)?.kind === PluginHostDisposalNodeKind.disposerWrapper

/** Recognizes a Host-generated single-error aggregate container without inspecting its cause shape. */
const isPluginHostAggregateContainer = (
  value: unknown
): value is Error & { readonly cause: unknown } =>
  value instanceof Error &&
  readPluginHostDisposalProvenance(value)?.kind === PluginHostDisposalNodeKind.aggregate

/**
 * Flattens PluginHost's structural cleanup containers while retaining every raw leaf in release
 * order. PluginHost uses nested AggregateError causes for one resource disposer; no diagnostic text
 * is inspected, so arbitrary user error messages remain opaque and untouched.
 */
const flattenHostCleanupErrors = (
  value: unknown,
  seen: Set<object> = new Set()
): readonly IRpcCleanupError[] => {
  if (!value || (typeof value !== 'object' && typeof value !== 'function'))
    return [{ resource: HOST_RESOURCE_DISPOSER_LABEL, error: value }]
  if (seen.has(value)) return []
  seen.add(value)
  if (isCleanupRecord(value)) {
    const resource = value.resource
    return flattenHostCleanupErrors(value.error, seen).map(({ error }) => ({
      resource,
      error
    }))
  }
  if (value instanceof AggregateError) {
    return value.errors.flatMap((child) => flattenHostCleanupErrors(child, seen))
  }
  if (isPluginHostAggregateContainer(value)) return flattenHostCleanupErrors(value.cause, seen)
  if (isPluginHostResourceWrapper(value)) return flattenHostCleanupErrors(value.cause, seen)
  return [{ resource: HOST_RESOURCE_DISPOSER_LABEL, error: value }]
}

/** Translates a PluginHost rejection before it crosses the composed endpoint boundary. */
export const translateEndpointDisposalError = (
  error: unknown,
  cleanupErrors: readonly IRpcCleanupError[] = []
): RpcLifecycleError => {
  const hostCleanupErrors = flattenHostCleanupErrors(error)
  const labeledByIdentity = new Map(
    cleanupErrors.map((cleanupError) => [cleanupError.error, cleanupError] as const)
  )
  const translatedCleanupErrors: IRpcCleanupError[] = []
  const seenLeaves = new Set<unknown>()
  for (const cleanupError of hostCleanupErrors) {
    if (seenLeaves.has(cleanupError.error)) continue
    seenLeaves.add(cleanupError.error)
    translatedCleanupErrors.push(labeledByIdentity.get(cleanupError.error) ?? cleanupError)
  }
  for (const cleanupError of cleanupErrors) {
    if (seenLeaves.has(cleanupError.error)) continue
    seenLeaves.add(cleanupError.error)
    translatedCleanupErrors.push(cleanupError)
  }
  /** Reuse a sole diagnostic only after proving that no independent cleanup leaf would be lost. */
  const soleFailure = translatedCleanupErrors[0]?.error
  if (translatedCleanupErrors.length === 1 && soleFailure instanceof RpcLifecycleError)
    return soleFailure
  if (translatedCleanupErrors.length > 0) {
    /** Labels remain public data while the standard cause/errors graph reaches every raw failure. */
    const failure = createRpcLifecycleError(
      RpcCoreErrorText.endpointDisposalCleanupFailed,
      translatedCleanupErrors[0]?.error,
      translatedCleanupErrors
    )
    attachSecondaryErrors(
      failure,
      translatedCleanupErrors.slice(1).map(({ error }) => error)
    )
    return failure
  }
  return createRpcLifecycleError(RpcCoreErrorText.endpointDisposalCleanupFailed, error)
}
