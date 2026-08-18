import { describe, expect, it } from 'vitest';
import { PluginHost } from '../src/host-runtime.js';

class Host extends PluginHost<Record<string, never>> {}

class PrototypeDate extends Date {
  readTime(): number {
    return this.getTime();
  }
}

class PrototypeRegExp extends RegExp {
  readSource(): string {
    return this.source;
  }
}

class PrototypeMap extends Map<string, number> {
  readValue(): number | undefined {
    return this.get('value');
  }
}

class PrototypeSet extends Set<string> {
  hasValue(): boolean {
    return this.has('value');
  }
}

/** Install config and return its readonly root for prototype-boundary assertions. */
const installConfig = async (config: Record<string, unknown>): Promise<any> => {
  const host = new Host();
  await host.use({ name: 'round25', config, install: () => ({}) } as never);
  return host.config.get('round25');
};

/** Return one callable output through the readonly boundary for branded output checks. */
const installCallableOutput = async (value: unknown): Promise<any> => {
  const host = new Host();
  await host.use({
    name: 'round25-output',
    config: { value: () => value },
    install: () => ({})
  } as never);
  return (host.config.get('round25-output.value') as () => unknown)();
};

describe('PH-R35: branded subclass prototype ownership', () => {
  it('PH-T35a: Date and RegExp subclasses own custom prototype graphs without losing intrinsic semantics', async () => {
    const shared = { value: 1 };
    const datePrototype = PrototypeDate.prototype as PrototypeDate & {
      nested?: typeof shared;
      self?: unknown;
    };
    const regexpPrototype = PrototypeRegExp.prototype as PrototypeRegExp & {
      nested?: typeof shared;
      self?: unknown;
    };
    datePrototype.nested = shared;
    datePrototype.self = datePrototype;
    regexpPrototype.nested = shared;
    regexpPrototype.self = regexpPrototype;
    const date = new PrototypeDate(0);
    const regexp = new PrototypeRegExp('value', 'g');

    const root = await installConfig({ date, dateAlias: date, regexp, regexpAlias: regexp });
    const dateView: any = root.date;
    const regexpView: any = root.regexp;
    const dateReadonlyPrototype: any = Object.getPrototypeOf(dateView);
    const regexpReadonlyPrototype: any = Object.getPrototypeOf(regexpView);

    expect(dateView).toBe(root.dateAlias);
    expect(regexpView).toBe(root.regexpAlias);
    expect(dateReadonlyPrototype).not.toBe(PrototypeDate.prototype);
    expect(regexpReadonlyPrototype).not.toBe(PrototypeRegExp.prototype);
    expect(dateReadonlyPrototype).toBe(Object.getPrototypeOf(dateView));
    expect(regexpReadonlyPrototype).toBe(Object.getPrototypeOf(regexpView));
    expect(dateReadonlyPrototype.self).toBe(dateReadonlyPrototype);
    expect(regexpReadonlyPrototype.self).toBe(regexpReadonlyPrototype);
    expect(dateReadonlyPrototype.nested).toBe(regexpReadonlyPrototype.nested);
    expect(dateView).toBeInstanceOf(Date);
    expect(regexpView).toBeInstanceOf(RegExp);
    expect(dateView.getTime()).toBe(0);
    expect(regexpView.readSource()).toBe('value');
    expect(() => {
      dateReadonlyPrototype.nested.value = 2;
    }).toThrow('config is readonly');

    shared.value = 3;
    expect(dateReadonlyPrototype.nested.value).toBe(1);
    expect(regexpReadonlyPrototype.nested.value).toBe(1);
    expect(() => dateView.setTime(1)).toThrow('config is readonly');
  });

  it('PH-T35b: Map and Set subclasses own custom prototype graphs while native readers keep brand semantics', async () => {
    const shared = { value: 1 };
    const mapPrototype = PrototypeMap.prototype as PrototypeMap & {
      nested?: typeof shared;
      self?: unknown;
    };
    const setPrototype = PrototypeSet.prototype as PrototypeSet & {
      nested?: typeof shared;
      self?: unknown;
    };
    mapPrototype.nested = shared;
    mapPrototype.self = mapPrototype;
    setPrototype.nested = shared;
    setPrototype.self = setPrototype;
    const map = new PrototypeMap([['value', 1]]);
    const set = new PrototypeSet(['value']);

    const root = await installConfig({ map, mapAlias: map, set, setAlias: set });
    const mapView: any = root.map;
    const setView: any = root.set;
    const mapReadonlyPrototype: any = Object.getPrototypeOf(mapView);
    const setReadonlyPrototype: any = Object.getPrototypeOf(setView);

    expect(mapView).toBe(root.mapAlias);
    expect(setView).toBe(root.setAlias);
    expect(mapReadonlyPrototype).not.toBe(PrototypeMap.prototype);
    expect(setReadonlyPrototype).not.toBe(PrototypeSet.prototype);
    expect(mapReadonlyPrototype.self).toBe(mapReadonlyPrototype);
    expect(setReadonlyPrototype.self).toBe(setReadonlyPrototype);
    expect(mapReadonlyPrototype.nested).toBe(setReadonlyPrototype.nested);
    expect(mapView).toBeInstanceOf(Map);
    expect(setView).toBeInstanceOf(Set);
    expect(mapView.readValue()).toBe(1);
    expect(setView.hasValue()).toBe(true);
    expect(mapView.get('value')).toBe(1);
    expect(setView.has('value')).toBe(true);
    expect(() => {
      mapReadonlyPrototype.nested.value = 2;
    }).toThrow('config is readonly');

    shared.value = 3;
    expect(mapReadonlyPrototype.nested.value).toBe(1);
    expect(setReadonlyPrototype.nested.value).toBe(1);
    expect(() => mapView.set('other', 2)).toThrow('config is readonly');
    expect(() => setView.add('other')).toThrow('config is readonly');
  });

  it('PH-T35c: branded callable outputs use readonly custom prototype facades without raw prototype leaks', async () => {
    const date = new PrototypeDate(0);
    const regexp = new PrototypeRegExp('value');
    const map = new PrototypeMap([['value', 1]]);
    const set = new PrototypeSet(['value']);
    const output: any = await installCallableOutput({ date, regexp, map, set });

    expect(Object.getPrototypeOf(output.date)).not.toBe(PrototypeDate.prototype);
    expect(Object.getPrototypeOf(output.regexp)).not.toBe(PrototypeRegExp.prototype);
    expect(Object.getPrototypeOf(output.map)).not.toBe(PrototypeMap.prototype);
    expect(Object.getPrototypeOf(output.set)).not.toBe(PrototypeSet.prototype);
    expect(output.date).toBeInstanceOf(Date);
    expect(output.regexp).toBeInstanceOf(RegExp);
    expect(output.map).toBeInstanceOf(Map);
    expect(output.set).toBeInstanceOf(Set);
    expect(output.date.getTime()).toBe(0);
    expect(output.regexp.readSource()).toBe('value');
    expect(output.map.readValue()).toBe(1);
    expect(output.set.hasValue()).toBe(true);
    expect(() => output.map.set('other', 2)).toThrow('config is readonly');
    expect(() => output.set.add('other')).toThrow('config is readonly');
  });
});
