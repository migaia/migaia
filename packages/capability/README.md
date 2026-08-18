# @migaia/capability

**可选功能的运行时开关和生命周期管理器。** 一个应用里总有些功能是"按需要才启用"的：离线持久化、实验性 AI 面板、协作 Worker 连接——这些功能开着的时候要占资源（网络连接、订阅、内存），关着的时候最好连代码都不下载。`@migaia/capability` 就是管这件事的最小闸门：登记一个能力定义，用开关决定它能不能启用，启用/关闭都走同一套状态机，资源释放不用自己攒一遍模板代码。

## 1. 这是什么

在这个库出现之前，"关闭一个能力"通常只有一个笨办法：**不 import 它**。于是能力的粒度被绑死在打包粒度上——同一份构建里做 A/B 灰度、按租户开关某个功能、线上出问题不重新部署就回退，全都做不到。

`createCapabilityHost()` 建一个"能力容器"：你把每个可选功能包成 `{ name, activate(context) }` 登记进去，容器负责这三件事——

1. **懒加载**：开关关着时代码不该被下载。`activate()` 允许是 `async`，里面 `await import()` 就行；加载完成前开关又被关掉这种竞态，容器帮你处理，不用每个调用点各写一遍。
2. **启停生命周期**：启用给出一个 `{ dispose() }` handle；关闭必须真释放（持久化有 I/O 连接，Worker 有端口）；激活失败要留在关闭态，不能"半开"。
3. **按租户/按开关隔离**：同一进程里两份 host 互不可见，各自的开关表、各自的资源。

它**不能**给的东西也要说清楚：不会让一个"静态 import 进来"的能力自动变免费。体积只在 `activate()` 内部用动态 `import()` 时才真的省下来——容器把这个写法变成一等公民，但省体积的是打包器，不是容器本身。

## 2. 适合什么场景 / 不适合什么场景

| 场景 | 建议 |
| --- | --- |
| 灰度发布、按租户开关某个功能 | 每个租户创建独立 host，用 `setFlags()` 同步远端开关表 |
| 需要代码分包，关闭时不下载对应 chunk | 在 `activate()` 内 `await import()`；静态 import 不会减少初始包体积 |
| 能力持有连接/订阅等需要释放的资源 | 返回带 `dispose()` 的 handle，交给 host 统一在关闭时释放 |
| 一次性业务动作（比如"发一次通知"） | **不适合**，直接调用函数更简单，不需要一整套状态机 |
| 需要能力之间强依赖顺序（A 必须先于 B） | 本包**不提供**依赖图，调用方需要自己显式 `await enable('A')` 再 `enable('B')` |

## 3. 用了之后能得到什么

- **幂等的启停**：并发调用 `enable()` 共享同一次 `activate()`，不会重复启动；`disable()` 只在确实关掉了一个启用态能力时才返回 `true`。
- **竞态不会让关掉的东西自己回来**：异步 `activate()` 还没跑完，开关就被关掉——迟到的结果会被就地释放，而不是"晚几毫秒又亮起来"。
- **失败不会卡在半开状态**：`activate()` 抛错或返回的 handle 无效，能力直接进入 `failed` 态，`error(name)` 能查到原因，不会留下一个看似启用、实际没有 handle 的假状态。
- **安全默认拒绝的开关表**：只有严格等于 `true` 的自有数据属性才会被当作"允许"；继承属性、getter、`__proto__` 这类都不生效，配置来源不可信时也不会被绕过。
- **两条 API 轨道**：`enable`/`disable`/`dispose` 返回结构化结果并等待异步清理完成；`enableLegacyBoolean`/`disableNow` 是同步/布尔风格的兼容适配器，接旧调用点不用重写。`dispose()` 首次调用发布唯一完成 Promise；完成前的重复调用 fail-fast 为 `HOST_TRANSITIONING`，完成后才恢复幂等 Promise。
- **租户互不可见**：不同 host 实例的 context、开关表、状态机完全独立。

## 4. 安装

```bash
pnpm add @migaia/capability
```

## 5. 五分钟上手

```ts
import { createCapabilityHost } from '@migaia/capability';

// context 是所有 activate() 共享的应用上下文，按需要放东西即可
const capabilities = createCapabilityHost(
  { userId: 'demo' },
  { flags: { greeting: true } } // 开关表：只有列出且为 true 的能力可以被启用
);

capabilities.register({
  name: 'greeting',
  activate(ctx) {
    const timer = setInterval(() => console.log(`hi, ${ctx.userId}`), 1000);
    return { dispose: () => clearInterval(timer) };
  }
});

const result = await capabilities.enable('greeting');
console.log(result); // { status: 'enabled' }

await capabilities.disable('greeting'); // 关闭并等待 dispose() 完成
await capabilities.dispose(); // 整个 host 收尾，之后不可再用
```

## 6. 核心概念速览

| 概念 | 是什么 |
| --- | --- |
| **Host** | `createCapabilityHost()` 创建的容器，持有登记表、开关快照与每个能力的状态机 |
| **Capability（能力）** | 用 `register()` 登记的一个可选功能定义：`{ name, activate(context) }` |
| **Flag（开关）** | host 内部的允许表，决定某个能力当前能不能被 `enable()` |
| **Handle** | `activate()` 返回的对象，唯一约束是必须有 `dispose()` |
| **State（状态）** | `off` / `blocked` / `activating` / `on` / `failed` 五态之一 |
| **Generation（激活代数）** | 每次开关变化或回退时递增的计数器，用来识别并丢弃"已经作废"的激活结果 |

## 7. API 一览

| 分组 | 成员 | 一句话 |
| --- | --- | --- |
| 登记 | `register` / `names` | 登记能力定义；查看已登记名单 |
| 开关 | `setFlag` / `setFlags` | 更新允许表，决定谁能被启用；关闭会同步作废在途激活并释放 handle |
| 结构化生命周期 | `enable` / `enableResult` / `disable` | 推荐使用，返回结构化结果并等待异步清理完成 |
| 兼容适配器 | `enableLegacyBoolean` / `disableNow` | 旧调用点用的同步/布尔风格接口，不等待异步清理 |
| 状态查询 | `state` / `handle` / `error` / `disposed` | 只读查询，不触发任何副作用 |
| 整体回收 | `dispose` | 按真实启用顺序反向（LIFO）关闭全部能力 |

`dispose()` 是 Round26 的显式 breaking behavior change：旧行为会让进行中的重复调用共享首个 Promise；新行为要求外部并发调用方保留并等待首个 Promise，完成前再次调用会立即以 `HOST_TRANSITIONING` 拒绝。这样 disposer-origin 调用不会把 host 卡在自等待循环中。

每个成员的精确签名、参数和边界行为见 [USEGUIDE.md](./USEGUIDE.md)。

## 8. 最容易踩的坑

1. **`setFlags()` 替换的是整份快照**，未列出的能力一律按拒绝处理，不是"维持原状"——远端配置删掉一个键，旧的 `true` 不会残留。
2. **本包不维护依赖图**。能力 A 依赖 B 时，必须显式 `await enable('A')` 完成后再 `enable('B')`，不能指望声明顺序或注册顺序。
3. **兼容适配器不等待异步清理**：`enableLegacyBoolean`/`disableNow` 是同步/尽快返回的接口；确定要等 `dispose()` 完全跑完，用 `enable`/`disable`/`dispose`。
4. **`dispose()` 之后 host 永久不可用**，不要把同一个 host 实例复用给下一个租户或下一次请求。
5. **能力自己的 `dispose()` 里不能再调用 `setFlag`/`enable` 等变更方法**——重入会立即抛错，防止回退过程中状态被自己写乱。
6. **不要在首次 `dispose()` 完成前再次调用 `dispose()`**——包括 disposer 延迟回调；重复调用会以 `HOST_TRANSITIONING` 立即拒绝。外部并发调用方必须保留并等待首次返回的 Promise。

## 9. 深入参考

完整类型定义、状态机每一态的转移条件、开关快照的 fail-closed 细节、竞态与激活代数的具体保证、释放顺序、错误处理与重入保护、以及更贴近生产的组合示例，见 **[USEGUIDE.md](./USEGUIDE.md)**。
