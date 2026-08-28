import type { ICodec } from '@migaia/storage-contract'
import { isUint8Array } from '@migaia/utils/bytes'
import type { IPersistStorage, IPersistByteStorage } from '../core/types.js'
import { createStorePersistTypeError } from '../errors.js'
import { StorePersistErrorCode } from '../error-code.js'
import { PersistCodecOutput } from '../state-constants.js'
import { StorePersistErrorText } from '../error-text.js'

const MAP_TAG = '__migaia_persist_map__'
const SET_TAG = '__migaia_persist_set__'

/** Detects collections by structured-cloning into this realm; never reads a candidate constructor. */
const intrinsicCollection = (value: unknown): Map<unknown, unknown> | Set<unknown> | undefined => {
  if (value === null || typeof value !== 'object') return undefined
  try {
    const clone = globalThis.structuredClone?.(value)
    if (clone instanceof Map) return clone
    if (clone instanceof Set) return clone
    if (value instanceof Map) return value
    if (value instanceof Set) return value
  } catch {
    return undefined
  }
  return undefined
}

/**
 * `JSON.stringify(new Map(...))` 产出 `"{}"`——Map/Set 不是 JSON 原生可表达的形状，裸调用会
 * 悄悄丢光内容而不是报错。`persistCollection()` 的 `ObservableMap`/`ObservableSet` 快照就是真的 `Map`/`Set` 实例（源码确认
 * `snapshot()` 内部 `return new Map(this.#values)`），所以默认 codec
 * 必须自己认得这两种形状，用一个打了标签的普通对象过一趟，而不是要求每个使用方自己转数组。
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  const collection = intrinsicCollection(value)
  if (collection instanceof Map) return { [MAP_TAG]: [...collection.entries()] }
  if (collection instanceof Set) return { [SET_TAG]: [...collection.values()] }
  return value
}

function jsonReviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (MAP_TAG in record && Array.isArray(record[MAP_TAG])) {
      return new Map(record[MAP_TAG] as [unknown, unknown][])
    }
    if (SET_TAG in record && Array.isArray(record[SET_TAG])) {
      return new Set(record[SET_TAG] as unknown[])
    }
  }
  return value
}

/**
 * 默认 codec：等价于 storage-web 的 `jsonCodec` 再加 Map/Set 往返支持——本包不 import `@migaia/storage-web`
 * 的具体值，只按结构复刻这一份零依赖实现，避免让"默认 codec 是什么"这件事 额外背上一条运行时依赖。
 */
export const defaultJsonCodec: ICodec = Object.freeze({
  name: 'json',
  output: PersistCodecOutput.text,
  async encode(value: unknown): Promise<string> {
    const encoded = JSON.stringify(value, jsonReplacer)
    if (encoded === undefined) {
      throw createStorePersistTypeError(
        StorePersistErrorCode.encodeFailed,
        StorePersistErrorText.jsonSerialize
      )
    }
    return encoded
  },
  async decode(raw: unknown): Promise<unknown> {
    if (typeof raw !== 'string') {
      throw createStorePersistTypeError(
        StorePersistErrorCode.envelopeInvalid,
        StorePersistErrorText.jsonPayload
      )
    }
    return JSON.parse(raw, jsonReviver)
  }
})

/**
 * 选路：codec.output 与后端 capabilities 是否匹配，决定编码后的值往 text 通道还是 bytes 通道落地。
 *
 * 只覆盖 text/binary 两种 output——`structured` 需要 storage-web L1 `IRecordStore` 的
 * `putRecord`/`getRecord`，这个最小 `IPersistStorage` 形状不声明这两个方法， 传入 structured codec 会在写入时明确抛错，而不是静默按
 * text 处理。
 */
function assertBinaryCapable(storage: IPersistStorage): asserts storage is IPersistByteStorage {
  if (typeof storage.getBytes !== 'function' || typeof storage.setBytes !== 'function') {
    throw createStorePersistTypeError(
      StorePersistErrorCode.backendCapability,
      StorePersistErrorText.binaryBackend
    )
  }
}

export async function writeEnvelope(
  storage: IPersistStorage,
  key: string,
  codec: ICodec,
  value: unknown,
  ctx: { signal?: AbortSignal }
): Promise<void> {
  if (codec.output === PersistCodecOutput.structured) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.codecOutputMismatch,
      StorePersistErrorText.structuredOutput(codec.name)
    )
  }
  const encoded = await codec.encode(value, ctx)
  if (codec.output === PersistCodecOutput.binary && storage.capabilities.binary) {
    assertBinaryCapable(storage)
    if (!isUint8Array(encoded)) {
      throw createStorePersistTypeError(
        StorePersistErrorCode.codecOutputMismatch,
        StorePersistErrorText.binaryUint8(codec.name)
      )
    }
    await storage.setBytes(key, encoded, ctx)
    return
  }
  if (typeof encoded !== 'string') {
    throw createStorePersistTypeError(
      StorePersistErrorCode.codecOutputMismatch,
      StorePersistErrorText.stringOutput(codec.name)
    )
  }
  await storage.set(key, encoded, ctx)
}

export async function readEnvelope(
  storage: IPersistStorage,
  key: string,
  codec: ICodec,
  ctx: { signal?: AbortSignal }
): Promise<unknown | undefined> {
  if (codec.output === PersistCodecOutput.binary && storage.capabilities.binary) {
    assertBinaryCapable(storage)
    const bytes = await storage.getBytes(key, ctx)
    if (bytes === null) return undefined
    return codec.decode(bytes, ctx)
  }
  if (codec.output === PersistCodecOutput.binary) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.codecOutputMismatch,
      StorePersistErrorText.binaryRead(codec.name)
    )
  }
  const text = await storage.get(key, ctx)
  if (text === null) return undefined
  return codec.decode(text, ctx)
}

export async function removeEnvelope(
  storage: IPersistStorage,
  key: string,
  ctx: { signal?: AbortSignal }
): Promise<void> {
  await storage.remove(key, ctx)
}
