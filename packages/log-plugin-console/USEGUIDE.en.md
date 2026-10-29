# Console guide

Install `@migaia/log-plugin-console` with the same version of `@migaia/log-host`. Its runtime dependencies are host, utils, and ansis; other output plugins are optional.

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { formatFeature } from '@migaia/log-host/features'
import { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'

const log = createLogHost({
  plugins: [
    levelPlugin(),
    consolePlugin({
      console: globalThis.console,
      features: { pretty: prettyFeature({ color: 'never', timestamp: false }) }
    })
  ]
})
log.info('user=%s', 'alice', { tenant: 'acme' })
log.raw('progress\r')
await log.flush()
await log.shutdown('manual')

const json = createLogHost({
  plugins: [consolePlugin({ features: { format: formatFeature({ format: 'json' }) } })]
})
json.log('info', 'structured')
await json.shutdown('manual')
```

`consolePlugin` accepts `console`, `stdout`, and `features`. The borrowed console implements log/warn/error and retains its receiver. The borrowed stdout implements write(text) and optionally isTTY. Defaults are the global console and recognized host process.stdout. Removing the plugin does not close either capability.

An output format replaces only the same host-wide record key. Two effective formats under different keys reject at actual installation with `INVALID_OPTION`. The output default applies when no explicit format survives. The default reads LOG_FORMAT=json|pretty, then selects pretty for CI or TTY, otherwise JSON. Select plain explicitly with `formatFeature({ format: 'plain' })`.

Pretty output retains placeholders, native argument order, objects, and Error identity while adding time/tag/context prefixes. Other formatters deliver their result as one text argument. Warn routes to warn; error/fatal route to error; other tags route to log. Silent entries produce no console output.

`prettyFeature({ color, timestamp })` defaults to color auto and timestamp true. `ConsoleColorMode` supplies auto/always/never. Explicit always/never win; auto considers NO_COLOR, nonzero FORCE_COLOR, TTY, then CI.

Log methods return synchronously and deliver asynchronously. Await flush/shutdown before inspecting a captured console or exiting. Raw writes synchronously to stdout.write, falling back to console.log. Capability failures reach host onFailure with the original error. `LogConsoleErrorCode` is empty and this package declares no error domain.

Meta retains the host entry’s shallow-copy boundary. Passing the same object in args and as meta delivers both the original argument and an additional meta copy to the console.

`features` uses the native plugin-host record form `{ alias: feature }`. Each feature is an opaque `defineFeature` token; the plugin installs it and exposes its controls as `console_alias_method` extensions on the host and plugin handle. Runtime state belongs to each installation. For example, a `threshold` alias exposes `console_threshold_setLevel`. Host-wide defaults are declared by a non-output `defineLogPlugin({ name, features })` from `@migaia/log-host/plugin`, passed in `createLogHost({ plugins: [...] })`; an output feature overrides only the same host-wide record key. Gates under different keys both apply. A repeated host-wide key is a conflict. At actual installation, each output checks the merged policies after key overrides: at most one format and one each of batch, retry and timeout, rejecting a collision with the existing `INVALID_OPTION`. `createLogHost({ features })` and feature arrays are no longer supported.
