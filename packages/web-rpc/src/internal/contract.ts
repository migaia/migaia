import { WebRpcError, WebRpcErrorCode, WebRpcSchemaValidationError } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IWebRpcContractConfig } from '../typing.js'
import { safeRead, safeString } from './safe-value.js'
import { WebRpcContractFailureKind } from '../protocol-constants.js'

/** Validates one contract payload and preserves schema-library issues in the public error. */
export function validateContractData(
  config: IWebRpcContractConfig,
  method: string,
  side: 'params' | 'result',
  data: unknown
): void {
  const schemas = safeRead<Record<string, unknown>>(config, 'schemas')
  const methodSchema = safeRead<Record<string, unknown>>(safeRead(schemas, method), side)
  const schema = methodSchema as { parse?: unknown } | undefined
  if (!schema) return
  try {
    if (typeof schema.parse !== 'function') return
    schema.parse(data)
  } catch (cause) {
    let issues: readonly unknown[] | undefined
    try {
      const candidate = safeRead<unknown>(cause, 'issues')
      issues = Array.isArray(candidate) ? candidate : undefined
    } catch {
      issues = undefined
    }
    let normalizedIssues:
      | Array<{
          readonly path: Array<string | number>
          readonly message: string
          readonly code?: string
        }>
      | undefined
    if (issues) {
      try {
        normalizedIssues = []
        for (const issue of issues) {
          const pathValue = safeRead<unknown>(issue, 'path')
          const path: Array<string | number> = []
          if (Array.isArray(pathValue)) {
            for (const part of pathValue) {
              if (typeof part === 'string' || typeof part === 'number') path.push(part)
            }
          }
          const message = safeRead<unknown>(issue, 'message')
          const code = safeRead<unknown>(issue, 'code')
          normalizedIssues.push({
            path,
            message: typeof message === 'string' ? message : 'Schema validation failed',
            code: typeof code === 'string' ? code : undefined
          })
        }
      } catch {
        normalizedIssues = undefined
      }
    }
    let causeMessage = 'Schema validation failed'
    try {
      causeMessage = cause instanceof Error ? safeString(cause.message) : safeString(cause)
    } catch {
      causeMessage = 'Schema validation failed'
    }
    throw new WebRpcSchemaValidationError(
      `Schema validation failed for ${method} ${side}`,
      {
        kind: WebRpcContractFailureKind.schemaValidation,
        method,
        side,
        issues: normalizedIssues?.length ? normalizedIssues : [{ path: [], message: causeMessage }]
      },
      cause
    )
  }
}

/** Validates public operation names at the existing contract-validation boundary. */
export function assertContractMethod(method: string): string {
  if (typeof method !== 'string' || method.length === 0)
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.methodInvalid)
  return method
}
