/**
 * Validates one configured method input/result with its actual schema parser. Preserves parser
 * failures and secondary issue-reading failures in the Host schema error boundary; schema lookup
 * performs no transport IO, provider registration or Session admission.
 */
import { createRpcSchemaValidationError } from '../../host/error-owner.ts'

import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import type { IRpcSchemaOptions } from './types.ts'
import { safeRead } from '@migaia/rpc-contract/errors'
import { safeString } from '@migaia/rpc-contract/errors'
import { RpcContractFailureKind } from './text.ts'

/** Validates one contract payload and preserves schema-library issues in the public error. */
export function validateContractData(
  config: IRpcSchemaOptions,
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
    throw createRpcSchemaValidationError(
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
    const reads = new SecondaryReadFailures()
    let issues: readonly unknown[] | undefined
    const candidate = safeRead<unknown>(cause, 'issues', reads.report)
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
          const pathValue = safeRead<unknown>(issue, 'path', reads.report)
          const path: Array<string | number> = []
          if (Array.isArray(pathValue)) {
            for (const part of pathValue) {
              if (typeof part === 'string' || typeof part === 'number') path.push(part)
            }
          }
          const message = safeRead<unknown>(issue, 'message', reads.report)
          const code = safeRead<unknown>(issue, 'code', reads.report)
          normalizedIssues.push({
            path,
            message:
              typeof message === 'string' ? message : RpcCoreErrorText.schemaValidationFallback,
            code: typeof code === 'string' ? code : undefined
          })
        }
      } catch (error) {
        reads.errors.push(error)
        normalizedIssues = undefined
      }
    }
    let causeMessage: string = RpcCoreErrorText.schemaValidationFallback
    try {
      causeMessage =
        cause instanceof Error
          ? safeString(cause.message, RpcCoreErrorText.unknownError, reads.report)
          : safeString(cause, RpcCoreErrorText.unknownError, reads.report)
    } catch (error) {
      reads.errors.push(error)
      causeMessage = RpcCoreErrorText.schemaValidationFallback
    }
    throw createRpcSchemaValidationError(
      failureText,
      {
        kind: RpcContractFailureKind.schemaValidation,
        method,
        side,
        issues: normalizedIssues?.length ? normalizedIssues : [{ path: [], message: causeMessage }]
      },
      reads.errors.length > 0 ? new AggregateError([cause, ...reads.errors], failureText) : cause
    )
  }
}

/**
 * Collects each failed issue/property read during schema-error normalization so it can ride behind
 * the parser's primary failure without replacing it.
 */
class SecondaryReadFailures {
  /** Read failures in observation order. */
  readonly errors: unknown[] = []
  /** `safeRead` failure reporter: records the error and yields no value. */
  readonly report = ({ error }: Readonly<{ error: unknown }>): undefined => {
    this.errors.push(error)
    return undefined
  }
}
