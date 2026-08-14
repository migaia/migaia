import { ObjectLeaseRegistry } from '@migaia/reactive/runtime/lifecycle-primitives';
import type { VersionToken } from '@migaia/reactive/runtime/lifecycle-primitives';

export class ResourceOwnershipRegistry<T> {
  #versionOwners = new ObjectLeaseRegistry<object>();
  #versionKeys = new Map<number, object>();
  #resourceOwners = 0;
  #versionOwnerTotal = 0;
  #epoch = 0;
  #disposedIdentities = new WeakSet<object>();

  get hasOwners(): boolean {
    return this.#resourceOwners > 0 || this.#versionOwnerTotal > 0;
  }

  get hasVersionOwners(): boolean {
    return this.#versionOwners.hasAny();
  }

  get hasResourceOwners(): boolean {
    return this.#resourceOwners > 0;
  }

  versionOwnerCount(version: number): number {
    const key = this.#versionKeys.get(version);
    return key ? this.#versionOwners.count(key) : 0;
  }

  versionOwnerCountToken(token: VersionToken): number {
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

  retainVersionToken(token: VersionToken, onRelease: () => void): () => void {
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
    this.#versionOwners.clear();
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
