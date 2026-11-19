/** Model validation surface of a host. */
import type { IModelDefinition } from '@migaia/part-contract'
import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import type { IDefinition, IModelHandle, IModelValidation } from './types.ts'

/** One Standard Schema issue as validators report it. */
type IStandardIssue = {
  readonly message: string
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[]
}

/** Dotted path of a Standard Schema issue; segments may be keys or `{ key }` objects. */
function issuePath(issue: IStandardIssue): string {
  return (issue.path ?? [])
    .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.')
}

/** Validates values against the models registered in a host catalog. */
export class ModelHandle implements IModelHandle {
  /** Catalog lookup by id. */
  readonly #lookup: (id: string) => IDefinition | undefined

  /** Binds the handle to a catalog lookup. */
  constructor(lookup: (id: string) => IDefinition | undefined) {
    this.#lookup = lookup
  }

  /**
   * Validates a value with a model's Standard Schema. Resolves with the validated value, or with
   * the issues (dotted paths and messages); rejects with MODEL_UNKNOWN for an unknown id.
   */
  async validate(id: string, value: unknown): Promise<IModelValidation> {
    /** Registered definition. */
    const definition = this.#lookup(id)
    if (definition?.descriptor.kind !== 'model')
      throw createPartHostError(PartHostErrorCode.modelUnknown, PartHostErrorText.modelUnknown(id))
    /** Validation result of the model schema. */
    const result = await (definition as IModelDefinition).schema['~standard'].validate(value)
    if (result.issues === undefined) return { ok: true, value: result.value }
    return {
      ok: false,
      issues: result.issues.map((issue) => ({
        path: issuePath(issue as IStandardIssue),
        message: issue.message
      }))
    }
  }
}
