import { describe, expect, it } from 'vitest';
import { RequestReplayLedger } from '../../src/internal/request-replay-ledger';

describe('RequestReplayLedger', () => {
  it('rejects fresh entries instead of evicting them at capacity', () => {
    const ledger = new RequestReplayLedger(2, 2, 100);
    expect(ledger.admit('a', 'peer', 0)).toBe(true);
    expect(ledger.admit('b', 'peer', 1)).toBe(true);
    expect(ledger.admit('c', 'peer', 2)).toBe(false);
    expect(ledger.has('a', 3)).toBe(true);
    expect(ledger.has('b', 3)).toBe(true);
  });

  it('releases expired capacity at the boundary', () => {
    const ledger = new RequestReplayLedger(1, 1, 100);
    expect(ledger.admit('a', 'peer', 0)).toBe(true);
    expect(ledger.admit('b', 'peer', 99)).toBe(false);
    expect(ledger.admit('b', 'peer', 1_000)).toBe(true);
  });

  it('does not evict fresh rejection tombstones at capacity', () => {
    const ledger = new RequestReplayLedger(1, 1, 1_000);
    expect(ledger.admit('a', 'peer', 0)).toBe(true);
    expect(ledger.admit('rejected-a', 'peer', 1)).toBe(false);
    expect(ledger.admit('rejected-b', 'peer', 2)).toBe(false);
    expect(ledger.admit('a', 'peer', 3)).toBe(false);
    expect(ledger.has('a', 3)).toBe(true);
    expect(ledger.admit('rejected-a', 'peer', 1_000)).toBe(false);
    expect(ledger.admit('fresh', 'peer', 1_000)).toBe(true);
  });

  it('retains and releases the peer lease with the tombstone lifetime', () => {
    const retained: string[] = [];
    const released: string[] = [];
    const ledger = new RequestReplayLedger(2, 2, 10, {
      retain: (peer) => retained.push(peer),
      release: (peer) => released.push(peer)
    });
    expect(ledger.admit('a', 'peer', 0)).toBe(true);
    expect(retained).toEqual(['peer']);
    expect(ledger.has('other', 10)).toBe(false);
    expect(released).toEqual(['peer']);
  });
});
