import { describe, expect, it } from 'vitest';
import { PluginHost } from '../src/host-runtime.js';

type IPrototypeOrder = 'child-first' | 'root-first';

class Host extends PluginHost<Record<string, never>> {}

/** Build an ordinary object whose custom prototype points back to its owning object. */
const createConfig = (order: IPrototypeOrder): Record<string, unknown> => {
  const ancestor = { value: 11 };
  const prototype: Record<PropertyKey, any> = {};
  const child: Record<PropertyKey, any> = Object.create(prototype);
  const deep: Record<PropertyKey, any> = { child, prototype };

  child.value = 7;
  child.deep = deep;
  deep.back = child;
  prototype.child = child;
  prototype.deep = deep;
  prototype.self = prototype;
  prototype.ancestor = ancestor;

  const config = (
    order === 'child-first'
      ? { child, childAlias: child, ancestor, ancestorAlias: ancestor, stable: { value: 1 } }
      : { ancestor, ancestorAlias: ancestor, child, childAlias: child, stable: { value: 1 } }
  ) as Record<string, unknown>;
  config.self = config;
  prototype.root = config;
  return config;
};

/** Admit one Round29 config and return its host for snapshot/update assertions. */
const installConfig = async (
  name: string,
  config: Record<string, unknown>,
  update?: () => void
): Promise<Host> => {
  const host = new Host();
  await host.use({ name, config, install: () => ({}), update } as never);
  return host;
};

describe('PH-R39: ordinary prototype shell registration', () => {
  it('PH-T39a: admission registers ordinary shells before prototype traversal in both property orders', async () => {
    for (const order of ['child-first', 'root-first'] as const) {
      const config = createConfig(order);
      const host = await installConfig(`round29-${order}`, config);
      const root: any = host.config.get(`round29-${order}`);
      const child: any = root.child;
      const prototype: any = Object.getPrototypeOf(child);

      expect(root.childAlias).toBe(child);
      expect(prototype).toBe(Object.getPrototypeOf(root.childAlias));
      expect(prototype.child).toBe(child);
      expect(prototype.deep.child).toBe(child);
      expect(child.deep.child).toBe(child);
      expect(child.deep.prototype).toBe(prototype);
      expect(prototype.self).toBe(prototype);
      expect(prototype.root).toBe(root);
      expect(prototype.ancestor).toBe(root.ancestor);
      expect(Object.getPrototypeOf(prototype)).toBe(Object.prototype);
      expect(Object.getOwnPropertyDescriptor(child, 'value')).toMatchObject({
        value: 7,
        enumerable: true,
        configurable: true,
        writable: true
      });
      expect(Object.getOwnPropertyDescriptor(prototype, 'child')?.value).toBe(child);
    }
  });

  it('PH-T39b: readonly prototype and nested aliases share identity and reject mutation', async () => {
    const host = await installConfig('round29-readonly', createConfig('child-first'));
    const root: any = host.config.get('round29-readonly');
    const child: any = root.child;
    const prototype: any = Object.getPrototypeOf(child);

    expect(root.childAlias).toBe(child);
    expect(prototype.child).toBe(child);
    expect(Object.getPrototypeOf(child)).toBe(Object.getPrototypeOf(root.childAlias));
    expect(() => {
      prototype.child = {};
    }).toThrow('config is readonly');
    expect(() => {
      child.deep.child = {};
    }).toThrow('config is readonly');
    expect(prototype.child).toBe(child);
  });

  it('PH-T39c: unrelated patch rebases root and ancestor prototype cycles without duplicate clones', async () => {
    const config = createConfig('root-first');
    const host = await installConfig('round29-cow', config);
    const previous: any = host.config.get('round29-cow');
    const previousChild: any = previous.child;
    const previousPrototype: any = Object.getPrototypeOf(previousChild);
    const previousStable: any = previous.stable;

    await host.config.update('round29-cow', () => ({ changed: true }));

    const next: any = host.config.get('round29-cow');
    const nextChild: any = next.child;
    const nextPrototype: any = Object.getPrototypeOf(nextChild);
    expect(next).not.toBe(previous);
    expect(nextChild).not.toBe(previousChild);
    expect(next.childAlias).toBe(nextChild);
    expect(nextPrototype.child).toBe(nextChild);
    expect(nextPrototype.deep.child).toBe(nextChild);
    expect(nextChild.deep.prototype).toBe(nextPrototype);
    expect(nextPrototype.root).toBe(next);
    expect(nextPrototype.self).toBe(nextPrototype);
    expect(next.ancestor).toBe(previous.ancestor);
    expect(next.ancestor).toBe(nextPrototype.ancestor);
    expect(next.stable).toBe(previousStable);
    expect(nextPrototype).not.toBe(previousPrototype);
    expect(next.changed).toBe(true);
  });

  it('PH-T39d: failed patch preserves prior ordinary prototype graph and published identity', async () => {
    const failure = new Error('PH-T39d update failure');
    const host = await installConfig('round29-rollback', createConfig('child-first'), () => {
      throw failure;
    });
    const previous: any = host.config.get('round29-rollback');
    const previousChild: any = previous.child;
    const previousPrototype: any = Object.getPrototypeOf(previousChild);

    await expect(host.config.update('round29-rollback', () => ({ changed: true }))).rejects.toBe(
      failure
    );

    const afterFailure: any = host.config.get('round29-rollback');
    expect(afterFailure).toBe(previous);
    expect(afterFailure.child).toBe(previousChild);
    expect(Object.getPrototypeOf(afterFailure.child)).toBe(previousPrototype);
    expect(previousPrototype.child).toBe(previousChild);
    expect(previousPrototype.root).toBe(previous);
    expect(previousPrototype.self).toBe(previousPrototype);
    expect(afterFailure.changed).toBeUndefined();
  });
});
