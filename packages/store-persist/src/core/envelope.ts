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

export class PersistEnvelopeError extends TypeError {}

export function assertEnvelope<TState>(value: unknown, key: string): IEnvelope<TState> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersistEnvelopeError(`[store] persist archive "${key}" is not an envelope`);
  }
  const envelope = value as Record<string, unknown>;
  if (
    typeof envelope.version !== 'number' ||
    !Number.isSafeInteger(envelope.version) ||
    envelope.version < 0
  ) {
    throw new PersistEnvelopeError(`[store] persist archive "${key}" has no usable version`);
  }
  if (!('state' in envelope)) {
    throw new PersistEnvelopeError(`[store] persist archive "${key}" carries no state`);
  }
  return { version: envelope.version, state: envelope.state as TState };
}
