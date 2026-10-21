# `@migaia/rpc-integration` user guide

[中文](./USEGUIDE.md)

## Contents

- [1. Setup](#1-setup)
- [2. Scripts](#2-scripts)
- [3. Foreign-language peers](#3-foreign-language-peers)
- [4. Adding tests](#4-adding-tests)
- [5. Wire-format vectors](#5-wire-format-vectors)
- [6. Performance measurement](#6-performance-measurement)

## 1. Setup

The tests import each RPC package's built `dist`. At the start of every run, a global setup compares each dependency's `dist` with its source; if one is out of date, the run fails with `DIST_STALE` and prints the packages to rebuild and the command to use. Build all dependencies of this package first:

```bash
pnpm --filter "@migaia/rpc-integration..." --workspace-concurrency=2 run build
```

Do not run a full `pnpm run build` from the repository root.

The full test suite, conformance and performance measurement are heavy commands. Run them inside the repository's exclusive window so they do not interfere with other measurements:

```bash
node "$(git rev-parse --path-format=absolute --git-common-dir)/../scripts/exclusive-window.mjs" run --window rpc-integration --wait 2700 -- pnpm --filter @migaia/rpc-integration run test
```

## 2. Scripts

| Script | What it does |
| --- | --- |
| `test` | The default suite. It runs in two groups, one after the other: ordinary tests (at most 2 workers), then the 16 MiB large-frame test on its own, so large frames and child-process fixtures do not compete for timers. Conformance and suite-parity are not included. |
| `test:conformance` | Interoperability with foreign-language peers, and bridge fault scenarios. Runs serially with a 120-second timeout per test. Needs foreign-language toolchains; see [section 3](#3-foreign-language-peers). |
| `test:suite-parity` | Checks the tests the RPC packages migrated from the old packages: every test name in each old file must exist in its new location and pass. |
| `test:packed` | Builds the five RPC packages, packs them, installs them into a clean directory, and checks that every declared public path resolves and that retired subpaths still cannot be imported. |
| `test:coverage:family` | Runs the tests of all six RPC test owners (the five RPC packages and this one) together and measures combined coverage of the five runtime packages' source. |
| `typecheck` / `typecheck:test` | Type-check the tests, benches and configuration (this package has no runtime `src`, so both check the same configuration). |
| `fmt` / `lint` | Format and lint the tests, benches and vitest configurations. |
| `bench:ipc` / `bench:probe` | IPC measurement drivers; see [section 6](#6-performance-measurement). |

The repository root also offers a shortcut: `pnpm @rpc-integration <script>`.

## 3. Foreign-language peers

`test:conformance` starts peers written in Python, Rust and Go, so the machine needs `python3`, `rustc`, `cargo` and `go`. `make ci-conformance` checks for these tools first. When any are missing it reports which ones and fails; with `CI_ALLOW_MISSING_TOOLCHAINS=1` set in CI it only warns and skips.

## 4. Adding tests

- Put tests under `test/<directory>/`, choosing the directory from [What it covers](./README.en.md#what-it-covers). A test that checks only one package's internal behaviour belongs in that package's own `test/`.
- Import by package name (`@migaia/rpc-core`, `@migaia/rpc-process/adapters/node-child-process` and so on). Do not reference another package's `src` through a relative path, or the test no longer exercises the public entry.
- A child-process or Worker fixture that `node` runs directly may be a `.mjs` file; register it in `scripts/fixtures/js-exceptions.json` with the reason. Every other file is TypeScript.
- A fixture that counts failures must record the full classification (`source`, `code`, `name`, the reason enum and a redacted message), not only the `code`.
- `test/process` tests whose file name starts with `conformance`, `test/bridge/conformance-faults.test.ts` and `test/merge/suite-parity.test.ts` are not in the default suite; `test:conformance` and `test:suite-parity` run them.

## 5. Wire-format vectors

`schema/vectors/*.json` are language-neutral protocol samples: each file lists valid and invalid messages with the expected parse result. `test/control`, `test/error-format`, `test/streaming` and `test/serialize` use them to check this repository's implementation, and implementations in other languages can read the same files for their own tests.

`schema/vectors/generate.mjs` generates `portable-values.json` from `canonical.json`. Run it again after changing `canonical.json`:

```bash
node packages/rpc-integration/schema/vectors/generate.mjs
```

## 6. Performance measurement

The drivers in `bench/` measure IPC round-trip latency, throughput, and process CPU and RSS. They need a calibrated exclusive window and take a long time, so they are not part of ordinary CI. See [bench/README.md](./bench/README.md) for usage, parameters and how results are recomputed. The repository's `make perf-guard` wraps `bench:ipc` and requires the noise calibration file of the current window:

```bash
make perf-guard PERF_NOISE=raw/noise.json PERF_UNIT=node:stdio-framed:64 PERF_OUTPUT=raw/perf
```
