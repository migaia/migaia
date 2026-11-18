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

## 插件替换与卸载

- `host.use(plugin)` 安装插件；它提供的部件、规则和实现进入目录。
- `host.replace(name, next)` 用新一代插件替换同名插件，依赖它的插件由 plugin-host 重启。
- `host.unUse(name)` 卸载插件。被挂起的依赖插件，其目录条目标记为不可用；结果里的 `errors` 也经 `onError` 报告。
- `host.dispose()` 幂等，返回 plugin-host 的释放结果；之后的调用抛 `HOST_DISPOSED`。

## 错误码

source 为 `part.host`：`CATALOG_CONFLICT`、`ENHANCER_CYCLE`、`ENHANCER_MUTATED_INPUT`、`DERIVE_WRITE`、`EFFECT_FAILED`、`RENDERER_MISSING`、`RENDERER_DUPLICATE`、`HOST_DISPOSED`、`BLUEPRINT_UNKNOWN`。插件安装期间的错误由 plugin-host 包装为 `PLUGIN_INSTALL_FAILED`，原错误在 `cause`。

## 构建与验证

```bash
pnpm --filter @migaia/part-host run fmt
pnpm --filter @migaia/part-host run lint
pnpm --filter @migaia/part-host run typecheck
pnpm --filter @migaia/part-host run test
```
