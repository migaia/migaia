# @migaia/part-plugin-remote

[English](./README.en.md) · [使用手册](./USEGUIDE.md)

让 part 宿主从目录服务拿到某个环境的最新版本：先用本地缓存渲染，后台按 ETag 检查新版本；新版本通过下发检查和安装检查后才替换当前版本，失败时保留当前版本。离线冷启动用缓存或构建时内联的快照。远端模块先下载、核对哈希，再按应用配置的信任档执行。

## 从这里开始

```ts
import * as partContract from '@migaia/part-contract'
import * as partHost from '@migaia/part-host'
import { forwardPartErrors, remotePlugin } from '@migaia/part-plugin-remote'

const remote = remotePlugin({
  service: 'https://catalog.example.com',
  project: 'orders',
  env: 'prod',
  manifest, // 客户端构建导出的能力清单
  shared: { '@migaia/part-host': partHost, '@migaia/part-contract': partContract },
  trust: { 'effects/audit.ts': { tier: 'isolated', grants: { state: ['page.audit'] } } },
  cache: storage.backend('indexed-db')
})
const host = await createPartHost({ plugins: [...appPlugins, remote], onError: forwardPartErrors(log) })
```

插件提供 Feature `remote`：`ready()` 在首个可用版本装好后完成，`revalidate()` 立刻检查一次，`current()` 返回当前版本的 `tag` 与快照哈希。

- **授权由应用决定。** 远端模块自己写的信任档和授权一律无效；`trust` 中没有条目的模块按受限档、无授权处理。
- **隔离档在 Worker 中运行。** effect 只能经 rpc 回到页面调用 `resources.run`、`state.read`、`state.write`、`dispatch`，越权仍由宿主拒绝。
- **页面 CSP 要允许 `script-src blob:`。** 模块字节经 Blob URL 导入。

详细用法见 [USEGUIDE.md](./USEGUIDE.md)。
