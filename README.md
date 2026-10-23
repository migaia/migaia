<p align="center">
  <img src="./website/app/favicon.svg" width="48" height="48" alt="migaia" />
</p>

<h1 align="center">migaia</h1>

<p align="center">
  <strong>让异步代码在关闭、取消和崩溃时依然正确的 TypeScript 库。</strong>
</p>

<p align="center">
  <img alt="状态：预发布" src="https://img.shields.io/badge/%E7%8A%B6%E6%80%81-%E9%A2%84%E5%8F%91%E5%B8%83-orange" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-ESM-3178c6" />
  <img alt="运行时" src="https://img.shields.io/badge/%E8%BF%90%E8%A1%8C%E6%97%B6-%E6%B5%8F%E8%A7%88%E5%99%A8%20%7C%20Node%20%7C%20Bun%20%7C%20Deno%20%7C%20Worker-555" />
  <img alt="许可证：MIT" src="https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF%E8%AF%81-MIT-green" />
</p>

<p align="center">
  <a href="https://hk.vps.kaeo.app/migaia/zh/">文档站</a> ·
  <a href="#快速上手">快速上手</a> ·
  <a href="#包一览">包一览</a> ·
  <a href="#文档">文档</a> ·
  <a href="#参与开发">参与开发</a> ·
  <a href="./README.en.md">English</a>
</p>

---

异步程序里最难写对的往往不是业务本身，而是边缘时刻：服务停机时进行中的请求怎么办，慢请求的旧结果会不会盖掉新结果，Worker 里的计算能不能取消，后台任务崩溃后该不该重启、重启几次。

migaia 把这些规则做成一组小而独立的包。每个包只负责一件事，按需安装；它们共用同一套取消、清理和错误追踪约定，组合在一起时行为一致。

> [!WARNING]
> migaia 处于预发布阶段，版本号为 `0.0.x`，尚未发布第一个正式版本。在此之前，任何公开 API 都可能直接调整，不提供兼容层，也不单独记录破坏性变更。

## 特性

- **收尾有保证。** 资源按登记的相反顺序释放；某一项清理失败，其余照常释放，最初的错误不会被清理错误盖掉。重复调用关闭只执行一轮。
- **处处可取消。** 超时、重试、远程调用和数据加载都接受标准的 `AbortSignal`，取消后不会再有迟到的结果写回状态。
- **错误可追踪。** 包抛出的每个错误都带有 `source`（哪个包）和 `code`（哪种情况），原始错误保留在 `cause` 链上，不会因为层层包装而丢失。通过 RPC 跨线程、跨进程传递时，错误的类型、`code` 和 `cause` 链也会一起传过去。
- **一套代码，多处运行。** 大多数包不依赖 DOM 或 Node 专有 API，浏览器、Node、Bun、Deno 和 Worker 里行为一致。只服务某个平台的包会在 README 里写明。
- **只为用到的部分付费。** 包之间分层依赖，底层包不会拖进状态管理或 RPC 代码；所有包都声明无副作用，打包工具可以删掉没用到的导出。
- **类型完整。** 源码就是 TypeScript，类型声明随包发布，不需要另装 `@types`。

## 快速上手

### 1. 配置包源

所有包发布在 GitHub Packages 的 `@migaia` 作用域下。在项目的 `.npmrc` 中加入：

```ini
@migaia:registry=https://npm.pkg.github.com
```

GitHub Packages 安装时需要登录，令牌至少需要 `read:packages` 权限。请把令牌放在环境变量或用户目录的 `~/.npmrc` 中，不要提交到仓库。

### 2. 安装需要的包

```bash
pnpm add @migaia/lifecycle
```

它依赖的其他 `@migaia` 包会自动安装。

### 3. 写第一段代码

下面的代码登记两个资源，然后一起释放。后登记的先释放：HTTP 服务先关闭，数据库最后关闭，正在处理的请求不会因为数据库先断开而失败。

```ts
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()

app.own('database', { force: () => console.log('close database') })
app.own('http-server', { force: async () => console.log('close http-server') })

// 真实服务里写成：process.once('SIGTERM', () => void app.dispose())
await app.dispose()
```

输出：

```text
close http-server
close database
```

完整的优雅停机示例（停止接收新请求、限时等待进行中的请求、最后关闭连接池）见 [`@migaia/lifecycle` 的 README](./packages/lifecycle/README.md)。

## 包一览

不知道从哪个包开始？先看你遇到的问题：

| 你遇到的问题                                         | 从这里开始                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| 发布新版本时，进行中的请求被砍断，写了一半的数据丢失 | [`lifecycle`](./packages/lifecycle/README.md)                 |
| 搜索框显示旧结果：先发出的慢请求晚到，覆盖了新结果   | [`resource`](./packages/resource/README.md)                   |
| 后台任务崩溃后不停重启，一个坏配置拖垮整台机器       | [`supervision`](./packages/supervision/README.md)             |
| 计算挪到 Worker 后，取消和超时都失效了               | [`rpc-plugin-thread`](./packages/rpc-plugin-thread/README.md) |
| 插件装到一半失败，前面装好的插件没人回滚             | [`plugin-host`](./packages/plugin-host/README.md)             |
| 同一页面里几个微前端抢着改同一份状态                 | [`micro-hub`](./packages/micro-hub/README.md)                 |

<details open>
<summary><strong>收尾、取消与错误追踪</strong></summary>

| 包                                                                | 用来做什么                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`utils`](./packages/utils/README.md)                             | 为代码添加超时、取消与错误追踪，并处理常见的数据转换和对象更新。                                     |
| [`lifecycle`](./packages/lifecycle/README.md)                     | 让关闭、取消和替换在并发下也不出错：按顺序释放资源、只采用最新请求的结果、限时等待进行中的工作。     |
| [`supervision`](./packages/supervision/README.md)                 | 看管后台任务、子进程和线程：崩溃后间隔递增地重启，失败太多就停下，停止有时限，真正退出后才释放名额。 |
| [`event-subscriber`](./packages/event-subscriber/README.md)       | 在本地模块间订阅和广播事件，并协调同步或异步监听器的执行。                                           |
| [`middleware-pipeline`](./packages/middleware-pipeline/README.md) | 把处理步骤组合为同步、异步或生成器中间件管线，并在需要时提前结束或取消处理。                         |
| [`logger`](./packages/logger/README.md)                           | 将日志输出到控制台或服务，按需要过滤和格式化，并等待异步输出完成。                                   |

</details>

<details open>
<summary><strong>插件与功能开关</strong></summary>

| 包                                                | 用来做什么                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`capability`](./packages/capability/README.md)   | 按开关启停可选功能，为不同租户隔离功能开关，并按依赖启动和释放功能。                |
| [`plugin-host`](./packages/plugin-host/README.md) | 为库或应用安装和卸载插件，配置共享能力与处理步骤，并在安装失败时回滚。              |
| [`tray`](./packages/tray/README.md)               | 启动、查找、调用和重启一组插件宿主，包括 Node Worker 与子进程，并在退出时释放它们。 |

</details>

<details open>
<summary><strong>响应式状态</strong></summary>

| 包                                                          | 用来做什么                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`reactive`](./packages/reactive/README.md)                 | 让状态变化自动更新派生值和副作用，并为不同使用场景隔离状态。             |
| [`resource`](./packages/resource/README.md)                 | 随输入变化加载异步数据，取消过期请求、重试失败请求并刷新缓存。           |
| [`store-light`](./packages/store-light/README.md)           | 管理对象状态、异步数据和更新操作，让相关计算随字段变化自动更新。         |
| [`store-keyed`](./packages/store-keyed/README.md)           | 在独立作用域中按业务 key 管理状态，并只订阅需要的部分。                  |
| [`store-indexed`](./packages/store-indexed/README.md)       | 在对象、数组、Map 和 Set 中按键或索引订阅变化，让相关计算随集合更新。    |
| [`store-react`](./packages/store-react/README.md)           | 在 React 组件中使用 Store、Atom 与异步资源，并管理订阅和退出时的清理。   |
| [`store-middleware`](./packages/store-middleware/README.md) | 跟踪 Store 的状态与 action、约束写入规则，并接入 Redux DevTools。        |
| [`store-devtools`](./packages/store-devtools/README.md)     | 查看 Store 的状态与 action 历史，通过时间旅行和依赖树定位状态变化。      |
| [`store-persist`](./packages/store-persist/README.md)       | 自动保存和恢复对象、按键管理的状态与集合，并在版本变化时迁移已保存数据。 |
| [`store-ssr`](./packages/store-ssr/README.md)               | 隔离每个 SSR 请求的 Store 与 Resource，并将服务端初始状态恢复到浏览器。  |
| [`store-worker`](./packages/store-worker/README.md)         | 把耗时计算和数据编解码移到 Worker，并为请求使用取消、去重和缓存功能。    |
| [`store-shared`](./packages/store-shared/README.md)         | 让主线程与 Worker 共同读写同一组响应式 32 位整数状态。                   |
| [`store-wasm`](./packages/store-wasm/README.md)             | 在 WASM 中管理可订阅的数值、字符串、数组和记录状态。                     |

</details>

<details open>
<summary><strong>存储与编码</strong></summary>

| 包                                                          | 用来做什么                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| [`storage-contract`](./packages/storage-contract/README.md) | 为键值和记录存储定义统一接口，让应用可以接入不同存储后端。       |
| [`storage-web`](./packages/storage-web/README.md)           | 通过统一接口读写 Web Storage、cookie、IndexedDB 和内存中的数据。 |
| [`serialize`](./packages/serialize/README.md)               | 把应用数据编码为可存储或传输的格式，并在读取时解码。             |
| [`wasm`](./packages/wasm/README.md)                         | 分配可复用的字节缓冲区，并在 JSON 与 MessagePack 之间转码。      |

</details>

<details open>
<summary><strong>跨线程、跨进程、跨页面调用（RPC）</strong></summary>

RPC（远程过程调用）让你像调用本地函数一样调用另一个线程、进程或页面里的函数，并保留超时、取消和错误信息。

使用 `createRpcHost` 创建一个 host，选择一个传输 plugin，并按需叠加 features。连接、调用、流和释放由同一个 host 管理。

| 包                                                                    | 用来做什么                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`rpc-contract`](./packages/rpc-contract/README.md)                   | 为自定义 RPC 实现校验和编解码消息，让不同对端按同一协议通信。             |
| [`rpc-host`](./packages/rpc-host/README.md)                           | 跨运行时调用远程函数，并为调用设置超时、取消和流式结果处理。              |
| [`rpc-plugin-thread`](./packages/rpc-plugin-thread/README.md)         | 把重计算移到 Worker，并通过 RPC 调用、管理和重启线程。                    |
| [`rpc-plugin-process`](./packages/rpc-plugin-process/README.md)       | 在子进程或本机服务中运行隔离任务，并通过 RPC 调用和管理它们。             |
| [`rpc-plugin-pool`](./packages/rpc-plugin-pool/README.md)             | 将 RPC 调用分配到线程池或进程池，并用有限队列承接繁忙时的请求。           |
| [`rpc-plugin-browser`](./packages/rpc-plugin-browser/README.md)       | 在浏览器窗口、iframe、SharedWorker 与可靠有序的 WebRTC 通道之间调用函数。 |
| [`rpc-plugin-coroutines`](./packages/rpc-plugin-coroutines/README.md) | 在同一运行环境中监督协程任务，并通过同一个 host 调用。                    |
| [`rpc-plugin-devtools`](./packages/rpc-plugin-devtools/README.md)     | 采集、查询和录制 RPC 元数据，并查看多个宿主的时间线与调用统计。           |

</details>

<details open>
<summary><strong>微前端</strong></summary>

| 包                                            | 用来做什么                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`micro-hub`](./packages/micro-hub/README.md) | 为同一页面里的多个微前端应用提供共享状态、事件和请求。每份状态有明确的所有者，应用卸载时统一释放它登记的订阅和请求处理函数。 |

</details>

## 架构

包分成几层。上层可以依赖下层，下层从不依赖上层，所以只用底层包时不会顺带装进上层的代码。

```text
应用集成          micro-hub   tray
状态与存储适配     store-*     storage-web
RPC              rpc-host + rpc-plugin-{process,thread,browser,coroutines,pool,devtools}
插件与开关         plugin-host   capability
通用基础          reactive   resource   serialize   storage-contract   supervision
                 lifecycle   event-subscriber   middleware-pipeline
最底层            utils   wasm
```

`utils` 和 `wasm` 不依赖任何 `@migaia` 包。每个包实际依赖哪些包，以它的 `package.json` 为准。

## 运行环境

| 环境      | 要求                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| Node.js   | 18 及以上；`rpc-plugin-pool` 需要 24 及以上                                             |
| Bun、Deno | 当前稳定版本                                                                            |
| 浏览器    | 当前版本的主流浏览器；各包 README 会注明额外要求，例如 `SharedArrayBuffer` 需要跨源隔离 |
| 模块格式  | 只发布 ESM，用 `import` 引入                                                            |

## 文档

| 文档     | 位置                                                         | 内容                                                                                  |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| README   | `packages/<包名>/README.md`                                  | 这个包解决什么问题，一段可以直接运行的入门代码，为什么选它                            |
| USEGUIDE | `packages/<包名>/USEGUIDE.md`                                | 按场景组织的完整用法，每个场景都有代码和输出                                          |
| 文档站   | [hk.vps.kaeo.app/migaia](https://hk.vps.kaeo.app/migaia/zh/) | 所有包的指南和 API 参考，可以搜索。源码在 `website/`，本地预览运行 `pnpm website:dev` |

每份文档都有英文版，文件名后缀为 `.en.md`。

## 参与开发

工具版本固定在 [`mise.toml`](./mise.toml) 中：Node 24、pnpm 和 Bun（文档站使用）。

```bash
mise install
```

```bash
pnpm install
```

日常开发只检查你改动的包。根目录为每个包提供了 `@<包名>` 快捷命令，按“格式化 → lint → 测试”的顺序运行：

```bash
pnpm @lifecycle fmt
```

```bash
pnpm @lifecycle lint
```

```bash
pnpm @lifecycle test
```

开始之前请读一遍 [AGENTS.md](./AGENTS.md)，代码约定都在那里。几条最容易踩的：

- **不要在根目录直接运行全量构建。** 三十多个包同时构建会耗尽内存。需要构建多个包时，用 `--workspace-concurrency` 限制并发数。
- **耗时命令要经过独占窗口脚本** `scripts/exclusive-window.mjs`，包括完整测试、构建和基准测试，避免多个任务同时抢占机器。
- **测试放在各包的 `test/` 目录**，不和源码混放。跨 RPC 包的集成测试在私有包 `packages/rpc-integration` 中。
- **新错误先登记错误码再抛出。** 每个包在 `src/error-code.ts` 中集中声明自己的错误码。
- **提交信息使用 [Conventional Commits](https://www.conventionalcommits.org/)**，例如 `fix(lifecycle): ...`。

## 许可证

所有包均以 MIT 许可证发布，以各包 `package.json` 中的 `license` 字段为准。
