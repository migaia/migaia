import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { defaultJsonCodec } from '../src/storage/codec.js';

describe('defaultJsonCodec Map/Set 往返', () => {
  it('同 realm 嵌套 Map/Set 还原为真实实例', async () => {
    const value = { map: new Map([['a', 1]]), set: new Set([1, 2, 3]) };
    const decoded = (await defaultJsonCodec.decode(
      await defaultJsonCodec.encode(value)
    )) as typeof value;
    expect(decoded.map).toBeInstanceOf(Map);
    expect([...decoded.map.entries()]).toEqual([['a', 1]]);
    expect(decoded.set).toBeInstanceOf(Set);
    expect([...decoded.set.values()]).toEqual([1, 2, 3]);
  });

  it('跨 realm Map 不丢内容（instanceof 会拒跨 realm 值，内部 slot 分类能识别）', async () => {
    const crossRealmMap = vm.runInNewContext('new Map([["a", 1]])') as Map<string, number>;
    expect(crossRealmMap instanceof Map).toBe(false);
    expect(Object.prototype.toString.call(crossRealmMap)).toBe('[object Map]');
    const decoded = (await defaultJsonCodec.decode(
      await defaultJsonCodec.encode({ map: crossRealmMap })
    )) as { map: Map<string, number> };
    expect(decoded.map).toBeInstanceOf(Map);
    expect([...decoded.map.entries()]).toEqual([['a', 1]]);
  });

  it('跨 realm Set 不丢内容', async () => {
    const crossRealmSet = vm.runInNewContext('new Set([1, 2, 3])') as Set<number>;
    expect(crossRealmSet instanceof Set).toBe(false);
    expect(Object.prototype.toString.call(crossRealmSet)).toBe('[object Set]');
    const decoded = (await defaultJsonCodec.decode(
      await defaultJsonCodec.encode({ set: crossRealmSet })
    )) as { set: Set<number> };
    expect(decoded.set).toBeInstanceOf(Set);
    expect([...decoded.set.values()]).toEqual([1, 2, 3]);
  });

  it('伪造 Map/Set constructor 不执行 hostile 成员', async () => {
    let executed = false;
    const fakeMap = Object.create({ constructor: { name: 'Map' } });
    Object.defineProperty(fakeMap, 'entries', {
      get() {
        executed = true;
        throw new Error('hostile entries');
      }
    });
    const fakeSet = Object.create({ constructor: { name: 'Set' } });
    Object.defineProperty(fakeSet, 'values', {
      get() {
        executed = true;
        throw new Error('hostile values');
      }
    });
    await expect(defaultJsonCodec.encode({ fakeMap, fakeSet })).resolves.toBeTypeOf('string');
    expect(executed).toBe(false);
  });
});
