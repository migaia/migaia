import { describe, expect, it } from 'vitest';
import { LoggerErrorCode, LOGGER_SOURCE } from '../src/errors';

describe('logger error-code contract (E-T9)', () => {
  it('declares 7 unique codes under the package source', () => {
    const codes = Object.values(LoggerErrorCode);
    expect(codes).toHaveLength(7);
    expect(new Set(codes).size).toBe(7);
    expect(LOGGER_SOURCE).toBe('@migaia/logger');
  });
});
