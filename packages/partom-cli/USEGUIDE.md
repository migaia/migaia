# `@migaia/partom-cli` 使用手册

[English](./USEGUIDE.en.md)

命令说明见 [README](./README.md)。`partom` 用 Bun 编写，仓库固定 Bun `1.4.4`（`engines.bun` 与开发依赖 `bun`）。

## 按场景查找

| 你遇到的问题                                     | 命令                                      | 看这一节                                         |
| ------------------------------------------------ | ----------------------------------------- | ------------------------------------------------ |
| 提交前检查蓝图有没有违反规则                     | `partom doctor`                           | [静态检查](#静态检查)                            |
| 确认组件真的符合 APG 交互模式                    | `partom doctor --rendered`                | [渲染检查](#渲染检查)                            |
| 只查一个出问题的部件                             | `partom doctor --only <地址>`             | [只查一个地址](#只查一个地址)                    |
| 把检查结果交给 CI 或编辑器                       | `partom doctor --json`                    | [机器可读输出](#机器可读输出)                    |
| 把现有 shadcn 组件批量转成 part                  | `partom extract`                          | [从现有组件提取](#从现有组件提取)                |
| 确认提取出的 part 渲染和原组件一致               | `partom extract --verify`                 | [核对提取结果](#核对提取结果)                    |

## 项目配置

`partom` 在当前目录查找 `partom.config.ts`（或用 `--config` 指定）：

```ts
import { appPlugin } from './src/parts/plugin.ts'

export default { plugins: [appPlugin], blueprints: ['blueprints/*.blueprint.json'] }
```

`@migaia/part-*`、`react`、`react-dom` 和 `@ui-sdk/core` 从被检查的项目解析，不打包进 `partom`，所以项目与检查用的是同一份 plugin-host 和 React。缺少这些依赖时退出码为 2。

## 静态检查

```bash
bunx partom doctor
```

对每份蓝图运行 authored 与 resolved 两个阶段的全部规则（32 条内置规则加上插件规则；配置里没有 `domPlugin` 时会自动加入项目里的那一份，内置修饰符因此可用），与宿主装载时的结果一致。有 error 时退出码为 1。

## 渲染检查

```bash
bunx partom doctor --rendered
```

在真实无头浏览器中挂载没有静态错误的蓝图：

- 声明了 `pattern` 的 part 交给 ui-sdk 的 `checkPattern`，检查角色、键盘和 aria 是否符合 APG 模式。
- 有层级的 part 打开后按 Esc 关闭，检查焦点没有落在 `body` 或 `inert` 区域、id 引用都存在。

浏览器依次取 `--browser`、环境变量 `PARTOM_BROWSER`、本机 Chrome、`partom browser install` 安装的 Chromium。显式路径不存在时直接报错，不会退回其他浏览器，也从不静默下载。

## 只查一个地址

```bash
bunx partom doctor --rendered --only orders/filter/combobox
```

渲染检查只针对该地址及其子树，适合修复单个部件时反复运行。静态规则仍对整份蓝图运行。

## 机器可读输出

```bash
bunx partom doctor --json > doctor.json
```

输出 `{ issues, rendered }`。问题的 `cause` 只保留 name、message、source、code，不带堆栈。

## 从现有组件提取

```bash
bunx partom extract src/components/ui/*.tsx --out src/parts/drafts
```

用 oxc 静态解析 shadcn 风格组件：导出的组件、props、`cva` 变体、事件回调、slot，并从 Radix、cmdk 的导入推测 `pattern`。每个组件生成一份 `definePart` + `bindReactComponent` 草稿，另写 `report.json` 记录推测依据。草稿需要人工审阅：推测的 pattern 和事件种类可能不准。加 `--probe` 会按每个变体值渲染组件并记录 DOM。

## 核对提取结果

```bash
bunx partom extract src/components/ui/button.tsx --out src/parts/drafts --verify
```

`--verify` 分别渲染原组件和经 part 宿主渲染的草稿，比较 DOM；有差异时退出码为 1。

## 单文件可执行

```bash
pnpm --filter @migaia/partom-cli run build:exe
```

编译后的 `dist/partom` 可直接运行 `doctor`、`extract` 和 `--version`。

Bun 编译模式解析不到项目里带作用域的符号链接包（pnpm 的 `@migaia/*`、`@ui-sdk/*`），Bun `1.4.4` 仍是如此。因此 `build:exe` 先把 doctor 单独打包成 `dist/doctor-runner.js` 并嵌入可执行文件；运行 `doctor` 时，可执行文件把它写到系统临时目录的 `partom/doctor-runner-<版本>.js`（内容相同时不重写），再以环境变量 `BUN_BE_BUN=1` 启动自己，作为普通 Bun 执行它。用户机器不需要另装 Bun，输出和退出码与源码运行相同。

`extract --probe` 与 `--verify` 用 `Bun.build` 打包检查页，打包时由自带的解析插件找到项目包，因此可执行文件可以直接运行它们：

```bash
partom extract src/components/ui/button.tsx --out drafts --verify
```

## 退出码

| 码  | 含义                               |
| --- | ---------------------------------- |
| 0   | 没有 error                         |
| 1   | 有 error，或 `--verify` 发现差异   |
| 2   | 配置、项目依赖或环境错误           |
