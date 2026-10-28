// @ts-expect-error Internal ownership vocabulary is not a root contract.
import { StoreResourceKind } from '../src/index.ts'
// @ts-expect-error Internal ownership vocabulary is not a root contract.
import type { IStoreResourceKind } from '../src/index.ts'
// @ts-expect-error Builders use an explicit asynchronous discriminant.
import type { ILegacyFieldBuilder } from '../src/index.ts'
import { FIELD_BUILDER, type IFieldBuilder, type IStoreResource } from '../src/index.ts'
/** Type-only consumer used to reject the removed compatibility member. */
declare const resource: IStoreResource<unknown>
// @ts-expect-error Resource and version ownership have separate public entry points.
resource.retain()
// @ts-expect-error Asynchronous builders require mode: async.
const builder: IFieldBuilder<{ disposed: boolean; dispose(): void }> = {
  [FIELD_BUILDER]: true,
  create: async () => ({ disposed: false, dispose() {} })
}
void builder
void StoreResourceKind
export type IRemovedVocabulary = IStoreResourceKind | ILegacyFieldBuilder<never>
