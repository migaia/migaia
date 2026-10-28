/**
 * Defines the explicit references shared by managed creation, admission and mutation modules.
 * Runtime state remains with HostCreation, ManagedTrayHost and their canonical external owners.
 */
import type { IDynamicCapabilityGraph } from '@migaia/capability/graph/dynamic'
import type { IGraphNodeId } from '@migaia/capability/graph'
import type {
  IPluginAdmission,
  IPluginConstraint,
  IPluginDataOrderSlot,
  IPluginDependency
} from '@migaia/plugin-host'
import type {
  IPluginHostCompositionSnapshot,
  IRegistrationToken
} from '@migaia/plugin-host/composition'
import type { ITrayArtifactCustody } from './internal-capability.ts'
import type {
  ICreateHostOptions,
  ITrayHostSource,
  ITrayPluginConstraint,
  ITrayPluginPhysicalCleanupResult
} from './typing.ts'

/** Concrete Host shape; composition authority is obtained only through openComposition. */
export type IAnyHost = ITrayHostSource
/** Exact snapshot paired with the composition revision published by HostCreation. */
export type IAnySnapshot = IPluginHostCompositionSnapshot
/** Internal admitted plugin shape independent of the public literal-definition tuple. */
export type IPluginBinding = ITrayPluginConstraint<IAnyHost>
/** Graph identity retains the capability-owned branded string contract. */
export type IGraphId = IGraphNodeId
/** Cleanup observations shared by one managed mutation and its physical continuations. */
export type ICleanupAccumulator = {
  errors: unknown[]
  complete: boolean
  physical: Promise<ITrayPluginPhysicalCleanupResult>[]
}
/** Tray stores only the immutable dependency projection of a canonical admission. */
export type IPluginSnapshot = Readonly<{
  readonly name: string
  readonly dependencies: readonly IPluginDependency[]
}>
/** One definition generation owns its canonical admission, data slot and optional artifact custody. */
export type IAdmissionRecord = {
  readonly plugin: IPluginBinding
  readonly snapshot: IPluginSnapshot
  readonly admission: IPluginAdmission<IPluginConstraint<any>>
  readonly slot: IPluginDataOrderSlot
  receipt?: IRegistrationToken
  artifactCustody?: ITrayArtifactCustody
}
/** The capability-owned dynamic Graph is the only table of managed definitions. */
export type IGraph = IDynamicCapabilityGraph<IAdmissionRecord>

/** Immutable references lent to one managed session; each resource retains its canonical owner. */
export type IManagedTrayHostContext = {
  readonly concrete: IAnyHost
  readonly graph: IGraph
  readonly options: ICreateHostOptions<IAnyHost, readonly IPluginBinding[]>
  readonly readSnapshot: () => IAnySnapshot
  readonly writeSnapshot: (snapshot: IAnySnapshot) => void
  readonly assertOwned: () => void
  readonly cleanup: ICleanupAccumulator
  readonly anchorName: string
  readonly readExpectedRevision: () => number
  readonly activeRuntimeNames: ReadonlyMap<string, number>
  readonly waitForRuntimeQuiescence: () => Promise<void>
}
