// 核心引擎
export { persistUnit } from './core/persist-unit';
export type {
  IPersistUnit,
  IPersistUnitOptions,
  IPersistHandle,
  IPersistStatus,
  IHydrationStatus,
  IWriteStatus,
  IReadonlyPersistValue,
  IPersistKeyValueStore,
  IPersistCodec
} from './core/types';
export { assertEnvelope, PersistEnvelopeError, type IEnvelope } from './core/envelope';

// storage-web codec 接入
export { defaultJsonCodec, writeEnvelope, readEnvelope, removeEnvelope } from './storage/codec';

// store-light
export { persist, type IPersistableStore, type IPersistOptions } from './light/persist';

// store-indexed
export {
  persistCollection,
  type IPersistableCollection,
  type IPersistCollectionOptions
} from './indexed/persist-collection';

// store-keyed
export {
  persistKeyed,
  clearFamily,
  type IPersistKeyedOptions,
  type IPersistKeyedHandle
} from './keyed/persist-keyed';
