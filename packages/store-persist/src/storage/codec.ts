import type { IPersistCodec, IPersistKeyValueStore } from '../core/types';

const MAP_TAG = '__migaia_persist_map__';
const SET_TAG = '__migaia_persist_set__';

/**
 * `JSON.stringify(new Map(...))` 产出 `"{}"`——Map/Set 不是 JSON 原生可表达的形状，裸调用会
 * 悄悄丢光内容而不是报错。`persistCollection()` 的 `ObservableMap`/`ObservableSet` 快照就是真的 `Map`/`Set` 实例（源码确认
 * `snapshot()` 内部 `return new Map(this.#values)`），所以默认 codec
 * 必须自己认得这两种形状，用一个打了标签的普通对象过一趟，而不是要求每个使用方自己转数组。
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return { [MAP_TAG]: [...value.entries()] };
  if (value instanceof Set) return { [SET_TAG]: [...value.values()] };
  return value;
}

function jsonReviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (MAP_TAG in record && Array.isArray(record[MAP_TAG])) {
      return new Map(record[MAP_TAG] as [unknown, unknown][]);
    }
    if (SET_TAG in record && Array.isArray(record[SET_TAG])) {
      return new Set(record[SET_TAG] as unknown[]);
    }
  }
  return value;
}

/**
 * 默认 codec：等价于 storage-web 的 `jsonCodec` 再加 Map/Set 往返支持——本包不 import `@migaia/storage-web`
 * 的具体值，只按结构复刻这一份零依赖实现，避免让"默认 codec 是什么"这件事 额外背上一条运行时依赖。
 */
export const defaultJsonCodec: IPersistCodec = Object.freeze({
  name: 'json',
  output: 'text',
  async encode(value: unknown): Promise<string> {
    const encoded = JSON.stringify(value, jsonReplacer);
    if (encoded === undefined) {
      throw new TypeError('[store] json codec cannot serialize this value');
    }
    return encoded;
  },
  async decode(raw: unknown): Promise<unknown> {
    if (typeof raw !== 'string') {
      throw new TypeError('[store] json codec expects a string payload');
    }
    return JSON.parse(raw, jsonReviver);
  }
});

/**
 * 选路：codec.output 与后端 capabilities 是否匹配，决定编码后的值往 text 通道还是 bytes 通道落地。
 *
 * 只覆盖 text/binary 两种 output——`structured` 需要 storage-web L1 `IRecordStore` 的
 * `putRecord`/`getRecord`，这个最小 `IPersistKeyValueStore` 形状不声明这两个方法， 传入 structured codec
 * 会在写入时明确抛错，而不是静默按 text 处理。
 */
function assertBinaryCapable(
  storage: IPersistKeyValueStore
): asserts storage is IPersistKeyValueStore &
  Required<Pick<IPersistKeyValueStore, 'getBytes' | 'setBytes'>> {
  if (typeof storage.getBytes !== 'function' || typeof storage.setBytes !== 'function') {
    throw new TypeError(
      '[store] binary codec output requires a storage-web store with getBytes/setBytes (an IRecordStore-capable backend)'
    );
  }
}

export async function writeEnvelope(
  storage: IPersistKeyValueStore,
  key: string,
  codec: IPersistCodec,
  value: unknown,
  ctx: { signal?: AbortSignal }
): Promise<void> {
  if (codec.output === 'structured') {
    throw new TypeError(
      `[store] codec "${codec.name}" produces structured output, which this storage adapter shape does not support`
    );
  }
  const encoded = await codec.encode(value, ctx);
  if (codec.output === 'binary' && storage.capabilities.binary) {
    assertBinaryCapable(storage);
    if (!(encoded instanceof Uint8Array)) {
      throw new TypeError(`[store] binary codec "${codec.name}" must encode to a Uint8Array`);
    }
    await storage.setBytes(key, encoded, ctx);
    return;
  }
  if (typeof encoded !== 'string') {
    throw new TypeError(
      `[store] codec "${codec.name}" must encode to a string when the backend has no binary channel`
    );
  }
  await storage.set(key, encoded, ctx);
}

export async function readEnvelope(
  storage: IPersistKeyValueStore,
  key: string,
  codec: IPersistCodec,
  ctx: { signal?: AbortSignal }
): Promise<unknown | undefined> {
  if (codec.output === 'binary' && storage.capabilities.binary) {
    assertBinaryCapable(storage);
    const bytes = await storage.getBytes(key, ctx);
    if (bytes === null) return undefined;
    return codec.decode(bytes, ctx);
  }
  const text = await storage.get(key, ctx);
  if (text === null) return undefined;
  return codec.decode(text, ctx);
}

export async function removeEnvelope(
  storage: IPersistKeyValueStore,
  key: string,
  ctx: { signal?: AbortSignal }
): Promise<void> {
  await storage.remove(key, ctx);
}
