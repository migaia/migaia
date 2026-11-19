# `@migaia/part-plugin-devtools` guide

## Install and toggle

Add `devtoolsPlugin` to the host's plugins. It mounts a panel fixed to the right of the page inside a Shadow DOM, so page styles do not reach it and it takes no part in layout. `Alt+Shift+D` toggles it; removing the plugin or disposing the host removes the panel, the shortcut and the trace subscription.

## Panel content

- **Address tree:** every address from `trace.addresses()`, filterable by any part of the address; click one to select it.
- **Enhancement:** `authored`, each enhancer and `resolved` in order, each listing only the changed configuration entries (`group.key: old → new`, values cut after 200 characters).
- **Resolved configuration:** the full current configuration of the selected address.
- **State:** each `$state` path bound in the configuration with its current value, `undefined` when it cannot be read.
- **Derives:** each `$derive` bound in the configuration with the paths its latest recomputation read. Derives are shared by id, so every node bound to one derive shows the same dependencies.
- **Events:** dispatches, effect runs and state writes of the address, newest first.

## Development only

The package `exports` map the `development` condition to the real implementation and the default condition to a no-op. Vite dev servers, vitest and `bun build --conditions=development` get the panel; `bun build --production` (or `NODE_ENV=production`) and production builds get a plugin that registers no Feature, creates no DOM and ignores the shortcut. The host's trace recording also exists only under the development condition (see the `@migaia/part-host` guide).

## Build and verify

```bash
pnpm --filter @migaia/part-plugin-devtools run fmt
pnpm --filter @migaia/part-plugin-devtools run lint
pnpm --filter @migaia/part-plugin-devtools run typecheck
pnpm --filter @migaia/part-plugin-devtools run test
```
