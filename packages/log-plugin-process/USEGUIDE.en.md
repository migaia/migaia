# Process guide

This package borrows a process capability for the logging lifecycle and requires the same version of `@migaia/log-host`. By default it uses the server process recognized by utils. Installation is inert when no process is available.

```ts
import { createLogHost } from '@migaia/log-host'
import { processPlugin } from '@migaia/log-plugin-process'

const log = createLogHost({
  plugins: [
    processPlugin({ captureCrashes: true, shutdownTimeoutMs: 3000, interceptProcessExit: false })
  ]
})
log.onShutdown(() => {
  log.log('info', 'closing')
})
```

`IProcessPluginConfig` also accepts process: an object with env, on, removeListener, and exit. Registration/removal uses the same event and listener identity. Exit retains the original object as its receiver. The caller owns the injected object and its original exit function.

Defaults are captureCrashes=true, shutdownTimeoutMs=3000, and interceptProcessExit=false. SIGINT/SIGTERM begin shutdown. With crash capture enabled, uncaughtException/unhandledRejection produce a fatal entry before shutdown. BeforeExit only waits for a bounded flush and never forces exit. Signal shutdown calls captured exit(0) after shutdown and core cleanup. Application onShutdown handlers may submit final logs.

Hosts sharing one process object share one listener group and must use matching captureCrashes, shutdownTimeoutMs, interceptProcessExit, and scheduler source. Different process objects remain isolated. Removing the last member removes listeners and permits reinstall. With exit interception enabled, the plugin waits for bounded flush, then calls the captured original function with its original receiver. Final removal restores exact function identity.

Partial installation rolls back every attempted registration in reverse order. One cleanup failure does not prevent remaining cleanup. The primary failure remains first; original Error/non-Error values, causes, and AggregateError.errors retain identity and order.

`LOG_PROCESS_ERROR_SOURCE` is logging.process. `LogProcessErrorCode` contains RUNTIME_SHUTTING_DOWN, PLUGIN_CONFIG_CONFLICT, PROCESS_INSTALL_ROLLBACK_FAILED, PLUGIN_UNINSTALL_CLEANUP_FAILED, and PLUGIN_SHUTDOWN_CLEANUP_FAILED. Installation conflicts and failures throw synchronously. Runtime failures reach host onFailure, and the host owns terminal reporting. Concurrent shutdown or flush events share in-flight work.
