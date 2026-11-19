# `@migaia/part-plugin-devtools` 使用手册

## 安装与开关

把 `devtoolsPlugin` 加进宿主插件即可。它在 Shadow DOM 中挂一个固定在页面右侧的面板，不受页面样式影响，也不参与布局。`Alt+Shift+D` 切换显示；卸载插件或关闭宿主时，面板、快捷键与追踪订阅一并移除。

## 面板内容

- **地址树：** `trace.addresses()` 给出的全部地址，可按地址片段过滤；点地址即选中。
- **增强阶段：** 依次列出 `authored`、每个增强器与 `resolved`，每一步只列变化的配置项（`组.键: 旧值 → 新值`，值超过 200 字符截断）。
- **解析后的配置：** 选中地址当前的完整配置。
- **状态：** 配置中 `$state` 绑定的路径及其当前值，读取失败显示 `undefined`。
- **推导：** 配置中 `$derive` 绑定的推导，以及它最近一次重算读取的路径。推导按 id 共享，绑定同一推导的节点看到同一份依赖。
- **事件：** 该地址的 dispatch、effect 运行与状态写入，最新的在前。

## 只在开发态生效

包的 `exports` 中 `development` 条件指向真实实现，默认条件指向空实现。Vite 开发服务器、vitest 与 `bun build --conditions=development` 会用到真实实现；`bun build --production`（或 `NODE_ENV=production`）与生产构建得到空插件：不登记 Feature、不建 DOM、快捷键无效。宿主的追踪记录同样只在开发条件下存在（见 `@migaia/part-host` 手册）。

## 构建与验证

```bash
pnpm --filter @migaia/part-plugin-devtools run fmt
pnpm --filter @migaia/part-plugin-devtools run lint
pnpm --filter @migaia/part-plugin-devtools run typecheck
pnpm --filter @migaia/part-plugin-devtools run test
```
