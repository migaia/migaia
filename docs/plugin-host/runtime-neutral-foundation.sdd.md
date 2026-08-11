# SDD: PluginHost Runtime-Neutral 去冗余重构

- 状态：Proposed
- 范围：`packages/plugin-host`
- 所有者：`@migaia/plugin-host`
- 更新：2026-08-10

## 1. 目标与边界

`plugin-host` 是跨 Node、Bun、Deno、Browser、Worker、Electron 与小程序复用的插件基础层。生产源码只依赖 ECMAScript、`Map`/`Set`/`WeakMap`、`Promise`、`Proxy`、`Reflect`、`AggregateError`、console 与 timer；禁止 Node、Bun、Deno、DOM、Electron、Worker 或小程序专属 API。

本次重构的目标是减少重复 wrapper、明确生命周期所有权，并保持 `use`、`update`、`unUse`、pipeline、shared、config 与 `dispose` 的主要形状。当前不提供 `safeUse` 或 static global plugin API。`PluginHost` 只做 public facade、guard 与少量编排；生命周期、registry、pipeline、extension 和 disposal 由内部核心模块负责。实现规模以当前分层边界与测试契约为准，不再强制 150–250 行的行数目标。

## 2. 目标结构

```text
src/
  plugin-host.ts   # public facade、生命周期门禁、少量编排
  typing.ts        # public contract
  error-text.ts    # locale 与错误文案
  registry.ts      # instance/global Map、registration、scoped core
  lifecycle.ts     # install/update/unUse/dispose/scope/transaction
  disposal.ts      # 统一 LIFO cleanup
  extension.ts     # descriptor 安装与安全恢复
  pipeline.ts      # sync/async/generator runner 与 stage list
```

持久注册使用 `Map`；scope 只使用 owner stack；disposal 只使用一个 LIFO stack。不得重新引入只转发 Map 的 registry 类、重复 Proxy、重复 rollback helper 或 `resources[]`/`DisposalStack` 双轨。

测试必须全部放在 `packages/plugin-host/test/`，不得放入 `src/`。

## 3. 生命周期模型

```ts
type IHostStatus = 'active' | 'disposing' | 'disposed';
type IRegistrationStatus = 'installing' | 'active' | 'updating' | 'disposing' | 'disposed';
```

Host 只保留 status 与 single-flight `disposePromise`。registration 保留不可变 name snapshot、update/dispose promise、统一 disposal stack、extension/shared/config ownership 记录。

- `dispose()` 是主入口；`Symbol.asyncDispose` 只委托它。
- disposing/disposed 后 `use`、`update`、`unUse`、pipeline 注册和 `runPipeline` 都拒绝。
- update 按 registration 串行；update 内的 Host mutation 统一抛 `LIFECYCLE_MUTATION`，避免等待链死锁。
- install、update、dispose user code 都进入同一 ResourceScope；资源归属当前 registration。
- cleanup 每项都执行，失败聚合为 `AggregateError`。

## 4. Transaction 与 global registry

每次 `use` 使用调用局部 transaction，只记录本次创建的 registration；失败不得通过名称差集或 Host 共享字段回滚其他并发调用。plugin lifecycle hook 内禁止调用当前 Host 的 `use`、`unUse`、`config.update` 或 `dispose`；插件拓扑由应用组合层维护。

每个 constructor 使用一个 `Map<string, IGlobalPluginEntry>`：

```ts
type IGlobalPluginEntry =
  { readonly kind: 'plugin'; readonly definition: IPluginFactory } | { readonly kind: 'disabled' };
```

static batch use 先在临时 Map 校验后一次提交；disabled 是 Map entry，不使用 tombstone。Base/Child/Sibling 按祖先到子类覆盖；子类 `unUse` 只屏蔽自身分支。factory 每个 Host 创建新实例，并且返回 object 的 `name` 必须匹配注册名。factory 的 extension/shared 泛型必须贯通 static constructor 返回类型。

## 5. Extension、shared、config 与输入边界

- extension 以 descriptor snapshot 安装/恢复；只允许 configurable own data descriptor，拒绝 accessor 与 non-configurable descriptor；用户覆盖后的属性不会被 cleanup 删除。
- registration name snapshot 是唯一身份；插件运行时 name 变化不影响已登记身份，卸载仍按快照名称执行。
- shared/config 所有权统一读取当前 scope owner，不通过 Proxy 特判绕过。
- plugin name 必须为非空字符串。
- Host public config 只允许通过 `plugin.key` 或 `plugin.[index].key` 读取嵌套值；直接读取插件根配置或全量配置不提供支持。
- 配置读取只做一层浅拷贝，嵌套对象/数组保持原引用；配置不可变性由调用方负责，不由 PluginHost 承担深拷贝成本。
- `host.config` facade 在重复访问时复用同一对象；Host 进入 disposing/disposed 后，读取与更新统一拒绝。
- `shared()` 与 `install()` 必须返回 object；`install()` 可返回 Promise 或其他 awaitable 值。
- disposer 与 pipeline stage 必须是 function。

## 6. Pipeline 契约

保留 sync、async、generator 三种 mode。runner 不依赖 Host、registry、scope 或 locale。

- generator 只把最后一个 yield 或 return 值传给下游；`return undefined` 表示中止；中间 yield 不对外暴露。
- async stage 在 `next()` 后抛错时必须 observe 已启动的 downstream；两者失败抛 `AggregateError`。
- late/duplicate next 按既有稳定错误语义处理。
- sync、async、generator 在嵌套执行和 await/yield 期间均禁止注册新 stage；owner 只允许在 install 生命周期注册 stage/resource。

## 7. 验收边界

必须覆盖：并发 use 隔离、lifecycle mutation 拒绝、update/dispose 资源所有权、LIFO 全路径 cleanup 与聚合、async pipeline 双失败、non-configurable extension、dispose 后所有入口拒绝、连续 use 的 shared 类型、配置路径/浅拷贝/facade 生命周期、三种 pipeline 交叉注册、原型污染键、全量 runtime import purity、bundle 无 external import，以及 Node/Bun/Deno/Browser/Worker/Electron/mini-program consumer fixtures。

安装失败且回滚清理失败时使用独立 `PLUGIN_INSTALL_ROLLBACK_FAILED` 错误码；原始安装与清理错误保留在 `cause` 的 `AggregateError` 中。

验证命令：

```bash
npm run typecheck:consumers
cd packages/plugin-host
npm run typecheck
npm test -- --run
npm run build
npm pack --dry-run --json
```

当前实现已完成核心模块收敛与上述生命周期、配置、pipeline、构建产物和类型边界要求。
