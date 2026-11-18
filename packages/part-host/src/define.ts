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
import { defineFeature } from '@migaia/plugin-host/features'
import type {
  IDeriveDefinition,
  IDeriveStateView,
  IEffectContext,
  IEffectDefinition,
  IEffectEvent,
  IEnhancerContext,
  IEnhancerDefinition,
  IFeatureRecordLike,
  IPartDefinition,
  IResourceDefinition,
  ISchemaInput
} from './types.ts'
import type { IPartFacets } from '@migaia/part-contract'

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

/** Resource specification: a Feature factory plus its parameter, result and command schemas. */
export type IResourceSpec<TOutput extends object> = IDescriptorFields & {
  readonly id: string
  readonly params?: ISchemaInput
  readonly result?: ISchemaInput
  readonly commands?: Readonly<Record<string, ISchemaInput>>
  readonly create: () => TOutput
}

/** Defines a resource: a PH Feature whose contract is listed in the catalog. */
export function defineResource<TOutput extends object>(
  spec: IResourceSpec<TOutput>
): IResourceDefinition {
  /** Spec split into schemas, the factory and descriptor fields. */
  const { params, result, commands, create, ...fields } = spec
  /** Command schemas converted for the catalog. */
  const commandSchemas: Record<string, IJsonSchema | undefined> = {}
  for (const [name, schema] of Object.entries(commands ?? {}))
    commandSchemas[name] = argsSchema(schema, undefined)
  return Object.freeze({
    descriptor: descriptorOf({
      ...fields,
      kind: 'resource',
      args: argsSchema(params, undefined),
      editor: { result: argsSchema(result, undefined), commands: commandSchemas }
    }),
    feature: defineFeature((() => create()) as never)
  })
}
