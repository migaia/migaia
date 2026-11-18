# `@migaia/partom-cli` guide

[中文](./USEGUIDE.md)

See the [README](./README.en.md) for the command summary. `partom` is written for Bun; the repository pins Bun `1.4.4` (`engines.bun` and the `bun` dev dependency).

## Find by scenario

| Problem                                                | Command                           | Section                                    |
| ------------------------------------------------------ | --------------------------------- | ------------------------------------------ |
| Check blueprints against the rules before committing   | `partom doctor`                   | [Static checks](#static-checks)            |
| Confirm a component really follows its APG pattern     | `partom doctor --rendered`        | [Rendered checks](#rendered-checks)        |
| Check only one failing part                            | `partom doctor --only <address>`  | [One address only](#one-address-only)      |
| Hand results to CI or an editor                        | `partom doctor --json`            | [Machine-readable output](#machine-readable-output) |
| Turn existing shadcn components into parts             | `partom extract`                  | [Extract from existing components](#extract-from-existing-components) |
| Confirm an extracted part renders like the original    | `partom extract --verify`         | [Verify extracted parts](#verify-extracted-parts) |

## Project config

`partom` looks for `partom.config.ts` in the current directory (or the file given with `--config`):

```ts
import { appPlugin } from './src/parts/plugin.ts'

export default { plugins: [appPlugin], blueprints: ['blueprints/*.blueprint.json'] }
```

`@migaia/part-*`, `react`, `react-dom` and `@ui-sdk/core` are resolved from the checked project and never bundled into `partom`, so the project and the check share one plugin-host and one React. Missing dependencies exit with code 2.

## Static checks

```bash
bunx partom doctor
```

Runs every rule of the authored and resolved phases (29 built-in rules plus plugin rules; the project's `domPlugin` is added when the config omits it, so built-in modifiers resolve) on each blueprint, with the same result as host loading. Errors exit with code 1.

## Rendered checks

```bash
bunx partom doctor --rendered
```

Mounts blueprints without static errors in a real headless browser:

- Parts claiming a `pattern` go through ui-sdk's `checkPattern`, which checks roles, keyboard and aria against the APG pattern.
- Layered parts are opened and closed with Escape while focus (not on `body`, not in `inert` content) and id references are checked.

The browser comes from `--browser`, then the `PARTOM_BROWSER` environment variable, then local Chrome, then the Chromium installed by `partom browser install`. An explicit path that does not exist fails without falling back, and nothing is downloaded silently.

## One address only

```bash
bunx partom doctor --rendered --only orders/filter/combobox
```

Rendered checks cover only that address and its subtree, which suits repeated runs while fixing one part. Static rules still run on the whole blueprint.

## Machine-readable output

```bash
bunx partom doctor --json > doctor.json
```

Prints `{ issues, rendered }`. An issue's `cause` keeps only name, message, source and code, without stacks.

## Extract from existing components

```bash
bunx partom extract src/components/ui/*.tsx --out src/parts/drafts
```

Parses shadcn-style components with oxc: exported components, props, `cva` variants, event callbacks, slots, and a `pattern` guess from Radix and cmdk imports. It writes one `definePart` + `bindReactComponent` draft per component plus `report.json` with the evidence for each guess. Review the drafts: guessed patterns and event kinds can be wrong. `--probe` renders each variant value and records the DOM.

## Verify extracted parts

```bash
bunx partom extract src/components/ui/button.tsx --out src/parts/drafts --verify
```

`--verify` renders the original component and the draft through a part host and compares the DOM; differences exit with code 1.

## Single executable

```bash
pnpm --filter @migaia/partom-cli run build:exe
```

The compiled `dist/partom` runs `doctor`, `extract` and `--version` directly.

Bun's compiled mode cannot resolve scoped, symlinked project packages (pnpm's `@migaia/*`, `@ui-sdk/*`), still true in Bun `1.4.4`. So `build:exe` first bundles doctor alone into `dist/doctor-runner.js` and embeds it. For `doctor`, the executable writes it to `partom/doctor-runner-<version>.js` in the system temp directory (not rewritten when the content is the same) and starts itself with `BUN_BE_BUN=1` to run it as plain Bun. No separate Bun install is needed; output and exit codes match a source run.

`extract --probe` and `--verify` bundle the check page with `Bun.build`, whose bundled resolver plugin finds project packages, so the executable runs them directly:

```bash
partom extract src/components/ui/button.tsx --out drafts --verify
```

## Exit codes

| Code | Meaning                                         |
| ---- | ----------------------------------------------- |
| 0    | No error                                        |
| 1    | Errors, or differences found by `--verify`      |
| 2    | Configuration, project dependency or environment error |
