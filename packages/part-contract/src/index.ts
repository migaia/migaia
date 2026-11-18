/** Public entry of the part contract: blueprint and address grammar, descriptors, schemas and rules. */
export {
  createAddressIndex,
  formatAddress,
  isValidName,
  parseAddress,
  resolveAddress,
  tagSegmentName,
  type IAddressIndex,
  type IIndexedNode,
  type IParsedAddress
} from './address.ts'
export { isPartNode, parseBlueprint } from './blueprint.ts'
export { isDescriptorId, splitDescriptorId, validateDescriptor } from './descriptor.ts'
export { ERROR_SOURCE, PartContractErrorCode, type IPartContractErrorCode } from './error-code.ts'
export type { IPartContractError } from './errors.ts'
export {
  createRuleEngine,
  defineRule,
  type IIssueInput,
  type IRuleContext,
  type IRuleDefinition,
  type IRuleEngine,
  type IRuleEngineOptions,
  type IRulePhase,
  type IRuleSpec
} from './rules.ts'
export {
  assertNoTransform,
  toCatalogSchema,
  validateArgs,
  type IStandardSchemaInput
} from './schema.ts'
export { LayerLevel } from './types.ts'
export type {
  IApgPattern,
  IAriaDerivation,
  IBehavior,
  IBlueprint,
  IBuiltinKind,
  ICatalogView,
  IDescriptor,
  IEventDeclaration,
  IEventSubscription,
  IIssue,
  IJsonPatchOperation,
  IJsonSchema,
  IKindSchema,
  IPartAddress,
  IPartFacets,
  IPartNode,
  IPartTemplate,
  ISlotDeclaration,
  IStyleHookType
} from './types.ts'
