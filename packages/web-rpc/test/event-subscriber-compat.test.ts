import { describe, expect, it, vi } from 'vitest';
import { HookRegistry } from '../src/internal/hooks.js';

describe('event-subscriber compatibility', () => {
  it('ES-T117 preserves HookRegistry Set dedupe, snapshot delivery, and idempotent disposer', () => {
    const registry = new HookRegistry();
    const hook = vi.fn();
    const first = registry.add(hook);
    const duplicate = registry.add(hook);
    registry.emit({} as never);
    expect(hook).toHaveBeenCalledOnce();
    duplicate();
    duplicate();
    expect(registry.size).toBe(0);
    first();
    expect(registry.size).toBe(0);
  });

  it('ES-T117 isolates synchronous hook failure and preserves snapshot call order', () => {
    const registry = new HookRegistry();
    const calls: string[] = [];
    registry.add(() => {
      calls.push('first');
      throw new Error('hook failure');
    });
    registry.add(() => {
      calls.push('second');
    });
    expect(() => registry.emit({} as never)).not.toThrow();
    expect(calls).toEqual(['first', 'second']);
  });

  it('ES-T118 preserves clear isolation and re-add identity', () => {
    const registry = new HookRegistry();
    const calls: string[] = [];
    const first = registry.add(() => {
      calls.push('first');
    });
    const second = registry.add(() => {
      calls.push('second');
    });
    registry.emit({} as never);
    expect(calls).toEqual(['first', 'second']);
    registry.clear();
    first();
    second();
    expect(registry.size).toBe(0);
    const recreatedHook = () => {
      calls.push('recreated');
    };
    const recreated = registry.add(recreatedHook);
    expect(registry.size).toBe(1);
    registry.emit({} as never);
    expect(calls.at(-1)).toBe('recreated');
    recreated();
  });
});
