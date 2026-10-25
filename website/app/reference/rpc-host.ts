/**
 * Actual Host namespace, complete-feature and native SDK reference. Contract owns shared pure
 * interfaces and errors; native execution and lifecycle documentation stays with its real owner.
 */
import type { ILibraryReference } from './contract.ts'
import { reference as contractReference } from './rpc-contract.ts'

/** Host-owned authored data omits retired endpoints, profiles and compatibility SDK entries. */
const owned: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Create one native host. The root owns self, provide and close; calls live under each installed transport namespace. Multiple namespaces are supported, but normally choose one transport kind per host.',
        zh: '创建一个原生宿主。根拥有身份、提供方法与关闭，调用位于各已安装传输命名空间。支持多个命名空间，但通常每个宿主选择一种传输。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
    },
    features: {
      summary: {
        en: 'Import complete timeout and retry implementations. Install them in a transport features list or linkPolicy; one call may override a policy with a complete instance or false, never a number or plain configuration.',
        zh: '导入包含完整算法的超时与重试实例。安装到传输功能列表或链路策略；单次调用可用完整实例或 `false` 覆盖，不能传数字或普通配置。'
      },
      example:
        "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
    },
    'features/timeout': {
      summary: {
        en: 'Default export timeout captures a finite nonnegative attempt budget. The instance owns its actual timer and removes timer/abort subscriptions on settlement; an inherited deadline can only shorten the budget.',
        zh: '默认导出的 `timeout` 捕获有限非负尝试预算。实例拥有实际计时器，结算后移除计时及取消订阅；继承截止时间只能缩短预算。'
      },
      example:
        "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
    },
    'features/retry': {
      summary: {
        en: 'Default export retry owns origin replay and backoff, borrowing genuine accepted-Session replacement or native-generation readiness. Method idempotency and physical handoff determine recovery; transit forwarding does not retry.',
        zh: '默认导出的 `retry` 拥有发起方重放与退避，借用真实接纳会话替换或原生代际就绪。方法幂等性及物理交接决定恢复，中继转发不重试。'
      },
      example:
        "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
    },
    sdk: {
      summary: {
        en: 'Author real native definitions through defineTransportPlugin, defineFlowPlugin and defineLinkPolicy. Carriers execute prepare/encode/decode/restore once. Native packages acquire IO, supply identity/transfer/observation facts and reuse RpcMemberGeneration with the original supervisor.',
        zh: '通过 `defineTransportPlugin`、`defineFlowPlugin` 和 `defineLinkPolicy` 编写真正原生定义。载体只执行一次准备、编码、解码及恢复。原生包获取读写资源，提供身份、转移及观察事实，并通过 `RpcMemberGeneration` 复用原监管器。'
      },
      example:
        "import { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}\n"
    },
    plugins: {
      summary: {
        en: 'Install optional flow implementations before transport startup: auth, chunk, batch, idempotency, limits, schema, probe, typegen and linkPolicy. Omission leaves the capability absent. Namespace filters scope installed hooks; extensions cannot replace built-in calls.',
        zh: '在传输启动前安装可选信息流实现：认证、分片、合帧、幂等、限流、模式校验、探针、类型生成及链路策略。省略即没有对应能力。命名空间过滤限定介入范围，扩展不能覆盖内建调用。'
      },
      example:
        "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
    },
    'plugins/auth': {
      summary: {
        en: 'Authentication transforms protect admitted handshake/envelope data. Supply complete sign/verify and encrypt/decrypt pairs. Credentials are explicit application/native capabilities; transport identity is not inferred from payload metadata.',
        zh: '认证转换保护已接纳的握手及信封数据。签名与验证、加密与解密分别成对提供。凭据来自显式应用或原生能力，不能从载荷元数据推断传输身份。'
      },
      example:
        "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\n\nexport function signed(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encodedType: 'string' })\n}\n"
    },
    'plugins/chunk': {
      summary: {
        en: 'Install negotiated chunk@1 with bounded source/message reassembly and expiry. Physical fragments are distinct from ordered business method groups; disposing a source releases its retained assemblies.',
        zh: '安装经协商的 `chunk@1`，限制来源及消息重组与过期。物理分片不同于有序业务方法分组；释放来源会清除所保留组装。'
      },
      example:
        "import chunk from '@migaia/rpc-host/plugins/chunk'\nexport const framing = chunk({ chunkBytes: 16384, maxMessageBytes: 16777216 })\n"
    },
    'plugins/batch': {
      summary: {
        en: 'Coalesce eligible physical frames through negotiated batch@1 while preserving each logical write cancellation and completion. Batching does not make application calls a transaction.',
        zh: '通过已协商的 `batch@1` 合并合格物理帧，保留各逻辑写入的取消及完成。合帧不会把应用调用变成事务。'
      },
      example:
        "import batch from '@migaia/rpc-host/plugins/batch'\nexport const batching = batch({ required: false })\n"
    },
    'plugins/limits': {
      summary: {
        en: 'Own shared provider concurrency and optional per-connection rate, payload, timeout-streak and idle admission. Defaults are 256 globally and 64 per peer. Omitting limits installs no such quotas.',
        zh: '拥有共享提供方并发及可选连接速率、载荷、连续超时和空闲准入。默认总并发 `256`、单对端 `64`。省略限流插件就不安装这些配额。'
      },
      example:
        "import limits from '@migaia/rpc-host/plugins/limits'\nexport const capacity = limits({ maxGlobal: 256, maxPerPeer: 64 })\n"
    },
    'plugins/schema': {
      summary: {
        en: 'Validate method inputs and successful results with synchronous application parsers, retaining the original business value. Schema announcements alone are inert Host directory metadata; this plugin enables validation.',
        zh: '使用应用同步解析器校验方法输入及成功结果，保留原业务值。仅公告模式是惰性宿主目录元数据，本插件才启用校验。'
      },
      example:
        "import schema from '@migaia/rpc-host/plugins/schema'\nexport const validation = schema()\n"
    },
    'plugins/typegen': {
      summary: {
        en: 'Observe actual accepted directories and write ambient declarations through application-owned output. Directory updates are not repeated peer-ready events; disposal stops later writes.',
        zh: '观察实际接纳目录，通过应用拥有的输出能力写入声明。目录更新不是重复对端就绪事件，释放后停止后续写入。'
      },
      example:
        "import typegen from '@migaia/rpc-host/plugins/typegen'\nexport const declarations = typegen({\n  out: { write: (fileName, text) => console.log(fileName, text) },\n})\n"
    },
    'plugins/idempotency': {
      summary: {
        en: 'Install a scoped execution/outcome store and the namespace outcome(key) extension. Explicit claims retain pending ownership and completed tombstones; a lookup does not authorize execution or replay by itself.',
        zh: '安装带作用域的执行及结果存储，为命名空间增加 `outcome(key)`。显式认领保留待决所有权及完成记录；查询本身不授予执行或重放权限。'
      },
      example:
        "import idempotency from '@migaia/rpc-host/plugins/idempotency'\nexport const outcomes = idempotency({ retentionMs: 300000, maxEntries: 1024 })\n"
    },
    'plugins/probe': {
      summary: {
        en: 'Observe real supported stages without changing business settlement. Capture is opt-in; synchronously copy the reused callback view before retaining it. Native carrier facts come from actual IO.',
        zh: '观察实际支持阶段，不改变业务结算。内容捕获须显式选择，保留前须同步复制复用回调视图。原生载体事实来自实际读写。'
      },
      example:
        "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])\n"
    },
    'plugins/link-policy': {
      summary: {
        en: 'Supply complete timeout/retry instances as link defaults. A transport-installed instance overrides the default, then a call instance or false overrides that choice. Inherited chain deadlines cannot be extended.',
        zh: '将完整超时及重试实例作为链路默认值。传输实例覆盖默认值，调用实例或 `false` 再覆盖传输选择。继承链路截止时间不能延长。'
      },
      example:
        "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
    }
  },
  symbols: {
    createRpcHost: {
      role: 'factory',
      purpose: {
        en: 'One native Host with global self/provide/close and inferred transport namespace properties. Root call methods do not exist.',
        zh: '一个原生宿主，拥有全局身份、提供方法及关闭，并推导传输命名空间属性；根调用方法不存在。'
      },
      options: 'IRpcHostOptions',
      params: {
        options: {
          en: 'At least one genuine transport definition plus optional local providers, global identity, reporter and Host signal.',
          zh: '至少一个真实传输定义，以及可选本地提供方、全局身份、上报器和宿主信号。'
        }
      },
      returns: {
        en: 'Promise of the Host after native installation and accepted handshakes. Failure rolls back resources; close reuses its original Promise.',
        zh: '原生安装及接纳握手完成后返回宿主，失败回滚资源，关闭复用原 Promise。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
    },
    timeout: {
      role: 'enhancer',
      purpose: {
        en: 'Captured complete attempt-timeout resources; ms does not change the independent handshake deadline.',
        zh: '完整尝试超时功能捕获的资源，毫秒预算不改变独立握手截止时间。'
      },
      options: 'ITimeoutFeatureOptions',
      returns: {
        en: 'A frozen complete executing feature; install in the owning transport/linkPolicy or select for one call.',
        zh: '冻结的完整执行功能，安装在所属传输及链路策略中，或为一次调用选用。'
      },
      example:
        "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n",
      scenarios: [
        {
          en: 'Select this complete instance for a single originating invocation or install it on its actual owner.',
          zh: '为一次发起调用选择本完整实例，或安装到实际所有者。'
        }
      ]
    },
    retry: {
      role: 'enhancer',
      purpose: {
        en: 'Captured originating retry policy; retain one logical key and inherited budget across permitted attempts.',
        zh: '捕获的发起方重试策略，在允许的尝试间保留同一逻辑键及继承预算。'
      },
      options: 'IRetryFeatureOptions',
      returns: {
        en: 'A frozen complete executing feature; install in the owning transport/linkPolicy or select for one call.',
        zh: '冻结的完整执行功能，安装在所属传输及链路策略中，或为一次调用选用。'
      },
      example:
        "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n",
      scenarios: [
        {
          en: 'Select this complete instance for a single originating invocation or install it on its actual owner.',
          zh: '为一次发起调用选择本完整实例，或安装到实际所有者。'
        }
      ]
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
        "import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-request')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))\n",
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
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'\n\nconst orderOutcomes = createRpcIdempotencyStore({\n  retentionMs: 300000,\n  maxEntries: 1000,\n  maxEntriesPerScope: 20,\n})\n",
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
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'\n\nconst exportOutcomes = createRpcIdempotencyStore({\n  maxBytes: 8 * 1024 * 1024,\n  maxOutcomeBytes: 256 * 1024,\n})\n",
          result: {
            en: 'The outcome store has an explicit memory budget for retained results.',
            zh: '保留结果的存储有明确内存预算。'
          },
          covers: ['maxBytes', 'maxOutcomeBytes']
        }
      ]
    },
    defineProbe: {
      role: 'factory',
      purpose: {
        en: 'Compile a standalone frozen probe or freeze the same augmented application object. Install its handle through the probe flow plugin to observe actual supported stages.',
        zh: '编译独立冻结探针，或冻结同一个增强应用对象。通过探针信息流插件安装其句柄，观察实际支持阶段。'
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
        "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])\n"
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
        "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])\n"
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
        "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])\n"
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
      example: "console.log(rpcProbeSampleKey('client', 'message-1'))\n"
    },
    IpcReporterContext: {
      role: 'constant',
      purpose: {
        en: 'Frozen utils reporter classification with operation limiter and phase reporter; use it only for secondary IPC observer failures.',
        zh: '冻结的工具上报分类，操作为限制器、阶段为上报者，只用于次级进程通信观察失败。'
      },
      example: 'hostRethrowReporter(error, IpcReporterContext)\n'
    },
    auth: {
      role: 'enhancer',
      purpose: {
        en: 'Complete paired transforms and optional explicit handshake credential capabilities captured by auth. Native acquisition and accepted identity remain separate owners.',
        zh: '认证插件捕获的完整成对转换及可选显式握手凭据能力；原生获取和接纳身份仍由不同所有者管理。'
      },
      options: 'IRpcAuthenticationOptions',
      returns: {
        en: 'Cold native flow definition; each receiving Host owns its own hooks and exact cleanup.',
        zh: '冷原生信息流定义；每个接收宿主拥有自己的介入点及精确清理。'
      },
      example:
        "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\n\nexport function signed(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encodedType: 'string' })\n}\n"
    },
    chunk: {
      role: 'enhancer',
      purpose: {
        en: 'Bounded chunk retention and timer capabilities used only by the installed chunk implementation.',
        zh: '仅由已安装分片实现使用的有界保留及计时能力。'
      },
      options: 'IRpcChunkFeatureOptions',
      returns: {
        en: 'Cold native flow definition; each receiving Host owns its own hooks and exact cleanup.',
        zh: '冷原生信息流定义；每个接收宿主拥有自己的介入点及精确清理。'
      },
      example:
        "import chunk from '@migaia/rpc-host/plugins/chunk'\nexport const framing = chunk({ chunkBytes: 16384, maxMessageBytes: 16777216 })\n"
    },
    batch: {
      role: 'enhancer',
      purpose: {
        en: 'Cold namespace and negotiation requirements for physical batch@1. No provider or application grouping policy is installed.',
        zh: '物理合帧的冷命名空间及协商要求，不安装提供方或应用分组策略。'
      },
      options: 'IRpcBatchOptions',
      returns: {
        en: 'Cold native flow definition; each receiving Host owns its own hooks and exact cleanup.',
        zh: '冷原生信息流定义；每个接收宿主拥有自己的介入点及精确清理。'
      },
      example:
        "import batch from '@migaia/rpc-host/plugins/batch'\nexport const batching = batch({ required: false })\n"
    },
    limits: {
      role: 'enhancer',
      purpose: {
        en: 'Shared provider concurrency and optional per-connection governance; unrelated to native execution-unit or pool capacity.',
        zh: '共享提供方并发及可选连接治理，与原生执行单元或池容量不同。'
      },
      options: 'IRpcLimitsOptions',
      returns: {
        en: 'Cold native flow definition; each receiving Host owns its own hooks and exact cleanup.',
        zh: '冷原生信息流定义；每个接收宿主拥有自己的介入点及精确清理。'
      },
      example:
        "import limits from '@migaia/rpc-host/plugins/limits'\nexport const capacity = limits()\n"
    },
    schema: {
      role: 'enhancer',
      purpose: {
        en: 'Explicit parser table keyed by real method path; local declarations remain inert metadata without this installed plugin.',
        zh: '按实际方法路径索引的显式解析器表；不安装本插件时，本地声明保持惰性元数据。'
      },
      options: 'IRpcSchemaOptions',
      returns: {
        en: 'Cold native flow definition; each receiving Host owns its own hooks and exact cleanup.',
        zh: '冷原生信息流定义；每个接收宿主拥有自己的介入点及精确清理。'
      },
      example:
        "import schema from '@migaia/rpc-host/plugins/schema'\nexport const validation = schema()\n"
    },
    typegen: {
      role: 'enhancer',
      purpose: {
        en: 'Output capability and namespace filter for one type-generation observer.',
        zh: '一次类型生成观察所用的输出能力及命名空间过滤。'
      },
      options: 'ITypegenOptions',
      returns: {
        en: 'Cold native flow definition; each receiving Host owns its own hooks and exact cleanup.',
        zh: '冷原生信息流定义；每个接收宿主拥有自己的介入点及精确清理。'
      },
      example:
        "import typegen from '@migaia/rpc-host/plugins/typegen'\nexport const declarations = typegen({\n  out: { write: (name, text) => console.log(name, text) },\n})\n"
    },
    idempotency: {
      role: 'enhancer',
      purpose: {
        en: 'Installed store, scope selection and namespace outcome extension; automatic replay policy is not granted merely by declaring a key.',
        zh: '已安装存储、作用域选择及命名空间结果扩展；仅声明键不会授予自动重放策略。'
      },
      options: 'IRpcIdempotencyOptions',
      returns: {
        en: 'Cold native flow definition; each receiving Host owns its own hooks and exact cleanup.',
        zh: '冷原生信息流定义；每个接收宿主拥有自己的介入点及精确清理。'
      },
      example:
        "import idempotency from '@migaia/rpc-host/plugins/idempotency'\nexport const outcomes = idempotency({ retentionMs: 300000 })\n"
    },
    probe: {
      role: 'enhancer',
      purpose: {
        en: 'Install actual readonly observation; no carrier, provider or business lifecycle is created by the observer.',
        zh: '安装实际只读观察；观察器不创建载体、提供方或业务生命周期。'
      },
      params: {
        inputs: {
          en: 'Genuine defineProbe handles or explicit probe definitions, compiled once per installation.',
          zh: '真实探针句柄或显式探针定义，每次安装只编译一次。'
        }
      },
      returns: {
        en: 'Cold native flow definition; each receiving Host owns its own hooks and exact cleanup.',
        zh: '冷原生信息流定义；每个接收宿主拥有自己的介入点及精确清理。'
      },
      example:
        "import probe from '@migaia/rpc-host/plugins/probe'\nexport const observation = probe({\n  stages: ['message'],\n  emit: (view) => console.log({ ...view }),\n})\n"
    },
    linkPolicy: {
      role: 'enhancer',
      purpose: {
        en: 'Complete timeout/retry instances used as link defaults before transport and call overrides.',
        zh: '在传输及调用覆盖之前使用的完整超时及重试链路默认实例。'
      },
      options: 'IRpcLinkPolicyOptions',
      returns: {
        en: 'Cold native flow definition; each receiving Host owns its own hooks and exact cleanup.',
        zh: '冷原生信息流定义；每个接收宿主拥有自己的介入点及精确清理。'
      },
      example:
        "import linkPolicy from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({ features: [timeout({ ms: 1500 })] })\n"
    },
    createRpcMessageCarrier: {
      role: 'factory',
      purpose: {
        en: 'Hold one acquired whole-message IO with a real codec and one close lifecycle.',
        zh: '以真实编解码器及唯一关闭生命周期持有已获取整条消息读写资源。'
      },
      options: 'IRpcMessageCarrierOptions',
      params: {},
      returns: {
        en: 'IRpcCarrier for actual Session attachment.',
        zh: '可附加到实际会话的载体。'
      },
      example:
        "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}\n"
    },
    createRpcByteCarrier: {
      role: 'factory',
      purpose: {
        en: 'Hold acquired ordered bytes with fatal UTF-8 and canonical length framing, without native acquisition or bootstrap aliases.',
        zh: '通过严格字符解码及规范长度分帧持有已获取有序字节，不获取原生资源或提供启动别名。'
      },
      options: 'IRpcByteCarrierOptions',
      params: {},
      returns: {
        en: 'IRpcCarrier sharing the same original byte close Promise.',
        zh: '共享原字节关闭 Promise 的载体。'
      },
      example:
        "import { createRpcByteCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport function acquire(io: IRpcByteIO, id: string, report: (error: unknown) => void) {\n  return createRpcByteCarrier({ id, io, report })\n}\n",
      optionDocs: {
        'utf8.encoder.encode': {
          summary: {
            en: 'Encode canonical text using the original native encoder receiver.',
            zh: '使用原生原编码接收者将规范文本编码为字节。'
          },
          params: {
            value: {
              en: 'Canonical carrier JSON text ready for byte framing.',
              zh: '等待字节分帧的规范载体文本。'
            }
          },
          returns: {
            en: 'Newly encoded native UTF-8 bytes.',
            zh: '新分配的原生字符编码字节。'
          },
          example:
            "import { RpcUtf8 } from '@migaia/rpc-host/sdk'\nconst utf8 = new RpcUtf8({\n  encoder: new TextEncoder(),\n  decoder: new TextDecoder('utf-8', { fatal: true }),\n})\nconst bytes = utf8.encoder.encode('hello')\nconst target = new Uint8Array(16)\nutf8.encoder.encodeInto('hello', target)\nexport const text = utf8.decode(bytes)\n",
          whenToUse: {
            en: 'Use actual Encoding API receivers to retain native allocation and malformed-text behavior.',
            zh: '使用真实编码接口接收者，保留原生分配及非法文本行为，不重新实现字符算法。'
          }
        },
        'utf8.encoder.encodeInto': {
          summary: {
            en: 'Write encoded text into the physical framer owned target view.',
            zh: '将文本编码写入物理分帧器所拥有的目标视图。'
          },
          params: {
            value: {
              en: 'Canonical carrier text from the encoding stage.',
              zh: '编码阶段产生的规范载体文本。'
            },
            target: {
              en: 'Writable target acquired by the original physical framer.',
              zh: '原物理分帧器获取的可写目标视图。'
            }
          },
          returns: {
            en: 'The number of bytes actually written; the native encoder determines partial progress.',
            zh: '实际写入字节数，部分进度由原生编码器决定。'
          },
          example:
            "import { RpcUtf8 } from '@migaia/rpc-host/sdk'\nconst utf8 = new RpcUtf8({\n  encoder: new TextEncoder(),\n  decoder: new TextDecoder('utf-8', { fatal: true }),\n})\nconst bytes = utf8.encoder.encode('hello')\nconst target = new Uint8Array(16)\nutf8.encoder.encodeInto('hello', target)\nexport const text = utf8.decode(bytes)\n",
          whenToUse: {
            en: 'Use actual Encoding API receivers to retain native allocation and malformed-text behavior.',
            zh: '使用真实编码接口接收者，保留原生分配及非法文本行为，不重新实现字符算法。'
          }
        },
        'utf8.decoder.decode': {
          summary: {
            en: 'Decode with fatal UTF-8 semantics and preserve the native malformed-input throw.',
            zh: '按严格字符语义解码，并保留非法输入的原生抛错。'
          },
          params: {
            value: {
              en: 'One complete received payload from the canonical byte framer.',
              zh: '规范字节分帧器交付的一个完整接收载荷。'
            }
          },
          returns: {
            en: 'Decoded text; malformed input throws instead of inserting replacement characters.',
            zh: '解码文本，非法输入抛错而非插入替换字符。'
          },
          example:
            "import { RpcUtf8 } from '@migaia/rpc-host/sdk'\nconst utf8 = new RpcUtf8({\n  encoder: new TextEncoder(),\n  decoder: new TextDecoder('utf-8', { fatal: true }),\n})\nconst bytes = utf8.encoder.encode('hello')\nconst target = new Uint8Array(16)\nutf8.encoder.encodeInto('hello', target)\nexport const text = utf8.decode(bytes)\n",
          whenToUse: {
            en: 'Use actual Encoding API receivers to retain native allocation and malformed-text behavior.',
            zh: '使用真实编码接口接收者，保留原生分配及非法文本行为，不重新实现字符算法。'
          }
        }
      }
    },
    prepareRpcBinary: {
      role: 'factory',
      purpose: {
        en: 'Capture each business slot synchronously before digest suspension, preserving original whole backing aliases and own-key order.',
        zh: '在散列挂起前同步捕获各业务槽，保留原完整缓冲区别名及自有键顺序。'
      },
      options: 'IRpcBinaryOptions',
      params: {
        message: {
          en: 'Actual captured semantic envelope or protected binary manifest from the sole codec.',
          zh: '唯一编解码器的实际捕获语义信封或保护二进制清单。'
        }
      },
      returns: {
        en: 'Captured protected manifest and original backing sidecars.',
        zh: '已捕获保护清单及原缓冲区附带列表。'
      },
      example:
        "import { prepareRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'\n\nexport function capture(message: IRpcEnvelope) {\n  return prepareRpcBinary(message, { storage: 'inline' })\n}\n"
    },
    restoreRpcBinary: {
      role: 'factory',
      purpose: {
        en: 'Validate the protected binary manifest and restore original backings/views once at the actual carrier restore boundary.',
        zh: '在实际载体恢复边界校验保护二进制清单，只恢复一次原缓冲区及视图。'
      },
      options: 'IRpcBinaryRestoreOptions',
      params: {
        value: {
          en: 'Protected manifest received from the actual carrier, not an arbitrary object claiming native backing authority.',
          zh: '实际载体接收的保护清单，不是自称拥有原生缓冲区权限的任意对象。'
        }
      },
      returns: {
        en: 'Restored semantic envelope or classified integrity/shape failure.',
        zh: '恢复的语义信封，或已分类完整性及形状失败。'
      },
      example:
        "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}\n"
    },
    portableBytes: {
      role: 'operation',
      purpose: {
        en: 'Count admitted portable result bytes exactly, or stop once a trusted rejection budget is exceeded.',
        zh: '精确计算已接纳可移植结果字节，或超过可信拒绝预算后停止。'
      },
      params: {
        value: {
          en: 'Admitted portable result or serialized error, not an arbitrary native object.',
          zh: '已接纳可移植结果或序列化错误，不是任意原生对象。'
        },
        budget: {
          en: 'Optional trusted byte limit; omit for exact replay-retention cost.',
          zh: '可选可信字节上限；精确重放保留成本应省略。'
        }
      },
      returns: {
        en: 'Exact bytes without a budget, otherwise an over-budget rejection witness.',
        zh: '无预算时返回精确字节，否则返回超预算拒绝证据。'
      },
      example:
        "import { portableBytes } from '@migaia/rpc-host/sdk'\nexport const bytes = portableBytes({ result: 'ready' })\n"
    },
    hasRpcPortableBinary: {
      role: 'operation',
      purpose: {
        en: 'Read exact SDK-owned native-backing proof; copying public properties cannot manufacture it.',
        zh: '读取共享工具拥有的精确原生缓冲区证明，复制公开属性不能伪造。'
      },
      params: {
        value: {
          en: 'Actual captured/restored codec value.',
          zh: '实际已捕获及恢复的编解码值。'
        }
      },
      returns: {
        en: 'Whether the actual SDK capture owner recorded native binary identity.',
        zh: '实际共享捕获所有者是否记录原生二进制身份。'
      },
      example:
        "import { hasRpcPortableBinary } from '@migaia/rpc-host/sdk'\nexport function native(value: unknown) {\n  return hasRpcPortableBinary(value)\n}\n"
    },
    splitRpcPreparedMetadata: {
      role: 'operation',
      purpose: {
        en: 'Shallowly separate prepared metadata from original binary sidecars without another business walk.',
        zh: '浅层分离准备元数据及原二进制附带列表，不再次遍历业务数据。'
      },
      params: {
        value: {
          en: 'Actual protected root passed by the carrier.',
          zh: '载体传入的实际保护根。'
        },
        sidecars: {
          en: 'Original physical ordered ArrayBuffer backing list.',
          zh: '原物理有序缓冲区列表。'
        }
      },
      returns: {
        en: 'Prepared metadata awaiting the sole semantic restore/admission.',
        zh: '等待唯一语义恢复及准入的准备元数据。'
      },
      example:
        "import { splitRpcPreparedMetadata } from '@migaia/rpc-host/sdk'\nexport function received(value: unknown, sidecars: readonly ArrayBuffer[]) {\n  return splitRpcPreparedMetadata(value, sidecars)\n}\n"
    },
    joinRpcPreparedMetadata: {
      role: 'operation',
      purpose: {
        en: 'Join only the fixed prepared root, retaining business key order and original backing references.',
        zh: '仅组合固定准备根，保留业务键顺序及原缓冲区引用。'
      },
      params: {
        value: {
          en: 'Actual prepared record returned by the codec.',
          zh: '编解码器返回的实际准备记录。'
        }
      },
      returns: {
        en: 'The shallow carrier root; no semantic validation or hashing is repeated.',
        zh: '浅层载体根，不重复语义校验及散列。'
      },
      example:
        "import { joinRpcPreparedMetadata } from '@migaia/rpc-host/sdk'\nimport type { IRpcPreparedMessage } from '@migaia/rpc-contract/interfaces'\nexport function outbound(value: IRpcPreparedMessage) {\n  return joinRpcPreparedMetadata(value)\n}\n"
    },
    createRpcBackingDigest: {
      role: 'operation',
      purpose: {
        en: 'Capture the available native crypto receiver for whole-backing SHA-256 integrity.',
        zh: '捕获可用原生加密接收者，计算完整缓冲区散列以检查完整性。'
      },
      params: {},
      returns: {
        en: 'Native async digest function, or undefined when no real capability exists; it grants no authentication.',
        zh: '原生异步散列函数，没有实际能力时为空值；不授予认证权限。'
      },
      example:
        "import { createRpcBackingDigest } from '@migaia/rpc-host/sdk'\nexport const digest = createRpcBackingDigest()\n"
    },
    defaultRpcId: {
      role: 'operation',
      purpose: {
        en: 'Allocate the existing secure originating identity/key without introducing a registry.',
        zh: '使用既有安全分配器产生发起身份及键，不引入登记表。'
      },
      params: {},
      returns: {
        en: 'A new opaque identity string from the native secure allocator.',
        zh: '原生安全分配器产生的新不透明身份字符串。'
      },
      example:
        "import { defaultRpcId } from '@migaia/rpc-host/sdk'\nexport const instanceId = defaultRpcId()\n"
    },
    resolveAbortReason: {
      role: 'operation',
      purpose: {
        en: 'Read an original cancellation reason once; a throwing structural getter itself remains the cancellation reason.',
        zh: '只读取原取消原因一次；结构访问器抛出的值本身仍作为取消原因。'
      },
      params: {
        signal: {
          en: 'The actual signal whose cancellation is being handled.',
          zh: '当前正在处理取消的实际信号。'
        }
      },
      returns: {
        en: 'The original reason value, including undefined or a thrown getter value.',
        zh: '原原因值，包括空值或访问器抛出值。'
      },
      example:
        "import { resolveAbortReason } from '@migaia/rpc-host/sdk'\nexport function cancelled(signal: AbortSignal) {\n  return resolveAbortReason(signal)\n}\n"
    },
    retainRpcRuntimeFlags: {
      role: 'operation',
      purpose: {
        en: 'Keep native loader/runtime flags while removing eval, print and test-controller entry selection.',
        zh: '保留原生加载及运行时参数，同时移除求值、打印和测试控制器入口选择。'
      },
      params: {
        flags: {
          en: 'Original execution arguments captured by the native launcher.',
          zh: '原生启动器捕获的原执行参数。'
        }
      },
      returns: {
        en: 'Retained loader/runtime arguments in their existing order.',
        zh: '按原顺序保留的加载及运行时参数。'
      },
      example:
        "import { retainRpcRuntimeFlags } from '@migaia/rpc-host/sdk'\nexport const flags = retainRpcRuntimeFlags(['--enable-source-maps'])\n"
    },
    resolveRpcEntry: {
      role: 'operation',
      purpose: {
        en: 'Resolve native process/thread entries using explicit main/base snapshots, without caller-stack or runtime-global inspection.',
        zh: '使用显式主入口及基础路径快照解析原生进程或线程入口，不检查调用栈或运行时全局。'
      },
      params: {
        entry: {
          en: 'Exact URL/string or true for the supported native self-entry recipe.',
          zh: '精确地址、字符串，或表示受支持原生自身入口方案的真值。'
        },
        options: {
          en: 'Actual native main/base/loader flags and platform capabilities.',
          zh: '实际原生主入口、基础路径、加载参数及平台能力。'
        }
      },
      returns: {
        en: 'Resolved entry string; unsupported interpreter/test self-spawning rejects before resource acquisition.',
        zh: '解析入口字符串；不支持的解释器及测试自身启动在资源获取前拒绝。'
      },
      example:
        "import { resolveRpcEntry } from '@migaia/rpc-host/sdk'\nexport const entry = resolveRpcEntry('./worker.ts', { base: import.meta.url })\n",
      options: 'IRpcEntryOptions'
    },
    readRpcLaunchFacts: {
      role: 'operation',
      purpose: {
        en: 'Read trusted launch facts attached to the exact original native request context.',
        zh: '读取附加于精确原原生请求上下文的可信启动事实。'
      },
      params: {
        context: {
          en: 'Original request object borrowed by the native launcher; copies have no receipt.',
          zh: '原生启动器借用的原请求对象，副本没有对应记录。'
        }
      },
      returns: {
        en: 'Actual launch facts or undefined; decoded metadata cannot grant this receipt.',
        zh: '实际启动事实或空值；解码元数据不能授予此记录。'
      },
      example:
        "import { readRpcLaunchFacts } from '@migaia/rpc-host/sdk'\nexport function facts(context: object) {\n  return readRpcLaunchFacts(context)\n}\n"
    },
    withRpcLaunchFacts: {
      role: 'operation',
      purpose: {
        en: 'Lend trusted parent/generation facts during the original launch operation, releasing the exact metadata receipt on completion.',
        zh: '在原启动操作期间借出可信父端及代际事实，完成时释放精确元数据记录。'
      },
      params: {
        context: {
          en: 'Original native request object, not a copied facade.',
          zh: '原生原请求对象，不是复制门面。'
        },
        facts: {
          en: 'Actual parent identity and reserved execution generation.',
          zh: '真实父端身份及保留执行代际。'
        },
        launch: {
          en: 'Original async native launch; its result and primary failure are preserved.',
          zh: '原异步原生启动，保留其结果及主要失败。'
        }
      },
      returns: {
        en: 'Original launch completion with metadata lifetime scoped to that operation.',
        zh: '原启动完成，元数据生命周期限定本次操作。'
      },
      example:
        "import { withRpcLaunchFacts } from '@migaia/rpc-host/sdk'\nimport type { IRpcLaunchFacts } from '@migaia/rpc-host/sdk'\nexport function launch<T>(\n  context: object,\n  facts: IRpcLaunchFacts,\n  start: () => Promise<T>,\n) {\n  return withRpcLaunchFacts(context, facts, start)\n}\n"
    },
    rpcMemberUnavailable: {
      role: 'operation',
      purpose: {
        en: 'Create a frozen explicit absence value instead of inventing zero, healthy or parent aggregate metrics.',
        zh: '创建冻结的显式缺失值，不伪造零值、健康状态或父级聚合指标。'
      },
      params: {
        reason: {
          en: 'Actual canonical native owner reason for missing data.',
          zh: '实际规范原生所有者提供的数据缺失原因。'
        }
      },
      returns: {
        en: 'Safe own-data unavailable record.',
        zh: '安全自有数据不可用记录。'
      },
      example:
        "import { rpcMemberUnavailable, RpcMemberQueryReason } from '@migaia/rpc-host/sdk'\nexport const resources = rpcMemberUnavailable(RpcMemberQueryReason.resources)\n"
    },
    rpcMemberMetric: {
      role: 'operation',
      purpose: {
        en: 'Project an original observed metric with explicit scope, unit and monotonic observation time.',
        zh: '以显式作用域、单位及单调观察时间投影原观测指标。'
      },
      params: {
        value: {
          en: 'Original sampled native value.',
          zh: '原原生采样值。'
        },
        scope: {
          en: 'Original observation denominator, such as execution-unit.',
          zh: '原观察分母，如执行单元。'
        },
        unit: {
          en: 'Explicit units; CPU microseconds and loop-utilization ratios are distinct.',
          zh: '显式单位，处理器微秒及循环使用率比例不同。'
        },
        observedAt: {
          en: 'Original native scheduler observation timestamp.',
          zh: '原生原调度器观察时间戳。'
        }
      },
      returns: {
        en: 'Safe metric record without native handles or resampling.',
        zh: '不含原生句柄或再次采样的安全指标记录。'
      },
      example:
        "import {\n  rpcMemberMetric,\n  RpcMemberMetricScope,\n  RpcMemberMetricUnit,\n} from '@migaia/rpc-host/sdk'\nexport function count(value: number, now: number) {\n  return rpcMemberMetric(\n    value,\n    RpcMemberMetricScope.client,\n    RpcMemberMetricUnit.calls,\n    now,\n  )\n}\n"
    },
    rpcMemberCounters: {
      role: 'operation',
      purpose: {
        en: 'Project only canonical actual client-work counts; unsupported physical counters stay explicitly unavailable.',
        zh: '仅投影规范实际客户端工作计数，不支持的物理计数保持显式不可用。'
      },
      params: {
        counts: {
          en: 'Optional original inFlight Map count and monotonic observation time.',
          zh: '可选原待决映射数量及单调观察时间。'
        }
      },
      returns: {
        en: 'Counter snapshot with no observer-created traffic totals.',
        zh: '没有观察器自创流量总数的计数快照。'
      },
      example:
        "import { rpcMemberCounters } from '@migaia/rpc-host/sdk'\nexport const unavailableCounts = rpcMemberCounters()\n"
    },
    rpcMemberErrorIdentity: {
      role: 'operation',
      purpose: {
        en: 'Project tagged own source/code only, excluding native handles, message, stack and arbitrary getters.',
        zh: '仅投影已标记自有来源及错误码，不包含原生句柄、消息、堆栈或任意访问器。'
      },
      params: {
        error: {
          en: 'Actual original error observed by native supervision.',
          zh: '原生监管观察到的实际原错误。'
        },
        report: {
          en: 'Original destination for contained property-read failure.',
          zh: '被隔离属性读取失败的原上报通道。'
        }
      },
      returns: {
        en: 'Safe source/code data without control authority.',
        zh: '不授予控制权限的安全来源及错误码数据。'
      },
      example:
        "import { rpcMemberErrorIdentity } from '@migaia/rpc-host/sdk'\nexport function describe(error: unknown) {\n  return rpcMemberErrorIdentity(error, console.error)\n}\n"
    },
    rpcMemberConnectionDetail: {
      role: 'operation',
      purpose: {
        en: 'Project actual accepted directory and original native state into safe local connection detail.',
        zh: '将实际接纳目录及原生原状态投影为安全本地连接详情。'
      },
      params: {
        directory: {
          en: 'Original source mode, direction, carrier and accepted method directory.',
          zh: '原来源模式、方向、载体及接纳方法目录。'
        },
        state: {
          en: 'Actual native connection state, when known.',
          zh: '已知时的实际原生连接状态。'
        },
        facts: {
          en: 'Original supervisor snapshot, samples, history and diagnostic destination.',
          zh: '原监管快照、采样、历史及诊断通道。'
        }
      },
      returns: {
        en: 'Safe detail with explicit unavailable fields; accepted connectivity does not imply native health.',
        zh: '含显式不可用字段的安全详情；连接接纳不代表原生健康。'
      },
      example:
        "import { rpcMemberConnectionDetail } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberConnectionDirectory } from '@migaia/rpc-host/sdk'\nexport function describe(directory: IRpcMemberConnectionDirectory) {\n  return rpcMemberConnectionDetail(directory)\n}\n"
    },
    rpcMemberResources: {
      role: 'operation',
      purpose: {
        en: 'Sample only the captured actual native unit and recheck its original identity after awaiting usage. Never sample a replacement selected by name.',
        zh: '仅采样捕获的实际原生单元，等待用量后重新检查其原身份；不按名称采样替换单元。'
      },
      params: {
        unit: {
          en: 'Exact original native unit with optional sampleUsage capability.',
          zh: '具有可选原生用量采样能力的精确原单元。'
        },
        kind: {
          en: 'Original process/thread/coroutine owner kind.',
          zh: '原进程、线程或协作任务所有者种类。'
        },
        now: {
          en: 'Original monotonic native clock.',
          zh: '原生原单调时钟。'
        },
        report: {
          en: 'Original contained sampling-failure reporter.',
          zh: '被隔离采样失败的原上报器。'
        },
        isCurrent: {
          en: 'Original source identity check for this exact captured unit.',
          zh: '本精确捕获单元的原来源身份检查。'
        }
      },
      returns: {
        en: 'Actual native-scope metrics or an explicit retired/unavailable reason.',
        zh: '真实原生作用域指标，或显式退场及不可用原因。'
      },
      example:
        "import { rpcMemberResources } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberNativeUnit } from '@migaia/rpc-host/sdk'\nexport function sample(\n  unit: IRpcMemberNativeUnit,\n  now: () => number,\n  current: () => boolean,\n) {\n  return rpcMemberResources(unit, 'thread', now, console.error, current)\n}\n"
    },
    encodeRpcStreamFrame: {
      role: 'operation',
      purpose: {
        en: 'Copy nonempty bytes behind the canonical four-byte network-order length; the original native writer owns ordering and drain.',
        zh: '在规范四字节网络序长度之后复制非空字节；原生原写入器拥有排序及排空。'
      },
      params: {
        payload: {
          en: 'Complete nonempty original payload, bounded at 16 MiB.',
          zh: '完整非空原载荷，上限为十六兆字节。'
        },
        errorMetadata: {
          en: 'Optional caller-owned local diagnostic presentation.',
          zh: '可选调用方本地诊断展示。'
        }
      },
      returns: {
        en: 'Owned contiguous bytes; malformed/empty or oversized payload rejects with canonical framing errors.',
        zh: '所拥有的连续字节，非法、空或超限载荷以规范分帧错误拒绝。'
      },
      example:
        "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()\n"
    },
    encodeRpcStreamTextFrame: {
      role: 'operation',
      purpose: {
        en: 'UTF-8 encode text behind the same length prefix; sufficiently large supplied storage can be borrowed until actual write drain.',
        zh: '将文本编码到相同长度前缀之后；提供足够存储时可借用至实际写入排空。'
      },
      params: {
        text: {
          en: 'Complete original text.',
          zh: '完整原文本。'
        },
        encoder: {
          en: 'Actual native encode/encodeInto receiver.',
          zh: '实际原生编码接收者。'
        },
        storage: {
          en: 'Optional reusable storage; do not reuse before physical completion.',
          zh: '可选复用存储，物理完成前不能复用。'
        },
        errorMetadata: {
          en: 'Optional actual local error presentation.',
          zh: '可选实际本地错误展示。'
        }
      },
      returns: {
        en: 'Frame view which may alias the supplied storage.',
        zh: '可能与提供存储共享缓冲区的帧视图。'
      },
      example:
        "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()\n"
    },
    createRpcStreamFrameDecoder: {
      role: 'factory',
      purpose: {
        en: 'Create the single bounded length decoder; push returns consumed bytes so synchronous close leaves this native chunk tail untouched. Finish reports truncated input; close abandons it silently.',
        zh: '创建唯一有界长度解码器；输入返回已消费字节，使同步关闭保留本原生块尾部。输入结束报告截断，关闭则静默放弃。'
      },
      options: 'IRpcStreamFrameDecoderOptions',
      params: {
        options: {
          en: 'Actual complete-frame and first-error callbacks.',
          zh: '实际完整帧及首错回调。'
        }
      },
      returns: {
        en: 'Held decoder; finish/close terminate framing only, not physical IO.',
        zh: '所持解码器，结束及关闭仅终止分帧，不关闭物理读写。'
      },
      example:
        "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()\n"
    },
    createRpcStreamFrameDecoderWithLimit: {
      role: 'factory',
      purpose: {
        en: 'Create the single bounded length decoder; push returns consumed bytes so synchronous close leaves this native chunk tail untouched. Finish reports truncated input; close abandons it silently.',
        zh: '创建唯一有界长度解码器；输入返回已消费字节，使同步关闭保留本原生块尾部。输入结束报告截断，关闭则静默放弃。'
      },
      options: 'IRpcStreamFrameDecoderOptions',
      params: {
        options: {
          en: 'Actual complete-frame and first-error callbacks.',
          zh: '实际完整帧及首错回调。'
        },
        maxFrameBytes: {
          en: 'Current original admission bound, read before retaining a payload.',
          zh: '保留载荷前读取的当前原准入上限。'
        }
      },
      returns: {
        en: 'Held decoder; finish/close terminate framing only, not physical IO.',
        zh: '所持解码器，结束及关闭仅终止分帧，不关闭物理读写。'
      },
      example:
        "import { createRpcStreamFrameDecoderWithLimit } from '@migaia/rpc-host/sdk'\nexport function bounded(accept: (frame: Uint8Array) => void) {\n  return createRpcStreamFrameDecoderWithLimit(() => 65536, {\n    onFrame: (frame) => accept(frame),\n    onError: (error) => console.error(error),\n  })\n}\n"
    },
    RPC_STREAM_MAX_FRAME_BYTES: {
      role: 'constant',
      purpose: {
        en: 'Maximum payload bytes in one canonical physical length-prefixed frame: 16 MiB. This is not the business group count.',
        zh: '一个规范物理长度前缀帧的载荷字节上限：十六兆字节，不是业务分组数量。'
      },
      example:
        "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()\n"
    },
    defineTransportPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Capture one genuine cold native transport definition. Its open callback acquires real carriers in the receiving Host and returns exact disposal/extensions; no second plugin-host or per-peer request facade is created.',
        zh: '捕获一个真实冷原生传输定义。其打开回调在接收宿主获取真实载体并返回精确释放及扩展，不创建第二插件宿主或逐对端请求门面。'
      },
      params: {
        definition: {
          en: 'Actual named namespace, complete feature instances and native open capability.',
          zh: '实际命名空间名、完整功能实例及原生打开能力。'
        }
      },
      options: 'IRpcTransportDefinition',
      returns: {
        en: 'Native registered transport identity. Copying its fields does not preserve installation authority.',
        zh: '原生登记传输身份，复制字段不会保留安装权限。'
      },
      example:
        "import { defineTransportPlugin, createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\n\nexport function transport(io: IRpcMessageIO, id: string) {\n  return defineTransportPlugin({\n    name: 'application-channel',\n    namespace: 'channel',\n    async open(context) {\n      const carrier = createRpcMessageCarrier({ id, io, report: context.report })\n      const handle = context.attach(carrier)\n      await handle.ready\n      return { dispose: () => handle.close() }\n    },\n  })\n}\n"
    },
    defineFlowPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Capture a reusable cold flow definition whose setup constructs per-Host hooks and cleanup. Optional metadata cannot replace native name/install identity.',
        zh: '捕获可复用冷信息流定义，其设置为每个宿主构造介入点及清理。可选元数据不能替换原生名称及安装身份。'
      },
      params: {
        definition: {
          en: 'Native name, namespace scope and per-install setup callback.',
          zh: '原生名称、命名空间作用域及逐次安装设置回调。'
        },
        metadata: {
          en: 'Optional original collector own-data metadata, excluding name and install.',
          zh: '可选原收集器自有数据元数据，不含名称及安装字段。'
        }
      },
      options: 'IRpcFlowDefinition',
      returns: {
        en: 'Actual native flow definition, installable before transport startup.',
        zh: '实际原生信息流定义，可在传输启动前安装。'
      },
      example:
        "import { defineFlowPlugin } from '@migaia/rpc-host/sdk'\n\nexport const trace = defineFlowPlugin({\n  name: 'application-trace',\n  setup() {\n    return { hooks: { observe: (event) => console.log(event) } }\n  },\n})\n"
    },
    defineLinkPolicy: {
      role: 'enhancer',
      purpose: {
        en: 'Register complete call-feature defaults without adding a second intervention pipeline or call strategy in Host.',
        zh: '登记完整调用功能默认值，不在宿主增加第二介入流水线或调用策略。'
      },
      params: {
        definition: {
          en: 'Native policy name and complete feature list.',
          zh: '原生策略名称及完整功能列表。'
        }
      },
      options: 'IRpcLinkPolicyDefinition',
      returns: {
        en: 'Cold native link-policy definition with no timer or retry work until a real invocation.',
        zh: '冷原生链路策略定义，实际调用前没有计时或重试工作。'
      },
      example:
        "import { defineLinkPolicy } from '@migaia/rpc-host/sdk'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = defineLinkPolicy({\n  name: 'application-policy',\n  features: [timeout({ ms: 500 })],\n})\n"
    },
    RpcPortableCapture: {
      role: 'factory',
      purpose: {
        en: 'Reuse the single serialize walker for owned portable snapshots while preserving genuine native backing/view identities.',
        zh: '复用唯一序列化遍历器创建所拥有的可移植快照，并保留真实原生缓冲区及视图身份。'
      },
      params: {
        errorMetadata: {
          en: 'Optional caller-owned presentation maps for local capture errors.',
          zh: '本地捕获错误的可选调用方展示映射。'
        }
      },
      returns: {
        en: 'One held capture walker; it acquires no native resource and needs no native dispose operation.',
        zh: '一个所持捕获遍历器，不获取原生资源，也不需要原生释放操作。'
      },
      example:
        "import { RpcPortableCapture } from '@migaia/rpc-host/sdk'\nconst capture = new RpcPortableCapture()\nexport const snapshot = capture.normalize({ label: 'ready' })\n"
    },
    RpcJsonCarrierCodec: {
      role: 'factory',
      purpose: {
        en: 'Own the one prepare/encode/decode/restore execution chain. Capture precedes hooks/hashing; parse occurs once, and semantic restore remains the sole admission owner.',
        zh: '拥有唯一准备、编码、解码及恢复执行链。捕获在介入点及散列之前，解析只执行一次，语义恢复仍是唯一准入所有者。'
      },
      params: {
        options: {
          en: 'Optional native digest and already-redacted syntax-failure projection, with no extra parser.',
          zh: '可选原生散列及已脱敏语法失败投影，不增加解析器。'
        }
      },
      returns: {
        en: 'One explicit resource owner; use its actual public instance surface and release resources according to native ownership.',
        zh: '一个显式资源所有者，使用其实际公开实例表面，并按原生所有权释放资源。'
      },
      example:
        "import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'\nexport const codec = new RpcJsonCarrierCodec()\n",
      optionDocs: {
        digest: {
          summary: {
            en: 'Actual native SHA-256 backing digest capability; it is not authentication authority.',
            zh: '实际原生完整缓冲区散列能力，不授予认证权限。'
          },
          default: {
            en: 'Use available native digest capability.',
            zh: '使用可用的原生散列能力。'
          },
          example:
            "import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryDigest } from '@migaia/rpc-host/sdk'\nexport function codec(\n  digest: IRpcBinaryDigest,\n  projectDecodeFailure: (cause: unknown) => Error,\n) {\n  return new RpcJsonCarrierCodec({ digest, projectDecodeFailure })\n}\n",
          whenToUse: {
            en: 'Lend the actual native digest and safe parse-error projector for a medium with a distinct coded decode boundary.',
            zh: '媒介有独立带码解码边界时借用实际原生散列及安全解析错误投影，不执行第二次文本解析。'
          }
        },
        projectDecodeFailure: {
          summary: {
            en: 'Called only with the already privacy-projected original parser cause. Return this media native coded Error; do not parse the text again.',
            zh: '仅以已经过隐私投影的原解析原因调用，返回本媒介原生分类错误，不再次解析文本。'
          },
          default: {
            en: 'Canonical privacy-safe Contract handshake error.',
            zh: '规范且保护隐私的契约握手错误。'
          },
          example:
            "import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryDigest } from '@migaia/rpc-host/sdk'\nexport function codec(\n  digest: IRpcBinaryDigest,\n  projectDecodeFailure: (cause: unknown) => Error,\n) {\n  return new RpcJsonCarrierCodec({ digest, projectDecodeFailure })\n}\n",
          whenToUse: {
            en: 'Lend the actual native digest and safe parse-error projector for a medium with a distinct coded decode boundary.',
            zh: '媒介有独立带码解码边界时借用实际原生散列及安全解析错误投影，不执行第二次文本解析。'
          }
        }
      }
    },
    RpcUtf8: {
      role: 'factory',
      purpose: {
        en: 'Capture one real encoder and fatal UTF-8 decoder. Malformed bytes keep the exact native exception as the canonical handshake failure cause.',
        zh: '捕获一个真实编码器及严格字符解码器。非法字节在规范握手失败原因中保留精确原生异常。'
      },
      params: {
        options: {
          en: 'Optional structural native Encoding API capabilities.',
          zh: '可选结构原生编码能力。'
        }
      },
      returns: {
        en: 'Held native encoding capabilities, without a physical connection or independent close lifetime.',
        zh: '所持原生编码能力，不含物理连接或独立关闭生命周期。'
      },
      example:
        "import { RpcUtf8 } from '@migaia/rpc-host/sdk'\nconst utf8 = new RpcUtf8()\nexport const text = utf8.decode(new Uint8Array([111, 107]))\n",
      options: 'IRpcUtf8Options',
      optionDocs: {
        'encoder.encode': {
          summary: {
            en: 'Encode canonical text using the original native encoder receiver.',
            zh: '使用原生原编码接收者将规范文本编码为字节。'
          },
          params: {
            value: {
              en: 'Canonical carrier JSON text ready for byte framing.',
              zh: '等待字节分帧的规范载体文本。'
            }
          },
          returns: {
            en: 'Newly encoded native UTF-8 bytes.',
            zh: '新分配的原生字符编码字节。'
          },
          example:
            "import { RpcUtf8 } from '@migaia/rpc-host/sdk'\nconst utf8 = new RpcUtf8({\n  encoder: new TextEncoder(),\n  decoder: new TextDecoder('utf-8', { fatal: true }),\n})\nconst bytes = utf8.encoder.encode('hello')\nconst target = new Uint8Array(16)\nutf8.encoder.encodeInto('hello', target)\nexport const text = utf8.decode(bytes)\n",
          whenToUse: {
            en: 'Use actual Encoding API receivers to retain native allocation and malformed-text behavior.',
            zh: '使用真实编码接口接收者，保留原生分配及非法文本行为，不重新实现字符算法。'
          }
        },
        'encoder.encodeInto': {
          summary: {
            en: 'Write encoded text into the physical framer owned target view.',
            zh: '将文本编码写入物理分帧器所拥有的目标视图。'
          },
          params: {
            value: {
              en: 'Canonical carrier text from the encoding stage.',
              zh: '编码阶段产生的规范载体文本。'
            },
            target: {
              en: 'Writable target acquired by the original physical framer.',
              zh: '原物理分帧器获取的可写目标视图。'
            }
          },
          returns: {
            en: 'The number of bytes actually written; the native encoder determines partial progress.',
            zh: '实际写入字节数，部分进度由原生编码器决定。'
          },
          example:
            "import { RpcUtf8 } from '@migaia/rpc-host/sdk'\nconst utf8 = new RpcUtf8({\n  encoder: new TextEncoder(),\n  decoder: new TextDecoder('utf-8', { fatal: true }),\n})\nconst bytes = utf8.encoder.encode('hello')\nconst target = new Uint8Array(16)\nutf8.encoder.encodeInto('hello', target)\nexport const text = utf8.decode(bytes)\n",
          whenToUse: {
            en: 'Use actual Encoding API receivers to retain native allocation and malformed-text behavior.',
            zh: '使用真实编码接口接收者，保留原生分配及非法文本行为，不重新实现字符算法。'
          }
        },
        'decoder.decode': {
          summary: {
            en: 'Decode with fatal UTF-8 semantics and preserve the native malformed-input throw.',
            zh: '按严格字符语义解码，并保留非法输入的原生抛错。'
          },
          params: {
            value: {
              en: 'One complete received payload from the canonical byte framer.',
              zh: '规范字节分帧器交付的一个完整接收载荷。'
            }
          },
          returns: {
            en: 'Decoded text; malformed input throws instead of inserting replacement characters.',
            zh: '解码文本，非法输入抛错而非插入替换字符。'
          },
          example:
            "import { RpcUtf8 } from '@migaia/rpc-host/sdk'\nconst utf8 = new RpcUtf8({\n  encoder: new TextEncoder(),\n  decoder: new TextDecoder('utf-8', { fatal: true }),\n})\nconst bytes = utf8.encoder.encode('hello')\nconst target = new Uint8Array(16)\nutf8.encoder.encodeInto('hello', target)\nexport const text = utf8.decode(bytes)\n",
          whenToUse: {
            en: 'Use actual Encoding API receivers to retain native allocation and malformed-text behavior.',
            zh: '使用真实编码接口接收者，保留原生分配及非法文本行为，不重新实现字符算法。'
          }
        }
      }
    },
    RpcCarrierObservation: {
      role: 'factory',
      purpose: {
        en: 'Own the native carrier single exact observation subscription and acquired immutable media facts; emit borrowed raw IO only when subscribed.',
        zh: '拥有原生载体唯一精确观察订阅及已获取不可变媒介事实，仅在订阅时发出借用原始读写数据。'
      },
      params: {
        facts: {
          en: 'Actual acquired platform/topology/encoding facts.',
          zh: '实际获取的平台、拓扑及编码事实。'
        },
        report: {
          en: 'Original native owner diagnostic destination.',
          zh: '原生原所有者诊断通道。'
        }
      },
      returns: {
        en: 'One explicit resource owner; use its actual public instance surface and release resources according to native ownership.',
        zh: '一个显式资源所有者，使用其实际公开实例表面，并按原生所有权释放资源。'
      },
      example:
        "import { RpcCarrierObservation } from '@migaia/rpc-host/sdk'\nimport { RpcCarrierPlatform, RpcCarrierEncoding } from '@migaia/rpc-contract/interfaces'\nexport const observation = new RpcCarrierObservation(\n  {\n    platform: RpcCarrierPlatform.messagePort,\n    encodedType: RpcCarrierEncoding.any,\n  },\n  console.error,\n)\n"
    },
    RpcMemberGeneration: {
      role: 'factory',
      purpose: {
        en: 'Reuse the actual supervisor and acquire/attach/detach ports for one accepted member generation. Native restart policy and business calls remain outside this owner.',
        zh: '复用实际监管器及获取、附加和摘除端口以管理一个接纳成员代际，原生重启策略及业务调用位于此所有者之外。'
      },
      params: {
        options: {
          en: 'Original native binding and explicit Session/cancellation/report callbacks.',
          zh: '原生原绑定及显式会话、取消和上报回调。'
        }
      },
      returns: {
        en: 'One explicit resource owner; use its actual public instance surface and release resources according to native ownership.',
        zh: '一个显式资源所有者，使用其实际公开实例表面，并按原生所有权释放资源。'
      },
      example:
        "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberGenerationOptions } from '@migaia/rpc-host/sdk'\nexport function member<T, S>(options: IRpcMemberGenerationOptions<T, S>) {\n  return new RpcMemberGeneration(options)\n}\n",
      options: 'IRpcMemberGenerationOptions'
    },
    RpcNativeMembers: {
      role: 'factory',
      purpose: {
        en: 'Project passive local members queries and controls from actual native records and indexes, without a second registry or supervisor.',
        zh: '从实际原生记录及索引投影被动本地成员查询及控制，不增加第二登记表或监管器。'
      },
      params: {
        options: {
          en: 'Original native kind, global self getter, source lookup and reporter.',
          zh: '原生原类别、全局自身读取器、来源查找及上报器。'
        }
      },
      returns: {
        en: 'One explicit resource owner; use its actual public instance surface and release resources according to native ownership.',
        zh: '一个显式资源所有者，使用其实际公开实例表面，并按原生所有权释放资源。'
      },
      example:
        "import { RpcNativeMembers } from '@migaia/rpc-host/sdk'\nimport type { IRpcNativeMembersOptions } from '@migaia/rpc-host/sdk'\nexport function controls(options: IRpcNativeMembersOptions<'process'>) {\n  return new RpcNativeMembers(options)\n}\n",
      options: 'IRpcNativeMembersOptions'
    },
    RpcNativePoolMember: {
      role: 'factory',
      purpose: {
        en: 'Project an original native member into repeatable Pool acquisition without adding readiness, media, lifecycle or supervision state.',
        zh: '将原原生成员投影为可重复池获取，不增加就绪、媒介、生命周期或监管状态。'
      },
      params: {
        options: {
          en: 'Actual registration, original native generation/currentHandle/rebind and original close.',
          zh: '实际登记、原生原代际及当前句柄、重绑定与原关闭。'
        }
      },
      returns: {
        en: 'One explicit resource owner; use its actual public instance surface and release resources according to native ownership.',
        zh: '一个显式资源所有者，使用其实际公开实例表面，并按原生所有权释放资源。'
      },
      example:
        "import type { IRpcNativePoolMember } from '@migaia/rpc-host/sdk'\nexport async function acquired(member: IRpcNativePoolMember) {\n  return member.ready()\n}\n",
      optionDocs: {
        record: {
          summary: {
            en: 'Exact original native registration, including accepted stable name and safe local query capabilities.',
            zh: '精确原生原登记，包含已接纳稳定名称及安全本地查询能力。'
          },
          example:
            "import { RpcNativePoolMember } from '@migaia/rpc-host/sdk'\nexport function selected(\n  options: ConstructorParameters<typeof RpcNativePoolMember>[0],\n) {\n  const { record, native, close } = options\n  return new RpcNativePoolMember({ record, native, close })\n}\n",
          whenToUse: {
            en: 'Project an actual private native acquisition through its original registration and generation ownership.',
            zh: '将真实私有原生获取通过其原登记及代际所有权投影到池成员边界，不创建逻辑媒介或就绪替身。'
          }
        },
        native: {
          summary: {
            en: 'Original native generation authority borrowed by this member.',
            zh: '本成员借用的原生原代际权限。'
          },
          example:
            "import { RpcNativePoolMember } from '@migaia/rpc-host/sdk'\nexport function selected(\n  options: ConstructorParameters<typeof RpcNativePoolMember>[0],\n) {\n  const { record, native, close } = options\n  return new RpcNativePoolMember({ record, native, close })\n}\n",
          whenToUse: {
            en: 'Project an actual private native acquisition through its original registration and generation ownership.',
            zh: '将真实私有原生获取通过其原登记及代际所有权投影到池成员边界，不创建逻辑媒介或就绪替身。'
          }
        },
        close: {
          summary: {
            en: 'Original exact resource close callable; repeated closes share its owned completion.',
            zh: '原精确资源关闭方法，重复关闭共享其拥有的完成。'
          },
          example:
            "import { RpcNativePoolMember } from '@migaia/rpc-host/sdk'\nexport function selected(\n  options: ConstructorParameters<typeof RpcNativePoolMember>[0],\n) {\n  const { record, native, close } = options\n  return new RpcNativePoolMember({ record, native, close })\n}\n",
          whenToUse: {
            en: 'Project an actual private native acquisition through its original registration and generation ownership.',
            zh: '将真实私有原生获取通过其原登记及代际所有权投影到池成员边界，不创建逻辑媒介或就绪替身。'
          }
        }
      }
    },
    RpcBytePump: {
      role: 'factory',
      purpose: {
        en: 'Hold one successfully acquired native reader/writer pair. Read only after a receiver subscribes, preserving original native ordering and terminal cleanup.',
        zh: '持有一组已成功获取的原生读取及写入端口，仅在接收者订阅后读取，保留原生原排序及终止清理。'
      },
      params: {
        reader: {
          en: 'Original already-acquired native reader.',
          zh: '原已获取原生读取器。'
        },
        writer: {
          en: 'Original already-acquired native writer.',
          zh: '原已获取原生写入器。'
        },
        closePhysical: {
          en: 'Original physical release owned by acquisition.',
          zh: '获取所拥有的原物理释放。'
        },
        options: {
          en: 'Native closed/cleanup error factories and reporter/observer.',
          zh: '原生关闭及清理错误工厂、上报器及观察器。'
        }
      },
      returns: {
        en: 'One explicit resource owner; use its actual public instance surface and release resources according to native ownership.',
        zh: '一个显式资源所有者，使用其实际公开实例表面，并按原生所有权释放资源。'
      },
      example:
        "import { RpcBytePump } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcByteReader,\n  IRpcByteWriter,\n  IRpcBytePumpOptions,\n} from '@migaia/rpc-host/sdk'\nexport function bytes(\n  reader: IRpcByteReader,\n  writer: IRpcByteWriter,\n  close: () => Promise<void>,\n  options: IRpcBytePumpOptions,\n) {\n  return new RpcBytePump(reader, writer, close, options).value\n}\n",
      options: 'IRpcBytePumpOptions'
    },
    RpcEventByteIO: {
      role: 'factory',
      purpose: {
        en: 'Hold original emitter-based reader/writer events with pause/resume, callback settlement and write-drain ownership.',
        zh: '持有原事件式读取及写入端口，保留暂停恢复、回调结算及写入排空所有权。'
      },
      params: {
        reader: {
          en: 'Original native emitter reader.',
          zh: '原生原事件读取器。'
        },
        writer: {
          en: 'Original native callback writer.',
          zh: '原生原回调写入器。'
        },
        closePhysical: {
          en: 'Original physical cleanup.',
          zh: '原物理清理。'
        },
        options: {
          en: 'Original closed-error factory, reporter and optional native observer.',
          zh: '原关闭错误工厂、上报器及可选原生观察器。'
        }
      },
      returns: {
        en: 'One explicit resource owner; use its actual public instance surface and release resources according to native ownership.',
        zh: '一个显式资源所有者，使用其实际公开实例表面，并按原生所有权释放资源。'
      },
      example:
        "import { RpcEventByteIO } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcEventByteReader,\n  IRpcEventByteWriter,\n  IRpcEventByteIOOptions,\n} from '@migaia/rpc-host/sdk'\nexport function bytes(\n  reader: IRpcEventByteReader,\n  writer: IRpcEventByteWriter,\n  close: () => void,\n  options: IRpcEventByteIOOptions,\n) {\n  return new RpcEventByteIO(reader, writer, close, options).value\n}\n",
      options: 'IRpcEventByteIOOptions'
    },
    HostObservationKind: {
      role: 'constant',
      purpose: {
        en: 'Actual accepted Session lifecycle observations; installing a subscriber does not create lifecycle authority.',
        zh: '实际接纳会话生命周期观察，安装订阅者不会创建生命周期权限。'
      },
      example:
        "import { HostObservationKind } from '@migaia/rpc-host/sdk'\nexport const choices = HostObservationKind\n"
    },
    RpcProtocolEvent: {
      role: 'constant',
      purpose: {
        en: 'Readonly protocol/control observations consumed through the actual observer boundary.',
        zh: '通过实际观察边界消费的只读协议及控制观察。'
      },
      example:
        "import { RpcProtocolEvent } from '@migaia/rpc-host/sdk'\nexport const choices = RpcProtocolEvent\n"
    },
    RpcBinaryStorage: {
      role: 'constant',
      purpose: {
        en: 'The acquired native media chooses the binary manifest representation; payload flags do not grant transfer.',
        zh: '已获取原生媒介选择二进制清单表示，载荷标记不授予转移权限。'
      },
      example:
        "import { RpcBinaryStorage } from '@migaia/rpc-host/sdk'\nexport const choices = RpcBinaryStorage\n"
    },
    RpcMemberSourceKind: {
      role: 'constant',
      purpose: {
        en: 'Actual native source acquisition mode, independent of connection direction.',
        zh: '标记原生来源实际获取模式，与连接方向及资源所有权分别描述。'
      },
      example:
        "import { RpcMemberSourceKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberSourceKind\n"
    },
    RpcMemberConnectionDirection: {
      role: 'constant',
      purpose: {
        en: 'Actual local/bootstrap direction, independent of owned or borrowed lifetime.',
        zh: '实际本地及启动方向，与拥有或借用生命周期不同。'
      },
      example:
        "import { RpcMemberConnectionDirection } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberConnectionDirection\n"
    },
    RpcMemberQueryStatus: {
      role: 'constant',
      purpose: {
        en: 'Safe actual connection availability; missing observations remain explicit.',
        zh: '表达真实连接当前可用状态，所有者没有观察时明确标记缺失。'
      },
      example:
        "import { RpcMemberQueryStatus } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberQueryStatus\n"
    },
    RpcMemberQueryReason: {
      role: 'constant',
      purpose: {
        en: 'Canonical explanations for unavailable native/member observations without invented healthy/zero values.',
        zh: '原生及成员观察不可用的规范说明，不伪造健康或零值。'
      },
      example:
        "import { RpcMemberQueryReason } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberQueryReason\n"
    },
    RpcMemberResourceKind: {
      role: 'constant',
      purpose: {
        en: 'Native CPU time and event-loop utilization are separate resource dimensions.',
        zh: '原生处理器时间及事件循环使用率是不同资源维度。'
      },
      example:
        "import { RpcMemberResourceKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberResourceKind\n"
    },
    RpcMemberMetricScope: {
      role: 'constant',
      purpose: {
        en: 'Metric denominators identify actual source scope rather than attributing global totals to a peer.',
        zh: '指标分母标明实际来源作用域，不把全局总量归给某对端。'
      },
      example:
        "import { RpcMemberMetricScope } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberMetricScope\n"
    },
    RpcMemberMetricUnit: {
      role: 'constant',
      purpose: {
        en: 'Explicit units keep counts, time, bytes and ratios separate.',
        zh: '指标单位区分次数、字节、时间与无量纲比例，不同单位不能互相推算。'
      },
      example:
        "import { RpcMemberMetricUnit } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberMetricUnit\n"
    },
    RpcMemberRecentKind: {
      role: 'constant',
      purpose: {
        en: 'Bounded original registration-departure facts do not manufacture native exit state.',
        zh: '记录有界原登记离开事实，不制造没有观察到的原生退出状态。'
      },
      example:
        "import { RpcMemberRecentKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberRecentKind\n"
    },
    RpcMemberEventName: {
      role: 'constant',
      purpose: {
        en: 'Passive member events come from original native lifecycle or completed explicit liquidation.',
        zh: '被动成员事件来自原原生生命周期或已完成显式清算。'
      },
      example:
        "import { RpcMemberEventName } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberEventName\n"
    },
    RpcMemberQueryClock: {
      role: 'constant',
      purpose: {
        en: 'Original monotonic scheduler timestamps do not use wall-clock epoch time.',
        zh: '查询时间使用原调度器单调时钟域，不能与纪元时间混合比较。'
      },
      example:
        "import { RpcMemberQueryClock } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberQueryClock\n"
    },
    RpcMemberQueryLimit: {
      role: 'constant',
      purpose: {
        en: 'The original passive recent/watch retention bound, not provider concurrency.',
        zh: '限制原生被动历史及观察保留量，与提供方并发配额相互独立。'
      },
      example:
        "import { RpcMemberQueryLimit } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberQueryLimit\n"
    },
    RpcNativeMemberKind: {
      role: 'constant',
      purpose: {
        en: 'Original native capability family determines the existing control/sampling boundary.',
        zh: '原生能力类别决定已有控制及采样边界，不提供跨媒介能力猜测。'
      },
      example:
        "import { RpcNativeMemberKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcNativeMemberKind\n"
    },
    RpcNativeFeatureKind: {
      role: 'constant',
      purpose: {
        en: 'Concrete native transport installs the complete same-medium resource feature.',
        zh: '由具体原生传输安装完整同媒介资源功能，宿主不执行池调度。'
      },
      example:
        "import { RpcNativeFeatureKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcNativeFeatureKind\n"
    },
    RpcBinaryProfile: {
      role: 'constant',
      purpose: {
        en: 'Portable binary representation profile migaia.rpc.portable-binary/1, nested inside the single migaia.rpc/2 semantic protocol; this is not a second RPC grammar.',
        zh: '唯一第二版语义协议内部的第一版可移植二进制表示标记，不是第二套远程调用语法。'
      },
      example:
        "import { RpcBinaryProfile } from '@migaia/rpc-host/sdk'\nexport const binaryProfile = RpcBinaryProfile\n"
    },
    RpcMemberStopSignal: {
      role: 'constant',
      purpose: {
        en: 'Original graceful process signal SIGTERM; thread/coroutine controls do not gain process signaling.',
        zh: '原优雅进程结束信号，线程及协作任务控制不获得进程信号权限。'
      },
      example:
        "import { RpcMemberStopSignal } from '@migaia/rpc-host/sdk'\nexport const processStop = { signal: RpcMemberStopSignal }\n"
    },
    'plugins/link-policy:RpcLinkPolicyName': {
      role: 'constant',
      purpose: {
        en: 'Stable native plugin identity used by the built-in linkPolicy definition. It is not a transport namespace.',
        zh: '内建链路策略定义使用的稳定原生插件身份，不是传输命名空间。'
      },
      example:
        "import { RpcLinkPolicyName } from '@migaia/rpc-host/plugins/link-policy'\nexport const policyName = RpcLinkPolicyName\n"
    },
    createProbeEmitter: {
      role: 'factory',
      purpose: {
        en: 'Create the existing fixed probe receiver over genuine defineProbe handles. It owns only stage subscriptions, sampling, the reused view and callback isolation, without acquiring IO.',
        zh: '以真实探针句柄创建现有固定探针接收者，只拥有阶段订阅、采样、复用视图及回调隔离，不获取读写资源。'
      },
      params: {
        probes: {
          en: 'Exact genuine handles produced by defineProbe.',
          zh: '探针定义工厂产生的精确真实句柄。'
        },
        now: {
          en: 'Existing monotonic observation clock.',
          zh: '现有单调观察时钟。'
        },
        endpointId: {
          en: 'Use the instanceId returned by host.self, or a getter returning that current global identity.',
          zh: '使用 `host.self` 返回的实例标识，或返回当前全局身份的读取器。'
        },
        report: {
          en: 'Optional original diagnostic reporter.',
          zh: '可选原诊断上报器。'
        }
      },
      returns: {
        en: 'Held emitter; dispose removes its subscriptions and retained view references.',
        zh: '所持发射器，释放会移除订阅及保留视图引用。'
      },
      example:
        "import { defineProbe, createProbeEmitter } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message'],\n  emit: (view) => console.log({ ...view }),\n})\nconst emitter = createProbeEmitter([observer], () => performance.now(), 'application')\nemitter.dispose()\n"
    },
    defaultRpcReporter: {
      role: 'operation',
      purpose: {
        en: 'Write an original background RPC failure to console.error without changing its identity.',
        zh: '将原后台远程调用失败写入标准错误输出，不改变其身份。'
      },
      params: {
        error: {
          en: 'Original failure supplied by the actual RPC/native owner.',
          zh: '实际远程调用或原生所有者提供的原失败。'
        }
      },
      returns: {
        en: 'No return value; application report options replace this default destination.',
        zh: '不返回值，应用上报选项替换此默认通道。'
      },
      example:
        "import { defaultRpcReporter } from '@migaia/rpc-host'\nexport const report = defaultRpcReporter\n"
    }
  },
  types: {
    createRpcMemberEventPublisher: {
      summary: {
        en: 'Type-only SDK binding for the internal passive publisher factory signature. The SDK has no runtime factory export with this name. Borrow the existing native member controls for on/watch subscriptions instead of constructing another event owner.',
        zh: '仅作为类型导出的内部被动发布器工厂签名；此名称不是开发接口的运行时工厂。订阅时借用已有原生成员控制中的监听及观察能力，不另建事件所有者。'
      },
      members: {},
      example:
        "import type { createRpcMemberEventPublisher } from '@migaia/rpc-host/sdk'\nexport type IMemberPublisherFactory = typeof createRpcMemberEventPublisher\nexport type IMemberPublisher = ReturnType<IMemberPublisherFactory>\n"
    },
    rpcMemberQueryOutput: {
      summary: {
        en: 'Type-only SDK binding for the internal safe-snapshot formatter signature; it cannot be called from this entry. Request formatted output through the actual native member controls list/get methods, which select and sample their own records.',
        zh: '仅作为类型导出的内部安全快照格式化签名，不能从此入口调用。通过实际原生成员控制的列表及查询方法请求格式化输出，由原所有者选择并采样记录。'
      },
      members: {},
      example:
        "import type { rpcMemberQueryOutput } from '@migaia/rpc-host/sdk'\nexport type IMemberQueryFormatter = typeof rpcMemberQueryOutput\n"
    },
    rpcCarrierWriteFacts: {
      summary: {
        en: 'Type-only SDK binding for the pure admitted-header write-facts function signature. It describes sendClass/trace projection without writing or queuing. Import the callable value from @migaia/rpc-contract/interfaces when implementing a real carrier boundary.',
        zh: '仅作为类型导出的已准入头部写入事实纯函数签名，描述发送通道及关联投影，不执行写入或排队。实现真实载体边界时，可调用值从契约包接口入口导入。'
      },
      members: {},
      example:
        "import type { rpcCarrierWriteFacts } from '@migaia/rpc-host/sdk'\nexport type ICarrierWriteFacts = typeof rpcCarrierWriteFacts\n"
    },
    rpcProbeEnvelopeFacts: {
      summary: {
        en: 'Type-only SDK binding for compact admitted envelope observation projection. Its signature describes borrowed correlation, method and route facts without observer state or authority. The callable value belongs to @migaia/rpc-contract/interfaces.',
        zh: '仅作为类型导出的紧凑已准入信封观察投影签名，描述借用的关联、方法及路由事实，不包含观察状态或权限。可调用值属于契约包接口入口。'
      },
      members: {},
      example:
        "import type { rpcProbeEnvelopeFacts } from '@migaia/rpc-host/sdk'\nexport type IEnvelopeProbeFacts = typeof rpcProbeEnvelopeFacts\n"
    },
    rpcProbeEnvelopeKind: {
      summary: {
        en: 'Type-only SDK binding for the pure operational/control-frame to probe-kind classifier signature. It neither parses content nor emits events. Import the callable classifier from @migaia/rpc-contract/interfaces for actual observation projection.',
        zh: '仅作为类型导出的操作及控制帧到探针种类的纯分类签名，不解析内容或发布事件。实际观察投影需要的可调用分类器从契约包接口入口导入。'
      },
      members: {},
      example:
        "import type { rpcProbeEnvelopeKind } from '@migaia/rpc-host/sdk'\nexport type IEnvelopeProbeKind = typeof rpcProbeEnvelopeKind\n"
    },
    RpcCallFeatureKind: {
      summary: {
        en: 'Type-only SDK binding for the timeout/retry discriminant table shape. Complete executing features use these exact tags; import the runtime table from @migaia/rpc-contract/interfaces rather than this SDK entry.',
        zh: '仅作为类型导出的超时与重试种类表形状，完整执行功能使用这些精确标识。运行时表从契约包接口入口导入，不从开发接口入口取值。'
      },
      members: Object.fromEntries(
        Object.entries(contractReference.enums.RpcCallFeatureKind!.values).map(
          ([name, summary]) => [name, { summary }]
        )
      ),
      example:
        "import type { RpcCallFeatureKind } from '@migaia/rpc-host/sdk'\nexport type ICallFeatureKinds = typeof RpcCallFeatureKind\n"
    },
    RpcCarrierEncoding: {
      summary: {
        en: 'Type-only SDK binding for the actual native representation table shape, distinct from semantic codec ids. The canonical any/string/byte values remain runtime exports of @migaia/rpc-contract/interfaces.',
        zh: '仅作为类型导出的实际原生表示表形状，与语义编解码标识不同。规范结构化值、文本及字节取值仍由契约包接口入口在运行时导出。'
      },
      members: Object.fromEntries(
        Object.entries(contractReference.enums.RpcCarrierEncoding!.values).map(
          ([name, summary]) => [name, { summary }]
        )
      ),
      example:
        "import type { RpcCarrierEncoding } from '@migaia/rpc-host/sdk'\nexport type ICarrierEncodings = typeof RpcCarrierEncoding\n"
    },
    RpcCarrierPlatform: {
      summary: {
        en: 'Type-only SDK binding for the acquired native platform diagnostic table shape. These labels grant no authentication or execution rights. Runtime labels are imported from @migaia/rpc-contract/interfaces.',
        zh: '仅作为类型导出的已获取原生平台诊断表形状，这些标签不授予认证或执行权限。运行时标签从契约包接口入口导入。'
      },
      members: Object.fromEntries(
        Object.entries(contractReference.enums.RpcCarrierPlatform!.values).map(
          ([name, summary]) => [name, { summary }]
        )
      ),
      example:
        "import type { RpcCarrierPlatform } from '@migaia/rpc-host/sdk'\nexport type ICarrierPlatforms = typeof RpcCarrierPlatform\n"
    },
    RpcCarrierTopology: {
      summary: {
        en: 'Type-only SDK binding for the acquired source topology table shape. Exclusive, multiplexed and broadcast describe actual source selection; the runtime table belongs to @migaia/rpc-contract/interfaces.',
        zh: '仅作为类型导出的已获取来源拓扑表形状，独占、复用及广播描述真实来源选择。运行时表属于契约包接口入口。'
      },
      members: Object.fromEntries(
        Object.entries(contractReference.enums.RpcCarrierTopology!.values).map(
          ([name, summary]) => [name, { summary }]
        )
      ),
      example:
        "import type { RpcCarrierTopology } from '@migaia/rpc-host/sdk'\nexport type ICarrierTopologies = typeof RpcCarrierTopology\n"
    },
    RpcProbeAuthentication: {
      summary: {
        en: 'Type-only SDK binding for the actual authentication observation label table shape. Installed authentication supplies these diagnostic facts; they do not authorize callers. Import runtime labels from @migaia/rpc-contract/interfaces.',
        zh: '仅作为类型导出的实际认证观察标签表形状，由已安装认证提供诊断事实，不授予调用者权限。运行时标签从契约包接口入口导入。'
      },
      members: Object.fromEntries(
        Object.entries(contractReference.enums.RpcProbeAuthentication!.values).map(
          ([name, summary]) => [name, { summary }]
        )
      ),
      example:
        "import type { RpcProbeAuthentication } from '@migaia/rpc-host/sdk'\nexport type IProbeAuthenticationLabels = typeof RpcProbeAuthentication\n"
    },
    RpcProbeLifecycle: {
      summary: {
        en: 'Type-only SDK binding for Session handshake/ready/closing observation labels. Actual Session transitions own those facts; the runtime label table is available from @migaia/rpc-contract/interfaces.',
        zh: '仅作为类型导出的会话握手、就绪及关闭观察标签，由真实会话转换拥有这些事实。运行时标签表可从契约包接口入口取得。'
      },
      members: Object.fromEntries(
        Object.entries(contractReference.enums.RpcProbeLifecycle!.values).map(([name, summary]) => [
          name,
          { summary }
        ])
      ),
      example:
        "import type { RpcProbeLifecycle } from '@migaia/rpc-host/sdk'\nexport type IProbeLifecycleLabels = typeof RpcProbeLifecycle\n"
    },
    RpcProbeObservationKind: {
      summary: {
        en: 'Type-only SDK binding for event/descriptor observation discriminants. Events borrow completed-stage facts and descriptors expose installed capabilities. Runtime discriminants belong to @migaia/rpc-contract/interfaces.',
        zh: '仅作为类型导出的事件及描述符观察种类。事件借用已完成阶段事实，描述符展示已安装能力。运行时种类标识属于契约包接口入口。'
      },
      members: Object.fromEntries(
        Object.entries(contractReference.enums.RpcProbeObservationKind!.values).map(
          ([name, summary]) => [name, { summary }]
        )
      ),
      example:
        "import type { RpcProbeObservationKind } from '@migaia/rpc-host/sdk'\nexport type IProbeObservationKinds = typeof RpcProbeObservationKind\n"
    },
    RpcProbeStageName: {
      summary: {
        en: 'Type-only SDK binding for the ordered stage-name array shape. Its entries correspond to RpcProbeStage ordinals and define probe stage configuration names. Import the runtime name array from @migaia/rpc-contract/interfaces.',
        zh: '仅作为类型导出的有序阶段名称数组形状，条目对应数字观察阶段并定义探针配置名称。运行时名称数组从契约包接口入口导入。'
      },
      members: {},
      example:
        "import type { RpcProbeStageName } from '@migaia/rpc-host/sdk'\nexport type IProbeStageNames = typeof RpcProbeStageName\n"
    },
    RpcProbeDirectionName: {
      summary: {
        en: 'Type-only SDK binding for the ordered outbound/inbound/local direction-name array shape. It labels numeric probe directions without routing traffic. Import the runtime array from @migaia/rpc-contract/interfaces.',
        zh: '仅作为类型导出的有序出站、入站及本地方向名称数组形状，为数字观察方向提供名称，不参与流量路由。运行时数组从契约包接口入口导入。'
      },
      members: {},
      example:
        "import type { RpcProbeDirectionName } from '@migaia/rpc-host/sdk'\nexport type IProbeDirectionNames = typeof RpcProbeDirectionName\n"
    },
    RpcProbeKindName: {
      summary: {
        en: 'Type-only SDK binding for the ordered probe interaction-name array shape. It labels request, reply, notify, stream and control ordinals. Import the runtime names from @migaia/rpc-contract/interfaces.',
        zh: '仅作为类型导出的有序探针交互名称数组形状，为请求、响应、通知、流及控制序号提供名称。运行时名称从契约包接口入口导入。'
      },
      members: {},
      example:
        "import type { RpcProbeKindName } from '@migaia/rpc-host/sdk'\nexport type IProbeKindNames = typeof RpcProbeKindName\n"
    },
    RpcProbeOutcomeName: {
      summary: {
        en: 'Type-only SDK binding for the ordered probe progress-name array shape. It distinguishes creation, handoff, admission, settlement and failure observations. Import the runtime name array from @migaia/rpc-contract/interfaces.',
        zh: '仅作为类型导出的有序探针进展名称数组形状，区分创建、交接、准入、结算及失败观察。运行时名称数组从契约包接口入口导入。'
      },
      members: {},
      example:
        "import type { RpcProbeOutcomeName } from '@migaia/rpc-host/sdk'\nexport type IProbeOutcomeNames = typeof RpcProbeOutcomeName\n"
    },
    IRpcCallOptions: {
      summary: {
        en: 'One invocation combines complete feature overrides, cancellation, transfer and pure wire metadata; numeric policy shorthand is rejected.',
        zh: '一次调用组合完整功能覆盖、取消、转移及纯线上元数据；不接收数字策略缩写。'
      },
      members: {
        timeout: {
          summary: {
            en: 'Complete timeout feature or false for this invocation; an inherited chain deadline still bounds the attempt.',
            zh: '本次调用的完整超时实例或 `false`，继承链路截止时间仍限制尝试。'
          },
          default: {
            en: 'Inherit the transport feature, then link policy.',
            zh: '继承传输实例，再继承链路策略。'
          },
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
        },
        retry: {
          summary: {
            en: 'Complete originating retry feature or false; transit forwarding never executes this strategy.',
            zh: '完整发起方重试实例或 `false`，转发中继不执行此策略。'
          },
          default: {
            en: 'Inherit the transport feature, then link policy.',
            zh: '继承传输实例，再继承链路策略。'
          },
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
        },
        signal: {
          summary: {
            en: 'Caller signal observed before admission and throughout completion. Cancelling a provider does not roll back side effects or kill a native process.',
            zh: '在准入前及完成期间观察的调用方信号。取消提供方不回滚副作用，也不杀死原生进程。'
          },
          default: {
            en: 'No caller signal.',
            zh: '无调用方信号。'
          }
        },
        transfer: {
          summary: {
            en: 'Original ArrayBuffer list for native media supporting transfer. Unsupported media reject synchronously without reading a caller transfer getter.',
            zh: '真正支持原生转移的媒介使用的原缓冲区列表。不支持的媒介同步拒绝，不读取调用方转移访问器。'
          },
          default: {
            en: 'No transfer requested.',
            zh: '不请求转移。'
          }
        },
        trace: {
          summary: {
            en: 'Application diagnostic correlation text propagated within protocol bounds, without granting authority.',
            zh: '在协议边界内传递的应用诊断关联文本，不授予权限。'
          },
          default: {
            en: 'No explicit trace.',
            zh: '无显式追踪文本。'
          }
        },
        idempotencyKey: {
          summary: {
            en: 'Stable logical key issued by the originating application or retry keyFactory. A key alone does not install server-side deduplication.',
            zh: '发起应用或重试键工厂签发的稳定逻辑键；仅提供键不会安装服务端去重。'
          },
          default: {
            en: 'No explicit logical key.',
            zh: '无显式逻辑键。'
          }
        },
        orderKey: {
          summary: {
            en: 'Application ordering key; the shared provider FIFO starts same-key work in acceptance order and releases its receipt on every terminal path.',
            zh: '应用顺序键，共享提供方先进先出所有者按接纳顺序启动同键工作，并在各终止路径释放记录。'
          },
          default: {
            en: 'No ordering-key lane.',
            zh: '无顺序键通道。'
          }
        },
        cancel: {
          summary: {
            en: 'Explicit before-start cancellation policy for queued provider work; it does not roll back work that already entered the provider.',
            zh: '排队提供方工作的显式启动前取消策略，不回滚已进入提供方的工作。'
          },
          default: {
            en: 'Canonical call cancellation behavior.',
            zh: '规范调用取消行为。'
          },
          values: {
            'before-start': {
              en: 'Cancel while provider work is still queued before entry.',
              zh: '提供方工作尚在进入前排队时取消。'
            }
          }
        }
      },
      example:
        "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
    },
    IRpcNotifyOptions: {
      summary: {
        en: 'Call options with a direct target override for one-way delivery; physical completion is not a business acknowledgement.',
        zh: '用于单向投递的调用选项，可覆盖直接目标；物理完成不是业务确认。'
      },
      members: {
        timeout: {
          summary: {
            en: 'Complete timeout feature or false for this invocation; an inherited chain deadline still bounds the attempt.',
            zh: '本次调用的完整超时实例或 `false`，继承链路截止时间仍限制尝试。'
          },
          default: {
            en: 'Inherit the transport feature, then link policy.',
            zh: '继承传输实例，再继承链路策略。'
          },
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
        },
        retry: {
          summary: {
            en: 'Complete originating retry feature or false; transit forwarding never executes this strategy.',
            zh: '完整发起方重试实例或 `false`，转发中继不执行此策略。'
          },
          default: {
            en: 'Inherit the transport feature, then link policy.',
            zh: '继承传输实例，再继承链路策略。'
          },
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
        },
        signal: {
          summary: {
            en: 'Caller signal observed before admission and throughout completion. Cancelling a provider does not roll back side effects or kill a native process.',
            zh: '在准入前及完成期间观察的调用方信号。取消提供方不回滚副作用，也不杀死原生进程。'
          },
          default: {
            en: 'No caller signal.',
            zh: '无调用方信号。'
          }
        },
        transfer: {
          summary: {
            en: 'Original ArrayBuffer list for native media supporting transfer. Unsupported media reject synchronously without reading a caller transfer getter.',
            zh: '真正支持原生转移的媒介使用的原缓冲区列表。不支持的媒介同步拒绝，不读取调用方转移访问器。'
          },
          default: {
            en: 'No transfer requested.',
            zh: '不请求转移。'
          }
        },
        trace: {
          summary: {
            en: 'Application diagnostic correlation text propagated within protocol bounds, without granting authority.',
            zh: '在协议边界内传递的应用诊断关联文本，不授予权限。'
          },
          default: {
            en: 'No explicit trace.',
            zh: '无显式追踪文本。'
          }
        },
        idempotencyKey: {
          summary: {
            en: 'Stable logical key issued by the originating application or retry keyFactory. A key alone does not install server-side deduplication.',
            zh: '发起应用或重试键工厂签发的稳定逻辑键；仅提供键不会安装服务端去重。'
          },
          default: {
            en: 'No explicit logical key.',
            zh: '无显式逻辑键。'
          }
        },
        targetId: {
          summary: {
            en: 'Accepted direct peer name or instance identity in this namespace, obtained from actual peer/member identity.',
            zh: '本命名空间接纳的直接对端名称或实例身份，来自实际对端及成员身份。'
          },
          default: {
            en: 'Select all current direct targets.',
            zh: '选择当前全部直接目标。'
          }
        },
        orderKey: {
          summary: {
            en: 'Application ordering key; the shared provider FIFO starts same-key work in acceptance order and releases its receipt on every terminal path.',
            zh: '应用顺序键，共享提供方先进先出所有者按接纳顺序启动同键工作，并在各终止路径释放记录。'
          },
          default: {
            en: 'No ordering-key lane.',
            zh: '无顺序键通道。'
          }
        },
        cancel: {
          summary: {
            en: 'Explicit before-start cancellation policy for queued provider work; it does not roll back work that already entered the provider.',
            zh: '排队提供方工作的显式启动前取消策略，不回滚已进入提供方的工作。'
          },
          default: {
            en: 'Canonical call cancellation behavior.',
            zh: '规范调用取消行为。'
          },
          values: {
            'before-start': {
              en: 'Cancel while provider work is still queued before entry.',
              zh: '提供方工作尚在进入前排队时取消。'
            }
          }
        }
      }
    },
    IRpcFanoutResult: {
      summary: {
        en: 'Zero or multiple direct targets settle independently in null-prototype maps keyed by actual instance identity. One selected target yields a scalar.',
        zh: '零个或多个直接目标在无原型字典中独立结算，键为实际实例身份；仅选一个目标时返回标量。'
      },
      members: {
        fulfilled: {
          summary: {
            en: 'Successful values indexed by the accepted target instance identity.',
            zh: '按已接纳目标实例身份索引的成功值。'
          }
        },
        rejected: {
          summary: {
            en: 'Original per-target failures, without rejecting successful siblings.',
            zh: '各目标原失败，不使成功目标一同失败。'
          }
        }
      }
    },
    IRpcNamespace: {
      summary: {
        en: 'Typed business surface of exactly one installed transport namespace, separate from global Host ownership.',
        zh: '一个已安装传输命名空间的有类型业务表面，与全局宿主所有权分开。'
      },
      members: {
        peers: {
          summary: {
            en: 'Current directory capabilities; a retained function stays bound to its original generation and cannot silently retarget a successor.',
            zh: '当前目录能力；保留函数始终绑定原代际，不会静默重新指向后继。'
          }
        },
        request: {
          summary: {
            en: 'Wait independently for each selected target business result.',
            zh: '独立等待各选中目标的业务结果。'
          },
          params: {
            method: {
              en: 'Method path from the remote accepted directory, retaining application payload/result types.',
              zh: '来自远端接纳目录的方法路径，保留应用载荷及结果类型。'
            },
            payload: {
              en: 'The selected method application value captured by the real codec.',
              zh: '实际编解码器捕获的所选方法应用值。'
            },
            options: {
              en: 'Complete call overrides and signal for this invocation, never numeric timeout shorthand.',
              zh: '本次调用的完整功能覆盖及信号，不是数字超时缩写。'
            },
            args: {
              en: 'The method-specific payload/options tuple from the declared remote API; omission is allowed only by that method signature.',
              zh: '来自远端方法声明的载荷及选项元组；只有该方法签名允许时才可省略参数。'
            }
          },
          returns: {
            en: 'Zero gives empty maps, one gives a scalar, many give independent fulfilled/rejected maps.',
            zh: '零个目标返回空字典，一个返回标量，多个返回独立成功及失败字典。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
        },
        notify: {
          summary: {
            en: 'Resolve after actual physical handoff without business ACK; cancellation still has a call id.',
            zh: '实际物理交接后完成，不等待业务确认；取消仍使用调用标识。'
          },
          params: {
            method: {
              en: 'Method path from the remote accepted directory, retaining application payload/result types.',
              zh: '来自远端接纳目录的方法路径，保留应用载荷及结果类型。'
            },
            payload: {
              en: 'The selected method application value captured by the real codec.',
              zh: '实际编解码器捕获的所选方法应用值。'
            },
            options: {
              en: 'Complete call overrides and signal for this invocation, never numeric timeout shorthand.',
              zh: '本次调用的完整功能覆盖及信号，不是数字超时缩写。'
            },
            args: {
              en: 'The method-specific payload/options tuple from the declared remote API; omission is allowed only by that method signature.',
              zh: '来自远端方法声明的载荷及选项元组；只有该方法签名允许时才可省略参数。'
            }
          },
          returns: {
            en: 'Physical completion per target; later asynchronous provider failure reaches reporting.',
            zh: '各目标的物理完成；提供方稍后的异步失败进入上报。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.notify('double', 21))\n} finally {\n  await host.close()\n}\n"
        },
        group: {
          summary: {
            en: 'Execute ordered scalar method/payload steps independently at each target; no cross-target transaction is implied.',
            zh: '各目标独立执行有序标量方法及载荷步骤，不提供跨目标事务。'
          },
          params: {
            steps: {
              en: 'Ordered method/payload records from the accepted scalar directory.',
              zh: '来自已接纳标量目录的有序方法及载荷记录。'
            },
            options: {
              en: 'Complete call overrides and signal for this invocation, never numeric timeout shorthand.',
              zh: '本次调用的完整功能覆盖及信号，不是数字超时缩写。'
            }
          },
          returns: {
            en: 'Ordered done/failed/not-run outcomes per target.',
            zh: '各目标有序的完成、失败及未执行结果。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.group([{ method: 'double', payload: 21 }]))\n} finally {\n  await host.close()\n}\n"
        },
        send: {
          summary: {
            en: 'Select one direct target and await its scalar business result; dotted methods may forward through the current directory.',
            zh: '选择一个直接目标并等待标量业务结果；带点方法可按当前目录继续转发。'
          },
          params: {
            targetId: {
              en: 'Use an accepted name or peerId read from this namespace peers directory; private pool members are not direct targets.',
              zh: '使用本命名空间 `peers` 目录返回的接纳名称或对端标识，不可将私有池成员作为直接目标。'
            },
            method: {
              en: 'Method path from the remote accepted directory, retaining application payload/result types.',
              zh: '来自远端接纳目录的方法路径，保留应用载荷及结果类型。'
            },
            payload: {
              en: 'The selected method application value captured by the real codec.',
              zh: '实际编解码器捕获的所选方法应用值。'
            },
            options: {
              en: 'Complete call overrides and signal for this invocation, never numeric timeout shorthand.',
              zh: '本次调用的完整功能覆盖及信号，不是数字超时缩写。'
            },
            args: {
              en: 'The method-specific payload/options tuple from the declared remote API; omission is allowed only by that method signature.',
              zh: '来自远端方法声明的载荷及选项元组；只有该方法签名允许时才可省略参数。'
            }
          },
          returns: {
            en: 'The exact target result or its original classified failure.',
            zh: '精确目标结果或其原分类失败。'
          },
          example:
            "import type { IRpcNamespace } from '@migaia/rpc-host'\n\nexport function double(\n  remote: IRpcNamespace<{ double(value: number): number }>,\n  id: string,\n) {\n  return remote.send(id, 'double', 21)\n}\n"
        },
        dispatch: {
          summary: {
            en: 'Start one direct call and return void synchronously; asynchronous failure is reported.',
            zh: '启动一次定向调用并同步返回空值；异步失败会被上报。'
          },
          params: {
            targetId: {
              en: 'Use an accepted name or peerId read from this namespace peers directory; private pool members are not direct targets.',
              zh: '使用本命名空间 `peers` 目录返回的接纳名称或对端标识，不可将私有池成员作为直接目标。'
            },
            method: {
              en: 'Method path from the remote accepted directory, retaining application payload/result types.',
              zh: '来自远端接纳目录的方法路径，保留应用载荷及结果类型。'
            },
            payload: {
              en: 'The selected method application value captured by the real codec.',
              zh: '实际编解码器捕获的所选方法应用值。'
            },
            options: {
              en: 'Complete call overrides and signal for this invocation, never numeric timeout shorthand.',
              zh: '本次调用的完整功能覆盖及信号，不是数字超时缩写。'
            },
            args: {
              en: 'The method-specific payload/options tuple from the declared remote API; omission is allowed only by that method signature.',
              zh: '来自远端方法声明的载荷及选项元组；只有该方法签名允许时才可省略参数。'
            }
          },
          returns: {
            en: 'No business return value; entry admission may reject synchronously.',
            zh: '不返回业务值，入口准入可能同步拒绝。'
          },
          example:
            "import type { IRpcNamespace } from '@migaia/rpc-host'\n\nexport function trigger(\n  remote: IRpcNamespace<{ double(value: number): number }>,\n  id: string,\n) {\n  remote.dispatch(id, 'double', 21)\n}\n"
        },
        stream: {
          summary: {
            en: 'Create lazy demand-driven iterators with independent target cancellation and credit.',
            zh: '创建以需求额度驱动的惰性迭代器，各目标独立取消。'
          },
          params: {
            method: {
              en: 'Method path from the remote accepted directory, retaining application payload/result types.',
              zh: '来自远端接纳目录的方法路径，保留应用载荷及结果类型。'
            },
            payload: {
              en: 'The selected method application value captured by the real codec.',
              zh: '实际编解码器捕获的所选方法应用值。'
            },
            options: {
              en: 'Complete call overrides and signal for this invocation, never numeric timeout shorthand.',
              zh: '本次调用的完整功能覆盖及信号，不是数字超时缩写。'
            },
            args: {
              en: 'The method-specific payload/options tuple from the declared remote API; omission is allowed only by that method signature.',
              zh: '来自远端方法声明的载荷及选项元组；只有该方法签名允许时才可省略参数。'
            }
          },
          returns: {
            en: 'One iterator or instance-indexed iterators. Return/throw releases that stream without killing native units.',
            zh: '一个或按实例索引的迭代器；结束或抛错释放流，不杀死原生单元。'
          },
          example:
            "import type { IRpcNamespace } from '@migaia/rpc-host'\n\nexport async function consume(\n  remote: IRpcNamespace<{ values(): AsyncIterable<number> }>,\n) {\n  const result = remote.stream('values')\n  if (Symbol.asyncIterator in result) {\n    for await (const value of result) console.log(value)\n  }\n}\n"
        },
        close: {
          summary: {
            en: 'Retire this namespace and release its owned transport installation.',
            zh: '使本命名空间退场并释放其所拥有的传输安装。'
          },
          params: {},
          returns: {
            en: 'Repeated calls share the original namespace-close Promise; original cleanup failures remain observable.',
            zh: '重复调用共享原命名空间关闭 Promise，原清理失败仍可观察。'
          },
          example:
            "import type { IRpcNamespace } from '@migaia/rpc-host'\n\nexport async function release(remote: IRpcNamespace) {\n  await remote.close()\n}\n"
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Delegate asynchronous disposal to this namespace’s close(), retaining the same installation cleanup completion.',
            zh: '异步释放协议委托本命名空间的 `close()`，复用该传输安装的同一清理完成 Promise。'
          },
          params: {},
          returns: {
            en: 'Repeated calls share the original namespace-close Promise; original cleanup failures remain observable.',
            zh: '重复调用共享原命名空间关闭 Promise，原清理失败仍可观察。'
          },
          example:
            "import type { IRpcNamespace } from '@migaia/rpc-host'\n\nexport async function release(remote: IRpcNamespace) {\n  await remote.close()\n}\n"
        }
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
    },
    IRpcHostOptions: {
      summary: {
        en: 'Cold native Host admission; optional auth, limits, schema and call policies are installed through real plugins/features.',
        zh: '冷原生宿主准入；可选认证、限流、模式及调用策略通过实际插件或功能安装。'
      },
      members: {
        plugins: {
          summary: {
            en: 'Genuine cold definitions with at least one transport and unique namespace names. Optional flow plugins precede the first transport startup.',
            zh: '至少包含一个传输且命名空间名唯一的真实冷定义。可选信息流插件在首个传输启动前安装。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
        },
        provide: {
          summary: {
            en: 'Initial recursive own-data application method whitelist; receiver identity is captured once.',
            zh: '初始递归自有数据方法白名单，接收者身份只捕获一次。'
          },
          default: {
            en: 'No initial local methods.',
            zh: '无初始本地方法。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
        },
        contract: {
          summary: {
            en: 'Local schemaVersion1 method declarations exchange schema/idempotency metadata; business validation requires the schema plugin.',
            zh: '本地第一版方法声明交换模式及幂等元数据；业务校验由模式插件启用。'
          },
          default: {
            en: 'No advanced local declarations.',
            zh: '无高级本地声明。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport type { IRpcHostPlugin } from '@migaia/rpc-host'\nexport function catalog(plugins: readonly IRpcHostPlugin[]) {\n  return createRpcHost({\n    plugins,\n    provide: { app: { catalog: { lookup: (key: string) => key } } },\n    contract: {\n      schemaVersion: 1,\n      plugin: 'app',\n      features: {\n        catalog: { methods: { lookup: { mode: 'request', idempotent: true } } },\n      },\n    },\n  })\n}\n",
          whenToUse: {
            en: 'Declare replay eligibility for the matching local whitelist; declaration data alone does not install validation.',
            zh: '仅为匹配本地方法白名单声明重放资格，声明数据本身不会安装业务校验器。'
          }
        },
        self: {
          summary: {
            en: 'Application global name and instanceId. Trusted native bootstrap may adopt only an unconfigured initial identity before first use.',
            zh: '应用全局名称及实例身份；可信原生启动信息只能在首次使用前接纳未显式配置的初始身份。'
          },
          default: {
            en: 'Secure generated identity.',
            zh: '安全生成的身份。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport type { IRpcHostPlugin } from '@migaia/rpc-host'\nexport function gateway(plugins: readonly IRpcHostPlugin[], signal: AbortSignal) {\n  return createRpcHost({\n    plugins,\n    signal,\n    self: { name: 'gateway', instanceId: 'gateway-main' },\n    report: (error) => console.error(error),\n  })\n}\n",
          whenToUse: {
            en: 'Provide a stable application identity and lifetime when the gateway must stop with its owner.',
            zh: '网关须随应用所有者停止时，显式提供全局身份、生命周期信号与原始失败上报通道。'
          }
        },
        report: {
          summary: {
            en: 'Receives failures not returned by a business operation; preserve source/code/native type/cause and avoid throwing from diagnostics.',
            zh: '接收不由业务操作返回的失败，应保留来源、错误码、原生类型及原因，避免在诊断中抛错。'
          },
          default: {
            en: 'defaultRpcReporter.',
            zh: '默认上报器。'
          },
          params: {
            error: {
              en: 'The original failure delivered by this owner, retaining its source, code, native class and cause chain.',
              zh: '本所有者交付的原失败，保留来源、错误码、原生类型及原因链；该值来自实际失败回调。'
            }
          },
          returns: {
            en: 'No business result is replaced; diagnostics should finish without throwing.',
            zh: '不替换业务返回结果，诊断回调应完成上报并避免再次抛错。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport type { IRpcHostPlugin } from '@migaia/rpc-host'\nexport function gateway(plugins: readonly IRpcHostPlugin[], signal: AbortSignal) {\n  return createRpcHost({\n    plugins,\n    signal,\n    self: { name: 'gateway', instanceId: 'gateway-main' },\n    report: (error) => console.error(error),\n  })\n}\n",
          whenToUse: {
            en: 'Provide a stable application identity and lifetime when the gateway must stop with its owner.',
            zh: '网关须随应用所有者停止时，显式提供全局身份、生命周期信号与原始失败上报通道。'
          }
        },
        signal: {
          summary: {
            en: 'External construction and Host-lifetime signal; it is not a per-call timeout.',
            zh: '外部构造及宿主生命周期信号，不是单次调用超时。'
          },
          default: {
            en: 'No external Host signal.',
            zh: '无外部宿主信号。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport type { IRpcHostPlugin } from '@migaia/rpc-host'\nexport function gateway(plugins: readonly IRpcHostPlugin[], signal: AbortSignal) {\n  return createRpcHost({\n    plugins,\n    signal,\n    self: { name: 'gateway', instanceId: 'gateway-main' },\n    report: (error) => console.error(error),\n  })\n}\n",
          whenToUse: {
            en: 'Provide a stable application identity and lifetime when the gateway must stop with its owner.',
            zh: '网关须随应用所有者停止时，显式提供全局身份、生命周期信号与原始失败上报通道。'
          }
        }
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
    },
    IRpcHost: {
      summary: {
        en: 'One native Host with global self/provide/close and inferred transport namespace properties. Root call methods do not exist.',
        zh: '一个原生宿主，拥有全局身份、提供方法及关闭，并推导传输命名空间属性；根调用方法不存在。'
      },
      members: {
        self: {
          summary: {
            en: 'Immutable global name and instance identity, unrelated to untrusted incoming payload fields.',
            zh: '不可变全局名称及实例身份，与未可信入站载荷字段无关。'
          }
        },
        provide: {
          summary: {
            en: 'Compile own-data local methods and announce the new directory after successful registration.',
            zh: '编译自有数据本地方法，并在登记成功后公告新目录。'
          },
          params: {
            input: {
              en: 'Recursive own-data method whitelist; accessor properties are not public provider declarations.',
              zh: '递归自有数据方法白名单；访问器属性不是公开提供方声明。'
            },
            options: {
              en: 'Optional schema and idempotency declarations for the same methods.',
              zh: '同一组方法的可选模式及幂等声明。'
            }
          },
          returns: {
            en: 'Synchronous completion; duplicates reject without replacing existing methods.',
            zh: '同步完成，重复方法拒绝且不替换现有方法。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
        },
        close: {
          summary: {
            en: 'Close global Host ownership and all installed namespace resources.',
            zh: '关闭全局宿主所有权及全部已安装命名空间资源。'
          },
          params: {},
          returns: {
            en: 'The original close Promise is reused; failures retain original causes and owned cleanup diagnostics.',
            zh: '复用原关闭 Promise，失败保留原原因及所拥有的清理诊断。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
        },
        '[Symbol.asyncDispose]': {
          summary: {
            en: 'Delegate asynchronous disposal to Host close(), returning the same completion for global ownership and every installed namespace.',
            zh: '异步释放协议委托全局宿主的 `close()`，返回覆盖全部命名空间的同一关闭 Promise。'
          },
          params: {},
          returns: {
            en: 'The original close Promise is reused; failures retain original causes and owned cleanup diagnostics.',
            zh: '复用原关闭 Promise，失败保留原原因及所拥有的清理诊断。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
        }
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n",
      scenarios: [
        {
          en: 'Own one gateway identity and providers while calls stay on their installed namespace.',
          zh: '在调用保持各已安装命名空间的同时拥有网关身份及提供方，原生所有者结束时关闭根。'
        }
      ]
    },
    IRpcProvide: {
      summary: {
        en: 'Recursive own-data method whitelist for createRpcHost/provide; only captured application methods enter the provider catalog.',
        zh: '创建宿主及提供方法时使用的递归自有数据方法白名单，只有捕获的应用方法进入提供方目录。'
      },
      members: {},
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
    },
    IRpcProviderMethod: {
      summary: {
        en: 'Application method receives payload first and the actual execution context second; the captured original receiver is retained.',
        zh: '应用方法先接收载荷，再接收实际执行上下文；保留捕获的原接收者。'
      },
      members: {},
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
    },
    IRpcProvider: {
      summary: {
        en: 'Explicit context-style provider returns that invocation context.success/context.failed result, preserving completion identity.',
        zh: '显式上下文式提供方返回该调用上下文的成功或失败结果，保留完成身份。'
      },
      members: {},
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
    },
    IRpcContext: {
      summary: {
        en: 'One actual provider execution supplies native cancellation, routing/generation facts and exact completion helpers; retained context capabilities expire with execution.',
        zh: '一次实际提供方执行拥有原生取消、路由及代际事实和精确完成工具；保留的上下文能力随执行失效。'
      },
      members: {
        localEndpointId: {
          summary: {
            en: 'Local instance identity issued by this Host.',
            zh: '本宿主签发的本地实例身份。'
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
            en: 'Original argument data of this actual invocation.',
            zh: '本次实际调用的原参数数据。'
          }
        },
        signal: {
          summary: {
            en: 'Original provider execution AbortSignal observes caller cancellation, inherited deadline and Host closure independently of optional plugins.',
            zh: '原提供方执行取消信号观察调用方取消、继承截止时间及宿主关闭，不依赖可选插件。'
          }
        },
        senderId: {
          summary: {
            en: 'Accepted originating sender identity supplied by the real route, not application payload metadata.',
            zh: '真实路由提供的已接纳发起方身份，不是应用载荷元数据。'
          }
        },
        route: {
          summary: {
            en: 'Original ordered forwardRoute node identities from admitted routing; the route alone does not authenticate a sender.',
            zh: '已接纳路由提供的原有序转发节点身份；仅有路由不会认证发送方。'
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
          example:
            "import type { IRpcContext } from '@migaia/rpc-host'\n\nexport function double(value: number, context: IRpcContext) {\n  return context.success(value * 2)\n}\n"
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
          example:
            "import type { IRpcContext } from '@migaia/rpc-host'\n\nexport function unavailable(_value: unknown, context: IRpcContext) {\n  return context.failed('Unavailable', 'UNAVAILABLE')\n}\n"
        },
        dispatchTo: {
          summary: {
            en: 'Start an execution-scoped one-way notification. An explicit sender id returns to that actual caller; omitted id excludes the sender from namespace delivery. After expiry it does nothing.',
            zh: '发起执行作用域内的单向通知。显式发送方身份返回实际调用方；省略身份时命名空间投递排除原发送方，过期后不执行。'
          },
          params: {
            input: {
              en: 'Application method/data and optional explicitly chosen target id; original execution controls validate its route.',
              zh: '应用方法、数据及可选显式目标标识，原执行控制校验路由。'
            }
          },
          returns: {
            en: 'Synchronous void; original Host reporting receives asynchronous notification failures.',
            zh: '同步返回空值，原宿主上报通道接收异步通知失败。'
          },
          example:
            "import type { IRpcContext } from '@migaia/rpc-host'\n\nexport function changed(value: number, context: IRpcContext) {\n  context.dispatchTo({ id: context.senderId, method: 'changed', data: value })\n  return context.success(value)\n}\n"
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import type { IRpcContext } from '@migaia/rpc-host'\n\nexport function double(value: number, context: IRpcContext) {\n  return context.success(value * 2)\n}\n"
    },
    ITimeoutFeatureOptions: {
      summary: {
        en: 'Captured complete attempt-timeout resources; ms does not change the independent handshake deadline.',
        zh: '完整尝试超时功能捕获的资源，毫秒预算不改变独立握手截止时间。'
      },
      members: {
        ms: {
          summary: {
            en: 'Finite nonnegative attempt milliseconds; zero allows immediate expiry.',
            zh: '有限非负的尝试毫秒数，零允许立即到期。'
          },
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
        },
        scheduler: {
          summary: {
            en: 'Existing scheduler owns actual timer and cancellation handles.',
            zh: '现有调度器拥有实际计时器及取消句柄。'
          },
          default: {
            en: 'systemScheduler.',
            zh: '系统调度器。'
          },
          example:
            "import { timeout } from '@migaia/rpc-host/features'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nexport const deadline = timeout({\n  ms: 1500,\n  scheduler: systemScheduler,\n  report: (error) => console.error(error),\n})\n",
          whenToUse: {
            en: 'Lend the application scheduler and diagnostic callback when attempt timers must use that monotonic clock.',
            zh: '尝试计时须使用应用单调时钟时，借用其调度器及诊断回调，结算后仍由功能释放计时资源。'
          }
        },
        report: {
          summary: {
            en: 'Reports cleanup/losing-branch failures without replacing the primary cancellation or timeout.',
            zh: '上报清理及落败分支失败，不替换主要取消或超时。'
          },
          default: {
            en: 'defaultRpcReporter.',
            zh: '默认上报器。'
          },
          params: {
            error: {
              en: 'The original failure delivered by this owner, retaining its source, code, native class and cause chain.',
              zh: '本所有者交付的原失败，保留来源、错误码、原生类型及原因链；该值来自实际失败回调。'
            }
          },
          returns: {
            en: 'No business result is replaced; diagnostics should finish without throwing.',
            zh: '不替换业务返回结果，诊断回调应完成上报并避免再次抛错。'
          },
          example:
            "import { timeout } from '@migaia/rpc-host/features'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nexport const deadline = timeout({\n  ms: 1500,\n  scheduler: systemScheduler,\n  report: (error) => console.error(error),\n})\n",
          whenToUse: {
            en: 'Lend the application scheduler and diagnostic callback when attempt timers must use that monotonic clock.',
            zh: '尝试计时须使用应用单调时钟时，借用其调度器及诊断回调，结算后仍由功能释放计时资源。'
          }
        }
      },
      example:
        "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
    },
    IRetryFeatureOptions: {
      summary: {
        en: 'Captured originating retry policy; retain one logical key and inherited budget across permitted attempts.',
        zh: '捕获的发起方重试策略，在允许的尝试间保留同一逻辑键及继承预算。'
      },
      members: {
        attempts: {
          summary: {
            en: 'Positive safe integer total attempt count including the initial attempt.',
            zh: '包含首次尝试的正安全整数总次数。'
          },
          default: {
            en: '2 attempts.',
            zh: '两次尝试。'
          },
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
        },
        backoff: {
          summary: {
            en: 'Nonnegative milliseconds or a synchronous function of original error and utils retry context; a throw terminates retry.',
            zh: '非负毫秒数，或接收原错误及工具重试上下文的同步函数；抛错会结束重试。'
          },
          default: {
            en: 'No extra delay.',
            zh: '无额外延迟。'
          },
          example:
            "import { retry } from '@migaia/rpc-host/features'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nexport const recovery = retry({\n  attempts: 3,\n  backoff: 40,\n  keyFactory: () => crypto.randomUUID(),\n  scheduler: systemScheduler,\n  report: (error) => console.error(error),\n})\n",
          whenToUse: {
            en: 'Choose finite replay/backoff and one logical-key issuer for requests whose actual idempotency and replacement facts permit recovery.',
            zh: '真实幂等及替换事实允许恢复时，选择有限重放、退避及一个逻辑键签发器，不能据错误码强行重试。'
          }
        },
        keyFactory: {
          summary: {
            en: 'Issues the originating logical key; never substitute a remote diagnostic as authority.',
            zh: '签发发起方逻辑键，不以远端诊断代替权限。'
          },
          default: {
            en: 'defaultRpcId.',
            zh: '默认标识分配器。'
          },
          params: {},
          returns: {
            en: 'A fresh logical idempotency key created for this originating invocation and reused by all its retry attempts.',
            zh: '为本次发起调用签发新的逻辑幂等键，后续所有重试尝试复用该键。'
          },
          example:
            "import { retry } from '@migaia/rpc-host/features'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nexport const recovery = retry({\n  attempts: 3,\n  backoff: 40,\n  keyFactory: () => crypto.randomUUID(),\n  scheduler: systemScheduler,\n  report: (error) => console.error(error),\n})\n",
          whenToUse: {
            en: 'Choose finite replay/backoff and one logical-key issuer for requests whose actual idempotency and replacement facts permit recovery.',
            zh: '真实幂等及替换事实允许恢复时，选择有限重放、退避及一个逻辑键签发器，不能据错误码强行重试。'
          }
        },
        scheduler: {
          summary: {
            en: 'Existing scheduler for cancellable owned backoff waits.',
            zh: '拥有可取消退避等待的现有调度器。'
          },
          default: {
            en: 'systemScheduler.',
            zh: '系统调度器。'
          },
          example:
            "import { retry } from '@migaia/rpc-host/features'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nexport const recovery = retry({\n  attempts: 3,\n  backoff: 40,\n  keyFactory: () => crypto.randomUUID(),\n  scheduler: systemScheduler,\n  report: (error) => console.error(error),\n})\n",
          whenToUse: {
            en: 'Choose finite replay/backoff and one logical-key issuer for requests whose actual idempotency and replacement facts permit recovery.',
            zh: '真实幂等及替换事实允许恢复时，选择有限重放、退避及一个逻辑键签发器，不能据错误码强行重试。'
          }
        },
        report: {
          summary: {
            en: 'Receives contained cleanup and late failures with original identity.',
            zh: '接收被隔离的清理及稍后失败并保留原身份。'
          },
          default: {
            en: 'defaultRpcReporter.',
            zh: '默认上报器。'
          },
          params: {
            error: {
              en: 'The original failure delivered by this owner, retaining its source, code, native class and cause chain.',
              zh: '本所有者交付的原失败，保留来源、错误码、原生类型及原因链；该值来自实际失败回调。'
            }
          },
          returns: {
            en: 'No business result is replaced; diagnostics should finish without throwing.',
            zh: '不替换业务返回结果，诊断回调应完成上报并避免再次抛错。'
          },
          example:
            "import { retry } from '@migaia/rpc-host/features'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nexport const recovery = retry({\n  attempts: 3,\n  backoff: 40,\n  keyFactory: () => crypto.randomUUID(),\n  scheduler: systemScheduler,\n  report: (error) => console.error(error),\n})\n",
          whenToUse: {
            en: 'Choose finite replay/backoff and one logical-key issuer for requests whose actual idempotency and replacement facts permit recovery.',
            zh: '真实幂等及替换事实允许恢复时，选择有限重放、退避及一个逻辑键签发器，不能据错误码强行重试。'
          }
        }
      },
      example:
        "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const\n"
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
        "import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-request')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))\n"
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
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-request')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))\n"
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
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-request')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))\n"
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
        "import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-request')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))\n"
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
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-request')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))\n"
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
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-request')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))\n"
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
            "import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-request')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))\n"
        }
      },
      scenarios: [
        {
          en: 'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
          zh: '组合实际端点或运行对端，并由规范所有者保持传输对象与生命周期所有权。'
        }
      ],
      example:
        "import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-request')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))\n"
    },
    IRpcProviderRejection: {
      summary: {
        en: 'Actual local refused execution observation; one OVERLOADED code has distinct owned reasons.',
        zh: '实际本地拒绝执行观察，同一过载错误码对应不同所属原因。'
      },
      members: {
        verifiedPeerKey: {
          summary: {
            en: 'Actual admitted peer identity used by the refusing owner; it grants no additional execution authority.',
            zh: '拒绝方所有者使用的实际准入对端身份，不额外授予执行权限。'
          }
        },
        controllerKey: {
          summary: {
            en: 'Original correlation key selected by the refusing execution or replay owner.',
            zh: '拒绝执行或重放所有者选择的原始关联键。'
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
        "import limits from '@migaia/rpc-host/plugins/limits'\n\nexport const capacity = limits({\n  onRejected: (rejection) => console.error(rejection.method, rejection.reason),\n})\n"
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
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])\n",
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
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])\n",
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
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])\n"
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
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])\n",
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
        "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])\n"
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
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])\n"
        }
      },
      scenarios: [
        {
          en: 'Observe the existing owner without changing its business settlement or resource lifetime.',
          zh: '观察现有所有者，不改变业务结算或资源生命周期。'
        }
      ],
      example:
        "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])\n"
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
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])\n"
        }
      },
      scenarios: [
        {
          en: 'Observe the existing owner without changing its business settlement or resource lifetime.',
          zh: '观察现有所有者，不改变业务结算或资源生命周期。'
        }
      ],
      example:
        "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])\n"
    },
    IRpcAuthenticationOptions: {
      summary: {
        en: 'Complete paired transforms and optional explicit handshake credential capabilities captured by auth. Native acquisition and accepted identity remain separate owners.',
        zh: '认证插件捕获的完整成对转换及可选显式握手凭据能力；原生获取和接纳身份仍由不同所有者管理。'
      },
      members: {
        encrypt: {
          summary: {
            en: 'Encrypt the prepared nonce/counter binding before signing; input and output must match encodedType and decrypt reverses this operation.',
            zh: '先加密已准备的随机值及计数绑定，再执行签名；输入输出须符合编码类别，解密执行逆操作。'
          },
          default: {
            en: 'Encryption is disabled when encrypt is omitted; enabling it requires decrypt and both sign and verify.',
            zh: '省略 encrypt 时不加密；启用加密须同时提供 decrypt 及 sign、verify。'
          },
          example:
            "import { auth } from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\nexport function protectedLink(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n  encrypt: IRpcAuthenticationTransform,\n  decrypt: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encrypt, decrypt, encodedType: 'string' })\n}\n",
          whenToUse: {
            en: 'Use the representation consumed by the actual paired cryptographic transforms; identity transforms do not demonstrate authentication.',
            zh: '选择实际成对加解密及签验能力消费的表示，双方须约定输入输出，不能以恒等转换冒充认证。'
          }
        },
        decrypt: {
          summary: {
            en: 'After inbound signature verification, reverse `encrypt` before envelope admission; a throw rejects the envelope.',
            zh: '在入站签名验证后、信封准入前执行与 `encrypt` 配套的逆转换，抛错拒绝信封。'
          },
          default: {
            en: 'Decryption is disabled when decrypt is omitted; encrypt must also be absent.',
            zh: '省略 decrypt 时不解密，encrypt 也必须省略。'
          },
          example:
            "import { auth } from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\nexport function protectedLink(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n  encrypt: IRpcAuthenticationTransform,\n  decrypt: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encrypt, decrypt, encodedType: 'string' })\n}\n",
          whenToUse: {
            en: 'Use the representation consumed by the actual paired cryptographic transforms; identity transforms do not demonstrate authentication.',
            zh: '选择实际成对加解密及签验能力消费的表示，双方须约定输入输出，不能以恒等转换冒充认证。'
          }
        },
        sign: {
          summary: {
            en: 'Sign the exact protected representation with its nonce/counter binding; return the representation consumed by verify.',
            zh: '签名含随机值及计数绑定的精确保护表示，返回供验证消费的表示。'
          },
          default: {
            en: 'Signing is disabled when sign is omitted; verify must also be absent, and encryption cannot be enabled.',
            zh: '省略 sign 时不签名，verify 也必须省略，且不能启用加密。'
          },
          example:
            "import { auth } from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\nexport function protectedLink(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n  encrypt: IRpcAuthenticationTransform,\n  decrypt: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encrypt, decrypt, encodedType: 'string' })\n}\n",
          whenToUse: {
            en: 'Use the representation consumed by the actual paired cryptographic transforms; identity transforms do not demonstrate authentication.',
            zh: '选择实际成对加解密及签验能力消费的表示，双方须约定输入输出，不能以恒等转换冒充认证。'
          }
        },
        verify: {
          summary: {
            en: 'Check the representation produced by `sign` and return authenticated inner data before dispatch.',
            zh: '验证由 `sign` 配套产生的保护表示，并在分派前返回已认证内部数据。'
          },
          default: {
            en: 'Signature verification is disabled when verify is omitted; sign must also be absent.',
            zh: '省略 verify 时不验证消息签名，sign 也必须省略。'
          },
          example:
            "import { auth } from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\nexport function protectedLink(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n  encrypt: IRpcAuthenticationTransform,\n  decrypt: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encrypt, decrypt, encodedType: 'string' })\n}\n",
          whenToUse: {
            en: 'Use the representation consumed by the actual paired cryptographic transforms; identity transforms do not demonstrate authentication.',
            zh: '选择实际成对加解密及签验能力消费的表示，双方须约定输入输出，不能以恒等转换冒充认证。'
          }
        },
        encodedType: {
          summary: {
            en: 'Transform input/output category; conversion belongs to auth representation rather than an extra JSON parser.',
            zh: '转换输入输出类别，由认证表示所有者转换，不增加一个 JSON 解析器。'
          },
          default: {
            en: 'any.',
            zh: '任意类别。'
          },
          values: {
            any: {
              en: 'Preserve the existing general representation contract.',
              zh: '保留现有通用表示契约。'
            },
            string: {
              en: 'Pass canonical JSON text to transforms.',
              zh: '向转换传递规范 JSON 文本。'
            },
            uint8array: {
              en: 'Pass UTF-8 bytes to transforms.',
              zh: '向转换传递 UTF-8 字节。'
            }
          },
          example:
            "import { auth } from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\nexport function protectedLink(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n  encrypt: IRpcAuthenticationTransform,\n  decrypt: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encrypt, decrypt, encodedType: 'string' })\n}\n",
          whenToUse: {
            en: 'Use the representation consumed by the actual paired cryptographic transforms; identity transforms do not demonstrate authentication.',
            zh: '选择实际成对加解密及签验能力消费的表示，双方须约定输入输出，不能以恒等转换冒充认证。'
          }
        },
        namespaces: {
          summary: {
            en: 'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
            zh: '本插件生效的精确已安装命名空间名称，不会创建命名空间。'
          },
          default: {
            en: 'All installed namespaces.',
            zh: '全部已安装命名空间。'
          },
          example:
            "import { auth } from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationOptions } from '@migaia/rpc-host/plugins/auth'\nexport function credentials(\n  verifyCredentials: NonNullable<IRpcAuthenticationOptions['verifyCredentials']>,\n) {\n  return auth({\n    namespaces: ['process'],\n    credentials: { application: 'catalog-service' },\n    verifyCredentials,\n  })\n}\n",
          whenToUse: {
            en: 'Supply explicit application credentials and the real verifier for selected native namespaces; launch tokens are not inferred.',
            zh: '为所选原生命名空间提供显式应用凭据及真实验证器，不会从载荷推断原生启动令牌。'
          }
        },
        credentials: {
          summary: {
            en: 'Portable explicit credential data or an async resolver receiving the actual admitted flow context. It does not discover native bootstrap tokens by guessing payload fields.',
            zh: '显式可移植凭据，或接收实际接纳信息流上下文的异步解析器；不通过猜测载荷字段发现原生启动令牌。'
          },
          default: {
            en: 'No explicit credentials.',
            zh: '无显式凭据。'
          },
          example:
            "import { auth } from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationOptions } from '@migaia/rpc-host/plugins/auth'\nexport function credentials(\n  verifyCredentials: NonNullable<IRpcAuthenticationOptions['verifyCredentials']>,\n) {\n  return auth({\n    namespaces: ['process'],\n    credentials: { application: 'catalog-service' },\n    verifyCredentials,\n  })\n}\n",
          whenToUse: {
            en: 'Supply explicit application credentials and the real verifier for selected native namespaces; launch tokens are not inferred.',
            zh: '为所选原生命名空间提供显式应用凭据及真实验证器，不会从载荷推断原生启动令牌。'
          }
        },
        maxReplayEntriesPerPeer: {
          summary: {
            en: 'Maximum retained request IDs per admitted peer, independent from provider concurrency and keyed outcome storage. Active IDs remain held through actual business and stream cleanup; completed IDs follow bounded TTL retention.',
            zh: '每个已接纳对端保留的请求 ID 数量上限，独立于提供方并发和按键结果存储。活动 ID 保留至实际业务及流清理结束，完成后按有界 TTL 保留。'
          },
          default: {
            en: '1024; a positive safe integer is required.',
            zh: '默认 1024；必须为正安全整数。'
          },
          example:
            "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationOptions } from '@migaia/rpc-host/plugins/auth'\nexport function requestReplay(\n  verifyCredentials: NonNullable<IRpcAuthenticationOptions['verifyCredentials']>,\n  onRejected: NonNullable<IRpcAuthenticationOptions['onRejected']>,\n) {\n  return auth({ verifyCredentials, maxReplayEntriesPerPeer: 1024, onRejected })\n}\n",
          whenToUse: {
            en: 'Bound authenticated request-ID history without substituting provider concurrency for replay capacity.',
            zh: '限制认证请求 ID 历史的容量，不用提供方并发替代重放配额。'
          }
        },
        onRejected: {
          summary: {
            en: 'Observe frozen replayLedgerFull or groupReplayFull refusals. Callback failure is reported with INTERNAL and the original cause; it does not replace OVERLOADED.',
            zh: '观察冻结的 replayLedgerFull 或 groupReplayFull 拒绝通知。回调失败以 INTERNAL 和原始原因上报，不替换 OVERLOADED。'
          },
          default: { en: 'No replay refusal observer.', zh: '默认无重放拒绝观察回调。' },
          params: {
            rejection: {
              en: 'Canonical IRpcProviderRejection from @migaia/rpc-contract/errors with actual admitted peer, correlation, method and reason.',
              zh: '来自 @migaia/rpc-contract/errors 的规范 IRpcProviderRejection，包含实际准入对端、关联键、方法和原因。'
            }
          },
          returns: {
            en: 'void or Promise<void>; failures are contained and reported.',
            zh: '空值或对应 Promise；失败被隔离并上报。'
          },
          example:
            "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationOptions } from '@migaia/rpc-host/plugins/auth'\nexport function requestReplay(\n  verifyCredentials: NonNullable<IRpcAuthenticationOptions['verifyCredentials']>,\n  onRejected: NonNullable<IRpcAuthenticationOptions['onRejected']>,\n) {\n  return auth({ verifyCredentials, maxReplayEntriesPerPeer: 1024, onRejected })\n}\n",
          whenToUse: {
            en: 'Distinguish request-ID replay capacity from other OVERLOADED reasons.',
            zh: '区分请求 ID 重放容量与其他 OVERLOADED 原因。'
          }
        },
        verifyCredentials: {
          summary: {
            en: 'Receives remote credential data, peer hello and actual flow context; return void/Promise<void> to accept or throw to reject.',
            zh: '接收远端凭据、对端握手及实际信息流上下文；返回空值或对应 Promise 接受，抛错拒绝。'
          },
          default: {
            en: 'No credential verifier.',
            zh: '无凭据验证器。'
          },
          params: {
            auth: {
              en: 'Portable credentials decoded from the peer hello, or undefined when it supplied none.',
              zh: '从对端握手解码出的可移植凭据；对端未提供时为空。'
            },
            peer: {
              en: 'The actual normalized peer identity from this handshake; it is not inferred from business payload.',
              zh: '本次握手的实际规范化对端身份，不从业务载荷推断。'
            },
            context: {
              en: 'The owning handshake flow context with its actual direction, namespace and cancellation signal.',
              zh: '所属握手信息流的真实方向、命名空间及取消信号上下文。'
            }
          },
          returns: {
            en: 'Return void or a fulfilled Promise to accept. Throw or reject to fail authentication before provider execution.',
            zh: '同步完成或兑现后接受凭据；抛错或拒绝会在提供方执行前拒绝认证。'
          },
          example:
            "import { auth } from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationOptions } from '@migaia/rpc-host/plugins/auth'\nexport function credentials(\n  verifyCredentials: NonNullable<IRpcAuthenticationOptions['verifyCredentials']>,\n) {\n  return auth({\n    namespaces: ['process'],\n    credentials: { application: 'catalog-service' },\n    verifyCredentials,\n  })\n}\n",
          whenToUse: {
            en: 'Supply explicit application credentials and the real verifier for selected native namespaces; launch tokens are not inferred.',
            zh: '为所选原生命名空间提供显式应用凭据及真实验证器，不会从载荷推断原生启动令牌。'
          }
        }
      }
    },
    IRpcAuthenticationTransform: {
      summary: {
        en: 'Application-owned synchronous or asynchronous protected-value transform. The second argument contains admitted direction/namespace/carrier facts; remote diagnostics do not grant local authority.',
        zh: '应用拥有的同步或异步保护值转换；第二参数包含接纳方向、命名空间及载体事实，远端诊断不授予本地权限。'
      },
      members: {}
    },
    IRpcAuthenticationCredentials: {
      summary: {
        en: 'Explicit credential resolver for the actual admitted flow context; return portable data or undefined.',
        zh: '针对实际接纳信息流上下文的显式凭据解析器，返回可移植数据或空值。'
      },
      members: {}
    },
    IRpcBatchOptions: {
      summary: {
        en: 'Cold namespace and negotiation requirements for physical batch@1. No provider or application grouping policy is installed.',
        zh: '物理合帧的冷命名空间及协商要求，不安装提供方或应用分组策略。'
      },
      members: {
        namespaces: {
          summary: {
            en: 'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
            zh: '本插件生效的精确已安装命名空间名称，不会创建命名空间。'
          },
          default: {
            en: 'All installed namespaces.',
            zh: '全部已安装命名空间。'
          },
          example:
            "import { batch } from '@migaia/rpc-host/plugins/batch'\nexport const negotiated = batch({ namespaces: ['process'], required: true })\n",
          whenToUse: {
            en: 'Require extension negotiation only where both deployed peers provide matching support.',
            zh: '仅在双方部署匹配能力的命名空间要求扩展协商，不支持该能力的对端在握手阶段被拒绝。'
          }
        },
        required: {
          summary: {
            en: 'Reject peers that cannot negotiate batch@1 rather than leaving batching optional.',
            zh: '拒绝无法协商合帧扩展的对端，不将合帧保留为可选。'
          },
          default: {
            en: 'false.',
            zh: '默认不强制要求该扩展。'
          },
          example:
            "import { batch } from '@migaia/rpc-host/plugins/batch'\nexport const negotiated = batch({ namespaces: ['process'], required: true })\n",
          whenToUse: {
            en: 'Require extension negotiation only where both deployed peers provide matching support.',
            zh: '仅在双方部署匹配能力的命名空间要求扩展协商，不支持该能力的对端在握手阶段被拒绝。'
          }
        }
      }
    },
    IRpcChunkFeatureOptions: {
      summary: {
        en: 'Bounded chunk retention and timer capabilities used only by the installed chunk implementation.',
        zh: '仅由已安装分片实现使用的有界保留及计时能力。'
      },
      members: {
        chunkBytes: {
          summary: {
            en: 'Positive fragment size in UTF-16 code units for text or bytes for Uint8Array.',
            zh: '正数分片大小；文本按 UTF-16 码元、字节数组按字节计算。'
          },
          default: {
            en: '16384 units.',
            zh: '一万六千三百八十四单位。'
          },
          example:
            "import { chunk } from '@migaia/rpc-host/plugins/chunk'\nexport const bounded = chunk({\n  chunkBytes: 16384,\n  maxMessageBytes: 16777216,\n  maxChunks: 1024,\n  maxBufferedBytes: 33554432,\n  maxConcurrentMessages: 8,\n  assemblyTimeoutMs: 5000,\n})\n",
          whenToUse: {
            en: 'Bound each message and aggregate unfinished assemblies when large results share a native stream.',
            zh: '大型结果共享原生流时，同时限制每条消息及未完成组装总量，并通过有限过期时间回收保留。'
          }
        },
        maxMessageBytes: {
          summary: {
            en: 'Maximum whole reassembled value, using the same text/byte units as chunkBytes.',
            zh: '完整重组值上限，采用与分片大小相同的文本及字节单位。'
          },
          default: {
            en: '16777216 units.',
            zh: '一千六百七十七万七千二百一十六单位。'
          },
          example:
            "import { chunk } from '@migaia/rpc-host/plugins/chunk'\nexport const bounded = chunk({\n  chunkBytes: 16384,\n  maxMessageBytes: 16777216,\n  maxChunks: 1024,\n  maxBufferedBytes: 33554432,\n  maxConcurrentMessages: 8,\n  assemblyTimeoutMs: 5000,\n})\n",
          whenToUse: {
            en: 'Bound each message and aggregate unfinished assemblies when large results share a native stream.',
            zh: '大型结果共享原生流时，同时限制每条消息及未完成组装总量，并通过有限过期时间回收保留。'
          }
        },
        maxChunks: {
          summary: {
            en: 'Positive safe-integer fragment-count bound before assembly retention.',
            zh: '组装保留前检查的正安全整数分片数上限。'
          },
          default: {
            en: '4096 fragments.',
            zh: '四千零九十六片。'
          },
          example:
            "import { chunk } from '@migaia/rpc-host/plugins/chunk'\nexport const bounded = chunk({\n  chunkBytes: 16384,\n  maxMessageBytes: 16777216,\n  maxChunks: 1024,\n  maxBufferedBytes: 33554432,\n  maxConcurrentMessages: 8,\n  assemblyTimeoutMs: 5000,\n})\n",
          whenToUse: {
            en: 'Bound each message and aggregate unfinished assemblies when large results share a native stream.',
            zh: '大型结果共享原生流时，同时限制每条消息及未完成组装总量，并通过有限过期时间回收保留。'
          }
        },
        maxBufferedBytes: {
          summary: {
            en: 'Total retained assembly units, at least maxMessageBytes.',
            zh: '组装保留总单位，至少等于整条消息上限。'
          },
          default: {
            en: '67108864 units.',
            zh: '六千七百一十万八千八百六十四单位。'
          },
          example:
            "import { chunk } from '@migaia/rpc-host/plugins/chunk'\nexport const bounded = chunk({\n  chunkBytes: 16384,\n  maxMessageBytes: 16777216,\n  maxChunks: 1024,\n  maxBufferedBytes: 33554432,\n  maxConcurrentMessages: 8,\n  assemblyTimeoutMs: 5000,\n})\n",
          whenToUse: {
            en: 'Bound each message and aggregate unfinished assemblies when large results share a native stream.',
            zh: '大型结果共享原生流时，同时限制每条消息及未完成组装总量，并通过有限过期时间回收保留。'
          }
        },
        maxConcurrentMessages: {
          summary: {
            en: 'Maximum simultaneous source/message assemblies.',
            zh: '同时保留的来源及消息组装数量上限。'
          },
          default: {
            en: '256 assemblies.',
            zh: '二百五十六组。'
          },
          example:
            "import { chunk } from '@migaia/rpc-host/plugins/chunk'\nexport const bounded = chunk({\n  chunkBytes: 16384,\n  maxMessageBytes: 16777216,\n  maxChunks: 1024,\n  maxBufferedBytes: 33554432,\n  maxConcurrentMessages: 8,\n  assemblyTimeoutMs: 5000,\n})\n",
          whenToUse: {
            en: 'Bound each message and aggregate unfinished assemblies when large results share a native stream.',
            zh: '大型结果共享原生流时，同时限制每条消息及未完成组装总量，并通过有限过期时间回收保留。'
          }
        },
        assemblyTimeoutMs: {
          summary: {
            en: 'Positive safe-integer lifetime of an incomplete assembly.',
            zh: '未完成组装的正安全整数保留毫秒数。'
          },
          default: {
            en: '30000 milliseconds.',
            zh: '三万毫秒。'
          },
          example:
            "import { chunk } from '@migaia/rpc-host/plugins/chunk'\nexport const bounded = chunk({\n  chunkBytes: 16384,\n  maxMessageBytes: 16777216,\n  maxChunks: 1024,\n  maxBufferedBytes: 33554432,\n  maxConcurrentMessages: 8,\n  assemblyTimeoutMs: 5000,\n})\n",
          whenToUse: {
            en: 'Bound each message and aggregate unfinished assemblies when large results share a native stream.',
            zh: '大型结果共享原生流时，同时限制每条消息及未完成组装总量，并通过有限过期时间回收保留。'
          }
        },
        now: {
          summary: {
            en: 'Retained compatibility clock option; current expiry is driven by schedule, not a separately polled clock.',
            zh: '保留的时钟选项；当前过期由调度回调驱动，不另轮询时钟。'
          },
          default: {
            en: 'No extra clock callback.',
            zh: '无额外时钟回调。'
          },
          example:
            "import { chunk } from '@migaia/rpc-host/plugins/chunk'\nimport type { IRpcChunkFeatureOptions } from '@migaia/rpc-host/plugins/chunk'\nexport function clock(\n  now: NonNullable<IRpcChunkFeatureOptions['now']>,\n  schedule: NonNullable<IRpcChunkFeatureOptions['schedule']>,\n  cancel: NonNullable<IRpcChunkFeatureOptions['cancel']>,\n) {\n  return chunk({ now, schedule, cancel, assemblyTimeoutMs: 5000 })\n}\n",
          whenToUse: {
            en: 'Borrow one existing native clock together with its timer/remover pair so assembly expiry uses one time domain.',
            zh: '借用同一个已有原生时钟及匹配计时与移除器，使组装过期遵循所属时间域，不产生第二计时所有者。'
          }
        },
        schedule: {
          summary: {
            en: 'Receives an expiry callback and delay, returns an owned timer handle; use cancel for that same scheduler.',
            zh: '接收过期回调及延迟，返回所拥有的计时句柄；应由对应取消端口释放。'
          },
          default: {
            en: 'Host timeout scheduling.',
            zh: '宿主超时调度。'
          },
          example:
            "import { chunk } from '@migaia/rpc-host/plugins/chunk'\nimport type { IRpcChunkFeatureOptions } from '@migaia/rpc-host/plugins/chunk'\nexport function clock(\n  now: NonNullable<IRpcChunkFeatureOptions['now']>,\n  schedule: NonNullable<IRpcChunkFeatureOptions['schedule']>,\n  cancel: NonNullable<IRpcChunkFeatureOptions['cancel']>,\n) {\n  return chunk({ now, schedule, cancel, assemblyTimeoutMs: 5000 })\n}\n",
          whenToUse: {
            en: 'Borrow one existing native clock together with its timer/remover pair so assembly expiry uses one time domain.',
            zh: '借用同一个已有原生时钟及匹配计时与移除器，使组装过期遵循所属时间域，不产生第二计时所有者。'
          }
        },
        cancel: {
          summary: {
            en: 'Cancel the handle issued by the configured schedule callback; cleanup failures retain their original diagnostic.',
            zh: '取消已配置调度回调签发的句柄，清理失败保留原诊断。'
          },
          default: {
            en: 'Host timeout cancellation.',
            zh: '宿主超时取消。'
          },
          example:
            "import { chunk } from '@migaia/rpc-host/plugins/chunk'\nimport type { IRpcChunkFeatureOptions } from '@migaia/rpc-host/plugins/chunk'\nexport function clock(\n  now: NonNullable<IRpcChunkFeatureOptions['now']>,\n  schedule: NonNullable<IRpcChunkFeatureOptions['schedule']>,\n  cancel: NonNullable<IRpcChunkFeatureOptions['cancel']>,\n) {\n  return chunk({ now, schedule, cancel, assemblyTimeoutMs: 5000 })\n}\n",
          whenToUse: {
            en: 'Borrow one existing native clock together with its timer/remover pair so assembly expiry uses one time domain.',
            zh: '借用同一个已有原生时钟及匹配计时与移除器，使组装过期遵循所属时间域，不产生第二计时所有者。'
          }
        },
        namespaces: {
          summary: {
            en: 'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
            zh: '本插件生效的精确已安装命名空间名称，不会创建命名空间。'
          },
          default: {
            en: 'All installed namespaces.',
            zh: '全部已安装命名空间。'
          },
          example:
            "import { chunk } from '@migaia/rpc-host/plugins/chunk'\nexport const negotiated = chunk({ namespaces: ['process'], required: true })\n",
          whenToUse: {
            en: 'Require extension negotiation only where both deployed peers provide matching support.',
            zh: '仅在双方部署匹配能力的命名空间要求扩展协商，不支持该能力的对端在握手阶段被拒绝。'
          }
        },
        required: {
          summary: {
            en: 'Require negotiated chunk@1 for this installation.',
            zh: '本次安装要求协商分片扩展。'
          },
          default: {
            en: 'false.',
            zh: '默认不强制要求该扩展。'
          },
          example:
            "import { chunk } from '@migaia/rpc-host/plugins/chunk'\nexport const negotiated = chunk({ namespaces: ['process'], required: true })\n",
          whenToUse: {
            en: 'Require extension negotiation only where both deployed peers provide matching support.',
            zh: '仅在双方部署匹配能力的命名空间要求扩展协商，不支持该能力的对端在握手阶段被拒绝。'
          }
        }
      }
    },
    IRpcSchemaParser: {
      summary: {
        en: 'Synchronous application parse capability; returned transformed data is ignored by validation, while a throw rejects the actual call.',
        zh: '应用同步解析能力；校验忽略转换后返回值，抛错则拒绝实际调用。'
      },
      members: {
        parse: {
          summary: {
            en: 'Check the original value against application schema.',
            zh: '应用解析器接收本边界实际数据，失败时保留其原生抛错。'
          },
          params: {
            value: {
              en: 'Actual argument or successful result captured by the existing execution boundary.',
              zh: '现有执行边界捕获的实际参数或成功结果。'
            }
          },
          returns: {
            en: 'Return an accepted value or throw the original validation failure; Host keeps the original business value.',
            zh: '返回接纳值或抛原校验失败；宿主保留原业务值。'
          },
          example:
            "import type { IRpcSchemaParser } from '@migaia/rpc-host/plugins/schema'\n\nexport function validate(parser: IRpcSchemaParser, value: unknown) {\n  parser.parse(value)\n}\n"
        }
      }
    },
    IRpcMethodValidators: {
      summary: {
        en: 'One method has separate synchronous input and result parsers.',
        zh: '一个方法分别拥有同步输入及结果解析器。'
      },
      members: {
        params: {
          summary: {
            en: 'Parser for actual method arguments before provider entry.',
            zh: '提供方进入前检查实际方法参数的解析器。'
          }
        },
        result: {
          summary: {
            en: 'Parser for successful result data before delivery.',
            zh: '交付前检查成功结果数据的解析器。'
          }
        }
      }
    },
    IRpcSchemaOptions: {
      summary: {
        en: 'Explicit parser table keyed by real method path; local declarations remain inert metadata without this installed plugin.',
        zh: '按实际方法路径索引的显式解析器表；不安装本插件时，本地声明保持惰性元数据。'
      },
      members: {
        schemas: {
          summary: {
            en: 'Application method-name map with params/result parsers retaining their captured receiver.',
            zh: '应用方法名映射，包含保留捕获接收者的参数及结果解析器。'
          },
          default: {
            en: 'No explicit parsers.',
            zh: '无显式解析器。'
          },
          example:
            "import { schema } from '@migaia/rpc-host/plugins/schema'\nimport type { IRpcSchemaParser } from '@migaia/rpc-host/plugins/schema'\nexport function checked(params: IRpcSchemaParser, result: IRpcSchemaParser) {\n  return schema({\n    namespaces: ['process'],\n    schemas: { 'app.catalog.lookup': { params, result } },\n  })\n}\n",
          whenToUse: {
            en: 'Provide real application parsers for exact accepted methods that require business input and result validation.',
            zh: '只为需要业务输入及结果校验的精确接纳方法提供真实应用解析器，不把握手声明元数据当校验算法。'
          }
        },
        namespaces: {
          summary: {
            en: 'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
            zh: '本插件生效的精确已安装命名空间名称，不会创建命名空间。'
          },
          default: {
            en: 'All installed namespaces.',
            zh: '全部已安装命名空间。'
          },
          example:
            "import { schema } from '@migaia/rpc-host/plugins/schema'\nimport type { IRpcSchemaParser } from '@migaia/rpc-host/plugins/schema'\nexport function checked(params: IRpcSchemaParser, result: IRpcSchemaParser) {\n  return schema({\n    namespaces: ['process'],\n    schemas: { 'app.catalog.lookup': { params, result } },\n  })\n}\n",
          whenToUse: {
            en: 'Provide real application parsers for exact accepted methods that require business input and result validation.',
            zh: '只为需要业务输入及结果校验的精确接纳方法提供真实应用解析器，不把握手声明元数据当校验算法。'
          }
        }
      }
    },
    ITypegenOutput: {
      summary: {
        en: 'Application-owned writer for accepted remote declarations; the plugin does not acquire filesystem authority.',
        zh: '为已接纳远端声明提供的应用输出所有者，插件不自行获得文件系统权限。'
      },
      members: {
        write: {
          summary: {
            en: 'Write one generated declaration to the selected destination.',
            zh: '向所选目标写入一份生成声明。'
          },
          params: {
            fileName: {
              en: 'Filename chosen by the real accepted peer/typegen renderer.',
              zh: '实际接纳对端及类型生成器选定的文件名。'
            },
            text: {
              en: 'Declaration text rendered from actual accepted methods.',
              zh: '根据实际接纳方法渲染的声明文本。'
            }
          },
          returns: {
            en: 'Void or a thenable; synchronous and asynchronous failures are reported by the installation.',
            zh: '返回空值或类 Promise 对象，同步及异步失败由安装上报。'
          },
          example:
            "import type { ITypegenOutput } from '@migaia/rpc-host/plugins/typegen'\n\nexport const out: ITypegenOutput = {\n  write: (fileName, text) => console.log(fileName, text),\n}\n"
        }
      }
    },
    ITypegenOptions: {
      summary: {
        en: 'Output capability and namespace filter for one type-generation observer.',
        zh: '一次类型生成观察所用的输出能力及命名空间过滤。'
      },
      members: {
        out: {
          summary: {
            en: 'Application writer called only for real accepted peer directories.',
            zh: '仅在真实接纳对端目录时调用的应用写入器。'
          },
          example:
            "import { typegen } from '@migaia/rpc-host/plugins/typegen'\nexport const declarations = typegen({\n  namespaces: ['process'],\n  out: { write: (fileName, text) => console.log(fileName, text) },\n})\n",
          whenToUse: {
            en: 'Write declarations from accepted directories when another application consumes their remote API types.',
            zh: '其他应用需要使用远端接口类型时，从真实接纳目录写出声明，不为尚未接纳的方法制造能力。'
          }
        },
        namespaces: {
          summary: {
            en: 'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
            zh: '本插件生效的精确已安装命名空间名称，不会创建命名空间。'
          },
          default: {
            en: 'All installed namespaces.',
            zh: '全部已安装命名空间。'
          },
          example:
            "import { typegen } from '@migaia/rpc-host/plugins/typegen'\nexport const declarations = typegen({\n  namespaces: ['process'],\n  out: { write: (fileName, text) => console.log(fileName, text) },\n})\n",
          whenToUse: {
            en: 'Write declarations from accepted directories when another application consumes their remote API types.',
            zh: '其他应用需要使用远端接口类型时，从真实接纳目录写出声明，不为尚未接纳的方法制造能力。'
          }
        }
      }
    },
    IRpcLimitsOptions: {
      summary: {
        en: 'Shared provider concurrency and optional per-connection governance; unrelated to native execution-unit or pool capacity.',
        zh: '共享提供方并发及可选连接治理，与原生执行单元或池容量不同。'
      },
      members: {
        maxGlobal: {
          summary: {
            en: 'Maximum admitted concurrent provider work across this shared installation.',
            zh: '本共享安装接纳的提供方并发工作总上限。'
          },
          default: {
            en: '256.',
            zh: '二百五十六。'
          },
          example:
            "import { limits } from '@migaia/rpc-host/plugins/limits'\nexport const admission = limits({\n  maxGlobal: 64,\n  maxPerPeer: 8,\n  maxCallsPerMinute: 600,\n  maxPayloadBytes: 1048576,\n  overflow: 'reject',\n  namespaces: ['process'],\n})\n",
          whenToUse: {
            en: 'Apply provider admission where selected namespaces must share finite execution, rate and payload capacity.',
            zh: '所选命名空间须共享有限执行、速率及载荷容量时配置提供方准入，而不改变载体队列容量。'
          }
        },
        maxPerPeer: {
          summary: {
            en: 'Maximum admitted concurrent work for one accepted peer scope.',
            zh: '一个接纳对端作用域的并发工作上限。'
          },
          default: {
            en: '64.',
            zh: '默认每个对端最多六十四个并发。'
          },
          example:
            "import { limits } from '@migaia/rpc-host/plugins/limits'\nexport const admission = limits({\n  maxGlobal: 64,\n  maxPerPeer: 8,\n  maxCallsPerMinute: 600,\n  maxPayloadBytes: 1048576,\n  overflow: 'reject',\n  namespaces: ['process'],\n})\n",
          whenToUse: {
            en: 'Apply provider admission where selected namespaces must share finite execution, rate and payload capacity.',
            zh: '所选命名空间须共享有限执行、速率及载荷容量时配置提供方准入，而不改变载体队列容量。'
          }
        },
        maxCallsPerMinute: {
          summary: {
            en: 'Optional actual per-connection call-rate bound.',
            zh: '实际单连接的可选每分钟调用上限。'
          },
          default: {
            en: 'No rate restriction.',
            zh: '不限速率。'
          },
          example:
            "import { limits } from '@migaia/rpc-host/plugins/limits'\nexport const admission = limits({\n  maxGlobal: 64,\n  maxPerPeer: 8,\n  maxCallsPerMinute: 600,\n  maxPayloadBytes: 1048576,\n  overflow: 'reject',\n  namespaces: ['process'],\n})\n",
          whenToUse: {
            en: 'Apply provider admission where selected namespaces must share finite execution, rate and payload capacity.',
            zh: '所选命名空间须共享有限执行、速率及载荷容量时配置提供方准入，而不改变载体队列容量。'
          }
        },
        maxPayloadBytes: {
          summary: {
            en: 'Optional admitted business payload bound measured by the limits owner.',
            zh: '限流所有者测量的可选业务载荷上限。'
          },
          default: {
            en: 'No payload restriction.',
            zh: '不限载荷。'
          },
          example:
            "import { limits } from '@migaia/rpc-host/plugins/limits'\nexport const admission = limits({\n  maxGlobal: 64,\n  maxPerPeer: 8,\n  maxCallsPerMinute: 600,\n  maxPayloadBytes: 1048576,\n  overflow: 'reject',\n  namespaces: ['process'],\n})\n",
          whenToUse: {
            en: 'Apply provider admission where selected namespaces must share finite execution, rate and payload capacity.',
            zh: '所选命名空间须共享有限执行、速率及载荷容量时配置提供方准入，而不改变载体队列容量。'
          }
        },
        maxConsecutiveTimeouts: {
          summary: {
            en: 'Optional consecutive provider-timeout threshold for this connection.',
            zh: '本连接的可选提供方连续超时阈值。'
          },
          default: {
            en: 'No timeout-streak restriction.',
            zh: '不限制连续超时。'
          },
          example:
            "import { limits } from '@migaia/rpc-host/plugins/limits'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nexport const idlePolicy = limits({\n  maxConsecutiveTimeouts: 3,\n  idleTimeoutMs: 30000,\n  violationLimit: 5,\n  scheduler: systemScheduler,\n  onRejected: (rejection) => console.error(rejection.reason),\n})\n",
          whenToUse: {
            en: 'Select explicit idle/violation thresholds and use the real rejection reason for operational diagnosis.',
            zh: '明确选择空闲及违例退场阈值，通过真实拒绝原因诊断运行问题，不能仅凭公共错误码猜测分支。'
          }
        },
        idleTimeoutMs: {
          summary: {
            en: 'Optional idle connection lifetime; timer belongs to this installed policy.',
            zh: '可选连接空闲寿命，计时器由本次安装策略拥有。'
          },
          default: {
            en: 'No idle restriction.',
            zh: '不限制空闲。'
          },
          example:
            "import { limits } from '@migaia/rpc-host/plugins/limits'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nexport const idlePolicy = limits({\n  maxConsecutiveTimeouts: 3,\n  idleTimeoutMs: 30000,\n  violationLimit: 5,\n  scheduler: systemScheduler,\n  onRejected: (rejection) => console.error(rejection.reason),\n})\n",
          whenToUse: {
            en: 'Select explicit idle/violation thresholds and use the real rejection reason for operational diagnosis.',
            zh: '明确选择空闲及违例退场阈值，通过真实拒绝原因诊断运行问题，不能仅凭公共错误码猜测分支。'
          }
        },
        violationLimit: {
          summary: {
            en: 'Violations before the existing connection policy retires its exact carrier.',
            zh: '现有连接策略使其精确载体退场之前允许的违例次数。'
          },
          default: {
            en: 'No automatic retirement threshold unless explicitly configured.',
            zh: '不显式配置时没有自动退场阈值。'
          },
          example:
            "import { limits } from '@migaia/rpc-host/plugins/limits'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nexport const idlePolicy = limits({\n  maxConsecutiveTimeouts: 3,\n  idleTimeoutMs: 30000,\n  violationLimit: 5,\n  scheduler: systemScheduler,\n  onRejected: (rejection) => console.error(rejection.reason),\n})\n",
          whenToUse: {
            en: 'Select explicit idle/violation thresholds and use the real rejection reason for operational diagnosis.',
            zh: '明确选择空闲及违例退场阈值，通过真实拒绝原因诊断运行问题，不能仅凭公共错误码猜测分支。'
          }
        },
        overflow: {
          summary: {
            en: 'Explicit source/code/message presentation for original governance rejection; does not grant local authority.',
            zh: '原治理拒绝使用的显式来源、错误码及消息展示，不授予本地权限。'
          },
          default: {
            en: 'Canonical provider overload presentation.',
            zh: '规范提供方过载展示。'
          },
          example:
            "import { limits } from '@migaia/rpc-host/plugins/limits'\nexport const admission = limits({\n  maxGlobal: 64,\n  maxPerPeer: 8,\n  maxCallsPerMinute: 600,\n  maxPayloadBytes: 1048576,\n  overflow: 'reject',\n  namespaces: ['process'],\n})\n",
          whenToUse: {
            en: 'Apply provider admission where selected namespaces must share finite execution, rate and payload capacity.',
            zh: '所选命名空间须共享有限执行、速率及载荷容量时配置提供方准入，而不改变载体队列容量。'
          }
        },
        onRejected: {
          summary: {
            en: 'Receives the admitted peer/controller, method and canonical reason before rejection; async callback failure is reported without replacing admission.',
            zh: '拒绝前接收已接纳对端及控制器、方法和规范原因；异步回调失败会被上报，不替换准入结果。'
          },
          default: {
            en: 'No rejection observer.',
            zh: '无拒绝观察器。'
          },
          params: {
            rejection: {
              en: 'The actual provider admission rejection, including its precise reason and current peer context.',
              zh: '真实提供方准入拒绝，包含精确原因以及当前对端上下文。'
            }
          },
          returns: {
            en: 'Notification only. Completion does not admit the rejected call or replace its original failure.',
            zh: '仅发出通知，完成回调不会接纳被拒调用或替换其原始失败。'
          },
          example:
            "import { limits } from '@migaia/rpc-host/plugins/limits'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nexport const idlePolicy = limits({\n  maxConsecutiveTimeouts: 3,\n  idleTimeoutMs: 30000,\n  violationLimit: 5,\n  scheduler: systemScheduler,\n  onRejected: (rejection) => console.error(rejection.reason),\n})\n",
          whenToUse: {
            en: 'Select explicit idle/violation thresholds and use the real rejection reason for operational diagnosis.',
            zh: '明确选择空闲及违例退场阈值，通过真实拒绝原因诊断运行问题，不能仅凭公共错误码猜测分支。'
          }
        },
        scheduler: {
          summary: {
            en: 'Existing application scheduler for actual admission timers and monotonic observations.',
            zh: '提供真实准入计时器及单调观察时间的现有应用调度器。'
          },
          default: {
            en: 'systemScheduler.',
            zh: '系统调度器。'
          },
          example:
            "import { limits } from '@migaia/rpc-host/plugins/limits'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nexport const idlePolicy = limits({\n  maxConsecutiveTimeouts: 3,\n  idleTimeoutMs: 30000,\n  violationLimit: 5,\n  scheduler: systemScheduler,\n  onRejected: (rejection) => console.error(rejection.reason),\n})\n",
          whenToUse: {
            en: 'Select explicit idle/violation thresholds and use the real rejection reason for operational diagnosis.',
            zh: '明确选择空闲及违例退场阈值，通过真实拒绝原因诊断运行问题，不能仅凭公共错误码猜测分支。'
          }
        },
        namespaces: {
          summary: {
            en: 'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
            zh: '本插件生效的精确已安装命名空间名称，不会创建命名空间。'
          },
          default: {
            en: 'All installed namespaces.',
            zh: '全部已安装命名空间。'
          },
          example:
            "import { limits } from '@migaia/rpc-host/plugins/limits'\nexport const admission = limits({\n  maxGlobal: 64,\n  maxPerPeer: 8,\n  maxCallsPerMinute: 600,\n  maxPayloadBytes: 1048576,\n  overflow: 'reject',\n  namespaces: ['process'],\n})\n",
          whenToUse: {
            en: 'Apply provider admission where selected namespaces must share finite execution, rate and payload capacity.',
            zh: '所选命名空间须共享有限执行、速率及载荷容量时配置提供方准入，而不改变载体队列容量。'
          }
        }
      }
    },
    IRpcLimitsOverflow: {
      summary: {
        en: 'Original explicit governance diagnostic presentation; source/code remain diagnostics, not execution authority.',
        zh: '原显式治理诊断展示，来源及错误码仍是诊断，不是执行权限。'
      },
      members: {
        source: {
          summary: {
            en: 'Stable package source for the selected diagnostic.',
            zh: '所选诊断的稳定包来源。'
          }
        },
        code: {
          summary: {
            en: 'Registered semantic code in that source.',
            zh: '该来源登记的语义错误码。'
          }
        },
        message: {
          summary: {
            en: 'Stable diagnostic text with no credential or payload excerpt.',
            zh: '不含凭据及载荷片段的稳定诊断文本。'
          }
        }
      }
    },
    IRpcLinkPolicyOptions: {
      summary: {
        en: 'Complete timeout/retry instances used as link defaults before transport and call overrides.',
        zh: '在传输及调用覆盖之前使用的完整超时及重试链路默认实例。'
      },
      members: {
        features: {
          summary: {
            en: 'Actual executing feature instances; duplicate kinds reject at cold admission.',
            zh: '实际执行功能实例；同种重复功能在冷准入时拒绝。'
          },
          example:
            "import { linkPolicy } from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout, retry } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\n",
          whenToUse: {
            en: 'Install complete attempt policies once when this link should provide consistent per-call defaults.',
            zh: '链路须为调用提供一致默认值时安装完整尝试策略，不能用只包含配置的普通对象替代执行实例。'
          }
        }
      }
    },
    IRpcIdempotencyStoreOptions: {
      summary: {
        en: 'Bounded explicit claim and outcome-retention configuration for the in-memory store.',
        zh: '内存存储的有界显式认领及结果保留配置。'
      },
      members: {
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
      }
    },
    IRpcIdempotencyOptions: {
      summary: {
        en: 'Installed store, scope selection and namespace outcome extension; automatic replay policy is not granted merely by declaring a key.',
        zh: '已安装存储、作用域选择及命名空间结果扩展；仅声明键不会授予自动重放策略。'
      },
      members: {
        retentionMs: {
          summary: {
            en: 'Positive safe-integer milliseconds retained after settlement; pending execution does not expire by this policy.',
            zh: '结算后保留的正安全整数毫秒，此策略不会使等待执行过期。'
          },
          default: {
            en: 'Default 300000; invalid nonpositive or unsafe integers fail INVALID_CONFIG.',
            zh: '默认 `300000`，非正数或非安全整数以配置非法失败。'
          },
          example:
            "import { idempotency } from '@migaia/rpc-host/plugins/idempotency'\nexport const retained = idempotency({\n  retentionMs: 60000,\n  maxEntries: 1024,\n  maxEntriesPerScope: 128,\n  maxBytes: 8388608,\n  maxOutcomeBytes: 1048576,\n})\n",
          whenToUse: {
            en: 'Bound retained replay outcomes independently from provider concurrency and request admission.',
            zh: '独立于提供方并发及请求准入限制重放结果保留，分别约束过期、条目数量及字节成本。'
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
          },
          example:
            "import { idempotency } from '@migaia/rpc-host/plugins/idempotency'\nexport const retained = idempotency({\n  retentionMs: 60000,\n  maxEntries: 1024,\n  maxEntriesPerScope: 128,\n  maxBytes: 8388608,\n  maxOutcomeBytes: 1048576,\n})\n",
          whenToUse: {
            en: 'Bound retained replay outcomes independently from provider concurrency and request admission.',
            zh: '独立于提供方并发及请求准入限制重放结果保留，分别约束过期、条目数量及字节成本。'
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
          },
          example:
            "import { idempotency } from '@migaia/rpc-host/plugins/idempotency'\nexport const retained = idempotency({\n  retentionMs: 60000,\n  maxEntries: 1024,\n  maxEntriesPerScope: 128,\n  maxBytes: 8388608,\n  maxOutcomeBytes: 1048576,\n})\n",
          whenToUse: {
            en: 'Bound retained replay outcomes independently from provider concurrency and request admission.',
            zh: '独立于提供方并发及请求准入限制重放结果保留，分别约束过期、条目数量及字节成本。'
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
          },
          example:
            "import { idempotency } from '@migaia/rpc-host/plugins/idempotency'\nexport const retained = idempotency({\n  retentionMs: 60000,\n  maxEntries: 1024,\n  maxEntriesPerScope: 128,\n  maxBytes: 8388608,\n  maxOutcomeBytes: 1048576,\n})\n",
          whenToUse: {
            en: 'Bound retained replay outcomes independently from provider concurrency and request admission.',
            zh: '独立于提供方并发及请求准入限制重放结果保留，分别约束过期、条目数量及字节成本。'
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
          },
          example:
            "import { idempotency } from '@migaia/rpc-host/plugins/idempotency'\nexport const retained = idempotency({\n  retentionMs: 60000,\n  maxEntries: 1024,\n  maxEntriesPerScope: 128,\n  maxBytes: 8388608,\n  maxOutcomeBytes: 1048576,\n})\n",
          whenToUse: {
            en: 'Bound retained replay outcomes independently from provider concurrency and request admission.',
            zh: '独立于提供方并发及请求准入限制重放结果保留，分别约束过期、条目数量及字节成本。'
          }
        },
        namespaces: {
          summary: {
            en: 'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
            zh: '本插件生效的精确已安装命名空间名称，不会创建命名空间。'
          },
          default: {
            en: 'All installed namespaces.',
            zh: '全部已安装命名空间。'
          },
          example:
            "import { idempotency, createRpcIdempotencyStore } from '@migaia/rpc-host/plugins'\nconst store = createRpcIdempotencyStore({ retentionMs: 60000, maxEntries: 1024 })\nexport const outcomes = idempotency({\n  namespaces: ['process'],\n  store,\n  scope: ({ token, senderId }) => JSON.stringify([token, senderId]),\n})\n",
          whenToUse: {
            en: 'Share an explicitly owned outcome store only within intended namespaces and authenticated identity scopes.',
            zh: '仅在明确选定的命名空间及已认证身份范围共享所拥有结果存储，不混淆不同调用方的结果。'
          }
        },
        store: {
          summary: {
            en: 'Original injected claim/lookup owner; no second store is created when supplied.',
            zh: '原注入认领及查询所有者；提供后不创建第二份存储。'
          },
          default: {
            en: 'A bounded in-memory store from these capacity options.',
            zh: '按容量选项创建有界内存存储。'
          },
          example:
            "import { idempotency, createRpcIdempotencyStore } from '@migaia/rpc-host/plugins'\nconst store = createRpcIdempotencyStore({ retentionMs: 60000, maxEntries: 1024 })\nexport const outcomes = idempotency({\n  namespaces: ['process'],\n  store,\n  scope: ({ token, senderId }) => JSON.stringify([token, senderId]),\n})\n",
          whenToUse: {
            en: 'Share an explicitly owned outcome store only within intended namespaces and authenticated identity scopes.',
            zh: '仅在明确选定的命名空间及已认证身份范围共享所拥有结果存储，不混淆不同调用方的结果。'
          }
        },
        scope: {
          summary: {
            en: 'Receives actual token/sender identity facts and returns a stable application scope; do not derive authorization from arbitrary payload data.',
            zh: '接收实际令牌及发送方身份事实，返回稳定应用作用域；不从任意载荷数据推导权限。'
          },
          default: {
            en: 'Canonical installed peer scope.',
            zh: '规范已安装对端作用域。'
          },
          params: {
            identity: {
              en: 'The authenticated senderId/token pair passed by the installed idempotency flow.',
              zh: '由已安装幂等信息流传入的发送者标识及认证令牌对。'
            }
          },
          returns: {
            en: 'A stable application isolation key for that identity; it selects retained outcomes without granting authentication.',
            zh: '该身份对应的稳定应用隔离键，用于选择保留结果，不授予认证权限。'
          },
          example:
            "import { idempotency, createRpcIdempotencyStore } from '@migaia/rpc-host/plugins'\nconst store = createRpcIdempotencyStore({ retentionMs: 60000, maxEntries: 1024 })\nexport const outcomes = idempotency({\n  namespaces: ['process'],\n  store,\n  scope: ({ token, senderId }) => JSON.stringify([token, senderId]),\n})\n",
          whenToUse: {
            en: 'Share an explicitly owned outcome store only within intended namespaces and authenticated identity scopes.',
            zh: '仅在明确选定的命名空间及已认证身份范围共享所拥有结果存储，不混淆不同调用方的结果。'
          }
        }
      }
    },
    IRpcIdempotencyLookup: {
      summary: {
        en: 'Passive retained-store result: pending, unknown or done with an outcome body or unavailable tombstone. Lookup does not allocate execution.',
        zh: '被动存储查询结果：待决、未知，或包含结果及不可用记录的完成状态。查询不分配执行。'
      },
      members: {
        state: {
          summary: {
            en: 'Actual retained claim state; unknown is not permission to replay side effects.',
            zh: '实际保留的认领状态；未知不代表可以重放副作用。'
          },
          values: {
            pending: {
              en: 'The matching execution is unfinished; await its original result.',
              zh: '匹配执行尚未完成，应等待原结果，不重复执行。'
            },
            unknown: {
              en: 'No retained outcome proves a result for this key.',
              zh: '没有保留结果证明此键结果，不可推测执行成功。'
            }
          }
        },
        outcome: {
          summary: {
            en: 'Retained original outcome or explicit unavailable body, only when done.',
            zh: '仅在完成时提供保留原结果或显式不可用内容。'
          }
        }
      }
    },
    IRpcOutcomeLookup: {
      summary: {
        en: 'Namespace callable installed by idempotency; routes a normal outcome command using the original logical idempotency key and standard call options.',
        zh: '幂等插件安装的命名空间可调用能力；以原逻辑幂等键及标准调用选项发送正常结果查询命令。'
      },
      members: {}
    },
    IRpcMessageIO: {
      summary: {
        en: 'Acquired whole-message IO forwards the original native value and transfer list. The native owner supplies subscriptions and close; SDK adds no peer or handshake facade.',
        zh: '已获取的整条消息读写资源传递原生原值及转移列表；原生所有者提供订阅及关闭，共享工具不增加对端或握手门面。'
      },
      members: {
        send: {
          summary: {
            en: 'Perform the actual native message handoff.',
            zh: '执行实际原生消息交接。'
          },
          params: {
            value: {
              en: 'Original encoded native payload.',
              zh: '原编码原生载荷。'
            },
            transfer: {
              en: 'Caller original ArrayBuffer transfer list.',
              zh: '调用方原缓冲区转移列表。'
            },
            options: {
              en: 'Actual cancellation/handoff metadata passed by Session and frame hooks.',
              zh: '会话及帧介入点传入的实际取消及交接元数据。'
            }
          },
          returns: {
            en: 'Void or Promise for actual write completion, preserving native failure.',
            zh: '实际写入完成的空值或 Promise，保留原生失败。'
          },
          example:
            "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}\n"
        },
        onMessage: {
          summary: {
            en: 'Subscribe to actual received native message values.',
            zh: '订阅实际接收的原生消息值。'
          },
          params: {
            listener: {
              en: 'Synchronous receiver for the original native value, called once per delivery.',
              zh: '每次交付只调用一次的原生原值同步接收者。'
            }
          },
          returns: {
            en: 'Exact remover for this native listener.',
            zh: '本原生监听者的精确移除器。'
          },
          example:
            "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}\n"
        },
        onClose: {
          summary: {
            en: 'Subscribe to original physical close or EOF with its reason.',
            zh: '订阅原物理关闭及输入终止，并保留原因。'
          },
          params: {
            listener: {
              en: 'Receives the original physical reason, not a reclassified business result.',
              zh: '接收原物理原因，不是重新分类的业务结果。'
            }
          },
          returns: {
            en: 'Exact native close-listener remover.',
            zh: '精确原生关闭监听移除器。'
          },
          example:
            "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}\n"
        },
        onError: {
          summary: {
            en: 'Optionally subscribe to actual native asynchronous failures.',
            zh: '可选订阅实际原生异步失败。'
          },
          params: {
            listener: {
              en: 'Receives the original native failure.',
              zh: '接收原生原失败。'
            }
          },
          returns: {
            en: 'Exact error-listener remover when this port exists.',
            zh: '存在此端口时返回精确错误监听移除器。'
          },
          example:
            "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}\n"
        },
        close: {
          summary: {
            en: 'Release resources according to original native ownership.',
            zh: '按原生原所有权释放资源。'
          },
          params: {
            reason: {
              en: 'Original explicit close reason, when supplied.',
              zh: '提供时使用原显式关闭原因。'
            }
          },
          returns: {
            en: 'Void or the original native cleanup Promise; borrowed resources remain externally owned.',
            zh: '空值或原生原清理 Promise，借用资源仍归外部所有者。'
          },
          example:
            "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}\n"
        }
      }
    },
    IRpcMessageCarrierOptions: {
      summary: {
        en: 'Concrete native message acquisition plus real codec, binary, observation and error-presentation capabilities.',
        zh: '具体原生消息获取及真实编解码、二进制、观察和错误展示能力。'
      },
      members: {
        id: {
          summary: {
            en: 'Native acquisition issues this unique carrier id before Session attachment; it is not a remote business id.',
            zh: '原生获取在会话附加前签发的唯一载体标识，不是远端业务标识。'
          },
          example:
            "import { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nexport function acquired(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ io, id, report })\n}\n",
          whenToUse: {
            en: 'Create the carrier after native acquisition and lend its actual IO, local carrier id and reporter.',
            zh: '原生获取成功后构造载体，借出实际读写资源、本地载体标识及上报器，保持原资源生命周期。'
          }
        },
        io: {
          summary: {
            en: 'The original acquired native message/byte IO; wrappers must retain its close, callbacks and actual transfer semantics.',
            zh: '原获取的原生消息或字节读写资源，边界保留其关闭、回调及实际转移语义。'
          },
          example:
            "import { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nexport function acquired(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ io, id, report })\n}\n",
          whenToUse: {
            en: 'Create the carrier after native acquisition and lend its actual IO, local carrier id and reporter.',
            zh: '原生获取成功后构造载体，借出实际读写资源、本地载体标识及上报器，保持原资源生命周期。'
          }
        },
        report: {
          summary: {
            en: 'Receives contained asynchronous native/cleanup failures without replacing the primary business result.',
            zh: '接收被隔离的原生及清理异步失败，不替换主要业务结果。'
          },
          params: {
            error: {
              en: 'The original failure delivered by this owner, retaining its source, code, native class and cause chain.',
              zh: '本所有者交付的原失败，保留来源、错误码、原生类型及原因链；该值来自实际失败回调。'
            }
          },
          returns: {
            en: 'No business result is replaced; diagnostics should finish without throwing.',
            zh: '不替换业务返回结果，诊断回调应完成上报并避免再次抛错。'
          },
          example:
            "import { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nexport function acquired(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ io, id, report })\n}\n",
          whenToUse: {
            en: 'Create the carrier after native acquisition and lend its actual IO, local carrier id and reporter.',
            zh: '原生获取成功后构造载体，借出实际读写资源、本地载体标识及上报器，保持原资源生命周期。'
          }
        },
        nativeBinary: {
          summary: {
            en: 'Capability from the real native medium for genuine ArrayBuffer/view representation; it is distinct from transfer support.',
            zh: '真实原生媒介提供的缓冲区及视图表示能力，与转移支持不同。'
          },
          default: {
            en: 'false unless supplied by the native owner.',
            zh: '由原生所有者提供，否则不启用。'
          },
          example:
            "import { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageCarrierOptions } from '@migaia/rpc-host/sdk'\nexport function structured(options: IRpcMessageCarrierOptions) {\n  return createRpcMessageCarrier({ ...options, nativeBinary: true })\n}\n",
          whenToUse: {
            en: 'Enable only for a medium that carries genuine original ArrayBuffer/view sidecars; transfer support remains separate.',
            zh: '只有媒介能携带真实原缓冲区及视图附带列表时才启用，转移支持仍由独立原生能力决定。'
          }
        },
        digest: {
          summary: {
            en: 'Actual native SHA-256 backing digest capability; it is not authentication authority.',
            zh: '实际原生完整缓冲区散列能力，不授予认证权限。'
          },
          default: {
            en: 'Use available native digest capability.',
            zh: '使用可用的原生散列能力。'
          },
          example:
            "import { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageCarrierOptions } from '@migaia/rpc-host/sdk'\nexport function encoded(options: IRpcMessageCarrierOptions) {\n  const { digest, codec, errorMetadata } = options\n  return createRpcMessageCarrier({ ...options, digest, codec, errorMetadata })\n}\n",
          whenToUse: {
            en: 'Lend the real native digest, sole media codec and operation error maps when the platform supplies explicit capabilities.',
            zh: '平台提供显式能力时借用真实原生散列、唯一媒介编解码器及操作错误映射，不增加第二业务遍历器。'
          }
        },
        codec: {
          summary: {
            en: 'One actual prepare/encode/decode/restore codec; no identity codec or second semantic parser is inserted.',
            zh: '唯一实际准备、编码、解码及恢复编解码器，不插入恒等编解码器或第二语义解析器。'
          },
          default: {
            en: 'RpcJsonCarrierCodec.',
            zh: '共享 JSON 载体编解码器。'
          },
          example:
            "import { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageCarrierOptions } from '@migaia/rpc-host/sdk'\nexport function encoded(options: IRpcMessageCarrierOptions) {\n  const { digest, codec, errorMetadata } = options\n  return createRpcMessageCarrier({ ...options, digest, codec, errorMetadata })\n}\n",
          whenToUse: {
            en: 'Lend the real native digest, sole media codec and operation error maps when the platform supplies explicit capabilities.',
            zh: '平台提供显式能力时借用真实原生散列、唯一媒介编解码器及操作错误映射，不增加第二业务遍历器。'
          }
        },
        errorMetadata: {
          summary: {
            en: 'Caller-owned error presentation maps for actual local errors created during this operation; diagnostics confer no authority.',
            zh: '本操作实际本地错误所用的调用方展示映射，诊断不授予权限。'
          },
          default: {
            en: 'No extra presentation maps.',
            zh: '无额外展示映射。'
          },
          example:
            "import { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageCarrierOptions } from '@migaia/rpc-host/sdk'\nexport function encoded(options: IRpcMessageCarrierOptions) {\n  const { digest, codec, errorMetadata } = options\n  return createRpcMessageCarrier({ ...options, digest, codec, errorMetadata })\n}\n",
          whenToUse: {
            en: 'Lend the real native digest, sole media codec and operation error maps when the platform supplies explicit capabilities.',
            zh: '平台提供显式能力时借用真实原生散列、唯一媒介编解码器及操作错误映射，不增加第二业务遍历器。'
          }
        },
        observation: {
          summary: {
            en: 'Actual native raw observation capability, emitted at physical IO only.',
            zh: '实际原生原始观察能力，只在物理读写点发出。'
          },
          default: {
            en: 'No physical observation.',
            zh: '无物理观察。'
          },
          example:
            "import { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageCarrierOptions } from '@migaia/rpc-host/sdk'\nexport function observed(options: IRpcMessageCarrierOptions) {\n  const { observation, assertTransfer } = options\n  return createRpcMessageCarrier({ ...options, observation, assertTransfer })\n}\n",
          whenToUse: {
            en: 'Use the original raw observer and synchronous transfer check issued by native acquisition.',
            zh: '使用原生获取签发的原始观察器及同步转移检查，不从已编码载荷或二进制类别猜测转移能力。'
          }
        },
        assertTransfer: {
          summary: {
            en: 'Native synchronous transfer capability check; preserve the medium original coded rejection.',
            zh: '原生同步转移能力检查，保留媒介原分类拒绝。'
          },
          default: {
            en: 'Native binary media permit transfer; inline-only media reject.',
            zh: '原生二进制媒介允许转移，仅内联媒介拒绝。'
          },
          params: {},
          returns: {
            en: 'Return normally only when the native medium supports the requested transfer; otherwise throw its original coded capability error.',
            zh: '仅在原生媒介支持所请求转移时正常返回，否则抛出该媒介原分类能力错误。'
          },
          example:
            "import { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageCarrierOptions } from '@migaia/rpc-host/sdk'\nexport function observed(options: IRpcMessageCarrierOptions) {\n  const { observation, assertTransfer } = options\n  return createRpcMessageCarrier({ ...options, observation, assertTransfer })\n}\n",
          whenToUse: {
            en: 'Use the original raw observer and synchronous transfer check issued by native acquisition.',
            zh: '使用原生获取签发的原始观察器及同步转移检查，不从已编码载荷或二进制类别猜测转移能力。'
          }
        }
      },
      example:
        "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}\n"
    },
    IRpcByteCarrierOptions: {
      summary: {
        en: 'The same carrier lifecycle over acquired ordered bytes; UTF-8 and length framing run in the actual SDK owner, without native-binary transfer.',
        zh: '在已获取有序字节上采用同一载体生命周期；字符编码及长度分帧在实际共享所有者执行，不提供原生二进制转移。'
      },
      members: {
        id: {
          summary: {
            en: 'Native acquisition issues this unique carrier id before Session attachment; it is not a remote business id.',
            zh: '原生获取在会话附加前签发的唯一载体标识，不是远端业务标识。'
          },
          example:
            "import { createRpcByteCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcByteIO } from '@migaia/rpc-host/sdk'\nexport function acquired(io: IRpcByteIO, id: string, report: (error: unknown) => void) {\n  return createRpcByteCarrier({ io, id, report })\n}\n",
          whenToUse: {
            en: 'Create the carrier after native acquisition and lend its actual IO, local carrier id and reporter.',
            zh: '原生获取成功后构造载体，借出实际读写资源、本地载体标识及上报器，保持原资源生命周期。'
          }
        },
        io: {
          summary: {
            en: 'The original acquired native message/byte IO; wrappers must retain its close, callbacks and actual transfer semantics.',
            zh: '原获取的原生消息或字节读写资源，边界保留其关闭、回调及实际转移语义。'
          },
          example:
            "import { createRpcByteCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcByteIO } from '@migaia/rpc-host/sdk'\nexport function acquired(io: IRpcByteIO, id: string, report: (error: unknown) => void) {\n  return createRpcByteCarrier({ io, id, report })\n}\n",
          whenToUse: {
            en: 'Create the carrier after native acquisition and lend its actual IO, local carrier id and reporter.',
            zh: '原生获取成功后构造载体，借出实际读写资源、本地载体标识及上报器，保持原资源生命周期。'
          }
        },
        report: {
          summary: {
            en: 'Receives contained asynchronous native/cleanup failures without replacing the primary business result.',
            zh: '接收被隔离的原生及清理异步失败，不替换主要业务结果。'
          },
          params: {
            error: {
              en: 'The original failure delivered by this owner, retaining its source, code, native class and cause chain.',
              zh: '本所有者交付的原失败，保留来源、错误码、原生类型及原因链；该值来自实际失败回调。'
            }
          },
          returns: {
            en: 'No business result is replaced; diagnostics should finish without throwing.',
            zh: '不替换业务返回结果，诊断回调应完成上报并避免再次抛错。'
          },
          example:
            "import { createRpcByteCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcByteIO } from '@migaia/rpc-host/sdk'\nexport function acquired(io: IRpcByteIO, id: string, report: (error: unknown) => void) {\n  return createRpcByteCarrier({ io, id, report })\n}\n",
          whenToUse: {
            en: 'Create the carrier after native acquisition and lend its actual IO, local carrier id and reporter.',
            zh: '原生获取成功后构造载体，借出实际读写资源、本地载体标识及上报器，保持原资源生命周期。'
          }
        },
        digest: {
          summary: {
            en: 'Actual native SHA-256 backing digest capability; it is not authentication authority.',
            zh: '实际原生完整缓冲区散列能力，不授予认证权限。'
          },
          default: {
            en: 'Use available native digest capability.',
            zh: '使用可用的原生散列能力。'
          },
          example:
            "import { createRpcByteCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcByteCarrierOptions } from '@migaia/rpc-host/sdk'\nexport function encoded(options: IRpcByteCarrierOptions) {\n  const { digest, codec, errorMetadata } = options\n  return createRpcByteCarrier({ ...options, digest, codec, errorMetadata })\n}\n",
          whenToUse: {
            en: 'Lend the real native digest, sole media codec and operation error maps when the platform supplies explicit capabilities.',
            zh: '平台提供显式能力时借用真实原生散列、唯一媒介编解码器及操作错误映射，不增加第二业务遍历器。'
          }
        },
        codec: {
          summary: {
            en: 'One actual prepare/encode/decode/restore codec; no identity codec or second semantic parser is inserted.',
            zh: '唯一实际准备、编码、解码及恢复编解码器，不插入恒等编解码器或第二语义解析器。'
          },
          default: {
            en: 'RpcJsonCarrierCodec.',
            zh: '共享 JSON 载体编解码器。'
          },
          example:
            "import { createRpcByteCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcByteCarrierOptions } from '@migaia/rpc-host/sdk'\nexport function encoded(options: IRpcByteCarrierOptions) {\n  const { digest, codec, errorMetadata } = options\n  return createRpcByteCarrier({ ...options, digest, codec, errorMetadata })\n}\n",
          whenToUse: {
            en: 'Lend the real native digest, sole media codec and operation error maps when the platform supplies explicit capabilities.',
            zh: '平台提供显式能力时借用真实原生散列、唯一媒介编解码器及操作错误映射，不增加第二业务遍历器。'
          }
        },
        errorMetadata: {
          summary: {
            en: 'Caller-owned error presentation maps for actual local errors created during this operation; diagnostics confer no authority.',
            zh: '本操作实际本地错误所用的调用方展示映射，诊断不授予权限。'
          },
          default: {
            en: 'No extra presentation maps.',
            zh: '无额外展示映射。'
          },
          example:
            "import { createRpcByteCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcByteCarrierOptions } from '@migaia/rpc-host/sdk'\nexport function encoded(options: IRpcByteCarrierOptions) {\n  const { digest, codec, errorMetadata } = options\n  return createRpcByteCarrier({ ...options, digest, codec, errorMetadata })\n}\n",
          whenToUse: {
            en: 'Lend the real native digest, sole media codec and operation error maps when the platform supplies explicit capabilities.',
            zh: '平台提供显式能力时借用真实原生散列、唯一媒介编解码器及操作错误映射，不增加第二业务遍历器。'
          }
        },
        observation: {
          summary: {
            en: 'Actual native raw observation capability, emitted at physical IO only.',
            zh: '实际原生原始观察能力，只在物理读写点发出。'
          },
          default: {
            en: 'No physical observation.',
            zh: '无物理观察。'
          },
          example:
            "import { createRpcByteCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcByteCarrierOptions } from '@migaia/rpc-host/sdk'\nexport function observed(options: IRpcByteCarrierOptions) {\n  const { observation, assertTransfer } = options\n  return createRpcByteCarrier({ ...options, observation, assertTransfer })\n}\n",
          whenToUse: {
            en: 'Use the original raw observer and synchronous transfer check issued by native acquisition.',
            zh: '使用原生获取签发的原始观察器及同步转移检查，不从已编码载荷或二进制类别猜测转移能力。'
          }
        },
        assertTransfer: {
          summary: {
            en: 'Native synchronous transfer capability check; preserve the medium original coded rejection.',
            zh: '原生同步转移能力检查，保留媒介原分类拒绝。'
          },
          default: {
            en: 'Native binary media permit transfer; inline-only media reject.',
            zh: '原生二进制媒介允许转移，仅内联媒介拒绝。'
          },
          params: {},
          returns: {
            en: 'Return normally only when the native medium supports the requested transfer; otherwise throw its original coded capability error.',
            zh: '仅在原生媒介支持所请求转移时正常返回，否则抛出该媒介原分类能力错误。'
          },
          example:
            "import { createRpcByteCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcByteCarrierOptions } from '@migaia/rpc-host/sdk'\nexport function observed(options: IRpcByteCarrierOptions) {\n  const { observation, assertTransfer } = options\n  return createRpcByteCarrier({ ...options, observation, assertTransfer })\n}\n",
          whenToUse: {
            en: 'Use the original raw observer and synchronous transfer check issued by native acquisition.',
            zh: '使用原生获取签发的原始观察器及同步转移检查，不从已编码载荷或二进制类别猜测转移能力。'
          }
        },
        utf8: {
          summary: {
            en: 'Optional structural encoder/fatal decoder injection from the acquiring platform.',
            zh: '获取平台提供的可选结构编码器及严格解码器。'
          },
          default: {
            en: 'Standard native TextEncoder/TextDecoder.',
            zh: '标准原生文本编码器及解码器。'
          },
          example:
            "import { createRpcByteCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcByteCarrierOptions } from '@migaia/rpc-host/sdk'\nexport function textBytes(options: IRpcByteCarrierOptions) {\n  return createRpcByteCarrier({\n    ...options,\n    utf8: {\n      encoder: new TextEncoder(),\n      decoder: new TextDecoder('utf-8', { fatal: true }),\n    },\n  })\n}\n",
          whenToUse: {
            en: 'Inject acquired platform text capabilities when the default global constructors are not the intended receivers.',
            zh: '默认全局构造器并非所需接收者时，注入已获取平台文本能力，仍只保留一个严格解码所有者。'
          }
        }
      }
    },
    IRpcUtf8Options: {
      summary: {
        en: 'Held Encoding API capabilities; an injected decoder must reject malformed UTF-8 and preserve its original native failure.',
        zh: '持有的编码能力；注入解码器必须拒绝非法字符字节并保留原生原失败。'
      },
      members: {
        encoder: {
          summary: {
            en: 'Native encode/encodeInto receiver captured once.',
            zh: '只捕获一次的原生编码接收者。'
          },
          default: {
            en: 'new TextEncoder().',
            zh: '创建原生文本编码器。'
          },
          example:
            "import { RpcUtf8 } from '@migaia/rpc-host/sdk'\nconst utf8 = new RpcUtf8({\n  encoder: new TextEncoder(),\n  decoder: new TextDecoder('utf-8', { fatal: true }),\n})\nconst bytes = utf8.encoder.encode('hello')\nconst target = new Uint8Array(16)\nutf8.encoder.encodeInto('hello', target)\nexport const text = utf8.decode(bytes)\n",
          whenToUse: {
            en: 'Capture the existing native Encoding API receivers when acquisition already owns them.',
            zh: '获取过程已拥有编码接口接收者时捕获其原实例，严格解码必须保留非法字节的原生失败。'
          }
        },
        decoder: {
          summary: {
            en: 'Native fatal decoder; malformed text is not silently replaced.',
            zh: '严格原生解码器，不静默替换非法文本。'
          },
          default: {
            en: 'new TextDecoder with fatal:true.',
            zh: '创建启用严格模式的原生文本解码器。'
          },
          example:
            "import { RpcUtf8 } from '@migaia/rpc-host/sdk'\nconst utf8 = new RpcUtf8({\n  encoder: new TextEncoder(),\n  decoder: new TextDecoder('utf-8', { fatal: true }),\n})\nconst bytes = utf8.encoder.encode('hello')\nconst target = new Uint8Array(16)\nutf8.encoder.encodeInto('hello', target)\nexport const text = utf8.decode(bytes)\n",
          whenToUse: {
            en: 'Capture the existing native Encoding API receivers when acquisition already owns them.',
            zh: '获取过程已拥有编码接口接收者时捕获其原实例，严格解码必须保留非法字节的原生失败。'
          }
        }
      }
    },
    IRpcPhysicalWriteOptions: {
      summary: {
        en: 'The identical Contract carrier-write metadata borrowed at actual native IO. No second write-admission record is created.',
        zh: '实际原生读写借用的同一契约载体写入元数据，不创建第二份写入准入记录。'
      },
      members: {}
    },
    IRpcJsonTextParser: {
      summary: {
        en: 'Canonical synchronous JSON text representation; the carrier supplies exactly one parse and one encoding boundary.',
        zh: '规范同步 JSON 文本表示，载体只提供一个解析及编码边界。'
      },
      members: {
        encode: {
          summary: {
            en: 'Encode the current prepared metadata to its canonical JSON text tuple.',
            zh: '将当前准备元数据编码为规范 JSON 文本元组。'
          },
          params: {
            value: {
              en: 'Prepared metadata after actual envelope hooks.',
              zh: '实际信封介入点之后的准备元数据。'
            }
          },
          returns: {
            en: 'A text discriminator and canonical JSON string.',
            zh: '文本判别值及规范 JSON 字符串。'
          },
          example:
            "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}\n"
        },
        decode: {
          summary: {
            en: 'Parse the actual text tuple once.',
            zh: '仅解析实际文本元组一次。'
          },
          params: {
            value: {
              en: 'Original text tuple from this codec.',
              zh: '本编解码器的原文本元组。'
            }
          },
          returns: {
            en: 'Parsed inert data or the original parser failure under the privacy boundary.',
            zh: '惰性解析数据，或经隐私边界处理的原解析失败。'
          },
          example:
            "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}\n"
        }
      }
    },
    IRpcPreparedBinary: {
      summary: {
        en: 'One captured binary manifest and original complete backing list; aliases/views retain actual identity and byte offsets.',
        zh: '一次捕获的二进制清单及原完整缓冲区列表，别名与视图保留实际身份及字节偏移。'
      },
      members: {
        manifest: {
          summary: {
            en: 'Protected manifest containing tagged semantic data and backing integrity descriptors.',
            zh: '包含带标签语义数据及缓冲区完整性描述的保护清单。'
          }
        },
        sidecars: {
          summary: {
            en: 'Original ordered complete ArrayBuffer backings, never copied slices of visible views.',
            zh: '有序原完整缓冲区，不是可见视图切片副本。'
          }
        },
        backingBytes: {
          summary: {
            en: 'Total actual complete backing bytes charged before hashing.',
            zh: '散列之前计费的实际完整缓冲区总字节数。'
          }
        }
      },
      scenarios: [
        {
          en: 'Carry captured metadata and original backings into the actual physical codec.',
          zh: '向实际物理编解码器携带捕获元数据及原缓冲区，不重新遍历已经捕获的应用图。'
        }
      ],
      example:
        "import { prepareRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryOptions } from '@migaia/rpc-host/sdk'\nimport type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'\nexport function binary(envelope: IRpcEnvelope, options: IRpcBinaryOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata } = options\n  return prepareRpcBinary(envelope, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n  })\n}\n"
    },
    IRpcBinaryOptions: {
      summary: {
        en: 'Operation-local storage, limit, hash and capture callbacks for the one binary execution walker.',
        zh: '唯一二进制执行遍历器的操作局部存储、上限、散列及捕获回调。'
      },
      members: {
        storage: {
          summary: {
            en: 'Choose inline base64url or original native backing sidecars according to acquired media capability.',
            zh: '按获取媒介能力选择内联字节表示或原生原缓冲区附带列表。'
          },
          values: {
            inline: {
              en: 'JSON-safe inline bytes.',
              zh: '可安全用于 JSON 的内联字节。'
            },
            native: {
              en: 'Original backings carried by native media.',
              zh: '原生媒介携带原缓冲区。'
            }
          },
          example:
            "import { prepareRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryOptions } from '@migaia/rpc-host/sdk'\nimport type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'\nexport function binary(envelope: IRpcEnvelope, options: IRpcBinaryOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata } = options\n  return prepareRpcBinary(envelope, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n  })\n}\n",
          whenToUse: {
            en: 'Lend the exact storage mode, original delivery sidecars and pre-hash capabilities from this operation owner.',
            zh: '借用本操作所有者的精确存储模式、原交付附带列表及散列前能力，不重走应用图或混用其他帧缓冲区。'
          }
        },
        limit: {
          summary: {
            en: 'Whole-backing budget checked before any native digest call.',
            zh: '调用任何原生散列之前检查的完整缓冲区预算。'
          },
          default: {
            en: 'Protocol binary limit.',
            zh: '协议二进制上限。'
          },
          example:
            "import { prepareRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryOptions } from '@migaia/rpc-host/sdk'\nimport type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'\nexport function binary(envelope: IRpcEnvelope, options: IRpcBinaryOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata } = options\n  return prepareRpcBinary(envelope, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n  })\n}\n",
          whenToUse: {
            en: 'Lend the exact storage mode, original delivery sidecars and pre-hash capabilities from this operation owner.',
            zh: '借用本操作所有者的精确存储模式、原交付附带列表及散列前能力，不重走应用图或混用其他帧缓冲区。'
          }
        },
        digest: {
          summary: {
            en: 'Actual native SHA-256 backing digest capability; it is not authentication authority.',
            zh: '实际原生完整缓冲区散列能力，不授予认证权限。'
          },
          default: {
            en: 'Use available native digest capability.',
            zh: '使用可用的原生散列能力。'
          },
          example:
            "import { prepareRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryOptions } from '@migaia/rpc-host/sdk'\nimport type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'\nexport function binary(envelope: IRpcEnvelope, options: IRpcBinaryOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata } = options\n  return prepareRpcBinary(envelope, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n  })\n}\n",
          whenToUse: {
            en: 'Lend the exact storage mode, original delivery sidecars and pre-hash capabilities from this operation owner.',
            zh: '借用本操作所有者的精确存储模式、原交付附带列表及散列前能力，不重走应用图或混用其他帧缓冲区。'
          }
        },
        errorMetadata: {
          summary: {
            en: 'Caller-owned error presentation maps for actual local errors created during this operation; diagnostics confer no authority.',
            zh: '本操作实际本地错误所用的调用方展示映射，诊断不授予权限。'
          },
          default: {
            en: 'No extra presentation maps.',
            zh: '无额外展示映射。'
          },
          example:
            "import { prepareRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryOptions } from '@migaia/rpc-host/sdk'\nimport type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'\nexport function binary(envelope: IRpcEnvelope, options: IRpcBinaryOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata } = options\n  return prepareRpcBinary(envelope, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n  })\n}\n",
          whenToUse: {
            en: 'Lend the exact storage mode, original delivery sidecars and pre-hash capabilities from this operation owner.',
            zh: '借用本操作所有者的精确存储模式、原交付附带列表及散列前能力，不重走应用图或混用其他帧缓冲区。'
          }
        },
        encoding: {
          summary: {
            en: 'Carrier hooks consume captured roots; capture runs synchronously before digest suspension.',
            zh: '载体介入点消费已捕获根；捕获在散列挂起之前同步执行。'
          },
          default: {
            en: 'Canonical inline encoding and no extra capture hook.',
            zh: '规范内联编码，无额外捕获介入。'
          },
          example:
            "import { prepareRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryOptions } from '@migaia/rpc-host/sdk'\nimport type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'\nexport function binary(envelope: IRpcEnvelope, options: IRpcBinaryOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata } = options\n  return prepareRpcBinary(envelope, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n  })\n}\n",
          whenToUse: {
            en: 'Lend the exact storage mode, original delivery sidecars and pre-hash capabilities from this operation owner.',
            zh: '借用本操作所有者的精确存储模式、原交付附带列表及散列前能力，不重走应用图或混用其他帧缓冲区。'
          }
        },
        beforeDigest: {
          summary: {
            en: 'Receives the protected captured manifest and total backing bytes before hashing starts.',
            zh: '散列启动前接收保护捕获清单及完整缓冲区总字节数。'
          },
          default: {
            en: 'No extra callback.',
            zh: '无额外回调。'
          },
          params: {
            manifest: {
              en: 'The protected manifest captured by this binary operation before any asynchronous digest.',
              zh: '本次二进制操作在任何异步散列之前捕获的受保护清单。'
            },
            backingBytes: {
              en: 'The sum of complete original backing lengths, not just visible view slices.',
              zh: '完整原缓冲区长度之和，而不只是可见视图片段长度。'
            }
          },
          returns: {
            en: 'Synchronous admission hook; a throw stops hashing and rejects this operation with that failure.',
            zh: '同步准入介入点，抛错会停止散列并以该失败拒绝本次操作。'
          },
          example:
            "import { prepareRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryOptions } from '@migaia/rpc-host/sdk'\nimport type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'\nexport function binary(envelope: IRpcEnvelope, options: IRpcBinaryOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata } = options\n  return prepareRpcBinary(envelope, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n  })\n}\n",
          whenToUse: {
            en: 'Lend the exact storage mode, original delivery sidecars and pre-hash capabilities from this operation owner.',
            zh: '借用本操作所有者的精确存储模式、原交付附带列表及散列前能力，不重走应用图或混用其他帧缓冲区。'
          }
        }
      }
    },
    IRpcBinaryRestoreOptions: {
      summary: {
        en: 'Binary restore options plus the exact original ordered native backing list from this physical delivery.',
        zh: '二进制恢复选项及本次物理交付的精确原有序缓冲区列表。'
      },
      members: {
        storage: {
          summary: {
            en: 'Choose inline base64url or original native backing sidecars according to acquired media capability.',
            zh: '按获取媒介能力选择内联字节表示或原生原缓冲区附带列表。'
          },
          values: {
            inline: {
              en: 'JSON-safe inline bytes.',
              zh: '可安全用于 JSON 的内联字节。'
            },
            native: {
              en: 'Original backings carried by native media.',
              zh: '原生媒介携带原缓冲区。'
            }
          },
          example:
            "import { restoreRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryRestoreOptions } from '@migaia/rpc-host/sdk'\nexport function binary(value: unknown, options: IRpcBinaryRestoreOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata, sidecars } =\n    options\n  return restoreRpcBinary(value, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n    sidecars,\n  })\n}\n",
          whenToUse: {
            en: 'Lend the exact storage mode, original delivery sidecars and pre-hash capabilities from this operation owner.',
            zh: '借用本操作所有者的精确存储模式、原交付附带列表及散列前能力，不重走应用图或混用其他帧缓冲区。'
          }
        },
        limit: {
          summary: {
            en: 'Whole-backing budget checked before any native digest call.',
            zh: '调用任何原生散列之前检查的完整缓冲区预算。'
          },
          default: {
            en: 'Protocol binary limit.',
            zh: '协议二进制上限。'
          },
          example:
            "import { restoreRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryRestoreOptions } from '@migaia/rpc-host/sdk'\nexport function binary(value: unknown, options: IRpcBinaryRestoreOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata, sidecars } =\n    options\n  return restoreRpcBinary(value, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n    sidecars,\n  })\n}\n",
          whenToUse: {
            en: 'Lend the exact storage mode, original delivery sidecars and pre-hash capabilities from this operation owner.',
            zh: '借用本操作所有者的精确存储模式、原交付附带列表及散列前能力，不重走应用图或混用其他帧缓冲区。'
          }
        },
        digest: {
          summary: {
            en: 'Actual native SHA-256 backing digest capability; it is not authentication authority.',
            zh: '实际原生完整缓冲区散列能力，不授予认证权限。'
          },
          default: {
            en: 'Use available native digest capability.',
            zh: '使用可用的原生散列能力。'
          },
          example:
            "import { restoreRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryRestoreOptions } from '@migaia/rpc-host/sdk'\nexport function binary(value: unknown, options: IRpcBinaryRestoreOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata, sidecars } =\n    options\n  return restoreRpcBinary(value, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n    sidecars,\n  })\n}\n",
          whenToUse: {
            en: 'Lend the exact storage mode, original delivery sidecars and pre-hash capabilities from this operation owner.',
            zh: '借用本操作所有者的精确存储模式、原交付附带列表及散列前能力，不重走应用图或混用其他帧缓冲区。'
          }
        },
        errorMetadata: {
          summary: {
            en: 'Caller-owned error presentation maps for actual local errors created during this operation; diagnostics confer no authority.',
            zh: '本操作实际本地错误所用的调用方展示映射，诊断不授予权限。'
          },
          default: {
            en: 'No extra presentation maps.',
            zh: '无额外展示映射。'
          },
          example:
            "import { restoreRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryRestoreOptions } from '@migaia/rpc-host/sdk'\nexport function binary(value: unknown, options: IRpcBinaryRestoreOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata, sidecars } =\n    options\n  return restoreRpcBinary(value, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n    sidecars,\n  })\n}\n",
          whenToUse: {
            en: 'Lend the exact storage mode, original delivery sidecars and pre-hash capabilities from this operation owner.',
            zh: '借用本操作所有者的精确存储模式、原交付附带列表及散列前能力，不重走应用图或混用其他帧缓冲区。'
          }
        },
        encoding: {
          summary: {
            en: 'Carrier hooks consume captured roots; capture runs synchronously before digest suspension.',
            zh: '载体介入点消费已捕获根；捕获在散列挂起之前同步执行。'
          },
          default: {
            en: 'Canonical inline encoding and no extra capture hook.',
            zh: '规范内联编码，无额外捕获介入。'
          },
          example:
            "import { restoreRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryRestoreOptions } from '@migaia/rpc-host/sdk'\nexport function binary(value: unknown, options: IRpcBinaryRestoreOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata, sidecars } =\n    options\n  return restoreRpcBinary(value, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n    sidecars,\n  })\n}\n",
          whenToUse: {
            en: 'Lend the exact storage mode, original delivery sidecars and pre-hash capabilities from this operation owner.',
            zh: '借用本操作所有者的精确存储模式、原交付附带列表及散列前能力，不重走应用图或混用其他帧缓冲区。'
          }
        },
        beforeDigest: {
          summary: {
            en: 'Receives the protected captured manifest and total backing bytes before hashing starts.',
            zh: '散列启动前接收保护捕获清单及完整缓冲区总字节数。'
          },
          default: {
            en: 'No extra callback.',
            zh: '无额外回调。'
          },
          params: {
            manifest: {
              en: 'The protected manifest captured by this binary operation before any asynchronous digest.',
              zh: '本次二进制操作在任何异步散列之前捕获的受保护清单。'
            },
            backingBytes: {
              en: 'The sum of complete original backing lengths, not just visible view slices.',
              zh: '完整原缓冲区长度之和，而不只是可见视图片段长度。'
            }
          },
          returns: {
            en: 'Synchronous admission hook; a throw stops hashing and rejects this operation with that failure.',
            zh: '同步准入介入点，抛错会停止散列并以该失败拒绝本次操作。'
          },
          example:
            "import { restoreRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryRestoreOptions } from '@migaia/rpc-host/sdk'\nexport function binary(value: unknown, options: IRpcBinaryRestoreOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata, sidecars } =\n    options\n  return restoreRpcBinary(value, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n    sidecars,\n  })\n}\n",
          whenToUse: {
            en: 'Lend the exact storage mode, original delivery sidecars and pre-hash capabilities from this operation owner.',
            zh: '借用本操作所有者的精确存储模式、原交付附带列表及散列前能力，不重走应用图或混用其他帧缓冲区。'
          }
        },
        sidecars: {
          summary: {
            en: 'Original complete backings matched to protected length/digest descriptors.',
            zh: '与保护长度及散列描述匹配的原完整缓冲区。'
          },
          default: {
            en: 'No native sidecars for inline storage.',
            zh: '内联存储不提供原生附带列表。'
          },
          example:
            "import { restoreRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcBinaryRestoreOptions } from '@migaia/rpc-host/sdk'\nexport function binary(value: unknown, options: IRpcBinaryRestoreOptions) {\n  const { storage, limit, digest, encoding, beforeDigest, errorMetadata, sidecars } =\n    options\n  return restoreRpcBinary(value, {\n    storage,\n    limit,\n    digest,\n    encoding,\n    beforeDigest,\n    errorMetadata,\n    sidecars,\n  })\n}\n",
          whenToUse: {
            en: 'Lend the exact storage mode, original delivery sidecars and pre-hash capabilities from this operation owner.',
            zh: '借用本操作所有者的精确存储模式、原交付附带列表及散列前能力，不重走应用图或混用其他帧缓冲区。'
          }
        }
      }
    },
    IRpcBinaryDigest: {
      summary: {
        en: 'Actual async whole-ArrayBuffer SHA-256 capability captured from native crypto; integrity is distinct from peer authentication.',
        zh: '从原生加密能力捕获的异步完整缓冲区散列能力；完整性与对端认证不同。'
      },
      members: {}
    },
    IRpcBinaryEncoding: {
      summary: {
        en: 'Explicit native inline/capture hooks at the sole pre-hash snapshot boundary.',
        zh: '唯一散列前快照边界上的显式原生内联编码及捕获介入。'
      },
      members: {
        encodeInline: {
          summary: {
            en: 'Receives each original byte view once and returns canonical unpadded base64url.',
            zh: '每个原字节视图只接收一次，返回规范无填充字节文本。'
          },
          default: {
            en: 'Canonical native-neutral encoder.',
            zh: '规范原生中立编码器。'
          }
        },
        capture: {
          summary: {
            en: 'Consume the already captured manifest and business-root slot map without another payload walk.',
            zh: '消费已捕获清单及业务根槽映射，不另遍历载荷。'
          },
          params: {
            manifest: {
              en: 'Actual protected manifest from the single walker.',
              zh: '唯一遍历器产生的实际保护清单。'
            },
            roots: {
              en: 'Original object identities mapped to captured binary slots.',
              zh: '映射到已捕获二进制槽的原对象身份。'
            }
          },
          returns: {
            en: 'Synchronous completion before any digest Promise.',
            zh: '在任何散列 Promise 之前同步完成。'
          },
          example:
            "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}\n"
        }
      }
    },
    IRpcMemberSource: {
      summary: {
        en: 'Actual native carrier acquisition and trusted facts for one generation; native retirement is not inferred from a wire code.',
        zh: '一次代际的实际原生载体获取及可信事实；不从线上错误码推断原生退场。'
      },
      members: {
        carrier: {
          summary: {
            en: 'The actual acquired carrier; no Peer/request facade is stored here.',
            zh: '实际获取的载体，此处不保存对端请求门面。'
          }
        },
        localSourceFacts: {
          summary: {
            en: 'Trusted native self/parent/generation facts; incoming business metadata cannot provide these facts.',
            zh: '可信原生自身、父端及代际事实，入站业务元数据不能提供这些事实。'
          }
        },
        onRetire: {
          summary: {
            en: 'Subscribe to original native physical retirement reason; return the exact remover.',
            zh: '订阅原生原物理退场原因，返回精确移除器。'
          },
          default: {
            en: 'Carrier close supplies retirement.',
            zh: '由载体关闭提供退场。'
          },
          params: {
            listener: {
              en: 'Receives the original physical retirement reason from this acquired source.',
              zh: '接收本获取来源提供的原物理退场原因。'
            }
          },
          returns: {
            en: 'The exact original listener remover, released when its candidate/registration no longer owns it.',
            zh: '精确原监听移除器，候选或登记不再拥有它时释放。'
          }
        }
      }
    },
    IRpcMemberBinding: {
      summary: {
        en: 'Original native supervisor, ownership, scheduler and raw acquisition; SDK reuses their authority and never recreates supervision.',
        zh: '原生原监管器、所有权、调度器及原始获取，共享工具复用其权限而不重建监管。'
      },
      members: {
        ownership: {
          summary: {
            en: 'Native source ownership decides who may release the acquired execution unit.',
            zh: '原生来源所有权决定谁能释放已获取执行单元。'
          },
          values: {
            owned: {
              en: 'The registration owns native disposal.',
              zh: '登记拥有原生释放。'
            },
            borrowed: {
              en: 'The external owner retains native disposal.',
              zh: '外部所有者保留原生释放。'
            }
          }
        },
        supervisor: {
          summary: {
            en: 'The actual existing supervisor for this native source.',
            zh: '本原生来源实际现有监管器。'
          }
        },
        scheduler: {
          summary: {
            en: 'Original native scheduler for generation ordering and monotonic events.',
            zh: '用于代际排序及单调事件的原生原调度器。'
          }
        },
        openCarrier: {
          summary: {
            en: 'Receives the actual unit, scoped signal and accepted ordinal, returning its real carrier/facts. Only accepted Sessions advance the ordinal.',
            zh: '接收实际单元、作用域信号及接纳序号，返回真实载体及事实；只有接纳会话才推进序号。'
          },
          params: {
            unit: {
              en: 'The exact unit returned by this binding supervisor, never a second launcher or synthetic member.',
              zh: '本绑定监管器返回的精确单元，不能替换为第二启动器或合成成员。'
            },
            signal: {
              en: 'The original candidate-preparation cancellation signal lent by the generation owner.',
              zh: '代际所有者借出的原候选准备取消信号。'
            },
            acceptedOrdinal: {
              en: 'The generation owner supplies the next accepted ordinal; failed preparations must not commit it.',
              zh: '代际所有者提供下一个接纳序号，失败准备不得提交该序号。'
            }
          },
          returns: {
            en: 'The actual acquired carrier, trusted local source facts and original retirement subscription.',
            zh: '返回实际获取载体、可信本地来源事实及原退场订阅能力。'
          }
        }
      }
    },
    IRpcMemberGenerationOptions: {
      summary: {
        en: 'Explicit existing native owners and callbacks for one shared member-generation algorithm.',
        zh: '唯一共享成员代际算法所用的显式原生现有所有者及回调。'
      },
      members: {
        context: {
          summary: {
            en: 'Actual transport setup ports from native installation, borrowing the unique Session owner.',
            zh: '原生安装提供的真实传输设置端口，借用唯一会话所有者。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberGenerationOptions } from '@migaia/rpc-host/sdk'\nexport function registration<T, S>(options: IRpcMemberGenerationOptions<T, S>) {\n  const { context, binding, signal, report } = options\n  return new RpcMemberGeneration({ context, binding, signal, report })\n}\n",
          whenToUse: {
            en: 'Reuse one real supervisor binding and the owning transport attach/detach ports for this registration.',
            zh: '为本登记复用一个真实监管绑定及所属传输附加和摘除端口，不创建另一会话权限或原生监管器。'
          }
        },
        binding: {
          summary: {
            en: 'Original supervisor, scheduler, ownership and carrier acquisition for this exact native registration.',
            zh: '本精确原生登记的原监管器、调度器、所有权及载体获取。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberGenerationOptions } from '@migaia/rpc-host/sdk'\nexport function registration<T, S>(options: IRpcMemberGenerationOptions<T, S>) {\n  const { context, binding, signal, report } = options\n  return new RpcMemberGeneration({ context, binding, signal, report })\n}\n",
          whenToUse: {
            en: 'Reuse one real supervisor binding and the owning transport attach/detach ports for this registration.',
            zh: '为本登记复用一个真实监管绑定及所属传输附加和摘除端口，不创建另一会话权限或原生监管器。'
          }
        },
        signal: {
          summary: {
            en: 'Owning installation or operation cancellation signal; no new lifetime is inferred from wire fields.',
            zh: '所属安装或操作取消信号，不从线上字段推断新生命周期。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberGenerationOptions } from '@migaia/rpc-host/sdk'\nexport function registration<T, S>(options: IRpcMemberGenerationOptions<T, S>) {\n  const { context, binding, signal, report } = options\n  return new RpcMemberGeneration({ context, binding, signal, report })\n}\n",
          whenToUse: {
            en: 'Reuse one real supervisor binding and the owning transport attach/detach ports for this registration.',
            zh: '为本登记复用一个真实监管绑定及所属传输附加和摘除端口，不创建另一会话权限或原生监管器。'
          }
        },
        report: {
          summary: {
            en: 'Receives contained asynchronous native/cleanup failures without replacing the primary business result.',
            zh: '接收被隔离的原生及清理异步失败，不替换主要业务结果。'
          },
          params: {
            error: {
              en: 'The original failure delivered by this owner, retaining its source, code, native class and cause chain.',
              zh: '本所有者交付的原失败，保留来源、错误码、原生类型及原因链；该值来自实际失败回调。'
            }
          },
          returns: {
            en: 'No business result is replaced; diagnostics should finish without throwing.',
            zh: '不替换业务返回结果，诊断回调应完成上报并避免再次抛错。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberGenerationOptions } from '@migaia/rpc-host/sdk'\nexport function registration<T, S>(options: IRpcMemberGenerationOptions<T, S>) {\n  const { context, binding, signal, report } = options\n  return new RpcMemberGeneration({ context, binding, signal, report })\n}\n",
          whenToUse: {
            en: 'Reuse one real supervisor binding and the owning transport attach/detach ports for this registration.',
            zh: '为本登记复用一个真实监管绑定及所属传输附加和摘除端口，不创建另一会话权限或原生监管器。'
          }
        },
        beforeRelease: {
          summary: {
            en: 'Joins the existing native drain before accepted Session detach.',
            zh: '在接纳会话摘除前等待原生现有排空。'
          },
          default: {
            en: 'No extra release work.',
            zh: '无额外释放工作。'
          },
          params: {},
          returns: {
            en: 'Join the native drain before Session detach; rejection remains a cleanup failure with its original identity.',
            zh: '在会话摘除之前等待原生排空，拒绝时保留原错误身份作为清理失败。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberGenerationOptions } from '@migaia/rpc-host/sdk'\nexport function observed<T, S>(options: IRpcMemberGenerationOptions<T, S>) {\n  const { beforeRelease, onReady, onNative } = options\n  return new RpcMemberGeneration({ ...options, beforeRelease, onReady, onNative })\n}\n",
          whenToUse: {
            en: 'Forward already-owned drain, ready and native event callbacks rather than subscribe another native event stream.',
            zh: '转交原来已拥有的排空、就绪及原生事件回调，不另订阅原生事件流或模拟新就绪状态。'
          }
        },
        onReady: {
          summary: {
            en: 'Receives committed accepted view, generation, original unit and exact Session handle; do not start another readiness state.',
            zh: '接收已提交接纳视图、代际、原单元及精确会话句柄，不另启动就绪状态。'
          },
          default: {
            en: 'No readiness observer.',
            zh: '无就绪观察器。'
          },
          params: {
            session: {
              en: 'The actual accepted Session view after its native generation is committed.',
              zh: '原生代际提交后实际已接纳的会话视图。'
            },
            generation: {
              en: 'The committed execution ordinal supplied by the original supervisor/generation owner.',
              zh: '原监管器及代际所有者提供的已提交执行序号。'
            },
            unit: {
              en: 'The exact original native resource used by this accepted execution.',
              zh: '本次接纳执行使用的精确原生原资源。'
            },
            handle: {
              en: 'The exact accepted Session handle lent for native health/drain operations.',
              zh: '借给原生健康及排空操作的精确接纳会话句柄。'
            }
          },
          returns: {
            en: 'Synchronous observation only; it must not create another native readiness state machine.',
            zh: '仅同步观察，不应建立另一套原生就绪状态机或重复获取资源。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberGenerationOptions } from '@migaia/rpc-host/sdk'\nexport function observed<T, S>(options: IRpcMemberGenerationOptions<T, S>) {\n  const { beforeRelease, onReady, onNative } = options\n  return new RpcMemberGeneration({ ...options, beforeRelease, onReady, onNative })\n}\n",
          whenToUse: {
            en: 'Forward already-owned drain, ready and native event callbacks rather than subscribe another native event stream.',
            zh: '转交原来已拥有的排空、就绪及原生事件回调，不另订阅原生事件流或模拟新就绪状态。'
          }
        },
        onNative: {
          summary: {
            en: 'Receives the original supervisor event and safe current metadata without another native event subscription.',
            zh: '接收原监管事件及安全当前元数据，不另订阅原生事件。'
          },
          default: {
            en: 'No native event observer.',
            zh: '无原生事件观察器。'
          },
          params: {
            event: {
              en: 'The original supervisor event forwarded by the existing single native subscription.',
              zh: '由现有唯一原生订阅转交的原监管事件。'
            },
            current: {
              en: 'Safe current accepted metadata captured by the generation owner for that native event.',
              zh: '代际所有者为该原生事件捕获的安全当前接纳元数据。'
            }
          },
          returns: {
            en: 'No native control result; use the event for passive member publication without resubscribing.',
            zh: '不返回原生控制结果，使用该事件被动发布成员事实，不重新订阅。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberGenerationOptions } from '@migaia/rpc-host/sdk'\nexport function observed<T, S>(options: IRpcMemberGenerationOptions<T, S>) {\n  const { beforeRelease, onReady, onNative } = options\n  return new RpcMemberGeneration({ ...options, beforeRelease, onReady, onNative })\n}\n",
          whenToUse: {
            en: 'Forward already-owned drain, ready and native event callbacks rather than subscribe another native event stream.',
            zh: '转交原来已拥有的排空、就绪及原生事件回调，不另订阅原生事件流或模拟新就绪状态。'
          }
        }
      }
    },
    IRpcMemberCurrent: {
      summary: {
        en: 'Safe current accepted member metadata, separate from mutable Session and native unit handles.',
        zh: '安全当前接纳成员元数据，与可变会话及原生单元句柄分开。'
      },
      members: {
        generation: {
          summary: {
            en: 'Original native execution ordinal or accepted generation tuple, according to the declaring type; never a fabricated retry counter.',
            zh: '按声明类型取原生执行序号或接纳代际元组，不是伪造重试计数。'
          }
        },
        active: {
          summary: {
            en: 'True only while the original native owner has an accepted current Session.',
            zh: '只有原生所有者拥有当前接纳会话时才为真。'
          }
        },
        session: {
          summary: {
            en: 'Safe current accepted Session view; absence remains explicit after departure.',
            zh: '安全的当前接纳会话视图，离开后明确缺省。'
          }
        }
      }
    },
    IRpcNativePoolMember: {
      summary: {
        en: 'One repeatably acquired actual native resource; private physical Session remains outside public direct-peer indexes.',
        zh: '一个可重复获取的实际原生资源，私有物理会话不进入公开直接对端索引。'
      },
      members: {
        record: {
          summary: {
            en: 'Exact original native registration, including accepted stable name and safe local query capabilities.',
            zh: '精确原生原登记，包含已接纳稳定名称及安全本地查询能力。'
          }
        },
        native: {
          summary: {
            en: 'Original native generation authority borrowed by this member.',
            zh: '本成员借用的原生原代际权限。'
          }
        },
        current: {
          summary: {
            en: 'Returns only the original currently accepted private Session, never a selected successor from another pool slot.',
            zh: '只返回原当前接纳私有会话，不选择另一个池槽的后继。'
          },
          params: {},
          returns: {
            en: 'The original private accepted Session or undefined after this member departs.',
            zh: '本成员原私有接纳会话，成员离开后为空。'
          }
        },
        ready: {
          summary: {
            en: 'Joins the original native rebind readiness and observes the supplied cancellation signal.',
            zh: '等待原生原重新绑定就绪并观察传入取消信号。'
          },
          params: {
            signal: {
              en: 'Cancellation for this readiness wait, taken from the caller installation or operation.',
              zh: '来自调用方安装或操作的本次就绪等待取消信号。'
            }
          },
          returns: {
            en: 'The original rebind Promise projected to an actual private Session; abort releases the waiting subscription.',
            zh: '将原重新绑定承诺投影到实际私有会话，取消时释放等待订阅。'
          }
        },
        close: {
          summary: {
            en: 'Original exact resource close callable; repeated closes share its owned completion.',
            zh: '原精确资源关闭方法，重复关闭共享其拥有的完成。'
          },
          params: {},
          returns: {
            en: 'The original native registration close completion; no duplicate resource owner is added.',
            zh: '原生原登记关闭完成，不增加重复资源所有者。'
          }
        }
      }
    },
    IRpcNativePoolEvents: {
      summary: {
        en: 'Original native callbacks publish to the sole passive Pool members receiver; no second supervisor subscription exists.',
        zh: '原生原回调向唯一被动池成员接收者发布，不存在第二监管订阅。'
      },
      members: {
        changed: {
          summary: {
            en: 'Notify actual native-directory change at its original owner transition.',
            zh: '在原所有者转换点通知实际原生目录变化。'
          },
          params: {},
          returns: {
            en: 'Refresh the existing pool projection after one actual native transition; no new connection is created.',
            zh: '在一次真实原生变化之后刷新现有池投影，不创建新连接。'
          }
        },
        ready: {
          summary: {
            en: 'Publish actual record, accepted view and committed generation.',
            zh: '发布实际记录、接纳视图及已提交代际。'
          },
          params: {
            record: {
              en: 'The exact native registration whose generation just became accepted.',
              zh: '刚完成代际接纳的精确原生登记。'
            },
            view: {
              en: 'The committed accepted Session view supplied by the generation callback.',
              zh: '由代际回调提供的已提交接纳会话视图。'
            },
            generation: {
              en: 'The original execution ordinal for this ready native resource.',
              zh: '此就绪原生资源的原执行序号。'
            }
          },
          returns: {
            en: 'Publish one real readiness observation through the existing members owner.',
            zh: '通过现有成员所有者发布一次真实就绪观察，不建立第二就绪状态。'
          }
        },
        native: {
          summary: {
            en: 'Publish the original supervisor event and safe current record facts.',
            zh: '发布原监管事件及安全当前记录事实。'
          },
          params: {
            record: {
              en: 'The exact original native registration that owns this event.',
              zh: '拥有本事件的精确原生原登记。'
            },
            event: {
              en: 'The original supervisor event from the native source single subscription.',
              zh: '来自原生来源唯一订阅的原监管事件。'
            },
            current: {
              en: 'Safe current native generation/Session metadata, if available.',
              zh: '存在时的安全当前原生代际及会话元数据。'
            }
          },
          returns: {
            en: 'Forward the fact to passive members publication without native acquisition or control.',
            zh: '将事实转交被动成员发布，不获取或控制原生资源。'
          }
        }
      }
    },
    IRpcNativeFeatureContext: {
      summary: {
        en: 'Real transport setup plus native kind and an optional repeatable actual member opener. Parent/listener sources cannot pretend to open members.',
        zh: '真实传输设置、原生种类及可选可重复实际成员获取端口；父端及监听来源不能伪称可以获取成员。'
      },
      members: {
        memberKind: {
          summary: {
            en: 'Actual source/native feature discriminator, selected by its canonical owner rather than a payload guess.',
            zh: '由规范所有者选择的真实来源或原生功能判别值，不按载荷猜测。'
          },
          values: {
            enum: 'RpcNativeMemberKind'
          }
        },
        openMember: {
          summary: {
            en: 'Repeat the concrete native source constructor and lend original generation/record/close ownership.',
            zh: '重复具体原生来源构造，并借出原代际、记录及关闭所有权。'
          },
          default: {
            en: 'Not supported by non-repeatable sources.',
            zh: '不可重复来源不提供此能力。'
          },
          params: {
            context: {
              en: 'The real private-member transport context lent by the owning native installation.',
              zh: '所属原生安装借出的真实私有成员传输上下文。'
            },
            events: {
              en: 'The pool-owned callbacks that consume existing native ready/change/event facts.',
              zh: '池所有者提供的回调，消费现有原生就绪、变化及事件事实。'
            }
          },
          returns: {
            en: 'One actual repeated native acquisition with its original generation and private accepted Session; parent/listener sources omit this capability.',
            zh: '返回一个真实重复原生获取及其原代际和私有接纳会话；父端及监听来源不提供此能力。'
          }
        }
      }
    },
    IRpcNativeTransportFeature: {
      summary: {
        en: 'Complete native pool implementation installed by its concrete transport; Host does not execute its resource scheduler.',
        zh: '由具体传输安装的完整原生池实现，宿主不执行其资源调度器。'
      },
      members: {
        kind: {
          summary: {
            en: 'Actual source/native feature discriminator, selected by its canonical owner rather than a payload guess.',
            zh: '由规范所有者选择的真实来源或原生功能判别值，不按载荷猜测。'
          },
          values: {
            enum: 'RpcNativeFeatureKind'
          }
        },
        install: {
          summary: {
            en: 'Acquire actual same-medium members through the supplied context and return value plus exact disposal.',
            zh: '通过提供的上下文获取同媒介实际成员，返回值及精确释放。'
          },
          params: {
            context: {
              en: 'The actual owning native installation context, including repeated acquisition only when supported.',
              zh: '真实所属原生安装上下文，仅在支持时提供重复获取能力。'
            }
          },
          returns: {
            en: 'A local namespace extension and its exact disposer; native Sessions remain private to their member owner.',
            zh: '本地命名空间扩展及其精确释放器，原生会话仍由各成员私有拥有。'
          }
        }
      }
    },
    IRpcStreamFrameDecoderOptions: {
      summary: {
        en: 'Original complete-payload and first-error callbacks for one held physical length decoder.',
        zh: '一个所持物理长度解码器使用的原完整载荷及首错回调。'
      },
      members: {
        errorMetadata: {
          summary: {
            en: 'Caller-owned presentation maps used only for actual decoder errors.',
            zh: '仅用于实际解码器错误的调用方展示映射。'
          },
          default: {
            en: 'No extra maps.',
            zh: '无额外映射。'
          },
          example:
            "import { createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\nimport type { IRpcErrorWireMetadata } from '@migaia/rpc-contract/errors'\nexport function framed(\n  accept: (frame: Uint8Array) => void,\n  errorMetadata: IRpcErrorWireMetadata,\n) {\n  return createRpcStreamFrameDecoder({\n    errorMetadata,\n    onFrame: (frame) => accept(frame),\n    onError: (error) => console.error(error),\n  })\n}\n",
          whenToUse: {
            en: 'Deliver complete frames into the existing native handoff and report only actual framing failures.',
            zh: '向现有原生交接路径交付完整帧，仅上报实际分帧失败，不另建解码器或补造启动确认。'
          }
        },
        onFrame: {
          summary: {
            en: 'Receives one owned complete payload synchronously; may close/finish the decoder to leave current chunk tail unconsumed.',
            zh: '同步接收一个所拥有的完整载荷，可关闭或结束解码器以保留当前块未消费尾部。'
          },
          params: {
            frame: {
              en: 'The owned complete payload bytes copied from one accepted length-prefixed frame.',
              zh: '从一个已接纳长度前缀帧复制出的所拥有完整载荷字节。'
            }
          },
          returns: {
            en: 'Synchronous delivery; closing the decoder leaves the current chunk tail unconsumed for native handoff.',
            zh: '同步交付；关闭解码器会将当前块尾部留给原生交接，不继续消费。'
          },
          example:
            "import { createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\nimport type { IRpcErrorWireMetadata } from '@migaia/rpc-contract/errors'\nexport function framed(\n  accept: (frame: Uint8Array) => void,\n  errorMetadata: IRpcErrorWireMetadata,\n) {\n  return createRpcStreamFrameDecoder({\n    errorMetadata,\n    onFrame: (frame) => accept(frame),\n    onError: (error) => console.error(error),\n  })\n}\n",
          whenToUse: {
            en: 'Deliver complete frames into the existing native handoff and report only actual framing failures.',
            zh: '向现有原生交接路径交付完整帧，仅上报实际分帧失败，不另建解码器或补造启动确认。'
          }
        },
        onError: {
          summary: {
            en: 'Receives first malformed length, size violation or truncated tail; subsequent framing errors are suppressed.',
            zh: '接收首个非法长度、大小违例或截断尾部，后续分帧错误不再重复发出。'
          },
          params: {
            error: {
              en: 'The first actual malformed length, frame-budget violation or truncated-end error.',
              zh: '第一个真实非法长度、帧预算违例或尾部截断错误。'
            }
          },
          returns: {
            en: 'Observe the framing failure; the decoder suppresses later framing failures rather than replaying bytes.',
            zh: '观察分帧失败，解码器抑制后续分帧错误，不重新交付字节。'
          },
          example:
            "import { createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\nimport type { IRpcErrorWireMetadata } from '@migaia/rpc-contract/errors'\nexport function framed(\n  accept: (frame: Uint8Array) => void,\n  errorMetadata: IRpcErrorWireMetadata,\n) {\n  return createRpcStreamFrameDecoder({\n    errorMetadata,\n    onFrame: (frame) => accept(frame),\n    onError: (error) => console.error(error),\n  })\n}\n",
          whenToUse: {
            en: 'Deliver complete frames into the existing native handoff and report only actual framing failures.',
            zh: '向现有原生交接路径交付完整帧，仅上报实际分帧失败，不另建解码器或补造启动确认。'
          }
        }
      }
    },
    IRpcStreamFrameDecoder: {
      summary: {
        en: 'One actual held decoder, not another business protocol or IO owner.',
        zh: '一个实际所持解码器，不是另一个业务协议或读写所有者。'
      },
      members: {
        push: {
          summary: {
            en: 'Consume actual incoming bytes until a complete payload callback closes this decoder.',
            zh: '消费实际入站字节，直至完整载荷回调关闭本解码器。'
          },
          params: {
            chunk: {
              en: 'Original ordered native byte chunk.',
              zh: '原有序原生字节块。'
            }
          },
          returns: {
            en: 'Consumed offset; the caller retains any unconsumed same-chunk tail.',
            zh: '已消费偏移，调用方保留同块未消费尾部。'
          },
          example:
            "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()\n"
        },
        finish: {
          summary: {
            en: 'End input and report any incomplete final payload once.',
            zh: '结束输入并只报告一次不完整尾部载荷。'
          },
          params: {},
          returns: {
            en: 'Decoder is terminal; physical IO ownership is unchanged.',
            zh: '解码器进入终止状态，物理读写所有权不变。'
          },
          example:
            "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()\n"
        },
        close: {
          summary: {
            en: 'Drop incomplete framing without emitting another error.',
            zh: '丢弃不完整分帧，不再发出错误。'
          },
          params: {},
          returns: {
            en: 'Decoder becomes terminal idempotently.',
            zh: '幂等进入终止状态。'
          },
          example:
            "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()\n"
        }
      },
      scenarios: [
        {
          en: 'Decode fragmented native chunks once and hand back any untouched tail after synchronous close.',
          zh: '对分段原生块解码一次，同步关闭后将未消费尾部交回原生所有者，不重放字节。'
        }
      ],
      example:
        "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()\n"
    },
    IRpcTransportPlugin: {
      summary: {
        en: 'Exact genuine native definition returned by defineTransportPlugin; its identity participates in the one native installation transaction.',
        zh: '由原生传输定义工厂返回的精确真实定义，其身份参与唯一原生安装事务。'
      },
      members: {},
      example:
        "import { defineTransportPlugin, createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\n\nexport function transport(io: IRpcMessageIO, id: string) {\n  return defineTransportPlugin({\n    name: 'application-channel',\n    namespace: 'channel',\n    async open(context) {\n      const carrier = createRpcMessageCarrier({ id, io, report: context.report })\n      const handle = context.attach(carrier)\n      await handle.ready\n      return { dispose: () => handle.close() }\n    },\n  })\n}\n"
    },
    IRpcFlowPlugin: {
      summary: {
        en: 'Genuine cold flow definition sharing native installation/rollback, with optional namespace extension inference.',
        zh: '共享原生安装及回滚的真实冷信息流定义，可推导可选命名空间扩展。'
      },
      members: {},
      example:
        "import { defineFlowPlugin } from '@migaia/rpc-host/sdk'\n\nexport const trace = defineFlowPlugin({\n  name: 'application-trace',\n  setup() {\n    return { hooks: { observe: (event) => console.log(event) } }\n  },\n})\n"
    },
    IRpcNamespacePlugin: {
      summary: {
        en: 'Erased static namespace/extension correlation on a genuine native definition. The private declaration marker creates no runtime property or authority.',
        zh: '真实原生定义上的擦除命名空间及扩展类型关联；私有声明标记不创建运行时属性或权限。'
      },
      members: {}
    },
    IRpcHostPlugin: {
      summary: {
        en: 'Union of genuine transport and flow definitions admitted by createRpcHost. User-written discriminator objects cannot gain registration authority.',
        zh: '创建宿主接纳的真实传输及信息流定义联合；用户自写判别对象不能取得登记权限。'
      },
      members: {}
    },
    IRpcTransportSetupContext: {
      summary: {
        en: 'Actual Contract transport ports plus the original native plugin-host core. Native diagnostics can borrow configuredReport without creating another reporter registry.',
        zh: '实际契约传输端口及原插件宿主核心；原生诊断可借用已配置上报器，不创建另一份上报登记表。'
      },
      members: {
        owner: {
          summary: {
            en: 'Exact receiving plugin-host core for native dependency/lifecycle integration.',
            zh: '用于原生依赖及生命周期接合的精确接收插件宿主核心。'
          }
        },
        configuredReport: {
          summary: {
            en: 'Original explicitly configured reporter, absent when Host uses only its default diagnostic.',
            zh: '显式配置的原上报器；宿主仅使用默认诊断时缺省。'
          }
        }
      }
    },
    IRpcFlowSetupContext: {
      summary: {
        en: 'Per-install cancellation, actual identity/reporting and narrow invocation/retirement ports, without mutable Host work tables.',
        zh: '逐次安装取消、实际身份及上报，以及窄调用和退场端口，不提供可变宿主工作表。'
      },
      members: {
        signal: {
          summary: {
            en: 'Installation lifetime cancellation.',
            zh: '所属原生信息流安装的真实生命周期取消信号。'
          }
        },
        report: {
          summary: {
            en: 'Original Host diagnostic destination.',
            zh: '所属原生信息流安装提供的原始诊断上报通道。'
          },
          params: {
            error: {
              en: 'The original failure delivered by this owner, retaining its source, code, native class and cause chain.',
              zh: '本所有者交付的原失败，保留来源、错误码、原生类型及原因链；该值来自实际失败回调。'
            }
          },
          returns: {
            en: 'No business result is replaced; diagnostics should finish without throwing.',
            zh: '不替换业务返回结果，诊断回调应完成上报并避免再次抛错。'
          }
        },
        self: {
          summary: {
            en: 'Optional current global admitted Host identity getter.',
            zh: '可选当前全局接纳宿主身份读取器。'
          },
          params: {},
          returns: {
            en: 'The current authoritative global Host identity, including trusted native bootstrap adoption when applicable.',
            zh: '当前权威全局宿主身份，适用时包含可信原生启动身份接纳结果。'
          }
        },
        observe: {
          summary: {
            en: 'Publish readonly facts to the existing actual observer boundary.',
            zh: '向现有实际观察边界发布只读事实。'
          },
          params: {
            event: {
              en: 'The actual safe observation passed by this flow; it is diagnostic data rather than admission authority.',
              zh: '本信息流传入的真实安全观察数据，仅用于诊断，不产生准入权限。'
            }
          },
          returns: {
            en: 'Publishes to the existing Host observation path; it does not perform a business call.',
            zh: '发布到现有宿主观察路径，不执行业务调用或建立另一个事件总线。'
          }
        },
        call: {
          summary: {
            en: 'Originate an ordinary Host command in an installed namespace.',
            zh: '在已安装命名空间发起正常宿主命令。'
          },
          params: {
            namespace: {
              en: 'Actual installed namespace name.',
              zh: '实际已安装命名空间名。'
            },
            command: {
              en: 'Normal method/call-mode/payload command owned by the extension.',
              zh: '扩展拥有的正常方法、调用形式及载荷命令。'
            },
            options: {
              en: 'Complete call features and original cancellation.',
              zh: '完整调用功能及原取消。'
            }
          },
          returns: {
            en: 'Actual business completion, using the canonical call/stream owners.',
            zh: '使用规范调用及流所有者得到的实际业务完成。'
          },
          example:
            "import { defineFlowPlugin } from '@migaia/rpc-host/sdk'\n\nexport const trace = defineFlowPlugin({\n  name: 'application-trace',\n  setup() {\n    return { hooks: { observe: (event) => console.log(event) } }\n  },\n})\n"
        },
        retire: {
          summary: {
            en: 'Retire one exact observed carrier through the real Session owner.',
            zh: '通过真实会话所有者使一个精确已观察载体退场。'
          },
          params: {
            carrierId: {
              en: 'Use the carrierId returned by this accepted flow context; it identifies that actual Session.',
              zh: '使用本已接纳信息流上下文返回的载体标识，指定该真实会话。'
            },
            reason: {
              en: 'Original policy retirement reason.',
              zh: '原策略退场原因。'
            }
          },
          returns: {
            en: 'Original Session cleanup completion.',
            zh: '原会话清理完成。'
          },
          example:
            "import { defineFlowPlugin } from '@migaia/rpc-host/sdk'\n\nexport const trace = defineFlowPlugin({\n  name: 'application-trace',\n  setup() {\n    return { hooks: { observe: (event) => console.log(event) } }\n  },\n})\n"
        }
      }
    },
    IRpcFlowDefinition: {
      summary: {
        en: 'Cold name/scope/setup captured once; each native installation calls setup for its own hooks and disposal.',
        zh: '只捕获一次的冷名称、作用域及设置，每个原生安装调用设置以获得自身介入点及释放。'
      },
      members: {
        name: {
          summary: {
            en: 'Unique native plugin name, used by actual dependency and installation order.',
            zh: '唯一原生插件名，用于实际依赖及安装次序。'
          }
        },
        namespaces: {
          summary: {
            en: 'Optional exact existing namespace scope.',
            zh: '可选精确现有命名空间作用域。'
          }
        },
        setup: {
          summary: {
            en: 'Construct one installation-local complete hook set.',
            zh: '构造一个安装局部完整介入点集合。'
          },
          params: {
            context: {
              en: 'Actual IRpcFlowSetupContext from the receiving Host.',
              zh: '接收宿主提供的实际设置上下文。'
            }
          },
          returns: {
            en: 'Hooks/extensions and exact dispose, synchronously or as a Promise.',
            zh: '同步或异步返回介入点、扩展及精确释放。'
          },
          example:
            "import { defineFlowPlugin } from '@migaia/rpc-host/sdk'\n\nexport const trace = defineFlowPlugin({\n  name: 'application-trace',\n  setup() {\n    return { hooks: { observe: (event) => console.log(event) } }\n  },\n})\n"
        }
      }
    },
    IRpcFlowInstallation: {
      summary: {
        en: 'One native setup result owns its own hooks, required extensions, namespace extensions and disposal.',
        zh: '一次原生设置结果拥有其介入点、所需扩展、命名空间扩展及释放。'
      },
      members: {
        dispose: {
          summary: {
            en: 'Exact installed resource cleanup, also used for native rollback.',
            zh: '精确已安装资源清理，也用于原生回滚。'
          }
        },
        namespaceExtensions: {
          summary: {
            en: 'Return an own-data surface for this exact namespace; reserved Host call names cannot be overwritten.',
            zh: '为本精确命名空间返回自有数据表面，不能覆盖宿主保留调用名。'
          },
          params: {
            namespace: {
              en: 'The installed namespace name selected by the native Host during cold assembly.',
              zh: '原生宿主在冷装配期间选定的已安装命名空间名称。'
            }
          },
          returns: {
            en: 'Local extension values for that namespace only; built-in call members cannot be replaced.',
            zh: '只返回该命名空间的本地扩展值，不能替换内建调用成员。'
          }
        }
      }
    },
    IRpcLinkPolicyDefinition: {
      summary: {
        en: 'Cold native policy name and complete timeout/retry instances; no hooks or strategy state live in Host configuration.',
        zh: '冷原生策略名及完整超时和重试实例；宿主配置不保存介入点或策略状态。'
      },
      members: {
        name: {
          summary: {
            en: 'Unique genuine native policy name.',
            zh: '冷策略定义使用的稳定安装名称，不用于授权。'
          }
        },
        features: {
          summary: {
            en: 'Complete feature objects; duplicate kinds reject before startup.',
            zh: '完整功能对象，同种重复项在启动前拒绝。'
          }
        }
      }
    },
    RpcBytePump: {
      summary: {
        en: 'One original native reader/writer pair, whose stable value owns ordered byte delivery and shared close completion.',
        zh: '一组原原生读写端口，其稳定值拥有有序字节交付及共享关闭完成。'
      },
      members: {
        value: {
          summary: {
            en: 'Exact original acquired byte resource; detached methods retain the same native lifetime.',
            zh: '精确原获取字节资源；摘出的方法仍保留同一原生生命周期。'
          }
        }
      },
      example:
        "import { RpcBytePump } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcBytePumpOptions,\n  IRpcByteReader,\n  IRpcByteWriter,\n} from '@migaia/rpc-host/sdk'\nexport function acquired(\n  reader: IRpcByteReader,\n  writer: IRpcByteWriter,\n  closePhysical: () => void | Promise<void>,\n  options: IRpcBytePumpOptions,\n) {\n  const { closedError, report, observation, cleanupFailed } = options\n  return new RpcBytePump(reader, writer, closePhysical, {\n    closedError,\n    report,\n    observation,\n    cleanupFailed,\n  }).value\n}\n",
      scenarios: [
        {
          en: 'Borrow acquired reader/writer locks and preserve their original terminal cleanup.',
          zh: '借用已获取读写锁，并保留其原终止清理顺序，不重复获取资源或建立监管器。'
        }
      ]
    },
    RpcEventByteIO: {
      summary: {
        en: 'One native emitter pair retains pause/resume, actual write callback settlement, drain and terminal replay.',
        zh: '一组原生事件端口保留暂停恢复、实际写入回调结算、排空及终止重放。'
      },
      members: {
        value: {
          summary: {
            en: 'Exact original acquired byte resource; detached methods retain the same native lifetime.',
            zh: '精确原获取字节资源；摘出的方法仍保留同一原生生命周期。'
          }
        }
      },
      example:
        "import { RpcEventByteIO } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcEventByteIOOptions,\n  IRpcEventByteReader,\n  IRpcEventByteWriter,\n} from '@migaia/rpc-host/sdk'\nexport function acquired(\n  reader: IRpcEventByteReader,\n  writer: IRpcEventByteWriter,\n  closePhysical: () => void,\n  options: IRpcEventByteIOOptions,\n) {\n  const { closedError, report, observation } = options\n  return new RpcEventByteIO(reader, writer, closePhysical, {\n    closedError,\n    report,\n    observation,\n  }).value\n}\n",
      scenarios: [
        {
          en: 'Pause the acquired event stream before subscribing and preserve native write/drain/close order.',
          zh: '订阅前暂停已获取事件流，保留原生写入、排空及关闭顺序，不重建消息协议。'
        }
      ]
    },
    RpcPortableCapture: {
      summary: {
        en: 'One codec-held executing portable walker, separate from pure Contract rules and native acquisition.',
        zh: '一个编解码器持有的执行可移植遍历器，与纯契约规则及原生获取分开。'
      },
      members: {
        normalize: {
          summary: {
            en: 'Snapshot in original own-key order while retaining genuine native backing/view identities.',
            zh: '按原自有键顺序捕获快照，同时保留真实原生缓冲区及视图身份。'
          },
          params: {
            value: {
              en: 'Original application graph at the actual capture boundary.',
              zh: '实际捕获边界的原应用图。'
            }
          },
          returns: {
            en: 'Owned portable snapshot; unsupported data produces the canonical payload error.',
            zh: '所拥有的可移植快照；不支持数据产生规范载荷错误。'
          }
        }
      },
      scenarios: [
        {
          en: 'Capture once before hashing or suspension, retaining key order and original backing identities.',
          zh: '在散列或挂起前捕获一次，保留键顺序及原缓冲区身份，不重复投影业务图。'
        }
      ],
      example:
        "import { RpcPortableCapture } from '@migaia/rpc-host/sdk'\nconst capture = new RpcPortableCapture()\nexport const value = capture.normalize({ bytes: new Uint8Array([1, 2, 3]) })\n"
    },
    RpcUtf8: {
      summary: {
        en: 'Held encoder and fatal decoder with no IO or length-framing ownership.',
        zh: '持有编码器及严格解码器，不拥有读写或长度分帧。'
      },
      members: {
        encoder: {
          summary: {
            en: 'Original captured native UTF-8 encoder, shared by the drained frame path.',
            zh: '原捕获字符编码器，由已排空帧路径共享。'
          }
        },
        decode: {
          summary: {
            en: 'Decode actual UTF-8 once and preserve native failure on HANDSHAKE_INVALID cause.',
            zh: '仅解码实际字符字节一次，并在握手非法原因中保留原生失败。'
          },
          params: {
            value: {
              en: 'Original received byte view.',
              zh: '原接收字节视图。'
            },
            metadata: {
              en: 'Optional operation-owned local error metadata.',
              zh: '可选操作所拥有的本地错误元数据。'
            }
          },
          returns: {
            en: 'Decoded string or the canonical handshake error with exact native cause.',
            zh: '解码字符串，或带精确原生原因的规范握手错误。'
          },
          example:
            "import { RpcUtf8 } from '@migaia/rpc-host/sdk'\nconst utf8 = new RpcUtf8({\n  encoder: new TextEncoder(),\n  decoder: new TextDecoder('utf-8', { fatal: true }),\n})\nconst bytes = utf8.encoder.encode('hello')\nconst target = new Uint8Array(16)\nutf8.encoder.encodeInto('hello', target)\nexport const text = utf8.decode(bytes)\n"
        }
      },
      scenarios: [
        {
          en: 'Retain original encoder/fatal decoder receivers and malformed-input native exceptions.',
          zh: '保留原编码器及严格解码器接收者，使非法输入保留原生异常而非静默替换字符。'
        }
      ],
      example:
        "import { RpcUtf8 } from '@migaia/rpc-host/sdk'\nconst utf8 = new RpcUtf8({\n  encoder: new TextEncoder(),\n  decoder: new TextDecoder('utf-8', { fatal: true }),\n})\nconst bytes = utf8.encoder.encode('hello')\nconst target = new Uint8Array(16)\nutf8.encoder.encodeInto('hello', target)\nexport const text = utf8.decode(bytes)\n"
    },
    RpcJsonCarrierCodec: {
      summary: {
        en: 'The one actual four-stage codec: capture before hooks/hash, parse once, admit once and restore genuine backings once.',
        zh: '唯一实际四阶段编解码器：介入及散列前捕获、一次解析、一次准入及一次真实缓冲区恢复。'
      },
      members: {
        prepare: {
          summary: {
            en: 'Capture semantic metadata and original binary alternatives before asynchronous hashing.',
            zh: '异步散列前捕获语义元数据及原二进制替代表示。'
          },
          params: {
            message: {
              en: 'Actual stage value produced by the preceding canonical stage.',
              zh: '前一规范阶段产生的实际阶段值。'
            },
            context: {
              en: 'Actual negotiated codec/budget/source/error-metadata context.',
              zh: '实际协商编解码、预算、来源及错误元数据上下文。'
            }
          },
          returns: {
            en: 'Prepared metadata and original backing sidecars.',
            zh: '准备元数据及原缓冲区附带列表。'
          },
          example:
            "import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'\nimport type { IRpcCodecContext } from '@migaia/rpc-host/sdk'\nimport type { IRpcSemanticFrame } from '@migaia/rpc-contract/interfaces'\nexport async function roundTrip(frame: IRpcSemanticFrame, context: IRpcCodecContext) {\n  const codec = new RpcJsonCarrierCodec()\n  const prepared = await codec.prepare(frame, context)\n  const wire = codec.encode(prepared, context)\n  const decoded = codec.decode(wire, context)\n  return codec.restore(decoded, context)\n}\n"
        },
        encode: {
          summary: {
            en: 'Encode the same prepared metadata after envelope hooks without another business projection or key sorting.',
            zh: '信封介入之后编码同一准备元数据，不再次投影业务或排序键。'
          },
          params: {
            value: {
              en: 'Actual stage value produced by the preceding canonical stage.',
              zh: '前一规范阶段产生的实际阶段值。'
            },
            _context: {
              en: 'Actual negotiated codec/budget/source/error-metadata context.',
              zh: '实际协商编解码、预算、来源及错误元数据上下文。'
            }
          },
          returns: {
            en: 'One physical carrier frame.',
            zh: '一个物理载体帧。'
          },
          example:
            "import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'\nimport type { IRpcCodecContext } from '@migaia/rpc-host/sdk'\nimport type { IRpcSemanticFrame } from '@migaia/rpc-contract/interfaces'\nexport async function roundTrip(frame: IRpcSemanticFrame, context: IRpcCodecContext) {\n  const codec = new RpcJsonCarrierCodec()\n  const prepared = await codec.prepare(frame, context)\n  const wire = codec.encode(prepared, context)\n  const decoded = codec.decode(wire, context)\n  return codec.restore(decoded, context)\n}\n"
        },
        decode: {
          summary: {
            en: 'Parse the original text exactly once; byte carriers already provide their once-parsed value.',
            zh: '原文本只解析一次；字节载体已经提供其只解析一次的值。'
          },
          params: {
            frame: {
              en: 'Actual stage value produced by the preceding canonical stage.',
              zh: '前一规范阶段产生的实际阶段值。'
            },
            context: {
              en: 'Actual negotiated codec/budget/source/error-metadata context.',
              zh: '实际协商编解码、预算、来源及错误元数据上下文。'
            }
          },
          returns: {
            en: 'Prepared inert data awaiting authentication and semantic restore.',
            zh: '等待认证及语义恢复的准备惰性数据。'
          },
          example:
            "import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'\nimport type { IRpcCodecContext } from '@migaia/rpc-host/sdk'\nimport type { IRpcSemanticFrame } from '@migaia/rpc-contract/interfaces'\nexport async function roundTrip(frame: IRpcSemanticFrame, context: IRpcCodecContext) {\n  const codec = new RpcJsonCarrierCodec()\n  const prepared = await codec.prepare(frame, context)\n  const wire = codec.encode(prepared, context)\n  const decoded = codec.decode(wire, context)\n  return codec.restore(decoded, context)\n}\n"
        },
        restore: {
          summary: {
            en: 'Admit prepared metadata and reconstruct real backings after envelope authentication.',
            zh: '信封认证之后接纳准备元数据并恢复实际缓冲区。'
          },
          params: {
            value: {
              en: 'Actual stage value produced by the preceding canonical stage.',
              zh: '前一规范阶段产生的实际阶段值。'
            },
            context: {
              en: 'Actual negotiated codec/budget/source/error-metadata context.',
              zh: '实际协商编解码、预算、来源及错误元数据上下文。'
            }
          },
          returns: {
            en: 'Canonical admitted semantic frame, or undefined for an actually rejected source.',
            zh: '规范接纳语义帧，或实际来源被拒绝时的空值。'
          },
          example:
            "import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'\nimport type { IRpcCodecContext } from '@migaia/rpc-host/sdk'\nimport type { IRpcSemanticFrame } from '@migaia/rpc-contract/interfaces'\nexport async function roundTrip(frame: IRpcSemanticFrame, context: IRpcCodecContext) {\n  const codec = new RpcJsonCarrierCodec()\n  const prepared = await codec.prepare(frame, context)\n  const wire = codec.encode(prepared, context)\n  const decoded = codec.decode(wire, context)\n  return codec.restore(decoded, context)\n}\n"
        }
      },
      scenarios: [
        {
          en: 'Execute one four-stage cycle with original capture and one privacy-safe text parse.',
          zh: '以原捕获及一次保护隐私的文本解析执行四阶段周期，不再次投影业务图。'
        }
      ],
      example:
        "import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'\nimport type { IRpcCodecContext } from '@migaia/rpc-host/sdk'\nimport type { IRpcSemanticFrame } from '@migaia/rpc-contract/interfaces'\nexport async function roundTrip(frame: IRpcSemanticFrame, context: IRpcCodecContext) {\n  const codec = new RpcJsonCarrierCodec()\n  const prepared = await codec.prepare(frame, context)\n  const wire = codec.encode(prepared, context)\n  const decoded = codec.decode(wire, context)\n  return codec.restore(decoded, context)\n}\n"
    },
    RpcCarrierObservation: {
      summary: {
        en: 'One exact native raw subscription and acquired immutable medium facts; it creates no extra listener, content queue or lifecycle owner.',
        zh: '唯一精确原生原始订阅及已获取不可变媒介事实，不创建额外监听、内容队列或生命周期所有者。'
      },
      members: {
        facts: {
          summary: {
            en: 'Actual acquired platform/topology/encoded-type metadata.',
            zh: '实际获取的平台、拓扑及编码类别元数据。'
          }
        },
        active: {
          summary: {
            en: 'Current subscriber presence read from the existing exact subscription record.',
            zh: '从现有精确订阅记录读取的当前订阅者存在状态。'
          }
        },
        subscribe: {
          summary: {
            en: 'Borrow one existing native observation stream without another native listener.',
            zh: '借用一个现有原生观察流，不另加原生监听。'
          },
          params: {
            listener: {
              en: 'Synchronous receiver for actual borrowed raw native content and size facts.',
              zh: '实际借用原始原生内容及大小事实的同步接收者。'
            }
          },
          returns: {
            en: 'Exact subscription remover; only this record is released.',
            zh: '精确订阅移除器，只释放本记录。'
          },
          example:
            "import {\n  RpcCarrierObservation,\n  RpcCarrierPlatform,\n  RpcProbeDirection,\n} from '@migaia/rpc-host/sdk'\nconst observer = new RpcCarrierObservation(\n  { platform: RpcCarrierPlatform.messagePort },\n  console.error,\n)\nconst remove = observer.subscribe((event) => console.log(event.content))\nexport function post(raw: unknown, nativePost: (value: unknown) => void) {\n  observer.emit(RpcProbeDirection.outbound, raw)\n  nativePost(raw)\n}\nexport function release() {\n  remove()\n}\n"
        },
        emit: {
          summary: {
            en: 'Publish actual borrowed raw IO only while subscribed; no copy, sizing or content read occurs otherwise.',
            zh: '仅在订阅时发布实际借用原始读写数据，否则不复制、不计大小、不读内容。'
          },
          params: {
            direction: {
              en: 'Actual canonical inbound/outbound ordinal.',
              zh: '实际规范入站及出站序号。'
            },
            content: {
              en: 'Original post/send/write argument or received raw event value.',
              zh: '原发送及写入实参或接收原始事件值。'
            },
            transfer: {
              en: 'Original actual native backing list, if present.',
              zh: '存在时的原实际原生缓冲区列表。'
            },
            detail: {
              en: 'Actual scalar facts from the owning native source/filter, never guessed counters.',
              zh: '原生来源及过滤所有者提供的真实标量事实，不是猜测计数。'
            }
          },
          returns: {
            en: 'Synchronous observer delivery with callback failure containment outside business settlement.',
            zh: '同步观察交付，回调失败在业务结算之外被隔离。'
          },
          example:
            "import {\n  RpcCarrierObservation,\n  RpcCarrierPlatform,\n  RpcProbeDirection,\n} from '@migaia/rpc-host/sdk'\nconst observer = new RpcCarrierObservation(\n  { platform: RpcCarrierPlatform.messagePort },\n  console.error,\n)\nconst remove = observer.subscribe((event) => console.log(event.content))\nexport function post(raw: unknown, nativePost: (value: unknown) => void) {\n  observer.emit(RpcProbeDirection.outbound, raw)\n  nativePost(raw)\n}\nexport function release() {\n  remove()\n}\n"
        }
      },
      scenarios: [
        {
          en: 'Borrow actual raw values at native read/post points only while subscribed.',
          zh: '仅在订阅期间于原生实际读写点借用原始值，不把应用载荷根冒充物理帧。'
        }
      ],
      example:
        "import {\n  RpcCarrierObservation,\n  RpcCarrierPlatform,\n  RpcProbeDirection,\n} from '@migaia/rpc-host/sdk'\nconst observer = new RpcCarrierObservation(\n  { platform: RpcCarrierPlatform.messagePort },\n  console.error,\n)\nconst remove = observer.subscribe((event) => console.log(event.content))\nexport function post(raw: unknown, nativePost: (value: unknown) => void) {\n  observer.emit(RpcProbeDirection.outbound, raw)\n  nativePost(raw)\n}\nexport function release() {\n  remove()\n}\n"
    },
    RpcMemberGeneration: {
      summary: {
        en: 'One canonical member-generation algorithm borrows native supervision and Session authority; it owns candidate/waiter cleanup only.',
        zh: '唯一规范成员代际算法借用原生监管及会话权限，只拥有候选及等待者清理。'
      },
      members: {
        current: {
          summary: {
            en: 'Read safe accepted member metadata only.',
            zh: '仅读取安全接纳成员元数据。'
          },
          params: {},
          returns: {
            en: 'Current accepted view/generation facts without a Session facade.',
            zh: '不含会话门面的当前接纳视图及代际事实。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nexport function current<T, S>(owner: RpcMemberGeneration<T, S>) {\n  return owner.current()\n}\n"
        },
        currentHandle: {
          summary: {
            en: 'Borrow the exact accepted handle for native lifecycle work.',
            zh: '为原生生命周期工作借用精确接纳句柄。'
          },
          params: {},
          returns: {
            en: 'Current original handle or undefined after departure.',
            zh: '当前原句柄，离开后为空。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nexport function currentHandle<T, S>(owner: RpcMemberGeneration<T, S>) {\n  return owner.currentHandle()\n}\n"
        },
        observedGeneration: {
          summary: {
            en: 'Read the original supervisor execution ordinal.',
            zh: '读取原监管器执行序号。'
          },
          params: {},
          returns: {
            en: 'Original native generation; SDK does not allocate another ordinal.',
            zh: '原生原代际，共享工具不另分配序号。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nexport function observedGeneration<T, S>(owner: RpcMemberGeneration<T, S>) {\n  return owner.observedGeneration()\n}\n"
        },
        open: {
          summary: {
            en: 'Open once through actual acquisition, attach and accepted readiness.',
            zh: '通过实际获取、附加及接纳就绪打开一次。'
          },
          params: {},
          returns: {
            en: 'Original accepted Session view; initial failure releases native resources without replacing the primary.',
            zh: '原接纳会话视图；初始失败释放原生资源但不替换主要失败。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nexport function open<T, S>(owner: RpcMemberGeneration<T, S>) {\n  return owner.open()\n}\n"
        },
        rebind: {
          summary: {
            en: 'Join the original pending native replacement preparation.',
            zh: '等待原待决原生替换准备。'
          },
          params: {
            signal: {
              en: 'Original cancellation signal for this preparation or wait.',
              zh: '本次准备或等待的原取消信号。'
            }
          },
          returns: {
            en: 'The shared accepted-generation Promise.',
            zh: '共享接纳代际 Promise。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nexport function rebind<T, S>(owner: RpcMemberGeneration<T, S>, signal: AbortSignal) {\n  return owner.rebind(signal)\n}\n"
        },
        retainedResourceCount: {
          summary: {
            en: 'Read actual retained native resource groups for cold lifecycle diagnosis.',
            zh: '为冷生命周期诊断读取实际保留原生资源组。'
          },
          params: {},
          returns: {
            en: 'Actual resource count, not native readiness or health.',
            zh: '实际资源数量，不代表原生就绪或健康。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nexport function retainedResourceCount<T, S>(owner: RpcMemberGeneration<T, S>) {\n  return owner.retainedResourceCount()\n}\n"
        },
        close: {
          summary: {
            en: 'Finally remove the original registration and join any candidate rollback.',
            zh: '最终移除原登记，并等待候选回滚。'
          },
          params: {},
          returns: {
            en: 'Shared original close completion.',
            zh: '共享原关闭完成。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nexport function close<T, S>(owner: RpcMemberGeneration<T, S>) {\n  return owner.close()\n}\n"
        },
        prepareGeneration: {
          summary: {
            en: 'Prepare the exact native unit through carrier acquisition and real Session readiness.',
            zh: '通过载体获取及真实会话就绪准备精确原生单元。'
          },
          params: {
            signal: {
              en: 'Original cancellation signal for this preparation or wait.',
              zh: '本次准备或等待的原取消信号。'
            },
            own: {
              en: 'Original holder receives each exact owned cleanup.',
              zh: '原持有者接收各精确所拥有清理。'
            }
          },
          returns: {
            en: 'Only an actually accepted execution generation.',
            zh: '仅实际已接纳执行代际。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nexport function prepareGeneration<T, S>(\n  owner: RpcMemberGeneration<T, S>,\n  signal: AbortSignal,\n  own: Parameters<RpcMemberGeneration<T, S>['prepareGeneration']>[1],\n) {\n  return owner.prepareGeneration(signal, own)\n}\n"
        },
        onLeave: {
          summary: {
            en: 'Observe original generation departure; late delivery uses the native clock without synchronous reentry.',
            zh: '观察原代际离开；稍后交付使用原生时钟且不发生同步重入。'
          },
          params: {
            generation: {
              en: 'Original native execution generation observed by this registration.',
              zh: '本登记观察到的原生原执行代际。'
            },
            listener: {
              en: 'Receives the exact original native departure reason.',
              zh: '接收精确原生原离开原因。'
            }
          },
          returns: {
            en: 'Exact idempotent listener remover.',
            zh: '精确幂等监听移除器。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nexport function onLeave<T, S>(owner: RpcMemberGeneration<T, S>) {\n  return owner.onLeave(owner.observedGeneration(), (reason) => console.error(reason))\n}\n"
        },
        whenClosed: {
          summary: {
            en: 'Join actual retired cleanup without rethrowing an already-reported physical failure as new work.',
            zh: '等待实际退场清理，不将已上报物理失败作为新工作再次抛出。'
          },
          params: {
            generation: {
              en: 'Original native execution generation observed by this registration.',
              zh: '本登记观察到的原生原执行代际。'
            }
          },
          returns: {
            en: 'Actual retired cleanup completion.',
            zh: '实际退场清理完成。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nexport function whenClosed<T, S>(owner: RpcMemberGeneration<T, S>) {\n  return owner.whenClosed(owner.observedGeneration())\n}\n"
        },
        whenReady: {
          summary: {
            en: 'Wait for a genuinely accepted later execution generation.',
            zh: '等待真实接纳的后续执行代际。'
          },
          params: {
            after: {
              en: 'Previously observed native generation lower bound.',
              zh: '先前观察的原生代际下界。'
            },
            signal: {
              en: 'Original cancellation signal for this preparation or wait.',
              zh: '本次准备或等待的原取消信号。'
            }
          },
          returns: {
            en: 'Later accepted generation, with the owned abort subscription released.',
            zh: '后续接纳代际，并释放所拥有取消订阅。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nexport function whenReady<T, S>(owner: RpcMemberGeneration<T, S>, signal: AbortSignal) {\n  return owner.whenReady(owner.observedGeneration(), signal)\n}\n"
        },
        releaseRegistration: {
          summary: {
            en: 'Release only the original holder, preserving drain, retirement and native-dispose order.',
            zh: '只释放原持有者，保留排空、退场及原生释放顺序。'
          },
          params: {},
          returns: {
            en: 'Original final registration cleanup completion.',
            zh: '原最终登记清理完成。'
          },
          example:
            "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nexport function releaseRegistration<T, S>(owner: RpcMemberGeneration<T, S>) {\n  return owner.releaseRegistration()\n}\n"
        }
      },
      scenarios: [
        {
          en: 'Reuse existing supervision and actual Session admission for one native registration.',
          zh: '为一个原生登记复用已有监管及真实会话准入，不建立第二套就绪或替换状态机。'
        }
      ],
      example:
        "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberGenerationOptions } from '@migaia/rpc-host/sdk'\nexport function registration<T, S>(options: IRpcMemberGenerationOptions<T, S>) {\n  const { context, binding, signal, report } = options\n  return new RpcMemberGeneration({ context, binding, signal, report })\n}\n"
    },
    RpcNativeMembers: {
      summary: {
        en: 'Passive members receiver over exact native records and controls; no business request surface or supervisor registry is introduced.',
        zh: '精确原生记录及控制上的被动成员接收者，不引入业务请求表面或监管器登记表。'
      },
      members: {
        value: {
          summary: {
            en: 'Frozen actual members namespace installed by the sole native extension channel.',
            zh: '由唯一原生扩展通道安装的冻结实际成员命名空间。'
          }
        },
        publishReady: {
          summary: {
            en: 'Publish actual accepted readiness after the generation owner commits its pointer.',
            zh: '代际所有者提交当前指针之后发布实际接纳就绪。'
          },
          params: {
            record: {
              en: 'Exact original native record.',
              zh: '精确原生原记录。'
            },
            session: {
              en: 'Original accepted Session view.',
              zh: '原接纳会话视图。'
            },
            generation: {
              en: 'Original native execution generation observed by this registration.',
              zh: '本登记观察到的原生原执行代际。'
            }
          },
          returns: {
            en: 'Only original safe event facts are delivered.',
            zh: '只交付原安全事件事实。'
          },
          example:
            "import { RpcNativeMembers } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcNativeMemberRecord,\n  IRpcSessionView,\n  IRpcMemberCurrent,\n} from '@migaia/rpc-host/sdk'\nexport function publishReady(\n  owner: RpcNativeMembers<'thread'>,\n  record: IRpcNativeMemberRecord,\n  session: IRpcSessionView,\n  generation: number,\n) {\n  owner.publishReady(record, session, generation)\n}\n"
        },
        publishNative: {
          summary: {
            en: 'Project the original native lifecycle event once.',
            zh: '仅投影原生原生命周期事件一次。'
          },
          params: {
            record: {
              en: 'Exact original native record.',
              zh: '精确原生原记录。'
            },
            event: {
              en: 'Original supervisor event, not a synthesized ready state.',
              zh: '原监管事件，不是合成就绪状态。'
            },
            current: {
              en: 'Optional safe actual current native facts.',
              zh: '可选安全实际当前原生事实。'
            }
          },
          returns: {
            en: 'Passive subscriber notification without another native subscription.',
            zh: '被动订阅通知，不另订阅原生事件。'
          },
          example:
            "import { RpcNativeMembers } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcNativeMemberRecord,\n  IRpcSessionView,\n  IRpcMemberCurrent,\n} from '@migaia/rpc-host/sdk'\nexport function publishNative(\n  owner: RpcNativeMembers<'thread'>,\n  record: IRpcNativeMemberRecord,\n  event: Parameters<RpcNativeMembers<'thread'>['publishNative']>[1],\n  current: IRpcMemberCurrent,\n) {\n  owner.publishNative(record, event, current)\n}\n"
        },
        close: {
          summary: {
            en: 'End passive listener/watch lifetime only.',
            zh: '仅结束被动监听及观察迭代器生命周期。'
          },
          params: {},
          returns: {
            en: 'No native unit is stopped by closing this receiver.',
            zh: '关闭本接收者不停止原生单元。'
          },
          example:
            "import { RpcNativeMembers } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcNativeMemberRecord,\n  IRpcSessionView,\n  IRpcMemberCurrent,\n} from '@migaia/rpc-host/sdk'\nexport function close(owner: RpcNativeMembers<'thread'>) {\n  owner.close()\n}\n"
        }
      },
      scenarios: [
        {
          en: 'Install local controls from real records and existing native indexes.',
          zh: '从真实记录及现有原生索引安装本地控制，被动接收者关闭不会杀死借用单元。'
        }
      ],
      example:
        "import { RpcNativeMembers } from '@migaia/rpc-host/sdk'\nimport type { IRpcNativeMembersOptions } from '@migaia/rpc-host/sdk'\nexport function members(options: IRpcNativeMembersOptions<'thread'>) {\n  const { self, source, report } = options\n  return new RpcNativeMembers({ kind: 'thread', self, source, report })\n}\n"
    },
    RpcNativePoolMember: {
      summary: {
        en: 'One actual native resource projected to private Session selection without adding a generation or ready state machine.',
        zh: '将一个实际原生资源投影为私有会话选择，不增加代际或就绪状态机。'
      },
      members: {
        record: {
          summary: {
            en: 'Exact original native record.',
            zh: '此私有成员原生获取所拥有的精确登记记录。'
          }
        },
        native: {
          summary: {
            en: 'Original native generation capability.',
            zh: '此成员实际原生代际能力，不由逻辑池模拟。'
          }
        },
        current: {
          summary: {
            en: 'Borrow the original accepted private Session for this member.',
            zh: '借用本成员的原接纳私有会话。'
          },
          params: {},
          returns: {
            en: 'Exact current private Session or undefined, never another slot.',
            zh: '精确当前私有会话或空值，不返回其它池槽。'
          },
          example:
            "import { RpcNativePoolMember } from '@migaia/rpc-host/sdk'\nexport function current(member: RpcNativePoolMember) {\n  return member.current()\n}\n"
        },
        ready: {
          summary: {
            en: 'Join original native rebind and current-handle readiness.',
            zh: '等待原生原重新绑定及当前句柄就绪。'
          },
          params: {
            signal: {
              en: 'Original cancellation signal for this preparation or wait.',
              zh: '本次准备或等待的原取消信号。'
            }
          },
          returns: {
            en: 'Original private Session, preserving the shared native preparation.',
            zh: '原私有会话，保留共享原生准备。'
          },
          example:
            "import { RpcNativePoolMember } from '@migaia/rpc-host/sdk'\nexport function ready(member: RpcNativePoolMember, signal: AbortSignal) {\n  return member.ready(signal)\n}\n"
        },
        close: {
          summary: {
            en: 'Preserve original generation/resource close completion.',
            zh: '保留原代际及资源关闭完成。'
          },
          params: {},
          returns: {
            en: 'Original shared close Promise.',
            zh: '原共享关闭 Promise。'
          },
          example:
            "import { RpcNativePoolMember } from '@migaia/rpc-host/sdk'\nexport function close(member: RpcNativePoolMember) {\n  return member.close()\n}\n"
        }
      },
      scenarios: [
        {
          en: 'Project repeated native acquisition while private Session and cleanup stay with original owners.',
          zh: '投影重复原生获取，同时将私有会话及清理保留在原所有者，不模拟逻辑媒介。'
        }
      ],
      example:
        "import { RpcNativePoolMember } from '@migaia/rpc-host/sdk'\nexport function selected(\n  options: ConstructorParameters<typeof RpcNativePoolMember>[0],\n) {\n  const { record, native, close } = options\n  return new RpcNativePoolMember({ record, native, close })\n}\n"
    },
    IRpcMemberIdentity: {
      summary: {
        en: 'Only actual safe Host/accepted peer identity enters member output.',
        zh: '只有实际安全宿主及接纳对端身份进入成员输出。'
      },
      members: {
        name: {
          summary: {
            en: 'Stable native registration name; accepted private members retain their first accepted name across departure/restart.',
            zh: '稳定原生登记名称，接纳私有成员在离开及重启后保留首次接纳名称。'
          }
        },
        instanceId: {
          summary: {
            en: 'Original accepted remote instance identity, not a fabricated native fingerprint.',
            zh: '原接纳远端实例身份，不是伪造原生指纹。'
          }
        }
      }
    },
    IRpcMemberQueryOptions: {
      summary: {
        en: 'Cold local formatting choice after actual record selection and sampling.',
        zh: '实际记录选择及采样之后的冷本地格式选择。'
      },
      members: {
        format: {
          summary: {
            en: 'Local safe snapshot format; omission keeps own-data objects.',
            zh: '本地安全快照格式，省略时保留自有数据对象。'
          },
          default: {
            en: 'Object output.',
            zh: '对象输出。'
          },
          values: {
            json: {
              en: 'Serialize safe data as JSON text.',
              zh: '将安全数据序列化为 JSON 文本。'
            },
            yaml: {
              en: 'Serialize safe data as YAML text.',
              zh: '将安全数据序列化为 YAML 文本。'
            },
            toml: {
              en: 'Serialize safe data as TOML text.',
              zh: '将安全数据序列化为 TOML 文本。'
            }
          },
          example:
            "import type { IRpcNativeMemberControls } from '@migaia/rpc-host/sdk'\n\nexport function memberListText(members: IRpcNativeMemberControls<'process'>) {\n  return members.list({ format: 'json' })\n}\n",
          whenToUse: {
            en: 'Select a serialize format only for local operator output; omission retains the same safe snapshot.',
            zh: '仅为本地运维输出选择序列化格式，省略时保留同一安全快照，不反射活动资源。'
          }
        }
      }
    },
    IRpcMemberUnavailable: {
      summary: {
        en: 'Frozen explicit absence is safe across object/JSON/YAML/TOML output.',
        zh: '冻结显式缺失值可安全用于对象及各文本格式输出。'
      },
      members: {
        status: {
          summary: {
            en: 'Actual available/unavailable connection state; never infer health from a ready channel.',
            zh: '实际可用及不可用连接状态，不从就绪通道推断健康。'
          }
        },
        reason: {
          summary: {
            en: 'Canonical safe reason from the actual owner; no native handles, credentials or arbitrary error message.',
            zh: '实际所有者提供的规范安全原因，不含原生句柄、凭据或任意错误消息。'
          }
        }
      },
      scenarios: [
        {
          en: 'Show why no native sampler, current unit or trusted observation supports a query field.',
          zh: '没有原生采样器、当前单元或可信观察支持查询字段时，显示其真实缺失原因。'
        }
      ],
      example:
        "import { rpcMemberUnavailable, RpcMemberQueryReason } from '@migaia/rpc-host/sdk'\nexport const resources = rpcMemberUnavailable(RpcMemberQueryReason.resources)\n"
    },
    IRpcMemberMetric: {
      summary: {
        en: 'One original sample with explicit scope, unit, time and clock domain.',
        zh: '包含显式作用域、单位、时间及时钟域的一个原采样。'
      },
      members: {
        value: {
          summary: {
            en: 'Original sampled value in the explicitly declared native scope and units.',
            zh: '显式原生作用域及单位下的原采样值。'
          }
        },
        scope: {
          summary: {
            en: 'Original metric denominator, such as endpoint-client, execution-unit, process or thread.',
            zh: '原指标分母，如客户端端点、执行单元、进程或线程。'
          }
        },
        unit: {
          summary: {
            en: 'Explicit metric units; CPU time, memory bytes and utilization ratios remain distinct.',
            zh: '显式指标单位，处理器时间、内存字节及使用率比例保持区别。'
          }
        },
        observedAt: {
          summary: {
            en: 'Original local monotonic native scheduler timestamp.',
            zh: '原本地原生调度器单调时间戳。'
          }
        },
        clock: {
          summary: {
            en: 'Clock-domain label belonging to the original monotonic observation, not wall-clock epoch time.',
            zh: '原单调观察的时钟域标签，不是墙上时钟纪元时间。'
          }
        }
      },
      scenarios: [
        {
          en: 'Preserve the real sample scope, units and monotonic time.',
          zh: '保留真实采样的范围、单位及单调时间，不比较分母不同的进程和线程指标。'
        }
      ],
      example:
        "import {\n  rpcMemberMetric,\n  RpcMemberMetricScope,\n  RpcMemberMetricUnit,\n} from '@migaia/rpc-host/sdk'\nexport function count(value: number, now: number) {\n  return rpcMemberMetric(\n    value,\n    RpcMemberMetricScope.client,\n    RpcMemberMetricUnit.calls,\n    now,\n  )\n}\n"
    },
    IRpcMemberCounters: {
      summary: {
        en: 'Actual canonical counters and explicit unavailable physical totals.',
        zh: '实际规范计数及显式不可用物理总量。'
      },
      members: {
        inFlight: {
          summary: {
            en: 'Current canonical client-work count sampled from its actual owner.',
            zh: '从实际所有者采样的当前规范客户端工作数量。'
          }
        },
        sent: {
          summary: {
            en: 'Explicitly unavailable without an actual physical sent-counter owner.',
            zh: '没有实际物理发送计数所有者时明确不可用。'
          }
        },
        received: {
          summary: {
            en: 'Explicitly unavailable without an actual physical receive-counter owner.',
            zh: '没有实际物理接收计数所有者时明确不可用。'
          }
        },
        errors: {
          summary: {
            en: 'Explicitly unavailable without a canonical counted-error owner.',
            zh: '没有规范错误计数所有者时明确不可用。'
          }
        },
        lastActiveAt: {
          summary: {
            en: 'Explicitly unavailable without a genuine activity observation owner.',
            zh: '没有真实活动观察所有者时明确不可用。'
          }
        }
      },
      scenarios: [
        {
          en: 'Use actual canonical local counts only when their owner lends a sample.',
          zh: '规范本地调用计数所有者借出采样时才展示计数，未接仪表的原生详情明确不可用。'
        }
      ],
      example:
        "import { rpcMemberCounters } from '@migaia/rpc-host/sdk'\nexport const unavailableCounts = rpcMemberCounters()\n"
    },
    IRpcMemberResources: {
      summary: {
        en: 'Original scoped native usage excludes private handles and parent aggregate substitutions.',
        zh: '原作用域原生用量，不含私有句柄，也不以父级聚合值替代。'
      },
      members: {
        scope: {
          summary: {
            en: 'Original metric denominator, such as endpoint-client, execution-unit, process or thread.',
            zh: '原指标分母，如客户端端点、执行单元、进程或线程。'
          }
        },
        pid: {
          summary: {
            en: 'Original native process id when observed.',
            zh: '被观察到的原原生进程标识。'
          }
        },
        sharedPid: {
          summary: {
            en: 'Actual shared host process id for a non-isolated native unit, not a claim of process isolation.',
            zh: '非隔离原生单元实际共享宿主进程标识，不声称进程隔离。'
          }
        },
        threadId: {
          summary: {
            en: 'Original actual native thread identity when observed.',
            zh: '被观察到的原实际原生线程身份。'
          }
        },
        rssBytes: {
          summary: {
            en: 'Original RSS byte metric in the declared native scope, or unavailable.',
            zh: '声明原生作用域内的原驻留字节指标或不可用值。'
          }
        },
        heapUsedBytes: {
          summary: {
            en: 'Original sampled used heap bytes; no aggregate substitution.',
            zh: '原已用堆字节采样，不以聚合值代替。'
          }
        },
        heapTotalBytes: {
          summary: {
            en: 'Original sampled total heap bytes; no invented zero.',
            zh: '原总堆字节采样，不伪造零值。'
          }
        },
        cpu: {
          summary: {
            en: 'Original user/system CPU-time metrics in microseconds, or explicit unavailable state.',
            zh: '原用户及系统处理器时间指标，单位微秒，或显式不可用状态。'
          }
        },
        elu: {
          summary: {
            en: 'Original event-loop active/idle milliseconds and dimensionless utilization, distinct from CPU time.',
            zh: '原事件循环活动及空闲毫秒和无量纲使用率，与处理器时间不同。'
          }
        }
      },
      scenarios: [
        {
          en: 'Sample the exact native unit and discard results if identity changed during awaiting.',
          zh: '采样精确原生单元，等待期间身份改变则丢弃数据，不支持的指标保留不可用原因。'
        }
      ],
      example:
        "import { rpcMemberResources } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberNativeUnit } from '@migaia/rpc-host/sdk'\nexport function sample(\n  unit: IRpcMemberNativeUnit,\n  now: () => number,\n  current: () => boolean,\n) {\n  return rpcMemberResources(unit, 'thread', now, console.error, current)\n}\n"
    },
    IRpcMemberConnectionOrigin: {
      summary: {
        en: 'Cold source mode and direction come from the actual factory branch.',
        zh: '冷来源模式及方向来自实际工厂分支。'
      },
      members: {
        kind: {
          summary: {
            en: 'Actual configured source mode or native unit kind from the original owner.',
            zh: '原所有者提供的实际配置来源模式或原生单元类别。'
          },
          values: {
            enum: 'RpcMemberSourceKind'
          }
        },
        direction: {
          summary: {
            en: 'Actual local connect/listen/spawn direction independent of owned/borrowed lifetime.',
            zh: '实际本地连接、监听及启动方向，与拥有及借用生命周期不同。'
          },
          values: {
            enum: 'RpcMemberConnectionDirection'
          }
        }
      }
    },
    IRpcMemberConnectionDirectory: {
      summary: {
        en: 'Safe accepted directory can survive retirement without retaining a Session handle.',
        zh: '安全接纳目录可在退场后保留，不持有会话句柄。'
      },
      members: {
        kind: {
          summary: {
            en: 'Actual configured source mode or native unit kind from the original owner.',
            zh: '原所有者提供的实际配置来源模式或原生单元类别。'
          },
          values: {
            enum: 'RpcMemberSourceKind'
          }
        },
        direction: {
          summary: {
            en: 'Actual local connect/listen/spawn direction independent of owned/borrowed lifetime.',
            zh: '实际本地连接、监听及启动方向，与拥有及借用生命周期不同。'
          },
          values: {
            enum: 'RpcMemberConnectionDirection'
          }
        },
        carrier: {
          summary: {
            en: 'Actual physical carrier label from the native acquisition.',
            zh: '原生获取提供的实际物理载体标签。'
          }
        },
        description: {
          summary: {
            en: 'Optional original accepted self/generation and actual callable method names.',
            zh: '可选原接纳自身及代际和实际可调用方法名。'
          }
        }
      }
    },
    IRpcMemberRecent: {
      summary: {
        en: 'Only original registration departures enter the bounded safe history.',
        zh: '只有原登记离开进入有界安全历史。'
      },
      members: {
        generation: {
          summary: {
            en: 'Original accepted generation tuple or explicitly declared native execution ordinal.',
            zh: '原接纳代际元组，或类型显式声明的原生执行序号。'
          }
        },
        timestamp: {
          summary: {
            en: 'Original monotonic event observation time, explicitly unavailable if not observed.',
            zh: '原单调事件观察时间；未观察时明确不可用。'
          }
        },
        clock: {
          summary: {
            en: 'Clock-domain label belonging to the original monotonic observation, not wall-clock epoch time.',
            zh: '原单调观察的时钟域标签，不是墙上时钟纪元时间。'
          }
        },
        kind: {
          summary: {
            en: 'Actual configured source mode or native unit kind from the original owner.',
            zh: '原所有者提供的实际配置来源模式或原生单元类别。'
          }
        },
        identity: {
          summary: {
            en: 'Safe accepted name/instance identity, or explicit unavailable data.',
            zh: '安全接纳名称及实例身份，或显式不可用数据。'
          }
        },
        source: {
          summary: {
            en: 'Safe original tagged diagnostic source.',
            zh: '安全原已标记诊断来源。'
          }
        },
        code: {
          summary: {
            en: 'Original native exit code or tagged diagnostic code according to the declaring field.',
            zh: '依字段声明取原生原退出码或已标记诊断错误码。'
          }
        }
      }
    },
    IRpcMemberConnectionDetail: {
      summary: {
        en: 'Connection state, execution-unit state, health and resources remain separate actual owner facts.',
        zh: '连接状态、执行单元状态、健康及资源保持为分别拥有的实际事实。'
      },
      members: {
        identity: {
          summary: {
            en: 'Safe accepted name/instance identity, or explicit unavailable data.',
            zh: '安全接纳名称及实例身份，或显式不可用数据。'
          }
        },
        generation: {
          summary: {
            en: 'Original accepted generation tuple or explicitly declared native execution ordinal.',
            zh: '原接纳代际元组，或类型显式声明的原生执行序号。'
          }
        },
        kind: {
          summary: {
            en: 'Actual configured source mode or native unit kind from the original owner.',
            zh: '原所有者提供的实际配置来源模式或原生单元类别。'
          }
        },
        direction: {
          summary: {
            en: 'Actual local connect/listen/spawn direction independent of owned/borrowed lifetime.',
            zh: '实际本地连接、监听及启动方向，与拥有及借用生命周期不同。'
          }
        },
        carrier: {
          summary: {
            en: 'Actual physical carrier label from the native acquisition.',
            zh: '原生获取提供的实际物理载体标签。'
          }
        },
        connection: {
          summary: {
            en: 'Actual channel availability separate from native execution-unit lifecycle.',
            zh: '实际通道可用性，与原生执行单元生命周期分开。'
          }
        },
        unit: {
          summary: {
            en: 'Original native kind/state/generation/degradation, or explicit unavailable record.',
            zh: '原生原种类、状态、代际及降级事实，或显式不可用记录。'
          }
        },
        health: {
          summary: {
            en: 'Original supervisor health observation; accepted Session readiness does not imply a healthy execution unit.',
            zh: '原监管器健康观察，接纳会话就绪不代表执行单元健康。'
          }
        },
        restartCount: {
          summary: {
            en: 'Original supervisor restart count metric, or explicit unavailable data.',
            zh: '原监管器重启计数指标或显式不可用数据。'
          }
        },
        methods: {
          summary: {
            en: 'Actual accepted callable method names; erased TypeScript declarations do not manufacture a directory.',
            zh: '实际接纳可调用方法名，已擦除类型声明不会制造目录。'
          }
        },
        counters: {
          summary: {
            en: 'Current built-in native source projections leave counters unavailable until an actual canonical count owner is connected. The SDK never derives counters from probe traffic.',
            zh: '当前内建原生来源投影在接入实际规范计数所有者之前将计数保持不可用，共享工具不从探针流量派生计数。'
          }
        },
        resources: {
          summary: {
            en: 'Original native-unit scoped usage, or explicit unavailable data; never substitute parent aggregate memory.',
            zh: '原原生单元作用域用量或显式不可用数据，不以父级聚合内存代替。'
          }
        },
        recent: {
          summary: {
            en: 'Original bounded registration-departure history, at most the canonical recent limit.',
            zh: '原有界登记离开历史，至多保留规范历史上限。'
          }
        },
        lastExit: {
          summary: {
            en: 'Safe original native exit generation/reason/code/signal without retaining native error objects.',
            zh: '安全原生原退出代际、原因、错误码及信号，不保留原生错误对象。'
          }
        }
      },
      scenarios: [
        {
          en: 'Show diagnostics from one exact native registration without guessing missing observations.',
          zh: '从一个精确原生登记展示诊断，未提供的数据保持缺失，不能根据流量推算指标。'
        }
      ],
      example:
        "import { rpcMemberConnectionDetail } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberConnectionDirectory } from '@migaia/rpc-host/sdk'\nexport function describe(directory: IRpcMemberConnectionDirectory) {\n  return rpcMemberConnectionDetail(directory)\n}\n"
    },
    IRpcMemberOverview: {
      summary: {
        en: 'Actual global Host identity plus genuine contributed safe connection records.',
        zh: '实际全局宿主身份及真实贡献的安全连接记录。'
      },
      members: {
        self: {
          summary: {
            en: 'Actual global Host name/instance identity captured before asynchronous query sampling.',
            zh: '异步查询采样前捕获的实际全局宿主名称及实例身份。'
          }
        },
        connections: {
          summary: {
            en: 'Safe actual connection records contributed by genuine native registrations.',
            zh: '真实原生登记提供的安全实际连接记录。'
          }
        }
      }
    },
    IRpcMemberEvent: {
      summary: {
        en: 'Passive safe lifecycle facts from original native events, without control authority.',
        zh: '来自原原生事件的被动安全生命周期事实，不授予控制权限。'
      },
      members: {
        name: {
          summary: {
            en: 'Stable native registration name; accepted private members retain their first accepted name across departure/restart.',
            zh: '稳定原生登记名称，接纳私有成员在离开及重启后保留首次接纳名称。'
          }
        },
        instanceId: {
          summary: {
            en: 'Original accepted remote instance identity, not a fabricated native fingerprint.',
            zh: '原接纳远端实例身份，不是伪造原生指纹。'
          }
        },
        generation: {
          summary: {
            en: 'Original accepted generation tuple or explicitly declared native execution ordinal.',
            zh: '原接纳代际元组，或类型显式声明的原生执行序号。'
          }
        },
        timestamp: {
          summary: {
            en: 'Original monotonic event observation time, explicitly unavailable if not observed.',
            zh: '原单调事件观察时间；未观察时明确不可用。'
          }
        },
        clock: {
          summary: {
            en: 'Clock-domain label belonging to the original monotonic observation, not wall-clock epoch time.',
            zh: '原单调观察的时钟域标签，不是墙上时钟纪元时间。'
          }
        },
        reason: {
          summary: {
            en: 'Canonical safe reason from the actual owner; no native handles, credentials or arbitrary error message.',
            zh: '实际所有者提供的规范安全原因，不含原生句柄、凭据或任意错误消息。'
          }
        },
        code: {
          summary: {
            en: 'Original native exit code or tagged diagnostic code according to the declaring field.',
            zh: '依字段声明取原生原退出码或已标记诊断错误码。'
          }
        },
        signal: {
          summary: {
            en: 'Original native exit signal, explicitly unavailable when not observed.',
            zh: '原生原退出信号，未观察时明确不可用。'
          }
        },
        error: {
          summary: {
            en: 'Safe source/code projection only; no message/stack/cause or authority is exposed.',
            zh: '仅安全来源及错误码投影，不公开消息、堆栈、原因或权限。'
          }
        },
        count: {
          summary: {
            en: 'Original native restart count for this event.',
            zh: '本事件的原生原重启次数。'
          }
        },
        degraded: {
          summary: {
            en: 'Original native supervisor degradation reasons.',
            zh: '原生原监管器降级原因。'
          }
        },
        type: {
          summary: {
            en: 'Original ready/exit/degraded/restart/terminal/liquidated event selected by the native owner.',
            zh: '原生所有者选定的原就绪、退出、降级、重启、终止及清算事件。'
          },
          values: {
            enum: 'RpcMemberEventName'
          }
        }
      }
    },
    IRpcNativeMemberRecord: {
      summary: {
        en: 'Exact native registration lends existing controls, readiness and safe asynchronous sampling. No second record owner is created.',
        zh: '精确原生登记借出现有控制、就绪及安全异步采样，不创建第二记录所有者。'
      },
      members: {
        name: {
          summary: {
            en: 'Stable native registration name; accepted private members retain their first accepted name across departure/restart.',
            zh: '稳定原生登记名称，接纳私有成员在离开及重启后保留首次接纳名称。'
          }
        },
        ownership: {
          summary: {
            en: 'Original owned/borrowed native authority; borrowed resources are never upgraded into an owned supervisor.',
            zh: '原拥有及借用原生权限，借用资源不会升级为所拥有监管器。'
          },
          values: {
            owned: {
              en: 'The installation owns native control and final release.',
              zh: '安装拥有原生控制及最终释放，可执行原生管理。'
            },
            borrowed: {
              en: 'Only the connection is lent; the remote unit remains outside this owner.',
              zh: '只借出连接，远端执行单元仍不属于本所有者。'
            }
          }
        },
        supervisor: {
          summary: {
            en: 'Optional original native supervisor; absence means control cannot fabricate one.',
            zh: '可选原生原监管器，缺省时控制不能伪造监管器。'
          }
        },
        current: {
          summary: {
            en: 'Returns safe actual generation and accepted Session metadata.',
            zh: '返回安全实际代际及接纳会话元数据。'
          },
          params: {},
          returns: {
            en: 'Current safe accepted metadata; departure makes active false without rewriting native history.',
            zh: '当前安全接纳元数据，离开后不再活跃，不改写原生历史。'
          }
        },
        whenReady: {
          summary: {
            en: 'Joins original native shared preparation; it does not fake Session readiness from supervisor state.',
            zh: '等待原生原共享准备，不从监管器状态伪造会话就绪。'
          },
          params: {},
          returns: {
            en: 'The native generation owner shared preparation Promise; this receiver adds no readiness machine.',
            zh: '原生代际所有者的共享准备承诺，本接收者不另建就绪状态机。'
          }
        },
        prepareReplacement: {
          summary: {
            en: 'Validate the actual native replacement specification before supervisor replacement.',
            zh: '监管器替换前校验实际原生替换规格。'
          },
          params: {
            spec: {
              en: 'The caller-supplied native replacement recipe accepted by this record supervisor.',
              zh: '调用方提供且由本记录监管器接纳的原生替换方案。'
            }
          },
          returns: {
            en: 'The original native replacement recipe/receipt prepared for the supervisor, without committing it here.',
            zh: '为监管器准备的原生原替换方案及回执，本函数不在此提交。'
          }
        },
        describe: {
          summary: {
            en: 'Samples only this exact original selected record and returns safe connection details.',
            zh: '仅采样本精确原选择记录并返回安全连接详情。'
          },
          params: {},
          returns: {
            en: 'Safe connection-detail snapshots from this exact native record, with unavailable metrics explicit.',
            zh: '本精确原生记录的安全连接详情快照，缺失指标保持显式。'
          }
        },
        now: {
          summary: {
            en: 'Original monotonic native scheduler clock.',
            zh: '原生原调度器单调时钟。'
          },
          params: {},
          returns: {
            en: 'The original scheduler monotonic timestamp, not a wall-clock epoch.',
            zh: '原调度器的单调时间戳，不使用墙上时钟纪元时间。'
          }
        }
      }
    },
    IRpcNativeMemberSource: {
      summary: {
        en: 'Borrow original native record iteration and indexes; null preserves ambiguity without choosing an arbitrary match.',
        zh: '借用原原生记录遍历及索引，空标记保留歧义，不任意选择匹配项。'
      },
      members: {
        values: {
          summary: {
            en: 'Iterate actual native registrations.',
            zh: '借用原生所有者当前登记集合，不创建第二索引。'
          },
          params: {},
          returns: {
            en: 'Original records without another registry.',
            zh: '原记录，不建立另一份登记表。'
          },
          example:
            "import type { IRpcNativeMemberSource } from '@migaia/rpc-host/sdk'\nexport function values(source: IRpcNativeMemberSource) {\n  return source.values()\n}\n"
        },
        byName: {
          summary: {
            en: 'Look up an actual registered member name.',
            zh: '通过原生所有者现有名称索引定位精确登记。'
          },
          params: {
            name: {
              en: 'Original configured or first-accepted stable registration name.',
              zh: '原配置或首次接纳稳定登记名。'
            }
          },
          returns: {
            en: 'Exact record, null for ambiguity or undefined when absent.',
            zh: '精确记录、表示歧义的空标记，或缺失空值。'
          },
          example:
            "import type { IRpcNativeMemberSource } from '@migaia/rpc-host/sdk'\nexport function byName(source: IRpcNativeMemberSource, name: string) {\n  return source.byName(name)\n}\n"
        },
        byInstance: {
          summary: {
            en: 'Look up an actual accepted instance identity.',
            zh: '查找实际接纳实例身份。'
          },
          params: {
            instanceId: {
              en: 'Use the peerId returned in an accepted member view or a previous members query; lookup borrows the native source existing index.',
              zh: '使用已接纳成员视图或先前成员查询返回的对端标识，查找借用原生来源现有索引。'
            }
          },
          returns: {
            en: 'Exact record, null for ambiguity or undefined when absent.',
            zh: '精确记录、表示歧义的空标记，或缺失空值。'
          },
          example:
            "import type { IRpcNativeMemberSource } from '@migaia/rpc-host/sdk'\nexport function byInstance(source: IRpcNativeMemberSource, instanceId: string) {\n  return source.byInstance(instanceId)\n}\n"
        }
      }
    },
    IRpcMemberListFilter: {
      summary: {
        en: 'Independent native state, registered name, source kind and direction filters.',
        zh: '独立的原生状态、登记名称、来源种类及方向过滤。'
      },
      members: {
        state: {
          summary: {
            en: 'Actual original supervisor state, not a channel-ready alias.',
            zh: '实际原监管器状态，不是通道就绪别名。'
          }
        },
        name: {
          summary: {
            en: 'Exact registered name or prefix, never both in the same filter.',
            zh: '精确登记名称或前缀，同一过滤器不同时指定二者。'
          }
        },
        kind: {
          summary: {
            en: 'Actual configured source mode or native unit kind from the original owner.',
            zh: '原所有者提供的实际配置来源模式或原生单元类别。'
          },
          values: {
            enum: 'RpcMemberSourceKind'
          }
        },
        direction: {
          summary: {
            en: 'Actual local connect/listen/spawn direction independent of owned/borrowed lifetime.',
            zh: '实际本地连接、监听及启动方向，与拥有及借用生命周期不同。'
          },
          values: {
            enum: 'RpcMemberConnectionDirection'
          }
        }
      }
    },
    IRpcMemberListOptions: {
      summary: {
        en: 'Formatting and safe native-record filters for one passive members listing.',
        zh: '一次被动成员列表的格式及安全原生记录过滤。'
      },
      members: {
        format: {
          summary: {
            en: 'Local safe snapshot format; omission keeps own-data objects.',
            zh: '本地安全快照格式，省略时保留自有数据对象。'
          },
          default: {
            en: 'Object output.',
            zh: '对象输出。'
          },
          values: {
            json: {
              en: 'Serialize safe data as JSON text.',
              zh: '将安全数据序列化为 JSON 文本。'
            },
            yaml: {
              en: 'Serialize safe data as YAML text.',
              zh: '将安全数据序列化为 YAML 文本。'
            },
            toml: {
              en: 'Serialize safe data as TOML text.',
              zh: '将安全数据序列化为 TOML 文本。'
            }
          }
        },
        filter: {
          summary: {
            en: 'Existing name/state/kind/direction selection before sampling.',
            zh: '采样之前按现有名称、状态、种类及方向选择。'
          }
        }
      }
    },
    IRpcMemberTarget: {
      summary: {
        en: 'Exact accepted instance identity wins over registered-name lookup for strings. Object targets require matching name and instanceId.',
        zh: '字符串首先匹配精确接纳实例身份，再查登记名；对象目标要求名称及实例身份同时匹配。'
      },
      members: {
        name: {
          summary: {
            en: 'Stable native registration name; accepted private members retain their first accepted name across departure/restart.',
            zh: '稳定原生登记名称，接纳私有成员在离开及重启后保留首次接纳名称。'
          }
        },
        instanceId: {
          summary: {
            en: 'Original accepted remote instance identity, not a fabricated native fingerprint.',
            zh: '原接纳远端实例身份，不是伪造原生指纹。'
          }
        }
      }
    },
    IRpcMemberListQuery: {
      summary: {
        en: 'Local listing returns the same safe sampled projection as an object or explicitly selected text format.',
        zh: '本地列表以对象或显式文本格式返回相同安全采样投影。'
      },
      members: {}
    },
    IRpcMemberTargetQuery: {
      summary: {
        en: 'Capture the exact selected native record before awaiting sampling; a retired record never retargets its successor.',
        zh: '等待采样前捕获精确所选原生记录；退场记录不重新指向后继。'
      },
      members: {}
    },
    IRpcNativeMemberControls: {
      summary: {
        en: 'Actual native members namespace: safe queries and original supervisor controls, never business request forwarding.',
        zh: '实际原生成员命名空间：安全查询及原监管器控制，不转发业务请求。'
      },
      members: {
        list: {
          summary: {
            en: 'List safe actual native connection facts after selection and cold sampling.',
            zh: '选择及冷采样后列出安全实际原生连接事实。'
          },
          params: {
            options: {
              en: 'Optional native filters and safe output format.',
              zh: '可选原生过滤及安全输出格式。'
            }
          },
          returns: {
            en: 'Safe overview object or selected serialized text.',
            zh: '安全概览对象或所选序列化文本。'
          },
          example:
            "import type { IRpcNativeMemberControls } from '@migaia/rpc-host/sdk'\nexport function list(members: IRpcNativeMemberControls<'process'>) {\n  return members.list()\n}\n"
        },
        get: {
          summary: {
            en: 'Read one exact original native member.',
            zh: '读取一个精确原原生成员。'
          },
          params: {
            target: {
              en: 'Actual registered name/instance target; exact identity takes precedence.',
              zh: '实际登记名及实例目标，精确身份优先。'
            },
            options: {
              en: 'Optional safe local text format.',
              zh: '可选安全本地文本格式。'
            }
          },
          returns: {
            en: 'Actual selected detail or original target/retirement failure.',
            zh: '实际所选详情或原目标及退场失败。'
          },
          example:
            "import type { IRpcNativeMemberControls } from '@migaia/rpc-host/sdk'\nexport function get(members: IRpcNativeMemberControls<'process'>, name: string) {\n  return members.get(name)\n}\n"
        },
        stop: {
          summary: {
            en: 'Request the original supervisor graceful stop.',
            zh: '请求原监管器优雅停止。'
          },
          params: {
            name: {
              en: 'Exact original native registration name.',
              zh: '精确原原生登记名。'
            },
            options: {
              en: 'Original graceMs and process-only SIGTERM option; threads do not expose process signals.',
              zh: '原宽限毫秒数及仅进程可用的结束信号选项，线程不暴露进程信号。'
            }
          },
          returns: {
            en: 'Original native stop completion, preserving its Promise.',
            zh: '原生原停止完成，保留其 Promise。'
          },
          example:
            "import type { IRpcNativeMemberControls } from '@migaia/rpc-host/sdk'\nexport function stop(members: IRpcNativeMemberControls<'process'>, name: string) {\n  return members.stop(name, { graceMs: 1000, signal: 'SIGTERM' })\n}\n"
        },
        kill: {
          summary: {
            en: 'Invoke actual native force termination authority.',
            zh: '调用实际原生强制终止权限。'
          },
          params: {
            name: {
              en: 'Exact original native registration name.',
              zh: '精确原原生登记名。'
            }
          },
          returns: {
            en: 'Original native kill completion; borrowed sources cannot manufacture kill authority.',
            zh: '原生原强制终止完成，借用来源不能制造强制终止权限。'
          },
          example:
            "import type { IRpcNativeMemberControls } from '@migaia/rpc-host/sdk'\nexport function kill(members: IRpcNativeMemberControls<'process'>, name: string) {\n  return members.kill(name)\n}\n"
        },
        restart: {
          summary: {
            en: 'Join the original supervisor restart and real accepted readiness.',
            zh: '等待原监管器重启及真实接纳就绪。'
          },
          params: {
            name: {
              en: 'Exact original native registration name.',
              zh: '精确原原生登记名。'
            }
          },
          returns: {
            en: 'Original native ready outcome.',
            zh: '原生原就绪结果。'
          },
          example:
            "import type { IRpcNativeMemberControls } from '@migaia/rpc-host/sdk'\nexport function restart(members: IRpcNativeMemberControls<'process'>, name: string) {\n  return members.restart(name)\n}\n"
        },
        replace: {
          summary: {
            en: 'Submit a real native replacement specification through its original admission owner.',
            zh: '通过原准入所有者提交真实原生替换规格。'
          },
          params: {
            name: {
              en: 'Exact original native registration name.',
              zh: '精确原原生登记名。'
            },
            spec: {
              en: 'Actual replacement specification for that transport.',
              zh: '本传输的实际替换规格。'
            }
          },
          returns: {
            en: 'Original native replace outcome, with candidate failure rollback.',
            zh: '原生原替换结果，候选失败会回滚。'
          },
          example:
            "import type { IRpcNativeMemberControls } from '@migaia/rpc-host/sdk'\nexport function replace(\n  members: IRpcNativeMemberControls<'process'>,\n  name: string,\n  spec: unknown,\n) {\n  return members.replace(name, spec)\n}\n"
        },
        on: {
          summary: {
            en: 'Subscribe passively to original native lifecycle events.',
            zh: '被动订阅原生原生命周期事件。'
          },
          params: {
            event: {
              en: 'Canonical original member lifecycle event name.',
              zh: '规范原成员生命周期事件名。'
            },
            listener: {
              en: 'Receives safe event data; throw/rejection is reported outside business settlement.',
              zh: '接收安全事件数据，抛错及拒绝在业务结算之外被上报。'
            }
          },
          returns: {
            en: 'Idempotent exact listener remover.',
            zh: '幂等精确监听移除器。'
          },
          example:
            "import type { IRpcNativeMemberControls } from '@migaia/rpc-host/sdk'\nexport function on(members: IRpcNativeMemberControls<'process'>) {\n  return members.on('ready', (event) => console.log(event.name))\n}\n"
        },
        watch: {
          summary: {
            en: 'Create the original bounded passive lifecycle-event iterator.',
            zh: '创建原有界被动生命周期事件迭代器。'
          },
          params: {},
          returns: {
            en: 'Iterator released by return or receiver close; it grants no terminal-handler authority.',
            zh: '通过迭代结束或接收者关闭释放，不授予终止处理权限。'
          },
          example:
            "import type { IRpcNativeMemberControls } from '@migaia/rpc-host/sdk'\nexport function watch(members: IRpcNativeMemberControls<'process'>) {\n  return members.watch()\n}\n"
        }
      }
    },
    IRpcNativeMembersOptions: {
      summary: {
        en: 'Original native kind, actual global identity getter, source indexes and diagnostic destination.',
        zh: '原生原类别、实际全局身份读取器、来源索引及诊断通道。'
      },
      members: {
        kind: {
          summary: {
            en: 'Actual configured source mode or native unit kind from the original owner.',
            zh: '原所有者提供的实际配置来源模式或原生单元类别。'
          },
          example:
            "import { RpcNativeMembers } from '@migaia/rpc-host/sdk'\nimport type { IRpcNativeMembersOptions } from '@migaia/rpc-host/sdk'\nexport function members(options: IRpcNativeMembersOptions<'thread'>) {\n  const { self, source, report } = options\n  return new RpcNativeMembers({ kind: 'thread', self, source, report })\n}\n",
          whenToUse: {
            en: 'Publish passive controls using the concrete native family existing lookup indexes and current global identity getter.',
            zh: '使用具体原生类别已有查找索引及当前全局身份读取器发布被动控制，不复制登记或原生资源数据。'
          }
        },
        self: {
          summary: {
            en: 'Actual global Host name/instance identity captured before asynchronous query sampling.',
            zh: '异步查询采样前捕获的实际全局宿主名称及实例身份。'
          },
          example:
            "import { RpcNativeMembers } from '@migaia/rpc-host/sdk'\nimport type { IRpcNativeMembersOptions } from '@migaia/rpc-host/sdk'\nexport function members(options: IRpcNativeMembersOptions<'thread'>) {\n  const { self, source, report } = options\n  return new RpcNativeMembers({ kind: 'thread', self, source, report })\n}\n",
          whenToUse: {
            en: 'Publish passive controls using the concrete native family existing lookup indexes and current global identity getter.',
            zh: '使用具体原生类别已有查找索引及当前全局身份读取器发布被动控制，不复制登记或原生资源数据。'
          }
        },
        source: {
          summary: {
            en: 'Actual native registration source; no second lookup table is created.',
            zh: '实际原生登记来源，不创建第二查找表。'
          },
          example:
            "import { RpcNativeMembers } from '@migaia/rpc-host/sdk'\nimport type { IRpcNativeMembersOptions } from '@migaia/rpc-host/sdk'\nexport function members(options: IRpcNativeMembersOptions<'thread'>) {\n  const { self, source, report } = options\n  return new RpcNativeMembers({ kind: 'thread', self, source, report })\n}\n",
          whenToUse: {
            en: 'Publish passive controls using the concrete native family existing lookup indexes and current global identity getter.',
            zh: '使用具体原生类别已有查找索引及当前全局身份读取器发布被动控制，不复制登记或原生资源数据。'
          }
        },
        report: {
          summary: {
            en: 'Original native diagnostic destination for contained query/event errors.',
            zh: '被隔离查询及事件错误的原生原诊断通道。'
          },
          params: {
            error: {
              en: 'The original failure delivered by this owner, retaining its source, code, native class and cause chain.',
              zh: '本所有者交付的原失败，保留来源、错误码、原生类型及原因链；该值来自实际失败回调。'
            }
          },
          returns: {
            en: 'No business result is replaced; diagnostics should finish without throwing.',
            zh: '不替换业务返回结果，诊断回调应完成上报并避免再次抛错。'
          },
          example:
            "import { RpcNativeMembers } from '@migaia/rpc-host/sdk'\nimport type { IRpcNativeMembersOptions } from '@migaia/rpc-host/sdk'\nexport function members(options: IRpcNativeMembersOptions<'thread'>) {\n  const { self, source, report } = options\n  return new RpcNativeMembers({ kind: 'thread', self, source, report })\n}\n",
          whenToUse: {
            en: 'Publish passive controls using the concrete native family existing lookup indexes and current global identity getter.',
            zh: '使用具体原生类别已有查找索引及当前全局身份读取器发布被动控制，不复制登记或原生资源数据。'
          }
        }
      }
    },
    IRpcMemberEventPublisher: {
      summary: {
        en: 'One passive listener/watch owner borrowing original native events; subscribers do not become controllers.',
        zh: '借用原生原事件的唯一被动监听及观察所有者，订阅者不成为控制器。'
      },
      members: {
        on: {
          summary: {
            en: 'Subscribe passively to original native lifecycle events.',
            zh: '被动订阅原生原生命周期事件。'
          },
          params: {
            event: {
              en: 'Canonical original member lifecycle event name.',
              zh: '规范原成员生命周期事件名。'
            },
            listener: {
              en: 'Receives safe event data; throw/rejection is reported outside business settlement.',
              zh: '接收安全事件数据，抛错及拒绝在业务结算之外被上报。'
            }
          },
          returns: {
            en: 'Idempotent exact listener remover.',
            zh: '幂等精确监听移除器。'
          },
          example:
            "import { RpcMemberEventName } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberEventPublisher, IRpcMemberEvent } from '@migaia/rpc-host/sdk'\nexport function on(events: IRpcMemberEventPublisher) {\n  return events.on(RpcMemberEventName.ready, (event) => console.log(event.name))\n}\n"
        },
        watch: {
          summary: {
            en: 'Create the original bounded passive lifecycle-event iterator.',
            zh: '创建原有界被动生命周期事件迭代器。'
          },
          params: {},
          returns: {
            en: 'Iterator released by return or receiver close; it grants no terminal-handler authority.',
            zh: '通过迭代结束或接收者关闭释放，不授予终止处理权限。'
          },
          example:
            "import { RpcMemberEventName } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberEventPublisher, IRpcMemberEvent } from '@migaia/rpc-host/sdk'\nexport function watch(events: IRpcMemberEventPublisher) {\n  return events.watch()\n}\n"
        },
        publish: {
          summary: {
            en: 'Publish one actual native safe event to the existing passive subscribers.',
            zh: '向现有被动订阅者发布一个实际原生安全事件。'
          },
          params: {
            event: {
              en: 'Original safe native event projection.',
              zh: '原安全原生事件投影。'
            },
            report: {
              en: 'Original contained subscriber-failure destination.',
              zh: '被隔离订阅者失败的原通道。'
            }
          },
          returns: {
            en: 'Passive synchronous delivery; business completion is unchanged.',
            zh: '被动同步交付，业务完成不变。'
          },
          example:
            "import { RpcMemberEventName } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberEventPublisher, IRpcMemberEvent } from '@migaia/rpc-host/sdk'\nexport function publish(events: IRpcMemberEventPublisher, event: IRpcMemberEvent) {\n  return events.publish(event, console.error)\n}\n"
        },
        close: {
          summary: {
            en: 'Release passive listeners and finish outstanding watchers.',
            zh: '释放被动监听并结束待决观察迭代器。'
          },
          params: {},
          returns: {
            en: 'No native unit is stopped.',
            zh: '不停止原生单元。'
          },
          example:
            "import { RpcMemberEventName } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberEventPublisher, IRpcMemberEvent } from '@migaia/rpc-host/sdk'\nexport function close(events: IRpcMemberEventPublisher) {\n  return events.close()\n}\n"
        }
      },
      scenarios: [
        {
          en: 'Publish existing native facts to passive listeners and bounded FIFO watches.',
          zh: '向被动监听及有界先进先出观察发布已有原生事实，不向订阅者授予控制权限。'
        }
      ],
      example:
        "import { RpcMemberEventName } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberEventPublisher } from '@migaia/rpc-host/sdk'\n\nexport async function observeMembers(events: IRpcMemberEventPublisher) {\n  const remove = events.on(RpcMemberEventName.ready, (event) => console.log(event.name))\n  const iterator = events.watch()\n  try {\n    const next = await iterator.next()\n    if (!next.done) console.log(next.value.name)\n  } finally {\n    remove()\n    await iterator.return?.()\n  }\n}\n"
    },
    IRpcMemberNativeUnit: {
      summary: {
        en: 'Original optional native identity and cold usage sampler; generation identity is checked by the native source after awaiting.',
        zh: '原可选原生身份及冷用量采样器；等待后由原生来源检查代际身份。'
      },
      members: {
        identity: {
          summary: {
            en: 'Actual native pid/threadId when available.',
            zh: '可用时的实际原生进程及线程身份。'
          }
        },
        sampleUsage: {
          summary: {
            en: 'Original native cold sampler; asynchronous completion cannot retarget another unit.',
            zh: '原生原冷采样器，异步完成不能重新指向其它单元。'
          },
          params: {},
          returns: {
            en: 'The real native usage sample or explicit absence; preserve native CPU/ELU units and recheck the selected unit after awaiting.',
            zh: '返回真实原生使用采样或显式缺失；保留原生处理器及事件循环单位，等待后复核所选单元。'
          }
        }
      }
    },
    IRpcByteReader: {
      summary: {
        en: 'Already-acquired native reader; the acquiring transport retains getReader/releaseLock failure handling.',
        zh: '已获取的原生读取器，获取传输保留读取器获取及锁释放失败处理。'
      },
      members: {
        read: {
          summary: {
            en: 'Read the next ordered native chunk.',
            zh: '读取下一个有序原生字节块。'
          },
          params: {},
          returns: {
            en: 'Original done/value result.',
            zh: '原结束及值结果。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        cancel: {
          summary: {
            en: 'Cancel the original reader with its native reason.',
            zh: '以原生原因取消原读取器。'
          },
          params: {
            reason: {
              en: 'Original explicit terminal or cancellation reason.',
              zh: '原显式终止或取消原因。'
            }
          },
          returns: {
            en: 'Original native cancellation completion.',
            zh: '原生原取消完成。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        }
      }
    },
    IRpcByteWriter: {
      summary: {
        en: 'Original already-acquired native writer remains the only queue and backpressure owner.',
        zh: '原已获取原生写入器仍是唯一队列及背压所有者。'
      },
      members: {
        write: {
          summary: {
            en: 'Write the original native byte chunk.',
            zh: '将本块写入实际原生写入器，并等待其完成。'
          },
          params: {
            chunk: {
              en: 'Original ordered native Uint8Array chunk.',
              zh: '原有序原生字节块。'
            },
            options: {
              en: 'Actual carrier handoff/cancellation options.',
              zh: '实际载体交接及取消选项。'
            }
          },
          returns: {
            en: 'Original native write completion.',
            zh: '原生原写入完成。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        abort: {
          summary: {
            en: 'Abort the original writer.',
            zh: '以所给原因终止原生写入器并释放所属资源。'
          },
          params: {
            reason: {
              en: 'Original explicit terminal or cancellation reason.',
              zh: '原显式终止或取消原因。'
            }
          },
          returns: {
            en: 'Original native abort completion.',
            zh: '原生原中止完成。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        }
      }
    },
    IRpcByteIO: {
      summary: {
        en: 'Original acquired byte delivery with one physical lifetime, no request/Peer/ACK facade.',
        zh: '拥有唯一物理生命周期的原获取字节交付，不提供请求、对端或确认门面。'
      },
      members: {
        kind: {
          summary: {
            en: 'Fixed byte discriminator, not a semantic wire profile.',
            zh: '固定字节判别值，不是语义线上协议。'
          }
        },
        observation: {
          summary: {
            en: 'Original native raw observation capability, if present.',
            zh: '存在时的原生原始观察能力。'
          }
        },
        write: {
          summary: {
            en: 'Write the original native byte chunk.',
            zh: '等待真实物理字节写入完成，不把准入当成完成。'
          },
          params: {
            chunk: {
              en: 'Original ordered native Uint8Array chunk.',
              zh: '原有序原生字节块。'
            },
            options: {
              en: 'Actual carrier handoff/cancellation options.',
              zh: '实际载体交接及取消选项。'
            }
          },
          returns: {
            en: 'Original native write completion.',
            zh: '原生原写入完成。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        onData: {
          summary: {
            en: 'Subscribe before reading begins and preserve original ordered chunks.',
            zh: '在读取开始前订阅并保留原有序字节块。'
          },
          params: {
            listener: {
              en: 'Original synchronous native event receiver; unsubscribe removes this listener only.',
              zh: '原同步原生事件接收者，取消订阅只移除本监听者。'
            }
          },
          returns: {
            en: 'Exact idempotent data-listener remover.',
            zh: '精确幂等数据监听移除器。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        onClose: {
          summary: {
            en: 'Observe original physical EOF or terminal reason.',
            zh: '观察原物理输入结束或终止原因。'
          },
          params: {
            listener: {
              en: 'Original synchronous native event receiver; unsubscribe removes this listener only.',
              zh: '原同步原生事件接收者，取消订阅只移除本监听者。'
            }
          },
          returns: {
            en: 'Exact native close-listener remover.',
            zh: '精确原生关闭监听移除器。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        close: {
          summary: {
            en: 'Join the single original byte resource close.',
            zh: '等待唯一原字节资源关闭。'
          },
          params: {
            reason: {
              en: 'Original explicit terminal or cancellation reason.',
              zh: '原显式终止或取消原因。'
            }
          },
          returns: {
            en: 'Shared original close Promise.',
            zh: '共享原关闭 Promise。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        }
      }
    },
    IRpcEventByteIO: {
      summary: {
        en: 'The same actual byte IO plus a passive completed physical-write/drain observation.',
        zh: '相同实际字节读写资源，另有被动物理写入完成及排空观察。'
      },
      members: {
        kind: {
          summary: {
            en: 'Fixed byte discriminator, not a semantic wire profile.',
            zh: '固定字节判别值，不是语义线上协议。'
          }
        },
        observation: {
          summary: {
            en: 'Original native raw observation capability, if present.',
            zh: '存在时的原生原始观察能力。'
          }
        },
        write: {
          summary: {
            en: 'Write the original native byte chunk.',
            zh: '借用原生写回调及排空信号确认实际写入完成。'
          },
          params: {
            chunk: {
              en: 'Original ordered native Uint8Array chunk.',
              zh: '原有序原生字节块。'
            },
            options: {
              en: 'Actual carrier handoff/cancellation options.',
              zh: '实际载体交接及取消选项。'
            }
          },
          returns: {
            en: 'Original native write completion.',
            zh: '原生原写入完成。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        onData: {
          summary: {
            en: 'Subscribe before reading begins and preserve original ordered chunks.',
            zh: '在读取开始前订阅并保留原有序字节块。'
          },
          params: {
            listener: {
              en: 'Original synchronous native event receiver; unsubscribe removes this listener only.',
              zh: '原同步原生事件接收者，取消订阅只移除本监听者。'
            }
          },
          returns: {
            en: 'Exact idempotent data-listener remover.',
            zh: '精确幂等数据监听移除器。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        onClose: {
          summary: {
            en: 'Observe original physical EOF or terminal reason.',
            zh: '观察原物理输入结束或终止原因。'
          },
          params: {
            listener: {
              en: 'Original synchronous native event receiver; unsubscribe removes this listener only.',
              zh: '原同步原生事件接收者，取消订阅只移除本监听者。'
            }
          },
          returns: {
            en: 'Exact native close-listener remover.',
            zh: '精确原生关闭监听移除器。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        close: {
          summary: {
            en: 'Join the single original byte resource close.',
            zh: '等待唯一原字节资源关闭。'
          },
          params: {
            reason: {
              en: 'Original explicit terminal or cancellation reason.',
              zh: '原显式终止或取消原因。'
            }
          },
          returns: {
            en: 'Shared original close Promise.',
            zh: '共享原关闭 Promise。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        onWrite: {
          summary: {
            en: 'Observe actual native write completion and measured drain delay.',
            zh: '观察实际原生写入完成及实测排空延迟。'
          },
          params: {
            listener: {
              en: 'Receives the original chunk and its real native drain milliseconds.',
              zh: '接收原字节块及其真实原生排空毫秒。'
            }
          },
          returns: {
            en: 'Exact observation remover; no write queue is added.',
            zh: '精确观察移除器，不增加写入队列。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        }
      }
    },
    IRpcBytePumpOptions: {
      summary: {
        en: 'Explicit native error and observation ports for the acquired reader/writer pump.',
        zh: '已获取读写泵所用的显式原生错误及观察端口。'
      },
      members: {
        closedError: {
          summary: {
            en: 'Original native closed-resource error factory, preserving the medium semantic code and native type.',
            zh: '原生原资源关闭错误工厂，保留媒介语义错误码及原生类型。'
          },
          params: {},
          returns: {
            en: 'A coded native resource-closed Error supplied by the acquiring medium; the SDK does not invent its error domain.',
            zh: '获取媒介提供的带码原生资源关闭错误，共享工具不另行定义该错误域。'
          },
          example:
            "import { RpcBytePump } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcBytePumpOptions,\n  IRpcByteReader,\n  IRpcByteWriter,\n} from '@migaia/rpc-host/sdk'\nexport function acquired(\n  reader: IRpcByteReader,\n  writer: IRpcByteWriter,\n  closePhysical: () => void | Promise<void>,\n  options: IRpcBytePumpOptions,\n) {\n  const { closedError, report, observation, cleanupFailed } = options\n  return new RpcBytePump(reader, writer, closePhysical, {\n    closedError,\n    report,\n    observation,\n    cleanupFailed,\n  }).value\n}\n",
          whenToUse: {
            en: 'Reuse the acquiring medium original error factories, reporter and raw observer without replacing its native cleanup boundary.',
            zh: '复用获取媒介原错误工厂、上报器及原始观察器，不替换原生清理边界或复制生命周期所有者。'
          }
        },
        report: {
          summary: {
            en: 'Original native destination for contained background or cleanup failures.',
            zh: '被隔离后台及清理失败的原生原上报通道。'
          },
          params: {
            error: {
              en: 'The original failure delivered by this owner, retaining its source, code, native class and cause chain.',
              zh: '本所有者交付的原失败，保留来源、错误码、原生类型及原因链；该值来自实际失败回调。'
            }
          },
          returns: {
            en: 'No business result is replaced; diagnostics should finish without throwing.',
            zh: '不替换业务返回结果，诊断回调应完成上报并避免再次抛错。'
          },
          example:
            "import { RpcBytePump } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcBytePumpOptions,\n  IRpcByteReader,\n  IRpcByteWriter,\n} from '@migaia/rpc-host/sdk'\nexport function acquired(\n  reader: IRpcByteReader,\n  writer: IRpcByteWriter,\n  closePhysical: () => void | Promise<void>,\n  options: IRpcBytePumpOptions,\n) {\n  const { closedError, report, observation, cleanupFailed } = options\n  return new RpcBytePump(reader, writer, closePhysical, {\n    closedError,\n    report,\n    observation,\n    cleanupFailed,\n  }).value\n}\n",
          whenToUse: {
            en: 'Reuse the acquiring medium original error factories, reporter and raw observer without replacing its native cleanup boundary.',
            zh: '复用获取媒介原错误工厂、上报器及原始观察器，不替换原生清理边界或复制生命周期所有者。'
          }
        },
        observation: {
          summary: {
            en: 'Original single native raw observer emitted at actual reads/writes.',
            zh: '在实际读写点发出的原唯一原生原始观察器。'
          },
          default: {
            en: 'No raw observer is installed.',
            zh: '未安装原始读写观察器。'
          },
          example:
            "import { RpcBytePump } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcBytePumpOptions,\n  IRpcByteReader,\n  IRpcByteWriter,\n} from '@migaia/rpc-host/sdk'\nexport function acquired(\n  reader: IRpcByteReader,\n  writer: IRpcByteWriter,\n  closePhysical: () => void | Promise<void>,\n  options: IRpcBytePumpOptions,\n) {\n  const { closedError, report, observation, cleanupFailed } = options\n  return new RpcBytePump(reader, writer, closePhysical, {\n    closedError,\n    report,\n    observation,\n    cleanupFailed,\n  }).value\n}\n",
          whenToUse: {
            en: 'Reuse the acquiring medium original error factories, reporter and raw observer without replacing its native cleanup boundary.',
            zh: '复用获取媒介原错误工厂、上报器及原始观察器，不替换原生清理边界或复制生命周期所有者。'
          }
        },
        cleanupFailed: {
          summary: {
            en: 'Receives ordered original cleanup failures and returns the medium original aggregate error.',
            zh: '接收有序原清理失败并返回媒介原聚合错误。'
          },
          params: {
            errors: {
              en: 'Original cleanup failures in reader/writer/native-close order, with each original error identity retained.',
              zh: '按读取器、写入器及原生关闭顺序排列的原清理失败，保留每个原错误身份。'
            }
          },
          returns: {
            en: 'The medium-owned coded cleanup error or AggregateError whose cause/errors preserve the originals.',
            zh: '返回媒介拥有的带码清理错误或聚合错误，通过原因及子错误保留原始失败。'
          },
          example:
            "import { RpcBytePump } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcBytePumpOptions,\n  IRpcByteReader,\n  IRpcByteWriter,\n} from '@migaia/rpc-host/sdk'\nexport function acquired(\n  reader: IRpcByteReader,\n  writer: IRpcByteWriter,\n  closePhysical: () => void | Promise<void>,\n  options: IRpcBytePumpOptions,\n) {\n  const { closedError, report, observation, cleanupFailed } = options\n  return new RpcBytePump(reader, writer, closePhysical, {\n    closedError,\n    report,\n    observation,\n    cleanupFailed,\n  }).value\n}\n",
          whenToUse: {
            en: 'Reuse the acquiring medium original error factories, reporter and raw observer without replacing its native cleanup boundary.',
            zh: '复用获取媒介原错误工厂、上报器及原始观察器，不替换原生清理边界或复制生命周期所有者。'
          }
        }
      }
    },
    IRpcEventByteIOOptions: {
      summary: {
        en: 'Native emitter acquisition supplies closed-error presentation, contained reporting and optional actual raw observation.',
        zh: '原生事件获取提供关闭错误展示、被隔离上报及可选实际原始观察。'
      },
      members: {
        closedError: {
          summary: {
            en: 'Original native closed-resource error factory, preserving the medium semantic code and native type.',
            zh: '原生原资源关闭错误工厂，保留媒介语义错误码及原生类型。'
          },
          params: {},
          returns: {
            en: 'A coded native resource-closed Error supplied by the acquiring medium; the SDK does not invent its error domain.',
            zh: '获取媒介提供的带码原生资源关闭错误，共享工具不另行定义该错误域。'
          },
          example:
            "import { RpcEventByteIO } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcEventByteIOOptions,\n  IRpcEventByteReader,\n  IRpcEventByteWriter,\n} from '@migaia/rpc-host/sdk'\nexport function acquired(\n  reader: IRpcEventByteReader,\n  writer: IRpcEventByteWriter,\n  closePhysical: () => void,\n  options: IRpcEventByteIOOptions,\n) {\n  const { closedError, report, observation } = options\n  return new RpcEventByteIO(reader, writer, closePhysical, {\n    closedError,\n    report,\n    observation,\n  }).value\n}\n",
          whenToUse: {
            en: 'Reuse the acquiring medium original error factories, reporter and raw observer without replacing its native cleanup boundary.',
            zh: '复用获取媒介原错误工厂、上报器及原始观察器，不替换原生清理边界或复制生命周期所有者。'
          }
        },
        report: {
          summary: {
            en: 'Original native destination for contained background or cleanup failures.',
            zh: '被隔离后台及清理失败的原生原上报通道。'
          },
          params: {
            error: {
              en: 'The original failure delivered by this owner, retaining its source, code, native class and cause chain.',
              zh: '本所有者交付的原失败，保留来源、错误码、原生类型及原因链；该值来自实际失败回调。'
            }
          },
          returns: {
            en: 'No business result is replaced; diagnostics should finish without throwing.',
            zh: '不替换业务返回结果，诊断回调应完成上报并避免再次抛错。'
          },
          example:
            "import { RpcEventByteIO } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcEventByteIOOptions,\n  IRpcEventByteReader,\n  IRpcEventByteWriter,\n} from '@migaia/rpc-host/sdk'\nexport function acquired(\n  reader: IRpcEventByteReader,\n  writer: IRpcEventByteWriter,\n  closePhysical: () => void,\n  options: IRpcEventByteIOOptions,\n) {\n  const { closedError, report, observation } = options\n  return new RpcEventByteIO(reader, writer, closePhysical, {\n    closedError,\n    report,\n    observation,\n  }).value\n}\n",
          whenToUse: {
            en: 'Reuse the acquiring medium original error factories, reporter and raw observer without replacing its native cleanup boundary.',
            zh: '复用获取媒介原错误工厂、上报器及原始观察器，不替换原生清理边界或复制生命周期所有者。'
          }
        },
        observation: {
          summary: {
            en: 'Original single native raw observer emitted at actual reads/writes.',
            zh: '在实际读写点发出的原唯一原生原始观察器。'
          },
          default: {
            en: 'No raw observer is installed.',
            zh: '未安装原始读写观察器。'
          },
          example:
            "import { RpcEventByteIO } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcEventByteIOOptions,\n  IRpcEventByteReader,\n  IRpcEventByteWriter,\n} from '@migaia/rpc-host/sdk'\nexport function acquired(\n  reader: IRpcEventByteReader,\n  writer: IRpcEventByteWriter,\n  closePhysical: () => void,\n  options: IRpcEventByteIOOptions,\n) {\n  const { closedError, report, observation } = options\n  return new RpcEventByteIO(reader, writer, closePhysical, {\n    closedError,\n    report,\n    observation,\n  }).value\n}\n",
          whenToUse: {
            en: 'Reuse the acquiring medium original error factories, reporter and raw observer without replacing its native cleanup boundary.',
            zh: '复用获取媒介原错误工厂、上报器及原始观察器，不替换原生清理边界或复制生命周期所有者。'
          }
        }
      }
    },
    IRpcEventByteReader: {
      summary: {
        en: 'Original native emitter read port with pause/resume and exact data/end/error cleanup.',
        zh: '原生原事件读取端口，提供暂停恢复及精确数据、结束和错误清理。'
      },
      members: {
        pause: {
          summary: {
            en: 'Pause original native data delivery before installing receiver subscriptions.',
            zh: '安装接收订阅前暂停原生原数据交付。'
          },
          params: {},
          returns: {
            en: 'Original native pause return value.',
            zh: '原生原暂停返回值。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        resume: {
          summary: {
            en: 'Resume actual native data delivery after a receiver is present.',
            zh: '接收者存在后恢复实际原生数据交付。'
          },
          params: {},
          returns: {
            en: 'Original native resume return value.',
            zh: '原生原恢复返回值。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        on: {
          summary: {
            en: 'Add the exact native data listener.',
            zh: '添加精确原生数据监听者。'
          },
          params: {
            event: {
              en: 'Actual native data event name.',
              zh: '实际原生数据事件名。'
            },
            listener: {
              en: 'Original synchronous native event receiver; unsubscribe removes this listener only.',
              zh: '原同步原生事件接收者，取消订阅只移除本监听者。'
            }
          },
          returns: {
            en: 'Original native registration result.',
            zh: '原生原登记结果。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        once: {
          summary: {
            en: 'Observe an original native terminal event once.',
            zh: '只观察一次原生原终止事件。'
          },
          params: {
            event: {
              en: 'Actual end/error event from the acquiring native emitter.',
              zh: '获取原生事件端口的实际结束及错误事件。'
            },
            listener: {
              en: 'Original synchronous native event receiver; unsubscribe removes this listener only.',
              zh: '原同步原生事件接收者，取消订阅只移除本监听者。'
            }
          },
          returns: {
            en: 'Original native registration result.',
            zh: '原生原登记结果。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        off: {
          summary: {
            en: 'Remove the exact original native listener.',
            zh: '移除精确原原生监听者。'
          },
          params: {
            event: {
              en: 'The same original event name used for subscription.',
              zh: '订阅使用的同一原事件名。'
            },
            listener: {
              en: 'Original synchronous native event receiver; unsubscribe removes this listener only.',
              zh: '原同步原生事件接收者，取消订阅只移除本监听者。'
            }
          },
          returns: {
            en: 'Original native removal result; failures remain observable.',
            zh: '原生原移除结果，失败仍可观察。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        }
      }
    },
    IRpcEventByteWriter: {
      summary: {
        en: 'Native callback settlement and false-write drain are independent; both original protocols are retained.',
        zh: '原生回调结算与写入返回假值的排空互相独立，保留两种原协议。'
      },
      members: {
        write: {
          summary: {
            en: 'Perform one actual native write with its original settlement callback.',
            zh: '使用原结算回调执行一次实际原生写入。'
          },
          params: {
            chunk: {
              en: 'Original ordered native Uint8Array chunk.',
              zh: '原有序原生字节块。'
            },
            settled: {
              en: 'Original callback receives the real native error or successful null/undefined.',
              zh: '原回调接收真实原生错误，或表示成功的空值。'
            }
          },
          returns: {
            en: 'Original native boolean/backpressure result.',
            zh: '原生原布尔背压结果。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        once: {
          summary: {
            en: 'Observe an original native terminal event once.',
            zh: '只观察一次原生原终止事件。'
          },
          params: {
            event: {
              en: 'Actual native error/close/drain/finish event.',
              zh: '实际原生错误、关闭、排空及完成事件。'
            },
            listener: {
              en: 'Original synchronous native event receiver; unsubscribe removes this listener only.',
              zh: '原同步原生事件接收者，取消订阅只移除本监听者。'
            }
          },
          returns: {
            en: 'Original native registration result.',
            zh: '原生原登记结果。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        },
        off: {
          summary: {
            en: 'Remove the exact original native listener.',
            zh: '移除精确原原生监听者。'
          },
          params: {
            event: {
              en: 'The same original event name used for subscription.',
              zh: '订阅使用的同一原事件名。'
            },
            listener: {
              en: 'Original synchronous native event receiver; unsubscribe removes this listener only.',
              zh: '原同步原生事件接收者，取消订阅只移除本监听者。'
            }
          },
          returns: {
            en: 'Original native removal result; failures remain observable.',
            zh: '原生原移除结果，失败仍可观察。'
          },
          example:
            "import type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport async function release(io: IRpcByteIO) {\n  await io.close()\n}\n"
        }
      }
    },
    IRpcEntryOptions: {
      summary: {
        en: 'Native owner snapshots for process/thread entry resolution; this resolver does not inspect caller stacks or runtime globals.',
        zh: '进程及线程入口解析使用的原生所有者快照，解析器不检查调用栈或运行时全局。'
      },
      members: {
        mainEntry: {
          summary: {
            en: 'Actual current main entry supplied by native acquisition.',
            zh: '原生获取提供的实际当前主入口。'
          },
          default: {
            en: 'No main entry snapshot.',
            zh: '无主入口快照。'
          },
          example:
            "import { resolveRpcEntry } from '@migaia/rpc-host/sdk'\nexport const workerEntry = resolveRpcEntry('./worker.ts', {\n  mainEntry: import.meta.url,\n  base: import.meta.url,\n  execArgv: [],\n  electron: false,\n  singleBinary: false,\n  selfAllowed: false,\n})\n",
          whenToUse: {
            en: 'Resolve an explicit worker URL with acquisition-time platform facts; do not infer caller stacks or permit unsupported self spawning.',
            zh: '使用获取时平台事实解析显式工作入口，不推断调用栈或允许不受支持的自身启动。'
          }
        },
        base: {
          summary: {
            en: 'Explicit URL base for relative entry strings.',
            zh: '相对入口字符串的显式地址基础。'
          },
          default: {
            en: 'Main entry directory when available.',
            zh: '可用时使用主入口目录。'
          },
          example:
            "import { resolveRpcEntry } from '@migaia/rpc-host/sdk'\nexport const workerEntry = resolveRpcEntry('./worker.ts', {\n  mainEntry: import.meta.url,\n  base: import.meta.url,\n  execArgv: [],\n  electron: false,\n  singleBinary: false,\n  selfAllowed: false,\n})\n",
          whenToUse: {
            en: 'Resolve an explicit worker URL with acquisition-time platform facts; do not infer caller stacks or permit unsupported self spawning.',
            zh: '使用获取时平台事实解析显式工作入口，不推断调用栈或允许不受支持的自身启动。'
          }
        },
        execArgv: {
          summary: {
            en: 'Original runtime loader/entry flags from native launch.',
            zh: '原生启动的原运行时加载及入口参数。'
          },
          default: {
            en: 'No native flag snapshot.',
            zh: '无原生参数快照。'
          },
          example:
            "import { resolveRpcEntry } from '@migaia/rpc-host/sdk'\nexport const workerEntry = resolveRpcEntry('./worker.ts', {\n  mainEntry: import.meta.url,\n  base: import.meta.url,\n  execArgv: [],\n  electron: false,\n  singleBinary: false,\n  selfAllowed: false,\n})\n",
          whenToUse: {
            en: 'Resolve an explicit worker URL with acquisition-time platform facts; do not infer caller stacks or permit unsupported self spawning.',
            zh: '使用获取时平台事实解析显式工作入口，不推断调用栈或允许不受支持的自身启动。'
          }
        },
        electron: {
          summary: {
            en: 'Actual Electron runtime fact supplied by its owner.',
            zh: '所有者提供的实际桌面运行时事实。'
          },
          default: {
            en: 'false.',
            zh: '默认未启用该原生模式。'
          },
          example:
            "import { resolveRpcEntry } from '@migaia/rpc-host/sdk'\nexport const workerEntry = resolveRpcEntry('./worker.ts', {\n  mainEntry: import.meta.url,\n  base: import.meta.url,\n  execArgv: [],\n  electron: false,\n  singleBinary: false,\n  selfAllowed: false,\n})\n",
          whenToUse: {
            en: 'Resolve an explicit worker URL with acquisition-time platform facts; do not infer caller stacks or permit unsupported self spawning.',
            zh: '使用获取时平台事实解析显式工作入口，不推断调用栈或允许不受支持的自身启动。'
          }
        },
        singleBinary: {
          summary: {
            en: 'Actual native single-binary execution mode.',
            zh: '实际原生单二进制执行模式。'
          },
          default: {
            en: 'false.',
            zh: '默认未启用该原生模式。'
          },
          example:
            "import { resolveRpcEntry } from '@migaia/rpc-host/sdk'\nexport const workerEntry = resolveRpcEntry('./worker.ts', {\n  mainEntry: import.meta.url,\n  base: import.meta.url,\n  execArgv: [],\n  electron: false,\n  singleBinary: false,\n  selfAllowed: false,\n})\n",
          whenToUse: {
            en: 'Resolve an explicit worker URL with acquisition-time platform facts; do not infer caller stacks or permit unsupported self spawning.',
            zh: '使用获取时平台事实解析显式工作入口，不推断调用栈或允许不受支持的自身启动。'
          }
        },
        selfAllowed: {
          summary: {
            en: 'Original native admission permits supported self spawning, never interpreter/test harness guesses.',
            zh: '原生原准入允许受支持自身启动，不猜测解释器或测试控制器。'
          },
          default: {
            en: 'No explicit override; actual main-entry and native flag checks still apply.',
            zh: '不显式覆盖，实际主入口及原生参数检查仍适用。'
          },
          example:
            "import { resolveRpcEntry } from '@migaia/rpc-host/sdk'\nexport const workerEntry = resolveRpcEntry('./worker.ts', {\n  mainEntry: import.meta.url,\n  base: import.meta.url,\n  execArgv: [],\n  electron: false,\n  singleBinary: false,\n  selfAllowed: false,\n})\n",
          whenToUse: {
            en: 'Resolve an explicit worker URL with acquisition-time platform facts; do not infer caller stacks or permit unsupported self spawning.',
            zh: '使用获取时平台事实解析显式工作入口，不推断调用栈或允许不受支持的自身启动。'
          }
        }
      }
    },
    IRpcLaunchFacts: {
      summary: {
        en: 'Trusted cold parent identity and the original reserved native execution generation. Only the exact original launch context receives these facts.',
        zh: '可信冷父端身份及原保留原生执行代际，只有精确原启动上下文接收这些事实。'
      },
      members: {
        parent: {
          summary: {
            en: 'Actual launching Host name and instance identity.',
            zh: '实际启动宿主名称及实例身份。'
          }
        },
        generation: {
          summary: {
            en: 'Original reserved native generation tuple.',
            zh: '由可信原生启动所有者提供的实际执行代际。'
          }
        },
        childName: {
          summary: {
            en: 'Original selected registration name for native child bootstrap, when explicitly chosen.',
            zh: '显式选择时用于原生子端启动的原所选登记名。'
          }
        }
      },
      scenarios: [
        {
          en: 'Keep trusted parent identity and reserved generation on the original launch request until acquisition settles.',
          zh: '仅在获取结算前于原启动请求保留可信父端身份及执行代际，业务载荷不能产生这些事实。'
        }
      ],
      example:
        "import { withRpcLaunchFacts } from '@migaia/rpc-host/sdk'\nimport type { IRpcLaunchFacts } from '@migaia/rpc-host/sdk'\nexport function launch<T>(\n  context: object,\n  facts: IRpcLaunchFacts,\n  start: () => Promise<T>,\n) {\n  return withRpcLaunchFacts(context, facts, start)\n}\n"
    },
    HostObservationKind: {
      summary: {
        en: 'Actual accepted Session lifecycle observations; installing a subscriber does not create lifecycle authority.',
        zh: '实际接纳会话生命周期观察，安装订阅者不会创建生命周期权限。'
      },
      members: {}
    },
    RpcProtocolEvent: {
      summary: {
        en: 'Readonly protocol/control observations consumed through the actual observer boundary.',
        zh: '通过实际观察边界消费的只读协议及控制观察。'
      },
      members: {}
    },
    RpcBinaryStorage: {
      summary: {
        en: 'The acquired native media chooses the binary manifest representation; payload flags do not grant transfer.',
        zh: '已获取原生媒介选择二进制清单表示，载荷标记不授予转移权限。'
      },
      members: {}
    },
    RpcMemberSourceKind: {
      summary: {
        en: 'Actual native source acquisition mode, independent of connection direction.',
        zh: '实际原生来源获取模式，与连接方向不同。'
      },
      members: {}
    },
    RpcMemberConnectionDirection: {
      summary: {
        en: 'Actual local/bootstrap direction, independent of owned or borrowed lifetime.',
        zh: '实际本地及启动方向，与拥有或借用生命周期不同。'
      },
      members: {}
    },
    RpcMemberQueryStatus: {
      summary: {
        en: 'Safe actual connection availability; missing observations remain explicit.',
        zh: '安全实际连接可用性，缺失观察保持显式。'
      },
      members: {}
    },
    RpcMemberQueryReason: {
      summary: {
        en: 'Canonical explanations for unavailable native/member observations without invented healthy/zero values.',
        zh: '原生及成员观察不可用的规范说明，不伪造健康或零值。'
      },
      members: {}
    },
    RpcMemberResourceKind: {
      summary: {
        en: 'Native CPU time and event-loop utilization are separate resource dimensions.',
        zh: '原生处理器时间及事件循环使用率是不同资源维度。'
      },
      members: {}
    },
    RpcMemberMetricScope: {
      summary: {
        en: 'Metric denominators identify actual source scope rather than attributing global totals to a peer.',
        zh: '指标分母标明实际来源作用域，不把全局总量归给某对端。'
      },
      members: {}
    },
    RpcMemberMetricUnit: {
      summary: {
        en: 'Explicit units keep counts, time, bytes and ratios separate.',
        zh: '显式单位使数量、时间、字节及比例保持区别。'
      },
      members: {}
    },
    RpcMemberRecentKind: {
      summary: {
        en: 'Bounded original registration-departure facts do not manufacture native exit state.',
        zh: '有界原登记离开事实不会制造原生退出状态。'
      },
      members: {}
    },
    RpcMemberEventName: {
      summary: {
        en: 'Passive member events come from original native lifecycle or completed explicit liquidation.',
        zh: '被动成员事件来自原原生生命周期或已完成显式清算。'
      },
      members: {}
    },
    RpcMemberQueryClock: {
      summary: {
        en: 'Original monotonic scheduler timestamps do not use wall-clock epoch time.',
        zh: '原单调调度时间戳不使用墙上时钟纪元时间。'
      },
      members: {}
    },
    RpcMemberQueryLimit: {
      summary: {
        en: 'The original passive recent/watch retention bound, not provider concurrency.',
        zh: '原被动历史及观察保留上限，不是提供方并发。'
      },
      members: {}
    },
    RpcNativeMemberKind: {
      summary: {
        en: 'Original native capability family determines the existing control/sampling boundary.',
        zh: '原原生能力类别决定既有控制及采样边界。'
      },
      members: {}
    },
    RpcNativeFeatureKind: {
      summary: {
        en: 'Concrete native transport installs the complete same-medium resource feature.',
        zh: '具体原生传输安装完整同媒介资源功能。'
      },
      members: {}
    },
    IRpcPreparedMessage: {
      summary: {
        en: 'Codec-owned prepared metadata is authenticated before original native values are restored.',
        zh: '编解码器持有的预备元数据，原生值恢复前先完成认证。'
      },
      members: {},
      scenarios: [
        {
          en: 'Run real envelope hooks between preparation and encoding; authenticate before restoration.',
          zh: '在准备和编码之间执行真实信封介入，入站数据先认证，再恢复语义及原缓冲区。'
        }
      ],
      example:
        "import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'\nimport type { IRpcCodecContext } from '@migaia/rpc-host/sdk'\nimport type { IRpcSemanticFrame } from '@migaia/rpc-contract/interfaces'\nexport async function roundTrip(frame: IRpcSemanticFrame, context: IRpcCodecContext) {\n  const codec = new RpcJsonCarrierCodec()\n  const prepared = await codec.prepare(frame, context)\n  const wire = codec.encode(prepared, context)\n  const decoded = codec.decode(wire, context)\n  return codec.restore(decoded, context)\n}\n"
    },
    IRpcPrivateSession: {
      summary: {
        en: 'Original physical Session lends private native IO/control without public target publication.',
        zh: '原物理会话借出内部原生输入输出及控制，不发布公共目标。'
      },
      members: {},
      scenarios: [
        {
          en: 'Borrow the selected actual pool member Session while namespace indexes expose only one logical target.',
          zh: '借用池选中的真实成员会话，命名空间索引仅公开一个逻辑目标，不公开成员调用门面。'
        }
      ],
      example:
        "import type { IRpcNativePoolMember } from '@migaia/rpc-host/sdk'\nexport async function drainSelected(member: IRpcNativePoolMember) {\n  const session = await member.ready()\n  await session.ping()\n  await session.drain(1000)\n}\n"
    },
    IRpcSessionHandle: {
      summary: {
        en: 'The actual Session lends original ready/closed Promises and its stable close operation.',
        zh: '实际会话借出原就绪、关闭异步结果及稳定关闭操作。'
      },
      members: {},
      example:
        "import type { IRpcTransportSetupContext, IRpcCarrier } from '@migaia/rpc-host/sdk'\nexport async function attach(context: IRpcTransportSetupContext, carrier: IRpcCarrier) {\n  const handle = context.attach(carrier)\n  await handle.ready\n  return handle\n}\n"
    }
  },
  enums: {
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
    HostObservationKind: {
      summary: {
        en: 'Actual accepted Session lifecycle observations; installing a subscriber does not create lifecycle authority.',
        zh: '实际接纳会话生命周期观察，安装订阅者不会创建生命周期权限。'
      },
      values: {
        peerReady: {
          en: 'The physical handshake and directory were admitted and published.',
          zh: '物理握手及目录已接纳并发布。'
        },
        peerLeave: {
          en: 'The exact physical generation retired from Host work owners.',
          zh: '精确物理代际已从宿主工作所有者退场。'
        }
      }
    },
    RpcProtocolEvent: {
      summary: {
        en: 'Readonly protocol/control observations consumed through the actual observer boundary.',
        zh: '通过实际观察边界消费的只读协议及控制观察。'
      },
      values: {
        unknownField: {
          en: 'An ignored unknown protocol field was observed by its canonical owner.',
          zh: '规范所有者观察到一个被忽略的未知协议字段。'
        },
        peerClosing: {
          en: 'The peer announced an actual relative drain window.',
          zh: '对端公告了实际相对排空窗口。'
        }
      }
    },
    RpcBinaryStorage: {
      summary: {
        en: 'The acquired native media chooses the binary manifest representation; payload flags do not grant transfer.',
        zh: '已获取原生媒介选择二进制清单表示，载荷标记不授予转移权限。'
      },
      values: {
        inline: {
          en: 'Use canonical JSON-safe inline bytes.',
          zh: '使用规范可用于 JSON 的内联字节。'
        },
        native: {
          en: 'Retain original complete native backing sidecars.',
          zh: '保留原完整原生缓冲区附带列表。'
        }
      }
    },
    RpcMemberSourceKind: {
      summary: {
        en: 'Actual native source acquisition mode, independent of connection direction.',
        zh: '标记原生来源实际获取模式，与连接方向及资源所有权分别描述。'
      },
      values: {
        spawn: {
          en: 'This source acquired an owned launch.',
          zh: '本来源通过拥有的启动获取。'
        },
        connect: {
          en: 'This source initiated a native connection.',
          zh: '来源通过主动建立原生连接获取资源。'
        },
        listen: {
          en: 'This source accepted native connections.',
          zh: '来源通过原生监听器接纳连接资源。'
        }
      }
    },
    RpcMemberConnectionDirection: {
      summary: {
        en: 'Actual local/bootstrap direction, independent of owned or borrowed lifetime.',
        zh: '实际本地及启动方向，与拥有或借用生命周期不同。'
      },
      values: {
        spawned: {
          en: 'This owner launched the remote execution unit.',
          zh: '本所有者启动了远端执行单元。'
        },
        spawnedBy: {
          en: 'This child uses its trusted launching-parent bootstrap.',
          zh: '本子端使用可信启动父端连接。'
        },
        connect: {
          en: 'This side initiated the connection.',
          zh: '本端主动发起并获取该原生连接。'
        },
        listen: {
          en: 'This side accepted the connection.',
          zh: '本端从原生监听器接纳该连接。'
        }
      }
    },
    RpcMemberQueryStatus: {
      summary: {
        en: 'Safe actual connection availability; missing observations remain explicit.',
        zh: '表达真实连接当前可用状态，所有者没有观察时明确标记缺失。'
      },
      values: {
        unavailable: {
          en: 'No actual owner fact exists for this query field.',
          zh: '本查询字段没有实际所有者事实。'
        },
        ready: {
          en: 'The original connection is actually accepted and usable.',
          zh: '原连接实际已接纳且可用。'
        },
        closed: {
          en: 'The original owner completed terminal close.',
          zh: '原所有者已完成终止关闭。'
        },
        departed: {
          en: 'The original accepted generation left.',
          zh: '此原接纳连接代际已经离开当前登记。'
        }
      }
    },
    RpcMemberQueryReason: {
      summary: {
        en: 'Canonical explanations for unavailable native/member observations without invented healthy/zero values.',
        zh: '原生及成员观察不可用的规范说明，不伪造健康或零值。'
      },
      values: {
        localUnit: {
          en: 'No local execution unit was observed.',
          zh: '没有观察到本地执行单元。'
        },
        owner: {
          en: 'The actual owner cannot supply this fact.',
          zh: '实际所有者不能提供此事实。'
        },
        health: {
          en: 'No native health fact is connected.',
          zh: '没有当前真实原生健康检查结果可供展示。'
        },
        restarts: {
          en: 'No original restart count was observed.',
          zh: '原生所有者未提供可采信的重启计数。'
        },
        counters: {
          en: 'No canonical counter owner supplies this value.',
          zh: '没有规范计数所有者提供此值。'
        },
        resources: {
          en: 'Native resource sampling is not connected.',
          zh: '当前原生媒介不提供该资源采样能力。'
        },
        retired: {
          en: 'The exact selected native unit retired during its async sample.',
          zh: '精确所选原生单元在异步采样期间退场。'
        },
        native: {
          en: 'Native API or OS permission cannot supply this resource fact.',
          zh: '原生接口或系统权限不能提供此资源事实。'
        }
      }
    },
    RpcMemberResourceKind: {
      summary: {
        en: 'Native CPU time and event-loop utilization are separate resource dimensions.',
        zh: '原生处理器时间及事件循环使用率是不同资源维度。'
      },
      values: {
        cpuTime: {
          en: 'Original user/system CPU time.',
          zh: '原用户及系统处理器时间。'
        },
        elu: {
          en: 'Original event-loop active/idle and utilization observations.',
          zh: '原事件循环活动、空闲及使用率观察。'
        }
      }
    },
    RpcMemberMetricScope: {
      summary: {
        en: 'Metric denominators identify actual source scope rather than attributing global totals to a peer.',
        zh: '指标分母标明实际来源作用域，不把全局总量归给某对端。'
      },
      values: {
        client: {
          en: 'Canonical local client work.',
          zh: '指标属于本地客户端观察而非远端单元。'
        },
        unit: {
          en: 'This original execution unit.',
          zh: '指标属于当前精确所选原生执行单元。'
        },
        process: {
          en: 'Actual native process scope.',
          zh: '指标采样覆盖原生进程实际资源范围。'
        },
        thread: {
          en: 'Actual native thread scope.',
          zh: '指标采样仅覆盖原生工作线程范围。'
        }
      }
    },
    RpcMemberMetricUnit: {
      summary: {
        en: 'Explicit units keep counts, time, bytes and ratios separate.',
        zh: '指标单位区分次数、字节、时间与无量纲比例，不能互相推算。'
      },
      values: {
        calls: {
          en: 'Count actual calls observed by the metric owner.',
          zh: '以实际观察到的调用次数表达指标。'
        },
        bytes: {
          en: 'Observed native memory bytes.',
          zh: '观察到的原生内存字节。'
        },
        microseconds: {
          en: 'Native CPU time in microseconds.',
          zh: '以原生处理器消耗的微秒时间表达。'
        },
        milliseconds: {
          en: 'Original monotonic/event-loop milliseconds.',
          zh: '原单调及事件循环毫秒。'
        },
        ratio: {
          en: 'Dimensionless utilization ratio.',
          zh: '使用无量纲比例表达实际利用程度。'
        },
        checks: {
          en: 'Original health-check count.',
          zh: '以原健康检查所有者的检查次数表达。'
        },
        restarts: {
          en: 'Original supervisor restart count.',
          zh: '以原监管器观察到的重启次数表达。'
        }
      }
    },
    RpcMemberRecentKind: {
      summary: {
        en: 'Bounded original registration-departure facts do not manufacture native exit state.',
        zh: '记录有界原登记离开事实，不制造未观察到的原生退出状态。'
      },
      values: {
        departed: {
          en: 'This original connection generation left.',
          zh: '记录原连接代际离开而非伪造单元退出。'
        }
      }
    },
    RpcMemberEventName: {
      summary: {
        en: 'Passive member events come from original native lifecycle or completed explicit liquidation.',
        zh: '被动成员事件来自原原生生命周期或已完成显式清算。'
      },
      values: {
        ready: {
          en: 'Real Session readiness committed.',
          zh: '原生代际及真实会话接纳完成后发出。'
        },
        exit: {
          en: 'The original native unit exited.',
          zh: '原监管器观察到执行单元实际退出。'
        },
        degraded: {
          en: 'Original supervisor reports degradation.',
          zh: '原执行单元报告可观察的降级原因。'
        },
        restart: {
          en: 'Original supervisor records a restart.',
          zh: '原监管器启动真实重启并携带重启计数。'
        },
        terminal: {
          en: 'Original supervisor becomes terminal.',
          zh: '原监管器进入终止状态。'
        },
        liquidated: {
          en: 'Original native control completes explicit liquidation.',
          zh: '原生原控制完成显式清算。'
        }
      }
    },
    RpcMemberQueryClock: {
      summary: {
        en: 'Original monotonic scheduler timestamps do not use wall-clock epoch time.',
        zh: '查询时间使用原调度器单调时钟域，不能当作纪元时间比较。'
      },
      values: {
        scheduler: {
          en: 'Use the original native scheduler clock domain.',
          zh: '使用原生原调度器时钟域。'
        }
      }
    },
    RpcMemberQueryLimit: {
      summary: {
        en: 'The original passive recent/watch retention bound, not provider concurrency.',
        zh: '限制原生被动历史及观察保留量，与提供方并发配额相互独立。'
      },
      values: {
        recent: {
          en: 'Retain at most100 original safe departure records.',
          zh: '至多保留一百条原安全离开记录。'
        }
      }
    },
    RpcNativeMemberKind: {
      summary: {
        en: 'Original native capability family determines the existing control/sampling boundary.',
        zh: '原生能力类别决定已有控制及采样边界，不提供跨媒介能力猜测。'
      },
      values: {
        process: {
          en: 'Native process controls and resources.',
          zh: '提供原生进程控制及其真实资源采样。'
        },
        thread: {
          en: 'Native thread controls without process crash isolation.',
          zh: '原生线程控制，不提供进程崩溃隔离。'
        },
        coroutine: {
          en: 'Cooperative in-process task controls.',
          zh: '提供进程内协作任务控制而非系统隔离。'
        }
      }
    },
    RpcNativeFeatureKind: {
      summary: {
        en: 'Concrete native transport installs the complete same-medium resource feature.',
        zh: '由具体原生传输安装完整同媒介资源功能，宿主不执行池调度。'
      },
      values: {
        pool: {
          en: 'Actual repeated native acquisition and Pool scheduler.',
          zh: '实际重复原生获取及池调度器。'
        }
      }
    }
  },
  enhancers: {
    auth: {
      kind: 'plugin',
      target: 'IRpcHostOptions.plugins',
      summary: {
        en: 'Complete paired transforms and optional explicit handshake credential capabilities captured by auth. Native acquisition and accepted identity remain separate owners.',
        zh: '认证插件捕获的完整成对转换及可选显式握手凭据能力；原生获取和接纳身份仍由不同所有者管理。'
      },
      install:
        "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\n\nexport function signed(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encodedType: 'string' })\n}\n",
      example:
        "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\n\nexport function signed(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encodedType: 'string' })\n}\n",
      grants: [],
      scenarios: [
        {
          en: 'Install before the first transport starts and restrict namespaces when the policy should apply only to selected links.',
          zh: '在首个传输启动前安装；仅需作用于选中链路时限定命名空间。'
        }
      ],
      behaviors: [
        {
          en: 'Handshake credentials and paired envelope transforms run in the installed flow. Authentication completes before provider dispatch; acquisition of native credentials remains explicit.',
          zh: '安装后在信息流执行握手凭据及成对信封转换，在提供方分派前完成认证；原生凭据获取仍须显式提供。'
        }
      ]
    },
    chunk: {
      kind: 'plugin',
      target: 'IRpcHostOptions.plugins',
      summary: {
        en: 'Bounded chunk retention and timer capabilities used only by the installed chunk implementation.',
        zh: '仅由已安装分片实现使用的有界保留及计时能力。'
      },
      install:
        "import chunk from '@migaia/rpc-host/plugins/chunk'\nexport const framing = chunk({ chunkBytes: 16384, maxMessageBytes: 16777216 })\n",
      example:
        "import chunk from '@migaia/rpc-host/plugins/chunk'\nexport const framing = chunk({ chunkBytes: 16384, maxMessageBytes: 16777216 })\n",
      grants: [],
      scenarios: [
        {
          en: 'Install before the first transport starts and restrict namespaces when the policy should apply only to selected links.',
          zh: '在首个传输启动前安装；仅需作用于选中链路时限定命名空间。'
        }
      ],
      behaviors: [
        {
          en: 'Peers negotiate chunk support; oversized eligible messages become bounded fragments and the receiver expires unfinished assemblies per source.',
          zh: '双方协商分片能力，将合格大消息拆成有界片段，并由接收方按来源清理过期的未完成组装。'
        }
      ]
    },
    batch: {
      kind: 'plugin',
      target: 'IRpcHostOptions.plugins',
      summary: {
        en: 'Cold namespace and negotiation requirements for physical batch@1. No provider or application grouping policy is installed.',
        zh: '物理合帧的冷命名空间及协商要求，不安装提供方或应用分组策略。'
      },
      install:
        "import batch from '@migaia/rpc-host/plugins/batch'\nexport const batching = batch({ required: false })\n",
      example:
        "import batch from '@migaia/rpc-host/plugins/batch'\nexport const batching = batch({ required: false })\n",
      grants: [],
      scenarios: [
        {
          en: 'Install before the first transport starts and restrict namespaces when the policy should apply only to selected links.',
          zh: '在首个传输启动前安装；仅需作用于选中链路时限定命名空间。'
        }
      ],
      behaviors: [
        {
          en: 'Eligible physical writes are coalesced after semantic admission while each logical write retains its own cancellation and physical completion.',
          zh: '在语义准入后合并合格物理写入，各逻辑写入仍保留自己的取消及物理完成结果，不形成应用事务。'
        }
      ]
    },
    limits: {
      kind: 'plugin',
      target: 'IRpcHostOptions.plugins',
      summary: {
        en: 'Shared provider concurrency and optional per-connection governance; unrelated to native execution-unit or pool capacity.',
        zh: '共享提供方并发及可选连接治理，与原生执行单元或池容量不同。'
      },
      install:
        "import limits from '@migaia/rpc-host/plugins/limits'\nexport const capacity = limits()\n",
      example:
        "import limits from '@migaia/rpc-host/plugins/limits'\nexport const capacity = limits()\n",
      grants: [],
      scenarios: [
        {
          en: 'Install before the first transport starts and restrict namespaces when the policy should apply only to selected links.',
          zh: '在首个传输启动前安装；仅需作用于选中链路时限定命名空间。'
        }
      ],
      behaviors: [
        {
          en: 'Provider admission enforces the configured concurrency, rate, payload and idle policies. Rejection is observable through onRejected before business execution.',
          zh: '提供方准入执行所配置的并发、速率、载荷及空闲策略，在业务执行前通过拒绝回调公开真实拒绝原因。'
        }
      ]
    },
    schema: {
      kind: 'plugin',
      target: 'IRpcHostOptions.plugins',
      summary: {
        en: 'Explicit parser table keyed by real method path; local declarations remain inert metadata without this installed plugin.',
        zh: '按实际方法路径索引的显式解析器表；不安装本插件时，本地声明保持惰性元数据。'
      },
      install:
        "import schema from '@migaia/rpc-host/plugins/schema'\nexport const validation = schema()\n",
      example:
        "import schema from '@migaia/rpc-host/plugins/schema'\nexport const validation = schema()\n",
      grants: [],
      scenarios: [
        {
          en: 'Install before the first transport starts and restrict namespaces when the policy should apply only to selected links.',
          zh: '在首个传输启动前安装；仅需作用于选中链路时限定命名空间。'
        }
      ],
      behaviors: [
        {
          en: 'Selected application parsers validate provider inputs and results at dispatch boundaries; invalid data fails the current invocation.',
          zh: '所选应用解析器在分派边界校验提供方输入及结果，无效数据使当前调用失败，不替换传输编解码器。'
        }
      ]
    },
    typegen: {
      kind: 'plugin',
      target: 'IRpcHostOptions.plugins',
      summary: {
        en: 'Output capability and namespace filter for one type-generation observer.',
        zh: '一次类型生成观察所用的输出能力及命名空间过滤。'
      },
      install:
        "import typegen from '@migaia/rpc-host/plugins/typegen'\nexport const declarations = typegen({\n  out: { write: (name, text) => console.log(name, text) },\n})\n",
      example:
        "import typegen from '@migaia/rpc-host/plugins/typegen'\nexport const declarations = typegen({\n  out: { write: (name, text) => console.log(name, text) },\n})\n",
      grants: [],
      scenarios: [
        {
          en: 'Install before the first transport starts and restrict namespaces when the policy should apply only to selected links.',
          zh: '在首个传输启动前安装；仅需作用于选中链路时限定命名空间。'
        }
      ],
      behaviors: [
        {
          en: 'Accepted peerReady directories are rendered to the configured output writer; directory refresh does not pretend to be another readiness event.',
          zh: '将真实对端就绪目录渲染到已配置输出写入器；目录刷新不会伪装成另一个就绪事件或生成执行代码。'
        }
      ]
    },
    idempotency: {
      kind: 'plugin',
      target: 'IRpcHostOptions.plugins',
      summary: {
        en: 'Installed store, scope selection and namespace outcome extension; automatic replay policy is not granted merely by declaring a key.',
        zh: '已安装存储、作用域选择及命名空间结果扩展；仅声明键不会授予自动重放策略。'
      },
      install:
        "import idempotency from '@migaia/rpc-host/plugins/idempotency'\nexport const outcomes = idempotency({ retentionMs: 300000 })\n",
      example:
        "import idempotency from '@migaia/rpc-host/plugins/idempotency'\nexport const outcomes = idempotency({ retentionMs: 300000 })\n",
      grants: [
        {
          signature: 'host.<namespace>.outcome(idempotencyKey, options?)',
          summary: {
            en: 'Query only retained outcome facts from the actual installed store; a lookup itself does not claim or execute work.',
            zh: '只查询实际安装存储所保留的结果事实，查询本身不认领或执行工作。'
          },
          params: {
            idempotencyKey: {
              en: 'Original application/retry-issued logical key used for reconciliation.',
              zh: '用于核对的应用及重试原签发逻辑键。'
            },
            options: {
              en: 'Normal complete call overrides and cancellation for this query.',
              zh: '本查询的正常完整调用覆盖及取消。'
            }
          },
          returns: {
            en: 'Pending/unknown/done facts for one target or independent target maps. Unknown is not permission to replay side effects.',
            zh: '一个目标的待决、未知及完成事实，或独立目标字典；未知不代表可以重放副作用。'
          },
          example:
            "import type { IRpcOutcomeLookup } from '@migaia/rpc-host/plugins/idempotency'\n\nexport function reconcile(outcome: IRpcOutcomeLookup, key: string) {\n  return outcome(key)\n}\n"
        }
      ],
      scenarios: [
        {
          en: 'Install before the first transport starts and restrict namespaces when the policy should apply only to selected links.',
          zh: '在首个传输启动前安装；仅需作用于选中链路时限定命名空间。'
        }
      ]
    },
    probe: {
      kind: 'plugin',
      target: 'IRpcHostOptions.plugins',
      summary: {
        en: 'Install actual readonly observation; no carrier, provider or business lifecycle is created by the observer.',
        zh: '安装实际只读观察；观察器不创建载体、提供方或业务生命周期。'
      },
      install:
        "import probe from '@migaia/rpc-host/plugins/probe'\nexport const observation = probe({\n  stages: ['message'],\n  emit: (view) => console.log({ ...view }),\n})\n",
      example:
        "import probe from '@migaia/rpc-host/plugins/probe'\nexport const observation = probe({\n  stages: ['message'],\n  emit: (view) => console.log({ ...view }),\n})\n",
      grants: [],
      scenarios: [
        {
          en: 'Install before the first transport starts and restrict namespaces when the policy should apply only to selected links.',
          zh: '在首个传输启动前安装；仅需作用于选中链路时限定命名空间。'
        }
      ],
      behaviors: [
        {
          en: 'The Host publishes admitted lifecycle and selected stage events to actual probe subscribers; optional raw records borrow the native carrier observation.',
          zh: '宿主向真实探针订阅者发布已接纳生命周期及所选阶段事件；可选原始记录借用原生载体的实际观察能力。'
        }
      ]
    },
    linkPolicy: {
      kind: 'plugin',
      target: 'IRpcHostOptions.plugins',
      summary: {
        en: 'Complete timeout/retry instances used as link defaults before transport and call overrides.',
        zh: '在传输及调用覆盖之前使用的完整超时及重试链路默认实例。'
      },
      install:
        "import linkPolicy from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({ features: [timeout({ ms: 1500 })] })\n",
      example:
        "import linkPolicy from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({ features: [timeout({ ms: 1500 })] })\n",
      grants: [],
      scenarios: [
        {
          en: 'Install before the first transport starts and restrict namespaces when the policy should apply only to selected links.',
          zh: '在首个传输启动前安装；仅需作用于选中链路时限定命名空间。'
        }
      ],
      behaviors: [
        {
          en: 'Unspecified per-call timeout and retry selections inherit complete feature instances from this link policy; a call may explicitly disable either.',
          zh: '未明确指定的单次超时及重试选项继承此链路策略的完整实例，调用可显式禁用其中任一功能。'
        }
      ]
    },
    timeout: {
      kind: 'feature',
      target: 'IRpcCallFeatures',
      summary: {
        en: 'Complete attempt-timeout implementation with owned timer cleanup.',
        zh: '为发起调用提供完整计时、取消订阅及结算清理算法的超时实例。'
      },
      install:
        "import linkPolicy from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({ features: [timeout({ ms: 1500 })] })\n",
      example:
        "import linkPolicy from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({ features: [timeout({ ms: 1500 })] })\n",
      grants: [],
      scenarios: [
        {
          en: 'Choose complete per-call policy without adding a second Host or pending table.',
          zh: '选择完整单次调用策略，不增加第二个宿主或待决表。'
        }
      ],
      behaviors: [
        {
          en: 'The selected call attempt has a bounded timer; inherited deadlines may shorten it. Settlement releases the timer and abort subscriptions.',
          zh: '为所选调用尝试设置有界计时，继承截止时间只能缩短预算；结算时释放该计时器及取消订阅。'
        }
      ]
    },
    retry: {
      kind: 'feature',
      target: 'IRpcCallFeatures',
      summary: {
        en: 'Complete originating retry implementation borrowing actual replacement availability.',
        zh: '借用真实接纳会话或原生代际就绪能力的完整发起方重试实现。'
      },
      install:
        "import linkPolicy from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({ features: [timeout({ ms: 1500 })] })\n",
      example:
        "import linkPolicy from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({ features: [timeout({ ms: 1500 })] })\n",
      grants: [],
      scenarios: [
        {
          en: 'Choose complete per-call policy without adding a second Host or pending table.',
          zh: '选择完整单次调用策略，不增加第二个宿主或待决表。'
        }
      ],
      behaviors: [
        {
          en: 'An originating invocation may repeat only when its idempotency, physical-handoff and actual replacement facts permit it. Attempts retain one logical key and remaining budget.',
          zh: '发起调用仅在幂等声明、物理交接及真实替换事实允许时重试；各次尝试保留同一逻辑键，并消费同一剩余预算。'
        }
      ]
    },
    defineTransportPlugin: {
      kind: 'transport',
      target: 'IRpcHostOptions.plugins',
      summary: {
        en: 'Capture one genuine cold native transport definition. Its open callback acquires real carriers in the receiving Host and returns exact disposal/extensions; no second plugin-host or per-peer request facade is created.',
        zh: '捕获一个真实冷原生传输定义。其打开回调在接收宿主获取真实载体并返回精确释放及扩展，不创建第二插件宿主或逐对端请求门面。'
      },
      install:
        "import { defineTransportPlugin, createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\n\nexport function transport(io: IRpcMessageIO, id: string) {\n  return defineTransportPlugin({\n    name: 'application-channel',\n    namespace: 'channel',\n    async open(context) {\n      const carrier = createRpcMessageCarrier({ id, io, report: context.report })\n      const handle = context.attach(carrier)\n      await handle.ready\n      return { dispose: () => handle.close() }\n    },\n  })\n}\n",
      example:
        "import { defineTransportPlugin, createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\n\nexport function transport(io: IRpcMessageIO, id: string) {\n  return defineTransportPlugin({\n    name: 'application-channel',\n    namespace: 'channel',\n    async open(context) {\n      const carrier = createRpcMessageCarrier({ id, io, report: context.report })\n      const handle = context.attach(carrier)\n      await handle.ready\n      return { dispose: () => handle.close() }\n    },\n  })\n}\n",
      grants: [
        {
          signature: 'host.<namespace>.request(method, payload?, options?)',
          summary: {
            en: 'Wait independently for each selected target business result.',
            zh: '独立等待各选中目标的业务结果。'
          },
          params: {
            method: {
              en: 'Method path from the remote accepted directory, retaining application payload/result types.',
              zh: '来自远端接纳目录的方法路径，保留应用载荷及结果类型。'
            },
            payload: {
              en: 'The selected method application value captured by the real codec.',
              zh: '实际编解码器捕获的所选方法应用值。'
            },
            options: {
              en: 'Complete call overrides and signal for this invocation, never numeric timeout shorthand.',
              zh: '本次调用的完整功能覆盖及信号，不是数字超时缩写。'
            }
          },
          returns: {
            en: 'Zero gives empty maps, one gives a scalar, many give independent fulfilled/rejected maps.',
            zh: '零个目标返回空字典，一个返回标量，多个返回独立成功及失败字典。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}\n"
        }
      ],
      scenarios: [
        {
          en: 'Use the receiving native Host installation and original cleanup ownership.',
          zh: '使用接收原生宿主安装及原清理所有权。'
        }
      ]
    },
    defineFlowPlugin: {
      kind: 'plugin',
      target: 'IRpcHostOptions.plugins',
      summary: {
        en: 'Capture a reusable cold flow definition whose setup constructs per-Host hooks and cleanup. Optional metadata cannot replace native name/install identity.',
        zh: '捕获可复用冷信息流定义，其设置为每个宿主构造介入点及清理。可选元数据不能替换原生名称及安装身份。'
      },
      install:
        "import { defineFlowPlugin } from '@migaia/rpc-host/sdk'\n\nexport const trace = defineFlowPlugin({\n  name: 'application-trace',\n  setup() {\n    return { hooks: { observe: (event) => console.log(event) } }\n  },\n})\n",
      example:
        "import { defineFlowPlugin } from '@migaia/rpc-host/sdk'\n\nexport const trace = defineFlowPlugin({\n  name: 'application-trace',\n  setup() {\n    return { hooks: { observe: (event) => console.log(event) } }\n  },\n})\n",
      grants: [],
      scenarios: [
        {
          en: 'Use the receiving native Host installation and original cleanup ownership.',
          zh: '使用接收原生宿主安装及原清理所有权。'
        }
      ],
      behaviors: [
        {
          en: 'A cold definition installs its own fixed hook set before the first transport starts; each native Host installation owns independent hook resources.',
          zh: '冷定义在首个传输启动前安装固定介入集合，每次原生宿主安装分别拥有自己的介入资源与清理。'
        }
      ]
    },
    defineLinkPolicy: {
      kind: 'plugin',
      target: 'IRpcHostOptions.plugins',
      summary: {
        en: 'Register complete call-feature defaults without adding a second intervention pipeline or call strategy in Host.',
        zh: '登记完整调用功能默认值，不在宿主增加第二介入流水线或调用策略。'
      },
      install:
        "import { defineLinkPolicy } from '@migaia/rpc-host/sdk'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = defineLinkPolicy({\n  name: 'application-policy',\n  features: [timeout({ ms: 500 })],\n})\n",
      example:
        "import { defineLinkPolicy } from '@migaia/rpc-host/sdk'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = defineLinkPolicy({\n  name: 'application-policy',\n  features: [timeout({ ms: 500 })],\n})\n",
      grants: [],
      scenarios: [
        {
          en: 'Use the receiving native Host installation and original cleanup ownership.',
          zh: '使用接收原生宿主安装及原清理所有权。'
        }
      ],
      behaviors: [
        {
          en: 'The cold link-policy definition installs complete call features at its declared native scope without adding a transport or business-call facade.',
          zh: '冷链路策略定义在声明的原生范围安装完整调用功能，不增加传输或业务调用门面，也不复制待决调用。'
        }
      ]
    }
  }
}

/** Pure declaration keys actually re-exported by the SDK. */
const sharedTypeNames = [
  'IpcSendClass',
  'rpcCarrierWriteFacts',
  'IRpcDispose',
  'IRpcCarrierFrame',
  'IRpcPreparedMessage',
  'IRpcCodecContext',
  'IRpcCarrierCodec',
  'IRpcCarrierReceiver',
  'IRpcCarrierWriteOptions',
  'IRpcCarrierObservationFacts',
  'IRpcCarrierObservationEvent',
  'IRpcCarrierObservation',
  'IRpcCarrier',
  'IRpcSessionView',
  'IRpcSessionHandle',
  'IRpcAttachedSession',
  'IRpcPingOptions',
  'IRpcLocalSourceFacts',
  'IRpcTransportContext',
  'IRpcSessionSelection',
  'IRpcTargetSource',
  'IRpcOriginSelection',
  'IRpcPrivateSession',
  'IRpcOriginBinding',
  'IRpcOriginHandle',
  'IRpcFlowContext',
  'IRpcFrameWriteOptions',
  'IRpcEnvelopeContext',
  'IRpcFrameNext',
  'IRpcDispatchOutcome',
  'IRpcDispatchContext',
  'IRpcObservation',
  'IRpcFlowHooks',
  'IRpcFlowPluginDefinition',
  'RpcCallFeatureKind',
  'IRpcNativeGeneration',
  'IRpcAvailableAttempt',
  'IRpcAttemptAvailability',
  'IRpcAttemptFacts',
  'IRpcAttemptOptions',
  'IRpcAttempt',
  'IRpcTimeoutFeature',
  'IRpcRetryFeature',
  'IRpcCallFeature',
  'IRpcCallFeatures',
  'IRpcFeatureContext',
  'IRpcFeatureDefinition',
  'IRpcTransportInstallation',
  'IRpcTransportDefinition',
  'RpcCarrierPlatform',
  'RpcCarrierEncoding',
  'RpcCarrierTopology',
  'RpcProbeStage',
  'RpcProbeStageName',
  'IRpcProbeStageName',
  'RpcProbeDirection',
  'RpcProbeDirectionName',
  'RpcProbeKind',
  'RpcProbeKindName',
  'RpcProbeOutcome',
  'RpcProbeOutcomeName',
  'RpcProbeObservationKind',
  'RpcProbeLifecycle',
  'IRpcProbeEventView',
  'IRpcProbeObservation',
  'RpcProbeAuthentication',
  'IRpcProbeDescriptor',
  'rpcProbeEnvelopeFacts',
  'rpcProbeEnvelopeKind',
  'IRpcError',
  'IRpcCleanupError',
  'RpcError',
  'RpcSchemaValidationError',
  'RpcConfigurationError',
  'RpcConstructionError',
  'RpcLifecycleError',
  'RpcSerializationError',
  'RpcProtocolError',
  'RpcContractError',
  'RpcTransportError',
  'RpcAuthenticationError',
  'RpcChunkError',
  'RpcRemoteError',
  'RpcAbortError',
  'RpcTimeoutError'
]

/** Actual shared runtime error/probe exports retain their one canonical documentation owner. */
const sharedRuntimeNames = [
  'RPC_CORE_ERROR_SOURCE',
  'RpcLifecycleError',
  'isRpcError',
  'isRpcErrorInstance',
  'isRpcRemoteError',
  'isRpcTimeoutError',
  'RpcProbeStage',
  'RpcProbeDirection',
  'RpcProbeKind',
  'RpcProbeOutcome',
  'RpcProbeStageName',
  'RpcProbeDirectionName',
  'RpcProbeKindName',
  'RpcProbeOutcomeName',
  'IpcSendClass',
  'RpcCallFeatureKind',
  'RpcCarrierEncoding',
  'RpcCarrierPlatform',
  'RpcCarrierTopology',
  'rpcCarrierWriteFacts',
  'RpcProbeAuthentication',
  'rpcProbeEnvelopeFacts',
  'rpcProbeEnvelopeKind',
  'RpcProbeLifecycle',
  'RpcProbeObservationKind'
]

/** The same native setup surface adds only its original core and optional configured reporter. */
const transportMembers = {
  ...contractReference.types.IRpcTransportContext?.members,
  ...owned.types.IRpcTransportSetupContext!.members
}

/** No guide fallback or structural copy can create a second public RPC contract. */
export const rpcHostReference: ILibraryReference = {
  ...owned,
  symbols: {
    ...Object.fromEntries(
      sharedRuntimeNames.flatMap((name) =>
        contractReference.symbols[name] ? [[name, contractReference.symbols[name]]] : []
      )
    ),
    ...owned.symbols
  },
  types: {
    ...Object.fromEntries(
      sharedTypeNames.flatMap((name) =>
        contractReference.types[name] ? [[name, contractReference.types[name]]] : []
      )
    ),
    ...owned.types,
    IRpcPrivateSession: {
      ...contractReference.types.IRpcPrivateSession!,
      ...owned.types.IRpcPrivateSession!,
      members: contractReference.types.IRpcPrivateSession?.members ?? {}
    },
    IRpcPreparedMessage: {
      ...contractReference.types.IRpcPreparedMessage!,
      ...owned.types.IRpcPreparedMessage!,
      members: contractReference.types.IRpcPreparedMessage?.members ?? {}
    },
    IRpcSessionHandle: {
      ...contractReference.types.IRpcSessionHandle!,
      ...owned.types.IRpcSessionHandle!,
      members: contractReference.types.IRpcSessionHandle?.members ?? {}
    },
    IRpcTransportSetupContext: {
      ...owned.types.IRpcTransportSetupContext!,
      members: transportMembers
    },
    IRpcNativeFeatureContext: {
      ...owned.types.IRpcNativeFeatureContext!,
      members: { ...transportMembers, ...owned.types.IRpcNativeFeatureContext!.members }
    },
    IRpcFlowInstallation: {
      ...owned.types.IRpcFlowInstallation!,
      members: {
        ...Object.fromEntries(
          Object.entries(contractReference.types.IRpcFlowPluginDefinition?.members ?? {}).filter(
            ([name]) => name !== 'name' && name !== 'namespaces'
          )
        ),
        ...owned.types.IRpcFlowInstallation!.members
      }
    },
    IRpcPhysicalWriteOptions: {
      ...owned.types.IRpcPhysicalWriteOptions!,
      members: contractReference.types.IRpcCarrierWriteOptions?.members ?? {}
    }
  },
  enums: {
    ...Object.fromEntries(
      [
        'RpcProbeStage',
        'RpcProbeDirection',
        'RpcProbeKind',
        'RpcProbeOutcome',
        'IpcSendClass',
        'RpcCallFeatureKind',
        'RpcCarrierEncoding',
        'RpcCarrierPlatform',
        'RpcCarrierTopology',
        'RpcProbeAuthentication',
        'RpcProbeLifecycle',
        'RpcProbeObservationKind'
      ].flatMap((name) =>
        contractReference.enums[name] ? [[name, contractReference.enums[name]]] : []
      )
    ),
    ...owned.enums
  }
}
