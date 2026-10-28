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
      features: [
        batchFeature({ maxSize: 20 }),
        retryFeature({ attempts: 3, backoff: 200 }),
        timeoutFeature({ ms: 10000 })
      ]
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
