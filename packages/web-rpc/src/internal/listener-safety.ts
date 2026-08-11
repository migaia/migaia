/** Observes sync, Promise, and thenable listener failures without rethrowing them. */
export function observeListener<T>(
  invoke: () => T | PromiseLike<T>,
  report: (error: unknown) => void
): void {
  try {
    void Promise.resolve(invoke()).catch((error) => {
      try {
        report(error);
      } catch {}
    });
  } catch (error) {
    try {
      report(error);
    } catch {}
  }
}

/** Registers a listener group atomically and removes earlier registrations on failure. */
export function registerListeners(
  registrations: readonly Readonly<{
    add: () => void;
    remove: () => void;
  }>[]
): void {
  const registered: Array<() => void> = [];
  try {
    for (const registration of registrations) {
      registration.add();
      registered.push(registration.remove);
    }
  } catch (error) {
    for (const remove of registered.reverse()) {
      try {
        remove();
      } catch {}
    }
    throw error;
  }
}

/** Removes every listener in reverse order and reports all release failures together. */
export function releaseListeners(removals: readonly (() => void)[]): void {
  const errors: unknown[] = [];
  for (const remove of [...removals].reverse()) {
    try {
      remove();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'listener cleanup failed');
}
