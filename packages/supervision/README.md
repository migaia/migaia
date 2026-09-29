# @migaia/supervision

Runtime-neutral supervision for execution units. The root entry owns unit budgets, attempts, active-unit lifecycle, bounded teardown, restart policy, health checks, capability admission, and observation. The `./coroutine` entry adds cooperative tasks; other unit profiles use the same root contracts.

Create a budget with `createUnitBudget({ kind, maxUnits })`, then pass that budget, a matching profile, a launcher, a specification, and a `report` callback to `createSupervisor`. Call `start()` and use the unit only when its result is `ready`. Call `dispose()` when finished. The complete coroutine example is in [USEGUIDE.md](./USEGUIDE.md).

The launcher must fulfill `handle.exited` only after its unit has stopped and its own resources are closed. `exited` never rejects. The profile validates specifications, declares required capabilities, terminates idempotently, and classifies fulfilled exit statuses. `report` receives terminal, cleanup, late rejection, and degraded-capability diagnostics. `inspect()` and `subscribe()` expose state without creating a unit.

Budgets return `{ kind: 'granted', lease }` or `{ kind: 'rejected', reason }`. Release each granted lease once; `release()` is idempotent. Closing a budget rejects pending and future admissions while existing leases remain held until their units actually exit. Nested budgets share the unit kind and release parent before child.

The default startup timeout is 10 seconds. Stop uses 5 seconds each for drain, graceful exit, and force reap. Restart defaults to `on-failure`, with 250 ms initial delay, factor 2, 30 seconds maximum delay, five restarts in 60 seconds. The default terminal policy stays terminal; a configured cooldown schedules one unref'd retry. Health checks default to a 5 second interval, 2 second check timeout, and three consecutive failures. Budget defaults are queue overflow, 30 second queue timeout, and eight grants per second. Supply a scheduler for deterministic timing.

The core depends only on `@migaia/lifecycle` and `@migaia/utils`. A profile may use `hooks.acquireUnit` for a preacquired unit, `hooks.afterLaunch` to own attachments, `hooks.onReady` to own monitors or fail the unit, and `hooks.inspectUnit` for a read-only snapshot. Attachments registered in `unit.scope` release after `exited`; monitors registered in `unit.monitors` release before termination. Unit-specific entry points belong beside, never inside, the root implementation.

All errors leaving this package carry `source: '@migaia/supervision'` and one semantic `SupervisionErrorCode`; original failures remain on `cause`, and cleanup failures remain reachable through `errors`. States and budget outcomes are values, not thrown codes.

The `./process` entry adds a shell-free specification, capability checks, usage monitoring,
bounded output tails, durable orphan records and recovery, a parent-loss guard, and an optional
bounded prewarm pool. It defines a launcher port and does not start an operating-system process
itself. See [USEGUIDE.md](./USEGUIDE.md) for the process contract, defaults and cleanup.
