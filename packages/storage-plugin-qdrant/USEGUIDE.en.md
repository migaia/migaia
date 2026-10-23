# Using the native Qdrant ports

## Borrow an SDK client

```ts
import { QdrantClient } from '@qdrant/js-client-rest'
import { qdrantClientHttp } from '@migaia/storage-plugin-qdrant/client'

const client = new QdrantClient({ url: 'http://127.0.0.1:6333' })
const http = qdrantClientHttp(client)
console.log(await http.getVersion())
```

Install the real `@qdrant/js-client-rest` version 1.11 or later. Only `/client` accesses the SDK. The HTTP entry uses runtime `fetch`.

## Failure semantics

HTTP 4xx responses produce `QDRANT_REQUEST_FAILED`; network and service failures produce `QDRANT_UNAVAILABLE`; malformed responses produce `QDRANT_RESPONSE_INVALID`. The adapter retains complete responses, native status, and cause without logging API keys. Unconfirmed writes are never retried automatically.

The HTTP port forwards cancellation to native fetch. The borrowed SDK controls its own timeout and cancellation support. Without a per-request signal port, its actual request must settle.

For a non-waiting snapshot, SDK 1.11 throws `QdrantClientUnexpectedResponseError` on HTTP 202. The adapter retains that cause and reports `QDRANT_RESPONSE_INVALID`. The operation may already be accepted and must not be replayed automatically. This SDK exception retains only potentially truncated response text, without status or complete response properties. Use the HTTP port when complete response evidence is required.
