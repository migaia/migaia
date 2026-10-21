# `@migaia/rpc-integration` 使用手册

[English](./USEGUIDE.en.md)

## 目录

- [1. 准备](#1-准备)
- [2. 脚本](#2-脚本)
- [3. 外部语言对端](#3-外部语言对端)
- [4. 添加测试](#4-添加测试)
- [5. 线上格式向量](#5-线上格式向量)
- [6. 性能测量](#6-性能测量)

## 1. 准备

测试导入的是各 RPC 包构建出的 `dist`。每次运行开始时，全局 setup 会比对依赖包的 `dist` 和源码；发现过期就以 `DIST_STALE` 失败，并给出需要重建的包和命令。先构建本包的全部依赖：

```bash
pnpm --filter "@migaia/rpc-integration..." --workspace-concurrency=2 run build
```

不要在仓库根目录运行全量 `pnpm run build`。

完整测试、conformance、性能测量都属于重命令，在仓库的独占窗口里运行，避免和其它测量互相干扰：

```bash
node "$(git rev-parse --path-format=absolute --git-common-dir)/../scripts/exclusive-window.mjs" run --window rpc-integration --wait 2700 -- pnpm --filter @migaia/rpc-integration run test
```

## 2. 脚本

| 脚本 | 作用 |
| --- | --- |
| `test` | 默认测试集。分两组依次运行：普通测试（最多 2 个 worker），然后单独运行 16 MiB 大帧测试，避免大帧和子进程夹具抢占计时器。不含 conformance 和 suite-parity。 |
| `test:conformance` | 与外部语言对端互通，以及桥接故障场景。串行运行，单个测试超时 120 秒。需要外部语言工具链，见[第 3 节](#3-外部语言对端)。 |
| `test:suite-parity` | 核对各 RPC 包从旧包迁移过来的测试：旧测试文件里的每个用例名都必须在新位置存在并通过。 |
| `test:packed` | 先构建五个 RPC 包，再把它们打包，在一个干净的目录里安装，检查每个声明的公开路径都能解析，已退役的子路径仍然不可导入。 |
| `test:coverage:family` | 把六个 RPC 测试归属方（五个 RPC 包和本包）的测试一起运行，统计五个运行时包源码的合并覆盖率。 |
| `typecheck` / `typecheck:test` | 对测试、bench 和配置做类型检查（本包没有 `src` 运行时代码，两者检查同一份配置）。 |
| `fmt` / `lint` | 格式化和 lint 测试、bench 与 vitest 配置。 |
| `bench:ipc` / `bench:probe` | IPC 性能测量驱动，见[第 6 节](#6-性能测量)。 |

仓库根目录也提供简写：`pnpm @rpc-integration <脚本>`。

## 3. 外部语言对端

`test:conformance` 会启动 Python、Rust、Go 写的对端，需要本机有 `python3`、`rustc`、`cargo`、`go`。`make ci-conformance` 会先检查这些工具：缺少时报告缺了哪些并失败；CI 设置 `CI_ALLOW_MISSING_TOOLCHAINS=1` 时只给出警告并跳过。

## 4. 添加测试

- 测试放在 `test/<目录>/` 下，按[覆盖范围](./README.md#覆盖范围)选择目录。只验证一个包内部行为的测试，放回那个包自己的 `test/`。
- 通过包名导入（`@migaia/rpc-core`、`@migaia/rpc-process/adapters/node-child-process` 等），不要用相对路径引用其它包的 `src`，否则测到的就不是公开入口。
- 需要 `node` 直接运行的子进程或 Worker 夹具，可以写成 `.mjs`，并登记到 `scripts/fixtures/js-exceptions.json`，写明原因。其余文件一律用 TypeScript。
- 统计失败次数的夹具要记录完整分类（`source`、`code`、`name`、原因枚举和去敏后的消息），不能只记 `code`。
- 文件名以 `conformance` 开头的 `test/process` 测试、`test/bridge/conformance-faults.test.ts` 和 `test/merge/suite-parity.test.ts` 不在默认测试集里，分别由 `test:conformance` 和 `test:suite-parity` 运行。

## 5. 线上格式向量

`schema/vectors/*.json` 是与语言无关的协议样例：每个文件列出合法与非法的消息，以及期望的解析结果。`test/control`、`test/error-format`、`test/streaming`、`test/serialize` 用它们验证本仓库的实现，其它语言的实现也可以直接读取这些文件自测。

`schema/vectors/generate.mjs` 由 `canonical.json` 生成 `portable-values.json`。修改 `canonical.json` 后重新运行它：

```bash
node packages/rpc-integration/schema/vectors/generate.mjs
```

## 6. 性能测量

`bench/` 中的驱动测量 IPC 往返延迟、吞吐和进程 CPU/RSS。它们需要校准过的独占窗口，耗时也长，不属于普通 CI。用法、参数和结果复算方式见 [bench/README.md](./bench/README.md)。仓库的 `make perf-guard` 是 `bench:ipc` 的封装，要求传入当前窗口的噪声校准文件：

```bash
make perf-guard PERF_NOISE=raw/noise.json PERF_UNIT=node:stdio-framed:64 PERF_OUTPUT=raw/perf
```
