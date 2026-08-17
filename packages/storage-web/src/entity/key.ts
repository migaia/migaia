import { decodeFlatStorageKey, encodeFlatStorageKey } from '../core/key-domain.js';
import type { IKeyRange, IStorageKey } from '../types/context.js';

/**
 * 同一个 store 实例可能被多个 entity 共用（例如同一个 indexedDb() 连接 上挂 users 和 posts）。entity 名必须编入实际存储 key，否则不同
 * entity 的同 id 记录会互相覆盖。
 *
 * 结构化后端：`[entityName, id]`，原生数组键，天然可用作 range 的前缀。 KV 后端：`"<entityName>:<id>"` 字符串。
 */
export const composeStructuredKey = (entityName: string, id: IStorageKey): IStorageKey => [
  entityName,
  id
];

/** Reserved v2 prefix keeps repository records disjoint from raw record keys. */
export const REPOSITORY_KEY_PREFIX = '__storage_web_entity_v2__';

/** Encode repository identity as a sortable, reversible physical record key. */
export const composeRepositoryKey = (entityName: string, id: IStorageKey): IStorageKey => [
  REPOSITORY_KEY_PREFIX,
  entityName,
  encodeFlatStorageKey(id)
];

/** Decode a v2 repository key; unrelated raw record keys return undefined. */
export const decodeRepositoryKey = (
  entityName: string,
  key: IStorageKey
): IStorageKey | undefined => {
  if (
    !Array.isArray(key) ||
    key.length !== 3 ||
    key[0] !== REPOSITORY_KEY_PREFIX ||
    key[1] !== entityName ||
    typeof key[2] !== 'string'
  )
    return undefined;
  return decodeFlatStorageKey(key[2]);
};

/** Build an IDB range that isolates the v2 entity prefix without claiming ID encoding is sortable. */
export const repositoryEntityRange = (
  entityName: string
): {
  readonly lower: IStorageKey;
  readonly upper: IStorageKey;
  readonly lowerOpen?: boolean;
  readonly upperOpen?: boolean;
} => ({
  lower: [REPOSITORY_KEY_PREFIX, entityName, ''],
  lowerOpen: false,
  upper: [REPOSITORY_KEY_PREFIX, entityName, '\uffff'],
  upperOpen: false
});

/** `String(id)` 会丢失 IStorageKey 的类型信息；可逆编码保留完整类型与嵌套结构。 */
export const composeFlatKey = (entityName: string, id: IStorageKey): string =>
  `${entityName}:${encodeFlatStorageKey(id)}`;

export const flatKeyPrefix = (entityName: string): string => `${entityName}:`;

/** 结构化后端的历史前缀 range 仅保留给兼容调用方；repository 对嵌套数组使用全扫描过滤。 */
export const structuredEntityRange = (
  entityName: string
): { readonly lower: IStorageKey; readonly upper: IStorageKey } => ({
  lower: [entityName],
  upper: [entityName, []]
});

/**
 * 把调用方提供的 range（作用于原始 id 空间）与 entity 前缀复合，结果恒为 `[entityName, ...]` 形状。调用方传入的 lower/upper 只会被当作 id
 * 部分 使用，不可能被拼成跨 entity 的复合键——即使调用方误传一个本就带 entityName 前缀的复合键，外层也会再包一层 `[entityName, [entityName,
 * id]]`， 结果依旧落在本 entity 的范围内，不会逃逸到其他 entity 的 keyspace。
 */
export const composeEntityRange = (
  entityName: string,
  range: IKeyRange | undefined
): {
  readonly lower: IStorageKey;
  readonly lowerOpen?: boolean;
  readonly upper: IStorageKey;
  readonly upperOpen?: boolean;
} => {
  const fallback = structuredEntityRange(entityName);
  return {
    lower:
      range?.lower !== undefined ? composeStructuredKey(entityName, range.lower) : fallback.lower,
    lowerOpen: range?.lower !== undefined ? range.lowerOpen : false,
    upper:
      range?.upper !== undefined ? composeStructuredKey(entityName, range.upper) : fallback.upper,
    upperOpen: range?.upper !== undefined ? range.upperOpen : false
  };
};
