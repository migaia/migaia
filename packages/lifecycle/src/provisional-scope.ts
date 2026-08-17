import type { ILifecycleOwner, IReleaseDescriptor } from './types.js';
import { ASYNC_OWNER_BRAND } from './types.js';
import { createLifecycleError, tagLifecycleError } from './errors.js';
import { LifecycleErrorCode } from './error-code.js';
import { createDisposeTransaction } from './dispose-transaction.js';
import { createAbortController, type IAbortSignal } from './abort.js';
import {
  DisposeTransactionKind,
  LifecycleErrorPolicy,
  ProvisionalScopeState
} from './state-constants.js';

export type IProvisionalScopeOptions = {
  /** Forwarded so `signal` also reflects a parent's abort (e.g. a superseded generation). */
  readonly parentSignal?: IAbortSignal;
};

export type IProvisionalScope = {
  readonly signal: IAbortSignal;
  own<T>(resource: T, descriptor: IReleaseDescriptor): T;
  /**
   * Transfers every owned resource to `parent`, in registration order. If `parent.own()` rejects
   * partway (e.g. `parent` is already closing), everything already transferred stays with `parent`;
   * everything not yet transferred is released by this scope (in reverse order) and **awaited**
   * before the original error is rethrown — nothing is left owned by neither side, and the returned
   * Promise settles only after the compensation has completed.
   */
  commitTo(parent: ILifecycleOwner): Promise<void>;
  /**
   * Releases every owned resource in reverse order, collecting every failure into one
   * `AggregateError` (idempotent).
   */
  rollback(): Promise<void>;
};

type IEntry = {
  readonly resource: unknown;
  readonly source: string;
  readonly descriptor: IReleaseDescriptor;
};

/**
 * A two-phase ownership transaction for async `setup()` work: resources accumulate here first, then
 * either move to a real owner via prefix transfer + awaited compensation (`commitTo`) or get torn
 * down (`rollback`) — never both, never neither (§4.9).
 */
export function createProvisionalScope(options: IProvisionalScopeOptions = {}): IProvisionalScope {
  const controller = createAbortController();
  const forwardAbort = (): void => controller.abort(options.parentSignal?.reason);
  const detachParent = (): void => options.parentSignal?.removeEventListener('abort', forwardAbort);
  if (options.parentSignal?.aborted) controller.abort(options.parentSignal.reason);
  else options.parentSignal?.addEventListener('abort', forwardAbort, { once: true });

  let entries: IEntry[] = [];
  let nextId = 0;
  let state: (typeof ProvisionalScopeState)[keyof typeof ProvisionalScopeState] =
    ProvisionalScopeState.pending;
  /** 唯一 settle 事实：并发第二次 rollback / commit 补偿都复用，避免「提前完成」的伪幂等。 */
  let rollbackPromise: Promise<void> | undefined;

  const assertPending = (): void => {
    if (state !== ProvisionalScopeState.pending) {
      throw createLifecycleError(
        LifecycleErrorCode.provisionalSettled,
        '[lifecycle] provisional scope has already committed or rolled back'
      );
    }
  };

  const own = <T>(resource: T, descriptor: IReleaseDescriptor): T => {
    assertPending();
    entries.push({ resource, source: String(nextId++), descriptor });
    return resource;
  };

  const releaseEntries = async (list: readonly IEntry[]): Promise<void> => {
    if (list.length === 0) return;
    const transaction = createDisposeTransaction(
      { kind: DisposeTransactionKind.plan },
      { errorPolicy: LifecycleErrorPolicy.throw }
    );
    // Release in reverse-of-registration order, matching the rest of the package's LIFO convention.
    await transaction.run(
      [...list].reverse().map((entry) => ({ source: entry.source, descriptor: entry.descriptor }))
    );
  };

  /** Releases `list` (reverse order) and returns every cleanup failure instead of throwing. */
  const releaseEntriesCollecting = async (list: readonly IEntry[]): Promise<readonly unknown[]> => {
    if (list.length === 0) return [];
    const transaction = createDisposeTransaction(
      { kind: DisposeTransactionKind.plan },
      { errorPolicy: LifecycleErrorPolicy.collect }
    );
    const collected = await transaction.run(
      [...list].reverse().map((entry) => ({ source: entry.source, descriptor: entry.descriptor }))
    );
    return collected.map((entry) => entry.error);
  };

  const rollback = (): Promise<void> => {
    // 复用唯一 settle Promise：并发第二次 rollback 严格 `===` 首个 rollback（AF-27），而非 async 包装新 Promise。
    if (rollbackPromise) return rollbackPromise;
    try {
      assertPending(); // throws PROVISIONAL_SETTLED if already committed
    } catch (error) {
      // 保持公开契约：已 settle 时返回 rejected Promise（不是同步 throw）。
      return Promise.reject(error);
    }
    state = ProvisionalScopeState.rolledBack;
    controller.abort('provisional scope rolled back');
    const remaining = entries;
    entries = [];
    detachParent();
    rollbackPromise = releaseEntries(remaining);
    return rollbackPromise;
  };

  /**
   * Makes cleanup failures reachable without replacing the primary error: attaches a frozen
   * `errors` array when the primary is an extensible object; otherwise (primitive/frozen primary)
   * wraps into a tagged `AggregateError` so the original stays `errors[0]`-reachable.
   */
  const attachCleanupErrors = (primary: unknown, cleanupErrors: readonly unknown[]): unknown => {
    if (cleanupErrors.length === 0) return primary;
    if (primary !== null && (typeof primary === 'object' || typeof primary === 'function')) {
      try {
        Object.defineProperty(primary, 'errors', {
          value: Object.freeze([...cleanupErrors]),
          enumerable: true
        });
        return primary;
      } catch {
        // Frozen / non-extensible primary — fall through to the aggregate wrapper.
      }
    }
    const message = primary instanceof Error ? primary.message : 'commitTo failed';
    return tagLifecycleError(
      new AggregateError([primary, ...cleanupErrors], message),
      LifecycleErrorCode.scopeDisposalFailed
    );
  };

  const commitTo = (parent: ILifecycleOwner): Promise<void> => {
    // Synchronous fail-fast for the "already settled" invariant (PROVISIONAL_SETTLED); only the
    // actual transfer + compensation is async so it can await the leftover release before settling.
    assertPending();
    const remaining = entries;
    entries = [];
    state = ProvisionalScopeState.committed;
    controller.abort('provisional scope committed');
    detachParent();
    return commitEntries(parent, remaining);
  };

  const commitEntries = async (
    parent: ILifecycleOwner,
    remaining: readonly IEntry[]
  ): Promise<void> => {
    let index = 0;
    try {
      for (; index < remaining.length; index++) {
        const entry = remaining[index]!;
        parent.own(entry.resource, entry.descriptor);
      }
    } catch (error) {
      // Everything from `index` onward never reached `parent` — it must be released by us so it
      // isn't leaked; everything before `index` is now `parent`'s responsibility. The compensation
      // is awaited before this Promise settles, so no background release outlives the commit.
      const leftover = remaining.slice(index);
      state = ProvisionalScopeState.rolledBack;
      // 补偿即回滚：复用唯一 `rollbackPromise`，禁止第三条独立释放路径（AF-15）。
      const cleanupPromise = releaseEntriesCollecting(leftover);
      rollbackPromise = cleanupPromise.then(() => undefined);
      const cleanupErrors = await cleanupPromise;
      // A closed/terminal parent is a specific, common reason `own()` rejects — surface it as a
      // provisional-scope-level signal too, without discarding the parent's own error (kept as
      // `cause`), so a caller can distinguish "my parent was closing" from any other reason `own()`
      // might have refused this resource.
      const parentCode = (error as { readonly code?: unknown } | null)?.code;
      if (
        parentCode === LifecycleErrorCode.scopeClosed ||
        parentCode === LifecycleErrorCode.scopeTerminal
      ) {
        throw createLifecycleError(
          LifecycleErrorCode.provisionalParentClosed,
          '[lifecycle] commitTo() target is already closing or terminal',
          { cause: error, errors: cleanupErrors }
        );
      }
      throw attachCleanupErrors(error, cleanupErrors);
    }
  };

  const scope: IProvisionalScope & { [ASYNC_OWNER_BRAND]?: true } = {
    [ASYNC_OWNER_BRAND]: true,
    get signal() {
      return controller.signal;
    },
    own,
    commitTo,
    rollback
  };

  return scope;
}
