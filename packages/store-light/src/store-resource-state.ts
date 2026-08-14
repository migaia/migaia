import { TerminalControllerImpl } from '@migaia/reactive/runtime/lifecycle-primitives';
import type { LifecycleState, VersionToken } from '@migaia/reactive/runtime/lifecycle-primitives';

export type ResourceVersion<T> = {
  readonly id: number;
  readonly token: VersionToken;
  readonly value: T;
};

export type ResourceCoreState<T> =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'loading';
      readonly operation: Promise<T>;
      readonly previous?: ResourceVersion<T>;
    }
  | { readonly kind: 'ready'; readonly current: ResourceVersion<T> }
  | { readonly kind: 'failed'; readonly error: unknown; readonly previous?: ResourceVersion<T> }
  | { readonly kind: 'closing'; readonly current?: ResourceVersion<T> }
  | { readonly kind: 'disposed' };

/**
 * Composes the shared terminal primitive instead of reimplementing open/closing/terminal a second
 * time. `TerminalControllerImpl` owns exactly the lifecycle question — is this thing alive,
 * closing, or gone, and who's waiting to find out — and knows nothing about resource payloads. The
 * request/data union here is the domain state layered on top: which values this specific resource
 * is idle/loading/holding/failing on. Neither replaces the other; a resource is a payload state
 * machine _with_ a lifecycle, not a lifecycle that happens to also hold a payload.
 */
export class ResourceStateController<T> {
  #terminal = new TerminalControllerImpl();
  #request:
    | { readonly kind: 'idle' }
    | {
        readonly kind: 'loading';
        readonly operation: Promise<T>;
        readonly previous?: ResourceVersion<T>;
      } = { kind: 'idle' };
  #data:
    | { readonly kind: 'empty' }
    | { readonly kind: 'value'; readonly current: ResourceVersion<T>; readonly stale: boolean }
    | { readonly kind: 'error'; readonly error: unknown; readonly previous?: ResourceVersion<T> } =
    { kind: 'empty' };

  get lifecycle(): LifecycleState {
    return this.#terminal.lifecycle;
  }

  /** Resolves once this resource reaches `terminal` — never depends on GC. */
  whenTerminal(): Promise<void> {
    return this.#terminal.whenTerminal();
  }

  get current(): ResourceCoreState<T> {
    if (this.#terminal.lifecycle === 'terminal') return { kind: 'disposed' };
    if (this.#terminal.lifecycle === 'closing') {
      return this.#data.kind === 'value'
        ? { kind: 'closing', current: this.#data.current }
        : { kind: 'closing' };
    }
    if (this.#request.kind === 'loading') {
      return {
        kind: 'loading',
        operation: this.#request.operation,
        ...(this.#request.previous ? { previous: this.#request.previous } : {})
      };
    }
    if (this.#data.kind === 'error') {
      return {
        kind: 'failed',
        error: this.#data.error,
        ...(this.#data.previous ? { previous: this.#data.previous } : {})
      };
    }
    if (this.#data.kind === 'value') return { kind: 'ready', current: this.#data.current };
    return { kind: 'idle' };
  }

  loading(operation: Promise<T>, previous?: ResourceVersion<T>): void {
    this.#assertOpen();
    this.#request = { kind: 'loading', operation, ...(previous ? { previous } : {}) };
    this.#data = previous ? { kind: 'value', current: previous, stale: true } : { kind: 'empty' };
  }

  ready(current: ResourceVersion<T>): void {
    this.#assertOpen();
    this.#request = { kind: 'idle' };
    this.#data = { kind: 'value', current, stale: false };
  }

  failed(error: unknown, previous?: ResourceVersion<T>): void {
    this.#assertOpen();
    this.#request = { kind: 'idle' };
    this.#data = { kind: 'error', error, ...(previous ? { previous } : {}) };
  }

  idle(): void {
    this.#assertOpen();
    this.#request = { kind: 'idle' };
    this.#data = { kind: 'empty' };
  }

  close(current?: ResourceVersion<T>): void {
    if (this.#terminal.lifecycle === 'terminal') return;
    this.#terminal.close();
    this.#request = { kind: 'idle' };
    this.#data = current ? { kind: 'value', current, stale: false } : { kind: 'empty' };
  }

  dispose(): void {
    this.#terminal.forceDispose();
    this.#request = { kind: 'idle' };
    this.#data = { kind: 'empty' };
  }

  #assertOpen(): void {
    if (this.#terminal.lifecycle !== 'open') throw new Error('[store] resource is disposed');
  }
}
