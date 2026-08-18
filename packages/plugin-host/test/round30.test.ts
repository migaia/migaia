import { describe, expect, it, vi } from 'vitest';
import { PluginHostErrorCode } from '../src/error-code.js';
import { PluginHost } from '../src/host-runtime.js';

type IRound30Config = Record<string, unknown>;
type IRound30Prototype = {
  root: unknown;
  self: unknown;
  stable: { nested: { value: number } };
  read(this: { value: number }): number;
};
type IRound30Error = TypeError & {
  readonly source: string;
  readonly code: string;
  readonly cause?: unknown;
};

class Host extends PluginHost<Record<string, never>> {}

/** Capture one rejected admission without changing the rejection identity. */
const captureAdmissionError = async (host: Host, plugin: unknown): Promise<IRound30Error> => {
  try {
    await host.use(plugin as never);
  } catch (error) {
    return error as IRound30Error;
  }
  throw new Error('expected plugin admission to fail');
};

describe('PH-R40: custom prototype accessor admission', () => {
  it('PH-T40a: rejects accessor closures that can retain caller roots before install', async () => {
    const config: IRound30Config = {};
    const prototype = Object.create(null) as IRound30Config;
    Object.defineProperty(prototype, 'root', {
      configurable: true,
      enumerable: true,
      get: () => config
    });
    const child = Object.create(prototype) as IRound30Config;
    config.child = child;
    config.childAlias = child;
    const priorInstall = vi.fn(() => ({}));
    const install = vi.fn(() => ({}));
    const host = new Host();

    let error: unknown;
    try {
      await host.use(
        { name: 'round30-prior', install: priorInstall } as never,
        { name: 'round30-accessor', config, install } as never
      );
    } catch (reason) {
      error = reason;
    }

    expect(priorInstall).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    expect(host.config.get('round30-accessor.child')).toBeUndefined();
    const admissionError = error as IRound30Error;
    expect(admissionError).toBeInstanceOf(TypeError);
    expect(admissionError.source).toBe('@migaia/plugin-host');
    expect(admissionError.code).toBe(PluginHostErrorCode.invalidOption);
    expect(admissionError.message).toContain('custom prototype accessors are not admitted');
    expect(admissionError.cause).toBeUndefined();
  });

  it('PH-T40b: preserves canonical TypeError code and reflection cause without partial install', async () => {
    const cause = new Error('round30 prototype inspection failure');
    const prototype = new Proxy(Object.create(null) as IRound30Config, {
      ownKeys: () => {
        throw cause;
      }
    });
    const config: IRound30Config = { child: Object.create(prototype) };
    const install = vi.fn(() => ({}));
    const host = new Host();

    const error = await captureAdmissionError(host, {
      name: 'round30-inspection',
      config,
      install
    });

    expect(install).not.toHaveBeenCalled();
    expect(host.config.get('round30-inspection.child')).toBeUndefined();
    expect(error).toBeInstanceOf(TypeError);
    expect(error.source).toBe('@migaia/plugin-host');
    expect(error.code).toBe(PluginHostErrorCode.invalidOption);
    expect(error.cause).toBe(cause);
  });
});

describe('PH-R40: custom prototype COW isolation', () => {
  it('PH-T40c: preserves root aliases, rebases owned prototype cycles, and shares stable COW nodes', async () => {
    const stable = { nested: { value: 9 } };
    const prototype: IRound30Prototype = {
      root: undefined,
      self: undefined,
      stable,
      read(this: { value: number }): number {
        return this.value;
      }
    };
    prototype.self = prototype;
    const child = Object.create(prototype) as IRound30Config & { value: number };
    child.value = 7;
    const config = {
      child,
      childAlias: child,
      stable,
      self: undefined
    } as IRound30Config;
    config.self = config;
    prototype.root = config;

    const host = new Host();
    await host.use({ name: 'round30-cow', config, install: () => ({}) } as never);
    const previous = host.config.get('round30-cow') as IRound30Config;
    const previousChild = previous.child as IRound30Config;
    const previousPrototype = Object.getPrototypeOf(previousChild) as IRound30Config;

    await host.config.update('round30-cow', () => ({ changed: true }));

    const next = host.config.get('round30-cow') as IRound30Config;
    const nextChild = next.child as IRound30Config & { read(): number };
    const nextPrototype = Object.getPrototypeOf(nextChild) as IRound30Config;

    expect(next).not.toBe(previous);
    expect(nextChild).not.toBe(previousChild);
    expect(next.childAlias).toBe(nextChild);
    expect(nextPrototype).toBe(Object.getPrototypeOf(next.childAlias));
    expect(nextPrototype).not.toBe(previousPrototype);
    expect(nextPrototype.root).toBe(next);
    expect(nextPrototype.self).toBe(nextPrototype);
    expect(nextChild.read()).toBe(7);
    expect(previousPrototype.root).toBe(previous);
    expect(previousPrototype.self).toBe(previousPrototype);
    expect(next.stable).toBe(previous.stable);
    expect((next.stable as { nested: unknown }).nested).toBe(
      (previous.stable as { nested: unknown }).nested
    );
  });
});
