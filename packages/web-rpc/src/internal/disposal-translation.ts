import { PluginHostDisposalNodeKind, readPluginHostDisposalProvenance } from '@migaia/plugin-host'
import { WebRpcLifecycleError } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IWebRpcCleanupError } from '../errors.js'

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

/** Finds an endpoint-owned lifecycle error retained inside a host cleanup wrapper. */
const findLifecycleError = (
  value: unknown,
  seen: Set<object> = new Set()
): WebRpcLifecycleError | undefined => {
  if (value instanceof WebRpcLifecycleError) return value
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  if (seen.has(value)) return undefined
  seen.add(value)
  if (isCleanupRecord(value)) return findLifecycleError(value.error, seen)
  if (value instanceof AggregateError)
    for (const child of value.errors) {
      const lifecycleError = findLifecycleError(child, seen)
      if (lifecycleError) return lifecycleError
    }
  if (isPluginHostAggregateContainer(value)) return findLifecycleError(value.cause, seen)
  if (isPluginHostResourceWrapper(value)) return findLifecycleError(value.cause, seen)
  return undefined
}

/**
 * Flattens PluginHost's structural cleanup containers while retaining every raw leaf in release
 * order. PluginHost uses nested AggregateError causes for one resource disposer; no diagnostic text
 * is inspected, so arbitrary user error messages remain opaque and untouched.
 */
const flattenHostCleanupErrors = (
  value: unknown,
  seen: Set<object> = new Set()
): readonly IWebRpcCleanupError[] => {
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
  cleanupErrors: readonly IWebRpcCleanupError[] = []
): WebRpcLifecycleError => {
  const nestedLifecycleError = findLifecycleError(error)
  if (nestedLifecycleError) return nestedLifecycleError
  const hostCleanupErrors = flattenHostCleanupErrors(error)
  const labeledByIdentity = new Map(
    cleanupErrors.map((cleanupError) => [cleanupError.error, cleanupError] as const)
  )
  const translatedCleanupErrors: IWebRpcCleanupError[] = []
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
  if (translatedCleanupErrors.length > 0)
    return new WebRpcLifecycleError(
      WebRpcErrorText.endpointDisposalCleanupFailed,
      translatedCleanupErrors[0]?.error,
      translatedCleanupErrors
    )
  return new WebRpcLifecycleError(WebRpcErrorText.endpointDisposalCleanupFailed, error)
}
