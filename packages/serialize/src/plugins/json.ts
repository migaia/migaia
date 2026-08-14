import type { ISerializeChunk, ISerializeParser, ISerializePlugin } from '../types';

export type IJsonPluginOptions = {
  /** 传给 JSON.stringify 的 replacer，用于裁剪不可序列化字段。 */
  readonly replacer?: (key: string, value: unknown) => unknown;
  /** 传给 JSON.parse 的 reviver，用于还原 Date 之类的富类型。 */
  readonly reviver?: (key: string, value: unknown) => unknown;
  /** 缩进。仅调试用——线上留空以免白白撑大体积。 */
  readonly space?: number;
};

/**
 * 默认方案，也是实测下最快的一条：V8 的 JSON 是高度优化的 C++ 实现， 在「需要拿到主线程上的对象图」这个前提下没有任何方案能赢它。 只有当你不需要对象图（字节直通）或格式 V8
 * 不认识时，才该换别的插件。
 */
export function jsonParser(options: IJsonPluginOptions = {}): ISerializeParser {
  const { replacer, reviver, space } = options;
  return {
    name: 'json',
    encode(value): ISerializeChunk {
      const encoded = JSON.stringify(value, replacer, space);
      if (encoded === undefined) {
        throw new TypeError('[store] json parser cannot serialize this value');
      }
      return ['text', encoded];
    },
    decode(chunk): unknown {
      if (chunk[0] === 'value') return chunk[1];
      const text = chunk[0] === 'text' ? chunk[1] : new TextDecoder().decode(chunk[1]);
      return JSON.parse(text, reviver);
    }
  };
}

export const jsonPlugin = (options: IJsonPluginOptions = {}): ISerializePlugin => ({
  type: 'json',
  parser: jsonParser(options)
});
