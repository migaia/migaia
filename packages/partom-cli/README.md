# @migaia/partom-cli

`partom` 命令：检查 part 项目（`doctor`），在本机预览蓝图（`preview`），从现有组件提取 part 定义草稿（`extract`）。用 Bun 编写。

```text
partom doctor [--rendered] [--only <address>] [--browser <path>] [--json [--blueprints]] [--config <path>]
partom preview [<id|file>] [--port <n>] [--config <path>]
partom extract <files...> --out <dir> [--probe] [--verify] [--browser <path>]
partom browser install
partom --version
```

退出码：0 无 error；1 有 error 或有差异；2 配置、项目依赖或环境错误。

## 项目配置

```ts
// partom.config.ts
export default { plugins: [appPlugin], blueprints: ['*.blueprint.json'] }
```

`@migaia/part-*`、`react`、`react-dom` 和 `@ui-sdk/core`（`0.1.0-beta.7`）都从被检查的项目解析，可执行文件里不打包它们，从而保证 plugin-host 与 React 各只有一份。

## doctor

- 默认运行 authored 与 resolved 两个阶段的全部规则。
- `--rendered` 在真实无头浏览器中挂载没有静态错误的蓝图：对声明了 `pattern` 的 part 运行 ui-sdk 的 `checkPattern`，对有层级的 part 打开再按 Esc 关闭，检查焦点没有落到 `body` 或 `inert` 区域、id 引用有效。浏览器依次取 `--browser`、`PARTOM_BROWSER`、本机 Chrome、`partom browser install` 安装的 Chromium；显式路径不存在时直接报错，从不静默下载。
- `--json` 输出 `{ issues, rendered }`，问题的 `cause` 只保留 name、message、source、code；加 `--blueprints` 时再输出每份蓝图的 `{ id, file, issues }`。

## preview

在 `127.0.0.1` 起一个只读服务（默认从 4400 端口起找空闲端口，`--port` 指定），首页列出配置里的全部蓝图，`/b/<id>` 用项目自己的插件挂载一份；给出 id 或文件路径时额外打印它的地址。文件变化后自动重新检查、重新打包并刷新页面；蓝图的 doctor 问题显示在页面右下角的浮层里，有 error 时不挂载。按 Ctrl+C 结束。

## extract

用 oxc 静态解析 shadcn 风格组件：导出的组件、props、`cva` 变体、事件回调、slot，以及从 Radix 与 cmdk 的导入推测 `pattern`。输出每个组件一份 `definePart` + `bindReactComponent` 草稿和 `report.json`。生成代码只接受合法标识符，字符串一律以 JSON 字面量写入。`--probe` 按每个变体值渲染并记录 DOM；`--verify` 比较原组件与经 part 宿主渲染的结果。

## 单文件可执行

```bash
pnpm --filter @migaia/partom-cli run build:exe
```

`build:exe` 先把 doctor 打成单文件 `dist/doctor-runner.js`，再把它嵌进可执行文件。Bun 编译模式解析不到项目里带作用域的符号链接包（`@migaia/*`、`@ui-sdk/*`），所以可执行文件运行 `doctor` 时，把 runner 写到系统临时目录，再以 `BUN_BE_BUN=1` 启动自己，作为普通 Bun 运行它。用户机器不需要另装 Bun，退出码与源码运行相同。`extract --probe`、`--verify` 用 `Bun.build` 打包检查页，可执行文件可直接运行。
