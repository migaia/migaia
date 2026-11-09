import type { IFeatureReference } from './feature-types.ts'
import type { IInstallBatchContext } from './install-runtime.ts'
import type {
  IExtensionOwner,
  IRegistration,
  ISharedExtensionContribution,
  ISharedExtensionReservation,
  ISharedExtensionSlot
} from './registry.ts'
import type { IPluginRuntimeSharedSlot } from './core.ts'
/** One canonical identity-to-topology compilation shared by preflight and registration execution. */
export type IFeaturePlan = Readonly<{
  readonly ordered: readonly object[]
  readonly dependencies: ReadonlyMap<object, Readonly<Record<string, object>>>
}>

/** Only installed feature execution functions enter the canonical install owner. */
export type IHostFeatureRuntime = Readonly<{
  compileFeatures(roots: Readonly<Record<string, object>>): IFeaturePlan
  instantiateFeatures(
    roots: Readonly<Record<string, object>>,
    expose: object,
    plan?: IFeaturePlan,
    report?: (error: unknown) => void,
    resolveReference?: (reference: IFeatureReference<object, boolean>) => object | undefined,
    terminal?: (failure: unknown) => void,
    pipeline?: (name: string, feature: object) => object
  ): Readonly<Record<string, object>>
}>
/** Host state reads and writes a slot view needs; it grants no ownership change. */
export type ISharedSlotViewPort<TDomainCore extends object, TValue> = Readonly<{
  /** Rejects once the Host is closing or disposed. */
  assertActive(): void
  /** Current committed owner of an extension key. */
  ownerOf(key: PropertyKey): IExtensionOwner<TDomainCore, TValue> | undefined
  /** Committed registration under a plugin name. */
  registrationNamed(name: string): IRegistration<TDomainCore, TValue> | undefined
  /** Whether a registration is still the live committed generation. */
  isLive(registration: IRegistration<TDomainCore, TValue>): boolean
  /** Publishes or withdraws one committed contribution. */
  updateContribution(receipt: ISharedExtensionContribution<TDomainCore, TValue>, add: boolean): void
}>

/** Features supply the actual view constructor while core retains every canonical slot table. */
export type ISharedSlotViewConstructor = new <
  TDomainCore extends object,
  TValue,
  TFacade extends object
>(
  port: ISharedSlotViewPort<TDomainCore, TValue>,
  slot: ISharedExtensionSlot<TDomainCore, TValue>,
  key: PropertyKey,
  registration: IRegistration<TDomainCore, TValue>,
  batch: IInstallBatchContext<TDomainCore, TValue>,
  reservation: ISharedExtensionReservation<TDomainCore, TValue>,
  assertContribution: () => void
) => IPluginRuntimeSharedSlot<TFacade>
