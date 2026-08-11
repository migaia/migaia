import { describe, expect, it } from 'vitest';
import { chunk } from '../../src/middleware/chunk';

describe('chunk middleware', () => {
  it('splits by UTF-8 bytes without breaking unicode', () => {
    const values = new Map<string, unknown>();
    chunk({ chunkSize: 4 }).install({
      id: 'a',
      transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
      hooks: () => undefined,
      capabilities: {
        set: (name, value) => values.set(name, value),
        get: <T>(name: string) => values.get(name) as T | undefined
      }
    });
    const capability = values.get('chunkCapability') as {
      byteLength(value: string): number;
      split(value: string, max: number): readonly string[];
    };
    const parts = capability.split('😀中文', 4);
    expect(parts.join('')).toBe('😀中文');
    expect(Math.max(...parts.map((part) => capability.byteLength(part)))).toBeLessThanOrEqual(4);
  });
  it('preserves custom splitter and byte counter in middleware capability', () => {
    const values = new Map<string, unknown>();
    const split = (value: string): readonly string[] => [value.slice(0, 1), value.slice(1)];
    const byteLength = (value: string): number => value.length;
    chunk({ split, byteLength }).install({
      id: 'a',
      transport: { platform: 'Memory', send() {}, subscribe: () => () => undefined },
      hooks: () => undefined,
      capabilities: {
        set: (name, value) => values.set(name, value),
        get: <T>(name: string) => values.get(name) as T | undefined
      }
    });
    const capability = values.get('chunkCapability') as {
      byteLength: (value: string) => number;
      split: (value: string, max: number) => readonly string[];
    };
    expect(capability.byteLength).toBe(byteLength);
    expect(capability.split).toBe(split);
  });
});
