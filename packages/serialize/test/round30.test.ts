import { describe, expect, it } from 'vitest';
import { createSerializeRegistry, type ISerializePlugin } from '../src/index.js';

/** Assert native TypeError tagging and exact cause preservation for plugin-list failures. */
const expectPluginListFailure = (plugins: unknown, cause: unknown): void => {
  let caught: unknown;
  try {
    createSerializeRegistry(plugins as readonly ISerializePlugin[]);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TypeError);
  expect(caught).toMatchObject({
    source: '@migaia/serialize',
    code: 'INVALID_OPTION',
    cause
  });
  expect((caught as { readonly cause?: unknown }).cause).toBe(cause);
};

describe('Round30 serialize plugin-list admission', () => {
  it('wraps a length getter failure before parser ownership', () => {
    const cause = new Error('plugin list length failed');
    const plugins = {} as Record<PropertyKey, unknown>;
    Object.defineProperty(plugins, 'length', { get: () => throwCause(cause) });

    expectPluginListFailure(plugins, cause);
  });

  it('wraps an entries getter failure before parser ownership', () => {
    const cause = new Error('plugin list entries getter failed');
    const plugins = { length: 1 } as Record<PropertyKey, unknown>;
    Object.defineProperty(plugins, 'entries', { get: () => throwCause(cause) });

    expectPluginListFailure(plugins, cause);
  });

  it('wraps an entries call failure before parser ownership', () => {
    const cause = new Error('plugin list entries call failed');
    const plugins = {
      length: 1,
      entries: () => throwCause(cause)
    };

    expectPluginListFailure(plugins, cause);
  });

  it('wraps an iterator next getter failure before parser ownership', () => {
    const cause = new Error('plugin list next getter failed');
    const iterator = {} as Record<PropertyKey, unknown>;
    Object.defineProperty(iterator, 'next', { get: () => throwCause(cause) });
    const plugins = { length: 1, entries: () => iterator };

    expectPluginListFailure(plugins, cause);
  });

  it('wraps an iterator next call failure before parser ownership', () => {
    const cause = new Error('plugin list next call failed');
    const plugins = {
      length: 1,
      entries: () => ({ next: () => throwCause(cause) })
    };

    expectPluginListFailure(plugins, cause);
  });

  it('wraps an iterator done getter failure before parser ownership', () => {
    const cause = new Error('plugin list done getter failed');
    const result = {} as Record<PropertyKey, unknown>;
    Object.defineProperty(result, 'done', { get: () => throwCause(cause) });
    const plugins = { length: 1, entries: () => ({ next: () => result }) };

    expectPluginListFailure(plugins, cause);
  });

  it('wraps an iterator value getter failure before parser ownership', () => {
    const cause = new Error('plugin list value getter failed');
    const result = {} as Record<PropertyKey, unknown>;
    Object.defineProperty(result, 'done', { value: false });
    Object.defineProperty(result, 'value', { get: () => throwCause(cause) });
    const plugins = { length: 1, entries: () => ({ next: () => result }) };

    expectPluginListFailure(plugins, cause);
  });

  it('takes no parser ownership when the iterator fails after yielding a plugin', () => {
    const cause = new Error('plugin list terminal next failed');
    let disposeCalls = 0;
    let parserPropertyReads = 0;
    const parser = {} as Record<PropertyKey, unknown>;
    Object.defineProperties(parser, {
      name: { value: 'round30' },
      encode: {
        get: () => {
          parserPropertyReads += 1;
          return () => ['text', 'value'];
        }
      },
      decode: {
        get: () => {
          parserPropertyReads += 1;
          return (chunk: unknown) => chunk;
        }
      },
      dispose: {
        get: () => {
          parserPropertyReads += 1;
          return () => {
            disposeCalls += 1;
          };
        }
      }
    });
    const plugin = { type: 'round30', parser };
    let nextCalls = 0;
    const plugins = {
      length: 1,
      entries: () => ({
        next: () => {
          nextCalls += 1;
          if (nextCalls === 1) return { done: false, value: [0, plugin] };
          return throwCause(cause);
        }
      })
    };

    expectPluginListFailure(plugins, cause);
    expect(parserPropertyReads).toBe(0);
    expect(disposeCalls).toBe(0);
  });
});

/** Throw a supplied fixture so tests can assert identity through the package boundary. */
const throwCause = (cause: unknown): never => {
  throw cause;
};
