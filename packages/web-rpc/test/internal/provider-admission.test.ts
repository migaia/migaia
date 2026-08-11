import { describe, expect, it } from 'vitest';
import { ProviderAdmissionRegistry } from '../../src/internal/provider-admission';

describe('ProviderAdmissionRegistry', () => {
  it('enforces global and per-peer limits and releases leases', () => {
    const admission = new ProviderAdmissionRegistry(2, 1);
    expect(admission.acquire('a', 'p1')).toBe(true);
    expect(admission.acquire('b', 'p1')).toBe(false);
    expect(admission.acquire('b', 'p2')).toBe(true);
    expect(admission.acquire('c', 'p3')).toBe(false);
    admission.release('a');
    expect(admission.acquire('c', 'p3')).toBe(true);
  });
});
