# 使用手册

本文是 `@migaia/capability` 的完整参考手册。先看 [README.md](./README.md#5-五分钟上手) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲"是什么、为什么用、5 分钟怎么跑起来"，本文讲"每一个状态、每一个 API、每一种边界行为"。

## 目录

1. [导入](#1-导入)
2. [状态机](#2-状态机)
3. [开关快照与 fail-closed](#3-开关快照与-fail-closed)
4. [Generation：竞态与作废的激活](#generation-races)
5. [完整 API 参考](#5-完整-api-参考)
6. [释放顺序与依赖](#6-释放顺序与依赖)
7. [错误处理](#7-错误处理)
8. [重入与并发保护](#8-重入与并发保护)
9. [完整组合示例](#9-完整组合示例)
10. [常见问题排查](#10-常见问题排查)

---

## 1. 导入

```ts
import {
  createCapabilityHost,
  type ICapabilityDefinition,
  type ICapabilityEnableResult,
  type ICapabilityHandle,
  type ICapabilityHost,
  type ICapabilityHostOptions,
  type ICapabilityState
} from '@migaia/capability';
```

本包不依赖 Store、React 或运行时全局对象；它复用 `@migaia/lifecycle` 的竞态/排空原语和 `@migaia/utils`。可以在任意支持 ESM 的 JS 环境中使用。

---

## 2. 状态机

`ICapabilityState` 是以下五个字符串之一：

| 状态 | 含义 | 进入条件 |
| --- | --- | --- |
| `off` | 开关允许，但尚未启用 | 注册时开关为 `true`；或开关从 `false` 变为 `true`；或成功 `disable()` 后（开关仍为 `true`） |
| `gated` | 开关明确拒绝 | 注册时开关不为 `true`；或 `setFlag`/`setFlags` 把某能力移出允许表 |
| `activating` | `activate()` 正在执行，尚未 settle | 调用 `enable()` 且当前不是 `on` |
| `on` | 已启用，持有一个有效 handle | `activate()` 成功返回合法 handle，且期间没有被回退作废 |
| `failed` | 上一次激活失败，或激活期间自身资源清理失败 | `activate()` 抛错、返回值不是带 `dispose()` 的对象；或代数匹配下的 release 出错 |

把 `off` 和 `gated` 分开是有意为之：控制台和调用方不会把"从未尝试启用"误报成"被灰度策略拦截"——两者的排查方向完全不同。

`state(name)` 对未注册的名字抛出 `capability "${name}" is not registered`；不要用 try/catch 探测名字是否存在，先看 `names`。

---

## 3. 开关快照与 fail-closed

`createCapabilityHost(context, options)` 在创建时对 options 做 admission snapshot（AF-86）：`flags`、`onError` 及其 receiver 只从这一份快照取得，之后修改或替换传入的 options 对象不会改变 host 行为。`options.flags` 只在**创建时**被复制一份快照，必须调用 `setFlag()`/`setFlags()` 才能改变开关。

复制逻辑只接受**自有、可枚举、值严格等于 `true` 的数据属性**：

- 继承属性（原型链上的）一律不算允许，即使值是 `true`。
- getter 属性完全不会被求值——host 只读取属性描述符（`Object.getOwnPropertyDescriptors`），不触发用户代码，避免配置对象的 getter 在构造 host 或热回退期间执行任意代码。
- `__proto__`、`constructor` 这类危险键名只是 `Map` 里的普通字符串键，不会污染原型链。

`setFlags(flags)` 是**原子替换整份快照**：新快照里没列出的能力一律按拒绝处理，不会保留旧快照里残留的 `true`——这是为了让"远端配置删掉一个键"能够可靠地收回权限。如果传入的 `flags` 对象本身不可安全读取（比如一个在 `ownKeys` 陷阱里抛错的 `Proxy`），host 会**先**整体回退到"全部拒绝"的空快照，**再**把原始错误重新抛给调用方——不会因为配置读取失败就继续沿用上一份允许表。

`setFlag(name, false)` 本身就是一次原子回退：它会同步作废该能力的在途激活并释放已有 handle，调用方不需要再额外调用一次 `disable()`。`setFlag(name, true)` 只是把开关打开，**不会自动启用**——启用仍然由调用方决定时机，调用 `enable(name)`。

---

<a id="generation-races"></a>

## 4. Generation：竞态与作废的激活

每个已登记的能力内部有一个 `generation` 计数器，每次 `setFlag(false)`、`setFlags()` 使某能力被拒绝、或 `dispose()` 整体关闭时递增。

异步 `activate()` 完成时会比较"发起时的 generation"和"当前 generation"：

- 一致 → 正常提交，`state` 变为 `on`，handle 生效。
- 不一致（说明激活过程中开关被关掉了）→ **不采纳这个结果**，刚创建出的 handle 会被立即释放，`enable()` 返回 `false`/`{ status: 'cancelled' }` 语义。

这就是"关闭一个能力"和裸的动态 import 之间的本质区别：没有这层保护，一个正在加载的 chunk 完成后会直接把开关"偷偷"打开，用户看到的是"明明关了，过几百毫秒又自己回来了"。

**LIFO 释放顺序按的是真实激活完成顺序，不是注册顺序，也不是调用 `enable()` 的顺序**——三者在并发激活下会分叉。比如先后调用 `enable('A')`、`enable('B')`，如果 B 的 `activate()` 先 resolve（比如没有 I/O），它会先进入激活顺序表，回退时反而先于 A 释放。这本身没问题：真正互相依赖的两个能力，调用方必须自己 `await enable('A')` 完成后再 `enable('B')`——这样 A 保证先进入顺序表，"后进先出"就自然等价于"先释放依赖 A 的 B，再释放 A"。

本包**不提供** `dependsOn` 声明，也不会把所有 `activate()` 调用强制串行化——一个被 `setFlag(false)` 废弃、永不 settle 的 `activate()` 会连带卡死排在它后面的每一个 `enable()`。需要严格顺序保证的调用方必须显式 `await`，host 不会替你保证。

---

## 5. 完整 API 参考

### 类型

| 类型 | 定义 | 说明 |
| --- | --- | --- |
| `ICapabilityHandle` | `{ dispose(): void \| PromiseLike<void> }` | 能力持有的资源句柄，唯一约束是必须有 `dispose()`；`activate()` 的返回值不满足此形状会被当作 `failed`。 |
| `ICapabilityState` | `'off' \| 'gated' \| 'activating' \| 'on' \| 'failed'` | 见 [§2](#2-状态机)。 |
| `ICapabilityEnableResult` | `{ status: 'enabled' } \| { status: 'gated' } \| { status: 'cancelled' } \| { status: 'failed'; error: unknown }` | `enable()`/`enableResult()` 的返回值。 |
| `ICapabilityDefinition<Context, Handle>` | `{ name: string; activate(context: Context): Handle \| Promise<Handle> }` | `register()` 的入参；`activate` 允许异步，正是为了按需加载增强能力时那个 chunk 不进初始包。 |
| `ICapabilityHostOptions` | `{ flags?: Readonly<Record<string, boolean>>; onError?: (name: string, error: unknown) => void }` | `createCapabilityHost()` 的第二个参数。 |
| `ICapabilityHost<Context>` | 见下表 | `createCapabilityHost()` 的返回值。 |

### `createCapabilityHost<Context>(context, options?): ICapabilityHost<Context>`

`context` 是所有 `activate()` 共享的应用上下文对象，按引用传入且不会被冻结——只放调用能力确实需要的东西（Store、配置、telemetry），host 本身不会读取或修改它。

### Host 方法

| API / 签名 | 参数 | 返回值 | 同步/异步 | 作用 |
| --- | --- | --- | --- | --- |
| `register(definition)` | `ICapabilityDefinition<Context, Handle>` | `void` | 同步 | 登记一个能力定义。同名重复登记抛 `capability "${name}" is already registered`；`name` 非字符串/空字符串或 `activate` 非函数抛 `TypeError`。登记时会对 `definition` 做一次快照（冻结 `{ name, activate }` 并保留方法风格的 `this.name`），之后调用方再修改原始 `definition` 对象不会影响已登记的身份。 |
| `names` | 无 | `readonly string[]` | 同步 | 只读属性，当前已登记的全部名字。 |
| `state(name)` | `string` | `ICapabilityState` | 同步 | 查询状态；未注册抛错。 |
| `handle<Handle>(name)` | `string` | `Handle \| undefined` | 同步 | 已启用能力的 handle；未启用返回 `undefined`。 |
| `error(name)` | `string` | `unknown` | 同步 | 上一次激活或释放失败的原因；成功重启或重新配置会清除。 |
| `setFlag(name, enabled)` | `string`, `boolean` | `void` | 同步 | 更新单个开关。`enabled !== true` 一律视为拒绝（不接受 truthy，只接受严格 `true`）。 |
| `setFlags(flags)` | `Readonly<Record<string, boolean>>` | `void` | 同步 | 原子替换整份快照，见 [§3](#3-开关快照与-fail-closed)。 |
| `enable(name)` | `string` | `Promise<ICapabilityEnableResult>` | 异步 | 幂等启用：并发调用共享同一次 `activate()`。开关为假时直接返回 `{ status: 'gated' }`，不会"偷偷打开"。 |
| `enableResult(name)` | `string` | `Promise<ICapabilityEnableResult>` | 异步 | 当前是 `enable()` 的别名，语义完全一致。 |
| `disable(name)` | `string` | `Promise<boolean>` | 异步 | 关闭并等待 handle 的 `dispose()`（含异步）真正完成后再 resolve；返回是否确实关掉了一个此前处于启用/在途状态的能力。 |
| `dispose()` | 无 | `Promise<void>` | 异步 | 唯一异步释放入口：首次调用按真实激活顺序反向（LIFO）关闭全部能力并等待全部释放工作结束；完成前重复调用立即以 `HOST_TRANSITIONING` 拒绝，完成后返回首个 canonical Promise。 |
| `enableLegacyBoolean(name)` | `string` | `Promise<boolean>` | 异步 | 语义与 `enable()` 相同，但只返回布尔值，用于接入尚未迁移到结构化结果的旧调用点。 |
| `disableNow(name)` | `string` | `boolean` | 同步 | 同步版本：立即触发关闭和释放，但**不等待**异步 `dispose()` 完成即返回；确定要等清理完成用 `disable()`。 |
| `disposed` | 无 | `boolean`（只读） | 同步 | host 是否已经整体关闭；`true` 之后所有变更类方法都会抛错或拒绝。 |

`enable()`/`enableResult()`/`enableLegacyBoolean()` 三者共享同一个内部实现和同一个 `pending` Promise：并发对同一名字调用 `enable()` 和 `enableLegacyBoolean()`，实际只会跑一次 `activate()`。

---

## 6. 释放顺序与依赖

- `dispose()` 按**真实激活完成顺序**反向（LIFO）释放，具体规则见 [§4](#generation-races)。
- `setFlags()` 替换快照导致的批量回退，同样按这个顺序释放；`disable(name)` 只影响单个条目，不触碰其余能力的顺序表位置。
- 单个能力释放失败（`dispose()` 抛错或拒绝）不会阻断其余能力继续关闭（AF-81）——LIFO 回退路径必须能走完，一个失败不能连累其它已启用能力泄漏；清理结束后 host/disposed/state 必须收敛，不残留 `activating`/`on` 假状态。
- `dispose()` 之后 `disposed` 变为 `true`，host 永久不可用：`register`/`setFlag`/`setFlags` 直接抛错，`enable` 类方法返回被拒绝的 Promise（错误信息 `capability host is disposed`）。不要把同一个 host 复用给下一次请求或下一个租户，需要新的一轮应该创建新的 host。

---

## 7. 错误处理

`activate()` 抛错，或返回值不是"带 `dispose` 函数的对象"（比如返回 `null`、返回一个没有 `dispose` 方法的对象），都会让能力进入 `failed` 态：

```ts
host.register({
  name: 'worker',
  activate: async () => {
    throw new Error('chunk 404');
  }
});

await host.enableLegacyBoolean('worker'); // false
host.state('worker'); // 'failed'
String(host.error('worker')); // 包含 'chunk 404'
```

`options.onError?.(name, error)` 会在以下场景被调用，且**永远不会**反过来影响能力的生命周期状态（即便 `onError` 自己抛错或返回被拒绝的 Promise，也会被 host 自己兜住，不会向上冒泡）：

- 激活失败（`activate()` 抛错或返回无效 handle）。
- 已有 handle 的 `dispose()` 抛错或返回的 Promise 被拒绝——包括"过期代数"的清理失败：一个已经被替换掉的旧 handle 在后台迟迟才完成清理并失败，这类失败仍会上报，但**不会**污染当前正在使用的新一代 handle 的状态。
- 一个手写的、非标准 `then` 实现（比如跨 iframe/VM 的 thenable，或者 `then` 是一个会抛错的 getter）在被当作 Promise 处理时出错，也会被安全地转换成一次 `onError` 调用，不会变成未处理的 rejection。

`error(name)` 返回的是**当前这一代**的失败原因；只要该能力后续成功重新激活，或被显式重新配置（比如 `setFlag(name, false)` 之后再打开），`error(name)` 就会被清空。

---

## 8. 重入与并发保护

- **变更类方法之间互斥**：`register`/`setFlag`/`setFlags`/`disableNow`（及其别名 `disable`/`dispose` 触发的同步阶段）内部通过一个"事务深度"计数器互相保护——在这些方法内部（例如一个能力自己的 `dispose()` 回调）再去调用任何一个变更方法，会立即抛出 `capability host cannot mutate during a lifecycle transition`。这防止了"回退过程中被自己的清理逻辑打乱开关快照"这类难以复现的 bug。
- `enable()`/`enableLegacyBoolean()` 在重入时不会同步抛错（它们是 async 语义），而是返回一个带上述错误信息的被拒绝 Promise。
- **Round26 breaking change**：disposer 在同步释放阶段调用同一 host 的 `dispose()` 时，立即同步抛出带 `HOST_TRANSITIONING` 的错误；调用延迟到当前栈之后时，也立即返回带 `HOST_TRANSITIONING` 的 rejected Promise。旧行为让所有进行中的调用复用首个 Promise；新行为禁止任何进行中的重复调用加入该 Promise，避免 disposer 自等待死锁。
- 外部并发调用方必须保留并等待首次 `dispose()` 返回的 Promise；首次 Promise 完成后，重复 `dispose()` 才返回同一个已完成的 canonical Promise。不要用第二次调用来“加入”正在进行的释放。
- `dispose()`/`disable()` 内部用"循环直到稳定"的方式等待清理完成：因为一次释放本身可能在等待期间又产生新的、此前快照里不存在的释放任务（比如一个仍在进行中的激活，在 `disposeSync()` 跑完之后才拿到 handle，随即需要被就地释放），单次 `await` 可能错过这类"迟到"的清理工作。`disable()`/`dispose()` 都会持续等到与该能力（或整个 host）相关的在途激活和在途释放都清零为止才真正 resolve。

---

## 9. 完整组合示例

按开关加载一个持久化能力，演示懒加载、启停、以及整体收尾：

```ts
import { createCapabilityHost } from '@migaia/capability';

const capabilities = createCapabilityHost(
  { store },
  {
    flags: { persistence: true },
    onError: (name, error) => reportError(name, error)
  }
);

capabilities.register({
  name: 'persistence',
  async activate({ store }) {
    // 只有开关打开、真正 enable() 时才会下载这个 chunk
    const { persist, memoryStorage } = await import('@migaia/store-persist');
    const handle = persist(store, { key: 'settings', storage: memoryStorage() });
    return { dispose: () => handle.dispose() };
  }
});

const result = await capabilities.enable('persistence');
if (result.status === 'enabled') console.log('持久化已启用');

await capabilities.disable('persistence');
await capabilities.dispose();
```

多租户隔离——每个租户一个独立 host，互不可见：

```ts
function createTenantCapabilities(tenant: string, flags: Record<string, boolean>) {
  const host = createCapabilityHost({ tenant }, { flags });
  host.register({
    name: 'experimental-ai',
    activate: async ({ tenant }) => {
      const controller = await connectAiSidecar(tenant);
      return { dispose: () => controller.close() };
    }
  });
  return host;
}

const acme = createTenantCapabilities('acme', { 'experimental-ai': true });
const globex = createTenantCapabilities('globex', { 'experimental-ai': false });

await acme.enable('experimental-ai'); // { status: 'enabled' }
await globex.enable('experimental-ai'); // { status: 'gated' }
```

---

## 10. 常见问题排查

**Q：`enable()` 返回 `{ status: 'gated' }`，但我确实在 `flags` 里传了 `true`。**
检查是不是在 `createCapabilityHost()` 之后又修改了传入的原始 `flags` 对象——host 只在创建时复制一份快照，之后必须调用 `setFlag()`/`setFlags()` 才会生效。另外确认值是严格的布尔 `true`，字符串 `'true'` 或数字 `1` 都不算。

**Q：关掉一个能力之后，过了一会儿它又自动变成 `on` 了。**
正常情况下不应该发生——这正是 generation 机制要防止的竞态（见 [§4](#generation-races)）。如果观察到这个现象，检查是否绕过了 host 直接持有并调用了 `activate()` 的返回值，或者在能力的 `dispose()` 里手动调用了 `enable()`（这类重入会被 [§8](#8-重入与并发保护) 描述的机制直接拒绝，但请确认没有捕获这个拒绝并静默重试）。

**Q：`disableNow()` 之后资源好像还没释放干净。**
`disableNow()` 是同步兼容接口，只是**触发**了 `disable()`，不等待异步清理完成。如果 handle 的 `dispose()` 是异步的，需要用 `disable()`/`dispose()` 的 Promise 版本并 `await`。

**Q：`setFlags({})` 之后所有能力都被关掉了，但我只想改一个。**
`setFlags()` 是整份快照的原子替换，不是"打补丁"。只想改一个开关用 `setFlag(name, enabled)`；确实要批量替换，记得把所有仍需保留的能力都显式列进新快照。

**Q：为什么错误信息里都是 `` 前缀，这个包不是叫 `capability` 吗？**
这是历史遗留的前缀（本包是从更大的 store 相关代码中拆分出来的独立包），不影响任何行为；用 `error(name)`/`onError` 拿到的错误对象，按信息里的关键字（如 `"is not registered"`、`"already registered"`）匹配即可，不需要关心前缀本身。

**Q：能不能声明能力之间的依赖关系，让 host 自动按顺序启停？**
不能，这是本包刻意不做的事，见 [§4](#generation-races) 末尾的说明。有依赖关系的能力，调用方自己 `await enable('A')` 完成后再 `enable('B')` 即可获得正确的启停顺序。

## 11. 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
