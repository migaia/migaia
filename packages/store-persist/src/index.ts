// 核心引擎
export { persistUnit } from './core/persist-unit.js';
export type {
  IPersistUnit,
  IPersistUnitOptions,
  IPersistHandle,
  IPersistStatus,
  IHydrationStatus,
  IWriteStatus,
  IReadonlyPersistValue
} from './core/types.js';
export { assertEnvelope, PersistEnvelopeError, type IEnvelope } from './core/envelope.js';

// storage-web codec 接入
export { defaultJsonCodec, writeEnvelope, readEnvelope, removeEnvelope } from './storage/codec.js';

// store-light
export { persist, type IPersistableStore, type IPersistOptions } from './light/persist.js';

// store-indexed
export {
  persistCollection,
  type IPersistableCollection,
  type IPersistCollectionOptions
} from './indexed/persist-collection.js';

// store-keyed
export {
  persistKeyed,
  clearFamily,
  type IPersistKeyedOptions,
  type IPersistKeyedHandle
} from './keyed/persist-keyed.js';

export * from './errors.js';
export {
  PersistState,
  PersistCodecOutput,
  type IPersistState,
  type IPersistCodecOutput
} from './state-constants.js';
