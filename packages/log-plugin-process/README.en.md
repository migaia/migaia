# @migaia/log-plugin-process

[中文](./README.md)

A plugin that keeps logs from being lost when the process exits, used with `@migaia/log-host`. On `SIGINT` / `SIGTERM` it first runs the last-log handlers you registered, then delivers queued lines, and only then exits; uncaught exceptions and Promise rejections are logged as `fatal` before shutdown.

## Problems you may have seen

- **When a container stops, the last lines and the exit reason are gone**: the process exits right after `SIGTERM` and buffered lines disappear with it. The cause is that nobody waits for logs before exiting.
- **The last error before a crash never reaches the log system**: an uncaught exception ends the process and the error only flashes on the terminal. The cause is that the crash path is not connected to log shutdown.
- **Several modules listen for signals and race to exit**: each library calls `process.on('SIGTERM')`; one calls `exit` while the others are still cleaning up. The cause is that signal handling has no single owner.

## Start here

The example uses a fake process object to show the order after `SIGTERM`, without really exiting. Run it directly with Node 24.

```ts doc-test=run
import { EventEmitter } from 'node:events'
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { defineOutputPlugin } from '@migaia/log-host/sdk'
import { processPlugin } from '@migaia/log-plugin-process'

// A fake process with events, env and exit; without process the real one is used
const fakeProcess = Object.assign(new EventEmitter(), {
  env: {},
  exit(code?: number) {
    console.log(`process.exit(${code})`)
  }
})
// A slow output: each write takes 20 ms
const output = defineOutputPlugin({
  name: 'output',
  batchable: false,
  defaultFormat: 'plain',
  async deliver(records) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    for (const record of records) console.log(`written: ${record.entry.message}`)
  }
})
const log = createLogHost({
  plugins: [levelPlugin(), output, processPlugin({ process: fakeProcess })]
})
log.onShutdown(() => {
  log.info('exit signal received, closing')
})
log.info('service started')
fakeProcess.emit('SIGTERM')
```

Output:

```text
written: service started
written: exit signal received, closing
process.exit(0)
```

After the signal, the last line from `onShutdown` is written too, and only then is `exit(0)` called. The whole shutdown waits at most 3000 ms by default.

## Common options

| Option                 | Default                     | Description                                                                        |
| ---------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| `process`              | The detected server process | Needs `env`, `on`, `removeListener` and `exit`; borrowed, never replaced           |
| `captureCrashes`       | `true`                      | Log uncaught exceptions and unhandled rejections as `fatal` before shutdown        |
| `shutdownTimeoutMs`    | `3000`                      | Upper bound for the shutdown wait                                                  |
| `interceptProcessExit` | `false`                     | When `true`, a direct `process.exit` in your code also waits for one bounded flush |

`log.onShutdown(handler)` registers a last-log handler (provided by log-host).

## Contract details

- `SIGINT` / `SIGTERM` start shutdown and call `exit(0)` when it completes; `beforeExit` only runs a bounded flush and does not force an exit. With no usable process and none injected, the plugin installs no listeners.
- Hosts on the same process object share one listener group and must agree on the three policy options and the scheduler source; otherwise installation fails with `PLUGIN_CONFIG_CONFLICT`. Different process objects do not affect each other. The listeners are removed after the last user is removed, and the plugin can be installed again later.
- If registering some listeners fails, the registered ones roll back in reverse order. One cleanup error does not skip other resources; the first error stays first, and original errors remain reachable through `cause` and `AggregateError.errors`.
- The error domain is `logging.process` (`LOG_PROCESS_ERROR_SOURCE`); see `LogProcessErrorCode` for codes. Installation conflicts and failures throw synchronously; run-time failures go to the host's failure channel.

See the [usage guide](./USEGUIDE.en.md) for all options and error codes.
