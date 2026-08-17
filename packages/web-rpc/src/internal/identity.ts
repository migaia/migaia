import { tupleKey } from './safe-value.js';
import { tagWebRpcError, WebRpcErrorCode } from '../errors.js';

/** Owns verified source bindings and issues unique, non-cryptographic identifiers. */
export class VerifiedPeerRegistry {
  readonly #bindings = new Map<
    string,
    {
      readonly token: string;
      readonly origin: string;
      readonly createdAt: number;
      readonly verifiedAt: number;
      readonly refs: number;
    }
  >();
  readonly #maxBindings: number;
  readonly #maxBindingsPerOrigin: number;
  readonly #maxBindingAgeMs: number;
  readonly #maxBindingLifetimeMs: number;
  #nextToken = 0;

  constructor(maxBindings = 1024, maxBindingsPerOrigin = 128, maxBindingAgeMs = 300_000) {
    if (
      !Number.isSafeInteger(maxBindings) ||
      maxBindings < 1 ||
      !Number.isSafeInteger(maxBindingsPerOrigin) ||
      maxBindingsPerOrigin < 1 ||
      !Number.isSafeInteger(maxBindingAgeMs) ||
      maxBindingAgeMs < 1 ||
      maxBindingAgeMs > Number.MAX_SAFE_INTEGER / 100
    )
      throw tagWebRpcError(
        new TypeError('binding limits must be positive safe integers'),
        WebRpcErrorCode.invalidConfig
      );
    this.#maxBindings = maxBindings;
    this.#maxBindingsPerOrigin = maxBindingsPerOrigin;
    this.#maxBindingAgeMs = maxBindingAgeMs;
    this.#maxBindingLifetimeMs = maxBindingAgeMs * 100;
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
      const now = Date.now();
      if (now - existing.createdAt < this.#maxBindingLifetimeMs) {
        this.#bindings.set(binding, { ...existing, verifiedAt: now });
        return existing.token;
      }
      this.#bindings.delete(binding);
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
    const token = `verified-peer-${++this.#nextToken}-${Math.random().toString(36).slice(2)}`;
    const now = Date.now();
    this.#bindings.set(binding, {
      token,
      origin: bindingOrigin,
      createdAt: now,
      verifiedAt: now,
      refs: 0
    });
    return token;
  }

  /**
   * Retains a verified identity while an active operation uses it. Looks up the exact token before
   * purging: an active retain must win over the same token's own idle-age purge — with a short
   * `maxBindingAgeMs`, purging first could delete the binding this very call is about to retain
   * (register() then retain() a few ms apart is enough to trigger it). Only purge as housekeeping
   * when the token was not found, so other genuinely stale entries still get swept.
   *
   * The hard lifetime cap is a different axis and is not subject to that race (it is measured from
   * `createdAt`, fixed at registration, not from the idle-tracking `verifiedAt`): a retain must
   * never revive a binding past `#maxBindingLifetimeMs`, or the cap `has()`/`#purgeExpired()`
   * enforce becomes bypassable simply by calling retain() directly instead of going through `has()`
   * first — see WR-R3-1 in docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md.
   */
  retain(token: string): boolean {
    const now = Date.now();
    for (const [key, entry] of this.#bindings) {
      if (entry.token !== token) continue;
      if (now - entry.createdAt >= this.#maxBindingLifetimeMs) {
        this.#bindings.delete(key);
        return false;
      }
      this.#bindings.set(key, { ...entry, refs: entry.refs + 1 });
      return true;
    }
    this.#purgeExpired();
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
    const now = Date.now();
    if (
      now - entry.createdAt >= this.#maxBindingLifetimeMs ||
      (entry.refs === 0 && now - entry.verifiedAt >= this.#maxBindingAgeMs)
    ) {
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
      if (
        now - entry.createdAt >= this.#maxBindingLifetimeMs ||
        (entry.refs === 0 && now - entry.verifiedAt >= this.#maxBindingAgeMs)
      )
        this.#bindings.delete(key);
  }
}
