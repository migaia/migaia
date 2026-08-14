/** 协作式取消与超时。所有公开方法的最后一个可选参数。 */
export type IOperationContext = {
  /** 协作式取消。后端可忽略，但调用方一定会以 AbortError 结束等待。 */
  readonly signal?: AbortSignal;
  /** 便捷超时，内部合成为 signal；与外部 signal 同时存在时取先触发者。 */
  readonly timeoutMs?: number;
  /** IndexedDB iterator page size; bounded to protect cursor memory. */
  readonly pageSize?: number;
};

export const ConflictPolicy = Object.freeze({
  conflict: 'conflict',
  replace: 'replace'
} as const);

export type IConflictPolicy = (typeof ConflictPolicy)[keyof typeof ConflictPolicy];

export type IWriteOptions = IOperationContext & {
  readonly conflictPolicy?: IConflictPolicy;
};

/** Synchronous writes cannot honor cancellation or timeout fields. */
export type ISyncWriteOptions = {
  readonly conflictPolicy?: IConflictPolicy;
};

/** L1 文档主键。结构化后端（IndexedDB）上等同 IDBValidKey。 */
export type IStorageKey = string | number | Date | ArrayBuffer | readonly IStorageKey[];

/** L1 范围查询边界，与 IDBKeyRange 语义对齐但不直接依赖它，便于其他结构化后端实现。 */
export type IKeyRange = {
  readonly lower?: IStorageKey;
  readonly lowerOpen?: boolean;
  readonly upper?: IStorageKey;
  readonly upperOpen?: boolean;
};
