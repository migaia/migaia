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

  it('exposes immutable capacity for independent replay namespaces', () => {
    const window = new ReplayWindow(2, 10_000);
    expect(window.maxEntries).toBe(2);
  });
  it('keeps an active identifier reserved past the retention window', () => {
    vi.useFakeTimers();
    try {
      const window = new ReplayWindow(1, 100);
      expect(window.reserveId('id')).toBe(true);
      vi.advanceTimersByTime(100);
      expect(window.hasReservedId('id')).toBe(true);
      expect(window.reserveId('id')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves a released identifier to a tombstone until the replay window expires', () => {
    vi.useFakeTimers();
    try {
      const window = new ReplayWindow(1, 100);
      expect(window.reserveId('id')).toBe(true);
      window.releaseId('id');
      window.releaseId('id');
      expect(window.hasReservedId('id')).toBe(true);
      expect(window.reserveId('id')).toBe(false);
      vi.advanceTimersByTime(100);
      expect(window.hasReservedId('id')).toBe(false);
      expect(window.reserveId('id')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('expires an active identifier without creating a second tombstone', () => {
    const window = new ReplayWindow(1, 10_000);
    expect(window.reserveId('id')).toBe(true);
    window.expireId('id');
    expect(window.hasReservedId('id')).toBe(false);
    expect(window.reserveId('replacement')).toBe(true);
  });

  it('does not let released tombstones evade the bounded namespace', () => {
    const window = new ReplayWindow(1, 10_000);
    expect(window.reserveId('id')).toBe(true);
    window.releaseId('id');
    expect(window.reserveId('other')).toBe(false);
  });

  it('expires released tombstones but never active ids after the replay window', () => {
    vi.useFakeTimers();
    try {
      const window = new ReplayWindow(2, 100);
      window.reserveId('id');
      expect(window.hasReservedId('id')).toBe(true);

      vi.advanceTimersByTime(100);
      expect(window.hasReservedId('id')).toBe(true);
      window.releaseId('id');
      expect(window.hasReservedId('id')).toBe(true);
      vi.advanceTimersByTime(100);
      expect(window.hasReservedId('id')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
