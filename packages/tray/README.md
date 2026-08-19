# `@migaia/tray`

Static, runtime-neutral composition root over [`@migaia/capability/graph`](../capability/README.md). Tray admits complete entries and exposes values only after Graph readiness; Graph owns lifecycle, primary release, and auxiliary ownership.

```ts
import { createTray } from '@migaia/tray';

const tray = createTray([{ key: 'config' as never, kind: 'value', start: () => ({ value: {}, release: () => undefined }) }]);
await tray.ready();
tray.get('config' as never);
await tray.dispose();
```

Tray core supports same-realm static composition only. Dynamic, notification, domain, and cross-realm behavior belong to [`tray-domain-adapters.sdd.md`](../../docs/tray/tray-domain-adapters.sdd.md) and [`capability-graph-cross-realm.sdd.md`](../../docs/capability/capability-graph-cross-realm.sdd.md); hard termination belongs to the deferred realm-host adapter, not Tray.
