# Process 使用指南

本包将宿主 process 作为借用能力接入日志生命周期，与相同版本的 `@migaia/log-host` 使用。默认从 utils 识别到的服务端宿主读取 process；没有宿主能力时安装为空操作。

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

`IProcessPluginConfig` 还接受 process：具有 env、on、removeListener、exit 的对象。on/removeListener 必须针对同一事件与函数身份注册/移除，exit 保留该对象作为 receiver。注入对象与原始 exit 方法都由调用方拥有，本插件不会替换成另一进程对象。

默认 captureCrashes=true、shutdownTimeoutMs=3000、interceptProcessExit=false。SIGINT/SIGTERM 启动关闭；uncaughtException/unhandledRejection 在启用崩溃捕获时先产生 fatal 条目再关闭。beforeExit 只做受预算限制的 flush，不强制 exit。信号路径在关闭与 core 清理后调用捕获的 exit(0)。应用的 onShutdown 可以提交最终日志。

相同 process 对象共享一组监听器，要求 captureCrashes、shutdownTimeoutMs、interceptProcessExit 和 scheduler 来源一致。不同 process 对象互不冲突。最后一个使用者移除后撤销监听，之后可重新安装。显式拦截 exit 时，插件等待受限 flush 后以捕获的原函数与原 receiver 调用；最后移除恢复原函数身份。

安装与清理按资源所有权管理：部分注册失败会逆序回滚所有已尝试的监听；一个清理错误不会跳过其它资源。primary 错误保持首位，原 Error、非 Error 值、cause 和 AggregateError.errors 的身份/顺序保持可追溯。

`LOG_PROCESS_ERROR_SOURCE` 为 logging.process；`LogProcessErrorCode` 包含 RUNTIME_SHUTTING_DOWN、PLUGIN_CONFIG_CONFLICT、PROCESS_INSTALL_ROLLBACK_FAILED、PLUGIN_UNINSTALL_CLEANUP_FAILED、PLUGIN_SHUTDOWN_CLEANUP_FAILED。安装冲突/失败同步抛出；运行期失败进入 host 的 onFailure，终端报告由 host 统一处理。并发同类关闭或 flush 共用进行中的工作。
