# @migaia/log-plugin-http

[中文](./README.md)

An output plugin that sends logs to a log service with HTTP POST, used with `@migaia/log-host`. Each delivery sends one request; batching, retries and timeouts come from host Features and follow the same rules as every other output.

## Problems you may have seen

- **One request per log line overloads the log service**: at peak, the request count equals the line count. The cause is no batching.
- **A short 503 from the log service loses every line sent meanwhile**: failed sends are not retried, or retries ignore the service's `Retry-After` and pile more load on it. The cause is retry rules that do not tell errors apart or follow the server's pace.

## Start here

The example injects a fake `fetcher` instead of a real network: the first call returns 503 and later calls return 200. Run it directly with Node 24.

```ts doc-test=run
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { batchFeature, retryFeature } from '@migaia/log-host/features'
import { httpPlugin } from '@migaia/log-plugin-http'

let calls = 0
const log = createLogHost({
  plugins: [
    levelPlugin(),
    httpPlugin({
      url: 'https://logs.example.invalid/ingest',
      // A fake network for the example: 503 first, then 200; without fetcher the global fetch is used
      async fetcher(_url, init) {
        calls += 1
        const { entries } = JSON.parse(init.body)
        console.log(`request ${calls} carries ${entries.length} entries`)
        const status = calls === 1 ? 503 : 200
        return { ok: status === 200, status, headers: new Headers() }
      },
      features: {
        batch: batchFeature({ maxSize: 2 }), // two entries per request
        retry: retryFeature({ attempts: 3, backoff: 0 }) // at most 3 attempts, the first included
      }
    })
  ]
})
log.info('order created')
log.info('payment captured')
await log.shutdown('manual')
```

Output:

```text
request 1 carries 2 entries
request 2 carries 2 entries
```

The two entries are batched into one request. After the first 503 the plugin retries under `retryFeature`, and the second attempt succeeds. `shutdown()` completes only after the batch is delivered.

## Common options

| Option            | Description                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`             | Passed to the fetcher unchanged                                                                                                                                                               |
| `fetcher`         | Defaults to `globalThis.fetch`; receives `(url, { method, headers, body, signal })` and returns a result with `ok`, `status` and `headers.get`. Timeouts and shutdown arrive through `signal` |
| `headers`         | Copied at creation; `Content-Type: application/json` by default                                                                                                                               |
| `authToken`       | When non-empty, sets `Authorization: Bearer <token>`                                                                                                                                          |
| `maxRetryAfterMs` | Upper bound for the server's `Retry-After`, 30000 by default                                                                                                                                  |
| `features`        | This output's policies, usually `batchFeature`, `retryFeature` and `timeoutFeature`                                                                                                           |

## Contract details

- The request body is always `{ "entries": [...] }`. Each entry's `error` is written through the host's shared projection with the whole error chain (`source`, `code`, `name`, `message`, `stack`, `cause`, `errors`).
- HTTP does not consume formatted text, so the host skips the format phase for it; a format in this plugin's `features` is rejected at install.
- Network errors, 429 and 5xx can be retried; other statuses are not. `attempts` includes the first request. A valid `Retry-After` (seconds or an HTTP date) replaces the ordinary backoff and is capped by `maxRetryAfterMs`.
- Without `retryFeature` there is no retry, without `batchFeature` no batching, and without `timeoutFeature` no extra timeout.
- With no usable fetcher, or an invalid `maxRetryAfterMs`, creation throws synchronously. Send and serialization errors at run time go to the host's failure channel; log methods do not throw and `flush()` does not reject. The error domain is `logging.http` (`LOG_HTTP_ERROR_SOURCE`); see `LogHttpErrorCode` for codes.
- `features` is a `{ name: feature }` record; controls appear on the host as `http_<name>_<method>`. For host-wide defaults and override rules see [Composing policies in log-host](../log-host/README.en.md#composing-policies).

See the [usage guide](./USEGUIDE.en.md) for full configuration and error boundaries.
