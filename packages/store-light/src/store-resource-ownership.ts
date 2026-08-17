import { createObjectLeaseRegistry, type ILeaseRegistry } from '@migaia/lifecycle';

/** Opaque object identity used as a version's lease key; never round-tripped through reactive. */
export type IVersionToken = object;

export class ResourceOwnershipRegistry<T> {
  #versionOwners: ILeaseRegistry<object> = createObjectLeaseRegistry<object>();
  #versionKeys = new Map<number, object>();
  #resourceOwners = 0;
  #versionOwnerTotal = 0;
  #epoch = 0;
  #disposedIdentities = new WeakSet<object>();

  get hasOwners(): boolean {
    return this.#resourceOwners > 0 || this.#versionOwnerTotal > 0;
  }

  get hasVersionOwners(): boolean {
    // `ILeaseRegistry` (WeakMap-backed) exposes no enumeration/`hasAny()` — this class already
    // maintains an aggregate total across every version key, so reuse it instead.
    return this.#versionOwnerTotal > 0;
  }

  get hasResourceOwners(): boolean {
    return this.#resourceOwners > 0;
  }

  versionOwnerCount(version: number): number {
    const key = this.#versionKeys.get(version);
    return key ? this.#versionOwners.count(key) : 0;
  }

  versionOwnerCountToken(token: IVersionToken): number {
    return this.#versionOwners.count(token);
  }

  retainResource(onRelease: () => void): () => void {
    this.#resourceOwners++;
    const epoch = this.#epoch;
    let active = true;
    return () => {
      if (!active || epoch !== this.#epoch) return;
      active = false;
      this.#resourceOwners--;
      onRelease();
    };
  }

  retainVersion(version: number, onRelease: () => void): () => void {
    this.#versionOwnerTotal++;
    const key = this.#versionKey(version);
    return this.#retainVersionKey(version, key, onRelease);
  }

  retainVersionToken(token: IVersionToken, onRelease: () => void): () => void {
    this.#versionOwnerTotal++;
    return this.#retainVersionKey(undefined, token, onRelease);
  }

  #retainVersionKey(version: number | undefined, key: object, onRelease: () => void): () => void {
    const releaseVersion = this.#versionOwners.retain(key);
    const epoch = this.#epoch;
    let active = true;
    return () => {
      if (!active || epoch !== this.#epoch) return;
      active = false;
      this.#versionOwnerTotal--;
      releaseVersion();
      if (version !== undefined && this.#versionOwners.count(key) === 0)
        this.#versionKeys.delete(version);
      onRelease();
    };
  }

  isDisposed(value: T): boolean {
    return this.#isReference(value) && this.#disposedIdentities.has(value as object);
  }

  markDisposed(value: T): void {
    if (this.#isReference(value)) this.#disposedIdentities.add(value as object);
  }

  forceReset(): void {
    this.#epoch++;
    this.#resourceOwners = 0;
    this.#versionOwnerTotal = 0;
    // `ILeaseRegistry` has no bulk `clear()` — bumping `#epoch` already makes every outstanding
    // release closure a permanent no-op (guarded above), and dropping the version→key map below
    // makes the old key objects unreachable from here, so the WeakMap-backed registry sheds those
    // entries on its own; no explicit registry reset is needed.
    this.#versionKeys.clear();
  }

  #versionKey(version: number): object {
    let key = this.#versionKeys.get(version);
    if (!key) {
      key = {};
      this.#versionKeys.set(version, key);
    }
    return key;
  }

  #isReference(value: T): boolean {
    return value !== null && (typeof value === 'object' || typeof value === 'function');
  }
}
