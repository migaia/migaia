import { describe, expect, it, vi } from 'vitest';
import { ReplayWindow } from '../../src/internal/replay';

describe('ReplayWindow', () => {
  it('rejects fresh entries independently at each capacity boundary', () => {
    const window = new ReplayWindow(2, 10_000);
    window.rememberCompleted('a');
    window.rememberCompleted('b');
    expect(window.rememberCompleted('c')).toBe(false);
    window.reserveId('id');
    expect(window.hasCompleted('a')).toBe(true);
    expect(window.hasCompleted('b')).toBe(true);
    expect(window.hasCompleted('c')).toBe(false);
    expect(window.hasReservedId('id')).toBe(true);
  });

  it('clears both replay namespaces', () => {
    const window = new ReplayWindow();
    window.rememberCompleted('task');
    window.reserveId('id');
    window.clear();
    expect(window.hasCompleted('task')).toBe(false);
    expect(window.hasReservedId('id')).toBe(false);
  });
  it('expires completed tasks and reserved ids after the replay window', () => {
    vi.useFakeTimers();
    try {
      const window = new ReplayWindow(2, 100);
      window.rememberCompleted('task');
      window.reserveId('id');
      expect(window.hasCompleted('task')).toBe(true);
      expect(window.hasReservedId('id')).toBe(true);

      vi.advanceTimersByTime(100);
      expect(window.hasCompleted('task')).toBe(false);
      expect(window.hasReservedId('id')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
