# Console guide

Install `@migaia/log-plugin-console` with the same version of `@migaia/log-host`. Its runtime dependencies are host, utils, and ansis; other output plugins are optional.

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { formatFeature } from '@migaia/log-host/features'
import { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'

const log = createLogHost({
  plugins: [levelPlugin(), consolePlugin({ console: globalThis.console })],
  features: [prettyFeature({ color: 'never', timestamp: false })]
})
log.info('user=%s', 'alice', { tenant: 'acme' })
log.raw('progress\r')
await log.flush()
await log.shutdown('manual')

const json = createLogHost({
  plugins: [consolePlugin({ features: [formatFeature({ format: 'json' })] })]
})
json.log('info', 'structured')
await json.shutdown('manual')
```

`consolePlugin` accepts `console`, `stdout`, and `features`. The borrowed console implements log/warn/error and retains its receiver. The borrowed stdout implements write(text) and optionally isTTY. Defaults are the global console and recognized host process.stdout. Removing the plugin does not close either capability.

An explicit output format takes precedence over a host format, then the output default. Each scope accepts one format feature. The default reads LOG_FORMAT=json|pretty, then selects pretty for CI or TTY, otherwise JSON. Select plain explicitly with `formatFeature({ format: 'plain' })`.

Pretty output retains placeholders, native argument order, objects, and Error identity while adding time/tag/context prefixes. Other formatters deliver their result as one text argument. Warn routes to warn; error/fatal route to error; other tags route to log. Silent entries produce no console output.

`prettyFeature({ color, timestamp })` defaults to color auto and timestamp true. `ConsoleColorMode` supplies auto/always/never. Explicit always/never win; auto considers NO_COLOR, nonzero FORCE_COLOR, TTY, then CI.

Log methods return synchronously and deliver asynchronously. Await flush/shutdown before inspecting a captured console or exiting. Raw writes synchronously to stdout.write, falling back to console.log. Capability failures reach host onFailure with the original error. `LogConsoleErrorCode` is empty and this package declares no error domain.

Meta retains the host entry’s shallow-copy boundary. Passing the same object in args and as meta delivers both the original argument and an additional meta copy to the console.
