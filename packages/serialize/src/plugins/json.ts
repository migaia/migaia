import type {
  ISerializeChunk,
  ISerializeParser,
  ISerializePlugin,
  ITextDecoder
} from '../types.js';
import { createSerializeError, createSerializeTypeError, SerializeErrorCode } from '../errors.js';
import { SerializeChunkKind, SerializePluginType } from '../format-constants.js';

export type IJsonPluginOptions = {
  /** 传给 JSON.stringify 的 replacer，用于裁剪不可序列化字段。 */
  readonly replacer?: (key: string, value: unknown) => unknown;
  /** 传给 JSON.parse 的 reviver，用于还原 Date 之类的富类型。 */
  readonly reviver?: (key: string, value: unknown) => unknown;
  /** 缩进。仅调试用——线上留空以免白白撑大体积。 */
  readonly space?: number;
  /** 字节段解码器（Encoding 注入；省略时用宿主 `TextDecoder`，明确声明宿主 Encoding API）。 */
  readonly decoder?: ITextDecoder;
};

const hostTextDecoder = (): ITextDecoder | undefined => {
  const Ctor = (globalThis as { TextDecoder?: new () => ITextDecoder }).TextDecoder;
  return Ctor ? new Ctor() : undefined;
};

/**
 * 默认方案，也是实测下最快的一条：V8 的 JSON 是高度优化的 C++ 实现， 在「需要拿到主线程上的对象图」这个前提下没有任何方案能赢它。 只有当你不需要对象图（字节直通）或格式 V8
 * 不认识时，才该换别的插件。
 */
export function jsonParser(options: IJsonPluginOptions = {}): ISerializeParser {
  const { replacer, reviver, space, decoder } = options;
  return {
    name: SerializePluginType.json,
    encode(value): ISerializeChunk {
      const encoded = JSON.stringify(value, replacer, space);
      if (encoded === undefined) {
        throw createSerializeTypeError(
          SerializeErrorCode.encodeFailed,
          'json parser cannot serialize this value'
        );
      }
      return ['text', encoded];
    },
    decode(chunk): unknown {
      if (chunk[0] === SerializeChunkKind.value) return chunk[1];
      if (chunk[0] === SerializeChunkKind.bytes) {
        const dec = decoder ?? hostTextDecoder();
        if (dec === undefined) {
          throw createSerializeError(
            SerializeErrorCode.envUnsupported,
            'TextDecoder is unavailable'
          );
        }
        return JSON.parse(dec.decode(chunk[1]), reviver);
      }
      return JSON.parse(chunk[1], reviver);
    }
  };
}

export const jsonPlugin = (options: IJsonPluginOptions = {}): ISerializePlugin => ({
  type: SerializePluginType.json,
  parser: jsonParser(options)
});
