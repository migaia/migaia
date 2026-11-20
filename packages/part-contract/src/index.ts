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
export {
  FieldRead,
  isResourceBinding,
  ModelFieldFormat,
  ResourceStatus,
  type IFieldBehavior,
  type IModelBody,
  type IModelFieldDisplay,
  type IModelRelation,
  type IResourceBehavior,
  type IResourceBinding,
  type IResourceSnapshot
} from './data.ts'
export { defineModel, type IModelDefinition, type IModelSpec } from './model.ts'
export { checkModels, MODEL_RELATION_TARGET } from './models-check.ts'
export { isDescriptorId, splitDescriptorId } from './descriptor-id.ts'
export { validateDescriptor } from './descriptor.ts'
export {
  eventEntries,
  eventNameOf,
  isModifierRef,
  modifierArgs,
  modifierId,
  normalizeEventEntry,
  type IEventEntry
} from './event-key.ts'
export {
  expandFragments,
  FRAGMENT_MAX_DEPTH,
  FRAGMENT_MAX_NODES,
  type IFragmentExpansion,
  type IFragmentUsage
} from './fragments.ts'
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
export { LandmarkElement, LayoutProp, type ILayoutProps } from './layout.ts'
export { affectedAddresses, applyPatch } from './platform/patch.ts'
export { descriptorView } from './platform/view.ts'
export {
  collectDefinitions,
  hashBytes,
  isModuleName,
  parseSnapshot,
  RemoteExportKind,
  SnapshotInvalidReason,
  type IPartLock,
  type IPartSnapshot,
  type IRemoteModuleRef
} from './platform/lock.ts'
export {
  checkDelivery,
  type ICapabilityManifest,
  type IDeliveryResult
} from './platform/manifest.ts'
export {
  collectStores,
  DEFAULT_STATE_NAMESPACES,
  isDefaultStateNamespace,
  stateNamespaceOf
} from './platform/stores.ts'
export {
  artifactKey,
  ChangesetStatus,
  checkBase,
  type IChangeset,
  type IChangesetArtifact,
  type IChangesetResult
} from './platform/changeset.ts'
export { mergeBlueprint, type IMergeConflict, type IMergeResult } from './platform/merge.ts'
export {
  AuditAction,
  auditTargets,
  type IAuditRecord,
  type IAuditTarget,
  type IProvenance
} from './platform/audit.ts'
export { TraceEventKind, TraceStage, type ITraceEvent, type ITraceStep } from './platform/trace.ts'
export { LayerLevel } from './types.ts'
export type {
  ILandmark,
  ILayoutBehavior,
  ILayoutRegion,
  IApgPattern,
  IAriaDerivation,
  IBehavior,
  IBlueprint,
  IBuiltinKind,
  ICatalogView,
  IStoreDescriptor,
  IDescriptor,
  IEventDeclaration,
  IEventSubscription,
  IFragmentBody,
  IModifierEventKind,
  IModifierRef,
  IParamPlaceholder,
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
