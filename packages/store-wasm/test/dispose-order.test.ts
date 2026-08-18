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

import { disposeAllWasm, ensureWasm, throwWasmConstructionFailure } from '../src/arena.js';
import { array } from '../src/array.js';
import { boolean } from '../src/boolean.js';
import { record } from '../src/record.js';
import { string } from '../src/string.js';
import { StoreWasmErrorCode } from '../src/error-code.js';
import { number } from '../src/number.js';

describe('WASM cleanup error contract', () => {
  it('rejects invalid record shapes at the public boundary', () => {
    expect(() => record(null as never)).toThrow('wasm.record: shape must be an object');
    expect(() => record({ value: null } as never)).toThrow(
      'wasm.record: shape must be an object of field builders'
    );
  });

  it('contains hostile record-shape proxy traps as tagged errors', () => {
    const shape = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('ownKeys failure');
        }
      }
    );
    expect(() => record(shape as never)).toThrow('wasm.record: shape must be an object');
  });

  it('contains revoked record-shape proxies as tagged errors', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    try {
      record(proxy as never);
      throw new Error('expected record() to fail');
    } catch (error) {
      expect(error).toMatchObject({
        source: '@migaia/store-wasm',
        code: StoreWasmErrorCode.invalidOption,
        cause: expect.any(TypeError)
      });
    }
  });

  it('retains non-Error construction primary and rollback failure', () => {
    const primary = Symbol('primary');
    const cleanup = new Error('rollback failed');
    let thrown: unknown;
    try {
      throwWasmConstructionFailure(primary, cleanup);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      source: '@migaia/store-wasm',
      code: StoreWasmErrorCode.cleanupFailed,
      errors: [primary, cleanup]
    });
  });

  it('retains a frozen Error primary when cause attachment is impossible', () => {
    const primary = Object.freeze(new Error('frozen primary'));
    const cleanup = new Error('rollback failed');
    expect(() => throwWasmConstructionFailure(primary, cleanup)).toThrow(AggregateError);
    try {
      throwWasmConstructionFailure(primary, cleanup);
    } catch (error) {
      expect(error).toMatchObject({ errors: [primary, cleanup] });
    }
  });

  it('tags multi-resource cleanup failure and preserves every original error', () => {
    const first = new Error('first cleanup failed');
    const second = new Error('second cleanup failed');

    let thrown: unknown;
    try {
      disposeAllWasm([
        () => {
          throw first;
        },
        () => {
          throw second;
        }
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown).toMatchObject({
      source: '@migaia/store-wasm',
      code: StoreWasmErrorCode.cleanupFailed,
      errors: [first, second]
    });
  });
});

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
    field.at(0);
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

describe('single-source field cleanup matrix', () => {
  beforeEach(async () => {
    allocations.clear();
    disposeOrder.length = 0;
    await ensureWasm();
  });

  it('attempts source and block cleanup for number, boolean, and string when source fails', async () => {
    const runtime = createRuntime();
    for (const builder of [number(), boolean(), string(16)]) {
      const sourceError = new Error('source cleanup failed');
      const field = await builder.create({
        runtime,
        signal: new AbortController().signal,
        createSource: () => ({
          track: () => undefined,
          notify: () => undefined,
          observed: false,
          commit: <T>(write: () => T): T => write(),
          disposed: false,
          dispose: () => {
            throw sourceError;
          }
        })
      });

      expect(() => field.dispose()).toThrow(sourceError);
      expect(allocations.size).toBe(0);
    }
  });

  it('rejects JavaScript values that do not match scalar field types', async () => {
    const runtime = createRuntime();
    const cases = [
      [number(), 'bad', 'wasm.number: value must be a number'],
      [boolean(), 1, 'wasm.boolean: value must be a boolean'],
      [string(16), 1, 'wasm.string: value must be a string']
    ] as const;
    for (const [builder, value, message] of cases) {
      const field = await builder.create({
        runtime,
        signal: new AbortController().signal,
        createSource: () => ({
          track: () => undefined,
          notify: () => undefined,
          observed: false,
          commit: <T>(write: () => T): T => write(),
          disposed: false,
          dispose: () => undefined
        })
      });
      expect(() => {
        field.value = value as never;
      }).toThrow(message);
      field.dispose();
    }
  });

  it('attempts the source and block cleanup for array when the source fails', async () => {
    const runtime = createRuntime();
    const sourceError = new Error('array source cleanup failed');
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
          throw sourceError;
        }
      })
    });

    field.setAt(0, 1);
    expect(() => field.dispose()).toThrow(sourceError);
    expect(allocations.size).toBe(0);
  });
});

describe('record construction rollback matrix', () => {
  beforeEach(async () => {
    allocations.clear();
    disposeOrder.length = 0;
    await ensureWasm();
  });

  it('keeps the construction primary while cleaning prior sources and the block', () => {
    const runtime = createRuntime();
    const primary = new Error('second source creation failed');
    const cleanup = new Error('first source cleanup failed');
    let sourceCount = 0;

    let thrown: unknown;
    try {
      record({ a: number(), b: number() }).create({
        runtime,
        signal: new AbortController().signal,
        createSource: () => {
          sourceCount++;
          if (sourceCount === 2) throw primary;
          return {
            track: () => undefined,
            notify: () => undefined,
            observed: false,
            commit: <T>(write: () => T): T => write(),
            disposed: false,
            dispose: () => {
              throw cleanup;
            }
          };
        }
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(primary);
    expect((thrown as Error).cause).toBe(cleanup);
    expect(allocations.size).toBe(0);
  });

  it('collects multiple source cleanup failures and still deallocates the block', async () => {
    const runtime = createRuntime();
    const first = new Error('first record source cleanup failed');
    const second = new Error('second record source cleanup failed');
    let sourceCount = 0;
    const field = await record({ a: number(), b: number() }).create({
      runtime,
      signal: new AbortController().signal,
      createSource: () => {
        sourceCount++;
        const error = sourceCount === 1 ? first : second;
        return {
          track: () => undefined,
          notify: () => undefined,
          observed: false,
          commit: <T>(write: () => T): T => write(),
          disposed: false,
          dispose: () => {
            throw error;
          }
        };
      }
    });

    let thrown: unknown;
    try {
      field.dispose();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      source: '@migaia/store-wasm',
      code: StoreWasmErrorCode.cleanupFailed,
      errors: [first, second]
    });
    expect(allocations.size).toBe(0);
  });
});
