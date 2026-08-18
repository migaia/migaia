import { describe, expect, it } from 'vitest';
import { PluginHost } from '../src/host-runtime.js';

class Host extends PluginHost<Record<string, never>> {}

/** Install one public plugin config and optionally make its update hook fail. */
const installConfig = async (
  config: Record<string, unknown>,
  update?: () => void
): Promise<Host> => {
  const host = new Host();
  await host.use({ name: 'round27', config, install: () => ({}), update } as never);
  return host;
};

describe('PH-R37: callable custom [[Prototype]] ownership and COW', () => {
  it('PH-T37a: public admission owns callable [[Prototype]] and preserves readonly/call/construct semantics', async () => {
    const parentValue = { value: 1 };
    const callableParent: Record<PropertyKey, unknown> = {
      inherited: parentValue,
      self: undefined
    };
    callableParent.self = callableParent;
    const callable = function (this: { value?: number }, value: number): object {
      this.value = value;
      return this;
    };
    callable.prototype.read = function (this: { value?: number }): number | undefined {
      return this.value;
    };
    Object.setPrototypeOf(callable, callableParent);
    const config: Record<string, unknown> = { callable };

    const host = await installConfig(config);
    const readonlyConfig: any = host.config.get('round27');
    const readonlyCallable: any = readonlyConfig.callable;
    const readonlyParent: any = Object.getPrototypeOf(readonlyCallable);

    expect(readonlyParent).not.toBe(callableParent);
    expect(Object.getPrototypeOf(readonlyCallable)).toBe(readonlyParent);
    expect(readonlyParent.self).toBe(readonlyParent);
    expect(readonlyParent.inherited.value).toBe(1);
    expect(() => {
      readonlyParent.inherited.value = 2;
    }).toThrow('config is readonly');
    expect(callableParent.inherited).toBe(parentValue);
    expect(parentValue.value).toBe(1);

    const receiver: { value?: number } = {};
    expect(Reflect.apply(readonlyCallable, receiver, [3])).toEqual({ value: 3 });
    const instance: any = new readonlyCallable(4);
    expect(instance.value).toBe(4);
    expect(instance.read()).toBe(4);
    expect(instance instanceof readonlyCallable).toBe(true);
    expect(readonlyCallable.prototype).not.toBe(callable.prototype);
    expect(Object.getPrototypeOf(instance)).not.toBe(Object.getPrototypeOf(readonlyCallable));
  });

  it('PH-T37b: unrelated successful patch rebases callable [[Prototype]] root edges and shares stable nodes', async () => {
    const ancestor = { value: 11 };
    const stable = { nested: { value: 1 } };
    const callableParent: Record<PropertyKey, unknown> = {
      root: undefined,
      ancestor,
      self: undefined
    };
    callableParent.self = callableParent;
    const callable = function (): number {
      return 7;
    };
    Object.setPrototypeOf(callable, callableParent);
    const config: Record<string, unknown> = {
      callable,
      callableAlias: callable,
      ancestor,
      ancestorAlias: ancestor,
      stable,
      unrelated: { changed: false },
      self: undefined
    };
    config.self = config;
    callableParent.root = config;

    const host = await installConfig(config);
    const previous: any = host.config.get('round27');
    const previousCallableParent: any = Object.getPrototypeOf(previous.callable);
    await host.config.update('round27', () => ({ unrelated: { changed: true } }));
    const next: any = host.config.get('round27');
    const nextCallableParent: any = Object.getPrototypeOf(next.callable);

    expect(next).not.toBe(previous);
    expect(next.callable).not.toBe(previous.callable);
    expect(next.callable).toBe(next.callableAlias);
    expect(nextCallableParent).not.toBe(previousCallableParent);
    expect(nextCallableParent).toBe(Object.getPrototypeOf(next.callableAlias));
    expect(nextCallableParent.root).toBe(next);
    expect(nextCallableParent.ancestor).toBe(next.ancestor);
    expect(nextCallableParent.self).toBe(nextCallableParent);
    expect(next.self).toBe(next);
    expect(next.ancestor).toBe(previous.ancestor);
    expect(next.ancestor).toBe(next.ancestorAlias);
    expect(next.stable).toBe(previous.stable);
    expect(next.stable.nested).toBe(previous.stable.nested);
    expect(next.callable()).toBe(7);
    expect(() => {
      nextCallableParent.ancestor.value = 12;
    }).toThrow('config is readonly');
  });

  it('PH-T37c: failed update rolls back callable [[Prototype]] graph and published identity', async () => {
    const failure = new Error('PH-T37c update failure');
    const callableParent: Record<PropertyKey, unknown> = {
      root: undefined,
      self: undefined
    };
    callableParent.self = callableParent;
    const callable = () => 7;
    Object.setPrototypeOf(callable, callableParent);
    const config: Record<string, unknown> = { callable, self: undefined, value: 1 };
    config.self = config;
    callableParent.root = config;

    const host = await installConfig(config, () => {
      throw failure;
    });
    const previous: any = host.config.get('round27');
    const previousCallableParent: any = Object.getPrototypeOf(previous.callable);

    await expect(host.config.update('round27', () => ({ value: 2 }))).rejects.toBe(failure);

    const afterFailure: any = host.config.get('round27');
    expect(afterFailure).toBe(previous);
    expect(Object.getPrototypeOf(afterFailure.callable)).toBe(previousCallableParent);
    expect(previousCallableParent.root).toBe(previous);
    expect(previousCallableParent.self).toBe(previousCallableParent);
    expect(afterFailure.value).toBe(1);
    expect(afterFailure.callable()).toBe(7);
  });
});
