/** Bilingual public boundary and original ownership contracts. */
import { findApiGuide } from '../api-guides.js'
import { rpcApiGuides } from '../rpc-api-guides.js'
import type { ILibraryReference, IMemberDoc } from './contract.js'

/** Canonical public SDK example shared by raw transport fields and lifecycle methods. */
const rpcRawCarrierExample =
  "import { MessageChannel } from 'node:worker_threads'\nimport { createEventEmitterMessageResource } from '@migaia/rpc-host/plugin'\nimport { RpcCapability } from '@migaia/rpc-contract'\nimport { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst ports = new MessageChannel()\nconst resources = [\n  createEventEmitterMessageResource(ports.port1),\n  createEventEmitterMessageResource(ports.port2)\n]\nconst channels = await Promise.all(resources.map((resource, index) => resource.open({\n  peerId: index === 0 ? 'right' : 'left',\n  scheduler: systemScheduler,\n  offer: [RpcCapability.runtimeApi, RpcCapability.batch],\n  control: rpcMessageCapabilityControl\n})))\nconst [left, right] = channels\nlet received!: () => void\nconst delivered = new Promise<void>((resolve) => { received = resolve })\nconst off = right!.transport.subscribe((message) => {\n  console.log(message.data)\n  received()\n})\ntry {\n  await left!.transport.send('hello')\n  await delivered\n} finally {\n  off()\n  await Promise.all(channels.map((channel) => channel.close?.()))\n  ports.port1.close()\n  ports.port2.close()\n}"

/** Exact SDK option documentation shared only by APIs consuming the same original contracts. */
const sdkOptions: Readonly<Record<string, IMemberDoc>> = {
  role: {
    summary: {
      en: 'Choose initiator to send hello, or responder to verify the received offer before accepting the ordered byte channel.',
      zh: '选择发起方发送问候，或响应方校验收到的提议后接纳有序字节通道。'
    }
  },
  offer: {
    summary: {
      en: 'Local capability and protocol proposal supplied by this adapter; only the received acknowledgement establishes the accepted agreement.',
      zh: '适配器提供的本地能力及协议提议，只有实际收到的确认才能确定接纳结果。'
    }
  },
  auth: {
    summary: {
      en: 'Responder authentication policy: required invokes the original verifier; none admits without a token verifier.',
      zh: '响应方认证策略，required 调用原验证器，none 不调用令牌验证器。'
    }
  },
  'auth.mode': {
    summary: {
      en: 'Use required for authenticated responder admission, or none for the explicitly unauthenticated responder path.',
      zh: '认证响应方接纳选择 required，显式不认证的响应路径选择 none。'
    }
  },
  'auth.verify': {
    summary: {
      en: 'Receives the remote authentication value and peer info; returns an optional principal synchronously or asynchronously. Throwing or rejection refuses the handshake.',
      zh: '接收远端认证值及对端信息，同步或异步返回可选主体；抛错或拒绝会拒绝握手。'
    }
  },
  platform: {
    summary: {
      en: 'Adapter-issued carrier label used in diagnostics; this presentation value grants no peer identity or trust.',
      zh: '适配器提供的载体诊断标签，仅用于展示，不授予对端身份或信任。'
    }
  },
  expectedStringText: {
    summary: {
      en: 'Canonical adapter diagnostic used when the physical connection supplies a non-text frame to its text pipeline.',
      zh: '物理连接向文本管线提供非文本帧时使用的适配器规范诊断文本。'
    }
  },
  peerId: {
    summary: {
      en: 'Direct peer address issued by the held deployment; runtime negotiation retains its own actual peer identity.',
      zh: '持有部署签发的直连地址，运行时协商仍保留实际对端身份。'
    }
  },
  signal: {
    summary: {
      en: 'Optional caller-owned abort signal stops opening and handshake work through the existing resource owner.',
      zh: '调用方可选取消信号通过原资源所有者停止打开及握手工作。'
    }
  },
  handshakeTimeoutMs: {
    summary: {
      en: 'Finite nonnegative opening budget in milliseconds; omission retains the canonical 10000 ms deadline.',
      zh: '有限非负的毫秒打开预算，省略时保留规范的 10000 毫秒期限。'
    }
  },
  scheduler: {
    summary: {
      en: 'Borrowed monotonic clock and timers for this preparation; optional connection schedulers default to systemScheduler.',
      zh: '此准备流程借入的单调时钟及定时器，连接中的可选调度器省略时使用 systemScheduler。'
    }
  },
  report: {
    summary: {
      en: 'Synchronous original background and secondary-cleanup error observer; it receives the original error without changing the business result.',
      zh: '原后台及次要清理错误的同步观察器，接收原错误，不改变业务结果。'
    }
  },
  ipc: {
    summary: {
      en: 'Original connection labels, bounded data/control backlog and diagnostic observer; no second message queue is created.',
      zh: '原连接标签、有界数据及控制积压和诊断观察器，不创建另一消息队列。'
    }
  },
  'ipc.connectionId': {
    summary: {
      en: 'Stable local connection label issued by the adapter for backlog diagnostics.',
      zh: '适配器为积压诊断签发的稳定本地连接标签。'
    }
  },
  'ipc.sessionId': {
    summary: {
      en: 'Session label issued by the actual accepted connection for diagnostic correlation.',
      zh: '实际接纳连接签发的会话标签，用于关联诊断。'
    }
  },
  'ipc.maxPendingData': {
    summary: {
      en: 'Positive safe-integer data capacity including active sends; omission keeps 256 entries.',
      zh: '包含活动发送的数据容量，必须为正安全整数，省略时为 256 项。'
    }
  },
  'ipc.maxPendingControl': {
    summary: {
      en: 'Positive safe-integer reserved control capacity including active sends; omission keeps 8 entries.',
      zh: '包含活动发送的保留控制容量，必须为正安全整数，省略时为 8 项。'
    }
  },
  'ipc.log': {
    summary: {
      en: 'Receives original backlog and physical diagnostic records; observer failures do not replace business settlement.',
      zh: '接收原积压及物理诊断记录，观察器失败不替换业务结算。'
    }
  },
  maxCallsPerMinute: {
    summary: {
      en: 'Per-connection admitted-call rate limit maintained by the original provider governor.',
      zh: '由原提供方治理器维护的逐连接每分钟接纳调用上限。'
    }
  },
  maxPayloadBytes: {
    summary: {
      en: 'Maximum payload size admitted by this connection before its provider executes.',
      zh: '此连接在提供方执行前接纳的最大载荷字节数。'
    }
  },
  maxConsecutiveTimeouts: {
    summary: {
      en: 'Consecutive deadline failures tolerated by the existing connection governor before session retirement.',
      zh: '既有连接治理器在退休会话前容忍的连续期限失败次数。'
    }
  },
  idleTimeoutMs: {
    summary: {
      en: 'Idle connection budget in milliseconds; the original governor owns the timer and closes only this session.',
      zh: '毫秒计的连接空闲预算，原治理器拥有定时器且仅关闭此会话。'
    }
  },
  violationLimit: {
    summary: {
      en: 'Number of quota violations handled by the existing governor before closing this connection.',
      zh: '既有治理器在关闭此连接前处理的配额违例次数。'
    }
  },
  overflow: {
    summary: {
      en: 'Adapter-owned source, code and message for quota rejection; diagnostics never grant control authority.',
      zh: '适配器拥有的配额拒绝来源、错误码及文本，诊断数据不授予控制权限。'
    }
  },
  openFailed: {
    summary: {
      en: 'Maps the actual native reader/writer acquisition error to the owning adapter error while preserving the original cause.',
      zh: '将实际原生读写器获取错误映射为所属适配器错误，同时保留原原因。'
    }
  },
  closedError: {
    summary: {
      en: 'Creates the adapter terminal error only when native EOF has no explicit error reason.',
      zh: '仅当原生输入结束且没有显式错误原因时创建适配器终态错误。'
    }
  },
  cleanupFailed: {
    summary: {
      en: 'Receives the original cleanup failures in an array and returns the owning aggregate with those same causes reachable.',
      zh: '接收原清理失败数组，返回仍可追溯同一原因对象的所属聚合错误。'
    }
  },
  runtime: {
    summary: {
      en: 'Local runtime presentation label supplied by the native adapter; it cannot supply decoded launch identity.',
      zh: '原生适配器提供的本地运行时展示标签，不能提供已解码启动身份。'
    }
  },
  diagnostics: {
    summary: {
      en: 'Canonical adapter failure identities and stable error text used by the original byte connection.',
      zh: '原字节连接使用的适配器规范失败身份及稳定错误文本。'
    }
  },
  bootstrapInvalidText: {
    summary: {
      en: 'Adapter-owned stable diagnostic for an invalid first-frame bootstrap received on the held byte resource.',
      zh: '在持有字节资源上收到无效首帧启动记录时使用的适配器稳定诊断文本。'
    }
  },
  initial: {
    summary: {
      en: 'Optional actual native first-message reader, including inbound/outbound direction; copied identity records are not accepted.',
      zh: '可选的实际原生首消息读取器及收发方向，不接受复制的身份记录。'
    }
  },
  connectTimeoutMs: {
    summary: {
      en: 'One finite connection preparation budget shared by native initial capture and acknowledgement; omission uses the existing SDK default.',
      zh: '原生首帧捕获及确认共用的一个有限连接准备预算，省略时使用既有 SDK 默认值。'
    }
  },
  name: {
    summary: {
      en: 'PluginHost registration name selected by the application; it identifies the installed remote contract.',
      zh: '应用选择的 PluginHost 登记名称，用于标识已安装远端契约。'
    }
  },
  contract: {
    summary: {
      en: 'Declared plugin feature and method schema used to validate the accepted remote description before publication.',
      zh: '发布前用于校验接纳远端描述的插件功能及方法声明。'
    }
  },
  host: {
    summary: {
      en: 'Existing PluginHost port that owns this registration and its native feature installation.',
      zh: '拥有此登记及原生功能安装的既有 PluginHost 接口。'
    }
  },
  binding: {
    summary: {
      en: 'Actual platform binding providing the original supervised generation, channel acquisition and clock.',
      zh: '提供原监督代次、通道获取及单调时钟的实际平台绑定。'
    }
  },
  endpointFactory: {
    summary: {
      en: 'Original channel and signal enter this endpoint factory; rejection rolls back construction without replacing the primary failure.',
      zh: '原通道及信号进入此端点工厂，拒绝时回滚构造且不替换主要失败。'
    }
  },
  keyFactory: {
    summary: {
      en: 'Synchronous application callback returning an idempotency key for a dispatch that needs an automatic key; the original request and outcome-ledger paths consume that string.',
      zh: '同步应用回调为需要自动键的派发返回幂等键，生成的字符串由原请求及结果账本路径消费。'
    }
  },
  retryPort: {
    summary: {
      en: 'Application retry dispatcher receives the original dispatch input and returns the selected result through the existing retry owner.',
      zh: '应用重试派发器接收原派发输入，通过既有重试所有者返回所选结果。'
    }
  },
  callDeadlineCapMs: {
    summary: {
      en: 'Application upper bound for remote call deadlines, interpreted by the original remote proxy rather than the transport handshake.',
      zh: '由原远端代理解释的应用调用期限上限，不是传输握手期限。'
    }
  },
  callGuard: {
    summary: {
      en: 'Application guard runs at the original remote-call admission boundary; rejection prevents that dispatch and retains its failure.',
      zh: '应用守卫在原远端调用准入处执行，拒绝会阻止该派发并保留失败。'
    }
  },
  byte: {
    summary: {
      en: 'Held ordered byte I/O acquired by the adapter; offer preparation does not open another reader or connection.',
      zh: '适配器已获取并持有的有序字节输入输出，提议准备不另开读取器或连接。'
    }
  },
  target: {
    summary: {
      en: 'Choose a plugin contract or host catalog to determine the JSON-RPC bridge method whitelist.',
      zh: '选择插件契约或宿主目录，以确定 JSON-RPC 桥的方法白名单。'
    }
  },
  'target.kind': {
    summary: {
      en: 'plugin selects the declared plugin contract; host selects the full Host catalog.',
      zh: 'plugin 选择声明插件契约，host 选择完整宿主目录。'
    }
  },
  'target.contract': {
    summary: {
      en: 'Explicit remote plugin contract used only with target.kind equal to plugin.',
      zh: '仅与 plugin 目标种类一起使用的显式远端插件契约。'
    }
  },
  'target.catalog': {
    summary: {
      en: 'Explicit Host plugin catalog used only with target.kind equal to host.',
      zh: '仅与 host 目标种类一起使用的显式宿主插件目录。'
    }
  },
  token: {
    summary: {
      en: 'Nonempty authentication token supplied by the launcher; keep this value out of diagnostic records.',
      zh: '启动器提供的非空认证令牌，不得放入诊断记录。'
    }
  },
  wallClock: {
    summary: {
      en: 'Borrowed epoch clock supplies handshake wall-time fields; local deadlines still use the monotonic scheduler.',
      zh: '借入的纪元时钟提供握手时间字段，本地期限仍使用单调调度器。'
    }
  },
  timeoutMs: {
    summary: {
      en: 'Optional bootstrap-read timeout in milliseconds; omission adds no bootstrap-read timer.',
      zh: '可选的毫秒启动记录读取期限，省略时不添加启动读取定时器。'
    }
  },
  mainEntry: {
    summary: {
      en: 'Native owner snapshot of the main module entry used to resolve self spawning and relative paths.',
      zh: '原生所有者提供的主模块入口快照，用于解析自身启动及相对路径。'
    }
  },
  base: {
    summary: {
      en: 'Explicit URL or path base for relative entry strings; exact URL inputs retain their original bytes.',
      zh: '相对入口字符串的显式 URL 或路径基准，精确 URL 输入保留原字节。'
    }
  },
  execArgv: {
    summary: {
      en: 'Native runtime argument snapshot used to reject interpreter and test-controller self-spawn contexts.',
      zh: '原生运行时参数快照，用于拒绝解释器及测试控制器的自身启动上下文。'
    }
  },
  electron: {
    summary: {
      en: 'Native owner indicates Electron entry semantics; no runtime globals are probed by this pure resolver.',
      zh: '原生所有者指出 Electron 入口语义，此纯解析器不探测运行时全局。'
    }
  },
  singleBinary: {
    summary: {
      en: 'Native owner marks a bundled executable where ordinary module self spawning is unavailable.',
      zh: '原生所有者标记无法执行普通模块自身启动的打包可执行文件。'
    }
  },
  selfAllowed: {
    summary: {
      en: 'Explicit permission from the native owner to resolve true as its snapshotted main entry; invalid harness contexts still reject.',
      zh: '原生所有者显式允许将 true 解析为其主入口快照，无效测试宿主上下文仍会拒绝。'
    }
  }
}

/** Authored public reference; author primitives retain their actual parameter and resource owners. */
export const rpcHostReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Start with createRpcHost, one transport plugin, and optional features. One host owns one actual call endpoint across all its sessions. Both sides provide and call methods; direct calls and broadcasts retain distinct result shapes.',
        zh: '从 `createRpcHost` 开始，安装一个传输插件和可选功能。一个宿主的所有会话共用一个实际调用端点，双方均可提供和调用方法；直连与广播保留不同结果形状。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },

    probe: {
      summary: {
        en: 'Observe original logical/carrier stages with defineProbe. Views are reused, so snapshot before retaining one. Install through defineFeaturePlugin; bounded collection and queries belong to rpc-plugin-devtools.',
        zh: '通过 `defineProbe` 观察原逻辑及载体阶段。视图会复用，保存前先取快照，再通过 `defineFeaturePlugin` 安装；有界采集和查询由观察插件负责。'
      },
      example:
        "import { defineProbe } from '@migaia/rpc-host/probe'\nimport { defineFeaturePlugin } from '@migaia/rpc-host/plugin'\n\nexport const observation = defineFeaturePlugin({\n  name: 'application-observer',\n  probe: defineProbe({\n    stages: ['message', 'peer'],\n    emit: (view) => console.log(Object.freeze({ ...view }))\n  })\n})"
    },

    plugin: {
      summary: {
        en: 'Author SDK for genuine transport/feature definitions and cold raw deployments. Submit original channels, listener receipts, or managed bindings rather than complete callable objects. Native first-frame holders establish child identity before endpoint construction.',
        zh: '插件作者通过此入口定义真实传输和功能及冷原始部署，提交原通道、监听回执或托管绑定，不把完整调用对象当作来源。原生首帧句柄在构造端点前确定子端身份。'
      },
      example:
        "import {\n  createAdapterDeployment,\n  defineTransportPlugin,\n  type IAdapterDeploymentContext,\n  type IRuntimePeerSourceResult\n} from '@migaia/rpc-host/plugin'\n\nexport function customTransport(\n  open: (context: IAdapterDeploymentContext) => Promise<IRuntimePeerSourceResult>\n) {\n  const deployment = createAdapterDeployment({ open })\n  return defineTransportPlugin({ name: 'custom', mode: 'connect', deployment })\n}"
    },
    features: {
      summary: {
        en: 'Install authFeature, chunkFeature, retryFeature, timeoutFeature, or typegenFeature beside the actual transport. Each definition appears at most once. Aggregate named imports and individual default imports select the same tree-shakable factories.',
        zh: '将认证、分块、重试、期限或类型生成功能与实际传输一起安装，每种定义至多一次；汇总命名导入与单功能默认导入选择同一可裁剪工厂。'
      },
      example:
        "import timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const deadline = timeoutFeature({ ms: 1500 })"
    },
    'features/timeout': {
      summary: {
        en: 'Provide a call default below explicit host and call timeouts. Default and aggregate exports select the same factory.',
        zh: '提供低于显式宿主及单次调用的默认期限。默认及汇总导出选择同一工厂。'
      },
      example:
        "import timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const deadline = timeoutFeature({ ms: 1500 })"
    },
    'features/typegen': {
      summary: {
        en: 'Generate declarations from accepted directories regardless of peer language; uninstall stops further output. Default and aggregate exports select the same factory.',
        zh: '从已接纳目录生成声明，不区分对端语言，卸载后停止输出。默认及汇总导出选择同一工厂。'
      },
      example:
        "import { typegenFeature } from '@migaia/rpc-host/features'\n\nexport const declarations = typegenFeature({\n  out: {\n    write: (fileName, text) => {\n      console.log(fileName, text)\n    }\n  }\n})"
    },
    'features/chunk': {
      summary: {
        en: 'Use the original single outbound framing and reassembly root. Default and aggregate exports select the same factory.',
        zh: '使用原唯一出站分块与重组根。默认及汇总导出选择同一工厂。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { chunkFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function callWithFeature(\n  transport: IRpcTransportPlugin\n) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [transport, chunkFeature()]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
    },
    'features/retry': {
      summary: {
        en: 'Use original generation-aware retry and unknown-result policy; never blindly replay non-idempotent work. Default and aggregate exports select the same factory.',
        zh: '使用原感知代次的重试及结果未知策略，不盲目重放非幂等业务。默认及汇总导出选择同一工厂。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { retryFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function callWithFeature(\n  transport: IRpcTransportPlugin\n) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [transport, retryFeature()]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
    },
    'features/auth': {
      summary: {
        en: 'Configure original signing/verification and optional paired encryption without changing replay or error ownership. Default and aggregate exports select the same factory.',
        zh: '配置原签名验证及可选成对加密，不改变重放及错误归属。默认及汇总导出选择同一工厂。'
      },
      example:
        "import { createRpcHost, type IRpcAuthenticationConfig } from '@migaia/rpc-host'\nimport { authFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function callWithFeature(\n  transport: IRpcTransportPlugin,\n  config: IRpcAuthenticationConfig\n) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [transport, authFeature(config)]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
    }
  },
  symbols: {
    RpcCoreErrorCode: {
      role: 'error',
      purpose: {
        en: 'Stable semantic failure codes owned by the runtime-neutral Core execution layer. The stable values below select actual contract behavior; declarations alone grant no capability.',
        zh: '运行时中立核心执行层拥有的稳定语义失败码。以下稳定取值选择实际契约行为；单独声明这些值不会赋予能力。'
      },
      example: 'console.log(RpcCoreErrorCode)'
    },
    RPC_CORE_ERROR_SOURCE: {
      role: 'error',
      purpose: {
        en: 'Identifies errors attributed to RPC Core for diagnostics. After catching an error, compare its source with RPC_CORE_ERROR_SOURCE before using code to distinguish failure kinds. These public fields describe a failure. Copying them onto another Error does not make Core treat it as an error created by its own local operation.',
        zh: '在诊断中标识归属 RPC Core 的错误。捕获错误后，先检查 source 是否等于 RPC_CORE_ERROR_SOURCE，再用 code 区分失败种类。这两个公开字段用于描述失败。把它们复制到另一个 Error 上，不会让 Core 把该错误认作自身本地操作创建的错误。'
      },
      example: 'if (isRpcError(error)) console.log(error.source, error.code)'
    },
    RpcProviderRejectionReason: {
      role: 'constant',
      purpose: {
        en: 'Actual local provider refusal branches sharing the public overload/capacity failure channel. The stable values below select actual contract behavior; declarations alone grant no capability.',
        zh: '共享公开过载容量失败通道的实际本地提供方拒绝分支。以下稳定取值选择实际契约行为；单独声明这些值不会赋予能力。'
      },
      example: 'console.log(RpcProviderRejectionReason)'
    },
    RpcPlatform: {
      role: 'constant',
      purpose: {
        en: 'Actual adapter platform labels used in endpoint diagnostics. The stable values below select actual contract behavior; declarations alone grant no capability.',
        zh: '端点诊断使用的实际适配器平台标签。以下稳定取值选择实际契约行为；单独声明这些值不会赋予能力。'
      },
      example: 'console.log(RpcPlatform)'
    },
    RpcTransportOwnership: {
      role: 'constant',
      purpose: {
        en: 'Determines which actual transport resources endpoint disposal may close. The stable values below select actual contract behavior; declarations alone grant no capability.',
        zh: '决定端点释放可以关闭哪些实际传输对象资源。以下稳定取值选择实际契约行为；单独声明这些值不会赋予能力。'
      },
      example: 'console.log(RpcTransportOwnership)'
    },
    RpcTransportEncoding: {
      role: 'constant',
      purpose: {
        en: 'Actual transport carrier domain matched to the selected codec and framer. The stable values below select actual contract behavior; declarations alone grant no capability.',
        zh: '与所选编解码及分帧匹配的实际传输值类型。以下稳定取值选择实际契约行为；单独声明这些值不会赋予能力。'
      },
      example: 'console.log(RpcTransportEncoding)'
    },
    RpcTransportTopology: {
      role: 'constant',
      purpose: {
        en: 'Actual peer fan-out topology declared by the original adapter. The stable values below select actual contract behavior; declarations alone grant no capability.',
        zh: '原适配器声明的实际对端扇出拓扑。以下稳定取值选择实际契约行为；单独声明这些值不会赋予能力。'
      },
      example: 'console.log(RpcTransportTopology)'
    },

    RpcOperation: {
      role: 'constant',
      purpose: {
        en: 'Single-target operation category supplied to the actual receiver selector. The stable values below select actual contract behavior; declarations alone grant no capability.',
        zh: '提供给实际接收端选择器的单目标操作类别。以下稳定取值选择实际契约行为；单独声明这些值不会赋予能力。'
      },
      example: 'console.log(RpcOperation)'
    },
    RpcCandidateStatus: {
      role: 'constant',
      purpose: {
        en: 'Original discovery owner state of one actual receiver candidate. The stable values below select actual contract behavior; declarations alone grant no capability.',
        zh: '原发现所有者给出的实际接收候选状态。以下稳定取值选择实际契约行为；单独声明这些值不会赋予能力。'
      },
      example: 'console.log(RpcCandidateStatus)'
    },
    RuntimeEventName: {
      role: 'constant',
      purpose: {
        en: 'Names of the lifecycle events passed to `peer.on(name, listener)` and `host.thread.on()` / `host.process.on()`.',
        zh: '传给 `peer.on(name, listener)` 以及 `host.thread.on()` / `host.process.on()` 的生命周期事件名称，用于订阅连接状态变化。'
      },
      example: "const off = peer.on('exit', (event) => console.warn(event.name, event.reason))"
    },
    createRpcIdempotencyStore: {
      role: 'factory',
      purpose: {
        en: 'Creates a bounded in-memory execution/outcome store with post-settlement retention. Byte pressure evicts completed bodies while retaining execution tombstones, so missing bodies do not authorize re-execution.',
        zh: '创建容量受限的内存执行与结果存储，保留期从操作结束时计算；字节压力可以淘汰已完成结果，但仍保留执行记录，因此缺少结果内容不表示可以再次执行。'
      },
      optionDocs: {
        retentionMs: {
          summary: {
            en: 'Positive safe-integer milliseconds retained after settlement; pending execution does not expire by this policy.',
            zh: '结算后保留的正安全整数毫秒，此策略不会使等待执行过期。'
          },
          default: {
            en: 'Default 300000; invalid nonpositive or unsafe integers fail INVALID_CONFIG.',
            zh: '默认 `300000`，非正数或非安全整数以配置非法失败。'
          }
        },
        maxEntries: {
          summary: {
            en: 'Positive safe-integer total original entry capacity.',
            zh: '正安全整数原始条目总容量。'
          },
          default: {
            en: 'Default 1024; invalid nonpositive or unsafe integers fail INVALID_CONFIG.',
            zh: '默认 `1024`，非正数或非安全整数以配置非法失败。'
          }
        },
        maxEntriesPerScope: {
          summary: {
            en: 'Positive safe-integer original entry capacity in each actual scope.',
            zh: '每个实际作用域的正安全整数原始条目容量。'
          },
          default: {
            en: 'Default 256; invalid nonpositive or unsafe integers fail INVALID_CONFIG.',
            zh: '默认 `256`，非正数或非安全整数以配置非法失败。'
          }
        },
        maxBytes: {
          summary: {
            en: 'Positive safe-integer total retained portable-outcome byte budget.',
            zh: '已保留可移植结果的正安全整数字节总预算。'
          },
          default: {
            en: 'Default 8388608; invalid nonpositive or unsafe integers fail INVALID_CONFIG.',
            zh: '默认 `8388608`，非正数或非安全整数以配置非法失败。'
          }
        },
        maxOutcomeBytes: {
          summary: {
            en: 'Positive safe-integer per-outcome retention budget; larger results leave an unavailable tombstone.',
            zh: '每项结果的保留预算，须为正安全整数；超过预算时仍保留结果已不可用的执行记录。'
          },
          default: {
            en: 'Default 1048576; invalid nonpositive or unsafe integers fail INVALID_CONFIG.',
            zh: '默认 `1048576`，非正数或非安全整数以配置非法失败。'
          }
        }
      },
      returns: {
        en: 'IRpcIdempotencyStore with no timers or dispose obligation; the session/provider owner controls scope/key admission.',
        zh: '返回不拥有计时器及释放义务的幂等存储，由会话或提供方所有者控制作用域及键准入。'
      },
      example:
        "import { createRpcIdempotencyStore } from '@migaia/rpc-host'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-v1')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))",
      optionCases: [
        {
          title: {
            en: 'Keep retry results for one checkout session',
            zh: '为一次结算保留重试结果'
          },
          problem: {
            en: 'An order submission can be retried after its reply is lost. Keep completed outcomes for five minutes so a retry with the same key can reuse its result. Bound entries per session so one checkout cannot consume the whole store.',
            zh: '订单提交后，答复丢失可能触发重试。保留五分钟结果，相同键的重试即可复用先前结果；限制每个会话的条目数，避免某次结算占满存储。'
          },
          example:
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host'\n\nconst orderOutcomes = createRpcIdempotencyStore({\n  retentionMs: 300000,\n  maxEntries: 1000,\n  maxEntriesPerScope: 20\n})",
          result: {
            en: 'Recent order results remain available to keyed retries within the configured capacity.',
            zh: '在设置的容量内，近期订单结果可供携带相同键的重试复用。'
          },
          covers: ['retentionMs', 'maxEntries', 'maxEntriesPerScope']
        },
        {
          title: {
            en: 'Keep large exports out of the outcome cache',
            zh: '避免导出文件占满结果缓存'
          },
          problem: {
            en: 'An export service returns much larger results than ordinary order calls. Bound total bytes and each outcome so caching exports cannot consume unbounded memory.',
            zh: '导出服务的结果远大于普通订单调用。限制总字节数与单个结果大小，避免缓存导出内容时无限占用内存。'
          },
          example:
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host'\n\nconst exportOutcomes = createRpcIdempotencyStore({\n  maxBytes: 8 * 1024 * 1024,\n  maxOutcomeBytes: 256 * 1024\n})",
          result: {
            en: 'The outcome store has an explicit memory budget for retained results.',
            zh: '保留结果的存储有明确内存预算。'
          },
          covers: ['maxBytes', 'maxOutcomeBytes']
        }
      ]
    },
    RpcLifecycleError: {
      role: 'error',
      purpose: {
        en: 'Constructs a public lifecycle diagnostic with ENDPOINT_DISPOSED code and optional original cleanup evidence. Direct construction does not mint owner-only live control identity.',
        zh: '构造带端点释放码及可选原清理证据的公开生命周期诊断，直接构造不签发所有者专属活动控制身份。'
      },
      params: {
        message: {
          en: 'Application-owned diagnostic message for this actual lifecycle boundary.',
          zh: '应用为此实际生命周期边界提供的诊断消息。'
        },
        cause: {
          en: 'Optional exact original primary failure; omitted means no cause.',
          zh: '可选精确原主要失败，省略表示没有原因。'
        },
        cleanupErrors: {
          en: 'Optional original cleanup failures labelled by their owning resources.',
          zh: '由所属资源标记的可选原清理失败。'
        }
      },
      returns: {
        en: 'Native RpcLifecycleError carrying original cause and cleanup references.',
        zh: '返回携带原始原因及清理引用的原生生命周期错误。'
      },
      example:
        'const error = new RpcLifecycleError("Application endpoint closed"); console.log(error.code)'
    },
    isRpcError: {
      role: 'operation',
      purpose: {
        en: 'Structurally recognizes a nonnull object with a string code; it does not validate source, known codes or local control identity.',
        zh: '结构识别含字符串错误码的非空对象，不校验来源、已知码或本地控制身份。'
      },
      params: {
        value: {
          en: 'Original unknown error received by the application; hostile diagnostic getters may throw PROPERTY_READ_FAILED.',
          zh: '应用接收的原未知错误，恶意诊断读取器可抛属性读取失败。'
        }
      },
      returns: {
        en: 'Boolean type guard for the documented diagnostic shape only.',
        zh: '返回只针对所述诊断形态的布尔类型守卫。'
      },
      example: 'if (isRpcError(error)) console.log(error.code)'
    },
    isRpcErrorInstance: {
      role: 'operation',
      purpose: {
        en: 'Recognizes exact Core source, a known Core code and an accepted Core native family name; cross-realm equivalents are supported without granting control rights.',
        zh: '识别精确核心来源、已知核心错误码及认可核心原生族名称，支持跨执行域等价诊断但不赋予控制权限。'
      },
      params: {
        value: {
          en: 'Original unknown error received by the application; hostile diagnostic getters may throw PROPERTY_READ_FAILED.',
          zh: '应用接收的原未知错误，恶意诊断读取器可抛属性读取失败。'
        }
      },
      returns: {
        en: 'Boolean type guard for the documented diagnostic shape only.',
        zh: '返回只针对所述诊断形态的布尔类型守卫。'
      },
      example: 'if (isRpcErrorInstance(error)) console.log(error.code)'
    },
    isRpcRemoteError: {
      role: 'operation',
      purpose: {
        en: 'Recognizes Core source plus remote family name and any string remote code, preserving the unrestricted peer-selected code domain.',
        zh: '识别核心来源、远端族名称及任意字符串远端码，保留不受限对端选择码域。'
      },
      params: {
        value: {
          en: 'Original unknown error received by the application; hostile diagnostic getters may throw PROPERTY_READ_FAILED.',
          zh: '应用接收的原未知错误，恶意诊断读取器可抛属性读取失败。'
        }
      },
      returns: {
        en: 'Boolean type guard for the documented diagnostic shape only.',
        zh: '返回只针对所述诊断形态的布尔类型守卫。'
      },
      example: 'if (isRpcRemoteError(error)) console.log(error.code)'
    },
    isRpcTimeoutError: {
      role: 'operation',
      purpose: {
        en: 'Recognizes exact Core source, timeout native family and DEADLINE_EXCEEDED code; copied diagnostics do not obtain owner decision authority.',
        zh: '识别精确核心来源、超时原生族及截止超出码，复制诊断不取得所有者决策权限。'
      },
      params: {
        value: {
          en: 'Original unknown error received by the application; hostile diagnostic getters may throw PROPERTY_READ_FAILED.',
          zh: '应用接收的原未知错误，恶意诊断读取器可抛属性读取失败。'
        }
      },
      returns: {
        en: 'Boolean type guard for the documented diagnostic shape only.',
        zh: '返回只针对所述诊断形态的布尔类型守卫。'
      },
      example: 'if (isRpcTimeoutError(error)) console.log(error.code)'
    },
    defaultRpcReporter: {
      role: 'operation',
      purpose: {
        en: 'Default background-failure sink writes the original failure to console.error. Explicit report callbacks receive the same original diagnostic events.',
        zh: '默认后台失败接收器把原始失败写入控制台错误输出，显式上报回调收到相同原诊断事件。'
      },
      params: {
        error: {
          en: 'Original observed background failure retaining identity and cause.',
          zh: '保留身份及原因的原已观察后台失败。'
        }
      },
      returns: {
        en: 'Synchronous diagnostic write completes; no business result is produced.',
        zh: '同步诊断写入完成，不产生业务结果。'
      },
      example: 'defaultRpcReporter(error)'
    },
    serializeRpcError: {
      role: 'operation',
      purpose: {
        en: 'Serializes the original error through rpc-contract while retaining private Core/Remote redaction summaries and admitted forwarding routes; callers cannot supply that private metadata.',
        zh: '经规范契约序列化原错误，同时保留核心及远端私有脱敏摘要及已准入转发路由，调用方不能提供该私有元数据。'
      },
      params: {
        value: {
          en: 'Original unknown held Core/Remote error or application throw value.',
          zh: '原持有核心或远端错误，或应用抛出值。'
        },
        options: {
          en: 'Required rpc-contract IRpcSerializeErrorOptions with synchronous original error reporter.',
          zh: '必需契约错误序列化选项，包含同步原错误上报者。'
        }
      },
      returns: {
        en: 'IRpcSerializedError with bounded truncation markers; no shared last-result state.',
        zh: '返回带有界截断标记的 `IRpcSerializedError`，不存在共享上次结果状态。'
      },
      example: {
        en: "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-host/plugin'\n\nconst original = new RangeError('limit exceeded')\nObject.defineProperties(original, { source: { value: 'example' }, code: { value: 'LIMIT' } })\nconst primary = new TypeError('request failed', { cause: original })\nObject.defineProperties(primary, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst reports: unknown[] = []\nconst wire = serializeRpcError(primary, { report: (failure) => { reports.push(failure) } })\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof TypeError, restored.cause instanceof RangeError)\nconsole.log(restored.stack === primary.stack, (restored.cause as Error).stack === original.stack)\nconsole.log((restored as Error & { code: string }).code,\n  (restored.cause as Error & { code: string }).code, reports.length)",
        zh: "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-host/plugin'\n\nconst original = new RangeError('超过限制')\nObject.defineProperties(original, { source: { value: 'example' }, code: { value: 'LIMIT' } })\nconst primary = new TypeError('请求失败', { cause: original })\nObject.defineProperties(primary, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst reports: unknown[] = []\nconst wire = serializeRpcError(primary, { report: (failure) => { reports.push(failure) } })\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof TypeError, restored.cause instanceof RangeError)\nconsole.log(restored.stack === primary.stack, (restored.cause as Error).stack === original.stack)\nconsole.log((restored as Error & { code: string }).code,\n  (restored.cause as Error & { code: string }).code, reports.length)"
      },
      exampleIntro: {
        en: 'A remote operation fails with a TypeError caused by a RangeError. The receiver needs both semantic codes and the original stacks to understand which operation failed and why.\n\nSending only error.message drops the cause tree, native classes and stacks. Creating a fresh local error from that text assigns a receiving-side stack that hides the original failure location.\n\nserializeRpcError projects a bounded coded tree, and deserializeRpcError validates it before restoring native classes. Supply the required report callback to retain any fields that cannot be read or normalized.',
        zh: '远端操作因范围错误而抛出类型错误，接收方需要两层语义码和原始堆栈，才能辨认失败操作及根因。\n\n只发送错误消息会丢掉原因树、原生类型与堆栈，用该文字在本地重建错误，又会生成接收端堆栈并掩盖原始失败位置。\n\n`serializeRpcError` 投影有界带码树，`deserializeRpcError` 校验后恢复原生类型，须提供 `report` 回调以保留无法读取或规范化字段的失败。'
      },
      exampleResult: {
        en: 'Prints `true true`, `true true`, then `REQUEST LIMIT 0`. Both native classes and stack strings survive the round trip, both semantic codes remain present, and no field failures are reported.\n\nRestoration creates new Error objects, so cross-boundary object identity is not preserved. The tree is bounded and can carry cause, AggregateError errors and a truncation marker; no connection or request is executed by these functions.',
        zh: '逐行输出 `true true`、`true true`、`REQUEST LIMIT 0`，往返保留两种原生类型、两份堆栈字符串和语义码，未报告字段失败。\n\n恢复会创建新的错误对象，不保留跨边界对象身份；错误树有界，可携带 `cause`、聚合错误子项和截断标记，这些函数不建立连接或执行请求。'
      },
      cases: [
        {
          title: {
            en: 'Preserve native error classes and remote cause stacks',
            zh: '保留原生错误类型与远端原因堆栈'
          },
          problem: {
            en: 'A remote operation fails with a TypeError caused by a RangeError. The receiver needs both semantic codes and the original stacks to understand which operation failed and why.\n\nSending only error.message drops the cause tree, native classes and stacks. Creating a fresh local error from that text assigns a receiving-side stack that hides the original failure location.\n\nserializeRpcError projects a bounded coded tree, and deserializeRpcError validates it before restoring native classes. Supply the required report callback to retain any fields that cannot be read or normalized.',
            zh: '远端操作因范围错误而抛出类型错误，接收方需要两层语义码和原始堆栈，才能辨认失败操作及根因。\n\n只发送错误消息会丢掉原因树、原生类型与堆栈，用该文字在本地重建错误，又会生成接收端堆栈并掩盖原始失败位置。\n\n`serializeRpcError` 投影有界带码树，`deserializeRpcError` 校验后恢复原生类型，须提供 `report` 回调以保留无法读取或规范化字段的失败。'
          },
          example: {
            en: "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-host/plugin'\n\nconst original = new RangeError('limit exceeded')\nObject.defineProperties(original, { source: { value: 'example' }, code: { value: 'LIMIT' } })\nconst primary = new TypeError('request failed', { cause: original })\nObject.defineProperties(primary, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst reports: unknown[] = []\nconst wire = serializeRpcError(primary, { report: (failure) => { reports.push(failure) } })\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof TypeError, restored.cause instanceof RangeError)\nconsole.log(restored.stack === primary.stack, (restored.cause as Error).stack === original.stack)\nconsole.log((restored as Error & { code: string }).code,\n  (restored.cause as Error & { code: string }).code, reports.length)",
            zh: "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-host/plugin'\n\nconst original = new RangeError('超过限制')\nObject.defineProperties(original, { source: { value: 'example' }, code: { value: 'LIMIT' } })\nconst primary = new TypeError('请求失败', { cause: original })\nObject.defineProperties(primary, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst reports: unknown[] = []\nconst wire = serializeRpcError(primary, { report: (failure) => { reports.push(failure) } })\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof TypeError, restored.cause instanceof RangeError)\nconsole.log(restored.stack === primary.stack, (restored.cause as Error).stack === original.stack)\nconsole.log((restored as Error & { code: string }).code,\n  (restored.cause as Error & { code: string }).code, reports.length)"
          },
          result: {
            en: 'Prints `true true`, `true true`, then `REQUEST LIMIT 0`. Both native classes and stack strings survive the round trip, both semantic codes remain present, and no field failures are reported.\n\nRestoration creates new Error objects, so cross-boundary object identity is not preserved. The tree is bounded and can carry cause, AggregateError errors and a truncation marker; no connection or request is executed by these functions.',
            zh: '逐行输出 `true true`、`true true`、`REQUEST LIMIT 0`，往返保留两种原生类型、两份堆栈字符串和语义码，未报告字段失败。\n\n恢复会创建新的错误对象，不保留跨边界对象身份；错误树有界，可携带 `cause`、聚合错误子项和截断标记，这些函数不建立连接或执行请求。'
          }
        },
        {
          title: {
            en: 'Report unreadable error fields without losing the wire error',
            zh: '报告不可读字段并继续生成线上错误'
          },
          problem: {
            en: 'A diagnostic serializer encounters an Error whose message getter throws. Losing the whole diagnostic would hide both the original operation and the new field-read failure.\n\nDirect property reads while building a JSON object let the getter exception escape the logging path. Ignoring that exception instead removes evidence that a field was omitted.\n\nserializeRpcError captures supported fields and routes omitted read failures to report. Save the fixture stack before installing its hostile message getter, then collect each report record for inspection.',
            zh: '诊断序列化遇到消息访问器会抛错的错误对象，丢弃整条诊断会同时掩盖原操作与新的字段读取失败。\n\n构建 JSON 对象时直接读取属性，会让访问器异常逃出日志路径，若忽略该异常，又会丢失字段被省略的依据。\n\n`serializeRpcError` 捕获支持字段，并把被省略的读取失败交给 `report`；本例先保存错误堆栈，再设置会抛错的消息访问器，收集报告记录供检查。'
          },
          example: {
            en: "import { serializeRpcError } from '@migaia/rpc-host/plugin'\nimport type { IRpcWireErrorFailure } from '@migaia/rpc-contract/errors'\n\nconst original = new TypeError('message access failed')\nconst failure = new Error('unreadable message')\nvoid failure.stack\nObject.defineProperty(failure, 'message', { get: () => { throw original } })\nconst reports: IRpcWireErrorFailure[] = []\nconst wire = serializeRpcError(failure, { report: (entry) => { reports.push(entry) } })\nconsole.log(wire.name, wire.code)\nconsole.log(reports.length, reports[0]?.field, reports[0]?.error === original)",
            zh: "import { serializeRpcError } from '@migaia/rpc-host/plugin'\nimport type { IRpcWireErrorFailure } from '@migaia/rpc-contract/errors'\n\nconst original = new TypeError('消息读取失败')\nconst failure = new Error('不可读消息')\nvoid failure.stack\nObject.defineProperty(failure, 'message', { get: () => { throw original } })\nconst reports: IRpcWireErrorFailure[] = []\nconst wire = serializeRpcError(failure, { report: (entry) => { reports.push(entry) } })\nconsole.log(wire.name, wire.code)\nconsole.log(reports.length, reports[0]?.field, reports[0]?.error === original)"
          },
          result: {
            en: 'Prints `Error UNKNOWN` and `1 message true`. A wire error is still returned, and the report identifies the unreadable message field with the exact original TypeError.\n\nreport is required and receives pointer, field and the original failure synchronously. These records are local diagnostic evidence, not extra wire fields. Untagged errors use the unknown source/code fallback; unreadable fields follow the bounded serializer policy.',
            zh: '逐行输出 `Error UNKNOWN`、`1 message true`，仍返回线上错误，报告指出不可读的消息字段并保留原始 `TypeError`。\n\n`report` 必填，同步收到指针、字段和原始失败；这些记录是本地诊断依据，不是额外线上字段，未编码错误使用未知来源与错误码兜底，不可读字段遵守有界序列化策略。'
          }
        }
      ],
      optionDocs: {
        report: {
          summary: {
            en: 'Application synchronous callback receives IRpcWireErrorFailure with pointer, field and original error; return void and avoid throwing.',
            zh: '应用同步回调接收含指针、字段及原错误的失败记录，返回空值并避免抛错。'
          },
          whenToUse: {
            en: 'Always supply a local diagnostic sink for failed reads or portable projections omitted from the wire error. The callback receives pointer, field and the original failure. There is no default reporter.',
            zh: '必须为线上错误省略的读取或可移植投影失败提供本地诊断接收方。回调接收 pointer、field 和原始失败。没有默认报告方。'
          },
          example:
            "import { serializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst wire = serializeRpcError(checkoutFailure, {\n  report: (failure) => reportSerializationFailure(failure)\n})\nsendFailureToCheckout(wire)"
        }
      }
    },
    deserializeRpcError: {
      role: 'operation',
      purpose: {
        en: 'Restores an actual serialized error through rpc-contract and retains its admitted route for subsequent original Core forwarding; received codes remain diagnostic data.',
        zh: '经规范契约恢复实际序列化错误，并保留已准入路由供原核心后续转发，接收的码仍是诊断数据。'
      },
      params: {
        value: {
          en: 'Actual serialized wire error received from the original remote owner.',
          zh: '从原远端所有者接收的实际线上序列化错误。'
        },
        options: {
          en: 'Optional rpc-contract IRpcWireErrorOptions controlling unknown-field handling.',
          zh: '控制未知字段处理的可选契约线上错误选项。'
        }
      },
      returns: {
        en: 'Restored native Error tree; malformed input throws INVALID_WIRE_ERROR before restoration.',
        zh: '返回恢复的原生错误树；异常输入在恢复前抛出线上错误非法错误。'
      },
      example:
        "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-host/plugin'\nconst original = new Error('Application failure')\nconst wire = serializeRpcError(original, { report: (error) => console.error(error) })\nconst restored = deserializeRpcError(wire)\nconsole.log(restored.message)",
      optionDocs: {
        unknownFields: {
          summary: {
            en: 'Chooses rejection or ignored admission of unknown received error-node fields.',
            zh: '选择拒绝或忽略接纳收到的未知错误节点字段。'
          },
          default: {
            en: '`reject`; unknown fields fail validation.',
            zh: '默认拒绝，未知字段会使校验失败。'
          },
          values: {
            reject: {
              en: 'Reject extra error-node fields with INVALID_WIRE_ERROR.',
              zh: '遇到额外错误节点字段时以编码错误拒绝。'
            },
            ignore: {
              en: 'Ignore unknown fields while optionally invoking the warning callback.',
              zh: '忽略未知字段，同时可调用警告回调。'
            }
          },
          whenToUse: {
            en: 'Use reject for strict received-error schemas; it is the default. Use ignore only when additive fields may be dropped. The observer does not choose or change that policy.',
            zh: '需要严格接收错误结构时用 reject，它也是默认值。仅允许丢弃新增字段时用 ignore。观察回调不选择或改变策略。'
          },
          example:
            "import { deserializeRpcError } from '@migaia/rpc-host/plugin'\n\nconst failure = deserializeRpcError(receivedError, { unknownFields: 'ignore' })\nshowConnectionError(failure.message)"
        },
        onUnknownField: {
          summary: {
            en: 'Optional synchronous application callback receives JSON pointer and unknown field name; returns void. A throw propagates from normalization.',
            zh: '可选应用同步回调接收对象指针及未知字段名称，返回空值；抛错从规范化调用传播。'
          },
          default: {
            en: 'Omitted; no observer is called. The default unknownFields policy still rejects unknown error-node fields.',
            zh: '默认省略，不调用观察者；默认 `unknownFields` 策略仍拒绝未知错误节点字段。'
          },
          whenToUse: {
            en: 'Use it with unknownFields ignore to record fields dropped from a newer peer’s error. Omit it for no observer; the default reject policy still rejects unknown fields.',
            zh: '使用 unknownFields ignore 接收新版本对端错误时，用它记录丢弃字段。省略时没有观察者；默认 reject 策略仍拒绝未知字段。'
          },
          example:
            "import { deserializeRpcError } from '@migaia/rpc-host/plugin'\n\nconst failure = deserializeRpcError(receivedError, {\n  unknownFields: 'ignore',\n  onUnknownField: (pointer, field) => reportDroppedErrorField(pointer, field)\n})\nshowConnectionError(failure.message)"
        }
      }
    },

    RpcProbeStage: {
      role: 'constant',
      purpose: {
        en: 'Stable numeric stages follow one operation from logical ownership to actual physical I/O.',
        zh: '稳定数字阶段跟随一次操作，从逻辑所有权到实际物理读写。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    RpcProbeDirection: {
      role: 'constant',
      purpose: {
        en: 'Numeric traffic directions distinguish original outbound, inbound and local observations.',
        zh: '数字流量方向区分原出站、入站及端点本地生命周期观察。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    RpcProbeKind: {
      role: 'constant',
      purpose: {
        en: 'Numeric interaction kinds identify which original operation an event concerns.',
        zh: '数字交互种类标识事件涉及的原始请求、流及控制操作。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    RpcProbeOutcome: {
      role: 'constant',
      purpose: {
        en: 'Numeric outcomes describe progress, admission and settlement at the observed stage.',
        zh: '数字结果描述实际观察阶段中的操作进度、准入及最终结算。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    RpcProbeStageName: {
      role: 'constant',
      purpose: {
        en: 'Frozen ordinal-to-name table aligned with RpcProbeStage; use it to format diagnostics, retaining the original numeric dispatch values.',
        zh: '与对应数字域对齐的冻结序号名称表，用于格式化诊断，同时保留原始数字派发值。'
      },
      example: 'console.log(RpcProbeStageName[0])'
    },
    RpcProbeDirectionName: {
      role: 'constant',
      purpose: {
        en: 'Frozen ordinal-to-name table aligned with RpcProbeDirection; use it to format diagnostics, retaining the original numeric dispatch values.',
        zh: '与对应数字域对齐的冻结序号名称表，用于格式化诊断，同时保留原始数字派发值。'
      },
      example: 'console.log(RpcProbeDirectionName[0])'
    },
    RpcProbeKindName: {
      role: 'constant',
      purpose: {
        en: 'Frozen ordinal-to-name table aligned with RpcProbeKind; use it to format diagnostics, retaining the original numeric dispatch values.',
        zh: '与对应数字域对齐的冻结序号名称表，用于格式化诊断，同时保留原始数字派发值。'
      },
      example: 'console.log(RpcProbeKindName[0])'
    },
    RpcProbeOutcomeName: {
      role: 'constant',
      purpose: {
        en: 'Frozen ordinal-to-name table aligned with RpcProbeOutcome; use it to format diagnostics, retaining the original numeric dispatch values.',
        zh: '与对应数字域对齐的冻结序号名称表，用于格式化诊断，同时保留原始数字派发值。'
      },
      example: 'console.log(RpcProbeOutcomeName[0])'
    },
    IpcReporterContext: {
      role: 'constant',
      purpose: {
        en: 'Frozen utils reporter classification with operation limiter and phase reporter; use it only for secondary IPC observer failures.',
        zh: '冻结的工具上报分类，操作为限制器、阶段为上报者，只用于次级进程通信观察失败。'
      },
      example: 'hostRethrowReporter(error, IpcReporterContext)'
    },
    hostRethrowReporter: {
      role: 'operation',
      purpose: {
        en: 'Canonical @migaia/utils/promise reporter preserves an unhandled diagnostic failure at the host reporting boundary; it does not convert it into an RPC result.',
        zh: '规范工具包上报函数把未处理诊断失败交给宿主上报边界，不把失败转换为远程调用结果。'
      },
      params: {
        error: {
          en: 'The original observed reporter failure, preserving its identity.',
          zh: '保留身份的原始已观察上报失败。'
        },
        context: {
          en: 'Actual utils reporter context; IPC observations use IpcReporterContext.',
          zh: '实际工具上报上下文，进程通信观察使用其规范分类对象。'
        }
      },
      returns: {
        en: 'Reports to the native host; no business result is returned.',
        zh: '交给原生宿主上报，不返回业务结果。'
      },
      example: 'hostRethrowReporter(error, IpcReporterContext)'
    },
    defineProbe: {
      role: 'factory',
      purpose: {
        en: 'Compiles a validated standalone probe, or attaches the five reserved fields to an extensible host and freezes that same host. It emits nothing until supplied through the Host probe option.',
        zh: '编译已校验独立探针，或向可扩展宿主附加五个保留字段并冻结同一宿主；交给 Host 的 probe 选项后才产生观察。'
      },
      params: {
        definition: {
          en: 'Application IRpcProbeDefinition; callbacks and filters are captured once.',
          zh: '应用提供的探针定义，回调及过滤器只捕获一次。'
        },
        host: {
          en: 'Optional original extensible nonfrozen application object with none of the reserved own fields; omit this argument for a standalone handle.',
          zh: '可选原应用对象，须可扩展、未冻结且不占用保留自有字段，独立句柄应省略此实参。'
        }
      },
      options: 'IRpcProbeDefinition',
      returns: {
        en: 'Genuine frozen IRpcProbe or the same frozen augmented host. Invalid definition or host throws coded TypeError INVALID_CONFIG.',
        zh: '返回真实冻结探针或同一冻结增强宿主，定义或宿主非法时抛带配置非法码的类型错误。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },

    readProbeStages: {
      role: 'operation',
      purpose: {
        en: 'Reads the current private subscription mask for genuine handles and attached frozen hosts; structural values fall back to their stageMask field.',
        zh: '读取真实句柄及附加冻结宿主的当前私有订阅掩码，结构值回退读取其公开阶段掩码。'
      },
      params: {
        probe: {
          en: 'Original defineProbe result whose current subscription is needed.',
          zh: '需要读取当前订阅的原探针定义结果。'
        }
      },
      returns: {
        en: 'Current numeric stage bitmask, including later successful setStages updates.',
        zh: '返回当前数字阶段位掩码，包含后续成功更新。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    subscribeProbeStages: {
      role: 'operation',
      purpose: {
        en: 'Registers a cold synchronous callback on a genuine probe for changed stage masks. Structural probes do not receive a private subscription.',
        zh: '为真实探针登记阶段掩码改变时的同步冷回调，结构探针不会取得私有订阅。'
      },
      params: {
        probe: {
          en: 'Original defineProbe result; only that owner has private subscriptions.',
          zh: '原探针定义结果，只有该所有者拥有私有订阅。'
        },
        listener: {
          en: 'Application zero-argument synchronous callback; return void. It runs after state changes; failures remain observable after every subscriber has received the committed mask.',
          zh: '应用无参同步回调，返回空值，在状态改变后运行，全部订阅接收已提交掩码后仍可观察其失败。'
        }
      },
      returns: {
        en: 'Idempotent release removes this callback only.',
        zh: '返回幂等移除函数，只移除本回调。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    rpcProbeSampleKey: {
      role: 'operation',
      purpose: {
        en: 'Returns deterministic unsigned FNV-1a of UTF-8 senderId plus messageId. This sampling key preserves sender/receiver correlation, not authentication or unique identity.',
        zh: '返回发送标识加消息标识的确定性无符号散列采样键，保留发送接收关联，不提供认证或唯一身份。'
      },
      params: {
        senderId: {
          en: 'Actual sender identifier from the observed route, issued by endpoint configuration.',
          zh: '观察路由中的实际发送标识，由端点配置签发。'
        },
        messageId: {
          en: 'Actual message identifier issued by the original outbound owner.',
          zh: '原出站所有者签发的实际消息标识。'
        }
      },
      returns: {
        en: 'Unsigned 32-bit deterministic sampling key; malformed UTF-16 is replaced before UTF-8 hashing.',
        zh: '返回无符号三十二位确定性采样键，非法代理码元在散列前替换。'
      },
      example: 'console.log(rpcProbeSampleKey("client", "message-1"))'
    },
    IpcLogEventName: {
      role: 'constant',
      purpose: {
        en: 'Connection-local diagnostic event names distinguish capacity transitions, send failures and explicit process stderr.',
        zh: '连接本地诊断事件名区分容量变化、发送失败及显式进程标准错误。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IpcSendClass: {
      role: 'constant',
      purpose: {
        en: 'Whole-envelope admission reserves separate total capacities for business data and control messages.',
        zh: '完整消息封装准入分别为业务数据及控制消息预留总容量。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    createIpcSendQueueFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Creates one bounded original connection gate and its native feature. Pair the feature with createIpcSendQueueTransport using that exact gate.',
        zh: '为现有连接创建有界发送队列和原生功能，再把同一个队列控制对象交给 `createIpcSendQueueTransport`。'
      },
      options: 'IIpcSendQueueOptions',
      returns: {
        en: 'IIpcSendQueueInstallation; invalid capacities throw INVALID_CONFIG before acquiring resources.',
        zh: '返回发送队列安装对象，非法容量在取得资源前抛配置非法错误。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      optionCases: [
        {
          title: {
            en: 'Keep a busy import from filling the send queue',
            zh: '避免繁忙导入占满发送队列'
          },
          problem: {
            en: 'An import produces data faster than the carrier drains it. Bound pending data separately from control messages so data load has an explicit queue budget.',
            zh: '导入产生数据的速度超过载体排空速度。分别限制待发数据和控制消息，为数据负载设置明确队列预算。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The connection has separate bounded queues for data and control traffic.',
            zh: '连接的数据与控制流量各有有界队列。'
          },
          covers: ['connectionId', 'maxPendingData', 'maxPendingControl']
        },
        {
          title: {
            en: 'Associate queue activity with one session',
            zh: '把队列活动归到对应会话'
          },
          problem: {
            en: 'A desktop process serves several sessions. Give the queue the connection and session identifiers used by application diagnostics so operators can locate a busy link.',
            zh: '桌面进程同时服务多个会话。为队列设置应用诊断使用的连接和会话标识，便于定位繁忙链路。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'Queue diagnostics can be associated with the selected connection and session.',
            zh: '队列诊断可归到所选连接和会话。'
          },
          covers: ['connectionId', 'sessionId']
        }
      ]
    },
    createIpcLogFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Observes the original gate and explicit stderr without changing operation results; asynchronous sink failures are observed through the mandatory secondary sink.',
        zh: '观察现有队列及应用显式提供的标准错误记录，不改变发送结果；异步报告失败交给必填的次级错误回调。'
      },
      optionDocs: {
        gate: {
          summary: {
            en: 'Exact original connection gate returned by createIpcSendQueueFeature.',
            zh: '本连接发送队列功能返回的同一个容量控制对象。'
          }
        },
        report: {
          summary: {
            en: 'Application callback receives IIpcLogRecord, returns void or Promise<void>; throws/rejections go to onReportError.',
            zh: '应用回调接收本地日志记录，返回空值或 Promise，抛错及拒绝交上报错误回调。'
          },
          whenToUse: {
            en: 'Observe local diagnostics and send sink failures to a separate application owner.',
            zh: '观察本地诊断，并把接收器失败交给独立应用所有者。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        onReportError: {
          summary: {
            en: 'Application callback receives original error and the same record, returns void or Promise<void>; secondary failure goes to hostRethrowReporter.',
            zh: '应用回调接收原错误及同一记录，返回空值或 Promise，次级失败交规范宿主上报。'
          },
          whenToUse: {
            en: 'Observe local diagnostics and send sink failures to a separate application owner.',
            zh: '观察本地诊断，并把接收器失败交给独立应用所有者。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        }
      },
      returns: {
        en: 'IIpcLogInstallation containing the feature token and explicit stderr intake.',
        zh: '返回包含功能令牌及显式标准错误入口的日志安装对象。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      optionCases: [
        {
          title: {
            en: 'Report connection diagnostics to monitoring',
            zh: '上报连接诊断'
          },
          problem: {
            en: 'A desktop link needs diagnostics in the application monitor. Pass its existing gate and report callback to the log feature, rather than adding log calls to each RPC method.',
            zh: '桌面链路需要向应用监控发送诊断。把已有 gate 和上报回调交给日志功能，避免逐个 RPC 方法添加日志。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The application monitor receives diagnostics from the selected gate.',
            zh: '应用监控收到所选 gate 的诊断。'
          },
          covers: ['gate', 'report', 'onReportError']
        },
        {
          title: {
            en: 'Report failure of the diagnostic sink',
            zh: '报告诊断接收器自身的故障'
          },
          problem: {
            en: 'The primary diagnostic sink can fail. Use a separate callback for sink errors so an unavailable logging service does not silently hide its own failure.',
            zh: '主要诊断接收器也可能失败。用独立回调处理接收器错误，避免日志服务不可用时连自身故障都被隐藏。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The fallback monitor receives sink failures with the associated diagnostic event.',
            zh: '备用监控收到接收器故障及对应诊断事件。'
          },
          covers: ['onReportError']
        }
      ]
    },

    createBrowserMessagePortTransport: {
      role: 'enhancer',
      purpose: {
        en: 'Wraps an original browser MessagePort with lazy native listeners, generation-bound observation and explicit physical cleanup ownership.',
        zh: '把浏览器 MessagePort 接入 Core，按需登记底层监听，隔离探针的多次安装，并明确端口的关闭责任。'
      },
      params: {
        port: {
          en: 'Original native port created by the application MessageChannel, Worker launcher or actual runtime resource.',
          zh: '调用方用 MessageChannel、Worker 启动器或其他运行资源取得的原生端口。'
        }
      },
      options: 'IBrowserMessagePortTransportOptions',
      returns: {
        en: 'IRpcTransport retaining the actual carrier and native failures; endpoint composition does not acquire capabilities from copied labels.',
        zh: '返回 `IRpcTransport`，保留底层载体和原生错误；复制它的标签不能获得额外能力。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      optionCases: [
        {
          title: {
            en: 'Close a port with its RPC wrapper',
            zh: '随 RPC 包装器关闭端口'
          },
          problem: {
            en: 'A pane creates a MessageChannel solely for this RPC connection. Transfer closure responsibility to the wrapper so its cleanup also closes the original port.',
            zh: '面板专门为此 RPC 连接创建 MessageChannel。把关闭责任交给包装器，清理时即可一并关闭原端口。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'Closing the transport also closes the port it owns.',
            zh: '关闭传输对象时也会关闭它拥有的端口。'
          },
          covers: ['ownership']
        },
        {
          title: {
            en: 'Keep a shared port under its creator',
            zh: '由创建者管理共享端口'
          },
          problem: {
            en: 'A shell owns a port longer than one RPC view. Borrow the port so disposing this view’s transport does not close the shell’s resource.',
            zh: '外壳持有端口的时间长于单个 RPC 视图。借用端口，使视图释放传输对象时不会关闭外壳的资源。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The shell keeps control of the original port’s final close.',
            zh: '原端口的最终关闭仍由外壳控制。'
          },
          covers: ['ownership']
        }
      ]
    },
    createWebWorkerTransport: {
      role: 'enhancer',
      purpose: {
        en: 'Wraps original Worker-like event I/O as a borrowed exclusive carrier; script/clone/read failures use transport errors, and cleanup never terminates the Worker.',
        zh: '把 Worker 事件接口包装为借用的独占载体；脚本、克隆和读取失败通过传输错误通道报告，清理不会终止 Worker。'
      },
      params: {
        port: {
          en: 'Original native port created by the application MessageChannel, Worker launcher or actual runtime resource.',
          zh: '调用方用 MessageChannel、Worker 启动器或其他运行资源取得的原生端口。'
        }
      },
      options: 'IWebWorkerTransportOptions',
      returns: {
        en: 'IRpcTransport retaining the actual carrier and native failures; endpoint composition does not acquire capabilities from copied labels.',
        zh: '返回 `IRpcTransport`，保留底层载体和原生错误；复制它的标签不能获得额外能力。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      optionCases: [
        {
          title: {
            en: 'Identify a dedicated worker connection',
            zh: '标记专用 Worker 连接'
          },
          problem: {
            en: 'A page already has a worker and knows its remote identity. Attach the application’s peer and origin metadata to the transport so inbound diagnostics retain that carrier context.',
            zh: '页面已持有 Worker，并知道远端身份。为传输对象设置应用的对端和来源元数据，让入站诊断保留这份载体上下文。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The worker transport exposes the supplied peer and origin metadata.',
            zh: 'Worker 传输对象会提供所设对端与来源元数据。'
          },
          covers: ['peerId', 'origin']
        },
        {
          title: {
            en: 'Agree on stream support before calling',
            zh: '调用前约定流支持'
          },
          problem: {
            en: 'A dedicated worker link uses a static capability agreement. Supply only the capabilities agreed by both ends; advertising a stream mode on one side alone cannot add support to the other.',
            zh: '专用 Worker 链路采用静态能力约定。只声明双方已经约定的能力；单方面声明流模式无法为另一端增加支持。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The transport presents the capability list selected by the application’s agreement.',
            zh: '传输对象使用应用约定的能力列表。'
          },
          covers: ['capabilities']
        }
      ]
    },
    defineMessageAdapter: {
      role: 'enhancer',
      purpose: {
        en: 'Defines one genuine raw-message adapter recipe; its peer/plugin operations reuse original Core assembly rather than accepting a prebuilt trusted channel.',
        zh: '定义消息适配器，把原始端口接入 Core；对端和插件复用已有构造流程，不接受调用方预先声明为可信的通道。'
      },
      options: 'IMessageAdapterOptions',
      returns: {
        en: 'Frozen genuine IAdapterDefinition retaining the exact original physical operations.',
        zh: '返回冻结的 `IAdapterDefinition`，保持与这组底层连接操作的绑定。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      optionCases: [
        {
          title: {
            en: 'Use an existing native message port',
            zh: '使用已有原生消息端口'
          },
          problem: {
            en: 'An application already owns a MessagePort. The adapter’s open callback returns that original port; Core owns negotiation and request handling instead of requiring another messaging implementation.',
            zh: '应用已经拥有 MessagePort。适配器的 open 回调返回原端口；协商和请求处理交给 Core，不再另写一套消息实现。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The checkout calls the remote pricing provider through its original native port.',
            zh: '结算页通过原生端口调用远端价格处理函数。'
          },
          covers: ['open']
        },
        {
          title: {
            en: 'Launch a worker with its actual exit handle',
            zh: '启动 Worker 并保留真实退出句柄'
          },
          problem: {
            en: 'A platform adapter also owns worker startup. Supply launchWorker, which returns the native port, the real exit Promise and termination operation; openExistingWorkerPort handles already-running workers.',
            zh: '平台适配器还负责启动 Worker。launchWorker 返回原生端口、真实退出 Promise 和终止操作；openExistingWorkerPort 处理已经运行的 Worker。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The adapter can stop the worker it launched and observe its actual exit.',
            zh: '适配器能停止自己启动的 Worker，并观察其真实退出。'
          },
          covers: ['launch']
        }
      ]
    },
    defineByteAdapter: {
      role: 'enhancer',
      purpose: {
        en: 'Defines one genuine ordered-byte adapter recipe; the existing Core owner performs handshake, authentication, framing and endpoint assembly.',
        zh: '定义有序字节适配器，由 Core 继续负责握手、认证、分帧和端点组装。'
      },
      options: 'IByteAdapterOptions',
      returns: {
        en: 'Frozen genuine IAdapterDefinition retaining the exact original physical operations.',
        zh: '返回冻结的 `IAdapterDefinition`，保持与这组底层连接操作的绑定。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      optionCases: [
        {
          title: {
            en: 'Open an application-owned ordered byte stream',
            zh: '打开应用持有的有序字节流'
          },
          problem: {
            en: 'A platform already supplies ordered byte I/O with write, onData, onClose and close. Keep those carrier operations in openByteConnection and let Core provide negotiation and framing. Application diagnostics and presentation describe this carrier.',
            zh: '平台已有带 write、onData、onClose 和 close 的有序字节读写。把载体操作留在 openByteConnection，协商和分帧交给 Core；应用诊断与展示配置描述这类载体。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The pricing connection uses Core’s byte handshake and framing over the platform’s I/O.',
            zh: '价格连接在平台字节读写上使用 Core 的字节握手与分帧。'
          },
          covers: [
            'open',
            'diagnostics',
            'presentation',
            'presentation.platform',
            'presentation.expectedStringText'
          ]
        },
        {
          title: {
            en: 'Separate accepted connections from outgoing dials',
            zh: '区分接入连接与主动拨号'
          },
          problem: {
            en: 'A byte adapter handles accepted server connections as well as outgoing clients. Supply the corresponding application open operations so each mode acquires the right native I/O.',
            zh: '字节适配器既处理服务端接入，也处理客户端主动连接。分别提供应用的打开操作，让两种模式取得正确的原生读写对象。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'Listening and dialing reuse the same Core protocol while retaining platform-specific acquisition.',
            zh: '监听与拨号复用同一 Core 协议，同时保留平台各自的资源取得方式。'
          },
          covers: ['listen', 'dial']
        }
      ]
    },
    createRemoteRetryPort: {
      role: 'factory',
      purpose: {
        en: 'Creates canonical request retry dispatch: at most one replay for an idempotent request after actual generation departure.',
        zh: '创建规范请求重试派发，在实际代次离开后最多为幂等请求重放一次。'
      },
      params: {
        options: {
          en: 'Original generation events, monotonic scheduler and diagnostic reporter.',
          zh: '原始代次事件、单调调度器与诊断报告函数。'
        }
      },
      returns: {
        en: 'IRemoteRetryPort preserving the original logical key, cancellation and deadline.',
        zh: '返回保留原逻辑键、取消及截止时间的重试端口。'
      },
      example:
        'const port = createRemoteRetryPort({ events, scheduler, report })\nconst value = await port.dispatch(input)',
      optionDocs: {
        events: {
          summary: {
            en: 'Original generation events returned by the proxy generation owner.',
            zh: '原代理代次拥有者提供的代次事件。'
          }
        },
        scheduler: {
          summary: {
            en: 'Same monotonic scheduler as the binding.',
            zh: '与绑定相同的单调调度器。'
          }
        },
        report: {
          summary: {
            en: 'Reports background or secondary cleanup failures synchronously; a thrown reporter failure follows the owner fallback.',
            zh: '同步报告后台或次要清理失败；报告函数抛错时由拥有者的后备路径处理。'
          },
          params: {
            error: {
              en: 'Original background failure.',
              zh: '原始后台失败值。'
            }
          },
          returns: {
            en: 'No result is consumed.',
            zh: '不消费返回值，诊断已交给应用。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          whenToUse: {
            en: 'Report secondary retry or cleanup failures through the original application diagnostic owner.',
            zh: '通过原应用诊断所有者报告重试或清理的次要失败。'
          }
        }
      },
      optionCases: [
        {
          title: {
            en: 'Reuse runtime events for retry decisions',
            zh: '用已有运行时事件决定重试'
          },
          problem: {
            en: 'A remote call policy must follow the same generation changes as its peer. Build the retry port from that peer’s events and scheduler instead of creating a second lifecycle tracker.',
            zh: '远端调用策略需要跟随对端原有的代次变化。用该对端的事件与调度器创建重试端口，避免另建一套生命周期追踪。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'Retry decisions follow the selected runtime’s existing generation events and clock.',
            zh: '重试决定跟随所选运行时已有的代次事件与时钟。'
          },
          covers: ['events', 'scheduler', 'report']
        },
        {
          title: {
            en: 'Keep retry cleanup failures observable',
            zh: '保留重试清理故障'
          },
          problem: {
            en: 'Secondary cleanup failures during retry should reach monitoring without obscuring the call’s primary result. Supply the retry owner’s diagnostic callback.',
            zh: '重试过程中的次要清理故障应进入监控，同时不能掩盖调用的主要结果。提供重试所有者的诊断回调。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'Monitoring receives retry-side failures through the application’s reporting channel.',
            zh: '监控通过应用上报通道收到重试侧故障。'
          },
          covers: ['report']
        }
      ]
    },
    normalizeRemoteContract: {
      role: 'operation',
      purpose: {
        en: 'Snapshots, validates and freezes an untrusted V1 plugin contract with bounded tables and sorted keys.',
        zh: '对不可信第一版插件契约取快照、校验并冻结，限制表大小并排序键。'
      },
      params: {
        input: {
          en: 'Application-authored or received portable contract description.',
          zh: '应用编写或接收到的可移植契约描述。'
        }
      },
      returns: {
        en: 'Normalized IRemoteContract; invalid shape throws REMOTE_CONTRACT_INVALID and retains the cause.',
        zh: '返回规范契约，形状不合法时抛出保留原因的 `REMOTE_CONTRACT_INVALID`。'
      },
      example:
        "const contract = normalizeRemoteContract({\n  schemaVersion: 1,\n  plugin: 'math',\n  features: { calc: { methods: { double: { mode: 'request', idempotent: true } } } }\n})"
    },
    normalizeRemoteHostCatalog: {
      role: 'operation',
      purpose: {
        en: 'Validates and freezes a nonempty name-to-contract catalog; each name must equal its contract plugin.',
        zh: '校验并冻结非空名称到契约目录，每个名称须等于对应契约插件名。'
      },
      params: {
        input: {
          en: 'Application catalog record or received portable catalog.',
          zh: '应用目录记录或接收到的可移植目录。'
        }
      },
      returns: {
        en: 'Sorted frozen IRemoteHostCatalog; invalid or oversized descriptions throw REMOTE_CONTRACT_INVALID.',
        zh: '返回排序冻结目录，不合法或超限的描述抛出 `REMOTE_CONTRACT_INVALID`。'
      },
      example:
        "const contract = normalizeRemoteContract({\n  schemaVersion: 1,\n  plugin: 'math',\n  features: { calc: { methods: { double: { mode: 'request', idempotent: true } } } }\n})\nconst catalog = normalizeRemoteHostCatalog({ math: contract })"
    },
    normalizeRemoteControlShape: {
      role: 'operation',
      purpose: {
        en: 'Validates one reserved Host control payload or result under the selected exact grammar.',
        zh: '按所选控制定义校验单个保留宿主控制负载或结果，返回规范可移植数据，失败沿宿主原错误映射抛出。'
      },
      params: {
        definition: {
          en: 'IRemoteControlDefinition selecting the actual reserved operation input or result shape.',
          zh: '选择实际保留操作输入或结果形状的控制定义。'
        },
        input: {
          en: 'Received portable control data.',
          zh: '接收到的可移植控制数据。'
        }
      },
      returns: {
        en: 'Normalized portable value; invalid required fields or unknown semantics throw REMOTE_CONTRACT_INVALID.',
        zh: '返回规范可移植值，必填字段或未知语义不合法时抛出契约错误。'
      },
      example: "const payload = normalizeRemoteControlShape('hostUseParams', ['math'])"
    },
    sameRemoteContract: {
      role: 'operation',
      purpose: {
        en: 'Compares JSON serializations of two already normalized contracts; normalize both before comparing.',
        zh: '比较两个已规范契约的序列化结果，比较前应先配合 `normalizeRemoteContract()` 规范双方。'
      },
      params: {
        a: {
          en: 'First normalized contract returned by normalizeRemoteContract.',
          zh: '第一个由 `normalizeRemoteContract()` 返回的规范契约。'
        },
        b: {
          en: 'Second normalized contract returned by normalizeRemoteContract.',
          zh: '第二个由 `normalizeRemoteContract()` 返回的规范契约。'
        }
      },
      returns: {
        en: 'True when normalized JSON representations match; raw insertion order is not normalized here.',
        zh: '规范序列化表示相同时为真，此函数不自行规范原始键顺序。'
      },
      example:
        'const a = normalizeRemoteContract(first)\nconst b = normalizeRemoteContract(second)\nconsole.log(sameRemoteContract(a, b))'
    },
    DEFAULT_DRAIN_MS: {
      role: 'constant',
      purpose: {
        en: 'Default native drain budget of 5000 milliseconds.',
        zh: '默认原生排空预算为五千毫秒，供进程与线程关闭路径共同使用。'
      },
      example: 'console.log(DEFAULT_DRAIN_MS)'
    },
    REMOTE_METHOD_MAX_LENGTH: {
      role: 'constant',
      purpose: {
        en: 'Maximum three-segment V1 method path length, 122 characters.',
        zh: '第一版三段方法路径最大长度为一百二十二个字符。'
      },
      example: 'if (path.length > REMOTE_METHOD_MAX_LENGTH) throw invalidPath'
    },
    REMOTE_NAME_PATTERN: {
      role: 'constant',
      purpose: {
        en: 'ASCII segment grammar: letter first, up to 40 total letters, digits, underscores or hyphens.',
        zh: '段名称采用字母开头、总长最多四十个字母数字下划线或连字符的语法。'
      },
      example: "console.log(new RegExp(REMOTE_NAME_PATTERN, 'u').test('math'))"
    },
    REMOTE_SCHEMA_VERSION: {
      role: 'constant',
      purpose: {
        en: 'V1 explicit plugin contract version, exactly 1.',
        zh: '显式插件契约版本，固定为第一版，用于接纳声明而非自动运行时目录。'
      },
      example: 'console.log(contract.schemaVersion === REMOTE_SCHEMA_VERSION)'
    },
    REMOTE_METHOD_MODES: {
      role: 'constant',
      purpose: {
        en: 'Frozen list of the four accepted V1 RemoteMethodMode values.',
        zh: '已冻结的第一版四种方法模式列表，用于拒绝契约中无法识别的模式。'
      },
      example: "console.log(REMOTE_METHOD_MODES.includes('request'))"
    },
    RPC_REMOTE_ERROR_SOURCE: {
      role: 'constant',
      purpose: {
        en: 'Identifies the package that created a remote-execution error. When handling a caught error, first compare its source with RPC_REMOTE_ERROR_SOURCE, then inspect code to choose how to respond. The same code text in another package need not mean the same failure.',
        zh: '标识远程执行错误的来源包。处理捕获的错误时，先比较 source 是否等于 RPC_REMOTE_ERROR_SOURCE，再读取 code 选择处理方式。其他包中的同名错误码不一定表示同一种失败。'
      },
      example: 'if (error.source === RPC_REMOTE_ERROR_SOURCE) console.error(error.code)'
    },
    RUNTIME_API_SCHEMA_VERSION: {
      role: 'constant',
      purpose: {
        en: 'Version 2 for automatic runtime method directories, independent of V1 explicit contracts.',
        zh: '自动运行时方法目录使用第二版，与第一版显式契约独立。'
      },
      example: 'console.log(RUNTIME_API_SCHEMA_VERSION)'
    },
    RemoteMethodMode: {
      role: 'constant',
      purpose: {
        en: 'Declared V1 method invocation modes.',
        zh: '第一版契约声明的方法调用模式，决定结果、单向交付或迭代器消费方式。'
      },
      example: 'console.log(RemoteMethodMode)'
    },
    RuntimeApiMode: {
      role: 'constant',
      purpose: {
        en: 'Actual installed V2 runtime call routes.',
        zh: '第二版运行时实际安装的调用路由模式，由真实安装能力确定可用操作。'
      },
      example: 'console.log(RuntimeApiMode)'
    },
    RuntimeSourceKind: {
      role: 'constant',
      purpose: {
        en: 'Local connection source selection.',
        zh: '本端连接来源的选择方式，分别对应启动、主动连接或接受连接。'
      },
      example: 'console.log(RuntimeSourceKind)'
    },
    RuntimeConnectionDirection: {
      role: 'constant',
      purpose: {
        en: 'Who established the physical connection.',
        zh: '记录物理连接由哪一方建立，区分父端启动、子端回连与连接接纳。'
      },
      example: 'console.log(RuntimeConnectionDirection)'
    },
    RuntimePluginKey: {
      role: 'constant',
      purpose: {
        en: 'Canonical runtime outlet names; labels grant no execution ownership.',
        zh: '规范运行时出口名称，标签本身不授予执行所有权。'
      },
      example: 'console.log(RuntimePluginKey)'
    },
    RuntimeQueryStatus: {
      role: 'constant',
      purpose: {
        en: 'Observed connection or metric availability.',
        zh: '观察到的连接状态或指标可用性，无法观察时明确返回不可用事实。'
      },
      example: 'console.log(RuntimeQueryStatus)'
    },
    RemoteMethodName: {
      role: 'constant',
      purpose: {
        en: 'Reserved remote control routes, excluded from application methods.',
        zh: '保留的远程控制路由，应用方法不得占用，目录与宿主控制使用这些固定名称。'
      },
      example: 'console.log(RemoteMethodName)'
    },
    RpcRemoteLayerErrorCode: {
      role: 'constant',
      purpose: {
        en: 'Stable remote-layer errors and caller recovery actions.',
        zh: '稳定的远程层错误及调用方恢复方式，区分契约错误、未接纳与结果未知。'
      },
      example: 'console.log(RpcRemoteLayerErrorCode)'
    },
    identifyRpcBoundaryFailure: {
      role: 'operation',
      purpose: {
        en: 'Classifies an adapter failure while preserving a mutable native Error or DOMException and a complete foreign semantic identity. Unattachable or primitive failures remain reachable through cause; the original stack is never replaced.',
        zh: '分类适配器失败，保留可修改原生错误及完整外部语义身份；不可附加身份的错误或原始值经原因链可达，原堆栈不替换。'
      },
      params: {
        error: {
          en: 'Original failure caught at this adapter boundary.',
          zh: '此适配器边界捕获的原始失败。'
        },
        code: {
          en: 'Core-owned semantic value selected from RpcCoreErrorCode for this boundary.',
          zh: '从核心错误码表选择的本边界语义值。'
        },
        message: {
          en: 'Stable adapter-owned fallback text used only when a wrapper is required.',
          zh: '仅需包装时使用的适配器所有者维护的稳定回退文本。'
        }
      },
      returns: {
        en: 'The original Error when it can retain or acquire semantic identity; otherwise a Core Error whose cause retains the original failure.',
        zh: '可保持或附加语义身份时返回原错误，否则返回以原始失败为原因的核心错误。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    createListenerFailureState: {
      role: 'factory',
      purpose: {
        en: 'Creates one adapter-local ordered state for reporter failures; retain it with the physical listener owner.',
        zh: '为报告失败创建适配器本地有序状态，应与物理监听拥有者一同保留。'
      },
      params: {},
      returns: {
        en: 'Mutable `{ failures: [], pending: new Set(), nextOrder: 0 }`. failures retain original errors and invocation order; pending tracks reporter settlement promises. Pass this exact state to observation and drain operations.\n\n`failures`: Mutable entries `{ order, error }` awaiting drain; errors keep original identity.\n\n`pending`: Set of tracked reporter settlement promises; terminal drain waits for this set to empty.\n\n`nextOrder`: Next adapter-local reporter invocation sequence number, starting at zero.',
        zh: '返回可变状态：失败列表与待结算集合初始为空，下一序号为零；失败列表保留原错误及调用顺序，待结算集合跟踪报告函数的 Promise。将同一状态传给观察及排空操作。\n\n`failures`: 等待排空的可变顺序与错误条目，错误保留原始身份。\n\n`pending`: 已跟踪报告函数结算 Promise 的集合，终态排空等待此集合清空。\n\n`nextOrder`: 下一个适配器本地报告调用序号，从零开始。'
      },
      example:
        'const failures = createListenerFailureState()\nobserveListener(() => listener(message), error => report(error), failures)\nawait drainTerminalListenerFailures([], { secondaryFailures: failures })'
    },
    createMessageListenerHub: {
      role: 'factory',
      purpose: {
        en: 'Creates a local listener fan-out hub sharing one physical attachment across distinct callback identities.',
        zh: '创建并返回本地监听扇出中心，让不同回调身份共享一次物理挂接，最后一个成员移除时解除监听。'
      },
      params: {},
      returns: {
        en: 'Local hub with size, has(listener), add(listener, attach), remove(listener, detach), dispatch(message, invoke) and clear(detach). add/remove/clear return void except remove returning whether a member was removed; has returns boolean. Dispatch snapshots membership and propagates invoke failures. Attach/detach callbacks are synchronous; failure leaves the logical change uncommitted.\n\n`size`: Current number of distinct registered callback identities.\n\n`has`: Checks whether this exact callback is registered. `listener`: Original application callback passed to add. True only for a currently registered callback identity.\n\n`add`: Attaches the physical listener before adding the first callback; duplicate callbacks remain one Set member. `listener`: Application callback to retain by identity. `attach`: Synchronous physical registration callback; a throw leaves this callback unregistered. No result; first successful attachment and membership are retained.\n\n`remove`: Detaches before removing the last callback; a detach throw keeps membership so release can be retried. `listener`: Exact original callback supplied to add. `detach`: Synchronous physical removal callback invoked only for the last member. True if removed, false if absent; detach failure propagates.\n\n`dispatch`: Snapshots callbacks before invocation; reentrant membership changes affect subsequent dispatches, and an invoke throw stops this dispatch. `message`: Actual message received from the physical carrier. `invoke`: Synchronous dispatcher receiving each snapshot listener and the message; use observeListener to isolate failures. No result; invokes each snapshot member unless the dispatcher throws.\n\n`clear`: Detaches the physical listener before clearing all callbacks; failure keeps membership intact. `detach`: Synchronous physical removal callback. No result; membership is empty after successful return.',
        zh: '返回本地中心：`size` 为成员数，`has(listener)` 返回是否存在，`add(listener, attach)` 添加成员，`remove(listener, detach)` 返回是否移除，`dispatch(message, invoke)` 快照派发，`clear(detach)` 清空。其余操作不返回值，派发回调失败向外传播；挂接及解除回调必须同步，失败时不提交逻辑变更。\n\n`size`: 当前登记的不同回调身份数量。\n\n`has`: 检查当前是否登记了此精确回调。 `listener`: 先前传给添加操作的原始应用回调。 仅当前已登记的回调身份返回真。\n\n`add`: 加入首个回调前挂接物理监听器，重复回调仅占一个集合成员。 `listener`: 按身份保留的应用回调。 `attach`: 同步物理登记回调，抛错时不加入当前回调。 无返回值，保留首次成功挂接及成员关系。\n\n`remove`: 移除最后回调前先解除物理挂接，解除抛错时保留成员以便重试释放。 `listener`: 添加时提供的精确原始回调。 `detach`: 仅最后成员移除时调用的同步物理解除回调。 已移除返回真，原本不存在返回假，解除失败向外传播。\n\n`dispatch`: 调用前对回调取快照，重入成员变更影响后续派发，调用回调抛错会停止当前派发。 `message`: 底层传输通道实际接收到的消息。 `invoke`: 同步派发器接收每个快照监听器与消息，可使用 `observeListener()` 隔离失败。 无返回值，依次调用快照成员，派发器抛错时停止。\n\n`clear`: 清空全部回调前先解除物理监听，失败时保留成员关系。 `detach`: 同步物理解除回调。 无返回值，成功返回后成员已清空。'
      },
      example:
        "const hub = createMessageListenerHub<string>()\nconst failures = createListenerFailureState()\nconst receive = (value: string) => console.log(value)\nhub.add(receive, () => port.addEventListener('message', onMessage))\nfunction onMessage(event: { data: string }) {\n  hub.dispatch(event.data, (listener, value) => observeListener(() => listener(value), report, failures))\n}\nhub.remove(receive, () => port.removeEventListener('message', onMessage))\nconsole.log(hub.has(receive), hub.size)\nhub.clear(() => port.removeEventListener('message', onMessage))\nawait drainTerminalListenerFailures([], { secondaryFailures: failures })"
    },
    collectListenerCleanupFailures: {
      role: 'operation',
      purpose: {
        en: 'Runs all synchronous listener removals in reverse order and collects exact failures without stopping at the first.',
        zh: '逆序执行全部同步监听移除操作，收集原始失败，不在首个失败处停止。'
      },
      params: {
        removals: {
          en: 'Application callbacks removing already registered physical listeners; invoked in reverse array order without awaiting return values.',
          zh: '应用提供的已登记物理监听器移除回调，按数组逆序调用，不等待其返回值。'
        }
      },
      returns: {
        en: 'New array of failures in reverse-removal encounter order; callbacks and input array are not altered.',
        zh: '返回按逆序移除遇到的失败组成的新数组，不改变回调及输入数组。'
      },
      example: 'const cleanupErrors = collectListenerCleanupFailures([removeMessage, removeError])'
    },
    collectListenerFailure: {
      role: 'operation',
      purpose: {
        en: 'Appends an already observed secondary failure using the next invocation order in the original state.',
        zh: '使用原状态的下一调用序号追加已观察到的次要失败，保留失败原对象及其原因链，不重新构造诊断。'
      },
      params: {
        state: {
          en: 'State returned by `createListenerFailureState()` for this adapter boundary.',
          zh: '由 `createListenerFailureState()` 为当前适配器边界返回的状态。'
        },
        error: {
          en: 'Exact secondary failure caught by the caller.',
          zh: '调用方捕获的精确次要失败。'
        }
      },
      returns: {
        en: 'No result; one failure is appended and nextOrder advances.',
        zh: '无返回值，已追加一项失败并推进下一序号。'
      },
      example: 'const state = createListenerFailureState()\ncollectListenerFailure(state, failure)'
    },
    createListenerFailure: {
      role: 'operation',
      purpose: {
        en: 'Builds a package-tagged native cleanup failure without consuming reporter states; a single Error normally keeps its exact identity.',
        zh: '构造带包标识的原生清理失败，不消费报告状态，单个错误通常保持精确身份。'
      },
      params: {
        errors: {
          en: 'Original failure values in desired primary-first order; empty means no primary failure.',
          zh: '按主错误优先排列的原始失败值，空数组表示没有主失败。'
        },
        boundary: {
          en: 'Optional policy: `code` defaults to `INTERNAL`; `message` is aggregate text; `secondaryFailures` selects factory-issued reporter states; `aggregateSingle` defaults to false except where the operation says otherwise.',
          zh: '可选策略：错误码默认 `INTERNAL`，消息用于汇总错误，次要失败字段选择工厂签发的报告状态，单项汇总默认关闭，具体操作另有说明时以其为准。'
        }
      },
      returns: {
        en: 'Undefined for no errors. A single Error is tagged in place unless already canonically tagged, except aggregateSingle forces AggregateError. Multiple or non-Error values use AggregateError with the original values in errors.',
        zh: '没有错误时返回空值；单个错误原位加标识，已有规范标识则保留，强制单项汇总时使用汇总错误。多个或非错误值使用 `AggregateError`，原始值保留在错误列表。'
      },
      example:
        'const failure = createListenerFailure([primary, cleanup], { aggregateSingle: true })\nif (failure) throw failure'
    },
    drainListenerFailures: {
      role: 'operation',
      purpose: {
        en: 'Consumes settled reporter failures once, after supplied primary failures, and throws their canonical native result.',
        zh: '在所提供主失败之后一次消费已结算报告失败，并抛出规范原生结果。'
      },
      params: {
        errors: {
          en: 'Original failure values in desired primary-first order; empty means no primary failure.',
          zh: '按主错误优先排列的原始失败值，空数组表示没有主失败。'
        },
        boundary: {
          en: 'Optional policy: `code` defaults to `INTERNAL`; `message` is aggregate text; `secondaryFailures` selects factory-issued reporter states; `aggregateSingle` defaults to false except where the operation says otherwise.',
          zh: '可选策略：错误码默认 `INTERNAL`，消息用于汇总错误，次要失败字段选择工厂签发的报告状态，单项汇总默认关闭，具体操作另有说明时以其为准。'
        }
      },
      returns: {
        en: 'Returns void if no failure remains; otherwise throws. Settled state entries are removed in state order and reporter invocation order. Pending reporter promises are not awaited.',
        zh: '没有剩余失败时不返回值，否则抛出。已结算状态条目按状态顺序及报告调用顺序取出并删除，不等待尚未完成的报告 Promise。'
      },
      example:
        'const failures = createListenerFailureState()\ncollectListenerFailure(failures, secondary)\ndrainListenerFailures([primary], { secondaryFailures: failures })'
    },
    drainTerminalListenerFailures: {
      role: 'operation',
      purpose: {
        en: 'Waits for all currently tracked reporter promises to settle before consuming failures at a terminal boundary.',
        zh: '在终态边界消费失败前等待当前跟踪的报告 Promise 全部结算。'
      },
      params: {
        errors: {
          en: 'Original failure values in desired primary-first order; empty means no primary failure.',
          zh: '按主错误优先排列的原始失败值，空数组表示没有主失败。'
        },
        boundary: {
          en: 'Optional policy: `code` defaults to `INTERNAL`; `message` is aggregate text; `secondaryFailures` selects factory-issued reporter states; `aggregateSingle` defaults to false except where the operation says otherwise.',
          zh: '可选策略：错误码默认 `INTERNAL`，消息用于汇总错误，次要失败字段选择工厂签发的报告状态，单项汇总默认关闭，具体操作另有说明时以其为准。'
        }
      },
      returns: {
        en: 'Void when supplied states have no pending reporters; otherwise a Promise. Throws or rejects with primary-first collected failures. It does not await unrelated pending listener work.',
        zh: '所提供状态没有待结算报告时同步返回空值，否则返回 Promise。以主失败优先的收集结果抛出或拒绝，不等待无关的待结算监听工作。'
      },
      example:
        'const failures = createListenerFailureState()\nobserveListener(() => listener(message), error => report(error), failures)\nawait drainTerminalListenerFailures([], { secondaryFailures: failures })'
    },
    observeListener: {
      role: 'operation',
      purpose: {
        en: 'Invokes a listener now, observes sync throws and thenable rejections, and reports them without throwing into the carrier dispatch.',
        zh: '立即调用监听器，观察同步抛错及类 Promise 对象拒绝，通过报告路径处理，不抛进传输对象派发。'
      },
      params: {
        invoke: {
          en: 'Zero-argument callback running the actual listener; its successful value is ignored.',
          zh: '执行实际监听器的无参回调，不消费成功返回值。'
        },
        report: {
          en: 'Application callback receiving the original listener error; a returned thenable is observed and its failure is retained in the supplied state.',
          zh: '应用回调接收原始监听错误，返回类 Promise 对象时会观察其结算，并将失败保留在所提供状态中。'
        },
        reporterFailures: {
          en: 'Optional state returned by createListenerFailureState; omitted creates an internal state that the caller cannot later drain.',
          zh: '可选工厂返回状态，省略时创建内部状态，调用方无法之后排空。'
        }
      },
      returns: {
        en: 'No result and no wait for listener settlement; reporter failures collect in the selected state.',
        zh: '无返回值，不等待监听结算，报告函数失败收集在所选状态中。'
      },
      example:
        'const failures = createListenerFailureState()\nobserveListener(() => listener(message), error => report(error), failures)\nawait drainTerminalListenerFailures([], { secondaryFailures: failures })'
    },
    reportListenerFailure: {
      role: 'operation',
      purpose: {
        en: 'Snapshots all reporters, invokes each with the original failure, and retains reporter failures without aborting later reporters.',
        zh: '对报告函数取快照，逐个传入原始失败，保留报告失败且不阻止后续报告。'
      },
      params: {
        error: {
          en: 'Original adapter failure to fan out.',
          zh: '需要扇出报告的原始适配器失败。'
        },
        reporters: {
          en: 'Application iterable of reporter functions; snapshot before invoking.',
          zh: '应用报告函数可迭代集合，调用前先取快照。'
        },
        reporterFailures: {
          en: 'State returned by `createListenerFailureState()` for this adapter boundary.',
          zh: '由 `createListenerFailureState()` 为当前适配器边界返回的状态。'
        }
      },
      returns: {
        en: 'No result; sync and async reporter failures are collected by invocation order.',
        zh: '无返回值，同步及异步报告失败按调用顺序收集。'
      },
      example:
        'const state = createListenerFailureState()\nreportListenerFailure(error, [report], state)\nawait drainTerminalListenerFailures([], { secondaryFailures: state })'
    },
    registerListeners: {
      role: 'operation',
      purpose: {
        en: 'Adds physical listeners in order and rolls back earlier successful registrations in reverse order if an add throws.',
        zh: '按输入顺序登记物理监听器，成功时无返回值，添加失败则逆序回滚先前成功登记并保留原主错误。'
      },
      params: {
        registrations: {
          en: 'Application records with synchronous add() and remove(); the failed add is not added to the rollback list.',
          zh: '应用提供的同步添加及移除记录，失败的添加本身不会加入回滚列表。'
        },
        boundary: {
          en: 'Optional policy: `code` defaults to `INTERNAL`; `message` is aggregate text; `secondaryFailures` selects factory-issued reporter states; `aggregateSingle` defaults to false except where the operation says otherwise.',
          zh: '可选策略：错误码默认 `INTERNAL`，消息用于汇总错误，次要失败字段选择工厂签发的报告状态，单项汇总默认关闭，具体操作另有说明时以其为准。'
        }
      },
      returns: {
        en: 'No result on success; on failure throws the original registration failure first, followed by rollback and settled reporter failures.',
        zh: '成功时无返回值，失败时先保留原登记失败，再附回滚及已结算报告失败。'
      },
      example:
        'registerListeners([\n  { add: addMessage, remove: removeMessage },\n  { add: addError, remove: removeError }\n])'
    },
    releaseListenerRegistration: {
      role: 'operation',
      purpose: {
        en: 'Removes every physical listener before committing logical removal; a cleanup failure preserves the logical registration for retry.',
        zh: '先移除全部物理监听器再提交逻辑移除，清理失败时保留逻辑登记以便重试。'
      },
      params: {
        removals: {
          en: 'Application callbacks removing already registered physical listeners; invoked in reverse array order without awaiting return values.',
          zh: '应用提供的已登记物理监听器移除回调，按数组逆序调用，不等待其返回值。'
        },
        commitRelease: {
          en: 'Synchronous application callback publishing logical removal, invoked only if all removals succeed.',
          zh: '同步应用回调，仅全部物理移除成功后发布逻辑移除。'
        },
        boundary: {
          en: 'Optional policy: `code` defaults to `INTERNAL`; `message` is aggregate text; `secondaryFailures` selects factory-issued reporter states; `aggregateSingle` defaults to false except where the operation says otherwise.',
          zh: '可选策略：错误码默认 `INTERNAL`，消息用于汇总错误，次要失败字段选择工厂签发的报告状态，单项汇总默认关闭，具体操作另有说明时以其为准。'
        }
      },
      returns: {
        en: 'No result on success; cleanup failures throw with aggregateSingle default false. A commitRelease throw propagates directly.',
        zh: '成功时无返回值，清理失败抛出，单项汇总默认关闭；逻辑提交回调抛错会直接传播。'
      },
      example:
        'releaseListenerRegistration([removeMessage, removeError], () => active.delete(listener))'
    },
    safeRead: {
      role: 'operation',
      purpose: {
        en: 'Reads one property of an object or function once; failed getters or proxy traps are reported synchronously or rethrown with the original cause.',
        zh: '对对象或函数的单个属性只读取一次，失败的访问器或代理陷阱被同步报告，或保留原始原因重新抛出。'
      },
      params: {
        value: {
          en: 'Untrusted received object or function; primitive and null inputs return undefined.',
          zh: '收到的不可信对象或函数，原始值及空输入返回空值。'
        },
        key: {
          en: 'Application-selected property key to inspect.',
          zh: '应用选择的待检查属性键。'
        },
        report: {
          en: 'Optional synchronous callback receiving `{ key, error }`, expected to return undefined; a successful callback converts the failed read to undefined.',
          zh: '可选同步回调接收属性键及原始错误，契约要求返回空值，回调成功时将读取失败转为空值。'
        }
      },
      returns: {
        en: 'Property value or undefined. Without report, throws TypeError with PROPERTY_READ_FAILED; if report also throws, its cause contains the read failure first and reporter failure second.',
        zh: '返回属性值或空值。不提供报告函数时抛出 `PROPERTY_READ_FAILED` 类型错误；报告函数也抛错时，原因链先保留读取失败，再保留报告失败。'
      },
      example:
        "const data = safeRead<unknown>(event, 'data', failure => { console.error(failure.error); return undefined })"
    },
    safeString: {
      role: 'operation',
      purpose: {
        en: 'Converts an untrusted value to text once; failed conversion is reported synchronously or rethrown as a coded TypeError retaining the original cause.',
        zh: '将不可信值一次转换为文本，转换失败时同步报告，或保留原始原因抛出带码类型错误。'
      },
      params: {
        value: {
          en: 'Any received value to stringify.',
          zh: '需要转为文本的任意接收值。'
        },
        fallback: {
          en: 'Application fallback used only after conversion fails and reporting succeeds; omitted uses the canonical unknown-error text.',
          zh: '仅转换失败且报告成功后使用的应用后备文本，省略时使用规范未知错误文本。'
        },
        report: {
          en: 'Optional synchronous callback receiving `{ error }` and returning undefined.',
          zh: '可选同步回调接收原始错误并返回空值。'
        }
      },
      returns: {
        en: 'Converted string or reported-failure fallback; without a reporter, throws STRING_CONVERSION_FAILED with the original cause. Reporter failure retains both original failures in primary-first order.',
        zh: '返回转换文本或报告成功后的后备文本；没有报告函数时抛出保留原始原因的 `STRING_CONVERSION_FAILED`。报告函数失败时按主错误优先保留两个原始失败。'
      },
      example:
        "const reason = safeString(value, '未知错误', failure => { console.error(failure.error); return undefined })"
    },
    createRpcHost: {
      role: 'factory',
      purpose: {
        en: 'Prepare one genuine transport, install features in order, and create exactly one endpoint. Listening transports accept further independent sessions on that endpoint. Failure rolls back acquired resources in reverse order while preserving the primary error.',
        zh: '准备一个真实传输、按顺序安装功能并创建唯一端点。监听传输在同一端点接纳后续独立会话，失败时逆序释放已获取资源并保留主错误。'
      },
      options: 'IRpcHostOptions',
      returns: {
        en: 'Promise of IRpcHost<TRemote>. Invalid or duplicate definitions reject before native opening. close and asyncDispose join the same original Promise; borrowed native resources remain application-owned.',
        zh: '返回带类型宿主的承诺。非法或重复定义在原生打开前拒绝；关闭与异步释放共用原承诺，借入原生资源仍归应用。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      scenarios: [
        {
          en: 'Use one call API with process, native thread, browser, or cooperative transports.',
          zh: '对进程、原生线程、浏览器或协作传输使用同一调用接口。'
        }
      ]
    },
    timeoutFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Provide a call default below explicit host and call timeouts.',
        zh: '返回可安装的默认期限配置，仅在单次调用和宿主都未显式设置超时时生效，不改变独立握手预算。'
      },
      returns: {
        en: 'Actual feature object; retain it and install at most once per host.',
        zh: '返回真实功能对象，保留原对象并在每个宿主至多安装一次。'
      },
      example:
        "import timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const deadline = timeoutFeature({ ms: 1500 })",
      options: 'ITimeoutFeatureOptions'
    },
    typegenFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Generate declarations from accepted directories regardless of peer language; uninstall stops further output.',
        zh: '返回可安装的声明生成功能，从已接纳目录读取方法及数据形状，更新换代后的声明并在卸载后停止输出。'
      },
      returns: {
        en: 'Actual feature object; retain it and install at most once per host.',
        zh: '返回真实功能对象，保留原对象并在每个宿主至多安装一次。'
      },
      example:
        "import { typegenFeature } from '@migaia/rpc-host/features'\n\nexport const declarations = typegenFeature({\n  out: {\n    write: (fileName, text) => {\n      console.log(fileName, text)\n    }\n  }\n})",
      options: 'ITypegenFeatureOptions'
    },
    chunkFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Use the original single outbound framing and reassembly root.',
        zh: '返回可安装的分块功能配置，复用同一连接的出站分块与接收重组，不另建端点或改变调用关联。'
      },
      returns: {
        en: 'Actual feature object; retain it and install at most once per host.',
        zh: '返回真实功能对象，保留原对象并在每个宿主至多安装一次。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { chunkFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function callWithFeature(\n  transport: IRpcTransportPlugin\n) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [transport, chunkFeature()]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
    },
    retryFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Use original generation-aware retry and unknown-result policy; never blindly replay non-idempotent work.',
        zh: '返回可安装的感知代次重试配置，沿原策略处理结果未知，并依据提供方幂等声明决定是否重放业务。'
      },
      returns: {
        en: 'Actual feature object; retain it and install at most once per host.',
        zh: '返回真实功能对象，保留原对象并在每个宿主至多安装一次。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { retryFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function callWithFeature(\n  transport: IRpcTransportPlugin\n) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [transport, retryFeature()]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
    },
    authFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Configure original signing/verification and optional paired encryption without changing replay or error ownership.',
        zh: '返回可安装的认证功能配置，将原签名验证及可选成对加密接入同一宿主连接，并保留重放与错误归属。'
      },
      returns: {
        en: 'Actual feature object; retain it and install at most once per host.',
        zh: '返回真实功能对象，保留原对象并在每个宿主至多安装一次。'
      },
      example:
        "import { createRpcHost, type IRpcAuthenticationConfig } from '@migaia/rpc-host'\nimport { authFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function callWithFeature(\n  transport: IRpcTransportPlugin,\n  config: IRpcAuthenticationConfig\n) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [transport, authFeature(config)]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      options: 'IRpcAuthenticationConfig'
    },
    defineTransportPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Register a cold source-mode deployment and exact plugin identity.',
        zh: '定义具有稳定工厂身份的传输插件，将冷来源模式与真实部署令牌交给宿主，并复用原插件安装生命周期。'
      },
      params: {
        definition: {
          en: 'Author-owned raw operations or native definition; retain original object identity.',
          zh: '作者拥有的原始操作或原生定义，须保留原对象身份。'
        }
      },
      returns: {
        en: 'Exact registered token/definition; no native connection opens yet.',
        zh: '返回精确登记的令牌或定义，此时不打开原生连接。'
      },
      example:
        "import {\n  createAdapterDeployment,\n  defineTransportPlugin,\n  type IAdapterDeploymentContext,\n  type IRuntimePeerSourceResult\n} from '@migaia/rpc-host/plugin'\n\nexport function customTransport(\n  open: (context: IAdapterDeploymentContext) => Promise<IRuntimePeerSourceResult>\n) {\n  const deployment = createAdapterDeployment({ open })\n  return defineTransportPlugin({ name: 'custom', mode: 'connect', deployment })\n}"
    },
    defineFeaturePlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Register policy, probe, setup or assembly with native plugin-host lifecycle.',
        zh: '定义可复用的功能插件工厂，按原插件宿主生命周期登记策略、观察、安装或装配，不创建另一条调用路径。'
      },
      params: {
        definition: {
          en: 'Author-owned raw operations or native definition; retain original object identity.',
          zh: '作者拥有的原始操作或原生定义，须保留原对象身份。'
        }
      },
      returns: {
        en: 'Exact registered token/definition; no native connection opens yet.',
        zh: '返回精确登记的令牌或定义，此时不打开原生连接。'
      },
      example:
        "import { defineProbe } from '@migaia/rpc-host/probe'\nimport { defineFeaturePlugin } from '@migaia/rpc-host/plugin'\n\nexport const observation = defineFeaturePlugin({\n  name: 'application-observer',\n  probe: defineProbe({\n    stages: ['message', 'peer'],\n    emit: (view) => console.log(Object.freeze({ ...view }))\n  })\n})"
    },
    createAdapterDeployment: {
      role: 'factory',
      purpose: {
        en: 'Capture raw open/listen/managed recipes in a genuine opaque deployment token.',
        zh: '将原始打开、监听或托管配方捕获为真实不透明部署令牌，由宿主随后打开来源并拥有唯一端点。'
      },
      params: {
        recipe: {
          en: 'Author-owned raw operations or native definition; retain original object identity.',
          zh: '作者拥有的原始操作或原生定义，须保留原对象身份。'
        }
      },
      returns: {
        en: 'Exact registered token/definition; no native connection opens yet.',
        zh: '返回精确登记的令牌或定义，此时不打开原生连接。'
      },
      example:
        "import {\n  createAdapterDeployment,\n  defineTransportPlugin,\n  type IAdapterDeploymentContext,\n  type IRuntimePeerSourceResult\n} from '@migaia/rpc-host/plugin'\n\nexport function customTransport(\n  open: (context: IAdapterDeploymentContext) => Promise<IRuntimePeerSourceResult>\n) {\n  const deployment = createAdapterDeployment({ open })\n  return defineTransportPlugin({ name: 'custom', mode: 'connect', deployment })\n}"
    },
    RpcTransportMode: {
      example: {
        en: findApiGuide('rpc-host', 'plugin', 'RpcTransportMode', 'en')!.quickStart!,
        zh: findApiGuide('rpc-host', 'plugin', 'RpcTransportMode', 'zh')!.quickStart!
      },
      role: 'constant',
      purpose: {
        en: 'Physical source selection for the original preparation owner; a mode label alone grants no native or connection authority. Import from `@migaia/rpc-host/plugin`.',
        zh: '选择原准备所有者的物理来源模式，单独模式标签不授予原生或连接权限。从 `@migaia/rpc-host/plugin` 导入。'
      }
    },
    runtimeQuery: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:runtimeQuery'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:runtimeQuery'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Wrap a cold snapshot reader in the original query overload/serialization policy, without caching a second runtime view.',
        zh: '以原查询重载和序列化策略包装冷快照读取，不缓存第二份运行时视图。'
      },
      params: {
        read: {
          en: 'Caller callback returning the current snapshot or its Promise.',
          zh: '调用者返回当前快照或其承诺的回调。'
        }
      },
      returns: {
        en: 'Original query callable; each invocation reads through the supplied owner and applies the existing format conversion.',
        zh: '返回原查询函数，每次经传入所有者读取并采用既有格式转换。'
      }
    },
    resolveAdapterEntry: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:resolveAdapterEntry'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:resolveAdapterEntry'].zh.quickStart!
      },
      optionDocs: {
        mainEntry: sdkOptions['mainEntry']!,
        base: sdkOptions['base']!,
        execArgv: sdkOptions['execArgv']!,
        electron: sdkOptions['electron']!,
        singleBinary: sdkOptions['singleBinary']!,
        selfAllowed: sdkOptions['selfAllowed']!
      },
      role: 'operation',
      purpose: {
        en: 'Resolve explicit or self-spawn entries from native-owner snapshots, without inspecting the caller stack or opening a resource.',
        zh: '从原生所有者快照解析显式或自身启动入口，不检查调用栈，也不打开资源。'
      },
      params: {
        entry: {
          en: 'true selects the supplied mainEntry; otherwise an exact URL-like value or string entry.',
          zh: '真值选择传入主入口，否则为精确地址对象或字符串入口。'
        },
        options: {
          en: 'Native mainEntry/base/execArgv and selfAllowed/Electron/single-binary facts captured by the caller.',
          zh: '调用者捕获的主入口、基准地址、运行参数及自身启动、桌面环境和单文件运行事实。'
        }
      },
      returns: {
        en: 'Resolved entry string. Exact URL bytes remain unchanged; unsupported self-spawn or unresolved relative input throws the original configuration error.',
        zh: '返回解析入口字符串，精确地址字节不变；不支持自身启动或缺少相对基准时抛原配置错误。'
      }
    },
    retainAdapterRuntimeFlags: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:retainAdapterRuntimeFlags'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:retainAdapterRuntimeFlags'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Preserve runtime/loader flags while removing eval, print and test-controller entry selection.',
        zh: '保留运行时及加载器参数，移除求值、打印和测试控制器入口选择。'
      },
      params: {
        flags: {
          en: 'Native execArgv snapshot supplied by the launcher owner.',
          zh: '启动所有者提供的原生运行参数快照。'
        }
      },
      returns: {
        en: 'A retained flag list; the input and native launcher remain caller-owned.',
        zh: '返回保留参数列表，输入及原生启动器仍归调用者。'
      }
    },
    createJsonRpcBridgeError: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createJsonRpcBridgeError'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createJsonRpcBridgeError'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Construct the canonical JSON-RPC bridge failure without reflecting peer payload or replacing the original cause.',
        zh: '按规范错误码返回桥接错误并保留原原因，诊断不反射对端负载，也不创建活动通道的控制权限。'
      },
      params: {
        code: {
          en: 'Registered IJsonRpcBridgeErrorCode value selecting canonical text and identity.',
          zh: '选择规范文本和身份的登记桥接错误码。'
        },
        cause: {
          en: 'Optional original local failure, retained on cause.',
          zh: '保留在原因链上的可选原本地失败。'
        },
        local: {
          en: 'Optional local-misuse flag, default false; local or unsupported-mode failures use TypeError.',
          zh: '可选本地误用标记，默认假值；本地或不支持模式失败使用类型错误。'
        }
      },
      returns: {
        en: 'Native Error or TypeError with the canonical bridge source/code and original cause; no live channel authority is created.',
        zh: '返回附规范桥接领域错误码及原原因的原生错误或类型错误，不创建活动通道权限。'
      }
    },
    JsonRpcProfile: {
      example: {
        en: findApiGuide('rpc-host', 'plugin', 'JsonRpcProfile', 'en')!.quickStart!,
        zh: findApiGuide('rpc-host', 'plugin', 'JsonRpcProfile', 'zh')!.quickStart!
      },
      role: 'constant',
      purpose: {
        en: 'Canonical fixed JSON-RPC bridge wire vocabulary, owned by rpc-contract and re-exported for adapter authors. Changing a label does not enable another profile. Import from `@migaia/rpc-host/plugin`.',
        zh: '契约层拥有并向适配器作者重导出的固定桥接协议词汇，修改标签不会启用另一协议。从 `@migaia/rpc-host/plugin` 导入。'
      }
    },
    JsonRpcErrorNumber: {
      example: {
        en: findApiGuide('rpc-host', 'plugin', 'JsonRpcErrorNumber', 'en')!.quickStart!,
        zh: findApiGuide('rpc-host', 'plugin', 'JsonRpcErrorNumber', 'zh')!.quickStart!
      },
      role: 'constant',
      purpose: {
        en: 'Standard numeric foreign-error classifications; they do not replace the canonical semantic source/code or original cause. Import from `@migaia/rpc-host/plugin`.',
        zh: '外部错误的标准数字分类，不替换规范语义领域错误码或原原因。从 `@migaia/rpc-host/plugin` 导入。'
      }
    },
    JSONRPC_REQUIRED_CAPABILITIES: {
      example: {
        en: findApiGuide('rpc-host', 'plugin', 'JSONRPC_REQUIRED_CAPABILITIES', 'en')!.quickStart!,
        zh: findApiGuide('rpc-host', 'plugin', 'JSONRPC_REQUIRED_CAPABILITIES', 'zh')!.quickStart!
      },
      role: 'constant',
      purpose: {
        en: 'Required bridge, runtime API, batch, cancellation and wire-error capability list. Both sides must satisfy it before readiness; the array creates no negotiation by itself. Import from `@migaia/rpc-host/plugin`.',
        zh: '就绪前双方必须满足的桥接、运行时接口、批处理、取消及错误链能力列表，数组本身不执行协商。从 `@migaia/rpc-host/plugin` 导入。'
      }
    },
    JSONRPC_ALLOWED_CAPABILITIES: {
      example: {
        en: findApiGuide('rpc-host', 'plugin', 'JSONRPC_ALLOWED_CAPABILITIES', 'en')!.quickStart!,
        zh: findApiGuide('rpc-host', 'plugin', 'JSONRPC_ALLOWED_CAPABILITIES', 'zh')!.quickStart!
      },
      role: 'constant',
      purpose: {
        en: 'Complete advertised capability allowlist: required bridge capabilities plus deadline, idempotency and trace metadata. It excludes unsupported native controls and stream frames. Import from `@migaia/rpc-host/plugin`.',
        zh: '完整可公布能力白名单，含必需桥接能力及期限、幂等、追踪元数据，不含不支持的原生控制和流帧。从 `@migaia/rpc-host/plugin` 导入。'
      }
    },
    JSONRPC_REQUIRED_METHODS: {
      example: {
        en: findApiGuide('rpc-host', 'plugin', 'JSONRPC_REQUIRED_METHODS', 'en')!.quickStart!,
        zh: findApiGuide('rpc-host', 'plugin', 'JSONRPC_REQUIRED_METHODS', 'zh')!.quickStart!
      },
      role: 'constant',
      purpose: {
        en: 'The responder must register hello, describe, invoke and cancel extension methods before the bridge becomes usable. The caller still owns actual responder setup. Import from `@migaia/rpc-host/plugin`.',
        zh: '桥接可用前响应方须登记问候、描述、调用及取消扩展方法，实际响应方初始化仍归调用者。从 `@migaia/rpc-host/plugin` 导入。'
      }
    },
    createAdapterSourceConfigurationError: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createAdapterSourceConfigurationError'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createAdapterSourceConfigurationError'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Create the original invalid-source diagnostic using its canonical code and text.',
        zh: '返回带规范错误码及稳定文本的非法来源配置错误，供适配器在获取读取器或原生资源之前拒绝配置。'
      },
      params: {},
      returns: {
        en: 'RpcError with INVALID_CONFIG; it owns no source, reader or native cleanup.',
        zh: '返回非法配置错误，不拥有来源、读取器或原生清理。'
      }
    },
    createAdapterId: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createAdapterId'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createAdapterId'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Allocate an ordinary local resource address through the canonical identifier owner.',
        zh: '经规范标识生成器返回新的本地资源地址字符串，仅用于寻址，不代表认证身份或已登记的来源权限。'
      },
      params: {},
      returns: {
        en: 'New string identifier, never authentication, provenance or a registered resource token.',
        zh: '返回新字符串标识，不代表认证、来源或已登记资源令牌。'
      }
    },
    readAdapterAbortReason: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:readAdapterAbortReason'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:readAdapterAbortReason'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Read the original signal reason at a held resource operation boundary.',
        zh: '在持有资源的操作边界返回原信号取消原因或规范回退值，仅读取借用信号，不会主动触发取消。'
      },
      params: {
        signal: {
          en: 'Original optional operation signal accepted by the canonical abort-reason resolver.',
          zh: '原取消原因解析器接收的可选操作信号。'
        }
      },
      returns: {
        en: 'Original abort reason or the canonical fallback; the signal is borrowed and is not aborted by this read.',
        zh: '返回原取消原因或规范回退值，仅借用信号，读取不会取消它。'
      }
    },

    createAdapterConfigurationError: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createAdapterConfigurationError'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createAdapterConfigurationError'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Attach the established invalid-configuration identity to a new canonical diagnostic.',
        zh: '使用稳定诊断文本创建带既有非法配置身份的错误实例，供适配器在获取原生来源前拒绝无效配置。'
      },
      params: {
        message: {
          en: 'Stable adapter-owned diagnostic text, not an untrusted reflected payload.',
          zh: '适配器拥有的稳定诊断文本，不是反射的不可信载荷。'
        }
      },
      returns: {
        en: 'RpcError with INVALID_CONFIG; no live resource registration is minted.',
        zh: '返回非法配置错误，不签发活动资源登记。'
      }
    },
    createAdapterConfigurationTypeError: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createAdapterConfigurationTypeError'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createAdapterConfigurationTypeError'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Create a native TypeError with canonical invalid-configuration identity while preserving its cause.',
        zh: '创建保留原原因的原生类型错误并附规范非法配置身份，供适配器拒绝本地配置而不登记活动资源。'
      },
      params: {
        message: {
          en: 'Stable adapter-owned configuration text.',
          zh: '适配器拥有的稳定配置文本。'
        },
        cause: {
          en: 'Optional original failure retained unchanged on the chain.',
          zh: '在原因链上原样保留的可选原失败。'
        }
      },
      returns: {
        en: 'The new TypeError instance with code attached; it does not register an external error or live resource.',
        zh: '返回附错误码的新类型错误实例，不登记外部错误或活动资源。'
      }
    },
    createAdapterTransportError: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createAdapterTransportError'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createAdapterTransportError'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Construct the original native transport diagnostic without granting private control identity.',
        zh: '返回保留原原因的原生传输错误实例，用于描述实际读写失败，不授予私有重试或取消控制身份。'
      },
      params: {
        args: {
          en: 'Original RpcTransportError constructor inputs: stable message and optional cause.',
          zh: '原传输错误构造输入，即稳定消息及可选原因。'
        }
      },
      returns: {
        en: 'RpcTransportError retaining its original native class and cause.',
        zh: '返回保留原生类及原因的传输错误。'
      }
    },
    holdAdapterLaunch: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:holdAdapterLaunch'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:holdAdapterLaunch'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Read launch proposal metadata attached by the canonical owner to this exact request; never trust copied caller labels.',
        zh: '读取规范所有者附在精确请求上的启动提议元数据，不信任复制的调用者标签。'
      },
      params: {
        request: {
          en: 'Actual native launch request object received by the launcher.',
          zh: '启动器收到的实际原生启动请求对象。'
        }
      },
      returns: {
        en: 'Readonly proposal projection, or undefined proposal if the request is not held. No setters or accepted identity claims are exposed.',
        zh: '返回只读提议投影，未持有请求的提议为空，不公开设置器或已接纳身份声称。'
      }
    },
    createAdapterBindingDrain: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createAdapterBindingDrain'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createAdapterBindingDrain'].zh.quickStart!
      },
      role: 'factory',
      purpose: {
        en: 'Reuse the original generation-bound drain owner for one actual adapter binding.',
        zh: '返回一个绑定的原有按代次排空控制器，跟踪该代未完成工作并在替换及关闭时等待其收尾。'
      },
      params: {
        args: {
          en: 'Original scheduler, diagnostic report callback and optional drainMs budget.',
          zh: '原调度器、诊断报告回调及可选排空毫秒预算。'
        }
      },
      returns: {
        en: 'Original wrap, trackCurrent and drainCurrent operations, registered with exact drain identity; replacement never inherits old-generation work.',
        zh: '返回原包装、当前请求跟踪及排空操作，并登记精确排空身份，替换不会继承旧代工作。'
      }
    },

    createRuntimeByteConnection: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createRuntimeByteConnection'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createRuntimeByteConnection'].zh.quickStart!
      },
      optionDocs: {
        role: sdkOptions['role']!,
        auth: sdkOptions['auth']!,
        'auth.mode': sdkOptions['auth.mode']!,
        'auth.verify': sdkOptions['auth.verify']!,
        offer: sdkOptions['offer']!,
        platform: sdkOptions['platform']!,
        expectedStringText: sdkOptions['expectedStringText']!,
        peerId: sdkOptions['peerId']!,
        signal: sdkOptions['signal']!,
        handshakeTimeoutMs: sdkOptions['handshakeTimeoutMs']!,
        scheduler: sdkOptions['scheduler']!,
        report: sdkOptions['report']!,
        ipc: sdkOptions['ipc']!,
        'ipc.connectionId': sdkOptions['ipc.connectionId']!,
        'ipc.sessionId': sdkOptions['ipc.sessionId']!,
        'ipc.maxPendingData': sdkOptions['ipc.maxPendingData']!,
        'ipc.maxPendingControl': sdkOptions['ipc.maxPendingControl']!,
        'ipc.log': sdkOptions['ipc.log']!
      },
      role: 'factory',
      purpose: {
        en: 'Perform original framed control negotiation over real ordered byte I/O and retain its accepted connection.',
        zh: '在真实有序字节输入输出上执行原分帧控制协商并保留已接纳连接。'
      },
      params: {
        channel: {
          en: 'Actual IRuntimeByteIO owned by the physical adapter.',
          zh: '物理适配器拥有的实际字节输入输出。'
        },
        options: {
          en: 'Initiator/responder offer, verifier, deadline and original connection policy.',
          zh: '发起响应角色的提议、验证器、期限及原连接策略。'
        },
        diagnostics: {
          en: 'Adapter-owned canonical error/code/text data.',
          zh: '适配器拥有的规范错误码及文本数据。'
        }
      },
      returns: {
        en: 'Promise of negotiated IRuntimeByteConnection; its original close releases connection cleanup before physical close. It creates no host endpoint.',
        zh: '返回已协商字节连接的承诺，原关闭先清理连接再物理关闭，不创建宿主端点。'
      }
    },
    readRuntimeByteBootstrap: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:readRuntimeByteBootstrap'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:readRuntimeByteBootstrap'].zh.quickStart!
      },
      optionDocs: {
        timeoutMs: sdkOptions['timeoutMs']!,
        scheduler: sdkOptions['scheduler']!
      },
      role: 'operation',
      purpose: {
        en: 'Consume exactly one original framed bootstrap while transferring the same decoder into subsequent handshake.',
        zh: '从持有的有序字节输入消费一个分帧启动记录，返回启动快照并将同一解码器转交后续握手继续使用。'
      },
      params: {
        channel: {
          en: 'Actual held ordered byte input, not another competing reader.',
          zh: '实际持有的有序字节输入，不是另一竞争读取器。'
        },
        diagnostics: {
          en: 'Original adapter EOF/timeout/error identities.',
          zh: '原适配器结束、期限及错误身份。'
        },
        options: {
          en: 'Optional explicit timeoutMs and borrowed scheduler for this bootstrap read.',
          zh: '此启动读取的可选显式期限及借入调度器。'
        }
      },
      returns: {
        en: 'Promise of channel plus bootstrap bytes. The channel retains the original decoder; omitted timeout installs no bootstrap-read timer.',
        zh: '返回通道及启动字节的承诺，通道保留原解码器，省略期限时不安装启动读取定时器。'
      }
    },
    createRuntimeProviderGovernor: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createRuntimeProviderGovernor'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createRuntimeProviderGovernor'].zh.quickStart!
      },
      optionDocs: {
        maxCallsPerMinute: sdkOptions['maxCallsPerMinute']!,
        maxPayloadBytes: sdkOptions['maxPayloadBytes']!,
        maxConsecutiveTimeouts: sdkOptions['maxConsecutiveTimeouts']!,
        idleTimeoutMs: sdkOptions['idleTimeoutMs']!,
        violationLimit: sdkOptions['violationLimit']!,
        overflow: sdkOptions['overflow']!
      },
      role: 'factory',
      purpose: {
        en: 'Enforce original connection rate, payload and idle limits at actual provider execution.',
        zh: '返回在实际提供方执行处实施连接速率、负载及空闲限制的治理器，沿原资源规则释放定时器与订阅。'
      },
      params: {
        channel: {
          en: 'Actual accepted remote channel.',
          zh: '实际已接纳远端通道。'
        },
        options: {
          en: 'Original IRuntimeProviderPolicy chosen by the native owner.',
          zh: '原生所有者选择的原提供方治理策略。'
        },
        closeSession: {
          en: 'Callback closing only this native session on the original policy.',
          zh: '按原策略仅关闭此原生会话的回调。'
        },
        report: {
          en: 'Observer for original background/cleanup diagnostics.',
          zh: '接收原后台及清理诊断的观察器。'
        }
      },
      returns: {
        en: 'Governor with original limit/provider/stream wrappers and close. It owns its connection timers/subscriptions, not another endpoint.',
        zh: '返回含原限制、提供方、流包装及关闭的治理器，仅拥有连接定时器和订阅，不拥有另一个端点。'
      }
    },
    createRuntimeProviderScope: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createRuntimeProviderScope'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createRuntimeProviderScope'].zh.quickStart!
      },
      role: 'factory',
      purpose: {
        en: 'Construct the original shared principal-scoped idempotency and provider admission resource.',
        zh: '返回按已认证主体划分的共享幂等与提供方准入资源，通过真实通道身份建立会话键并保留原关闭顺序。'
      },
      params: {
        inputStore: {
          en: 'Optional existing idempotency store; omission selects the canonical store.',
          zh: '可选既有幂等存储，省略时选择规范存储。'
        }
      },
      returns: {
        en: 'Scope whose session derives keys from authenticated channel identity; retire sessions before closing its shared admission registry.',
        zh: '返回从已认证通道身份推导会话键的范围，关闭共享准入登记前须退休会话。'
      }
    },
    createEventEmitterMessageResource: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createEventEmitterMessageResource'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createEventEmitterMessageResource'].zh.quickStart!
      },
      role: 'factory',
      purpose: {
        en: 'Hold actual EventEmitter messaging and optional native launch completion through the canonical resource owner.',
        zh: '通过原资源所有者持有实际事件发射消息及可选启动结果，返回按原有规则负责消息捕获与原生清理的资源。'
      },
      params: {
        port: {
          en: 'Native postMessage/on/off port, optionally exposing actual listener count and close events.',
          zh: '原生消息收发端口，可提供实际监听数量及关闭事件。'
        },
        launch: {
          en: 'Optional genuine launch handle retaining its physical/execution lifetime.',
          zh: '保留物理及执行寿命的可选真实启动句柄。'
        }
      },
      returns: {
        en: 'Held IAdapterMessageResource. Its original close releases capture/launch resources; it never constructs a second host endpoint.',
        zh: '返回持有消息资源，原关闭释放捕获及启动资源，不构造第二个宿主端点。'
      }
    },
    createEventTargetMessageResource: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createEventTargetMessageResource'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createEventTargetMessageResource'].zh.quickStart!
      },
      role: 'factory',
      purpose: {
        en: 'Hold actual EventTarget messaging with the original bounded cold receive capture.',
        zh: '持有实际事件目标并启用有界冷接收捕获，返回沿原生借用与清理规则释放监听及消息捕获的资源。'
      },
      params: {
        port: {
          en: 'Native addEventListener/removeEventListener message port supplied by the adapter.',
          zh: '适配器提供的原生监听增删消息端口。'
        },
        launch: {
          en: 'Optional genuine launch completion/lifetime handle.',
          zh: '可选真实启动完成及寿命句柄。'
        }
      },
      returns: {
        en: 'Held IAdapterMessageResource using original resource cleanup and borrowed native lifetime semantics.',
        zh: '返回使用原资源清理及借用原生寿命语义的持有消息资源。'
      }
    },
    createRuntimeEventByteIO: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createRuntimeEventByteIO'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createRuntimeEventByteIO'].zh.quickStart!
      },
      role: 'factory',
      purpose: {
        en: 'Adapt native event reader/writer and physical close into the one original ordered byte port.',
        zh: '将原生事件读取、写入及物理关闭接入同一有序字节端口，返回保留原订阅与清理行为的字节接口。'
      },
      params: {
        reader: {
          en: 'Actual native byte-event reader.',
          zh: '实际原生字节事件读取器。'
        },
        writer: {
          en: 'Actual native byte writer and its backpressure behavior.',
          zh: '实际原生字节写入器及其背压行为。'
        },
        physical: {
          en: 'Original close/error observation and physical lifetime owner.',
          zh: '原关闭错误观察及物理寿命所有者。'
        },
        closedDiagnostic: {
          en: 'Adapter-owned diagnostic for terminal closure.',
          zh: '适配器拥有的终态关闭诊断。'
        },
        byteViewFactory: {
          en: 'Optional original native byte view conversion.',
          zh: '可选原生字节视图转换。'
        }
      },
      returns: {
        en: 'IRuntimeByteIO retaining original subscriptions, writes and close; no caller predicate or label grants trust.',
        zh: '返回保留原订阅、写入及关闭的字节接口，调用者谓词或标签不授予信任。'
      }
    },
    createRuntimeMessageConnection: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createRuntimeMessageConnection'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createRuntimeMessageConnection'].zh.quickStart!
      },
      optionDocs: {
        offer: sdkOptions['offer']!,
        platform: sdkOptions['platform']!,
        expectedStringText: sdkOptions['expectedStringText']!,
        peerId: sdkOptions['peerId']!,
        signal: sdkOptions['signal']!,
        handshakeTimeoutMs: sdkOptions['handshakeTimeoutMs']!,
        scheduler: sdkOptions['scheduler']!,
        report: sdkOptions['report']!,
        ipc: sdkOptions['ipc']!,
        'ipc.connectionId': sdkOptions['ipc.connectionId']!,
        'ipc.sessionId': sdkOptions['ipc.sessionId']!,
        'ipc.maxPendingData': sdkOptions['ipc.maxPendingData']!,
        'ipc.maxPendingControl': sdkOptions['ipc.maxPendingControl']!,
        'ipc.log': sdkOptions['ipc.log']!
      },
      role: 'factory',
      purpose: {
        en: 'Negotiate on held whole-message I/O through the original bounded capability acknowledgement path.',
        zh: '在持有的完整消息输入输出上执行有界能力协商，返回实际来源结果的承诺，连接继续拥有资源清理。'
      },
      params: {
        io: {
          en: 'Actual whole-message send/onMessage/onClose source.',
          zh: '实际完整消息发送及消息关闭订阅来源。'
        },
        options: {
          en: 'Original message connection offer, peer and control policy.',
          zh: '原消息连接提议、对端及控制策略。'
        },
        diagnostics: {
          en: 'Canonical adapter-owned connection diagnostics.',
          zh: '适配器拥有的规范连接诊断。'
        }
      },
      returns: {
        en: 'Promise of the genuine source result; actual negotiation and resource cleanup remain connection-owned.',
        zh: '返回真实来源结果的承诺，实际协商及资源清理仍归连接。'
      }
    },
    carrierSizeBytes: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:carrierSizeBytes'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:carrierSizeBytes'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Read byte-like payload length without serializing structured-clone values or allocating another buffer.',
        zh: '读取类字节负载长度，不序列化结构化克隆值，也不分配另一缓冲。'
      },
      params: {
        message: {
          en: 'Actual physical frame or structured message being observed.',
          zh: '正在观察的实际物理帧或结构消息。'
        }
      },
      returns: {
        en: 'Known byte length, or the canonical unknown-size sentinel for a non-byte object; observation does not consume the message.',
        zh: '返回已知字节长度或非字节对象的原未知大小标记，观察不消费消息。'
      }
    },
    holdAdapterObjectChannel: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:holdAdapterObjectChannel'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:holdAdapterObjectChannel'].zh.quickStart!
      },
      role: 'factory',
      purpose: {
        en: 'Hold actual object I/O cold so the original connection negotiates and qualifies its own paired object port.',
        zh: '冷持有实际对象输入输出，由原连接自行协商并确定成对对象端口资格。'
      },
      params: {
        io: {
          en: 'Actual physical exchange, text/object channels and terminal lifetime operations.',
          zh: '实际物理交换、文本对象通道及终态寿命操作。'
        }
      },
      returns: {
        en: 'IRuntimeObjectConnection with prepare/negotiate/open/close; it accepts local proposals, never caller-supplied accepted agreement proofs.',
        zh: '返回含准备、协商、打开和关闭的对象连接，接收本地提议而非调用者提交的已接纳协商证明。'
      }
    },
    materializeAdapterJson: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:materializeAdapterJson'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:materializeAdapterJson'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Materialize the canonical JSON data-only view without revisiting caller getters or minting an owned receipt.',
        zh: '形成规范仅数据的序列化视图，不重复访问调用者访问器，也不签发拥有回执。'
      },
      params: {
        value: {
          en: 'Object-carrier input to project before existing listener delivery.',
          zh: '既有监听交付前需要投影的对象载体输入。'
        }
      },
      returns: {
        en: 'Ordinary materialized value; physical source identity, listeners and lifetime remain unchanged.',
        zh: '返回普通投影值，物理来源身份、监听和寿命不变。'
      }
    },
    prepareJsonRpcOffer: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:prepareJsonRpcOffer'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:prepareJsonRpcOffer'].zh.quickStart!
      },
      optionDocs: {
        byte: sdkOptions['byte']!,
        peerId: sdkOptions['peerId']!,
        target: sdkOptions['target']!,
        'target.kind': sdkOptions['target.kind']!,
        'target.contract': sdkOptions['target.contract']!,
        'target.catalog': sdkOptions['target.catalog']!,
        offer: sdkOptions['offer']!,
        token: sdkOptions['token']!,
        scheduler: sdkOptions['scheduler']!,
        wallClock: sdkOptions['wallClock']!,
        ipc: sdkOptions['ipc']!,
        'ipc.connectionId': sdkOptions['ipc.connectionId']!,
        'ipc.sessionId': sdkOptions['ipc.sessionId']!,
        'ipc.maxPendingData': sdkOptions['ipc.maxPendingData']!,
        'ipc.maxPendingControl': sdkOptions['ipc.maxPendingControl']!,
        'ipc.log': sdkOptions['ipc.log']!,
        signal: sdkOptions['signal']!,
        handshakeTimeoutMs: sdkOptions['handshakeTimeoutMs']!,
        report: sdkOptions['report']!
      },
      role: 'operation',
      purpose: {
        en: 'Validate supported local bridge options before readers, timers or physical writes, then add canonical JSON/auth/profile fields.',
        zh: '在读取器、定时器或物理写入前验证支持的本地桥接选项，再加入规范序列化、认证及协议字段。'
      },
      params: {
        options: {
          en: 'Actual byte I/O, contract/catalog whitelist, local offer/token, clocks, IPC policy and reporter.',
          zh: '实际字节输入输出、契约目录白名单、本地提议凭据、时钟、通信策略和报告器。'
        }
      },
      returns: {
        en: 'Canonical IRpcHandshakeOffer; unsupported streams or capabilities reject before I/O. The caller retains credentials and physical ownership.',
        zh: '返回规范握手提议，不支持的流或能力在输入输出前拒绝，调用者保留凭据及物理归属。'
      }
    },
    readJsonRpcReply: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:readJsonRpcReply'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:readJsonRpcReply'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Admit the actual bridge response shape without echoing its reply/authentication text into diagnostics.',
        zh: '检查实际控制交换回复并返回规范桥接结果，非法形状抛出桥接错误，诊断不回显回复或认证文本。'
      },
      params: {
        result: {
          en: 'Actual control-exchange response to inspect.',
          zh: '要检查的实际控制交换回复。'
        }
      },
      returns: {
        en: 'The original reply string; invalid response shape throws the canonical profile error without changing channel ownership.',
        zh: '返回原回复字符串，形状非法时抛规范协议配置错误，不改变通道归属。'
      }
    },
    assertJsonRpcExtensions: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:assertJsonRpcExtensions'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:assertJsonRpcExtensions'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Check required capabilities and all four responder extension methods after the original control exchange.',
        zh: '在原控制交换后检查必需能力及响应端全部四种扩展方法，缺失时抛出规范桥接错误，成功不返回数据。'
      },
      params: {
        capabilities: {
          en: 'Actual accepted capability list.',
          zh: '实际已接纳能力列表。'
        },
        result: {
          en: 'Already shape-admitted responder reply carrying its methods.',
          zh: '已通过形状准入且带方法列表的响应回复。'
        }
      },
      returns: {
        en: 'Void on success; missing extensions throw the original bridge error. No handshake or reader is added.',
        zh: '成功返回空值，缺失扩展抛原桥接错误，不添加握手或读取器。'
      }
    },
    validateJsonRpcDescription: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:validateJsonRpcDescription'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:validateJsonRpcDescription'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Apply the canonical remote description checker and the bridge profile stream exclusion.',
        zh: '按规范检查收到的远端方法目录并执行桥接协议的流排除规则，成功无返回值，非法形状保留原规范错误。'
      },
      params: {
        value: {
          en: 'Actual received version-two method directory.',
          zh: '实际收到的第二版方法目录。'
        }
      },
      returns: {
        en: 'Void on success; malformed data or stream methods keep their canonical errors. Validation grants no source identity.',
        zh: '成功返回空值，非法数据或流方法保留规范错误，验证不授予来源身份。'
      }
    },
    RpcCarrierDetailKey: {
      example: {
        en: findApiGuide('rpc-host', 'plugin', 'RpcCarrierDetailKey', 'en')!.quickStart!,
        zh: findApiGuide('rpc-host', 'plugin', 'RpcCarrierDetailKey', 'zh')!.quickStart!
      },
      role: 'constant',
      purpose: {
        en: 'Canonical physical observation field names. These measurements describe native activity and never authorize a source or infer business completion. Import from `@migaia/rpc-host/plugin`.',
        zh: '规范物理观察字段名称，测量仅描述原生活动，不授权来源或推断业务完成。从 `@migaia/rpc-host/plugin` 导入。'
      }
    },
    RpcAdapterErrorText: {
      example: {
        en: findApiGuide('rpc-host', 'plugin', 'RpcAdapterErrorText', 'en')!.quickStart!,
        zh: findApiGuide('rpc-host', 'plugin', 'RpcAdapterErrorText', 'zh')!.quickStart!
      },
      role: 'constant',
      purpose: {
        en: 'Stable message data and text factories used by the canonical native carrier owners. They create neither error identity nor cleanup authority by themselves; use the existing error constructors. Import from `@migaia/rpc-host/plugin`.',
        zh: '原生载体所有者使用的稳定消息及文本工厂，本身不创建错误身份或清理权限，应使用既有错误构造器。从 `@migaia/rpc-host/plugin` 导入。'
      }
    },
    createRpcTransportError: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createRpcTransportError'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createRpcTransportError'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Construct the original transport error class and preserve its registered identity.',
        zh: '返回带原原因及登记身份的原生传输错误实例，用于诊断物理收发失败，不授予活动操作控制权限。'
      },
      params: {
        args: {
          en: 'Stable diagnostic message and optional original cause accepted by RpcTransportError.',
          zh: '原传输错误接收的稳定诊断消息及可选原原因。'
        }
      },
      returns: {
        en: 'Native RpcTransportError with original cause; no private live-control brand is granted to external errors.',
        zh: '返回带原原因的原生传输错误，不为外部错误授予私有活动控制标记。'
      }
    },
    holdAdapterByteBootstrapSource: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:holdAdapterByteBootstrapSource'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:holdAdapterByteBootstrapSource'].zh.quickStart!
      },
      optionDocs: {
        runtime: sdkOptions['runtime']!,
        platform: sdkOptions['platform']!,
        diagnostics: sdkOptions['diagnostics']!,
        expectedStringText: sdkOptions['expectedStringText']!,
        bootstrapInvalidText: sdkOptions['bootstrapInvalidText']!,
        ipc: sdkOptions['ipc']!
      },
      role: 'factory',
      purpose: {
        en: 'Hold the original private byte first-frame snapshot before the unique host endpoint is constructed.',
        zh: '在唯一宿主端点构造前持有真实字节来源的首帧快照，返回保留原解码器与启动权限的不透明句柄。'
      },
      params: {
        io: {
          en: 'Genuine IRuntimeByteIO already carrying its canonical bootstrap receipt.',
          zh: '已携规范启动回执的真实字节接口。'
        },
        local: {
          en: 'Local presentation, diagnostics and original IPC overrides, never accepted identity claims.',
          zh: '本地展示、诊断及原通信覆盖，不是已接纳身份声称。'
        }
      },
      returns: {
        en: 'Exact opaque IAdapterByteBootstrapSource; no second reader or endpoint is opened and invalid source authority rejects.',
        zh: '返回精确不透明字节启动句柄，不打开第二个读取器或端点，非法来源权限拒绝。'
      }
    },
    holdAdapterMessageBootstrapSource: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:holdAdapterMessageBootstrapSource'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:holdAdapterMessageBootstrapSource'].zh.quickStart!
      },
      optionDocs: {
        initial: sdkOptions['initial']!,
        connectTimeoutMs: sdkOptions['connectTimeoutMs']!,
        report: sdkOptions['report']!
      },
      role: 'factory',
      purpose: {
        en: 'Hold native initial message identity with the original resource and one shared deadline before host endpoint construction.',
        zh: '在宿主端点构造前通过原消息资源及共享期限持有首消息身份，返回不透明启动令牌并在失败时清理原捕获。'
      },
      params: {
        resource: {
          en: 'Genuine resource from the canonical EventEmitter/EventTarget holder.',
          zh: '规范消息资源持有器产生的真实资源。'
        },
        options: {
          en: 'Optional original initial reader, connectTimeoutMs and cleanup reporter.',
          zh: '可选原首消息读取器、连接期限及清理报告器。'
        }
      },
      returns: {
        en: 'Promise of exact opaque message bootstrap token; failure cleans original capture and retains primary error identity.',
        zh: '返回精确不透明消息启动令牌的承诺，失败清理原捕获并保留主错误身份。'
      }
    },
    createAdapterMessageHandshakeBudget: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createAdapterMessageHandshakeBudget'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createAdapterMessageHandshakeBudget'].zh.quickStart!
      },
      role: 'operation',
      purpose: {
        en: 'Capture one absolute preparation deadline before initial-message and capability acknowledgement work.',
        zh: '根据可选超时在首消息及能力确认前返回共享绝对期限预算，未提供超时时返回未定义，不创建定时器。'
      },
      params: {
        scheduler: {
          en: 'Borrowed monotonic scheduler used by the existing resource timers.',
          zh: '既有资源定时器使用的借入单调调度器。'
        },
        timeoutMs: {
          en: 'Explicit connection budget, or undefined to retain unconfigured timing.',
          zh: '显式连接预算，未配置时为空值。'
        }
      },
      returns: {
        en: 'Budget object or undefined when no timeout was supplied. It creates no timer and cannot reset the deadline on later phases.',
        zh: '返回预算对象，未提供期限时为空值；不创建定时器，也不能在后续阶段重置期限。'
      }
    },
    MessageResourceEvent: {
      example: {
        en: findApiGuide('rpc-host', 'plugin', 'MessageResourceEvent', 'en')!.quickStart!,
        zh: findApiGuide('rpc-host', 'plugin', 'MessageResourceEvent', 'zh')!.quickStart!
      },
      role: 'constant',
      purpose: {
        en: 'Native message-resource event names shared by first-frame capture and transport construction. Subscribe through the canonical resource rather than taking a second reader. Import from `@migaia/rpc-host/plugin`.',
        zh: '首帧捕获及传输构造共用的原生消息资源事件名，应经规范资源订阅而不另占读取器。从 `@migaia/rpc-host/plugin` 导入。'
      }
    },
    RuntimeApiErrorText: {
      example: {
        en: findApiGuide('rpc-host', 'plugin', 'RuntimeApiErrorText', 'en')!.quickStart!,
        zh: findApiGuide('rpc-host', 'plugin', 'RuntimeApiErrorText', 'zh')!.quickStart!
      },
      role: 'constant',
      purpose: {
        en: 'Stable non-reflecting configuration and directory diagnostic text. Use the owning error boundary to attach code/cause; text values are not runtime registration or identity proofs. Import from `@migaia/rpc-host/plugin`.',
        zh: '不反射输入的稳定配置及目录诊断文本，由所属错误边界附加错误码原因；文本值不是运行时登记或身份证明。从 `@migaia/rpc-host/plugin` 导入。'
      }
    },
    createRuntimeWebByteStream: {
      example: {
        en: rpcApiGuides['rpc-host:plugin:createRuntimeWebByteStream'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:createRuntimeWebByteStream'].zh.quickStart!
      },
      optionDocs: {
        openFailed: sdkOptions['openFailed']!,
        closedError: sdkOptions['closedError']!,
        cleanupFailed: sdkOptions['cleanupFailed']!,
        report: sdkOptions['report']!
      },
      role: 'factory',
      purpose: {
        en: 'Acquire native reader/writer once and reuse their buffering and write ordering in the shared reliable byte pump.',
        zh: '仅获取一次原生读写器，并在共享可靠字节泵中复用原缓冲及写入顺序。'
      },
      params: {
        readable: {
          en: 'Actual native structural readable stream.',
          zh: '实际原生结构可读流。'
        },
        writable: {
          en: 'Actual native structural writable stream.',
          zh: '实际原生结构可写流。'
        },
        closePhysical: {
          en: 'Original physical close callback owned by the adapter.',
          zh: '适配器拥有的原物理关闭回调。'
        },
        options: {
          en: 'Adapter error constructors and background reporter preserving native identity.',
          zh: '保留原生身份的适配器错误构造及后台报告器。'
        }
      },
      returns: {
        en: 'IRuntimeByteIO whose same terminal cleanup cancels reader, aborts writer, invokes physical close and releases the reader lock; no second queue or session owner.',
        zh: '返回字节接口，同一终态清理取消读取器、终止写入器、调用物理关闭并释放读取锁，不添加另一队列或会话所有者。'
      }
    }
  },
  types: {
    IRuntimeTypedPeer: {
      summary: {
        en: 'A Runtime Peer typed by `TRemote`: method names, payloads and results are checked against the other side API. Also has `self`, `describe()`, `outcome()`, `on()` and `close()`.',
        zh: '按 `TRemote` 类型化的 Runtime Peer：方法名、参数与结果都按对端 API 检查。另有 `self`、`describe()`、`outcome()`、`on()` 与 `close()`。'
      },
      scenarios: [
        {
          en: 'Call worker or child process functions as if they were local, with types.',
          zh: '像调用本地函数一样带类型地调用 Worker 或子进程中的函数。'
        },
        {
          en: 'Retry a non-idempotent call safely with `idempotencyKey` and `outcome(key)`.',
          zh: '借助 `idempotencyKey` 与 `outcome(key)` 安全地重试非幂等调用。'
        }
      ],
      example: {
        en: "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
        zh: "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
      },
      members: {
        self: {
          summary: {
            en: 'Frozen local peer name and instanceId minted or supplied during this connection construction; it is not a remote authentication principal.',
            zh: '连接构造时签发或由应用提供的冻结本端名称与实例标识，不代表对端认证主体。'
          }
        },
        outcome: {
          summary: {
            en: 'Queries the original remote operation ledger for a prior idempotency key, without dispatching that operation again.',
            zh: '查询原始远端操作账本中已有幂等键的结果，不会再次派发对应操作。'
          },
          params: {
            idempotencyKey: {
              en: 'The caller-issued key supplied as options.idempotencyKey on an earlier request to this connection.',
              zh: '来自调用方先前在此连接请求的 `options.idempotencyKey` 中指定的幂等键。'
            }
          },
          returns: {
            en: 'Promise of IRpcRuntimeOutcomeResult; support and availability come from the accepted remote runtime contract.',
            zh: '返回 `IRpcRuntimeOutcomeResult` Promise，支持程度与可用性取决于已接受的远端运行时契约。'
          },
          example:
            "await worker.request('orders.create', order, { idempotencyKey: 'order-42' })\nconsole.log(await worker.outcome('order-42'))"
        },
        describe: {
          summary: {
            en: 'Queries the local accepted peer detail asynchronously. Without format returns IRuntimeDetail; json, yaml or toml returns the admitted text projection. It does not claim unavailable physical metrics.',
            zh: '异步查询本地已接受的连接详情，不选格式时返回 `IRuntimeDetail`，选择 `json`、`yaml` 或 `toml` 时返回允许的文本投影，不编造不可观察的物理指标。'
          },
          params: {
            options: {
              en: 'Optional query format from IRuntimeQueryOptions; omitted returns the object snapshot.',
              zh: '来自 `IRuntimeQueryOptions` 的可选查询格式，省略时返回对象快照。'
            }
          },
          returns: {
            en: 'Promise of local detail or formatted text, following the selected query format.',
            zh: '根据所选查询格式返回本地详情或格式化文本的 Promise。'
          },
          example:
            "console.log(await worker.describe())\nconsole.log(await worker.describe({ format: 'json' }))"
        },
        on: {
          summary: {
            en: 'Registers a future RuntimeEventName listener after construction; factory resolution already represents initial readiness. Listener return is ignored and failures are contained by the runtime reporter.',
            zh: '构造完成后登记未来运行时事件监听，工厂完成已经代表首次就绪；不消费监听返回值，失败由运行时报告接收方隔离。'
          },
          params: {
            event: {
              en: 'A RuntimeEventName value such as ready or exit; it selects future connection lifecycle notifications.',
              zh: '来自 `RuntimeEventName` 的取值，例如 `ready` 或 `exit`，用于选择未来连接生命周期通知。'
            },
            listener: {
              en: 'Callback receives IRuntimeEvent from this connection; return is ignored and throws or rejected thenables are reported.',
              zh: '回调接收来自本连接的 `IRuntimeEvent`，返回值不消费，抛错或类 Promise 对象拒绝会报告。'
            }
          },
          returns: {
            en: 'Idempotent removal function for this registration; closing the peer clears its publisher.',
            zh: '返回本次登记的幂等移除函数，关闭连接会清理其事件发布者。'
          },
          example:
            "const off = worker.on('exit', event => console.log(event))\nawait worker.close()\noff()"
        },
        close: {
          summary: {
            en: 'Ends this logical connection and releases its owned channel resources; platform factories also terminate a worker or child they spawned.',
            zh: '结束本逻辑连接并释放其拥有的通道资源，平台工厂还会终止由它启动的线程或子进程。'
          },
          returns: {
            en: 'Shared completion Promise retaining the original close operation identity; no new calls are admitted once closing begins.',
            zh: '返回保持原始关闭操作身份的共享完成 Promise，关闭开始后不再接纳新调用。'
          },
          example: 'await worker.close()\nawait worker.close()'
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Scoped asynchronous cleanup is the exact original close operation, including its Promise identity.',
            zh: '作用域异步清理使用原始关闭操作本身，并保持其完成 Promise 身份。'
          },
          returns: {
            en: 'The same completion Promise as close(), including platform-owned resource cleanup.',
            zh: '返回与 `close()` 相同的完成 Promise，包含平台拥有资源的清理。'
          },
          example: 'await worker[Symbol.asyncDispose]()'
        },
        request: {
          summary: {
            en: 'Calls a method the other side provides and waits for its result. Default deadline 30000 ms (`defaultTimeoutMs`); errors keep their native type and `(source, code)`.',
            zh: '调用对端提供的方法并等待结果。默认截止时间为 30000 毫秒（可由 `defaultTimeoutMs` 修改）；错误保留原生类型与 `(source, code)`。'
          },
          params: {
            method: {
              en: 'Dotted path of a method in the other side `provide`, e.g. `math.double`.',
              zh: '对端 `provide` 中方法的点分路径，例如 `math.double`。'
            },
            args: {
              en: '`(payload?, options?)`: one payload and call options (`timeoutMs`, `signal`, `transfer`, `idempotencyKey`).',
              zh: '`(payload?, options?)`：一个参数，以及调用选项（`timeoutMs`、`signal`、`transfer`、`idempotencyKey`）。'
            }
          },
          returns: {
            en: 'The method result, typed from `TRemote`.',
            zh: '方法的返回结果，类型由 `TRemote` 推导。'
          },
          example: "const total = await worker.request('math.double', 21, { timeoutMs: 1000 })"
        },
        notify: {
          summary: {
            en: 'Sends a one-way call; no result comes back.',
            zh: '发送单向调用，不会返回结果。'
          },
          params: {
            method: {
              en: 'Dotted method path provided by the other side.',
              zh: '对端提供的方法的点分路径。'
            },
            args: {
              en: '`(payload?, options?)` as for `request`.',
              zh: '`(payload?, options?)`，规则与 `request` 相同。'
            }
          },
          returns: {
            en: 'Resolves once the call was sent.',
            zh: '调用发送后 resolve。'
          },
          example: "await worker.notify('log.write', 'started')"
        },
        stream: {
          summary: {
            en: 'Calls a method that returns an iterable and yields its items as they arrive.',
            zh: '调用返回可迭代对象的方法，并在元素到达时逐个产出。'
          },
          params: {
            method: {
              en: 'Dotted path of an iterator method provided by the other side.',
              zh: '对端提供的迭代器方法的点分路径。'
            },
            args: {
              en: '`(payload?, options?)` as for `request`.',
              zh: '`(payload?, options?)`，规则与 `request` 相同。'
            }
          },
          returns: {
            en: 'An async iterator of the yielded items.',
            zh: '所产出元素的异步迭代器。'
          },
          example: "for await (const value of worker.stream('feed.count', 3)) console.log(value)"
        },
        group: {
          summary: {
            en: 'Sends several calls as one batch and returns the outcome of each step in order.',
            zh: '把多次调用作为一个批次发送，并按顺序返回每一步的结果。'
          },
          params: {
            steps: {
              en: 'Steps `{ method, payload? }` in order.',
              zh: '按顺序排列的步骤 `{ method, payload? }`。'
            },
            options: {
              en: 'Batch options such as `timeoutMs` and `signal`.',
              zh: '批次选项，例如 `timeoutMs` 与 `signal`。'
            }
          },
          returns: {
            en: 'One outcome per step (success value or error).',
            zh: '每一步对应一个结果（成功值或错误）。'
          },
          example:
            "const [a, b] = await worker.group([{ method: 'math.double', payload: 1 }, { method: 'math.double', payload: 2 }])"
        }
      }
    },
    IRuntimeUnavailable: {
      summary: {
        en: 'Explicit marker for a fact that cannot be observed, used instead of inventing `0` or `null`.',
        zh: '表示某个事实无法观察的显式标记，用来代替编造的 `0` 或 `null`。'
      },
      members: {
        status: {
          summary: {
            en: 'Always `unavailable`: the value could not be observed.',
            zh: '固定为 `unavailable`，表示该值不可用。'
          }
        },
        reason: {
          summary: {
            en: 'Why it is unavailable, e.g. `native-resource-sampling-not-connected`.',
            zh: '该值不可用的具体原因，例如 `native-resource-sampling-not-connected`。'
          }
        }
      }
    },
    IRuntimeConnectionDetail: {
      summary: {
        en: 'Detail of one connection, returned by `get(target)`, listed by `list()` and in `describe().connections`.',
        zh: '单个连接的详情，由 `get(target)` 返回，也出现在 `list()` 与 `describe().connections` 中。'
      },
      members: {
        methods: {
          summary: {
            en: 'Method paths callable on the other side, from its accepted directory.',
            zh: '对端已接受目录中可调用的方法路径。'
          }
        },
        counters: {
          summary: {
            en: 'Call counters: `inFlight` (calls not yet finished) is measured; `sent`, `received`, `errors`, `lastActiveAt` are reported unavailable; or `{ status: "unavailable", reason }` when the owner cannot observe it.',
            zh: '调用计数：`inFlight`（尚未结束的调用数）会被测量；`sent`、`received`、`errors`、`lastActiveAt` 报告为不可用；无法观察时为 `{ status: "unavailable", reason }`。'
          }
        },
        recent: {
          summary: {
            en: 'Recent lifecycle records (`IRuntimeRecent`), newest last.',
            zh: '最近的生命周期记录（`IRuntimeRecent`），最新的在最后。'
          }
        },
        identity: {
          summary: {
            en: 'Identity `{ name, instanceId }` the other side announced, or `{ status: "unavailable", reason }` when the owner cannot observe it.',
            zh: '对端声明的身份 `{ name, instanceId }`；无法观察时为 `{ status: "unavailable", reason }`。'
          }
        },
        generation: {
          summary: {
            en: 'Generation accepted from the other side (not the local restart count).',
            zh: '从对端接受的代次（不是本地重启次数）。'
          }
        },
        kind: {
          summary: {
            en: 'How the connection was configured: `spawn`, `connect` or `listen`.',
            zh: '该连接在本端的配置方式：`spawn`、`connect` 或 `listen`。'
          },
          values: {
            enum: 'RuntimeSourceKind'
          }
        },
        direction: {
          summary: {
            en: 'Who started it: `spawned`, `spawned-by` (this side is the child), `connect` or `listen`.',
            zh: '由哪一方发起：`spawned`、`spawned-by`（本端是子端）、`connect` 或 `listen`。'
          },
          values: {
            enum: 'RuntimeConnectionDirection'
          }
        },
        carrier: {
          summary: {
            en: 'Name of the physical carrier, such as a MessagePort or stdio.',
            zh: '底层传输通道的名称，例如 MessagePort 或 stdio。'
          }
        },
        connection: {
          summary: {
            en: '`{ status }`: `ready`, `closed`, `departed`, or unavailable.',
            zh: '逻辑连接状态 `{ status }`：`ready`、`closed`、`departed` 或不可用。'
          }
        },
        unit: {
          summary: {
            en: 'Supervised unit `{ kind, state, generation, degraded }`, or `{ status: "unavailable", reason }` when the owner cannot observe it.',
            zh: '受监督的执行单元 `{ kind, state, generation, degraded }`；无法观察时为 `{ status: "unavailable", reason }`。'
          }
        },
        health: {
          summary: {
            en: 'Health check metric `{ state, failures }`, or `{ status: "unavailable", reason }` when the owner cannot observe it.',
            zh: '健康检查指标 `{ state, failures }`；无法观察时为 `{ status: "unavailable", reason }`。'
          }
        },
        restartCount: {
          summary: {
            en: 'Number of restarts as a metric, or `{ status: "unavailable", reason }` when the owner cannot observe it.',
            zh: '以指标形式给出的重启次数；无法观察时为 `{ status: "unavailable", reason }`。'
          }
        },
        resources: {
          summary: {
            en: 'Sampled resources (pid or threadId, memory, CPU time, event-loop utilisation), or `{ status: "unavailable", reason }` when the owner cannot observe it.',
            zh: '采样得到的资源（pid 或 threadId、内存、CPU 时间、事件循环利用率）；无法观察时为 `{ status: "unavailable", reason }`。'
          }
        },
        lastExit: {
          summary: {
            en: 'Last exit `{ generation, reason, code, signal, error? }`, or `{ status: "unavailable", reason }` when the owner cannot observe it.',
            zh: '最近一次退出 `{ generation, reason, code, signal, error? }`；无法观察时为 `{ status: "unavailable", reason }`。'
          }
        }
      }
    },
    IRuntimeDetail: {
      summary: {
        en: 'Result of `peer.describe()`: this side identity, its methods and its connections.',
        zh: '`peer.describe()` 的结果：本端身份、本端方法以及各个连接。'
      },
      members: {
        methods: {
          summary: {
            en: 'Method paths provided by this local Peer; each connection detail separately lists its accepted remote methods.',
            zh: '此本端对端提供的方法路径；每条连接详情另外列出已接纳远端的方法。'
          }
        },
        counters: {
          summary: {
            en: 'Call counters: `inFlight` (calls not yet finished) is measured; `sent`, `received`, `errors`, `lastActiveAt` are reported unavailable; or `{ status: "unavailable", reason }` when the owner cannot observe it.',
            zh: '调用计数：`inFlight`（尚未结束的调用数）会被测量；`sent`、`received`、`errors`、`lastActiveAt` 报告为不可用；无法观察时为 `{ status: "unavailable", reason }`。'
          }
        },
        recent: {
          summary: {
            en: 'Recent lifecycle records (`IRuntimeRecent`), newest last.',
            zh: '最近的生命周期记录（`IRuntimeRecent`），最新的在最后。'
          }
        },
        identity: {
          summary: {
            en: 'Identity `{ name, instanceId }` of this Peer.',
            zh: '当前这个本地 Peer 自身的身份 `{ name, instanceId }`。'
          }
        },
        self: {
          summary: {
            en: 'Same identity, as given by the `self` option or generated.',
            zh: '同一身份，来自 `self` 选项或自动生成。'
          }
        },
        provide: {
          summary: {
            en: 'Method paths this side provides.',
            zh: '本端通过 `provide` 提供的方法路径。'
          }
        },
        connections: {
          summary: {
            en: 'Details of every connection (`IRuntimeConnectionDetail`).',
            zh: '本 Peer 当前每个连接的运行详情（`IRuntimeConnectionDetail`）。'
          }
        },
        unit: {
          summary: {
            en: 'Unavailable for a local Peer; see `connections`.',
            zh: '对本地 Peer 不可用；执行单元信息请查看 `connections`。'
          }
        },
        health: {
          summary: {
            en: 'A local Peer may have several connections, so this field does not combine them into one health result. It returns an unavailable value. Inspect each connection to see whether that connection is healthy.',
            zh: '本地 Peer 可以持有多条连接，此字段不会把它们合成为一个健康结果，而是返回不可用值。需要判断通信是否健康时，应查看每条连接各自的健康状态。'
          }
        },
        restartCount: {
          summary: {
            en: 'Restart counts describe individual connections, not the local Peer as a whole. This field returns an unavailable value. Inspect the relevant connection when you need its restart count.',
            zh: '重启次数属于每条连接，不属于整个本地 Peer，因此此字段返回不可用值。需要知道某个对端重启过多少次时，应查看对应连接。'
          }
        },
        resources: {
          summary: {
            en: 'Resource measurements belong to the execution unit behind each connection. The local Peer returns an unavailable value here rather than a combined measurement. Inspect a connection for the resource information its runtime supports.',
            zh: '资源测量属于每条连接背后的执行单元。本地 Peer 在此返回不可用值，不汇总各连接的用量。需要资源信息时，应查看对应连接及其运行环境实际支持的测量结果。'
          }
        }
      }
    },
    IRuntimeOverview: {
      summary: {
        en: 'Result of `host.thread.list()` / `host.process.list()`.',
        zh: '调用 `host.thread.list()` / `host.process.list()` 时返回的全部连接总览。'
      },
      members: {
        self: {
          summary: {
            en: 'Identity `{ name, instanceId }` of the host.',
            zh: '宿主自身的身份 `{ name, instanceId }`，用于区分不同宿主。'
          }
        },
        connections: {
          summary: {
            en: 'Details of the selected connections.',
            zh: '按筛选条件选出的各个连接的详情。'
          }
        }
      }
    },
    IRuntimeQueryOptions: {
      summary: {
        en: 'Options of `describe()` and `get()`.',
        zh: '`describe()` 与 `get()` 的选项：控制结果的输出格式。'
      },
      members: {
        format: {
          summary: {
            en: 'Return text in `json`, `yaml` or `toml` instead of an object.',
            zh: '以 `json`、`yaml` 或 `toml` 文本返回，而不是对象。'
          },
          default: {
            en: 'Not set: return an object.',
            zh: '不设置：返回对象。'
          }
        }
      }
    },
    IRuntimeListOptions: {
      summary: {
        en: 'Options of `list()`: filter and output format.',
        zh: '`list()` 的选项：筛选条件与输出格式。'
      },
      members: {
        filter: {
          summary: {
            en: 'Selects connections; see `IRuntimeListFilter`.',
            zh: '用于选择连接的条件，见 `IRuntimeListFilter`。'
          },
          default: {
            en: 'Not set: all connections.',
            zh: '不设置：返回全部连接。'
          }
        },
        format: {
          summary: {
            en: 'Return text in `json`, `yaml` or `toml`.',
            zh: '改为以 `json`、`yaml` 或 `toml` 文本返回结果。'
          },
          default: {
            en: 'Not set: return an object.',
            zh: '不设置：返回对象。'
          }
        }
      }
    },
    IRuntimeListFilter: {
      summary: {
        en: 'Filter of `list({ filter })`; every given field must match.',
        zh: '`list({ filter })` 的筛选条件；给出的字段都必须匹配。'
      },
      members: {
        state: {
          summary: {
            en: 'Supervisor state: `idle`, `queued`, `starting`, `ready`, `backoff`, `stopping`, `stopped`, `terminal` or `disposed`.',
            zh: '受监督执行单元的状态：`idle`、`queued`、`starting`、`ready`、`backoff`、`stopping`、`stopped`、`terminal` 或 `disposed`。'
          }
        },
        name: {
          summary: {
            en: '`{ exact }` or `{ prefix }` match on the connection name.',
            zh: '按连接名称 `{ exact }` 精确匹配或 `{ prefix }` 前缀匹配。'
          }
        },
        kind: {
          summary: {
            en: '`spawn`, `connect` or `listen`.',
            zh: '按连接配置方式筛选：`spawn`、`connect` 或 `listen`。'
          },
          values: {
            enum: 'RuntimeSourceKind'
          }
        },
        direction: {
          summary: {
            en: '`spawned`, `spawned-by`, `connect` or `listen`.',
            zh: '按连接发起方向筛选：`spawned`、`spawned-by`、`connect` 或 `listen`。'
          },
          values: {
            enum: 'RuntimeConnectionDirection'
          }
        }
      }
    },
    IRuntimeRecent: {
      summary: {
        en: 'One recent lifecycle record of a connection.',
        zh: '某个连接最近的一条生命周期记录。'
      },
      members: {
        generation: {
          summary: {
            en: 'Generation the record belongs to.',
            zh: '该记录所属的代次编号。'
          }
        },
        timestamp: {
          summary: {
            en: 'Scheduler time (monotonic milliseconds), not epoch time.',
            zh: '调度器时间（单调毫秒数），不是纪元时间。'
          }
        },
        clock: {
          summary: {
            en: 'Clock of `timestamp`; `scheduler`.',
            zh: '`timestamp` 所使用的时钟，取值固定为 `scheduler`。'
          }
        },
        kind: {
          summary: {
            en: 'What happened, such as `ready` or `exit`.',
            zh: '记录的事件类型，例如 `ready` 或 `exit`。'
          }
        },
        identity: {
          summary: {
            en: 'Peer identity at that time, if known.',
            zh: '当时的对端身份（已知时才有）。'
          }
        },
        source: {
          summary: {
            en: 'Error source when the record is a failure.',
            zh: '记录为失败时对应错误的 source。'
          }
        },
        code: {
          summary: {
            en: 'Error code when the record is a failure.',
            zh: '记录为失败时对应错误的 code。'
          }
        }
      }
    },
    IRuntimeEvent: {
      summary: {
        en: 'Lifecycle event received by `on(event, listener)` and `watch()`.',
        zh: '`on(event, listener)` 与 `watch()` 收到的生命周期事件。'
      },
      members: {
        type: {
          summary: {
            en: 'Event name; see `RuntimeEventName`.',
            zh: '生命周期事件名称，取值见 `RuntimeEventName`。'
          },
          values: {
            enum: 'RuntimeEventName'
          }
        },
        name: {
          summary: {
            en: 'Connection name, e.g. the plugin `name`.',
            zh: '发生事件的连接名称，例如插件的 `name`。'
          }
        },
        instanceId: {
          summary: {
            en: 'Instance id of that generation, or `{ status: "unavailable", reason }` when the owner cannot observe it.',
            zh: '该代次的实例 id；无法观察时为 `{ status: "unavailable", reason }`。'
          }
        },
        generation: {
          summary: {
            en: 'Generation number, or `{ status: "unavailable", reason }` when the owner cannot observe it.',
            zh: '代次编号；无法观察时为 `{ status: "unavailable", reason }`。'
          }
        },
        timestamp: {
          summary: {
            en: 'Scheduler time of the observation, or `{ status: "unavailable", reason }` when the owner cannot observe it.',
            zh: '观察到该事件时的调度器时间；无法观察时为 `{ status: "unavailable", reason }`。'
          }
        },
        clock: {
          summary: {
            en: 'Clock of `timestamp`; `scheduler`.',
            zh: '`timestamp` 所使用的时钟，取值固定为 `scheduler`。'
          }
        },
        reason: {
          summary: {
            en: '`exit` only: why the unit exited.',
            zh: '仅 `exit` 事件：执行单元退出的原因。'
          }
        },
        code: {
          summary: {
            en: '`exit` only: exit code, or unavailable.',
            zh: '仅 `exit` 事件：退出码，或不可用。'
          }
        },
        signal: {
          summary: {
            en: '`exit` only: terminating signal, or unavailable.',
            zh: '仅 `exit` 事件：终止信号，或不可用。'
          }
        },
        error: {
          summary: {
            en: '`exit` / `terminal`: `{ source, code }` of the failure.',
            zh: '仅 `exit` / `terminal` 事件：导致退出的失败 `{ source, code }`。'
          }
        },
        count: {
          summary: {
            en: '`restart` only: how many restarts so far.',
            zh: '仅 `restart` 事件：到目前为止的重启次数。'
          }
        },
        degraded: {
          summary: {
            en: '`degraded` only: features that are degraded.',
            zh: '仅 `degraded` 事件：处于降级状态的功能。'
          }
        }
      }
    },
    IRuntimeSurface: {
      summary: {
        en: 'Type of the methods a runtime plugin publishes: its `provide` plus the selected host `expose` paths.',
        zh: '运行时插件发布的方法类型：其 `provide` 加上所选的宿主 `expose` 路径。'
      },
      members: {}
    },
    IRuntimeDynamicSurface: {
      summary: {
        en: 'Untyped method record used when the remote API is not declared.',
        zh: '未声明远端 API 时使用的无类型方法记录。'
      },
      members: {}
    },
    IRpcFanoutResult: {
      summary: {
        en: 'Per-receiver successful data and original failures from one actual endpoint fan-out.',
        zh: '一次实际端点扇出中每接收端的成功数据和原始失败。'
      },
      members: {
        fulfilled: {
          summary: {
            en: 'Actual successful fan-out results keyed by selected receiver or target identity.',
            zh: '按选中接收端或目标身份记录的实际成功扇出结果。'
          }
        },
        rejected: {
          summary: {
            en: 'Original failed fan-out errors keyed by selected receiver or target identity.',
            zh: '按选中接收端或目标身份记录的原始失败扇出错误。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcProviderLimits: {
      summary: {
        en: 'Shared original provider concurrency/replay limits with a local refusal observation callback.',
        zh: '原始共享提供方并发及重放限制，附本地拒绝观察回调。'
      },
      members: {
        maxGlobal: {
          summary: {
            en: 'Positive safe-integer maximum waiting and running provider executions across this endpoint.',
            zh: '端点全部等待及运行提供方执行的正安全整数上限。'
          },
          default: {
            en: '`256` concurrent provider leases.',
            zh: '默认最多 `256` 个提供方执行租约。'
          }
        },
        maxPerPeer: {
          summary: {
            en: 'Positive safe-integer maximum waiting and running executions for one verified direct peer.',
            zh: '单个已验证直接对端等待及运行执行的正安全整数上限。'
          },
          default: {
            en: '`64` provider leases per verified peer.',
            zh: '默认每个已验证对端最多 `64` 个租约。'
          }
        },
        maxReplayEntriesPerPeer: {
          summary: {
            en: 'Maximum completed inbound replay tombstones retained for each actual verified peer.',
            zh: '每个已验证对端最多保留多少条已完成入站请求标识，用于识别重复请求。'
          },
          default: {
            en: '`1024` completed entries per peer.',
            zh: '默认每个对端 `1024` 个完成条目。'
          }
        },
        onRejected: {
          summary: {
            en: 'Application callback receives actual IRpcProviderRejection before any provider runs; may return void or Promise<void>. Throw/rejection is reported through hooks without replacing OVERLOADED.',
            zh: '应用回调在提供方执行前接收实际准入拒绝，可返回空值或 Promise<void>；抛错或拒绝经钩子上报，不替换过载结果。'
          },
          default: {
            en: 'Absent: no additional local refusal observer.',
            zh: '默认不设置，不添加本地拒绝观察者。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcContext: {
      summary: {
        en: 'Provider-lifetime context created only after actual inbound identity and execution admission.',
        zh: '只在实际入站身份及执行准入之后创建的提供方生命周期上下文。'
      },
      members: {
        localEndpointId: {
          summary: {
            en: 'Serving endpoint identifier provided by the actual provider execution context.',
            zh: '实际提供方执行上下文给出的服务端点标识。'
          }
        },
        callerGeneration: {
          summary: {
            en: 'Optional caller generation from an actually admitted generation-aware directory task.',
            zh: '实际已准入世代目录任务提供的可选调用方世代。'
          }
        },
        targetGeneration: {
          summary: {
            en: 'Exact accepted provider execution/session generation, never a launch-attempt counter.',
            zh: '精确已接受提供方执行或会话世代，不是启动尝试计数。'
          }
        },
        data: {
          summary: {
            en: 'Application data provided by the actual request, event, schema or result owner.',
            zh: '实际请求、事件、结构或结果所有者提供的应用数据。'
          }
        },
        signal: {
          summary: {
            en: 'Provider-owned AbortSignal from the admitted execution scope; deadline, caller cancellation and endpoint disposal can retire this lifetime independently of outbound abort middleware.',
            zh: '已准入执行作用域提供的所属中止信号；截止、调用方取消及端点释放可结束此生命周期，不依赖出站中止中间件。'
          }
        },
        senderId: {
          summary: {
            en: 'Direct authenticated sender identifier provided by the actual admitted inbound binding.',
            zh: '实际已准入入站绑定提供的直接认证发送方标识。'
          }
        },
        route: {
          summary: {
            en: 'Optional ordered signed forwarding node identifiers; originating ordinary calls omit it.',
            zh: '可选有序签名转发节点标识，普通原发调用省略。'
          }
        },
        trace: {
          summary: {
            en: 'Optional caller-issued opaque diagnostic trace; downstream calls must pass it explicitly.',
            zh: '调用方提供的可选不透明诊断追踪，下游调用须显式传入。'
          },
          default: {
            en: 'Absent: no trace is attached.',
            zh: '默认不设置，不附加追踪值。'
          }
        },
        timeoutMs: {
          summary: {
            en: 'Remaining actual provider deadline derived from the original endpoint monotonic clock; absent without a deadline.',
            zh: '由原端点单调时钟得出的实际提供方剩余截止，无截止时省略。'
          }
        },
        success: {
          summary: {
            en: 'Constructs explicit successful completion while this provider lifetime is active.',
            zh: '提供方生命周期仍活动时构造显式成功完成结果。'
          },
          params: {
            data: {
              en: 'Optional application success data, omitted only when actually undefined.',
              zh: '可选应用成功数据，只有实际未定义才省略。'
            },
            options: {
              en: 'Optional explicit original transfer list for physical result ownership.',
              zh: '物理结果所有权使用的可选显式原转移列表。'
            }
          },
          returns: {
            en: 'IRpcProviderResult to return from the provider; after expiry returns a failure result carrying PROVIDER_CONTEXT_EXPIRED.',
            zh: '返回应从提供方返回的结果，过期后返回携带提供方上下文过期码的失败值。'
          },
          example: 'server.provide("echo", (context) => context.success(context.data))'
        },
        failed: {
          summary: {
            en: 'Constructs explicit application failure without replacing it with an internal exception.',
            zh: '构造显式应用失败，不把它替换为内部异常。'
          },
          params: {
            message: {
              en: 'Application-readable semantic failure description.',
              zh: '应用可读的语义失败说明。'
            },
            code: {
              en: 'Application-owned stable semantic failure code.',
              zh: '应用拥有的稳定语义失败错误码。'
            }
          },
          returns: {
            en: 'IRpcProviderResult to return; after lifetime expiry returns a failure result carrying PROVIDER_CONTEXT_EXPIRED.',
            zh: '返回应交出的提供方结果，生命周期过期返回携带上下文过期码的失败值。'
          },
          example: 'server.provide("load", (context) => context.failed("missing", "NOT_FOUND"))'
        },
        dispatchTo: {
          summary: {
            en: 'Issues a provider-scoped one-way dispatch using the original provider execution owner.',
            zh: '通过原提供方执行所有者发起提供方作用域单向派发。'
          },
          params: {
            input: {
              en: 'Application method/data and optional explicitly chosen target id; original execution controls validate its route.',
              zh: '应用方法、数据及可选显式目标标识，原执行控制校验路由。'
            }
          },
          returns: {
            en: 'Returns void after dispatch initiation; provider lifecycle and endpoint hooks contain later failures.',
            zh: '发起派发后返回空值，后续失败由提供方生命周期及端点钩子容纳。'
          },
          example: 'context.dispatchTo({ id: "observer", method: "changed", data: 1 })'
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcProviderRejection: {
      summary: {
        en: 'Actual local refused execution observation; one OVERLOADED code has distinct owned reasons.',
        zh: '实际本地拒绝执行观察，同一过载错误码对应不同所属原因。'
      },
      members: {
        verifiedPeerKey: {
          summary: {
            en: 'Opaque verified peer key issued by the actual admitted provider binding; never log its secret-bearing material.',
            zh: '实际已准入提供方绑定签发的不透明已验证对端键，不记录可能含秘密的材料。'
          }
        },
        controllerKey: {
          summary: {
            en: 'Original controller key assigned by the actual provider execution owner.',
            zh: '实际提供方执行所有者分配的原始控制器键。'
          }
        },
        method: {
          summary: {
            en: 'Application method name registered by the receiving endpoint provide or declared in the actual remote contract.',
            zh: '接收端提供方法登记或实际远端契约声明的应用方法名称。'
          }
        },
        reason: {
          summary: {
            en: 'Actual RpcProviderRejectionReason distinguishing capacity, replay and expired binding refusal.',
            zh: '区分容量、重放及绑定过期拒绝的实际提供方拒绝原因。'
          },
          values: {
            enum: 'RpcProviderRejectionReason'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcAuthenticationConfig: {
      summary: {
        en: 'Installs original per-frame protection, actual physical-session binding and replay checks; encryption runs before signing, verification before decryption.',
        zh: '安装原逐帧保护、实际物理会话绑定及重放检查，先加密再签名，先验证再解密。'
      },
      members: {
        encrypt: {
          summary: {
            en: 'Outbound sync/async encryption runs after the endpoint wraps its encoded value with replay metadata and before signing. Throw/rejection normally becomes AUTHENTICATION_FAILED with its cause.',
            zh: '出站同步或异步加密在端点为编码值包装重放元数据后、签名前执行；抛错或拒绝通常成为保留原因的认证失败。'
          },
          params: {
            value: {
              en: 'Replay-bound authentication envelope produced by the endpoint, including its encoded payload; not the bare application payload.',
              zh: '端点生成、绑定重放信息的认证消息封装，包含编码载荷，不是裸应用负载。'
            },
            context: {
              en: 'IRpcAuthenticationContext issued by the endpoint: direction is outbound/inbound, endpointId is its local identifier and platform is its configured IRpcPlatformValue.',
              zh: '端点签发的认证上下文：方向为出站或入站，端点标识来自本端，平台为已配置的 `IRpcPlatformValue`。'
            }
          },
          returns: {
            en: 'Encrypted value or its Promise, passed unchanged into sign.',
            zh: '返回加密值或其 Promise，原样传入签名阶段。'
          },
          default: {
            en: 'Leave encrypt and decrypt out together when messages need signatures but not encryption. In that case, sign receives the unencrypted authentication envelope: the message data together with the information used to detect replay. Omitting encryption does not remove signing or verification.',
            zh: '消息只需要签名、不需要加密时，应同时省略 encrypt 和 decrypt。此时 sign 直接接收未加密的认证数据封装，其中包含消息数据和用于识别重复发送的信息。省略加密不会省去签名与验证。'
          },
          whenToUse: {
            en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
            zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
          },
          example:
            "import type { IRpcAuthenticationConfig } from '@migaia/rpc-host'\n\nconst privateOrders: IRpcAuthenticationConfig = {\n  encrypt: (value) => encryptOrderMessage(value),\n  decrypt: (value) => decryptOrderMessage(value),\n  sign: (value) => signOrderMessage(value),\n  verify: (value) => verifyOrderMessage(value),\n  encodedType: 'string'\n}\n// Pass this configuration through the Host authentication option."
        },
        decrypt: {
          summary: {
            en: 'Inbound sync/async decryption runs on the value recovered by verify. The endpoint then validates the recovered authentication envelope and replay binding.',
            zh: '入站同步或异步解密处理验证阶段恢复的值；随后端点校验恢复的认证消息封装与重放绑定。'
          },
          params: {
            value: {
              en: 'Verified protected value returned by verify.',
              zh: '验证阶段返回的已验证受保护值。'
            },
            context: {
              en: 'IRpcAuthenticationContext issued by the endpoint: direction is outbound/inbound, endpointId is its local identifier and platform is its configured IRpcPlatformValue.',
              zh: '端点签发的认证上下文：方向为出站或入站，端点标识来自本端，平台为已配置的 `IRpcPlatformValue`。'
            }
          },
          returns: {
            en: 'Recovered replay-bound authentication envelope or its Promise; throw/rejection normally becomes AUTHENTICATION_FAILED with the original cause.',
            zh: '返回恢复的重放绑定认证消息封装或其 Promise；抛错或拒绝通常成为保留原始原因的认证失败。'
          },
          default: {
            en: 'Omit decrypt only when encrypt is also omitted. After verify checks the signature and recovers the inner value, the endpoint directly checks that value as the authentication envelope, including its replay information. It does not try to decrypt the value.',
            zh: '只有同时省略 encrypt 时，才可以省略 decrypt。verify 验证签名并恢复内部值后，端点会直接检查该值是否符合认证数据封装格式，并检查用于识别重复发送的信息，不再进行解密。'
          },
          whenToUse: {
            en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
            zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
          },
          example:
            "import type { IRpcAuthenticationConfig } from '@migaia/rpc-host'\n\nconst privateOrders: IRpcAuthenticationConfig = {\n  encrypt: (value) => encryptOrderMessage(value),\n  decrypt: (value) => decryptOrderMessage(value),\n  sign: (value) => signOrderMessage(value),\n  verify: (value) => verifyOrderMessage(value),\n  encodedType: 'string'\n}\n// Pass this configuration through the Host authentication option."
        },
        sign: {
          summary: {
            en: 'Outbound sync/async signing runs after optional encryption and returns the complete protected frame representation. Signing and verification are required even without encryption.',
            zh: '出站同步或异步签名在可选加密后执行，返回完整受保护帧表示；即使不加密，也必须配置签名与验证。'
          },
          params: {
            value: {
              en: 'Encrypted value when encrypt exists, otherwise the replay-bound authentication envelope.',
              zh: '存在加密阶段时接收加密值，否则接收重放绑定认证消息封装。'
            },
            context: {
              en: 'IRpcAuthenticationContext issued by the endpoint: direction is outbound/inbound, endpointId is its local identifier and platform is its configured IRpcPlatformValue.',
              zh: '端点签发的认证上下文：方向为出站或入站，端点标识来自本端，平台为已配置的 `IRpcPlatformValue`。'
            }
          },
          returns: {
            en: 'Signed representation or its Promise; throw/rejection normally becomes AUTHENTICATION_FAILED. Keep the declared encodedType output domain.',
            zh: '返回签名表示或其 Promise；抛错或拒绝通常成为认证失败，输出须符合声明的编码值域。'
          },
          default: {
            en: 'There is no default signing function. Provide sign together with verify whenever authentication is enabled. This remains required when encrypt and decrypt are configured: encryption alone is insufficient, and omitting sign rejects the configuration.',
            zh: '没有默认签名函数。启用认证时，必须同时提供 sign 和 verify。即使已经配置 encrypt 和 decrypt，也仍然需要签名；只加密而省略 sign 会使配置被拒绝。'
          },
          whenToUse: {
            en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
            zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
          },
          example:
            "import type { IRpcAuthenticationConfig } from '@migaia/rpc-host'\n\nconst signedMessages: IRpcAuthenticationConfig = {\n  sign: (value) => signCheckoutMessage(value),\n  verify: (value) => verifyCheckoutMessage(value),\n  encodedType: 'string'\n}\n// Pass this configuration through the Host authentication option."
        },
        verify: {
          summary: {
            en: 'Inbound sync/async verification receives the protected frame and must recover its authenticated inner value; returning a boolean is not a verification verdict protocol.',
            zh: '入站同步或异步验证接收受保护帧，必须恢复其经过认证的内部值；布尔返回值不是验证结论协议。'
          },
          params: {
            value: {
              en: 'Protected value received at the authentication pipeline edge.',
              zh: '从认证管线边界接收到的受保护值。'
            },
            context: {
              en: 'IRpcAuthenticationContext issued by the endpoint: direction is outbound/inbound, endpointId is its local identifier and platform is its configured IRpcPlatformValue.',
              zh: '端点签发的认证上下文：方向为出站或入站，端点标识来自本端，平台为已配置的 `IRpcPlatformValue`。'
            }
          },
          returns: {
            en: 'Authenticated inner value or its Promise, passed to decrypt when configured; reject or throw on invalid signatures. Local reporting retains the original verification failure, which may be sensitive; the peer receives a sanitized summary. Other returned values still undergo envelope/replay validation.',
            zh: '返回认证内部值或其 Promise，配置了解密时传给解密；签名非法时应拒绝或抛错，本地报告保留可能敏感的原校验失败，对端只接收净化摘要，其它返回值仍需通过消息封装及重放校验。'
          },
          default: {
            en: 'There is no default verification function. Provide verify together with sign so incoming protected messages can be checked and their inner values recovered. If sign is supplied without verify, construction rejects the configuration before the endpoint becomes active.',
            zh: '没有默认验证函数。必须把 verify 与 sign 配套提供，才能检查收到的受保护消息并恢复其内部值。提供 sign 却缺少 verify 时，构造会在端点启用前拒绝配置。'
          },
          whenToUse: {
            en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
            zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
          },
          example:
            "import type { IRpcAuthenticationConfig } from '@migaia/rpc-host'\n\nconst signedMessages: IRpcAuthenticationConfig = {\n  sign: (value) => signCheckoutMessage(value),\n  verify: (value) => verifyCheckoutMessage(value),\n  encodedType: 'string'\n}\n// Pass this configuration through the Host authentication option."
        },
        encodedType: {
          summary: {
            en: 'Declared protected-output domain must match the next physical pipeline edge. Encrypt/decrypt and sign/verify are complete pairs, at least signing is required, and encryption additionally requires signing.',
            zh: '声明的受保护输出域须匹配后续物理管线边界；加解密与签名验证各自须完整，至少配置签名，加密还必须有签名。'
          },
          default: {
            en: 'any: do not impose a declared protected-output value category.',
            zh: '`any`：不声明额外受保护输出值类别。'
          },
          values: {
            any: {
              en: 'Leave the declared output domain unconstrained; transforms may still change representation.',
              zh: '不限制声明输出值域，转换仍可改变表示。'
            },
            string: {
              en: 'Declare that the protected output is text for the subsequent pipeline edge.',
              zh: '声明受保护输出为文本，供后续管线边界使用。'
            },
            uint8array: {
              en: 'Declare that the protected output is a byte array for the subsequent pipeline edge.',
              zh: '声明受保护输出为字节数组，供后续管线边界使用。'
            }
          },
          whenToUse: {
            en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
            zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
          },
          example:
            "import type { IRpcAuthenticationConfig } from '@migaia/rpc-host'\n\nconst signedMessages: IRpcAuthenticationConfig = {\n  sign: (value) => signCheckoutMessage(value),\n  verify: (value) => verifyCheckoutMessage(value),\n  encodedType: 'string'\n}\n// Pass this configuration through the Host authentication option."
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      optionCases: [
        {
          title: {
            en: 'Verify signed checkout messages',
            zh: '验证结算消息签名'
          },
          problem: {
            en: 'Checkout messages need integrity protection. Supply the application’s signing and verification functions on both ends. They must encode and recover the complete value supplied by Core; encodedType describes the protected representation.',
            zh: '结算消息需要完整性保护。在两端配置应用的签名与验证函数；它们必须编码并恢复 Core 交给它们的完整值，encodedType 声明保护后的表示形式。'
          },
          example:
            "import type { IRpcAuthenticationConfig } from '@migaia/rpc-host'\n\nconst signedMessages: IRpcAuthenticationConfig = {\n  sign: (value) => signCheckoutMessage(value),\n  verify: (value) => verifyCheckoutMessage(value),\n  encodedType: 'string'\n}\n// Pass this configuration through the Host authentication option.",
          result: {
            en: 'Both endpoints authenticate signed messages before business handlers receive them.',
            zh: '两端会先验证消息签名，再将消息交给业务处理函数。'
          },
          covers: ['sign', 'verify', 'encodedType']
        },
        {
          title: {
            en: 'Protect private order contents',
            zh: '保护订单的私密内容'
          },
          problem: {
            en: 'Order payloads also contain private details. Add the application’s encryption pair to the same signed pipeline: outbound values are encrypted then signed, and inbound values are verified then decrypted.',
            zh: '订单载荷还包含私密信息。给同一签名管线加上应用的加解密函数；出站先加密再签名，入站先验证再解密。'
          },
          example:
            "import type { IRpcAuthenticationConfig } from '@migaia/rpc-host'\n\nconst privateOrders: IRpcAuthenticationConfig = {\n  encrypt: (value) => encryptOrderMessage(value),\n  decrypt: (value) => decryptOrderMessage(value),\n  sign: (value) => signOrderMessage(value),\n  verify: (value) => verifyOrderMessage(value),\n  encodedType: 'string'\n}\n// Pass this configuration through the Host authentication option.",
          result: {
            en: 'Order values cross the carrier in the application’s protected representation.',
            zh: '订单值以应用约定的受保护表示经过载体。'
          },
          covers: ['encrypt', 'decrypt']
        }
      ]
    },
    IRpcAuthenticationContext: {
      summary: {
        en: 'Actual transform context is supplied by the installed authentication owner at its physical frame boundary.',
        zh: '已安装认证所有者在物理帧边界提供的实际转换上下文。'
      },
      members: {
        direction: {
          summary: {
            en: 'Actual direction of this transform invocation.',
            zh: '本次转换调用的实际处理方向。'
          },
          values: {
            outbound: {
              en: 'Protecting a frame before actual sending.',
              zh: '实际发送之前正在保护物理帧。'
            },
            inbound: {
              en: 'Unprotecting a received physical frame.',
              zh: '正在解除已接收物理帧的保护。'
            }
          }
        },
        endpointId: {
          summary: {
            en: 'Actual configured endpoint identifier supplied by the constructing owner.',
            zh: '构造所有者提供的实际配置端点标识。'
          }
        },
        platform: {
          summary: {
            en: 'Actual adapter platform supplied by the constructing owner.',
            zh: '构造所有者提供的实际适配器平台。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcAuthenticationCapability: {
      summary: {
        en: 'Original installed frame-protection operations own actual authentication mode and encoded carrier requirements.',
        zh: '原已安装帧保护操作拥有实际认证模式及编码传输对象要求。'
      },
      members: {
        mode: {
          summary: {
            en: 'Actual original protection mode reported to probe descriptors.',
            zh: '报告给探针描述的实际原保护模式。'
          },
          values: {
            none: {
              en: 'No signing or encryption middleware is installed.',
              zh: '未安装签名或加密中间件。'
            },
            sign: {
              en: 'Signing and verification protect actual frames.',
              zh: '签名及验证保护实际物理帧。'
            },
            'encrypt-sign': {
              en: 'Encryption and signing protect actual frames together.',
              zh: '加密及签名共同保护实际物理帧。'
            }
          }
        },
        enabled: {
          summary: {
            en: 'Literal true marks configured cancellation support.',
            zh: '真字面值标记已经配置的取消支持。'
          },
          values: {
            true: {
              en: 'Cancellation support is installed by the original owner.',
              zh: '原所有者已经安装取消支持。'
            }
          }
        },
        encodedType: {
          summary: {
            en: 'Declared protected-output domain must match the next physical pipeline edge. Encrypt/decrypt and sign/verify are complete pairs, at least signing is required, and encryption additionally requires signing.',
            zh: '声明的受保护输出域须匹配后续物理管线边界；加解密与签名验证各自须完整，至少配置签名，加密还必须有签名。'
          },
          default: {
            en: 'any: do not impose a declared protected-output value category.',
            zh: '`any`：不声明额外受保护输出值类别。'
          },
          values: {
            any: {
              en: 'Leave the declared output domain unconstrained; transforms may still change representation.',
              zh: '不限制声明输出值域，转换仍可改变表示。'
            },
            string: {
              en: 'Declare that the protected output is text for the subsequent pipeline edge.',
              zh: '声明受保护输出为文本，供后续管线边界使用。'
            },
            uint8array: {
              en: 'Declare that the protected output is a byte array for the subsequent pipeline edge.',
              zh: '声明受保护输出为字节数组，供后续管线边界使用。'
            }
          }
        },
        protect: {
          summary: {
            en: 'Original transform receives value and authentication context, returns protected value or Promise; failures retain AUTHENTICATION_FAILED semantics.',
            zh: '原转换接收值及认证上下文，返回保护值或 Promise，失败保留认证失败语义。'
          }
        },
        unprotect: {
          summary: {
            en: 'Original transform receives physical protected value and context, returns verified unprotected value or Promise.',
            zh: '原转换接收物理保护值及上下文，返回已验证解除保护值或 Promise。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcIdempotencyOutcome: {
      summary: {
        en: 'Portable successful or failed provider outcome retained by the actual store; a later request may replay it without executing business again.',
        zh: '实际存储保留的可移植提供方成功或失败结果，后续请求可重放而不再次执行业务。'
      },
      members: {
        ok: {
          summary: {
            en: 'True retains successful data; false retains public failure presentation.',
            zh: '真值保留成功数据，`false`保留公开失败展示。'
          },
          values: {
            true: {
              en: 'Business completed successfully and data may be replayed.',
              zh: '业务已经成功完成，可以重放数据。'
            },
            false: {
              en: 'Business completed with a retained public failure.',
              zh: '业务以已保留公开失败结束。'
            }
          }
        },
        data: {
          summary: {
            en: 'Original portable business payload or public failure detail.',
            zh: '原可移植业务载荷或公开失败细节。'
          }
        },
        code: {
          summary: {
            en: 'Original provider-issued public failure code on unsuccessful outcomes.',
            zh: '失败结果中原提供方签发的公开失败码。'
          }
        },
        message: {
          summary: {
            en: 'Original public failure presentation retained for replay.',
            zh: '为重放保留的原公开失败展示信息。'
          }
        },
        error: {
          summary: {
            en: 'Optional rpc-contract IRpcSerializedError preserving the original failure chain.',
            zh: '保留原始失败链的可选契约序列化错误。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import { createRpcIdempotencyStore } from '@migaia/rpc-host'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-v1')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))"
    },
    IRpcIdempotencyClaim: {
      summary: {
        en: 'One store claim owns execution, waits on original work, replays retained outcome, or refuses capacity; each status has a distinct available surface.',
        zh: '一次存储认领可以拥有执行、等待原工作、重放保留结果或拒绝容量，每个状态有不同可用接口。'
      },
      members: {
        status: {
          summary: {
            en: 'Discriminates claimed, pending, done and full branches; narrow before using branch-specific methods.',
            zh: '区分已认领、等待、完成及容量满分支，使用分支方法前须缩窄。'
          },
          values: {
            claimed: {
              en: 'This exact claim owns the first business execution.',
              zh: '此精确认领拥有首次业务执行。'
            },
            pending: {
              en: 'Original business is still running; await its existing outcome.',
              zh: '原业务仍运行，等待其现有结果。'
            },
            done: {
              en: 'Original business already settled; replay or report unavailable body.',
              zh: '原业务已结算，应重放或报告结果体不可用。'
            },
            full: {
              en: 'No execution reservation was admitted at the current quota.',
              zh: '当前配额没有准入任何执行预留。'
            }
          }
        },
        settle: {
          summary: {
            en: 'On a claimed branch, settles once with the original portable business outcome and starts retention at the supplied time.',
            zh: '在已认领分支中用原可移植业务结果结算一次，并从给定时间开始保留。'
          },
          params: {
            outcome: {
              en: 'Actual IRpcIdempotencyOutcome returned by the original business execution.',
              zh: '原业务执行返回的实际幂等结果。'
            },
            now: {
              en: 'Current monotonic milliseconds from the same clock used for claim.',
              zh: '来自认领相同时钟的当前单调毫秒。'
            }
          },
          returns: {
            en: 'Original waiters receive the result or unavailable marker; stale settlement does not reacquire ownership.',
            zh: '原等待者收到结果或不可用标记，过期结算不能重新取得所有权。'
          },
          example:
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-v1')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))"
        },
        release: {
          summary: {
            en: 'On a claimed branch, abandons the original unexecuted reservation and wakes waiters without an outcome.',
            zh: '在已认领分支中放弃原未执行预留，并唤醒等待者而不提供结果。'
          },
          params: {},
          returns: {
            en: 'The original reservation is removed; this is not a retry of already executed business.',
            zh: '原预留被移除，这不是重试已经执行的业务。'
          },
          example:
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-v1')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))"
        },
        outcome: {
          summary: {
            en: 'Pending returns the original completion Promise; done contains retained outcome or unavailable when its body was evicted.',
            zh: '等待分支返回原完成 Promise，完成分支包含保留结果或结果体被淘汰时的不可用标记。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import { createRpcIdempotencyStore } from '@migaia/rpc-host'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-v1')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))"
    },
    IRpcIdempotencyStore: {
      summary: {
        en: 'Injectable original execution/outcome owner; scope and key admission must follow actual verified connection identity rather than caller labels.',
        zh: '可注入原执行及结果所有者，作用域及键准入须遵循实际已验证连接身份，不取调用方标签。'
      },
      members: {
        claim: {
          summary: {
            en: 'Reserves the original scope/key once, observes matching pending work or returns retained completion; incompatible fingerprints fail CONTRACT_INVALID.',
            zh: '对原作用域及键预留一次、观察匹配等待工作或返回保留完成，不兼容指纹以契约非法失败。'
          },
          params: {
            scope: {
              en: 'Actual verified session scope issued by the admission owner, or an explicit application-issued isolated scope for direct use.',
              zh: '实际已验证会话准入所有者签发的作用域，直接使用时由应用提供隔离作用域。'
            },
            key: {
              en: 'Stable application-issued operation key reused only for the same intended execution.',
              zh: '应用提供的稳定操作键，只为相同预期执行复用。'
            },
            now: {
              en: 'Finite monotonic milliseconds supplied by the original caller clock.',
              zh: '原调用方时钟提供的有限单调毫秒。'
            },
            fingerprint: {
              en: 'Optional canonical operation fingerprint issued by the original admitted operation owner.',
              zh: '原已准入操作所有者签发的可选规范操作指纹。'
            }
          },
          returns: {
            en: 'IRpcIdempotencyClaim; capacity refusal does not execute business.',
            zh: '返回幂等认领，容量拒绝不会执行业务。'
          },
          example:
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-v1')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))"
        },
        lookup: {
          summary: {
            en: 'Optional outcome-only lookup neither allocates execution nor refreshes retention or quota.',
            zh: '可选仅结果查询不分配执行、不刷新保留期及配额。'
          },
          params: {
            scope: {
              en: 'Same actual session scope originally issued to claim.',
              zh: '原认领取得的同一实际会话作用域。'
            },
            key: {
              en: 'Same application-issued operation key passed to claim.',
              zh: '原认领传入的相同应用操作键。'
            },
            now: {
              en: 'Current monotonic milliseconds from the original claim clock.',
              zh: '来自原认领时钟的当前单调毫秒。'
            }
          },
          returns: {
            en: 'State pending, unknown, or done with the retained portable outcome; a legacy store lacking lookup cannot advertise outcome support.',
            zh: '返回等待、未知或含保留可移植结果的完成状态，没有查询的旧存储不能声明结果查询支持。'
          },
          example:
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-v1')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))"
        },
        readRuntimeFacts: {
          summary: {
            en: 'Optional operation reports facts of this exact store incarnation; ordinary claims never create/read a store epoch.',
            zh: '可选操作报告此精确存储实例事实，普通认领不创建或读取存储纪元。'
          },
          params: {},
          returns: {
            en: 'rpc-contract IRpcRuntimeStore facts; the built-in memory owner lazily issues an epoch and reports retained continuity.',
            zh: '返回契约运行存储事实，内置内存所有者延迟签发纪元并报告保留连续性。'
          },
          example:
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-v1')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))"
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import { createRpcIdempotencyStore } from '@migaia/rpc-host'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-v1')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))"
    },
    IRpcIdempotencyConfig: {
      summary: {
        en: 'Provider replay policy reuses a real store and derives scopes only after verified admission.',
        zh: '提供方重放策略复用真实存储，并只在已验证准入后派生作用域。'
      },
      members: {
        store: {
          summary: {
            en: 'Optional caller-held IRpcIdempotencyStore shared only across actual intended sessions.',
            zh: '调用方可选持有的幂等存储，只跨实际预期会话共享。'
          },
          default: {
            en: 'Absent: use the original endpoint-local store.',
            zh: '默认使用原端点本地存储。'
          }
        },
        scope: {
          summary: {
            en: 'Synchronous application callback receives actual admitted token and senderId, returns a stable scope string; it must not treat arbitrary wire claims as identity.',
            zh: '应用同步回调接收实际已准入令牌及发送标识，返回稳定作用域字符串，不能把任意线上声明视为身份。'
          },
          default: {
            en: 'Absent: canonical admitted-session scope is used.',
            zh: '默认使用规范已准入会话作用域。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import { createRpcIdempotencyStore } from '@migaia/rpc-host'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-v1')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))"
    },
    IRpcCleanupError: {
      summary: {
        en: 'One original resource cleanup failure kept alongside the primary construction/lifecycle failure.',
        zh: '与主要构造或生命周期失败一起保留的一个原资源清理失败。'
      },
      members: {
        resource: {
          summary: {
            en: 'Owner-issued resource label captured when the cleanup was registered.',
            zh: '清理登记时所有者签发的资源标签。'
          }
        },
        error: {
          summary: {
            en: 'Exact original cleanup failure, preserving its reference and cause chain.',
            zh: '保留引用及原因链的精确原清理失败。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcError: {
      summary: {
        en: 'Structural public error diagnostics; this type does not prove local execution/control ownership.',
        zh: '结构公开错误诊断，此类型不证明本地执行或控制所有权。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcCoreErrorCode: {
      summary: {
        en: 'One stable semantic value from RpcCoreErrorCode; source and code together identify its owning contract.',
        zh: '稳定语义失败码中的一个值，来源及错误码共同标识所属契约。'
      },
      members: {},
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    RpcError: {
      summary: {
        en: 'Public diagnostic RpcError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        cleanupErrors: {
          summary: {
            en: 'Original cleanup resource labels and exact failures without replacing the primary error.',
            zh: '原清理资源标签及精确失败，不替换主要错误。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    RpcSchemaValidationError: {
      summary: {
        en: 'Public diagnostic RpcSchemaValidationError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        cleanupErrors: {
          summary: {
            en: 'Original cleanup resource labels and exact failures without replacing the primary error.',
            zh: '原清理资源标签及精确失败，不替换主要错误。'
          }
        },
        data: {
          summary: {
            en: 'Original public validation or remote failure detail.',
            zh: '原公开校验或远端失败细节。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    RpcConfigurationError: {
      summary: {
        en: 'Public diagnostic RpcConfigurationError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        cleanupErrors: {
          summary: {
            en: 'Original cleanup resource labels and exact failures without replacing the primary error.',
            zh: '原清理资源标签及精确失败，不替换主要错误。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    RpcConstructionError: {
      summary: {
        en: 'Public diagnostic RpcConstructionError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        cleanupErrors: {
          summary: {
            en: 'Original cleanup resource labels and exact failures without replacing the primary error.',
            zh: '原清理资源标签及精确失败，不替换主要错误。'
          }
        },
        cleanupPromise: {
          summary: {
            en: 'Original asynchronous cleanup observation; an early primary rejection may precede its final cleanup evidence.',
            zh: '原异步清理观察，较早主要拒绝可能先于最终清理证据。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    RpcLifecycleError: {
      summary: {
        en: 'Public diagnostic RpcLifecycleError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        cleanupErrors: {
          summary: {
            en: 'Original cleanup resource labels and exact failures without replacing the primary error.',
            zh: '原清理资源标签及精确失败，不替换主要错误。'
          }
        },
        errors: {
          summary: {
            en: 'Optional standard error graph retains every original cleanup failure in this batch; inspect it together with cause.',
            zh: '可选标准错误图保留本批每项原清理失败，须结合原因链检查。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    RpcSerializationError: {
      summary: {
        en: 'Public diagnostic RpcSerializationError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        cleanupErrors: {
          summary: {
            en: 'Original cleanup resource labels and exact failures without replacing the primary error.',
            zh: '原清理资源标签及精确失败，不替换主要错误。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    RpcProtocolError: {
      summary: {
        en: 'Public diagnostic RpcProtocolError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        cleanupErrors: {
          summary: {
            en: 'Original cleanup resource labels and exact failures without replacing the primary error.',
            zh: '原清理资源标签及精确失败，不替换主要错误。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    RpcContractError: {
      summary: {
        en: 'Public diagnostic RpcContractError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        cleanupErrors: {
          summary: {
            en: 'Original cleanup resource labels and exact failures without replacing the primary error.',
            zh: '原清理资源标签及精确失败，不替换主要错误。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    RpcTransportError: {
      summary: {
        en: 'Public diagnostic RpcTransportError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        cleanupErrors: {
          summary: {
            en: 'Original cleanup resource labels and exact failures without replacing the primary error.',
            zh: '原清理资源标签及精确失败，不替换主要错误。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    RpcAuthenticationError: {
      summary: {
        en: 'Public diagnostic RpcAuthenticationError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        cleanupErrors: {
          summary: {
            en: 'Original cleanup resource labels and exact failures without replacing the primary error.',
            zh: '原清理资源标签及精确失败，不替换主要错误。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    RpcChunkError: {
      summary: {
        en: 'Public diagnostic RpcChunkError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        cleanupErrors: {
          summary: {
            en: 'Original cleanup resource labels and exact failures without replacing the primary error.',
            zh: '原清理资源标签及精确失败，不替换主要错误。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    RpcRemoteError: {
      summary: {
        en: 'Public diagnostic RpcRemoteError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Peer-selected remote code remains an unrestricted string and never grants local control rights.',
            zh: '对端选择的远端码仍为不受限字符串，不赋予本地控制权限。'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        data: {
          summary: {
            en: 'Original public validation or remote failure detail.',
            zh: '原公开校验或远端失败细节。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    RpcAbortError: {
      summary: {
        en: 'Public diagnostic RpcAbortError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        cleanupErrors: {
          summary: {
            en: 'Original cleanup resource labels and exact failures without replacing the primary error.',
            zh: '原清理资源标签及精确失败，不替换主要错误。'
          }
        },
        cleanupPromise: {
          summary: {
            en: 'Original asynchronous cleanup observation; an early primary rejection may precede its final cleanup evidence.',
            zh: '原异步清理观察，较早主要拒绝可能先于最终清理证据。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    RpcTimeoutError: {
      summary: {
        en: 'Public diagnostic RpcTimeoutError type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
        zh: '公开诊断错误类型保留原生错误名称、消息、堆栈及原始原因，本入口只有生命周期错误类作为运行时类导出。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable source identifying the owner that originally created this error.',
            zh: '标识原创建此错误所有者的稳定来源。'
          }
        },
        code: {
          summary: {
            en: 'Original semantic code identifying the actual failure branch.',
            zh: '标识实际失败分支的原语义码。'
          },
          values: {
            enum: 'RpcCoreErrorCode'
          }
        },
        cause: {
          summary: {
            en: 'Exact original failure preserved on the cause chain when supplied.',
            zh: '提供时在原因链保留的精确原始失败。'
          }
        },
        cleanupErrors: {
          summary: {
            en: 'Original cleanup resource labels and exact failures without replacing the primary error.',
            zh: '原清理资源标签及精确失败，不替换主要错误。'
          }
        },
        cleanupPromise: {
          summary: {
            en: 'Original asynchronous cleanup observation; an early primary rejection may precede its final cleanup evidence.',
            zh: '原异步清理观察，较早主要拒绝可能先于最终清理证据。'
          }
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
    },
    IRpcPlatformValue: {
      summary: {
        en: 'One actual adapter platform label used for presentation and diagnostics.',
        zh: '用于展示及诊断的一个实际适配器平台标签。'
      },
      members: {},
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcTransportTopologyValue: {
      summary: {
        en: 'One physical topology from RpcTransportTopology, without implied provenance.',
        zh: '规范传输对象拓扑中的一个物理拓扑，不隐含来源身份。'
      },
      members: {},
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcTransportEncodingValue: {
      summary: {
        en: 'One actual accepted carrier encoding domain from RpcTransportEncoding.',
        zh: '规范传输对象编码中的一个实际接受值域。'
      },
      members: {},
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcTransportOwnershipValue: {
      summary: {
        en: 'One physical cleanup responsibility from RpcTransportOwnership.',
        zh: '规范传输对象所有权中的一个物理清理责任值。'
      },
      members: {},
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcOperation: {
      summary: {
        en: 'One original send, dispatch or ping operation category.',
        zh: '原发送、派发或心跳操作类别之一。'
      },
      members: {},
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcCandidateStatus: {
      summary: {
        en: 'Actual discovery candidate activity classification, not a thrown error code.',
        zh: '实际发现候选活动分类，不是抛出错误码。'
      },
      members: {},
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },

    IRpcProbeDefinition: {
      summary: {
        en: 'Application definition captured and compiled once; the original callbacks do not become mutable host configuration.',
        zh: '一次捕获及编译的应用定义，原回调不会变成可变宿主配置。'
      },
      members: {
        stages: {
          summary: {
            en: 'Application-selected nonempty stage-name array from RpcProbeStageName; duplicates compile to one bit.',
            zh: '应用从规范阶段名称表选择的非空数组，重复名称编译为同一位。'
          }
        },
        capture: {
          summary: {
            en: 'Application-selected subset of initial stages whose content may be captured after redaction; later setStages cannot enlarge this immutable permission.',
            zh: '应用选择的初始阶段子集，允许脱敏后捕获内容，后续修改阶段不能扩大此不可变权限。'
          },
          default: {
            en: 'Absent: no content capture.',
            zh: '默认不捕获内容。'
          }
        },
        methods: {
          summary: {
            en: 'Application method-name filter for method-bearing logical/envelope observations; methodless controls remain visible.',
            zh: '应用方法名过滤器作用于含方法的逻辑及消息封装观察，无方法控制仍可见。'
          },
          default: {
            en: 'Absent: all methods remain eligible.',
            zh: '默认所有方法均可被观察。'
          }
        },
        sample: {
          summary: {
            en: 'Application probability strictly greater than zero and at most one; deterministic sender/message correlation selects matching events.',
            zh: '应用采样概率须大于零且不大于一，确定性发送及消息关联选择匹配事件。'
          },
          default: {
            en: '1: retain every eligible event.',
            zh: '默认一，保留所有符合条件的事件。'
          }
        },
        redact: {
          summary: {
            en: 'Synchronous application transform receives numeric stage and original content; return only the redacted value safe to expose. A throw is sent to onError and contained.',
            zh: '应用同步转换接收数字阶段及原内容，只返回可以公开的脱敏值；抛错交错误观察并被隔离。'
          },
          params: {
            stage: {
              en: 'Actual RpcProbeStage ordinal supplied by the emitter.',
              zh: '发射器提供的实际阶段序号。'
            },
            content: {
              en: 'Original owner value before exposure; never mutate or retain it without ownership.',
              zh: '公开之前的原所有者值，未拥有时不得修改或保留。'
            }
          },
          returns: {
            en: 'The synchronous redacted capture value; no Promise is awaited.',
            zh: '返回同步脱敏捕获值，不等待 Promise。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          default: {
            en: 'Absent: selected captures expose the original content reference.',
            zh: '默认选定捕获公开原内容引用。'
          }
        },
        describe: {
          summary: {
            en: 'Receives the cold actual endpoint capability descriptor at installation; synchronous observer throws are contained through onError.',
            zh: '安装时接收实际端点能力冷描述，同步观察者抛错经错误观察隔离。'
          },
          params: {
            descriptor: {
              en: 'Actual owner descriptor; unsupported stages cannot be created by subscription.',
              zh: '实际所有者描述，订阅不能创建不受支持阶段。'
            }
          },
          returns: {
            en: 'Descriptor notification completes synchronously; no return is consumed.',
            zh: '同步完成描述通知，不消费返回值。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          default: {
            en: 'Absent: no descriptor callback.',
            zh: '默认没有描述回调。'
          }
        },
        emit: {
          summary: {
            en: 'Receives a reused mutable view valid only during this synchronous callback; snapshot before retaining. Throws are isolated through onError.',
            zh: '接收只在本次同步回调期间有效的复用可变视图，保留前须快照；抛错经错误观察隔离。'
          },
          params: {
            view: {
              en: 'Emitter-owned IRpcProbeEventView with current event fields.',
              zh: '发射器拥有并填入当前事件字段的观察视图。'
            }
          },
          returns: {
            en: 'Observation completes synchronously; returned thenable rejections are observed, but a retained view still needs a synchronous snapshot.',
            zh: '同步完成观察，返回类 Promise 对象的拒绝仍被观察，但保留视图仍须同步快照。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        onError: {
          summary: {
            en: 'Receives a coded PROBE_FAILED wrapper retaining the original callback failure as cause; a secondary throw is forwarded to hostRethrowReporter without changing business settlement.',
            zh: '接收带探针失败码的包装错误并在原因中保留原回调失败，次级抛错交宿主规范上报，不改变业务结算。'
          },
          params: {
            error: {
              en: 'Core PROBE_FAILED error whose cause is the original observer failure.',
              zh: '核心探针失败错误，其原因保留原观察者失败。'
            }
          },
          returns: {
            en: 'Completes diagnostic handling without a business result.',
            zh: '完成诊断处理，不产生业务结果。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          default: {
            en: 'Absent: canonical host reporting receives observer failures.',
            zh: '默认由规范宿主上报处理观察失败。'
          }
        }
      },
      scenarios: [
        {
          en: 'Observe the existing owner without changing its business settlement or resource lifetime.',
          zh: '观察现有所有者，不改变业务结算或资源生命周期。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcProbe: {
      summary: {
        en: 'Frozen genuine compiled handle created by defineProbe; setStages changes private active subscription state without mutating capture permission.',
        zh: '由定义工厂创建的冻结真实编译句柄，阶段更新只改变私有活动订阅状态，不改变捕获权限。'
      },
      members: {
        stageMask: {
          summary: {
            en: 'Current compiled subscription mask on standalone handles; attached frozen hosts retain their initial data field. Use readProbeStages for either form.',
            zh: '独立句柄显示当前编译订阅掩码，附加冻结宿主保留初始数据字段，两种形式均可用读取函数取得当前值。'
          }
        },
        captureMask: {
          summary: {
            en: 'Immutable content-capture permission compiled at definition time.',
            zh: '定义时编译的不可变内容捕获权限。'
          }
        },
        methods: {
          summary: {
            en: 'Captured readonly method filter Set or undefined when unfiltered.',
            zh: '捕获的只读方法过滤集合，未过滤时没有值。'
          }
        },
        sampleThreshold: {
          summary: {
            en: 'Unsigned correlation threshold; 0xffffffff selects every eligible event.',
            zh: '无符号关联阈值，最大无符号整数选择全部合格事件。'
          }
        },
        setStages: {
          summary: {
            en: 'Atomically replaces active stage bits; an empty array pauses observation. Invalid names throw INVALID_CONFIG and retain the previous mask.',
            zh: '原子替换活动阶段位，空数组暂停观察，非法名称抛配置非法错误并保留原掩码。'
          },
          params: {
            stages: {
              en: 'Application array of names from RpcProbeStageName; empty is allowed for updates.',
              zh: '应用提供规范阶段名称数组，更新时允许为空。'
            }
          },
          returns: {
            en: 'All changed subscriptions are notified synchronously even if one throws, so emitters adopt the committed mask. Callback failures gain CALLBACK_FAILED unless already classified; unchanged masks send no notification.',
            zh: '同步通知全部改变的订阅，某项抛错不阻断其它项采用已提交掩码；未分类回调失败附加 `CALLBACK_FAILED`，掩码不变时不通知。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        }
      },
      scenarios: [
        {
          en: 'Observe the existing owner without changing its business settlement or resource lifetime.',
          zh: '观察现有所有者，不改变业务结算或资源生命周期。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcProbeDescriptor: {
      summary: {
        en: 'Cold description of the actual installed endpoint; subscriptions never manufacture unavailable capabilities.',
        zh: '实际已安装端点的冷描述，订阅不会制造不可用能力。'
      },
      members: {
        endpointId: {
          summary: {
            en: 'Identifier issued by the endpoint configuration whose emitter created this descriptor.',
            zh: '创建此描述的发射器所属端点配置签发的标识。'
          }
        },
        platform: {
          summary: {
            en: 'Actual adapter platform label; presentation alone grants no authority.',
            zh: '实际适配器平台标签，展示信息不赋予权限。'
          }
        },
        topology: {
          summary: {
            en: 'Actual transport topology when the adapter supplies it.',
            zh: '适配器提供时的实际传输对象拓扑。'
          }
        },
        encodedType: {
          summary: {
            en: 'Actual encoded carrier domain reported by the owner.',
            zh: '所有者报告的实际编码传输值类型。'
          }
        },
        authentication: {
          summary: {
            en: 'Installed protection profile derived from actual middleware.',
            zh: '从实际中间件派生的已安装保护配置。'
          },
          values: {
            none: {
              en: 'No signing or encryption middleware is installed.',
              zh: '未安装签名或加密中间件。'
            },
            sign: {
              en: 'Signing and verification protect actual frames.',
              zh: '签名及验证保护实际物理帧。'
            },
            'encrypt-sign': {
              en: 'Encryption and signing protect actual frames together.',
              zh: '加密及签名共同保护实际物理帧。'
            }
          }
        },
        fastPath: {
          summary: {
            en: 'Whether the real endpoint selected its compatible direct execution path.',
            zh: '实际端点是否选择了兼容直接执行路径。'
          }
        },
        carrier: {
          summary: {
            en: 'Actual carrier label or unavailable when physical observation is unsupported.',
            zh: '实际传输对象标签，不支持物理观察时表示不可用。'
          },
          values: {
            unavailable: {
              en: 'The adapter has no physical observation capability.',
              zh: '适配器没有物理观察能力。'
            }
          }
        },
        stageMask: {
          summary: {
            en: 'Actual emitter-supported stage bits, intersected with subscriptions at dispatch.',
            zh: '实际发射器支持阶段位，派发时与订阅求交。'
          }
        }
      },
      scenarios: [
        {
          en: 'Observe the existing owner without changing its business settlement or resource lifetime.',
          zh: '观察现有所有者，不改变业务结算或资源生命周期。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcProbeEventView: {
      summary: {
        en: 'Emitter-owned reused record valid only during emit; copy the required fields inside emit before retaining them; copies are shallow and nested content stays application-owned.',
        zh: '发射器拥有并复用的记录，只在回调期间有效；在回调内复制需要保留的字段，浅复制不转移嵌套内容的所有权。'
      },
      members: {
        seq: {
          summary: {
            en: 'Emitter-issued increasing sequence within the original endpoint emitter.',
            zh: '原端点发射器内部签发的递增序号。'
          }
        },
        carrierSeq: {
          summary: {
            en: 'Original inbound physical sequence; -1 means no physical link.',
            zh: '原入站物理序号，负一表示没有物理关联。'
          }
        },
        at: {
          summary: {
            en: 'Monotonic observation timestamp in milliseconds from the endpoint scheduler.',
            zh: '来自端点调度器的单调观察毫秒时间戳。'
          }
        },
        endpointId: {
          summary: {
            en: 'Identifier issued by the endpoint configuration whose emitter created this descriptor.',
            zh: '创建此描述的发射器所属端点配置签发的标识。'
          }
        },
        stage: {
          summary: {
            en: 'RpcProbeStage numeric ordinal for the current actual boundary.',
            zh: '当前实际边界对应的数字阶段序号。'
          }
        },
        direction: {
          summary: {
            en: 'RpcProbeDirection numeric ordinal for inbound, outbound or local traffic.',
            zh: '入站、出站或本地流量对应的数字方向序号。'
          }
        },
        kind: {
          summary: {
            en: 'RpcProbeKind numeric ordinal for the observed interaction.',
            zh: '被观察交互对应的数字种类序号。'
          }
        },
        outcome: {
          summary: {
            en: 'RpcProbeOutcome numeric ordinal for current progress or settlement.',
            zh: '当前进度或结算对应的数字结果序号。'
          }
        },
        messageId: {
          summary: {
            en: 'Original message identifier issued by the sender, or undefined without message attribution.',
            zh: '发送方签发的原消息标识，无消息归属时没有值。'
          }
        },
        method: {
          summary: {
            en: 'Original application method name when this observation has one.',
            zh: '本次观察存在方法时的原应用方法名称。'
          }
        },
        variation: {
          summary: {
            en: 'Original variation-control route only on applicable message/envelope observations.',
            zh: '只在适用逻辑或消息封装观察中的原变体控制路由。'
          }
        },
        senderId: {
          summary: {
            en: 'Original admitted sender identifier from the observed message.',
            zh: '观察消息中原已准入发送方标识。'
          }
        },
        targetId: {
          summary: {
            en: 'Original application target identifier from the observed route.',
            zh: '观察路由中原应用指定的目标标识。'
          }
        },
        receiverId: {
          summary: {
            en: 'Actual discovery-selected receiving instance identifier when known.',
            zh: '已知时由实际发现选择的接收实例标识。'
          }
        },
        peerId: {
          summary: {
            en: 'Actual physical peer identifier attributed by the held transport.',
            zh: '持有传输对象归属的实际物理对端标识。'
          }
        },
        trace: {
          summary: {
            en: 'Original explicitly supplied application trace when present.',
            zh: '存在时由应用显式提供的原追踪值。'
          }
        },
        sizeBytes: {
          summary: {
            en: 'Observed byte size; -1 means this layer cannot determine it.',
            zh: '观察到的字节数，负一表示此层无法确定。'
          }
        },
        chunkIndex: {
          summary: {
            en: 'Actual fragment index; -1 means this observation is not a fragment.',
            zh: '实际分片索引，负一表示本次观察不是分片。'
          }
        },
        chunkCount: {
          summary: {
            en: 'Actual fragment count; -1 means this observation is not a fragment.',
            zh: '实际分片数量，负一表示本次观察不是分片。'
          }
        },
        members: {
          summary: {
            en: 'Actual batch member count; -1 means this observation is not a batch.',
            zh: '实际批次成员数，负一表示本次观察不是批次。'
          }
        },
        durationMs: {
          summary: {
            en: 'Original settlement duration; -1 means this event does not settle an operation.',
            zh: '原结算耗时毫秒数，负一表示此事件不结算操作。'
          }
        },
        rejection: {
          summary: {
            en: 'Actual admission refusal reason, independent of a shared error code.',
            zh: '实际准入拒绝原因，与共享错误码分开。'
          }
        },
        lifecycle: {
          summary: {
            en: 'Actual lifecycle observation label when emitted by that owner.',
            zh: '相应所有者发出时的实际生命周期观察标签。'
          }
        },
        error: {
          summary: {
            en: 'Original observed failure reference; snapshotting does not clone errors.',
            zh: '原观察失败引用，快照不会克隆错误。'
          }
        },
        carrier: {
          summary: {
            en: 'Actual carrier label or unavailable when physical observation is unsupported.',
            zh: '实际传输对象标签，不支持物理观察时表示不可用。'
          },
          values: {
            unavailable: {
              en: 'The adapter has no physical observation capability.',
              zh: '适配器没有物理观察能力。'
            }
          }
        },
        detail: {
          summary: {
            en: 'Owner-produced diagnostic scalar record; snapshots retain its original reference.',
            zh: '所有者生成的诊断标量记录，快照保留其原引用。'
          }
        },
        content: {
          summary: {
            en: 'Only captured stages expose content after redaction; the reference is not deep-cloned.',
            zh: '只有捕获阶段在脱敏后公开内容，其引用不作深克隆。'
          }
        }
      },
      scenarios: [
        {
          en: 'Observe the existing owner without changing its business settlement or resource lifetime.',
          zh: '观察现有所有者，不改变业务结算或资源生命周期。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcProbeStageName: {
      summary: {
        en: 'One exact configuration name from RpcProbeStageName; unknown strings are rejected before changing compiled state.',
        zh: '规范阶段名称表中的精确配置名称，未知字符串在改变编译状态前被拒绝。'
      },
      members: {},
      scenarios: [
        {
          en: 'Observe the existing owner without changing its business settlement or resource lifetime.',
          zh: '观察现有所有者，不改变业务结算或资源生命周期。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcCarrierProbe: {
      summary: {
        en: 'Emitter-supplied physical observation port; adapters call it for actual I/O and retain no endpoint lifecycle authority.',
        zh: '发射器提供的物理观察端口，适配器只为实际读写调用，不拥有端点生命周期权限。'
      },
      members: {
        capturing: {
          summary: {
            en: 'True only when this physical observer may include original content.',
            zh: '只有该物理观察者可以包含原内容时为真。'
          }
        },
        emit: {
          summary: {
            en: 'Records actual synchronous carrier observation without changing the physical send or receive result.',
            zh: '同步记录实际传输对象观察，不改变物理发送或接收结果。'
          },
          params: {
            direction: {
              en: 'Actual RpcProbeDirection ordinal, supplied by the carrier owner.',
              zh: '传输对象所有者提供的实际方向序号。'
            },
            sizeBytes: {
              en: 'Measured physical byte size or -1 when unknown.',
              zh: '实测物理字节数，未知时为负一。'
            },
            carrier: {
              en: 'Physical carrier label chosen by the actual adapter.',
              zh: '实际适配器选择的底层传输通道标签。'
            },
            detail: {
              en: 'Actual scalar diagnostic record, or undefined.',
              zh: '实际标量诊断记录，或不提供。'
            },
            content: {
              en: 'Original physical value only if capturing is true; otherwise undefined.',
              zh: '只在允许捕获时传原物理值，否则不提供。'
            }
          },
          returns: {
            en: 'Observation is forwarded to the endpoint emitter; no operation result is returned.',
            zh: '观察转交端点发射器，不返回操作结果。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        }
      },
      scenarios: [
        {
          en: 'Observe the existing owner without changing its business settlement or resource lifetime.',
          zh: '观察现有所有者，不改变业务结算或资源生命周期。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IIpcSendQueueOptions: {
      summary: {
        en: 'Application-owned bounds and local diagnostic labels for one original physical connection.',
        zh: '一个原物理连接的应用容量边界及本地诊断标签。'
      },
      members: {
        connectionId: {
          summary: {
            en: 'Stable local diagnostic identifier issued by the application owner of this actual physical connection.',
            zh: '此实际物理连接的应用所有者签发的稳定本地诊断标识。'
          }
        },
        sessionId: {
          summary: {
            en: 'Optional local session identifier issued by that connection owner; it does not prove peer identity.',
            zh: '该连接所有者签发的可选本地会话标识，不证明对端身份。'
          },
          default: {
            en: 'Absent: session attribution is omitted.',
            zh: '默认省略会话归属。'
          }
        },
        maxPendingData: {
          summary: {
            en: 'Positive safe-integer data capacity counting running and queued whole envelopes together.',
            zh: '正安全整数数据容量，同时统计运行及排队的完整消息封装。'
          },
          default: {
            en: '256 total accepted data envelopes.',
            zh: '默认总计二百五十六个准入数据信封。'
          }
        },
        maxPendingControl: {
          summary: {
            en: 'Positive safe-integer control capacity independent of data saturation.',
            zh: '独立于数据饱和状态的正安全整数控制容量。'
          },
          default: {
            en: '8 total accepted control envelopes.',
            zh: '默认总计八个准入控制信封。'
          }
        }
      },
      scenarios: [
        {
          en: 'Observe the existing owner without changing its business settlement or resource lifetime.',
          zh: '观察现有所有者，不改变业务结算或资源生命周期。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      optionCases: [
        {
          title: {
            en: 'Keep a busy import from filling the send queue',
            zh: '避免繁忙导入占满发送队列'
          },
          problem: {
            en: 'An import produces data faster than the carrier drains it. Bound pending data separately from control messages so data load has an explicit queue budget.',
            zh: '导入产生数据的速度超过载体排空速度。分别限制待发数据和控制消息，为数据负载设置明确队列预算。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The connection has separate bounded queues for data and control traffic.',
            zh: '连接的数据与控制流量各有有界队列。'
          },
          covers: ['connectionId', 'maxPendingData', 'maxPendingControl']
        },
        {
          title: {
            en: 'Associate queue activity with one session',
            zh: '把队列活动归到对应会话'
          },
          problem: {
            en: 'A desktop process serves several sessions. Give the queue the connection and session identifiers used by application diagnostics so operators can locate a busy link.',
            zh: '桌面进程同时服务多个会话。为队列设置应用诊断使用的连接和会话标识，便于定位繁忙链路。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'Queue diagnostics can be associated with the selected connection and session.',
            zh: '队列诊断可归到所选连接和会话。'
          },
          covers: ['connectionId', 'sessionId']
        }
      ]
    },
    IIpcLogRecord: {
      summary: {
        en: 'A local backlog snapshot or explicit stderr record; no business payload is inferred from diagnostic labels.',
        zh: '本地容量快照或显式标准错误记录，诊断标签不推断业务载荷。'
      },
      members: {
        name: {
          summary: {
            en: 'Actual local event classification from the gate or explicit stderr intake.',
            zh: '来自门控或显式标准错误入口的实际本地事件分类。'
          },
          values: {
            enum: 'IpcLogEventName'
          }
        },
        connectionId: {
          summary: {
            en: 'Stable local diagnostic identifier issued by the application owner of this actual physical connection.',
            zh: '此实际物理连接的应用所有者签发的稳定本地诊断标识。'
          }
        },
        sessionId: {
          summary: {
            en: 'Optional local session identifier issued by that connection owner; it does not prove peer identity.',
            zh: '该连接所有者签发的可选本地会话标识，不证明对端身份。'
          },
          default: {
            en: 'Absent: session attribution is omitted.',
            zh: '默认省略会话归属。'
          }
        },
        pendingData: {
          summary: {
            en: 'Snapshot of accepted queued plus running business envelopes.',
            zh: '已准入排队及运行业务消息封装的计数快照。'
          }
        },
        pendingControl: {
          summary: {
            en: 'Snapshot of accepted queued plus running control envelopes.',
            zh: '已准入排队及运行控制消息封装的计数快照。'
          }
        },
        active: {
          summary: {
            en: 'Actual physical sender lane, or null while neither lane is sending.',
            zh: '实际物理发送通道，无通道发送时为空。'
          },
          values: {
            enum: 'IpcSendClass'
          }
        },
        trace: {
          summary: {
            en: 'Original application trace from the observed route when supplied.',
            zh: '提供时来自被观察路由的原应用追踪。'
          }
        },
        error: {
          summary: {
            en: 'Exact original observed failure when this event reports failure.',
            zh: '此事件报告失败时的精确原始失败。'
          }
        },
        processId: {
          summary: {
            en: 'Optional actual process identity issued by the native launcher.',
            zh: '原生启动器签发的可选实际进程标识。'
          }
        },
        text: {
          summary: {
            en: 'Already decoded stderr text explicitly supplied by the process owner.',
            zh: '进程所有者显式提供的已解码标准错误文本。'
          }
        },
        droppedChunks: {
          summary: {
            en: 'Optional number of source chunks omitted from an overflow summary.',
            zh: '溢出摘要中被省略的可选来源块数量。'
          }
        }
      },
      scenarios: [
        {
          en: 'Observe the existing owner without changing its business settlement or resource lifetime.',
          zh: '观察现有所有者，不改变业务结算或资源生命周期。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IIpcSendGate: {
      summary: {
        en: 'One connection-owned complete-envelope queue with independent data/control capacity and original cancellation.',
        zh: '一个连接拥有的完整消息封装队列，保留独立数据控制容量及原取消。'
      },
      members: {
        run: {
          summary: {
            en: 'Reserves the actual envelope class and serializes its physical callback; full capacity rejects OVERLOADED. New work after close rejects ENDPOINT_DISPOSED; already queued work receives the original close(reason).',
            zh: '预留实际消息封装类别并串行运行物理回调，容量满时拒绝过载；关闭后新工作拒绝端点已释放错误，已有排队工作接收原关闭原因。'
          },
          params: {
            envelope: {
              en: 'Original normalized rpc-contract envelope supplied by the outbound owner.',
              zh: '原出站所有者提供的规范契约消息封装。'
            },
            sendNow: {
              en: 'Original zero-argument physical send callback returns void or Promise<void>; throws/rejections retain their original failure.',
              zh: '执行原始发送的无参回调，返回 `void` 或 `Promise<void>`；抛错及拒绝仍保留原始失败。'
            },
            admission: {
              en: 'Optional original Core outbound admission; omission attaches no extra live cancellation.',
              zh: '可选原核心出站准入，省略时不附加额外活动取消。'
            }
          },
          returns: {
            en: 'Promise settles with the original send and releases its accepted capacity exactly once.',
            zh: 'Promise 随原发送结算，并精确释放一次已准入容量。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        onEvent: {
          summary: {
            en: 'Subscribes to frozen local backlog snapshots; observer failure is host-reported and cannot change send settlement.',
            zh: '订阅冻结本地容量快照，观察失败交宿主上报且不改变发送结算。'
          },
          params: {
            listener: {
              en: 'Synchronous application callback receives IIpcBacklogEvent and returns void.',
              zh: '应用同步回调接收容量事件并返回空值。'
            }
          },
          returns: {
            en: 'Idempotent removal releases this observer only.',
            zh: '幂等移除函数只释放此观察者。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        whenIdle: {
          summary: {
            en: 'Waits until all currently accepted logical sends have settled, including work admitted while waiting.',
            zh: '等待所有已准入逻辑发送结算，包含等待期间继续准入的工作。'
          },
          params: {},
          returns: {
            en: 'Resolves once accepted work is empty; it does not close the connection.',
            zh: '已准入工作清空时完成，不关闭连接。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        close: {
          summary: {
            en: 'Idempotently closes admission and rejects queued work with the original reason; active physical I/O keeps its own settlement.',
            zh: '幂等关闭准入并用原始原因拒绝排队工作，活动物理读写保留自身结算。'
          },
          params: {
            reason: {
              en: 'Optional original shutdown failure issued by the connection owner.',
              zh: '连接所有者提供的可选原关闭失败。'
            }
          },
          returns: {
            en: 'No later work can be admitted; existing physical send is not falsely declared cancelled.',
            zh: '后续不能准入工作，不会虚称现有物理发送已取消。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        }
      },
      scenarios: [
        {
          en: 'Observe the existing owner without changing its business settlement or resource lifetime.',
          zh: '观察现有所有者，不改变业务结算或资源生命周期。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IIpcLogInstallation: {
      summary: {
        en: 'One observer feature lifetime with explicit local stderr intake; it never owns or changes gate admission.',
        zh: '具有显式本地标准错误入口的一次观察功能生命周期，不拥有或改变门控准入。'
      },
      members: {
        feature: {
          summary: {
            en: 'Native feature token subscribes while installed and unregisters on endpoint cleanup.',
            zh: '原生功能令牌安装时订阅，端点清理时注销。'
          }
        },
        recordStderr: {
          summary: {
            en: 'Publishes one explicit original stderr record through the same observed reporter.',
            zh: '通过同一受观察上报者发布一条显式原标准错误记录。'
          },
          params: {
            record: {
              en: 'Actual decoded stderr record with ipc.stderr name and connection/session identifiers issued by its native owner.',
              zh: '实际已解码标准错误记录，含标准错误事件名及原生所有者签发的连接会话标识。'
            }
          },
          returns: {
            en: 'Reporting starts without waiting for async sinks; failures go to onReportError.',
            zh: '开始上报而不等待异步接收器，失败交上报错误回调。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        }
      },
      scenarios: [
        {
          en: 'Observe the existing owner without changing its business settlement or resource lifetime.',
          zh: '观察现有所有者，不改变业务结算或资源生命周期。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRpcTransport: {
      summary: {
        en: 'Original adapter-owned carrier interface; its operations, source proof and cleanup stay separate from Core protocol ownership.',
        zh: '传输适配器提供的载体接口；底层读写、来源检查和资源清理由适配器负责，RPC 协议由 Core 负责。'
      },
      scenarios: [
        {
          en: 'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
          zh: '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
        }
      ],
      example: rpcRawCarrierExample,
      members: {
        send: {
          summary: {
            en: 'Sends one actual carrier value; completion means the physical boundary completed, not that a remote provider executed.',
            zh: '发送一条底层消息；返回或完成承诺只说明发送操作已完成，不说明对端的业务函数已执行。'
          },
          params: {
            message: {
              en: 'Original complete message value accepted by this actual carrier domain.',
              zh: '交给底层载体的完整消息值，必须属于该载体支持的类型。'
            },
            options: {
              en: 'Optional IRpcSendOptions supplies original physical transfer references.',
              zh: '可选的 `IRpcSendOptions`，其中 `transfer` 指定本次发送要转移的对象。'
            }
          },
          returns: {
            en: 'Void or Promise<void> from the physical owner; native message-port and Worker send failures retain native Error/DOMException type and stack. Mutable unclassified errors gain Core TRANSPORT in place; foreign semantic identities stay unchanged, and immutable values remain on cause.',
            zh: '返回物理所有者的空值或承诺，原生消息端口及工作者发送失败保留原生错误类型及堆栈；可修改且未分类的错误原位附加核心 `TRANSPORT`，外部语义身份保持不变，不可修改的值保留在原因链。'
          },
          example: rpcRawCarrierExample
        },
        subscribe: {
          summary: {
            en: 'Subscribes to actual inbound messages; the original native registration is detached when its last logical listener leaves.',
            zh: '订阅收到的消息；最后一个逻辑订阅被移除时，适配器才移除底层事件监听。'
          },
          params: {
            listener: {
              en: 'Application callback receives a record containing data and optional actual peerId/origin/source; return void. Adapter-owned listener errors use onListenerError.',
              zh: '回调收到含 `data` 的记录，并可能带有 `peerId`、`origin`、`source`，返回 `void`；回调失败由 `onListenerError` 观察。'
            }
          },
          returns: {
            en: 'Idempotent removal of this registration; native cleanup failure may throw and preserve retry ownership.',
            zh: '返回仅取消这次订阅的函数，可重复调用；底层监听移除失败时可能抛错，尚未释放的部分仍可重试。'
          },
          example: rpcRawCarrierExample
        },
        close: {
          summary: {
            en: 'Retires this transport according to actual ownership; owned resources may be closed, borrowed resources retain their caller-owned native lifetime.',
            zh: '释放这个传输适配器；是否同时关闭底层资源，取决于它接管了资源还是只借用资源。'
          },
          params: {},
          returns: {
            en: 'Void or Promise<void>; actual native cleanup failures remain observable. Consult the adapter-specific close policy.',
            zh: '返回 `void` 或 `Promise<void>`，清理失败仍会报告；底层资源的关闭规则见具体适配器。'
          },
          example: rpcRawCarrierExample
        },
        onTransportError: {
          summary: {
            en: 'Subscribes to original physical/read/terminal failures without treating them as application provider results.',
            zh: '观察底层读写和连接终止的失败；这些错误与对端业务函数的返回值分开处理。'
          },
          params: {
            listener: {
              en: 'Application callback receives original unknown error, returns void; secondary failure is retained by the adapter reporter boundary.',
              zh: '回调接收原始错误并返回 `void`；若回调自身也失败，适配器会保留并报告这次次级失败。'
            }
          },
          returns: {
            en: 'Removal releases this failure observer only.',
            zh: '返回仅取消这次错误订阅的函数。'
          },
          example: rpcRawCarrierExample
        },
        onListenerError: {
          summary: {
            en: 'Subscribes to original message-listener or physical-observer callback failures independently of transport failure.',
            zh: '观察消息监听器或载体探针回调抛出的错误，与底层连接错误分开处理。'
          },
          params: {
            listener: {
              en: 'Application callback receives original listener error and returns void; its own failure is collected by the original adapter.',
              zh: '回调收到原始监听错误并返回 `void`；回调自身的失败仍由适配器收集。'
            }
          },
          returns: {
            en: 'Removal releases this diagnostic observer and may surface collected reporter failures.',
            zh: '返回取消这次诊断订阅的函数，取消时可能报告已收集的上报器错误。'
          },
          example: rpcRawCarrierExample
        },
        observe: {
          summary: {
            en: 'Installs original physical observation; replacing it retires the preceding observation generation without acquiring lifecycle ownership.',
            zh: '安装载体探针；替换探针后，旧安装失效，但探针不会接管载体的关闭责任。'
          },
          params: {
            probe: {
              en: 'Actual IRpcCarrierProbe port supplied by the installed endpoint emitter.',
              zh: '由端点的观察模块提供的 `IRpcCarrierProbe`，用于接收底层发送与接收观察。'
            }
          },
          returns: {
            en: 'Disposer retires only this observation generation, including when the same probe was later reinstalled.',
            zh: '返回只移除本次安装的函数；同一个探针后来重新安装时，不会被旧函数误删。'
          },
          example: rpcRawCarrierExample
        },
        peerId: {
          summary: {
            en: 'Optional original peer identity attributed by the actual adapter; caller labels do not grant verified identity.',
            zh: '适配器记录的可选对端标识；调用方填写这个标签并不等于对端身份已经验证。'
          }
        },
        origin: {
          summary: {
            en: 'Optional actual origin attributed by the adapter, not a caller assertion of trust.',
            zh: '适配器记录的可选来源域；它是来源信息，不能单独用作信任凭据。'
          }
        },
        platform: {
          summary: {
            en: 'Actual carrier platform label for presentation and diagnostics.',
            zh: '载体的平台标签，用于展示和诊断。'
          },
          values: {
            enum: 'RpcPlatform'
          }
        },
        topology: {
          summary: {
            en: 'Actual peer topology supplied by the adapter.',
            zh: '适配器提供的连接拓扑，说明载体怎样连接对端。'
          },
          values: {
            enum: 'RpcTransportTopology'
          }
        },
        encodedType: {
          summary: {
            en: 'Actual accepted carrier encoding domain.',
            zh: '载体接受的数据表示类型。'
          },
          values: {
            enum: 'RpcTransportEncoding'
          }
        },
        ownership: {
          summary: {
            en: 'Actual original physical ownership determining cleanup responsibility.',
            zh: '底层资源的所有权标记，用来决定谁负责关闭。'
          },
          values: {
            enum: 'RpcTransportOwnership'
          }
        },
        sourceProof: {
          summary: {
            en: 'Optional original adapter callback receives native source and optional origin, synchronously returns boolean; labels alone cannot replace this proof.',
            zh: '可选的来源检查函数，接收原生 `source` 和可选 `origin`，同步返回布尔值；标识标签不能代替这项检查。'
          }
        },
        closed: {
          summary: {
            en: 'True only when this adapter can prove no future message delivery; logical detach alone is insufficient.',
            zh: '只有适配器确认不会再交付消息时才为 `true`；仅移除一层逻辑监听不代表底层已关闭。'
          }
        }
      }
    },
    IRpcSendOptions: {
      summary: {
        en: 'Physical sender options contain only original transfer references, without application deadlines or RPC replay semantics.',
        zh: '底层发送选项，仅包含要转移的对象；调用超时和 RPC 重放策略不在这里配置。'
      },
      scenarios: [
        {
          en: 'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
          zh: '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
        }
      ],
      example: rpcRawCarrierExample,
      members: {
        transfer: {
          summary: {
            en: 'Optional ordered original transfer references; the actual native carrier validates support and detaches accepted ownership.',
            zh: '可选的转移列表，按调用方给出的顺序传给底层载体；由宿主检查可转移对象并完成所有权转移。'
          },
          default: {
            en: 'Absent: no explicit physical transfer.',
            zh: '默认没有显式物理转移。'
          }
        }
      }
    },

    IBrowserMessagePortLike: {
      summary: {
        en: 'Original browser MessagePort structural surface with explicit start/close and optional raw physical observation.',
        zh: '浏览器 MessagePort 需要满足的接口，包括启动、关闭及可选的载体观察能力。'
      },
      scenarios: [
        {
          en: 'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
          zh: '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      members: {
        postMessage: {
          summary: {
            en: 'Calls the actual native postMessage and forwards the exact ordered transfer list.',
            zh: '调用底层 `postMessage`，按原顺序传入转移列表。'
          },
          params: {
            message: {
              en: 'Original native-supported message value.',
              zh: '原生支持的原始消息值。'
            },
            transfer: {
              en: 'Optional original native transferable references.',
              zh: '可选的原生可转移对象列表，保留传入的对象引用。'
            },
            transferList: {
              en: 'Optional original native transferable references.',
              zh: '可选的原生可转移对象列表，保留传入的对象引用。'
            }
          },
          returns: {
            en: 'Returns after native postMessage; synchronous clone/transfer failures propagate.',
            zh: '原生消息发送返回后完成，同步克隆或转移失败传播。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        start: {
          summary: {
            en: 'Starts native MessagePort delivery without replacing existing event listeners.',
            zh: '启动 MessagePort 的消息交付，不替换已有事件监听。'
          },
          params: {},
          returns: {
            en: 'Native delivery is enabled; no RPC connection is inferred.',
            zh: '端口开始交付消息；这一步不会自行建立 RPC 连接。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        close: {
          summary: {
            en: 'Calls the original native port close operation; its actual physical owner determines idempotency and errors.',
            zh: '调用端口自己的 `close`；是否幂等、怎样报告失败，由底层端口决定。'
          },
          params: {},
          returns: {
            en: 'Native close completes or throws its original failure.',
            zh: '端口关闭完成，或抛出原始关闭错误。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        addEventListener: {
          summary: {
            en: 'Registers an additional native event callback without taking a mutable onmessage slot.',
            zh: '通过原生事件接口增加监听，不覆盖 `onmessage`。'
          },
          params: {
            type: {
              en: 'Actual supported native message/messageerror/error event name for this structural port.',
              zh: '该端口支持的 `message`、`messageerror` 或 `error` 事件名。'
            },
            listener: {
              en: 'Synchronous callback receives the original native event, returns void; native dispatch owns invocation.',
              zh: '回调接收原生事件并返回 `void`，由端口的事件系统同步调用。'
            }
          },
          returns: {
            en: 'Original event callback is registered.',
            zh: '事件回调已登记。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        removeEventListener: {
          summary: {
            en: 'Removes the exact original event callback without removing other registrations.',
            zh: '按回调引用移除对应监听，不影响其他监听。'
          },
          params: {
            type: {
              en: 'Same native event name passed when registering.',
              zh: '登记时传入的相同原生事件名。'
            },
            listener: {
              en: 'Same original callback reference passed to registration.',
              zh: '登记时使用的同一个回调引用。'
            }
          },
          returns: {
            en: 'Native removal completes or throws its original failure.',
            zh: '监听移除完成，或抛出底层移除错误。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        onError: {
          summary: {
            en: 'Subscribes to original physical/read/terminal failures without treating them as application provider results.',
            zh: '观察底层读写和连接终止的失败；这些错误与对端业务函数的返回值分开处理。'
          },
          params: {
            listener: {
              en: 'Application callback receives original unknown error, returns void; secondary failure is retained by the adapter reporter boundary.',
              zh: '回调接收原始错误并返回 `void`；若回调自身也失败，适配器会保留并报告这次次级失败。'
            }
          },
          returns: {
            en: 'Removal releases this failure observer only.',
            zh: '返回仅取消这次错误订阅的函数。'
          },
          example: rpcRawCarrierExample
        },
        observe: {
          summary: {
            en: 'Installs original physical observation; replacing it retires the preceding observation generation without acquiring lifecycle ownership.',
            zh: '安装载体探针；替换探针后，旧安装失效，但探针不会接管载体的关闭责任。'
          },
          params: {
            probe: {
              en: 'Actual IRpcCarrierProbe port supplied by the installed endpoint emitter.',
              zh: '由端点的观察模块提供的 `IRpcCarrierProbe`，用于接收底层发送与接收观察。'
            }
          },
          returns: {
            en: 'Disposer retires only this observation generation, including when the same probe was later reinstalled.',
            zh: '返回只移除本次安装的函数；同一个探针后来重新安装时，不会被旧函数误删。'
          },
          example: rpcRawCarrierExample
        }
      }
    },
    IWebWorkerLikePort: {
      summary: {
        en: 'Original Worker/MessagePort event-listener surface; mutable onmessage ownership is never required.',
        zh: 'Worker 或 MessagePort 需要满足的事件监听接口，不要求接管 `onmessage`。'
      },
      scenarios: [
        {
          en: 'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
          zh: '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      members: {
        postMessage: {
          summary: {
            en: 'Calls the actual native postMessage and forwards the exact ordered transfer list.',
            zh: '调用底层 `postMessage`，按原顺序传入转移列表。'
          },
          params: {
            message: {
              en: 'Original native-supported message value.',
              zh: '原生支持的原始消息值。'
            },
            transfer: {
              en: 'Optional original native transferable references.',
              zh: '可选的原生可转移对象列表，保留传入的对象引用。'
            },
            transferList: {
              en: 'Optional original native transferable references.',
              zh: '可选的原生可转移对象列表，保留传入的对象引用。'
            }
          },
          returns: {
            en: 'Returns after native postMessage; synchronous clone/transfer failures propagate.',
            zh: '原生消息发送返回后完成，同步克隆或转移失败传播。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        addEventListener: {
          summary: {
            en: 'Registers an additional native event callback without taking a mutable onmessage slot.',
            zh: '通过原生事件接口增加监听，不覆盖 `onmessage`。'
          },
          params: {
            type: {
              en: 'Actual supported native message/messageerror/error event name for this structural port.',
              zh: '该端口支持的 `message`、`messageerror` 或 `error` 事件名。'
            },
            listener: {
              en: 'Synchronous callback receives the original native event, returns void; native dispatch owns invocation.',
              zh: '回调接收原生事件并返回 `void`，由端口的事件系统同步调用。'
            }
          },
          returns: {
            en: 'Original event callback is registered.',
            zh: '事件回调已登记。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        removeEventListener: {
          summary: {
            en: 'Removes the exact original event callback without removing other registrations.',
            zh: '按回调引用移除对应监听，不影响其他监听。'
          },
          params: {
            type: {
              en: 'Same native event name passed when registering.',
              zh: '登记时传入的相同原生事件名。'
            },
            listener: {
              en: 'Same original callback reference passed to registration.',
              zh: '登记时使用的同一个回调引用。'
            }
          },
          returns: {
            en: 'Native removal completes or throws its original failure.',
            zh: '监听移除完成，或抛出底层移除错误。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        }
      }
    },
    IWebWorkerPortEvent: {
      summary: {
        en: 'Original native event fields read once at the adapter boundary; getter failure is reported as transport failure.',
        zh: '适配器读取一次的原生事件字段；属性访问失败会作为传输错误报告。'
      },
      scenarios: [
        {
          en: 'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
          zh: '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      members: {
        data: {
          summary: {
            en: 'Original native event message payload, when present.',
            zh: '存在时的原生事件消息载荷。'
          }
        },
        origin: {
          summary: {
            en: 'Original untrusted event origin before string classification.',
            zh: '尚未确认是字符串的原始 `origin`，不能直接当作可信来源。'
          }
        },
        source: {
          summary: {
            en: 'Original native event source reference.',
            zh: '保留原对象身份的原生事件来源引用。'
          }
        },
        type: {
          summary: {
            en: 'Original native event classification when supplied.',
            zh: '宿主提供的原始事件类型。'
          }
        },
        error: {
          summary: {
            en: 'Optional original ErrorEvent failure retained as transport cause; it remains reachable with its native type and stack.',
            zh: '可选原生错误事件失败，保留为载体错误原因；其原生类型及堆栈仍可经原因链追踪。'
          }
        }
      }
    },
    IBrowserMessagePortTransportOptions: {
      summary: {
        en: 'Explicit cleanup ownership of the exact browser port supplied to its adapter.',
        zh: '指定浏览器端口由适配器关闭，还是继续由调用方关闭。'
      },
      scenarios: [
        {
          en: 'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
          zh: '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      members: {
        ownership: {
          summary: {
            en: 'Owned closes the native port; borrowed only removes this wrapper registrations.',
            zh: '`owned` 会关闭端口；`borrowed` 只移除本适配器的监听。'
          },
          default: {
            en: 'owned: wrapper closes the original native port.',
            zh: '默认 `owned`，关闭适配器时也关闭端口。'
          },
          values: {
            enum: 'RpcTransportOwnership'
          },
          whenToUse: {
            en: 'Choose owned only when the wrapper should close the original port; choose borrowed when another component retains it.',
            zh: '包装器应负责关闭原端口时选 owned，其他组件保留生命周期时选 borrowed。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        }
      },
      optionCases: [
        {
          title: {
            en: 'Close a port with its RPC wrapper',
            zh: '随 RPC 包装器关闭端口'
          },
          problem: {
            en: 'A pane creates a MessageChannel solely for this RPC connection. Transfer closure responsibility to the wrapper so its cleanup also closes the original port.',
            zh: '面板专门为此 RPC 连接创建 MessageChannel。把关闭责任交给包装器，清理时即可一并关闭原端口。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'Closing the transport also closes the port it owns.',
            zh: '关闭传输对象时也会关闭它拥有的端口。'
          },
          covers: ['ownership']
        },
        {
          title: {
            en: 'Keep a shared port under its creator',
            zh: '由创建者管理共享端口'
          },
          problem: {
            en: 'A shell owns a port longer than one RPC view. Borrow the port so disposing this view’s transport does not close the shell’s resource.',
            zh: '外壳持有端口的时间长于单个 RPC 视图。借用端口，使视图释放传输对象时不会关闭外壳的资源。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The shell keeps control of the original port’s final close.',
            zh: '原端口的最终关闭仍由外壳控制。'
          },
          covers: ['ownership']
        }
      ]
    },
    IWebWorkerTransportOptions: {
      summary: {
        en: 'Static dedicated-channel presentation and explicit capability agreement; both deployment ends must use the same actual capabilities.',
        zh: '专用通道的标签和静态能力约定，两端必须配置相同的能力。'
      },
      scenarios: [
        {
          en: 'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
          zh: '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      members: {
        capabilities: {
          summary: {
            en: 'Application static capability list agreed on both actual deployment ends; never inferred from metadata labels.',
            zh: '部署时在两端约定的能力列表，不根据标签自动推断。'
          },
          default: {
            en: 'Canonical batch@1 capability is enabled.',
            zh: '默认启用 `batch@1`。'
          }
        },
        peerId: {
          summary: {
            en: 'Optional actual peer identifier issued by this known dedicated deployment owner.',
            zh: '`options.peerId` 来自调用方的部署配置，用于标记专用连接的对端；这个标签不代替身份验证。'
          },
          default: {
            en: 'Absent: no explicit peer label.',
            zh: '默认没有显式对端标签。'
          }
        },
        origin: {
          summary: {
            en: 'Optional actual origin label supplied by the dedicated deployment owner.',
            zh: '部署方提供的可选来源域标签。'
          },
          default: {
            en: 'Absent: no configured origin label.',
            zh: '默认没有配置来源域标签。'
          }
        }
      },
      optionCases: [
        {
          title: {
            en: 'Identify a dedicated worker connection',
            zh: '标记专用 Worker 连接'
          },
          problem: {
            en: 'A page already has a worker and knows its remote identity. Attach the application’s peer and origin metadata to the transport so inbound diagnostics retain that carrier context.',
            zh: '页面已持有 Worker，并知道远端身份。为传输对象设置应用的对端和来源元数据，让入站诊断保留这份载体上下文。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The worker transport exposes the supplied peer and origin metadata.',
            zh: 'Worker 传输对象会提供所设对端与来源元数据。'
          },
          covers: ['peerId', 'origin']
        },
        {
          title: {
            en: 'Agree on stream support before calling',
            zh: '调用前约定流支持'
          },
          problem: {
            en: 'A dedicated worker link uses a static capability agreement. Supply only the capabilities agreed by both ends; advertising a stream mode on one side alone cannot add support to the other.',
            zh: '专用 Worker 链路采用静态能力约定。只声明双方已经约定的能力；单方面声明流模式无法为另一端增加支持。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The transport presents the capability list selected by the application’s agreement.',
            zh: '传输对象使用应用约定的能力列表。'
          },
          covers: ['capabilities']
        }
      ]
    },
    createBrowserMessagePortTransport: {
      summary: {
        en: 'Original adapter-owned carrier interface; its operations, source proof and cleanup stay separate from Core protocol ownership.',
        zh: '传输适配器提供的载体接口；底层读写、来源检查和资源清理由适配器负责，RPC 协议由 Core 负责。'
      },
      scenarios: [
        {
          en: 'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
          zh: '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
        }
      ],
      example: rpcRawCarrierExample,
      members: {
        send: {
          summary: {
            en: 'Sends one actual carrier value; completion means the physical boundary completed, not that a remote provider executed.',
            zh: '发送一条底层消息；返回或完成承诺只说明发送操作已完成，不说明对端的业务函数已执行。'
          },
          params: {
            message: {
              en: 'Original complete message value accepted by this actual carrier domain.',
              zh: '交给底层载体的完整消息值，必须属于该载体支持的类型。'
            },
            options: {
              en: 'Optional IRpcSendOptions supplies original physical transfer references.',
              zh: '可选的 `IRpcSendOptions`，其中 `transfer` 指定本次发送要转移的对象。'
            }
          },
          returns: {
            en: 'Void or Promise<void> from the physical owner; native message-port and Worker send failures retain native Error/DOMException type and stack. Mutable unclassified errors gain Core TRANSPORT in place; foreign semantic identities stay unchanged, and immutable values remain on cause.',
            zh: '返回物理所有者的空值或承诺，原生消息端口及工作者发送失败保留原生错误类型及堆栈；可修改且未分类的错误原位附加核心 `TRANSPORT`，外部语义身份保持不变，不可修改的值保留在原因链。'
          },
          example: rpcRawCarrierExample
        },
        subscribe: {
          summary: {
            en: 'Subscribes to actual inbound messages; the original native registration is detached when its last logical listener leaves.',
            zh: '订阅收到的消息；最后一个逻辑订阅被移除时，适配器才移除底层事件监听。'
          },
          params: {
            listener: {
              en: 'Application callback receives a record containing data and optional actual peerId/origin/source; return void. Adapter-owned listener errors use onListenerError.',
              zh: '回调收到含 `data` 的记录，并可能带有 `peerId`、`origin`、`source`，返回 `void`；回调失败由 `onListenerError` 观察。'
            }
          },
          returns: {
            en: 'Idempotent removal of this registration; native cleanup failure may throw and preserve retry ownership.',
            zh: '返回仅取消这次订阅的函数，可重复调用；底层监听移除失败时可能抛错，尚未释放的部分仍可重试。'
          },
          example: rpcRawCarrierExample
        },
        close: {
          summary: {
            en: 'Retires this transport according to actual ownership; owned resources may be closed, borrowed resources retain their caller-owned native lifetime.',
            zh: '释放这个传输适配器；是否同时关闭底层资源，取决于它接管了资源还是只借用资源。'
          },
          params: {},
          returns: {
            en: 'Void or Promise<void>; actual native cleanup failures remain observable. Consult the adapter-specific close policy.',
            zh: '返回 `void` 或 `Promise<void>`，清理失败仍会报告；底层资源的关闭规则见具体适配器。'
          },
          example: rpcRawCarrierExample
        },
        onTransportError: {
          summary: {
            en: 'Subscribes to original physical/read/terminal failures without treating them as application provider results.',
            zh: '观察底层读写和连接终止的失败；这些错误与对端业务函数的返回值分开处理。'
          },
          params: {
            listener: {
              en: 'Application callback receives original unknown error, returns void; secondary failure is retained by the adapter reporter boundary.',
              zh: '回调接收原始错误并返回 `void`；若回调自身也失败，适配器会保留并报告这次次级失败。'
            }
          },
          returns: {
            en: 'Removal releases this failure observer only.',
            zh: '返回仅取消这次错误订阅的函数。'
          },
          example: rpcRawCarrierExample
        },
        onListenerError: {
          summary: {
            en: 'Subscribes to original message-listener or physical-observer callback failures independently of transport failure.',
            zh: '观察消息监听器或载体探针回调抛出的错误，与底层连接错误分开处理。'
          },
          params: {
            listener: {
              en: 'Application callback receives original listener error and returns void; its own failure is collected by the original adapter.',
              zh: '回调收到原始监听错误并返回 `void`；回调自身的失败仍由适配器收集。'
            }
          },
          returns: {
            en: 'Removal releases this diagnostic observer and may surface collected reporter failures.',
            zh: '返回取消这次诊断订阅的函数，取消时可能报告已收集的上报器错误。'
          },
          example: rpcRawCarrierExample
        },
        observe: {
          summary: {
            en: 'Installs original physical observation; replacing it retires the preceding observation generation without acquiring lifecycle ownership.',
            zh: '安装载体探针；替换探针后，旧安装失效，但探针不会接管载体的关闭责任。'
          },
          params: {
            probe: {
              en: 'Actual IRpcCarrierProbe port supplied by the installed endpoint emitter.',
              zh: '由端点的观察模块提供的 `IRpcCarrierProbe`，用于接收底层发送与接收观察。'
            }
          },
          returns: {
            en: 'Disposer retires only this observation generation, including when the same probe was later reinstalled.',
            zh: '返回只移除本次安装的函数；同一个探针后来重新安装时，不会被旧函数误删。'
          },
          example: rpcRawCarrierExample
        },
        peerId: {
          summary: {
            en: 'Optional original peer identity attributed by the actual adapter; caller labels do not grant verified identity.',
            zh: '适配器记录的可选对端标识；调用方填写这个标签并不等于对端身份已经验证。'
          }
        },
        origin: {
          summary: {
            en: 'Optional actual origin attributed by the adapter, not a caller assertion of trust.',
            zh: '适配器记录的可选来源域；它是来源信息，不能单独用作信任凭据。'
          }
        },
        platform: {
          summary: {
            en: 'Actual carrier platform label for presentation and diagnostics.',
            zh: '载体的平台标签，用于展示和诊断。'
          },
          values: {
            enum: 'RpcPlatform'
          }
        },
        topology: {
          summary: {
            en: 'Actual peer topology supplied by the adapter.',
            zh: '适配器提供的连接拓扑，说明载体怎样连接对端。'
          },
          values: {
            enum: 'RpcTransportTopology'
          }
        },
        encodedType: {
          summary: {
            en: 'Actual accepted carrier encoding domain.',
            zh: '载体接受的数据表示类型。'
          },
          values: {
            enum: 'RpcTransportEncoding'
          }
        },
        ownership: {
          summary: {
            en: 'Actual original physical ownership determining cleanup responsibility.',
            zh: '底层资源的所有权标记，用来决定谁负责关闭。'
          },
          values: {
            enum: 'RpcTransportOwnership'
          }
        },
        sourceProof: {
          summary: {
            en: 'Optional original adapter callback receives native source and optional origin, synchronously returns boolean; labels alone cannot replace this proof.',
            zh: '可选的来源检查函数，接收原生 `source` 和可选 `origin`，同步返回布尔值；标识标签不能代替这项检查。'
          }
        },
        closed: {
          summary: {
            en: 'True only when this adapter can prove no future message delivery; logical detach alone is insufficient.',
            zh: '只有适配器确认不会再交付消息时才为 `true`；仅移除一层逻辑监听不代表底层已关闭。'
          }
        }
      },
      surface: 'IRpcTransport'
    },
    createWebWorkerTransport: {
      summary: {
        en: 'Original adapter-owned carrier interface; its operations, source proof and cleanup stay separate from Core protocol ownership.',
        zh: '传输适配器提供的载体接口；底层读写、来源检查和资源清理由适配器负责，RPC 协议由 Core 负责。'
      },
      scenarios: [
        {
          en: 'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
          zh: '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
        }
      ],
      example: rpcRawCarrierExample,
      members: {
        send: {
          summary: {
            en: 'Sends one actual carrier value; completion means the physical boundary completed, not that a remote provider executed.',
            zh: '发送一条底层消息；返回或完成承诺只说明发送操作已完成，不说明对端的业务函数已执行。'
          },
          params: {
            message: {
              en: 'Original complete message value accepted by this actual carrier domain.',
              zh: '交给底层载体的完整消息值，必须属于该载体支持的类型。'
            },
            options: {
              en: 'Optional IRpcSendOptions supplies original physical transfer references.',
              zh: '可选的 `IRpcSendOptions`，其中 `transfer` 指定本次发送要转移的对象。'
            }
          },
          returns: {
            en: 'Void or Promise<void> from the physical owner; native message-port and Worker send failures retain native Error/DOMException type and stack. Mutable unclassified errors gain Core TRANSPORT in place; foreign semantic identities stay unchanged, and immutable values remain on cause.',
            zh: '返回物理所有者的空值或承诺，原生消息端口及工作者发送失败保留原生错误类型及堆栈；可修改且未分类的错误原位附加核心 `TRANSPORT`，外部语义身份保持不变，不可修改的值保留在原因链。'
          },
          example: rpcRawCarrierExample
        },
        subscribe: {
          summary: {
            en: 'Subscribes to actual inbound messages; the original native registration is detached when its last logical listener leaves.',
            zh: '订阅收到的消息；最后一个逻辑订阅被移除时，适配器才移除底层事件监听。'
          },
          params: {
            listener: {
              en: 'Application callback receives a record containing data and optional actual peerId/origin/source; return void. Adapter-owned listener errors use onListenerError.',
              zh: '回调收到含 `data` 的记录，并可能带有 `peerId`、`origin`、`source`，返回 `void`；回调失败由 `onListenerError` 观察。'
            }
          },
          returns: {
            en: 'Idempotent removal of this registration; native cleanup failure may throw and preserve retry ownership.',
            zh: '返回仅取消这次订阅的函数，可重复调用；底层监听移除失败时可能抛错，尚未释放的部分仍可重试。'
          },
          example: rpcRawCarrierExample
        },
        close: {
          summary: {
            en: 'Retires this transport according to actual ownership; owned resources may be closed, borrowed resources retain their caller-owned native lifetime.',
            zh: '释放这个传输适配器；是否同时关闭底层资源，取决于它接管了资源还是只借用资源。'
          },
          params: {},
          returns: {
            en: 'Void or Promise<void>; actual native cleanup failures remain observable. Consult the adapter-specific close policy.',
            zh: '返回 `void` 或 `Promise<void>`，清理失败仍会报告；底层资源的关闭规则见具体适配器。'
          },
          example: rpcRawCarrierExample
        },
        onTransportError: {
          summary: {
            en: 'Subscribes to original physical/read/terminal failures without treating them as application provider results.',
            zh: '观察底层读写和连接终止的失败；这些错误与对端业务函数的返回值分开处理。'
          },
          params: {
            listener: {
              en: 'Application callback receives original unknown error, returns void; secondary failure is retained by the adapter reporter boundary.',
              zh: '回调接收原始错误并返回 `void`；若回调自身也失败，适配器会保留并报告这次次级失败。'
            }
          },
          returns: {
            en: 'Removal releases this failure observer only.',
            zh: '返回仅取消这次错误订阅的函数。'
          },
          example: rpcRawCarrierExample
        },
        onListenerError: {
          summary: {
            en: 'Subscribes to original message-listener or physical-observer callback failures independently of transport failure.',
            zh: '观察消息监听器或载体探针回调抛出的错误，与底层连接错误分开处理。'
          },
          params: {
            listener: {
              en: 'Application callback receives original listener error and returns void; its own failure is collected by the original adapter.',
              zh: '回调收到原始监听错误并返回 `void`；回调自身的失败仍由适配器收集。'
            }
          },
          returns: {
            en: 'Removal releases this diagnostic observer and may surface collected reporter failures.',
            zh: '返回取消这次诊断订阅的函数，取消时可能报告已收集的上报器错误。'
          },
          example: rpcRawCarrierExample
        },
        observe: {
          summary: {
            en: 'Installs original physical observation; replacing it retires the preceding observation generation without acquiring lifecycle ownership.',
            zh: '安装载体探针；替换探针后，旧安装失效，但探针不会接管载体的关闭责任。'
          },
          params: {
            probe: {
              en: 'Actual IRpcCarrierProbe port supplied by the installed endpoint emitter.',
              zh: '由端点的观察模块提供的 `IRpcCarrierProbe`，用于接收底层发送与接收观察。'
            }
          },
          returns: {
            en: 'Disposer retires only this observation generation, including when the same probe was later reinstalled.',
            zh: '返回只移除本次安装的函数；同一个探针后来重新安装时，不会被旧函数误删。'
          },
          example: rpcRawCarrierExample
        },
        peerId: {
          summary: {
            en: 'Optional original peer identity attributed by the actual adapter; caller labels do not grant verified identity.',
            zh: '适配器记录的可选对端标识；调用方填写这个标签并不等于对端身份已经验证。'
          }
        },
        origin: {
          summary: {
            en: 'Optional actual origin attributed by the adapter, not a caller assertion of trust.',
            zh: '适配器记录的可选来源域；它是来源信息，不能单独用作信任凭据。'
          }
        },
        platform: {
          summary: {
            en: 'Actual carrier platform label for presentation and diagnostics.',
            zh: '载体的平台标签，用于展示和诊断。'
          },
          values: {
            enum: 'RpcPlatform'
          }
        },
        topology: {
          summary: {
            en: 'Actual peer topology supplied by the adapter.',
            zh: '适配器提供的连接拓扑，说明载体怎样连接对端。'
          },
          values: {
            enum: 'RpcTransportTopology'
          }
        },
        encodedType: {
          summary: {
            en: 'Actual accepted carrier encoding domain.',
            zh: '载体接受的数据表示类型。'
          },
          values: {
            enum: 'RpcTransportEncoding'
          }
        },
        ownership: {
          summary: {
            en: 'Actual original physical ownership determining cleanup responsibility.',
            zh: '底层资源的所有权标记，用来决定谁负责关闭。'
          },
          values: {
            enum: 'RpcTransportOwnership'
          }
        },
        sourceProof: {
          summary: {
            en: 'Optional original adapter callback receives native source and optional origin, synchronously returns boolean; labels alone cannot replace this proof.',
            zh: '可选的来源检查函数，接收原生 `source` 和可选 `origin`，同步返回布尔值；标识标签不能代替这项检查。'
          }
        },
        closed: {
          summary: {
            en: 'True only when this adapter can prove no future message delivery; logical detach alone is insufficient.',
            zh: '只有适配器确认不会再交付消息时才为 `true`；仅移除一层逻辑监听不代表底层已关闭。'
          }
        }
      },
      surface: 'IRpcTransport'
    },
    IMessageAdapterOptions: {
      summary: {
        en: 'Raw messaging recipe supplies actual operations only; Core owns identity exchange, accepted capabilities and endpoint construction.',
        zh: '调用方提供打开或启动消息资源的操作，Core 负责身份交换、能力协商和端点构造。'
      },
      scenarios: [
        {
          en: 'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
          zh: '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      members: {
        open: {
          summary: {
            en: 'Opens the original raw messaging resource for one deployment input; rejects propagate through canonical construction cleanup.',
            zh: '根据一次连接输入打开消息资源；失败时由 Core 的构造流程清理已取得的资源并报告原错误。'
          },
          params: {
            input: {
              en: 'Actual physical input supplied by the application connect/listen deployment choice.',
              zh: '调用方通过 `connect` 或 `listen` 提供的底层连接输入。'
            }
          },
          returns: {
            en: 'Original IMessageAdapterPort synchronously or asynchronously; no fabricated transport recipe is accepted.',
            zh: '同步或异步返回 `IMessageAdapterPort`；这里需要原始消息端口，不接受预先组装的传输配置。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          whenToUse: {
            en: 'Return the original host MessagePort or messaging object when the connection already exists.',
            zh: '连接已存在时，返回宿主的原始消息端口或消息对象。'
          }
        },
        launch: {
          summary: {
            en: 'Launches the actual native resource and returns its real exit/termination operations.',
            zh: '启动底层资源，返回它的消息端口、退出结果和终止操作。'
          },
          params: {
            input: {
              en: 'Actual application launch input selected by spawn.',
              zh: '调用方通过 `spawn` 提供的启动输入。'
            },
            context: {
              en: 'Original runtime source context containing configured self and local capability offer.',
              zh: '包含本端 `self` 和本地能力提议的运行上下文。'
            }
          },
          returns: {
            en: 'Promise of IMessageAdapterLaunch; rejection fails original peer construction.',
            zh: '返回 `Promise<IMessageAdapterLaunch>`；启动失败会使对端构造失败。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          default: {
            en: 'Absent: spawn is unavailable for this recipe.',
            zh: '省略时，该适配器不支持 `spawn`。'
          },
          whenToUse: {
            en: 'Supply launch only when the adapter owns native execution and can observe its actual exit.',
            zh: '仅在适配器拥有原生执行单元且能观察真实退出时提供 launch。'
          }
        }
      },
      optionCases: [
        {
          title: {
            en: 'Use an existing native message port',
            zh: '使用已有原生消息端口'
          },
          problem: {
            en: 'An application already owns a MessagePort. The adapter’s open callback returns that original port; Core owns negotiation and request handling instead of requiring another messaging implementation.',
            zh: '应用已经拥有 MessagePort。适配器的 open 回调返回原端口；协商和请求处理交给 Core，不再另写一套消息实现。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The checkout calls the remote pricing provider through its original native port.',
            zh: '结算页通过原生端口调用远端价格处理函数。'
          },
          covers: ['open']
        },
        {
          title: {
            en: 'Launch a worker with its actual exit handle',
            zh: '启动 Worker 并保留真实退出句柄'
          },
          problem: {
            en: 'A platform adapter also owns worker startup. Supply launchWorker, which returns the native port, the real exit Promise and termination operation; openExistingWorkerPort handles already-running workers.',
            zh: '平台适配器还负责启动 Worker。launchWorker 返回原生端口、真实退出 Promise 和终止操作；openExistingWorkerPort 处理已经运行的 Worker。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The adapter can stop the worker it launched and observe its actual exit.',
            zh: '适配器能停止自己启动的 Worker，并观察其真实退出。'
          },
          covers: ['launch']
        }
      ]
    },
    IMessageAdapterLaunch: {
      summary: {
        en: 'Actual launch resource includes its original messaging port, exit Promise and native termination request.',
        zh: '启动操作返回的资源，包括消息端口、退出承诺和终止请求函数。'
      },
      scenarios: [
        {
          en: 'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
          zh: '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      members: {
        port: {
          summary: {
            en: 'Original raw messaging port returned by the actual launcher.',
            zh: '启动器取得的原始消息端口。'
          }
        },
        exited: {
          summary: {
            en: 'Actual native exit observation; requesting terminate does not settle it by assertion.',
            zh: '资源实际退出时结算的承诺；仅发出终止请求不代表它已经退出。'
          }
        },
        failed: {
          summary: {
            en: 'Optional original native failure observation before eventual exit.',
            zh: '可选的失败观察，在资源最终退出前报告底层故障。'
          }
        },
        initialMessage: {
          summary: {
            en: 'Original initial launch message supplied by this actual launcher.',
            zh: '启动器提供的初始消息，保留原始消息值。'
          }
        },
        terminate: {
          summary: {
            en: 'Requests actual native termination without claiming observed exit.',
            zh: '请求底层资源终止，不把请求发出当作退出完成。'
          },
          params: {},
          returns: {
            en: 'Termination request is issued; await exited for actual completion.',
            zh: '发出终止请求；仍须等待 `exited` 才能确认资源实际退出。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        }
      }
    },
    IMessageAdapterPort: {
      summary: {
        en: 'Original EventEmitter or EventTarget raw messaging operations; this structural input alone grants no accepted runtime channel identity.',
        zh: 'EventEmitter 或 EventTarget 风格的原始消息接口；仅满足这些方法形状，不代表已经完成通道身份验证。'
      },
      scenarios: [
        {
          en: 'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
          zh: '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      members: {
        postMessage: {
          summary: {
            en: 'Calls the actual native postMessage and forwards the exact ordered transfer list.',
            zh: '调用底层 `postMessage`，按原顺序传入转移列表。'
          },
          params: {
            message: {
              en: 'Original native-supported message value.',
              zh: '原生支持的原始消息值。'
            },
            transfer: {
              en: 'Optional original native transferable references.',
              zh: '可选的原生可转移对象列表，保留传入的对象引用。'
            },
            transferList: {
              en: 'Optional original native transferable references.',
              zh: '可选的原生可转移对象列表，保留传入的对象引用。'
            }
          },
          returns: {
            en: 'Returns after native postMessage; synchronous clone/transfer failures propagate.',
            zh: '原生消息发送返回后完成，同步克隆或转移失败传播。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        addEventListener: {
          summary: {
            en: 'Registers an additional native event callback without taking a mutable onmessage slot.',
            zh: '通过原生事件接口增加监听，不覆盖 `onmessage`。'
          },
          params: {
            type: {
              en: 'Actual supported native message/messageerror/error event name for this structural port.',
              zh: '该端口支持的 `message`、`messageerror` 或 `error` 事件名。'
            },
            listener: {
              en: 'Synchronous callback receives the original native event, returns void; native dispatch owns invocation.',
              zh: '回调接收原生事件并返回 `void`，由端口的事件系统同步调用。'
            }
          },
          returns: {
            en: 'Original event callback is registered.',
            zh: '事件回调已登记。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        removeEventListener: {
          summary: {
            en: 'Removes the exact original event callback without removing other registrations.',
            zh: '按回调引用移除对应监听，不影响其他监听。'
          },
          params: {
            type: {
              en: 'Same native event name passed when registering.',
              zh: '登记时传入的相同原生事件名。'
            },
            listener: {
              en: 'Same original callback reference passed to registration.',
              zh: '登记时使用的同一个回调引用。'
            }
          },
          returns: {
            en: 'Native removal completes or throws its original failure.',
            zh: '监听移除完成，或抛出底层移除错误。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        on: {
          summary: {
            en: 'Adds an actual EventEmitter message, messageerror or close listener.',
            zh: '通过事件订阅接口监听消息、消息解码错误或连接关闭，事件名分别为 `message`、`messageerror`、`close`。'
          },
          params: {
            event: {
              en: 'Supported native message/messageerror/close event name.',
              zh: '受支持的原生事件名：`message`、`messageerror` 或 `close`。'
            },
            listener: {
              en: 'Synchronous callback receives original message or optional original error; returns void.',
              zh: '回调同步接收原始消息或可选错误，返回 `void`。'
            }
          },
          returns: {
            en: 'Native emitter registration result is not used by Core.',
            zh: 'Core 不使用底层 `on` 的返回值。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        off: {
          summary: {
            en: 'Removes an exact EventEmitter listener registration.',
            zh: '通过 EventEmitter 接口移除对应监听。'
          },
          params: {
            event: {
              en: 'Original supported native event name used when adding.',
              zh: '添加监听时使用的同一个原生事件名。'
            },
            listener: {
              en: 'Exact original listener reference used when adding.',
              zh: '添加监听时使用的同一个回调引用。'
            }
          },
          returns: {
            en: 'Native emitter removal result is not used by Core.',
            zh: 'Core 不使用底层 `off` 的返回值。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        onError: {
          summary: {
            en: 'Subscribes to original physical/read/terminal failures without treating them as application provider results.',
            zh: '观察底层读写和连接终止的失败；这些错误与对端业务函数的返回值分开处理。'
          },
          params: {
            listener: {
              en: 'Application callback receives original unknown error, returns void; secondary failure is retained by the adapter reporter boundary.',
              zh: '回调接收原始错误并返回 `void`；若回调自身也失败，适配器会保留并报告这次次级失败。'
            }
          },
          returns: {
            en: 'Removal releases this failure observer only.',
            zh: '返回仅取消这次错误订阅的函数。'
          },
          example: rpcRawCarrierExample
        },
        observe: {
          summary: {
            en: 'Installs original physical observation; replacing it retires the preceding observation generation without acquiring lifecycle ownership.',
            zh: '安装载体探针；替换探针后，旧安装失效，但探针不会接管载体的关闭责任。'
          },
          params: {
            probe: {
              en: 'Actual IRpcCarrierProbe port supplied by the installed endpoint emitter.',
              zh: '由端点的观察模块提供的 `IRpcCarrierProbe`，用于接收底层发送与接收观察。'
            }
          },
          returns: {
            en: 'Disposer retires only this observation generation, including when the same probe was later reinstalled.',
            zh: '返回只移除本次安装的函数；同一个探针后来重新安装时，不会被旧函数误删。'
          },
          example: rpcRawCarrierExample
        },
        listenerCount: {
          summary: {
            en: 'Reports actual native message listener count when the raw EventEmitter supports it.',
            zh: '底层 EventEmitter 支持时，查询消息监听器的数量。'
          },
          params: {
            event: {
              en: 'The original message event name.',
              zh: '原生 `message` 事件名。'
            }
          },
          returns: {
            en: 'Actual native listener count.',
            zh: '返回底层监听器数量。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        once: {
          summary: {
            en: 'Registers an actual one-shot close observation on the native resource.',
            zh: '在底层资源上登记一次性的关闭监听。'
          },
          params: {
            event: {
              en: 'The original native close event name.',
              zh: '原生 `close` 事件名。'
            },
            listener: {
              en: 'Application zero-argument synchronous close callback returning void.',
              zh: '无参的同步关闭回调，返回 `void`。'
            }
          },
          returns: {
            en: 'Native registration result is not consumed by Core.',
            zh: 'Core 不使用底层监听登记的返回值。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        }
      }
    },
    IByteAdapterOptions: {
      summary: {
        en: 'Raw ordered-byte recipe delegates opening to the application and retains all wire handshake, authentication and protocol control in Core.',
        zh: '调用方负责打开有序字节连接，Core 负责连接上的握手、认证和协议控制。'
      },
      scenarios: [
        {
          en: 'Use the original physical I/O and let Core retain protocol and lifecycle ownership.',
          zh: '对接已有端口或连接，由 Core 处理 RPC 协议和资源释放。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      members: {
        open: {
          summary: {
            en: 'Opens original physical ordered-byte I/O; an async rejection fails construction.',
            zh: '打开底层有序字节连接；异步打开失败会使对端构造失败。'
          },
          params: {
            input: {
              en: 'Actual application physical input selected by connect/listen deployment options.',
              zh: '调用方通过 `connect` 或 `listen` 选择的底层连接输入。'
            }
          },
          returns: {
            en: 'Original ordered byte I/O with kind byte, async write, data/close subscriptions and actual close; Core owns wire control.',
            zh: '返回 `kind` 为 `byte` 的有序字节连接，提供异步写入、数据与关闭订阅以及关闭操作；线上协议仍由 Core 负责。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          whenToUse: {
            en: 'Return the original ordered byte I/O for this source mode; keep handshake and framing in Core.',
            zh: '按来源模式返回原始有序字节读写，把握手与分帧留给 Core。'
          }
        },
        listen: {
          summary: {
            en: 'Opens an actual accepted listening byte connection, without supplying a fabricated runtime agreement.',
            zh: '打开监听端已接纳的字节连接；不由调用方预填一份已协商的运行约定。'
          },
          params: {
            input: {
              en: 'Actual application physical input selected by connect/listen deployment options.',
              zh: '调用方通过 `connect` 或 `listen` 选择的底层连接输入。'
            }
          },
          returns: {
            en: 'Original ordered byte I/O with kind byte, async write, data/close subscriptions and actual close; Core owns wire control.',
            zh: '返回 `kind` 为 `byte` 的有序字节连接，提供异步写入、数据与关闭订阅以及关闭操作；线上协议仍由 Core 负责。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          default: {
            en: 'Absent: use open for the original listening input.',
            zh: '省略时，把监听输入交给 `open`。'
          },
          whenToUse: {
            en: 'Return the original ordered byte I/O for this source mode; keep handshake and framing in Core.',
            zh: '按来源模式返回原始有序字节读写，把握手与分帧留给 Core。'
          }
        },
        dial: {
          summary: {
            en: 'Opens an actual dialed byte connection while retaining the original byte owner.',
            zh: '通过拨号取得字节连接，保留底层资源已有的所有权。'
          },
          params: {
            input: {
              en: 'Actual application physical input selected by connect/listen deployment options.',
              zh: '调用方通过 `connect` 或 `listen` 选择的底层连接输入。'
            }
          },
          returns: {
            en: 'Original ordered byte I/O with kind byte, async write, data/close subscriptions and actual close; Core owns wire control.',
            zh: '返回 `kind` 为 `byte` 的有序字节连接，提供异步写入、数据与关闭订阅以及关闭操作；线上协议仍由 Core 负责。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          default: {
            en: 'Absent: use open for the original connecting input.',
            zh: '省略时，把连接输入交给 `open`。'
          },
          whenToUse: {
            en: 'Return the original ordered byte I/O for this source mode; keep handshake and framing in Core.',
            zh: '按来源模式返回原始有序字节读写，把握手与分帧留给 Core。'
          }
        },
        diagnostics: {
          summary: {
            en: 'Optional adapter-owned canonical error source/code/message records and text for actual byte failures.',
            zh: '可选的适配器诊断配置，提供字节连接失败时使用的错误来源、错误码和消息。'
          },
          default: {
            en: 'Absent: Core canonical byte diagnostics.',
            zh: '默认使用 Core 的字节连接诊断。'
          }
        },
        'presentation.platform': {
          summary: {
            en: 'Actual platform label selected by the byte adapter author; presentation grants no provenance.',
            zh: '适配器作者配置的平台标签，只用于展示，不能证明来源身份。'
          }
        },
        'presentation.expectedStringText': {
          summary: {
            en: 'Adapter-owned canonical diagnostic text for an unsupported non-string semantic carrier.',
            zh: '适配器提供的错误文本，用于说明不支持的非字符串消息值。'
          }
        },
        presentation: {
          summary: {
            en: 'Optional platform label and expected-string diagnostic text; presentation cannot establish channel provenance.',
            zh: '可选的平台标签和预期字符串错误文本，只用于展示与诊断，不能证明通道来源。'
          },
          default: {
            en: 'Absent: Core process presentation defaults.',
            zh: '默认沿用 Core 的进程标签与诊断文本。'
          }
        }
      },
      optionCases: [
        {
          title: {
            en: 'Open an application-owned ordered byte stream',
            zh: '打开应用持有的有序字节流'
          },
          problem: {
            en: 'A platform already supplies ordered byte I/O with write, onData, onClose and close. Keep those carrier operations in openByteConnection and let Core provide negotiation and framing. Application diagnostics and presentation describe this carrier.',
            zh: '平台已有带 write、onData、onClose 和 close 的有序字节读写。把载体操作留在 openByteConnection，协商和分帧交给 Core；应用诊断与展示配置描述这类载体。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The pricing connection uses Core’s byte handshake and framing over the platform’s I/O.',
            zh: '价格连接在平台字节读写上使用 Core 的字节握手与分帧。'
          },
          covers: [
            'open',
            'diagnostics',
            'presentation',
            'presentation.platform',
            'presentation.expectedStringText'
          ]
        },
        {
          title: {
            en: 'Separate accepted connections from outgoing dials',
            zh: '区分接入连接与主动拨号'
          },
          problem: {
            en: 'A byte adapter handles accepted server connections as well as outgoing clients. Supply the corresponding application open operations so each mode acquires the right native I/O.',
            zh: '字节适配器既处理服务端接入，也处理客户端主动连接。分别提供应用的打开操作，让两种模式取得正确的原生读写对象。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'Listening and dialing reuse the same Core protocol while retaining platform-specific acquisition.',
            zh: '监听与拨号复用同一 Core 协议，同时保留平台各自的资源取得方式。'
          },
          covers: ['listen', 'dial']
        }
      ]
    },
    IAdapterDefinition: {
      summary: {
        en: 'A cold raw-source definition with deployment and provider-scope operations. The definition itself creates no endpoint, starts no native execution and owns no application Host.',
        zh: '提供冷原始来源部署及提供方作用域操作的定义。定义本身不创建端点、不启动原生执行，也不拥有应用宿主。'
      },
      scenarios: [
        {
          en: 'An author contributes actual raw I/O to Host installation and shares the original provider scope when needed.',
          zh: '作者在宿主安装时提供实际原始输入输出，并按需共享原提供方作用域。'
        }
      ],
      members: {
        deployment: {
          summary: {
            en: 'Capture exactly one selected physical source as an opaque cold deployment token; Host installation opens it later.',
            zh: '把恰好一个选定物理来源捕获为不透明冷部署令牌，由宿主安装过程稍后打开。'
          },
          params: {
            options: {
              en: 'IAdapterDeploymentOptions with spawn, connect or listen raw input and optional local policy.',
              zh: '带 spawn、connect 或 listen 原始输入及可选本地策略的 IAdapterDeploymentOptions。'
            }
          },
          returns: {
            en: 'IAdapterDeployment passed to defineTransportPlugin; capture does not create a callable Peer.',
            zh: '返回交给 defineTransportPlugin 的 IAdapterDeployment，捕获过程不创建可调用对端。'
          },
          example: {
            en: rpcApiGuides['rpc-host:plugin:defineMessageAdapter'].en.quickStart!,
            zh: rpcApiGuides['rpc-host:plugin:defineMessageAdapter'].zh.quickStart!
          }
        },
        scope: {
          summary: {
            en: 'Allocate the original shared admission and idempotency scope; its creator retires it after all borrowing hosts close.',
            zh: '分配原共享准入及幂等作用域，创建方在全部借用宿主关闭后退休它。'
          },
          params: {
            store: {
              en: 'Optional existing IRpcIdempotencyStore; omission uses the canonical store owner.',
              zh: '可选既有 IRpcIdempotencyStore，省略时使用规范存储所有者。'
            }
          },
          returns: {
            en: 'IRuntimeProviderScope with session-derived policy and explicit idempotent close. The native session supplies authenticated identity.',
            zh: '返回带会话派生策略及显式幂等关闭的 IRuntimeProviderScope，由原生会话提供已认证身份。'
          },
          example:
            "import type { IAdapterDefinition } from '@migaia/rpc-host/plugin'\n\n/** The callback closes all borrowing hosts before returning. */\nexport async function withProviderScope<T>(\n  adapter: IAdapterDefinition<T>,\n  use: (scope: ReturnType<IAdapterDefinition<T>['scope']>) => Promise<void>\n): Promise<void> {\n  const scope = adapter.scope()\n  try { await use(scope) }\n  finally { scope.close() }\n}"
        }
      }
    },
    IRemoteContract: {
      summary: {
        en: 'Normalized frozen V1 plugin description, admitted before publishing remote routes.',
        zh: '发布远程路由前接纳的第一版冻结插件描述。'
      },
      members: {
        schemaVersion: {
          summary: {
            en: 'Exactly schema version 1; V2 runtime directories use a different schema.',
            zh: '固定为第一版模式，第二版运行时目录使用独立模式。'
          },
          values: {
            '1': {
              en: 'V1 explicit plugin contract.',
              zh: '第一版显式插件契约。'
            }
          }
        },
        plugin: {
          summary: {
            en: 'Plugin name authored by the application: ASCII letter followed by up to 39 letters, digits, underscores or hyphens.',
            zh: '应用编写的插件名：以字母开头，后接最多三十九个字母、数字、下划线或连字符。'
          }
        },
        features: {
          summary: {
            en: 'Nonempty feature table; each feature owns a nonempty method table.',
            zh: '非空特性表，每个特性拥有非空方法表。'
          }
        }
      },
      scenarios: [
        {
          en: 'Validate received descriptions before publishing any remote method.',
          zh: '发布任何远程方法前校验接收到的描述。'
        }
      ],
      example:
        "const contract = normalizeRemoteContract({\n  schemaVersion: 1,\n  plugin: 'math',\n  features: { calc: { methods: { double: { mode: 'request', idempotent: true } } } }\n})"
    },
    IRemoteFeatureContract: {
      summary: {
        en: 'One declared feature and its nonempty method table.',
        zh: '一个已声明特性及其非空方法表。'
      },
      members: {
        methods: {
          summary: {
            en: 'Application method names mapped to explicit invocation mode and idempotency declarations.',
            zh: '应用方法名到显式调用模式与幂等声明的映射。'
          }
        }
      }
    },
    IRemoteMethodContract: {
      summary: {
        en: 'Explicit mode and retry eligibility for one V1 method.',
        zh: '单个第一版方法的显式模式与重试资格。'
      },
      members: {
        mode: {
          summary: {
            en: 'Select the actual callable mode of the provided method.',
            zh: '选择实际提供方法的调用模式。'
          },
          values: {
            enum: 'RemoteMethodMode'
          }
        },
        idempotent: {
          summary: {
            en: 'Whether replaying a request is safe; must be false for one-way or iterator methods.',
            zh: '重放请求是否安全，单向或迭代器方法必须为假。'
          }
        }
      }
    },
    IRemoteHostCatalog: {
      summary: {
        en: 'Frozen name-to-contract map; each key equals its contract plugin name.',
        zh: '冻结的名称到契约映射，每个键必须等于对应契约的插件名。'
      },
      members: {}
    },
    IRemoteControlDefinition: {
      summary: {
        en: 'One of describePlugin, describeHost, hostUseParams, hostUseResult, hostUnUseParams, hostUnUseResult, hostInspectParams or hostInspectResult, selecting the exact reserved description/control grammar.',
        zh: '选择插件描述、宿主描述，或宿主安装、移除、检查的输入及结果形式，精确校验对应保留描述或控制语法。'
      },
      members: {}
    },
    IRemoteEndpointFactory: {
      summary: {
        en: 'Async callback receiving the actual IRemoteChannel and native preparation signal; returns IRemoteServeEndpoint and must install the supplied channel features together.',
        zh: '异步回调接收实际 `IRemoteChannel` 及原生准备信号，返回 `IRemoteServeEndpoint`，须同时安装通道提供的特性。'
      },
      members: {}
    },
    IRemoteChannel: {
      summary: {
        en: 'Negotiated channel held for one generation and owned by its supplied close operation.',
        zh: '为单个代次持有的协商通道，由其提供的关闭操作拥有。'
      },
      scenarios: [
        {
          en: 'Assemble an endpoint on the codec and framer selected by the platform.',
          zh: '使用平台选定的编解码器与帧处理器组装端点。'
        }
      ],
      example:
        'const served = await endpointFactory(channel, signal)\nawait served.endpoint.dispose()\nawait channel.close()',
      members: {
        transport: {
          summary: {
            en: 'Original physical transport supplied by the platform channel owner.',
            zh: '平台通道拥有者提供的原始物理传输。'
          }
        },
        peerId: {
          summary: {
            en: 'Remote endpoint identifier established by handshake or trusted platform bootstrap.',
            zh: '由握手或受信平台启动过程确定的远端端点标识。'
          }
        },
        scheduler: {
          summary: {
            en: 'Monotonic clock and timers shared with the platform binding.',
            zh: '与平台绑定共用的单调时钟和计时器。'
          }
        },
        agreement: {
          summary: {
            en: 'Accepted negotiated or explicitly static codec and capability agreement.',
            zh: '已接受的协商结果或显式静态编解码与能力约定。'
          }
        },
        pipeline: {
          summary: {
            en: 'Actual codec and framer selected by that agreement.',
            zh: '由该约定选定的实际编解码器与帧处理器。'
          }
        },
        features: {
          summary: {
            en: 'Endpoint features that must be installed in its initial construction batch.',
            zh: '必须在端点首次构造批次中安装的特性。'
          }
        },
        close: {
          summary: {
            en: 'Releases the channel-owned physical resources after endpoint teardown.',
            zh: '端点清理后释放通道拥有的物理资源。'
          },
          params: {},
          returns: {
            en: 'Promise completing channel cleanup; ownership and repeat-call semantics belong to the concrete channel.',
            zh: '返回通道清理 Promise，所有权及重复调用语义由具体通道决定。'
          },
          example: 'await channel.close()'
        }
      }
    },
    IRemoteBinding: {
      summary: {
        en: 'Platform-owned bridge between an actual supervisor unit and its remote channel.',
        zh: '实际监督执行单元与远程通道之间的平台绑定。'
      },
      members: {
        ownership: {
          summary: {
            en: 'Explicit responsibility for the supervisor lifetime.',
            zh: '对监督器生命周期承担的显式责任。'
          },
          values: {
            owned: {
              en: 'Release also owns supervisor disposal.',
              zh: '释放时同时负责监督器清理。'
            },
            borrowed: {
              en: 'Release leaves the external supervisor alive.',
              zh: '释放后保留外部监督器。'
            }
          }
        },
        supervisor: {
          summary: {
            en: 'Existing supervisor of the real unit, from the platform execution owner.',
            zh: '实际执行单元的现有监督器，来自平台执行拥有者。'
          }
        },
        scheduler: {
          summary: {
            en: 'Same monotonic scheduler used by the supervisor and retry deadlines.',
            zh: '监督器与重试截止时间共用的单调调度器。'
          }
        },
        openChannel: {
          summary: {
            en: 'Opens the actual unit channel under the preparation cancellation signal.',
            zh: '在准备取消信号约束下打开实际执行单元通道。'
          },
          params: {
            unit: {
              en: 'Ready unit returned by this binding supervisor.',
              zh: '本绑定监督器返回的就绪执行单元。'
            },
            signal: {
              en: 'Native preparation signal issued by the generation owner.',
              zh: '代次拥有者签发的原生准备信号。'
            }
          },
          returns: {
            en: 'Promise of a complete channel; acquisition failure becomes start failure with its cause.',
            zh: '返回完整通道的 Promise，获取失败成为保留原始原因的启动失败。'
          },
          example: 'const channel = await binding.openChannel(unit, signal)'
        },
        trackRequest: {
          summary: {
            en: 'Optional original native-drain tracker wrapping a request or cold dispatcher without adding another drain owner.',
            zh: '可选原生排空跟踪器，包装请求或冷派发器，不额外创建排空拥有者。'
          }
        }
      }
    },
    IRemoteProxyOptions: {
      summary: {
        en: 'Shared generation proxy configuration; the platform supplies its actual binding.',
        zh: '共享代次代理配置，平台提供其实际绑定。'
      },
      members: {
        contract: {
          summary: {
            en: 'Normalized plugin contract or Host catalog returned by the remote normalizers.',
            zh: '远程规范化函数返回的插件契约或宿主目录。'
          }
        },
        binding: {
          summary: {
            en: 'Actual platform binding supplying supervision, clock, channel acquisition and explicit execution ownership.',
            zh: '平台适配器提供的真实绑定，包含监督、时钟、通道获取与显式执行所有权。'
          }
        },
        endpointFactory: {
          summary: {
            en: 'Constructs the served endpoint from the complete channel and native cancellation signal; install its features in the same batch.',
            zh: '从完整通道与原生取消信号构造服务端点，须在同批构造中安装通道特性。'
          },
          params: {
            channel: {
              en: 'Channel returned by the binding openChannel operation.',
              zh: '绑定的 `openChannel()` 返回的通道。'
            },
            signal: {
              en: 'Native signal issued for this generation preparation.',
              zh: '本次代次准备签发的原生取消信号。'
            }
          },
          returns: {
            en: 'Promise of endpoint, optional one-way surface and stream runtime; failure rolls construction back.',
            zh: '返回端点及可选单向、流式能力的 Promise；失败会触发构造回滚。'
          },
          example: 'const served = await endpointFactory(channel, signal)'
        },
        report: {
          summary: {
            en: 'Reports background or secondary cleanup failures synchronously; a thrown reporter failure follows the owner fallback.',
            zh: '同步报告后台或次要清理失败；报告函数抛错时由拥有者的后备路径处理。'
          },
          params: {
            error: {
              en: 'Original background failure.',
              zh: '原始后台失败值。'
            }
          },
          returns: {
            en: 'No result is consumed.',
            zh: '不消费返回值，诊断已交给应用。'
          },
          example: 'report(error)'
        },
        keyFactory: {
          summary: {
            en: 'Synchronous application key factory used for automatically keyed idempotent requests.',
            zh: '同步应用键工厂，为自动分配键的幂等请求返回字符串。'
          },
          default: {
            en: 'Omitted: use defaultRpcId.',
            zh: '省略时使用默认远程标识工厂。'
          },
          params: {},
          returns: {
            en: 'A string logical key; a thrown factory failure rejects that request before sending.',
            zh: '返回字符串逻辑键；工厂抛错会在发送前拒绝该请求。'
          }
        },
        retryPort: {
          summary: {
            en: 'Application retry dispatcher replacing the entire original retry dispatch operation.',
            zh: '应用重试派发端口，整体替换原有重试派发操作。'
          },
          default: {
            en: 'Omitted: create the canonical retry port from binding events, scheduler and report.',
            zh: '省略时从绑定事件、调度器及报告函数创建规范重试端口。'
          }
        },
        callDeadlineCapMs: {
          summary: {
            en: 'Optional positive finite platform ceiling on a logical call deadline, in milliseconds.',
            zh: '平台对逻辑调用截止时间施加的可选正有限毫秒上限。'
          },
          default: {
            en: 'Omitted: no additional platform deadline ceiling.',
            zh: '省略时不额外施加平台截止上限。'
          }
        },
        callGuard: {
          summary: {
            en: 'Optional synchronous pre-dispatch admission guard, after validation and before selecting a generation.',
            zh: '可选同步派发前接纳检查，在校验后、选取代次前执行。'
          },
          default: {
            en: 'Omitted: no extra admission guard.',
            zh: '省略时不增加额外接纳检查。'
          }
        }
      }
    },
    IRemoteCallOptions: {
      summary: {
        en: 'Legacy proxy request and stream controls kept outside business arguments.',
        zh: '旧版代理的请求及流式控制设置，与业务参数分开。'
      },
      members: {
        signal: {
          summary: {
            en: 'Caller-owned signal cancelling the logical call, preserving the actual abort reason.',
            zh: '调用方持有的信号，用于取消逻辑调用并保留实际取消原因。'
          },
          default: {
            en: 'Omitted: no caller cancellation signal.',
            zh: '省略时不附加调用方取消信号。'
          }
        },
        timeoutMs: {
          summary: {
            en: 'Caller-selected finite nonnegative local call budget in milliseconds.',
            zh: '调用方选择的有限非负本地调用毫秒预算。'
          },
          default: {
            en: 'Omitted: inherit the actual dispatch owner default.',
            zh: '省略时继承实际派发拥有者的默认预算。'
          }
        },
        idempotencyKey: {
          summary: {
            en: 'Application-issued key identifying the same logical operation across retries; use the original key for reconciliation.',
            zh: '应用为同一逻辑操作签发的键，重试时保持一致，核对结果时使用原键。'
          },
          default: {
            en: 'Omitted: automatic keys are generated only for declared idempotent requests.',
            zh: '省略时仅为声明幂等的请求自动生成键。'
          }
        },
        orderKey: {
          summary: {
            en: 'Application-selected lane key grouping calls for provider-wide ordered admission in the runtime profile.',
            zh: '应用选择的通道键，在运行时协议中将调用归入提供方统一有序接纳队列。'
          },
          default: {
            en: 'Omitted: no ordered lane is requested.',
            zh: '省略时不请求有序接纳通道。'
          }
        },
        cancel: {
          summary: {
            en: 'Cancellation intent evaluated by the final provider start boundary.',
            zh: '由最终提供方开始执行边界判断的取消意图。'
          },
          default: {
            en: 'Omitted: no before-start cancellation intent.',
            zh: '省略时不请求开始前取消。'
          },
          values: {
            'before-start': {
              en: 'Permit cancellation before the provider starts the invocation.',
              zh: '允许在提供方开始执行调用之前取消。'
            }
          }
        }
      }
    },
    IRuntimeCallOptions: {
      summary: {
        en: 'Runtime call controls including false deadline override and explicit binary ownership transfer.',
        zh: '运行时调用控制，包含关闭截止时间的显式`false`及二进制所有权转移。'
      },
      members: {
        signal: {
          summary: {
            en: 'Caller-owned signal cancelling the logical call, preserving the actual abort reason.',
            zh: '调用方持有的信号，用于取消逻辑调用并保留实际取消原因。'
          },
          default: {
            en: 'Omitted: no caller cancellation signal.',
            zh: '省略时不附加调用方取消信号。'
          }
        },
        timeoutMs: {
          summary: {
            en: 'Finite nonnegative milliseconds, or false to disable the inherited deadline for this call.',
            zh: '有限非负毫秒数，或用显式`false`关闭本次调用的继承截止时间。'
          },
          default: {
            en: 'Omitted: request and stream inherit defaultTimeoutMs; other call kinds keep their original defaults.',
            zh: '省略时请求与流式调用继承默认截止时间，其他调用保留原默认行为。'
          },
          values: {
            false: {
              en: 'Disable the inherited deadline.',
              zh: '关闭继承的调用截止时间。'
            }
          }
        },
        idempotencyKey: {
          summary: {
            en: 'Application-issued key identifying the same logical operation across retries; use the original key for reconciliation.',
            zh: '应用为同一逻辑操作签发的键，重试时保持一致，核对结果时使用原键。'
          },
          default: {
            en: 'Omitted: automatic keys are generated only for declared idempotent requests.',
            zh: '省略时仅为声明幂等的请求自动生成键。'
          }
        },
        orderKey: {
          summary: {
            en: 'Application-selected lane key grouping calls for provider-wide ordered admission in the runtime profile.',
            zh: '应用选择的通道键，在运行时协议中将调用归入提供方统一有序接纳队列。'
          },
          default: {
            en: 'Omitted: no ordered lane is requested.',
            zh: '省略时不请求有序接纳通道。'
          }
        },
        cancel: {
          summary: {
            en: 'Cancellation intent evaluated by the final provider start boundary.',
            zh: '由最终提供方开始执行边界判断的取消意图。'
          },
          default: {
            en: 'Omitted: no before-start cancellation intent.',
            zh: '省略时不请求开始前取消。'
          },
          values: {
            'before-start': {
              en: 'Permit cancellation before the provider starts the invocation.',
              zh: '允许在提供方开始执行调用之前取消。'
            }
          }
        },
        transfer: {
          summary: {
            en: 'Caller-owned ArrayBuffers transferred through a carrier that actually supports native transfer.',
            zh: '由调用方拥有的缓冲区列表，经实际支持原生转移的传输对象转移。'
          },
          default: {
            en: 'Omitted: no explicit native ownership transfer.',
            zh: '省略时不显式请求原生所有权转移。'
          }
        }
      }
    },
    IRemoteCallGuard: {
      summary: {
        en: 'One synchronous admission hook before generation dispatch; a throw prevents sending.',
        zh: '代次派发前的同步接纳钩子，抛错会阻止发送。'
      },
      members: {
        beforeDispatch: {
          summary: {
            en: 'Checks the normalized method, invocation mode and selected generation before dispatch.',
            zh: '派发前检查规范方法、调用模式与选定代次。'
          },
          params: {
            input: {
              en: 'Original dispatch metadata with method, mode and generation.',
              zh: '原始派发元数据，包含方法、模式与代次。'
            }
          },
          returns: {
            en: 'No value; a thrown failure rejects admission.',
            zh: '无返回值，抛错会拒绝接纳。'
          },
          example:
            "callGuard.beforeDispatch({ method: 'math.calc.double', mode: 'request', generation: 1 })"
        }
      }
    },
    IRemoteServeEndpoint: {
      summary: {
        en: 'One dedicated endpoint plus its actually installed one-way and streaming capabilities.',
        zh: '单个专用端点及其实际安装的单向、流式能力。'
      },
      members: {
        endpoint: {
          summary: {
            en: 'Original Core endpoint serving and sending frames.',
            zh: '原始核心端点，负责提供服务及发送帧。'
          }
        },
        oneWay: {
          summary: {
            en: 'Installed one-way surface; required when the contract declares that mode.',
            zh: '已安装的单向能力，契约声明此模式时必须提供。'
          }
        },
        stream: {
          summary: {
            en: 'Installed stream runtime; required for iterator modes.',
            zh: '已安装的流式运行时，迭代器模式必须提供。'
          }
        }
      }
    },
    IRemoteGenerationEvents: {
      summary: {
        en: 'Original current, departure and readiness facts used by the shared retry owner.',
        zh: '共享重试拥有者使用的原始当前代次、离开与就绪事实。'
      },
      members: {
        current: {
          summary: {
            en: 'Reads the accepted generation and whether it remains active without preparing another unit.',
            zh: '读取已接受代次及其是否仍有效，不准备其他执行单元。'
          },
          params: {},
          returns: {
            en: 'Generation number and active flag.',
            zh: '返回代次编号及有效标志。'
          },
          example: 'const current = events.current()'
        },
        onLeave: {
          summary: {
            en: 'Subscribes to departure of the exact supplied generation.',
            zh: '订阅所提供精确代次的离开事件。'
          },
          params: {
            generation: {
              en: 'Number obtained from current or whenReady.',
              zh: '从 `current()` 或 `whenReady()` 取得的代次编号。'
            },
            listener: {
              en: 'Receives the original departure reason.',
              zh: '接收原始离开原因。'
            }
          },
          returns: {
            en: 'Removal function for this observation.',
            zh: '返回本次观察的移除函数。'
          },
          example:
            'const off = events.onLeave(events.current().generation, reason => console.error(reason))\noff()'
        },
        whenReady: {
          summary: {
            en: 'Waits for an accepted generation newer than the supplied number.',
            zh: '等待编号晚于所提供代次的已接受就绪代次。'
          },
          params: {
            afterGeneration: {
              en: 'Previously observed number returned by current or whenReady.',
              zh: '先前从 `current()` 或 `whenReady()` 观察到的编号。'
            },
            signal: {
              en: 'Optional caller cancellation signal.',
              zh: '可选调用方取消信号。'
            }
          },
          returns: {
            en: 'Promise of the newer generation; cancellation rejects with the owner reason.',
            zh: '返回较新代次编号的 Promise，取消会按拥有者原因拒绝。'
          },
          example: 'const next = await events.whenReady(events.current().generation, signal)'
        }
      }
    },
    IRemoteRetryDispatch: {
      summary: {
        en: 'One logical request retaining its original key and deadline across at most two physical sends.',
        zh: '单个逻辑请求在最多两次物理发送间保留原键与截止时间。'
      },
      members: {
        method: {
          summary: {
            en: 'Actual method path from the accepted remote contract.',
            zh: '从已接受远程契约取得的实际方法路径。'
          }
        },
        mode: {
          summary: {
            en: 'Only scalar request dispatch uses this retry port.',
            zh: '仅标量请求派发使用此重试端口。'
          },
          values: {
            request: {
              en: 'One-result request dispatch.',
              zh: '等待单个结果的请求派发。'
            }
          }
        },
        idempotent: {
          summary: {
            en: 'Validated request replay eligibility from its contract.',
            zh: '契约中已校验的请求重放资格。'
          }
        },
        key: {
          summary: {
            en: 'Original application or generated logical idempotency key.',
            zh: '原始应用提供或自动生成的逻辑幂等键。'
          }
        },
        generation: {
          summary: {
            en: 'Original accepted generation number from the generation event owner.',
            zh: '从代次事件拥有者取得的原始已接受代次编号。'
          }
        },
        signal: {
          summary: {
            en: 'Caller-owned signal cancelling the logical call, preserving the actual abort reason.',
            zh: '调用方持有的信号，用于取消逻辑调用并保留实际取消原因。'
          },
          default: {
            en: 'Omitted: no caller cancellation signal.',
            zh: '省略时不附加调用方取消信号。'
          }
        },
        timeoutMs: {
          summary: {
            en: 'Caller-selected finite nonnegative local call budget in milliseconds.',
            zh: '调用方选择的有限非负本地调用毫秒预算。'
          },
          default: {
            en: 'Omitted: inherit the actual dispatch owner default.',
            zh: '省略时继承实际派发拥有者的默认预算。'
          }
        },
        deadlineAt: {
          summary: {
            en: 'Absolute monotonic deadline computed by the original logical-call owner.',
            zh: '原始逻辑调用拥有者计算的绝对单调截止时间。'
          }
        },
        events: {
          summary: {
            en: 'Original generation event owner, never a separate synthetic event stream.',
            zh: '原始代次事件拥有者，不是另建的合成事件流。'
          }
        },
        sendOnce: {
          summary: {
            en: 'Sends through the selected generation using the original remaining deadline and key.',
            zh: '通过选定代次发送，并保留原始剩余截止时间及键。'
          },
          params: {
            input: {
              en: 'Expected generation, optional remaining milliseconds and original key supplied by the retry owner.',
              zh: '重试拥有者提供的预期代次、可选剩余毫秒数与原键。'
            }
          },
          returns: {
            en: 'Promise of one portable result; a departure may leave the logical result unknown.',
            zh: '返回单次可移植结果的 Promise，代次离开可能使逻辑结果未知。'
          },
          example:
            'const value = await input.sendOnce({ expectedGeneration: input.generation, key: input.key })'
        }
      }
    },
    IRemoteRetryPort: {
      summary: {
        en: 'Whole logical request dispatch port; the canonical implementation permits one idempotent replay after a departure.',
        zh: '完整逻辑请求派发端口，规范实现允许在离开后执行一次幂等重放。'
      },
      scenarios: [
        {
          en: 'Preserve one deadline while waiting for a replacement generation.',
          zh: '等待替换代次期间保持同一个截止时间。'
        }
      ],
      example:
        'const port = createRemoteRetryPort({ events, scheduler, report })\nconst value = await port.dispatch(input)',
      members: {
        dispatch: {
          summary: {
            en: 'Dispatches a logical request under its original cancellation, key and deadline.',
            zh: '在原始取消、键与截止时间约束下派发逻辑请求。'
          },
          params: {
            input: {
              en: 'IRemoteRetryDispatch issued by the original proxy dispatch owner.',
              zh: '原代理派发拥有者签发的 `IRemoteRetryDispatch`。'
            }
          },
          returns: {
            en: 'Portable result; lost non-idempotent results reject with REMOTE_RESULT_UNKNOWN.',
            zh: '返回可移植结果，非幂等调用丢失结果时以 `REMOTE_RESULT_UNKNOWN` 拒绝。'
          },
          example: 'const value = await port.dispatch(input)'
        }
      }
    },

    IRuntimePeer: {
      summary: {
        en: 'One accepted logical Peer exposing local identity, calls, passive events and deterministic connection cleanup.',
        zh: '单个已接受逻辑连接，提供本端身份、调用、被动事件与确定性连接清理。'
      },
      scenarios: [
        {
          en: 'Use a negotiated platform channel without introducing another proxy lifecycle.',
          zh: '使用已协商的平台通道，不额外创建代理生命周期。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      members: {
        self: {
          summary: {
            en: 'Frozen local peer name and instanceId minted or supplied during this connection construction; it is not a remote authentication principal.',
            zh: '连接构造时签发或由应用提供的冻结本端名称与实例标识，不代表对端认证主体。'
          }
        },
        outcome: {
          summary: {
            en: 'Queries the original remote operation ledger for a prior idempotency key, without dispatching that operation again.',
            zh: '查询原始远端操作账本中已有幂等键的结果，不会再次派发对应操作。'
          },
          params: {
            idempotencyKey: {
              en: 'The caller-issued key supplied as options.idempotencyKey on an earlier request to this connection.',
              zh: '来自调用方先前在此连接请求的 `options.idempotencyKey` 中指定的幂等键。'
            }
          },
          returns: {
            en: 'Promise of IRpcRuntimeOutcomeResult; support and availability come from the accepted remote runtime contract.',
            zh: '返回 `IRpcRuntimeOutcomeResult` Promise，支持程度与可用性取决于已接受的远端运行时契约。'
          },
          example:
            "await worker.request('orders.create', order, { idempotencyKey: 'order-42' })\nconsole.log(await worker.outcome('order-42'))"
        },
        describe: {
          summary: {
            en: 'Queries the local accepted peer detail asynchronously. Without format returns IRuntimeDetail; json, yaml or toml returns the admitted text projection. It does not claim unavailable physical metrics.',
            zh: '异步查询本地已接受的连接详情，不选格式时返回 `IRuntimeDetail`，选择 `json`、`yaml` 或 `toml` 时返回允许的文本投影，不编造不可观察的物理指标。'
          },
          params: {
            options: {
              en: 'Optional query format from IRuntimeQueryOptions; omitted returns the object snapshot.',
              zh: '来自 `IRuntimeQueryOptions` 的可选查询格式，省略时返回对象快照。'
            }
          },
          returns: {
            en: 'Promise of local detail or formatted text, following the selected query format.',
            zh: '根据所选查询格式返回本地详情或格式化文本的 Promise。'
          },
          example:
            "console.log(await worker.describe())\nconsole.log(await worker.describe({ format: 'json' }))"
        },
        on: {
          summary: {
            en: 'Registers a future RuntimeEventName listener after construction; factory resolution already represents initial readiness. Listener return is ignored and failures are contained by the runtime reporter.',
            zh: '构造完成后登记未来运行时事件监听，工厂完成已经代表首次就绪；不消费监听返回值，失败由运行时报告接收方隔离。'
          },
          params: {
            event: {
              en: 'A RuntimeEventName value such as ready or exit; it selects future connection lifecycle notifications.',
              zh: '来自 `RuntimeEventName` 的取值，例如 `ready` 或 `exit`，用于选择未来连接生命周期通知。'
            },
            listener: {
              en: 'Callback receives IRuntimeEvent from this connection; return is ignored and throws or rejected thenables are reported.',
              zh: '回调接收来自本连接的 `IRuntimeEvent`，返回值不消费，抛错或类 Promise 对象拒绝会报告。'
            }
          },
          returns: {
            en: 'Idempotent removal function for this registration; closing the peer clears its publisher.',
            zh: '返回本次登记的幂等移除函数，关闭连接会清理其事件发布者。'
          },
          example:
            "const off = worker.on('exit', event => console.log(event))\nawait worker.close()\noff()"
        },
        close: {
          summary: {
            en: 'Ends this logical connection and releases its owned channel resources; platform factories also terminate a worker or child they spawned.',
            zh: '结束本逻辑连接并释放其拥有的通道资源，平台工厂还会终止由它启动的线程或子进程。'
          },
          returns: {
            en: 'Shared completion Promise retaining the original close operation identity; no new calls are admitted once closing begins.',
            zh: '返回保持原始关闭操作身份的共享完成 Promise，关闭开始后不再接纳新调用。'
          },
          example: 'await worker.close()\nawait worker.close()'
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Scoped asynchronous cleanup is the exact original close operation, including its Promise identity.',
            zh: '作用域异步清理使用原始关闭操作本身，并保持其完成 Promise 身份。'
          },
          returns: {
            en: 'The same completion Promise as close(), including platform-owned resource cleanup.',
            zh: '返回与 `close()` 相同的完成 Promise，包含平台拥有资源的清理。'
          },
          example: 'await worker[Symbol.asyncDispose]()'
        },
        request: {
          summary: {
            en: 'Calls a method the other side provides and waits for its result. Default deadline 30000 ms (`defaultTimeoutMs`); errors keep their native type and `(source, code)`.',
            zh: '调用对端提供的方法并等待结果。默认截止时间为 30000 毫秒（可由 `defaultTimeoutMs` 修改）；错误保留原生类型与 `(source, code)`。'
          },
          params: {
            method: {
              en: 'Dotted path from the accepted remote provide directory.',
              zh: '已接受远端方法目录中的点分路径。'
            },
            payload: {
              en: 'Single application payload accepted by that method; omit for a parameterless method.',
              zh: '该方法接受的单个应用负载；无参数方法可省略。'
            },
            options: {
              en: 'Local controls from IRuntimeCallOptions, separate from the payload.',
              zh: '来自 `IRuntimeCallOptions` 的本地控制设置，与业务负载分开。'
            }
          },
          returns: {
            en: 'The method result, typed from `TRemote`.',
            zh: '方法的返回结果，类型由 `TRemote` 推导。'
          },
          example: "const total = await worker.request('math.double', 21, { timeoutMs: 1000 })"
        },
        notify: {
          summary: {
            en: 'Sends a one-way call; no result comes back.',
            zh: '发送单向调用，不会返回结果。'
          },
          params: {
            method: {
              en: 'Dotted path from the accepted remote provide directory.',
              zh: '已接受远端方法目录中的点分路径。'
            },
            payload: {
              en: 'Single application payload accepted by that method; omit for a parameterless method.',
              zh: '该方法接受的单个应用负载；无参数方法可省略。'
            },
            options: {
              en: 'Local controls from IRuntimeCallOptions, separate from the payload.',
              zh: '来自 `IRuntimeCallOptions` 的本地控制设置，与业务负载分开。'
            }
          },
          returns: {
            en: 'Resolves once the call was sent.',
            zh: '调用发送后 resolve。'
          },
          example: "await worker.notify('log.write', 'started')"
        },
        stream: {
          summary: {
            en: 'Calls a method that returns an iterable and yields its items as they arrive.',
            zh: '调用返回可迭代对象的方法，并在元素到达时逐个产出。'
          },
          params: {
            method: {
              en: 'Dotted path from the accepted remote provide directory.',
              zh: '已接受远端方法目录中的点分路径。'
            },
            payload: {
              en: 'Single application payload accepted by that method; omit for a parameterless method.',
              zh: '该方法接受的单个应用负载；无参数方法可省略。'
            },
            options: {
              en: 'Local controls from IRuntimeCallOptions, separate from the payload.',
              zh: '来自 `IRuntimeCallOptions` 的本地控制设置，与业务负载分开。'
            }
          },
          returns: {
            en: 'An async iterator of the yielded items.',
            zh: '所产出元素的异步迭代器。'
          },
          example: "for await (const value of worker.stream('feed.count', 3)) console.log(value)"
        },
        group: {
          summary: {
            en: 'Sends several calls as one batch and returns the outcome of each step in order.',
            zh: '把多次调用作为一个批次发送，并按顺序返回每一步的结果。'
          },
          params: {
            steps: {
              en: 'Steps `{ method, payload? }` in order.',
              zh: '按顺序排列的步骤 `{ method, payload? }`。'
            },
            options: {
              en: 'Batch options such as `timeoutMs` and `signal`.',
              zh: '批次选项，例如 `timeoutMs` 与 `signal`。'
            }
          },
          returns: {
            en: 'One outcome per step (success value or error).',
            zh: '每一步对应一个结果（成功值或错误）。'
          },
          example:
            "const [a, b] = await worker.group([{ method: 'math.double', payload: 1 }, { method: 'math.double', payload: 2 }])"
        }
      }
    },
    IRuntimePeerOptions: {
      summary: {
        en: 'Core peer configuration selecting exactly one application source and actual provided methods.',
        zh: '核心连接配置，选择唯一应用来源及实际提供的方法。'
      },
      members: {
        endpointFactory: {
          summary: {
            en: 'Advanced synchronous invocation of an async endpoint factory with this acquired channel and native abort signal; its Promise must resolve an IRemoteServeEndpoint. Failure triggers construction rollback.',
            zh: '高级端点工厂在取得通道后接收该通道与原生中止信号，其 Promise 须返回 `IRemoteServeEndpoint`，失败会触发构造回滚。'
          },
          params: {
            channel: {
              en: 'IRemoteChannelResources acquired by the selected platform source; ownership remains with the original construction.',
              zh: '由所选平台来源取得的 `IRemoteChannelResources`，所有权仍归原始构造流程。'
            },
            signal: {
              en: 'Native construction cancellation signal supplied by the peer owner.',
              zh: '由连接拥有者提供的原生构造取消信号。'
            }
          },
          returns: {
            en: 'Promise of the endpoint assembled for this exact channel; throw or rejection preserves the original construction failure.',
            zh: '返回为此精确通道组装的端点 Promise，抛错或拒绝保留原始构造失败。'
          },
          default: {
            en: 'Omitted: the canonical runtime endpoint is assembled from the acquired channel and common options.',
            zh: '省略时根据已取得通道与通用选项组装规范运行时端点。'
          },
          whenToUse: {
            en: 'Supply this advanced callback only when the application owns a complete served endpoint; reject construction if that endpoint cannot be acquired.',
            zh: '仅在应用拥有完整服务端点时提供此高级回调；无法取得端点时拒绝构造。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        self: {
          summary: {
            en: 'Application-supplied safe identity with nonempty name and instanceId; neither credentials nor arbitrary properties are published.',
            zh: '应用提供的安全身份，含非空名称与实例标识，不会发布凭据或任意额外属性。'
          },
          default: {
            en: 'Omitted: the core uses RUNTIME_PEER_DEFAULT_NAME and a generated defaultRpcId; trusted platform bootstrap may supply its own identity.',
            zh: '省略时核心使用默认连接名称常量与自动生成的实例标识，可信平台启动数据也可提供自身身份。'
          }
        },
        provide: {
          summary: {
            en: 'Application-provided local methods, descriptors or allowed runtime forwarding entries compiled into the accepted directory; methods receive the remote payload and preserve synchronous or async failures.',
            zh: '应用提供的本端方法、描述符或获准运行时转发条目，会编译为已接受目录；方法接收远端载荷，同步或异步失败均保留。'
          },
          default: {
            en: 'Omitted: this side publishes no application methods.',
            zh: '省略时本端不发布任何应用方法。'
          }
        },
        providerLimits: {
          summary: {
            en: 'Provider admission policy forwarded to the canonical endpoint; it does not alter transport framing or acquire another provider registry.',
            zh: '转交规范端点的提供方接纳策略，不改变传输分帧，也不另建提供方登记表。'
          },
          default: {
            en: 'Omitted: the original endpoint or listener admission owner supplies its standard provider limits.',
            zh: '省略时由原端点或监听接纳拥有者提供标准提供方限制。'
          }
        },
        authentication: {
          summary: {
            en: 'Original signing, verification and optional encryption configuration installed into canonical endpoint assembly; invalid credentials reject construction before publication.',
            zh: '安装到规范端点组装的原始签名、校验与可选加密配置，非法凭据会在发布前拒绝构造。'
          },
          default: {
            en: 'Omitted: no authentication middleware is added by these options.',
            zh: '省略时不通过本选项增加认证中间件。'
          },
          whenToUse: {
            en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
            zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        probe: {
          summary: {
            en: 'One IRpcProbe or an array of probes from the application, installed as endpoint-local synchronous observers without selecting a different pipeline.',
            zh: '应用提供的一个或多个 `IRpcProbe`，安装为端点本地同步观察者，不会据此选择另一套管线。'
          },
          default: {
            en: 'Omitted: no observer is added by this field.',
            zh: '省略时不通过此字段增加观察者。'
          }
        },
        defaultTimeoutMs: {
          summary: {
            en: 'Finite positive millisecond default for request and stream calls, validated before acquiring source resources; it does not extend the notify or group timeout scope.',
            zh: '请求与流调用使用的有限正毫秒默认值，在取得来源资源前校验，不扩展通知或分组操作的超时作用域。'
          },
          default: {
            en: '30000 ms for request and stream in the original timeout scope.',
            zh: '默认三万毫秒，仅用于原有请求与流超时作用域。'
          }
        },
        contract: {
          summary: {
            en: 'Optional IRemoteContract with explicit method schemas, supported modes and idempotency declarations, compiled by the original remote contract owner.',
            zh: '可选的 `IRemoteContract`，提供显式方法模式、支持的调用方式与幂等声明，由原远端契约拥有者编译。'
          },
          default: {
            en: 'Omitted: provided method definitions supply the normal inferred runtime directory.',
            zh: '省略时根据已提供的方法定义推导通常的运行时目录。'
          }
        },
        report: {
          summary: {
            en: 'Synchronous callback receives background or contained failures as error; no return is consumed, and failure handling stays with the original runtime reporter owner.',
            zh: '同步回调以错误参数接收后台或隔离的失败，不消费返回值，失败处理仍归既有运行时报告拥有者。'
          },
          params: {
            error: {
              en: 'Original background or secondary failure supplied by the runtime owner.',
              zh: '来自运行时拥有者的原始后台或次级失败。'
            }
          },
          returns: {
            en: 'No result is used; reporter errors are contained by the reporting boundary.',
            zh: '不使用返回结果，报告函数失败由报告边界隔离。'
          },
          default: {
            en: 'Omitted: defaultRpcReporter reports to console.error.',
            zh: '省略时默认报告函数输出到控制台错误通道。'
          },
          whenToUse: {
            en: 'Keep local diagnostics with this Peer’s owner; keyFactory is inherited but direct requests do not read it.',
            zh: '把本地诊断交给此对端所有者；keyFactory 是继承配置，直接请求不会读取。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        keyFactory: {
          summary: {
            en: 'Advanced remote-proxy key callback returning an application string for automatically keyed retry paths. The direct createRpcHost assembly does not read this inherited field itself.',
            zh: '高级远程代理键回调，返回应用字符串供自动分配键的重试路径使用；直接运行时连接组装本身不读取这个继承字段。'
          },
          default: {
            en: 'Omitted: proxy paths use defaultRpcId when generating keys; direct peer call keys retain their own call-option semantics.',
            zh: '省略时代理生成键使用默认标识工厂，直接连接调用仍按自身调用选项处理幂等键。'
          },
          whenToUse: {
            en: 'Direct Peer requests do not consult this inherited policy. Use a managed or remote proxy dispatch path when logical-key or retry policy is required.',
            zh: '直接 Peer 请求不读取此继承策略；需要逻辑键或重试策略时，使用托管或远端代理派发路径。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        retryPort: {
          summary: {
            en: 'Advanced application-supplied retry dispatch port for remote-proxy paths; it receives the original retry input and returns the selected dispatch result. Direct createRpcHost assembly does not read it itself.',
            zh: '高级应用重试派发端口，供远程代理路径接收原始重试输入并返回所选派发结果；直接运行时连接组装本身不读取它。'
          },
          default: {
            en: 'Omitted: the remote proxy keeps its original retry dispatch owner; no second retry policy is installed by a direct peer.',
            zh: '省略时远程代理保留原重试派发拥有者，直接连接不会额外安装另一套重试策略。'
          },
          whenToUse: {
            en: 'Direct Peer requests do not consult this inherited policy. Use a managed or remote proxy dispatch path when logical-key or retry policy is required.',
            zh: '直接 Peer 请求不读取此继承策略；需要逻辑键或重试策略时，使用托管或远端代理派发路径。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        'authentication.encrypt': {
          summary: {
            en: 'Outbound sync/async encryption runs after the endpoint wraps its encoded value with replay metadata and before signing. Throw/rejection normally becomes AUTHENTICATION_FAILED with its cause.',
            zh: '出站同步或异步加密在端点为编码值包装重放元数据后、签名前执行；抛错或拒绝通常成为保留原因的认证失败。'
          },
          params: {
            value: {
              en: 'Replay-bound authentication envelope produced by the endpoint, including its encoded payload; not the bare application payload.',
              zh: '端点生成、绑定重放信息的认证消息封装，包含编码载荷，不是裸应用负载。'
            },
            context: {
              en: 'IRpcAuthenticationContext issued by the endpoint: direction is outbound/inbound, endpointId is its local identifier and platform is its configured IRpcPlatformValue.',
              zh: '端点签发的认证上下文：方向为出站或入站，端点标识来自本端，平台为已配置的 `IRpcPlatformValue`。'
            }
          },
          returns: {
            en: 'Encrypted value or its Promise, passed unchanged into sign.',
            zh: '返回加密值或其 Promise，原样传入签名阶段。'
          },
          default: {
            en: 'Leave encrypt and decrypt out together when messages need signatures but not encryption. In that case, sign receives the unencrypted authentication envelope: the message data together with the information used to detect replay. Omitting encryption does not remove signing or verification.',
            zh: '消息只需要签名、不需要加密时，应同时省略 encrypt 和 decrypt。此时 sign 直接接收未加密的认证数据封装，其中包含消息数据和用于识别重复发送的信息。省略加密不会省去签名与验证。'
          },
          whenToUse: {
            en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
            zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        'authentication.decrypt': {
          summary: {
            en: 'Inbound sync/async decryption runs on the value recovered by verify. The endpoint then validates the recovered authentication envelope and replay binding.',
            zh: '入站同步或异步解密处理验证阶段恢复的值；随后端点校验恢复的认证消息封装与重放绑定。'
          },
          params: {
            value: {
              en: 'Verified protected value returned by verify.',
              zh: '验证阶段返回的已验证受保护值。'
            },
            context: {
              en: 'IRpcAuthenticationContext issued by the endpoint: direction is outbound/inbound, endpointId is its local identifier and platform is its configured IRpcPlatformValue.',
              zh: '端点签发的认证上下文：方向为出站或入站，端点标识来自本端，平台为已配置的 `IRpcPlatformValue`。'
            }
          },
          returns: {
            en: 'Recovered replay-bound authentication envelope or its Promise; throw/rejection normally becomes AUTHENTICATION_FAILED with the original cause.',
            zh: '返回恢复的重放绑定认证消息封装或其 Promise；抛错或拒绝通常成为保留原始原因的认证失败。'
          },
          default: {
            en: 'Omit decrypt only when encrypt is also omitted. After verify checks the signature and recovers the inner value, the endpoint directly checks that value as the authentication envelope, including its replay information. It does not try to decrypt the value.',
            zh: '只有同时省略 encrypt 时，才可以省略 decrypt。verify 验证签名并恢复内部值后，端点会直接检查该值是否符合认证数据封装格式，并检查用于识别重复发送的信息，不再进行解密。'
          },
          whenToUse: {
            en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
            zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        'authentication.sign': {
          summary: {
            en: 'Outbound sync/async signing runs after optional encryption and returns the complete protected frame representation. Signing and verification are required even without encryption.',
            zh: '出站同步或异步签名在可选加密后执行，返回完整受保护帧表示；即使不加密，也必须配置签名与验证。'
          },
          params: {
            value: {
              en: 'Encrypted value when encrypt exists, otherwise the replay-bound authentication envelope.',
              zh: '存在加密阶段时接收加密值，否则接收重放绑定认证消息封装。'
            },
            context: {
              en: 'IRpcAuthenticationContext issued by the endpoint: direction is outbound/inbound, endpointId is its local identifier and platform is its configured IRpcPlatformValue.',
              zh: '端点签发的认证上下文：方向为出站或入站，端点标识来自本端，平台为已配置的 `IRpcPlatformValue`。'
            }
          },
          returns: {
            en: 'Signed representation or its Promise; throw/rejection normally becomes AUTHENTICATION_FAILED. Keep the declared encodedType output domain.',
            zh: '返回签名表示或其 Promise；抛错或拒绝通常成为认证失败，输出须符合声明的编码值域。'
          },
          default: {
            en: 'There is no default signing function. Provide sign together with verify whenever authentication is enabled. This remains required when encrypt and decrypt are configured: encryption alone is insufficient, and omitting sign rejects the configuration.',
            zh: '没有默认签名函数。启用认证时，必须同时提供 sign 和 verify。即使已经配置 encrypt 和 decrypt，也仍然需要签名；只加密而省略 sign 会使配置被拒绝。'
          },
          whenToUse: {
            en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
            zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        'authentication.verify': {
          summary: {
            en: 'Inbound sync/async verification receives the protected frame and must recover its authenticated inner value; returning a boolean is not a verification verdict protocol.',
            zh: '入站同步或异步验证接收受保护帧，必须恢复其经过认证的内部值；布尔返回值不是验证结论协议。'
          },
          params: {
            value: {
              en: 'Protected value received at the authentication pipeline edge.',
              zh: '从认证管线边界接收到的受保护值。'
            },
            context: {
              en: 'IRpcAuthenticationContext issued by the endpoint: direction is outbound/inbound, endpointId is its local identifier and platform is its configured IRpcPlatformValue.',
              zh: '端点签发的认证上下文：方向为出站或入站，端点标识来自本端，平台为已配置的 `IRpcPlatformValue`。'
            }
          },
          returns: {
            en: 'Authenticated inner value or its Promise, passed to decrypt when configured; reject or throw on invalid signatures. Local reporting retains the original verification failure, which may be sensitive; the peer receives a sanitized summary. Other returned values still undergo envelope/replay validation.',
            zh: '返回认证内部值或其 Promise，配置了解密时传给解密；签名非法时应拒绝或抛错，本地报告保留可能敏感的原校验失败，对端只接收净化摘要，其它返回值仍需通过消息封装及重放校验。'
          },
          default: {
            en: 'There is no default verification function. Provide verify together with sign so incoming protected messages can be checked and their inner values recovered. If sign is supplied without verify, construction rejects the configuration before the endpoint becomes active.',
            zh: '没有默认验证函数。必须把 verify 与 sign 配套提供，才能检查收到的受保护消息并恢复其内部值。提供 sign 却缺少 verify 时，构造会在端点启用前拒绝配置。'
          },
          whenToUse: {
            en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
            zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        'authentication.encodedType': {
          summary: {
            en: 'Declared protected-output domain must match the next physical pipeline edge. Encrypt/decrypt and sign/verify are complete pairs, at least signing is required, and encryption additionally requires signing.',
            zh: '声明的受保护输出域须匹配后续物理管线边界；加解密与签名验证各自须完整，至少配置签名，加密还必须有签名。'
          },
          default: {
            en: 'any: do not impose a declared protected-output value category.',
            zh: '`any`：不声明额外受保护输出值类别。'
          },
          values: {
            any: {
              en: 'Leave the declared output domain unconstrained; transforms may still change representation.',
              zh: '不限制声明输出值域，转换仍可改变表示。'
            },
            string: {
              en: 'Declare that the protected output is text for the subsequent pipeline edge.',
              zh: '声明受保护输出为文本，供后续管线边界使用。'
            },
            uint8array: {
              en: 'Declare that the protected output is a byte array for the subsequent pipeline edge.',
              zh: '声明受保护输出为字节数组，供后续管线边界使用。'
            }
          },
          whenToUse: {
            en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
            zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        spawn: {
          summary: {
            en: 'Application source callback receiving the safe local identity and capability offer; choose exactly one source.',
            zh: '应用来源回调接收安全本端身份及能力提议；只能选择一种来源。'
          },
          default: {
            en: 'Omitting spawn means this Peer starts no execution unit through that source. Select connect to reach an existing peer, or listen to accept one; exactly one source is required.',
            zh: '省略 spawn 时，Peer 不会通过此来源启动执行单元。应选择 connect 连接已有对端，或选择 listen 接收对端；三种来源必须且只能选择一种。'
          },
          params: {
            context: {
              en: 'IRuntimePeerSourceContext from this preparation, containing its self identity and actual offered capabilities; no public abort signal is added to this context.',
              zh: '本次准备提供的来源上下文，含本端身份与实际提议能力，不向此公开上下文额外添加中止信号。'
            }
          },
          returns: {
            en: 'Promise of a complete IRuntimePeerSourceResult with agreed pipeline and features; failure rejects construction and rolls back resources already acquired.',
            zh: '返回完整来源结果的 Promise，包含已约定管线与特性；失败拒绝构造，并回滚已经取得的资源。'
          },
          whenToUse: {
            en: 'The application source supplies a real negotiated channel; direct Peer calls use their existing dispatcher and do not consult retryPort.',
            zh: '应用来源提供真实已协商通道；直接 Peer 调用使用现有派发器，不读取 retryPort。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        connect: {
          summary: {
            en: 'Application source callback opening a channel to an existing peer; choose exactly one source.',
            zh: '应用来源回调打开通往已有对端的通道；只能选择一种来源。'
          },
          default: {
            en: 'Omitting connect means no outgoing connection is opened through this source. Choose spawn to start a peer or listen to accept one instead; exactly one source is required.',
            zh: '省略 connect 时，不会通过此来源主动打开连接。应改选 spawn 启动对端，或选择 listen 接收连接；三种来源必须且只能选择一种。'
          },
          params: {
            context: {
              en: 'IRuntimePeerSourceContext from this preparation, containing its self identity and actual offered capabilities; no public abort signal is added to this context.',
              zh: '本次准备提供的来源上下文，含本端身份与实际提议能力，不向此公开上下文额外添加中止信号。'
            }
          },
          returns: {
            en: 'Promise of a complete IRuntimePeerSourceResult with agreed pipeline and features; failure rejects construction and rolls back resources already acquired.',
            zh: '返回完整来源结果的 Promise，包含已约定管线与特性；失败拒绝构造，并回滚已经取得的资源。'
          },
          whenToUse: {
            en: 'The application source supplies a real negotiated channel; direct Peer calls use their existing dispatcher and do not consult retryPort.',
            zh: '应用来源提供真实已协商通道；直接 Peer 调用使用现有派发器，不读取 retryPort。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        listen: {
          summary: {
            en: 'Application source callback accepting a negotiated peer channel; choose exactly one source.',
            zh: '应用来源回调接受协商后的对端通道；只能选择一种来源。'
          },
          default: {
            en: 'Omitting listen means this Peer does not accept incoming connections through this source. Choose spawn or connect for the initiating side; exactly one source is required.',
            zh: '省略 listen 时，Peer 不会通过此来源接收传入连接。主动建立连接的一端应选择 spawn 或 connect；三种来源必须且只能选择一种。'
          },
          params: {
            context: {
              en: 'IRuntimePeerSourceContext from this preparation, containing its self identity and actual offered capabilities; no public abort signal is added to this context.',
              zh: '本次准备提供的来源上下文，含本端身份与实际提议能力，不向此公开上下文额外添加中止信号。'
            }
          },
          returns: {
            en: 'Promise of a complete IRuntimePeerSourceResult with agreed pipeline and features; failure rejects construction and rolls back resources already acquired.',
            zh: '返回完整来源结果的 Promise，包含已约定管线与特性；失败拒绝构造，并回滚已经取得的资源。'
          },
          whenToUse: {
            en: 'The application source supplies a real negotiated channel; direct Peer calls use their existing dispatcher and do not consult retryPort.',
            zh: '应用来源提供真实已协商通道；直接 Peer 调用使用现有派发器，不读取 retryPort。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        }
      },
      optionCases: [
        {
          title: {
            en: 'Connect checkout to a negotiated pricing channel',
            zh: '将结算页接到已协商的价格通道'
          },
          problem: {
            en: 'The platform adapter’s openPricingChannel returns a real negotiated channel for checkout. Use connect for an existing service and a local timeout for a responsive checkout; send background failures to monitoring.',
            zh: '平台适配器的 openPricingChannel 为结算页返回真实协商通道。用 connect 连接已有服务，并设置本地期限以保持结算响应；后台失败交给监控。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'Checkout receives prices through the adapter’s channel and reports background failures centrally.',
            zh: '结算页通过适配器通道取得价格，并集中上报后台失败。'
          },
          covers: ['self', 'connect', 'defaultTimeoutMs', 'report']
        },
        {
          title: {
            en: 'Serve prices with bounded provider work',
            zh: '限制价格处理任务的并发'
          },
          problem: {
            en: 'A pricing worker accepts an incoming channel and runs expensive lookups. Register the declared price methods before serving, and cap concurrent work so a caller cannot fill the worker with lookups.',
            zh: '价格 Worker 接受入站通道，并执行昂贵查询。服务开始前登记声明的价格方法，再限制并发，避免单个调用者用查询占满 Worker。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The provider exposes its declared price method with global and per-peer concurrency budgets.',
            zh: '提供方公开声明的价格方法，并应用全局与每个对端的并发预算。'
          },
          covers: ['provide', 'listen', 'contract', 'providerLimits']
        },
        {
          title: {
            en: 'Trace one pricing connection',
            zh: '追踪一条价格连接'
          },
          problem: {
            en: 'Operations need to inspect one troublesome connection without adding logging to business handlers. Attach a probe that snapshots events before forwarding them to the application collector.',
            zh: '排查时需要检查某条异常连接，却不想改业务处理函数。附加 probe，在交给应用接收器前将事件快照化。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
          result: {
            en: 'The collector receives stable message trace snapshots for this peer.',
            zh: '接收器取得该对端的稳定消息追踪快照。'
          },
          covers: ['probe']
        }
      ]
    },

    IRuntimePeerIdentity: {
      summary: {
        en: 'Frozen display name and per-instance identity, separate from authentication principal.',
        zh: '冻结的显示名称与逐实例标识，与认证主体分开。'
      },
      members: {
        name: {
          summary: {
            en: 'Application-selected nonempty local display name or canonical peer fallback.',
            zh: '应用选择的非空本端显示名称，或规范连接后备名称。'
          }
        },
        instanceId: {
          summary: {
            en: 'Application-provided or factory-generated unique instance identifier.',
            zh: '应用提供或工厂生成的唯一实例标识。'
          }
        }
      }
    },
    IRuntimePeerProvide: {
      summary: {
        en: 'Own enumerable data methods or nested groups authored by the application; no accessors, reserved paths or noncallable leaves are admitted.',
        zh: '应用编写的自有可枚举数据方法或嵌套方法组，不接纳访问器、保留路径及不可调用叶子。'
      },
      members: {}
    },
    IRuntimePeerSource: {
      summary: {
        en: 'Async application callback receiving IRuntimePeerSourceContext and returning a fully agreed IRuntimePeerSourceResult; acquisition failures abort construction.',
        zh: '异步应用回调接收 `IRuntimePeerSourceContext`，返回完整约定的 `IRuntimePeerSourceResult`，获取失败中止构造。'
      },
      members: {}
    },
    IRuntimePeerSourceContext: {
      summary: {
        en: 'Safe local identity and offered capabilities passed to the actual platform source.',
        zh: '传给实际平台来源的安全本端身份及能力提议。'
      },
      members: {
        self: {
          summary: {
            en: 'Identity issued by this exact peer preparation.',
            zh: '当前精确连接准备过程签发的身份。'
          }
        },
        capabilities: {
          summary: {
            en: 'Capabilities implemented by the selected endpoint assembly.',
            zh: '所选端点组装实际实现的能力列表。'
          }
        }
      }
    },
    IRuntimePeerSourceResult: {
      summary: {
        en: 'Agreed channel with optional cold-receive activation handed to the endpoint owner.',
        zh: '已约定通道及可选冷接收激活操作，转交给端点拥有者。'
      },
      members: {
        transport: {
          summary: {
            en: 'Original physical transport supplied by the platform channel owner.',
            zh: '平台通道拥有者提供的原始物理传输。'
          }
        },
        peerId: {
          summary: {
            en: 'Remote endpoint identifier established by handshake or trusted platform bootstrap.',
            zh: '由握手或受信平台启动过程确定的远端端点标识。'
          }
        },
        scheduler: {
          summary: {
            en: 'Monotonic clock and timers shared with the platform binding.',
            zh: '与平台绑定共用的单调时钟和计时器。'
          }
        },
        agreement: {
          summary: {
            en: 'Accepted negotiated or explicitly static codec and capability agreement.',
            zh: '已接受的协商结果或显式静态编解码与能力约定。'
          }
        },
        pipeline: {
          summary: {
            en: 'Actual codec and framer selected by that agreement.',
            zh: '由该约定选定的实际编解码器与帧处理器。'
          }
        },
        features: {
          summary: {
            en: 'Endpoint features that must be installed in its initial construction batch.',
            zh: '必须在端点首次构造批次中安装的特性。'
          }
        },
        close: {
          summary: {
            en: 'Releases the channel-owned physical resources after endpoint teardown.',
            zh: '端点清理后释放通道拥有的物理资源。'
          },
          params: {},
          returns: {
            en: 'Promise completing channel cleanup; ownership and repeat-call semantics belong to the concrete channel.',
            zh: '返回通道清理 Promise，所有权及重复调用语义由具体通道决定。'
          },
          example: 'await channel.close()'
        },
        activateReceive: {
          summary: {
            en: 'Optional synchronous callback activating captured receive delivery only after endpoint registration; thrown activation failures trigger construction rollback.',
            zh: '可选同步回调，仅在端点登记后激活已捕获消息交付；激活抛错会触发构造回滚。'
          },
          params: {},
          returns: {
            en: 'No return value is consumed; activation is complete when the synchronous callback returns.',
            zh: '不消费返回值；同步回调返回时激活已经完成。'
          }
        }
      }
    },
    IRuntimePluginTyping: {
      summary: {
        en: 'Compile-time metadata connecting remote, provide, exposure and runtime slot without granting runtime authority.',
        zh: '编译期元数据，将远端、提供方法、暴露与运行时槽位关联，不授予运行时权限。'
      },
      members: {
        name: {
          summary: {
            en: 'Literal registration name supplied by the application plugin factory.',
            zh: '应用插件工厂提供的字面登记名称。'
          }
        }
      },
      scenarios: [
        {
          en: 'Infer exposed callable paths from a typed installed Host.',
          zh: '从已安装的带类型宿主推导可暴露调用路径。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    IRuntimeExpose: {
      summary: {
        en: 'Compile-time whitelist of installed plugin names, dotted callable paths and the explicit host control entry.',
        zh: '已安装插件名称、点分可调用路径及显式宿主控制入口组成的编译期白名单。'
      },
      members: {}
    },
    IRuntimeFlatten: {
      summary: {
        en: 'Type-only flattening of nested method groups into dotted paths; runtime descriptor admission remains authoritative.',
        zh: '将嵌套方法组展平为点分路径的纯类型运算，运行时描述符接纳仍为权威。'
      },
      members: {}
    },
    IRuntimeRegistry: {
      summary: {
        en: 'Type-level installed plugin tuple extracted from a real typed Host.',
        zh: '从真实带类型宿主提取的类型级已安装插件元组。'
      },
      members: {}
    },
    IRuntimeProcessStopOptions: {
      summary: {
        en: 'Graceful process stop inputs used only for an execution-owned connection.',
        zh: '仅拥有执行所有权的连接使用的进程优雅停止输入。'
      },
      members: {
        graceMs: {
          summary: {
            en: 'Caller-selected finite nonnegative time for graceful completion.',
            zh: '调用方选择的有限非负优雅完成时长。'
          }
        },
        signal: {
          summary: {
            en: 'Only the existing graceful process signal is admitted.',
            zh: '仅接纳现有的进程优雅停止信号。'
          },
          values: {
            SIGTERM: {
              en: 'Request graceful process termination.',
              zh: '请求进程优雅终止。'
            }
          }
        }
      }
    },
    IRuntimeThreadStopOptions: {
      summary: {
        en: 'Grace interval before the owned thread termination operation.',
        zh: '拥有的线程执行终止前使用的宽限间隔。'
      },
      members: {
        graceMs: {
          summary: {
            en: 'Caller-selected finite nonnegative graceful-completion interval.',
            zh: '调用方选择的有限非负优雅完成间隔。'
          }
        }
      }
    },
    IRpcRemoteLayerErrorCode: {
      summary: {
        en: 'Value union of RpcRemoteLayerErrorCode; branch on source and code together.',
        zh: '`RpcRemoteLayerErrorCode` 的值联合，须同时根据来源与错误码分支。'
      },
      members: {}
    },
    IRpcHostOptions: {
      summary: {
        en: 'Cold host configuration captured before its unique endpoint is opened.',
        zh: '在唯一端点打开前捕获的冷宿主配置。'
      },
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      members: {
        plugins: {
          summary: {
            en: 'Required exact registered objects: one transport, at most one assembler, and one instance per feature definition.',
            zh: '必填精确登记对象：一个传输、至多一个装配器，每种功能定义至多一次。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        provide: {
          summary: {
            en: 'Nested local methods compiled into the accepted directory; duplicate names reject.',
            zh: '编译进已接纳目录的嵌套本地方法，重名拒绝。'
          },
          default: {
            en: 'Omitted: no application providers.',
            zh: '省略时没有应用提供方。'
          },
          example:
            "import type { IRpcHost, IRpcContext } from '@migaia/rpc-host'\n\nexport function exposeWork(host: IRpcHost) {\n  host.provide({\n    double: (value: number) => value * 2,\n    values: async function* (end: number) {\n      for (let value = 0; value < end; value++) yield value\n    },\n    wait: (_value: unknown, context: IRpcContext) => {\n      if (context.signal.aborted) throw context.signal.reason\n      return new Promise<void>((_resolve, reject) => {\n        context.signal.addEventListener('abort', () => reject(context.signal.reason), {\n          once: true\n        })\n      })\n    }\n  })\n}"
        },
        self: {
          summary: {
            en: 'Caller-selected name/instanceId; a genuine child bootstrap supplies original self/generation before endpoint creation and rejects explicit mismatch.',
            zh: '调用者选定的名称与实例标识；真实子端启动帧在端点创建前提供原身份及代次，显式不匹配拒绝。'
          },
          default: {
            en: 'Omitted: canonical unique identity or the genuine child bootstrap identity.',
            zh: '省略时采用规范唯一身份或真实子端启动身份。'
          }
        },
        defaultTimeoutMs: {
          summary: {
            en: 'Call default below per-call timeoutMs and above timeoutFeature.',
            zh: '低于单次调用选项、高于期限功能的调用默认。'
          },
          default: {
            en: 'Omitted: preserve feature/canonical call defaults.',
            zh: '省略时保留功能或原调用默认。'
          }
        },
        providerLimits: {
          summary: {
            en: 'Original rate, payload, concurrency and admission limits. Native session policies remain bound to verified sender identity.',
            zh: '原速率、负载、并发和准入限制，原生会话策略仍绑定已验证发送者。'
          },
          default: {
            en: 'Omitted: canonical provider defaults.',
            zh: '省略时使用原提供方默认。'
          }
        },
        authentication: {
          summary: {
            en: 'Paired signing/verification and optional encryption configuration. Actual carrier qualification still controls native transfer.',
            zh: '成对签名验证及可选加密配置，原生转移仍由真实载体资格控制。'
          },
          default: {
            en: 'Omitted: no configured authentication transforms.',
            zh: '省略时没有配置认证变换。'
          }
        },
        contract: {
          summary: {
            en: 'Portable method modes, idempotency and input/output/yield schemas exchanged through the accepted directory.',
            zh: '通过已接纳目录交换的可移植方法模式、幂等性和输入、输出、产出模式。'
          },
          default: {
            en: 'Omitted: compile local callable declarations canonically.',
            zh: '省略时按原规则编译本地可调用声明。'
          }
        },
        report: {
          summary: {
            en: 'Application diagnostics receive original errors; reporter failures follow the canonical host route.',
            zh: '应用诊断接收原始错误，报告器失败走原宿主路径。'
          },
          default: {
            en: 'Omitted: defaultRpcReporter.',
            zh: '省略时使用原默认报告器。'
          }
        },
        signal: {
          summary: {
            en: 'Caller-owned cancellation for preparation and host lifetime, preserving the abort reason and resource rollback.',
            zh: '调用者拥有的准备及宿主寿命取消信号，保留取消原因和资源回滚。'
          },
          default: {
            en: 'Omitted: no external cancellation signal.',
            zh: '省略时没有外部取消信号。'
          }
        }
      }
    },
    IRpcHost: {
      summary: {
        en: 'Typed bidirectional calls on one canonical endpoint. Generic capabilities are erased at runtime; actual accepted directories authorize methods.',
        zh: '唯一规范端点上的带类型双向调用，泛型能力在运行时擦除，实际已接纳目录授权方法。'
      },
      scenarios: [
        {
          en: 'Combine direct calls, broadcasts, provide and held forwarding.',
          zh: '组合直连、广播、本地提供和持有转发。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      members: {
        self: {
          summary: {
            en: 'Accepted local identity, distinct from remote native generations.',
            zh: '已接纳本地身份，与远端原生代次分开。'
          }
        },
        peers: {
          summary: {
            en: 'Nested held direct capabilities bind exact accepted generations. They reject after retirement; pool exposes only its logical target.',
            zh: '嵌套持有直连能力绑定准确已接纳代次，退场后拒绝，池只公开其逻辑目标。'
          }
        },
        provide: {
          summary: {
            en: 'Incrementally register local nested methods without replacing existing names.',
            zh: '增量登记本地嵌套方法，不替换已有名称。'
          },
          params: {
            definition: {
              en: 'Application functions or held forwarded capabilities.',
              zh: '应用函数或持有转发能力。'
            }
          },
          returns: {
            en: 'Void after registration; duplicate names reject and retain the old provider.',
            zh: '登记后返回空值，重名拒绝并保留原提供方。'
          },
          example:
            "import type { IRpcHost, IRpcContext } from '@migaia/rpc-host'\n\nexport function exposeWork(host: IRpcHost) {\n  host.provide({\n    double: (value: number) => value * 2,\n    values: async function* (end: number) {\n      for (let value = 0; value < end; value++) yield value\n    },\n    wait: (_value: unknown, context: IRpcContext) => {\n      if (context.signal.aborted) throw context.signal.reason\n      return new Promise<void>((_resolve, reject) => {\n        context.signal.addEventListener('abort', () => reject(context.signal.reason), {\n          once: true\n        })\n      })\n    }\n  })\n}"
        },
        request: {
          summary: {
            en: 'Invoke current direct targets: zero gives empty settlements, one returns scalar/rejects, many retain independent results.',
            zh: '调用当前直连目标：零目标返回空结算，单目标返回标量或拒绝，多目标保留独立结果。'
          },
          params: {
            method: {
              en: 'Application method from the accepted directory.',
              zh: '从已接纳目录取得的业务方法。'
            },
            args: {
              en: 'Typed payload and optional original call options.',
              zh: '带类型的负载及可选原调用选项。'
            }
          },
          returns: {
            en: 'Scalar or IRpcFanoutResult Promise; pool schedules one member exactly once.',
            zh: '返回标量或逐目标结果的承诺，池只调度一个成员执行一次。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        notify: {
          summary: {
            en: 'Await physical sending without waiting for remote provider acknowledgement; options.targetId can select one direct peer.',
            zh: '等待物理发送但不等远端提供方确认，选项目标标识可选择一个直连。'
          },
          params: {
            method: {
              en: 'Application method from the accepted directory.',
              zh: '从已接纳目录取得的业务方法。'
            },
            args: {
              en: 'Typed payload and optional original call options.',
              zh: '带类型的负载及可选原调用选项。'
            }
          },
          returns: {
            en: 'Void or per-target result Promise; physical failure retains its original cause.',
            zh: '返回空值或逐目标结果的承诺，物理失败保留原原因。'
          },
          example:
            "import type { IRpcHost } from '@migaia/rpc-host'\n\ntype IApi = { update(value: number): number }\nexport async function sendUpdates(host: IRpcHost<IApi>) {\n  await host.notify('update', 1, { targetId: 'worker' })\n  const outcomes = await host.group([\n    { method: 'update', payload: 2 },\n    { method: 'update', payload: 3 }\n  ])\n  return outcomes\n}"
        },
        stream: {
          summary: {
            en: 'Open independent lazy iterators; returning one does not cancel the others.',
            zh: '打开独立惰性迭代器，返回其中一个不取消其他迭代器。'
          },
          params: {
            method: {
              en: 'Application method from the accepted directory.',
              zh: '从已接纳目录取得的业务方法。'
            },
            args: {
              en: 'Typed payload and optional original call options.',
              zh: '带类型的负载及可选原调用选项。'
            }
          },
          returns: {
            en: 'One iterator or a per-target iterator result; return partially consumed streams.',
            zh: '返回一个迭代器或逐目标迭代器结果，部分消费后须返回。'
          },
          example:
            "import type { IRpcHost } from '@migaia/rpc-host'\n\ntype IWorkers = {\n  worker: {\n    double(value: number): number\n    values(end: number): AsyncIterable<number>\n  }\n}\n\nexport async function useWorker(host: IRpcHost<IWorkers>) {\n  const answer: number = await host.send('worker', 'double', 21)\n  const values: number[] = []\n  for await (const value of host.peers.worker.values(3)) values.push(value)\n  return { answer, values }\n}"
        },
        group: {
          summary: {
            en: 'Send ordered steps to each target; a pool selects one member for the entire group.',
            zh: '向各目标发送有序步骤，池为整组选一个成员。'
          },
          params: {
            steps: {
              en: 'Ordered application method/payload steps.',
              zh: '应用编写的有序方法与负载步骤。'
            },
            options: {
              en: 'Original group policy and limits.',
              zh: '原分组策略与限制。'
            }
          },
          returns: {
            en: 'Ordered step outcomes or fanout Promise; no cross-target transaction.',
            zh: '返回有序步骤或逐目标结果的承诺，不提供跨目标事务。'
          },
          example:
            "import type { IRpcHost } from '@migaia/rpc-host'\n\ntype IApi = { update(value: number): number }\nexport async function sendUpdates(host: IRpcHost<IApi>) {\n  await host.notify('update', 1, { targetId: 'worker' })\n  const outcomes = await host.group([\n    { method: 'update', payload: 2 },\n    { method: 'update', payload: 3 }\n  ])\n  return outcomes\n}"
        },
        outcome: {
          summary: {
            en: 'Query original retained idempotency outcomes; a pool selects one member rather than searching all stores.',
            zh: '查询原保留幂等结果，池选一个成员而非搜索全部存储。'
          },
          params: {
            idempotencyKey: {
              en: 'Logical operation key issued by the application.',
              zh: '应用签发的逻辑操作键。'
            }
          },
          returns: {
            en: 'Original outcome or fanout Promise; disconnection alone does not prove whether business ran.',
            zh: '返回原结果或逐目标结果的承诺，断开本身不能证明业务是否执行。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        send: {
          summary: {
            en: 'Address one current direct name or peer ID. Dotted methods can ask that target to resolve its own live direct namespace.',
            zh: '定向一个当前直连名称或标识，带点方法可请求该目标解析自身存活直连名称空间。'
          },
          params: {
            targetId: {
              en: 'Current accepted name or peer ID.',
              zh: '当前已接纳名称或对端标识。'
            },
            method: {
              en: 'Application method from the accepted directory.',
              zh: '从已接纳目录取得的业务方法。'
            },
            args: {
              en: 'Typed payload and optional original call options.',
              zh: '带类型的负载及可选原调用选项。'
            }
          },
          returns: {
            en: 'One scalar Promise. TARGET_UNKNOWN precedes method lookup when the target is absent or reconnecting.',
            zh: '返回一个标量承诺，目标缺失或重连时先于方法查找拒绝。'
          },
          example:
            "import type { IRpcHost } from '@migaia/rpc-host'\n\ntype IWorkers = {\n  worker: {\n    double(value: number): number\n    values(end: number): AsyncIterable<number>\n  }\n}\n\nexport async function useWorker(host: IRpcHost<IWorkers>) {\n  const answer: number = await host.send('worker', 'double', 21)\n  const values: number[] = []\n  for await (const value of host.peers.worker.values(3)) values.push(value)\n  return { answer, values }\n}"
        },
        dispatch: {
          summary: {
            en: 'Send a direct call through the original fire-and-report route.',
            zh: '沿原发送并报告路径进行直连调用。'
          },
          params: {
            targetId: {
              en: 'Accepted direct name or ID.',
              zh: '已接纳直连名称或标识。'
            },
            method: {
              en: 'Application method from the accepted directory.',
              zh: '从已接纳目录取得的业务方法。'
            },
            args: {
              en: 'Typed payload and optional original call options.',
              zh: '带类型的负载及可选原调用选项。'
            }
          },
          returns: {
            en: 'Void; later errors report rather than supplying physical-send acknowledgement.',
            zh: '返回空值，后续错误报告，不提供物理发送确认。'
          },
          example:
            "import type { IRpcHost } from '@migaia/rpc-host'\n\ntype IApi = { update(value: number): number }\nexport async function sendUpdates(host: IRpcHost<IApi>) {\n  await host.notify('update', 1, { targetId: 'worker' })\n  const outcomes = await host.group([\n    { method: 'update', payload: 2 },\n    { method: 'update', payload: 3 }\n  ])\n  return outcomes\n}"
        },
        describe: {
          summary: {
            en: 'Read safe host/direct connection details and optional pool statistics.',
            zh: '读取安全宿主、直连详情与可选池统计。'
          },
          params: {
            options: {
              en: 'Original overview/query options.',
              zh: '原概览查询选项。'
            }
          },
          returns: {
            en: 'Safe snapshot; unavailable native facts remain explicitly unavailable.',
            zh: '返回安全快照，缺失原生事实明确保持不可用。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        on: {
          summary: {
            en: 'Subscribe to original runtime events without another lifecycle owner.',
            zh: '订阅原运行时事件，不创建另一寿命所有者。'
          },
          params: {
            event: {
              en: 'Name from RuntimeEventName.',
              zh: '来自原事件名称常量的名称。'
            },
            listener: {
              en: 'Application listener for the original event projection.',
              zh: '接收原事件投影的应用监听者。'
            }
          },
          returns: {
            en: 'Exact unsubscribe receipt releases only this listener.',
            zh: '返回精确退订回执，仅释放该监听者。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        close: {
          summary: {
            en: 'Drain original assemblers/native owners, revoke sessions, and release features in their owning scopes.',
            zh: '排空原装配器及原生所有者、撤回会话并按归属释放功能。'
          },
          params: {},
          returns: {
            en: 'Repeated calls share one Promise; cleanup failures remain reachable and do not replace a primary error.',
            zh: '重复调用共用一个承诺，清理失败可追踪且不替换主错误。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Use language-managed disposal for the same close operation.',
            zh: '以语言管理的释放执行同一次关闭。'
          },
          params: {},
          returns: {
            en: 'Same original close Promise and ownership.',
            zh: '保持同一原关闭承诺与归属。'
          },
          example:
            "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
        }
      }
    },
    IRpcHostNotifyOptions: {
      summary: {
        en: 'Original call options plus optional selection of one current direct target.',
        zh: '原调用选项加上对一个当前直连目标的可选选择。'
      },
      example:
        "import type { IRpcHost } from '@migaia/rpc-host'\n\ntype IApi = { update(value: number): number }\nexport async function sendUpdates(host: IRpcHost<IApi>) {\n  await host.notify('update', 1, { targetId: 'worker' })\n  const outcomes = await host.group([\n    { method: 'update', payload: 2 },\n    { method: 'update', payload: 3 }\n  ])\n  return outcomes\n}",
      members: {
        signal: {
          summary: {
            en: 'Caller-owned signal cancelling the logical call, preserving the actual abort reason.',
            zh: '调用方持有的信号，用于取消逻辑调用并保留实际取消原因。'
          },
          default: {
            en: 'Omitted: no caller cancellation signal.',
            zh: '省略时不附加调用方取消信号。'
          }
        },
        timeoutMs: {
          summary: {
            en: 'Finite nonnegative milliseconds, or false to disable the inherited deadline for this call.',
            zh: '有限非负毫秒数，或用显式`false`关闭本次调用的继承截止时间。'
          },
          default: {
            en: 'Omitted: request and stream inherit defaultTimeoutMs; other call kinds keep their original defaults.',
            zh: '省略时请求与流式调用继承默认截止时间，其他调用保留原默认行为。'
          },
          values: {
            false: {
              en: 'Disable the inherited deadline.',
              zh: '关闭继承的调用截止时间。'
            }
          }
        },
        idempotencyKey: {
          summary: {
            en: 'Application-issued key identifying the same logical operation across retries; use the original key for reconciliation.',
            zh: '应用为同一逻辑操作签发的键，重试时保持一致，核对结果时使用原键。'
          },
          default: {
            en: 'Omitted: automatic keys are generated only for declared idempotent requests.',
            zh: '省略时仅为声明幂等的请求自动生成键。'
          }
        },
        orderKey: {
          summary: {
            en: 'Application-selected lane key grouping calls for provider-wide ordered admission in the runtime profile.',
            zh: '应用选择的通道键，在运行时协议中将调用归入提供方统一有序接纳队列。'
          },
          default: {
            en: 'Omitted: no ordered lane is requested.',
            zh: '省略时不请求有序接纳通道。'
          }
        },
        cancel: {
          summary: {
            en: 'Cancellation intent evaluated by the final provider start boundary.',
            zh: '由最终提供方开始执行边界判断的取消意图。'
          },
          default: {
            en: 'Omitted: no before-start cancellation intent.',
            zh: '省略时不请求开始前取消。'
          },
          values: {
            'before-start': {
              en: 'Permit cancellation before the provider starts the invocation.',
              zh: '允许在提供方开始执行调用之前取消。'
            }
          }
        },
        transfer: {
          summary: {
            en: 'Caller-owned ArrayBuffers transferred through a carrier that actually supports native transfer.',
            zh: '由调用方拥有的缓冲区列表，经实际支持原生转移的传输对象转移。'
          },
          default: {
            en: 'Omitted: no explicit native ownership transfer.',
            zh: '省略时不显式请求原生所有权转移。'
          }
        },
        targetId: {
          summary: {
            en: 'Current direct name or ID, never a hidden pool member.',
            zh: '当前直连名称或标识，不能是隐藏池成员。'
          },
          default: {
            en: 'Omitted: broadcast to current direct targets.',
            zh: '省略时广播到当前直连集合。'
          },
          example:
            "import type { IRpcHost } from '@migaia/rpc-host'\n\ntype IApi = { update(value: number): number }\nexport async function sendUpdates(host: IRpcHost<IApi>) {\n  await host.notify('update', 1, { targetId: 'worker' })\n  const outcomes = await host.group([\n    { method: 'update', payload: 2 },\n    { method: 'update', payload: 3 }\n  ])\n  return outcomes\n}"
        }
      }
    },
    ITimeoutFeatureOptions: {
      summary: {
        en: 'Required default budget for canonical call timeouts.',
        zh: '原调用期限所需的默认预算。'
      },
      example:
        "import timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const deadline = timeoutFeature({ ms: 1500 })",
      members: {
        ms: {
          summary: {
            en: 'Finite nonnegative default call milliseconds, used only when neither the call nor the Host sets an explicit timeout; this does not change the handshake deadline.',
            zh: '有限非负的默认调用毫秒数，仅在单次调用与宿主都未显式设置超时时使用，不改变握手期限。'
          },
          example:
            "import timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const deadline = timeoutFeature({ ms: 1500 })"
        }
      }
    },
    ITypegenFeatureOptions: {
      summary: {
        en: 'Application output capability borrowed by installed generation.',
        zh: '已安装生成器借用的应用输出能力。'
      },
      example:
        "import { typegenFeature } from '@migaia/rpc-host/features'\n\nexport const declarations = typegenFeature({\n  out: {\n    write: (fileName, text) => {\n      console.log(fileName, text)\n    }\n  }\n})",
      members: {
        out: {
          summary: {
            en: 'ITypegenOutput supplied by the application; no native path access is granted.',
            zh: '应用提供的输出能力，不授予原生路径访问。'
          },
          example:
            "import { typegenFeature } from '@migaia/rpc-host/features'\n\nexport const declarations = typegenFeature({\n  out: {\n    write: (fileName, text) => {\n      console.log(fileName, text)\n    }\n  }\n})"
        }
      }
    },
    ITypegenOutput: {
      summary: {
        en: 'Application-owned synchronous/asynchronous declaration output.',
        zh: '应用拥有的同步或异步声明输出。'
      },
      example:
        "import { typegenFeature } from '@migaia/rpc-host/features'\n\nexport const declarations = typegenFeature({\n  out: {\n    write: (fileName, text) => {\n      console.log(fileName, text)\n    }\n  }\n})",
      members: {
        write: {
          summary: {
            en: 'Receive a safe filename and generated declaration; failures report through host.report.',
            zh: '接收安全文件名及生成声明，失败走宿主报告。'
          },
          params: {
            fileName: {
              en: 'Safe local filename issued by the generator.',
              zh: '生成器签发的安全本地文件名。'
            },
            text: {
              en: 'Declaration rendered from an accepted directory.',
              zh: '从已接纳目录渲染的声明。'
            }
          },
          returns: {
            en: 'Void or thenable; no subsequent writes after uninstall.',
            zh: '返回空值或可等待对象，卸载后不再写入。'
          },
          example:
            "import { typegenFeature } from '@migaia/rpc-host/features'\n\nexport const declarations = typegenFeature({\n  out: {\n    write: (fileName, text) => {\n      console.log(fileName, text)\n    }\n  }\n})"
        }
      }
    },
    IRpcConnectOptions: {
      summary: {
        en: 'One optional finite nonnegative timeout shared by the actual identity/capability handshake; it neither controls business calls nor restarts its budget between phases. Import from `@migaia/rpc-host/plugin`.',
        zh: '实际身份及能力握手共用的可选有限非负期限，不控制业务调用，也不在阶段之间重置预算。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRpcTransportPluginDefinition: {
      summary: {
        en: 'Cold transport registration: local name/expose, physical mode, exact deployment token and optional connect policy. Defining it acquires no native resource. Import from `@migaia/rpc-host/plugin`.',
        zh: '冷传输登记，含本地名称及公开选择、物理模式、精确部署令牌和可选连接策略；定义时不获取原生资源。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRpcHostContribution: {
      summary: {
        en: 'Policies supplied before the unique endpoint construction: canonical chunk root, features/middlewares, authentication, timeout, retry and probes. Existing owners retain execution and cleanup. Import from `@migaia/rpc-host/plugin`.',
        zh: '唯一端点构造前提交的策略，含原分块根、功能、中间件、认证、期限、重试及观察；执行和清理仍归原所有者。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRpcHostMember: {
      summary: {
        en: 'A single actual session projected from the host endpoint, with its member id and original callable/close surface. It does not own another endpoint. Import from `@migaia/rpc-host/plugin`.',
        zh: '从宿主端点投影的一条实际会话，含成员标识和原调用及关闭接口，不拥有另一个端点。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRpcHostAssembleContext: {
      summary: {
        en: 'Assembler input containing the actual host, transport name/mode and openMember. Each opening creates a private real session; the assembler publishes one logical member. Import from `@migaia/rpc-host/plugin`.',
        zh: '装配器输入，含实际宿主、传输名称模式及打开成员操作；每次打开产生私有真实会话，装配器仅公布一个逻辑成员。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRpcFeaturePluginDefinition: {
      summary: {
        en: 'Native feature registration with optional probe, endpoint contribution, setup and one member assembler. Setup cleanup belongs to the supplied host lifecycle. Import from `@migaia/rpc-host/plugin`.',
        zh: '带可选观察、端点策略、安装及唯一成员装配器的原生功能登记；安装清理归传入的宿主生命周期。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRpcTransportPlugin: {
      summary: {
        en: 'Exact registered native transport definition returned by the SDK, installable in createRpcHost or ordinary PluginHost. Copying fields does not retain its registration identity. Import from `@migaia/rpc-host/plugin`.',
        zh: '作者工具返回的精确原生传输定义，可安装统一宿主或普通插件宿主；复制字段不会保留登记身份。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRpcFeaturePlugin: {
      summary: {
        en: 'Exact native feature definition carrying its registered frozen surface. The host owns installation resources; the definition alone opens no connection. Import from `@migaia/rpc-host/plugin`.',
        zh: '带登记冻结接口的精确原生功能定义；宿主拥有安装资源，定义本身不打开连接。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRpcHostPlugin: {
      summary: {
        en: 'Union of actual registered transport and feature definitions admitted by the host. Caller-authored discriminator fields grant no plugin authority. Import from `@migaia/rpc-host/plugin`.',
        zh: '宿主接纳的实际登记传输及功能定义联合；调用者自写分类字段不授予插件权限。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimePeerDescription: {
      summary: {
        en: 'Version-two accepted application directory: actual self/generation, callable methods and optional negotiated node id. This data describes accepted capabilities; it does not mint channel trust. Import from `@migaia/rpc-host/plugin`.',
        zh: '第二版已接纳应用目录，含实际自身身份代次、可调用方法及可选协商节点标识；目录描述能力，不签发通道信任。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeMethodDescription: {
      summary: {
        en: 'Accepted method name, installed modes, declaration source, idempotency and optional input/output/yield schemas. forwardedVia is a display hint, not principal or mutation authority. Import from `@migaia/rpc-host/plugin`.',
        zh: '已接纳方法名称、安装模式、声明来源、幂等性及可选输入输出产出模式；转发提示不是主体或修改权限。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterDeploymentOptions: {
      summary: {
        en: 'Physical opening and local policy options for an adapter definition, with endpointFactory excluded. Raw deployment joins the host endpoint rather than constructing a callable source object. Import from `@migaia/rpc-host/plugin`.',
        zh: '适配器定义的物理打开及本地策略选项，排除端点工厂；原始部署接入宿主端点，不构造调用对象充当来源。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterJsonRpcChannelOptions: {
      summary: {
        en: 'Author-owned ordered byte I/O, direct address, explicit contract/catalog, local offer/token, clocks, IPC policy and reporter. The physical connection and credential issuance stay with the caller. Import from `@migaia/rpc-host/plugin`.',
        zh: '作者拥有的有序字节输入输出、直连地址、显式契约目录、本地提议凭据、时钟、通信策略及报告器；物理连接和凭据签发归调用者。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterPeerPreparation: {
      summary: {
        en: 'Read-only original preparation operations and local proposal data held for a genuine resource. No private context writer or accepted-capability setter is exposed. Import from `@migaia/rpc-host/plugin`.',
        zh: '为真实资源持有的原只读准备操作及本地提议数据，不公开私有上下文写入器或已接纳能力设置器。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterListenerPreparation: {
      summary: {
        en: 'Original native session preparation, policy attachment and membership publication interface. New host listener recipes use their supplied accept callback to borrow the shared endpoint. Import from `@migaia/rpc-host/plugin`.',
        zh: '原原生会话准备、策略附着及成员发布接口；新宿主监听配方通过传入的接纳回调借用共享端点。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterListenerSession: {
      summary: {
        en: 'Held original session stages for preparation, drain/governor attachment and adoption. Native integration retains the same bare/final resource across these stages. Import from `@migaia/rpc-host/plugin`.',
        zh: '持有的原会话准备、排空治理附着及采用阶段；原生集成跨阶段保留同一原始及最终资源。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterListenerService: {
      summary: {
        en: 'Actual accepted service handle and callable session retained by its native owner. Closing the handle releases that session, not unrelated host sessions. Import from `@migaia/rpc-host/plugin`.',
        zh: '由原生所有者保留的实际已接纳服务句柄及调用会话；关闭仅释放该会话，不影响无关宿主会话。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeObjectConnection: {
      summary: {
        en: 'Cold object-I/O preparation, actual reply negotiation and one final open. The retained agreement stays with the original connection, whose close joins its terminal cleanup. Import from `@migaia/rpc-host/plugin`.',
        zh: '冷对象输入输出准备、实际回复协商及唯一最终打开；保留协商归原连接，关闭共用其终态清理。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeByteDiagnostics: {
      summary: {
        en: 'Adapter-owned error identities and stable texts for EOF, timeout, authentication and byte profile failures. Shared byte machinery uses these without changing the adapter domain. Import from `@migaia/rpc-host/plugin`.',
        zh: '适配器拥有的结束、期限、认证及字节配置失败错误身份和稳定文本，共享字节机制使用它们而不改变适配器领域。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeConnectionOptions: {
      summary: {
        en: 'Local presentation, direct address, cancellation, handshake budget, scheduler, reporter and original IPC gate/log settings. Labels never establish provenance or authentication. Import from `@migaia/rpc-host/plugin`.',
        zh: '本地展示、直连地址、取消、握手预算、调度器、报告器及原通信准入日志设置；标签不建立来源或认证。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeByteOptions: {
      summary: {
        en: 'Shared connection options plus initiator/responder role and local offer. A responder chooses required verification or no authentication; only the original verifier result establishes principal identity. Import from `@migaia/rpc-host/plugin`.',
        zh: '共用连接选项加发起或响应角色及本地提议；响应方选择必需验证或无认证，仅原验证结果确定主体身份。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeByteConnection: {
      summary: {
        en: 'Negotiated raw byte channel with original logger and ownClose registration. Extra connection resources release before the physical close under the same owner. Import from `@migaia/rpc-host/plugin`.',
        zh: '含原日志器及关闭资源登记的已协商原始字节通道；附加资源由同一所有者在物理关闭前释放。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeProviderGovernor: {
      summary: {
        en: 'Per-connection rate/payload/idle governor exposing original limit, provider and stream admission operations. Its close retires only its timers and diagnostic subscriptions. Import from `@migaia/rpc-host/plugin`.',
        zh: '逐连接速率负载空闲治理器，公开原限制、提供方及流准入操作；关闭仅退休其定时器和诊断订阅。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeProviderScope: {
      summary: {
        en: 'Original shared idempotency store and provider admission scope. Session keys derive from authenticated channel identity; close the sessions before retiring this shared scope. Import from `@migaia/rpc-host/plugin`.',
        zh: '原共享幂等存储及提供方准入范围，会话键来自已认证通道身份；退休共享范围前先关闭会话。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterMessageResource: {
      summary: {
        en: 'Held raw messaging resource owning initial capture, identity/capability exchange and channel opening. Its close joins the original capture and physical/launch cleanup. Import from `@migaia/rpc-host/plugin`.',
        zh: '持有的原始消息资源，拥有首帧捕获、身份能力交换及通道打开；关闭共用原捕获及物理启动清理。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterEventEmitterMessagePort: {
      summary: {
        en: 'Structural native postMessage/on/off port with optional actual listenerCount and close observation. The holder subscribes without replacing other native listeners. Import from `@migaia/rpc-host/plugin`.',
        zh: '结构原生消息收发端口，可提供实际监听数量及关闭观察；持有器订阅时不替换其他原生监听者。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeObjectIO: {
      summary: {
        en: 'Actual physical hello exchange, text/object sends and subscriptions with one terminal lifetime. It supplies real replies; accepted agreement and paired-port qualification remain internal. Import from `@migaia/rpc-host/plugin`.',
        zh: '具有唯一终态寿命的实际物理问候交换、文本对象发送及订阅，提供真实回复；接纳协商和成对端口资格仍留内部。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeObjectChannel: {
      summary: {
        en: 'Original negotiated source result plus connection log and cleanup registration. It exposes no writer for provenance or trust facts. Import from `@migaia/rpc-host/plugin`.',
        zh: '原已协商来源结果加连接日志和清理登记，不公开来源或信任事实写入能力。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterDeployment: {
      summary: {
        en: 'Opaque cold recipe token minted by createAdapterDeployment. Only its exact registered object grants those raw source operations; copied fields grant nothing. Import from `@migaia/rpc-host/plugin`.',
        zh: '由部署工厂签发的不透明冷配方令牌，仅其精确登记对象授予原始来源操作，复制字段不授予权限。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterDeploymentContext: {
      summary: {
        en: 'Host-issued real self/offer, cancellation and connect budget, reporter, exact installed features and native launcher preparation. Cleanup is registered in the existing endpoint scope. Import from `@migaia/rpc-host/plugin`.',
        zh: '宿主签发的真实身份提议、取消连接预算、报告器、精确安装功能及原生启动准备；清理登记在既有端点作用域。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterDeploymentEndpointPreparation: {
      summary: {
        en: 'Original provider limits, scope/admission and optional execution/wrapping receipts for one accepted channel. They configure the shared endpoint instead of creating another one. Import from `@migaia/rpc-host/plugin`.',
        zh: '一条已接纳通道的原提供方限制、范围准入及可选执行包装回执，配置共享端点而非另建端点。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterDeploymentListener: {
      summary: {
        en: 'Native listener close receipt returned to host installation. It retains original listener/session ownership and terminal cleanup. Import from `@migaia/rpc-host/plugin`.',
        zh: '返回宿主安装的原生监听关闭回执，保留原监听会话归属及终态清理。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterDeploymentRecipe: {
      summary: {
        en: 'Cold raw open, optional listen/managed/bootstrap and per-channel policy callbacks. Native recipes return real sources/bindings; endpoint assembly and publication stay host-owned. Import from `@migaia/rpc-host/plugin`.',
        zh: '冷原始打开及可选监听托管启动和逐通道策略回调；原生配方返回真实来源绑定，端点装配和发布仍归宿主。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterManagedDeployment: {
      summary: {
        en: 'Original binding, optional real supervisor execution, replacement preparation, retry/key policy and drain attachment. Borrowed connections do not gain native execution authority. Import from `@migaia/rpc-host/plugin`.',
        zh: '原绑定、可选真实监督执行、替换准备、重试键策略及排空附着；借入连接不因此获得原生执行权限。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterByteBootstrapSource: {
      summary: {
        en: 'Opaque handle to the actual private byte bootstrap snapshot, not a caller-supplied identity record. Host adopts it before constructing its unique endpoint. Import from `@migaia/rpc-host/plugin`.',
        zh: '实际私有字节启动快照的不透明句柄，不是调用者提供的身份记录；宿主在构造唯一端点前采用它。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterBytePeerOptions: {
      summary: {
        en: 'Local runtime/platform presentation, canonical diagnostics and optional original IPC capacity/log overrides. It cannot supply decoded launch identity or negotiated capability claims. Import from `@migaia/rpc-host/plugin`.',
        zh: '本地运行时平台展示、原诊断及可选通信容量日志覆盖，不能提供已解码启动身份或协商能力声称。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterDeploymentAccept: {
      summary: {
        en: 'Listener callback accepting one real source result and optional original session policy; resolves the borrowed host session/endpoint receipt. The source keeps its physical lease. Import from `@migaia/rpc-host/plugin`.',
        zh: '监听回调接收一个真实来源结果及可选原会话策略，结算借用宿主会话端点回执；来源保留物理租约。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterDeploymentAcceptedSession: {
      summary: {
        en: 'Accepted member and borrowed endpoint returned to a native listener. Endpoint disposal retires that channel and never closes the entire host. Import from `@migaia/rpc-host/plugin`.',
        zh: '返回原生监听者的已接纳成员及借用端点，释放端点仅退休该通道，不关闭整个宿主。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterMessageBootstrapSource: {
      summary: {
        en: 'Opaque genuine native first-message receipt. It binds original resource, preparation and deadline without exposing ports or copyable accepted identity. Import from `@migaia/rpc-host/plugin`.',
        zh: '不透明真实原生首消息回执，绑定原资源、准备和期限，不公开端口或可复制接纳身份。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IAdapterMessageHandshakeBudget: {
      summary: {
        en: 'One borrowed monotonic scheduler and absolute preparation deadline shared by initial capture and capability acknowledgement. The budget itself owns no timer. Import from `@migaia/rpc-host/plugin`.',
        zh: '首帧捕获及能力确认共用的一个借入单调调度器和绝对准备期限，预算本身不拥有定时器。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeWebByteStreamOptions: {
      summary: {
        en: 'Adapter callbacks preserve acquisition/EOF/aggregate error identity and background reporting while the shared native reader/writer pump owns its lifetime. Import from `@migaia/rpc-host/plugin`.',
        zh: '适配器回调保留获取、结束、聚合错误身份及后台报告，共享原生读写泵拥有其寿命。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeByteStreamReader: {
      summary: {
        en: 'Structural native byte reader with read/cancel/releaseLock; the shared pump acquires one reader and releases its lock during terminal cleanup. Import from `@migaia/rpc-host/plugin`.',
        zh: '带读取、取消及释放锁操作的结构原生字节读取器，共享泵获取唯一读取器并在终态清理时释放锁。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeByteStreamWriter: {
      summary: {
        en: 'Structural native ordered writer with write and abort. Native promise settlement controls backpressure; the shared pump does not add another write queue. Import from `@migaia/rpc-host/plugin`.',
        zh: '带写入及终止的结构原生有序写入器，原生承诺结算控制背压，共享泵不添加另一写入队列。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeReadableByteStream: {
      summary: {
        en: 'Minimal getReader surface borrowed from a native readable stream. It keeps the shared byte owner independent of DOM-specific declarations. Import from `@migaia/rpc-host/plugin`.',
        zh: '从原生可读流借用的最小获取读取器接口，使共享字节所有者不依赖浏览器专有声明。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    },
    IRuntimeWritableByteStream: {
      summary: {
        en: 'Minimal getWriter surface supplying the single native writer retained by the shared byte owner. The surrounding session remains separately owned. Import from `@migaia/rpc-host/plugin`.',
        zh: '提供共享字节所有者保留的唯一原生写入器的最小接口，外层会话仍单独归属。从 `@migaia/rpc-host/plugin` 导入。'
      },
      members: {}
    }
  },
  enums: {
    RuntimeEventName: {
      summary: {
        en: 'Lifecycle events of runtime connections, observed with `on()` and `watch()`.',
        zh: '运行时连接的生命周期事件，可用 `on()` 与 `watch()` 观察。'
      },
      values: {
        ready: {
          en: '`ready`: a (new) generation completed its handshake and accepts calls.',
          zh: '`ready`：某个（新的）代次完成握手，可以接收调用。'
        },
        exit: {
          en: '`exit`: the worker or process exited; see `reason`, `code`, `signal`.',
          zh: '`exit`：工作线程或子进程已经退出；通过 `reason`、`code`、`signal` 检查原因。'
        },
        degraded: {
          en: '`degraded`: some capability (such as exit observation) is not available.',
          zh: '`degraded`：某些能力（例如退出观察）不可用。'
        },
        restart: {
          en: '`restart`: the supervisor starts a new generation; `count` says how many so far.',
          zh: '`restart`：监督器启动新的代次；`count` 表示已重启的次数。'
        },
        terminal: {
          en: '`terminal`: the supervisor gave up restarting; create or replace the unit.',
          zh: '`terminal`：监督器放弃重启；需要重新创建或替换该执行单元。'
        },
        liquidated: {
          en: '`liquidated`: the process resilience layer removed the registration; it cannot restart.',
          zh: '`liquidated`：进程容错层已移除该登记；它无法再重启。'
        }
      }
    },
    RpcCoreErrorCode: {
      summary: {
        en: 'Stable semantic failure codes owned by the runtime-neutral Core execution layer.',
        zh: '运行时中立核心执行层拥有的稳定语义失败码。'
      },
      values: {
        providerGenerationMismatch: {
          en: 'PROVIDER_GENERATION_MISMATCH: accepted caller/provider generation no longer matches the task; select the actual binding again.',
          zh: '提供方世代不匹配：已接受调用方或提供方世代与任务不符，应重新选择实际绑定。'
        },
        providerGenerationRetired: {
          en: 'PROVIDER_GENERATION_RETIRED: an admitted forwarded execution retired with its exact generation; never replay it.',
          zh: '对应的提供方代次已经结束；先前接受的转发执行随该代次失效，不能重放。'
        },
        forwardLoop: {
          en: 'FORWARD_LOOP: signed route revisits this or the selected next Host; choose another route.',
          zh: '转发环路错误：签名路由再次访问当前或下一宿主，应选择其他路由。'
        },
        forwardHopLimit: {
          en: 'FORWARD_HOP_LIMIT: three forwarding nodes were already visited; use a direct channel or shorter route.',
          zh: '转发跳数超限：已经访问三个转发节点，应使用直接通道或更短路由。'
        },
        middlewareDuplicated: {
          en: 'MIDDLEWARE_DUPLICATED: names repeat in the construction tuple; assign one unique name per middleware.',
          zh: '中间件重复错误：构造元组中名称重复，每个中间件必须使用唯一名称。'
        },
        middlewareMissing: {
          en: 'MIDDLEWARE_MISSING: the operation requires an actually installed connect, abort, ping or other middleware capability.',
          zh: '缺少中间件错误：操作要求实际安装连接、中止、心跳等中间件能力。'
        },
        capabilityUnsupported: {
          en: 'CAPABILITY_UNSUPPORTED: actual peer agreement does not support the requested runtime mode or capability.',
          zh: '能力不支持错误：实际对端协议不支持请求的运行模式或能力。'
        },
        invalidConfig: {
          en: 'INVALID_CONFIG: factory, component, transport or transform configuration is invalid; inspect detail and correct local inputs.',
          zh: '配置非法错误：工厂、组件、传输对象或转换配置无效，应检查细节并修正本地输入。'
        },
        probeFailed: {
          en: 'PROBE_FAILED: a diagnostic emit/describe/redact callback failed; business execution remains isolated.',
          zh: '诊断失败错误：观察、描述或脱敏回调失败，业务执行保持隔离。'
        },
        providerDuplicated: {
          en: 'PROVIDER_DUPLICATED: provide registered a method that already has an owner; change the method or combine providers.',
          zh: '提供方重复错误：登记方法已经有所有者，应改名或合并提供方。'
        },
        protocolInvalid: {
          en: 'PROTOCOL_INVALID: codec/protocol/envelope behavior or correlated control is invalid; inspect original cause.',
          zh: '协议非法错误：编解码、消息封装行为或关联控制非法，应检查原始原因。'
        },
        contractInvalid: {
          en: 'CONTRACT_INVALID: method correlation, direction or contract identity fields violate the actual request contract.',
          zh: '契约非法错误：方法关联、方向或契约身份字段违反实际请求契约。'
        },
        payloadInvalid: {
          en: 'PAYLOAD_INVALID: data, physical batch encoding or error projection violates its selected codec boundary.',
          zh: '载荷非法错误：数据、物理攒批编码或错误投影违反所选编解码边界。'
        },
        providerNotFound: {
          en: 'PROVIDER_NOT_FOUND: the receiving endpoint has no registered provider for the requested method.',
          zh: '提供方不存在错误：接收端没有为所请求方法登记提供方。'
        },
        providerNotSettled: {
          en: 'PROVIDER_NOT_SETTLED: a request provider returned without an explicit success or failed result.',
          zh: '提供方未结算错误：请求提供方返回时没有给出显式成功或失败结果。'
        },
        callbackFailed: {
          en: 'CALLBACK_FAILED: a construction or diagnostic callback failed; native mutable errors retain type, stack and identity, foreign semantic identities stay unchanged, and other values remain on cause.',
          zh: '回调失败错误：构造或诊断回调失败；可修改原生错误保留类型、堆栈及身份，外部语义身份保持不变，其它值保留在原因链。'
        },
        internal: {
          en: 'INTERNAL: provider threw unexpectedly; original error stays in local diagnostics while the peer receives a redacted failure.',
          zh: '内部错误：提供方发生意外抛错，原错误保留在本地诊断，对端收到脱敏失败。'
        },
        targetUnknown: {
          en: 'TARGET_UNKNOWN: target or receiver is unresolved, inactive or outside the original selected binding.',
          zh: '目标未知错误：目标或接收端未解析、不活动或不在原选定绑定内。'
        },
        targetNotIdentifiable: {
          en: 'TARGET_NOT_IDENTIFIABLE: anonymous broadcast group cannot satisfy a per-instance operation.',
          zh: '目标不可识别错误：匿名广播组不能满足针对单实例的操作。'
        },
        endpointDisposed: {
          en: 'ENDPOINT_DISPOSED: an operation used a disposed endpoint; construct a new owner instead.',
          zh: '端点已释放错误：操作使用已释放端点，应构造新的所有者。'
        },
        cancelled: {
          en: 'CANCELLED: actual caller AbortSignal cancelled the local send; remote effects may already have occurred.',
          zh: '取消错误：实际调用方信号取消本地发送，远端效果可能已经发生。'
        },
        deadlineExceeded: {
          en: 'DEADLINE_EXCEEDED: the local operation deadline expired; treat this transmission attempt as failed.',
          zh: '截止超时错误：本地操作截止已经到期，本次传输尝试视为失败。'
        },
        contextExpired: {
          en: 'PROVIDER_CONTEXT_EXPIRED: success or failed was called after the original provider lifetime ended; no wire effect is produced.',
          zh: '提供方上下文过期错误：生命周期结束后调用结果方法，不产生线上效果。'
        },
        transport: {
          en: 'TRANSPORT: actual physical send or terminal channel failed; preserve original transport evidence before choosing recovery. The code alone never proves nonexecution; retry requires independent evidence or idempotency/outcome reconciliation.',
          zh: '传输错误：实际物理发送或通道终止失败，恢复前保留原传输对象证据；单凭此码不能证明未执行，重试须有独立证据或幂等结果核对。'
        },
        authenticationFailed: {
          en: 'AUTHENTICATION_FAILED: signing, verification, encryption, decryption or original replay binding failed; details stay local.',
          zh: '认证失败错误：签名、校验、加密、解密或原重放绑定失败，细节保持本地。'
        },
        schemaInvalid: {
          en: 'SCHEMA_INVALID: params/result parse rejected the method data; inspect normalized issues and original cause.',
          zh: '结构非法错误：入参或结果解析拒绝方法数据，应检查规范问题及原始原因。'
        },
        capabilityConflict: {
          en: 'CAPABILITY_CONFLICT: selected middleware/features publish conflicting keys or an ambiguous runtime instance.',
          zh: '能力冲突错误：所选中间件或功能发布冲突键，或运行实例有歧义。'
        },
        overloaded: {
          en: 'OVERLOADED: execution/replay/discovery/chunk capacity refused new work; inspect its independent reason channel.',
          zh: '过载错误：执行、重放、发现或分片容量拒绝新工作，应检查独立原因通道。'
        },
        streamResultUnknown: {
          en: 'STREAM_RESULT_UNKNOWN: transport may have sent a stream frame before rejecting; open a new stream without replaying items.',
          zh: '流结果未知错误：传输对象可能已发送帧后拒绝，应新建流，不重放条目。'
        },
        chunkInvalid: {
          en: 'CHUNK_INVALID: physical fragment grammar is invalid; hooks observe it and the frame is not replayed.',
          zh: '分片非法错误：物理分片语法非法，钩子观察该错误且不重放帧。'
        },
        propertyReadFailed: {
          en: 'PROPERTY_READ_FAILED: a getter/proxy failed without a valid synchronous reporter, or that reporter threw.',
          zh: '属性读取失败错误：读取器或代理失败且无有效同步上报，或上报自身抛错。'
        },
        idempotencyResultUnavailable: {
          en: 'IDEMPOTENCY_RESULT_UNAVAILABLE: business already ran but result was not retained; resolve outcome before another attempt.',
          zh: '幂等结果不可用错误：业务已执行但结果未保留，再次尝试前须确定结果。'
        },
        stringConversionFailed: {
          en: 'STRING_CONVERSION_FAILED: conversion or its required synchronous reporter failed; preserve original cause.',
          zh: '字符串转换失败错误：转换或所需同步上报失败，应保留原始原因。'
        },
        hostTransportMissing: {
          en: 'Exactly one genuine transport is required before opening.',
          zh: '打开前必须提供一个真实传输。'
        },
        hostTransportDuplicate: {
          en: 'Multiple transports require separate hosts.',
          zh: '多个传输须使用不同宿主。'
        },
        hostPluginInvalid: {
          en: 'A copied or fabricated object lacks registered SDK identity.',
          zh: '复制或伪造对象不具备作者工具登记身份。'
        },
        hostAssemblerDuplicate: {
          en: 'Only one member assembler can own scheduling.',
          zh: '只能有一个成员装配器拥有调度。'
        },
        hostFeatureDuplicate: {
          en: 'A definition may be installed only once in one host.',
          zh: '同一种定义在一个宿主只能安装一次。'
        },
        hostPeerNameDuplicate: {
          en: 'A same-name peer is responsive, or its one probe is already pending; reject the newcomer.',
          zh: '同名对端仍响应，或其唯一探测尚未完成，拒绝新连接。'
        }
      }
    },
    RpcProviderRejectionReason: {
      summary: {
        en: 'Actual local provider refusal branches sharing the public overload/capacity failure channel.',
        zh: '共享公开过载容量失败通道的实际本地提供方拒绝分支。'
      },
      values: {
        orderedQueueFull: {
          en: 'Waiting plus running ordered work exhausted the original provider quota.',
          zh: '等待和运行中的有序工作耗尽原提供方配额。'
        },
        groupConcurrency: {
          en: 'The complete group could not reserve every step execution lease.',
          zh: '完整分组不能为全部步骤预留执行租约。'
        },
        groupReplayFull: {
          en: 'The complete group could not reserve every original replay entry.',
          zh: '完整分组不能预留全部原始重放条目。'
        },
        concurrency: {
          en: 'Global or actual verified-peer execution concurrency is full.',
          zh: '全局或实际已验证对端的执行并发已满。'
        },
        replayLedgerFull: {
          en: 'Inbound request tombstones cannot retain another original identity.',
          zh: '入站请求标识记录已满，无法再保留新的请求身份。'
        },
        outboundReplayFull: {
          en: 'Active outbound identities and tombstones exhausted their ceiling.',
          zh: '活动请求和已结束请求的出站标识记录已达到保留上限。'
        },
        bindingExpired: {
          en: 'The actual verified binding expired before provider execution started.',
          zh: '实际已验证绑定在提供方开始执行前过期。'
        }
      }
    },
    RpcPlatform: {
      summary: {
        en: 'Actual adapter platform labels used in endpoint diagnostics.',
        zh: '端点诊断使用的实际适配器平台标签。'
      },
      values: {
        broadcastChannel: {
          en: 'The actual adapter reports platform BroadcastChannel; this diagnostic label grants no native capability.',
          zh: '实际适配器报告 `BroadcastChannel` 平台，此诊断标签不赋予原生能力。'
        },
        iframe: {
          en: 'The actual adapter reports platform Iframe; this diagnostic label grants no native capability.',
          zh: '实际适配器报告 `Iframe` 平台，此诊断标签不赋予原生能力。'
        },
        memory: {
          en: 'The actual adapter reports platform Memory; this diagnostic label grants no native capability.',
          zh: '实际适配器报告 `Memory` 平台，此诊断标签不赋予原生能力。'
        },
        messagePort: {
          en: 'The actual adapter reports platform MessagePort; this diagnostic label grants no native capability.',
          zh: '实际适配器报告 `MessagePort` 平台，此诊断标签不赋予原生能力。'
        },
        process: {
          en: 'The actual adapter reports platform Process; this diagnostic label grants no native capability.',
          zh: '实际适配器报告 `Process` 平台，此诊断标签不赋予原生能力。'
        },
        rtcDataChannel: {
          en: 'The actual adapter reports platform RTCDataChannel; this diagnostic label grants no native capability.',
          zh: '实际适配器报告 `RTCDataChannel` 平台，此诊断标签不赋予原生能力。'
        },
        webTransport: {
          en: 'The actual adapter reports platform WebTransport; this diagnostic label grants no native capability.',
          zh: '实际适配器报告 `WebTransport` 平台，此诊断标签不赋予原生能力。'
        },
        worker: {
          en: 'The actual adapter reports platform Worker; this diagnostic label grants no native capability.',
          zh: '实际适配器报告 `Worker` 平台，此诊断标签不赋予原生能力。'
        }
      }
    },
    RpcTransportOwnership: {
      summary: {
        en: 'Determines which actual transport resources endpoint disposal may close.',
        zh: '决定端点释放可以关闭哪些实际传输对象资源。'
      },
      values: {
        owned: {
          en: 'Endpoint disposal closes actual resources owned by this adapter.',
          zh: '端点释放会关闭该适配器实际拥有的资源。'
        },
        borrowed: {
          en: 'Endpoint detaches its listeners but caller retains physical resource ownership.',
          zh: '端点只移除自身监听，物理资源仍由调用方拥有。'
        }
      }
    },
    RpcTransportEncoding: {
      summary: {
        en: 'Actual transport carrier domain matched to the selected codec and framer.',
        zh: '与所选编解码及分帧匹配的实际传输值类型。'
      },
      values: {
        any: {
          en: 'Transport accepts arbitrary complete message values.',
          zh: '载体接受任意完整消息值。'
        },
        string: {
          en: 'Transport accepts only complete string carriers.',
          zh: '载体只接受完整字符串载体。'
        },
        uint8Array: {
          en: 'Transport accepts genuine Uint8Array byte carriers.',
          zh: '传输对象接受真实字节数组传输对象。'
        }
      }
    },
    RpcTransportTopology: {
      summary: {
        en: 'Actual peer fan-out topology declared by the original adapter.',
        zh: '原适配器声明的实际对端扇出拓扑。'
      },
      values: {
        exclusive: {
          en: 'One original connection addresses exactly one peer.',
          zh: '一个原始连接精确寻址一个对端。'
        },
        multiplexed: {
          en: 'One transport carries several peer sources with actual source proof.',
          zh: '一个传输对象携带多个对端来源并提供实际来源证明。'
        },
        broadcast: {
          en: 'One send reaches a group; per-instance selection requires actual distinct identities.',
          zh: '一次发送到达一组，实例选择要求实际不同身份。'
        }
      }
    },

    RpcOperation: {
      summary: {
        en: 'Single-target operation category supplied to the actual receiver selector.',
        zh: '提供给实际接收端选择器的单目标操作类别。'
      },
      values: {
        send: {
          en: 'Select a receiver for one correlated scalar request.',
          zh: '为一个关联标量请求选择接收端。'
        },
        dispatch: {
          en: 'Select a receiver for one legacy one-way event.',
          zh: '为一个传统单向事件选择接收端。'
        },
        ping: {
          en: 'Select an actual receiver for a liveness check.',
          zh: '为存活检查选择一个实际接收端。'
        }
      }
    },
    RpcCandidateStatus: {
      summary: {
        en: 'Original discovery owner state of one actual receiver candidate.',
        zh: '原发现所有者给出的实际接收候选状态。'
      },
      values: {
        active: {
          en: 'Candidate is currently eligible for original selection.',
          zh: '候选当前可以参与原接收端选择。'
        },
        stale: {
          en: 'Candidate observation is stale; original selection applies its liveness policy.',
          zh: '候选观察已过期，原选择应用其存活策略。'
        },
        unregistered: {
          en: 'Candidate was explicitly removed from the original registry.',
          zh: '候选已从原始注册表中显式移除。'
        }
      }
    },
    RpcProbeStage: {
      summary: {
        en: 'Stable numeric stages follow one operation from logical ownership to actual physical I/O.',
        zh: '稳定数字阶段跟随一次操作，从逻辑所有权到实际物理读写。'
      },
      values: {
        peer: {
          en: 'Peer lifecycle and local settlement observations.',
          zh: '对端生命周期及本地结算的观察阶段。'
        },
        message: {
          en: 'Logical application request or response observation.',
          zh: '应用逻辑请求或响应的观察阶段。'
        },
        envelope: {
          en: 'Normalized protocol envelope observation before encoding.',
          zh: '编码之前规范协议消息封装的观察阶段。'
        },
        encoded: {
          en: 'Encoded semantic payload observation before framing.',
          zh: '分帧之前已编码语义载荷的观察阶段。'
        },
        frame: {
          en: 'Physical frame observation before protection.',
          zh: '保护之前物理分帧结果的观察阶段。'
        },
        protected: {
          en: 'Protected carrier observation after signing or encryption.',
          zh: '签名或加密之后受保护传输对象的观察阶段。'
        },
        carrier: {
          en: 'Actual adapter send/receive observation at physical I/O.',
          zh: '物理读写中实际适配器发送接收的观察阶段。'
        }
      }
    },
    RpcProbeDirection: {
      summary: {
        en: 'Numeric traffic directions distinguish original outbound, inbound and local observations.',
        zh: '数字流量方向区分原出站、入站及端点本地生命周期观察。'
      },
      values: {
        outbound: {
          en: 'The original endpoint is sending toward its peer.',
          zh: '原端点正在向实际对端发送流量。'
        },
        inbound: {
          en: 'The original endpoint is receiving from its peer.',
          zh: '原端点正在从实际对端接收流量。'
        },
        local: {
          en: 'The event concerns local lifecycle or settlement only.',
          zh: '该事件只涉及本地生命周期或结算。'
        }
      }
    },
    RpcProbeKind: {
      summary: {
        en: 'Numeric interaction kinds identify which original operation an event concerns.',
        zh: '数字交互种类标识事件涉及的原始请求、流及控制操作。'
      },
      values: {
        request: {
          en: 'A correlated application request enters the owner.',
          zh: '关联应用请求进入原所有者的处理路径。'
        },
        response: {
          en: 'A scalar result replies to an original request.',
          zh: '标量结果响应一个原始关联请求。'
        },
        notify: {
          en: 'A one-way application notification has no result wait.',
          zh: '单向应用通知不建立业务结果等待。'
        },
        streamOpen: {
          en: 'A streaming interaction opens its original lifetime.',
          zh: '流式交互打开自身原始生命周期。'
        },
        streamChunk: {
          en: 'One item belongs to the original stream.',
          zh: '一个条目属于已经打开的原始流。'
        },
        streamClose: {
          en: 'The original stream ends, fails or closes.',
          zh: '原始流正常结束、失败或被关闭。'
        },
        cancel: {
          en: 'A cancellation observation concerns admitted work.',
          zh: '取消观察涉及已经准入的工作。'
        },
        control: {
          en: 'A protocol control observation carries no new business call.',
          zh: '协议控制观察不产生新的业务调用。'
        },
        lifecycle: {
          en: 'The event describes local lifecycle transitions.',
          zh: '该事件描述本地生命周期状态变化。'
        }
      }
    },
    RpcProbeOutcome: {
      summary: {
        en: 'Numeric outcomes describe progress, admission and settlement at the observed stage.',
        zh: '数字结果描述实际观察阶段中的操作进度、准入及最终结算。'
      },
      values: {
        none: {
          en: 'No specific progress result applies to this event.',
          zh: '此事件不适用更具体的进度结果。'
        },
        created: {
          en: 'The original owner created the observed operation.',
          zh: '原所有者已经创建被观察的操作。'
        },
        sent: {
          en: 'The owning send boundary completed successfully.',
          zh: '所属发送边界已经成功完成发送。'
        },
        received: {
          en: 'The observing owner received the original value.',
          zh: '观察所有者已经收到原始输入值。'
        },
        admitted: {
          en: 'The original operation passed its admission checks.',
          zh: '原始操作已经通过自身准入检查。'
        },
        rejected: {
          en: 'The original operation failed its admission checks.',
          zh: '原始操作未能通过自身准入检查。'
        },
        settled: {
          en: 'The original operation completed its settlement.',
          zh: '原始操作已经完成自身结算过程。'
        },
        failed: {
          en: 'The observed original boundary completed with failure.',
          zh: '被观察的原始边界已经失败结束。'
        }
      }
    },
    IpcReporterContext: {
      summary: {
        en: 'Frozen utils reporter classification with operation limiter and phase reporter; use it only for secondary IPC observer failures.',
        zh: '冻结的工具上报分类，操作为限制器、阶段为上报者，只用于次级进程通信观察失败。'
      },
      values: {
        operation: {
          en: 'limiter identifies the existing concurrency-limiter diagnostic owner.',
          zh: '限制器值标识现有并发限制诊断所有者。'
        },
        phase: {
          en: 'reporter identifies a failure in the observer failure sink itself.',
          zh: '上报阶段值表示观察者失败接收器自身发生失败。'
        }
      }
    },
    IpcLogEventName: {
      summary: {
        en: 'Connection-local diagnostic event names distinguish capacity transitions, send failures and explicit process stderr.',
        zh: '连接本地诊断事件名区分容量变化、发送失败及显式进程标准错误。'
      },
      values: {
        'ipc.backlog.high': {
          en: 'Accepted capacity reached or exceeded ceil(capacity * 0.75), after previously being below its high watermark.',
          zh: '已准入容量达到或超过容量乘零点七五的向上取整值，且此前尚未处于高水位。'
        },
        'ipc.backlog.low': {
          en: 'After a high event, accepted capacity drained to or below floor(capacity * 0.5).',
          zh: '高水位事件后，已准入容量降到容量乘零点五的向下取整值或更低。'
        },
        'ipc.backlog.rejected': {
          en: 'The corresponding whole-envelope lane refused capacity.',
          zh: '对应完整消息封装通道拒绝容量准入。'
        },
        'ipc.send.failed': {
          en: 'The original physical send or diagnostic dispatch failed.',
          zh: '原物理发送或诊断派发发生失败。'
        },
        'ipc.stderr': {
          en: 'An explicit process standard-error record is supplied locally.',
          zh: '本地显式提供进程标准错误记录。'
        }
      }
    },
    IpcSendClass: {
      summary: {
        en: 'Whole-envelope admission reserves separate total capacities for business data and control messages.',
        zh: '完整消息封装准入分别为业务数据及控制消息预留总容量。'
      },
      values: {
        data: {
          en: 'Business requests, replies and stream data use the data lane.',
          zh: '业务请求、响应及流数据使用数据通道。'
        },
        control: {
          en: 'Cancellation, liveness and outcome control use reserved control capacity.',
          zh: '取消、存活及结果控制使用预留控制容量。'
        }
      }
    },
    RemoteMethodMode: {
      summary: {
        en: 'Declared V1 method invocation modes.',
        zh: '第一版契约声明的方法调用模式，决定结果、单向交付或迭代器消费方式。'
      },
      values: {
        request: {
          en: 'Await one scalar portable result; only this mode may declare idempotency.',
          zh: '等待单个可移植标量结果，只有此模式可声明幂等。'
        },
        oneWay: {
          en: 'Send without waiting for a method result.',
          zh: '发送后不等待方法返回结果。'
        },
        generator: {
          en: 'Consume items from a synchronous iterator over the stream protocol.',
          zh: '通过流式协议消费同步迭代器的元素。'
        },
        asyncGenerator: {
          en: 'Consume items from an asynchronous iterator over the stream protocol.',
          zh: '通过流式协议消费异步迭代器的元素。'
        }
      }
    },
    RuntimeApiMode: {
      summary: {
        en: 'Actual installed V2 runtime call routes.',
        zh: '第二版运行时实际安装的调用路由模式，由真实安装能力确定可用操作。'
      },
      values: {
        request: {
          en: 'Request one portable scalar result.',
          zh: '请求并等待单个可移植结果。'
        },
        notify: {
          en: 'Dispatch without a result.',
          zh: '派发后不等待返回结果。'
        },
        stream: {
          en: 'Read an asynchronous item sequence.',
          zh: '读取异步产出的元素序列。'
        }
      }
    },
    RuntimeSourceKind: {
      summary: {
        en: 'Local connection source selection.',
        zh: '本端连接来源的选择方式，分别对应启动、主动连接或接受连接。'
      },
      values: {
        spawn: {
          en: 'Classify this as the spawning source; actual execution ownership comes from its platform adapter, not the label.',
          zh: '将此来源归类为启动，实际执行所有权来自平台适配器，不由标签授予。'
        },
        connect: {
          en: 'Source dials an existing peer.',
          zh: '来源主动连接到已有对端。'
        },
        listen: {
          en: 'Source accepts an incoming peer connection.',
          zh: '来源接受一个对端连接。'
        }
      }
    },
    RuntimeConnectionDirection: {
      summary: {
        en: 'Who established the physical connection.',
        zh: '记录物理连接由哪一方建立，区分父端启动、子端回连与连接接纳。'
      },
      values: {
        spawned: {
          en: 'This side started the unit.',
          zh: '本端启动对端执行单元。'
        },
        spawnedBy: {
          en: 'This side was started by its parent.',
          zh: '本端由其父端启动并回连。'
        },
        connect: {
          en: 'This side initiated connection.',
          zh: '本端主动建立对端连接。'
        },
        listen: {
          en: 'This side accepted connection.',
          zh: '本端接受外部传入的连接。'
        }
      }
    },
    RuntimePluginKey: {
      summary: {
        en: 'Canonical runtime outlet names; labels grant no execution ownership.',
        zh: '规范运行时出口名称，标签本身不授予执行所有权。'
      },
      values: {
        process: {
          en: 'Canonical outlet for process connections.',
          zh: '进程连接使用的规范出口。'
        },
        thread: {
          en: 'Canonical outlet for thread connections.',
          zh: '线程连接使用的规范出口。'
        },
        coroutine: {
          en: 'Cooperative coroutine outlet.',
          zh: '协作式协程使用的出口。'
        }
      }
    },
    RuntimeQueryStatus: {
      summary: {
        en: 'Observed connection or metric availability.',
        zh: '观察到的连接状态或指标可用性，无法观察时明确返回不可用事实。'
      },
      values: {
        unavailable: {
          en: 'The owner cannot observe this fact.',
          zh: '拥有者无法观察此项事实。'
        },
        ready: {
          en: 'The accepted connection is ready.',
          zh: '已接受的连接处于就绪状态。'
        },
        closed: {
          en: 'The logical connection has closed.',
          zh: '所查询的逻辑连接已经关闭。'
        },
        departed: {
          en: 'The selected generation left.',
          zh: '本次查询选定的代次已经离开。'
        }
      }
    },
    RemoteMethodName: {
      summary: {
        en: 'Reserved remote control routes, excluded from application methods.',
        zh: '保留的远程控制路由，应用方法不得占用，目录与宿主控制使用这些固定名称。'
      },
      values: {
        runtimeDescribe: {
          en: 'Read the accepted runtime directory.',
          zh: '读取已接受的运行时目录。'
        },
        runtimeStreamPrefix: {
          en: 'Prefix for internal stream routes.',
          zh: '内部流式路由使用的前缀。'
        },
        runtimeNamespace: {
          en: 'Reserved namespace excluding automatic provide paths.',
          zh: '自动提供方法不得占用的保留命名空间。'
        },
        hostUse: {
          en: 'Install or adopt a catalog plugin.',
          zh: '安装或接纳目录中的插件。'
        },
        hostUnUse: {
          en: 'Remove a plugin adopted by this connection.',
          zh: '移除本连接已经接纳的插件。'
        },
        hostInspect: {
          en: 'Inspect adopted remote Host state.',
          zh: '检查已接纳的远程宿主状态。'
        }
      }
    },
    RpcRemoteLayerErrorCode: {
      summary: {
        en: 'Stable remote-layer errors and caller recovery actions.',
        zh: '稳定的远程层错误及调用方恢复方式，区分契约错误、未接纳与结果未知。'
      },
      values: {
        runtimeEventOverflow: {
          en: 'More than 100 unread passive events; query current state and resubscribe.',
          zh: '被动事件未读数量超过一百，应查询当前状态后重新订阅。'
        },
        contractInvalid: {
          en: 'Description or control payload is invalid; correct it before retry.',
          zh: '描述或控制负载不合法，修正后再重试。'
        },
        hostNotAdopted: {
          en: 'This connection lacks live adoption; perform host use before removal.',
          zh: '本连接尚未接纳当前登记，移除前先执行宿主安装接纳。'
        },
        startFailed: {
          en: 'Unit preparation or channel acquisition failed; inspect the cause.',
          zh: '执行单元准备或通道获取失败，应检查原始原因。'
        },
        closed: {
          en: 'Registration was released or generation left; wait for valid readiness.',
          zh: '登记已释放或代次已离开，应等待有效就绪状态。'
        },
        resultUnknown: {
          en: 'A sent request lost its result after departure; reconcile before repeating a non-idempotent operation.',
          zh: '已发送请求在离开后丢失结果，应先核对再重复非幂等操作。'
        }
      }
    },
    RpcTransportMode: {
      summary: {
        en: 'Physical source selection for the original preparation owner; a mode label alone grants no native or connection authority.',
        zh: '选择原准备所有者的物理来源模式，单独模式标签不授予原生或连接权限。'
      },
      values: {
        spawn: {
          en: 'Open a locally supervised native resource.',
          zh: '打开本地监督的原生资源。'
        },
        connect: {
          en: 'Connect one existing remote resource.',
          zh: '连接一个既有远端资源。'
        },
        listen: {
          en: 'Accept independent incoming sessions.',
          zh: '接纳独立入站会话。'
        },
        'connect-to-parent': {
          en: 'Attach using the actual launching parent source.',
          zh: '使用实际启动父端来源接入。'
        }
      }
    },
    JsonRpcProfile: {
      summary: {
        en: 'Canonical fixed JSON-RPC bridge wire vocabulary, owned by rpc-contract and re-exported for adapter authors. Changing a label does not enable another profile.',
        zh: '契约层拥有并向适配器作者重导出的固定桥接协议词汇，修改标签不会启用另一协议。'
      },
      values: {
        carrier: {
          en: 'Physical JSON-RPC carrier label in observation.',
          zh: '观察中的物理桥接载体标签。'
        },
        version: {
          en: 'Required JSON-RPC version 2.0.',
          zh: '必需的协议版本。'
        },
        capability: {
          en: 'Negotiated bridge-profile capability.',
          zh: '协商的桥接协议能力。'
        },
        wireError: {
          en: 'Capability for the full portable error chain.',
          zh: '完整可移植错误链能力。'
        },
        hello: {
          en: 'Responder identity/capability exchange method.',
          zh: '响应方身份及能力交换方法。'
        },
        describe: {
          en: 'Responder accepted-directory description method.',
          zh: '响应方已接纳目录描述方法。'
        },
        invoke: {
          en: 'Responder scalar invocation method.',
          zh: '响应方标量调用方法。'
        },
        cancel: {
          en: 'Responder correlated cancellation method.',
          zh: '响应方关联取消方法。'
        },
        incomingIdPrefix: {
          en: 'Local core correlation prefix, separate from the foreign reply id.',
          zh: '本地规范关联前缀，与外部回复标识分开。'
        },
        applicationVersion: {
          en: 'Fixed route grammar version for translated calls.',
          zh: '翻译调用使用的固定路由语法版本。'
        }
      }
    },
    JsonRpcErrorNumber: {
      summary: {
        en: 'Standard numeric foreign-error classifications; they do not replace the canonical semantic source/code or original cause.',
        zh: '外部错误的标准数字分类，不替换规范语义领域错误码或原原因。'
      },
      values: {
        parse: {
          en: 'Malformed JSON text.',
          zh: '格式错误的序列化文本。'
        },
        invalidRequest: {
          en: 'Invalid JSON-RPC request shape.',
          zh: '非法协议请求形状。'
        },
        methodNotFound: {
          en: 'Responder has no selected method.',
          zh: '响应方没有选定方法。'
        },
        invalidParams: {
          en: 'Invalid invocation parameters.',
          zh: '非法调用参数。'
        },
        internal: {
          en: 'Responder internal failure.',
          zh: '响应方内部失败。'
        },
        business: {
          en: 'Application business failure represented on the bridge.',
          zh: '经桥接表示的应用业务失败。'
        }
      }
    },
    RpcCarrierDetailKey: {
      summary: {
        en: 'Canonical physical observation field names. These measurements describe native activity and never authorize a source or infer business completion.',
        zh: '规范物理观察字段名称，测量仅描述原生活动，不授权来源或推断业务完成。'
      },
      values: {
        transfers: {
          en: 'Outbound transfer-list length; inbound uses the unknown marker because native delivery hides transfer mode.',
          zh: '出站转移列表长度，入站因原生交付隐藏转移模式而使用未知标记。'
        },
        frameBytes: {
          en: 'Known physical frame length including framing bytes.',
          zh: '包含分帧字节的已知物理帧长度。'
        },
        drainMs: {
          en: 'Observed native false-write backpressure until actual drain.',
          zh: '观察到的原生背压直到实际排空的时长。'
        },
        jsonrpcId: {
          en: 'Foreign wire correlation id before core translation.',
          zh: '规范翻译前的外部协议关联标识。'
        },
        jsonrpcMethod: {
          en: 'Foreign wire method before provider namespace translation.',
          zh: '提供方名称空间翻译前的外部协议方法。'
        },
        batchSize: {
          en: 'Physical JSON-RPC object count; an ordinary object counts as one.',
          zh: '物理桥接对象数量，普通对象计一个。'
        }
      }
    },
    MessageResourceEvent: {
      summary: {
        en: 'Native message-resource event names shared by first-frame capture and transport construction. Subscribe through the canonical resource rather than taking a second reader.',
        zh: '首帧捕获及传输构造共用的原生消息资源事件名，应经规范资源订阅而不另占读取器。'
      },
      values: {
        message: {
          en: 'Native message payload delivery.',
          zh: '原生消息载荷交付。'
        },
        messageerror: {
          en: 'Native message deserialization failure.',
          zh: '原生消息反序列化失败。'
        },
        error: {
          en: 'Native resource failure.',
          zh: '原生资源失败。'
        },
        close: {
          en: 'Native resource terminal close.',
          zh: '原生资源终态关闭。'
        }
      }
    }
  },
  enhancers: {
    createIpcSendQueueFeature: {
      kind: 'feature',
      target: 'IRpcEndpoint',
      summary: {
        en: 'Creates one bounded original connection gate and its native feature. Pair the feature with createIpcSendQueueTransport using that exact gate.',
        zh: '为现有连接创建有界发送队列和原生功能，再把同一个队列控制对象交给 `createIpcSendQueueTransport`。'
      },
      install:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      grants: [],
      behaviors: [
        {
          en: 'Uses the original admission/physical owner; diagnostics never replace business settlement.',
          zh: '使用原准入及物理所有者，诊断不替换业务结算。'
        }
      ],
      scenarios: [
        {
          en: 'Bound whole-envelope backlog for one physical connection.',
          zh: '限制单个物理连接的完整消息封装积压。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    createIpcLogFeature: {
      kind: 'feature',
      target: 'IRpcEndpoint',
      summary: {
        en: 'Observes the original gate and explicit stderr without changing operation results; asynchronous sink failures are observed through the mandatory secondary sink.',
        zh: '观察现有队列及应用显式提供的标准错误记录，不改变发送结果；异步报告失败交给必填的次级错误回调。'
      },
      install:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      grants: [],
      behaviors: [
        {
          en: 'Uses the original admission/physical owner; diagnostics never replace business settlement.',
          zh: '使用原准入及物理所有者，诊断不替换业务结算。'
        }
      ],
      scenarios: [
        {
          en: 'Bound whole-envelope backlog for one physical connection.',
          zh: '限制单个物理连接的完整消息封装积压。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    createBrowserMessagePortTransport: {
      kind: 'transport',
      target: 'IRpcEndpoint',
      summary: {
        en: 'Wraps an original browser MessagePort with lazy native listeners, generation-bound observation and explicit physical cleanup ownership.',
        zh: '把浏览器 MessagePort 接入 Core，按需登记底层监听，隔离探针的多次安装，并明确端口的关闭责任。'
      },
      install:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      grants: [],
      behaviors: [
        {
          en: 'Endpoint uses this original physical I/O; its explicit ownership determines cleanup.',
          zh: '端点使用这个载体读写消息，按所有权设置决定谁负责关闭。'
        }
      ],
      scenarios: [
        {
          en: 'Connect an existing native message resource to Core.',
          zh: '把已有原生消息资源连接到核心。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    createWebWorkerTransport: {
      kind: 'transport',
      target: 'IRpcEndpoint',
      summary: {
        en: 'Wraps original Worker-like event I/O as a borrowed exclusive carrier; script/clone/read failures use transport errors, and cleanup never terminates the Worker.',
        zh: '把 Worker 事件接口包装为借用的独占载体；脚本、克隆和读取失败通过传输错误通道报告，清理不会终止 Worker。'
      },
      install:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}",
      grants: [],
      behaviors: [
        {
          en: 'Endpoint uses this original physical I/O; its explicit ownership determines cleanup.',
          zh: '端点使用这个载体读写消息，按所有权设置决定谁负责关闭。'
        }
      ],
      scenarios: [
        {
          en: 'Connect an existing native message resource to Core.',
          zh: '把已有原生消息资源连接到核心。'
        }
      ],
      example:
        "import assert from 'node:assert/strict'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { timeoutFeature } from '@migaia/rpc-host/features'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 }\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) => {\n              signal.addEventListener('abort', () => resolve(), { once: true })\n            })\n        } finally {\n          await child.close()\n        }\n      }\n    }),\n    timeoutFeature({ ms: 1500 })\n  ]\n})\ntry {\n  const value = await host.request('double', 21)\n  assert.equal(value, 42)\n  console.log(value)\n} finally {\n  await host.close()\n}"
    },
    defineMessageAdapter: {
      kind: 'adapter',
      target: 'IAdapterDefinition',
      summary: {
        en: 'Define cold acquisition of native message ports; original Host assembly retains handshake, providers and endpoint ownership.',
        zh: '定义原生消息端口的冷获取过程，握手、提供方及端点仍由原宿主组装所有者负责。'
      },
      install: {
        en: rpcApiGuides['rpc-host:plugin:defineMessageAdapter'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:defineMessageAdapter'].zh.quickStart!
      },
      grants: [
        {
          signature: 'adapter.deployment(options)',
          summary: {
            en: 'Select this definition’s native message ports input for later transport-plugin installation, without opening it during capture.',
            zh: '为稍后的传输插件安装选择此定义的原生消息端口输入，捕获时不打开来源。'
          },
          params: {
            options: {
              en: 'Actual physical input and local deployment policy accepted by this definition.',
              zh: '此定义接收的实际物理输入及本地部署策略。'
            }
          },
          returns: {
            en: 'Opaque recipe token consumed by defineTransportPlugin and the one Host endpoint.',
            zh: '返回由 defineTransportPlugin 及唯一宿主端点消费的不透明配方令牌。'
          },
          example: {
            en: rpcApiGuides['rpc-host:plugin:defineMessageAdapter'].en.quickStart!,
            zh: rpcApiGuides['rpc-host:plugin:defineMessageAdapter'].zh.quickStart!
          }
        },
        {
          signature: 'adapter.scope(store?)',
          summary: {
            en: 'Share one original provider admission/store resource among the connections created from this definition.',
            zh: '让基于此定义创建的连接共享同一原提供方准入和存储资源。'
          },
          params: {
            store: {
              en: 'Caller-selected existing idempotency store, or the canonical default when omitted.',
              zh: '调用方选择的既有幂等存储，省略时使用规范默认值。'
            }
          },
          returns: {
            en: 'Caller-owned scope; release it after every borrowing host has completed closure.',
            zh: '返回调用方拥有的作用域，在所有借用宿主完成关闭后释放。'
          },
          example:
            "import type { IAdapterDefinition } from '@migaia/rpc-host/plugin'\n\n/** The callback closes all borrowing hosts before returning. */\nexport async function withProviderScope<T>(\n  adapter: IAdapterDefinition<T>,\n  use: (scope: ReturnType<IAdapterDefinition<T>['scope']>) => Promise<void>\n): Promise<void> {\n  const scope = adapter.scope()\n  try { await use(scope) }\n  finally { scope.close() }\n}"
        }
      ],
      behaviors: [
        {
          en: 'Accepted identity and capabilities come from genuine negotiation on the acquired source.',
          zh: '已接纳身份及能力来自所获取实际来源上的真实协商。'
        }
      ],
      scenarios: [
        {
          en: 'A transport author already owns native message ports and needs canonical preparation without a second endpoint.',
          zh: '传输作者已持有原生消息端口，需要规范准备过程而不另建端点。'
        }
      ],
      example: {
        en: rpcApiGuides['rpc-host:plugin:defineMessageAdapter'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:defineMessageAdapter'].zh.quickStart!
      }
    },
    defineByteAdapter: {
      kind: 'adapter',
      target: 'IAdapterDefinition',
      summary: {
        en: 'Define cold acquisition of ordered byte I/O; original Host assembly retains handshake, providers and endpoint ownership.',
        zh: '定义有序字节输入输出的冷获取过程，握手、提供方及端点仍由原宿主组装所有者负责。'
      },
      install: {
        en: rpcApiGuides['rpc-host:plugin:defineByteAdapter'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:defineByteAdapter'].zh.quickStart!
      },
      grants: [
        {
          signature: 'adapter.deployment(options)',
          summary: {
            en: 'Select this definition’s ordered byte I/O input for later transport-plugin installation, without opening it during capture.',
            zh: '为稍后的传输插件安装选择此定义的有序字节输入输出输入，捕获时不打开来源。'
          },
          params: {
            options: {
              en: 'Actual physical input and local deployment policy accepted by this definition.',
              zh: '此定义接收的实际物理输入及本地部署策略。'
            }
          },
          returns: {
            en: 'Opaque recipe token consumed by defineTransportPlugin and the one Host endpoint.',
            zh: '返回由 defineTransportPlugin 及唯一宿主端点消费的不透明配方令牌。'
          },
          example: {
            en: rpcApiGuides['rpc-host:plugin:defineByteAdapter'].en.quickStart!,
            zh: rpcApiGuides['rpc-host:plugin:defineByteAdapter'].zh.quickStart!
          }
        },
        {
          signature: 'adapter.scope(store?)',
          summary: {
            en: 'Share one original provider admission/store resource among the connections created from this definition.',
            zh: '让基于此定义创建的连接共享同一原提供方准入和存储资源。'
          },
          params: {
            store: {
              en: 'Caller-selected existing idempotency store, or the canonical default when omitted.',
              zh: '调用方选择的既有幂等存储，省略时使用规范默认值。'
            }
          },
          returns: {
            en: 'Caller-owned scope; release it after every borrowing host has completed closure.',
            zh: '返回调用方拥有的作用域，在所有借用宿主完成关闭后释放。'
          },
          example:
            "import type { IAdapterDefinition } from '@migaia/rpc-host/plugin'\n\n/** The callback closes all borrowing hosts before returning. */\nexport async function withProviderScope<T>(\n  adapter: IAdapterDefinition<T>,\n  use: (scope: ReturnType<IAdapterDefinition<T>['scope']>) => Promise<void>\n): Promise<void> {\n  const scope = adapter.scope()\n  try { await use(scope) }\n  finally { scope.close() }\n}"
        }
      ],
      behaviors: [
        {
          en: 'Accepted identity and capabilities come from genuine negotiation on the acquired source.',
          zh: '已接纳身份及能力来自所获取实际来源上的真实协商。'
        }
      ],
      scenarios: [
        {
          en: 'A transport author already owns ordered byte I/O and needs canonical preparation without a second endpoint.',
          zh: '传输作者已持有有序字节输入输出，需要规范准备过程而不另建端点。'
        }
      ],
      example: {
        en: rpcApiGuides['rpc-host:plugin:defineByteAdapter'].en.quickStart!,
        zh: rpcApiGuides['rpc-host:plugin:defineByteAdapter'].zh.quickStart!
      }
    },
    timeoutFeature: {
      kind: 'feature',
      target: 'IRpcHost',
      summary: {
        en: 'Provide a call default below explicit host and call timeouts.',
        zh: '提供低于显式宿主及单次调用的默认期限。'
      },
      install:
        "import timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const deadline = timeoutFeature({ ms: 1500 })",
      grants: [],
      behaviors: [],
      scenarios: [
        {
          en: 'Install beside one actual transport.',
          zh: '与一个实际传输一起安装。'
        }
      ],
      example:
        "import timeoutFeature from '@migaia/rpc-host/features/timeout'\n\nexport const deadline = timeoutFeature({ ms: 1500 })"
    },
    typegenFeature: {
      kind: 'feature',
      target: 'IRpcHost',
      summary: {
        en: 'Generate declarations from accepted directories regardless of peer language; uninstall stops further output.',
        zh: '从已接纳目录生成声明，不区分对端语言，卸载后停止输出。'
      },
      install:
        "import { typegenFeature } from '@migaia/rpc-host/features'\n\nexport const declarations = typegenFeature({\n  out: {\n    write: (fileName, text) => {\n      console.log(fileName, text)\n    }\n  }\n})",
      grants: [],
      behaviors: [],
      scenarios: [
        {
          en: 'Install beside one actual transport.',
          zh: '与一个实际传输一起安装。'
        }
      ],
      example:
        "import { typegenFeature } from '@migaia/rpc-host/features'\n\nexport const declarations = typegenFeature({\n  out: {\n    write: (fileName, text) => {\n      console.log(fileName, text)\n    }\n  }\n})"
    },
    chunkFeature: {
      kind: 'feature',
      target: 'IRpcHost',
      summary: {
        en: 'Use the original single outbound framing and reassembly root.',
        zh: '使用原唯一出站分块与重组根。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { chunkFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function callWithFeature(\n  transport: IRpcTransportPlugin\n) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [transport, chunkFeature()]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [],
      scenarios: [
        {
          en: 'Install beside one actual transport.',
          zh: '与一个实际传输一起安装。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { chunkFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function callWithFeature(\n  transport: IRpcTransportPlugin\n) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [transport, chunkFeature()]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
    },
    retryFeature: {
      kind: 'feature',
      target: 'IRpcHost',
      summary: {
        en: 'Use original generation-aware retry and unknown-result policy; never blindly replay non-idempotent work.',
        zh: '使用原感知代次的重试及结果未知策略，不盲目重放非幂等业务。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { retryFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function callWithFeature(\n  transport: IRpcTransportPlugin\n) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [transport, retryFeature()]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [],
      scenarios: [
        {
          en: 'Install beside one actual transport.',
          zh: '与一个实际传输一起安装。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { retryFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function callWithFeature(\n  transport: IRpcTransportPlugin\n) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [transport, retryFeature()]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
    },
    authFeature: {
      kind: 'feature',
      target: 'IRpcHost',
      summary: {
        en: 'Configure original signing/verification and optional paired encryption without changing replay or error ownership.',
        zh: '配置原签名验证及可选成对加密，不改变重放及错误归属。'
      },
      install:
        "import { createRpcHost, type IRpcAuthenticationConfig } from '@migaia/rpc-host'\nimport { authFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function callWithFeature(\n  transport: IRpcTransportPlugin,\n  config: IRpcAuthenticationConfig\n) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [transport, authFeature(config)]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [],
      scenarios: [
        {
          en: 'Install beside one actual transport.',
          zh: '与一个实际传输一起安装。'
        }
      ],
      example:
        "import { createRpcHost, type IRpcAuthenticationConfig } from '@migaia/rpc-host'\nimport { authFeature } from '@migaia/rpc-host/features'\nimport type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'\n\nexport async function callWithFeature(\n  transport: IRpcTransportPlugin,\n  config: IRpcAuthenticationConfig\n) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [transport, authFeature(config)]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
    },
    defineTransportPlugin: {
      kind: 'plugin',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Register a cold source-mode deployment and exact plugin identity.',
        zh: '登记冷来源模式部署及精确插件身份。'
      },
      install:
        "import {\n  createAdapterDeployment,\n  defineTransportPlugin,\n  type IAdapterDeploymentContext,\n  type IRuntimePeerSourceResult\n} from '@migaia/rpc-host/plugin'\n\nexport function customTransport(\n  open: (context: IAdapterDeploymentContext) => Promise<IRuntimePeerSourceResult>\n) {\n  const deployment = createAdapterDeployment({ open })\n  return defineTransportPlugin({ name: 'custom', mode: 'connect', deployment })\n}",
      grants: [],
      behaviors: [],
      scenarios: [
        {
          en: 'Author one reusable source or optional feature.',
          zh: '编写一个可复用来源或可选功能。'
        }
      ],
      example:
        "import {\n  createAdapterDeployment,\n  defineTransportPlugin,\n  type IAdapterDeploymentContext,\n  type IRuntimePeerSourceResult\n} from '@migaia/rpc-host/plugin'\n\nexport function customTransport(\n  open: (context: IAdapterDeploymentContext) => Promise<IRuntimePeerSourceResult>\n) {\n  const deployment = createAdapterDeployment({ open })\n  return defineTransportPlugin({ name: 'custom', mode: 'connect', deployment })\n}"
    },
    defineFeaturePlugin: {
      kind: 'plugin',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Register policy, probe, setup or assembly with native plugin-host lifecycle.',
        zh: '按原插件宿主生命周期登记策略、观察、安装或装配。'
      },
      install:
        "import { defineProbe } from '@migaia/rpc-host/probe'\nimport { defineFeaturePlugin } from '@migaia/rpc-host/plugin'\n\nexport const observation = defineFeaturePlugin({\n  name: 'application-observer',\n  probe: defineProbe({\n    stages: ['message', 'peer'],\n    emit: (view) => console.log(Object.freeze({ ...view }))\n  })\n})",
      grants: [],
      behaviors: [],
      scenarios: [
        {
          en: 'Author one reusable source or optional feature.',
          zh: '编写一个可复用来源或可选功能。'
        }
      ],
      example:
        "import { defineProbe } from '@migaia/rpc-host/probe'\nimport { defineFeaturePlugin } from '@migaia/rpc-host/plugin'\n\nexport const observation = defineFeaturePlugin({\n  name: 'application-observer',\n  probe: defineProbe({\n    stages: ['message', 'peer'],\n    emit: (view) => console.log(Object.freeze({ ...view }))\n  })\n})"
    }
  }
}
