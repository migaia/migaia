import { describe, expect, it } from 'vitest';
import {
  createSerializeRegistry,
  type ISerializeAbortSignal,
  type ISerializeChunk,
  type ISerializePlugin
} from '../src/index.js';

const plugin = (encode: ISerializePlugin['parser']['encode']): ISerializePlugin => ({
  type: 'a',
  parser: {
    name: 'snapshot',
    encode,
    decode: (_chunk, context) => context.context
  }
});

describe('serialize operation option admission', () => {
  it('reads type, signal, and context once per operation before parser admission', async () => {
    let typeReads = 0;
    let signalReads = 0;
    let contextReads = 0;
    let encodeContext = '';
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {}
    } satisfies ISerializeAbortSignal;
    const options = {
      get type() {
        typeReads += 1;
        return 'a';
      },
      get signal() {
        signalReads += 1;
        return signal;
      },
      get context() {
        contextReads += 1;
        return contextReads === 1 ? 'encode-context' : 'decode-context';
      }
    };
    const registry = createSerializeRegistry([
      plugin((value, context) => {
        encodeContext = context.context;
        return ['text', String(value)] as const;
      })
    ]);

    await expect(registry.encode('value', options)).resolves.toEqual(['text', 'value']);
    await expect(registry.decode(['text', 'decoded'], options)).resolves.toBe('decode-context');

    expect(encodeContext).toBe('encode-context');
    expect(typeReads).toBe(2);
    expect(signalReads).toBe(2);
    expect(contextReads).toBe(2);
  });

  it('turns hostile option getters into INVALID_OPTION before parser or listener admission', async () => {
    for (const key of ['type', 'signal', 'context'] as const) {
      const cause = new Error(`${key} getter failed`);
      let parserCalls = 0;
      const options = {} as Record<string, unknown>;
      Object.defineProperty(options, key, {
        configurable: true,
        get: () => {
          throw cause;
        }
      });
      const registry = createSerializeRegistry([
        plugin(() => {
          parserCalls += 1;
          return ['text', 'unexpected'] as const;
        })
      ]);

      await expect(registry.encode('value', options as never)).rejects.toMatchObject({
        source: '@migaia/serialize',
        code: 'INVALID_OPTION',
        cause
      });
      expect(parserCalls).toBe(0);
    }
  });

  it('rejects malformed operation options without starting parser work', async () => {
    const parserCalls = { value: 0 };
    const registry = createSerializeRegistry([
      plugin(() => {
        parserCalls.value += 1;
        return ['text', 'unexpected'] as const;
      })
    ]);

    for (const options of [
      { type: 1 },
      { context: 1 },
      {
        signal: {
          aborted: 'not-a-boolean',
          addEventListener: () => {},
          removeEventListener: () => {}
        }
      }
    ]) {
      await expect(registry.encode('value', options as never)).rejects.toMatchObject({
        source: '@migaia/serialize',
        code: 'INVALID_OPTION'
      });
    }
    expect(parserCalls.value).toBe(0);
  });

  it('rolls back listener admission failure before parser work', async () => {
    const cause = new Error('add listener failed');
    let parserCalls = 0;
    let removeCalls = 0;
    const signal: ISerializeAbortSignal = {
      aborted: false,
      reason: undefined,
      addEventListener() {
        throw cause;
      },
      removeEventListener() {
        removeCalls += 1;
      }
    };
    const registry = createSerializeRegistry([
      plugin(() => {
        parserCalls += 1;
        return ['text', 'unexpected'] as const;
      })
    ]);

    await expect(
      registry.encode('value', { signal: signal as unknown as ISerializeAbortSignal })
    ).rejects.toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_OPTION',
      cause
    });
    expect(parserCalls).toBe(0);
    expect(removeCalls).toBe(1);
  });

  it('wraps signal accessor failures before parser or listener admission', async () => {
    const cause = new Error('add accessor failed');
    let parserCalls = 0;
    const signal = {} as Record<PropertyKey, unknown>;
    Object.defineProperties(signal, {
      aborted: { value: false },
      addEventListener: {
        get: () => {
          throw cause;
        }
      },
      removeEventListener: { value: () => {} }
    });
    const registry = createSerializeRegistry([
      plugin(() => {
        parserCalls += 1;
        return ['text', 'unexpected'] as const;
      })
    ]);

    await expect(
      registry.encode('value', { signal: signal as unknown as ISerializeAbortSignal })
    ).rejects.toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_OPTION',
      cause
    });
    expect(parserCalls).toBe(0);
  });

  it('maps a hostile reason getter to INVALID_OPTION and removes listeners', async () => {
    const cause = new Error('reason getter failed');
    let listener: (() => void) | undefined;
    let removeCalls = 0;
    const signal: ISerializeAbortSignal = {
      aborted: false,
      get reason() {
        throw cause;
      },
      addEventListener(_type, callback) {
        listener = callback;
      },
      removeEventListener() {
        removeCalls += 1;
      }
    };
    const registry = createSerializeRegistry([
      plugin(() => new Promise<ISerializeChunk>(() => {}))
    ]);
    const pending = registry.encode('value', { signal });

    listener?.();

    await expect(pending).rejects.toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_OPTION',
      cause
    });
    expect(removeCalls).toBe(1);
  });
});
