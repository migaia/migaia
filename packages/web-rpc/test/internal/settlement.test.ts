import { describe, expect, it } from 'vitest';
import { createSettlement } from '../../src/internal/settlement';

describe('settlement', () => {
  it('runs cleanup and settles only once', () => {
    let cleanups = 0;
    let result = '';
    const settlement = createSettlement<string>({
      cleanup: () => {
        cleanups += 1;
      },
      resolve: (value) => {
        result = value;
      },
      reject: () => undefined
    });
    expect(settlement.resolve('ok')).toBe(true);
    expect(settlement.reject(new Error('late'))).toBe(false);
    expect(cleanups).toBe(1);
    expect(result).toBe('ok');
  });

  it('still settles when cleanup throws', () => {
    let result = '';
    const settlement = createSettlement<string>({
      cleanup: () => {
        throw new Error('cleanup');
      },
      resolve: (value) => {
        result = value;
      },
      reject: () => undefined
    });
    expect(settlement.resolve('ok')).toBe(true);
    expect(result).toBe('ok');
  });
  it('reports cleanup failure without replacing the primary result', () => {
    const diagnostics: unknown[] = [];
    const settlement = createSettlement<string>({
      cleanup: () => {
        throw new Error('cleanup');
      },
      reportCleanupError: (error) => {
        diagnostics.push(error);
        throw new Error('diagnostic');
      },
      resolve: () => undefined,
      reject: () => undefined
    });
    expect(settlement.resolve('ok')).toBe(true);
    expect(diagnostics).toHaveLength(1);
  });
});
