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
| See blueprint edits in a browser while you work | `partom preview` | [Local preview](#local-preview) |
| Turn the JSX of a shadcn page into a blueprint | `partom extract --usage` | [Convert pages to blueprints](#convert-pages-to-blueprints) |
| Generate models and resources from an OpenAPI document | `partom import` | [Generate the data layer from OpenAPI](#generate-the-data-layer-from-openapi) |
| Get typed addresses and state paths in effects | `partom types` | [Generate types](#generate-types) |

## Project config

`partom` looks for `partom.config.ts` in the current directory (or the file given with `--config`):

```ts
import { appPlugin } from './src/parts/plugin.ts'

export default { plugins: [appPlugin], blueprints: ['blueprints/*.blueprint.json'] }
```

Rendered checks and the local preview bundle the config into a browser page. Only environment variables named `PARTOM_PUBLIC_*` are written into that page at bundle time (for example `process.env.PARTOM_PUBLIC_API_URL`); no other variable reaches the page. An unset variable is not replaced, and reading `process.env` in the page then throws, so set these variables before running rendered checks or the preview.

`@migaia/part-*`, `react`, `react-dom` and `@ui-sdk/core` are resolved from the checked project and never bundled into `partom`, so the project and the check share one plugin-host and one React. Missing dependencies exit with code 2.

## Static checks

```bash
bunx partom doctor
```

Runs every rule of the authored and resolved phases (37 built-in rules plus plugin rules; the project's `domPlugin` is added when the config omits it, so built-in modifiers resolve) on each blueprint, with the same result as host loading. Errors exit with code 1.

## Rendered checks

```bash
bunx partom doctor --rendered
```

Mounts blueprints without static errors in a real headless browser:

- Parts claiming a `pattern` go through ui-sdk's `checkPattern`, which checks roles, keyboard and aria against the APG pattern.
- Layered parts are opened and closed with Escape while focus (not on `body`, not in `inert` content) and id references are checked.
- Parts whose descriptor declares `budget.render` (milliseconds) are mounted alone five times, using the first node of each in the blueprint; a median mount-to-commit time above the budget reports a `budget.render` error with `basis` `median <measured>ms > budget <budget>ms`. Parts without a budget are not measured. Timing depends on machine load, so leave headroom.

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

Prints `{ issues, rendered }`. An issue's `cause` keeps only name, message, source and code, without stacks. With `--blueprints` it also prints `blueprints: { id, file, issues }[]`, each blueprint in config match order with its own issues; the other fields and the exit code stay the same.

## Extract from existing components

```bash
bunx partom extract src/components/ui/*.tsx --out src/parts/drafts
```

Parses shadcn-style components with oxc: exported components, props, `cva` variants, event callbacks, slots, and a `pattern` guess from Radix and cmdk imports. It writes one `definePart` + `bindReactComponent` draft per component plus `report.json` with the evidence for each guess. Review the drafts: guessed patterns and event kinds can be wrong. `--probe` renders each variant value and records the DOM.

Exports wrapped in `memo` or `forwardRef` (also with the `React.` prefix, nested in any order) are unwrapped: props come from the innermost function, `report.json` records the chain in `wrappers`, and the draft binds the outer export. List your own transparent higher-order components in `extract.transparentWrappers` of `partom.config.ts` (for example `['withTheme']`); each is unwrapped one level through its first argument. Other higher-order components (such as `connect(map)(X)`) are not guessed: the component is bound as a black box with no guessed props, and the report carries `hoc-opaque`.

## Verify extracted parts

```bash
bunx partom extract src/components/ui/button.tsx --out src/parts/drafts --verify
```

`--verify` renders the original component and the draft through a part host and compares the DOM; differences exit with code 1.

## Form controls, form.tsx and DataTable

Extraction infers a field protocol by fixed rules; the draft gets `behavior.field` and the callback mapping, and the field value is written back to its bound state automatically:

- props typed `ComponentProps<'input'>` or `ComponentProps<'textarea'>`: value `value`, event `change` mapped to `onChange`, read from the event target;
- a Radix checkbox or switch `Root` at the root: value `checked`, event `checkedChange` mapped to `onCheckedChange`;
- a Radix select `Root` at the root: value `value`, event `valueChange` mapped to `onValueChange`.

shadcn's `form.tsx` reads react-hook-form context and cannot render outside `<Form>`, so it is not wrapped. Extraction writes `form.part.tsx` instead: five components without react-hook-form (`form-item@1`, `form-label@1`, `form-control@1`, `form-description@1`, `form-message@1`) that keep the original classes and link the label's `for`, the control's `aria-describedby` and `aria-invalid` as the original does. `form-message@1` shows `props.message` and renders nothing when it is empty.

A `data-table.tsx` that uses TanStack's `useReactTable` becomes `data-table.part.tsx`: part `data-table@1` binds a resource (`props.source`), declares the `loading`, `empty`, `error` and `header` slots, renders with the project's own shadcn table components, and gets its rows from a blueprint template. Sorting, filtering and paging stay out of the part.

`report.json` carries a `summary`: `components`, `componentsClean` (components without uncertain items), and with `--probe` also `patternChecked` and `patternPassed` (otherwise both are `null`). Generated substitutes are not part of `--verify`.

## Convert pages to blueprints

```bash
bunx partom extract --usage src/pages/orders-page.tsx --parts src/parts --out src/blueprints
```

`--parts` is the output directory of the component extraction (its `report.json` is read). Each exported function component with a single JSX `return` produces these files under `--out`:

- `<file>.blueprint.json`: extracted components become their part nodes, native elements become `html-<tag>@1` nodes, literal attributes go to `props`, and `useState` variables become `{ $state: 'page.<variable>' }`;
- `<file>.seed.ts`: state with literal initial values, written when the plugin installs (only if never written before);
- `effects/<file>.ts`: one `defineEffect` draft per event handler; it throws until rewritten by hand, and the original handler source only appears in an exported string constant;
- `blackbox/*.tsx`: JSX that cannot be converted (components that were not extracted, `map`, conditions…) is kept verbatim as a black-box part; the state variables it reads arrive as props;
- `parts/html.ts`: the native-element parts the pages use.

Every TS file default-exports a part plugin to install in `partom.config.ts`. react-hook-form fields bind to `page.<form>.<field>` and their messages to `page.<form>-errors.<field>`; `onSubmit={form.handleSubmit(fn)}` becomes a `submit.prevent` subscription. A DataTable gets its columns and row template from the page's `columns` array; `data` has to be bound to a resource by hand. When the field protocol already writes a value back (such as `onValueChange={setStatus}`), no subscription is generated.

The printed report lists written, unchanged and taken-over files, each uncertain item with its reason and line, and a `summary`: `usageNodes`, `usageConverted`, `blackboxes`. Generated files carry the `@partom-generated` marker (blueprint JSON uses a `$partom` key), so files edited by hand are never overwritten. A `--parts` directory without a report exits with code 2.

## Generate the data layer from OpenAPI

```bash
bunx partom import openapi.json --out src/api
```

Reads an OpenAPI 3.x document (JSON or YAML) and generates the source of models, resources and an HTTP plugin; `src/api/index.ts` exports `apiPlugin` and `createHttpPlugin`. Generated files edited by hand are never overwritten; the report lists them as taken over.

## Generate types

```bash
bunx partom types
```

Generates `partom-env.d.ts` from the configured plugins and blueprints: part addresses, state paths, event `detail`, resource parameters and command arguments. `--check` only checks that the file is current.

## Local preview

```bash
bunx partom preview            # prints {"url":"http://127.0.0.1:4400/"}
bunx partom preview orders     # also prints {"url":"http://127.0.0.1:4400/b/orders"}
```

`partom preview` listens on `127.0.0.1` only and has no write routes. It takes the first free port from 4400 to 4419, or the port given with `--port <n>`; when no port is free it exits with code 2 (`PORT_IN_USE`). The argument may be a blueprint id or a blueprint file path; one the config does not match exits with code 2 (`BLUEPRINT_NOT_FOUND`).

- The home page lists every blueprint the config matches with its error and warning counts; `/b/<id>` mounts that blueprint with the config's plugins plus the project's `domPlugin` and `reactPlugin`.
- Changes to blueprints, components or the config within 100 milliseconds merge into one rebuild: doctor runs again, the page is bundled again, and on success the page reloads. Rebuilds run one at a time; changes made during a rebuild cause exactly one more rebuild after it.
- When bundling or the config fails, the page keeps its last content and the overlay at the bottom right shows the error; the next change after the fix recovers.
- The overlay lists the blueprint's doctor issues; clicking one outlines the element and scrolls to it. A blueprint with errors is not mounted, matching doctor's rule for skipping rendered checks. The overlay lives in Shadow DOM, untouched by page styles and outside the F6 region cycle.
- The preview writes only the project's `.partom-preview/` directory, cleared at start and removed at exit, so running `partom doctor` at the same time does not interfere. Ctrl+C stops it with exit code 0.

- **Editor bridge mode**: `partom preview --editor --editor-origin <editor url>` is what the preview column of `apps/part-editor` embeds. The page is bundled with the `development` condition first, so devtools and host tracing are real; it installs `devtoolsPlugin` and the entries of `release.remote.modules` as `remote:modules`. It accepts `postMessage` only from the editor origin: `{ kind: 'blueprint', document }` updates and mounts a blueprint, and `{ kind: 'modules', modules, base, token }` hot-replaces remote modules by name (every module runs at tier `page` in the preview). The issues of every update (project rules and resolved issues included) go back to the editor; on start the page sends `{ kind: 'ready' }`.

## Build remote code modules

```bash
partom remote build remote/effects/notify.ts --out partom-build --root remote --project .
```

A remote module is one TS file whose default export is the result of `defineEnhancer`, `defineEffect` or `defineDerive` (or an array of them); its name is the file path relative to `--root`. Each entry is processed on its own:

- **Code rules:** imports only `@migaia/part-host`, `@migaia/part-contract`, `react` and `react/jsx-runtime` (`remote.import`; relative imports, dynamic `import()` and `require` are refused); no top-level `let`/`var` or statements other than definition calls (`remote.module-state`); no host globals such as `window`, `process` or `fetch` (`remote.global`).
- **Type check:** the project's own `tsc` on a generated tsconfig holding only this entry, in a temporary directory inside the project; without TypeScript the command exits 2 (`PROJECT_DEPENDENCY_MISSING`).
- **Build:** `Bun.build` emits browser ESM without minification or source maps, byte-identical for equal input; imports of the shared runtime become shims reading `globalThis[Symbol.for('migaia.part.shared')]`, which the page fills.
- **Contract test:** runs in a Bun child whose environment holds only `PATH`: enhancers and derives run twice and must agree (`remote.impure`); effects run once against a recording ctx, reporting `remote.contract-timeout` after 2 seconds and `remote.contract-failed` when they throw.

Outputs are `<out>/m/<content hash>.js` and `<out>/modules.json` (`name`, `id`, `url`, `integrity`, `exports`); stdout prints `{ modules, failed, issues }`. A failed entry makes the exit code 1; an entry outside `--root` reports `REMOTE_ENTRY_OUTSIDE`. These checks give early feedback and are not a sandbox: running the command executes module code on this machine.

## Release and sync

Add `release` to `partom.config.ts`:

```ts
export default {
  plugins: [appPlugin],
  blueprints: ['blueprints/*.blueprint.json'],
  release: {
    project: 'orders', // project name in the catalog
    parts: ['parts/*.part.tsx'], // part modules loaded on demand
    remote: { root: 'remote', modules: ['**/*.ts'] } // remote-module root and entry globs
  }
}
```

- **`partom build [--tag <tag>] [--out partom-build]`** builds only from a clean, tagged HEAD; otherwise it exits 2 (`RELEASE_DIRTY`). It writes `snapshot.json`, remote modules under `m/` and `sources.json`. Remote modules are installed in the checking host first, so a remote effect a blueprint uses does not trigger `event.handler-exists`, and its descriptor goes into the snapshot. Two builds of one tag are byte-identical. A static error in any blueprint prints `{ issues }` and exits 1.
- **`partom manifest [--out src/partom-client.gen.ts] [--build <name>] [--inline <id,...>] [--budgets]`** generates the client module. It exports `manifest`, `shared`, `chunks`, `lazyPartsPlugin` and `inlined`, ready to pass to `remotePlugin`. The manifest leaves out definitions that remote modules provide. `lazyPartsPlugin` registers the parts of `release.parts` at once and renders each component after its module loads. `--budgets` checks each part module's minified size (shared runtime external) against `budget.size`; an oversize module reports `budget.size` and exits 1, and the module file is still written. When the config itself imports a remote module, both `manifest` and `build` report `release.remote-in-config` and exit 1.
- **`partom publish --service <url> [--env dev] [--dir partom-build]`** uploads the modules, the snapshot bytes and the sources, then points the environment at the snapshot. `promote --env <env> --from <env>`, `rollback --env <env> --to <tag|snapshot hash>` and `history --env <env>` work on environment pointers. The token comes only from `PARTOM_TOKEN`. A 4xx answer is printed to stderr as is and exits 1; a network failure or 5xx exits 2 (`SERVICE_UNREACHABLE`).
- **`partom pull --service <url>`** merges the editor draft into the workspace blueprints by address (the base is the file at the draft's base tag) and writes draft module sources whose workspace file has not changed since that tag. Conflicts and failures are listed and exit 1; a merge conflict keeps the local value. A draft with rebase conflicts writes nothing.
- **`partom push --service <url>`** sends workspace blueprints and remote modules changed since the draft's base tag as one changeset and prints the result; `rejected` or `conflict` exits 1. The catalog never commits to git: developers commit and open the PR.

## Single executable

```bash
pnpm --filter @migaia/partom-cli run build:exe
```

The compiled `dist/partom` runs `doctor`, `preview`, `extract` and `--version` directly. `build:exe` also bundles the preview page's browser code into `dist/preview-runtime.js` and embeds it; the `preview` server process imports no project module and starts a fresh doctor child for every check.

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
