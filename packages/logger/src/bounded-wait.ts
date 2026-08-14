/** Waits for one awaitable until an existing absolute deadline, without cancelling it. */
export const waitUntil = async (
  task: PromiseLike<unknown>,
  deadlineAt: number
): Promise<boolean> => {
  // Observe `task` unconditionally, before the deadline check below can return early. Every call
  // site builds a fresh, previously-unobserved promise (`Promise.resolve(flusher())`,
  // `target.flush()`, `Promise.resolve(handler(reason))`, `Promise.all(inFlight)` in the batch
  // plugin) — none of them are pre-wrapped the way entries in Logger's own `#pending` registry are
  // via `#track()`. If the deadline has already elapsed by the time waitUntil() is called (e.g. a
  // prior #drain() round already burned the whole budget), the old code returned `false` without
  // ever touching `task`, so a `task` that later rejects surfaces as a genuine Node
  // unhandledRejection instead of flowing into the caller's normal failure-reporting path. This
  // extra handler only marks the promise as handled; it never swallows the rejection seen by the
  // real race below. See LG-R5-3 in
  // docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md.
  const observedTask = Promise.resolve(task);
  void observedTask.catch(() => undefined);

  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), remainingMs);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([observedTask.then(() => true), timeout]);
  } finally {
    // The deadline timer must be cleared whenever the tracked task wins the race — otherwise it
    // keeps a timer slot alive (and, without unref support, keeps a browser event loop non-idle)
    // for up to the full remaining budget on every successful bounded wait, accumulating dangling
    // timers on any code path that calls waitUntil() at high frequency. See LG-R5-2 in
    // docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md.
    if (timer !== undefined) clearTimeout(timer);
  }
};
