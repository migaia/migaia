# `@migaia/part-plugin-dom` 使用手册

[English](./USEGUIDE.en.md)

包的定位见 [README](./README.md)。应用通常不直接调用本包：渲染插件在提交期调用这些能力。下面的场景说明在蓝图和 part 定义里怎么写，以及写渲染插件时怎么调用。

## 按场景查找

| 你遇到的问题                                   | 写法                                      | 看这一节                                         |
| ---------------------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| 关闭弹窗后焦点回到触发按钮                     | `focus.restore`                           | [焦点恢复](#焦点恢复)                            |
| 下拉框在模态框里也要显示在最上面               | `behavior.layer`                          | [层级](#层级)                                    |
| 点击下拉框外部时关闭它                         | `dismiss.outside`                         | [点击外部关闭](#点击外部关闭)                    |
| 外层 `stopPropagation` 后仍要知道发生了外部点击 | 订阅修饰符 `outside`                      | [外部事件订阅](#外部事件订阅)                    |
| 在捕获阶段先拿到事件                           | 订阅选项 `capture: true`                  | [捕获阶段](#捕获阶段)                            |
| 一千行列表不要一千个监听器                     | `events.delegate`                         | [列表事件委托](#列表事件委托)                    |
| 主题色只改一处                                 | `styleHooks`、`stylesheet`                | [样式](#样式)                                    |

## 焦点恢复

声明 `focus: { restore: true }` 的 part 打开时记录当前焦点，关闭时还回去。原元素已被移除时，退到最近的仍存在的可聚焦元素，不落到 `body`。模态 part 打开期间，页面其余顶层元素设为 `inert`。

渲染插件的调用顺序：打开时先 `focus.open` 再 `layer.open`，关闭时先 `layer.close` 再 `focus.close`。

## 层级

- `layer: 'top'` 且元素是 `<dialog>`：用 `showModal()`。
- 已有顶层元素时再打开的弹层：用 popover 进入顶层，所以模态框里的下拉框不会被盖住。
- 其余：按语义层级（`dropdown`、`overlay`、`modal`、`toast` 等）取 z-index，写在专用的 `stacking` 层，不写 `style` 属性。

Esc 只关闭最上层，并通过 `onDismiss` 通知调用方。蓝图不能写 `z-index`（规则 `behavior.no-zindex`）。

## 点击外部关闭

```ts
definePart({
  id: 'menu@1',
  behavior: { layer: 'dropdown', dismiss: { outside: true }, states: { names: ['open'], openState: 'open' } }
})
```

在最上层 part 外部按下指针（`pointerdown`，捕获阶段）时，只关闭最上层，与 Esc 一致。这次点击不会被拦截，照常到达目标。模态对话框点在 `::backdrop` 上时，事件目标是对话框本身，此时按对话框的矩形判断是否在外部。由组件自己管理层级的 part（`managedBy: 'component'`，如 Radix）不经过这里，由组件自己处理。

## 外部事件订阅

```json
{ "events": { "click": { "handler": "close-panel@1", "modifiers": ["outside"] } } }
```

`outside` 把监听挂到文档的捕获阶段，只在事件路径不包含 part 元素时触发。因为在捕获阶段，外层的 `stopPropagation` 挡不住它。它只用于 DOM 事件，规则 `event.outside-dom` 会报告用在 `custom` 或 `component` 事件上的情况。

## 捕获阶段

```json
{ "events": { "click": { "handler": "track@1", "capture": true } } }
```

`capture`、`once`、`passive` 直接作为原生监听选项。`component` 事件没有捕获阶段，规则 `event.component-no-capture` 会报告。

## 列表事件委托

渲染插件遇到模板宿主时，为模板节点的每个事件在宿主元素上调用一次 `delegate`，行实例自己不挂监听：

```ts
dom.events.delegate('orders/rows/item', listElement, 'click', subscription, declaration)
```

事件到来时，从目标向上找带 `data-part-address` 的元素，找到属于该模板节点的行实例（`orders/rows/item@row:<键>`）后，用这个地址派发；不在任何行内的事件被忽略。`self` 修饰符和行实例元素比较，`stop`、`prevent` 照常生效。

## 样式

每个宿主一张构造样式表，按（层，地址）保存规则并原地更新。一条地址规则同时匹配该地址的所有行实例，所以列表行共享一份样式。蓝图只能通过 part 声明的 `styleHooks` 写样式，值按 hook 类型校验。

## aria

`aria.apply` 写 `data-part-address`、稳定的 `id`、关联属性（地址解析为目标 id）和 `tabindex`。`aria.applyStates` 把由状态派生的值写成 `aria-<名称>`：布尔值写成 `"true"`/`"false"`，`undefined` 和 `null` 移除属性。

## 错误码

source 为 `part.dom`：`CUSTOM_EVENT_UNNAMESPACED`（自定义事件名缺少插件名前缀）、`STYLESHEET_UNSUPPORTED`（环境没有构造样式表）。

## 构建与验证

测试在真实 Chromium 中运行（vitest 浏览器模式）。

```bash
pnpm --filter @migaia/part-plugin-dom run fmt
pnpm --filter @migaia/part-plugin-dom run lint
pnpm --filter @migaia/part-plugin-dom run typecheck
pnpm --filter @migaia/part-plugin-dom run test
```
