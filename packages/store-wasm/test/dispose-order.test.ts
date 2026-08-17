import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntime } from '@migaia/reactive';

const memory = new WebAssembly.Memory({ initial: 1 });
let nextId = 1;
const allocations = new Map<number, number>();
/** 记录正常 dispose() 的实际释放顺序，用于断言「子资源 → block」（migration.sdd.md §5.7 / M-T35）。 */
const disposeOrder: string[] = [];

vi.mock('@migaia/wasm', () => ({
  default: async () => ({ memory }),
  alloc_bytes: (byteLength: number) => {
    const id = nextId++;
    allocations.set(id, 8);
    if (byteLength > memory.buffer.byteLength - 8) memory.grow(1);
    return id;
  },
  dealloc_bytes: (id: number) => {
    disposeOrder.push('block');
    allocations.delete(id);
  },
  ptr_of: (id: number) => allocations.get(id) ?? 0
}));

import { ensureWasm } from '../src/arena';
import { array } from '../src/array';
import { number } from '../src/number';

describe('array normal dispose order (M-T35)', () => {
  beforeEach(async () => {
    allocations.clear();
    disposeOrder.length = 0;
    await ensureWasm();
  });

  it('正常 dispose() 先释放子资源再 dealloc block，与回滚路径一致', async () => {
    const runtime = createRuntime();
    const field = await array(number(), 4, 2).create({
      runtime,
      signal: new AbortController().signal,
      createSource: () => ({
        track: () => undefined,
        notify: () => undefined,
        observed: false,
        commit: <T>(write: () => T): T => write(),
        disposed: false,
        dispose: () => {
          disposeOrder.push('source');
        }
      })
    });

    // 触发一个 bucket 的 source 创建，使 dispose 路径上存在子资源。
    field.setAt(0, 1);
    field.dispose();

    // 逆序：全部子资源先释放，block 最后 dealloc。
    expect(disposeOrder[0]).toBe('source');
    expect(disposeOrder[disposeOrder.length - 1]).toBe('block');
  });
});

describe('array construction-failure rollback (M-T34)', () => {
  beforeEach(async () => {
    allocations.clear();
    disposeOrder.length = 0;
    await ensureWasm();
  });

  it('构造中途失败：block 已 dealloc、原始错误原样重抛（不泄漏）', () => {
    const controller = new AbortController();
    controller.abort();
    const runtime = createRuntime();
    expect(() =>
      array(number(), 4, 2).create({
        runtime,
        signal: controller.signal,
        createSource: () => ({
          track: () => undefined,
          notify: () => undefined,
          observed: false,
          commit: <T>(write: () => T): T => write(),
          disposed: false,
          dispose: () => undefined
        })
      })
    ).toThrowError(expect.objectContaining({ code: 'INIT_ABORTED' }));
    // 构造失败后已分配的 WASM block 必须已释放。
    expect(allocations.size).toBe(0);
  });
});
