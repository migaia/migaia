import { describe, expect, it } from 'vitest';
import { planChannelWrite } from '../../src/core/channel-write';

describe('planChannelWrite', () => {
  it('conflict policy rejects cross-channel presence', () => {
    expect(() => planChannelWrite('k', 'record', new Set(['value']))).toThrow(
      expect.objectContaining({ code: 'DUPLICATE_KEY' })
    );
  });

  it('replace policy returns only conflicting channels to remove', () => {
    expect(planChannelWrite('k', 'record', new Set(['value', 'bytes']), 'replace')).toEqual({
      remove: ['value', 'bytes']
    });
  });

  it('same-channel write does not remove itself', () => {
    expect(planChannelWrite('k', 'value', new Set(['value']), 'replace')).toEqual({ remove: [] });
  });
});
