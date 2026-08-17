import {
  createTerminalController,
  type ITerminalController,
  type ILifecycleState
} from '@migaia/lifecycle';
import { LifecycleState } from '@migaia/lifecycle';
import type { IVersionToken } from './store-resource-ownership.js';
import { createStoreLightError, StoreLightErrorCode } from './errors.js';
import { StoreResourceDataKind, StoreResourceKind } from './resource-state-constants.js';

export type IResourceVersion<T> = {
  readonly id: number;
  readonly token: IVersionToken;
  readonly value: T;
};

export type IResourceCoreState<T> =
  | { readonly kind: typeof StoreResourceKind.idle }
  | {
      readonly kind: typeof StoreResourceKind.loading;
      readonly operation: Promise<T>;
      readonly previous?: IResourceVersion<T>;
    }
  | { readonly kind: typeof StoreResourceKind.ready; readonly current: IResourceVersion<T> }
  | {
      readonly kind: typeof StoreResourceKind.failed;
      readonly error: unknown;
      readonly previous?: IResourceVersion<T>;
    }
  | { readonly kind: typeof StoreResourceKind.closing; readonly current?: IResourceVersion<T> }
  | { readonly kind: typeof StoreResourceKind.disposed };

/**
 * Composes the shared terminal primitive instead of reimplementing open/closing/terminal a second
 * time. `TerminalControllerImpl` owns exactly the lifecycle question — is this thing alive,
 * closing, or gone, and who's waiting to find out — and knows nothing about resource payloads. The
 * request/data union here is the domain state layered on top: which values this specific resource
 * is idle/loading/holding/failing on. Neither replaces the other; a resource is a payload state
 * machine _with_ a lifecycle, not a lifecycle that happens to also hold a payload.
 */
export class ResourceStateController<T> {
  #terminal: ITerminalController = createTerminalController();
  #request:
    | { readonly kind: typeof StoreResourceKind.idle }
    | {
        readonly kind: typeof StoreResourceKind.loading;
        readonly operation: Promise<T>;
        readonly previous?: IResourceVersion<T>;
      } = { kind: StoreResourceKind.idle };
  #data:
    | { readonly kind: typeof StoreResourceDataKind.empty }
    | {
        readonly kind: typeof StoreResourceDataKind.value;
        readonly current: IResourceVersion<T>;
        readonly stale: boolean;
      }
    | {
        readonly kind: typeof StoreResourceDataKind.error;
        readonly error: unknown;
        readonly previous?: IResourceVersion<T>;
      } = { kind: StoreResourceDataKind.empty };

  get lifecycle(): ILifecycleState {
    return this.#terminal.lifecycle;
  }

  /** Resolves once this resource reaches `terminal` — never depends on GC. */
  whenTerminal(): Promise<void> {
    return this.#terminal.whenTerminal();
  }

  get current(): IResourceCoreState<T> {
    if (this.#terminal.lifecycle === LifecycleState.terminal)
      return { kind: StoreResourceKind.disposed };
    if (this.#terminal.lifecycle === LifecycleState.closing) {
      return this.#data.kind === StoreResourceDataKind.value
        ? { kind: StoreResourceKind.closing, current: this.#data.current }
        : { kind: StoreResourceKind.closing };
    }
    if (this.#request.kind === StoreResourceKind.loading) {
      return {
        kind: StoreResourceKind.loading,
        operation: this.#request.operation,
        ...(this.#request.previous ? { previous: this.#request.previous } : {})
      };
    }
    if (this.#data.kind === StoreResourceDataKind.error) {
      return {
        kind: StoreResourceKind.failed,
        error: this.#data.error,
        ...(this.#data.previous ? { previous: this.#data.previous } : {})
      };
    }
    if (this.#data.kind === StoreResourceDataKind.value)
      return { kind: StoreResourceKind.ready, current: this.#data.current };
    return { kind: StoreResourceKind.idle };
  }

  loading(operation: Promise<T>, previous?: IResourceVersion<T>): void {
    this.#assertOpen();
    this.#request = {
      kind: StoreResourceKind.loading,
      operation,
      ...(previous ? { previous } : {})
    };
    this.#data = previous
      ? { kind: StoreResourceDataKind.value, current: previous, stale: true }
      : { kind: StoreResourceDataKind.empty };
  }

  ready(current: IResourceVersion<T>): void {
    this.#assertOpen();
    this.#request = { kind: StoreResourceKind.idle };
    this.#data = { kind: StoreResourceDataKind.value, current, stale: false };
  }

  failed(error: unknown, previous?: IResourceVersion<T>): void {
    this.#assertOpen();
    this.#request = { kind: StoreResourceKind.idle };
    this.#data = { kind: StoreResourceDataKind.error, error, ...(previous ? { previous } : {}) };
  }

  idle(): void {
    this.#assertOpen();
    this.#request = { kind: StoreResourceKind.idle };
    this.#data = { kind: StoreResourceDataKind.empty };
  }

  close(current?: IResourceVersion<T>): void {
    if (this.#terminal.lifecycle === LifecycleState.terminal) return;
    this.#terminal.close();
    this.#request = { kind: StoreResourceKind.idle };
    this.#data = current
      ? { kind: StoreResourceDataKind.value, current, stale: false }
      : { kind: StoreResourceDataKind.empty };
  }

  dispose(): void {
    this.#terminal.forceTerminal();
    this.#request = { kind: StoreResourceKind.idle };
    this.#data = { kind: StoreResourceDataKind.empty };
  }

  #assertOpen(): void {
    if (this.#terminal.lifecycle !== LifecycleState.open)
      throw createStoreLightError(
        StoreLightErrorCode.resourceDisposed,
        '[store] resource is disposed'
      );
  }
}
