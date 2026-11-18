# @migaia/part-plugin-dom

part 宿主的 DOM 插件：页面级焦点管理、层级管理、样式表写入、事件适配和 aria 落地。与 UI 框架无关，由渲染插件在提交期调用。

## 用法

先安装 `domPlugin`，再安装渲染插件（例如 `@migaia/part-plugin-react` 的 `reactPlugin`）：

```ts
const host = await createPartHost({ plugins: [domPlugin, reactPlugin, appPlugin] })
```

渲染插件通过 `domPlugin.getFeature('focus' | 'layer' | 'stylesheet' | 'events' | 'aria')` 取得这些能力。

## 行为

- **焦点**：打开声明了 `focus.restore` 的 part 时记录焦点，关闭时恢复；原元素已被移除时，退到最近的仍存在的可聚焦元素，不会落到 `body`。模态 part 打开期间，页面其余顶层元素设为 `inert`。打开时先调 `focus.open` 再调 `layer.open`，关闭时先 `layer.close` 再 `focus.close`。
- **层级**：模态对话框用 `showModal()`；顶层元素之上的弹层用 popover 进入顶层；其余按语义层级取 z-index，写在专用的 `stacking` 层，不写 `style` 属性。Esc 只关闭最上层，并通过 `onDismiss` 通知调用方。声明了 `dismiss.outside` 的 part 在它外部按下指针时也只关闭最上层；这次点击不会被拦截，照常到达目标。`close` 是幂等的。
- **样式**：每个宿主一张样式表，按（层，地址）保存规则，原地更新。
- **事件**：`dom` 与 `custom` 事件用 `addEventListener` 注册，修饰符同步执行；`custom` 事件名必须以插件名加冒号开头。`outside` 修饰符把监听挂到文档的捕获阶段，只在事件发生于 part 元素之外时触发，所以外层 `stopPropagation` 挡不住它；它只用于 `dom` 事件。捕获阶段监听用订阅的 `capture: true`。`delegate` 为模板节点的每个事件在模板宿主上只挂一个监听，按事件目标找到所在的行实例，以 `…@row:<键>` 地址派发。
- **aria**：关联属性中的地址解析为目标元素的 id，并写入 `data-part-address`。`applyStates` 把由状态派生的值写成 `aria-<名称>`，`undefined`/`null` 移除该属性。
- **布局**：`layout.attach` 给布局 part 加上区域地标属性、可拖动并记住宽度的分隔条、窄屏折叠成抽屉，以及 F6 区域切换；尺寸写在专用的 `layout` 层。
- **模板行样式**：一条地址规则同时匹配该地址的全部行实例。

由组件自己管理焦点与层级的 part（`managedBy: 'component'`，例如 Radix）不经过焦点与层级管理。

## 错误码（source `part.dom`）

`CUSTOM_EVENT_UNNAMESPACED`、`STYLESHEET_UNSUPPORTED`。
