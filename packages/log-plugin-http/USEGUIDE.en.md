# HTTP guide

Install this package with the same version of `@migaia/log-host`. Each delivery makes one POST; host features supply transport policy.

```ts
import { createLogHost } from '@migaia/log-host'
import { batchFeature, retryFeature, timeoutFeature } from '@migaia/log-host/features'
import { httpPlugin } from '@migaia/log-plugin-http'

const log = createLogHost({
  plugins: [
    httpPlugin({
      url: 'https://example.test/logs',
      fetcher: globalThis.fetch,
      headers: { 'X-Application': 'example' },
      authToken: 'example-token',
      maxRetryAfterMs: 30000,
      features: {
        batch: batchFeature({ maxSize: 20 }),
        retry: retryFeature({ attempts: 3, backoff: 200 }),
        timeout: timeoutFeature({ ms: 10000 })
      }
    })
  ]
})
log.onFailure(({ error }) => {
  globalThis.console.error(error)
})
log.log('info', 'request complete')
await log.flush()
await log.shutdown('manual')
```

The public option type is `IHttpPluginConfig`. The URL is passed unchanged to fetcher, which defaults to global fetch. An injected function accepts `(url, { method, headers, body, signal })` and returns a Promise of an ok/status/headers.get response. Host timeout and shutdown propagate through signal; custom fetchers should cooperate with cancellation.

Content-Type defaults to application/json. Custom headers can override it; a nonempty authToken then overrides Authorization with Bearer token. Headers are copied at creation. maxRetryAfterMs defaults to 30000 and must be finite and nonnegative.

The body is always `{ "entries": [...] }`. HTTP uses the host's shared entry projection: errors retain source/code/name/message/stack/cause/errors while raw and private Error fields stay off the wire. Ordinary business fields retain their structure. HTTP does not consume formatted text and skips the entire host format phase. Host plain/pretty/JSON formats do not change the wire. HTTP output features cannot include any format feature: the host rejects it at creation with logging/INVALID_OPTION. Gate and entry stages still execute.

Network failures, 429, and 5xx are retryable; other statuses are not. Attempts include the first request. Strict Retry-After supports nonnegative decimal seconds and all three HTTP date forms. A valid delay overrides normal backoff and is clamped by maxRetryAfterMs. Without retryFeature there are no hidden retries; without batchFeature there is no implicit batching; without timeoutFeature there is no separate request timer.

`LOG_HTTP_ERROR_SOURCE` is logging.http. `LogHttpErrorCode` contains TRANSPORT_UNAVAILABLE, SERIALIZE_FAILED, DELIVERY_FAILED, and INVALID_OPTION. Missing fetch capabilities and invalid maxRetryAfterMs fail synchronously at creation. Runtime delivery/serialization failures reach the host failure channel with native error types and reachable causes. Business log calls and flush do not rethrow delivery failures. When delivery and cleanup both fail, the original delivery error comes first in the error chain and drives retry classification. A 503 with cleanup failures still follows the configured retry policy. Cleanup after a successful 200 is reported once as host logging/DELIVERY_FAILED and never replays the request; timeout errors also belong to host logging. A scheduler must return its receipt before invoking the callback. Install the onFailure reporting behavior required by your application.

`features` uses the native plugin-host record form `{ alias: feature }`. Each feature is an opaque `defineFeature` token; the plugin installs it and exposes its controls as `http_alias_method` extensions on the host and plugin handle. Runtime state belongs to each installation. For example, a `threshold` alias exposes `http_threshold_setLevel`. Host-wide defaults are declared by a non-output `defineLogPlugin({ name, features })` from `@migaia/log-host/plugin`, passed in `createLogHost({ plugins: [...] })`; an output feature overrides only the same host-wide record key. Gates under different keys both apply. A repeated host-wide key is a conflict. At actual installation, each output checks the merged policies after key overrides: at most one format and one each of batch, retry and timeout, rejecting a collision with the existing `INVALID_OPTION`. `createLogHost({ features })` and feature arrays are no longer supported.
