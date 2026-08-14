import type { ResourceVersion } from './store-resource-state';

/** Owns all non-visible versions until they are adopted or released. */
export class ResourceVersionRegistry<T> {
  #stale: ResourceVersion<T> | undefined;
  #retired = new Map<number, ResourceVersion<T>>();
  #superseded: T[] = [];
  #closing = new Map<number, ResourceVersion<T>>();

  get stale(): ResourceVersion<T> | undefined {
    return this.#stale;
  }
  /** True while non-visible values still need final ownership resolution. */
  get hasPending(): boolean {
    return (
      this.#stale !== undefined ||
      this.#retired.size > 0 ||
      this.#superseded.length > 0 ||
      this.#closing.size > 0
    );
  }
  setStale(version: ResourceVersion<T>): void {
    this.#stale = version;
  }
  takeStale(): ResourceVersion<T> | undefined {
    const stale = this.#stale;
    this.#stale = undefined;
    return stale;
  }

  retire(version: ResourceVersion<T>): void {
    this.#retired.set(version.id, version);
  }
  hasRetired(id: number): boolean {
    return this.#retired.has(id);
  }
  retiredIds(): Iterable<number> {
    return this.#retired.keys();
  }
  takeRetired(id: number): ResourceVersion<T> | undefined {
    const version = this.#retired.get(id);
    this.#retired.delete(id);
    return version;
  }
  retiredValues(): T[] {
    return [...this.#retired.values()].map((version) => version.value);
  }

  addSuperseded(value: T): void {
    this.#superseded.push(value);
  }
  takeSuperseded(): T[] {
    const values = this.#superseded;
    this.#superseded = [];
    return values;
  }

  beginClosing(values: ResourceVersion<T>[]): void {
    for (const value of values) this.#closing.set(value.id, value);
  }
  takeClosing(id: number): ResourceVersion<T> | undefined {
    const value = this.#closing.get(id);
    this.#closing.delete(id);
    return value;
  }
  hasClosing(id: number): boolean {
    return this.#closing.has(id);
  }
  has(id: number): boolean {
    return this.#stale?.id === id || this.#retired.has(id) || this.#closing.has(id);
  }

  holds(value: T): boolean {
    return (
      [...this.#closing.values()].some((item) => Object.is(item.value, value)) ||
      this.#superseded.some((item) => Object.is(item, value)) ||
      (this.#stale !== undefined && Object.is(this.#stale.value, value)) ||
      [...this.#retired.values()].some((version) => Object.is(version.value, value))
    );
  }

  clear(): T[] {
    const values = [...this.#closing.values()].map((item) => item.value);
    values.push(
      ...this.#superseded,
      ...this.retiredValues(),
      ...(this.#stale ? [this.#stale.value] : [])
    );
    this.#closing.clear();
    this.#superseded = [];
    this.#retired.clear();
    this.#stale = undefined;
    return values;
  }

  moveToClosing(): { versions: ResourceVersion<T>[]; superseded: T[] } {
    const values = [
      ...this.#closing.values(),
      ...this.#retired.values(),
      ...(this.#stale ? [this.#stale] : [])
    ];
    const superseded = this.#superseded;
    this.#closing.clear();
    this.#retired.clear();
    this.#stale = undefined;
    this.#superseded = [];
    return { versions: values, superseded };
  }
}
