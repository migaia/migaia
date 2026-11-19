# `@migaia/part-plugin-remote` 使用手册

## 启动顺序

1. 读缓存里的上一个可用快照。有就装入；它引用的模块字节也从缓存取，不访问网络。
2. 缓存没有或装入失败时，装入 `fallback`（构建时内联的快照字节）。
3. 两者都没有时等待第一次拉取。拉取失败时 `ready()` 以 `REMOTE_FETCH_FAILED` 拒绝。
4. `ready()` 完成后，后台请求 `GET <service>/p/<project>/env/<env>/snapshot`，带 `If-None-Match` 与读令牌（有的话）。

之后在 `revalidateMs`（默认 300000）定时、页面变为可见、调用 `revalidate()` 时重新检查。同一时刻只有一个请求，后来的调用等待同一个结果。`304` 什么也不做；`200` 对响应字节算哈希，进入安装。读令牌不要打进公开包：生产客户端应使用在目录服务中设为公开读取的环境。

## 安装一个版本

1. 解析快照；
2. 下发检查：`lock.definitions` 中的每个 id 要么在 `manifest` 里，要么由快照的远端模块导出，否则以 `REMOTE_VERSION_REJECTED` 拒绝，错误上带 `tag` 与 `missing`；
3. 调用 `chunks` 中被引用的 part 的加载函数并等待；
4. 取得模块字节（先缓存后网络），核对 `integrity`（SHA-384）与 `id`（SHA-256），不符时以 `REMOTE_MODULE_INTEGRITY` 拒绝；
5. 先把全部隔离模块一次交给 Worker，再把全部远端定义作为一个插件 `remote:modules` 安装或替换；
6. 逐份 `host.blueprint.update`。宿主在这一步运行已安装的全部规则，有 error 即失败。

第 5、6 步失败时，已更新的蓝图恢复为旧文档，`remote:modules` 换回旧版本（首次安装时移除），Worker 重新装入旧的隔离模块。拒绝只经宿主诊断报告一次，当前版本不变。成功后快照与模块字节写入缓存，旧版本独有的模块键被删除，`host.diagnostics.setContext({ version, snapshot })` 更新。

快照不再包含某份已装入的蓝图时，插件不卸载它，卸载挂载由应用负责。

## 信任档

| 档位 | 运行位置 | ctx |
|---|---|---|
| `page` | 页面 | 完整 ctx |
| `restricted`（默认） | 页面 | 受授权检查的 ctx，`features` 与 `models` 为空对象 |
| `isolated` | Worker | 只有 `resources.run`、`state.read`、`state.write`、`dispatch`；Worker 中 `state.read` 返回 Promise |

隔离模块只能导出 effect。Worker 默认由 `new URL('./browser/isolated-worker.js', import.meta.url)` 创建，应用打包器需要产出这个文件；也可以用 `isolatedWorker` 选项自己创建。隔离模块不能导入 `react`。

## 编辑器预览

`loadRemoteModules(host, refs, { base, token, shared, trust })` 取得、核对并导入 `refs`，用同名模块覆盖 `remote:modules` 中的当前项，其余项保留。`remoteModulesPlugin(entries)` 构造该插件，它的 Feature `remoteModules` 的 `current()` 返回当前模块集合。`loadRemoteModules` 只为隔离模块放占位定义，不启动 Worker。

## 生产报错

`forwardPartErrors(log)` 返回 `createPartHost({ onError })` 用的函数。每个报告写一条 log-host `error` 日志：`{ address, version, snapshot, source, code, message }`，不含配置值。`log` 需要装 `levelPlugin()`。

## 错误码

domain `part.remote`：`REMOTE_VERSION_REJECTED`、`REMOTE_MODULE_INTEGRITY`、`REMOTE_FETCH_FAILED`、`REMOTE_ISOLATED_EFFECT_MISSING`（Worker 收到当前表中已删除的 effect，宿主以 `EFFECT_FAILED` 结束该运行）。

## 构建与验证

```bash
pnpm --filter @migaia/part-plugin-remote run fmt
pnpm --filter @migaia/part-plugin-remote run lint
pnpm --filter @migaia/part-plugin-remote run typecheck
pnpm --filter @migaia/part-plugin-remote run test
```

测试在 Chromium 中运行；全局准备在 Node 中用 `partom remote build` 构建夹具模块，并启动一个假目录服务。
