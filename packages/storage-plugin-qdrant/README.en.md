# Native Qdrant protocol ports

Use `fetchHttp(url, apiKey?)` from `/http`, or `qdrantClientHttp(client)` from `/client`, to access the finite native Qdrant interface. The caller owns the SDK client and its lifetime. The adapter does not change its configuration.

```ts
import { fetchHttp } from '@migaia/storage-plugin-qdrant/http'

const http = fetchHttp('http://127.0.0.1:6333')
const version = await http.getVersion()
console.log(version)
```

Native methods retain SDK parameter and result shapes and accept an optional operation context last. Writes do not follow redirects or replay. Protocol failures carry the `storage.backend.qdrant` identity and retain the original error chain.
