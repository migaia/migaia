import { describe, expect, it } from 'vitest';
import { WebRpcSchemaValidationError } from '../../src/errors';
import { validateContractData } from '../../src/internal/contract';
import type { IWebRpcContractConfig } from '../../src/typing';

describe('contract error normalization', () => {
  it('does not let hostile issue getters replace the stable schema error', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('getter leaked');
        },
        has() {
          throw new Error('has leaked');
        }
      }
    );
    expect(() =>
      validateContractData(
        {
          schemas: {
            value: {
              params: {
                parse: () => {
                  throw hostile;
                }
              },
              result: { parse: () => undefined }
            }
          }
        },
        'value',
        'params',
        1
      )
    ).toThrowError(expect.objectContaining({ code: 'SCHEMA_INVALID' }));
  });
  it('falls back when the issues collection itself is hostile', () => {
    const issues = new Proxy([], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw new Error('iterator leaked');
        return Reflect.get(target, property, receiver);
      }
    });
    expect(() =>
      validateContractData(
        {
          schemas: {
            value: {
              params: {
                parse: () => {
                  throw { issues };
                }
              },
              result: { parse: () => undefined }
            }
          }
        },
        'value',
        'params',
        1
      )
    ).toThrowError(expect.objectContaining({ code: 'SCHEMA_INVALID' }));
  });

  it('ignores absent and non-parser schemas and executes valid parsers', () => {
    expect(() => validateContractData({}, 'missing', 'params', 1)).not.toThrow();
    expect(() =>
      validateContractData(
        { schemas: { value: { params: {} } } } as unknown as IWebRpcContractConfig,
        'value',
        'params',
        1
      )
    ).not.toThrow();
    let parsed: unknown;
    validateContractData(
      {
        schemas: {
          value: {
            params: {
              parse: (data: unknown) => {
                parsed = data;
              }
            },
            result: { parse: () => undefined }
          }
        }
      },
      'value',
      'params',
      42
    );
    expect(parsed).toBe(42);
  });

  it('snapshots normal schema issues and filters hostile path elements', () => {
    let failure: WebRpcSchemaValidationError | undefined;
    try {
      validateContractData(
        {
          schemas: {
            value: {
              result: {
                parse: () => {
                  throw {
                    issues: [
                      { path: ['root', 1, {}, null], message: 'wrong value', code: 'custom' },
                      { path: 'not-an-array', message: 42, code: null }
                    ]
                  };
                }
              },
              params: { parse: () => undefined }
            }
          }
        },
        'value',
        'result',
        null
      );
    } catch (error) {
      failure = error as WebRpcSchemaValidationError;
    }
    expect(failure?.data).toEqual({
      kind: 'schema-validation',
      method: 'value',
      side: 'result',
      issues: [
        { path: ['root', 1], message: 'wrong value', code: 'custom' },
        { path: [], message: 'Schema validation failed', code: undefined }
      ]
    });
  });

  it('uses a stable fallback for errors without issue arrays', () => {
    expect(() =>
      validateContractData(
        {
          schemas: {
            value: {
              params: {
                parse: () => {
                  throw new Error('bad input');
                }
              },
              result: { parse: () => undefined }
            }
          }
        },
        'value',
        'params',
        null
      )
    ).toThrowError(
      expect.objectContaining({
        data: expect.objectContaining({ issues: [{ path: [], message: 'bad input' }] })
      })
    );
  });
});
