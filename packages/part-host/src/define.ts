import {
  assertNoTransform,
  toCatalogSchema,
  validateDescriptor,
  type IBehavior,
  type IDescriptor,
  type IEventDeclaration,
  type IJsonSchema,
  type ISlotDeclaration,
  type IStyleHookType
} from '@migaia/part-contract'
import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import type {
  IDeriveDefinition,
  IDeriveStateView,
  IEffectContext,
  IEffectDefinition,
  IEffectEvent,
  IEnhancerContext,
  IEnhancerDefinition,
  IFeatureRecordLike,
  IFragmentDefinition,
  IModifierContext,
  IModifierDefinition,
  IModifierInstance,
  IModifierPlacement,
  IPartDefinition,
  IResourceCommand,
  IResourceDefinition,
  IResourceLoadContext,
  ISchemaInput
} from './types.ts'
import type { IFeatureDependencyRecord } from '@migaia/plugin-host'
import type { IFragmentBody, IModifierEventKind, IPartFacets } from '@migaia/part-contract'

/** Common optional descriptor fields accepted by every define function. */
type IDescriptorFields = Pick<
  IDescriptor,
  'title' | 'description' | 'meta' | 'status' | 'replacedBy' | 'editor'
>

/** Converts an optional argument schema into its catalog JSON Schema after the no-transform check. */
function argsSchema(
  args: ISchemaInput | undefined,
  jsonSchema: IJsonSchema | undefined
): IJsonSchema | undefined {
  if (args === undefined) return jsonSchema
  assertNoTransform(args)
  return toCatalogSchema(args, jsonSchema)
}

/** Validates and freezes a descriptor built by a define function. */
function descriptorOf(fields: IDescriptor): IDescriptor {
  return Object.freeze(validateDescriptor(fields))
}

/** Part specification. */
export type IPartSpec = IDescriptorFields & {
  readonly id: string
  readonly behavior?: IBehavior
  readonly events?: Readonly<Record<string, IEventDeclaration>>
  readonly slots?: Readonly<Record<string, ISlotDeclaration>>
  readonly styleHooks?: Readonly<Record<string, IStyleHookType>>
  /** Size (bytes) and render (milliseconds) budgets, passed into the descriptor unchanged. */
  readonly budget?: IDescriptor['budget']
  readonly props?: ISchemaInput
  readonly propsJsonSchema?: IJsonSchema
}

/** Defines a part: its descriptor carries behavior groups, events, slots, style hooks and props. */
export function definePart<TProps = Record<string, unknown>>(
  spec: IPartSpec
): IPartDefinition<TProps> {
  /** Spec without the schema-input fields, which are not descriptor data. */
  const { props, propsJsonSchema, ...fields } = spec
  return Object.freeze({
    descriptor: descriptorOf({ ...fields, kind: 'part', args: argsSchema(props, propsJsonSchema) })
  })
}

/** Enhancer specification. */
export type IEnhancerSpec<TArgs> = IDescriptorFields & {
  readonly id: string
  readonly targets: readonly string[]
  readonly reads?: readonly string[]
  readonly writes?: readonly string[]
  readonly after?: readonly string[]
  readonly args?: ISchemaInput
  readonly argsJsonSchema?: IJsonSchema
  readonly transform: (config: IPartFacets, context: IEnhancerContext<TArgs>) => IPartFacets
}

/** Defines a pure configuration enhancer for the target part names. */
export function defineEnhancer<TArgs = undefined>(
  spec: IEnhancerSpec<TArgs>
): IEnhancerDefinition<TArgs> {
  /** Spec split into descriptor fields and the transform. */
  const { transform, args, argsJsonSchema, ...fields } = spec
  return Object.freeze({
    descriptor: descriptorOf({
      ...fields,
      kind: 'enhancer',
      phase: 'config',
      pure: true,
      args: argsSchema(args, argsJsonSchema)
    }),
    transform
  })
}

/** Derive specification. `inputs` lists other derives it depends on. */
export type IDeriveSpec<TArgs, TOut> = IDescriptorFields & {
  readonly id: string
  readonly inputs?: readonly string[]
  readonly args?: ISchemaInput
  readonly argsJsonSchema?: IJsonSchema
  readonly compute: (state: IDeriveStateView, args: TArgs | undefined) => TOut
}

/** Defines a pure derive over scope state. */
export function defineDerive<TArgs = undefined, TOut = unknown>(
  spec: IDeriveSpec<TArgs, TOut>
): IDeriveDefinition<TArgs, TOut> {
  /** Spec split into descriptor fields and the computation. */
  const { compute, args, argsJsonSchema, ...fields } = spec
  return Object.freeze({
    descriptor: descriptorOf({
      ...fields,
      kind: 'derive',
      pure: true,
      args: argsSchema(args, argsJsonSchema)
    }),
    compute
  })
}

/** Effect specification; `deps` are PH Feature references resolved for each run. */
export type IEffectSpec<TDeps extends IFeatureRecordLike> = IDescriptorFields & {
  readonly id: string
  readonly deps?: TDeps
  readonly sync?: boolean
  readonly tier?: 'page' | 'restricted' | 'isolated'
  readonly run: (
    event: IEffectEvent,
    context: IEffectContext<{ readonly [K in keyof TDeps]: unknown }>
  ) => unknown
}

/** Defines an effect run by event subscriptions. */
export function defineEffect<TDeps extends IFeatureRecordLike = Record<never, never>>(
  spec: IEffectSpec<TDeps>
): IEffectDefinition {
  /** Spec split into descriptor fields, dependencies and the run function. */
  const { run, deps, sync, ...fields } = spec
  return Object.freeze({
    descriptor: descriptorOf({ ...fields, kind: 'effect' }),
    deps: deps ?? {},
    sync: sync === true,
    run: run as IEffectDefinition['run']
  })
}

/** One command of a resource specification. */
export type IResourceCommandSpec<TDeps extends IFeatureDependencyRecord> = {
  readonly args?: ISchemaInput
  readonly argsJsonSchema?: IJsonSchema
  /** UI-visibility metadata only; written to the descriptor and never checked. */
  readonly permission?: string
  readonly run: (args: unknown, context: IResourceLoadContext<TDeps>) => Promise<unknown>
  readonly invalidates?: (args: unknown, result: unknown) => readonly string[]
}

/**
 * Resource specification: schemas, dependencies, the load function, cache key and tags, empty test,
 * paging and commands. Explicit JSON Schemas, when given, are stored in the catalog as is.
 */
export type IResourceSpec<
  TParams,
  TResult,
  TDeps extends IFeatureDependencyRecord = Record<never, never>
> = IDescriptorFields & {
  readonly id: string
  readonly params?: ISchemaInput
  readonly paramsJsonSchema?: IJsonSchema
  readonly result?: ISchemaInput
  readonly resultJsonSchema?: IJsonSchema
  readonly deps?: TDeps
  readonly load: (params: TParams, context: IResourceLoadContext<TDeps>) => Promise<TResult>
  readonly key?: (params: TParams) => string
  readonly tags?: (params: TParams, result: TResult) => readonly string[]
  readonly isEmpty?: (result: TResult) => boolean
  readonly paging?: { readonly param: string; readonly size: number }
  readonly commands?: Readonly<Record<string, IResourceCommandSpec<TDeps>>>
}

/** Catalog entry of one command: its argument schema and permission metadata. */
function commandEntry(command: IResourceCommandSpec<IFeatureDependencyRecord>): IJsonSchema {
  /** Argument schema for the catalog. */
  const args = argsSchema(command.args, command.argsJsonSchema)
  return {
    ...(args === undefined ? {} : { args }),
    ...(command.permission === undefined ? {} : { permission: command.permission })
  }
}

/** Runtime part of one command. */
function commandRuntime(command: IResourceCommandSpec<IFeatureDependencyRecord>): IResourceCommand {
  return {
    ...(command.args === undefined ? {} : { args: command.args }),
    run: command.run,
    ...(command.invalidates === undefined ? {} : { invalidates: command.invalidates })
  }
}

/**
 * Defines a resource. The descriptor carries the parameter schema in `args` and the result and
 * command schemas in `editor`; the definition carries the runtime functions the host's resource
 * store calls. Dependencies are resolved by the owning plugin per generation.
 */
export function defineResource<
  TParams = Record<string, unknown>,
  TResult = unknown,
  TDeps extends IFeatureDependencyRecord = Record<never, never>
>(spec: IResourceSpec<TParams, TResult, TDeps>): IResourceDefinition {
  /** Spec split into schemas, runtime functions and descriptor fields. */
  const {
    params,
    paramsJsonSchema,
    result,
    resultJsonSchema,
    deps,
    load,
    key,
    tags,
    isEmpty,
    paging,
    commands,
    ...fields
  } = spec
  /** Command catalog entries and runtime parts, by name. */
  const commandSchemas: Record<string, IJsonSchema> = {}
  /** Runtime commands by name. */
  const runtime: Record<string, IResourceCommand> = {}
  for (const [name, command] of Object.entries(commands ?? {})) {
    commandSchemas[name] = commandEntry(command as IResourceCommandSpec<IFeatureDependencyRecord>)
    runtime[name] = commandRuntime(command as IResourceCommandSpec<IFeatureDependencyRecord>)
  }
  /** Result schema for the catalog. */
  const resultSchema = argsSchema(result, resultJsonSchema)
  return Object.freeze({
    descriptor: descriptorOf({
      ...fields,
      kind: 'resource',
      args: argsSchema(params, paramsJsonSchema),
      editor: {
        ...fields.editor,
        ...(resultSchema === undefined ? {} : { result: resultSchema }),
        commands: commandSchemas
      }
    }),
    deps: deps ?? {},
    ...(params === undefined ? {} : { params }),
    load: load as IResourceDefinition['load'],
    ...(key === undefined ? {} : { key: key as IResourceDefinition['key'] }),
    ...(tags === undefined ? {} : { tags: tags as IResourceDefinition['tags'] }),
    ...(isEmpty === undefined ? {} : { isEmpty: isEmpty as IResourceDefinition['isEmpty'] }),
    ...(paging === undefined ? {} : { paging }),
    commands: Object.freeze(runtime)
  })
}

/** Modifier specification; `place` is required exactly when `placement` is true. */
export type IModifierSpec<TArgs> = IDescriptorFields & {
  readonly id: string
  readonly eventKinds: readonly IModifierEventKind[]
  readonly placement: boolean
  readonly args?: ISchemaInput
  readonly argsJsonSchema?: IJsonSchema
  readonly place?: (element: unknown, args: TArgs) => IModifierPlacement
  readonly create: (args: TArgs, context: IModifierContext) => IModifierInstance
}

/**
 * Defines a modifier: one step of an event subscription's listener chain. Throws
 * `MODIFIER_PLACEMENT_MISMATCH` when `placement` and `place` disagree.
 */
export function defineModifier<TArgs = undefined>(
  spec: IModifierSpec<TArgs>
): IModifierDefinition<TArgs> {
  /** Spec split into descriptor fields and runtime functions. */
  const { place, create, args, argsJsonSchema, ...fields } = spec
  if ((place !== undefined) !== spec.placement)
    throw createPartHostError(
      PartHostErrorCode.modifierPlacementMismatch,
      PartHostErrorText.modifierPlacementMismatch(spec.id)
    )
  return Object.freeze({
    descriptor: descriptorOf({
      ...fields,
      kind: 'modifier',
      args: argsSchema(args, argsJsonSchema)
    }),
    ...(args === undefined ? {} : { argsSchema: args }),
    ...(place === undefined ? {} : { place }),
    create
  })
}

/** Fragment specification: a subtree with `{ $param }` and `{ $slot }` placeholders. */
export type IFragmentSpec = IDescriptorFields & {
  readonly id: string
  readonly node: IFragmentBody['node']
  readonly slots?: readonly string[]
  readonly args?: ISchemaInput
  readonly argsJsonSchema?: IJsonSchema
}

/** Defines a fragment expanded wherever a blueprint node's tag names it. */
export function defineFragment<TArgs = Record<string, unknown>>(
  spec: IFragmentSpec
): IFragmentDefinition<TArgs> {
  /** Spec split into the body, schemas and descriptor fields. */
  const { node, slots, args, argsJsonSchema, ...fields } = spec
  return Object.freeze({
    descriptor: descriptorOf({
      ...fields,
      kind: 'fragment',
      args: argsSchema(args, argsJsonSchema),
      fragment: slots === undefined ? { node } : { node, slots }
    }),
    ...(args === undefined ? {} : { argsSchema: args })
  })
}
