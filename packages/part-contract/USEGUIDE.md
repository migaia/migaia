# `@migaia/part-contract` 使用手册

[English](./USEGUIDE.en.md)

包的定位见 [README](./README.md)。本包只有纯数据与纯函数，下面的示例在 Node、Bun、浏览器中都能运行。

## 按场景查找

| 你遇到的问题                           | API                                 | 看这一节                                                       |
| -------------------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| 编辑器保存前确认蓝图结构合法           | `parseBlueprint`                    | [保存前确认蓝图结构合法](#保存前确认蓝图结构合法)              |
| 在服务端和编辑器里给出同一份问题清单   | `createRuleEngine`、`builtinRules`  | [在任何环境给出同一份问题清单](#在任何环境给出同一份问题清单)  |
| 声明数据模型、资源绑定与表单字段       | `defineModel`、`checkModels`        | [声明数据模型、资源绑定与表单字段](#声明数据模型资源绑定与表单字段) |
| 把团队约定写成规则                     | `defineRule`                        | [把团队约定写成规则](#把团队约定写成规则)                      |
| 从地址找到节点，包括列表行             | `createAddressIndex`、`resolveAddress` | [从地址找到节点](#从地址找到节点)                           |
| 用 zod 定义参数，同时得到 JSON Schema  | `toCatalogSchema`、`assertNoTransform` | [用校验库定义参数](#用校验库定义参数)                       |

## 保存前确认蓝图结构合法

蓝图是 JSON。`parseBlueprint` 检查结构（`id`、`version`、每个节点的 `tag`、`facets`、`children`、`template`），并检查同一父节点下没有重复地址；通过后返回深度冻结的副本，失败抛 `BLUEPRINT_INVALID` 或 `ADDRESS_DUPLICATE`。它不查目录，所以不知道 tag 是否存在；那是规则的工作。

```ts
import { parseBlueprint } from '@migaia/part-contract'

const blueprint = parseBlueprint({
  id: 'orders',
  version: 1,
  root: {
    tag: 'page@1',
    id: 'orders',
    children: [
      { tag: 'button@1', id: 'refresh', facets: { events: { click: { handler: 'reload@1' } } } }
    ]
  }
})
```

## 在任何环境给出同一份问题清单

规则引擎接收规则列表和目录视图。目录视图只有三个方法：`get(id)` 返回描述符，`majors(name)` 返回可用的主版本，`writesFor(tag)` 返回增强器声明会写入的字段。宿主、CLI 和编辑器都实现这个视图，所以它们看到的问题相同。

```ts
import { createRuleEngine } from '@migaia/part-contract'
import { builtinRules } from '@migaia/part-contract/doctor'

const engine = createRuleEngine({ rules: builtinRules, catalog })
for (const issue of engine.run('authored', blueprint))
  console.log(issue.severity, issue.rule, issue.address, issue.path)
```

`authored` 检查原始蓝图，`resolved` 检查增强后的蓝图。`authored` 阶段把增强器 `writes` 声明的字段当作已提供，所以“必填 prop 由增强器补上”不会误报。一条规则抛错时，引擎记一条 `RULE_FAILED` 问题，原错误在 `cause` 上，其他规则照常运行。

内置 36 条规则覆盖 html、aria、slot、catalog、style、event、flow、behavior、layout、resource、field。例如：

- `event.modifier-exists`、`event.modifier-kind`、`event.modifier-placement`、`event.modifier-duplicate`：引用的修饰符必须在目录中；修饰符必须声明了所订阅的事件种类（组件回调不接受修饰符）；一个订阅至多一个改变监听位置的修饰符，模板行上一个都不行；同一订阅中同一 id 只能出现一次。
- 片段：`expandFragments(blueprint, catalog)` 把 tag 指向片段的节点替换为片段子树，用使用点的 props 代入 `{ $param }`，把插槽填充放到 `{ $slot }` 位置；插槽节点保留作者写的地址 `<使用点>/slot.<名>/<段>`。它报告 `fragment.param-missing` 与 `fragment.slot-unknown`，并抛出 `FRAGMENT_CYCLE`、`FRAGMENT_TOO_DEEP`（16 层）与 `FRAGMENT_TOO_LARGE`（10000 个节点）。
- `behavior.no-zindex`：蓝图不能直接写 `z-index`，层级由 `behavior.layer` 决定。
- `layout.single-main`、`layout.region-unknown`、`layout.size-range`：一份蓝图只能有一个最外层布局（嵌在别的布局区域里的布局不算），因为只有最外层布局的 `main` 区域会成为页面的 `main` 地标；蓝图只能往布局已有的区域里放内容；`props.sizes` 只能给可调区域设初始宽度，且必须在该区域的 `min`、`max` 之间。

## 声明布局

布局是带 `behavior.layout` 的 part。区域就是插槽，蓝图用 `facets.slots.<区域名>` 往里放内容。每个区域声明地标（决定渲染成 `header`、`nav`、`main`、`aside`、`footer` 还是 `section`，对应表是 `LandmarkElement`）、可选的尺寸、是否可拖动调宽、容器窄于多少像素时折叠成抽屉。

```ts
const layout = {
  direction: 'row',
  regions: [
    { name: 'nav', landmark: 'navigation', label: 'Main navigation', resizable: true,
      size: { default: 240, min: 160, max: 480 }, collapseBelow: 720 },
    { name: 'content', landmark: 'main' }
  ]
}
```

`validateDescriptor` 会拒绝以下声明并抛 `DESCRIPTOR_INVALID`：区域重名、`main` 不是恰好一个、可调区域没有像素默认值或 `min`/`max`、默认值不在范围内、`main` 可折叠、可折叠区域没有 `label`、同一地标出现多次而某个区域没有 `label`。蓝图里的布局节点可以用 `LayoutProp` 列出的三个 props：`sizes`（可调区域的初始宽度）、`labels`（覆盖区域标签，用于本地化）、`skipLabel`（“跳到主内容”链接的文字）。

## 声明数据模型、资源绑定与表单字段

`defineModel` 声明与后端无关的数据模型：字段 schema（Standard Schema，目录里存它的 JSON Schema，也可以用 `jsonSchema` 直接给出）、主键 `key`、字段的展示提示 `display`（标签、`ModelFieldFormat` 中的格式、枚举文案）和到其他模型的关系 `relations`。主键、提示和关系里写的字段必须在 schema 的 `properties` 中，否则抛 `DESCRIPTOR_INVALID`。

```ts
const order = defineModel({
  id: 'order@1',
  schema: z.object({ id: z.string(), customer: z.string().min(1), status: z.enum(['open', 'closed']) }),
  key: ['id'],
  display: { status: { format: 'enum', enumLabels: { open: '处理中', closed: '已完成' } } }
})
```

part 用 `behavior.resource = { prop, slots }` 声明哪个 prop 接收数据资源的快照（`IResourceSnapshot`：`status` 取 `ResourceStatus` 中的值，另有 `data`、`error`、`refreshing`、`page`），以及加载中、空、出错时分别显示哪个插槽。蓝图在这个 prop 上写 `{ $resource: 'orders@1', params: { status: { $state: 'page.status' } } }`。表单控件用 `behavior.field = { value, change, read }` 声明字段协议：值 prop、变更事件和取值方式（`FieldRead`），渲染器据此把输入写回绑定的状态。

规则 `resource.bind-target`、`resource.bind-prop`、`resource.params` 检查资源绑定的 id、位置和字面量参数，`field.value-bound` 在字段的值没有绑定状态时给出警告；绑定在 `params` 里的状态路径与推导同样受 `flow.bind-path`、`flow.scope`、`catalog.id-exists` 检查。`checkModels(catalog)` 检查模型关系指向的模型是否存在，`partom doctor` 每次运行会调用一次。

## 把团队约定写成规则

规则是纯函数。`context.provided(node, 'props.label')` 只在 `authored` 阶段、且增强器在 `writes` 里声明了这个字段时为真，所以规则要自己先看蓝图里有没有写这个值。`scope: 'part'` 时对每个匹配 `targets` 的节点运行一次，`scope: 'blueprint'` 时整个蓝图运行一次。`report` 的 `messageKey` 是稳定键，界面再把它翻译成文字。

```ts
import { defineRule } from '@migaia/part-contract'

export const buttonNeedsLabel = defineRule({
  id: 'orders.button-label',
  targets: ['button'],
  scope: 'part',
  phase: ['authored', 'resolved'],
  severity: 'error',
  check(context) {
    const node = context.node!
    if (node.facets?.props?.label === undefined && !context.provided(node, 'props.label'))
      context.report({
        address: context.address!,
        facet: 'props',
        path: 'label',
        messageKey: 'orders.button-label'
      })
  }
})
```

通过 `definePartPlugin({ rules: [buttonNeedsLabel] })` 交给宿主后，宿主装载、`partom doctor` 和编辑器都会运行它。

## 从地址找到节点

地址是问题、事件和样式共用的定位方式。有 `id` 的节点用 `id` 作地址段，否则用 tag 名；同级同名节点加 `#序号`；slot 成员加 `slot.<名称>` 段。列表行实例在模板节点地址后加 `@row:<行键>`，行键中的 `% / # @ .` 会被百分号编码。

```ts
import { createAddressIndex, parseAddress, resolveAddress } from '@migaia/part-contract'

const index = createAddressIndex(blueprint)
const hit = resolveAddress(index, 'orders/rows/item@row:a%2Fb')
// hit.node 是模板节点，hit.rowKey === 'a/b'
parseAddress('orders/rows/item@row:a%2Fb') // { segments: ['orders', 'rows', 'item'], rowKey: 'a/b' }
```

模板宿主这样声明列表：

```json
{
  "tag": "list@1",
  "id": "rows",
  "template": {
    "rowKey": "id",
    "rows": { "$state": "page.rows" },
    "node": { "tag": "item@1", "id": "item", "facets": { "props": { "label": { "$row": "name" } } } }
  }
}
```

## 用校验库定义参数

增强器、推导和资源的参数可以用任何实现了 Standard Schema v1 的库定义。`toCatalogSchema` 读取库提供的 JSON Schema 写入目录，没有 JSON Schema 能力的库必须同时传入手写的 JSON Schema，否则抛 `SCHEMA_NOT_SERIALIZABLE`。`assertNoTransform` 拒绝会改写值的 schema（例如 `z.string().transform(...)`），抛 `SCHEMA_TRANSFORMS`，因为远端传来的参数必须原样通过校验。

```ts
import { assertNoTransform, toCatalogSchema, validateArgs } from '@migaia/part-contract'
import { z } from 'zod'

const args = z.object({ pageSize: z.number().int().min(1) })
assertNoTransform(args)
const jsonSchema = toCatalogSchema(args)
await validateArgs(args, { pageSize: 20 }) // 不合法时以 ARGS_INVALID 拒绝，问题列表在 cause 上
```

## 错误码

source 为 `part.contract`：`BLUEPRINT_INVALID`、`ADDRESS_INVALID`、`ADDRESS_DUPLICATE`、`DESCRIPTOR_INVALID`、`SCHEMA_NOT_SERIALIZABLE`、`SCHEMA_TRANSFORMS`、`ARGS_INVALID`、`RULE_FAILED`。

## 构建与验证

```bash
pnpm --filter @migaia/part-contract run fmt
pnpm --filter @migaia/part-contract run lint
pnpm --filter @migaia/part-contract run typecheck
pnpm --filter @migaia/part-contract run test
```
