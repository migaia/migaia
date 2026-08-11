import type { IAbortSignal } from './async-control';

export type IPending<T> = {
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
  readonly signal?: IAbortSignal;
  readonly abort?: () => void;
};

/** Owns request lifetimes so endpoint routing does not duplicate cleanup state. */
export class PendingRegistry<T> {
  readonly tasks = new Map<string, T>();

  /** Gets one task by wire id. */
  get(id: string): T | undefined {
    return this.tasks.get(id);
  }

  /** Adds or replaces a task by wire id. */
  set(id: string, task: T): this {
    this.tasks.set(id, task);
    return this;
  }

  /** Commits a task only while its caller-owned admission predicate remains true. */
  commit(id: string, task: T, canCommit: () => boolean): boolean {
    if (!canCommit()) return false;
    this.tasks.set(id, task);
    return true;
  }

  /** Removes a task and reports whether it existed. */
  delete(id: string): boolean {
    return this.tasks.delete(id);
  }

  /** Tests whether a wire id is already pending. */
  has(id: string): boolean {
    return this.tasks.has(id);
  }

  /** Iterates pending tasks for lifecycle failure handling. */
  [Symbol.iterator](): IterableIterator<[string, T]> {
    return this.tasks[Symbol.iterator]();
  }

  /** Iterates pending task values for lifecycle cleanup. */
  values(): IterableIterator<T> {
    return this.tasks.values();
  }

  /** Removes every task during endpoint disposal. */
  clear(): void {
    this.tasks.clear();
  }
}
