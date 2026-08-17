import { describe, expect, it } from 'vitest';
import {
  deserializeError,
  reachError,
  serializeError,
  WebRpcLifecycleError,
  WEBRPC_SOURCE
} from '../src';

describe('cross-realm error serialization', () => {
  it('reaches cause, cleanupErrors and AggregateError entries (E-T3)', () => {
    const root = new Error('root');
    const cleanup = new Error('cleanup');
    const error = new WebRpcLifecycleError('lifecycle', root, [
      { resource: 'middleware', error: cleanup }
    ]);
    const withCleanup = [...reachError(error)];
    expect(withCleanup.some((entry) => entry === root)).toBe(true);
    expect(withCleanup.some((entry) => entry === cleanup)).toBe(true);

    const first = new Error('first');
    const second = new Error('second');
    const aggregate = new AggregateError([first, second], 'aggregate');
    const wrapped = new WebRpcLifecycleError('lifecycle2', aggregate, []);
    const reached = [...reachError(wrapped)];
    expect(reached.some((entry) => entry === aggregate)).toBe(true);
    expect(reached.some((entry) => entry === first)).toBe(true);
    expect(reached.some((entry) => entry === second)).toBe(true);
  });

  it('round-trips (source, code, name, message, stack, causes) losslessly (E-T4)', () => {
    const root = new Error('root');
    const cleanup = new Error('cleanup');
    const error = new WebRpcLifecycleError('lifecycle failed', root, [
      { resource: 'middleware', error: cleanup }
    ]);
    const serialized = serializeError(error);
    expect(serialized.source).toBe(WEBRPC_SOURCE);
    expect(serialized.code).toBe('ENDPOINT_DISPOSED');
    expect(serialized.name).toBe('WebRpcLifecycleError');
    expect(serialized.causes?.map((entry) => entry.message)).toEqual(['root', 'cleanup']);

    const restored = deserializeError(serialized);
    expect(restored.name).toBe('WebRpcLifecycleError');
    expect(restored.message).toBe('lifecycle failed');
    expect(restored.stack).toBe(serialized.stack);
    expect(serializeError(restored)).toEqual(serialized);
  });

  it('preserves an AbortError name so callers can still branch on it (E-T4)', () => {
    const abort = new DOMException('aborted', 'AbortError');
    const serialized = serializeError(abort);
    expect(serialized.name).toBe('AbortError');
    const restored = deserializeError(serialized);
    expect(restored.name).toBe('AbortError');
  });
});
