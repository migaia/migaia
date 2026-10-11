# @migaia/rpc-process 使用指南

从包根使用 `createProcessPeer`、`createProcessPlugin`。按平台导入 Node、Bun、Deno、Electron utility process 或 Windows job 的普通 adapter 子路径。

```ts
import { createProcessPeer } from '@migaia/rpc-process'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'
```

spawn 拥有执行单元；connect/listen 只持有自己的连接。Peer 的 request、notify、stream、group、outcome、取消、重试与 close 沿原实际资源生命周期执行。Core 持有 launch/bootstrap、provider 字节准入、listener 与 drain 机制；Native 包持有平台发现、stdio、socket 与 OS 资源。Electron、Koffi 仅是对应可选平台的 peer；使用进程不需要安装线程包。

RPC 包族精确锁步为 0.0.7，跨包 peer 使用精确版本。此工作不发布；仓内消费方直接导入各公开包。同一 realm 的第二份模块实例在取得资源前抛出 native Error，source 为 `@migaia/rpc/core`、code 为 `DUPLICATE_MODULE_INSTANCE`；修复依赖解析并重载 realm。不同 Worker realm 独立。既有六个语义 source、wire 与错误身份保持不变。

包内使用相对路径；跨包调用只使用公开 API。协议工具使用 `@migaia/rpc-contract`，Core/Remote/Testing 使用 `@migaia/rpc-core` 的普通入口。

从包根导入 `RPC_PROCESS_ERROR_SOURCE` 和 `RpcProcessErrorCode`，按 `(source, code)` 处理 launch、dial、listen 与资源采样失败。source 固定为 `@migaia/rpc/process`；原生 cause 与错误类型沿原路径保留。`RpcProcessErrorText` 已从公开面删除，这是更名后包的破坏性导出变更；消息只用于展示，不作为重试或终止依据。自定义 child bootstrap 继续使用 `@migaia/rpc-core/adapter/process-data` 的环境名、版本、frame 限额与发现超时常量；stderr 文本与配额常量属于私有诊断策略。

## Advanced usage：拥有子进程并调用远端服务

下面沿已存在的 Node stdio source 启动一个服务，在父端调用 `math.double`，并在 `finally` 关闭 Peer。两个 TypeScript 文件使用 ESM，先编译到同目录的 `.js`；`service.js` 必须是本应用实际部署的子端入口。

### 进程子端 service.ts

```ts
import { createProcessPeer } from '@migaia/rpc-process'

await createProcessPeer({
  provide: { math: { double: (value: number) => value * 2 } },
  report: (error) => console.error(error)
})
```

### createProcessPeer 父端 main.ts

```ts
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  createProcessPeer,
  createProcessTransport,
  type IProcessByteChannel
} from '@migaia/rpc-process'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'
import { createUnitBudget } from '@migaia/supervision'

type IChildApi = { math: { double: (value: number) => number } }
type IOptions = Parameters<typeof createProcessPeer<IChildApi>>[0]
type ISpawn = Exclude<NonNullable<IOptions['spawn']>, Function>
/** 收集原 source/code/cause 错误，不把失败当成重执许可。 */
const report = (error: unknown) => console.error(error)
/** 此 launcher 创建并持有本次原生进程。 */
const launcher = createNodeProcessLauncher()
/** 新会话凭据通过实际 bootstrap 交给该子进程，不写入日志。 */
const token = randomBytes(32).toString('base64url')
/** 保留 launcher 返回的实际 handle，建立连接时复用其字节资源与身份。 */
let handle: Awaited<ReturnType<typeof launcher.launch>>
/** 一个 source 组合监督预算、bootstrap 与同一次 launch 的真实通道。 */
const spawn: ISpawn = {
  kind: 'spawn',
  channelKind: 'byte',
  wire: 'native',
  token,
  supervision: {
    id: 'math-process',
    isolation: 'best-effort',
    report,
    launcher: {
      ...launcher,
      launch: async (spec, request) => {
        handle = await launcher.launch(spec, request)
        return handle
      }
    },
    budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
    spec: {
      command: process.execPath,
      args: [fileURLToPath(new URL('./service.js', import.meta.url))],
      env: { inherit: ['PATH'], set: {} },
      stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
      bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
    }
  },
  rawChannel: async () => handle.channel!,
  establish: (raw, prepared) =>
    createProcessTransport(raw as IProcessByteChannel, {
      role: 'initiator',
      offer: prepared.offer!,
      peerId: handle.runtimeApiIdentity!.instanceId,
      scheduler: prepared.scheduler,
      ipc: { ...prepared.session, log: () => undefined },
      report
    })
}
/** 工厂完成协商后，Peer 持有本次连接与执行单元的生命周期。 */
const typedRemote = await createProcessPeer<IChildApi>({ spawn, report })
try {
  console.log(await typedRemote.request('math.double', 21))
} finally {
  await typedRemote.close()
}
```

`launcher.launch` 返回实际 handle 后，`rawChannel` 才读取它的字节通道；`establish` 用该次 handle 的真实 instanceId 和原 prepared offer 创建通道。这里没有声明任意 transport 为 owned，也没有把复制的身份或 capabilities 当授信。`budget` 限定本应用的进程数，不能用它声称操作系统隔离或已测量资源用量。

`request` 的 Promise 给出业务结果，发送成功本身不代表服务已执行。`close()` 由原监督与 drain owner 结束这个 spawn 的连接和执行单元；使用 connect/listen 借用外部服务时，只关闭本端连接，外部进程仍由其原 owner 终止。遇到断线或未知结果，先按既有 source/code 策略对账，不自动重放副作用。
