import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntime } from '@migaia/reactive';

const memory = new WebAssembly.Memory({ initial: 1 });
let nextId = 1;
const allocations = new Map<number, number>();

vi.mock('@migaia/wasm', () => ({
  default: async () => ({ memory }),
  alloc_bytes: (byteLength: number) => {
    const id = nextId++;
    allocations.set(id, 8);
    if (byteLength > memory.buffer.byteLength - 8) memory.grow(1);
    return id;
  },
  dealloc_bytes: (id: number) => allocations.delete(id),
  ptr_of: (id: number) => allocations.get(id) ?? 0
}));

import { ensureWasm } from '../src/arena';
import { array } from '../src/array';
import { number } from '../src/number';

describe('array setRange memory replacement', () => {
  beforeEach(async () => {
    allocations.clear();
    await ensureWasm();
  });

  it('resolves a fresh view for each bucket commit after memory.grow', async () => {
    const runtime = createRuntime();
    const field = await array(number(), 4, 2).create({
      runtime,
      signal: new AbortController().signal,
      createSource: () => ({
        track: () => undefined,
        notify: () => undefined,
        observed: false,
        commit: <T>(write: () => T): T => {
          memory.grow(1);
          return write();
        },
        disposed: false,
        dispose: () => undefined
      })
    });

    field.setRange(0, 4, [1, 2, 3, 4]);
    expect(Array.from(field.view())).toEqual([1, 2, 3, 4]);
    field.dispose();
  });
});
