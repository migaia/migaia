import { RpcError, RpcCoreErrorCode, RpcSchemaValidationError } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import type { IRpcContractConfig } from '../typing.js'
import { safeRead, safeString, type IRpcPropertyReadReporter } from './safe-value.js'
import { RpcContractFailureKind } from '../semantic-constants.js'

/** Validates one contract payload and preserves schema-library issues in the public error. */
export function validateContractData(
  config: IRpcContractConfig,
  method: string,
  side: 'params' | 'result',
  data: unknown
): void {
  /** Public schema failure text shared by lookup and parser failures. */
  const failureText = RpcCoreErrorText.schemaValidationFailed(method, side)
  let schema: { parse?: unknown } | undefined
  try {
    const schemas = safeRead<Record<string, unknown>>(config, 'schemas')
    const methodSchema = safeRead<Record<string, unknown>>(safeRead(schemas, method), side)
    schema = methodSchema as { parse?: unknown } | undefined
  } catch (cause) {
    throw new RpcSchemaValidationError(
      failureText,
      {
        kind: RpcContractFailureKind.schemaValidation,
        method,
        side,
        issues: [{ path: [], message: RpcCoreErrorText.schemaValidationFallback }]
      },
      cause
    )
  }
  if (!schema) return
  try {
    if (typeof schema.parse !== 'function') return
    schema.parse(data)
  } catch (cause) {
    /** Secondary property and collection failures remain behind the parser's primary failure. */
    const secondaryFailures: unknown[] = []
    /** Collects each failed issue read without allowing it to replace the parser error. */
    const reportRead: IRpcPropertyReadReporter = ({ error }) => {
      secondaryFailures.push(error)
      return undefined
    }
    let issues: readonly unknown[] | undefined
    const candidate = safeRead<unknown>(cause, 'issues', reportRead)
    issues = Array.isArray(candidate) ? candidate : undefined
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
          const pathValue = safeRead<unknown>(issue, 'path', reportRead)
          const path: Array<string | number> = []
          if (Array.isArray(pathValue)) {
            for (const part of pathValue) {
              if (typeof part === 'string' || typeof part === 'number') path.push(part)
            }
          }
          const message = safeRead<unknown>(issue, 'message', reportRead)
          const code = safeRead<unknown>(issue, 'code', reportRead)
          normalizedIssues.push({
            path,
            message:
              typeof message === 'string' ? message : RpcCoreErrorText.schemaValidationFallback,
            code: typeof code === 'string' ? code : undefined
          })
        }
      } catch (error) {
        secondaryFailures.push(error)
        normalizedIssues = undefined
      }
    }
    let causeMessage: string = RpcCoreErrorText.schemaValidationFallback
    try {
      causeMessage = cause instanceof Error ? safeString(cause.message) : safeString(cause)
    } catch (error) {
      secondaryFailures.push(error)
      causeMessage = RpcCoreErrorText.schemaValidationFallback
    }
    throw new RpcSchemaValidationError(
      failureText,
      {
        kind: RpcContractFailureKind.schemaValidation,
        method,
        side,
        issues: normalizedIssues?.length ? normalizedIssues : [{ path: [], message: causeMessage }]
      },
      secondaryFailures.length > 0
        ? new AggregateError([cause, ...secondaryFailures], failureText)
        : cause
    )
  }
}

/** Validates public operation names at the existing contract-validation boundary. */
export function assertContractMethod(method: string): string {
  if (typeof method !== 'string' || method.length === 0)
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.methodInvalid)
  return method
}
