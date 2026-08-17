import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** T-2 结构中立：产物 d.ts 不得出现 DOM/Node 类型（AbortSignal/AbortController/node:）。 */
describe('structure neutrality（T-2）', () => {
  it('dist/index.d.ts 不引 AbortSignal / AbortController / node:*', () => {
    const dts = readFileSync(resolve(process.cwd(), 'dist/index.d.ts'), 'utf8');
    expect(dts).not.toContain('AbortSignal');
    expect(dts).not.toContain('AbortController');
    expect(dts).not.toMatch(/from ['"]node:/);
    expect(dts).not.toContain('structuredClone');
    expect(dts).not.toContain('TextEncoder');
  });
});
