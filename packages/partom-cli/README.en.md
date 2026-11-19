# @migaia/partom-cli

The `partom` command checks part projects (`doctor`), previews blueprints (`preview`), drafts part definitions from existing components and converts pages to blueprints (`extract`), generates the data layer from OpenAPI (`import`) and generates types (`types`). It is written for Bun.

```text
partom doctor [--rendered] [--only <address>] [--browser <path>] [--json [--blueprints]] [--config <path>]
partom preview [<id|file>] [--port <n>] [--config <path>]
partom extract <files...> --out <dir> [--probe] [--verify] [--browser <path>]
partom extract --usage <pages...> --parts <dir> --out <dir>
partom import <openapi.json|yaml> --out <dir>
partom types [--out <file>] [--check] [--config <path>]
partom browser install
partom --version
```

Exit codes: 0 no error; 1 errors or differences; 2 configuration, project dependency or environment error.

## Project config

```ts
// partom.config.ts
export default { plugins: [appPlugin], blueprints: ['*.blueprint.json'] }
```

`@migaia/part-*`, `react`, `react-dom` and `@ui-sdk/core` (`0.1.0-beta.7`) are resolved from the checked project, never bundled into the executable, so there is one plugin-host and one React.

## doctor

- By default it runs every rule in the authored and resolved phases.
- `--rendered` mounts blueprints without static errors in a real headless browser: parts claiming a `pattern` go through ui-sdk's `checkPattern`; layered parts are opened and closed with Escape while focus (not on `body`, not in `inert` content) and id references are checked. The browser comes from `--browser`, then `PARTOM_BROWSER`, then local Chrome, then the Chromium installed by `partom browser install`; an explicit path that does not exist fails without fallback, and nothing is downloaded silently.
- `--json` prints `{ issues, rendered }`; an issue's `cause` keeps only name, message, source and code. With `--blueprints` it also prints `{ id, file, issues }` for each blueprint.

## preview

Starts a read-only server on `127.0.0.1` (the first free port from 4400, or `--port`). The home page lists every blueprint of the config, and `/b/<id>` mounts one with the project's own plugins; given an id or file path, the command also prints that blueprint's URL. File changes re-run the checks, rebuild the page and reload it; the blueprint's doctor issues appear in an overlay at the bottom right, and a blueprint with errors is not mounted. Stop it with Ctrl+C.

## extract

It parses shadcn-style components with oxc: exported components, props, `cva` variants, event callbacks, slots, and a `pattern` guess from Radix and cmdk imports. It writes one `definePart` + `bindReactComponent` draft per component and `report.json`. Generated code accepts only valid identifiers and writes every string as a JSON literal. `--probe` renders each variant value and records the DOM; `--verify` compares the original component with its rendering through a part host. Form controls get a field protocol by fixed rules; shadcn's `form.tsx` becomes five substitute parts without react-hook-form; a TanStack `data-table.tsx` becomes the resource-bound `data-table@1`. The report's `summary` counts clean components and pattern checks.

`--usage` converts page JSX into blueprints, a state seed plugin, effect drafts, native-element parts and black-box parts; see the [guide](./USEGUIDE.en.md#convert-pages-to-blueprints).

## import and types

`import` generates models, resources and an HTTP plugin from OpenAPI 3.x; `types` generates `partom-env.d.ts`. Generated files carry an ownership marker, so files edited by hand are never overwritten.

## Single executable

```bash
pnpm --filter @migaia/partom-cli run build:exe
```

`build:exe` first bundles doctor into one file, `dist/doctor-runner.js`, and embeds it in the executable. Bun's compiled mode cannot resolve scoped, symlinked project packages (`@migaia/*`, `@ui-sdk/*`), so for `doctor` the executable writes the runner to the system temp directory and starts itself with `BUN_BE_BUN=1` to run it as plain Bun. No separate Bun install is needed, and exit codes match a source run. `extract --probe` and `--verify` bundle their check page with `Bun.build` and run directly in the executable.
