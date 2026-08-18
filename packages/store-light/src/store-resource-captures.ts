import { createStoreLightError, StoreLightErrorCode } from './errors.js';
import { StoreLightErrorText } from './error-text.js';

const CAPTURES = Symbol('store-resource-captures');

/**
 * A provisional capture is the record of a Suspense render that suspended on a still-loading
 * version and never got to explicitly commit or discard it — React gives userland no "this render
 * was abandoned" callback, so nothing else will ever call `commit()`/`discard()` on it. Relying
 * solely on WeakRef/FinalizationRegistry to eventually notice bounds cleanup only by GC timing,
 * which can be arbitrarily late — in a quiet tab, effectively unbounded. This window bounds it
 * explicitly: a provisional capture still uncommitted after this long is treated as abandoned
 * regardless of whether the engine has gotten around to collecting it. Generous relative to a real
 * render→commit cycle (a single micro/macrotask), tight relative to "whenever GC feels like
 * running".
 */
const PROVISIONAL_COMMIT_WINDOW_MS = 4000;

/** Opaque render-phase protection for a resource version. */
/** Opaque capture token; version metadata remains private to the registry. */
export type IResourceCapture = object;
type ICaptureToken = {
  version?: number;
  /**
   * Set only by `resolve()`: this token started as an unbound/pending capture taken before its
   * version existed (a render that suspended on the initial load). Its owning render never got the
   * token back — it threw before the local variable could be used — so nothing can ever explicitly
   * commit or discard it. A later _direct_ `capture(version)` call is proof that some render is now
   * actively observing the settled value, so it supersedes any leftover provisional token for that
   * version. Tokens taken directly (not provisional) never supersede each other: two independent
   * renders capturing an already-ready version are peers, not successors.
   */
  provisional?: boolean;
  /** Explicit-expiry timer set alongside `provisional`; see PROVISIONAL_COMMIT_WINDOW_MS. */
  expireTimer?: ReturnType<typeof setTimeout>;
};
type ICapturableOperation = Promise<unknown> & { [CAPTURES]?: Set<ICaptureToken> };

/**
 * Render captures live on the Suspense thenable, not on a timeout while the render is still in
 * flight. React keeps that thenable while retrying suspended work; abandoned work becomes weakly
 * collectible once the thenable is no longer retained. But _provisional_ captures (see
 * `ICaptureToken.provisional`) get an explicit backstop on top of that —
 * `PROVISIONAL_COMMIT_WINDOW_MS` — because GC timing alone is not a bounded cleanup path; see its
 * doc comment.
 *
 * `onChanged` fires for both: a token actually collected (FinalizationRegistry) and a provisional
 * token explicitly expiring (the primary, bounded path). Callers should treat it purely as "recheck
 * ownership now", not as a signal about _why_ — the registry-owner side already ignores the
 * distinction.
 */
export class ResourceCaptureRegistry {
  #unbound = new Set<ICaptureToken>();
  #pending = new Map<number, Set<ICaptureToken>>();
  #captures = new WeakSet<object>();
  #committed = new WeakSet<object>();
  #byVersion = new Map<number, Array<WeakRef<object>>>();
  #finalizer: FinalizationRegistry<number>;
  #onChanged: (version: number) => void;
  #expireTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(onChanged?: (version: number) => void) {
    if (typeof WeakRef !== 'function' || typeof FinalizationRegistry !== 'function')
      throw createStoreLightError(
        StoreLightErrorCode.envUnsupported,
        StoreLightErrorText.captureRegistryWeakRef
      );
    this.#onChanged = onChanged ?? (() => undefined);
    // Leak telemetry only: by the time this fires (if it ever does), the
    // explicit PROVISIONAL_COMMIT_WINDOW_MS timer below has already retired
    // any abandoned provisional capture. This is not load-bearing for
    // correctness or for bounding cleanup latency.
    this.#finalizer = new FinalizationRegistry(this.#onChanged);
  }

  capture(version?: number): IResourceCapture | ICaptureToken {
    const token: ICaptureToken = version === undefined ? {} : { version };
    this.#captures.add(token);
    this.#finalizer.register(token, version ?? -1, token);
    if (version === undefined) this.#unbound.add(token);
    else {
      this.#supersedeProvisional(version);
      this.#track(version, token);
    }
    return token as IResourceCapture;
  }

  bind(generation: number, operation: Promise<unknown>): void {
    const tokens = this.#pending.get(generation) ?? new Set<ICaptureToken>();
    for (const token of this.#unbound) tokens.add(token);
    this.#unbound.clear();
    this.#pending.set(generation, tokens);
    (operation as ICapturableOperation)[CAPTURES] = tokens;
  }

  capturePending(generation: number, operation: Promise<unknown>): IResourceCapture {
    const token = this.capture() as ICaptureToken;
    this.#unbound.delete(token);
    const tokens = this.#pending.get(generation) ?? new Set<ICaptureToken>();
    tokens.add(token);
    this.#pending.set(generation, tokens);
    (operation as ICapturableOperation)[CAPTURES] = tokens;
    return token as IResourceCapture;
  }

  resolve(generation: number, version: number): void {
    const tokens = this.#pending.get(generation);
    this.#pending.delete(generation);
    if (!tokens) return;
    for (const token of tokens) {
      token.version = version;
      token.provisional = true;
      this.#finalizer.unregister(token);
      this.#finalizer.register(token, version, token);
      this.#track(version, token);
      this.#scheduleProvisionalExpiry(token, version);
    }
  }

  /**
   * Bounded, explicit backstop for an abandoned provisional capture — the primary cleanup path;
   * FinalizationRegistry is telemetry-only (see class doc comment). Fires `onChanged` the same way
   * GC collection would, so callers don't need to know which path actually retired the token.
   */
  #scheduleProvisionalExpiry(token: ICaptureToken, version: number): void {
    const timer = setTimeout(() => {
      this.#expireTimers.delete(timer);
      if (!token.provisional || !this.#captures.has(token) || this.#committed.has(token)) {
        return;
      }
      this.#captures.delete(token);
      this.#finalizer.unregister(token);
      this.#onChanged(version);
    }, PROVISIONAL_COMMIT_WINDOW_MS);
    // Node/tests must not be kept alive by a housekeeping timer.
    (timer as unknown as { unref?: () => void }).unref?.();
    this.#expireTimers.add(timer);
    token.expireTimer = timer;
  }

  #cancelProvisionalExpiry(token: ICaptureToken): void {
    if (token.expireTimer === undefined) return;
    clearTimeout(token.expireTimer);
    this.#expireTimers.delete(token.expireTimer);
    token.expireTimer = undefined;
  }

  discard(generation: number): void {
    const tokens = this.#pending.get(generation);
    if (!tokens) return;
    this.#pending.delete(generation);
    for (const token of tokens) this.#finalizer.unregister(token);
  }

  inspect(token: IResourceCapture): number {
    const captured = token as ICaptureToken;
    if (!this.#captures.has(token) || this.#committed.has(token) || captured.version === undefined)
      throw createStoreLightError(
        StoreLightErrorCode.captureInvalid,
        StoreLightErrorText.invalidCapture
      );
    return captured.version;
  }

  commit(token: IResourceCapture): number {
    const version = this.inspect(token);
    this.#committed.add(token);
    this.#finalizer.unregister(token);
    this.#cancelProvisionalExpiry(token as ICaptureToken);
    return version;
  }

  has(version: number): boolean {
    const references = this.#byVersion.get(version);
    if (!references) return false;
    const live = references.filter((reference) => {
      const token = reference.deref();
      return token !== undefined && this.#captures.has(token) && !this.#committed.has(token);
    });
    if (live.length === 0) this.#byVersion.delete(version);
    else this.#byVersion.set(version, live);
    return live.length > 0;
  }
  hasAny(): boolean {
    // Pending observations only keep a Suspense operation associated with its
    // generation. They are not value leases: an abandoned, never-settling
    // promise must not keep a closing resource alive forever.
    //
    // `has()` already excludes committed tokens per-token (its filter drops
    // anything in `#committed`). A version-level `#committedVersions` set
    // used to short-circuit this check per version instead of per token: the
    // moment any one capture for a version committed, every other
    // still-uncommitted capture for that same version stopped counting as a
    // reservation too. Two concurrent renders capturing the same version,
    // one committing before the other, would let the resource think it had
    // no owners and dispose the value the second render was still waiting
    // to commit against.
    return (
      this.#unbound.size > 0 || [...this.#byVersion.keys()].some((version) => this.has(version))
    );
  }
  clear(): void {
    this.#unbound.clear();
    this.#pending.clear();
    this.#byVersion.clear();
    this.#captures = new WeakSet();
    this.#committed = new WeakSet();
    for (const timer of this.#expireTimers) clearTimeout(timer);
    this.#expireTimers.clear();
  }
  #track(version: number, token: object): void {
    const list = this.#byVersion.get(version) ?? [];
    list.push(new WeakRef(token));
    this.#byVersion.set(version, list);
  }
  /**
   * Discard leftover provisional (resolve()-originated, still-uncommitted) captures for a version.
   * Never touches directly-taken captures — those are peers, not predecessors, and must keep
   * coexisting until each is individually committed or discarded.
   */
  #supersedeProvisional(version: number): void {
    const references = this.#byVersion.get(version);
    if (!references) return;
    const survivors: WeakRef<object>[] = [];
    for (const reference of references) {
      const token = reference.deref() as ICaptureToken | undefined;
      if (token === undefined) continue;
      if (!token.provisional || this.#committed.has(token)) {
        survivors.push(reference);
        continue;
      }
      this.#captures.delete(token);
      this.#finalizer.unregister(token);
      this.#cancelProvisionalExpiry(token);
    }
    if (survivors.length === 0) this.#byVersion.delete(version);
    else this.#byVersion.set(version, survivors);
  }
}
