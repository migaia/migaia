import { describe, expect, it } from 'vitest';
import { passthrough } from '../../src/schema/passthrough';

describe('passthrough', () => {
  it('validate 恒等透传', async () => {
    const schema = passthrough<{ a: number }>();
    await expect(schema.validate({ a: 1 })).resolves.toEqual({ a: 1 });
  });
  it('不提供 encode/decode/normalize', () => {
    const schema = passthrough();
    expect(schema.encode).toBeUndefined();
    expect(schema.decode).toBeUndefined();
    expect(schema.normalize).toBeUndefined();
  });
  it('name 固定为 passthrough', () => expect(passthrough().name).toBe('passthrough'));
});
