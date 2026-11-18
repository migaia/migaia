# @migaia/part-host

part 平台的运行时宿主，建立在 `@migaia/plugin-host` 与 `@migaia/reactive` 之上：装配插件、装载蓝图、执行配置增强、维护作用域状态与推导、调度 effect，并通过渲染槽位交给渲染插件。它不依赖 DOM 或任何 UI 框架。

## 从这里开始

```ts
import { createPartHost, defineEffect, definePart, definePartPlugin } from '@migaia/part-host'

const plugin = definePartPlugin({
  name: 'orders',
  parts: [definePart({ id: 'button@1' })],
  effects: [defineEffect({ id: 'open-detail@1', run: (event, ctx) => ctx.state.write('page.detail', event.detail) })]
})

const host = await createPartHost({ plugins: [plugin] })
const { tree, issues } = await host.blueprint.load(blueprint)
```

`load` 先运行 authored 规则，再按 tag 执行增强器，最后运行 resolved 规则；有 error 时 `tree` 为 `undefined`。`patch` 接收 JSON Patch，只对受影响的地址重新增强。

## 定义

- `definePart`：组件结构、行为配置组、事件、slot、style hooks。
- `defineEnhancer`：按 tag 的纯配置转换，顺序由 `after` 决定，成环在安装时拒绝。
- `defineDerive`：纯推导，写状态会抛 `DERIVE_WRITE`。
- `defineEffect`：事件订阅调用的副作用；同一 effect 按到达顺序串行，`ctx.dispatch` 只入队。
- `defineResource`：带参数、结果和命令 schema 的 PH Feature。

## 接线

插件之间只通过 PH 的 `getFeature` 引用：`partCorePlugin.getFeature('catalog' | 'state' | 'effect' | 'diagnostics' | 'renderSlot' | …)`。渲染插件在安装时把工厂登记到 `renderSlot`；`host.mount(target, blueprintId)` 为每次挂载创建一个渲染实例。

运行期错误只经 `diagnostics` 报告一次，交给 `createPartHost({ onError })`。`dispose()` 幂等，返回 plugin-host 的释放结果。

## 错误码（source `part.host`）

`CATALOG_CONFLICT`、`ENHANCER_CYCLE`、`ENHANCER_MUTATED_INPUT`、`DERIVE_WRITE`、`EFFECT_FAILED`、`RENDERER_MISSING`、`RENDERER_DUPLICATE`、`HOST_DISPOSED`、`BLUEPRINT_UNKNOWN`。插件安装期间的错误由 plugin-host 包装为 `PLUGIN_INSTALL_FAILED`，原错误在 `cause`。
