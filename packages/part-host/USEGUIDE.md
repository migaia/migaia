# `@migaia/part-host` 使用手册

[English](./USEGUIDE.en.md)

包的定位见 [README](./README.md)。宿主不依赖 DOM 或 UI 框架；要渲染时再装 `@migaia/part-plugin-dom` 和一个渲染插件（如 `@migaia/part-plugin-react`）。

## 按场景查找

| 你遇到的问题                                 | API                                | 看这一节                                                       |
| -------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| 装载蓝图并拿到问题清单                       | `createPartHost`、`blueprint.load` | [装载蓝图](#装载蓝图)                                          |
| 编辑器改一个字段，不想整棵树重算             | `blueprint.patch`                  | [只重算改动的地址](#只重算改动的地址)                          |
| 让所有按钮自动带上团队默认配置               | `defineEnhancer`                   | [用增强器补默认配置](#用增强器补默认配置)                      |
| 一个值由其他状态算出                         | `defineDerive`                     | [由状态推导值](#由状态推导值)                                  |
| 点击后请求接口、写状态                       | `defineEffect`                     | [事件触发副作用](#事件触发副作用)                              |
| 列表行里的点击要知道是哪一行                 | `IEffectEvent.rowKey`              | [列表行事件](#列表行事件)                                      |
| 弹层打开时 `aria-expanded` 跟着变            | `behavior.aria.fromState`          | [由状态派生 aria](#由状态派生-aria)                            |
| 列表从接口取数，带加载、空、出错状态         | `defineResource`、`host.resources` | [数据资源与模型](#数据资源与模型)                              |
| 购物车、会话用自己的 store，界面直接读写它 | `defineStateStore`、`composeStore` | [接入自己的 store](#接入自己的-store)                          |
| 在 effect 里得到地址和状态路径的类型提示     | `IPartTypeRegistry`                | [生成的类型](#生成的类型)                                      |
| 卸载一个插件，依赖它的部件暂时不可用         | `host.unUse`                       | [插件替换与卸载](#插件替换与卸载)                              |

## 装载蓝图

```ts
import { createPartHost, definePart, definePartPlugin } from '@migaia/part-host'

const app = definePartPlugin({ name: 'orders', parts: [definePart({ id: 'button@1' })] })
const host = await createPartHost({ plugins: [app], onError: (error) => console.error(error) })
const { tree, issues } = await host.blueprint.load(blueprint)
if (tree === undefined) console.table(issues)
```

`load` 依次运行 authored 规则、按 tag 执行增强器、运行 resolved 规则。只要有 error 级问题，`tree` 为 `undefined`，`issues` 合并了两个阶段的问题且不重复。规则集是 `@migaia/part-contract/doctor` 的全部内置规则加上插件 `rules`，宿主不提供关闭内置规则的选项。

## 只重算改动的地址

```ts
await host.blueprint.patch('orders', [
  { op: 'replace', path: '/root/children/0/facets/props/label', value: '刷新' }
])
```

`patch` 接收 JSON Patch。宿主只对受影响的地址重新增强，已挂载的渲染器只收到变化的节点。

## 用增强器补默认配置

增强器是按 tag 的纯函数：输入是冻结的配置，返回新配置；修改输入会抛 `ENHANCER_MUTATED_INPUT`。多个增强器用 `after` 排序，成环在安装时抛 `ENHANCER_CYCLE`。`writes` 声明会写入的字段，规则在 authored 阶段把它们视为已提供。

```ts
import { defineEnhancer } from '@migaia/part-host'

const defaultSize = defineEnhancer({
  id: 'orders.default-size@1',
  targets: ['button'],
  writes: ['props.size'],
  transform: (config) => ({ ...config, props: { size: 'sm', ...config.props } })
})
```

## 由状态推导值

推导是纯计算，在 `{ $derive: 'id' }` 绑定处使用；写状态会抛 `DERIVE_WRITE`。同一批状态写入只重算一次。

```ts
import { defineDerive } from '@migaia/part-host'

const total = defineDerive({
  id: 'orders.total@1',
  compute: (state) => (state.read('page.rows') as { amount: number }[]).reduce((sum, row) => sum + row.amount, 0)
})
```

## 事件触发副作用

蓝图里的事件订阅指向一个 effect。同一 effect 按到达顺序串行执行；`ctx.dispatch` 只入队，不会在当前 effect 内重入。effect 抛错时宿主经 `onError` 报告一次（`EFFECT_FAILED`，原错误在 `cause`）。effect 需要的服务用 `deps` 声明为 PH Feature 引用，运行时从 `ctx.features` 取得。

```ts
import { defineEffect } from '@migaia/part-host'

const reload = defineEffect({
  id: 'reload@1',
  deps: { api: apiPlugin.getFeature('api') },
  run: async (_event, ctx) => ctx.state.write('page.rows', await ctx.features.api.listOrders())
})
```

## 列表行事件

模板宿主用 `template: { rowKey, rows, node }` 声明重复的子树。行内节点的地址是 `<模板节点地址>@row:<行键>`。`host.dispatch` 收到这种地址时，用模板节点上的订阅，并把行键交给 effect：

```ts
const remove = defineEffect({
  id: 'remove-row@1',
  run: (event, ctx) => {
    const rows = ctx.state.read('page.rows') as { id: string }[]
    ctx.state.write('page.rows', rows.filter((row) => row.id !== event.rowKey))
  }
})
```

DOM 插件在模板宿主元素上只挂一个委托监听，不随行数增加。

## 由状态派生 aria

part 在 `behavior.aria` 里写 `{ fromState: '状态名' }`。宿主把它解析成状态路径，放在解析节点的 `ariaStates` 上：蓝图里该状态名的 prop 是 `{ $state }` 绑定时用绑定路径，否则用 `part.<地址>.<状态名>` 并以字面量（或 `false`）作初值。渲染器追踪读取这些路径，状态变化时只更新对应的 `aria-*` 属性。

```ts
definePart({
  id: 'disclosure@1',
  behavior: { states: { names: ['expanded'] }, aria: { expanded: { fromState: 'expanded' } } }
})
```

## 自定义修饰符与片段

`defineModifier` 定义事件修饰符，由 DOM 插件在监听函数里按订阅顺序执行：

```ts
const confirm = defineModifier({
  id: 'confirm@1',
  eventKinds: ['dom'],
  placement: false,
  create: () => ({ handle: (event, next) => { if (window.confirm('确定？')) next() } })
})
```

`handle(event, next, element)` 不调用 `next` 即拦下事件；`next` 每个事件只生效一次，可以晚一些调用（例如防抖）；`next(detail)` 替换 effect 收到的 detail。`placement: true` 的修饰符必须提供 `place(element, args)` 决定监听位置，两者不一致时抛 `MODIFIER_PLACEMENT_MISMATCH`。带 `args` schema 的修饰符在装载时校验参数，失败记为 `event.modifier-args` 问题。

`defineFragment` 定义可复用的蓝图片段：

```ts
const card = defineFragment({
  id: 'card@1',
  args: z.object({ title: z.string() }),
  slots: ['body'],
  node: { tag: 'box@1', children: [{ tag: 'text@1', id: 'heading', facets: { props: { text: { $param: 'title' } } } }, { $slot: 'body' }] }
})
```

蓝图里 `tag: 'card@1'` 的节点就是使用点，`facets.props` 是参数，`facets.slots` 填插槽。装载时先展开片段，再校验参数（失败记为 `fragment.args` 问题），然后运行规则和增强。补丁落在使用点上时，只重算这个使用点展开出的节点；替换片段定义时，只重算用到它的使用点。片段成环、过深或过大时 `load` 直接抛错。

两者都经 `definePartPlugin({ modifiers, fragments })` 登记，冲突与替换规则与 part 相同。

## 数据资源与模型

`defineResource` 声明一个数据资源：参数与结果的 schema、依赖的 Feature（`deps`）、加载函数 `load(params, { features, signal })`，以及可选的缓存键 `key`、额外失效标签 `tags`、空结果判断 `isEmpty`、分页 `paging` 和命令 `commands`。资源经 `definePartPlugin({ resources: [...] })` 登记。

```ts
const orders = defineResource({
  id: 'orders@1',
  params: z.object({ status: z.string() }),
  deps: { http: httpPlugin.getFeature('http') },
  load: (params, { features, signal }) => features.http.request({ path: '/orders', query: params, signal }),
  commands: {
    create: { args: z.object({ customer: z.string().min(1) }), run: (args, { features }) => features.http.request({ method: 'POST', path: '/orders', body: args }) }
  }
})
```

每个宿主有一份资源仓库（`host.resources`，effect 里是 `ctx.resources`）。同一资源加同一组参数是一个缓存条目：第一次被观察时开始加载（`loading`），成功后是 `ready` 或 `empty`，失败是 `error` 且保留上一次的数据；刷新时状态不变、`refreshing` 为 `true`，被取代的加载会被中止，迟到的结果被丢弃。`watch(binding)` 观察一个 `{ $resource, params }` 绑定：参数里的 `$state` 变化时自动换到新条目，新条目首次加载期间继续显示旧数据；`read()` 没有副作用，可以在渲染时调用；用完调用 `release()`。命令 `run(id, command, args)` 成功后按标签（默认是资源名）刷新相关条目；`invalidate(tags)` 手动失效。提供资源的插件被替换、挂起或卸载时，相关条目作废，观察会自动重新订阅，资源不存在时快照为 `RESOURCE_UNKNOWN` 的出错状态。

`definePartPlugin({ models: [...] })` 登记 `defineModel` 定义的模型；`host.models.validate(id, value)`（effect 里是 `ctx.models`）用模型的 schema 校验，返回 `ok` 与按字段路径的问题列表。`host.state.seed(path, value)` 只在该路径从未被写过时写入，适合初始状态。

## 接入自己的 store

状态路径的第一段是命名空间。`page`、`section`、`part` 由宿主自带的默认 store 保存；其他命名空间由插件登记的 store 提供，值始终留在你的 store 里，宿主只为被读过的路径保留缓存和 reactive 版本号，用来通知绑定、推导和资源参数。

```ts
import { createPartHost, definePartPlugin, defineStateStore } from '@migaia/part-host'

const items = new Map<string, unknown>([['items', []]])
const cart = defineStateStore<Map<string, unknown>>({
  namespace: 'cart',
  create: () => items,
  get: (map, key) => map.get(key),
  set: (map, key, value) => {
    map.set(key, value)
    if (key === 'items') {
      map.set('count', (value as unknown[]).length)
      return ['count']
    }
  }
})
const host = await createPartHost({ plugins: [definePartPlugin({ name: 'cart', stores: [cart] })] })
host.state.write('cart.items', ['a'])
host.state.read('cart.count') // 1：`set` 返回了 count，写入当下就比较并更新
```

- **key：** store 收到的 key 不带命名空间（`cart.items.0` 的 key 是 `items.0`）。key 之间的关系由 store 自己说明：`set` 返回受这次写入影响的其他 key。
- **引用契约：** 值变了，`get` 必须返回新引用；值没变，应返回同一个引用。原地修改值的 store（mobx 式）要在 `get` 里返回副本或快照；每次都返回新副本的 store 要提供结构比较的 `equals`，否则每次比较都判为变化。
- **绕过宿主的写入：** 提供 `subscribe(handle, listener)` 时，宿主在 `create` 后立即订阅；`listener(keys)` 只比较这些 key，`listener()` 比较全部被读过的 key。也可以在 `create(ctx)` 里保存 `ctx.invalidate`，外部改完后调用。两者都没有时，外部写入不会显示。同一微任务内的多次通知合并为一次比较。
- **相等判断：** 先 `Object.is`，不同才调用比较器；`equalsBy` 按 key 前缀选比较器，最长前缀优先。比较器必须同步；抛错或返回 Promise 时报 `STATE_EQUALS_FAILED` 并按“已变化”处理。相等时保留旧值。
- **默认 store 的比较：** 插件以 `stores: [defaultStateStore({ equals, equalsBy })]` 为 `page`、`section`、`part` 设置比较器（`equalsBy` 的键是完整路径前缀，如 `page.form`）；一个宿主只允许一个插件这样做。
- **异步：** `create`、`get`、`set`、`has`、`dispose` 都可以返回 Promise。`ctx.state.status(path)` 与 derive 里的 `state.status(path)` 给出 `idle`/`loading`/`ready`/`error` 与 `refreshing`；`ctx.state.load(path)` 等待调用之后的第一次读取。读取或写入失败分别报 `STATE_STORE_READ_FAILED`、`STATE_STORE_WRITE_FAILED`，缓存保留旧值。
- **中间件：** `composeStore(store, m1, m2)` 按 m1 → m2 → store 调用；中间件只返回它覆盖的函数和自己的 `dispose`，释放顺序为 m1、m2、store。
- **句柄：** 效果的 ctx 上没有句柄。需要句柄的本地插件在 `deps` 里引用 `partCorePlugin.getFeature('stateStores')`，调用 `handle(namespace)`。
- **未登记的命名空间：** 显式读写抛 `STATE_NAMESPACE_UNKNOWN`；渲染、derive 和资源参数读到 `undefined`，每段未登记期间只报告一次。

## 生成的类型

`partom types` 生成的 `.d.ts` 会填充 `IPartTypeRegistry`。之后 `ctx.state.read(path)`、`ctx.dispatch(address, event, detail)`、`ctx.part(address).dispatch(...)` 与 `host.resources` 的方法都会检查地址、状态路径、事件 `detail` 和资源参数；没有生成文件时，这些参数都是普通字符串和 `unknown`。

## 插件替换与卸载

- `host.use(plugin)` 安装插件；它提供的部件、规则和实现进入目录。
- `host.replace(name, next)` 用新一代插件替换同名插件，依赖它的插件由 plugin-host 重启。
- `host.unUse(name)` 卸载插件。被挂起的依赖插件，其目录条目标记为不可用；结果里的 `errors` 也经 `onError` 报告。
- `host.dispose()` 幂等，返回 plugin-host 的释放结果；之后的调用抛 `HOST_DISPOSED`。

## 远端下发与开发态检查用到的宿主接口

- **装入新版本：** `host.blueprint.update(document)` 比较新旧版本，只重算配置组或子节点列表变化的地址（以及增删节点的父地址）；根节点 tag 变化时全量重算；新版本有 error 时当前版本保持不变；没有装入过的 id 等同 `load`。
- **能力清单：** `host.catalog.manifest(build)` 返回 `{ format: 1, build, definitions, renderers }`，列出当前可用的全部定义（暂停插件的不计入）与渲染器名，供客户端下发校验使用。
- **effect 信任档：** `restricted` 档 effect 的 ctx 只有 `resources.run`、`state.read/write`、`dispatch`、`part()`，`features` 与 `models` 为空；可用的命令与状态路径前缀写在定义的 `meta['part.grants']`（`{ resources: ['orders@1:create'], state: ['page.form'] }`），由安装它的插件决定，越权以 `EFFECT_FORBIDDEN` 拒绝并报告一次。`isolated` 档交给 `effect` Feature 上 `setIsolatedRunner` 登记的执行器，没有执行器时以 `EFFECT_ISOLATION_UNAVAILABLE` 拒绝。
- **诊断上下文：** `host.diagnostics.setContext({ version, snapshot })` 之后，`onError(error, info)` 的第二个参数为 `{ address?, context }`，错误对象本身不变。
- **开发态追踪：** 核心 Feature `trace` 提供 `steps`、`events`、`addresses`、`resolved`、`subscribe`。只有在 `development` 条件下（vitest、`bun build --conditions=development`、Vite 开发服务器）才记录；生产构建（`bun build --production` 或 `NODE_ENV=production`）解析到空实现，产物中没有记录代码。推导重算记在 `$derive:<推导 id>` 下。
- **替换定义：** `host.replace` 或 `unUse` 改变推导、增强器或 effect 后，缓存的推导结果作废、用到增强器的地址重新增强、下一次 effect 运行用新定义。

## 错误码

source 为 `part.host`：`CATALOG_CONFLICT`、`ENHANCER_CYCLE`、`ENHANCER_MUTATED_INPUT`、`DERIVE_WRITE`、`EFFECT_FAILED`、`RENDERER_MISSING`、`RENDERER_DUPLICATE`、`HOST_DISPOSED`、`BLUEPRINT_UNKNOWN`、`MODIFIER_PLACEMENT_MISMATCH`、`RESOURCE_UNKNOWN`、`RESOURCE_COMMAND_UNKNOWN`、`MODEL_UNKNOWN`、`ARGS_INVALID`、`EFFECT_FORBIDDEN`、`EFFECT_ISOLATION_UNAVAILABLE`。插件安装期间的错误由 plugin-host 包装为 `PLUGIN_INSTALL_FAILED`，原错误在 `cause`。

## 构建与验证

```bash
pnpm --filter @migaia/part-host run fmt
pnpm --filter @migaia/part-host run lint
pnpm --filter @migaia/part-host run typecheck
pnpm --filter @migaia/part-host run test
```
