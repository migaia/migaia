# @migaia/part-plugin-remote

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

Keeps a part host on the latest version of one catalog environment. It renders from the local cache first and checks for a new version with ETag in the background. A new version replaces the current one only after the delivery check and the install check pass; on failure the current version stays. An offline cold start uses the cache or a snapshot inlined at build time. Remote modules are downloaded and hash-checked before they run, at the trust tier the application configures.

## Start here

```ts
import * as partContract from '@migaia/part-contract'
import * as partHost from '@migaia/part-host'
import { forwardPartErrors, remotePlugin } from '@migaia/part-plugin-remote'

const remote = remotePlugin({
  service: 'https://catalog.example.com',
  project: 'orders',
  env: 'prod',
  manifest, // capability manifest exported by the client build
  shared: { '@migaia/part-host': partHost, '@migaia/part-contract': partContract },
  trust: { 'effects/audit.ts': { tier: 'isolated', grants: { state: ['page.audit'] } } },
  cache: storage.backend('indexed-db')
})
const host = await createPartHost({ plugins: [...appPlugins, remote], onError: forwardPartErrors(log) })
```

The plugin provides Feature `remote`: `ready()` completes once the first usable version is installed, `revalidate()` checks now, and `current()` returns the current `tag` and snapshot hash.

- **The application decides grants.** Tiers and grants a remote module writes for itself are ignored. A module without a `trust` entry runs at the restricted tier with no grants.
- **The isolated tier runs in a Worker.** Its effects reach the page over rpc for `resources.run`, `state.read`, `state.write` and `dispatch`; the host still refuses calls outside the grants.
- **The page CSP must allow `script-src blob:`.** Module bytes are imported through Blob URLs.

See [USEGUIDE.en.md](./USEGUIDE.en.md) for details.
