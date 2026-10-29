# @migaia/log-plugin-http

An injectable HTTP POST output for the matching `@migaia/log-host` version. Host features own batching, retry and timeout policy; this package performs one request attempt.

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { batchFeature, retryFeature, timeoutFeature } from '@migaia/log-host/features'
import { httpPlugin } from '@migaia/log-plugin-http'

const log = createLogHost({
  plugins: [
    levelPlugin(),
    httpPlugin({
      url: 'https://example.test/logs',
      features: {
        batch: batchFeature({ maxSize: 20 }),
        retry: retryFeature({ attempts: 3, backoff: 200 }),
        timeout: timeoutFeature({ ms: 10000 })
      }
    })
  ]
})
log.info('request completed', { requestId: 'one' })
await log.flush()
await log.shutdown('manual')
```

The wire body always remains `{ "entries": [...] }`. Entry error fields use the host's canonical error-chain projection. HTTP does not consume formatted text, so host formats are skipped. Adding a format to HTTP features is rejected at creation with the host INVALID_OPTION error. The output borrows `globalThis.fetch` unless a fetcher is supplied. Creation fails synchronously when neither exists.

Network failures, 429 and 5xx responses are eligible for `retryFeature`. Strictly parsed `Retry-After` advice overrides the next ordinary backoff and is bounded by `maxRetryAfterMs`. `attempts` includes the first request.

Runtime delivery failures enter the host failure channel. Logging methods do not throw and `flush` does not reject. See the [usage guide](./USEGUIDE.en.md) for configuration and error boundaries.

`features` uses the native plugin-host record form `{ alias: feature }`. Each feature is an opaque `defineFeature` token; the plugin installs it and exposes its controls as `http_alias_method` extensions on the host and plugin handle. Runtime state belongs to each installation. For example, a `threshold` alias exposes `http_threshold_setLevel`. Host-wide defaults are declared by a non-output `defineLogPlugin({ name, features })` from `@migaia/log-host/plugin`, passed in `createLogHost({ plugins: [...] })`; an output feature overrides only the same host-wide record key. Gates under different keys both apply. A repeated host-wide key is a conflict. At actual installation, each output checks the merged policies after key overrides: at most one format and one each of batch, retry and timeout, rejecting a collision with the existing `INVALID_OPTION`. `createLogHost({ features })` and feature arrays are no longer supported.
