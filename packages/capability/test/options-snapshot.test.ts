import { describe, expect, it, vi } from 'vitest';
import { CapabilityErrorCode, createCapabilityHost } from '../src/index.js';

const source = '@migaia/capability';

const invalidOptionValues = [
  ['null', null],
  ['number', 0],
  ['boolean', false],
  ['string', ''],
  ['symbol', Symbol('options')],
  ['bigint', 0n]
] as const;

describe('capability host option admission snapshot', () => {
  it('reads each public option exactly once and keeps callback/flags stable after mutation', async () => {
    let onErrorReads = 0;
    let flagsReads = 0;
    const firstOnError = vi.fn(function (
      this: { seen: [string, unknown][] },
      name: string,
      error: unknown
    ) {
      this.seen.push([name, error]);
    });
    const replacementOnError = vi.fn();
    const firstFlags = { worker: true };
    let currentOnError: (name: string, error: unknown) => void = firstOnError;
    const options = {
      seen: [] as [string, unknown][],
      get onError() {
        onErrorReads++;
        return currentOnError;
      },
      get flags() {
        flagsReads++;
        return firstFlags;
      }
    };
    const host = createCapabilityHost(undefined, options);

    currentOnError = replacementOnError;
    firstFlags.worker = false;

    host.register({ name: 'worker', activate: () => ({}) as never });
    await expect(host.enable('worker')).resolves.toEqual({
      status: 'failed',
      error: expect.objectContaining({ code: CapabilityErrorCode.invalidHandle })
    });

    expect({ onErrorReads, flagsReads }).toEqual({ onErrorReads: 1, flagsReads: 1 });
    expect(firstOnError).toHaveBeenCalledWith('worker', expect.any(TypeError));
    expect(replacementOnError).not.toHaveBeenCalled();
    expect(options.seen).toEqual([['worker', expect.any(TypeError)]]);
  });

  it('preserves the original options receiver for a captured onError method', async () => {
    const options = {
      names: [] as string[],
      onError(name: string) {
        this.names.push(name);
      },
      flags: { worker: true }
    };
    const host = createCapabilityHost(undefined, options);
    host.register({ name: 'worker', activate: () => ({}) as never });

    await host.enable('worker');

    expect(options.names).toEqual(['worker']);
  });

  it.each([
    ['onError getter', 'onError'],
    ['flags getter', 'flags']
  ] as const)('wraps a hostile %s failure with source, code, and cause', (_label, property) => {
    const cause = new Error(`${property} unavailable`);
    const options = {
      get onError() {
        if (property === 'onError') throw cause;
        return undefined;
      },
      get flags() {
        if (property === 'flags') throw cause;
        return undefined;
      }
    };

    expect(() => createCapabilityHost(undefined, options)).toThrow(
      expect.objectContaining({
        source,
        code: CapabilityErrorCode.invalidOption,
        cause
      })
    );
  });

  it('wraps a hostile flags descriptor walk with source, code, and cause', () => {
    const cause = new Error('flags cannot be inspected');
    const flags = new Proxy(
      {},
      {
        ownKeys() {
          throw cause;
        }
      }
    );

    expect(() => createCapabilityHost(undefined, { flags })).toThrow(
      expect.objectContaining({
        source,
        code: CapabilityErrorCode.invalidOption,
        cause
      })
    );
  });

  it('rejects a non-function onError with native TypeError plus source and code', () => {
    expect(() => createCapabilityHost(undefined, { onError: 'not-a-function' } as never)).toThrow(
      expect.objectContaining({
        source,
        code: CapabilityErrorCode.invalidOption,
        message: 'capability onError must be a function'
      })
    );
    expect(() => createCapabilityHost(undefined, { onError: 'not-a-function' } as never)).toThrow(
      TypeError
    );
  });

  it('rejects null and primitive option containers before getter reads or host allocation', () => {
    let onErrorReads = 0;
    let flagsReads = 0;
    const originalOnError = Object.getOwnPropertyDescriptor(Object.prototype, 'onError');
    const originalFlags = Object.getOwnPropertyDescriptor(Object.prototype, 'flags');
    Object.defineProperty(Object.prototype, 'onError', {
      configurable: true,
      get: () => {
        onErrorReads++;
        return undefined;
      }
    });
    Object.defineProperty(Object.prototype, 'flags', {
      configurable: true,
      get: () => {
        flagsReads++;
        return undefined;
      }
    });

    try {
      for (const [_label, options] of invalidOptionValues) {
        let thrown: unknown;
        try {
          createCapabilityHost(undefined, options as never);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(TypeError);
        expect(thrown).toMatchObject({
          source,
          code: CapabilityErrorCode.invalidOption
        });
        expect((thrown as Error).stack).toBeTruthy();
      }
    } finally {
      if (originalOnError) Object.defineProperty(Object.prototype, 'onError', originalOnError);
      else Reflect.deleteProperty(Object.prototype, 'onError');
      if (originalFlags) Object.defineProperty(Object.prototype, 'flags', originalFlags);
      else Reflect.deleteProperty(Object.prototype, 'flags');
    }

    expect({ onErrorReads, flagsReads }).toEqual({ onErrorReads: 0, flagsReads: 0 });
  });
});
