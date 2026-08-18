/**
 * 存档信封：version（schema 版本，供 migrate() 用）+ state。
 *
 * 不再像旧实现那样自己维护 revision/双通道冲突判定——storage-web 的 `ICodec`/`selectCodec` 已经把 "codec 产出形态 vs
 * 后端能力"这层路由做掉了，store-persist 不需要在同一个 key 上同时维护文本和字节两个 物理位置，也就没有"两个通道各自解码后按 revision 取新"这个问题存在的前提。
 */
export type IEnvelope<TState> = {
  version: number;
  state: TState;
};

export class PersistEnvelopeError extends TypeError {
  constructor(message: string) {
    super(message);
    Object.defineProperty(this, 'source', { value: STORE_PERSIST_SOURCE, enumerable: true });
    Object.defineProperty(this, 'code', {
      value: StorePersistErrorCode.envelopeInvalid,
      enumerable: true
    });
  }
}

import { STORE_PERSIST_SOURCE } from '../errors.js';
import { StorePersistErrorCode } from '../error-code.js';
import { StorePersistErrorText } from '../error-text.js';

export function assertEnvelope<TState>(value: unknown, key: string): IEnvelope<TState> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersistEnvelopeError(StorePersistErrorText.archiveEnvelope(key));
  }
  const envelope = value as Record<string, unknown>;
  if (
    typeof envelope.version !== 'number' ||
    !Number.isSafeInteger(envelope.version) ||
    envelope.version < 0
  ) {
    throw new PersistEnvelopeError(StorePersistErrorText.archiveVersion(key));
  }
  if (!('state' in envelope) || envelope.state === null || envelope.state === undefined) {
    throw new PersistEnvelopeError(StorePersistErrorText.archiveState(key));
  }
  return { version: envelope.version, state: envelope.state as TState };
}
