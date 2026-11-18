# @migaia/part-contract

part 平台的数据与校验契约：蓝图格式、part 地址、描述符、行为配置组、Standard Schema 接入和规则引擎。它不依赖 DOM、Node、Bun 或 React，编辑器、服务端、CLI 和宿主运行同一套规则。

## 从这里开始

```ts
import { createRuleEngine, parseBlueprint } from '@migaia/part-contract'
import { builtinRules } from '@migaia/part-contract/doctor'

const engine = createRuleEngine({ rules: builtinRules, catalog })
const issues = engine.run('authored', parseBlueprint(input))
```

`catalog` 是一个只读视图：`get(id)` 返回描述符，`majors(name)` 返回某个名称可用的主版本，`writesFor(tag)` 返回增强器声明会写入的字段。

## 地址

- 节点有 `id` 时地址段就是 `id`，否则是 tag 名（去掉 `@主版本`，文法外的字符换成 `-`）。
- 同级多个同名节点加序号：`orders/button#0`、`orders/button#1`。
- slot 里的节点在中间加 `slot.<名称>` 段：`orders/filter/slot.empty/text`。
- 模板行实例在静态地址后加行键：`orders/rows/status@row:123`。

## 规则

`/doctor` 导出 25 条内置规则，分为 html、aria、slot、catalog、style、event、flow、behavior 八组。规则只有 `authored`（原始蓝图）和 `resolved`（增强后）两个阶段；渲染后的检查由 `partom doctor --rendered` 完成。`authored` 阶段会把增强器 `writes` 声明的字段视为会被补上。

规则抛错时不会中断其他规则，而是产生一条 `RULE_FAILED` 问题，原错误在问题的 `cause` 上。

## 参数 schema

`toCatalogSchema` 接受任何 Standard Schema v1 校验库（zod、valibot、arktype），读取它的 JSON Schema 写入目录。`assertNoTransform` 拒绝会转换值的 schema，因为远端传来的参数必须原样通过校验。

## 错误码（source `part.contract`）

`BLUEPRINT_INVALID`、`ADDRESS_INVALID`、`ADDRESS_DUPLICATE`、`DESCRIPTOR_INVALID`、`SCHEMA_NOT_SERIALIZABLE`、`SCHEMA_TRANSFORMS`、`ARGS_INVALID`、`RULE_FAILED`。
