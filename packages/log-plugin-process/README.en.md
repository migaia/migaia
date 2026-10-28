# @migaia/log-plugin-process

Process signals, crash capture and graceful shutdown for the matching `@migaia/log-host` version. The process capability can be injected per plugin.

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { consolePlugin } from '@migaia/log-plugin-console'
import { processPlugin } from '@migaia/log-plugin-process'

const log = createLogHost({
  plugins: [levelPlugin(), consolePlugin(), processPlugin()]
})
log.onShutdown(() => {
  log.info('shutdown started')
})
log.info('ready')
```

Hosts sharing the same process object share one listener set. Different objects have independent groups. Removing the last member releases the group's listeners without closing the borrowed process capability.

Defaults enable crash capture, allow 3000ms for graceful work, and leave `process.exit` unchanged. `SIGINT`/`SIGTERM` start a shared shutdown; `beforeExit` only waits for flushing. A host without a process capability installs no listeners.

Members of the same process group must use compatible configuration and the same scheduler source. Failed installation rolls back attempted listener registrations, and cleanup failures retain original error identity and order. See the [usage guide](./USEGUIDE.en.md) for options and error codes.
