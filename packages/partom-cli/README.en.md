# @migaia/partom-cli

The `partom` command checks part projects (`doctor`) and drafts part definitions from existing components (`extract`). It is written for Bun.

```text
partom doctor [--rendered] [--only <address>] [--browser <path>] [--json] [--config <path>]
partom extract <files...> --out <dir> [--probe] [--verify] [--browser <path>]
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
- `--json` prints `{ issues, rendered }`; an issue's `cause` keeps only name, message, source and code.

## extract

It parses shadcn-style components with oxc: exported components, props, `cva` variants, event callbacks, slots, and a `pattern` guess from Radix and cmdk imports. It writes one `definePart` + `bindReactComponent` draft per component and `report.json`. Generated code accepts only valid identifiers and writes every string as a JSON literal. `--probe` renders each variant value and records the DOM; `--verify` compares the original component with its rendering through a part host.

## Single executable

```bash
pnpm --filter @migaia/partom-cli run build:exe
```

In the compiled executable `--version` and `extract` work today. `doctor` cannot resolve scoped, symlinked project packages in compiled mode (a Bun compile resolution limit), so run it as `bun src/cli.ts doctor …`.
