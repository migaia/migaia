# @migaia/log-plugin-console

[中文](./README.md)

Console output for `@migaia/log-host`. On a terminal or in CI it prints a readable, colored format that keeps native objects and error stacks; when output is redirected or collected by a log pipeline it prints one JSON object per line by default, so you do not need separate setups for the two environments.

## Problems you may have seen

- **Production logs cannot be searched**: colored text that reads well in development reaches the log system as escape codes and stack traces split across lines. The cause is that the output format does not follow the environment.
- **Objects print as `[object Object]`**: the logger joins arguments into a string before the console sees them, losing the object expansion and error stacks the console could show. The cause is formatting before the console.

## Start here

```ts doc-test=run
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'

const log = createLogHost({
  plugins: [
    levelPlugin(),
    // The example fixes no color and no timestamp so the output is easy to compare;
    // by default both follow the terminal and the environment
    consolePlugin({ features: { pretty: prettyFeature({ color: 'never', timestamp: false }) } })
  ]
})
log.info('user %s signed in', 'alice')
log.warn('disk usage at %d%%', 91)
await log.shutdown('manual')
```

Output:

```text
[INFO] user alice signed in
[WARN] disk usage at 91%
```

Placeholders such as `%s` and `%d` are handled by the console itself. Arguments reach `console.log` / `console.warn` / `console.error` unchanged, so objects expand and errors keep their full stack. `warn` goes to `console.warn`, `error` and `fatal` go to `console.error`, and other levels go to `console.log`.

Without `features`, the format is chosen automatically: first the `LOG_FORMAT=json|pretty` environment variable; when it is not set, the readable format is used in CI or when output is a terminal, and JSON otherwise. To always print JSON, put `format: formatFeature({ format: 'json' })` (from `@migaia/log-host/features`) in `features`.

## Common options

| Option or API                                     | Description                                                                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `consolePlugin({ console?, stdout?, features? })` | `console` defaults to the global console and `stdout` to the detected `process.stdout`; both are borrowed and not closed on removal      |
| `prettyFeature({ color?, timestamp? })`           | Readable format. `color` is `auto` (default), `always` or `never`; `timestamp` defaults to `true`                                        |
| `ConsoleColorMode`                                | Constants for `color`                                                                                                                    |
| `log.raw(text)`                                   | Added to the host on install: writes raw text straight to stdout (for example a progress bar's `\r`), or to `console.log` without stdout |

`color: 'auto'` checks, in order, `NO_COLOR`, a non-zero `FORCE_COLOR`, whether the output is a terminal, and whether it runs in CI.

## Contract details

- Log methods return synchronously and delivery is asynchronous; await `flush()` or `shutdown()` before reading a test console or exiting.
- An Error passed as an argument reaches the console once. Entries with a truthy `data.silent` (for example the reasoning plugin's completed-phase records) are not printed again.
- `meta` follows the host's shallow-copy rule: when one object is passed both as an argument and as `meta`, the console receives the original argument and the `meta` copy.
- Write failures (including `raw`) go to the host's failure channel, and handlers receive the original error. An option that cannot be read throws `logging.console / INVALID_OPTION` synchronously, with the reason in `cause`.
- How to write `features`, host-wide defaults and override rules are the same for every output plugin; see [Composing policies in log-host](../log-host/README.en.md#composing-policies).

Public exports: `consolePlugin`, `prettyFeature`, `ConsoleColorMode` and `LogConsoleErrorCode`. The only third-party runtime dependency is `ansis`. See the [usage guide](./USEGUIDE.en.md) for full examples.
