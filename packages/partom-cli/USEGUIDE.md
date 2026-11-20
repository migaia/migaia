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
| 边改蓝图边在浏览器里看效果 | `partom preview` | [本地预览](#本地预览) |
| 把 shadcn 页面的 JSX 转成蓝图 | `partom extract --usage` | [把页面转成蓝图](#把页面转成蓝图) |
| 从 OpenAPI 文档生成模型与资源 | `partom import` | [从 OpenAPI 生成数据层](#从-openapi-生成数据层) |
| 让 effect 里的地址、状态路径有类型提示 | `partom types` | [生成类型](#生成类型) |

## 项目配置

`partom` 在当前目录查找 `partom.config.ts`（或用 `--config` 指定）：

```ts
import { appPlugin } from './src/parts/plugin.ts'

export default { plugins: [appPlugin], blueprints: ['blueprints/*.blueprint.json'] }
```

渲染检查与本地预览会把配置打包进浏览器页面。配置里只有名为 `PARTOM_PUBLIC_*` 的环境变量会在打包时写入页面（例如 `process.env.PARTOM_PUBLIC_API_URL`），其他环境变量不会进入页面。未设置的变量不会被替换，页面里读取 `process.env` 会报错，所以运行渲染检查或预览前要设置它们。

`@migaia/part-*`、`react`、`react-dom` 和 `@ui-sdk/core` 从被检查的项目解析，不打包进 `partom`，所以项目与检查用的是同一份 plugin-host 和 React。缺少这些依赖时退出码为 2。

## 静态检查

```bash
bunx partom doctor
```

对每份蓝图运行 authored 与 resolved 两个阶段的全部规则（37 条内置规则加上插件规则；配置里没有 `domPlugin` 时会自动加入项目里的那一份，内置修饰符因此可用），与宿主装载时的结果一致。有 error 时退出码为 1。

## 渲染检查

```bash
bunx partom doctor --rendered
```

在真实无头浏览器中挂载没有静态错误的蓝图：

- 声明了 `pattern` 的 part 交给 ui-sdk 的 `checkPattern`，检查角色、键盘和 aria 是否符合 APG 模式。
- 有层级的 part 打开后按 Esc 关闭，检查焦点没有落在 `body` 或 `inert` 区域、id 引用都存在。
- 描述符声明了 `budget.render`（毫秒）的 part，取每份蓝图中第一个使用它的节点，单独挂载 5 次，挂载到提交完成的中位数超过预算时报 `budget.render` error，`basis` 写 `median <实测>ms > budget <预算>ms`。没有声明预算的 part 不测。耗时受机器负载影响，预算要留出余量。

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

输出 `{ issues, rendered }`。问题的 `cause` 只保留 name、message、source、code，不带堆栈。加 `--blueprints` 时再输出 `blueprints: { id, file, issues }[]`，按配置匹配顺序列出每份蓝图和它自己的问题，其他字段与退出码不变。

## 从现有组件提取

```bash
bunx partom extract src/components/ui/*.tsx --out src/parts/drafts
```

用 oxc 静态解析 shadcn 风格组件：导出的组件、props、`cva` 变体、事件回调、slot，并从 Radix、cmdk 的导入推测 `pattern`。每个组件生成一份 `definePart` + `bindReactComponent` 草稿，另写 `report.json` 记录推测依据。草稿需要人工审阅：推测的 pattern 和事件种类可能不准。加 `--probe` 会按每个变体值渲染组件并记录 DOM。

被 `memo`、`forwardRef`（含 `React.` 前缀，可任意嵌套）包装的导出会被解开，从最内层函数提取 props，`report.json` 的 `wrappers` 记录包装链，草稿绑定外层导出。项目自己的透明高阶组件在 `partom.config.ts` 的 `extract.transparentWrappers`（如 `['withTheme']`）中列出，按第一个参数解开一层。其他高阶组件（如 `connect(map)(X)`）不猜测：整体作为黑盒绑定，没有推测的 props，报告带 `hoc-opaque`。

## 核对提取结果

```bash
bunx partom extract src/components/ui/button.tsx --out src/parts/drafts --verify
```

`--verify` 分别渲染原组件和经 part 宿主渲染的草稿，比较 DOM；有差异时退出码为 1。

## 表单控件、form.tsx 与 DataTable

提取时按固定规则推断字段协议，草稿的 `behavior.field` 与回调映射随之生成，字段的值会自动写回绑定的状态：

- props 类型是 `ComponentProps<'input'>` 或 `ComponentProps<'textarea'>`：值为 `value`，事件 `change` 映射到 `onChange`，从事件目标读值；
- 根元素是 Radix checkbox 或 switch 的 `Root`：值为 `checked`，事件 `checkedChange` 映射到 `onCheckedChange`；
- 根元素是 Radix select 的 `Root`：值为 `value`，事件 `valueChange` 映射到 `onValueChange`。

shadcn 的 `form.tsx` 依赖 react-hook-form 的上下文，离开 `<Form>` 无法渲染，所以不按原组件包装，而是生成 `form.part.tsx`：`form-item@1`、`form-label@1`、`form-control@1`、`form-description@1`、`form-message@1` 五个不依赖 react-hook-form 的组件，沿用原文件的 class，并照原样把 label 的 `for`、控件的 `aria-describedby` 与 `aria-invalid` 连起来。`form-message@1` 显示 `props.message`，为空时不渲染。

用 TanStack `useReactTable` 的 `data-table.tsx` 生成 `data-table.part.tsx`：part `data-table@1` 绑定 resource（`props.source`），声明 `loading`、`empty`、`error`、`header` 插槽，用项目自己的 shadcn table 组件渲染，行由蓝图模板给出。排序、筛选、分页不进入 part。

报告 `report.json` 带 `summary`：`components`、`componentsClean`（没有不确定项的组件数），加 `--probe` 时还有 `patternChecked`、`patternPassed`，否则二者为 `null`。替代生成的 part 不参加 `--verify`。

## 把页面转成蓝图

```bash
bunx partom extract --usage src/pages/orders-page.tsx --parts src/parts --out src/blueprints
```

`--parts` 指向组件提取的输出目录（读其中的 `report.json`）。每个页面文件里导出的、只有一个 JSX `return` 的函数组件生成一组文件，都在 `--out` 下：

- `<文件名>.blueprint.json`：已提取的组件成为对应 part 节点，原生元素成为 `html-<标签>@1` 节点，字面量属性写进 `props`，`useState` 变量写成 `{ $state: 'page.<变量>' }`；
- `<文件名>.seed.ts`：初始值是字面量的状态，在插件安装时写入（只在从未写过时写入）；
- `effects/<文件名>.ts`：每个事件处理函数一份 `defineEffect` 草稿，在人工改写前运行就抛错，原处理函数源码只放在导出的字符串常量里；
- `blackbox/*.tsx`：转换不了的整块 JSX（未提取的组件、`map`、条件等）按原文保留为黑盒 part，引用的状态变量作为 props 传入；
- `parts/html.ts`：页面用到的原生元素 part。

每个 TS 文件默认导出一个 part 插件，在 `partom.config.ts` 里安装即可。react-hook-form 表单按字段绑定到 `page.<表单>.<字段>`，错误消息绑定到 `page.<表单>-errors.<字段>`；`onSubmit={form.handleSubmit(fn)}` 生成带 `submit.prevent` 的订阅。DataTable 按页面里的 `columns` 数组生成列与行模板，`data` 需要人工绑定资源。字段值已由字段协议写回时（如 `onValueChange={setStatus}`），不再生成订阅。

输出的报告列出写入、未变、已接管的文件，每个不确定项的原因和行号，以及 `summary`：`usageNodes`、`usageConverted`、`blackboxes`。生成文件带 `@partom-generated` 标记（蓝图 JSON 用 `$partom` 键），改过的文件重新运行时不会被覆盖。`--parts` 目录没有报告时退出码为 2。

## 从 OpenAPI 生成数据层

```bash
bunx partom import openapi.json --out src/api
```

读取 OpenAPI 3.x 文档（JSON 或 YAML），生成模型、资源与 HTTP 插件的源码；`src/api/index.ts` 导出 `apiPlugin` 与 `createHttpPlugin`。手工改过的生成文件不会被覆盖，报告把它列为已接管。

## 生成类型

```bash
bunx partom types
```

按配置里的插件与蓝图生成 `partom-env.d.ts`：part 地址、状态路径、事件 `detail`、resource 参数与命令的类型。`--check` 只检查文件是否最新。

## 本地预览

```bash
bunx partom preview            # 打印 {"url":"http://127.0.0.1:4400/"}
bunx partom preview orders     # 再打印 {"url":"http://127.0.0.1:4400/b/orders"}
```

`partom preview` 只监听 `127.0.0.1`，没有写入接口。默认从 4400 到 4419 找第一个空闲端口，`--port <n>` 指定端口；端口都被占用时以退出码 2 结束（`PORT_IN_USE`）。参数可以是蓝图 id 或蓝图文件路径，配置里找不到时以退出码 2 结束（`BLUEPRINT_NOT_FOUND`）。

- 首页列出配置匹配到的每份蓝图及其 error、warning 数；`/b/<id>` 用配置里的插件（再加上项目的 `domPlugin`、`reactPlugin`）挂载这份蓝图。
- 改动蓝图、组件或配置后，100 毫秒内的改动合并成一次重建：重新运行 doctor、重新打包页面，成功后页面整页刷新。重建串行进行，重建中途的改动在它结束后再合并重建一次。
- 打包或配置出错时页面保留上一次的内容，右下角浮层显示错误；修好后下一次改动自动恢复。
- 浮层列出这份蓝图的 doctor 问题，点一条会给对应元素加轮廓并滚动过去。有 error 时不挂载，与 doctor 跳过渲染检查的规则一致。浮层在 Shadow DOM 里，不受页面样式影响，也不参与 F6 区域切换。
- 预览只写项目里的 `.partom-preview/` 目录，启动时清空、退出时删除；同时运行 `partom doctor` 互不影响。按 Ctrl+C 结束，退出码 0。

- **编辑器桥接模式**：`partom preview --editor --editor-origin <编辑器地址>` 供 `apps/part-editor` 的预览栏嵌入。打包时先按 `development` 条件解析（devtools 与宿主追踪因此生效），页面装上 `devtoolsPlugin`，并把 `release.remote.modules` 的入口作为 `remote:modules` 一起装入。页面只接受编辑器源的 `postMessage`：`{ kind: 'blueprint', document }` 更新并挂载蓝图，`{ kind: 'modules', modules, base, token }` 按模块名热替换远端模块（预览中一律按 `page` 档运行）。每次更新的问题（含项目规则与 resolved 问题）回发编辑器；页面启动时先发 `{ kind: 'ready' }`。

## 构建远端代码模块

```bash
partom remote build remote/effects/notify.ts --out partom-build --root remote --project .
```

远端模块是一个 TS 文件，默认导出 `defineEnhancer`、`defineEffect` 或 `defineDerive` 的结果（或它们的数组），模块名是文件相对 `--root` 的路径。每个入口独立处理，依次：

- **代码规则：** 只能导入 `@migaia/part-host`、`@migaia/part-contract`、`react`、`react/jsx-runtime`（`remote.import`，相对导入、动态 `import()` 与 `require` 都不允许）；模块顶层不能有 `let`/`var` 或定义调用以外的语句（`remote.module-state`）；不能引用 `window`、`process`、`fetch` 等宿主全局（`remote.global`）。
- **类型检查：** 用项目自己的 `tsc`，在项目内临时目录生成只含该入口的 tsconfig；项目没有 TypeScript 时退出 2（`PROJECT_DEPENDENCY_MISSING`）。
- **构建：** `Bun.build` 输出浏览器 ESM，不压缩、不带 source map，同一输入逐字节相同；对共享运行时的导入换成读取 `globalThis[Symbol.for('migaia.part.shared')]` 的垫片，页面负责放好这些包。
- **契约测试：** 在只带 `PATH` 环境变量的 Bun 子进程中运行：增强器与推导各运行两次，结果必须相同（`remote.impure`）；effect 用记录型假 ctx 运行，2 秒不结束报 `remote.contract-timeout`，抛错报 `remote.contract-failed`。

输出 `<out>/m/<内容哈希>.js` 与 `<out>/modules.json`（`name`、`id`、`url`、`integrity`、`exports`），标准输出打印 `{ modules, failed, issues }`；有失败入口时退出 1，入口不在 `--root` 内时报 `REMOTE_ENTRY_OUTSIDE`。这些检查是提前反馈，不是沙箱：运行它就等于在本机执行模块代码。

## 发布与同步

在 `partom.config.ts` 中加 `release`：

```ts
export default {
  plugins: [appPlugin],
  blueprints: ['blueprints/*.blueprint.json'],
  release: {
    project: 'orders', // 目录服务中的项目名
    parts: ['parts/*.part.tsx'], // 按需加载的 part 模块
    remote: { root: 'remote', modules: ['**/*.ts'] } // 远端模块根目录与入口 glob
  }
}
```

- **`partom build [--tag <tag>] [--out partom-build]`**：只从干净且打了 tag 的 HEAD 构建，否则退出 2（`RELEASE_DIRTY`）。产出 `snapshot.json`、`m/` 下的远端模块与 `sources.json`。远端模块会先装进检查用的宿主，所以蓝图引用的远端 effect 不会报 `event.handler-exists`，它的描述符也进入快照。同一 tag 两次构建逐字节相同。任一蓝图有静态 error 时打印 `{ issues }` 并退出 1。
- **`partom manifest [--out src/partom-client.gen.ts] [--build <名>] [--inline <id,...>] [--budgets]`**：生成客户端模块，导出 `manifest`、`shared`、`chunks`、`lazyPartsPlugin` 与 `inlined`，直接传给 `remotePlugin`。能力清单不含远端模块提供的定义；`release.parts` 中的 part 由 `lazyPartsPlugin` 立即登记描述符，组件在模块加载后才渲染。`--budgets` 按 `budget.size` 检查每个 part 模块压缩后的体积（共享运行时外置），超出时报 `budget.size` 并退出 1，生成文件照常写出。配置本身也导入了远端模块时，`manifest` 与 `build` 都报 `release.remote-in-config` 并退出 1。
- **`partom publish --service <url> [--env dev] [--dir partom-build]`**：上传模块、快照原字节与源码，再把环境指向该快照。`promote --env <env> --from <env>`、`rollback --env <env> --to <tag|快照哈希>`、`history --env <env>` 操作环境指针。令牌只从环境变量 `PARTOM_TOKEN` 读取。服务返回 4xx 时原样打印到 stderr 并退出 1；网络失败或 5xx 退出 2（`SERVICE_UNREACHABLE`）。
- **`partom pull --service <url>`**：按地址把编辑器草稿三方合并进工作区蓝图（base 为草稿基于的 tag 中的文件），把自 base 以来没改过的远端模块写成草稿源码。冲突与失败都列出并退出 1；合并有冲突时保留本地值。草稿还有变基冲突时什么都不写。
- **`partom push --service <url>`**：把相对草稿 base tag 有改动的蓝图与远端模块作为一个变更集提交，打印结果；有 `rejected` 或 `conflict` 时退出 1。服务不提交 git，由开发者提交并开 PR。

## 单文件可执行

```bash
pnpm --filter @migaia/partom-cli run build:exe
```

编译后的 `dist/partom` 可直接运行 `doctor`、`preview`、`extract` 和 `--version`。`build:exe` 还把预览页的浏览器端代码打成 `dist/preview-runtime.js` 嵌进可执行文件；`preview` 的服务进程不导入项目模块，每次重新检查都启动一个新的 doctor 子进程。

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
