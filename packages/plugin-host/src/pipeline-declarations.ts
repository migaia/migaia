/**
 * Owns immutable pipeline declaration admission and snapshots; it allocates no lanes or running
 * stages.
 */
import {
  createPipeline,
  MiddlewarePipelineMode,
  MiddlewarePipelineNext,
  type IMiddlewarePipelineMode
} from '@migaia/middleware-pipeline'
import {
  readPipelineSpec,
  type IPipelineDefinitions,
  type IPipelineSpecOptions
} from './pipeline-spec.ts'
import ERROR_TEXT, {
  PluginHostError,
  attachPluginHostIdentity,
  tagPluginHostError
} from './error-text.ts'
import { PluginHostErrorCode, type IPluginHostErrorCode } from './error-code.ts'
import { PipelineOrder } from './pipeline-constants.ts'

/** One admitted declaration contains no running stage or lifetime state. */
type IPipelineDeclaration = Readonly<{
  key: PropertyKey
  options: IPipelineSpecOptions
}>

/** Native input errors preserve their TypeError family and exact issuing Host attribution. */
export function pipelineOptionError(
  host: object | undefined,
  code: IPluginHostErrorCode,
  message: string,
  cause?: unknown
): TypeError {
  /** The original native or coded failure receives Host attribution without replacing its identity. */
  const error = tagPluginHostError(
    new TypeError(message, cause === undefined ? undefined : { cause }),
    code
  )
  return host ? attachPluginHostIdentity(error, host) : error
}

/** The finite supported mode domain is shared by default and named declarations. */
export function assertPipelineMode(
  host: object | undefined,
  mode: unknown
): asserts mode is IMiddlewarePipelineMode {
  if (
    mode === MiddlewarePipelineMode.sync ||
    mode === MiddlewarePipelineMode.async ||
    mode === MiddlewarePipelineMode.generator ||
    mode === MiddlewarePipelineMode.asyncGenerator
  )
    return
  /** The original native or coded failure receives Host attribution without replacing its identity. */
  const error = new PluginHostError(
    PluginHostErrorCode.invalidPipelineMode,
    ERROR_TEXT.INVALID_PIPELINE_MODE
  )
  throw host ? attachPluginHostIdentity(error, host) : error
}

/** Validate the complete map before any named runner or lane is allocated. */
export function pipelineDeclarations(
  host: object | undefined,
  definitions: IPipelineDefinitions | undefined
): readonly IPipelineDeclaration[] {
  if (definitions === undefined) return []
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions))
    throw pipelineOptionError(
      host,
      PluginHostErrorCode.invalidPipelineOption,
      ERROR_TEXT.INVALID_PIPELINE_OPTION
    )
  /** Only enumerable own string keys form public names; the default symbol stays private. */
  const declarations: IPipelineDeclaration[] = []
  for (const key of Object.keys(definitions)) {
    /** Descriptors keep invalid accessors out of the configuration snapshot. */
    const descriptor = Object.getOwnPropertyDescriptor(definitions, key)
    /** The factory's weak identity rejects structural copies of declarations. */
    const options =
      descriptor && 'value' in descriptor ? readPipelineSpec(descriptor.value) : undefined
    if (
      !key ||
      !options ||
      (options.order !== undefined &&
        options.order !== PipelineOrder.install &&
        options.order !== PipelineOrder.reverse)
    )
      throw pipelineOptionError(
        host,
        PluginHostErrorCode.invalidPipelineOption,
        ERROR_TEXT.INVALID_PIPELINE_OPTION
      )
    assertPipelineMode(
      host,
      options.mode === undefined ? MiddlewarePipelineMode.sync : options.mode
    )
    if (
      options.next !== undefined &&
      options.next !== MiddlewarePipelineNext.single &&
      options.next !== MiddlewarePipelineNext.multiple
    ) {
      try {
        /**
         * Canonical admission supplies the middleware INVALID_OPTION cause without creating a
         * runner.
         */
        createPipeline({ mode: MiddlewarePipelineMode.sync, next: options.next })
      } catch (cause) {
        throw pipelineOptionError(
          host,
          PluginHostErrorCode.invalidPipelineOption,
          ERROR_TEXT.INVALID_PIPELINE_OPTION,
          cause
        )
      }
    }
    declarations.push({ key, options })
  }
  return declarations
}

/** Captures supported declarations once without constructing runners or Host state. */
export function snapshotPipelineDefinitions(value: unknown): IPipelineDefinitions | undefined {
  if (value === undefined) return undefined
  /** Canonical admission yields validated own-data declarations in their original key order. */
  const declarations = pipelineDeclarations(undefined, value as IPipelineDefinitions)
  /** A null-prototype frozen copy retains trusted spec identities without reading accessors. */
  const snapshot: Record<string, IPipelineDefinitions[string]> = Object.create(null)
  for (const declaration of declarations)
    snapshot[declaration.key as string] = Object.getOwnPropertyDescriptor(
      value,
      declaration.key
    )!.value
  return Object.freeze(snapshot)
}
