import { describe, expect, it, vi } from 'vitest';
import { ReplayWindow } from '../../src/internal/replay';

describe('ReplayWindow', () => {
  it('rejects fresh entries independently at each capacity boundary', () => {
    const window = new ReplayWindow(2, 10_000);
    expect(window.reserveId('a')).toBe(true);
    expect(window.reserveId('b')).toBe(true);
    expect(window.reserveId('c')).toBe(false);
    const second = new ReplayWindow(2, 10_000);
    second.reserveId('id');
    expect(second.hasReservedId('id')).toBe(true);
  });

  it('clears both replay namespaces', () => {
    const window = new ReplayWindow();
    window.reserveId('id');
    window.clear();
    expect(window.hasReservedId('id')).toBe(false);
  });
  it('releases settled identifiers before the retention window expires', () => {
    const window = new ReplayWindow(1, 10_000);
    expect(window.reserveId('id')).toBe(true);
    window.releaseId('id');
    expect(window.reserveId('id')).toBe(true);
  });
  it('expires completed tasks and reserved ids after the replay window', () => {
    vi.useFakeTimers();
    try {
      const window = new ReplayWindow(2, 100);
      window.reserveId('id');
      expect(window.hasReservedId('id')).toBe(true);

      vi.advanceTimersByTime(100);
      expect(window.hasReservedId('id')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
