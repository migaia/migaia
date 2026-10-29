# @migaia/log-plugin-console

An optional console output for the matching version of `@migaia/log-host`. Its only third-party runtime dependency is `ansis`. Console and stdout capabilities can be supplied independently.

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'

const log = createLogHost({
  plugins: [
    levelPlugin(),
    consolePlugin({ features: { pretty: prettyFeature({ color: 'auto' }) } })
  ]
})
log.info('server ready', { port: 3000 })
await log.flush()
await log.shutdown('manual')
```

Logging methods return synchronously and deliver entries asynchronously. `warn` uses `console.warn`, `error`/`fatal` use `console.error`, and other tags use `console.log`. Entries marked `data.silent` are skipped.

`prettyFeature` preserves message placeholders, argument order, object identity and native Error arguments. JSON/plain delivery uses the host's `record.text`. Automatic format selection checks `LOG_FORMAT=json|pretty`, then CI and TTY, and otherwise selects JSON. Explicit host/output formatting overrides this fallback.

The installed plugin adds `raw(text)` to the host. It writes unchanged text to borrowed stdout or falls back to the borrowed console's `log`. Writer failures enter the host failure channel. Removal never closes supplied console/stdout capabilities.

Runtime exports are `consolePlugin`, `prettyFeature`, `ConsoleColorMode` and the empty `LogConsoleErrorCode` table. The package declares no error source; the host contains original capability failures.

See the [usage guide](./USEGUIDE.en.md) for options and scope examples.

Meta retains the host entry’s shallow-copy boundary. Passing the same object in args and as meta delivers both the original argument and an additional meta copy to the console.

`features` uses the native plugin-host record form `{ alias: feature }`. Each feature is an opaque `defineFeature` token; the plugin installs it and exposes its controls as `console_alias_method` extensions on the host and plugin handle. Runtime state belongs to each installation. For example, a `threshold` alias exposes `console_threshold_setLevel`. Host-wide defaults are declared by a non-output `defineLogPlugin({ name, features })` from `@migaia/log-host/plugin`, passed in `createLogHost({ plugins: [...] })`; an output feature overrides only the same host-wide record key. Gates under different keys both apply. A repeated host-wide key is a conflict. At actual installation, each output checks the merged policies after key overrides: at most one format and one each of batch, retry and timeout, rejecting a collision with the existing `INVALID_OPTION`. `createLogHost({ features })` and feature arrays are no longer supported.
