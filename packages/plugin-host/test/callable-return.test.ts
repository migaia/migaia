import { describe, expect, it } from 'vitest';
import { PluginHost } from '../src/host-runtime.js';

class Host extends PluginHost<Record<string, never>> {}

type ITestIterator = {
  next(this: object): IteratorResult<{ value: number }>;
  return(this: object): IteratorResult<{ value: number }>;
  throw(this: object, reason: unknown): never;
  [Symbol.iterator](this: object): ITestIterator;
};

type IAsyncTestIterator = {
  next(this: object): Promise<IteratorResult<{ value: number }>>;
  return(this: object): Promise<IteratorResult<{ value: number }>>;
  throw(this: object, reason: unknown): Promise<never>;
  [Symbol.asyncIterator](this: object): IAsyncTestIterator;
};

/** Install one config callable and return its public readonly facade. */
const installCallable = async (callable: unknown): Promise<unknown> => {
  const host = new Host();
  await host.use({
    name: 'callable',
    config: { callable },
    install: () => ({})
  } as never);
  return host.config.get('callable.callable');
};

describe('PH-T26: callable output readonly boundary', () => {
  it('PH-T26a: protects sync object/function outputs, aliases, primitives, and thrown errors', async () => {
    const captured = { value: 1 };
    const returnedFunction = (): unknown => captured;
    const returned = { first: captured, second: captured };
    Object.defineProperty(returnedFunction, 'marker', {
      configurable: true,
      enumerable: true,
      value: captured,
      writable: true
    });
    const thrown = new Error('callable failure');
    const callable = function (this: unknown, mode: string): unknown {
      if (mode === 'object') return returned;
      if (mode === 'function') return returnedFunction;
      if (mode === 'primitive') return 7;
      throw thrown;
    };
    const readonlyCallable = (await installCallable(callable)) as (mode: string) => unknown;

    const readonlyReturned = readonlyCallable('object') as {
      first: { value: number };
      second: { value: number };
    };
    expect(readonlyReturned).not.toBe(returned);
    expect(readonlyReturned.first).toBe(readonlyReturned.second);
    expect(() => {
      readonlyReturned.first.value = 2;
    }).toThrow('readonly');
    expect(captured.value).toBe(1);

    const readonlyFunction = readonlyCallable('function') as ((...args: never[]) => unknown) & {
      marker: { value: number };
    };
    expect(readonlyFunction).not.toBe(returnedFunction);
    expect(() => {
      readonlyFunction.marker.value = 2;
    }).toThrow('readonly');
    expect(readonlyFunction()).not.toBe(captured);
    expect(readonlyCallable('primitive')).toBe(7);
    expect(() => readonlyCallable('error')).toThrow(thrown);
  });

  it('PH-T26b: maps fulfilled async values and preserves rejection identity', async () => {
    const fulfilled = { value: 1 };
    const rejection = new Error('async rejection');
    const callable = (mode: string): unknown =>
      mode === 'promise' ? Promise.resolve(fulfilled) : Promise.reject(rejection);
    const readonlyCallable = (await installCallable(callable)) as (mode: string) => unknown;

    const promiseResult = readonlyCallable('promise') as Promise<{ value: number }>;
    expect(promiseResult).toBeInstanceOf(Promise);
    const readonlyFulfilled = await promiseResult;
    expect(readonlyFulfilled).not.toBe(fulfilled);
    expect(() => {
      readonlyFulfilled.value = 2;
    }).toThrow('readonly');
    await expect(readonlyCallable('reject')).rejects.toBe(rejection);
  });

  it('PH-T26c: reads hostile thenable once with original receiver and protects fulfillment', async () => {
    const fulfilled = { value: 1 };
    let thenReads = 0;
    let thenReceiverMatched = false;
    const hostileThenable = {
      // oxlint-disable-next-line unicorn/no-thenable -- PH-R26 hostile thenable receiver contract.
      get then() {
        thenReads += 1;
        return function (
          this: unknown,
          resolve: (value: unknown) => void,
          _reject: (reason: unknown) => void
        ): void {
          thenReceiverMatched = this === hostileThenable;
          resolve(fulfilled);
        };
      }
    };
    const readonlyCallable = (await installCallable(() => hostileThenable)) as () => unknown;
    const readonlyFulfilled = (await readonlyCallable()) as { value: number };
    expect(readonlyFulfilled).not.toBe(fulfilled);
    expect(() => {
      readonlyFulfilled.value = 2;
    }).toThrow('readonly');
    expect(thenReads).toBe(1);
    expect(thenReceiverMatched).toBe(true);
  });

  it('PH-T26d: lazily protects sync generator yields and return values, preserving iterator receiver and errors', async () => {
    const yielded = { value: 1 };
    let rawGenerator: Generator<{ value: number }, { value: number }, never> | undefined;
    const generator = function* (): Generator<{ value: number }, { value: number }, never> {
      yield yielded;
      return yielded;
    };
    const readonlyCallable = (await installCallable(() => {
      rawGenerator = generator();
      return rawGenerator;
    })) as () => Generator<{ value: number }, { value: number }, never>;
    const readonlyGenerator = readonlyCallable();
    expect(readonlyGenerator).not.toBe(rawGenerator);
    const first = readonlyGenerator.next();
    expect(first.done).toBe(false);
    expect(() => {
      first.value.value = 2;
    }).toThrow('readonly');
    const done = readonlyGenerator.next();
    expect(done.done).toBe(true);
    expect(done.value).toBe(first.value);
    expect(yielded.value).toBe(1);
  });

  it('PH-T26e: preserves sync iterator receiver, return/throw behavior, and lazy advancement', async () => {
    const value = { value: 1 };
    const error = new Error('iterator error');
    let nextCalls = 0;
    let iteratorReceiverMatched = false;
    let factoryReceiverMatched = false;
    const iterator: ITestIterator = {
      next(this: object): IteratorResult<typeof value> {
        iteratorReceiverMatched = this === iterator;
        nextCalls += 1;
        return nextCalls === 1 ? { done: false, value } : { done: true, value };
      },
      return(this: object): IteratorResult<typeof value> {
        iteratorReceiverMatched = this === iterator;
        return { done: true, value };
      },
      throw(this: object, reason: unknown): never {
        iteratorReceiverMatched = this === iterator;
        throw reason;
      },
      [Symbol.iterator](this: object): ITestIterator {
        factoryReceiverMatched = this === iterator;
        return iterator;
      }
    };
    const readonlyCallable = (await installCallable(() => iterator)) as () => typeof iterator;
    const readonlyIterator = readonlyCallable();
    expect(nextCalls).toBe(0);
    expect(readonlyIterator[Symbol.iterator]()).toBe(readonlyIterator);
    expect(factoryReceiverMatched).toBe(true);
    const first = readonlyIterator.next();
    expect(nextCalls).toBe(1);
    expect(() => {
      first.value.value = 2;
    }).toThrow('readonly');
    expect(readonlyIterator.return().value).toBe(first.value);
    expect(() => readonlyIterator.throw(error)).toThrow(error);
    expect(iteratorReceiverMatched).toBe(true);
  });

  it('PH-T26f: lazily protects async generator yields and return values, preserving rejection identity', async () => {
    const yielded = { value: 1 };
    const generator = async function* (): AsyncGenerator<
      { value: number },
      { value: number },
      never
    > {
      yield yielded;
      return yielded;
    };
    const readonlyCallable = (await installCallable(() => generator())) as () => AsyncGenerator<
      { value: number },
      { value: number },
      never
    >;
    const readonlyGenerator = readonlyCallable();
    const first = await readonlyGenerator.next();
    expect(first.done).toBe(false);
    expect(() => {
      first.value.value = 2;
    }).toThrow('readonly');
    const done = await readonlyGenerator.next();
    expect(done.done).toBe(true);
    expect(done.value).toBe(first.value);
    const rejection = new Error('async iterator error');
    await expect(readonlyGenerator.throw(rejection)).rejects.toBe(rejection);
    expect(yielded.value).toBe(1);
  });

  it('PH-T26g: preserves async iterator receiver, return/throw behavior, lazy advancement, and aliases', async () => {
    const value = { value: 1 };
    const error = new Error('async iterator error');
    let nextCalls = 0;
    let iteratorReceiverMatched = false;
    let factoryReceiverMatched = false;
    const iterator: IAsyncTestIterator = {
      next(this: object): Promise<IteratorResult<typeof value>> {
        iteratorReceiverMatched = this === iterator;
        nextCalls += 1;
        return Promise.resolve(nextCalls === 1 ? { done: false, value } : { done: true, value });
      },
      return(this: object): Promise<IteratorResult<typeof value>> {
        iteratorReceiverMatched = this === iterator;
        return Promise.resolve({ done: true, value });
      },
      throw(this: object, reason: unknown): Promise<never> {
        iteratorReceiverMatched = this === iterator;
        return Promise.reject(reason);
      },
      [Symbol.asyncIterator](this: object): IAsyncTestIterator {
        factoryReceiverMatched = this === iterator;
        return iterator;
      }
    };
    const readonlyCallable = (await installCallable(() => iterator)) as () => typeof iterator;
    const readonlyIterator = readonlyCallable();
    expect(nextCalls).toBe(0);
    expect(await readonlyIterator[Symbol.asyncIterator]()).toBe(readonlyIterator);
    expect(factoryReceiverMatched).toBe(true);
    const first = await readonlyIterator.next();
    expect(nextCalls).toBe(1);
    expect(() => {
      first.value.value = 2;
    }).toThrow('readonly');
    expect((await readonlyIterator.return()).value).toBe(first.value);
    await expect(readonlyIterator.throw(error)).rejects.toBe(error);
    expect(iteratorReceiverMatched).toBe(true);
  });

  it('PH-T28a: maps frozen iterator methods, protocol, locked values, and descriptors safely', async () => {
    type IRawIterator = {
      next(this: object): IteratorResult<{ value: number }>;
      return(this: object): IteratorResult<{ value: number }>;
      throw(this: object, reason: unknown): never;
      [Symbol.iterator](this: object): IRawIterator;
      locked: { value: number };
    };
    type IReadonlyIterator = {
      next(): IteratorResult<{ value: number }>;
      return(): IteratorResult<{ value: number }>;
      throw(reason: unknown): never;
      [Symbol.iterator](): IReadonlyIterator;
      locked: { value: number };
    };
    const rawValue = { value: 1 };
    const rawError = new Error('frozen iterator error');
    let nextCalls = 0;
    let receiverMatched = false;
    const readonlyCallable = (await installCallable(() => {
      const iterator: IRawIterator = {
        next(this: object): IteratorResult<typeof rawValue> {
          receiverMatched = this === iterator;
          nextCalls += 1;
          return nextCalls === 1
            ? { done: false, value: rawValue }
            : { done: true, value: rawValue };
        },
        return(this: object): IteratorResult<typeof rawValue> {
          receiverMatched = this === iterator;
          return { done: true, value: rawValue };
        },
        throw(this: object, reason: unknown): never {
          receiverMatched = this === iterator;
          throw reason;
        },
        [Symbol.iterator](this: object): IRawIterator {
          receiverMatched = this === iterator;
          return this as IRawIterator;
        },
        locked: rawValue
      };
      return Object.freeze(iterator);
    })) as () => IReadonlyIterator;
    const readonlyIterator = readonlyCallable();

    expect(nextCalls).toBe(0);
    expect(Object.isFrozen(readonlyIterator)).toBe(true);
    expect(Reflect.ownKeys(readonlyIterator)).toEqual(
      expect.arrayContaining(['next', 'return', 'throw', 'locked', Symbol.iterator])
    );
    expect(Object.getOwnPropertyDescriptor(readonlyIterator, 'locked')?.value).toBe(
      readonlyIterator.locked
    );
    expect(Object.getOwnPropertyDescriptor(readonlyIterator, 'next')?.value).toBe(
      readonlyIterator.next
    );
    expect(readonlyIterator[Symbol.iterator]()).toBe(readonlyIterator);
    expect(receiverMatched).toBe(true);
    expect(nextCalls).toBe(0);

    const first = readonlyIterator.next();
    expect(nextCalls).toBe(1);
    expect(() => {
      first.value.value = 2;
    }).toThrow('readonly');
    expect(readonlyIterator.return().value).toBe(first.value);
    expect(() => readonlyIterator.throw(rawError)).toThrow(rawError);
    expect(receiverMatched).toBe(true);
  });

  it('PH-T28c: maps frozen async iterator methods, protocol, and rejection identity safely', async () => {
    type IRawAsyncIterator = {
      next(this: object): Promise<IteratorResult<{ value: number }>>;
      return(this: object): Promise<IteratorResult<{ value: number }>>;
      throw(this: object, reason: unknown): Promise<never>;
      [Symbol.asyncIterator](this: object): IRawAsyncIterator;
      locked: { value: number };
    };
    type IReadonlyAsyncIterator = {
      next(): Promise<IteratorResult<{ value: number }>>;
      return(): Promise<IteratorResult<{ value: number }>>;
      throw(reason: unknown): Promise<never>;
      [Symbol.asyncIterator](): IReadonlyAsyncIterator;
      locked: { value: number };
    };
    const rawValue = { value: 1 };
    const rawError = new Error('frozen async iterator error');
    let nextCalls = 0;
    let receiverMatched = false;
    const readonlyCallable = (await installCallable(() => {
      const iterator: IRawAsyncIterator = {
        next(this: object): Promise<IteratorResult<typeof rawValue>> {
          receiverMatched = this === iterator;
          nextCalls += 1;
          return Promise.resolve(
            nextCalls === 1 ? { done: false, value: rawValue } : { done: true, value: rawValue }
          );
        },
        return(this: object): Promise<IteratorResult<typeof rawValue>> {
          receiverMatched = this === iterator;
          return Promise.resolve({ done: true, value: rawValue });
        },
        throw(this: object, reason: unknown): Promise<never> {
          receiverMatched = this === iterator;
          return Promise.reject(reason);
        },
        [Symbol.asyncIterator](this: object): IRawAsyncIterator {
          receiverMatched = this === iterator;
          return this as IRawAsyncIterator;
        },
        locked: rawValue
      };
      return Object.freeze(iterator);
    })) as () => IReadonlyAsyncIterator;
    const readonlyIterator = readonlyCallable();
    expect(Object.isFrozen(readonlyIterator)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(readonlyIterator, 'locked')?.value).toBe(
      readonlyIterator.locked
    );
    expect(await readonlyIterator[Symbol.asyncIterator]()).toBe(readonlyIterator);
    expect(receiverMatched).toBe(true);
    expect(nextCalls).toBe(0);
    const first = await readonlyIterator.next();
    expect(first.done).toBe(false);
    expect(() => {
      first.value.value = 2;
    }).toThrow('readonly');
    expect((await readonlyIterator.return()).value).toBe(first.value);
    await expect(readonlyIterator.throw(rawError)).rejects.toBe(rawError);
    expect(receiverMatched).toBe(true);
  });

  it('PH-T29a: preserves frozen iterator ordinary accessors, receivers, descriptors, aliases, and cycles', async () => {
    type IRawAccessorIterator = {
      next(this: object): IteratorResult<{ value: number }>;
      [Symbol.iterator](this: object): IRawAccessorIterator;
      ordinary: { value: number; self?: unknown; iterator?: unknown };
      cycle: IRawAccessorIterator;
      throwing: unknown;
      [accessorKey]: { value: number; self?: unknown; iterator?: unknown };
    };
    type IReadonlyAccessorIterator = {
      next(): IteratorResult<{ value: number }>;
      [Symbol.iterator](): IReadonlyAccessorIterator;
      ordinary: { value: number; self?: unknown; iterator?: unknown };
      cycle: IReadonlyAccessorIterator;
      throwing: unknown;
      [accessorKey]: { value: number; self?: unknown; iterator?: unknown };
    };
    const accessorKey = Symbol('ordinary accessor');
    const getterError = new Error('iterator accessor getter');
    const shared = { value: 1 } as { value: number; self?: unknown; iterator?: unknown };
    let iterator!: IRawAccessorIterator;
    let ordinaryReads = 0;
    let ordinaryGetterReceiverMatched = false;
    let symbolReads = 0;
    let symbolGetterReceiverMatched = false;
    let throwingReads = 0;
    let nextReads = 0;
    let nextGetterReceiverMatched = false;
    let nextReceiverMatched = false;
    const rawNext = function (this: object): IteratorResult<typeof shared> {
      nextReceiverMatched = this === iterator;
      return { done: true, value: shared };
    };
    iterator = {} as IRawAccessorIterator;
    Object.defineProperties(iterator, {
      next: {
        configurable: false,
        enumerable: true,
        get(this: object): typeof rawNext {
          nextReads += 1;
          nextGetterReceiverMatched = this === iterator;
          return rawNext;
        }
      },
      [Symbol.iterator]: {
        configurable: false,
        enumerable: true,
        value: function (this: object): IRawAccessorIterator {
          expect(this).toBe(iterator);
          return iterator;
        },
        writable: false
      },
      ordinary: {
        configurable: false,
        enumerable: true,
        get(this: object): typeof shared {
          ordinaryReads += 1;
          ordinaryGetterReceiverMatched = this === iterator;
          return shared;
        },
        set: (): void => undefined
      },
      cycle: {
        configurable: false,
        enumerable: true,
        get(this: object): IRawAccessorIterator {
          expect(this).toBe(iterator);
          return iterator;
        }
      },
      throwing: {
        configurable: false,
        enumerable: true,
        get(this: object): never {
          throwingReads += 1;
          expect(this).toBe(iterator);
          throw getterError;
        }
      },
      [accessorKey]: {
        configurable: false,
        enumerable: true,
        get(this: object): typeof shared {
          symbolReads += 1;
          symbolGetterReceiverMatched = this === iterator;
          return shared;
        }
      }
    });
    shared.self = shared;
    shared.iterator = iterator;
    Object.freeze(iterator);

    const readonlyCallable = (await installCallable(
      () => iterator
    )) as () => IReadonlyAccessorIterator;
    const readonlyIterator = readonlyCallable();
    expect(Object.isFrozen(readonlyIterator)).toBe(true);
    expect(Object.isExtensible(readonlyIterator)).toBe(false);
    expect(Reflect.ownKeys(readonlyIterator)).toEqual(
      expect.arrayContaining([
        'next',
        'ordinary',
        'cycle',
        'throwing',
        Symbol.iterator,
        accessorKey
      ])
    );

    const ordinaryDescriptor = Object.getOwnPropertyDescriptor(readonlyIterator, 'ordinary');
    expect(ordinaryDescriptor?.configurable).toBe(false);
    expect(ordinaryDescriptor?.get).toBeTypeOf('function');
    expect(ordinaryDescriptor?.set).toBeTypeOf('function');
    const ordinaryReadsBeforeDescriptor = ordinaryReads;
    const fromDescriptor = ordinaryDescriptor?.get?.();
    expect(ordinaryReads).toBe(ordinaryReadsBeforeDescriptor + 1);
    expect(fromDescriptor).toBe(readonlyIterator.ordinary);
    expect(ordinaryGetterReceiverMatched).toBe(true);

    const ordinaryReadsBeforeAccess = ordinaryReads;
    const ordinary = readonlyIterator.ordinary;
    expect(ordinaryReads).toBe(ordinaryReadsBeforeAccess + 1);
    expect(ordinary).toBe(readonlyIterator[accessorKey]);
    expect(ordinary).not.toBe(shared);
    expect(ordinary.self).toBe(ordinary);
    expect(ordinary.iterator).toBe(readonlyIterator);
    expect(() => {
      ordinary.value = 2;
    }).toThrow('readonly');
    expect(shared.value).toBe(1);

    const symbolReadsBeforeAccess = symbolReads;
    const symbolValue = readonlyIterator[accessorKey];
    expect(symbolReads).toBe(symbolReadsBeforeAccess + 1);
    expect(symbolValue).toBe(ordinary);
    expect(symbolGetterReceiverMatched).toBe(true);

    const throwingReadsBeforeAccess = throwingReads;
    expect(() => readonlyIterator.throwing).toThrow(getterError);
    expect(throwingReads).toBe(throwingReadsBeforeAccess + 1);

    const nextDescriptor = Object.getOwnPropertyDescriptor(readonlyIterator, 'next');
    expect(nextDescriptor?.configurable).toBe(false);
    expect(nextDescriptor?.get).toBeTypeOf('function');
    const nextReadsBeforeAccess = nextReads;
    const next = readonlyIterator.next;
    expect(nextReads).toBe(nextReadsBeforeAccess + 1);
    expect(nextGetterReceiverMatched).toBe(true);
    expect(next).not.toBe(rawNext);
    const step = next();
    expect(step.value).toBe(ordinary);
    expect(nextReceiverMatched).toBe(true);
    expect(readonlyIterator.cycle).toBe(readonlyIterator);
    expect(() => ordinaryDescriptor?.set?.(shared)).toThrow('readonly');
    expect(() => Reflect.set(readonlyIterator, 'ordinary', shared)).toThrow('readonly');
  });

  it('PH-T28b: forwards frozen callable properties with call, construct, receiver, and prototype semantics', async () => {
    const lockedKey = Symbol('locked');
    const lockedValue = { value: 1 };
    let receiverMatched = false;
    let newTargetMatched = false;
    const receiver: { value?: number } = {};
    let publicCallable: unknown;
    const callableFactory = (await installCallable(() => {
      const callable = function (this: { value?: number }, value: number): object {
        receiverMatched = this === receiver;
        newTargetMatched = new.target === publicCallable;
        this.value = value;
        return this;
      };
      Object.defineProperty(callable, lockedKey, {
        configurable: false,
        enumerable: true,
        value: lockedValue,
        writable: false
      });
      return Object.freeze(callable);
    })) as () => ((value: number) => object) & {
      new (value: number): { value: number };
      prototype: object;
      [lockedKey]: { value: number };
    };
    const readonlyCallable = callableFactory();
    publicCallable = readonlyCallable;

    expect(typeof readonlyCallable).toBe('function');
    expect(Reflect.ownKeys(readonlyCallable)).toEqual(
      expect.arrayContaining(['length', 'name', 'prototype', lockedKey])
    );
    expect(Object.getOwnPropertyDescriptor(readonlyCallable, lockedKey)?.value).toBe(
      readonlyCallable[lockedKey]
    );
    expect(() => {
      readonlyCallable[lockedKey].value = 2;
    }).toThrow('readonly');

    Reflect.apply(readonlyCallable, receiver, [3]);
    expect(receiverMatched).toBe(true);
    expect(receiver.value).toBe(3);

    const instance = new readonlyCallable(4) as { value: number };
    expect(instance.value).toBe(4);
    expect(newTargetMatched).toBe(true);
    expect(instance instanceof readonlyCallable).toBe(true);
    expect(Object.getPrototypeOf(instance)).toBe(readonlyCallable.prototype);
    expect(() => {
      (readonlyCallable.prototype as { value?: number }).value = 2;
    }).toThrow('readonly');
  });

  it('PH-T27a: maps frozen, sealed, non-extensible, accessor, symbol, and array outputs safely', async () => {
    const shared = { value: 1 };
    const frozen = Object.freeze({ shared });
    const sealed = Object.seal({ shared });
    const nonExtensible = Object.preventExtensions({ shared });
    const accessor = Object.defineProperty({}, 'value', {
      configurable: false,
      enumerable: true,
      get: () => shared
    });
    const array = Object.freeze([shared]);
    const symbol = Symbol('shared');
    const readonlyCallable = (await installCallable(() => ({
      frozen,
      sealed,
      nonExtensible,
      accessor,
      array,
      [symbol]: shared
    }))) as () => {
      frozen: { shared: { value: number } };
      sealed: { shared: { value: number } };
      nonExtensible: { shared: { value: number } };
      accessor: { value: { value: number } };
      array: readonly [{ value: number }];
      [symbol]: { value: number };
    };
    const output = readonlyCallable();

    expect(Object.getOwnPropertyDescriptor(output.frozen, 'shared')?.value).toBe(
      output.frozen.shared
    );
    expect(Object.getOwnPropertyDescriptor(output.array, '0')?.value).toBe(output.array[0]);
    expect(Object.getOwnPropertyDescriptor(output.accessor, 'value')?.get).toBeDefined();
    expect(output.frozen.shared).toBe(output.sealed.shared);
    expect(output.frozen.shared).toBe(output.nonExtensible.shared);
    expect(output.frozen.shared).toBe(output.accessor.value);
    expect(output.frozen.shared).toBe(output.array[0]);
    expect(output.frozen.shared).toBe(output[symbol]);
    expect(() => {
      output.frozen.shared.value = 2;
    }).toThrow('readonly');
    expect(shared.value).toBe(1);
  });

  it('PH-T27b: shares promise identity through fulfilled object back-references and nested awaits', async () => {
    const referenced: { value: number; promise?: Promise<unknown> } = { value: 1 };
    const promise = Promise.resolve(referenced);
    referenced.promise = promise;
    const readonlyCallable = (await installCallable(() => ({
      first: promise,
      second: promise,
      referenced,
      list: [promise, referenced]
    }))) as () => {
      first: Promise<{ value: number; promise?: Promise<unknown> }>;
      second: Promise<{ value: number; promise?: Promise<unknown> }>;
      referenced: { value: number; promise?: Promise<unknown> };
      list: readonly [Promise<unknown>, { value: number; promise?: Promise<unknown> }];
    };
    const output = readonlyCallable();

    expect(output.first).toBe(output.second);
    expect(output.first).toBe(output.list[0]);
    expect(await output.first).toBe(output.referenced);
    expect(output.referenced.promise).toBe(output.first);
    expect((await output.first).promise).toBe(output.first);
  });

  it('PH-T27c: maps repeated nested thenables once with original receiver and readonly fulfillment', async () => {
    const fulfilled = { value: 1 };
    let thenReads = 0;
    let thenReceiverMatched = false;
    const thenable = {
      // oxlint-disable-next-line unicorn/no-thenable -- PH-R27 receiver-safe nested thenable.
      get then() {
        thenReads += 1;
        return function (
          this: unknown,
          resolve: (value: unknown) => void,
          _reject: (reason: unknown) => void
        ): void {
          thenReceiverMatched = this === thenable;
          resolve(fulfilled);
        };
      }
    };
    const readonlyCallable = (await installCallable(() => ({
      first: { nested: thenable },
      second: thenable
    }))) as () => {
      first: { nested: Promise<{ value: number }> };
      second: Promise<{ value: number }>;
    };
    const output = readonlyCallable();

    expect(output.first.nested).toBe(output.second);
    const readonlyFulfilled = await output.first.nested;
    expect(readonlyFulfilled).toBe(await output.second);
    expect(() => {
      readonlyFulfilled.value = 2;
    }).toThrow('readonly');
    expect(thenReads).toBe(1);
    expect(thenReceiverMatched).toBe(true);
    expect(fulfilled.value).toBe(1);
  });

  it('PH-T27d: preserves rejected promise identity without unhandled boundary rejection', async () => {
    const rejection = new Error('round20 rejection');
    const rejected = Promise.reject(rejection);
    const readonlyCallable = (await installCallable(() => ({
      first: rejected,
      second: rejected
    }))) as () => { first: Promise<never>; second: Promise<never> };
    const output = readonlyCallable();

    expect(output.first).toBe(output.second);
    expect(output.first).toBeInstanceOf(Promise);
    await expect(output.first).rejects.toBe(rejection);
    await expect(output.second).rejects.toBe(rejection);
  });

  it('PH-T27e: preserves hostile then getter and invocation errors exactly', async () => {
    const getterError = new Error('round20 then getter');
    const callError = new Error('round20 then call');
    let callReads = 0;
    // oxlint-disable-next-line unicorn/no-thenable -- PH-R27 getter error boundary.
    const getterFailure = Object.defineProperty({}, 'then', {
      configurable: true,
      get: () => {
        throw getterError;
      }
    });
    const callFailure = {
      // oxlint-disable-next-line unicorn/no-thenable -- PH-R27 invocation error boundary.
      get then() {
        callReads += 1;
        return function (): never {
          throw callError;
        };
      }
    };
    const readonlyCallable = (await installCallable(() => ({
      getterFailure,
      callFailure
    }))) as () => {
      getterFailure: Promise<never>;
      callFailure: Promise<never>;
    };
    const output = readonlyCallable();

    expect(output.callFailure).toBeInstanceOf(Promise);
    await expect(output.getterFailure).rejects.toBe(getterError);
    await expect(output.callFailure).rejects.toBe(callError);
    expect(callReads).toBe(1);
  });
});
