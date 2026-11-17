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

A format configured on the output replaces the host-wide format, even under a different name; one plugin's `features` hold at most one format. Without an explicit format the output default applies: it reads LOG_FORMAT=json|pretty first; when that is not set it selects pretty in CI or when stdout is a terminal, and JSON otherwise. Select plain explicitly with `formatFeature({ format: 'plain' })`.

Pretty output retains placeholders, native argument order, objects, and Error identity while adding time/tag/context prefixes. Other formatters deliver their result as one text argument. Warn routes to warn; error/fatal route to error; other tags route to log. Silent entries produce no console output.

`prettyFeature({ color, timestamp })` defaults to color auto and timestamp true. `ConsoleColorMode` supplies auto/always/never. Explicit always/never win; auto considers NO_COLOR, nonzero FORCE_COLOR, TTY, then CI.

Log methods return synchronously and deliver asynchronously. Await flush/shutdown before inspecting a captured console or exiting. Raw writes synchronously to stdout.write, falling back to console.log. Capability failures reach host onFailure with the original error. An option that cannot be read throws `logging.console / INVALID_OPTION` synchronously, with the reason in `cause`.

Meta retains the host entry’s shallow-copy boundary. Passing the same object in args and as meta delivers both the original argument and an additional meta copy to the console.

`features` is a `{ name: feature }` record; a Feature's controls appear on the host as `console_<name>_<method>`, for example `console_threshold_setLevel` for the name `threshold`. For host-wide defaults and override rules see [Composing policies in log-host](../log-host/README.en.md#composing-policies).
