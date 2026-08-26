import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import {
  atomGetter,
  atomSetter,
  type IReadableAtom,
  type IWritableAtom
} from '../src/reactive/atom'

function fakeReadableAtom<T>(
  runtime: ReturnType<typeof createRuntime>,
  value: T
): IReadableAtom<T> {
  return {
    runtime,
    value,
    observed: false,
    disposed: false,
    dispose: vi.fn(),
    read: () => value,
    peek: () => value
  }
}

function fakeWritableAtom<T>(
  runtime: ReturnType<typeof createRuntime>,
  value: T,
  write: (...args: unknown[]) => unknown
): IWritableAtom<T, [unknown], unknown> {
  return { ...fakeReadableAtom(runtime, value), write }
}

describe('atomGetter', () => {
  it('reads .value when the atom belongs to the bound runtime', () => {
    const runtime = createRuntime()
    const get = atomGetter(runtime)
    const atom = fakeReadableAtom(runtime, 42)
    expect(get(atom)).toBe(42)
  })

  it('throws when the atom belongs to a different runtime', () => {
    const runtime = createRuntime()
    const otherRuntime = createRuntime()
    const get = atomGetter(runtime)
    const atom = fakeReadableAtom(otherRuntime, 1)
    expect(() => get(atom)).toThrow('[store] cross-runtime atom access is not allowed')
  })
})

describe('atomSetter', () => {
  it('delegates to atom.write(...args) when the runtime matches', () => {
    const runtime = createRuntime()
    const write = vi.fn((amount: number) => amount * 2)
    const set = atomSetter(runtime)
    const atom = fakeWritableAtom(runtime, 0, write as never)
    const result = set(atom, 21)
    expect(write).toHaveBeenCalledWith(21)
    expect(result).toBe(42)
  })

  it('throws when the atom belongs to a different runtime and never calls write', () => {
    const runtime = createRuntime()
    const otherRuntime = createRuntime()
    const write = vi.fn()
    const set = atomSetter(runtime)
    const atom = fakeWritableAtom(otherRuntime, 0, write as never)
    expect(() => set(atom, 1)).toThrow('[store] cross-runtime atom access is not allowed')
    expect(write).not.toHaveBeenCalled()
  })
})
