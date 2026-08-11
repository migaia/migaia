import { tupleKey } from './safe-value';

/** Owns verified source bindings and issues opaque per-binding tokens. */
export class VerifiedPeerRegistry {
  readonly #bindings = new Map<
    string,
    {
      readonly token: string;
      readonly origin: string;
      readonly verifiedAt: number;
      readonly refs: number;
    }
  >();
  readonly #maxBindings: number;
  readonly #maxBindingsPerOrigin: number;
  readonly #maxBindingAgeMs: number;
  #nextToken = 0;

  constructor(maxBindings = 1024, maxBindingsPerOrigin = 128, maxBindingAgeMs = 300_000) {
    if (
      !Number.isSafeInteger(maxBindings) ||
      maxBindings < 1 ||
      !Number.isSafeInteger(maxBindingsPerOrigin) ||
      maxBindingsPerOrigin < 1 ||
      !Number.isSafeInteger(maxBindingAgeMs) ||
      maxBindingAgeMs < 1
    )
      throw new TypeError('binding limits must be positive safe integers');
    this.#maxBindings = maxBindings;
    this.#maxBindingsPerOrigin = maxBindingsPerOrigin;
    this.#maxBindingAgeMs = maxBindingAgeMs;
  }

  /** Returns the stable opaque token for one authenticated source binding. */
  register(
    senderId: string,
    peerId?: string,
    origin?: string,
    sourceToken?: string
  ): string | false {
    const binding = tupleKey(senderId, peerId ?? '', origin ?? '', sourceToken ?? '');
    const existing = this.#bindings.get(binding);
    if (existing) {
      this.#bindings.set(binding, { ...existing, verifiedAt: Date.now() });
      return existing.token;
    }
    const bindingOrigin = origin ?? '';
    this.#purgeExpired();
    const originEntries = [...this.#bindings.entries()].filter(
      ([, entry]) => entry.origin === bindingOrigin
    );
    if (
      originEntries.length >= this.#maxBindingsPerOrigin ||
      this.#bindings.size >= this.#maxBindings
    )
      return false;
    const token = `verified-peer-${++this.#nextToken}`;
    this.#bindings.set(binding, { token, origin: bindingOrigin, verifiedAt: Date.now(), refs: 0 });
    return token;
  }

  /** Retains a verified identity while an active operation uses it. */
  retain(token: string): boolean {
    for (const [key, entry] of this.#bindings) {
      if (entry.token !== token) continue;
      this.#bindings.set(key, { ...entry, refs: entry.refs + 1 });
      return true;
    }
    return false;
  }

  /** Releases one active-operation identity lease. */
  release(token: string): void {
    for (const [key, entry] of this.#bindings) {
      if (entry.token !== token) continue;
      this.#bindings.set(key, { ...entry, refs: Math.max(0, entry.refs - 1) });
      return;
    }
  }

  /** Returns whether a sender has an authenticated binding for this source. */
  has(senderId: string, peerId?: string, origin?: string, sourceToken?: string): boolean {
    const binding = tupleKey(senderId, peerId ?? '', origin ?? '', sourceToken ?? '');
    const entry = this.#bindings.get(binding);
    if (!entry) return false;
    if (entry.refs === 0 && Date.now() - entry.verifiedAt >= this.#maxBindingAgeMs) {
      this.#bindings.delete(binding);
      return false;
    }
    return true;
  }

  /** Clears source bindings during endpoint disposal. */
  clear(): void {
    this.#bindings.clear();
  }

  #purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.#bindings)
      if (entry.refs === 0 && now - entry.verifiedAt >= this.#maxBindingAgeMs)
        this.#bindings.delete(key);
  }
}
