# `@migaia/part-plugin-dom` 使用手册

[English](./USEGUIDE.en.md)

包的定位见 [README](./README.md)。应用通常不直接调用本包：渲染插件在提交期调用这些能力。下面的场景说明在蓝图和 part 定义里怎么写，以及写渲染插件时怎么调用。

## 按场景查找

| 你遇到的问题                                   | 写法                                      | 看这一节                                         |
| ---------------------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| 关闭弹窗后焦点回到触发按钮                     | `focus.restore`                           | [焦点恢复](#焦点恢复)                            |
| 下拉框在模态框里也要显示在最上面               | `behavior.layer`                          | [层级](#层级)                                    |
| 点击下拉框外部时关闭它                         | `dismiss.outside`                         | [点击外部关闭](#点击外部关闭)                    |
| 外部点击、按键过滤、防抖、长按、滑动、拖拽 | 订阅修饰符、`click.once.stop` 写法 | [修饰符与事件键简写](#修饰符与事件键简写) |
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

## 修饰符与事件键简写

订阅可以带修饰符链，修饰符按数组顺序执行，每个都可以拦下事件；全部通过后才派发 effect。修饰符写成 `名称@主版本`，带参数时写成对象：

```json
{ "events": { "click": { "handler": "save@1", "modifiers": ["stop@1", { "id": "debounce@1", "args": { "ms": 200 } }] } } }
```

事件键也可以用点号简写：第一段是事件名，`once`、`capture`、`passive`、`native` 是监听选项，其余每段是一个修饰符（省略主版本时取 `@1`）。下面两种写法等价：

```json
{ "events": { "click.once.stop.outside": { "handler": "close@1" } } }
{ "events": { "click": { "handler": "close@1", "once": true, "modifiers": ["stop@1", "outside@1"] } } }
```

`native` 用于组件事件：不走组件回调，而是在 part 的根元素上监听同名原生事件（例如 `click.native`）。

本插件登记的内置修饰符：

| 修饰符 | 作用 |
|---|---|
| `stop`、`prevent`、`self` | 停止冒泡；取消默认行为；只在事件目标是 part 元素本身时继续 |
| `outside` | 监听挂到文档的捕获阶段，只在点击发生在 part 之外时继续；外层的 `stopPropagation` 挡不住它；只用于 DOM 事件，不能用在模板行上 |
| `enter`、`esc`、`tab`、`space`、`up`、`down`、`delete` | 只在按下对应键时继续（`delete` 同时接受 Delete 与 Backspace） |
| `left`、`right`、`middle` | 键盘事件为方向键，鼠标事件为对应按键 |
| `key` | `{ keys: [...] }`，按 `KeyboardEvent.key` 过滤 |
| `ctrl`、`shift`、`alt`、`meta`、`exact` | 要求按住对应系统键；`exact` 要求只按住订阅里写出的系统键 |
| `debounce`、`throttle` | `{ ms }`，默认 300；防抖只让最后一次通过，节流每个窗口只让第一次通过 |
| `longpress` | 用于 `pointerdown`；`{ ms, tolerance }`，按住足够久且没有移动时派发 `{ x, y, duration }` |
| `swipe` | 用于 `pointerdown`；`{ distance, direction }`，松开时位移足够且方向符合则派发 `{ direction, dx, dy }` |
| `drag` | 用于 `pointerdown`；`{ threshold }`，捕获指针并依次派发 `{ phase: 'start' \| 'move' \| 'end', x, y, dx, dy }` |

双击、触摸、滚动、拖放本身是原生事件（`dblclick`、`touchstart`、`scroll`、`dragstart` 等），直接订阅即可，再按需加修饰符，例如 `scroll.passive.throttle`。

自定义修饰符用 part-host 的 `defineModifier` 定义，经 `definePartPlugin({ modifiers })` 登记。运行时找不到修饰符时，订阅不挂监听，并经 diagnostics 报告 `MODIFIER_UNAVAILABLE`；修饰符代码抛错时报告 `MODIFIER_FAILED`，原错误在 `cause`；这些错误都带 `address`、`event`、`modifier` 字段，便于定位。

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
