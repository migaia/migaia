/**
 * Eight RPC owners use actual authored purpose/options/examples. Current re-exports share reading
 * records; this table introduces no runtime alias, fallback prose or documentation generator.
 */
import type { IApiGuide, IGuideLocale } from './api-guides.ts'

/** One specific bilingual reading record is shared only by identical public contracts. */
const canonicalRpcGuides: Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> = {
  'rpc-host:index:RPC_CORE_ERROR_SOURCE': {
    en: {
      purpose: 'Canonical endpoint source rpc.endpoint for the native RPC error families.',
      quickStart:
        "import { RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-contract/errors'\nconst value = RPC_CORE_ERROR_SOURCE",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '原生远程调用错误家族使用的规范端点诊断来源。',
      quickStart:
        "import { RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-contract/errors'\nconst value = RPC_CORE_ERROR_SOURCE",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:index:RpcLifecycleError': {
    en: {
      purpose:
        'Actual lifecycle diagnostic keeps cleanup details and optional standard aggregate errors. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcLifecycleError } from '@migaia/rpc-contract/errors'\nconst error = new RpcLifecycleError('Operation failed')",
      options: [],
      scenarios: [
        'Describe an endpoint retirement failure together with original resource cleanup details.',
        'Retain secondary cleanup failures alongside a primary lifecycle cause.'
      ],
      avoidWhen: [
        'Do not turn a successful closed state into an error merely because the endpoint is unavailable.',
        'Do not use this class to change namespace or global Host close ownership.'
      ]
    },
    zh: {
      purpose: '实际生命周期诊断保留清理详情及可选标准聚合错误。构造或恢复诊断不授予本地控制权限。',
      quickStart:
        "import { RpcLifecycleError } from '@migaia/rpc-contract/errors'\nconst error = new RpcLifecycleError('Operation failed')",
      options: [],
      scenarios: ['描述端点退场失败及原始资源清理详情。', '在主要生命周期原因旁保留次要清理失败。'],
      avoidWhen: [
        '端点不可用的关闭状态本身不意味着必须制造失败诊断。',
        '不要用此类改变命名空间关闭与全局 Host 关闭的所有权。'
      ]
    }
  },
  'rpc-host:index:createRpcHost': {
    en: {
      purpose:
        'Create one native RPC Host that owns global identity, local provider registration and close. Installed transports publish separate typed namespaces for calls; the root does not provide request or notify methods.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}",
      options: [
        {
          name: 'plugins',
          description:
            'Genuine cold definitions with at least one transport and unique namespace names. Optional flow plugins precede the first transport startup.',
          whenToUse:
            'Genuine cold definitions with at least one transport and unique namespace names. Optional flow plugins precede the first transport startup.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}"
        },
        {
          name: 'provide',
          description:
            'Initial recursive own-data application method whitelist; receiver identity is captured once.',
          whenToUse:
            'Initial recursive own-data application method whitelist; receiver identity is captured once.',
          defaultValue: 'No initial local methods.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}"
        },
        {
          name: 'contract',
          description:
            'Local schemaVersion1 method declarations exchange schema/idempotency metadata; business validation requires the schema plugin.',
          whenToUse:
            'Local schemaVersion1 method declarations exchange schema/idempotency metadata; business validation requires the schema plugin.',
          defaultValue: 'No advanced local declarations.'
        },
        {
          name: 'self',
          description:
            'Application global name and instanceId. Trusted native bootstrap may adopt only an unconfigured initial identity before first use.',
          whenToUse:
            'Application global name and instanceId. Trusted native bootstrap may adopt only an unconfigured initial identity before first use.',
          defaultValue: 'Secure generated identity.'
        },
        {
          name: 'report',
          description:
            'Receives failures not returned by a business operation; preserve source/code/native type/cause and avoid throwing from diagnostics.',
          whenToUse:
            'Receives failures not returned by a business operation; preserve source/code/native type/cause and avoid throwing from diagnostics.',
          defaultValue: 'defaultRpcReporter.'
        },
        {
          name: 'signal',
          description:
            'External construction and Host-lifetime signal; it is not a per-call timeout.',
          whenToUse:
            'External construction and Host-lifetime signal; it is not a per-call timeout.',
          defaultValue: 'No external Host signal.'
        }
      ],
      scenarios: [
        'An application needs one provider catalog and a typed namespace for its actual worker or coroutine transport.',
        'Construction must await native installation and release every acquired transport if startup fails.'
      ],
      avoidWhen: [
        'A transport only needs a codec or native IO adapter; implement that resource in its transport owner instead of creating another Host.',
        'Independent applications require separate ownership; do not share one Host merely to combine unrelated lifetimes.'
      ]
    },
    zh: {
      purpose:
        '创建一个原生 RPC 宿主，统一拥有全局身份、本地方法登记及关闭；安装的传输各自发布有类型的调用命名空间，业务通过该命名空间选择链路。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}",
      options: [
        {
          name: 'plugins',
          description:
            '至少包含一个传输且命名空间名唯一的真实冷定义。可选信息流插件在首个传输启动前安装。',
          whenToUse:
            '至少包含一个传输且命名空间名唯一的真实冷定义。可选信息流插件在首个传输启动前安装。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}"
        },
        {
          name: 'provide',
          description: '初始递归自有数据方法白名单，接收者身份只捕获一次。',
          whenToUse: '初始递归自有数据方法白名单，接收者身份只捕获一次。',
          defaultValue: '无初始本地方法。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features'\n\nconst host = await createRpcHost<{ double(value: number): number }>({\n  plugins: [\n    coroutinePlugin({\n      features: [timeout({ ms: 1500 })],\n      spawn: async ({ connect, signal }) => {\n        const child = await createRpcHost({\n          plugins: [coroutinePlugin({ connectToParent: connect })],\n          provide: { double: (value: number) => value * 2 },\n        })\n        try {\n          if (!signal.aborted)\n            await new Promise<void>((resolve) =>\n              signal.addEventListener('abort', () => resolve(), { once: true }),\n            )\n        } finally {\n          await child.close()\n        }\n      },\n    }),\n  ],\n})\ntry {\n  console.log(await host.coroutine.request('double', 21))\n} finally {\n  await host.close()\n}"
        },
        {
          name: 'contract',
          description: '本地第一版方法声明交换模式及幂等元数据；业务校验由模式插件启用。',
          whenToUse: '本地第一版方法声明交换模式及幂等元数据；业务校验由模式插件启用。',
          defaultValue: '无高级本地声明。'
        },
        {
          name: 'self',
          description:
            '应用全局名称及实例身份；可信原生启动信息只能在首次使用前接纳未显式配置的初始身份。',
          whenToUse:
            '应用全局名称及实例身份；可信原生启动信息只能在首次使用前接纳未显式配置的初始身份。',
          defaultValue: '安全生成的身份。'
        },
        {
          name: 'report',
          description:
            '接收不由业务操作返回的失败，应保留来源、错误码、原生类型及原因，避免在诊断中抛错。',
          whenToUse:
            '接收不由业务操作返回的失败，应保留来源、错误码、原生类型及原因，避免在诊断中抛错。',
          defaultValue: '默认上报器。'
        },
        {
          name: 'signal',
          description: '外部构造及宿主生命周期信号，不是单次调用超时。',
          whenToUse: '外部构造及宿主生命周期信号，不是单次调用超时。',
          defaultValue: '无外部宿主信号。'
        }
      ],
      scenarios: [
        '应用需要统一登记本地方法，并通过实际工作线程或协程传输的命名空间调用远端业务。',
        '构造必须等待原生安装完成，并在启动失败时释放本次已经取得的传输资源。'
      ],
      avoidWhen: [
        '只需编写编解码器或原生读写适配器时，应实现传输所有者，不应为此另建宿主。',
        '两个应用需要独立所有权时，不应只为合并无关的生命周期而共享同一宿主。'
      ]
    }
  },
  'rpc-host:index:defaultRpcReporter': {
    en: {
      purpose:
        'Report an original background RPC failure to console.error without replacing its identity. This is the fallback diagnostic callback when the application supplies no reporter.',
      quickStart:
        "import { defaultRpcReporter } from '@migaia/rpc-host'\nexport const report = defaultRpcReporter",
      options: [],
      scenarios: [
        'A small application wants visible background failures without installing a logging service.',
        'A transport needs the default reporter while keeping its original source, code and cause chain.'
      ],
      avoidWhen: [
        'Production diagnostics require redaction or structured routing; supply a suitable application reporter.',
        'The caller is already awaiting a returned failure; this callback is not a second result channel.'
      ]
    },
    zh: {
      purpose:
        '将原后台 RPC 失败交给 console.error，并保留该异常对象的身份；应用没有提供上报回调时，由此默认诊断回调接收后台失败。',
      quickStart:
        "import { defaultRpcReporter } from '@migaia/rpc-host'\nexport const report = defaultRpcReporter",
      options: [],
      scenarios: [
        '小型应用需要直接看到后台失败，但暂时不接入日志服务。',
        '传输需要使用默认上报方式，同时保留原异常的来源、错误码及原因链。'
      ],
      avoidWhen: [
        '生产诊断需要脱敏或结构化分流时，应提供符合应用要求的上报回调。',
        '调用者已经等待操作返回的失败时，不应把此回调当作第二个结果通道。'
      ]
    }
  },
  'rpc-host:index:isRpcError': {
    en: {
      purpose:
        'Recognize a readable string code only; source, known-code and local-authority checks are not implied.',
      quickStart:
        "import { isRpcError } from '@migaia/rpc-contract/errors'\nexport function classify(value: unknown) {\n  return isRpcError(value)\n}",
      options: [],
      scenarios: [
        'Decide whether a caught value exposes a string code before displaying that code.',
        'Accept diagnostic objects from another realm without requiring local instanceof identity.'
      ],
      avoidWhen: [
        'Use isRpcErrorInstance when the branch requires endpoint source and a known Core family.',
        'Do not authorize a retry merely because an arbitrary object passes this broad guard.'
      ]
    },
    zh: {
      purpose:
        '仅检查未知对象是否具有可读取的字符串 code，适合宽泛诊断分支；不校验来源、已知码域或本地控制权限。',
      quickStart:
        "import { isRpcError } from '@migaia/rpc-contract/errors'\nexport function classify(value: unknown) {\n  return isRpcError(value)\n}",
      options: [],
      scenarios: [
        '显示捕获值的错误码前，判断其是否具有字符串 code。',
        '无需本地 instanceof 身份即可识别其他运行域的诊断对象。'
      ],
      avoidWhen: [
        '分支要求端点来源及已知 Core 家族时，应使用 isRpcErrorInstance。',
        '不要仅因任意对象通过此宽泛判断就允许重试。'
      ]
    }
  },
  'rpc-host:index:isRpcErrorInstance': {
    en: {
      purpose:
        'Recognize endpoint source, a known core code and a supported nonremote family, including restored cross-realm diagnostics.',
      quickStart:
        "import { isRpcErrorInstance } from '@migaia/rpc-contract/errors'\nexport function classify(value: unknown) {\n  return isRpcErrorInstance(value)\n}",
      options: [],
      scenarios: [
        'Classify a restored endpoint configuration or protocol error across realm boundaries.',
        'Distinguish known Core failures from application errors with unrelated string codes.'
      ],
      avoidWhen: [
        'Use isRpcRemoteError for the separate remote family with unrestricted application codes.',
        'Do not substitute this structural check for owner-held local cancellation provenance.'
      ]
    },
    zh: {
      purpose:
        '检查端点来源、已知核心码及受支持的非远端错误家族，用于跨运行域诊断分类；结构匹配不证明本地操作来源。',
      quickStart:
        "import { isRpcErrorInstance } from '@migaia/rpc-contract/errors'\nexport function classify(value: unknown) {\n  return isRpcErrorInstance(value)\n}",
      options: [],
      scenarios: [
        '跨运行域分类恢复后的端点配置或协议错误。',
        '区分已知 Core 失败与仅带无关字符串码的应用错误。'
      ],
      avoidWhen: [
        '独立远端家族及其不限域的应用码应使用 isRpcRemoteError。',
        '不要用结构判断替代所有者持有的本地取消来源记录。'
      ]
    }
  },
  'rpc-host:index:isRpcRemoteError': {
    en: {
      purpose:
        'Recognize endpoint-source RpcRemoteError diagnostics with unrestricted remote string codes.',
      quickStart:
        "import { isRpcRemoteError } from '@migaia/rpc-contract/errors'\nexport function classify(value: unknown) {\n  return isRpcRemoteError(value)\n}",
      options: [],
      scenarios: [
        'Separate a remote application failure from local configuration or transport diagnostics.',
        'Read a restored remote code without assuming it belongs to the Core code union.'
      ],
      avoidWhen: [
        'Do not use it to recognize every Error returned by a provider; direct native failures may use another family.',
        'Do not treat a remote code as permission to replay a completed application operation.'
      ]
    },
    zh: {
      purpose:
        '识别端点来源与 RpcRemoteError 家族及其远端字符串错误码，用于收到的应用失败分类；不把远端码限制为 Core 码。',
      quickStart:
        "import { isRpcRemoteError } from '@migaia/rpc-contract/errors'\nexport function classify(value: unknown) {\n  return isRpcRemoteError(value)\n}",
      options: [],
      scenarios: [
        '区分远端应用失败与本地配置或传输诊断。',
        '读取恢复的远端错误码时，不假设其属于 Core 码联合。'
      ],
      avoidWhen: [
        '不要用它识别提供方返回的所有错误，直接原生失败可能属于其他家族。',
        '不要把远端错误码当作重放已完成应用操作的权限。'
      ]
    }
  },
  'rpc-host:index:isRpcTimeoutError': {
    en: {
      purpose:
        'Recognize endpoint-source TimeoutError with DEADLINE_EXCEEDED; this is diagnostic classification, not retry authority.',
      quickStart:
        "import { isRpcTimeoutError } from '@migaia/rpc-contract/errors'\nexport function classify(value: unknown) {\n  return isRpcTimeoutError(value)\n}",
      options: [],
      scenarios: [
        'Display a deadline-specific response for an endpoint timeout diagnostic.',
        'Recognize the same coded timeout after serialization into another realm.'
      ],
      avoidWhen: [
        'Use cancellation classification for AbortError rather than treating caller abort as a deadline.',
        'Do not create or extend a timer by calling this predicate; timeout execution belongs to a feature.'
      ]
    },
    zh: {
      purpose:
        '识别具有端点来源、TimeoutError 名称及 DEADLINE_EXCEEDED 错误码的诊断，支持跨运行域分类但不创建截止时间。',
      quickStart:
        "import { isRpcTimeoutError } from '@migaia/rpc-contract/errors'\nexport function classify(value: unknown) {\n  return isRpcTimeoutError(value)\n}",
      options: [],
      scenarios: [
        '针对端点超时诊断展示截止时间相关反馈。',
        '错误序列化到其他运行域后识别相同的带码超时。'
      ],
      avoidWhen: [
        '调用者中止应按 AbortError 分类，不应当作期限超出。',
        '调用此判断不会创建或延长计时器，超时执行属于功能实例。'
      ]
    }
  },
  'rpc-host:features:retry': {
    en: {
      purpose:
        'Create a complete originating retry feature and install it in transport features or select that instance for one call. attempts is the total admission limit, including the first attempt; backoff uses the configured scheduler. Replay follows actual accepted/native availability and admitted method idempotency, preserving one logical key and the inherited remaining budget across replacements. This policy does not retry arbitrary business exceptions or refresh a deadline on every attempt.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { retry } from '@migaia/rpc-host/features/retry'\nexport async function run() {\n  const host = await createRpcHost({\n    plugins: [\n      coroutinePlugin({\n        features: [retry({ attempts: 3, backoff: 40 })],\n        spawn: async ({ connect, signal }) => {\n          const child = await createRpcHost({\n            plugins: [coroutinePlugin({ connectToParent: connect })],\n            provide: { demo: { service: { echo: (value: string) => value } } },\n            contract: {\n              schemaVersion: 1,\n              plugin: 'demo',\n              features: {\n                service: { methods: { echo: { mode: 'request', idempotent: true } } },\n              },\n            },\n          })\n          try {\n            if (!signal.aborted) {\n              await new Promise<void>((resolve) =>\n                signal.addEventListener('abort', () => resolve(), { once: true }),\n              )\n            }\n          } finally {\n            await child.close()\n          }\n        },\n      }),\n    ],\n  })\n  try {\n    return await host.coroutine.request('demo.service.echo', 'replay-eligible value')\n  } finally {\n    await host.close()\n  }\n}\n",
      options: [
        {
          name: 'attempts',
          description: 'Positive safe integer total attempt count including the initial attempt.',
          whenToUse: 'Positive safe integer total attempt count including the initial attempt.',
          defaultValue: '2 attempts.',
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const"
        },
        {
          name: 'backoff',
          description:
            'Nonnegative milliseconds or a synchronous function of original error and utils retry context; a throw terminates retry.',
          whenToUse:
            'Nonnegative milliseconds or a synchronous function of original error and utils retry context; a throw terminates retry.',
          defaultValue: 'No extra delay.'
        },
        {
          name: 'keyFactory',
          description:
            'Issues the originating logical key; never substitute a remote diagnostic as authority.',
          whenToUse:
            'Issues the originating logical key; never substitute a remote diagnostic as authority.',
          defaultValue: 'defaultRpcId.'
        },
        {
          name: 'scheduler',
          description: 'Existing scheduler for cancellable owned backoff waits.',
          whenToUse: 'Existing scheduler for cancellable owned backoff waits.',
          defaultValue: 'systemScheduler.'
        },
        {
          name: 'report',
          description: 'Receives contained cleanup and late failures with original identity.',
          whenToUse: 'Receives contained cleanup and late failures with original identity.',
          defaultValue: 'defaultRpcReporter.'
        }
      ],
      scenarios: [
        'Replay an idempotent request after the actual selected generation departs and an eligible replacement becomes ready.',
        'Bound replacement attempts and cancellable backoff while carrying the same logical idempotency key and remaining call budget.'
      ],
      avoidWhen: [
        'Do not enable retry to repeat arbitrary provider errors; business failures retain their original identity and do not authorize replay.',
        'Do not assume a written non-idempotent operation can safely run twice, or install a numeric per-call retry flag instead of the complete feature instance.'
      ]
    },
    zh: {
      purpose:
        '创建完整的发起方重试实例，装入传输的 features，或为一次调用显式选择该实例。attempts 表示包含首次尝试的总接纳次数，backoff 借配置的调度器等待；实际接纳或原生代际可用性与已声明的方法幂等性共同决定能否重放。跨代际替换保留同一个逻辑幂等键与继承的剩余预算，不因新尝试重置截止时间，也不会重试任意业务异常。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { retry } from '@migaia/rpc-host/features/retry'\nexport async function run() {\n  const host = await createRpcHost({\n    plugins: [\n      coroutinePlugin({\n        features: [retry({ attempts: 3, backoff: 40 })],\n        spawn: async ({ connect, signal }) => {\n          const child = await createRpcHost({\n            plugins: [coroutinePlugin({ connectToParent: connect })],\n            provide: { demo: { service: { echo: (value: string) => value } } },\n            contract: {\n              schemaVersion: 1,\n              plugin: 'demo',\n              features: {\n                service: { methods: { echo: { mode: 'request', idempotent: true } } },\n              },\n            },\n          })\n          try {\n            if (!signal.aborted) {\n              await new Promise<void>((resolve) =>\n                signal.addEventListener('abort', () => resolve(), { once: true }),\n              )\n            }\n          } finally {\n            await child.close()\n          }\n        },\n      }),\n    ],\n  })\n  try {\n    return await host.coroutine.request('demo.service.echo', 'replay-eligible value')\n  } finally {\n    await host.close()\n  }\n}\n",
      options: [
        {
          name: 'attempts',
          description: '包含首次尝试的正安全整数总次数。',
          whenToUse: '包含首次尝试的正安全整数总次数。',
          defaultValue: '两次尝试。',
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const"
        },
        {
          name: 'backoff',
          description: '非负毫秒数，或接收原错误及工具重试上下文的同步函数；抛错会结束重试。',
          whenToUse: '非负毫秒数，或接收原错误及工具重试上下文的同步函数；抛错会结束重试。',
          defaultValue: '无额外延迟。'
        },
        {
          name: 'keyFactory',
          description: '签发发起方逻辑键，不以远端诊断代替权限。',
          whenToUse: '签发发起方逻辑键，不以远端诊断代替权限。',
          defaultValue: '默认标识分配器。'
        },
        {
          name: 'scheduler',
          description: '拥有可取消退避等待的现有调度器。',
          whenToUse: '拥有可取消退避等待的现有调度器。',
          defaultValue: '系统调度器。'
        },
        {
          name: 'report',
          description: '接收被隔离的清理及稍后失败并保留原身份。',
          whenToUse: '接收被隔离的清理及稍后失败并保留原身份。',
          defaultValue: '默认上报器。'
        }
      ],
      scenarios: [
        '实际选中代际退场、允许的替代代际就绪后，重放已声明为幂等的请求。',
        '限定替代尝试次数及可取消退避，同时跨尝试沿用原逻辑幂等键与剩余调用预算。'
      ],
      avoidWhen: [
        '业务失败保持原身份，不授予重放权限；不要用 retry 反复执行任意提供方错误。',
        '不要假设已写出的非幂等操作能安全再执行一次，也不要用数字调用标记替代完整重试实例。'
      ]
    }
  },
  'rpc-host:features:timeout': {
    en: {
      purpose:
        'Create a complete timeout feature with a finite nonnegative ms budget, then install it in transport features or select it for one call. Each attempt borrows a merged cancellation signal and owns its timer through the supplied scheduler; zero permits immediate expiry. The effective budget can shorten but never renew inherited remaining time. Timeout errors remain distinct from caller cancellation, while the independent handshake deadline and provider cooperation retain their own owners.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nexport async function run() {\n  const host = await createRpcHost({\n    plugins: [\n      coroutinePlugin({\n        features: [timeout({ ms: 1500 })],\n        spawn: async ({ connect, signal }) => {\n          const child = await createRpcHost({\n            plugins: [coroutinePlugin({ connectToParent: connect })],\n            provide: { double: (value: number) => value * 2 },\n          })\n          try {\n            if (!signal.aborted) {\n              await new Promise<void>((resolve) =>\n                signal.addEventListener('abort', () => resolve(), { once: true }),\n              )\n            }\n          } finally {\n            await child.close()\n          }\n        },\n      }),\n    ],\n  })\n  try {\n    return await host.coroutine.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}\n",
      options: [
        {
          name: 'ms',
          description: 'Finite nonnegative attempt milliseconds; zero allows immediate expiry.',
          whenToUse: 'Finite nonnegative attempt milliseconds; zero allows immediate expiry.',
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const"
        },
        {
          name: 'scheduler',
          description: 'Existing scheduler owns actual timer and cancellation handles.',
          whenToUse: 'Existing scheduler owns actual timer and cancellation handles.',
          defaultValue: 'systemScheduler.'
        },
        {
          name: 'report',
          description:
            'Reports cleanup/losing-branch failures without replacing the primary cancellation or timeout.',
          whenToUse:
            'Reports cleanup/losing-branch failures without replacing the primary cancellation or timeout.',
          defaultValue: 'defaultRpcReporter.'
        }
      ],
      scenarios: [
        'Bound an originating request attempt while preserving an earlier caller or forwarded deadline.',
        'Use an injected scheduler and report outlet to control timer cleanup and observe late failures without replacing the primary timeout.'
      ],
      avoidWhen: [
        'Do not use this call feature to configure handshake establishment time; the Session handshake has an independent deadline.',
        'Do not assume cancellation forcibly terminates uncooperative provider code, or pass a raw number in place of a complete timeout instance.'
      ]
    },
    zh: {
      purpose:
        '用有限非负的 ms 创建完整超时实例，再装入传输的 features，或为一次调用显式选择该实例。每次尝试借合并取消信号，并通过配置的调度器拥有计时器，零允许立即到期；有效预算只能缩短继承的剩余时间，不能重新续期。超时错误与调用者取消保持区别，握手建立的独立截止时间和提供方是否配合取消仍由各自所有者负责。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nexport async function run() {\n  const host = await createRpcHost({\n    plugins: [\n      coroutinePlugin({\n        features: [timeout({ ms: 1500 })],\n        spawn: async ({ connect, signal }) => {\n          const child = await createRpcHost({\n            plugins: [coroutinePlugin({ connectToParent: connect })],\n            provide: { double: (value: number) => value * 2 },\n          })\n          try {\n            if (!signal.aborted) {\n              await new Promise<void>((resolve) =>\n                signal.addEventListener('abort', () => resolve(), { once: true }),\n              )\n            }\n          } finally {\n            await child.close()\n          }\n        },\n      }),\n    ],\n  })\n  try {\n    return await host.coroutine.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}\n",
      options: [
        {
          name: 'ms',
          description: '有限非负的尝试毫秒数，零允许立即到期。',
          whenToUse: '有限非负的尝试毫秒数，零允许立即到期。',
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const"
        },
        {
          name: 'scheduler',
          description: '现有调度器拥有实际计时器及取消句柄。',
          whenToUse: '现有调度器拥有实际计时器及取消句柄。',
          defaultValue: '系统调度器。'
        },
        {
          name: 'report',
          description: '上报清理及落败分支失败，不替换主要取消或超时。',
          whenToUse: '上报清理及落败分支失败，不替换主要取消或超时。',
          defaultValue: '默认上报器。'
        }
      ],
      scenarios: [
        '限制发起请求的一次尝试，同时保留调用者或转发链路传来的更早截止时间。',
        '注入调度器与报告出口，管理计时器清理并观察稍后失败，不替换主要超时错误。'
      ],
      avoidWhen: [
        '不要用调用超时功能配置握手建立耗时；Session 握手拥有独立期限。',
        '不要把取消视为强制终止不配合的提供方，也不要把原始数字当作完整超时实例传入。'
      ]
    }
  },
  'rpc-host:features-retry:default': {
    en: {
      purpose:
        'Complete originating retry implementation borrowing actual replacement availability.',
      quickStart:
        "import linkPolicy from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({ features: [timeout({ ms: 1500 })] })",
      options: [
        {
          name: 'attempts',
          description: 'Positive safe integer total attempt count including the initial attempt.',
          whenToUse: 'Positive safe integer total attempt count including the initial attempt.',
          defaultValue: '2 attempts.',
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const"
        },
        {
          name: 'backoff',
          description:
            'Nonnegative milliseconds or a synchronous function of original error and utils retry context; a throw terminates retry.',
          whenToUse:
            'Nonnegative milliseconds or a synchronous function of original error and utils retry context; a throw terminates retry.',
          defaultValue: 'No extra delay.'
        },
        {
          name: 'keyFactory',
          description:
            'Issues the originating logical key; never substitute a remote diagnostic as authority.',
          whenToUse:
            'Issues the originating logical key; never substitute a remote diagnostic as authority.',
          defaultValue: 'defaultRpcId.'
        },
        {
          name: 'scheduler',
          description: 'Existing scheduler for cancellable owned backoff waits.',
          whenToUse: 'Existing scheduler for cancellable owned backoff waits.',
          defaultValue: 'systemScheduler.'
        },
        {
          name: 'report',
          description: 'Receives contained cleanup and late failures with original identity.',
          whenToUse: 'Receives contained cleanup and late failures with original identity.',
          defaultValue: 'defaultRpcReporter.'
        }
      ],
      scenarios: ['Choose complete per-call policy without adding a second Host or pending table.'],
      avoidWhen: []
    },
    zh: {
      purpose: '借用实际替换可用性的完整发起方重试实现。',
      quickStart:
        "import linkPolicy from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({ features: [timeout({ ms: 1500 })] })",
      options: [
        {
          name: 'attempts',
          description: '包含首次尝试的正安全整数总次数。',
          whenToUse: '包含首次尝试的正安全整数总次数。',
          defaultValue: '两次尝试。',
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const"
        },
        {
          name: 'backoff',
          description: '非负毫秒数，或接收原错误及工具重试上下文的同步函数；抛错会结束重试。',
          whenToUse: '非负毫秒数，或接收原错误及工具重试上下文的同步函数；抛错会结束重试。',
          defaultValue: '无额外延迟。'
        },
        {
          name: 'keyFactory',
          description: '签发发起方逻辑键，不以远端诊断代替权限。',
          whenToUse: '签发发起方逻辑键，不以远端诊断代替权限。',
          defaultValue: '默认标识分配器。'
        },
        {
          name: 'scheduler',
          description: '拥有可取消退避等待的现有调度器。',
          whenToUse: '拥有可取消退避等待的现有调度器。',
          defaultValue: '系统调度器。'
        },
        {
          name: 'report',
          description: '接收被隔离的清理及稍后失败并保留原身份。',
          whenToUse: '接收被隔离的清理及稍后失败并保留原身份。',
          defaultValue: '默认上报器。'
        }
      ],
      scenarios: ['选择完整单次调用策略，不增加第二个宿主或待决表。'],
      avoidWhen: []
    }
  },
  'rpc-host:features-timeout:default': {
    en: {
      purpose: 'Complete attempt-timeout implementation with owned timer cleanup.',
      quickStart:
        "import linkPolicy from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({ features: [timeout({ ms: 1500 })] })",
      options: [
        {
          name: 'ms',
          description: 'Finite nonnegative attempt milliseconds; zero allows immediate expiry.',
          whenToUse: 'Finite nonnegative attempt milliseconds; zero allows immediate expiry.',
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const"
        },
        {
          name: 'scheduler',
          description: 'Existing scheduler owns actual timer and cancellation handles.',
          whenToUse: 'Existing scheduler owns actual timer and cancellation handles.',
          defaultValue: 'systemScheduler.'
        },
        {
          name: 'report',
          description:
            'Reports cleanup/losing-branch failures without replacing the primary cancellation or timeout.',
          whenToUse:
            'Reports cleanup/losing-branch failures without replacing the primary cancellation or timeout.',
          defaultValue: 'defaultRpcReporter.'
        }
      ],
      scenarios: ['Choose complete per-call policy without adding a second Host or pending table.'],
      avoidWhen: []
    },
    zh: {
      purpose: '拥有计时器清理的完整尝试超时实现。',
      quickStart:
        "import linkPolicy from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({ features: [timeout({ ms: 1500 })] })",
      options: [
        {
          name: 'ms',
          description: '有限非负的尝试毫秒数，零允许立即到期。',
          whenToUse: '有限非负的尝试毫秒数，零允许立即到期。',
          example:
            "import { timeout, retry } from '@migaia/rpc-host/features'\nimport linkPolicy from '@migaia/rpc-host/plugins/link-policy'\n\nexport const defaults = linkPolicy({\n  features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n})\nexport const oneCall = { timeout: timeout({ ms: 100 }), retry: false } as const"
        },
        {
          name: 'scheduler',
          description: '现有调度器拥有实际计时器及取消句柄。',
          whenToUse: '现有调度器拥有实际计时器及取消句柄。',
          defaultValue: '系统调度器。'
        },
        {
          name: 'report',
          description: '上报清理及落败分支失败，不替换主要取消或超时。',
          whenToUse: '上报清理及落败分支失败，不替换主要取消或超时。',
          defaultValue: '默认上报器。'
        }
      ],
      scenarios: ['选择完整单次调用策略，不增加第二个宿主或待决表。'],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:HostObservationKind': {
    en: {
      purpose:
        'Actual accepted Session lifecycle observations; installing a subscriber does not create lifecycle authority.',
      quickStart:
        "import { HostObservationKind } from '@migaia/rpc-host/sdk'\nexport const choices = HostObservationKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '实际接纳会话生命周期观察，安装订阅者不会创建生命周期权限。',
      quickStart:
        "import { HostObservationKind } from '@migaia/rpc-host/sdk'\nexport const choices = HostObservationKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:IpcReporterContext': {
    en: {
      purpose:
        'Frozen utils reporter classification with operation limiter and phase reporter; use it only for secondary IPC observer failures.',
      quickStart: 'hostRethrowReporter(error, IpcReporterContext)',
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '冻结的工具上报分类，操作为限制器、阶段为上报者，只用于次级进程通信观察失败。',
      quickStart: 'hostRethrowReporter(error, IpcReporterContext)',
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RPC_STREAM_MAX_FRAME_BYTES': {
    en: {
      purpose:
        'Maximum payload bytes in one canonical physical length-prefixed frame: 16 MiB. This is not the business group count.',
      quickStart:
        "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '一个规范物理长度前缀帧的载荷字节上限：十六兆字节，不是业务分组数量。',
      quickStart:
        "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcBinaryProfile': {
    en: {
      purpose:
        'Portable binary representation profile migaia.rpc.portable-binary/1, nested inside the single migaia.rpc/2 semantic protocol; this is not a second RPC grammar.',
      quickStart:
        "import { RpcBinaryProfile } from '@migaia/rpc-host/sdk'\nexport const binaryProfile = RpcBinaryProfile",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '唯一第二版语义协议内部的第一版可移植二进制表示标记，不是第二套远程调用语法。',
      quickStart:
        "import { RpcBinaryProfile } from '@migaia/rpc-host/sdk'\nexport const binaryProfile = RpcBinaryProfile",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcBinaryStorage': {
    en: {
      purpose:
        'The acquired native media chooses the binary manifest representation; payload flags do not grant transfer.',
      quickStart:
        "import { RpcBinaryStorage } from '@migaia/rpc-host/sdk'\nexport const choices = RpcBinaryStorage",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '已获取原生媒介选择二进制清单表示，载荷标记不授予转移权限。',
      quickStart:
        "import { RpcBinaryStorage } from '@migaia/rpc-host/sdk'\nexport const choices = RpcBinaryStorage",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcBytePump': {
    en: {
      purpose:
        'Own one acquired native reader and writer. Reads begin only after the receiver subscribes, while original write ordering, cancellation and terminal resource cleanup remain under this pump.',
      quickStart:
        "import { RpcBytePump } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcByteReader,\n  IRpcByteWriter,\n  IRpcBytePumpOptions,\n} from '@migaia/rpc-host/sdk'\nexport function bytes(\n  reader: IRpcByteReader,\n  writer: IRpcByteWriter,\n  close: () => Promise<void>,\n  options: IRpcBytePumpOptions,\n) {\n  return new RpcBytePump(reader, writer, close, options).value\n}",
      options: [
        {
          name: 'closedError',
          description:
            'Original native closed-resource error factory, preserving the medium semantic code and native type.',
          whenToUse:
            'Original native closed-resource error factory, preserving the medium semantic code and native type.'
        },
        {
          name: 'report',
          description: 'Original native destination for contained background or cleanup failures.',
          whenToUse: 'Original native destination for contained background or cleanup failures.'
        },
        {
          name: 'observation',
          description: 'Original single native raw observer emitted at actual reads/writes.',
          whenToUse: 'Original single native raw observer emitted at actual reads/writes.'
        },
        {
          name: 'cleanupFailed',
          description:
            'Receives ordered original cleanup failures and returns the medium original aggregate error.',
          whenToUse:
            'Receives ordered original cleanup failures and returns the medium original aggregate error.'
        }
      ],
      scenarios: [
        'A Web Streams style native transport has already acquired its reader and writer locks.',
        'The carrier must pause acquisition of input until its actual Session receiver is ready to consume bytes.'
      ],
      avoidWhen: [
        'The source exposes Node-style data events; use RpcEventByteIO with its original event emitters.',
        'The application still needs to open the physical stream; acquire it in the concrete native source first.'
      ]
    },
    zh: {
      purpose:
        '持有一组已取得的原生读取及写入端口，只有接收者订阅后才开始读取；原写入顺序、取消及终态资源清理由该泵统一拥有。',
      quickStart:
        "import { RpcBytePump } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcByteReader,\n  IRpcByteWriter,\n  IRpcBytePumpOptions,\n} from '@migaia/rpc-host/sdk'\nexport function bytes(\n  reader: IRpcByteReader,\n  writer: IRpcByteWriter,\n  close: () => Promise<void>,\n  options: IRpcBytePumpOptions,\n) {\n  return new RpcBytePump(reader, writer, close, options).value\n}",
      options: [
        {
          name: 'closedError',
          description: '原生原资源关闭错误工厂，保留媒介语义错误码及原生类型。',
          whenToUse: '原生原资源关闭错误工厂，保留媒介语义错误码及原生类型。'
        },
        {
          name: 'report',
          description: '被隔离后台及清理失败的原生原上报通道。',
          whenToUse: '被隔离后台及清理失败的原生原上报通道。'
        },
        {
          name: 'observation',
          description: '在实际读写点发出的原唯一原生原始观察器。',
          whenToUse: '在实际读写点发出的原唯一原生原始观察器。'
        },
        {
          name: 'cleanupFailed',
          description: '接收有序原清理失败并返回媒介原聚合错误。',
          whenToUse: '接收有序原清理失败并返回媒介原聚合错误。'
        }
      ],
      scenarios: [
        '采用 Web Streams 的原生传输已经取得读取及写入锁。',
        '载体需要等待实际会话接收者准备好后才读取输入字节。'
      ],
      avoidWhen: [
        '原生源暴露 Node 风格数据事件时，应使用 RpcEventByteIO。',
        '仍需打开物理流时，应先在具体原生源取得资源。'
      ]
    }
  },
  'rpc-host:sdk:RpcCarrierObservation': {
    en: {
      purpose:
        'Own exact raw-observation subscriptions and immutable media facts for one acquired native carrier. Emission borrows the actual read or write value and sizes it only while subscribers exist.',
      quickStart:
        "import { RpcCarrierObservation } from '@migaia/rpc-host/sdk'\nimport { RpcCarrierPlatform, RpcCarrierEncoding } from '@migaia/rpc-contract/interfaces'\nexport const observation = new RpcCarrierObservation(\n  {\n    platform: RpcCarrierPlatform.messagePort,\n    encodedType: RpcCarrierEncoding.any,\n  },\n  console.error,\n)",
      options: [],
      scenarios: [
        'A concrete native IO point must emit the original message or byte chunk to subscribed observers.',
        'A carrier lends true platform, topology and encoding facts to the Host observation stage.'
      ],
      avoidWhen: [
        'An observer needs semantic provider data; select an envelope or dispatch observation stage.',
        'The caller has no actual native resource facts; do not label invented frames as raw carrier events.'
      ]
    },
    zh: {
      purpose:
        '为一个已取得原生载体拥有精确原始观察订阅及不可变媒介事实；只在存在订阅者时借出实际读写值并计量，不复制或解析业务负载。',
      quickStart:
        "import { RpcCarrierObservation } from '@migaia/rpc-host/sdk'\nimport { RpcCarrierPlatform, RpcCarrierEncoding } from '@migaia/rpc-contract/interfaces'\nexport const observation = new RpcCarrierObservation(\n  {\n    platform: RpcCarrierPlatform.messagePort,\n    encodedType: RpcCarrierEncoding.any,\n  },\n  console.error,\n)",
      options: [],
      scenarios: [
        '具体原生读写位置需要把原消息或原字节块发给已订阅观察器。',
        '载体需要向宿主观察阶段借出真实平台、拓扑及编码事实。'
      ],
      avoidWhen: [
        '观察器需要提供方语义数据时，应选择信封或派发观察阶段。',
        '没有实际原生资源事实时，不应把构造帧标记为原始载体事件。'
      ]
    }
  },
  'rpc-host:sdk:RpcEventByteIO': {
    en: {
      purpose:
        'Own original event-based byte readers and writers with pause/resume, native callback settlement and drain ordering. Close removes the exact native listeners while preserving the real writer flush terminal.',
      quickStart:
        "import { RpcEventByteIO } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcEventByteReader,\n  IRpcEventByteWriter,\n  IRpcEventByteIOOptions,\n} from '@migaia/rpc-host/sdk'\nexport function bytes(\n  reader: IRpcEventByteReader,\n  writer: IRpcEventByteWriter,\n  close: () => void,\n  options: IRpcEventByteIOOptions,\n) {\n  return new RpcEventByteIO(reader, writer, close, options).value\n}",
      options: [
        {
          name: 'closedError',
          description:
            'Original native closed-resource error factory, preserving the medium semantic code and native type.',
          whenToUse:
            'Original native closed-resource error factory, preserving the medium semantic code and native type.'
        },
        {
          name: 'report',
          description: 'Original native destination for contained background or cleanup failures.',
          whenToUse: 'Original native destination for contained background or cleanup failures.'
        },
        {
          name: 'observation',
          description: 'Original single native raw observer emitted at actual reads/writes.',
          whenToUse: 'Original single native raw observer emitted at actual reads/writes.'
        }
      ],
      scenarios: [
        'A process pipe or Node stream already exposes data, end, error and drain events.',
        'A native owner needs pending writes and close to follow its actual stream callbacks rather than a second queue.'
      ],
      avoidWhen: [
        'The native API uses reader and writer locks rather than events; use RpcBytePump.',
        'A caller expects this IO owner to launch, handshake or supervise a process; those responsibilities remain outside it.'
      ]
    },
    zh: {
      purpose:
        '持有原事件式字节读写端口，保持暂停恢复、原生回调结算及排空顺序；关闭时移除精确原生监听器，并保留实际写入刷新终态。',
      quickStart:
        "import { RpcEventByteIO } from '@migaia/rpc-host/sdk'\nimport type {\n  IRpcEventByteReader,\n  IRpcEventByteWriter,\n  IRpcEventByteIOOptions,\n} from '@migaia/rpc-host/sdk'\nexport function bytes(\n  reader: IRpcEventByteReader,\n  writer: IRpcEventByteWriter,\n  close: () => void,\n  options: IRpcEventByteIOOptions,\n) {\n  return new RpcEventByteIO(reader, writer, close, options).value\n}",
      options: [
        {
          name: 'closedError',
          description: '原生原资源关闭错误工厂，保留媒介语义错误码及原生类型。',
          whenToUse: '原生原资源关闭错误工厂，保留媒介语义错误码及原生类型。'
        },
        {
          name: 'report',
          description: '被隔离后台及清理失败的原生原上报通道。',
          whenToUse: '被隔离后台及清理失败的原生原上报通道。'
        },
        {
          name: 'observation',
          description: '在实际读写点发出的原唯一原生原始观察器。',
          whenToUse: '在实际读写点发出的原唯一原生原始观察器。'
        }
      ],
      scenarios: [
        '进程管道或 Node 流已经提供 data、end、error 及 drain 事件。',
        '原生所有者需要让待决写入与关闭遵循实际流回调，而非另建队列。'
      ],
      avoidWhen: [
        '原生接口使用读写锁而非事件时，应使用 RpcBytePump。',
        '需要启动、握手或监管进程时，应使用相应所有者，而非此读写实现。'
      ]
    }
  },
  'rpc-host:sdk:RpcJsonCarrierCodec': {
    en: {
      purpose:
        'Own the single prepare, encode, decode and restore chain for the JSON carrier. Capture precedes hooks and hashing, parsing happens once, and restore owns semantic admission and binary reconstruction.',
      quickStart:
        "import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'\nexport const codec = new RpcJsonCarrierCodec()",
      options: [
        {
          name: 'digest',
          description:
            'Actual native SHA-256 backing digest capability; it is not authentication authority.',
          whenToUse:
            'Actual native SHA-256 backing digest capability; it is not authentication authority.',
          defaultValue: 'Use available native digest capability.'
        },
        {
          name: 'projectDecodeFailure',
          description:
            'Called only with the already privacy-projected original parser cause. Return this media native coded Error; do not parse the text again.',
          whenToUse:
            'Called only with the already privacy-projected original parser cause. Return this media native coded Error; do not parse the text again.'
        }
      ],
      scenarios: [
        'A native message or byte carrier needs the canonical JSON and binary-sidecar encoding contract.',
        'Authentication hooks must protect prepared metadata and reuse the same cached restore admission.'
      ],
      avoidWhen: [
        'A flow plugin wants to replace the codec with its own parser; use the existing prepared-message hooks instead.',
        'An application already holds admitted semantic values; do not encode and parse them merely to inspect fields.'
      ]
    },
    zh: {
      purpose:
        '拥有 JSON 载体唯一准备、编码、解码及恢复执行链；捕获先于介入点和散列，解析只执行一次，恢复统一拥有语义准入及二进制重建。',
      quickStart:
        "import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'\nexport const codec = new RpcJsonCarrierCodec()",
      options: [
        {
          name: 'digest',
          description: '实际原生完整缓冲区散列能力，不授予认证权限。',
          whenToUse: '实际原生完整缓冲区散列能力，不授予认证权限。',
          defaultValue: '使用可用的原生散列能力。'
        },
        {
          name: 'projectDecodeFailure',
          description:
            '仅以已经过隐私投影的原解析原因调用，返回本媒介原生分类错误，不再次解析文本。',
          whenToUse: '仅以已经过隐私投影的原解析原因调用，返回本媒介原生分类错误，不再次解析文本。'
        }
      ],
      scenarios: [
        '原生消息或字节载体需要使用规范 JSON 及二进制附带编码契约。',
        '认证介入点需要保护准备元数据，并复用同一缓存恢复准入。'
      ],
      avoidWhen: [
        '信息流插件不应另建解析器替换编解码器，应使用已有准备消息介入点。',
        '应用已经持有接纳语义值时，不应只为读字段而再次编码解析。'
      ]
    }
  },
  'rpc-host:sdk:RpcMemberConnectionDirection': {
    en: {
      purpose: 'Actual local/bootstrap direction, independent of owned or borrowed lifetime.',
      quickStart:
        "import { RpcMemberConnectionDirection } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberConnectionDirection",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '实际本地及启动方向，与拥有或借用生命周期不同。',
      quickStart:
        "import { RpcMemberConnectionDirection } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberConnectionDirection",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcMemberEventName': {
    en: {
      purpose:
        'Passive member events come from original native lifecycle or completed explicit liquidation.',
      quickStart:
        "import { RpcMemberEventName } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberEventName",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '被动成员事件来自原原生生命周期或已完成显式清算。',
      quickStart:
        "import { RpcMemberEventName } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberEventName",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcMemberGeneration': {
    en: {
      purpose:
        'Manage one accepted member generation using the actual supervisor and native acquire, attach and detach ports. Replacement publication and rollback reuse the sole generation owner without adding business requests.',
      quickStart:
        "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberGenerationOptions } from '@migaia/rpc-host/sdk'\nexport function member<T, S>(options: IRpcMemberGenerationOptions<T, S>) {\n  return new RpcMemberGeneration(options)\n}",
      options: [
        {
          name: 'context',
          description:
            'Actual transport setup ports from native installation, borrowing the unique Session owner.',
          whenToUse:
            'Actual transport setup ports from native installation, borrowing the unique Session owner.'
        },
        {
          name: 'binding',
          description:
            'Original supervisor, scheduler, ownership and carrier acquisition for this exact native registration.',
          whenToUse:
            'Original supervisor, scheduler, ownership and carrier acquisition for this exact native registration.'
        },
        {
          name: 'signal',
          description:
            'Owning installation or operation cancellation signal; no new lifetime is inferred from wire fields.',
          whenToUse:
            'Owning installation or operation cancellation signal; no new lifetime is inferred from wire fields.'
        },
        {
          name: 'report',
          description:
            'Receives contained asynchronous native/cleanup failures without replacing the primary business result.',
          whenToUse:
            'Receives contained asynchronous native/cleanup failures without replacing the primary business result.'
        },
        {
          name: 'beforeRelease',
          description: 'Joins the existing native drain before accepted Session detach.',
          whenToUse: 'Joins the existing native drain before accepted Session detach.',
          defaultValue: 'No extra release work.'
        },
        {
          name: 'onReady',
          description:
            'Receives committed accepted view, generation, original unit and exact Session handle; do not start another readiness state.',
          whenToUse:
            'Receives committed accepted view, generation, original unit and exact Session handle; do not start another readiness state.',
          defaultValue: 'No readiness observer.'
        },
        {
          name: 'onNative',
          description:
            'Receives the original supervisor event and safe current metadata without another native event subscription.',
          whenToUse:
            'Receives the original supervisor event and safe current metadata without another native event subscription.',
          defaultValue: 'No native event observer.'
        }
      ],
      scenarios: [
        'A process or thread source needs consistent rebind and rollback across actual native replacements.',
        'A native owner must retire an old accepted Session while preserving its supervisor and original resource identity.'
      ],
      avoidWhen: [
        'The requirement is a call retry or provider registry; use the call or dispatch owner.',
        'A second supervisor would be created only to obtain generation events; borrow the original native supervisor instead.'
      ]
    },
    zh: {
      purpose:
        '借用实际监管器及原生获取、附加和摘除端口，管理一个已接纳成员代际；替换发布及回滚复用唯一代际所有者，不增加业务请求实现。',
      quickStart:
        "import { RpcMemberGeneration } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberGenerationOptions } from '@migaia/rpc-host/sdk'\nexport function member<T, S>(options: IRpcMemberGenerationOptions<T, S>) {\n  return new RpcMemberGeneration(options)\n}",
      options: [
        {
          name: 'context',
          description: '原生安装提供的真实传输设置端口，借用唯一会话所有者。',
          whenToUse: '原生安装提供的真实传输设置端口，借用唯一会话所有者。'
        },
        {
          name: 'binding',
          description: '本精确原生登记的原监管器、调度器、所有权及载体获取。',
          whenToUse: '本精确原生登记的原监管器、调度器、所有权及载体获取。'
        },
        {
          name: 'signal',
          description: '所属安装或操作取消信号，不从线上字段推断新生命周期。',
          whenToUse: '所属安装或操作取消信号，不从线上字段推断新生命周期。'
        },
        {
          name: 'report',
          description: '接收被隔离的原生及清理异步失败，不替换主要业务结果。',
          whenToUse: '接收被隔离的原生及清理异步失败，不替换主要业务结果。'
        },
        {
          name: 'beforeRelease',
          description: '在接纳会话摘除前等待原生现有排空。',
          whenToUse: '在接纳会话摘除前等待原生现有排空。',
          defaultValue: '无额外释放工作。'
        },
        {
          name: 'onReady',
          description: '接收已提交接纳视图、代际、原单元及精确会话句柄，不另启动就绪状态。',
          whenToUse: '接收已提交接纳视图、代际、原单元及精确会话句柄，不另启动就绪状态。',
          defaultValue: '无就绪观察器。'
        },
        {
          name: 'onNative',
          description: '接收原监管事件及安全当前元数据，不另订阅原生事件。',
          whenToUse: '接收原监管事件及安全当前元数据，不另订阅原生事件。',
          defaultValue: '无原生事件观察器。'
        }
      ],
      scenarios: [
        '进程或线程源需要让实际原生替换复用一致的重新绑定及回滚顺序。',
        '原生所有者需要退场旧接纳会话，同时保留监管器及原资源身份。'
      ],
      avoidWhen: [
        '需要调用重试或提供方登记时，应使用调用或派发所有者。',
        '不能只为取得代际事件而创建第二监管器，应借用原生监管器。'
      ]
    }
  },
  'rpc-host:sdk:RpcMemberMetricScope': {
    en: {
      purpose:
        'Metric denominators identify actual source scope rather than attributing global totals to a peer.',
      quickStart:
        "import { RpcMemberMetricScope } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberMetricScope",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '指标分母标明实际来源作用域，不把全局总量归给某对端。',
      quickStart:
        "import { RpcMemberMetricScope } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberMetricScope",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcMemberMetricUnit': {
    en: {
      purpose: 'Explicit units keep counts, time, bytes and ratios separate.',
      quickStart:
        "import { RpcMemberMetricUnit } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberMetricUnit",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '显式单位使数量、时间、字节及比例保持区别。',
      quickStart:
        "import { RpcMemberMetricUnit } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberMetricUnit",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcMemberQueryClock': {
    en: {
      purpose: 'Original monotonic scheduler timestamps do not use wall-clock epoch time.',
      quickStart:
        "import { RpcMemberQueryClock } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberQueryClock",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '原单调调度时间戳不使用墙上时钟纪元时间。',
      quickStart:
        "import { RpcMemberQueryClock } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberQueryClock",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcMemberQueryLimit': {
    en: {
      purpose: 'The original passive recent/watch retention bound, not provider concurrency.',
      quickStart:
        "import { RpcMemberQueryLimit } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberQueryLimit",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '原被动历史及观察保留上限，不是提供方并发。',
      quickStart:
        "import { RpcMemberQueryLimit } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberQueryLimit",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcMemberQueryReason': {
    en: {
      purpose:
        'Canonical explanations for unavailable native/member observations without invented healthy/zero values.',
      quickStart:
        "import { RpcMemberQueryReason } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberQueryReason",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '原生及成员观察不可用的规范说明，不伪造健康或零值。',
      quickStart:
        "import { RpcMemberQueryReason } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberQueryReason",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcMemberQueryStatus': {
    en: {
      purpose: 'Safe actual connection availability; missing observations remain explicit.',
      quickStart:
        "import { RpcMemberQueryStatus } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberQueryStatus",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '安全实际连接可用性，缺失观察保持显式。',
      quickStart:
        "import { RpcMemberQueryStatus } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberQueryStatus",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcMemberRecentKind': {
    en: {
      purpose:
        'Bounded original registration-departure facts do not manufacture native exit state.',
      quickStart:
        "import { RpcMemberRecentKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberRecentKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '有界原登记离开事实不会制造原生退出状态。',
      quickStart:
        "import { RpcMemberRecentKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberRecentKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcMemberResourceKind': {
    en: {
      purpose: 'Native CPU time and event-loop utilization are separate resource dimensions.',
      quickStart:
        "import { RpcMemberResourceKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberResourceKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '原生处理器时间及事件循环使用率是不同资源维度。',
      quickStart:
        "import { RpcMemberResourceKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberResourceKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcMemberSourceKind': {
    en: {
      purpose: 'Actual native source acquisition mode, independent of connection direction.',
      quickStart:
        "import { RpcMemberSourceKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberSourceKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '实际原生来源获取模式，与连接方向不同。',
      quickStart:
        "import { RpcMemberSourceKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcMemberSourceKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcMemberStopSignal': {
    en: {
      purpose:
        'Original graceful process signal SIGTERM; thread/coroutine controls do not gain process signaling.',
      quickStart:
        "import { RpcMemberStopSignal } from '@migaia/rpc-host/sdk'\nexport const processStop = { signal: RpcMemberStopSignal }",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '原优雅进程结束信号，线程及协作任务控制不获得进程信号权限。',
      quickStart:
        "import { RpcMemberStopSignal } from '@migaia/rpc-host/sdk'\nexport const processStop = { signal: RpcMemberStopSignal }",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcNativeFeatureKind': {
    en: {
      purpose: 'Concrete native transport installs the complete same-medium resource feature.',
      quickStart:
        "import { RpcNativeFeatureKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcNativeFeatureKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '具体原生传输安装完整同媒介资源功能。',
      quickStart:
        "import { RpcNativeFeatureKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcNativeFeatureKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcNativeMemberKind': {
    en: {
      purpose:
        'Original native capability family determines the existing control/sampling boundary.',
      quickStart:
        "import { RpcNativeMemberKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcNativeMemberKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '原原生能力类别决定既有控制及采样边界。',
      quickStart:
        "import { RpcNativeMemberKind } from '@migaia/rpc-host/sdk'\nexport const choices = RpcNativeMemberKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcNativeMembers': {
    en: {
      purpose:
        'Project local member queries and controls from the actual native records and their existing indexes. It borrows the original supervisor and generation owner rather than maintaining another member registry.',
      quickStart:
        "import { RpcNativeMembers } from '@migaia/rpc-host/sdk'\nimport type { IRpcNativeMembersOptions } from '@migaia/rpc-host/sdk'\nexport function controls(options: IRpcNativeMembersOptions<'process'>) {\n  return new RpcNativeMembers(options)\n}",
      options: [
        {
          name: 'kind',
          description: 'Actual configured source mode or native unit kind from the original owner.',
          whenToUse: 'Actual configured source mode or native unit kind from the original owner.'
        },
        {
          name: 'self',
          description:
            'Actual global Host name/instance identity captured before asynchronous query sampling.',
          whenToUse:
            'Actual global Host name/instance identity captured before asynchronous query sampling.'
        },
        {
          name: 'source',
          description: 'Actual native registration source; no second lookup table is created.',
          whenToUse: 'Actual native registration source; no second lookup table is created.'
        },
        {
          name: 'report',
          description: 'Original native diagnostic destination for contained query/event errors.',
          whenToUse: 'Original native diagnostic destination for contained query/event errors.'
        }
      ],
      scenarios: [
        'A concrete native transport exposes list, get, stop or restart through its namespace members extension.',
        'Operator events and safe overviews must refer to the same accepted native records used by controls.'
      ],
      avoidWhen: [
        'The operation is a remote business request; use the namespace call methods.',
        'A borrowed member has no supervisor for destructive control; do not synthesize one from its name.'
      ]
    },
    zh: {
      purpose:
        '从真实原生记录及其既有索引投影本地成员查询和控制；借用原监管器与代际所有者，不维护另一套成员登记表。',
      quickStart:
        "import { RpcNativeMembers } from '@migaia/rpc-host/sdk'\nimport type { IRpcNativeMembersOptions } from '@migaia/rpc-host/sdk'\nexport function controls(options: IRpcNativeMembersOptions<'process'>) {\n  return new RpcNativeMembers(options)\n}",
      options: [
        {
          name: 'kind',
          description: '原所有者提供的实际配置来源模式或原生单元类别。',
          whenToUse: '原所有者提供的实际配置来源模式或原生单元类别。'
        },
        {
          name: 'self',
          description: '异步查询采样前捕获的实际全局宿主名称及实例身份。',
          whenToUse: '异步查询采样前捕获的实际全局宿主名称及实例身份。'
        },
        {
          name: 'source',
          description: '实际原生登记来源，不创建第二查找表。',
          whenToUse: '实际原生登记来源，不创建第二查找表。'
        },
        {
          name: 'report',
          description: '被隔离查询及事件错误的原生原诊断通道。',
          whenToUse: '被隔离查询及事件错误的原生原诊断通道。'
        }
      ],
      scenarios: [
        '具体原生传输需要通过命名空间 members 扩展公开列表、查询、停止或重启。',
        '运维事件及安全概览需要引用控制入口使用的同一已接纳原生记录。'
      ],
      avoidWhen: [
        '操作属于远端业务请求时，应使用命名空间调用方法。',
        '借用成员没有可执行破坏性控制的监管器时，不能按名称伪造一个监管器。'
      ]
    }
  },
  'rpc-host:sdk:RpcNativePoolMember': {
    en: {
      purpose:
        'Project an actual native registration into the repeatable pool-member ports. Current and ready reuse the original private Session handle and generation rebind promise without new media or lifecycle state.',
      quickStart:
        "import type { IRpcNativePoolMember } from '@migaia/rpc-host/sdk'\nexport async function acquired(member: IRpcNativePoolMember) {\n  return member.ready()\n}",
      options: [
        {
          name: 'record',
          description:
            'Exact original native registration, including accepted stable name and safe local query capabilities.',
          whenToUse:
            'Exact original native registration, including accepted stable name and safe local query capabilities.'
        },
        {
          name: 'native',
          description: 'Original native generation authority borrowed by this member.',
          whenToUse: 'Original native generation authority borrowed by this member.'
        },
        {
          name: 'close',
          description:
            'Original exact resource close callable; repeated closes share its owned completion.',
          whenToUse:
            'Original exact resource close callable; repeated closes share its owned completion.'
        }
      ],
      scenarios: [
        'A supported repeatable native source lends its real registration to the pool feature.',
        'Pool scheduling must wait on the same generation readiness used by the concrete source.'
      ],
      avoidWhen: [
        'The native source is a parent or listener without repeatable acquisition; do not fabricate pool membership.',
        'A caller expects a second business pending table or codec; use the sole private Session instead.'
      ]
    },
    zh: {
      purpose:
        '把实际原生登记投影为可重复获取的池成员端口；current 及 ready 复用原私有会话句柄与代际重新绑定 Promise，不增加媒介或生命周期状态。',
      quickStart:
        "import type { IRpcNativePoolMember } from '@migaia/rpc-host/sdk'\nexport async function acquired(member: IRpcNativePoolMember) {\n  return member.ready()\n}",
      options: [
        {
          name: 'record',
          description: '精确原生原登记，包含已接纳稳定名称及安全本地查询能力。',
          whenToUse: '精确原生原登记，包含已接纳稳定名称及安全本地查询能力。'
        },
        {
          name: 'native',
          description: '本成员借用的原生原代际权限。',
          whenToUse: '本成员借用的原生原代际权限。'
        },
        {
          name: 'close',
          description: '原精确资源关闭方法，重复关闭共享其拥有的完成。',
          whenToUse: '原精确资源关闭方法，重复关闭共享其拥有的完成。'
        }
      ],
      scenarios: [
        '受支持的可重复原生源需要把真实登记借给池功能。',
        '池调度需要等待具体来源使用的同一代际就绪过程。'
      ],
      avoidWhen: [
        '原生源是无法重复获取的父端或监听器时，不能伪造池成员能力。',
        '需要业务待决状态或编解码时，应使用唯一私有会话，不能另建一份。'
      ]
    }
  },
  'rpc-host:sdk:RpcPortableCapture': {
    en: {
      purpose:
        'Create one owned portable snapshot through the canonical serialize walker. Capture preserves real native buffers, backing aliases and view identity before asynchronous codec work begins.',
      quickStart:
        "import { RpcPortableCapture } from '@migaia/rpc-host/sdk'\nconst capture = new RpcPortableCapture()\nexport const snapshot = capture.normalize({ label: 'ready' })",
      options: [],
      scenarios: [
        'A codec must capture caller values synchronously before hashing or an asynchronous hook.',
        'Native binary aliases must remain available to the same preparation traversal without a second graph walker.'
      ],
      avoidWhen: [
        'The value already carries the canonical owned snapshot receipt; reuse that snapshot.',
        'The input is untrusted remote metadata requiring admission; use codec restore and protocol normalization.'
      ]
    },
    zh: {
      purpose:
        '通过规范序列化遍历器创建唯一已拥有可移植快照，在异步编解码工作前保留真实原生缓冲区、底层别名及视图身份。',
      quickStart:
        "import { RpcPortableCapture } from '@migaia/rpc-host/sdk'\nconst capture = new RpcPortableCapture()\nexport const snapshot = capture.normalize({ label: 'ready' })",
      options: [],
      scenarios: [
        '编解码器需要在散列或异步介入点前同步捕获调用者值。',
        '原生二进制别名需要在同一次准备遍历中保留，不能增加第二图遍历器。'
      ],
      avoidWhen: [
        '值已经带有规范已拥有快照凭据时，应复用该快照。',
        '输入是需要准入的远端元数据时，应使用编解码恢复及协议规范化。'
      ]
    }
  },
  'rpc-host:sdk:RpcProtocolEvent': {
    en: {
      purpose:
        'Readonly protocol/control observations consumed through the actual observer boundary.',
      quickStart:
        "import { RpcProtocolEvent } from '@migaia/rpc-host/sdk'\nexport const choices = RpcProtocolEvent",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '通过实际观察边界消费的只读协议及控制观察。',
      quickStart:
        "import { RpcProtocolEvent } from '@migaia/rpc-host/sdk'\nexport const choices = RpcProtocolEvent",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:sdk:RpcUtf8': {
    en: {
      purpose:
        'Capture a real text encoder and fatal UTF-8 decoder for a carrier. Invalid bytes preserve the exact native decoding error as the cause of the canonical handshake failure.',
      quickStart:
        "import { RpcUtf8 } from '@migaia/rpc-host/sdk'\nconst utf8 = new RpcUtf8()\nexport const text = utf8.decode(new Uint8Array([111, 107]))",
      options: [
        {
          name: 'encoder',
          description: 'Native encode/encodeInto receiver captured once.',
          whenToUse: 'Native encode/encodeInto receiver captured once.',
          defaultValue: 'new TextEncoder().'
        },
        {
          name: 'decoder',
          description: 'Native fatal decoder; malformed text is not silently replaced.',
          whenToUse: 'Native fatal decoder; malformed text is not silently replaced.',
          defaultValue: 'new TextDecoder with fatal:true.'
        }
      ],
      scenarios: [
        'A byte carrier must reject malformed UTF-8 instead of replacing invalid sequences.',
        'A transport injects its actual encoder and fatal decoder while preserving their native error identity.'
      ],
      avoidWhen: [
        'The source already supplies JavaScript values or strings; no byte decoding boundary is needed.',
        'The decoder silently replaces malformed bytes; it does not satisfy this carrier contract.'
      ]
    },
    zh: {
      purpose:
        '为载体捕获真实文本编码器及严格 UTF-8 解码器；非法字节以规范握手失败包装，并在原因链保留精确原生解码异常。',
      quickStart:
        "import { RpcUtf8 } from '@migaia/rpc-host/sdk'\nconst utf8 = new RpcUtf8()\nexport const text = utf8.decode(new Uint8Array([111, 107]))",
      options: [
        {
          name: 'encoder',
          description: '只捕获一次的原生编码接收者。',
          whenToUse: '只捕获一次的原生编码接收者。',
          defaultValue: '创建原生文本编码器。'
        },
        {
          name: 'decoder',
          description: '严格原生解码器，不静默替换非法文本。',
          whenToUse: '严格原生解码器，不静默替换非法文本。',
          defaultValue: '创建启用严格模式的原生文本解码器。'
        }
      ],
      scenarios: [
        '字节载体需要拒绝非法 UTF-8，而不是以替代字符悄悄修复。',
        '传输需要注入实际编码器及严格解码器，同时保留原生错误身份。'
      ],
      avoidWhen: [
        '原生源已经交付 JavaScript 值或文本时，不需要字节解码边界。',
        '解码器会静默替换非法字节时，它不满足此载体契约。'
      ]
    }
  },
  'rpc-host:sdk:createRpcBackingDigest': {
    en: {
      purpose:
        'Capture an available native cryptographic digest receiver and hash every byte of an original binary backing with SHA-256. Absence is explicit; hashing supplies integrity metadata, not peer authority.',
      quickStart:
        "import { createRpcBackingDigest } from '@migaia/rpc-host/sdk'\nexport const digest = createRpcBackingDigest()",
      options: [],
      scenarios: [
        'A native-binary codec needs integrity digests for original complete backing buffers.',
        'A transport checks whether the runtime offers the required native cryptographic capability before selecting binary handling.'
      ],
      avoidWhen: [
        'A digest is expected to authenticate a peer or sign an envelope; use the authentication plugin.',
        'The runtime supplies no native digest capability; do not replace absence with an invented integrity proof.'
      ]
    },
    zh: {
      purpose:
        '捕获可用的原生加密散列接收者，以 SHA-256 计算原完整二进制缓冲区的每个字节；能力缺失会明确返回，不把完整性元数据当作对端权限。',
      quickStart:
        "import { createRpcBackingDigest } from '@migaia/rpc-host/sdk'\nexport const digest = createRpcBackingDigest()",
      options: [],
      scenarios: [
        '原生二进制编解码器需要为原完整底层缓冲区生成完整性散列。',
        '传输选择二进制处理方式前，需要检查运行时是否提供原生加密能力。'
      ],
      avoidWhen: [
        '需要认证对端或签名信封时，应使用认证插件，而非单独的内容散列。',
        '运行时没有原生散列能力时，不应以虚构证明替代明确缺失。'
      ]
    }
  },
  'rpc-host:sdk:createRpcByteCarrier': {
    en: {
      purpose:
        'Own an already-acquired ordered byte IO resource through fatal UTF-8 decoding, canonical length framing and one carrier close lifetime. Native acquisition remains with the concrete transport.',
      quickStart:
        "import { createRpcByteCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport function acquire(io: IRpcByteIO, id: string, report: (error: unknown) => void) {\n  return createRpcByteCarrier({ id, io, report })\n}",
      options: [
        {
          name: 'id',
          description:
            'Native acquisition issues this unique carrier id before Session attachment; it is not a remote business id.',
          whenToUse:
            'Native acquisition issues this unique carrier id before Session attachment; it is not a remote business id.'
        },
        {
          name: 'io',
          description:
            'The original acquired native message/byte IO; wrappers must retain its close, callbacks and actual transfer semantics.',
          whenToUse:
            'The original acquired native message/byte IO; wrappers must retain its close, callbacks and actual transfer semantics.'
        },
        {
          name: 'report',
          description:
            'Receives contained asynchronous native/cleanup failures without replacing the primary business result.',
          whenToUse:
            'Receives contained asynchronous native/cleanup failures without replacing the primary business result.'
        },
        {
          name: 'digest',
          description:
            'Actual native SHA-256 backing digest capability; it is not authentication authority.',
          whenToUse:
            'Actual native SHA-256 backing digest capability; it is not authentication authority.',
          defaultValue: 'Use available native digest capability.'
        },
        {
          name: 'codec',
          description:
            'One actual prepare/encode/decode/restore codec; no identity codec or second semantic parser is inserted.',
          whenToUse:
            'One actual prepare/encode/decode/restore codec; no identity codec or second semantic parser is inserted.',
          defaultValue: 'RpcJsonCarrierCodec.'
        },
        {
          name: 'errorMetadata',
          description:
            'Caller-owned error presentation maps for actual local errors created during this operation; diagnostics confer no authority.',
          whenToUse:
            'Caller-owned error presentation maps for actual local errors created during this operation; diagnostics confer no authority.',
          defaultValue: 'No extra presentation maps.'
        },
        {
          name: 'observation',
          description: 'Actual native raw observation capability, emitted at physical IO only.',
          whenToUse: 'Actual native raw observation capability, emitted at physical IO only.',
          defaultValue: 'No physical observation.'
        },
        {
          name: 'assertTransfer',
          description:
            'Native synchronous transfer capability check; preserve the medium original coded rejection.',
          whenToUse:
            'Native synchronous transfer capability check; preserve the medium original coded rejection.',
          defaultValue: 'Native binary media permit transfer; inline-only media reject.'
        },
        {
          name: 'utf8',
          description:
            'Optional structural encoder/fatal decoder injection from the acquiring platform.',
          whenToUse:
            'Optional structural encoder/fatal decoder injection from the acquiring platform.',
          defaultValue: 'Standard native TextEncoder/TextDecoder.'
        }
      ],
      scenarios: [
        'A process pipe or socket already supplies ordered bytes and needs the canonical RPC carrier boundary.',
        'A byte transport must lend its original IO close and optional raw observation capability to one Session.'
      ],
      avoidWhen: [
        'The native API already delivers whole structured messages; use createRpcMessageCarrier.',
        'The caller still needs to spawn a process or connect a socket; acquire that resource in its native transport owner first.'
      ]
    },
    zh: {
      purpose:
        '通过严格 UTF-8 解码、规范长度分帧及唯一关闭生命周期持有已经取得的有序字节资源；原生资源获取仍由具体传输负责。',
      quickStart:
        "import { createRpcByteCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcByteIO } from '@migaia/rpc-host/sdk'\n\nexport function acquire(io: IRpcByteIO, id: string, report: (error: unknown) => void) {\n  return createRpcByteCarrier({ id, io, report })\n}",
      options: [
        {
          name: 'id',
          description: '原生获取在会话附加前签发的唯一载体标识，不是远端业务标识。',
          whenToUse: '原生获取在会话附加前签发的唯一载体标识，不是远端业务标识。'
        },
        {
          name: 'io',
          description: '原获取的原生消息或字节读写资源，边界保留其关闭、回调及实际转移语义。',
          whenToUse: '原获取的原生消息或字节读写资源，边界保留其关闭、回调及实际转移语义。'
        },
        {
          name: 'report',
          description: '接收被隔离的原生及清理异步失败，不替换主要业务结果。',
          whenToUse: '接收被隔离的原生及清理异步失败，不替换主要业务结果。'
        },
        {
          name: 'digest',
          description: '实际原生完整缓冲区散列能力，不授予认证权限。',
          whenToUse: '实际原生完整缓冲区散列能力，不授予认证权限。',
          defaultValue: '使用可用的原生散列能力。'
        },
        {
          name: 'codec',
          description:
            '唯一实际准备、编码、解码及恢复编解码器，不插入恒等编解码器或第二语义解析器。',
          whenToUse: '唯一实际准备、编码、解码及恢复编解码器，不插入恒等编解码器或第二语义解析器。',
          defaultValue: '共享 JSON 载体编解码器。'
        },
        {
          name: 'errorMetadata',
          description: '本操作实际本地错误所用的调用方展示映射，诊断不授予权限。',
          whenToUse: '本操作实际本地错误所用的调用方展示映射，诊断不授予权限。',
          defaultValue: '无额外展示映射。'
        },
        {
          name: 'observation',
          description: '实际原生原始观察能力，只在物理读写点发出。',
          whenToUse: '实际原生原始观察能力，只在物理读写点发出。',
          defaultValue: '无物理观察。'
        },
        {
          name: 'assertTransfer',
          description: '原生同步转移能力检查，保留媒介原分类拒绝。',
          whenToUse: '原生同步转移能力检查，保留媒介原分类拒绝。',
          defaultValue: '原生二进制媒介允许转移，仅内联媒介拒绝。'
        },
        {
          name: 'utf8',
          description: '获取平台提供的可选结构编码器及严格解码器。',
          whenToUse: '获取平台提供的可选结构编码器及严格解码器。',
          defaultValue: '标准原生文本编码器及解码器。'
        }
      ],
      scenarios: [
        '进程管道或套接字已提供有序字节，需要接入规范 RPC 载体边界。',
        '字节传输需要将原读写关闭与可选原始观察能力借给唯一会话。'
      ],
      avoidWhen: [
        '原生接口已经交付完整结构化消息时，应使用 createRpcMessageCarrier。',
        '仍需启动进程或连接套接字时，应先在原生传输所有者取得资源。'
      ]
    }
  },
  'rpc-host:sdk:createRpcMessageCarrier': {
    en: {
      purpose:
        'Own already-acquired whole-message IO with the actual codec, original transfer lists and one close lifetime. It installs the sole native message subscription without creating a peer request facade.',
      quickStart:
        "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}",
      options: [
        {
          name: 'id',
          description:
            'Native acquisition issues this unique carrier id before Session attachment; it is not a remote business id.',
          whenToUse:
            'Native acquisition issues this unique carrier id before Session attachment; it is not a remote business id.'
        },
        {
          name: 'io',
          description:
            'The original acquired native message/byte IO; wrappers must retain its close, callbacks and actual transfer semantics.',
          whenToUse:
            'The original acquired native message/byte IO; wrappers must retain its close, callbacks and actual transfer semantics.'
        },
        {
          name: 'report',
          description:
            'Receives contained asynchronous native/cleanup failures without replacing the primary business result.',
          whenToUse:
            'Receives contained asynchronous native/cleanup failures without replacing the primary business result.'
        },
        {
          name: 'nativeBinary',
          description:
            'Capability from the real native medium for genuine ArrayBuffer/view representation; it is distinct from transfer support.',
          whenToUse:
            'Capability from the real native medium for genuine ArrayBuffer/view representation; it is distinct from transfer support.',
          defaultValue: 'false unless supplied by the native owner.'
        },
        {
          name: 'digest',
          description:
            'Actual native SHA-256 backing digest capability; it is not authentication authority.',
          whenToUse:
            'Actual native SHA-256 backing digest capability; it is not authentication authority.',
          defaultValue: 'Use available native digest capability.'
        },
        {
          name: 'codec',
          description:
            'One actual prepare/encode/decode/restore codec; no identity codec or second semantic parser is inserted.',
          whenToUse:
            'One actual prepare/encode/decode/restore codec; no identity codec or second semantic parser is inserted.',
          defaultValue: 'RpcJsonCarrierCodec.'
        },
        {
          name: 'errorMetadata',
          description:
            'Caller-owned error presentation maps for actual local errors created during this operation; diagnostics confer no authority.',
          whenToUse:
            'Caller-owned error presentation maps for actual local errors created during this operation; diagnostics confer no authority.',
          defaultValue: 'No extra presentation maps.'
        },
        {
          name: 'observation',
          description: 'Actual native raw observation capability, emitted at physical IO only.',
          whenToUse: 'Actual native raw observation capability, emitted at physical IO only.',
          defaultValue: 'No physical observation.'
        },
        {
          name: 'assertTransfer',
          description:
            'Native synchronous transfer capability check; preserve the medium original coded rejection.',
          whenToUse:
            'Native synchronous transfer capability check; preserve the medium original coded rejection.',
          defaultValue: 'Native binary media permit transfer; inline-only media reject.'
        }
      ],
      scenarios: [
        'A MessagePort or other native source already delivers whole values with transfer ownership.',
        'A concrete transport must hand one acquired message resource to the canonical Session.'
      ],
      avoidWhen: [
        'A source delivers an ordered byte stream requiring length framing; use the byte carrier.',
        'A caller expects this factory to launch or supervise workers; those remain native transport responsibilities.'
      ]
    },
    zh: {
      purpose:
        '以实际编解码器、原转移列表及唯一关闭生命周期持有已经取得的整条消息读写资源；安装唯一消息订阅，不创建逐对端请求门面。',
      quickStart:
        "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}",
      options: [
        {
          name: 'id',
          description: '原生获取在会话附加前签发的唯一载体标识，不是远端业务标识。',
          whenToUse: '原生获取在会话附加前签发的唯一载体标识，不是远端业务标识。'
        },
        {
          name: 'io',
          description: '原获取的原生消息或字节读写资源，边界保留其关闭、回调及实际转移语义。',
          whenToUse: '原获取的原生消息或字节读写资源，边界保留其关闭、回调及实际转移语义。'
        },
        {
          name: 'report',
          description: '接收被隔离的原生及清理异步失败，不替换主要业务结果。',
          whenToUse: '接收被隔离的原生及清理异步失败，不替换主要业务结果。'
        },
        {
          name: 'nativeBinary',
          description: '真实原生媒介提供的缓冲区及视图表示能力，与转移支持不同。',
          whenToUse: '真实原生媒介提供的缓冲区及视图表示能力，与转移支持不同。',
          defaultValue: '由原生所有者提供，否则不启用。'
        },
        {
          name: 'digest',
          description: '实际原生完整缓冲区散列能力，不授予认证权限。',
          whenToUse: '实际原生完整缓冲区散列能力，不授予认证权限。',
          defaultValue: '使用可用的原生散列能力。'
        },
        {
          name: 'codec',
          description:
            '唯一实际准备、编码、解码及恢复编解码器，不插入恒等编解码器或第二语义解析器。',
          whenToUse: '唯一实际准备、编码、解码及恢复编解码器，不插入恒等编解码器或第二语义解析器。',
          defaultValue: '共享 JSON 载体编解码器。'
        },
        {
          name: 'errorMetadata',
          description: '本操作实际本地错误所用的调用方展示映射，诊断不授予权限。',
          whenToUse: '本操作实际本地错误所用的调用方展示映射，诊断不授予权限。',
          defaultValue: '无额外展示映射。'
        },
        {
          name: 'observation',
          description: '实际原生原始观察能力，只在物理读写点发出。',
          whenToUse: '实际原生原始观察能力，只在物理读写点发出。',
          defaultValue: '无物理观察。'
        },
        {
          name: 'assertTransfer',
          description: '原生同步转移能力检查，保留媒介原分类拒绝。',
          whenToUse: '原生同步转移能力检查，保留媒介原分类拒绝。',
          defaultValue: '原生二进制媒介允许转移，仅内联媒介拒绝。'
        }
      ],
      scenarios: [
        'MessagePort 等原生源已经按完整值交付消息并支持所有权转移。',
        '具体传输需要把一个已经取得的消息资源交给规范会话。'
      ],
      avoidWhen: [
        '原生源交付需要长度分帧的有序字节流时，应使用字节载体。',
        '需要启动或监管工作单元时，应由原生传输负责，不能依赖此工厂。'
      ]
    }
  },
  'rpc-host:sdk:createRpcStreamFrameDecoder': {
    en: {
      purpose:
        'Create the bounded decoder for canonical four-byte length-prefixed frames. Push reports consumed bytes, synchronous close preserves the unread chunk tail, and end reports a truncated frame.',
      quickStart:
        "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()",
      options: [
        {
          name: 'errorMetadata',
          description: 'Caller-owned presentation maps used only for actual decoder errors.',
          whenToUse: 'Caller-owned presentation maps used only for actual decoder errors.',
          defaultValue: 'No extra maps.'
        },
        {
          name: 'onFrame',
          description:
            'Receives one owned complete payload synchronously; may close/finish the decoder to leave current chunk tail unconsumed.',
          whenToUse:
            'Receives one owned complete payload synchronously; may close/finish the decoder to leave current chunk tail unconsumed.'
        },
        {
          name: 'onError',
          description:
            'Receives first malformed length, size violation or truncated tail; subsequent framing errors are suppressed.',
          whenToUse:
            'Receives first malformed length, size violation or truncated tail; subsequent framing errors are suppressed.'
        }
      ],
      scenarios: [
        'A byte source receives frames split across native chunks or several frames in one chunk.',
        'Bootstrap hands the unconsumed tail of the original chunk to the next actual reader after one frame.'
      ],
      avoidWhen: [
        'The source already supplies whole messages; length framing would add an unnecessary protocol boundary.',
        'An application wants JSON or semantic validation; decode the completed bytes with the actual codec.'
      ]
    },
    zh: {
      purpose:
        '创建规范四字节长度前缀的有界解码器；输入返回实际消费字节数，同步关闭保留当前块未读尾部，输入结束则报告未完成帧。',
      quickStart:
        "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()",
      options: [
        {
          name: 'errorMetadata',
          description: '仅用于实际解码器错误的调用方展示映射。',
          whenToUse: '仅用于实际解码器错误的调用方展示映射。',
          defaultValue: '无额外映射。'
        },
        {
          name: 'onFrame',
          description: '同步接收一个所拥有的完整载荷，可关闭或结束解码器以保留当前块未消费尾部。',
          whenToUse: '同步接收一个所拥有的完整载荷，可关闭或结束解码器以保留当前块未消费尾部。'
        },
        {
          name: 'onError',
          description: '接收首个非法长度、大小违例或截断尾部，后续分帧错误不再重复发出。',
          whenToUse: '接收首个非法长度、大小违例或截断尾部，后续分帧错误不再重复发出。'
        }
      ],
      scenarios: [
        '字节源可能跨原生块接收一帧，也可能在同一块中接收多帧。',
        '启动阶段读取一帧后，需要把原块尚未消费的尾部交给下一个真实读取者。'
      ],
      avoidWhen: [
        '原生源已交付整条消息时，不应再增加不必要的长度分帧边界。',
        '需要 JSON 或语义校验时，应由实际编解码器处理完成帧。'
      ]
    }
  },
  'rpc-host:sdk:defaultRpcId': {
    en: {
      purpose:
        'Allocate a secure RPC identity or key through the existing allocator and its supported native fallback. This creates no member registry and conveys no authenticated peer or provider authority.',
      quickStart:
        "import { defaultRpcId } from '@migaia/rpc-host/sdk'\nexport const instanceId = defaultRpcId()",
      options: [],
      scenarios: [
        'A genuine native owner needs a fresh local carrier or construction identity.',
        'A custom transport must use the same secure allocation behavior as the built-in owners.'
      ],
      avoidWhen: [
        'An accepted remote identity already exists; preserve that admitted identity instead of generating a replacement.',
        'A generated string is being used as proof of peer authentication; allocation does not establish trust.'
      ]
    },
    zh: {
      purpose:
        '通过已有分配器及其支持的原生回退产生安全 RPC 身份或键；它不创建成员登记表，也不授予已认证对端或提供方权限。',
      quickStart:
        "import { defaultRpcId } from '@migaia/rpc-host/sdk'\nexport const instanceId = defaultRpcId()",
      options: [],
      scenarios: [
        '真实原生所有者需要为本地载体或构造过程分配新身份。',
        '自定义传输需要使用与内置所有者相同的安全标识分配行为。'
      ],
      avoidWhen: [
        '已经存在接纳后的远端身份时，应保留该身份，不应重新生成替代值。',
        '不能将新生成的字符串作为对端认证证明，分配标识不建立信任。'
      ]
    }
  },
  'rpc-host:sdk:defineFlowPlugin': {
    en: {
      purpose:
        'Capture a reusable cold flow definition whose setup creates hooks and cleanup for each receiving Host. Optional public metadata cannot replace native plugin name or installation identity.',
      quickStart:
        "import { defineFlowPlugin } from '@migaia/rpc-host/sdk'\n\nexport const trace = defineFlowPlugin({\n  name: 'application-trace',\n  setup() {\n    return { hooks: { observe: (event) => console.log(event) } }\n  },\n})",
      options: [
        {
          name: 'name',
          description:
            'Unique native plugin name, used by actual dependency and installation order.',
          whenToUse: 'Unique native plugin name, used by actual dependency and installation order.'
        },
        {
          name: 'namespaces',
          description: 'Optional exact existing namespace scope.',
          whenToUse: 'Optional exact existing namespace scope.'
        },
        {
          name: 'setup',
          description: 'Construct one installation-local complete hook set.',
          whenToUse: 'Construct one installation-local complete hook set.',
          example:
            "import { defineFlowPlugin } from '@migaia/rpc-host/sdk'\n\nexport const trace = defineFlowPlugin({\n  name: 'application-trace',\n  setup() {\n    return { hooks: { observe: (event) => console.log(event) } }\n  },\n})"
        }
      ],
      scenarios: [
        'An optional capability needs one of the existing envelope, frame, dispatch or observation hooks.',
        'A reusable definition must create independent state and an exact disposer for each installation.'
      ],
      avoidWhen: [
        'The extension must acquire a native IO resource; define a transport plugin instead.',
        'The design needs another generic middleware pipeline; reuse one of the supported fixed hooks.'
      ]
    },
    zh: {
      purpose:
        '捕获可复用的冷信息流定义，由每个接收宿主的 setup 创建介入点及清理；可选公开元数据不能替换原生插件名称或安装身份。',
      quickStart:
        "import { defineFlowPlugin } from '@migaia/rpc-host/sdk'\n\nexport const trace = defineFlowPlugin({\n  name: 'application-trace',\n  setup() {\n    return { hooks: { observe: (event) => console.log(event) } }\n  },\n})",
      options: [
        {
          name: 'name',
          description: '唯一原生插件名，用于实际依赖及安装次序。',
          whenToUse: '唯一原生插件名，用于实际依赖及安装次序。'
        },
        {
          name: 'namespaces',
          description: '可选精确现有命名空间作用域。',
          whenToUse: '可选精确现有命名空间作用域。'
        },
        {
          name: 'setup',
          description: '构造一个安装局部完整介入点集合。',
          whenToUse: '构造一个安装局部完整介入点集合。',
          example:
            "import { defineFlowPlugin } from '@migaia/rpc-host/sdk'\n\nexport const trace = defineFlowPlugin({\n  name: 'application-trace',\n  setup() {\n    return { hooks: { observe: (event) => console.log(event) } }\n  },\n})"
        }
      ],
      scenarios: [
        '可选能力需要使用已有的信封、帧、派发或观察介入点。',
        '可复用定义需要为每次安装创建独立状态及精确释放函数。'
      ],
      avoidWhen: [
        '扩展需要取得原生读写资源时，应定义传输插件。',
        '需要介入执行时应复用支持的固定介入点，不能另建通用中间件流水线。'
      ]
    }
  },
  'rpc-host:sdk:defineLinkPolicy': {
    en: {
      purpose:
        'Capture complete call-feature defaults for native installation. FeatureScope selects those existing timeout and retry instances without creating timers or executing policy during definition.',
      quickStart:
        "import { defineLinkPolicy } from '@migaia/rpc-host/sdk'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = defineLinkPolicy({\n  name: 'application-policy',\n  features: [timeout({ ms: 500 })],\n})",
      options: [
        {
          name: 'name',
          description: 'Unique genuine native policy name.',
          whenToUse: 'Unique genuine native policy name.'
        },
        {
          name: 'features',
          description: 'Complete feature objects; duplicate kinds reject before startup.',
          whenToUse: 'Complete feature objects; duplicate kinds reject before startup.'
        }
      ],
      scenarios: [
        'A custom link policy composes complete call features under one reusable native definition.',
        'Several namespace installations should inherit defaults without sharing per-call execution state.'
      ],
      avoidWhen: [
        'A policy needs carrier acquisition or a second execution loop; use the existing transport and feature owners.',
        'Plain numbers or partial feature objects are being used as defaults; provide complete feature instances.'
      ]
    },
    zh: {
      purpose:
        '为原生安装捕获完整调用功能默认值；FeatureScope 选择已有超时与重试实例，定义阶段不创建计时器，也不执行调用策略。',
      quickStart:
        "import { defineLinkPolicy } from '@migaia/rpc-host/sdk'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = defineLinkPolicy({\n  name: 'application-policy',\n  features: [timeout({ ms: 500 })],\n})",
      options: [
        {
          name: 'name',
          description: '唯一真实原生策略名。',
          whenToUse: '唯一真实原生策略名。'
        },
        {
          name: 'features',
          description: '完整功能对象，同种重复项在启动前拒绝。',
          whenToUse: '完整功能对象，同种重复项在启动前拒绝。'
        }
      ],
      scenarios: [
        '自定义链路策略需要以可复用原生定义组合完整调用功能。',
        '多个命名空间安装需要继承默认值，同时保持每次调用执行状态独立。'
      ],
      avoidWhen: [
        '需要获取载体或执行调用循环时，应使用已有传输及功能所有者。',
        '不能把数字或不完整对象作为默认功能，应提供完整功能实例。'
      ]
    }
  },
  'rpc-host:sdk:defineTransportPlugin': {
    en: {
      purpose:
        'Capture a genuine cold native transport definition. Open acquires real carriers through the receiving Host context and returns exact cleanup and namespace extensions without another Host or peer facade.',
      quickStart:
        "import { defineTransportPlugin, createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\n\nexport function transport(io: IRpcMessageIO, id: string) {\n  return defineTransportPlugin({\n    name: 'application-channel',\n    namespace: 'channel',\n    async open(context) {\n      const carrier = createRpcMessageCarrier({ id, io, report: context.report })\n      const handle = context.attach(carrier)\n      await handle.ready\n      return { dispose: () => handle.close() }\n    },\n  })\n}",
      options: [
        {
          name: 'name',
          description: 'Actual native plugin name used for dependency and installation order.',
          whenToUse: 'Actual native plugin name used for dependency and installation order.'
        },
        {
          name: 'namespace',
          description:
            'Host-local namespace fixed by the installed transport definition, never decoded from payload permissions.',
          whenToUse:
            'Host-local namespace fixed by the installed transport definition, never decoded from payload permissions.'
        },
        {
          name: 'expose',
          description:
            'Explicit native Feature whitelist for ordinary PluginHosts; RPC Roots use their own provide catalog.',
          whenToUse:
            'Explicit native Feature whitelist for ordinary PluginHosts; RPC Roots use their own provide catalog.'
        },
        {
          name: 'features',
          description: 'Complete feature instances owned by this transport installation.',
          whenToUse: 'Complete feature instances owned by this transport installation.'
        },
        {
          name: 'handshakeTimeoutMs',
          description: 'Actual handshake budget in milliseconds using the existing Session clock.',
          whenToUse: 'Actual handshake budget in milliseconds using the existing Session clock.',
          defaultValue: '10000 milliseconds.'
        },
        {
          name: 'open',
          description: 'Acquire actual carriers during native installation.',
          whenToUse: 'Acquire actual carriers during native installation.',
          example:
            "import type { IRpcTransportDefinition } from '@migaia/rpc-contract/interfaces'\nexport function usePort(\n  owner: IRpcTransportDefinition,\n  arg0: Parameters<IRpcTransportDefinition['open']>[0],\n) {\n  return owner.open(arg0)\n}"
        }
      ],
      scenarios: [
        'A native source must attach its acquired carrier to the canonical Session and expose transport-owned controls.',
        'The same transport definition should install independently in ordinary and specialized native Hosts.'
      ],
      avoidWhen: [
        'The extension only observes or transforms existing traffic; define a flow plugin instead.',
        'A cold definition is expected to open resources before installation; move acquisition into open.'
      ]
    },
    zh: {
      purpose:
        '捕获真实冷原生传输定义，open 通过接收宿主上下文取得真实载体，并返回精确清理及命名空间扩展；不建立第二宿主或对端门面。',
      quickStart:
        "import { defineTransportPlugin, createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\nimport type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\n\nexport function transport(io: IRpcMessageIO, id: string) {\n  return defineTransportPlugin({\n    name: 'application-channel',\n    namespace: 'channel',\n    async open(context) {\n      const carrier = createRpcMessageCarrier({ id, io, report: context.report })\n      const handle = context.attach(carrier)\n      await handle.ready\n      return { dispose: () => handle.close() }\n    },\n  })\n}",
      options: [
        {
          name: 'name',
          description: '用于依赖及安装顺序的实际原生插件名称。',
          whenToUse: '用于依赖及安装顺序的实际原生插件名称。'
        },
        {
          name: 'namespace',
          description: '已安装传输定义确定的宿主本地命名空间，不能由载荷权限字段指定。',
          whenToUse: '已安装传输定义确定的宿主本地命名空间，不能由载荷权限字段指定。'
        },
        {
          name: 'expose',
          description: '普通插件宿主的显式原生特性白名单，远程调用根使用自身提供目录。',
          whenToUse: '普通插件宿主的显式原生特性白名单，远程调用根使用自身提供目录。'
        },
        {
          name: 'features',
          description: '此传输安装拥有的完整特性实例。',
          whenToUse: '此传输安装拥有的完整特性实例。'
        },
        {
          name: 'handshakeTimeoutMs',
          description: '使用既有会话时钟的实际握手毫秒预算。',
          whenToUse: '使用既有会话时钟的实际握手毫秒预算。',
          defaultValue: '默认 `10000` 毫秒。'
        },
        {
          name: 'open',
          description: '在原生安装期间获取实际载体。',
          whenToUse: '在原生安装期间获取实际载体。',
          example:
            "import type { IRpcTransportDefinition } from '@migaia/rpc-contract/interfaces'\nexport function usePort(\n  owner: IRpcTransportDefinition,\n  arg0: Parameters<IRpcTransportDefinition['open']>[0],\n) {\n  return owner.open(arg0)\n}"
        }
      ],
      scenarios: [
        '原生源需要将已取得载体附加到规范会话，并公开所属传输控制。',
        '同一传输定义需要在普通宿主与专用宿主中独立安装。'
      ],
      avoidWhen: [
        '扩展只观察或变换既有流量时，应定义信息流插件。',
        '冷定义阶段不应提前打开资源，应把获取动作放入 open。'
      ]
    }
  },
  'rpc-host:sdk:encodeRpcStreamFrame': {
    en: {
      purpose:
        'Copy a nonempty byte frame behind the canonical four-byte network-order length prefix. The caller retains responsibility for native write ordering and completion of the returned framed bytes.',
      quickStart:
        "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()",
      options: [],
      scenarios: [
        'An ordered byte writer needs the exact canonical length-prefixed representation of an encoded frame.',
        'A transport has completed encoding and must frame bytes without another semantic traversal.'
      ],
      avoidWhen: [
        'The native API already preserves whole message boundaries; send the original message through its carrier.',
        'The operation still holds a string; use encodeRpcStreamTextFrame with the actual encoder.'
      ]
    },
    zh: {
      purpose:
        '把非空字节帧复制到规范四字节网络序长度前缀之后；调用者仍负责原生写入顺序及返回分帧字节的实际写入完成。',
      quickStart:
        "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()",
      options: [],
      scenarios: [
        '有序字节写入器需要编码帧的规范长度前缀表示。',
        '传输已经完成编码，需要在不再遍历业务语义的情况下完成字节分帧。'
      ],
      avoidWhen: [
        '原生接口已经保留整条消息边界时，应通过其载体发送原消息。',
        '操作仍持有文本时，应使用实际编码器及 encodeRpcStreamTextFrame。'
      ]
    }
  },
  'rpc-host:sdk:encodeRpcStreamTextFrame': {
    en: {
      purpose:
        'Encode text directly after the same canonical length prefix, optionally borrowing adequate caller storage until the actual write drains. Native writer ownership and completion remain unchanged.',
      quickStart:
        "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()",
      options: [],
      scenarios: [
        'A text codec must produce the canonical byte frame for an ordered stream.',
        'A native owner can lend adequate storage while retaining it until physical write completion.'
      ],
      avoidWhen: [
        'The payload is already encoded bytes; use encodeRpcStreamFrame without another text conversion.',
        'The caller will reuse storage before write completion; allocate independent storage instead.'
      ]
    },
    zh: {
      purpose:
        '把文本编码到同一规范长度前缀之后，可借用足够大的调用者存储直到实际写入排空；原生写入所有权及完成边界保持不变。',
      quickStart:
        "import { encodeRpcStreamFrame, createRpcStreamFrameDecoder } from '@migaia/rpc-host/sdk'\n\nconst decoder = createRpcStreamFrameDecoder({\n  onFrame: (frame) => console.log(frame),\n  onError: console.error,\n})\nconst frame = encodeRpcStreamFrame(new Uint8Array([1, 2, 3]))\ndecoder.push(frame.subarray(0, 2))\ndecoder.push(frame.subarray(2))\ndecoder.finish()\ndecoder.close()",
      options: [],
      scenarios: [
        '文本编解码器需要为有序字节流生成规范帧。',
        '原生所有者可以借出足够存储，并持有它直到物理写入完成。'
      ],
      avoidWhen: [
        '负载已经是编码字节时，应使用 encodeRpcStreamFrame，避免再次文本转换。',
        '写入完成前就会复用存储时，不应借出该存储，应使用独立空间。'
      ]
    }
  },
  'rpc-host:sdk:hasRpcPortableBinary': {
    en: {
      purpose:
        'Read the exact owned snapshot proof recorded by the shared binary capture owner. Public properties cannot forge this proof, which indicates captured native binary rather than remote authority.',
      quickStart:
        "import { hasRpcPortableBinary } from '@migaia/rpc-host/sdk'\nexport function native(value: unknown) {\n  return hasRpcPortableBinary(value)\n}",
      options: [],
      scenarios: [
        'A codec needs to distinguish an already-owned portable snapshot containing native binary.',
        'An execution owner must avoid treating copied metadata fields as a successful binary capture receipt.'
      ],
      avoidWhen: [
        'The input is arbitrary remote data requiring admission; restore and validate it through the actual codec.',
        'The caller only needs to test whether a value is an ArrayBuffer; use its actual native type check.'
      ]
    },
    zh: {
      purpose:
        '读取共享二进制捕获所有者登记的精确已拥有快照证明；复制公开属性不能伪造该证明，它表示已捕获原生二进制，不表示远端权限。',
      quickStart:
        "import { hasRpcPortableBinary } from '@migaia/rpc-host/sdk'\nexport function native(value: unknown) {\n  return hasRpcPortableBinary(value)\n}",
      options: [],
      scenarios: [
        '编解码器需要识别含原生二进制的已拥有可移植快照。',
        '执行所有者需要避免把复制的元数据字段当作二进制捕获成功凭据。'
      ],
      avoidWhen: [
        '输入是需要准入的任意远端数据时，应通过实际编解码器恢复并校验。',
        '只需判断值是否为 ArrayBuffer 时，应使用实际原生类型检查。'
      ]
    }
  },
  'rpc-host:sdk:joinRpcPreparedMetadata': {
    en: {
      purpose:
        'Join only the fixed prepared-message root and its binary manifest. The shallow projection preserves business key order and original backing references while leaving admission to codec restore.',
      quickStart:
        "import { joinRpcPreparedMetadata } from '@migaia/rpc-host/sdk'\nimport type { IRpcPreparedMessage } from '@migaia/rpc-contract/interfaces'\nexport function outbound(value: IRpcPreparedMessage) {\n  return joinRpcPreparedMetadata(value)\n}",
      options: [],
      scenarios: [
        'An envelope protection hook needs the full prepared metadata as one value before signing or encryption.',
        'A codec must expose the prepared root without walking the business graph again.'
      ],
      avoidWhen: [
        'The value has not passed the canonical preparation stage; do not manufacture a binary manifest.',
        'The caller expects this projection to encode bytes or validate a peer; use the actual codec stages.'
      ]
    },
    zh: {
      purpose:
        '只组合固定的准备消息根及二进制清单；浅投影保留业务键顺序与原底层缓冲区引用，语义准入仍由编解码器恢复阶段负责。',
      quickStart:
        "import { joinRpcPreparedMetadata } from '@migaia/rpc-host/sdk'\nimport type { IRpcPreparedMessage } from '@migaia/rpc-contract/interfaces'\nexport function outbound(value: IRpcPreparedMessage) {\n  return joinRpcPreparedMetadata(value)\n}",
      options: [],
      scenarios: [
        '信封保护介入点需要在签名或加密前取得完整准备元数据。',
        '编解码器需要公开准备根，同时避免再次遍历业务图。'
      ],
      avoidWhen: [
        '值尚未经过规范准备阶段时，不能自行制造二进制清单。',
        '需要字节编码或对端校验时，应使用实际编解码阶段，而非此投影。'
      ]
    }
  },
  'rpc-host:sdk:portableBytes': {
    en: {
      purpose:
        'Measure an admitted portable value using the canonical byte accounting rules, with optional early rejection above a trusted budget. This reports value size and does not acquire or copy native resources.',
      quickStart:
        "import { portableBytes } from '@migaia/rpc-host/sdk'\nexport const bytes = portableBytes({ result: 'ready' })",
      options: [],
      scenarios: [
        'A retained provider outcome needs exact portable body accounting before storage.',
        'An execution owner must stop measuring once an admitted value exceeds its existing byte budget.'
      ],
      avoidWhen: [
        'The input is untrusted wire data; canonical protocol admission must happen before this trusted-value measurement.',
        'The requirement is native process memory usage; use the actual native resource sampler.'
      ]
    },
    zh: {
      purpose:
        '按规范字节规则计算已经接纳的可移植值大小，可在超过可信预算后提前拒绝；该操作只计量值，不取得或复制原生资源。',
      quickStart:
        "import { portableBytes } from '@migaia/rpc-host/sdk'\nexport const bytes = portableBytes({ result: 'ready' })",
      options: [],
      scenarios: [
        '保留提供方结果前，需要精确计算可移植正文的字节占用。',
        '执行所有者需要在已接纳值超过既有字节预算后停止计量。'
      ],
      avoidWhen: [
        '输入是未可信的线上数据时，应先完成规范协议准入，再计量可信值。',
        '需要原生进程内存用量时，应使用实际原生资源采样器。'
      ]
    }
  },
  'rpc-host:sdk:prepareRpcBinary': {
    en: {
      purpose:
        'Capture semantic slots synchronously before digest suspension, then prepare one binary manifest. The canonical capture preserves own-key order, complete backing aliases and original sidecar identities.',
      quickStart:
        "import { prepareRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'\n\nexport function capture(message: IRpcEnvelope) {\n  return prepareRpcBinary(message, { storage: 'inline' })\n}",
      options: [
        {
          name: 'storage',
          description:
            'Choose inline base64url or original native backing sidecars according to acquired media capability.',
          whenToUse:
            'Choose inline base64url or original native backing sidecars according to acquired media capability.'
        },
        {
          name: 'limit',
          description: 'Whole-backing budget checked before any native digest call.',
          whenToUse: 'Whole-backing budget checked before any native digest call.',
          defaultValue: 'Protocol binary limit.'
        },
        {
          name: 'digest',
          description:
            'Actual native SHA-256 backing digest capability; it is not authentication authority.',
          whenToUse:
            'Actual native SHA-256 backing digest capability; it is not authentication authority.',
          defaultValue: 'Use available native digest capability.'
        },
        {
          name: 'errorMetadata',
          description:
            'Caller-owned error presentation maps for actual local errors created during this operation; diagnostics confer no authority.',
          whenToUse:
            'Caller-owned error presentation maps for actual local errors created during this operation; diagnostics confer no authority.',
          defaultValue: 'No extra presentation maps.'
        },
        {
          name: 'encoding',
          description:
            'Carrier hooks consume captured roots; capture runs synchronously before digest suspension.',
          whenToUse:
            'Carrier hooks consume captured roots; capture runs synchronously before digest suspension.',
          defaultValue: 'Canonical inline encoding and no extra capture hook.'
        },
        {
          name: 'beforeDigest',
          description:
            'Receives the protected captured manifest and total backing bytes before hashing starts.',
          whenToUse:
            'Receives the protected captured manifest and total backing bytes before hashing starts.',
          defaultValue: 'No extra callback.'
        }
      ],
      scenarios: [
        'A native-binary carrier needs one owned snapshot before asynchronous integrity hashing begins.',
        'A codec must preserve shared backing and view offsets while preparing transfer sidecars.'
      ],
      avoidWhen: [
        'The message already passed the codec prepare stage; do not prepare its business graph a second time.',
        'The caller wants chunking or authentication policy; those plugins operate around the prepared message.'
      ]
    },
    zh: {
      purpose:
        '在散列挂起前同步捕获语义槽，再准备唯一二进制清单；规范捕获保留自有键顺序、完整底层缓冲区别名及原附带数据身份。',
      quickStart:
        "import { prepareRpcBinary } from '@migaia/rpc-host/sdk'\nimport type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'\n\nexport function capture(message: IRpcEnvelope) {\n  return prepareRpcBinary(message, { storage: 'inline' })\n}",
      options: [
        {
          name: 'storage',
          description: '按获取媒介能力选择内联字节表示或原生原缓冲区附带列表。',
          whenToUse: '按获取媒介能力选择内联字节表示或原生原缓冲区附带列表。'
        },
        {
          name: 'limit',
          description: '调用任何原生散列之前检查的完整缓冲区预算。',
          whenToUse: '调用任何原生散列之前检查的完整缓冲区预算。',
          defaultValue: '协议二进制上限。'
        },
        {
          name: 'digest',
          description: '实际原生完整缓冲区散列能力，不授予认证权限。',
          whenToUse: '实际原生完整缓冲区散列能力，不授予认证权限。',
          defaultValue: '使用可用的原生散列能力。'
        },
        {
          name: 'errorMetadata',
          description: '本操作实际本地错误所用的调用方展示映射，诊断不授予权限。',
          whenToUse: '本操作实际本地错误所用的调用方展示映射，诊断不授予权限。',
          defaultValue: '无额外展示映射。'
        },
        {
          name: 'encoding',
          description: '载体介入点消费已捕获根；捕获在散列挂起之前同步执行。',
          whenToUse: '载体介入点消费已捕获根；捕获在散列挂起之前同步执行。',
          defaultValue: '规范内联编码，无额外捕获介入。'
        },
        {
          name: 'beforeDigest',
          description: '散列启动前接收保护捕获清单及完整缓冲区总字节数。',
          whenToUse: '散列启动前接收保护捕获清单及完整缓冲区总字节数。',
          defaultValue: '无额外回调。'
        }
      ],
      scenarios: [
        '原生二进制载体需要在异步完整性散列前取得唯一已拥有快照。',
        '编解码器准备转移附带数据时，需要保留共享底层缓冲区及视图偏移。'
      ],
      avoidWhen: [
        '消息已经通过编解码器准备阶段时，不应再次准备其业务图。',
        '需要分块或认证策略时，应由对应插件围绕已准备消息执行。'
      ]
    }
  },
  'rpc-host:sdk:readRpcLaunchFacts': {
    en: {
      purpose:
        'Read trusted parent and generation facts attached to the exact original native launch context. The facts exist only during the owning launch operation and are not serialized credentials.',
      quickStart:
        "import { readRpcLaunchFacts } from '@migaia/rpc-host/sdk'\nexport function facts(context: object) {\n  return readRpcLaunchFacts(context)\n}",
      options: [],
      scenarios: [
        'A built-in launcher needs the actual parent identity while preserving the original supervisor context object.',
        'A custom native launcher consumes facts lent during its current launch call.'
      ],
      avoidWhen: [
        'The input is a copied context or data from a remote peer; it has no exact local launch receipt.',
        'The transport needs authentication credentials; supply them through the actual credential owner.'
      ]
    },
    zh: {
      purpose:
        '读取附加在精确原生启动上下文上的可信父端及代际事实；这些事实只在所属启动操作期间存在，不是序列化凭证或调用者自报身份。',
      quickStart:
        "import { readRpcLaunchFacts } from '@migaia/rpc-host/sdk'\nexport function facts(context: object) {\n  return readRpcLaunchFacts(context)\n}",
      options: [],
      scenarios: [
        '内置启动器需要取得真实父端身份，同时保留原监管上下文对象。',
        '自定义原生启动器需要在当前启动调用期间读取借出的事实。'
      ],
      avoidWhen: [
        '输入是上下文副本或远端数据时，不具有精确本地启动凭据。',
        '传输需要认证凭证时，应通过实际凭证所有者提供。'
      ]
    }
  },
  'rpc-host:sdk:resolveAbortReason': {
    en: {
      purpose:
        'Read the original abort reason once without replacing its identity. If the structural reason accessor itself throws, that exact thrown value becomes the resolved cancellation reason.',
      quickStart:
        "import { resolveAbortReason } from '@migaia/rpc-host/sdk'\nexport function cancelled(signal: AbortSignal) {\n  return resolveAbortReason(signal)\n}",
      options: [],
      scenarios: [
        'An IO owner needs the exact external cancellation reason when settling pending work.',
        'A structural signal may expose a throwing reason accessor and the original thrown value must remain reachable.'
      ],
      avoidWhen: [
        'The caller needs to create or abort a controller; use the lifecycle controller owner.',
        'Cancellation needs a public coded wrapper at another boundary; resolve the reason here and let that owner apply its contract.'
      ]
    },
    zh: {
      purpose:
        '只读取一次原取消原因，并保留其精确身份；结构 reason 访问器自身抛出时，抛出的原值仍作为解析后的取消原因返回。',
      quickStart:
        "import { resolveAbortReason } from '@migaia/rpc-host/sdk'\nexport function cancelled(signal: AbortSignal) {\n  return resolveAbortReason(signal)\n}",
      options: [],
      scenarios: [
        '读写所有者结算待决操作时，需要保留外部取消原因的精确身份。',
        '结构信号的 reason 访问器可能抛出，原抛出值仍需保留可追溯性。'
      ],
      avoidWhen: [
        '需要创建或取消控制器时，应使用生命周期控制器所有者。',
        '其他边界需要公开错误码包装时，应先在此读取原原因，再由该边界应用契约。'
      ]
    }
  },
  'rpc-host:sdk:resolveRpcEntry': {
    en: {
      purpose:
        'Resolve a process or thread entry from the explicit main-entry and base-path snapshot. It uses the supplied runtime path facts instead of inspecting call stacks or guessing the caller module.',
      quickStart:
        "import { resolveRpcEntry } from '@migaia/rpc-host/sdk'\nexport const entry = resolveRpcEntry('./worker.ts', { base: import.meta.url })",
      options: [],
      scenarios: [
        'A native spawn recipe needs an entry URL relative to its captured application base.',
        'A launcher must resolve the same entry consistently in Node, Bun or Deno using explicit runtime inputs.'
      ],
      avoidWhen: [
        'The entry is untrusted user input needing authorization; path resolution does not grant execution permission.',
        'A caller expects stack-based discovery of its source module; pass the actual entry and base explicitly.'
      ]
    },
    zh: {
      purpose:
        '根据显式主入口及基础路径快照解析进程或线程入口；它使用调用者提供的运行时路径事实，不检查调用栈，也不猜测调用模块。',
      quickStart:
        "import { resolveRpcEntry } from '@migaia/rpc-host/sdk'\nexport const entry = resolveRpcEntry('./worker.ts', { base: import.meta.url })",
      options: [],
      scenarios: [
        '原生启动配方需要相对已捕获应用基础路径解析入口地址。',
        '启动器需要在 Node、Bun 或 Deno 使用显式运行时输入一致解析入口。'
      ],
      avoidWhen: [
        '入口来自需要授权的用户输入时，路径解析本身不授予执行权限。',
        '不能期待通过调用栈发现源模块，应显式传入实际入口及基础路径。'
      ]
    }
  },
  'rpc-host:sdk:restoreRpcBinary': {
    en: {
      purpose:
        'Restore one admitted binary manifest at the actual carrier boundary. Integrity checks and the canonical restore preserve complete backing aliases, original view offsets and the selected sidecar identities.',
      quickStart:
        "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}",
      options: [
        {
          name: 'storage',
          description:
            'Choose inline base64url or original native backing sidecars according to acquired media capability.',
          whenToUse:
            'Choose inline base64url or original native backing sidecars according to acquired media capability.'
        },
        {
          name: 'limit',
          description: 'Whole-backing budget checked before any native digest call.',
          whenToUse: 'Whole-backing budget checked before any native digest call.',
          defaultValue: 'Protocol binary limit.'
        },
        {
          name: 'digest',
          description:
            'Actual native SHA-256 backing digest capability; it is not authentication authority.',
          whenToUse:
            'Actual native SHA-256 backing digest capability; it is not authentication authority.',
          defaultValue: 'Use available native digest capability.'
        },
        {
          name: 'errorMetadata',
          description:
            'Caller-owned error presentation maps for actual local errors created during this operation; diagnostics confer no authority.',
          whenToUse:
            'Caller-owned error presentation maps for actual local errors created during this operation; diagnostics confer no authority.',
          defaultValue: 'No extra presentation maps.'
        },
        {
          name: 'encoding',
          description:
            'Carrier hooks consume captured roots; capture runs synchronously before digest suspension.',
          whenToUse:
            'Carrier hooks consume captured roots; capture runs synchronously before digest suspension.',
          defaultValue: 'Canonical inline encoding and no extra capture hook.'
        },
        {
          name: 'beforeDigest',
          description:
            'Receives the protected captured manifest and total backing bytes before hashing starts.',
          whenToUse:
            'Receives the protected captured manifest and total backing bytes before hashing starts.',
          defaultValue: 'No extra callback.'
        },
        {
          name: 'sidecars',
          description: 'Original complete backings matched to protected length/digest descriptors.',
          whenToUse: 'Original complete backings matched to protected length/digest descriptors.',
          defaultValue: 'No native sidecars for inline storage.'
        }
      ],
      scenarios: [
        'A decoded carrier message contains protected binary metadata that must reconstruct the original value graph.',
        'The receive path must validate backing integrity before making restored values available to provider code.'
      ],
      avoidWhen: [
        'The actual codec already restored this prepared object; reuse its restore result instead of another traversal.',
        'The input is raw JSON text or an arbitrary sidecar list; decode and admit it through the canonical codec first.'
      ]
    },
    zh: {
      purpose:
        '在实际载体边界恢复已接纳二进制清单；完整性检查与规范恢复保留完整底层缓冲区别名、原视图偏移及选定附带数据身份。',
      quickStart:
        "import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'\nimport { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'\n\nexport function acquire(\n  io: IRpcMessageIO,\n  id: string,\n  report: (error: unknown) => void,\n) {\n  return createRpcMessageCarrier({ id, io, report })\n}",
      options: [
        {
          name: 'storage',
          description: '按获取媒介能力选择内联字节表示或原生原缓冲区附带列表。',
          whenToUse: '按获取媒介能力选择内联字节表示或原生原缓冲区附带列表。'
        },
        {
          name: 'limit',
          description: '调用任何原生散列之前检查的完整缓冲区预算。',
          whenToUse: '调用任何原生散列之前检查的完整缓冲区预算。',
          defaultValue: '协议二进制上限。'
        },
        {
          name: 'digest',
          description: '实际原生完整缓冲区散列能力，不授予认证权限。',
          whenToUse: '实际原生完整缓冲区散列能力，不授予认证权限。',
          defaultValue: '使用可用的原生散列能力。'
        },
        {
          name: 'errorMetadata',
          description: '本操作实际本地错误所用的调用方展示映射，诊断不授予权限。',
          whenToUse: '本操作实际本地错误所用的调用方展示映射，诊断不授予权限。',
          defaultValue: '无额外展示映射。'
        },
        {
          name: 'encoding',
          description: '载体介入点消费已捕获根；捕获在散列挂起之前同步执行。',
          whenToUse: '载体介入点消费已捕获根；捕获在散列挂起之前同步执行。',
          defaultValue: '规范内联编码，无额外捕获介入。'
        },
        {
          name: 'beforeDigest',
          description: '散列启动前接收保护捕获清单及完整缓冲区总字节数。',
          whenToUse: '散列启动前接收保护捕获清单及完整缓冲区总字节数。',
          defaultValue: '无额外回调。'
        },
        {
          name: 'sidecars',
          description: '与保护长度及散列描述匹配的原完整缓冲区。',
          whenToUse: '与保护长度及散列描述匹配的原完整缓冲区。',
          defaultValue: '内联存储不提供原生附带列表。'
        }
      ],
      scenarios: [
        '已解码载体消息包含受保护二进制元数据，需要重建原值图。',
        '接收路径需要在提供方取得恢复值前验证底层缓冲区完整性。'
      ],
      avoidWhen: [
        '实际编解码器已经恢复该准备对象时，应复用其恢复结果，避免再次遍历。',
        '输入仍是原 JSON 文本或任意附带列表时，应先通过规范编解码器解码准入。'
      ]
    }
  },
  'rpc-host:sdk:retainRpcRuntimeFlags': {
    en: {
      purpose:
        'Preserve native loader and runtime arguments while removing evaluation, print and test-runner entry selection. Launchers can retain their execution environment without accidentally starting the parent command again.',
      quickStart:
        "import { retainRpcRuntimeFlags } from '@migaia/rpc-host/sdk'\nexport const flags = retainRpcRuntimeFlags(['--enable-source-maps'])",
      options: [],
      scenarios: [
        'A child process or worker must inherit loader flags needed for its actual source format.',
        'A short-source launcher runs under a test or evaluation command but must select its own child entry.'
      ],
      avoidWhen: [
        'Arguments are application payload or credentials; this helper only filters runtime startup flags.',
        'The child requires a deliberately different runtime configuration; provide that configuration in the native recipe.'
      ]
    },
    zh: {
      purpose:
        '保留原生加载器及运行时参数，同时移除求值、打印和测试执行器的入口选择；启动器因此保留执行环境，而不会意外再次启动父命令。',
      quickStart:
        "import { retainRpcRuntimeFlags } from '@migaia/rpc-host/sdk'\nexport const flags = retainRpcRuntimeFlags(['--enable-source-maps'])",
      options: [],
      scenarios: [
        '子进程或工作线程需要继承其实际源码格式所需的加载参数。',
        '短源码启动器在测试或求值命令下运行，但必须选择自己的子端入口。'
      ],
      avoidWhen: [
        '参数是应用负载或凭证时，不应使用只筛选运行时启动标志的此工具。',
        '子端需要明确不同的运行时配置时，应在原生配方中直接提供。'
      ]
    }
  },
  'rpc-host:sdk:rpcMemberConnectionDetail': {
    en: {
      purpose:
        'Project an accepted directory and captured native status into safe local connection details. Optional resource observations remain explicitly scoped and unavailable facts are not inferred from another generation.',
      quickStart:
        "import { rpcMemberConnectionDetail } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberConnectionDirectory } from '@migaia/rpc-host/sdk'\nexport function describe(directory: IRpcMemberConnectionDirectory) {\n  return rpcMemberConnectionDetail(directory)\n}",
      options: [],
      scenarios: [
        'A native member query needs accepted method metadata together with safe supervisor observations.',
        'Operator output must describe one captured execution unit without exposing its live native handles.'
      ],
      avoidWhen: [
        'The operation needs to mutate or restart a member; use its actual controls.',
        'A resource fact is unavailable; preserve the unavailable projection rather than borrowing a successor sample.'
      ]
    },
    zh: {
      purpose:
        '把已接纳目录及捕获的原生状态投影为安全本地连接详情；可选资源观察保留明确作用域，不从其他代际推断缺失事实。',
      quickStart:
        "import { rpcMemberConnectionDetail } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberConnectionDirectory } from '@migaia/rpc-host/sdk'\nexport function describe(directory: IRpcMemberConnectionDirectory) {\n  return rpcMemberConnectionDetail(directory)\n}",
      options: [],
      scenarios: [
        '原生成员查询需要组合已接纳方法元数据及安全监管观察。',
        '运维输出需要描述一个捕获执行单元，同时避免公开活动原生句柄。'
      ],
      avoidWhen: [
        '需要变更或重启成员时，应使用其实际控制入口。',
        '资源事实不可用时，应保留缺失投影，不能借用后继单元采样。'
      ]
    }
  },
  'rpc-host:sdk:rpcMemberCounters': {
    en: {
      purpose:
        'Project only the supplied canonical client-work counters into safe member diagnostics. Unsupported physical counters stay explicitly unavailable rather than being reconstructed from unrelated call counts.',
      quickStart:
        "import { rpcMemberCounters } from '@migaia/rpc-host/sdk'\nexport const unavailableCounts = rpcMemberCounters()",
      options: [],
      scenarios: [
        'A native member overview needs safe call counters already supplied by the canonical owner.',
        'An operator must distinguish unavailable physical counters from observed zero values.'
      ],
      avoidWhen: [
        'The caller wants to measure provider concurrency; use the provider policy observation instead.',
        'No canonical counter exists and an estimate is being presented as measured native activity.'
      ]
    },
    zh: {
      purpose:
        '只把已提供的规范客户端工作计数投影为安全成员诊断；不支持的物理计数保持明确不可用，不从无关调用次数推算。',
      quickStart:
        "import { rpcMemberCounters } from '@migaia/rpc-host/sdk'\nexport const unavailableCounts = rpcMemberCounters()",
      options: [],
      scenarios: [
        '原生成员概览需要使用规范所有者已经提供的安全调用计数。',
        '运维需要区分不可用物理计数与实际观察到的零值。'
      ],
      avoidWhen: [
        '需要测量提供方并发时，应使用提供方策略的实际观察。',
        '没有规范计数时，不应把估算值表示为已测量的原生活动。'
      ]
    }
  },
  'rpc-host:sdk:rpcMemberErrorIdentity': {
    en: {
      purpose:
        'Project only safe own source and code fields from a tagged diagnostic. The output omits native handles, message, stack and arbitrary accessors so operator events do not reflect live resources.',
      quickStart:
        "import { rpcMemberErrorIdentity } from '@migaia/rpc-host/sdk'\nexport function describe(error: unknown) {\n  return rpcMemberErrorIdentity(error, console.error)\n}",
      options: [],
      scenarios: [
        'A member lifecycle event needs a bounded diagnostic identity without full error contents.',
        'An operator overview must expose source and code while keeping raw native resources private.'
      ],
      avoidWhen: [
        'A cross-realm business error must preserve its entire cause chain; use the Contract error serializer.',
        'The caller wants to classify or mint local control errors; this projection grants no local authority.'
      ]
    },
    zh: {
      purpose:
        '只从已标记诊断投影安全自有 source 及 code 字段；输出不包含原生句柄、消息、堆栈或任意访问器，避免运维事件反射活动资源。',
      quickStart:
        "import { rpcMemberErrorIdentity } from '@migaia/rpc-host/sdk'\nexport function describe(error: unknown) {\n  return rpcMemberErrorIdentity(error, console.error)\n}",
      options: [],
      scenarios: [
        '成员生命周期事件需要有界诊断身份，而不公开完整错误内容。',
        '运维概览需要公开来源及错误码，同时保持原生资源私有。'
      ],
      avoidWhen: [
        '跨运行域业务错误需要保留完整原因链时，应使用 Contract 错误序列化。',
        '需要分类或创建本地控制错误时，不能依赖不授予本地权限的此投影。'
      ]
    }
  },
  'rpc-host:sdk:rpcMemberMetric': {
    en: {
      purpose:
        'Create a safe observed metric with explicit scope, unit and monotonic observation time. A measured zero remains valid, while missing measurements use the separate unavailable representation.',
      quickStart:
        "import {\n  rpcMemberMetric,\n  RpcMemberMetricScope,\n  RpcMemberMetricUnit,\n} from '@migaia/rpc-host/sdk'\nexport function count(value: number, now: number) {\n  return rpcMemberMetric(\n    value,\n    RpcMemberMetricScope.client,\n    RpcMemberMetricUnit.calls,\n    now,\n  )\n}",
      options: [],
      scenarios: [
        'A native resource sampler must label a measured CPU or elapsed-time value with its real unit.',
        'An operator snapshot needs a timestamped metric tied to the captured execution scope.'
      ],
      avoidWhen: [
        'The value was not observed; use rpcMemberUnavailable rather than inventing zero.',
        'The number is an application budget or limit rather than a sampled native metric.'
      ]
    },
    zh: {
      purpose:
        '以明确作用域、单位及单调观察时间创建安全指标投影；实际测得的零仍是有效值，缺少测量时应使用独立的不可用表示。',
      quickStart:
        "import {\n  rpcMemberMetric,\n  RpcMemberMetricScope,\n  RpcMemberMetricUnit,\n} from '@migaia/rpc-host/sdk'\nexport function count(value: number, now: number) {\n  return rpcMemberMetric(\n    value,\n    RpcMemberMetricScope.client,\n    RpcMemberMetricUnit.calls,\n    now,\n  )\n}",
      options: [],
      scenarios: [
        '原生资源采样器需要为实际 CPU 或耗时测量标明真实单位。',
        '运维快照需要把带时间的指标归属到捕获执行作用域。'
      ],
      avoidWhen: [
        '值并未实际观察到时，应使用 rpcMemberUnavailable，而非虚构零值。',
        '数值表示应用预算或限制而非采样原生指标时，不应使用此投影。'
      ]
    }
  },
  'rpc-host:sdk:rpcMemberResources': {
    en: {
      purpose:
        'Sample only the captured actual native unit, then verify that exact unit is still current after the await. It preserves process/thread scope and never substitutes a replacement generation by name.',
      quickStart:
        "import { rpcMemberResources } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberNativeUnit } from '@migaia/rpc-host/sdk'\nexport function sample(\n  unit: IRpcMemberNativeUnit,\n  now: () => number,\n  current: () => boolean,\n) {\n  return rpcMemberResources(unit, 'thread', now, console.error, current)\n}",
      options: [],
      scenarios: [
        'A member overview needs CPU or memory data from the exact unit selected before asynchronous sampling.',
        'A restart can occur during sampling and retired-unit results must remain explicitly unavailable.'
      ],
      avoidWhen: [
        'The source is borrowed and exposes no native unit; preserve unavailable resources.',
        'An application wants an aggregate for all workers; one unit sample must not be relabeled as a pool total.'
      ]
    },
    zh: {
      purpose:
        '只采样捕获的实际原生单元，并在等待完成后检查该精确单元仍为当前对象；保持进程或线程作用域，不按名称替换成后继代际。',
      quickStart:
        "import { rpcMemberResources } from '@migaia/rpc-host/sdk'\nimport type { IRpcMemberNativeUnit } from '@migaia/rpc-host/sdk'\nexport function sample(\n  unit: IRpcMemberNativeUnit,\n  now: () => number,\n  current: () => boolean,\n) {\n  return rpcMemberResources(unit, 'thread', now, console.error, current)\n}",
      options: [],
      scenarios: [
        '成员概览需要从异步采样前选定的精确单元取得 CPU 或内存数据。',
        '采样期间可能重启，需要把已退场单元的结果明确标为不可用。'
      ],
      avoidWhen: [
        '借用来源没有暴露原生单元时，应保留资源不可用状态。',
        '需要全部工作单元聚合值时，不能把单元采样重标为池总量。'
      ]
    }
  },
  'rpc-host:sdk:rpcMemberUnavailable': {
    en: {
      purpose:
        'Create the frozen explicit absence value for native member diagnostics. It records why a fact cannot be observed instead of inventing a zero, healthy state or parent-level aggregate.',
      quickStart:
        "import { rpcMemberUnavailable, RpcMemberQueryReason } from '@migaia/rpc-host/sdk'\nexport const resources = rpcMemberUnavailable(RpcMemberQueryReason.resources)",
      options: [],
      scenarios: [
        'A borrowed native member has no owned resource sampler or restart budget.',
        'A selected execution unit retired before its asynchronous observation completed.'
      ],
      avoidWhen: [
        'A real measurement is zero; keep the measured metric rather than labeling it absent.',
        'The operation actually failed and must reject or report its original error; absence is not a replacement error policy.'
      ]
    },
    zh: {
      purpose:
        '为原生成员诊断创建冻结的明确缺失值，记录事实无法观察的原因；不会制造零值、健康状态或父级聚合指标替代真实缺失。',
      quickStart:
        "import { rpcMemberUnavailable, RpcMemberQueryReason } from '@migaia/rpc-host/sdk'\nexport const resources = rpcMemberUnavailable(RpcMemberQueryReason.resources)",
      options: [],
      scenarios: [
        '借用原生成员没有所属资源采样器或重启预算可供查询。',
        '选定执行单元在异步观察完成前已经退场。'
      ],
      avoidWhen: [
        '实际测量结果为零时，应保留测得指标，不能将其标为缺失。',
        '操作真正失败且必须拒绝或上报原错误时，缺失值不能替代错误策略。'
      ]
    }
  },
  'rpc-host:sdk:splitRpcPreparedMetadata': {
    en: {
      purpose:
        'Shallowly separate the fixed prepared-message root and its original binary sidecars. It performs no second business traversal; the eventual codec restore remains the sole semantic admission owner.',
      quickStart:
        "import { splitRpcPreparedMetadata } from '@migaia/rpc-host/sdk'\nexport function received(value: unknown, sidecars: readonly ArrayBuffer[]) {\n  return splitRpcPreparedMetadata(value, sidecars)\n}",
      options: [],
      scenarios: [
        'A codec decodes a protected prepared root and must preserve the original sidecar list for restore.',
        'An authentication hook unwraps a verified value and reuses the canonical fixed-root projection.'
      ],
      avoidWhen: [
        'The caller expects this shallow split to verify integrity or admit a semantic envelope; call restore.',
        'The input still consists of raw byte chunks; finish physical framing and decode first.'
      ]
    },
    zh: {
      purpose:
        '浅层分离固定准备消息根及原二进制附带列表，不再次遍历业务数据；最终编解码恢复仍是唯一语义准入所有者。',
      quickStart:
        "import { splitRpcPreparedMetadata } from '@migaia/rpc-host/sdk'\nexport function received(value: unknown, sidecars: readonly ArrayBuffer[]) {\n  return splitRpcPreparedMetadata(value, sidecars)\n}",
      options: [],
      scenarios: [
        '编解码器解出受保护准备根后，需要保留原附带列表供恢复使用。',
        '认证介入点解开已验证值后，需要复用规范固定根投影。'
      ],
      avoidWhen: [
        '需要完整性验证或语义信封准入时，应调用恢复，不能依赖此浅分离。',
        '输入仍为原始字节块时，应先完成物理分帧及解码。'
      ]
    }
  },
  'rpc-host:sdk:withRpcLaunchFacts': {
    en: {
      purpose:
        'Lend trusted parent and generation facts during the original native launch operation without replacing its context object. Completion releases the exact metadata receipt and nested launches restore the prior facts.',
      quickStart:
        "import { withRpcLaunchFacts } from '@migaia/rpc-host/sdk'\nimport type { IRpcLaunchFacts } from '@migaia/rpc-host/sdk'\nexport function launch<T>(\n  context: object,\n  facts: IRpcLaunchFacts,\n  start: () => Promise<T>,\n) {\n  return withRpcLaunchFacts(context, facts, start)\n}",
      options: [],
      scenarios: [
        'A concrete launcher must expose trusted parent identity to its original custom launch callback.',
        'A native spawn needs scoped generation facts while retaining exact supervisor context identity.'
      ],
      avoidWhen: [
        'The data is an authentication token or arbitrary remote claim; use the actual credential boundary.',
        'Facts must remain readable after the launch operation completes; persist explicit application data elsewhere.'
      ]
    },
    zh: {
      purpose:
        '在原生启动操作期间借出可信父端及代际事实，不替换其上下文对象；完成时释放精确元数据凭据，嵌套启动恢复先前事实。',
      quickStart:
        "import { withRpcLaunchFacts } from '@migaia/rpc-host/sdk'\nimport type { IRpcLaunchFacts } from '@migaia/rpc-host/sdk'\nexport function launch<T>(\n  context: object,\n  facts: IRpcLaunchFacts,\n  start: () => Promise<T>,\n) {\n  return withRpcLaunchFacts(context, facts, start)\n}",
      options: [],
      scenarios: [
        '具体启动器需要向原自定义启动回调提供可信父端身份。',
        '原生启动需要有作用域的代际事实，同时保留精确监管上下文身份。'
      ],
      avoidWhen: [
        '数据是认证令牌或任意远端声明时，应使用实际凭证边界。',
        '启动完成后仍需读取的数据，应由应用另行显式持有，不能依赖此临时事实。'
      ]
    }
  },
  'rpc-host:plugins:auth': {
    en: {
      purpose:
        'Install the authentication flow plugin on the Host before starting transports. Paired sign/verify callbacks protect the prepared representation; optional encrypt/decrypt callbacks must also match. Explicit credentials and verifyCredentials govern handshake credential exchange without discovering native launch tokens or replacing carrier identity admission. Use namespaces to select links, then close the Host after application calls finish.',
      quickStart:
        "// Supply the application real paired cryptographic operations.\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { auth } from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\nexport async function run(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  const protection = auth({ sign, verify, encodedType: 'string' })\n  const host = await createRpcHost({\n    plugins: [\n      protection,\n      coroutinePlugin({\n        spawn: async ({ connect, signal }) => {\n          const child = await createRpcHost({\n            plugins: [protection, coroutinePlugin({ connectToParent: connect })],\n            provide: { echo: (value: string) => value },\n          })\n          try {\n            if (!signal.aborted) {\n              await new Promise<void>((resolve) =>\n                signal.addEventListener('abort', () => resolve(), { once: true }),\n              )\n            }\n          } finally {\n            await child.close()\n          }\n        },\n      }),\n    ],\n  })\n  try {\n    return await host.coroutine.request('echo', 'authenticated value')\n  } finally {\n    await host.close()\n  }\n}\n",
      options: [
        {
          name: 'encrypt',
          description:
            'Encrypt the prepared signed representation; input and output must match encodedType and decrypt reverses this operation.',
          whenToUse:
            'Encrypt the prepared signed representation; input and output must match encodedType and decrypt reverses this operation.',
          defaultValue: 'No transform; configure the corresponding pair together.',
          example:
            "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\n\nexport function signed(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encodedType: 'string' })\n}"
        },
        {
          name: 'decrypt',
          description:
            'Reverse the paired encryption before inbound verification/admission; throw rejects the envelope.',
          whenToUse:
            'Reverse the paired encryption before inbound verification/admission; throw rejects the envelope.',
          defaultValue: 'No transform; configure the corresponding pair together.',
          example:
            "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\n\nexport function signed(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encodedType: 'string' })\n}"
        },
        {
          name: 'sign',
          description:
            'Sign the exact protected representation with its nonce/counter binding; return the representation consumed by verify.',
          whenToUse:
            'Sign the exact protected representation with its nonce/counter binding; return the representation consumed by verify.',
          defaultValue: 'No transform; configure the corresponding pair together.',
          example:
            "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\n\nexport function signed(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encodedType: 'string' })\n}"
        },
        {
          name: 'verify',
          description:
            'Verify the paired protected representation and return its authenticated inner data; failure rejects before provider execution.',
          whenToUse:
            'Verify the paired protected representation and return its authenticated inner data; failure rejects before provider execution.',
          defaultValue: 'No transform; configure the corresponding pair together.',
          example:
            "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\n\nexport function signed(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encodedType: 'string' })\n}"
        },
        {
          name: 'encodedType',
          description:
            'Transform input/output category; conversion belongs to auth representation rather than an extra JSON parser.',
          whenToUse:
            'Transform input/output category; conversion belongs to auth representation rather than an extra JSON parser.',
          defaultValue: 'any.'
        },
        {
          name: 'namespaces',
          description:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          whenToUse:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          defaultValue: 'All installed namespaces.'
        },
        {
          name: 'credentials',
          description:
            'Portable explicit credential data or an async resolver receiving the actual admitted flow context. It does not discover native bootstrap tokens by guessing payload fields.',
          whenToUse:
            'Portable explicit credential data or an async resolver receiving the actual admitted flow context. It does not discover native bootstrap tokens by guessing payload fields.',
          defaultValue: 'No explicit credentials.'
        },
        {
          name: 'verifyCredentials',
          description:
            'Receives remote credential data, peer hello and actual flow context; return void/Promise<void> to accept or throw to reject.',
          whenToUse:
            'Receives remote credential data, peer hello and actual flow context; return void/Promise<void> to accept or throw to reject.',
          defaultValue: 'No credential verifier.'
        }
      ],
      scenarios: [
        'Sign outbound frames and verify the matching inbound representation with application-owned cryptographic callbacks on both peers.',
        'Validate explicit portable handshake credentials for selected namespaces before their providers accept application calls.'
      ],
      avoidWhen: [
        'Do not install auth only to validate business arguments; use declared schemas and the schema plugin for payload validation.',
        'Do not treat this plugin as automatic native-bootstrap token verification or enable one transform without its matching peer operation.'
      ]
    },
    zh: {
      purpose:
        '在启动传输前把认证信息流插件安装到 Host，让配套的 sign/verify 对已准备表示签名和验证，需要加密时再提供相互匹配的 encrypt/decrypt。credentials 与 verifyCredentials 处理显式握手凭据，不会自动发现原生启动令牌，也不替代载体的身份接纳。通过 namespaces 选择实际链路；业务调用结束后仍由应用关闭 Host，释放该安装拥有的认证资源。',
      quickStart:
        "// 传入应用实际拥有且相互匹配的签名及验证能力。\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { auth } from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\nexport async function run(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  const protection = auth({ sign, verify, encodedType: 'string' })\n  const host = await createRpcHost({\n    plugins: [\n      protection,\n      coroutinePlugin({\n        spawn: async ({ connect, signal }) => {\n          const child = await createRpcHost({\n            plugins: [protection, coroutinePlugin({ connectToParent: connect })],\n            provide: { echo: (value: string) => value },\n          })\n          try {\n            if (!signal.aborted) {\n              await new Promise<void>((resolve) =>\n                signal.addEventListener('abort', () => resolve(), { once: true }),\n              )\n            }\n          } finally {\n            await child.close()\n          }\n        },\n      }),\n    ],\n  })\n  try {\n    return await host.coroutine.request('echo', 'authenticated value')\n  } finally {\n    await host.close()\n  }\n}\n",
      options: [
        {
          name: 'encrypt',
          description: '加密已准备签名表示；输入输出须符合编码类别，解密执行逆操作。',
          whenToUse: '加密已准备签名表示；输入输出须符合编码类别，解密执行逆操作。',
          defaultValue: '不转换；应成对配置对应转换。',
          example:
            "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\n\nexport function signed(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encodedType: 'string' })\n}"
        },
        {
          name: 'decrypt',
          description: '在入站验证及准入前执行配套解密，抛错会拒绝信封。',
          whenToUse: '在入站验证及准入前执行配套解密，抛错会拒绝信封。',
          defaultValue: '不转换；应成对配置对应转换。',
          example:
            "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\n\nexport function signed(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encodedType: 'string' })\n}"
        },
        {
          name: 'sign',
          description: '签名含随机值及计数绑定的精确保护表示，返回供验证消费的表示。',
          whenToUse: '签名含随机值及计数绑定的精确保护表示，返回供验证消费的表示。',
          defaultValue: '不转换；应成对配置对应转换。',
          example:
            "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\n\nexport function signed(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encodedType: 'string' })\n}"
        },
        {
          name: 'verify',
          description: '验证配套保护表示并返回已认证内部数据，失败在提供方执行前拒绝。',
          whenToUse: '验证配套保护表示并返回已认证内部数据，失败在提供方执行前拒绝。',
          defaultValue: '不转换；应成对配置对应转换。',
          example:
            "import auth from '@migaia/rpc-host/plugins/auth'\nimport type { IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'\n\nexport function signed(\n  sign: IRpcAuthenticationTransform,\n  verify: IRpcAuthenticationTransform,\n) {\n  return auth({ sign, verify, encodedType: 'string' })\n}"
        },
        {
          name: 'encodedType',
          description: '转换输入输出类别，由认证表示所有者转换，不增加一个 JSON 解析器。',
          whenToUse: '转换输入输出类别，由认证表示所有者转换，不增加一个 JSON 解析器。',
          defaultValue: '任意类别。'
        },
        {
          name: 'namespaces',
          description: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          whenToUse: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          defaultValue: '全部已安装命名空间。'
        },
        {
          name: 'credentials',
          description:
            '显式可移植凭据，或接收实际接纳信息流上下文的异步解析器；不通过猜测载荷字段发现原生启动令牌。',
          whenToUse:
            '显式可移植凭据，或接收实际接纳信息流上下文的异步解析器；不通过猜测载荷字段发现原生启动令牌。',
          defaultValue: '无显式凭据。'
        },
        {
          name: 'verifyCredentials',
          description:
            '接收远端凭据、对端握手及实际信息流上下文；返回空值或对应 Promise 接受，抛错拒绝。',
          whenToUse:
            '接收远端凭据、对端握手及实际信息流上下文；返回空值或对应 Promise 接受，抛错拒绝。',
          defaultValue: '无凭据验证器。'
        }
      ],
      scenarios: [
        '双方使用应用持有的配套密码操作，签名出站帧并验证收到的原始保护表示。',
        '在选中命名空间的提供方接纳业务调用前，校验显式传入的可移植握手凭据。'
      ],
      avoidWhen: [
        '只需校验业务参数时不要用认证插件代替参数模式；应使用声明模式和 schema 插件。',
        '不要把安装此插件视为自动验证原生启动令牌，也不要仅配置一端无法匹配的签名或加密操作。'
      ]
    }
  },
  'rpc-host:plugins:batch': {
    en: {
      purpose:
        'Install negotiated physical batching for selected namespaces. The plugin combines compatible physical writes while keeping each logical call and application group under its original execution owner.',
      quickStart:
        "import batch from '@migaia/rpc-host/plugins/batch'\nexport const batching = batch({ required: false })",
      options: [
        {
          name: 'namespaces',
          description:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          whenToUse:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          defaultValue: 'All installed namespaces.'
        },
        {
          name: 'required',
          description:
            'Reject peers that cannot negotiate batch@1 rather than leaving batching optional.',
          whenToUse:
            'Reject peers that cannot negotiate batch@1 rather than leaving batching optional.',
          defaultValue: 'false.'
        }
      ],
      scenarios: [
        'A message transport receives bursts of small compatible writes that can share one native handoff.',
        'Only selected transport namespaces should negotiate batching before they start.'
      ],
      avoidWhen: [
        'Application steps need ordered result semantics; use group rather than physical batching.',
        'A write carries opaque native data or transfer ownership that cannot be combined; preserve the individual write boundary.'
      ]
    },
    zh: {
      purpose:
        '为选定命名空间安装经协商的物理合帧，将兼容写入合并发送；每个逻辑调用与应用分组仍由原执行所有者管理，不把合帧变成业务分组。',
      quickStart:
        "import batch from '@migaia/rpc-host/plugins/batch'\nexport const batching = batch({ required: false })",
      options: [
        {
          name: 'namespaces',
          description: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          whenToUse: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          defaultValue: '全部已安装命名空间。'
        },
        {
          name: 'required',
          description: '拒绝无法协商合帧扩展的对端，不将合帧保留为可选。',
          whenToUse: '拒绝无法协商合帧扩展的对端，不将合帧保留为可选。',
          defaultValue: '不强制。'
        }
      ],
      scenarios: [
        '消息传输会连续发送多个较小且兼容的写入，需要合并为一次原生交付。',
        '仅选定的传输命名空间需要在启动前协商并启用物理合帧。'
      ],
      avoidWhen: [
        '应用步骤需要有序结果语义时，应使用 group，而不是依赖物理合帧。',
        '写入含有不能合并的不透明原生数据或转移所有权时，应保留各自写入边界。'
      ]
    }
  },
  'rpc-host:plugins:chunk': {
    en: {
      purpose:
        'Install chunk on both peers when an encoded string or byte message must travel as bounded fragments. The plugin negotiates chunk@1, applies per-message and total assembly limits, and retires incomplete assemblies and their timers with the source. chunkBytes counts UTF-16 units for strings and bytes for Uint8Array. required rejects a peer lacking the extension; optional namespaces select existing links without constructing another transport or codec.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { chunk } from '@migaia/rpc-host/plugins/chunk'\nexport async function run() {\n  const framing = chunk({ required: true, chunkBytes: 16384, maxMessageBytes: 1048576 })\n  const host = await createRpcHost({\n    plugins: [\n      framing,\n      coroutinePlugin({\n        spawn: async ({ connect, signal }) => {\n          const child = await createRpcHost({\n            plugins: [framing, coroutinePlugin({ connectToParent: connect })],\n            provide: { echo: (value: string) => value },\n          })\n          try {\n            if (!signal.aborted) {\n              await new Promise<void>((resolve) =>\n                signal.addEventListener('abort', () => resolve(), { once: true }),\n              )\n            }\n          } finally {\n            await child.close()\n          }\n        },\n      }),\n    ],\n  })\n  try {\n    return await host.coroutine.request('echo', 'large result'.repeat(10000))\n  } finally {\n    await host.close()\n  }\n}\n",
      options: [
        {
          name: 'chunkBytes',
          description:
            'Positive fragment size in UTF-16 code units for text or bytes for Uint8Array.',
          whenToUse:
            'Positive fragment size in UTF-16 code units for text or bytes for Uint8Array.',
          defaultValue: '16384 units.'
        },
        {
          name: 'maxMessageBytes',
          description:
            'Maximum whole reassembled value, using the same text/byte units as chunkBytes.',
          whenToUse:
            'Maximum whole reassembled value, using the same text/byte units as chunkBytes.',
          defaultValue: '16777216 units.'
        },
        {
          name: 'maxChunks',
          description: 'Positive safe-integer fragment-count bound before assembly retention.',
          whenToUse: 'Positive safe-integer fragment-count bound before assembly retention.',
          defaultValue: '4096 fragments.'
        },
        {
          name: 'maxBufferedBytes',
          description: 'Total retained assembly units, at least maxMessageBytes.',
          whenToUse: 'Total retained assembly units, at least maxMessageBytes.',
          defaultValue: '67108864 units.'
        },
        {
          name: 'maxConcurrentMessages',
          description: 'Maximum simultaneous source/message assemblies.',
          whenToUse: 'Maximum simultaneous source/message assemblies.',
          defaultValue: '256 assemblies.'
        },
        {
          name: 'assemblyTimeoutMs',
          description: 'Positive safe-integer lifetime of an incomplete assembly.',
          whenToUse: 'Positive safe-integer lifetime of an incomplete assembly.',
          defaultValue: '30000 milliseconds.'
        },
        {
          name: 'now',
          description:
            'Retained compatibility clock option; current expiry is driven by schedule, not a separately polled clock.',
          whenToUse:
            'Retained compatibility clock option; current expiry is driven by schedule, not a separately polled clock.',
          defaultValue: 'No extra clock callback.'
        },
        {
          name: 'schedule',
          description:
            'Receives an expiry callback and delay, returns an owned timer handle; use cancel for that same scheduler.',
          whenToUse:
            'Receives an expiry callback and delay, returns an owned timer handle; use cancel for that same scheduler.',
          defaultValue: 'Host timeout scheduling.'
        },
        {
          name: 'cancel',
          description:
            'Cancel the handle issued by the configured schedule callback; cleanup failures retain their original diagnostic.',
          whenToUse:
            'Cancel the handle issued by the configured schedule callback; cleanup failures retain their original diagnostic.',
          defaultValue: 'Host timeout cancellation.'
        },
        {
          name: 'namespaces',
          description:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          whenToUse:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          defaultValue: 'All installed namespaces.'
        },
        {
          name: 'required',
          description: 'Require negotiated chunk@1 for this installation.',
          whenToUse: 'Require negotiated chunk@1 for this installation.',
          defaultValue: 'false.'
        }
      ],
      scenarios: [
        'Send a large encoded result across a message transport whose practical native message size is smaller than the application result.',
        'Bound retained incomplete assemblies with maxMessageBytes, maxChunks and assemblyTimeoutMs while requiring both peers to negotiate chunk@1.'
      ],
      avoidWhen: [
        'Omit chunk when messages already fit the native carrier and no fragmentation is needed; the absent plugin allocates no assembly resources.',
        'Do not use fragment quotas as provider concurrency, request timeout or business payload validation; these have separate policy owners.'
      ]
    },
    zh: {
      purpose:
        '编码后的字符串或字节消息需要拆成有界片段时，在通信双方安装 chunk。插件协商 chunk@1，约束单条消息、分片数量和总体组装保留量，并在来源退场时释放未完成组装及其计时器。chunkBytes 对文本按 UTF-16 码元、对 Uint8Array 按字节计量；required 可拒绝未支持该扩展的对端，namespaces 只选择已有链路，不另建传输或编解码器。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { chunk } from '@migaia/rpc-host/plugins/chunk'\nexport async function run() {\n  const framing = chunk({ required: true, chunkBytes: 16384, maxMessageBytes: 1048576 })\n  const host = await createRpcHost({\n    plugins: [\n      framing,\n      coroutinePlugin({\n        spawn: async ({ connect, signal }) => {\n          const child = await createRpcHost({\n            plugins: [framing, coroutinePlugin({ connectToParent: connect })],\n            provide: { echo: (value: string) => value },\n          })\n          try {\n            if (!signal.aborted) {\n              await new Promise<void>((resolve) =>\n                signal.addEventListener('abort', () => resolve(), { once: true }),\n              )\n            }\n          } finally {\n            await child.close()\n          }\n        },\n      }),\n    ],\n  })\n  try {\n    return await host.coroutine.request('echo', 'large result'.repeat(10000))\n  } finally {\n    await host.close()\n  }\n}\n",
      options: [
        {
          name: 'chunkBytes',
          description: '正数分片大小；文本按 UTF-16 码元、字节数组按字节计算。',
          whenToUse: '正数分片大小；文本按 UTF-16 码元、字节数组按字节计算。',
          defaultValue: '一万六千三百八十四单位。'
        },
        {
          name: 'maxMessageBytes',
          description: '完整重组值上限，采用与分片大小相同的文本及字节单位。',
          whenToUse: '完整重组值上限，采用与分片大小相同的文本及字节单位。',
          defaultValue: '一千六百七十七万七千二百一十六单位。'
        },
        {
          name: 'maxChunks',
          description: '组装保留前检查的正安全整数分片数上限。',
          whenToUse: '组装保留前检查的正安全整数分片数上限。',
          defaultValue: '四千零九十六片。'
        },
        {
          name: 'maxBufferedBytes',
          description: '组装保留总单位，至少等于整条消息上限。',
          whenToUse: '组装保留总单位，至少等于整条消息上限。',
          defaultValue: '六千七百一十万八千八百六十四单位。'
        },
        {
          name: 'maxConcurrentMessages',
          description: '同时保留的来源及消息组装数量上限。',
          whenToUse: '同时保留的来源及消息组装数量上限。',
          defaultValue: '二百五十六组。'
        },
        {
          name: 'assemblyTimeoutMs',
          description: '未完成组装的正安全整数保留毫秒数。',
          whenToUse: '未完成组装的正安全整数保留毫秒数。',
          defaultValue: '三万毫秒。'
        },
        {
          name: 'now',
          description: '保留的时钟选项；当前过期由调度回调驱动，不另轮询时钟。',
          whenToUse: '保留的时钟选项；当前过期由调度回调驱动，不另轮询时钟。',
          defaultValue: '无额外时钟回调。'
        },
        {
          name: 'schedule',
          description: '接收过期回调及延迟，返回所拥有的计时句柄；应由对应取消端口释放。',
          whenToUse: '接收过期回调及延迟，返回所拥有的计时句柄；应由对应取消端口释放。',
          defaultValue: '宿主超时调度。'
        },
        {
          name: 'cancel',
          description: '取消已配置调度回调签发的句柄，清理失败保留原诊断。',
          whenToUse: '取消已配置调度回调签发的句柄，清理失败保留原诊断。',
          defaultValue: '宿主超时取消。'
        },
        {
          name: 'namespaces',
          description: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          whenToUse: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          defaultValue: '全部已安装命名空间。'
        },
        {
          name: 'required',
          description: '本次安装要求协商分片扩展。',
          whenToUse: '本次安装要求协商分片扩展。',
          defaultValue: '不强制。'
        }
      ],
      scenarios: [
        '业务结果大于原生消息载体适合一次投递的大小时，分片发送实际编码后的消息。',
        '要求双方协商 chunk@1，并用 maxMessageBytes、maxChunks 与 assemblyTimeoutMs 限定未完成组装的资源。'
      ],
      avoidWhen: [
        '消息已经适合原生载体、无需分片时省略此插件；未安装时不会创建组装资源。',
        '不要把分片配额当成提供方并发、请求超时或业务载荷校验，这些职责由独立策略拥有。'
      ]
    }
  },
  'rpc-host:plugins:createRpcIdempotencyStore': {
    en: {
      purpose:
        'Create a bounded in-memory execution and outcome store. Retention starts at settlement, and result-body eviction preserves the execution record so missing content never authorizes another execution.',
      quickStart:
        "import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-request')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))",
      options: [
        {
          name: 'retentionMs',
          description:
            'Positive safe-integer milliseconds retained after settlement; pending execution does not expire by this policy.',
          whenToUse:
            'Positive safe-integer milliseconds retained after settlement; pending execution does not expire by this policy.',
          defaultValue:
            'Default 300000; invalid nonpositive or unsafe integers fail INVALID_CONFIG.'
        },
        {
          name: 'maxEntries',
          description: 'Positive safe-integer total original entry capacity.',
          whenToUse: 'Positive safe-integer total original entry capacity.',
          defaultValue: 'Default 1024; invalid nonpositive or unsafe integers fail INVALID_CONFIG.'
        },
        {
          name: 'maxEntriesPerScope',
          description: 'Positive safe-integer original entry capacity in each actual scope.',
          whenToUse: 'Positive safe-integer original entry capacity in each actual scope.',
          defaultValue: 'Default 256; invalid nonpositive or unsafe integers fail INVALID_CONFIG.'
        },
        {
          name: 'maxBytes',
          description: 'Positive safe-integer total retained portable-outcome byte budget.',
          whenToUse: 'Positive safe-integer total retained portable-outcome byte budget.',
          defaultValue:
            'Default 8388608; invalid nonpositive or unsafe integers fail INVALID_CONFIG.'
        },
        {
          name: 'maxOutcomeBytes',
          description:
            'Positive safe-integer per-outcome retention budget; larger results leave an unavailable tombstone.',
          whenToUse:
            'Positive safe-integer per-outcome retention budget; larger results leave an unavailable tombstone.',
          defaultValue:
            'Default 1048576; invalid nonpositive or unsafe integers fail INVALID_CONFIG.'
        }
      ],
      scenarios: [
        'The idempotency plugin needs a local store shared by the selected provider scopes.',
        'An operator must query a settled outcome even when its retained result body was evicted under byte pressure.'
      ],
      avoidWhen: [
        'Deduplication must survive process loss; use a store with the required durability contract.',
        'A missing retained body is being treated as permission to repeat a side effect; consult the execution state instead.'
      ]
    },
    zh: {
      purpose:
        '创建有容量上限的内存执行与结果存储；保留期从结算时计算，结果正文被淘汰后仍保留执行事实，不能因内容缺失就允许再次执行。',
      quickStart:
        "import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'\nconst store = createRpcIdempotencyStore()\nconst claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-request')\nif (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)\nconsole.log(store.lookup?.('actual-session', 'checkout-1', 2))",
      options: [
        {
          name: 'retentionMs',
          description: '结算后保留的正安全整数毫秒，此策略不会使等待执行过期。',
          whenToUse: '结算后保留的正安全整数毫秒，此策略不会使等待执行过期。',
          defaultValue: '默认 `300000`，非正数或非安全整数以配置非法失败。'
        },
        {
          name: 'maxEntries',
          description: '正安全整数原始条目总容量。',
          whenToUse: '正安全整数原始条目总容量。',
          defaultValue: '默认 `1024`，非正数或非安全整数以配置非法失败。'
        },
        {
          name: 'maxEntriesPerScope',
          description: '每个实际作用域的正安全整数原始条目容量。',
          whenToUse: '每个实际作用域的正安全整数原始条目容量。',
          defaultValue: '默认 `256`，非正数或非安全整数以配置非法失败。'
        },
        {
          name: 'maxBytes',
          description: '已保留可移植结果的正安全整数字节总预算。',
          whenToUse: '已保留可移植结果的正安全整数字节总预算。',
          defaultValue: '默认 `8388608`，非正数或非安全整数以配置非法失败。'
        },
        {
          name: 'maxOutcomeBytes',
          description:
            '每项结果的保留预算，须为正安全整数；超过预算时仍保留结果已不可用的执行记录。',
          whenToUse: '每项结果的保留预算，须为正安全整数；超过预算时仍保留结果已不可用的执行记录。',
          defaultValue: '默认 `1048576`，非正数或非安全整数以配置非法失败。'
        }
      ],
      scenarios: [
        '幂等插件需要为选定的提供方作用域共享一个本地执行存储。',
        '运维查询需要区分已结算执行与因字节压力被淘汰的结果正文。'
      ],
      avoidWhen: [
        '去重事实必须在进程退出后继续存在时，应使用满足持久化契约的存储。',
        '不能将缺少保留正文解释为允许重做副作用，应先检查已有执行状态。'
      ]
    }
  },
  'rpc-host:plugins:defineProbe': {
    en: {
      purpose:
        'Compile an independent frozen probe or attach probe behavior to the same enhanced application object. Installed observation handles select actual supported stages without opening a transport or changing business authority.',
      quickStart:
        "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])",
      options: [
        {
          name: 'stages',
          description:
            'Application-selected nonempty stage-name array from RpcProbeStageName; duplicates compile to one bit.',
          whenToUse:
            'Application-selected nonempty stage-name array from RpcProbeStageName; duplicates compile to one bit.'
        },
        {
          name: 'capture',
          description:
            'Application-selected subset of initial stages whose content may be captured after redaction; later setStages cannot enlarge this immutable permission.',
          whenToUse:
            'Application-selected subset of initial stages whose content may be captured after redaction; later setStages cannot enlarge this immutable permission.',
          defaultValue: 'Absent: no content capture.'
        },
        {
          name: 'methods',
          description:
            'Application method-name filter for method-bearing logical/envelope observations; methodless controls remain visible.',
          whenToUse:
            'Application method-name filter for method-bearing logical/envelope observations; methodless controls remain visible.',
          defaultValue: 'Absent: all methods remain eligible.'
        },
        {
          name: 'sample',
          description:
            'Application probability strictly greater than zero and at most one; deterministic sender/message correlation selects matching events.',
          whenToUse:
            'Application probability strictly greater than zero and at most one; deterministic sender/message correlation selects matching events.',
          defaultValue: '1: retain every eligible event.'
        },
        {
          name: 'redact',
          description:
            'Synchronous application transform receives numeric stage and original content; return only the redacted value safe to expose. A throw is sent to onError and contained.',
          whenToUse:
            'Synchronous application transform receives numeric stage and original content; return only the redacted value safe to expose. A throw is sent to onError and contained.',
          defaultValue: 'Absent: selected captures expose the original content reference.',
          example:
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])"
        },
        {
          name: 'describe',
          description:
            'Receives the cold actual endpoint capability descriptor at installation; synchronous observer throws are contained through onError.',
          whenToUse:
            'Receives the cold actual endpoint capability descriptor at installation; synchronous observer throws are contained through onError.',
          defaultValue: 'Absent: no descriptor callback.',
          example:
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])"
        },
        {
          name: 'emit',
          description:
            'Receives a reused mutable view valid only during this synchronous callback; snapshot before retaining. Throws are isolated through onError.',
          whenToUse:
            'Receives a reused mutable view valid only during this synchronous callback; snapshot before retaining. Throws are isolated through onError.',
          example:
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])"
        },
        {
          name: 'onError',
          description:
            'Receives a coded PROBE_FAILED wrapper retaining the original callback failure as cause; a secondary throw is forwarded to hostRethrowReporter without changing business settlement.',
          whenToUse:
            'Receives a coded PROBE_FAILED wrapper retaining the original callback failure as cause; a secondary throw is forwarded to hostRethrowReporter without changing business settlement.',
          defaultValue: 'Absent: canonical host reporting receives observer failures.',
          example:
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])"
        }
      ],
      scenarios: [
        'An application needs a reusable probe definition whose callbacks remain separate from transport acquisition.',
        'A collector-enhanced application object must retain its original identity while gaining probe subscriptions.'
      ],
      avoidWhen: [
        'An observer is expected to authorize calls or rewrite provider results; use the corresponding execution owner.',
        'Only a ready-made host observation plugin is needed; install probe with the existing handle instead.'
      ]
    },
    zh: {
      purpose:
        '编译独立冻结探针，或把探针行为附加到同一个增强应用对象；观察句柄只选择实际支持的阶段，不打开传输，也不改变业务权限。',
      quickStart:
        "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])",
      options: [
        {
          name: 'stages',
          description: '应用从规范阶段名称表选择的非空数组，重复名称编译为同一位。',
          whenToUse: '应用从规范阶段名称表选择的非空数组，重复名称编译为同一位。'
        },
        {
          name: 'capture',
          description:
            '应用选择的初始阶段子集，允许脱敏后捕获内容，后续修改阶段不能扩大此不可变权限。',
          whenToUse:
            '应用选择的初始阶段子集，允许脱敏后捕获内容，后续修改阶段不能扩大此不可变权限。',
          defaultValue: '默认不捕获内容。'
        },
        {
          name: 'methods',
          description: '应用方法名过滤器作用于含方法的逻辑及消息封装观察，无方法控制仍可见。',
          whenToUse: '应用方法名过滤器作用于含方法的逻辑及消息封装观察，无方法控制仍可见。',
          defaultValue: '默认所有方法均可被观察。'
        },
        {
          name: 'sample',
          description: '应用采样概率须大于零且不大于一，确定性发送及消息关联选择匹配事件。',
          whenToUse: '应用采样概率须大于零且不大于一，确定性发送及消息关联选择匹配事件。',
          defaultValue: '默认一，保留所有符合条件的事件。'
        },
        {
          name: 'redact',
          description:
            '应用同步转换接收数字阶段及原内容，只返回可以公开的脱敏值；抛错交错误观察并被隔离。',
          whenToUse:
            '应用同步转换接收数字阶段及原内容，只返回可以公开的脱敏值；抛错交错误观察并被隔离。',
          defaultValue: '默认选定捕获公开原内容引用。',
          example:
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])"
        },
        {
          name: 'describe',
          description: '安装时接收实际端点能力冷描述，同步观察者抛错经错误观察隔离。',
          whenToUse: '安装时接收实际端点能力冷描述，同步观察者抛错经错误观察隔离。',
          defaultValue: '默认没有描述回调。',
          example:
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])"
        },
        {
          name: 'emit',
          description:
            '接收只在本次同步回调期间有效的复用可变视图，保留前须快照；抛错经错误观察隔离。',
          whenToUse:
            '接收只在本次同步回调期间有效的复用可变视图，保留前须快照；抛错经错误观察隔离。',
          example:
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])"
        },
        {
          name: 'onError',
          description:
            '接收带探针失败码的包装错误并在原因中保留原回调失败，次级抛错交宿主规范上报，不改变业务结算。',
          whenToUse:
            '接收带探针失败码的包装错误并在原因中保留原回调失败，次级抛错交宿主规范上报，不改变业务结算。',
          defaultValue: '默认由规范宿主上报处理观察失败。',
          example:
            "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])"
        }
      ],
      scenarios: [
        '应用需要复用探针定义，并让观察回调与传输获取保持独立。',
        '增强后的收集对象需要保留原始身份，同时获得探针订阅能力。'
      ],
      avoidWhen: [
        '需要授权调用或改写提供方结果时，应使用对应执行所有者，不能由观察器承担。',
        '已经有观察句柄且只需宿主观察时，应直接安装使用该句柄的 probe 插件。'
      ]
    }
  },
  'rpc-host:plugins:idempotency': {
    en: {
      purpose:
        'Install provider execution claims, outcome storage and namespace outcome queries using the selected store and scope. A key is metadata for this policy; it does not by itself enable client retry.',
      quickStart:
        "import idempotency from '@migaia/rpc-host/plugins/idempotency'\nexport const outcomes = idempotency({ retentionMs: 300000 })",
      options: [
        {
          name: 'retentionMs',
          description:
            'Positive safe-integer milliseconds retained after settlement; pending execution does not expire by this policy.',
          whenToUse:
            'Positive safe-integer milliseconds retained after settlement; pending execution does not expire by this policy.',
          defaultValue:
            'Default 300000; invalid nonpositive or unsafe integers fail INVALID_CONFIG.'
        },
        {
          name: 'maxEntries',
          description: 'Positive safe-integer total original entry capacity.',
          whenToUse: 'Positive safe-integer total original entry capacity.',
          defaultValue: 'Default 1024; invalid nonpositive or unsafe integers fail INVALID_CONFIG.'
        },
        {
          name: 'maxEntriesPerScope',
          description: 'Positive safe-integer original entry capacity in each actual scope.',
          whenToUse: 'Positive safe-integer original entry capacity in each actual scope.',
          defaultValue: 'Default 256; invalid nonpositive or unsafe integers fail INVALID_CONFIG.'
        },
        {
          name: 'maxBytes',
          description: 'Positive safe-integer total retained portable-outcome byte budget.',
          whenToUse: 'Positive safe-integer total retained portable-outcome byte budget.',
          defaultValue:
            'Default 8388608; invalid nonpositive or unsafe integers fail INVALID_CONFIG.'
        },
        {
          name: 'maxOutcomeBytes',
          description:
            'Positive safe-integer per-outcome retention budget; larger results leave an unavailable tombstone.',
          whenToUse:
            'Positive safe-integer per-outcome retention budget; larger results leave an unavailable tombstone.',
          defaultValue:
            'Default 1048576; invalid nonpositive or unsafe integers fail INVALID_CONFIG.'
        },
        {
          name: 'namespaces',
          description:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          whenToUse:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          defaultValue: 'All installed namespaces.'
        },
        {
          name: 'store',
          description:
            'Original injected claim/lookup owner; no second store is created when supplied.',
          whenToUse:
            'Original injected claim/lookup owner; no second store is created when supplied.',
          defaultValue: 'A bounded in-memory store from these capacity options.'
        },
        {
          name: 'scope',
          description:
            'Receives actual token/sender identity facts and returns a stable application scope; do not derive authorization from arbitrary payload data.',
          whenToUse:
            'Receives actual token/sender identity facts and returns a stable application scope; do not derive authorization from arbitrary payload data.',
          defaultValue: 'Canonical installed peer scope.'
        }
      ],
      scenarios: [
        'A side-effecting provider needs retained execution facts and an outcome query through its namespace.',
        'Several namespaces must share or isolate claims according to an explicitly selected store scope.'
      ],
      avoidWhen: [
        'The operation merely needs a timeout or retry budget; select those complete call features separately.',
        'An application assumes every arbitrary payload has a proven fingerprint; verify the store and fingerprint contract first.'
      ]
    },
    zh: {
      purpose:
        '安装提供方执行认领、结果存储及命名空间结果查询，并使用选定的存储与作用域；幂等键是策略输入，单独声明它不会启用客户端重试。',
      quickStart:
        "import idempotency from '@migaia/rpc-host/plugins/idempotency'\nexport const outcomes = idempotency({ retentionMs: 300000 })",
      options: [
        {
          name: 'retentionMs',
          description: '结算后保留的正安全整数毫秒，此策略不会使等待执行过期。',
          whenToUse: '结算后保留的正安全整数毫秒，此策略不会使等待执行过期。',
          defaultValue: '默认 `300000`，非正数或非安全整数以配置非法失败。'
        },
        {
          name: 'maxEntries',
          description: '正安全整数原始条目总容量。',
          whenToUse: '正安全整数原始条目总容量。',
          defaultValue: '默认 `1024`，非正数或非安全整数以配置非法失败。'
        },
        {
          name: 'maxEntriesPerScope',
          description: '每个实际作用域的正安全整数原始条目容量。',
          whenToUse: '每个实际作用域的正安全整数原始条目容量。',
          defaultValue: '默认 `256`，非正数或非安全整数以配置非法失败。'
        },
        {
          name: 'maxBytes',
          description: '已保留可移植结果的正安全整数字节总预算。',
          whenToUse: '已保留可移植结果的正安全整数字节总预算。',
          defaultValue: '默认 `8388608`，非正数或非安全整数以配置非法失败。'
        },
        {
          name: 'maxOutcomeBytes',
          description:
            '每项结果的保留预算，须为正安全整数；超过预算时仍保留结果已不可用的执行记录。',
          whenToUse: '每项结果的保留预算，须为正安全整数；超过预算时仍保留结果已不可用的执行记录。',
          defaultValue: '默认 `1048576`，非正数或非安全整数以配置非法失败。'
        },
        {
          name: 'namespaces',
          description: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          whenToUse: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          defaultValue: '全部已安装命名空间。'
        },
        {
          name: 'store',
          description: '原注入认领及查询所有者；提供后不创建第二份存储。',
          whenToUse: '原注入认领及查询所有者；提供后不创建第二份存储。',
          defaultValue: '按容量选项创建有界内存存储。'
        },
        {
          name: 'scope',
          description:
            '接收实际令牌及发送方身份事实，返回稳定应用作用域；不从任意载荷数据推导权限。',
          whenToUse: '接收实际令牌及发送方身份事实，返回稳定应用作用域；不从任意载荷数据推导权限。',
          defaultValue: '规范已安装对端作用域。'
        }
      ],
      scenarios: [
        '具有副作用的提供方需要保留执行事实，并通过其命名空间查询结果。',
        '多个命名空间需要按显式选择的存储作用域共享或隔离执行认领。'
      ],
      avoidWhen: [
        '操作只需超时或重试预算时，应单独选择对应的完整调用功能实例。',
        '不能假定任意负载都已有等价指纹，应先核对存储与指纹契约。'
      ]
    }
  },
  'rpc-host:plugins:limits': {
    en: {
      purpose:
        'Install shared provider concurrency and optional connection admission limits. These policy slots count RPC work and accepted connections, independently of native worker or pool capacity.',
      quickStart:
        "import limits from '@migaia/rpc-host/plugins/limits'\nexport const capacity = limits()",
      options: [
        {
          name: 'maxGlobal',
          description: 'Maximum admitted concurrent provider work across this shared installation.',
          whenToUse: 'Maximum admitted concurrent provider work across this shared installation.',
          defaultValue: '256.'
        },
        {
          name: 'maxPerPeer',
          description: 'Maximum admitted concurrent work for one accepted peer scope.',
          whenToUse: 'Maximum admitted concurrent work for one accepted peer scope.',
          defaultValue: '64.'
        },
        {
          name: 'maxCallsPerMinute',
          description: 'Optional actual per-connection call-rate bound.',
          whenToUse: 'Optional actual per-connection call-rate bound.',
          defaultValue: 'No rate restriction.'
        },
        {
          name: 'maxPayloadBytes',
          description: 'Optional admitted business payload bound measured by the limits owner.',
          whenToUse: 'Optional admitted business payload bound measured by the limits owner.',
          defaultValue: 'No payload restriction.'
        },
        {
          name: 'maxConsecutiveTimeouts',
          description: 'Optional consecutive provider-timeout threshold for this connection.',
          whenToUse: 'Optional consecutive provider-timeout threshold for this connection.',
          defaultValue: 'No timeout-streak restriction.'
        },
        {
          name: 'idleTimeoutMs',
          description: 'Optional idle connection lifetime; timer belongs to this installed policy.',
          whenToUse: 'Optional idle connection lifetime; timer belongs to this installed policy.',
          defaultValue: 'No idle restriction.'
        },
        {
          name: 'violationLimit',
          description:
            'Violations before the existing connection policy retires its exact carrier.',
          whenToUse: 'Violations before the existing connection policy retires its exact carrier.',
          defaultValue: 'No automatic retirement threshold unless explicitly configured.'
        },
        {
          name: 'overflow',
          description:
            'Explicit source/code/message presentation for original governance rejection; does not grant local authority.',
          whenToUse:
            'Explicit source/code/message presentation for original governance rejection; does not grant local authority.',
          defaultValue: 'Canonical provider overload presentation.'
        },
        {
          name: 'onRejected',
          description:
            'Receives the admitted peer/controller, method and canonical reason before rejection; async callback failure is reported without replacing admission.',
          whenToUse:
            'Receives the admitted peer/controller, method and canonical reason before rejection; async callback failure is reported without replacing admission.',
          defaultValue: 'No rejection observer.'
        },
        {
          name: 'scheduler',
          description:
            'Existing application scheduler for actual admission timers and monotonic observations.',
          whenToUse:
            'Existing application scheduler for actual admission timers and monotonic observations.',
          defaultValue: 'systemScheduler.'
        },
        {
          name: 'namespaces',
          description:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          whenToUse:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          defaultValue: 'All installed namespaces.'
        }
      ],
      scenarios: [
        'Providers must share a concurrency ceiling while queued ordered work remains subject to admission.',
        'Selected namespaces need an explicit bound on accepted connection resources.'
      ],
      avoidWhen: [
        'The requirement is to resize native workers; use the transport pool or member controls.',
        'A deployment expects byte bandwidth shaping; provider concurrency is not a network byte quota.'
      ]
    },
    zh: {
      purpose:
        '安装共享提供方并发限制及可选连接准入限制；策略计数面向 RPC 工作与已接纳连接，独立于原生工作单元数量及池容量。',
      quickStart:
        "import limits from '@migaia/rpc-host/plugins/limits'\nexport const capacity = limits()",
      options: [
        {
          name: 'maxGlobal',
          description: '本共享安装接纳的提供方并发工作总上限。',
          whenToUse: '本共享安装接纳的提供方并发工作总上限。',
          defaultValue: '二百五十六。'
        },
        {
          name: 'maxPerPeer',
          description: '一个接纳对端作用域的并发工作上限。',
          whenToUse: '一个接纳对端作用域的并发工作上限。',
          defaultValue: '六十四。'
        },
        {
          name: 'maxCallsPerMinute',
          description: '实际单连接的可选每分钟调用上限。',
          whenToUse: '实际单连接的可选每分钟调用上限。',
          defaultValue: '不限速率。'
        },
        {
          name: 'maxPayloadBytes',
          description: '限流所有者测量的可选业务载荷上限。',
          whenToUse: '限流所有者测量的可选业务载荷上限。',
          defaultValue: '不限载荷。'
        },
        {
          name: 'maxConsecutiveTimeouts',
          description: '本连接的可选提供方连续超时阈值。',
          whenToUse: '本连接的可选提供方连续超时阈值。',
          defaultValue: '不限制连续超时。'
        },
        {
          name: 'idleTimeoutMs',
          description: '可选连接空闲寿命，计时器由本次安装策略拥有。',
          whenToUse: '可选连接空闲寿命，计时器由本次安装策略拥有。',
          defaultValue: '不限制空闲。'
        },
        {
          name: 'violationLimit',
          description: '现有连接策略使其精确载体退场之前允许的违例次数。',
          whenToUse: '现有连接策略使其精确载体退场之前允许的违例次数。',
          defaultValue: '不显式配置时没有自动退场阈值。'
        },
        {
          name: 'overflow',
          description: '原治理拒绝使用的显式来源、错误码及消息展示，不授予本地权限。',
          whenToUse: '原治理拒绝使用的显式来源、错误码及消息展示，不授予本地权限。',
          defaultValue: '规范提供方过载展示。'
        },
        {
          name: 'onRejected',
          description:
            '拒绝前接收已接纳对端及控制器、方法和规范原因；异步回调失败会被上报，不替换准入结果。',
          whenToUse:
            '拒绝前接收已接纳对端及控制器、方法和规范原因；异步回调失败会被上报，不替换准入结果。',
          defaultValue: '无拒绝观察器。'
        },
        {
          name: 'scheduler',
          description: '提供真实准入计时器及单调观察时间的现有应用调度器。',
          whenToUse: '提供真实准入计时器及单调观察时间的现有应用调度器。',
          defaultValue: '系统调度器。'
        },
        {
          name: 'namespaces',
          description: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          whenToUse: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          defaultValue: '全部已安装命名空间。'
        }
      ],
      scenarios: [
        '提供方需要共享并发上限，且已经排队的有序任务仍须接受准入约束。',
        '选定命名空间需要明确限制已接纳连接所占用的资源。'
      ],
      avoidWhen: [
        '需要调整原生工作单元数量时，应使用传输池或成员控制。',
        '需要按字节整形带宽时，不能把提供方并发限制当作网络字节配额。'
      ]
    }
  },
  'rpc-host:plugins:linkPolicy': {
    en: {
      purpose:
        'Install complete timeout and retry instances as link defaults before transport and per-call overrides. The policy selects existing feature owners and adds no separate call pipeline.',
      quickStart:
        "import linkPolicy from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({ features: [timeout({ ms: 1500 })] })",
      options: [
        {
          name: 'features',
          description:
            'Actual executing feature instances; duplicate kinds reject at cold admission.',
          whenToUse: 'Actual executing feature instances; duplicate kinds reject at cold admission.'
        }
      ],
      scenarios: [
        'Several transport namespaces should inherit the same explicit timeout and retry defaults.',
        'A host-wide link default must remain overridable by a complete per-call feature or false.'
      ],
      avoidWhen: [
        'A policy is expected to acquire or supervise native workers; use the concrete transport source.',
        'A numeric timeout is being passed as a feature; construct timeout with its options first.'
      ]
    },
    zh: {
      purpose:
        '在传输及单次调用覆盖之前安装链路默认的完整超时与重试实例；该策略只选择已有功能所有者，不增加另一套调用流水线。',
      quickStart:
        "import linkPolicy from '@migaia/rpc-host/plugins/link-policy'\nimport { timeout } from '@migaia/rpc-host/features'\nexport const defaults = linkPolicy({ features: [timeout({ ms: 1500 })] })",
      options: [
        {
          name: 'features',
          description: '实际执行功能实例；同种重复功能在冷准入时拒绝。',
          whenToUse: '实际执行功能实例；同种重复功能在冷准入时拒绝。'
        }
      ],
      scenarios: [
        '多个传输命名空间需要继承同一组显式超时与重试默认值。',
        '宿主链路默认值需要允许单次调用以完整功能实例或 false 覆盖。'
      ],
      avoidWhen: [
        '需要获取或监管原生工作单元时，应使用具体传输源，而非链路默认策略。',
        '不能把超时数字直接当作功能，应先用配置构造完整 timeout 实例。'
      ]
    }
  },
  'rpc-host:plugins:probe': {
    en: {
      purpose:
        'Install passive observation at the Host flow stages supported by the supplied probe handle. Observation follows actual execution and carrier facts without owning IO or altering provider results.',
      quickStart:
        "import probe from '@migaia/rpc-host/plugins/probe'\nexport const observation = probe({\n  stages: ['message'],\n  emit: (view) => console.log({ ...view }),\n})",
      options: [],
      scenarios: [
        'A real probe handle should observe selected namespaces without changing their call or carrier ownership.',
        'Diagnostics need semantic and raw carrier events at the stages the installed transport actually exposes.'
      ],
      avoidWhen: [
        'The application needs to change an envelope or enforce admission; implement the appropriate flow hook.',
        'A raw-stage listener expects decoded business values; select the semantic stage instead of parsing borrowed raw data.'
      ]
    },
    zh: {
      purpose:
        '将给定探针句柄安装到宿主实际支持的信息流阶段；观察借用真实执行与载体事实，不拥有读写资源，也不改写提供方结果。',
      quickStart:
        "import probe from '@migaia/rpc-host/plugins/probe'\nexport const observation = probe({\n  stages: ['message'],\n  emit: (view) => console.log({ ...view }),\n})",
      options: [],
      scenarios: [
        '真实探针句柄需要观察选定命名空间，同时保留其调用与载体所有权。',
        '诊断需要从已安装传输实际提供的阶段读取语义事件及原始载体事件。'
      ],
      avoidWhen: [
        '应用需要修改信封或执行准入时，应实现对应的信息流介入点。',
        '原始阶段监听器不应自行解析借用数据来获取业务值，应选择语义阶段。'
      ]
    }
  },
  'rpc-host:plugins:schema': {
    en: {
      purpose:
        'Install explicit method parsers for provider payloads and results using actual method paths. Without this plugin, local contract declarations remain metadata and do not perform business validation.',
      quickStart:
        "import schema from '@migaia/rpc-host/plugins/schema'\nexport const validation = schema()",
      options: [
        {
          name: 'schemas',
          description:
            'Application method-name map with params/result parsers retaining their captured receiver.',
          whenToUse:
            'Application method-name map with params/result parsers retaining their captured receiver.',
          defaultValue: 'No explicit parsers.'
        },
        {
          name: 'namespaces',
          description:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          whenToUse:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          defaultValue: 'All installed namespaces.'
        }
      ],
      scenarios: [
        'A provider needs its declared input and result parsers enforced at the actual dispatch boundary.',
        'Only selected method paths or namespaces should run application schema validation.'
      ],
      avoidWhen: [
        'The problem is wire grammar admission; the Contract protocol normalizers already own that boundary.',
        'Declaring a schema is being assumed to enable validation without installation; install this plugin explicitly.'
      ]
    },
    zh: {
      purpose:
        '按实际方法路径安装提供方负载及结果解析器；没有安装该插件时，本地契约声明仍是元数据，不会自动执行业务数据校验。',
      quickStart:
        "import schema from '@migaia/rpc-host/plugins/schema'\nexport const validation = schema()",
      options: [
        {
          name: 'schemas',
          description: '应用方法名映射，包含保留捕获接收者的参数及结果解析器。',
          whenToUse: '应用方法名映射，包含保留捕获接收者的参数及结果解析器。',
          defaultValue: '无显式解析器。'
        },
        {
          name: 'namespaces',
          description: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          whenToUse: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          defaultValue: '全部已安装命名空间。'
        }
      ],
      scenarios: [
        '提供方需要在实际派发边界执行已声明的输入及结果解析器。',
        '只有选定的方法路径或命名空间需要运行应用模式校验。'
      ],
      avoidWhen: [
        '线上语法准入问题已由 Contract 协议规范化所有者处理，不应在此重复。',
        '不能假定声明模式就自动启用校验，需要显式安装此插件。'
      ]
    }
  },
  'rpc-host:plugins:typegen': {
    en: {
      purpose:
        'Install the readonly typegen observer before a transport starts and provide the application-owned out.write capability. An actual accepted peer directory supplies method metadata for one inert TypeScript declaration; namespaces limits which installed links are observed. The application decides how to persist the file name and text. Write failures reach the Host report outlet, and disposal prevents later generation without granting provider execution or filesystem authority to remote peer strings.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { typegen } from '@migaia/rpc-host/plugins/typegen'\nexport async function run() {\n  const declarations = typegen({\n    out: { write: (fileName, text) => console.log(fileName, text) },\n  })\n  const host = await createRpcHost({\n    plugins: [\n      declarations,\n      coroutinePlugin({\n        spawn: async ({ connect, signal }) => {\n          const child = await createRpcHost({\n            plugins: [coroutinePlugin({ connectToParent: connect })],\n            provide: { double: (value: number) => value * 2 },\n          })\n          try {\n            if (!signal.aborted) {\n              await new Promise<void>((resolve) =>\n                signal.addEventListener('abort', () => resolve(), { once: true }),\n              )\n            }\n          } finally {\n            await child.close()\n          }\n        },\n      }),\n    ],\n  })\n  try {\n    return await host.coroutine.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}\n",
      options: [
        {
          name: 'out',
          description: 'Application writer called only for real accepted peer directories.',
          whenToUse: 'Application writer called only for real accepted peer directories.'
        },
        {
          name: 'namespaces',
          description:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          whenToUse:
            'Exact installed namespace names to which this plugin applies; this does not create namespaces.',
          defaultValue: 'All installed namespaces.'
        }
      ],
      scenarios: [
        'Write a TypeScript declaration when a real peer is accepted, using that peer directory rather than a hand-maintained method list.',
        'Generate declarations only for selected transport namespaces and route output to an application-owned editor, file writer or review buffer.'
      ],
      avoidWhen: [
        'Do not use generated declarations as runtime validation, provider authorization or an implementation of the remote methods.',
        'Do not expect every later directory refresh to generate another file; this observer listens to accepted-peer events, not arbitrary metadata changes.'
      ]
    },
    zh: {
      purpose:
        '在传输启动前安装只读的 typegen 观察插件，并提供由应用拥有的 out.write 输出能力。真实接纳的对端目录提供方法元数据，用来生成不执行业务的 TypeScript 声明；namespaces 限定需要观察的已安装链路。文件名与文本由应用决定如何保存，写入失败交给 Host 报告出口，销毁后不再生成新声明，不会因对端字符串获得文件系统或提供方执行权限。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'\nimport { typegen } from '@migaia/rpc-host/plugins/typegen'\nexport async function run() {\n  const declarations = typegen({\n    out: { write: (fileName, text) => console.log(fileName, text) },\n  })\n  const host = await createRpcHost({\n    plugins: [\n      declarations,\n      coroutinePlugin({\n        spawn: async ({ connect, signal }) => {\n          const child = await createRpcHost({\n            plugins: [coroutinePlugin({ connectToParent: connect })],\n            provide: { double: (value: number) => value * 2 },\n          })\n          try {\n            if (!signal.aborted) {\n              await new Promise<void>((resolve) =>\n                signal.addEventListener('abort', () => resolve(), { once: true }),\n              )\n            }\n          } finally {\n            await child.close()\n          }\n        },\n      }),\n    ],\n  })\n  try {\n    return await host.coroutine.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}\n",
      options: [
        {
          name: 'out',
          description: '仅在真实接纳对端目录时调用的应用写入器。',
          whenToUse: '仅在真实接纳对端目录时调用的应用写入器。'
        },
        {
          name: 'namespaces',
          description: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          whenToUse: '本插件生效的精确已安装命名空间名称，不会创建命名空间。',
          defaultValue: '全部已安装命名空间。'
        }
      ],
      scenarios: [
        '真实对端接纳时根据其目录生成 TypeScript 声明，避免另行维护一份方法名称清单。',
        '只为选定的传输命名空间生成声明，将输出交给应用已有的编辑器、文件写入器或审阅缓冲区。'
      ],
      avoidWhen: [
        '不要把生成的声明当成运行时校验、提供方授权或远端方法的实际实现。',
        '不要期待每次后续目录刷新都重新生成文件；该观察器接收真实对端接纳事件，不监听任意元数据变化。'
      ]
    }
  },
  'rpc-host:plugins-link-policy:RpcLinkPolicyName': {
    en: {
      purpose:
        'Stable native plugin identity used by the built-in linkPolicy definition. It is not a transport namespace.',
      quickStart:
        "import { RpcLinkPolicyName } from '@migaia/rpc-host/plugins/link-policy'\nexport const policyName = RpcLinkPolicyName",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '内建链路策略定义使用的稳定原生插件身份，不是传输命名空间。',
      quickStart:
        "import { RpcLinkPolicyName } from '@migaia/rpc-host/plugins/link-policy'\nexport const policyName = RpcLinkPolicyName",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:plugins-probe:RpcProbeDirection': {
    en: {
      purpose:
        'Numeric traffic directions distinguish original outbound, inbound and local observations.',
      quickStart:
        "import { RpcProbeDirection } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeDirection",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '数字流量方向区分原出站、入站及端点本地生命周期观察。',
      quickStart:
        "import { RpcProbeDirection } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeDirection",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:plugins-probe:RpcProbeDirectionName': {
    en: {
      purpose: 'Ordered outbound/inbound/local names correspond to direction ordinals.',
      quickStart:
        "import { RpcProbeDirectionName } from '@migaia/rpc-contract/interfaces'\nconst value = RpcProbeDirectionName",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '有序出站、入站及本地名称对应方向序号。',
      quickStart:
        "import { RpcProbeDirectionName } from '@migaia/rpc-contract/interfaces'\nconst value = RpcProbeDirectionName",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:plugins-probe:RpcProbeKind': {
    en: {
      purpose: 'Numeric interaction kinds identify which original operation an event concerns.',
      quickStart:
        "import { RpcProbeKind } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '数字交互种类标识事件涉及的原始请求、流及控制操作。',
      quickStart:
        "import { RpcProbeKind } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:plugins-probe:RpcProbeKindName': {
    en: {
      purpose: 'Ordered interaction names correspond to numeric probe kinds.',
      quickStart:
        "import { RpcProbeKindName } from '@migaia/rpc-contract/interfaces'\nconst value = RpcProbeKindName",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '有序交互名称对应数字探针种类。',
      quickStart:
        "import { RpcProbeKindName } from '@migaia/rpc-contract/interfaces'\nconst value = RpcProbeKindName",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:plugins-probe:RpcProbeOutcome': {
    en: {
      purpose:
        'Numeric outcomes describe progress, admission and settlement at the observed stage.',
      quickStart:
        "import { RpcProbeOutcome } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeOutcome",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '数字结果描述实际观察阶段中的操作进度、准入及最终结算。',
      quickStart:
        "import { RpcProbeOutcome } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeOutcome",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:plugins-probe:RpcProbeOutcomeName': {
    en: {
      purpose: 'Ordered progress names correspond to numeric probe outcomes.',
      quickStart:
        "import { RpcProbeOutcomeName } from '@migaia/rpc-contract/interfaces'\nconst value = RpcProbeOutcomeName",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '有序进展名称对应数字探针结果。',
      quickStart:
        "import { RpcProbeOutcomeName } from '@migaia/rpc-contract/interfaces'\nconst value = RpcProbeOutcomeName",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:plugins-probe:RpcProbeStage': {
    en: {
      purpose:
        'Stable numeric stages follow one operation from logical ownership to actual physical I/O.',
      quickStart:
        "import { RpcProbeStage } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeStage",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '稳定数字阶段跟随一次操作，从逻辑所有权到实际物理读写。',
      quickStart:
        "import { RpcProbeStage } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeStage",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:plugins-probe:RpcProbeStageName': {
    en: {
      purpose: 'Ordered stage names correspond to numeric RpcProbeStage ordinals.',
      quickStart:
        "import { RpcProbeStageName } from '@migaia/rpc-contract/interfaces'\nconst value = RpcProbeStageName",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '有序阶段名称对应数字探针阶段序号。',
      quickStart:
        "import { RpcProbeStageName } from '@migaia/rpc-contract/interfaces'\nconst value = RpcProbeStageName",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-host:plugins-probe:createProbeEmitter': {
    en: {
      purpose:
        'Create the fixed-stage receiver for actual probe handles. It owns subscriptions, sampling and callback isolation, borrowing observed values without acquiring native read or write resources.',
      quickStart:
        "import { defineProbe, createProbeEmitter } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message'],\n  emit: (view) => console.log({ ...view }),\n})\nconst emitter = createProbeEmitter([observer], () => performance.now(), 'application')\nemitter.dispose()",
      options: [],
      scenarios: [
        'A transport or execution owner already holds the original event and needs to emit it to selected probe stages.',
        'An observation owner must release stage subscriptions when its real connection closes.'
      ],
      avoidWhen: [
        'An application only wants to install observation on a Host; use the probe flow plugin.',
        'An emitter is being used to invent carrier facts or substitute for a native read operation; supply actual facts instead.'
      ]
    },
    zh: {
      purpose:
        '为真实探针句柄创建固定阶段接收者，管理订阅、采样及回调隔离；观察值由原所有者借出，接收者不获取原生读取或写入资源。',
      quickStart:
        "import { defineProbe, createProbeEmitter } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message'],\n  emit: (view) => console.log({ ...view }),\n})\nconst emitter = createProbeEmitter([observer], () => performance.now(), 'application')\nemitter.dispose()",
      options: [],
      scenarios: [
        '传输或执行所有者已持有原始事件，需要将其发给选定的探针阶段。',
        '观察所有者需要在真实连接关闭时释放其阶段订阅。'
      ],
      avoidWhen: [
        '应用只需在宿主安装观察时，应使用 probe 信息流插件。',
        '不能用发射器伪造载体事实或替代原生读取，必须提供实际发生的事实。'
      ]
    }
  },
  'rpc-host:plugins-probe:readProbeStages': {
    en: {
      purpose:
        'Read the current stage mask of a genuine probe handle, including subscriptions attached to the same frozen host object. Structural probes expose only their public stages value.',
      quickStart:
        "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])",
      options: [],
      scenarios: [
        'A native emission owner needs to avoid preparing detail when no selected stage has subscribers.',
        'A mounted probe host changes its subscriptions and the emitter must read the current mask.'
      ],
      avoidWhen: [
        'A stage mask is being treated as permission to execute a provider; it only controls observation.',
        'The caller needs change notifications rather than a current read; use subscribeProbeStages.'
      ]
    },
    zh: {
      purpose:
        '读取真实探针句柄当前的阶段掩码，包括附加到同一冻结宿主对象的订阅；结构探针只提供其公开阶段值，不因此获得私有订阅身份。',
      quickStart:
        "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])",
      options: [],
      scenarios: [
        '原生事件所有者需要在没有订阅阶段时避免准备诊断详情。',
        '已挂载的探针宿主改变订阅后，发射者需要读取其当前阶段掩码。'
      ],
      avoidWhen: [
        '不能将阶段掩码当作执行提供方的权限，它只控制观察。',
        '需要接收掩码变化通知而非读取当前值时，应使用 subscribeProbeStages。'
      ]
    }
  },
  'rpc-host:plugins-probe:rpcProbeSampleKey': {
    en: {
      purpose:
        'Compute a deterministic unsigned sample key from the sender and message identifiers. Both sides can correlate a sampled exchange without creating a new request identity or authentication token.',
      quickStart: "console.log(rpcProbeSampleKey('client', 'message-1'))",
      options: [],
      scenarios: [
        'Probe sampling should keep the send and receive observations of one exchange correlated.',
        'A diagnostic sampler needs a stable numeric key without retaining a per-message lookup table.'
      ],
      avoidWhen: [
        'The value must be collision-free or unpredictable; this sampling hash supplies neither guarantee.',
        'A peer needs authentication or replay protection; use the actual authentication owner.'
      ]
    },
    zh: {
      purpose:
        '根据发送方与消息标识计算确定性的无符号采样键，使两端可以关联同一交换的采样结果；它不创建请求身份，也不是认证令牌。',
      quickStart: "console.log(rpcProbeSampleKey('client', 'message-1'))",
      options: [],
      scenarios: [
        '探针采样需要让一次交换的发送与接收观察保持关联。',
        '诊断采样器需要稳定数值键，而不保留逐消息查找表。'
      ],
      avoidWhen: [
        '需要无碰撞或不可预测标识时，不能依赖该采样散列。',
        '对端需要认证或防重放时，应使用实际认证所有者。'
      ]
    }
  },
  'rpc-host:plugins-probe:subscribeProbeStages': {
    en: {
      purpose:
        'Subscribe a synchronous cold callback to stage-mask changes on a genuine probe. The returned remover releases that exact subscription; structural probes do not gain private stage state.',
      quickStart:
        "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])",
      options: [],
      scenarios: [
        'A mounted emitter must refresh which observation stages have real subscribers.',
        'An observation service needs an exact remover to release its stage callback during close.'
      ],
      avoidWhen: [
        'The listener needs each business or raw event; subscribe to the corresponding probe event instead.',
        'A structural object only declares a stages field; do not expect private subscription notifications from it.'
      ]
    },
    zh: {
      purpose:
        '为真实探针的阶段掩码变化登记同步冷回调，返回的移除函数释放精确订阅；结构探针不会因此取得私有阶段状态或宿主身份。',
      quickStart:
        "import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'\n\nconst observer = defineProbe({\n  stages: ['message', 'peer'],\n  emit: (view) => console.log({ ...view }),\n})\nexport const observation = probe(observer)\nobserver.setStages(['message'])",
      options: [],
      scenarios: [
        '已挂载的发射器需要更新当前具有真实订阅者的观察阶段。',
        '观察服务需要在关闭时用精确移除函数释放阶段回调。'
      ],
      avoidWhen: [
        '需要每个业务或原始事件时，应订阅对应的探针事件，而非阶段变化。',
        '对象仅以结构形式声明 stages 字段时，不能期待它发出私有订阅变化通知。'
      ]
    }
  },
  'rpc-contract:index:ERROR_SOURCE': {
    en: {
      purpose:
        'Canonical diagnostic source rpc.contract; import its matching code table from the same entry.',
      quickStart:
        "import { ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = ERROR_SOURCE",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '规范诊断来源为 rpc.contract，从同一入口导入对应错误码表。',
      quickStart:
        "import { ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = ERROR_SOURCE",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:REMOTE_NAME_PATTERN': {
    en: {
      purpose: 'Bounded ASCII letter-first segment grammar, up to 40 characters.',
      quickStart:
        "import { REMOTE_NAME_PATTERN } from '@migaia/rpc-contract/protocol'\nconst value = REMOTE_NAME_PATTERN",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '有界字母开头段语法，最多四十字符。',
      quickStart:
        "import { REMOTE_NAME_PATTERN } from '@migaia/rpc-contract/protocol'\nconst value = REMOTE_NAME_PATTERN",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RPC_BROWSER_ERROR_SOURCE': {
    en: {
      purpose:
        'Canonical rpc.transport.browser source for Browser-specific source admission and decoding diagnostics. The Browser package re-exports the same value; endpoint transport errors may still retain rpc.endpoint.',
      quickStart:
        "import { RPC_BROWSER_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_BROWSER_ERROR_SOURCE",
      options: [],
      scenarios: [
        'Distinguish a missing Window origin from a later endpoint business failure.',
        'Pair Browser-specific admission codes with their actual diagnostic source.'
      ],
      avoidWhen: [
        'Do not relabel all browser native failures as this family when their source already belongs elsewhere.',
        'Do not use a matching source property as native Window or Client authentication.'
      ]
    },
    zh: {
      purpose:
        '这是浏览器专用来源准入及解码诊断的规范来源 rpc.transport.browser，Browser 包重导出同一值；端点传输错误仍可能保持 rpc.endpoint。',
      quickStart:
        "import { RPC_BROWSER_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_BROWSER_ERROR_SOURCE",
      options: [],
      scenarios: [
        '区分 Window 来源域缺失与后续端点业务失败。',
        '将浏览器专用准入码与其实际诊断来源配对。'
      ],
      avoidWhen: [
        '已有其他所属来源时，不要把所有浏览器原生失败改标为此家族。',
        '不要用来源属性匹配代替原生 Window 或 Client 身份认证。'
      ]
    }
  },
  'rpc-contract:index:RPC_CONTRACT_SOURCE': {
    en: {
      purpose:
        'Canonical rpc.contract diagnostic source also exported with the standalone error tools.',
      quickStart:
        "import { RPC_CONTRACT_SOURCE } from '@migaia/rpc-contract/errors'\nconst value = RPC_CONTRACT_SOURCE",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '独立错误工具同时导出的规范契约诊断来源。',
      quickStart:
        "import { RPC_CONTRACT_SOURCE } from '@migaia/rpc-contract/errors'\nconst value = RPC_CONTRACT_SOURCE",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RPC_COROUTINE_ERROR_SOURCE': {
    en: {
      purpose:
        'Canonical rpc.transport.coroutine source re-exported by the Coroutine package for its own source admission diagnostics. Cooperative execution, endpoint calls and supervision still retain their separate failure owners.',
      quickStart:
        "import { RPC_COROUTINE_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_COROUTINE_ERROR_SOURCE",
      options: [],
      scenarios: [
        'Classify rejection of an invalid task or parent-connect source together with its code.',
        'Keep a coroutine configuration diagnostic distinguishable from task business exceptions.'
      ],
      avoidWhen: [
        'Do not equate this diagnostic string with custody of an opaque parent connection.',
        'Do not overwrite a task or supervision error source simply because the carrier is a coroutine.'
      ]
    },
    zh: {
      purpose:
        '这是 Coroutine 包重导出的规范来源 rpc.transport.coroutine，用于其自有来源准入诊断；协作执行、端点调用与监督仍保持独立失败所有者。',
      quickStart:
        "import { RPC_COROUTINE_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_COROUTINE_ERROR_SOURCE",
      options: [],
      scenarios: [
        '结合错误码分类非法任务或父连接来源的拒绝。',
        '把协程配置诊断与任务业务异常区分。'
      ],
      avoidWhen: [
        '不要把诊断字符串等同于持有不可伪造父连接。',
        '不要仅因载体是协程就覆写任务或监督错误来源。'
      ]
    }
  },
  'rpc-contract:index:RPC_DEVTOOLS_ERROR_SOURCE': {
    en: {
      purpose:
        'Canonical rpc.devtools identifies collector, recording and service-projection diagnostics. Devtools re-exports it as RPC_DEVTOOLS_SOURCE; this naming alias does not change the original source value or create an execution API.',
      quickStart:
        "import { RPC_DEVTOOLS_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_DEVTOOLS_ERROR_SOURCE",
      options: [],
      scenarios: [
        'Separate collector lifecycle rejection from an observed application request failure.',
        'Classify recording or redaction diagnostics without parsing rendered log text.'
      ],
      avoidWhen: [
        'Do not relabel an observed provider Error as a Devtools error; it remains original event data.',
        'Do not use collector diagnostic identity to grant access to captured content.'
      ]
    },
    zh: {
      purpose:
        '规范来源 rpc.devtools 标识收集器、录制与服务投影诊断；Devtools 以 RPC_DEVTOOLS_SOURCE 重导出该值，此命名别名不改变原来源或创建执行 API。',
      quickStart:
        "import { RPC_DEVTOOLS_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_DEVTOOLS_ERROR_SOURCE",
      options: [],
      scenarios: [
        '区分收集器生命周期拒绝与被观察的应用请求失败。',
        '无需解析渲染日志文本即可分类录制或脱敏诊断。'
      ],
      avoidWhen: [
        '不要把观察到的提供方错误改标为 Devtools 错误，它仍是原事件数据。',
        '不要用收集器诊断身份授予捕获内容访问权。'
      ]
    }
  },
  'rpc-contract:index:RPC_ENDPOINT_ERROR_SOURCE': {
    en: {
      purpose:
        'Canonical diagnostic source rpc.endpoint; import its matching code table from the same entry.',
      quickStart:
        "import { RPC_ENDPOINT_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_ENDPOINT_ERROR_SOURCE",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '规范诊断来源为 rpc.endpoint，从同一入口导入对应错误码表。',
      quickStart:
        "import { RPC_ENDPOINT_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_ENDPOINT_ERROR_SOURCE",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RPC_INVALID_DECLARATION_SEGMENT': {
    en: {
      purpose: 'Fixed invalid-key placeholder avoids reflecting malformed declaration names.',
      quickStart:
        "import { RPC_INVALID_DECLARATION_SEGMENT } from '@migaia/rpc-contract/protocol'\nconst value = RPC_INVALID_DECLARATION_SEGMENT",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '固定非法键占位文本，避免反射非法声明名称。',
      quickStart:
        "import { RPC_INVALID_DECLARATION_SEGMENT } from '@migaia/rpc-contract/protocol'\nconst value = RPC_INVALID_DECLARATION_SEGMENT",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RPC_POOL_ERROR_SOURCE': {
    en: {
      purpose:
        'Canonical rpc.pool source identifies failures owned by native pool scheduling. Member transport and provider failures retain their original identities rather than being recoded as pool errors.',
      quickStart:
        "import { RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_POOL_ERROR_SOURCE",
      options: [],
      scenarios: [
        'Distinguish bounded queue admission failure from a selected member business failure.',
        'Pair pool close aggregation with its original pool-owned semantic code.'
      ],
      avoidWhen: [
        'Do not tag every rejected operation with rpc.pool merely because it was routed through a pool.',
        'Do not infer member native generation or physical health from this scheduling source.'
      ]
    },
    zh: {
      purpose:
        '规范来源 rpc.pool 标识原生池调度拥有的失败，成员传输及提供方失败保留原身份，不会统一改码为池错误。',
      quickStart:
        "import { RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_POOL_ERROR_SOURCE",
      options: [],
      scenarios: [
        '区分有界队列准入失败与选中成员业务失败。',
        '将池关闭聚合诊断与其原池语义码配对。'
      ],
      avoidWhen: [
        '不要仅因操作经池路由，就给所有拒绝都附加 rpc.pool。',
        '不要从调度诊断来源推断成员原生代际或物理健康。'
      ]
    }
  },
  'rpc-contract:index:RPC_PORTABLE_MAX_DEPTH': {
    en: {
      purpose: 'Portable recursion depth is bounded at 64 with root depth zero.',
      quickStart:
        "import { RPC_PORTABLE_MAX_DEPTH } from '@migaia/rpc-contract/portable'\nconst value = RPC_PORTABLE_MAX_DEPTH",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '可移植递归深度最多六十四，根深度为零。',
      quickStart:
        "import { RPC_PORTABLE_MAX_DEPTH } from '@migaia/rpc-contract/portable'\nconst value = RPC_PORTABLE_MAX_DEPTH",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RPC_PROCESS_ERROR_SOURCE': {
    en: {
      purpose:
        'Canonical rpc.transport.process diagnostic source exported by Contract and re-exported by the Process package. Pair it with the matching Process code table; Core, native and supervision failures can keep other sources.',
      quickStart:
        "import { RPC_PROCESS_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_PROCESS_ERROR_SOURCE",
      options: [],
      scenarios: [
        'Separate a Process connection admission failure from an endpoint protocol failure.',
        'Preserve the original Process family identity when logging a native connection cause chain.'
      ],
      avoidWhen: [
        'Do not overwrite a foreign source merely because the failing call used a process transport.',
        'Do not interpret a matching source string as proof of trusted native bootstrap ownership.'
      ]
    },
    zh: {
      purpose:
        '这是 Contract 声明、Process 包直接重导出的规范诊断来源 rpc.transport.process，应配合进程错误码表使用；Core、原生及监督失败仍可保持其他来源。',
      quickStart:
        "import { RPC_PROCESS_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_PROCESS_ERROR_SOURCE",
      options: [],
      scenarios: [
        '区分进程连接准入失败与端点协议失败。',
        '记录原生连接原因链时，保留原始进程家族身份。'
      ],
      avoidWhen: [
        '不要仅因调用使用进程传输就覆写外部来源。',
        '不要把来源字符串匹配当作可信原生引导所有权的证明。'
      ]
    }
  },
  'rpc-contract:index:RPC_PROVIDER_DECLARATION_METHOD_MAX_CHARS': {
    en: {
      purpose: 'Bounded full advanced declared method path: 122 characters.',
      quickStart:
        "import { RPC_PROVIDER_DECLARATION_METHOD_MAX_CHARS } from '@migaia/rpc-contract/protocol'\nconst value = RPC_PROVIDER_DECLARATION_METHOD_MAX_CHARS",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '高级声明完整方法路径上限为一百二十二字符。',
      quickStart:
        "import { RPC_PROVIDER_DECLARATION_METHOD_MAX_CHARS } from '@migaia/rpc-contract/protocol'\nconst value = RPC_PROVIDER_DECLARATION_METHOD_MAX_CHARS",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RPC_PROVIDER_DECLARATION_VERSION': {
    en: {
      purpose: 'Local advanced provider declaration schemaVersion is exactly 1.',
      quickStart:
        "import { RPC_PROVIDER_DECLARATION_VERSION } from '@migaia/rpc-contract/protocol'\nconst value = RPC_PROVIDER_DECLARATION_VERSION",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '本地高级提供方声明版本固定为一。',
      quickStart:
        "import { RPC_PROVIDER_DECLARATION_VERSION } from '@migaia/rpc-contract/protocol'\nconst value = RPC_PROVIDER_DECLARATION_VERSION",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RPC_PROVIDER_METHOD_MAX_CHARS': {
    en: {
      purpose: 'Actual provider method identifier ceiling is 100 characters.',
      quickStart:
        "import { RPC_PROVIDER_METHOD_MAX_CHARS } from '@migaia/rpc-contract/protocol'\nconst value = RPC_PROVIDER_METHOD_MAX_CHARS",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '实际提供方方法标识最多一百字符。',
      quickStart:
        "import { RPC_PROVIDER_METHOD_MAX_CHARS } from '@migaia/rpc-contract/protocol'\nconst value = RPC_PROVIDER_METHOD_MAX_CHARS",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RPC_PROVIDER_MODES': {
    en: {
      purpose:
        'Frozen four local declaration modes; accepted wire modes remain a separate vocabulary.',
      quickStart:
        "import { RPC_PROVIDER_MODES } from '@migaia/rpc-contract/protocol'\nconst value = RPC_PROVIDER_MODES",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '冻结的四个本地声明模式，准入线上模式为另一词汇。',
      quickStart:
        "import { RPC_PROVIDER_MODES } from '@migaia/rpc-contract/protocol'\nconst value = RPC_PROVIDER_MODES",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RPC_PROVIDER_RESERVED_NAMESPACE': {
    en: {
      purpose: 'migaia.remote. remains reserved by canonical provider admission.',
      quickStart:
        "import { RPC_PROVIDER_RESERVED_NAMESPACE } from '@migaia/rpc-contract/protocol'\nconst value = RPC_PROVIDER_RESERVED_NAMESPACE",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '规范提供方准入保留 `migaia.remote.` 命名空间。',
      quickStart:
        "import { RPC_PROVIDER_RESERVED_NAMESPACE } from '@migaia/rpc-contract/protocol'\nconst value = RPC_PROVIDER_RESERVED_NAMESPACE",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RPC_REMOTE_ERROR_SOURCE': {
    en: {
      purpose:
        'Canonical diagnostic source rpc.remote; import its matching code table from the same entry.',
      quickStart:
        "import { RPC_REMOTE_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_REMOTE_ERROR_SOURCE",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '规范诊断来源为 rpc.remote，从同一入口导入对应错误码表。',
      quickStart:
        "import { RPC_REMOTE_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_REMOTE_ERROR_SOURCE",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RPC_THREAD_ERROR_SOURCE': {
    en: {
      purpose:
        'Canonical rpc.transport.thread diagnostic source shared by Contract and the Thread public re-export. It identifies Thread-owned diagnostics, not every native Worker, endpoint or supervision failure.',
      quickStart:
        "import { RPC_THREAD_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_THREAD_ERROR_SOURCE",
      options: [],
      scenarios: [
        'Identify a Thread-owned resource query diagnostic alongside its registered code.',
        'Keep usage observation failure separate from the Worker execution lifecycle.'
      ],
      avoidWhen: [
        'Do not tag an existing supervision error with this source to force Thread classification.',
        'Do not infer a current or trusted worker generation from the diagnostic source alone.'
      ]
    },
    zh: {
      purpose:
        '这是 Contract 与 Thread 公开重导出共享的规范诊断来源 rpc.transport.thread，用于线程自有诊断，不代表所有原生 Worker、端点或监督失败。',
      quickStart:
        "import { RPC_THREAD_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'\nconst value = RPC_THREAD_ERROR_SOURCE",
      options: [],
      scenarios: [
        '结合登记码识别线程自有资源查询诊断。',
        '把用量观察失败与 Worker 执行生命周期分开。'
      ],
      avoidWhen: [
        '不要用此来源标记既有监督错误来强制线程分类。',
        '不要仅从诊断来源推断当前或可信工作线程代际。'
      ]
    }
  },
  'rpc-contract:index:RpcAbortError': {
    en: {
      purpose:
        'Cancellation diagnostic uses standard AbortError name and optional original cleanup completion. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcAbortError } from '@migaia/rpc-contract/errors'\nconst error = new RpcAbortError('Operation failed')",
      options: [],
      scenarios: [
        'Represent endpoint cancellation with the standard AbortError name and CANCELLED code.',
        'Retain an optional construction cleanup Promise for a caller that must observe rollback.'
      ],
      avoidWhen: [
        'Do not mistake a constructed diagnostic for an AbortController that can cancel live work.',
        'Use RpcTimeoutError when an actual deadline expires instead of reporting caller cancellation.'
      ]
    },
    zh: {
      purpose: '取消诊断采用标准中止名称及可选原清理完成结果。构造或恢复诊断不授予本地控制权限。',
      quickStart:
        "import { RpcAbortError } from '@migaia/rpc-contract/errors'\nconst error = new RpcAbortError('Operation failed')",
      options: [],
      scenarios: [
        '使用标准 AbortError 名称及 CANCELLED 码表示端点取消诊断。',
        '为需要观察回滚的调用者保留可选构造清理 Promise。'
      ],
      avoidWhen: [
        '构造此诊断不等于取得能取消活跃工作的 AbortController。',
        '实际期限到期应使用 RpcTimeoutError，不应报告为调用者取消。'
      ]
    }
  },
  'rpc-contract:index:RpcAuthenticationError': {
    en: {
      purpose:
        'Protection or verification diagnostic retains the actual failure. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcAuthenticationError } from '@migaia/rpc-contract/errors'\nconst error = new RpcAuthenticationError('Operation failed')",
      options: [],
      scenarios: [
        'Describe a signing or verification failure while retaining the original cryptographic cause.',
        'Expose a protection-layer failure with a distinct family from malformed application payloads.'
      ],
      avoidWhen: [
        'Do not construct this error as evidence that peer credentials were verified.',
        'Use the actual auth flow to protect frames; this class performs no transform.'
      ]
    },
    zh: {
      purpose:
        '表示实际保护或验证操作失败的 AUTHENTICATION_FAILED 诊断，保留原始原因；错误构造本身不会验证凭据或接纳身份。',
      quickStart:
        "import { RpcAuthenticationError } from '@migaia/rpc-contract/errors'\nconst error = new RpcAuthenticationError('Operation failed')",
      options: [],
      scenarios: [
        '描述签名或验证失败，同时保留原始密码操作原因。',
        '用独立家族展示保护层失败，与非法业务载荷区分。'
      ],
      avoidWhen: [
        '不要把构造此错误当作对端凭据已验证的证据。',
        '保护帧应使用实际 auth 信息流，此类不执行转换。'
      ]
    }
  },
  'rpc-contract:index:RpcAuthenticationRejectionReason': {
    en: {
      purpose: 'Actual missing-session or invalid-challenge authentication refusal.',
      quickStart:
        "import { RpcAuthenticationRejectionReason } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcAuthenticationRejectionReason",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '实际缺失会话或非法挑战认证拒绝。',
      quickStart:
        "import { RpcAuthenticationRejectionReason } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcAuthenticationRejectionReason",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcBrowserErrorCode': {
    en: {
      purpose:
        'Canonical Browser-specific values cover required Window origins, reliable RTC admission, source selection, listener ownership and RTC decoding failures. Physical or Core failures can preserve separate native families.',
      quickStart:
        "import { RpcBrowserErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcBrowserErrorCode",
      options: [],
      scenarios: [
        'Handle WINDOW_ORIGIN_REQUIRED before constructing a usable Window transport.',
        'Distinguish an unreliable RTC source from a malformed received RTC message.'
      ],
      avoidWhen: [
        'Do not infer a common retry policy for configuration, listener and decode failures.',
        'Do not replace an original native Error solely to make its code appear in this Browser table.'
      ]
    },
    zh: {
      purpose:
        '规范浏览器专用码涵盖 Window 来源域要求、可靠 RTC 准入、来源选择、监听所有权及 RTC 解码失败；物理或 Core 失败可保持独立原生家族。',
      quickStart:
        "import { RpcBrowserErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcBrowserErrorCode",
      options: [],
      scenarios: [
        '在构造可用 Window 传输前处理来源域必填错误。',
        '区分不可靠 RTC 来源与收到的非法 RTC 消息。'
      ],
      avoidWhen: [
        '不要给配置、监听和解码失败推定同一重试策略。',
        '不要只为让错误码出现在浏览器表中而替换原生错误。'
      ]
    }
  },
  'rpc-contract:index:RpcCallMode': {
    en: {
      purpose:
        'Operation modes preserve distinct request, notify, stream, group and outcome completion boundaries.',
      quickStart:
        "import { RpcCallMode } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcCallMode",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '操作模式保持不同的请求、通知、流、分组及查询完成边界。',
      quickStart:
        "import { RpcCallMode } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcCallMode",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcCarrierFrameKind': {
    en: {
      purpose:
        'Opaque codec messages and negotiated outer extensions do not create another semantic protocol.',
      quickStart:
        "import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcCarrierFrameKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '非透明编解码消息及协商外层扩展不创建另一语义协议。',
      quickStart:
        "import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcCarrierFrameKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcChunkError': {
    en: {
      purpose:
        'Chunk/reassembly diagnostic retains the original rejected input cause. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcChunkError } from '@migaia/rpc-contract/errors'\nconst error = new RpcChunkError('Operation failed')",
      options: [],
      scenarios: [
        'Describe an invalid fragment encountered by an installed chunk implementation.',
        'Keep a reassembly rejection separate from semantic envelope or provider failures.'
      ],
      avoidWhen: [
        'Do not use this constructor instead of checking fragment bounds and sequence.',
        'Do not infer that a whole remote request executed from a chunk failure alone.'
      ]
    },
    zh: {
      purpose:
        '表示分片格式或重组输入被拒绝的 CHUNK_INVALID 诊断，保留原始失败原因；不创建组装缓冲区或驱动分片投递。',
      quickStart:
        "import { RpcChunkError } from '@migaia/rpc-contract/errors'\nconst error = new RpcChunkError('Operation failed')",
      options: [],
      scenarios: ['描述已安装分片实现遇到的非法片段。', '把重组拒绝与语义信封或提供方失败区分。'],
      avoidWhen: [
        '不要用构造诊断代替分片边界与序号检查。',
        '不能仅从分片失败推断完整远端请求已经执行。'
      ]
    }
  },
  'rpc-contract:index:RpcConfigurationError': {
    en: {
      purpose:
        'Invalid configuration diagnostic preserves its original cause. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcConfigurationError } from '@migaia/rpc-contract/errors'\nconst error = new RpcConfigurationError('Operation failed')",
      options: [],
      scenarios: [
        'Report an unsupported configuration after the owning factory validates its fields.',
        'Retain a getter or configuration callback failure on the diagnostic cause chain.'
      ],
      avoidWhen: [
        'Do not create this error to silently replace a foreign coded configuration failure.',
        'Use RpcConstructionError when partial setup also requires ordered rollback details.'
      ]
    },
    zh: {
      purpose:
        '表示配置被拒绝的 INVALID_CONFIG 原生诊断，可保留导致拒绝的原原因；配置获取、快照与具体字段校验仍由调用所有者执行。',
      quickStart:
        "import { RpcConfigurationError } from '@migaia/rpc-contract/errors'\nconst error = new RpcConfigurationError('Operation failed')",
      options: [],
      scenarios: [
        '所属工厂校验字段后，报告不支持的配置。',
        '把配置读取或回调失败保留在诊断原因链上。'
      ],
      avoidWhen: [
        '不要用此错误悄悄替换已有完整外部码的配置失败。',
        '部分安装还需要有序回滚详情时，应使用 RpcConstructionError。'
      ]
    }
  },
  'rpc-contract:index:RpcConstructionError': {
    en: {
      purpose:
        'Partial construction keeps primary cause, ordered cleanup failures and optional pending cleanup. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcConstructionError } from '@migaia/rpc-contract/errors'\nconst error = new RpcConstructionError('Construction failed', new Error('primary'), [])",
      options: [],
      scenarios: [
        'Keep the original construction failure ahead of ordered rollback cleanup failures.',
        'Expose outstanding rollback through cleanupPromise when cleanup has not settled yet.'
      ],
      avoidWhen: [
        'Do not replace the primary cause with the last disposer rejection.',
        'Do not assume constructing this diagnostic runs rollback or awaits its Promise.'
      ]
    },
    zh: {
      purpose: '部分构造保留主原因、有序清理失败及可选待决清理。构造或恢复诊断不授予本地控制权限。',
      quickStart:
        "import { RpcConstructionError } from '@migaia/rpc-contract/errors'\nconst error = new RpcConstructionError('Construction failed', new Error('primary'), [])",
      options: [],
      scenarios: [
        '在有序回滚清理失败之前保留原构造失败。',
        '清理尚未结算时，通过 cleanupPromise 暴露仍在进行的回滚。'
      ],
      avoidWhen: [
        '不要用最后一次释放拒绝替换主要原因。',
        '构造此诊断不会执行回滚，也不会等待其 Promise。'
      ]
    }
  },
  'rpc-contract:index:RpcContractError': {
    en: {
      purpose:
        'Application method-contract diagnostic retains the original cause. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcContractError } from '@migaia/rpc-contract/errors'\nconst error = new RpcContractError('Operation failed')",
      options: [],
      scenarios: [
        'Describe a method contract mismatch at an endpoint application boundary.',
        'Retain the underlying correlation or declaration failure as the original cause.'
      ],
      avoidWhen: [
        'Use createContractError for the rpc.contract parser code domain rather than conflating both contracts.',
        'Do not compile schemas or expose providers by constructing this diagnostic.'
      ]
    },
    zh: {
      purpose:
        '表示应用方法声明或关联关系被拒绝的 CONTRACT_INVALID 诊断，保留原原因；不同于 rpc.contract 纯协议校验工厂所选择的码域。',
      quickStart:
        "import { RpcContractError } from '@migaia/rpc-contract/errors'\nconst error = new RpcContractError('Operation failed')",
      options: [],
      scenarios: ['在端点应用边界描述方法契约不匹配。', '把底层关联或声明失败保留为原始原因。'],
      avoidWhen: [
        'rpc.contract 解析器码域应使用 createContractError，不能混同两种契约。',
        '构造此诊断不会编译数据模式或发布提供方。'
      ]
    }
  },
  'rpc-contract:index:RpcContractErrorCode': {
    en: {
      purpose: 'Stable semantic codes owned by the runtime-neutral contract package.',
      quickStart:
        "import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcContractErrorCode",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '运行时中立契约包拥有的稳定语义错误码。',
      quickStart:
        "import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcContractErrorCode",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcCoreErrorCode': {
    en: {
      purpose: 'Stable semantic failure codes owned by the runtime-neutral Core execution layer.',
      quickStart:
        "import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcCoreErrorCode",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '运行时中立核心执行层拥有的稳定语义失败码。',
      quickStart:
        "import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcCoreErrorCode",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcCoreErrorText': {
    en: {
      purpose:
        'Canonical RpcCoreErrorText literal messages and text factories. Diagnostic wording is retained even for historical fields; the table neither constructs a Session nor restores retired configuration or protocol entry points.',
      quickStart:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.callbackFailed",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose:
        '规范 `RpcCoreErrorText` 字面消息及文本工厂。历史字段仍保留诊断措辞，此表不构造会话，也不恢复已退役配置或协议入口。',
      quickStart:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.callbackFailed",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcCoroutineErrorCode': {
    en: {
      purpose:
        'Canonical coroutine source admission currently uses COROUTINE_SOURCE_INVALID. The native TypeError carries this diagnostic when no single callable task or genuine parent connection can be selected before acquisition.',
      quickStart:
        "import { RpcCoroutineErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcCoroutineErrorCode",
      options: [],
      scenarios: [
        'Reject configurations that supply both spawn and connectToParent or neither source.',
        'Reject a copied parent token instead of creating native task custody from structural fields.'
      ],
      avoidWhen: [
        'Do not use the diagnostic code itself as proof that a different connect token is genuine.',
        'Do not treat this admission table as the code domain of errors thrown by task business methods.'
      ]
    },
    zh: {
      purpose:
        '协程来源准入当前使用规范码 COROUTINE_SOURCE_INVALID，在获取前无法选择唯一可调用任务或真实父连接时，由原生 TypeError 携带此诊断。',
      quickStart:
        "import { RpcCoroutineErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcCoroutineErrorCode",
      options: [],
      scenarios: [
        '拒绝同时提供 spawn 与 connectToParent，或未提供任何来源的配置。',
        '拒绝复制的父连接令牌，不从结构字段创建原生任务持有权。'
      ],
      avoidWhen: [
        '不要用诊断码本身证明另一个连接令牌真实。',
        '不要把来源准入表当作任务业务方法抛出错误的码域。'
      ]
    }
  },
  'rpc-contract:index:RpcDevtoolsErrorCode': {
    en: {
      purpose:
        'Canonical Devtools values describe invalid options, closed collectors, recording transitions, record format and redaction/service projection failure. They classify collector behavior independently from the RPC calls being observed.',
      quickStart:
        "import { RpcDevtoolsErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcDevtoolsErrorCode",
      options: [],
      scenarios: [
        'Handle RECORD_ACTIVE or RECORD_NOT_ACTIVE according to the actual recording lifetime.',
        'Reject malformed imported records while retaining the original format parsing cause.'
      ],
      avoidWhen: [
        'Do not suppress the original redaction failure by returning unredacted captured content.',
        'Do not treat these codes as a provider result vocabulary or as native transport failure codes.'
      ]
    },
    zh: {
      purpose:
        '规范 Devtools 码描述非法选项、收集器关闭、录制转换、记录格式及脱敏或服务投影失败，用于独立分类收集器行为，不代替被观察 RPC 调用的错误。',
      quickStart:
        "import { RpcDevtoolsErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcDevtoolsErrorCode",
      options: [],
      scenarios: [
        '按实际录制生命周期处理录制已活动或未活动状态。',
        '拒绝非法导入记录，同时保留原格式解析原因。'
      ],
      avoidWhen: [
        '不要通过返回未脱敏捕获内容来掩盖原脱敏失败。',
        '不要把这些码当作提供方结果词汇或原生传输失败码。'
      ]
    }
  },
  'rpc-contract:index:RpcEnvelopeViolation': {
    en: {
      purpose: 'First-envelope failure categories used in coded diagnostics.',
      quickStart:
        "import { RpcEnvelopeViolation } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcEnvelopeViolation",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '编码诊断使用的首个信封失败类别。',
      quickStart:
        "import { RpcEnvelopeViolation } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcEnvelopeViolation",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcError': {
    en: {
      purpose:
        'Endpoint base diagnostic with explicit core code and original cause. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcError } from '@migaia/rpc-contract/errors'\nimport { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'\nconst error = new RpcError(RpcCoreErrorCode.internal, 'Operation failed')",
      options: [],
      scenarios: [
        'Represent an endpoint failure whose semantic Core code is selected by the actual owner.',
        'Preserve an original thrown value on cause while presenting a stable diagnostic family.'
      ],
      avoidWhen: [
        'Use tagRpcError when an existing native subtype must retain exact object identity.',
        'Use RpcRemoteError for arbitrary remote application codes outside the Core union.'
      ]
    },
    zh: {
      purpose:
        '带显式核心码、消息及原始原因的端点基础 Error 诊断，保留原生堆栈；它描述失败，不承担调用取消、重试或清理控制。',
      quickStart:
        "import { RpcError } from '@migaia/rpc-contract/errors'\nimport { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'\nconst error = new RpcError(RpcCoreErrorCode.internal, 'Operation failed')",
      options: [],
      scenarios: [
        '表示由实际所有者选择语义 Core 码的端点失败。',
        '展示稳定诊断家族的同时，把原抛出值保留在 cause 上。'
      ],
      avoidWhen: [
        '既有原生子类型必须保持精确对象身份时，应使用 tagRpcError。',
        'Core 联合之外的任意远端应用码应使用 RpcRemoteError。'
      ]
    }
  },
  'rpc-contract:index:RpcErrorFamily': {
    en: {
      purpose: 'Stable native Error.name families are diagnostics, not local operation authority.',
      quickStart:
        "import { RpcErrorFamily } from '@migaia/rpc-contract/errors'\n\nconst values = RpcErrorFamily",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '稳定原生错误名称家族是诊断，不是本地操作权限。',
      quickStart:
        "import { RpcErrorFamily } from '@migaia/rpc-contract/errors'\n\nconst values = RpcErrorFamily",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcErrorReachLimit': {
    en: {
      purpose:
        'Bound on visiting original JavaScript error graph objects, separate from wire node limits.',
      quickStart:
        "import { RpcErrorReachLimit } from '@migaia/rpc-contract/errors'\n\nconst values = RpcErrorReachLimit",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '原始脚本错误图访问边界，与线上节点限制分开。',
      quickStart:
        "import { RpcErrorReachLimit } from '@migaia/rpc-contract/errors'\n\nconst values = RpcErrorReachLimit",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcHandshakeViolation': {
    en: {
      purpose: 'First malformed handshake boundary without exposing authentication material.',
      quickStart:
        "import { RpcHandshakeViolation } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcHandshakeViolation",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '不暴露认证材料的首个异常握手边界。',
      quickStart:
        "import { RpcHandshakeViolation } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcHandshakeViolation",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcJsonRpcWireError': {
    en: {
      purpose:
        'Retained diagnostic extension/source vocabulary; no JSON-RPC parser or mapping operation is exported.',
      quickStart:
        "import { RpcJsonRpcWireError } from '@migaia/rpc-contract/errors'\n\nconst values = RpcJsonRpcWireError",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '保留诊断扩展及来源词汇，不导出旧协议解析器或映射操作。',
      quickStart:
        "import { RpcJsonRpcWireError } from '@migaia/rpc-contract/errors'\n\nconst values = RpcJsonRpcWireError",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcPoolErrorCode': {
    en: {
      purpose:
        'Canonical pool-owned values identify invalid options, unsupported sources, closed admission, full FIFO, queued cancellation and member cleanup aggregation. Original member failures remain on their own native chains.',
      quickStart:
        "import { RpcPoolErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcPoolErrorCode",
      options: [],
      scenarios: [
        'Handle QUEUE_FULL without claiming the rejected call reached a native member.',
        'Observe CLOSE_FAILED AggregateError causes after all original member cleanup attempts.'
      ],
      avoidWhen: [
        'Do not interpret POOL_CLOSED as a recoverable member restart event.',
        'Do not use one pool code to discard original transport, provider or queued-abort causes.'
      ]
    },
    zh: {
      purpose:
        '规范池码标识非法选项、不支持来源、关闭准入、队列已满、排队取消及成员清理聚合，原成员失败仍保留在各自原生原因链。',
      quickStart:
        "import { RpcPoolErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcPoolErrorCode",
      options: [],
      scenarios: [
        '处理 QUEUE_FULL 时不声称被拒调用已经到达原生成员。',
        '所有原成员清理均已尝试后，观察 CLOSE_FAILED 聚合错误原因。'
      ],
      avoidWhen: [
        '不要把 POOL_CLOSED 解释为可恢复成员重启事件。',
        '不要用单个池码丢弃原传输、提供方或排队中止原因。'
      ]
    }
  },
  'rpc-contract:index:RpcProcessErrorCode': {
    en: {
      purpose:
        'Canonical Process-family semantic values for connection admission, native lifecycle and resource diagnostics. The Process entry re-exports this same table; endpoint or supervision errors retain their own code domains.',
      quickStart:
        "import { RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcProcessErrorCode",
      options: [],
      scenarios: [
        'Branch on a registered Process connect or listener failure while retaining its original cause.',
        'Recognize PROCESS_USAGE_SAMPLE_FAILED as unavailable resource sampling rather than request failure.'
      ],
      avoidWhen: [
        'Do not assume every failure crossing a Process namespace uses this table.',
        'Do not collapse different Process codes into a retry decision without their actual native policy facts.'
      ]
    },
    zh: {
      purpose:
        '这是进程家族连接准入、原生生命周期及资源诊断的规范语义值表，Process 入口重导出同一对象；端点或监督错误保留各自码域。',
      quickStart:
        "import { RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcProcessErrorCode",
      options: [],
      scenarios: [
        '按已登记进程连接或监听失败分支，同时保留原始原因。',
        '把进程资源采样失败识别为采样不可用，而非请求失败。'
      ],
      avoidWhen: [
        '不要假设经过进程命名空间的每个失败都使用此表。',
        '没有实际原生策略事实时，不要把不同进程码直接归为重试决定。'
      ]
    }
  },
  'rpc-contract:index:RpcProtocolError': {
    en: {
      purpose:
        'Semantic protocol diagnostic preserves its original parser cause. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcProtocolError } from '@migaia/rpc-contract/errors'\nconst error = new RpcProtocolError('Operation failed')",
      options: [],
      scenarios: [
        'Keep a semantic interpretation failure distinguishable from a physical carrier error.',
        'Preserve the original parser failure when an endpoint needs a protocol-level diagnostic.'
      ],
      avoidWhen: [
        'Do not use the error family to select an unnegotiated protocol or codec.',
        'Use a transport diagnostic for actual native IO failure rather than misclassifying it as grammar.'
      ]
    },
    zh: {
      purpose:
        '表示语义协议或信封解释失败的 PROTOCOL_INVALID 诊断，可保留原解析原因；它不执行编解码器，也不决定会话是否退场。',
      quickStart:
        "import { RpcProtocolError } from '@migaia/rpc-contract/errors'\nconst error = new RpcProtocolError('Operation failed')",
      options: [],
      scenarios: ['把语义解释失败与物理载体错误区分。', '端点需要协议层诊断时保留原始解析失败。'],
      avoidWhen: [
        '不要根据错误家族选择未协商的协议或编解码器。',
        '实际原生 IO 失败应使用传输诊断，不应误归为语法失败。'
      ]
    }
  },
  'rpc-contract:index:RpcProviderDeclarationLimit': {
    en: {
      purpose: 'Bounded local catalogs prevent unbounded description retention before compilation.',
      quickStart:
        "import { RpcProviderDeclarationLimit } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcProviderDeclarationLimit",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '有界本地目录防止编译前保留无界描述。',
      quickStart:
        "import { RpcProviderDeclarationLimit } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcProviderDeclarationLimit",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcProviderMode': {
    en: {
      purpose:
        'Explicit local declaration modes differ from the wire request/notify/stream vocabulary.',
      quickStart:
        "import { RpcProviderMode } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcProviderMode",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '显式本地声明模式与线上请求、通知及流词汇区分。',
      quickStart:
        "import { RpcProviderMode } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcProviderMode",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcProviderRejectionReason': {
    en: {
      purpose:
        'Actual local provider refusal branches sharing the public overload/capacity failure channel.',
      quickStart:
        "import { RpcProviderRejectionReason } from '@migaia/rpc-contract/errors'\n\nconst values = RpcProviderRejectionReason",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '共享公开过载容量失败通道的实际本地提供方拒绝分支。',
      quickStart:
        "import { RpcProviderRejectionReason } from '@migaia/rpc-contract/errors'\n\nconst values = RpcProviderRejectionReason",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcRemoteError': {
    en: {
      purpose:
        'Separate native Error subclass carries arbitrary remote string codes; it is not a RpcError subclass. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcRemoteError } from '@migaia/rpc-contract/errors'\nconst error = new RpcRemoteError('DECLINED', 'Operation declined')",
      options: [],
      scenarios: [
        'Carry an application-defined remote string code and optional remote detail.',
        'Keep the remote failure chain available separately from the local RpcError hierarchy.'
      ],
      avoidWhen: [
        'Do not restrict remote codes to RpcCoreErrorCode or treat every remote code as local policy.',
        'Do not rebuild a directly restored native provider error merely to force this family.'
      ]
    },
    zh: {
      purpose:
        '独立原生错误子类携带任意远端字符串码，不是基础远程调用错误的子类。构造或恢复诊断不授予本地控制权限。',
      quickStart:
        "import { RpcRemoteError } from '@migaia/rpc-contract/errors'\nconst error = new RpcRemoteError('DECLINED', 'Operation declined')",
      options: [],
      scenarios: [
        '携带应用定义的远端字符串码及可选远端详情。',
        '在本地 RpcError 继承体系之外保留远端失败原因链。'
      ],
      avoidWhen: [
        '不要把远端码限制为 RpcCoreErrorCode，也不要将其直接用作本地策略。',
        '不要为了强制归入此家族而重建已直接恢复的原生提供方错误。'
      ]
    }
  },
  'rpc-contract:index:RpcRemoteLayerErrorCode': {
    en: {
      purpose: 'Stable remote-layer errors and caller recovery actions.',
      quickStart:
        "import { RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcRemoteLayerErrorCode",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '稳定的远程层错误及调用方恢复方式，区分契约错误、未接纳与结果未知。',
      quickStart:
        "import { RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcRemoteLayerErrorCode",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcRuntimeOutcomeState': {
    en: {
      purpose: 'Read-only lookup facts never guess whether business execution occurred.',
      quickStart:
        "import { RpcRuntimeOutcomeState } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcRuntimeOutcomeState",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '只读查询事实不猜测业务是否实际执行。',
      quickStart:
        "import { RpcRuntimeOutcomeState } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcRuntimeOutcomeState",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcRuntimeStoreContinuity': {
    en: {
      purpose: 'Continuity is issued by the real store owner, never inferred from key expiry.',
      quickStart:
        "import { RpcRuntimeStoreContinuity } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcRuntimeStoreContinuity",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '连续性由实际存储所有者签发，不由键过期推断。',
      quickStart:
        "import { RpcRuntimeStoreContinuity } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcRuntimeStoreContinuity",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcRuntimeStoreKind': {
    en: {
      purpose: 'Original final-provider store owner and its availability.',
      quickStart:
        "import { RpcRuntimeStoreKind } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcRuntimeStoreKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '原始最终提供方存储所有者及可用性。',
      quickStart:
        "import { RpcRuntimeStoreKind } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcRuntimeStoreKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcSchemaValidationError': {
    en: {
      purpose:
        'Schema failure preserves validation detail and original cause. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcSchemaValidationError } from '@migaia/rpc-contract/errors'\nconst error = new RpcSchemaValidationError('Input rejected', { field: 'amount' })",
      options: [],
      scenarios: [
        'Present argument validation details produced by the actual schema checker.',
        'Retain the validator failure on cause while exposing its structured data.'
      ],
      avoidWhen: [
        'Do not assume the constructor validates an input value against a schema.',
        'Do not substitute this endpoint diagnostic for a malformed schema declaration error.'
      ]
    },
    zh: {
      purpose:
        '表示声明模式校验失败的 SCHEMA_INVALID 诊断，把具体校验详情保存在 data 并保留原始原因；实际验证仍由模式能力执行。',
      quickStart:
        "import { RpcSchemaValidationError } from '@migaia/rpc-contract/errors'\nconst error = new RpcSchemaValidationError('Input rejected', { field: 'amount' })",
      options: [],
      scenarios: [
        '展示实际模式检查器产生的参数校验详情。',
        '展示结构化 data 的同时，把验证器失败保留在 cause 上。'
      ],
      avoidWhen: [
        '构造函数不会根据模式验证输入值。',
        '不要用此端点诊断替代模式声明本身非法的错误。'
      ]
    }
  },
  'rpc-contract:index:RpcSerializationError': {
    en: {
      purpose:
        'Payload/serialization diagnostic keeps the original failure. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcSerializationError } from '@migaia/rpc-contract/errors'\nconst error = new RpcSerializationError('Operation failed')",
      options: [],
      scenarios: [
        'Describe failure to project an application payload into the supported portable domain.',
        'Keep the original encoder failure reachable while returning an endpoint diagnostic.'
      ],
      avoidWhen: [
        'Do not claim data was encoded successfully merely because this class can be constructed.',
        'Use a protocol error for an invalid received envelope rather than a local payload conversion failure.'
      ]
    },
    zh: {
      purpose:
        '表示载荷转换或序列化失败的 PAYLOAD_INVALID 诊断，保留原始转换原因；不会复制业务图、编码数据或选择物理传输格式。',
      quickStart:
        "import { RpcSerializationError } from '@migaia/rpc-contract/errors'\nconst error = new RpcSerializationError('Operation failed')",
      options: [],
      scenarios: [
        '描述应用载荷无法投影到受支持可移植值域的失败。',
        '返回端点诊断时保持原编码器失败可追溯。'
      ],
      avoidWhen: [
        '能够构造此类不表示数据已经成功编码。',
        '收到的信封非法应按协议错误处理，与本地载荷转换失败区分。'
      ]
    }
  },
  'rpc-contract:index:RpcShapeReason': {
    en: {
      purpose:
        'Bounded declaration/directory diagnostics; historical labels enable no retired profile.',
      quickStart:
        "import { RpcShapeReason } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcShapeReason",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '有界声明及目录诊断，历史标签不启用退役协议。',
      quickStart:
        "import { RpcShapeReason } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcShapeReason",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcStreamEvent': {
    en: {
      purpose: 'Seven protocol stream events; the stream owner checks direction and held sequence.',
      quickStart:
        "import { RpcStreamEvent } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcStreamEvent",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '七种协议流事件，由流所有者检查方向和已有序号。',
      quickStart:
        "import { RpcStreamEvent } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcStreamEvent",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcStreamLimit': {
    en: {
      purpose: 'Portable item and per-peer stream admission ceilings.',
      quickStart:
        "import { RpcStreamLimit } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcStreamLimit",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '可移植条目及每对端流准入的上限。',
      quickStart:
        "import { RpcStreamLimit } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcStreamLimit",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcStreamViolation': {
    en: {
      purpose: 'Stable first-failure categories for stream payload and credit checks.',
      quickStart:
        "import { RpcStreamViolation } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcStreamViolation",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '流载荷及额度检查使用的稳定首失败类别。',
      quickStart:
        "import { RpcStreamViolation } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcStreamViolation",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcThreadErrorCode': {
    en: {
      purpose:
        'The canonical Thread-owned table currently contains THREAD_USAGE_SAMPLE_FAILED for native Worker usage sampling. RPC and supervision failures use their existing families rather than being folded into this table.',
      quickStart:
        "import { RpcThreadErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcThreadErrorCode",
      options: [],
      scenarios: [
        'Display unavailable usage when the native Worker sampling operation fails.',
        'Log the original sampling cause without marking the business provider unhealthy.'
      ],
      avoidWhen: [
        'Do not treat this table as a complete list of all errors possible through threadPlugin.',
        'Do not restart a worker merely because cold resource sampling reported this code.'
      ]
    },
    zh: {
      purpose:
        '规范线程自有码表当前包含原生 Worker 用量采样失败 THREAD_USAGE_SAMPLE_FAILED；RPC 与监督失败使用已有家族，不会并入此表。',
      quickStart:
        "import { RpcThreadErrorCode } from '@migaia/rpc-contract/error-code'\n\nconst values = RpcThreadErrorCode",
      options: [],
      scenarios: [
        '原生 Worker 采样操作失败时展示用量不可用。',
        '记录原始采样原因，不因此把业务提供方标记为不健康。'
      ],
      avoidWhen: [
        '不要把此表当作 threadPlugin 所有可能错误的完整清单。',
        '不要仅因资源采样报告此码就重启工作线程。'
      ]
    }
  },
  'rpc-contract:index:RpcTimeoutError': {
    en: {
      purpose:
        'Deadline diagnostic uses standard TimeoutError name and optional original cleanup completion. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcTimeoutError } from '@migaia/rpc-contract/errors'\nconst error = new RpcTimeoutError('Operation failed')",
      options: [],
      scenarios: [
        'Represent a real endpoint deadline expiry with TimeoutError and DEADLINE_EXCEEDED.',
        'Expose optional pending construction cleanup without hiding the deadline diagnostic.'
      ],
      avoidWhen: [
        'Do not use this diagnostic constructor to start or reset a timeout timer.',
        'Use RpcAbortError for caller-driven cancellation instead of relabeling it as timeout.'
      ]
    },
    zh: {
      purpose: '期限诊断采用标准超时名称及可选原清理完成结果。构造或恢复诊断不授予本地控制权限。',
      quickStart:
        "import { RpcTimeoutError } from '@migaia/rpc-contract/errors'\nconst error = new RpcTimeoutError('Operation failed')",
      options: [],
      scenarios: [
        '用 TimeoutError 及 DEADLINE_EXCEEDED 表示实际端点期限到期。',
        '暴露可选待完成构造清理，同时保留期限诊断。'
      ],
      avoidWhen: [
        '不要用此诊断构造函数启动或重置超时计时器。',
        '调用者主动取消应使用 RpcAbortError，不应改称超时。'
      ]
    }
  },
  'rpc-contract:index:RpcTransportError': {
    en: {
      purpose:
        'Physical transport diagnostic does not itself prove whether remote work ran. Constructing or restoring it grants no local control authority.',
      quickStart:
        "import { RpcTransportError } from '@migaia/rpc-contract/errors'\nconst error = new RpcTransportError('Operation failed')",
      options: [],
      scenarios: [
        'Describe a carrier IO failure without losing the original native cause.',
        'Distinguish the physical boundary from malformed protocol or application result failures.'
      ],
      avoidWhen: [
        'Do not infer nonexecution or safe replay from a transport error alone.',
        'Preserve an existing native error identity when the boundary contract requires pass-through tagging.'
      ]
    },
    zh: {
      purpose:
        '表示实际物理传输失败的 TRANSPORT 诊断，保留原始 IO 原因；错误本身不证明远端是否执行，也不授予重放非幂等操作的权限。',
      quickStart:
        "import { RpcTransportError } from '@migaia/rpc-contract/errors'\nconst error = new RpcTransportError('Operation failed')",
      options: [],
      scenarios: ['描述载体 IO 失败，同时保留原生原因。', '区分物理边界与协议非法或应用结果失败。'],
      avoidWhen: [
        '不要仅凭传输错误推断未执行或可以安全重放。',
        '边界契约要求附码直通时，应保留既有原生错误身份。'
      ]
    }
  },
  'rpc-contract:index:RpcWireBinaryProfile': {
    en: {
      purpose: 'Fixed portable-binary representation revision, not a second RPC protocol.',
      quickStart:
        "import { RpcWireBinaryProfile } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireBinaryProfile",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '固定可移植二进制表示版本，不是第二套远程调用协议。',
      quickStart:
        "import { RpcWireBinaryProfile } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireBinaryProfile",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireBinaryStorage': {
    en: {
      purpose:
        'Actual carrier support selects inline or native backing representation, independently of caller transfer permission.',
      quickStart:
        "import { RpcWireBinaryStorage } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireBinaryStorage",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '实际载体支持选择内联或原生背板表示，与调用方转移权限分开。',
      quickStart:
        "import { RpcWireBinaryStorage } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireBinaryStorage",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireCancel': {
    en: {
      purpose: 'The only before-start cancellation scope literal.',
      quickStart:
        "import { RpcWireCancel } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireCancel",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '唯一启动前取消范围字面值。',
      quickStart:
        "import { RpcWireCancel } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireCancel",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireCodecPattern': {
    en: {
      purpose:
        'Codec ids begin lowercase and have at most 32 lowercase/digit/dot/hyphen characters.',
      quickStart:
        "import { RpcWireCodecPattern } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireCodecPattern",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '编解码身份小写开头，最多三十二个小写、数字、点或连字符。',
      quickStart:
        "import { RpcWireCodecPattern } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireCodecPattern",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireControlOperation': {
    en: {
      purpose: 'Host health and drain controls carry route/id without a provider task.',
      quickStart:
        "import { RpcWireControlOperation } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireControlOperation",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '宿主健康及排空控制携带路由及标识，不含提供方任务。',
      quickStart:
        "import { RpcWireControlOperation } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireControlOperation",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireDirectoryVersion': {
    en: {
      purpose: 'Accepted wire directory schemaVersion is exactly 3.',
      quickStart:
        "import { RpcWireDirectoryVersion } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireDirectoryVersion",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '准入线上目录版本固定为三。',
      quickStart:
        "import { RpcWireDirectoryVersion } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireDirectoryVersion",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireErrorFallback': {
    en: {
      purpose: 'Stable projection for thrown values without complete semantic error identity.',
      quickStart:
        "import { RpcWireErrorFallback } from '@migaia/rpc-contract/errors'\n\nconst values = RpcWireErrorFallback",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '没有完整语义错误身份的抛出值所用稳定投影。',
      quickStart:
        "import { RpcWireErrorFallback } from '@migaia/rpc-contract/errors'\n\nconst values = RpcWireErrorFallback",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireErrorField': {
    en: {
      purpose:
        'Ordered serialized error-tree field names preserve first-failure read/validation order.',
      quickStart:
        "import { RpcWireErrorField } from '@migaia/rpc-contract/errors'\nconst value = RpcWireErrorField",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '有序序列化错误树字段名保持首个失败读取及校验顺序。',
      quickStart:
        "import { RpcWireErrorField } from '@migaia/rpc-contract/errors'\nconst value = RpcWireErrorField",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireErrorLimit': {
    en: {
      purpose: 'Shared serializer and validator limits for bounded cross-realm error graphs.',
      quickStart:
        "import { RpcWireErrorLimit } from '@migaia/rpc-contract/errors'\n\nconst values = RpcWireErrorLimit",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '跨域有界错误图的共享序列化及校验限制。',
      quickStart:
        "import { RpcWireErrorLimit } from '@migaia/rpc-contract/errors'\n\nconst values = RpcWireErrorLimit",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireErrorUnknownFieldMode': {
    en: {
      purpose: 'Received error-node policy for fields added by another peer version.',
      quickStart:
        "import { RpcWireErrorUnknownFieldMode } from '@migaia/rpc-contract/errors'\n\nconst values = RpcWireErrorUnknownFieldMode",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '接收错误节点时处理其他版本新增字段的策略。',
      quickStart:
        "import { RpcWireErrorUnknownFieldMode } from '@migaia/rpc-contract/errors'\n\nconst values = RpcWireErrorUnknownFieldMode",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireErrorViolation': {
    en: {
      purpose: 'Stable first-failure classifications for serialized error validation.',
      quickStart:
        "import { RpcWireErrorViolation } from '@migaia/rpc-contract/errors'\n\nconst values = RpcWireErrorViolation",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '序列化错误校验所用的稳定首失败分类。',
      quickStart:
        "import { RpcWireErrorViolation } from '@migaia/rpc-contract/errors'\n\nconst values = RpcWireErrorViolation",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireExtensionPattern': {
    en: {
      purpose: 'Lowercase versioned extension grammar name@positive-version.',
      quickStart:
        "import { RpcWireExtensionPattern } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireExtensionPattern",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '小写名称加正整数版本的扩展语法。',
      quickStart:
        "import { RpcWireExtensionPattern } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireExtensionPattern",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireField': {
    en: {
      purpose: 'Closed-shape field names are vocabulary; a listed key is not valid on every frame.',
      quickStart:
        "import { RpcWireField } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireField",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '闭合形态字段名仅为词汇，列出某键不表示每帧都允许它。',
      quickStart:
        "import { RpcWireField } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireField",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireHandshakeStep': {
    en: {
      purpose:
        'Actual offer, selected agreement and classified rejection share one handshake grammar.',
      quickStart:
        "import { RpcWireHandshakeStep } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireHandshakeStep",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '实际提议、选定协议及分类拒绝共用一套握手语法。',
      quickStart:
        "import { RpcWireHandshakeStep } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireHandshakeStep",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireJsonCodec': {
    en: {
      purpose: 'Mandatory actual json startup codec identifier.',
      quickStart:
        "import { RpcWireJsonCodec } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireJsonCodec",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '必需实际文本对象启动编解码身份。',
      quickStart:
        "import { RpcWireJsonCodec } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireJsonCodec",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireKind': {
    en: {
      purpose: 'Closed semantic frame kinds select the only admitted protocol grammar.',
      quickStart:
        "import { RpcWireKind } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '闭合语义帧种类选择唯一准入协议语法。',
      quickStart:
        "import { RpcWireKind } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireLimit': {
    en: {
      purpose: 'Admission bounds for untrusted identifiers, offers and durations.',
      quickStart:
        "import { RpcWireLimit } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireLimit",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '未可信标识、提议和时长的准入边界。',
      quickStart:
        "import { RpcWireLimit } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireLimit",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWirePointer': {
    en: {
      purpose: 'Canonical JSON-pointer roots identify the first pure validation failure.',
      quickStart:
        "import { RpcWirePointer } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWirePointer",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '规范数据指针根标识首个纯校验失败。',
      quickStart:
        "import { RpcWirePointer } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWirePointer",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireProfile': {
    en: {
      purpose: 'Fixed migaia.rpc/2 profile for the only semantic grammar.',
      quickStart:
        "import { RpcWireProfile } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireProfile",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '唯一语义语法固定标识为 `migaia.rpc/2`。',
      quickStart:
        "import { RpcWireProfile } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireProfile",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireStepState': {
    en: {
      purpose: 'Ordered group outcomes retain first failure and unexecuted suffix.',
      quickStart:
        "import { RpcWireStepState } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireStepState",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '有序分组结果保留首个失败及未执行后缀。',
      quickStart:
        "import { RpcWireStepState } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireStepState",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireStreamFinish': {
    en: {
      purpose: 'Actual finish-without-items event intent; not cancellation of a new task.',
      quickStart:
        "import { RpcWireStreamFinish } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireStreamFinish",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '实际无项目结束事件意图，不是取消新任务。',
      quickStart:
        "import { RpcWireStreamFinish } from '@migaia/rpc-contract/protocol'\nconst value = RpcWireStreamFinish",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RpcWireVersion': {
    en: {
      purpose: 'Single semantic version 2.0; no older profile fallback.',
      quickStart:
        "import { RpcWireVersion } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireVersion",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '唯一语义版本为二点零，不回退旧协议。',
      quickStart:
        "import { RpcWireVersion } from '@migaia/rpc-contract/protocol'\n\nconst values = RpcWireVersion",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RuntimeApiErrorText': {
    en: {
      purpose:
        'Canonical RuntimeApiErrorText literal messages and text factories. Diagnostic wording is retained even for historical fields; the table neither constructs a Session nor restores retired configuration or protocol entry points.',
      quickStart:
        "import { RuntimeApiErrorText } from '@migaia/rpc-contract/errors'\nconst message = RuntimeApiErrorText.defaultTimeoutInvalid",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose:
        '规范 `RuntimeApiErrorText` 字面消息及文本工厂。历史字段仍保留诊断措辞，此表不构造会话，也不恢复已退役配置或协议入口。',
      quickStart:
        "import { RuntimeApiErrorText } from '@migaia/rpc-contract/errors'\nconst message = RuntimeApiErrorText.defaultTimeoutInvalid",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RuntimeApiMode': {
    en: {
      purpose: 'Actual installed V2 runtime call routes.',
      quickStart:
        "import { RuntimeApiMode } from '@migaia/rpc-contract/protocol'\n\nconst values = RuntimeApiMode",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '第二版运行时实际安装的调用路由模式，由真实安装能力确定可用操作。',
      quickStart:
        "import { RuntimeApiMode } from '@migaia/rpc-contract/protocol'\n\nconst values = RuntimeApiMode",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:RuntimeApiModeSource': {
    en: {
      purpose:
        'Method metadata records whether actual modes were declared or generated from routes.',
      quickStart:
        "import { RuntimeApiModeSource } from '@migaia/rpc-contract/protocol'\n\nconst values = RuntimeApiModeSource",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '方法元数据记录实际模式来自声明还是路由生成。',
      quickStart:
        "import { RuntimeApiModeSource } from '@migaia/rpc-contract/protocol'\n\nconst values = RuntimeApiModeSource",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:index:acceptRpcHandshake': {
    en: {
      purpose:
        'Select only real shared versions, codecs and installed extensions from two admitted offers.',
      quickStart:
        "import {\n  acceptRpcHandshake,\n  completeRpcHandshake,\n  RpcWireProfile,\n  type IRpcHello,\n} from '@migaia/rpc-contract/protocol'\n\nfunction offer(name: string): IRpcHello {\n  return {\n    profile: RpcWireProfile,\n    kind: 'handshake',\n    step: 'hello',\n    versions: [{ major: 2, minor: 0 }],\n    codecs: ['json'],\n    extensions: [],\n    peer: { id: name, runtime: 'node' },\n    directory: {\n      schemaVersion: 3,\n      self: {\n        name,\n        instanceId: name,\n        generation: { kind: 'session', value: 1, providerId: name },\n      },\n      methods: [],\n    },\n  }\n}\nconst caller = offer('caller')\nconst provider = offer('provider')\nconst accepted = acceptRpcHandshake(caller, provider)\nconst agreement = completeRpcHandshake(caller, accepted)",
      options: [],
      scenarios: [
        'Select an agreement from two actual hello records during protocol implementation.',
        'Reject a peer when either side requires an extension absent from the actual intersection.'
      ],
      avoidWhen: [
        'Do not advertise an extension merely because its name is known; an installed handler must exist.',
        'Do not mark a Session ready from this pure return value before its owner completes bilateral admission.'
      ]
    },
    zh: {
      purpose:
        '从双方实际 hello 选择唯一主版本、发起方优先的共有编解码器及真实共有扩展，验证必要扩展并返回接收选择，不打开载体或发布就绪。',
      quickStart:
        "import {\n  acceptRpcHandshake,\n  completeRpcHandshake,\n  RpcWireProfile,\n  type IRpcHello,\n} from '@migaia/rpc-contract/protocol'\n\nfunction offer(name: string): IRpcHello {\n  return {\n    profile: RpcWireProfile,\n    kind: 'handshake',\n    step: 'hello',\n    versions: [{ major: 2, minor: 0 }],\n    codecs: ['json'],\n    extensions: [],\n    peer: { id: name, runtime: 'node' },\n    directory: {\n      schemaVersion: 3,\n      self: {\n        name,\n        instanceId: name,\n        generation: { kind: 'session', value: 1, providerId: name },\n      },\n      methods: [],\n    },\n  }\n}\nconst caller = offer('caller')\nconst provider = offer('provider')\nconst accepted = acceptRpcHandshake(caller, provider)\nconst agreement = completeRpcHandshake(caller, accepted)",
      options: [],
      scenarios: [
        '实现协议时根据两个实际 hello 记录选择协议约定。',
        '任一方要求的扩展不在实际交集中时拒绝对端。'
      ],
      avoidWhen: [
        '不能仅因知道扩展名称就声明支持，必须有已安装处理器。',
        '所有者完成双向准入前，不能仅根据纯函数返回值发布会话就绪。'
      ]
    }
  },
  'rpc-contract:index:checkRpcDirectory': {
    en: {
      purpose:
        'Return a frozen successful directory or bounded nonreflecting diagnostic instead of throwing the shape result.',
      quickStart:
        "import {\n  acceptRpcHandshake,\n  completeRpcHandshake,\n  RpcWireProfile,\n  type IRpcHello,\n} from '@migaia/rpc-contract/protocol'\n\nfunction offer(name: string): IRpcHello {\n  return {\n    profile: RpcWireProfile,\n    kind: 'handshake',\n    step: 'hello',\n    versions: [{ major: 2, minor: 0 }],\n    codecs: ['json'],\n    extensions: [],\n    peer: { id: name, runtime: 'node' },\n    directory: {\n      schemaVersion: 3,\n      self: {\n        name,\n        instanceId: name,\n        generation: { kind: 'session', value: 1, providerId: name },\n      },\n      methods: [],\n    },\n  }\n}\nconst caller = offer('caller')\nconst provider = offer('provider')\nconst accepted = acceptRpcHandshake(caller, provider)\nconst agreement = completeRpcHandshake(caller, accepted)\nimport { checkRpcDirectory } from '@migaia/rpc-contract/protocol'\nconst checked = checkRpcDirectory(provider.directory)",
      options: [],
      scenarios: [
        'Inspect a peer directory with an explicit success/failure result before publishing it.',
        'Report the first invalid method declaration without exposing an unbounded input excerpt.'
      ],
      avoidWhen: [
        'Use normalizeRpcDirectory when the receiving boundary requires a throwing parser.',
        'Do not use a shape-success result as proof that the remote sender is authenticated.'
      ]
    },
    zh: {
      purpose:
        '检查第三版目录并返回冻结成功值或有界形状诊断，保留首个违规与原原因；此非抛错结果不建立会话身份或安装提供方方法。',
      quickStart:
        "import {\n  acceptRpcHandshake,\n  completeRpcHandshake,\n  RpcWireProfile,\n  type IRpcHello,\n} from '@migaia/rpc-contract/protocol'\n\nfunction offer(name: string): IRpcHello {\n  return {\n    profile: RpcWireProfile,\n    kind: 'handshake',\n    step: 'hello',\n    versions: [{ major: 2, minor: 0 }],\n    codecs: ['json'],\n    extensions: [],\n    peer: { id: name, runtime: 'node' },\n    directory: {\n      schemaVersion: 3,\n      self: {\n        name,\n        instanceId: name,\n        generation: { kind: 'session', value: 1, providerId: name },\n      },\n      methods: [],\n    },\n  }\n}\nconst caller = offer('caller')\nconst provider = offer('provider')\nconst accepted = acceptRpcHandshake(caller, provider)\nconst agreement = completeRpcHandshake(caller, accepted)\nimport { checkRpcDirectory } from '@migaia/rpc-contract/protocol'\nconst checked = checkRpcDirectory(provider.directory)",
      options: [],
      scenarios: [
        '发布对端目录前，用明确成功或失败结果检查它。',
        '报告首个非法方法声明，同时避免暴露无限输入摘录。'
      ],
      avoidWhen: [
        '接收边界要求抛错解析器时，应使用 normalizeRpcDirectory。',
        '形状检查成功不能证明远端发送者已经认证。'
      ]
    }
  },
  'rpc-contract:index:checkRpcProviderDeclaration': {
    en: {
      purpose:
        'Admit one bounded local schemaVersion-one advanced declaration before provider compilation.',
      quickStart:
        "import { checkRpcProviderDeclaration } from '@migaia/rpc-contract/protocol'\nconst checked = checkRpcProviderDeclaration({\n  schemaVersion: 1,\n  plugin: 'math',\n  features: {\n    api: {\n      methods: {\n        add: { mode: 'request', idempotent: true, input: { type: 'array' } },\n      },\n    },\n  },\n})\nif (!checked.ok) throw new TypeError(checked.reason)\nexport const declaration = checked.value",
      options: [],
      scenarios: [
        'Validate advanced method modes and schema declarations before compiling local providers.',
        'Keep declaration diagnostics separate from execution failures thrown by the implementation.'
      ],
      avoidWhen: [
        'Do not provide the exchanged version-three directory in place of the local declaration shape.',
        'Do not treat accepted schema data as a compiled business validator or exposed callable.'
      ]
    },
    zh: {
      purpose:
        '在提供方编译前检查本地 schemaVersion 为一的高级声明，返回明确形状结果并保留方法模式及模式元数据，不注册实际业务函数。',
      quickStart:
        "import { checkRpcProviderDeclaration } from '@migaia/rpc-contract/protocol'\nconst checked = checkRpcProviderDeclaration({\n  schemaVersion: 1,\n  plugin: 'math',\n  features: {\n    api: {\n      methods: {\n        add: { mode: 'request', idempotent: true, input: { type: 'array' } },\n      },\n    },\n  },\n})\nif (!checked.ok) throw new TypeError(checked.reason)\nexport const declaration = checked.value",
      options: [],
      scenarios: [
        '编译本地提供方前，校验高级方法模式及数据模式声明。',
        '把声明诊断与实际实现抛出的执行失败区分。'
      ],
      avoidWhen: [
        '不要用交换的第三版目录替代本地声明形状。',
        '接纳的数据模式不是已编译业务验证器或已发布函数。'
      ]
    }
  },
  'rpc-contract:index:checkRpcRuntimeStreamFinish': {
    en: {
      purpose:
        'Require before-start scope when a compatible peer has actually received a finish control.',
      quickStart:
        "import { checkRpcRuntimeStreamFinish } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcRuntimeStreamFinish({ cancel: 'before-start' })",
      options: [],
      scenarios: [
        'Validate a received finish control against the original stream call options.',
        'Return the established runtime-event diagnostic when the cancellation scope is incompatible.'
      ],
      avoidWhen: [
        'Do not call this unconditional finish rule for ordinary item or end events.',
        'Do not infer the original cancellation scope from the finish sender or error code.'
      ]
    },
    zh: {
      purpose:
        '实际收到无项目结束控制后，检查原调用是否声明 before-start 取消范围；返回违规错误或无值，不发送终态也不改变流状态。',
      quickStart:
        "import { checkRpcRuntimeStreamFinish } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcRuntimeStreamFinish({ cancel: 'before-start' })",
      options: [],
      scenarios: [
        '用原流调用选项校验已经收到的结束控制。',
        '取消范围不兼容时返回已有运行时事件诊断。'
      ],
      avoidWhen: [
        '不要把此无条件结束规则用于普通项目或 end 事件。',
        '不要从结束发送方或错误码推断原始取消范围。'
      ]
    }
  },
  'rpc-contract:index:checkRpcRuntimeStreamIntent': {
    en: {
      purpose:
        'Check the owner-held finish intent using the original call scope; a false intent imposes no finish rule.',
      quickStart:
        "import { checkRpcRuntimeStreamIntent } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcRuntimeStreamIntent(\n  { finish: true },\n  { cancel: 'before-start' },\n)",
      options: [],
      scenarios: [
        'Validate an early finish intent retained before the corresponding control is processed.',
        'Leave an operation without finish intent unaffected by this specific scope rule.'
      ],
      avoidWhen: [
        'Do not replace actual owner-held intent with a guessed pending or sequence flag.',
        'Use checkRpcRuntimeStreamTransition when a concrete event discriminator is already available.'
      ]
    },
    zh: {
      purpose:
        '根据原调用选项检查所有者保留的 finish 意图，仅在意图为真时要求 before-start 取消范围，不为假意图制造额外限制。',
      quickStart:
        "import { checkRpcRuntimeStreamIntent } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcRuntimeStreamIntent(\n  { finish: true },\n  { cancel: 'before-start' },\n)",
      options: [],
      scenarios: [
        '处理相应控制前，校验所有者保留的提前结束意图。',
        '让没有结束意图的操作不受此特定范围规则影响。'
      ],
      avoidWhen: [
        '不要用猜测的待决或序号标记替代所有者实际保留的意图。',
        '已经取得具体事件判别字段时，应使用 checkRpcRuntimeStreamTransition。'
      ]
    }
  },
  'rpc-contract:index:checkRpcRuntimeStreamTransition': {
    en: {
      purpose: 'Check finish-without-items only against its original before-start call scope.',
      quickStart:
        "import { checkRpcRuntimeStreamTransition } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcRuntimeStreamTransition(\n  { event: 'finish-without-items' },\n  { cancel: 'before-start' },\n)",
      options: [],
      scenarios: [
        'Check a concrete runtime stream event before applying its early-finish behavior.',
        'Accept other stream events without incorrectly applying the finish-only scope restriction.'
      ],
      avoidWhen: [
        'Do not use this scope check instead of validating the full stream event structure.',
        'Do not expect it to finish an iterator or send a cancellation envelope.'
      ]
    },
    zh: {
      purpose:
        '只在实际事件为 finish-without-items 时检查原调用 before-start 范围，其他事件沿原路径通过；此函数不执行迭代器取消或返回。',
      quickStart:
        "import { checkRpcRuntimeStreamTransition } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcRuntimeStreamTransition(\n  { event: 'finish-without-items' },\n  { cancel: 'before-start' },\n)",
      options: [],
      scenarios: [
        '应用提前结束行为前，检查具体运行时流事件。',
        '接纳其他流事件时，不误用仅适用于结束控制的范围限制。'
      ],
      avoidWhen: [
        '此范围检查不能替代完整流事件结构校验。',
        '它不会结束迭代器，也不会发送取消信封。'
      ]
    }
  },
  'rpc-contract:index:checkRpcStreamConsumerCredit': {
    en: {
      purpose: 'Require both matching sequence and actual pending consumer credit.',
      quickStart:
        "import { checkRpcStreamConsumerCredit } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcStreamConsumerCredit({ seq: 1 }, { seq: 1, pending: true })",
      options: [],
      scenarios: [
        'Admit an item only when it answers the consumer current outstanding pull.',
        'Reject unsolicited responses even when their sequence equals the current consumer sequence.'
      ],
      avoidWhen: [
        'Do not substitute the client in-flight call count for one stream pending credit.',
        'Do not use a passing check to create another pull; the consumer owns credit transitions.'
      ]
    },
    zh: {
      purpose:
        '将入站流序号与消费者实际持有序号和待决拉取额度比较，只有两者均匹配才通过；此纯检查不创建 next Promise 或补充额度。',
      quickStart:
        "import { checkRpcStreamConsumerCredit } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcStreamConsumerCredit({ seq: 1 }, { seq: 1, pending: true })",
      options: [],
      scenarios: [
        '只接纳回答消费者当前未完成拉取的项目。',
        '即使序号匹配，也拒绝没有实际待决额度的响应。'
      ],
      avoidWhen: [
        '不要用客户端调用在途数替代单条流的待决额度。',
        '检查通过不意味着创建另一次拉取，额度转换由消费者拥有。'
      ]
    }
  },
  'rpc-contract:index:checkRpcStreamInitialSequence': {
    en: {
      purpose: 'Require sequence zero for the original open.',
      quickStart:
        "import { checkRpcStreamInitialSequence } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcStreamInitialSequence({ seq: 0 })",
      options: [],
      scenarios: [
        'Validate the first open event before admitting a new stream exchange.',
        'Report a nonzero initial sequence at the supplied diagnostic pointer.'
      ],
      avoidWhen: [
        'Do not apply the initial-zero requirement to subsequent item or terminal events.',
        'Do not use it to allocate or reset the stream owner sequence counter.'
      ]
    },
    zh: {
      purpose:
        '要求原始流打开事件的序号精确为零，不满足时返回既有序号诊断；检查只读取传入事实，不创建流交换或初始化生产者。',
      quickStart:
        "import { checkRpcStreamInitialSequence } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcStreamInitialSequence({ seq: 0 })",
      options: [],
      scenarios: ['接纳新流交换前，校验首次打开事件。', '在指定诊断指针处报告非零初始序号。'],
      avoidWhen: [
        '不要把初始零序号要求用于后续项目或终态事件。',
        '不要用它分配或重置流所有者的序号计数器。'
      ]
    }
  },
  'rpc-contract:index:checkRpcStreamProducerCredit': {
    en: {
      purpose: 'Require matching sequence and a producer that is not already busy.',
      quickStart:
        "import { checkRpcStreamProducerCredit } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcStreamProducerCredit({ seq: 1 }, { seq: 1, busy: false })",
      options: [],
      scenarios: [
        'Reject a pull while the producer is still awaiting its current iterator result.',
        'Admit the next matching pull after the owner has cleared its busy state.'
      ],
      avoidWhen: [
        'Do not clear busy to make the check pass while iterator work is still in flight.',
        'Do not use consumer pending state as a substitute for the producer busy fact.'
      ]
    },
    zh: {
      purpose:
        '将拉取序号与生产者实际序号及忙状态比较，序号匹配且没有在途拉取才通过；不并发调用迭代器或自行排队后续请求。',
      quickStart:
        "import { checkRpcStreamProducerCredit } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcStreamProducerCredit({ seq: 1 }, { seq: 1, busy: false })",
      options: [],
      scenarios: [
        '生产者仍在等待当前迭代结果时拒绝新拉取。',
        '所有者清除忙状态后，接纳序号匹配的下一次拉取。'
      ],
      avoidWhen: [
        '迭代工作尚在进行时，不要清除忙状态使检查通过。',
        '不要用消费者待决状态替代生产者实际忙状态。'
      ]
    }
  },
  'rpc-contract:index:checkRpcStreamProgress': {
    en: {
      purpose: 'Permit a terminal to skip discarded items but never move backwards.',
      quickStart:
        "import { checkRpcStreamProgress } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcStreamProgress({ seq: 2 }, { seq: 1 })",
      options: [],
      scenarios: [
        'Accept a terminal observation after intermediate stream items were discarded locally.',
        'Reject a late terminal whose sequence falls behind the owner current progress.'
      ],
      avoidWhen: [
        'Use checkRpcStreamSequence for exchanges that require exact sequence equality.',
        'Do not advance state merely by measuring an unadmitted frame; the owner commits progress.'
      ]
    },
    zh: {
      purpose:
        '检查终态序号不小于所有者已持有的进度，允许越过被丢弃项目但拒绝倒退；不要求每个终态与当前序号严格相等。',
      quickStart:
        "import { checkRpcStreamProgress } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcStreamProgress({ seq: 2 }, { seq: 1 })",
      options: [],
      scenarios: [
        '本地丢弃中间项目后，仍接纳进度向前的终态观察。',
        '拒绝序号落后于所有者当前进度的迟到终态。'
      ],
      avoidWhen: [
        '要求精确序号相等的交换应使用 checkRpcStreamSequence。',
        '不能仅检查未接纳帧就推进状态，进度由所有者提交。'
      ]
    }
  },
  'rpc-contract:index:checkRpcStreamSequence': {
    en: {
      purpose:
        'Require the actual held sequence; an absent exchange cannot acknowledge cancellation.',
      quickStart:
        "import { checkRpcStreamSequence } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcStreamSequence({ seq: 1 }, { seq: 1 })",
      options: [],
      scenarios: [
        'Match an item or cancellation acknowledgment to the exact existing exchange.',
        'Reject an acknowledgment received after its exchange record has already retired.'
      ],
      avoidWhen: [
        'Use the progress check for terminals allowed to skip discarded intermediate items.',
        'Do not create an exchange record just to accept an otherwise unmatched acknowledgment.'
      ]
    },
    zh: {
      purpose:
        '将事件序号与实际存在的交换序号作精确比较，不存在的交换也会失败；用于关联检查，不根据诊断码伪造取消确认。',
      quickStart:
        "import { checkRpcStreamSequence } from '@migaia/rpc-contract/protocol'\nconst violation = checkRpcStreamSequence({ seq: 1 }, { seq: 1 })",
      options: [],
      scenarios: [
        '把项目或取消确认关联到实际存在的精确交换。',
        '交换记录已经退场后，拒绝收到的确认。'
      ],
      avoidWhen: [
        '允许跨过被丢弃中间项目的终态应使用进度检查。',
        '不要为了接纳本不匹配的确认而创建交换记录。'
      ]
    }
  },
  'rpc-contract:index:completeRpcHandshake': {
    en: {
      purpose:
        'Check a received selection against the original initiating offer; a reject restores its remote cause.',
      quickStart:
        "import {\n  acceptRpcHandshake,\n  completeRpcHandshake,\n  RpcWireProfile,\n  type IRpcHello,\n} from '@migaia/rpc-contract/protocol'\n\nfunction offer(name: string): IRpcHello {\n  return {\n    profile: RpcWireProfile,\n    kind: 'handshake',\n    step: 'hello',\n    versions: [{ major: 2, minor: 0 }],\n    codecs: ['json'],\n    extensions: [],\n    peer: { id: name, runtime: 'node' },\n    directory: {\n      schemaVersion: 3,\n      self: {\n        name,\n        instanceId: name,\n        generation: { kind: 'session', value: 1, providerId: name },\n      },\n      methods: [],\n    },\n  }\n}\nconst caller = offer('caller')\nconst provider = offer('provider')\nconst accepted = acceptRpcHandshake(caller, provider)\nconst agreement = completeRpcHandshake(caller, accepted)",
      options: [],
      scenarios: [
        'Validate that a selected codec and extensions were actually offered by the initiator.',
        'Preserve the restored remote rejection as cause when handshake completion fails.'
      ],
      avoidWhen: [
        'Do not validate an accept against a newly constructed offer that differs from the one sent.',
        'Do not skip the owning Session bilateral publication step after this pure validation.'
      ]
    },
    zh: {
      purpose:
        '把收到的 accept 或 reject 与原始发起 hello 比较，约束版本、编解码器及必要扩展；拒绝时恢复远端错误原因，不发布会话。',
      quickStart:
        "import {\n  acceptRpcHandshake,\n  completeRpcHandshake,\n  RpcWireProfile,\n  type IRpcHello,\n} from '@migaia/rpc-contract/protocol'\n\nfunction offer(name: string): IRpcHello {\n  return {\n    profile: RpcWireProfile,\n    kind: 'handshake',\n    step: 'hello',\n    versions: [{ major: 2, minor: 0 }],\n    codecs: ['json'],\n    extensions: [],\n    peer: { id: name, runtime: 'node' },\n    directory: {\n      schemaVersion: 3,\n      self: {\n        name,\n        instanceId: name,\n        generation: { kind: 'session', value: 1, providerId: name },\n      },\n      methods: [],\n    },\n  }\n}\nconst caller = offer('caller')\nconst provider = offer('provider')\nconst accepted = acceptRpcHandshake(caller, provider)\nconst agreement = completeRpcHandshake(caller, accepted)",
      options: [],
      scenarios: [
        '校验选中的编解码器和扩展确由发起方提议。',
        '握手完成被拒绝时，把恢复的远端拒绝保留为原因。'
      ],
      avoidWhen: [
        '不要用与实际发送不同的新建提议校验接收选择。',
        '纯校验完成后不能跳过所属 Session 的双向发布步骤。'
      ]
    }
  },
  'rpc-contract:index:createContractError': {
    en: {
      purpose:
        'Construct a canonical rpc.contract error for a rejected protocol or portable-value operation. The semantic code selects the existing native Error, TypeError or RangeError and its stable text; an optional cause retains the exact original failure. Provenance is written only through the explicitly supplied metadata port, so this pure factory owns no process state or local retry/cancellation authority.',
      quickStart:
        "import { createContractError } from '@migaia/rpc-contract/errors'\nimport { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'\nconst error = createContractError(RpcContractErrorCode.invalidEnvelope)",
      options: [],
      scenarios: [
        'Reject an invalid envelope with the registered Contract code and native error family chosen for that violation.',
        'Retain an underlying operation failure on cause while allowing the calling owner to record provenance through its explicit metadata port.'
      ],
      avoidWhen: [
        'Do not recreate an existing native callback failure merely to add a code; use the callback identification boundary that preserves its identity.',
        'Do not use this factory to restore a remote flat error graph; deserialize that graph through the public error operation instead.'
      ]
    },
    zh: {
      purpose:
        '协议或可移植值操作拒绝输入时，构造规范的 rpc.contract 错误。语义码选择已有原生 Error、TypeError 或 RangeError 家族及稳定文本；可选 cause 保留原始失败的精确身份。只有显式传入的元数据端口才记录来源，因此纯工厂不持有进程状态，也不因创建错误获得本地重试或取消权限。',
      quickStart:
        "import { createContractError } from '@migaia/rpc-contract/errors'\nimport { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'\nconst error = createContractError(RpcContractErrorCode.invalidEnvelope)",
      options: [],
      scenarios: [
        '拒绝非法信封时使用已登记的契约码，由该违规类型选择对应原生错误家族。',
        '在 cause 上保留底层操作失败，并让调用所有者通过显式元数据端口记录来源。'
      ],
      avoidWhen: [
        '不要为了附码重建已经存在的原生回调失败；应使用保留其身份的回调识别边界。',
        '不要用此工厂还原远端扁平错误图，应通过公开的错误反序列化操作恢复。'
      ]
    }
  },
  'rpc-contract:index:deserializeRpcError': {
    en: {
      purpose:
        'Validates a complete received error tree before restoring native Error subclasses and original serialized stacks. It does not convert wire properties into local authority. This standalone tree boundary is distinct from the protocol flat graph.',
      quickStart:
        "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'\nconst wire = serializeRpcError(\n  new RangeError('invalid count', { cause: new Error('root') }),\n  { report: console.error },\n)\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof RangeError, restored.cause)",
      options: [
        {
          name: 'unknownFields',
          description:
            'Chooses rejection or ignored admission of unknown received error-node fields.',
          whenToUse:
            'Use reject for strict received-error schemas; it is the default. Use ignore only when additive fields may be dropped. The observer does not choose or change that policy.',
          defaultValue: '`reject`; unknown fields fail validation.',
          example:
            "import { deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst failure = deserializeRpcError(receivedError, {\n  unknownFields: 'ignore',\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field),\n})\nshowCheckoutFailure(failure)"
        },
        {
          name: 'onUnknownField',
          description:
            'Optional synchronous application callback receives JSON pointer and unknown field name; returns void. A throw propagates from normalization.',
          whenToUse:
            'Use it with unknownFields ignore to record fields dropped from a newer peer’s error. Omit it for no observer; the default reject policy still rejects unknown fields.',
          defaultValue:
            'Omitted; no observer is called. The default unknownFields policy still rejects unknown error-node fields.',
          example:
            "import { deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst failure = deserializeRpcError(receivedError, {\n  unknownFields: 'ignore',\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field),\n})\nshowCheckoutFailure(failure)"
        }
      ],
      scenarios: [
        'Restore a validated standalone error tree received from a diagnostic export.',
        'Keep remote stack text and cause/aggregate descendants when presenting a failure.'
      ],
      avoidWhen: [
        'Use deserializeRpcWireError for the single protocol indexed graph instead of passing that graph here.',
        'Do not regard restored source/code properties as proof of locally minted cancellation or retry rights.'
      ]
    },
    zh: {
      purpose:
        '恢复原生错误子类及原始序列化堆栈之前，先校验完整接收错误树；线上属性不会变成本地权限。此独立错误树边界与协议平面错误图区分。',
      quickStart:
        "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'\nconst wire = serializeRpcError(\n  new RangeError('invalid count', { cause: new Error('root') }),\n  { report: console.error },\n)\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof RangeError, restored.cause)",
      options: [
        {
          name: 'unknownFields',
          description: '选择拒绝或忽略接纳收到的未知错误节点字段。',
          whenToUse:
            '需要严格接收错误结构时用 reject，它也是默认值。仅允许丢弃新增字段时用 ignore。观察回调不选择或改变策略。',
          defaultValue: '默认拒绝，未知字段会使校验失败。',
          example:
            "import { deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst failure = deserializeRpcError(receivedError, {\n  unknownFields: 'ignore',\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field),\n})\nshowCheckoutFailure(failure)"
        },
        {
          name: 'onUnknownField',
          description:
            '可选应用同步回调接收对象指针及未知字段名称，返回空值；抛错从规范化调用传播。',
          whenToUse:
            '使用 unknownFields ignore 接收新版本对端错误时，用它记录丢弃字段。省略时没有观察者；默认 reject 策略仍拒绝未知字段。',
          defaultValue: '默认省略，不调用观察者；默认 `unknownFields` 策略仍拒绝未知错误节点字段。',
          example:
            "import { deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst failure = deserializeRpcError(receivedError, {\n  unknownFields: 'ignore',\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field),\n})\nshowCheckoutFailure(failure)"
        }
      ],
      scenarios: [
        '恢复从诊断导出接收到、已通过完整校验的独立错误树。',
        '展示失败时保留远端堆栈文本及原因、聚合错误后代。'
      ],
      avoidWhen: [
        '唯一协议的索引错误图应交给 deserializeRpcWireError，不能作为错误树传入。',
        '不要把恢复的来源与错误码当作本地签发取消或重试权限的证明。'
      ]
    }
  },
  'rpc-contract:index:deserializeRpcWireError': {
    en: {
      purpose:
        'Validate and restore indexed native errors while preserving sender stacks and graph topology.',
      quickStart:
        "import {\n  serializeRpcWireError,\n  deserializeRpcWireError,\n} from '@migaia/rpc-contract/protocol'\n\nconst cause = new RangeError('sample limit')\nconst original = new TypeError('sample operation', { cause })\nconst wire = serializeRpcWireError(original, { report: console.error })\nconst restored = deserializeRpcWireError(wire)",
      options: [],
      scenarios: [
        'Restore a correlated terminal flat error graph without regenerating its remote stack.',
        'Preserve shared causes and aggregate edges between indexed error nodes.'
      ],
      avoidWhen: [
        'Use deserializeRpcError for the independent nested serialized-error tree boundary.',
        'Do not treat restored native class names or codes as authority to cancel or replay local work.'
      ]
    },
    zh: {
      purpose:
        '先校验唯一线上错误图的索引与预算，再恢复原生错误节点、发送方堆栈及共享原因关系；恢复的诊断属性不产生本地控制权限。',
      quickStart:
        "import {\n  serializeRpcWireError,\n  deserializeRpcWireError,\n} from '@migaia/rpc-contract/protocol'\n\nconst cause = new RangeError('sample limit')\nconst original = new TypeError('sample operation', { cause })\nconst wire = serializeRpcWireError(original, { report: console.error })\nconst restored = deserializeRpcWireError(wire)",
      options: [],
      scenarios: [
        '恢复关联终态的扁平错误图，不重新生成远端堆栈。',
        '保持索引错误节点之间共享原因及聚合边。'
      ],
      avoidWhen: [
        '独立嵌套序列化错误树应使用 deserializeRpcError。',
        '恢复的原生类型名称或错误码不授予取消或重放本地工作的权限。'
      ]
    }
  },
  'rpc-contract:index:identifyContractCallbackFailure': {
    en: {
      purpose:
        'Keep mutable native error identity and complete foreign codes; otherwise retain the original failure on the canonical callback error cause.',
      quickStart:
        "import { identifyContractCallbackFailure } from '@migaia/rpc-contract/errors'\nconst original = new RangeError('callback range')\nconst error = identifyContractCallbackFailure(original)",
      options: [],
      scenarios: [
        'Classify a caller callback rejection at a pure Contract operation boundary.',
        'Retain a foreign package error that already has a complete semantic source and code.'
      ],
      avoidWhen: [
        'Do not replace a mutable native callback error with a new error just to annotate it.',
        'Do not use callback classification to accept malformed protocol data; validate its shape separately.'
      ]
    },
    zh: {
      purpose:
        '在契约操作捕获回调失败时，保留可修改原生错误的身份及完整外部诊断；无法附码的值通过规范回调错误保留原原因。',
      quickStart:
        "import { identifyContractCallbackFailure } from '@migaia/rpc-contract/errors'\nconst original = new RangeError('callback range')\nconst error = identifyContractCallbackFailure(original)",
      options: [],
      scenarios: [
        '在纯契约操作边界为调用者回调拒绝分类。',
        '保留已经带有完整语义来源和错误码的外包错误。'
      ],
      avoidWhen: [
        '不要仅为附加诊断而用新错误替换可修改的原生回调错误。',
        '不要用回调失败分类代替协议数据形状校验。'
      ]
    }
  },
  'rpc-contract:index:identifyRpcBoundaryFailure': {
    en: {
      purpose:
        'Preserve an original mutable native error or complete foreign diagnostic identity; wrap only values that cannot retain it.',
      quickStart:
        "import { identifyRpcBoundaryFailure } from '@migaia/rpc-contract/errors'\nimport { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'\nconst error = identifyRpcBoundaryFailure(\n  'closed',\n  RpcCoreErrorCode.transport,\n  'Channel closed',\n)",
      options: [],
      scenarios: [
        'Attach a chosen endpoint code to a native boundary error that has no complete semantic identity.',
        'Keep an already coded foreign error intact while returning one Error-shaped diagnostic.'
      ],
      avoidWhen: [
        'Do not use the supplied fallback message to overwrite an existing native message or stack.',
        'Do not infer physical departure from a TRANSPORT code; the carrier owner must supply that fact.'
      ]
    },
    zh: {
      purpose:
        '在端点边界为实际失败补充诊断，同时保留可修改原生错误或完整外部来源身份；需要包装时把原值保存在原因链上。',
      quickStart:
        "import { identifyRpcBoundaryFailure } from '@migaia/rpc-contract/errors'\nimport { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'\nconst error = identifyRpcBoundaryFailure(\n  'closed',\n  RpcCoreErrorCode.transport,\n  'Channel closed',\n)",
      options: [],
      scenarios: [
        '为尚无完整语义身份的原生边界失败附加选定端点错误码。',
        '返回可诊断错误时保持已有完整错误码的外包错误不变。'
      ],
      avoidWhen: [
        '不要用传入的后备消息覆写已有原生消息或堆栈。',
        '不要从 TRANSPORT 错误码推断物理退场，必须由载体所有者提供事实。'
      ]
    }
  },
  'rpc-contract:index:isRpcHandshakeExcerptFree': {
    en: {
      purpose: 'Check whether a diagnostic message omits a raw JSON handshake excerpt.',
      quickStart:
        "import { isRpcHandshakeExcerptFree } from '@migaia/rpc-contract/errors'\nconst safe = isRpcHandshakeExcerptFree('Handshake invalid', '{\"auth\":\"fixture\"}')",
      options: [],
      scenarios: [
        'Check a JSON parser message before retaining it beside the failed handshake input.',
        'Choose whether a native parse error can be exposed without copying a credential excerpt.'
      ],
      avoidWhen: [
        'Do not call it a general secret detector; it compares only the supplied message and JSON text.',
        'Use an actual redaction boundary after a negative result; this predicate does not remove text.'
      ]
    },
    zh: {
      purpose:
        '比较诊断消息与原握手 JSON 的四码元片段，判断是否存在输入摘录；只返回比较结果，不修改消息或认证数据。',
      quickStart:
        "import { isRpcHandshakeExcerptFree } from '@migaia/rpc-contract/errors'\nconst safe = isRpcHandshakeExcerptFree('Handshake invalid', '{\"auth\":\"fixture\"}')",
      options: [],
      scenarios: [
        '保留 JSON 解析诊断前，检查消息是否包含失败握手输入的片段。',
        '判断能否展示原生解析错误而不复制凭据摘录。'
      ],
      avoidWhen: [
        '它只比较传入消息与 JSON 文本，不是通用秘密检测器。',
        '结果为否后应交给实际脱敏边界处理，此判断不会移除文本。'
      ]
    }
  },
  'rpc-contract:index:measurePortableStreamValue': {
    en: {
      purpose:
        'Measure already admitted values without encoding: numbers charge 24 bytes, native leaves charge actual intrinsic length.',
      quickStart:
        "import { measurePortableStreamValue } from '@migaia/rpc-contract/protocol'\nconst bytes = measurePortableStreamValue({ amount: 42 })",
      options: [],
      scenarios: [
        'Compare an admitted stream item semantic size against the existing 16KiB budget.',
        'Count genuine native byte leaves without first expanding them into Base64 text.'
      ],
      avoidWhen: [
        'Do not use this function to validate arbitrary graphs containing cycles or unsupported objects.',
        'Do not report its result as actual carrier bytes after framing, encryption or batching.'
      ]
    },
    zh: {
      purpose:
        '对已接纳可移植值执行不编码的语义计额，数字固定计二十四字节，原生叶子按内在长度计量；只返回大小，不自行执行流配额。',
      quickStart:
        "import { measurePortableStreamValue } from '@migaia/rpc-contract/protocol'\nconst bytes = measurePortableStreamValue({ amount: 42 })",
      options: [],
      scenarios: [
        '把已接纳流项目的语义大小与既有 16KiB 预算比较。',
        '计量真实原生字节叶子，无需先扩展为 Base64 文本。'
      ],
      avoidWhen: [
        '不要用此函数校验含环或不支持对象的任意图。',
        '不要把结果当作分帧、加密或合批后的实际载体字节数。'
      ]
    }
  },
  'rpc-contract:index:normalizeMethodSchema': {
    en: {
      purpose:
        'Admit the closed portable schema subset and local references as inert data; no validator is compiled.',
      quickStart:
        "import { normalizeMethodSchema } from '@migaia/rpc-contract/protocol'\nconst schema = normalizeMethodSchema({\n  type: 'object',\n  properties: { amount: { type: 'number' } },\n})",
      options: [],
      scenarios: [
        'Validate method schema metadata before placing it in a provider declaration or peer directory.',
        'Check local references while keeping schema content inert and runtime-neutral.'
      ],
      avoidWhen: [
        'Use an installed schema capability to validate application arguments against the admitted schema.',
        'Do not assume arbitrary JSON Schema extensions or external references are supported.'
      ]
    },
    zh: {
      purpose:
        '把受支持的闭合可移植模式子集及本地引用接纳为惰性冻结数据，拒绝非法声明并保留原原因；不生成或执行参数验证器。',
      quickStart:
        "import { normalizeMethodSchema } from '@migaia/rpc-contract/protocol'\nconst schema = normalizeMethodSchema({\n  type: 'object',\n  properties: { amount: { type: 'number' } },\n})",
      options: [],
      scenarios: [
        '把方法数据模式放入提供方声明或对端目录前先校验。',
        '检查本地引用，同时让模式内容保持惰性及运行时中立。'
      ],
      avoidWhen: [
        '实际业务参数应由已安装模式能力按已接纳模式验证。',
        '不要假设支持任意 JSON Schema 扩展或外部引用。'
      ]
    }
  },
  'rpc-contract:index:normalizePortable': {
    en: {
      purpose:
        'Snapshots supported portable values without sending or executing a request. The default wire domain is null, boolean, finite number, string, array, plain record or a canonical bytes tag; Uint8Array becomes {$rpc: "bytes", base64url}. Records become frozen null-prototype snapshots.\n\nRejects cycles, nonfinite numbers and unsupported objects with INVALID_ENVELOPE. Ordinary record getters are read once and can execute user code. Native binary belongs to an independently negotiated profile, not the default wire result.',
      quickStart:
        "import { normalizePortable } from '@migaia/rpc-contract/portable'\n\nconst source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }\nconst snapshot = normalizePortable(source)\nsource.profile.name = 'Grace'\nsource.bytes[0] = 99\nconsole.log(JSON.stringify(snapshot))\nconsole.log(Object.isFrozen(snapshot))",
      options: [],
      scenarios: [
        'Snapshot ordinary application data into the default wire portable domain before encoding.',
        'Turn a Uint8Array into its canonical bytes tag while freezing ordinary record snapshots.'
      ],
      avoidWhen: [
        'Use normalizeRpcPortable only when a negotiated native profile permits retained native leaves.',
        'Do not use the result as proof of schema validity or send completion; this is data projection only.'
      ],
      examples: [
        {
          id: 'case-1',
          title: 'Capture data before the caller changes it',
          description:
            'An adapter validates a payload, then the caller changes its nested object or byte array before encoding. The message should keep the values admitted at the validation boundary.\n\nKeeping the original object lets later mutations change what is sent. A shallow spread still shares nested records and bytes, so it does not establish a stable payload snapshot.\n\nnormalizePortable creates a frozen portable snapshot. The default wire profile copies records and converts Uint8Array bytes into a canonical unpadded Base64URL tag; it does not send a request.\n\nPrints `{"profile":{"name":"Ada"},"bytes":{"$rpc":"bytes","base64url":"AQID"}}` and `true`. Later source mutations do not change the captured name or the encoded bytes.\n\nOrdinary records become frozen null-prototype snapshots. This default profile produces a bytes tag, not a restored Uint8Array; negotiated native-binary paths have a separate contract. Getters on ordinary wire records are read once and can execute user code.',
          code: "import { normalizePortable } from '@migaia/rpc-contract/portable'\n\nconst source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }\nconst snapshot = normalizePortable(source)\nsource.profile.name = 'Grace'\nsource.bytes[0] = 99\nconsole.log(JSON.stringify(snapshot))\nconsole.log(Object.isFrozen(snapshot))"
        },
        {
          id: 'case-2',
          title: 'Reject values that cannot preserve their meaning on the wire',
          description:
            'A nonfinite measurement can be silently saved as null, while a cyclic payload cannot form a finite wire tree. Both should be rejected before an adapter commits to sending the message.\n\nJSON.stringify changes NaN to null inside a record. Checking only the top-level object misses invalid descendants and cycles that appear deeper in the payload.\n\nnormalizePortable walks the supported value tree and rejects invalid descendants. Compare the JSON result with the categorized TypeError, then submit a separate cyclic object through the same public entry.\n\nPrints `{"total":null}`, `nonfinite: true INVALID_ENVELOPE`, then `cycle: true INVALID_ENVELOPE`. Validation neither substitutes a finite value nor accepts a recursive reference.\n\nThe default domain includes null, booleans, finite numbers, strings, arrays, plain records and portable bytes. Its maximum depth is 64 with root depth 0; Date, Map, Set, functions and unsupported primitive values are not admitted.',
          code: "import { normalizePortable } from '@migaia/rpc-contract/portable'\n\nconsole.log(JSON.stringify({ total: Number.NaN }))\ntry {\n  normalizePortable({ total: Number.NaN })\n} catch (error) {\n  console.log(\n    'nonfinite:',\n    error instanceof TypeError,\n    (error as { code: string }).code,\n  )\n}\nconst cycle: { self?: unknown } = {}\ncycle.self = cycle\ntry {\n  normalizePortable(cycle)\n} catch (error) {\n  console.log('cycle:', error instanceof TypeError, (error as { code: string }).code)\n}"
        }
      ]
    },
    zh: {
      purpose:
        '快照支持的可移植值，不发送或执行请求；默认线上值域为 `null`、布尔、有限数、字符串、数组、普通记录或规范字节标签，`Uint8Array` 转为 `{ $rpc: "bytes", base64url }`，记录成为冻结的空原型快照。\n\n循环、非有限数与不支持的对象以 `INVALID_ENVELOPE` 拒绝；普通记录访问器读取一次，可能执行用户代码；原生二进制属于独立协商形态，不是默认线上结果。',
      quickStart:
        "import { normalizePortable } from '@migaia/rpc-contract/portable'\n\nconst source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }\nconst snapshot = normalizePortable(source)\nsource.profile.name = 'Grace'\nsource.bytes[0] = 99\nconsole.log(JSON.stringify(snapshot))\nconsole.log(Object.isFrozen(snapshot))",
      options: [],
      scenarios: [
        '编码前把普通应用数据快照为默认线上可移植值域。',
        '把 Uint8Array 转为规范字节标签，同时冻结普通记录快照。'
      ],
      avoidWhen: [
        '协商原生形态允许保留原生叶子时，才使用 normalizeRpcPortable。',
        '结果不证明数据模式有效或发送完成，此操作只投影数据。'
      ],
      examples: [
        {
          id: 'case-1',
          title: '在调用者修改前捕获数据',
          description:
            '适配器校验载荷后，调用者在编码前又修改了嵌套对象或字节数组，消息应保留校验边界接纳的值。\n\n保留原对象会让后续修改改变发送内容，浅层展开仍共享嵌套记录与字节，无法建立稳定的载荷快照。\n\n`normalizePortable` 创建冻结的可移植快照，默认线上形态复制记录，并把 `Uint8Array` 字节转成规范的不带填充 Base64URL 标签，不会发送请求。\n\n逐行输出 `{"profile":{"name":"Ada"},"bytes":{"$rpc":"bytes","base64url":"AQID"}}`、`true`，后续修改没有改变已捕获的名字或字节编码。\n\n普通记录变成冻结的空原型快照，默认形态产出字节标签，不会恢复为 `Uint8Array`；协商后的原生二进制另有契约，普通线上记录的访问器会读取一次并可能执行用户代码。',
          code: "import { normalizePortable } from '@migaia/rpc-contract/portable'\n\nconst source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }\nconst snapshot = normalizePortable(source)\nsource.profile.name = 'Grace'\nsource.bytes[0] = 99\nconsole.log(JSON.stringify(snapshot))\nconsole.log(Object.isFrozen(snapshot))"
        },
        {
          id: 'case-2',
          title: '拒绝在线上传输时会失去原意的值',
          description:
            '非有限计量值可能被悄悄保存为 `null`，带环载荷则无法形成有限线上树，两者都应在适配器决定发送消息前拒绝。\n\n`JSON.stringify` 会把记录里的 `NaN` 改成 `null`，只检查顶层对象又会漏掉深处的非法后代与环。\n\n`normalizePortable` 遍历支持的值树并拒绝非法后代，对照 JSON 结果与带分类的 `TypeError`，再用同一公开入口接收另一个带环对象。\n\n逐行输出 `{"total":null}`、`非有限值: true INVALID_ENVELOPE`、`循环: true INVALID_ENVELOPE`，校验没有替换非法数字，也没有接纳递归引用。\n\n默认值域含 `null`、布尔、有限数、字符串、数组、普通记录及可移植字节，根深度为 `0`，最大深度 `64`；不接纳 `Date`、`Map`、`Set`、函数及其他不支持的原始值。',
          code: "import { normalizePortable } from '@migaia/rpc-contract/portable'\n\nconsole.log(JSON.stringify({ total: Number.NaN }))\ntry {\n  normalizePortable({ total: Number.NaN })\n} catch (error) {\n  console.log('非有限值:', error instanceof TypeError, (error as { code: string }).code)\n}\nconst cycle: { self?: unknown } = {}\ncycle.self = cycle\ntry {\n  normalizePortable(cycle)\n} catch (error) {\n  console.log('循环:', error instanceof TypeError, (error as { code: string }).code)\n}"
        }
      ]
    }
  },
  'rpc-contract:index:normalizeRpcBinaryManifest': {
    en: {
      purpose:
        'Check pure envelope/backing length-digest metadata; actual digest computation and native transfer stay with the codec.',
      quickStart:
        "import { normalizeRpcFrame, RpcWireProfile } from '@migaia/rpc-contract/protocol'\n\nconst frame = normalizeRpcFrame({\n  profile: RpcWireProfile,\n  kind: 'call',\n  id: 'job-1',\n  route: {\n    applicationVersion: '1',\n    senderId: 'caller',\n    receiverId: 'provider',\n    targetId: 'provider',\n    sentAt: 0,\n    trace: 'checkout-1',\n  },\n  task: {\n    mode: 'request',\n    callerId: 'caller',\n    method: 'math.add',\n    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },\n    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },\n  },\n  options: {},\n  payload: [20, 22],\n})\nimport {\n  normalizeRpcBinaryManifest,\n  RpcWireBinaryProfile,\n} from '@migaia/rpc-contract/protocol'\nconst manifest =\n  'task' in frame\n    ? normalizeRpcBinaryManifest({\n        profile: RpcWireBinaryProfile,\n        storage: 'inline',\n        envelope: frame,\n        backings: [],\n      })\n    : undefined",
      options: [],
      scenarios: [
        'Admit inline versus native binary storage metadata around an actual semantic envelope.',
        'Reject malformed backing length or SHA-256 spelling before the codec uses the manifest.'
      ],
      avoidWhen: [
        'Do not treat a well-formed digest string as proof that supplied native bytes match it.',
        'Use the SDK codec for actual binary capture, digest verification and restoration.'
      ]
    },
    zh: {
      purpose:
        '检查二进制清单的形态、语义信封及完整背板长度和摘要拼写，保留原生表示约定；不计算摘要、恢复标签或执行转移。',
      quickStart:
        "import { normalizeRpcFrame, RpcWireProfile } from '@migaia/rpc-contract/protocol'\n\nconst frame = normalizeRpcFrame({\n  profile: RpcWireProfile,\n  kind: 'call',\n  id: 'job-1',\n  route: {\n    applicationVersion: '1',\n    senderId: 'caller',\n    receiverId: 'provider',\n    targetId: 'provider',\n    sentAt: 0,\n    trace: 'checkout-1',\n  },\n  task: {\n    mode: 'request',\n    callerId: 'caller',\n    method: 'math.add',\n    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },\n    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },\n  },\n  options: {},\n  payload: [20, 22],\n})\nimport {\n  normalizeRpcBinaryManifest,\n  RpcWireBinaryProfile,\n} from '@migaia/rpc-contract/protocol'\nconst manifest =\n  'task' in frame\n    ? normalizeRpcBinaryManifest({\n        profile: RpcWireBinaryProfile,\n        storage: 'inline',\n        envelope: frame,\n        backings: [],\n      })\n    : undefined",
      options: [],
      scenarios: [
        '接纳真实语义信封周围的内联或原生二进制存储元数据。',
        '编解码器消费清单前，拒绝非法背板长度或摘要拼写。'
      ],
      avoidWhen: [
        '摘要字符串形状正确不证明实际原生字节与其匹配。',
        '实际二进制捕获、摘要验证与恢复应由 SDK 编解码器完成。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcCallOptions': {
    en: {
      purpose:
        'Check orderKey/cancel/idempotencyKey for the actual task mode; local executing options are excluded.',
      quickStart:
        "import { normalizeRpcCallOptions } from '@migaia/rpc-contract/protocol'\nconst options = normalizeRpcCallOptions({ orderKey: 'cart' }, 'request')",
      options: [],
      scenarios: [
        'Admit wire options using the same task mode as the correlated call.',
        'Reject notify or stream idempotency metadata lacking its required cancellation scope.'
      ],
      avoidWhen: [
        'Use the Host local call API to select timeout or retry instances instead of serializing them here.',
        'Do not infer that a syntactically valid key reserves work in an idempotency store.'
      ]
    },
    zh: {
      purpose:
        '按实际任务模式检查线上 orderKey、before-start 取消范围及幂等键，返回闭合冻结选项；本地完整功能实例与数字超时不能进入此记录。',
      quickStart:
        "import { normalizeRpcCallOptions } from '@migaia/rpc-contract/protocol'\nconst options = normalizeRpcCallOptions({ orderKey: 'cart' }, 'request')",
      options: [],
      scenarios: [
        '使用关联调用的同一任务模式接纳线上选项。',
        '拒绝缺少必要取消范围的通知或流幂等元数据。'
      ],
      avoidWhen: [
        '应在 Host 本地调用 API 选择超时或重试实例，不要在此序列化它们。',
        '幂等键语法有效不意味着结果存储已为该工作建立保留。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcCarrierFrame': {
    en: {
      purpose:
        'Admit a message or an actually negotiated extension outer frame, preserving sidecar references.',
      quickStart:
        "import { normalizeRpcCarrierFrame } from '@migaia/rpc-contract/protocol'\nconst frame = normalizeRpcCarrierFrame({ kind: 'message', data: '{}' }, new Set())",
      options: [],
      scenarios: [
        'Validate the physical shell before dispatching a negotiated extension to its installed handler.',
        'Preserve genuine native sidecar buffers while checking the surrounding message shell.'
      ],
      avoidWhen: [
        'Do not add a name to the negotiated set merely to accept an unknown extension.',
        'Use normalizeRpcFrame after decoding semantic data; a carrier shell is not that semantic union.'
      ]
    },
    zh: {
      purpose:
        '接纳普通消息或实际已协商扩展的载体外壳，保持原始旁挂 ArrayBuffer 引用；编码数据仍不透明，不在这里执行编解码或原生写出。',
      quickStart:
        "import { normalizeRpcCarrierFrame } from '@migaia/rpc-contract/protocol'\nconst frame = normalizeRpcCarrierFrame({ kind: 'message', data: '{}' }, new Set())",
      options: [],
      scenarios: [
        '把物理外壳交给已安装扩展处理器前进行校验。',
        '校验消息外壳时保持真实原生旁挂缓冲区。'
      ],
      avoidWhen: [
        '不要仅为接纳未知扩展而把名称加进协商集合。',
        '语义数据解码后应使用 normalizeRpcFrame，载体外壳不是语义联合。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcCompletion': {
    en: {
      purpose:
        'Check success/failure completion for its actual task mode, including ordered group results.',
      quickStart:
        "import { normalizeRpcCompletion } from '@migaia/rpc-contract/protocol'\nconst completion = normalizeRpcCompletion({ ok: true, result: 42 }, 'request')",
      options: [],
      scenarios: [
        'Admit a scalar completion while preserving whether an actual result field was omitted.',
        'Validate a group completion using the original group mode and fail-stop report shape.'
      ],
      avoidWhen: [
        'Do not pass a request envelope as a completion record.',
        'Do not choose a different mode to bypass group-result or error-shape requirements.'
      ]
    },
    zh: {
      purpose:
        '根据实际任务模式接纳成功或失败完成记录，错误采用扁平图，成功分组需要完整有序结果；不根据完成数据执行提供方或重新查询结果。',
      quickStart:
        "import { normalizeRpcCompletion } from '@migaia/rpc-contract/protocol'\nconst completion = normalizeRpcCompletion({ ok: true, result: 42 }, 'request')",
      options: [],
      scenarios: [
        '接纳标量完成记录，同时保持真实结果字段是否省略。',
        '使用原分组模式及首错停止报告形状校验分组完成。'
      ],
      avoidWhen: ['不要把请求信封当作完成记录传入。', '不要更换模式来绕过分组结果或错误形状要求。']
    }
  },
  'rpc-contract:index:normalizeRpcDirectory': {
    en: {
      purpose:
        'Check version-three identity and unique bounded method descriptions; schema validation remains plugin-owned.',
      quickStart:
        "import {\n  acceptRpcHandshake,\n  completeRpcHandshake,\n  RpcWireProfile,\n  type IRpcHello,\n} from '@migaia/rpc-contract/protocol'\n\nfunction offer(name: string): IRpcHello {\n  return {\n    profile: RpcWireProfile,\n    kind: 'handshake',\n    step: 'hello',\n    versions: [{ major: 2, minor: 0 }],\n    codecs: ['json'],\n    extensions: [],\n    peer: { id: name, runtime: 'node' },\n    directory: {\n      schemaVersion: 3,\n      self: {\n        name,\n        instanceId: name,\n        generation: { kind: 'session', value: 1, providerId: name },\n      },\n      methods: [],\n    },\n  }\n}\nconst caller = offer('caller')\nconst provider = offer('provider')\nconst accepted = acceptRpcHandshake(caller, provider)\nconst agreement = completeRpcHandshake(caller, accepted)\nimport { normalizeRpcDirectory } from '@migaia/rpc-contract/protocol'\nconst directory = normalizeRpcDirectory(provider.directory)",
      options: [],
      scenarios: [
        'Normalize a peer advertised method directory before its owner publishes accepted capabilities.',
        'Reject duplicate method names and invalid bounded method metadata.'
      ],
      avoidWhen: [
        'Use checkRpcDirectory when the caller needs a returned diagnostic rather than an exception.',
        'Do not install local providers or grant remote execution rights from directory shape alone.'
      ]
    },
    zh: {
      purpose:
        '校验第三版目录身份、唯一且有界的方法描述与模式元数据，返回冻结快照；目录形状接纳不代替会话身份、鉴权或业务参数校验。',
      quickStart:
        "import {\n  acceptRpcHandshake,\n  completeRpcHandshake,\n  RpcWireProfile,\n  type IRpcHello,\n} from '@migaia/rpc-contract/protocol'\n\nfunction offer(name: string): IRpcHello {\n  return {\n    profile: RpcWireProfile,\n    kind: 'handshake',\n    step: 'hello',\n    versions: [{ major: 2, minor: 0 }],\n    codecs: ['json'],\n    extensions: [],\n    peer: { id: name, runtime: 'node' },\n    directory: {\n      schemaVersion: 3,\n      self: {\n        name,\n        instanceId: name,\n        generation: { kind: 'session', value: 1, providerId: name },\n      },\n      methods: [],\n    },\n  }\n}\nconst caller = offer('caller')\nconst provider = offer('provider')\nconst accepted = acceptRpcHandshake(caller, provider)\nconst agreement = completeRpcHandshake(caller, accepted)\nimport { normalizeRpcDirectory } from '@migaia/rpc-contract/protocol'\nconst directory = normalizeRpcDirectory(provider.directory)",
      options: [],
      scenarios: [
        '所有者发布已接纳能力前，规范化对端公布的方法目录。',
        '拒绝重复方法名称及非法有界方法元数据。'
      ],
      avoidWhen: [
        '调用者需要返回诊断而非异常时，应使用 checkRpcDirectory。',
        '不要仅凭目录形状安装本地提供方或授予远端执行权限。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcFrame': {
    en: {
      purpose:
        'Admit the one migaia.rpc/2 semantic union after decoding; this performs no Session or task admission.',
      quickStart:
        "import { normalizeRpcFrame, RpcWireProfile } from '@migaia/rpc-contract/protocol'\n\nconst frame = normalizeRpcFrame({\n  profile: RpcWireProfile,\n  kind: 'call',\n  id: 'job-1',\n  route: {\n    applicationVersion: '1',\n    senderId: 'caller',\n    receiverId: 'provider',\n    targetId: 'provider',\n    sentAt: 0,\n    trace: 'checkout-1',\n  },\n  task: {\n    mode: 'request',\n    callerId: 'caller',\n    method: 'math.add',\n    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },\n    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },\n  },\n  options: {},\n  payload: [20, 22],\n})",
      options: [],
      scenarios: [
        'Validate a decoded call, result, cancellation or control against its actual semantic variant.',
        'Reject fields belonging to a different frame variant before dispatch.'
      ],
      avoidWhen: [
        'Decode carrier bytes or text through the selected codec before invoking this semantic parser.',
        'Do not assume valid shape authenticates the sender or matches an outstanding call.'
      ]
    },
    zh: {
      purpose:
        '对已解码值接纳唯一 migaia.rpc/2 语义帧联合，检查对应封闭字段并投影载荷；不选择物理载体，也不完成会话或待决任务匹配。',
      quickStart:
        "import { normalizeRpcFrame, RpcWireProfile } from '@migaia/rpc-contract/protocol'\n\nconst frame = normalizeRpcFrame({\n  profile: RpcWireProfile,\n  kind: 'call',\n  id: 'job-1',\n  route: {\n    applicationVersion: '1',\n    senderId: 'caller',\n    receiverId: 'provider',\n    targetId: 'provider',\n    sentAt: 0,\n    trace: 'checkout-1',\n  },\n  task: {\n    mode: 'request',\n    callerId: 'caller',\n    method: 'math.add',\n    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },\n    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },\n  },\n  options: {},\n  payload: [20, 22],\n})",
      options: [],
      scenarios: [
        '按实际语义分支校验解码后的调用、结果、取消或控制。',
        '分发前拒绝属于其他帧分支的字段。'
      ],
      avoidWhen: [
        '调用语义解析器前，应先用选定编解码器解码载体字节或文本。',
        '形状有效不意味着发送方已认证或匹配某个待决调用。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcGeneration': {
    en: {
      purpose:
        'Check a restart/session kind, safe ordinal and original provider id; this does not create a supervisor.',
      quickStart:
        "import { normalizeRpcGeneration } from '@migaia/rpc-contract/protocol'\nconst generation = normalizeRpcGeneration({\n  kind: 'session',\n  value: 1,\n  providerId: 'b',\n})",
      options: [],
      scenarios: [
        'Admit the caller and target generation tuples carried by a task.',
        'Reject unsafe counters or unsupported generation kinds before correlation checks.'
      ],
      avoidWhen: [
        'Use the actual availability owner to decide whether the described generation is current.',
        'Do not increment a remote tuple to fabricate a replacement generation.'
      ]
    },
    zh: {
      purpose:
        '校验闭合代际记录中的 restart/session 种类、非负安全序号与原提供方标识，返回冻结快照；不创建监管者或判断代际是否仍然活跃。',
      quickStart:
        "import { normalizeRpcGeneration } from '@migaia/rpc-contract/protocol'\nconst generation = normalizeRpcGeneration({\n  kind: 'session',\n  value: 1,\n  providerId: 'b',\n})",
      options: [],
      scenarios: [
        '接纳任务携带的调用方及目标代际组合。',
        '关联检查前拒绝不安全计数或不支持的代际种类。'
      ],
      avoidWhen: [
        '描述的代际是否当前有效，应由实际可用性所有者判断。',
        '不要递增远端组合来伪造替代代际。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcGroupResult': {
    en: {
      purpose:
        'Preserve successful prefix, first error and not-executed suffix in a group terminal.',
      quickStart:
        "import { normalizeRpcGroupResult } from '@migaia/rpc-contract/protocol'\nconst results = normalizeRpcGroupResult([{ state: 'success', result: 42 }])",
      options: [],
      scenarios: [
        'Validate a fail-stop group report after the first provider failure.',
        'Reject a result that claims later steps succeeded after a previous failure.'
      ],
      avoidWhen: [
        'Do not treat the group report as an unordered settled-results array.',
        'Do not use normalization to execute missing steps or repair a partial provider report.'
      ]
    },
    zh: {
      purpose:
        '按原步骤顺序接纳分组结果，保持成功前缀、首个失败与后续未执行后缀；对成功值和扁平错误分别校验，不实际重跑任何步骤。',
      quickStart:
        "import { normalizeRpcGroupResult } from '@migaia/rpc-contract/protocol'\nconst results = normalizeRpcGroupResult([{ state: 'success', result: 42 }])",
      options: [],
      scenarios: [
        '首个提供方失败后，校验首错停止的分组报告。',
        '拒绝声称早先失败之后的步骤仍成功执行的结果。'
      ],
      avoidWhen: [
        '不要把分组报告当作无序的全部结算结果数组。',
        '不要靠规范化执行缺失步骤或修补不完整提供方报告。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcHandshake': {
    en: {
      purpose:
        'Check the sole hello/accept/reject grammar using strict own-data fields; no getters are executed.',
      quickStart:
        "import {\n  acceptRpcHandshake,\n  completeRpcHandshake,\n  RpcWireProfile,\n  type IRpcHello,\n} from '@migaia/rpc-contract/protocol'\n\nfunction offer(name: string): IRpcHello {\n  return {\n    profile: RpcWireProfile,\n    kind: 'handshake',\n    step: 'hello',\n    versions: [{ major: 2, minor: 0 }],\n    codecs: ['json'],\n    extensions: [],\n    peer: { id: name, runtime: 'node' },\n    directory: {\n      schemaVersion: 3,\n      self: {\n        name,\n        instanceId: name,\n        generation: { kind: 'session', value: 1, providerId: name },\n      },\n      methods: [],\n    },\n  }\n}\nconst caller = offer('caller')\nconst provider = offer('provider')\nconst accepted = acceptRpcHandshake(caller, provider)\nconst agreement = completeRpcHandshake(caller, accepted)\nimport { normalizeRpcHandshake } from '@migaia/rpc-contract/protocol'\nconst hello = normalizeRpcHandshake(provider)",
      options: [],
      scenarios: [
        'Validate a received hello before performing version, codec and extension selection.',
        'Reject malformed accept or reject records while retaining safe native causes.'
      ],
      avoidWhen: [
        'Use acceptRpcHandshake or completeRpcHandshake for agreement checks against actual offers.',
        'Do not pass raw JSON text directly; decoding and excerpt-safe parser handling belong upstream.'
      ]
    },
    zh: {
      purpose:
        '以严格自有数据字段接纳唯一 hello/accept/reject 握手语法，验证对应身份及目录等结构，不执行访问器，也不协商或公布会话就绪。',
      quickStart:
        "import {\n  acceptRpcHandshake,\n  completeRpcHandshake,\n  RpcWireProfile,\n  type IRpcHello,\n} from '@migaia/rpc-contract/protocol'\n\nfunction offer(name: string): IRpcHello {\n  return {\n    profile: RpcWireProfile,\n    kind: 'handshake',\n    step: 'hello',\n    versions: [{ major: 2, minor: 0 }],\n    codecs: ['json'],\n    extensions: [],\n    peer: { id: name, runtime: 'node' },\n    directory: {\n      schemaVersion: 3,\n      self: {\n        name,\n        instanceId: name,\n        generation: { kind: 'session', value: 1, providerId: name },\n      },\n      methods: [],\n    },\n  }\n}\nconst caller = offer('caller')\nconst provider = offer('provider')\nconst accepted = acceptRpcHandshake(caller, provider)\nconst agreement = completeRpcHandshake(caller, accepted)\nimport { normalizeRpcHandshake } from '@migaia/rpc-contract/protocol'\nconst hello = normalizeRpcHandshake(provider)",
      options: [],
      scenarios: [
        '选择版本、编解码器与扩展前校验收到的 hello。',
        '拒绝非法 accept 或 reject 记录，同时保留安全原生原因。'
      ],
      avoidWhen: [
        '针对实际提议检查协议约定时，应使用 acceptRpcHandshake 或 completeRpcHandshake。',
        '不要直接传入原始 JSON 文本，解码及摘录安全处理属于上游。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcOutcome': {
    en: {
      purpose:
        'Check retained original mode/generation/completion without querying or creating a store.',
      quickStart:
        "import { normalizeRpcOutcome } from '@migaia/rpc-contract/protocol'\nconst outcome = normalizeRpcOutcome({\n  mode: 'request',\n  targetGeneration: { kind: 'session', value: 1, providerId: 'b' },\n  completion: { ok: true, result: 42 },\n})",
      options: [],
      scenarios: [
        'Read a retained scalar or group completion together with the generation that produced it.',
        'Reject a retained outcome whose completion does not match its original mode.'
      ],
      avoidWhen: [
        'Do not replace the producing generation with the generation of the current lookup request.',
        'Do not expect this parser to query, reserve or persist an idempotency result.'
      ]
    },
    zh: {
      purpose:
        '接纳保留结果的原始调用模式、产生代际与完成记录，保持结果发生时的事实；不把本次查询身份写回，也不拥有幂等存储。',
      quickStart:
        "import { normalizeRpcOutcome } from '@migaia/rpc-contract/protocol'\nconst outcome = normalizeRpcOutcome({\n  mode: 'request',\n  targetGeneration: { kind: 'session', value: 1, providerId: 'b' },\n  completion: { ok: true, result: 42 },\n})",
      options: [],
      scenarios: [
        '读取保留的标量或分组完成结果及其产生代际。',
        '拒绝完成记录与原始模式不匹配的保留结果。'
      ],
      avoidWhen: [
        '不要用当前查询请求的代际替换结果产生代际。',
        '此解析器不会查询、保留或持久化幂等结果。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcOutcomeStore': {
    en: {
      purpose:
        'Check actual store kind/epoch/continuity facts; unknown outcome is not converted to success.',
      quickStart:
        "import { normalizeRpcOutcomeStore } from '@migaia/rpc-contract/protocol'\nconst store = normalizeRpcOutcomeStore({\n  kind: 'unavailable',\n  continuity: 'unavailable',\n})",
      options: [],
      scenarios: [
        'Validate memory or external result-store metadata with a real epoch.',
        'Represent unavailable continuity without inventing an epoch or retained result.'
      ],
      avoidWhen: [
        'Do not use the declaration to create a store implementation or claim durable retention.',
        'Do not interpret lost or unavailable continuity as proof that the original operation never ran.'
      ]
    },
    zh: {
      purpose:
        '校验结果存储的实际种类、纪元和连续性组合，明确不可用、已保留及已丢失状态；只规范事实，不把未知结果推断为成功或未执行。',
      quickStart:
        "import { normalizeRpcOutcomeStore } from '@migaia/rpc-contract/protocol'\nconst store = normalizeRpcOutcomeStore({\n  kind: 'unavailable',\n  continuity: 'unavailable',\n})",
      options: [],
      scenarios: [
        '校验带真实纪元的内存或外部结果存储元数据。',
        '表示不可用连续性时不发明纪元或保留结果。'
      ],
      avoidWhen: [
        '不要用此声明创建存储实现或宣称持久保留。',
        '不要把连续性丢失或不可用解释为原操作从未执行的证明。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcPortable': {
    en: {
      purpose:
        'Use the strict negotiated-native portable policy: own data only, preserving genuine native leaf identities.',
      quickStart:
        "import { normalizeRpcPortable } from '@migaia/rpc-contract/portable'\nconst native = new Uint8Array([1, 2, 3])\nconst snapshot = normalizeRpcPortable({ native })",
      options: [],
      scenarios: [
        'Admit codec-side values when genuine native binary leaves are already allowed by the selected profile.',
        'Reject accessor-backed records while keeping an accepted ArrayBuffer identity unchanged.'
      ],
      avoidWhen: [
        'Use normalizePortable for default inline wire snapshots that encode bytes as tags.',
        'Do not treat preserved buffer identity as authority to transfer or detach the backing.'
      ]
    },
    zh: {
      purpose:
        '使用已协商原生形态的严格可移植策略，只接纳记录自有数据并保留真实 ArrayBuffer 或字节视图叶子身份，不执行应用访问器。',
      quickStart:
        "import { normalizeRpcPortable } from '@migaia/rpc-contract/portable'\nconst native = new Uint8Array([1, 2, 3])\nconst snapshot = normalizeRpcPortable({ native })",
      options: [],
      scenarios: [
        '选中形态已允许真实原生二进制叶子时，接纳编解码侧的值。',
        '拒绝访问器记录，同时保持已接纳 ArrayBuffer 的身份。'
      ],
      avoidWhen: [
        '默认内联线上快照应使用把字节编码为标签的 normalizePortable。',
        '保留缓冲区身份不授予转移或分离背板的权限。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcRoute': {
    en: {
      purpose:
        'Check closed routing metadata, printable trace and bounded relative budget without extending the deadline.',
      quickStart:
        "import { normalizeRpcRoute } from '@migaia/rpc-contract/protocol'\nconst route = normalizeRpcRoute({\n  applicationVersion: '1',\n  senderId: 'a',\n  receiverId: 'b',\n  targetId: 'b',\n  sentAt: 0,\n})",
      options: [],
      scenarios: [
        'Admit direct sender, logical target and selected receiver metadata before task matching.',
        'Reject a malformed trace or oversized relative duration without modifying the caller budget.'
      ],
      avoidWhen: [
        'Do not derive authenticated source identity only from the route senderId string.',
        'Do not reset remainingMs while forwarding; the owning call path propagates the remaining budget.'
      ]
    },
    zh: {
      purpose:
        '校验闭合路由身份、发送时间、可打印 trace 与有限非负剩余预算，返回冻结快照；不会续期截止时间或把地址字符串转换为会话权限。',
      quickStart:
        "import { normalizeRpcRoute } from '@migaia/rpc-contract/protocol'\nconst route = normalizeRpcRoute({\n  applicationVersion: '1',\n  senderId: 'a',\n  receiverId: 'b',\n  targetId: 'b',\n  sentAt: 0,\n})",
      options: [],
      scenarios: [
        '任务匹配前接纳直接发送方、逻辑目标及选定接收方元数据。',
        '拒绝非法 trace 或过大相对时长，不修改调用者预算。'
      ],
      avoidWhen: [
        '不要只从路由 senderId 字符串推导已认证来源身份。',
        '转发时不要重置 remainingMs，实际调用路径应传播剩余预算。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcSerializedError': {
    en: {
      purpose:
        'Validates and freezes a fresh wire error tree with deterministic first-violation order and fixed graph/string/byte limits. This standalone tree boundary is distinct from the protocol flat graph.',
      quickStart: 'const validated = normalizeRpcSerializedError(wire)',
      options: [
        {
          name: 'unknownFields',
          description:
            'Chooses rejection or ignored admission of unknown received error-node fields.',
          whenToUse:
            'Use reject for strict received-error schemas; it is the default. Use ignore only when additive fields may be dropped. The observer does not choose or change that policy.',
          defaultValue: '`reject`; unknown fields fail validation.',
          example:
            "import { deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst failure = deserializeRpcError(receivedError, {\n  unknownFields: 'ignore',\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field),\n})\nshowCheckoutFailure(failure)"
        },
        {
          name: 'onUnknownField',
          description:
            'Optional synchronous application callback receives JSON pointer and unknown field name; returns void. A throw propagates from normalization.',
          whenToUse:
            'Use it with unknownFields ignore to record fields dropped from a newer peer’s error. Omit it for no observer; the default reject policy still rejects unknown fields.',
          defaultValue:
            'Omitted; no observer is called. The default unknownFields policy still rejects unknown error-node fields.',
          example:
            "import { deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst failure = deserializeRpcError(receivedError, {\n  unknownFields: 'ignore',\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field),\n})\nshowCheckoutFailure(failure)"
        }
      ],
      scenarios: [
        'Validate a standalone serialized error tree before storing or restoring it.',
        'Choose explicit unknown-field handling while retaining bounded pointer diagnostics.'
      ],
      avoidWhen: [
        'Use normalizeRpcWireError for indexed nodes used by the current wire protocol.',
        'Do not pass live native Error objects as serialized trees; project them first.'
      ]
    },
    zh: {
      purpose:
        '按确定的首违规顺序及固定图、字符串、字节限制，校验并冻结新的线上错误树。此独立错误树边界与协议平面错误图区分。',
      quickStart: 'const validated = normalizeRpcSerializedError(wire)',
      options: [
        {
          name: 'unknownFields',
          description: '选择拒绝或忽略接纳收到的未知错误节点字段。',
          whenToUse:
            '需要严格接收错误结构时用 reject，它也是默认值。仅允许丢弃新增字段时用 ignore。观察回调不选择或改变策略。',
          defaultValue: '默认拒绝，未知字段会使校验失败。',
          example:
            "import { deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst failure = deserializeRpcError(receivedError, {\n  unknownFields: 'ignore',\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field),\n})\nshowCheckoutFailure(failure)"
        },
        {
          name: 'onUnknownField',
          description:
            '可选应用同步回调接收对象指针及未知字段名称，返回空值；抛错从规范化调用传播。',
          whenToUse:
            '使用 unknownFields ignore 接收新版本对端错误时，用它记录丢弃字段。省略时没有观察者；默认 reject 策略仍拒绝未知字段。',
          defaultValue: '默认省略，不调用观察者；默认 `unknownFields` 策略仍拒绝未知错误节点字段。',
          example:
            "import { deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst failure = deserializeRpcError(receivedError, {\n  unknownFields: 'ignore',\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field),\n})\nshowCheckoutFailure(failure)"
        }
      ],
      scenarios: [
        '存储或恢复独立序列化错误树前，先校验完整结构。',
        '保留有界路径诊断的同时，显式选择未知字段处理策略。'
      ],
      avoidWhen: [
        '当前线上协议的索引节点应交给 normalizeRpcWireError。',
        '不要把活的原生错误直接当作已序列化错误树，应先投影。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcSteps': {
    en: {
      purpose:
        'Check a nonempty bounded ordered request-only step list and project each payload once.',
      quickStart:
        "import { normalizeRpcSteps } from '@migaia/rpc-contract/protocol'\nconst steps = normalizeRpcSteps([{ method: 'math.add', payload: [20, 22] }])",
      options: [],
      scenarios: [
        'Prepare a request-only atomic group while retaining the caller step order.',
        'Reject an empty group or malformed step before provider admission.'
      ],
      avoidWhen: [
        'Do not include notify or stream operations in this request-only step shape.',
        'Do not sort steps for convenience; execution order is part of the group contract.'
      ]
    },
    zh: {
      purpose:
        '接纳非空、有界且有序的请求步骤列表，逐项校验方法名并对载荷执行一次可移植投影，生成冻结步骤；不排序或执行提供方。',
      quickStart:
        "import { normalizeRpcSteps } from '@migaia/rpc-contract/protocol'\nconst steps = normalizeRpcSteps([{ method: 'math.add', payload: [20, 22] }])",
      options: [],
      scenarios: [
        '准备仅含请求的原子分组，同时保留调用者步骤顺序。',
        '提供方准入前拒绝空分组或非法步骤。'
      ],
      avoidWhen: [
        '不要把通知或流操作放入仅请求步骤形状。',
        '不要为方便而排序步骤，执行顺序属于分组契约。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcStream': {
    en: {
      purpose:
        'Check closed stream event fields and the semantic 16KiB value budget without scheduling pulls.',
      quickStart:
        "import { normalizeRpcStream } from '@migaia/rpc-contract/protocol'\nconst item = normalizeRpcStream({ event: 'item', seq: 1, value: 'ready' })",
      options: [],
      scenarios: [
        'Validate an item or terminal before its stream owner applies sequence and credit transitions.',
        'Reject an oversized semantic item while allowing a supplied projector to preserve binary accounting.'
      ],
      avoidWhen: [
        'Use the stream credit helpers and actual owner state after shape validation.',
        'Do not encode a cancel event as an ordinary stream event; cancellation has its correlated envelope.'
      ]
    },
    zh: {
      purpose:
        '接纳闭合流事件字段、非负序号、扁平终态错误及语义 16KiB 值预算，返回冻结记录；不保留拉取额度、调度迭代器或管理会话。',
      quickStart:
        "import { normalizeRpcStream } from '@migaia/rpc-contract/protocol'\nconst item = normalizeRpcStream({ event: 'item', seq: 1, value: 'ready' })",
      options: [],
      scenarios: [
        '流所有者应用序号及额度转换前，校验项目或终态。',
        '拒绝过大的语义项目，同时允许显式投影器保持二进制计额。'
      ],
      avoidWhen: [
        '形状校验后仍需使用额度检查及实际所有者状态。',
        '不要把 cancel 编成普通流事件，取消使用其关联信封。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcTask': {
    en: {
      purpose: 'Check exact caller/target generation tuple and mode-dependent method fields.',
      quickStart:
        "import { normalizeRpcFrame, RpcWireProfile } from '@migaia/rpc-contract/protocol'\n\nconst frame = normalizeRpcFrame({\n  profile: RpcWireProfile,\n  kind: 'call',\n  id: 'job-1',\n  route: {\n    applicationVersion: '1',\n    senderId: 'caller',\n    receiverId: 'provider',\n    targetId: 'provider',\n    sentAt: 0,\n    trace: 'checkout-1',\n  },\n  task: {\n    mode: 'request',\n    callerId: 'caller',\n    method: 'math.add',\n    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },\n    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },\n  },\n  options: {},\n  payload: [20, 22],\n})\nimport { normalizeRpcTask } from '@migaia/rpc-contract/protocol'\nconst task = 'task' in frame ? normalizeRpcTask(frame.task) : undefined",
      options: [],
      scenarios: [
        'Admit a request task with its original caller and target generation identities.',
        'Reject a method field on a mode whose task grammar forbids one.'
      ],
      avoidWhen: [
        'Do not use a valid tuple as proof that its target generation is currently selected.',
        'Do not replace task identity with only the envelope id during reply matching.'
      ]
    },
    zh: {
      purpose:
        '按模式校验调用方身份、调用及目标代际，以及是否必须存在方法名，生成精确冻结任务组合；不按方法字符串查找或调用提供方。',
      quickStart:
        "import { normalizeRpcFrame, RpcWireProfile } from '@migaia/rpc-contract/protocol'\n\nconst frame = normalizeRpcFrame({\n  profile: RpcWireProfile,\n  kind: 'call',\n  id: 'job-1',\n  route: {\n    applicationVersion: '1',\n    senderId: 'caller',\n    receiverId: 'provider',\n    targetId: 'provider',\n    sentAt: 0,\n    trace: 'checkout-1',\n  },\n  task: {\n    mode: 'request',\n    callerId: 'caller',\n    method: 'math.add',\n    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },\n    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },\n  },\n  options: {},\n  payload: [20, 22],\n})\nimport { normalizeRpcTask } from '@migaia/rpc-contract/protocol'\nconst task = 'task' in frame ? normalizeRpcTask(frame.task) : undefined",
      options: [],
      scenarios: [
        '接纳携带原调用方及目标代际身份的请求任务。',
        '任务模式语法禁止方法字段时，拒绝该额外字段。'
      ],
      avoidWhen: [
        '组合有效不能证明目标代际当前已被选中。',
        '匹配回复时不要仅用信封 id 替代完整任务身份。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcTrace': {
    en: {
      purpose: 'Require 1–256 printable ASCII characters for explicit operation correlation.',
      quickStart:
        "import { normalizeRpcTrace } from '@migaia/rpc-contract/protocol'\nconst trace = normalizeRpcTrace('checkout-1')",
      options: [],
      scenarios: [
        'Admit a caller-provided trace without changing its exact spelling.',
        'Reject control characters, empty text and overlong correlation strings.'
      ],
      avoidWhen: [
        'Do not put credentials or binary payloads into a trace field.',
        'Do not infer automatic tracing across new calls; callers explicitly supply each correlation value.'
      ]
    },
    zh: {
      purpose:
        '要求显式关联文本由一到二百五十六个可打印 ASCII 字符组成，原样返回已接纳字符串；不生成标识、不解释含义或自动跨调用继承。',
      quickStart:
        "import { normalizeRpcTrace } from '@migaia/rpc-contract/protocol'\nconst trace = normalizeRpcTrace('checkout-1')",
      options: [],
      scenarios: ['原样接纳调用者提供的 trace 拼写。', '拒绝控制字符、空文本及过长关联字符串。'],
      avoidWhen: [
        '不要把凭据或二进制载荷放进 trace 字段。',
        '新调用不会因此自动继承追踪值，调用者需显式提供关联。'
      ]
    }
  },
  'rpc-contract:index:normalizeRpcWireError': {
    en: {
      purpose:
        'Check indexed graph references, native diagnostic fields and aggregate budgets for the sole wire error grammar.',
      quickStart:
        "import {\n  serializeRpcWireError,\n  deserializeRpcWireError,\n} from '@migaia/rpc-contract/protocol'\n\nconst cause = new RangeError('sample limit')\nconst original = new TypeError('sample operation', { cause })\nconst wire = serializeRpcWireError(original, { report: console.error })\nconst restored = deserializeRpcWireError(wire)",
      options: [],
      scenarios: [
        'Validate a received indexed error graph before restoring its native diagnostics.',
        'Reject out-of-range references or aggregate budgets without partially restoring the graph.'
      ],
      avoidWhen: [
        'Use normalizeRpcSerializedError for the separate nested-tree interchange format.',
        'Do not accept an unknown wire error field merely because an application error once had it.'
      ]
    },
    zh: {
      purpose:
        '校验唯一扁平错误图的节点索引、引用关系、原生诊断字段与总预算，返回可恢复的冻结数据；不创建本地错误权限或执行原因中的对象。',
      quickStart:
        "import {\n  serializeRpcWireError,\n  deserializeRpcWireError,\n} from '@migaia/rpc-contract/protocol'\n\nconst cause = new RangeError('sample limit')\nconst original = new TypeError('sample operation', { cause })\nconst wire = serializeRpcWireError(original, { report: console.error })\nconst restored = deserializeRpcWireError(wire)",
      options: [],
      scenarios: [
        '恢复原生诊断前，校验收到的索引错误图。',
        '拒绝越界引用或累计预算违规，不进行部分恢复。'
      ],
      avoidWhen: [
        '独立嵌套树交换格式应使用 normalizeRpcSerializedError。',
        '不要仅因应用错误曾有某字段就接纳未知线上字段。'
      ]
    }
  },
  'rpc-contract:index:reachRpcError': {
    en: {
      purpose:
        'Lazily walks original causes, aggregate entries and cleanup failures by identity under the object visit limit; it observes originals rather than restored copies. This standalone tree boundary is distinct from the protocol flat graph.',
      quickStart:
        'for (const failure of reachRpcError(error, { report: console.error }))\n  console.log(failure)',
      options: [
        {
          name: 'report',
          description:
            'Application synchronous callback receives IRpcWireErrorFailure with pointer, field and original error; return void and avoid throwing.',
          whenToUse:
            'Always supply a local diagnostic sink for failed reads or portable projections omitted from the wire error. The callback receives pointer, field and the original failure. There is no default reporter.',
          example:
            "import { serializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst wire = serializeRpcError(checkoutFailure, {\n  report: (failure) => reportSerializationFailure(failure),\n})\nsendFailureToCheckout(wire)"
        }
      ],
      scenarios: [
        'Inspect original causes and aggregate entries while keeping their object identities.',
        'Find a retained cleanup failure without restoring or cloning its diagnostic graph.'
      ],
      avoidWhen: [
        'Do not use the yielded values as a transport representation; serialize errors for that boundary.',
        'Do not assume an unbounded exhaustive walk; the operation enforces the object visit limit.'
      ]
    },
    zh: {
      purpose:
        '在对象访问上限内按身份惰性遍历原始原因、聚合条目及清理失败，观察原对象而非恢复副本。此独立错误树边界与协议平面错误图区分。',
      quickStart:
        'for (const failure of reachRpcError(error, { report: console.error }))\n  console.log(failure)',
      options: [
        {
          name: 'report',
          description: '应用同步回调接收含指针、字段及原错误的失败记录，返回空值并避免抛错。',
          whenToUse:
            '必须为线上错误省略的读取或可移植投影失败提供本地诊断接收方。回调接收 pointer、field 和原始失败。没有默认报告方。',
          example:
            "import { serializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst wire = serializeRpcError(checkoutFailure, {\n  report: (failure) => reportSerializationFailure(failure),\n})\nsendFailureToCheckout(wire)"
        }
      ],
      scenarios: [
        '保持对象身份地查看原始原因和聚合错误条目。',
        '无需恢复或克隆诊断图即可找到保留的清理失败。'
      ],
      avoidWhen: [
        '遍历产出的值不是传输表示，跨边界时应序列化错误。',
        '此操作受对象访问上限约束，不承诺无限制完整遍历。'
      ]
    }
  },
  'rpc-contract:index:redactRpcHandshakeFailure': {
    en: {
      purpose:
        'Apply the bounded handshake cause-chain privacy policy. A fully inspectable ordinary native Error chain is retained; aggregate, unknown or overly deep structures become a frozen classification record without original text. JSON-message excerpt comparison remains a separate operation.',
      quickStart:
        "import { redactRpcHandshakeFailure } from '@migaia/rpc-contract/errors'\nexport function redact(error: unknown) {\n  return redactRpcHandshakeFailure(error)\n}",
      options: [],
      scenarios: [
        'Retain a clean native Error when its bounded ordinary cause chain can be preserved.',
        'Project an aggregate or uninspectable handshake failure into safe structural classification.'
      ],
      avoidWhen: [
        'Use isRpcHandshakeExcerptFree for the separate message-versus-JSON excerpt check.',
        'Do not apply this policy to arbitrary application payloads or expect a deep-cloned error graph.'
      ]
    },
    zh: {
      purpose:
        '对握手失败执行有界原因链隐私投影：保留可完整检查的普通原生错误，聚合、未知或过深结构改为不含原始文本的冻结分类记录。',
      quickStart:
        "import { redactRpcHandshakeFailure } from '@migaia/rpc-contract/errors'\nexport function redact(error: unknown) {\n  return redactRpcHandshakeFailure(error)\n}",
      options: [],
      scenarios: [
        '能够保留有界普通原因链时，沿用干净的原生错误。',
        '把聚合或无法检查的握手失败投影为安全的结构分类。'
      ],
      avoidWhen: [
        '消息与 JSON 的摘录比对应使用独立的 isRpcHandshakeExcerptFree。',
        '不要把此策略用于任意应用载荷，也不要期待得到深克隆错误图。'
      ]
    }
  },
  'rpc-contract:index:roleAdmissionMessage': {
    en: {
      purpose: 'Format the canonical diagnostic for an unsupported component role and slot.',
      quickStart:
        "import { roleAdmissionMessage } from '@migaia/rpc-contract/errors'\nconst message = roleAdmissionMessage('transport', 'namespace', 'memory')",
      options: [],
      scenarios: [
        'Explain why a component role cannot occupy a particular installation slot.',
        'Reuse the same diagnostic wording in separate role-admission owners.'
      ],
      avoidWhen: [
        'Do not rely on formatting a message to validate a plugin definition.',
        'Do not parse the message to recover role identity; retain the structured role facts.'
      ]
    },
    zh: {
      purpose:
        '根据组件角色、安装位置及可选属性键构造统一角色诊断文字，按规范区分字符串或符号键；不检查组件或改变安装状态。',
      quickStart:
        "import { roleAdmissionMessage } from '@migaia/rpc-contract/errors'\nconst message = roleAdmissionMessage('transport', 'namespace', 'memory')",
      options: [],
      scenarios: [
        '说明某个组件角色为何不能用于指定安装位置。',
        '让不同角色准入所有者复用同一诊断措辞。'
      ],
      avoidWhen: [
        '格式化消息不会校验插件定义本身。',
        '不要解析消息恢复角色身份，应保留原结构化角色事实。'
      ]
    }
  },
  'rpc-contract:index:rpcWirePointer': {
    en: {
      purpose:
        'Append one escaped key or index to a diagnostic JSON pointer, without reading a business object.',
      quickStart:
        "import { rpcWirePointer } from '@migaia/rpc-contract/protocol'\nconst path = rpcWirePointer('/payload', 'a/b')",
      options: [],
      scenarios: [
        'Build a precise pointer for a rejected array element or record field.',
        'Escape a field name containing slash or tilde without changing the original key.'
      ],
      avoidWhen: [
        'Do not use this formatter to navigate or validate the referenced business object.',
        'Do not concatenate an unescaped key manually when composing the same diagnostic path.'
      ]
    },
    zh: {
      purpose:
        '把单个键或索引按 JSON Pointer 规则转义并追加到父诊断路径，保持斜杠与波浪号含义；不读取目标对象，也不解析整个指针。',
      quickStart:
        "import { rpcWirePointer } from '@migaia/rpc-contract/protocol'\nconst path = rpcWirePointer('/payload', 'a/b')",
      options: [],
      scenarios: [
        '为拒绝的数组元素或记录字段构造精确指针。',
        '转义含斜杠或波浪号的字段名，不修改原始键。'
      ],
      avoidWhen: [
        '不要用此格式化器访问或校验所指业务对象。',
        '构造同类诊断路径时，不要手工拼接未转义键。'
      ]
    }
  },
  'rpc-contract:index:safeRead': {
    en: {
      purpose:
        'Read one property once; an original read trap is synchronously reported or thrown as coded TypeError with original cause.',
      quickStart:
        "import { safeRead } from '@migaia/rpc-contract/errors'\nconst code = safeRead<string>({ code: 'DECLINED' }, 'code')",
      options: [],
      scenarios: [
        'Read one diagnostic field from a value that may expose a hostile getter.',
        'Report a failed property read synchronously and receive undefined as the fallback.'
      ],
      avoidWhen: [
        'Do not use safeRead as an own-data-only record validator; a successful getter is still executed.',
        'Do not supply an asynchronous reporting policy when the read must settle synchronously.'
      ]
    },
    zh: {
      purpose:
        '对未知值只执行一次指定属性读取；读取陷阱失败由同步报告器接收，或抛出保留原原因的带码 TypeError，不自动遍历对象。',
      quickStart:
        "import { safeRead } from '@migaia/rpc-contract/errors'\nconst code = safeRead<string>({ code: 'DECLINED' }, 'code')",
      options: [],
      scenarios: [
        '从可能带有抛错访问器的值读取一个诊断字段。',
        '同步报告属性读取失败，并取得 undefined 后备结果。'
      ],
      avoidWhen: [
        'safeRead 不是仅接纳自有数据的记录校验器，成功访问器仍会执行。',
        '读取必须同步结算，不要传入异步报告策略。'
      ]
    }
  },
  'rpc-contract:index:safeString': {
    en: {
      purpose:
        'Convert an untrusted value once; report conversion failure synchronously or throw coded TypeError retaining its cause.',
      quickStart:
        "import { safeString } from '@migaia/rpc-contract/errors'\nconst text = safeString(42)",
      options: [],
      scenarios: [
        'Convert a thrown non-Error value into displayable diagnostic text.',
        'Choose a fallback while synchronously reporting a failing toString conversion.'
      ],
      avoidWhen: [
        'Do not use string conversion as structured error serialization or secret redaction.',
        'Do not call it to validate protocol identifiers; conversion may accept values the grammar forbids.'
      ]
    },
    zh: {
      purpose:
        '对未知值执行一次字符串转换，转换抛错时同步上报并使用后备文本，或抛出保留原始原因的带码 TypeError。',
      quickStart:
        "import { safeString } from '@migaia/rpc-contract/errors'\nconst text = safeString(42)",
      options: [],
      scenarios: [
        '把非 Error 抛出值转换为可展示的诊断文本。',
        'toString 转换失败时同步报告，并选用后备文本。'
      ],
      avoidWhen: [
        '字符串转换不能代替结构化错误序列化或秘密脱敏。',
        '不要用它校验协议标识，转换可能接受语法禁止的值。'
      ]
    }
  },
  'rpc-contract:index:serializeRpcError': {
    en: {
      purpose:
        'Projects any original thrown value into a bounded wire error tree while preserving semantic source/code, native name, remote stack and cause/aggregate descendants. Omitted unreadable data is reported. This standalone tree boundary is distinct from the protocol flat graph.',
      quickStart:
        "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst original = new RangeError('limit exceeded')\nObject.defineProperties(original, {\n  source: { value: 'example' },\n  code: { value: 'LIMIT' },\n})\nconst primary = new TypeError('request failed', { cause: original })\nObject.defineProperties(primary, {\n  source: { value: 'example' },\n  code: { value: 'REQUEST' },\n})\nconst reports: unknown[] = []\nconst wire = serializeRpcError(primary, {\n  report: (failure) => {\n    reports.push(failure)\n  },\n})\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof TypeError, restored.cause instanceof RangeError)\nconsole.log(\n  restored.stack === primary.stack,\n  (restored.cause as Error).stack === original.stack,\n)\nconsole.log(\n  (restored as Error & { code: string }).code,\n  (restored.cause as Error & { code: string }).code,\n  reports.length,\n)",
      options: [
        {
          name: 'report',
          description:
            'Application synchronous callback receives IRpcWireErrorFailure with pointer, field and original error; return void and avoid throwing.',
          whenToUse:
            'Always supply a local diagnostic sink for failed reads or portable projections omitted from the wire error. The callback receives pointer, field and the original failure. There is no default reporter.',
          example:
            "import { serializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst wire = serializeRpcError(checkoutFailure, {\n  report: (failure) => reportSerializationFailure(failure),\n})\nsendFailureToCheckout(wire)"
        }
      ],
      scenarios: [
        'Export a native failure and its descendants as a bounded standalone error tree.',
        'Report unreadable diagnostic fields while preserving the readable source, code and stack.'
      ],
      avoidWhen: [
        'Use serializeRpcWireError when the receiving protocol requires indexed shared/cyclic nodes.',
        'Do not send the original application object graph as diagnostic data without the serializer bounds.'
      ],
      examples: [
        {
          id: 'case-1',
          title: 'Preserve native error classes and remote cause stacks',
          description:
            'A remote operation fails with a TypeError caused by a RangeError. The receiver needs both semantic codes and the original stacks to understand which operation failed and why.\n\nSending only error.message drops the cause tree, native classes and stacks. Creating a fresh local error from that text assigns a receiving-side stack that hides the original failure location.\n\nserializeRpcError projects a bounded coded tree, and deserializeRpcError validates it before restoring native classes. Supply the required report callback to retain any fields that cannot be read or normalized.\n\nPrints `true true`, `true true`, then `REQUEST LIMIT 0`. Both native classes and stack strings survive the round trip, both semantic codes remain present, and no field failures are reported.\n\nRestoration creates new Error objects, so cross-boundary object identity is not preserved. The tree is bounded and can carry cause, AggregateError errors and a truncation marker; no connection or request is executed by these functions.',
          code: "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst original = new RangeError('limit exceeded')\nObject.defineProperties(original, {\n  source: { value: 'example' },\n  code: { value: 'LIMIT' },\n})\nconst primary = new TypeError('request failed', { cause: original })\nObject.defineProperties(primary, {\n  source: { value: 'example' },\n  code: { value: 'REQUEST' },\n})\nconst reports: unknown[] = []\nconst wire = serializeRpcError(primary, {\n  report: (failure) => {\n    reports.push(failure)\n  },\n})\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof TypeError, restored.cause instanceof RangeError)\nconsole.log(\n  restored.stack === primary.stack,\n  (restored.cause as Error).stack === original.stack,\n)\nconsole.log(\n  (restored as Error & { code: string }).code,\n  (restored.cause as Error & { code: string }).code,\n  reports.length,\n)"
        },
        {
          id: 'case-2',
          title: 'Report unreadable error fields without losing the wire error',
          description:
            'A diagnostic serializer encounters an Error whose message getter throws. Losing the whole diagnostic would hide both the original operation and the new field-read failure.\n\nDirect property reads while building a JSON object let the getter exception escape the logging path. Ignoring that exception instead removes evidence that a field was omitted.\n\nserializeRpcError captures supported fields and routes omitted read failures to report. Save the fixture stack before installing its hostile message getter, then collect each report record for inspection.\n\nPrints `Error UNKNOWN` and `1 message true`. A wire error is still returned, and the report identifies the unreadable message field with the exact original TypeError.\n\nreport is required and receives pointer, field and the original failure synchronously. These records are local diagnostic evidence, not extra wire fields. Untagged errors use the unknown source/code fallback; unreadable fields follow the bounded serializer policy.',
          code: "import {\n  serializeRpcError,\n  type IRpcWireErrorFailure,\n} from '@migaia/rpc-contract/errors'\n\nconst original = new TypeError('message access failed')\nconst failure = new Error('unreadable message')\nvoid failure.stack\nObject.defineProperty(failure, 'message', {\n  get: () => {\n    throw original\n  },\n})\nconst reports: IRpcWireErrorFailure[] = []\nconst wire = serializeRpcError(failure, {\n  report: (entry) => {\n    reports.push(entry)\n  },\n})\nconsole.log(wire.name, wire.code)\nconsole.log(reports.length, reports[0]?.field, reports[0]?.error === original)"
        }
      ]
    },
    zh: {
      purpose:
        '把任意原始抛出值投影为有界线上错误树，保留语义来源、错误码、原生名称、远端堆栈及原因聚合后代；省略不可读数据时会上报。此独立错误树边界与协议平面错误图区分。',
      quickStart:
        "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst original = new RangeError('超过限制')\nObject.defineProperties(original, {\n  source: { value: 'example' },\n  code: { value: 'LIMIT' },\n})\nconst primary = new TypeError('请求失败', { cause: original })\nObject.defineProperties(primary, {\n  source: { value: 'example' },\n  code: { value: 'REQUEST' },\n})\nconst reports: unknown[] = []\nconst wire = serializeRpcError(primary, {\n  report: (failure) => {\n    reports.push(failure)\n  },\n})\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof TypeError, restored.cause instanceof RangeError)\nconsole.log(\n  restored.stack === primary.stack,\n  (restored.cause as Error).stack === original.stack,\n)\nconsole.log(\n  (restored as Error & { code: string }).code,\n  (restored.cause as Error & { code: string }).code,\n  reports.length,\n)",
      options: [
        {
          name: 'report',
          description: '应用同步回调接收含指针、字段及原错误的失败记录，返回空值并避免抛错。',
          whenToUse:
            '必须为线上错误省略的读取或可移植投影失败提供本地诊断接收方。回调接收 pointer、field 和原始失败。没有默认报告方。',
          example:
            "import { serializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst wire = serializeRpcError(checkoutFailure, {\n  report: (failure) => reportSerializationFailure(failure),\n})\nsendFailureToCheckout(wire)"
        }
      ],
      scenarios: [
        '把原生失败及其后代导出为有界独立错误树。',
        '报告不可读诊断字段，同时保留可读取的来源、错误码与堆栈。'
      ],
      avoidWhen: [
        '接收协议要求索引共享或循环节点时，应使用 serializeRpcWireError。',
        '不要绕过序列化边界限制，把原始应用对象图直接作为诊断数据发送。'
      ],
      examples: [
        {
          id: 'case-1',
          title: '保留原生错误类型与远端原因堆栈',
          description:
            '远端操作因范围错误而抛出类型错误，接收方需要两层语义码和原始堆栈，才能辨认失败操作及根因。\n\n只发送错误消息会丢掉原因树、原生类型与堆栈，用该文字在本地重建错误，又会生成接收端堆栈并掩盖原始失败位置。\n\n`serializeRpcError` 投影有界带码树，`deserializeRpcError` 校验后恢复原生类型，须提供 `report` 回调以保留无法读取或规范化字段的失败。\n\n逐行输出 `true true`、`true true`、`REQUEST LIMIT 0`，往返保留两种原生类型、两份堆栈字符串和语义码，未报告字段失败。\n\n恢复会创建新的错误对象，不保留跨边界对象身份；错误树有界，可携带 `cause`、聚合错误子项和截断标记，这些函数不建立连接或执行请求。',
          code: "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst original = new RangeError('超过限制')\nObject.defineProperties(original, {\n  source: { value: 'example' },\n  code: { value: 'LIMIT' },\n})\nconst primary = new TypeError('请求失败', { cause: original })\nObject.defineProperties(primary, {\n  source: { value: 'example' },\n  code: { value: 'REQUEST' },\n})\nconst reports: unknown[] = []\nconst wire = serializeRpcError(primary, {\n  report: (failure) => {\n    reports.push(failure)\n  },\n})\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof TypeError, restored.cause instanceof RangeError)\nconsole.log(\n  restored.stack === primary.stack,\n  (restored.cause as Error).stack === original.stack,\n)\nconsole.log(\n  (restored as Error & { code: string }).code,\n  (restored.cause as Error & { code: string }).code,\n  reports.length,\n)"
        },
        {
          id: 'case-2',
          title: '报告不可读字段并继续生成线上错误',
          description:
            '诊断序列化遇到消息访问器会抛错的错误对象，丢弃整条诊断会同时掩盖原操作与新的字段读取失败。\n\n构建 JSON 对象时直接读取属性，会让访问器异常逃出日志路径，若忽略该异常，又会丢失字段被省略的依据。\n\n`serializeRpcError` 捕获支持字段，并把被省略的读取失败交给 `report`；本例先保存错误堆栈，再设置会抛错的消息访问器，收集报告记录供检查。\n\n逐行输出 `Error UNKNOWN`、`1 message true`，仍返回线上错误，报告指出不可读的消息字段并保留原始 `TypeError`。\n\n`report` 必填，同步收到指针、字段和原始失败；这些记录是本地诊断依据，不是额外线上字段，未编码错误使用未知来源与错误码兜底，不可读字段遵守有界序列化策略。',
          code: "import {\n  serializeRpcError,\n  type IRpcWireErrorFailure,\n} from '@migaia/rpc-contract/errors'\n\nconst original = new TypeError('消息读取失败')\nconst failure = new Error('不可读消息')\nvoid failure.stack\nObject.defineProperty(failure, 'message', {\n  get: () => {\n    throw original\n  },\n})\nconst reports: IRpcWireErrorFailure[] = []\nconst wire = serializeRpcError(failure, {\n  report: (entry) => {\n    reports.push(entry)\n  },\n})\nconsole.log(wire.name, wire.code)\nconsole.log(reports.length, reports[0]?.field, reports[0]?.error === original)"
        }
      ]
    }
  },
  'rpc-contract:index:serializeRpcWireError': {
    en: {
      purpose:
        'Project the original JavaScript error graph into indexed nodes, preserving sharing/cycles and bounded native diagnostics.',
      quickStart:
        "import {\n  serializeRpcWireError,\n  deserializeRpcWireError,\n} from '@migaia/rpc-contract/protocol'\n\nconst cause = new RangeError('sample limit')\nconst original = new TypeError('sample operation', { cause })\nconst wire = serializeRpcWireError(original, { report: console.error })\nconst restored = deserializeRpcWireError(wire)",
      options: [],
      scenarios: [
        'Send a terminal error graph with shared causes through the current single protocol.',
        'Preserve cycles without recursively expanding the same error into repeated subtrees.'
      ],
      avoidWhen: [
        'Use serializeRpcError when an independent consumer explicitly requires the nested-tree format.',
        'Do not infer caller cancellation authority from public source or code properties being serialized.'
      ],
      examples: [
        {
          id: 'case-1',
          title: 'Keep one shared cause in the flat error graph',
          description:
            'A batch failure has the same RangeError as its primary cause and its first aggregate child. A nested-only serialization can duplicate that object and lose the shared relationship. The sole wire graph uses node indexes, while its receiver restores native classes and original stack strings.\n\nBoth lines print true. The restored cause and aggregate child share one new receiving-side identity; their original sender stack is preserved. These objects are not === their sending-side originals. Graph normalization also checks indices and aggregate budgets, beyond what JSON Schema alone proves.',
          code: "import {\n  serializeRpcWireError,\n  deserializeRpcWireError,\n} from '@migaia/rpc-contract/protocol'\n\nconst cause = new RangeError('sample limit')\nconst original = new AggregateError([cause], 'sample operation', { cause })\nconst wire = serializeRpcWireError(original, { report: console.error })\nconst restored = deserializeRpcWireError(wire)\nif (restored instanceof AggregateError) {\n  console.log(restored.cause === restored.errors[0])\n  console.log(restored.stack === original.stack)\n}"
        }
      ]
    },
    zh: {
      purpose:
        '把原本地 JavaScript 错误图投影为有界索引节点，保留原因、聚合条目及共享或循环关系，发送方堆栈仍是诊断数据而非本地控制证据。',
      quickStart:
        "import {\n  serializeRpcWireError,\n  deserializeRpcWireError,\n} from '@migaia/rpc-contract/protocol'\n\nconst cause = new RangeError('sample limit')\nconst original = new TypeError('sample operation', { cause })\nconst wire = serializeRpcWireError(original, { report: console.error })\nconst restored = deserializeRpcWireError(wire)",
      options: [],
      scenarios: [
        '经当前唯一协议发送包含共享原因的终态错误图。',
        '保持循环关系，避免把同一错误递归展开为重复子树。'
      ],
      avoidWhen: [
        '独立消费者明确要求嵌套树格式时，应使用 serializeRpcError。',
        '不要从被序列化的公开来源或错误码推断调用者取消权限。'
      ],
      examples: [
        {
          id: 'case-1',
          title: '在平面错误图中保持共享原因',
          description:
            '批量失败把同一范围错误用作主原因和首个聚合子项。只用嵌套序列化会复制该对象并丢失共享关系。唯一线上错误图使用节点索引，接收方恢复原生类型及原堆栈字符串。\n\n两行均输出真值。恢复后的原因及聚合子项共享一个新的接收端身份，并保留原发送方堆栈；它们与发送方原对象不是同一身份。错误图规范化还检查索引和累计预算，超出单独数据模式所能证明的范围。',
          code: "import {\n  serializeRpcWireError,\n  deserializeRpcWireError,\n} from '@migaia/rpc-contract/protocol'\n\nconst cause = new RangeError('sample limit')\nconst original = new AggregateError([cause], 'sample operation', { cause })\nconst wire = serializeRpcWireError(original, { report: console.error })\nconst restored = deserializeRpcWireError(wire)\nif (restored instanceof AggregateError) {\n  console.log(restored.cause === restored.errors[0])\n  console.log(restored.stack === original.stack)\n}"
        }
      ]
    }
  },
  'rpc-contract:index:tagRpcError': {
    en: {
      purpose:
        'Attach endpoint diagnostic source/code to an existing native Error without replacing name, message, stack or object identity.',
      quickStart:
        "import { tagRpcError } from '@migaia/rpc-contract/errors'\nimport { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'\nconst error = tagRpcError(\n  new TypeError('invalid amount'),\n  RpcCoreErrorCode.invalidConfig,\n)",
      options: [],
      scenarios: [
        'Tag an existing TypeError while keeping instanceof behavior and exact identity.',
        'Expose a chosen endpoint semantic code without reconstructing the original native failure.'
      ],
      avoidWhen: [
        'Use identifyRpcBoundaryFailure when a complete foreign identity must remain unchanged.',
        'Do not tag an arbitrary Error to acquire owner-held cancellation or retry provenance.'
      ]
    },
    zh: {
      purpose:
        '把端点来源及选定核心码附到既有原生 Error 上，保留对象、名称、消息和堆栈身份；不可附加时由调用边界处理失败。',
      quickStart:
        "import { tagRpcError } from '@migaia/rpc-contract/errors'\nimport { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'\nconst error = tagRpcError(\n  new TypeError('invalid amount'),\n  RpcCoreErrorCode.invalidConfig,\n)",
      options: [],
      scenarios: [
        '为既有 TypeError 附码，同时保留 instanceof 行为与精确身份。',
        '无需重建原生失败即可公开选定端点语义码。'
      ],
      avoidWhen: [
        '完整外部来源身份需要保持不变时，应使用 identifyRpcBoundaryFailure。',
        '不要通过给任意 Error 附码来获得所有者持有的取消或重试来源。'
      ]
    }
  },
  'rpc-contract:interfaces:IpcSendClass': {
    en: {
      purpose:
        'The existing data/control lane vocabulary borrowed by native Process admission. Semantic frame ownership selects the lane before encoding; the constants themselves perform no queueing, scheduling or physical send.',
      quickStart:
        "import { IpcSendClass } from '@migaia/rpc-contract/interfaces'\n\nconst values = IpcSendClass",
      options: [],
      scenarios: [
        'Keep control traffic on its reserved capacity when the data lane is saturated.',
        'Carry the already selected lane through a queued write without reclassifying encoded bytes.'
      ],
      avoidWhen: [
        'Do not infer a lane by scanning arbitrary encoded payloads or trusting remote lane claims.',
        'Do not treat a control lane value as proof of message admission or write completion.'
      ]
    },
    zh: {
      purpose:
        '这是原生 Process 准入借用的 data/control 通道词汇，由语义帧所有者在编码前选择通道；常量本身不排队、调度或执行物理发送。',
      quickStart:
        "import { IpcSendClass } from '@migaia/rpc-contract/interfaces'\n\nconst values = IpcSendClass",
      options: [],
      scenarios: [
        '业务通道饱和时，让控制流量使用其保留容量。',
        '让已经选定的通道穿过排队写入，不重新检查编码字节分类。'
      ],
      avoidWhen: [
        '不要扫描任意编码载荷或信任远端自报通道来推断类别。',
        '不要把控制通道值当作消息准入或写入完成证明。'
      ]
    }
  },
  'rpc-contract:interfaces:RpcCallFeatureKind': {
    en: {
      purpose: 'The sole selector recognizes complete executing timeout and retry instances.',
      quickStart:
        "import { RpcCallFeatureKind } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcCallFeatureKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '唯一选择器识别完整执行超时及重试实例。',
      quickStart:
        "import { RpcCallFeatureKind } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcCallFeatureKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:interfaces:RpcCarrierEncoding': {
    en: {
      purpose: 'Raw native representation labels differ from selected semantic codec ids.',
      quickStart:
        "import { RpcCarrierEncoding } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcCarrierEncoding",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '原始原生表示标签与已选语义编解码身份不同。',
      quickStart:
        "import { RpcCarrierEncoding } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcCarrierEncoding",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:interfaces:RpcCarrierPlatform': {
    en: {
      purpose:
        'Actual acquired native platform labels are diagnostics, never authenticated capabilities.',
      quickStart:
        "import { RpcCarrierPlatform } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcCarrierPlatform",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '实际已获取原生平台标签仅作诊断，不是认证能力。',
      quickStart:
        "import { RpcCarrierPlatform } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcCarrierPlatform",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:interfaces:RpcCarrierTopology': {
    en: {
      purpose:
        'Native resource acquisition supplies actual exclusive, multiplexed or broadcast topology.',
      quickStart:
        "import { RpcCarrierTopology } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcCarrierTopology",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '原生资源获取提供实际独占、多路复用或广播拓扑。',
      quickStart:
        "import { RpcCarrierTopology } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcCarrierTopology",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:interfaces:RpcProbeAuthentication': {
    en: {
      purpose: 'Only the actually installed auth owner supplies protection facts.',
      quickStart:
        "import { RpcProbeAuthentication } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeAuthentication",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '只有实际安装的认证所有者提供保护事实。',
      quickStart:
        "import { RpcProbeAuthentication } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeAuthentication",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:interfaces:RpcProbeLifecycle': {
    en: {
      purpose: 'Actual Session handshake, ready publication and closing supply lifecycle events.',
      quickStart:
        "import { RpcProbeLifecycle } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeLifecycle",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '实际会话握手、就绪发布及关闭提供生命周期事件。',
      quickStart:
        "import { RpcProbeLifecycle } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeLifecycle",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:interfaces:RpcProbeObservationKind': {
    en: {
      purpose: 'Readonly facts use the same flow observer without a second pipeline.',
      quickStart:
        "import { RpcProbeObservationKind } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeObservationKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '只读事实使用同一信息流观察者，不创建第二流水线。',
      quickStart:
        "import { RpcProbeObservationKind } from '@migaia/rpc-contract/interfaces'\n\nconst values = RpcProbeObservationKind",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:interfaces:rpcCarrierWriteFacts': {
    en: {
      purpose:
        'Project control/data lane and explicit trace from admitted semantic headers without looking through codec output.',
      quickStart:
        "import { normalizeRpcFrame, RpcWireProfile } from '@migaia/rpc-contract/protocol'\n\nconst frame = normalizeRpcFrame({\n  profile: RpcWireProfile,\n  kind: 'call',\n  id: 'job-1',\n  route: {\n    applicationVersion: '1',\n    senderId: 'caller',\n    receiverId: 'provider',\n    targetId: 'provider',\n    sentAt: 0,\n    trace: 'checkout-1',\n  },\n  task: {\n    mode: 'request',\n    callerId: 'caller',\n    method: 'math.add',\n    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },\n    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },\n  },\n  options: {},\n  payload: [20, 22],\n})\nimport { rpcCarrierWriteFacts } from '@migaia/rpc-contract/interfaces'\nconst write = rpcCarrierWriteFacts(frame)",
      options: [],
      scenarios: [
        'Choose the existing control lane for handshake, cancellation and directory traffic.',
        'Carry an explicit admitted route trace into physical write options.'
      ],
      avoidWhen: [
        'Do not classify an opaque codec output by inspecting its payload with this helper.',
        'Do not treat the returned lane as a queue admission or physical-write receipt.'
      ]
    },
    zh: {
      purpose:
        '从已接纳语义帧头投影真实 control/data 发送类别与显式 trace，供载体借用；不查看编码输出，也不安排队列或发送。',
      quickStart:
        "import { normalizeRpcFrame, RpcWireProfile } from '@migaia/rpc-contract/protocol'\n\nconst frame = normalizeRpcFrame({\n  profile: RpcWireProfile,\n  kind: 'call',\n  id: 'job-1',\n  route: {\n    applicationVersion: '1',\n    senderId: 'caller',\n    receiverId: 'provider',\n    targetId: 'provider',\n    sentAt: 0,\n    trace: 'checkout-1',\n  },\n  task: {\n    mode: 'request',\n    callerId: 'caller',\n    method: 'math.add',\n    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },\n    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },\n  },\n  options: {},\n  payload: [20, 22],\n})\nimport { rpcCarrierWriteFacts } from '@migaia/rpc-contract/interfaces'\nconst write = rpcCarrierWriteFacts(frame)",
      options: [],
      scenarios: [
        '为握手、取消及目录流量选择已有控制通道。',
        '把路由中显式接纳的 trace 传入物理写入选项。'
      ],
      avoidWhen: [
        '不要借此辅助函数检查不透明编码输出的载荷来分类。',
        '返回的通道类别不是队列准入或实际物理写出回执。'
      ]
    }
  },
  'rpc-contract:interfaces:rpcProbeEnvelopeFacts': {
    en: {
      purpose:
        'Project compact admitted id, task method and route addresses for readonly observation.',
      quickStart:
        "import { normalizeRpcFrame, RpcWireProfile } from '@migaia/rpc-contract/protocol'\n\nconst frame = normalizeRpcFrame({\n  profile: RpcWireProfile,\n  kind: 'call',\n  id: 'job-1',\n  route: {\n    applicationVersion: '1',\n    senderId: 'caller',\n    receiverId: 'provider',\n    targetId: 'provider',\n    sentAt: 0,\n    trace: 'checkout-1',\n  },\n  task: {\n    mode: 'request',\n    callerId: 'caller',\n    method: 'math.add',\n    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },\n    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },\n  },\n  options: {},\n  payload: [20, 22],\n})\nimport { rpcProbeEnvelopeFacts } from '@migaia/rpc-contract/interfaces'\nconst facts = 'route' in frame ? rpcProbeEnvelopeFacts(frame) : undefined",
      options: [],
      scenarios: [
        'Correlate an observed semantic call with its admitted message id and method.',
        'Expose sender, target and receiver addresses without retaining the full payload graph.'
      ],
      avoidWhen: [
        'Do not regard copied route strings as authenticated sender authority.',
        'Use the observing owner for time, endpoint identity and sequence; this projection does not mint them.'
      ]
    },
    zh: {
      purpose:
        '从已接纳信封投影消息标识、方法、发送及接收地址与 trace，产生只读观察所需的紧凑事实，不分配探针序号或读取业务载荷。',
      quickStart:
        "import { normalizeRpcFrame, RpcWireProfile } from '@migaia/rpc-contract/protocol'\n\nconst frame = normalizeRpcFrame({\n  profile: RpcWireProfile,\n  kind: 'call',\n  id: 'job-1',\n  route: {\n    applicationVersion: '1',\n    senderId: 'caller',\n    receiverId: 'provider',\n    targetId: 'provider',\n    sentAt: 0,\n    trace: 'checkout-1',\n  },\n  task: {\n    mode: 'request',\n    callerId: 'caller',\n    method: 'math.add',\n    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },\n    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },\n  },\n  options: {},\n  payload: [20, 22],\n})\nimport { rpcProbeEnvelopeFacts } from '@migaia/rpc-contract/interfaces'\nconst facts = 'route' in frame ? rpcProbeEnvelopeFacts(frame) : undefined",
      options: [],
      scenarios: [
        '把语义调用观察与已接纳消息标识和方法关联。',
        '无需保留完整载荷图即可展示发送方、目标及接收方地址。'
      ],
      avoidWhen: [
        '不要把复制的路由字符串当作已认证发送权限。',
        '时间、端点身份与序号由观察所有者提供，此投影不会签发这些事实。'
      ]
    }
  },
  'rpc-contract:interfaces:rpcProbeEnvelopeKind': {
    en: {
      purpose:
        'Map the single operational/control grammar to canonical probe interaction ordinals.',
      quickStart:
        "import { normalizeRpcFrame, RpcWireProfile } from '@migaia/rpc-contract/protocol'\n\nconst frame = normalizeRpcFrame({\n  profile: RpcWireProfile,\n  kind: 'call',\n  id: 'job-1',\n  route: {\n    applicationVersion: '1',\n    senderId: 'caller',\n    receiverId: 'provider',\n    targetId: 'provider',\n    sentAt: 0,\n    trace: 'checkout-1',\n  },\n  task: {\n    mode: 'request',\n    callerId: 'caller',\n    method: 'math.add',\n    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },\n    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },\n  },\n  options: {},\n  payload: [20, 22],\n})\nimport { rpcProbeEnvelopeKind } from '@migaia/rpc-contract/interfaces'\nconst kind = 'task' in frame ? rpcProbeEnvelopeKind(frame) : undefined",
      options: [],
      scenarios: [
        'Label an observed notify call separately from a result-bearing request.',
        'Map stream item and terminal events to the existing streamChunk and streamClose kinds.'
      ],
      avoidWhen: [
        'Do not use a probe ordinal as a wire discriminator when encoding messages.',
        'Do not feed arbitrary raw native values here before semantic frame admission.'
      ]
    },
    zh: {
      purpose:
        '将唯一协议的已接纳操作或控制帧映射为规范探针交互序号，区分请求、通知、取消与流阶段；不创建观察订阅或执行对应业务。',
      quickStart:
        "import { normalizeRpcFrame, RpcWireProfile } from '@migaia/rpc-contract/protocol'\n\nconst frame = normalizeRpcFrame({\n  profile: RpcWireProfile,\n  kind: 'call',\n  id: 'job-1',\n  route: {\n    applicationVersion: '1',\n    senderId: 'caller',\n    receiverId: 'provider',\n    targetId: 'provider',\n    sentAt: 0,\n    trace: 'checkout-1',\n  },\n  task: {\n    mode: 'request',\n    callerId: 'caller',\n    method: 'math.add',\n    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },\n    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' },\n  },\n  options: {},\n  payload: [20, 22],\n})\nimport { rpcProbeEnvelopeKind } from '@migaia/rpc-contract/interfaces'\nconst kind = 'task' in frame ? rpcProbeEnvelopeKind(frame) : undefined",
      options: [],
      scenarios: [
        '把观察到的通知与带结果请求分别标记。',
        '把流项目及终态映射为已有 streamChunk 与 streamClose 类别。'
      ],
      avoidWhen: [
        '编码消息时不要把探针序号当作线上判别字段。',
        '不要在语义帧准入前把任意原生值传入此处。'
      ]
    }
  },
  'rpc-contract:portable:RpcPortableField': {
    en: {
      purpose: 'Reserved portable bytes tag discriminator and canonical data field.',
      quickStart:
        "import { RpcPortableField } from '@migaia/rpc-contract/portable'\n\nconst values = RpcPortableField",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '保留可移植字节标签判别值及规范数据字段。',
      quickStart:
        "import { RpcPortableField } from '@migaia/rpc-contract/portable'\n\nconst values = RpcPortableField",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:portable:RpcPortableViolation': {
    en: {
      purpose: 'Pure portable failures preserve original binary, ancestor and prototype causes.',
      quickStart:
        "import { RpcPortableViolation } from '@migaia/rpc-contract/portable'\n\nconst values = RpcPortableViolation",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '纯可移植失败保留原二进制、祖先及原型原因。',
      quickStart:
        "import { RpcPortableViolation } from '@migaia/rpc-contract/portable'\n\nconst values = RpcPortableViolation",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:portable:assertRpcPortableRecordKey': {
    en: {
      purpose: 'Reserve $rpc for complete admitted bytes tags rather than ordinary records.',
      quickStart:
        "import {\n  assertRpcPortableRecordKey,\n  raiseRpcPortableViolation,\n} from '@migaia/rpc-contract/portable'\nassertRpcPortableRecordKey('amount', { reject: raiseRpcPortableViolation })",
      options: [],
      scenarios: [
        'Reject an ordinary business record that tries to use the reserved bytes-tag marker.',
        'Reuse the same key rule inside a custom walker using the Contract portable policy.'
      ],
      avoidWhen: [
        'Do not reject an already admitted atomic bytes tag by treating its marker as an ordinary field.',
        'Do not use a key-only check instead of validating the complete value or record prototype.'
      ]
    },
    zh: {
      purpose:
        '在普通可移植记录字段写入前检查保留键，禁止把 $rpc 当作业务键；完整字节标签由记录捕获策略整体识别，而不是逐键放行。',
      quickStart:
        "import {\n  assertRpcPortableRecordKey,\n  raiseRpcPortableViolation,\n} from '@migaia/rpc-contract/portable'\nassertRpcPortableRecordKey('amount', { reject: raiseRpcPortableViolation })",
      options: [],
      scenarios: [
        '拒绝尝试使用保留字节标签标记的普通业务记录。',
        '在使用 Contract 可移植策略的遍历器中复用相同键规则。'
      ],
      avoidWhen: [
        '不要把已接纳原子字节标签的标记当作普通字段再次拒绝。',
        '仅检查键不能替代完整值或记录原型校验。'
      ]
    }
  },
  'rpc-contract:portable:captureRpcWirePortableRecord': {
    en: {
      purpose:
        'Shallowly snapshot parent enumerable string-key values before descendants, preserving getter order. Arrays defer to the walker.',
      quickStart:
        "import {\n  captureRpcWirePortableRecord,\n  raiseRpcPortableViolation,\n} from '@migaia/rpc-contract/portable'\nimport { isCanonicalBase64url } from '@migaia/serialize/core'\nconst captured = captureRpcWirePortableRecord(\n  { amount: 42 },\n  {\n    reject: raiseRpcPortableViolation,\n    isCanonicalBase64url,\n  },\n)",
      options: [],
      scenarios: [
        'Keep parent field getters ahead of nested child traversal in the ordinary wire snapshot policy.',
        'Reuse the established shallow record projection while the surrounding walker owns recursion.'
      ],
      avoidWhen: [
        'Use the negotiated-native policy when getters must be rejected rather than evaluated.',
        'Do not treat this shallow capture as a complete deep snapshot or array parser.'
      ]
    },
    zh: {
      purpose:
        '对非数组普通记录先按自有可枚举键顺序浅捕获全部父字段值，再由遍历器访问后代，保持访问器读取次序及字节标签整体识别。',
      quickStart:
        "import {\n  captureRpcWirePortableRecord,\n  raiseRpcPortableViolation,\n} from '@migaia/rpc-contract/portable'\nimport { isCanonicalBase64url } from '@migaia/serialize/core'\nconst captured = captureRpcWirePortableRecord(\n  { amount: 42 },\n  {\n    reject: raiseRpcPortableViolation,\n    isCanonicalBase64url,\n  },\n)",
      options: [],
      scenarios: [
        '在普通线上快照策略中，让父字段访问器先于子值遍历执行。',
        '由外围遍历器拥有递归时，复用既有浅记录投影。'
      ],
      avoidWhen: [
        '必须拒绝而不是执行访问器时，应使用协商原生策略。',
        '浅捕获不是完整深快照，也不是数组解析器。'
      ]
    }
  },
  'rpc-contract:portable:raiseRpcPortableViolation': {
    en: {
      purpose:
        'Route the existing portable policy violation while preserving raw binary/ancestor failures and canonical Contract causes.',
      quickStart:
        "import {\n  raiseRpcPortableViolation,\n  RpcPortableViolation,\n} from '@migaia/rpc-contract/portable'\nexport function rejectValue(cause: unknown): never {\n  return raiseRpcPortableViolation(RpcPortableViolation.invalid, cause)\n}",
      options: [],
      scenarios: [
        'Translate an invalid scalar or record rule failure from the existing portable walker.',
        'Retain a native-binary guard failure as the actual underlying diagnostic cause.'
      ],
      avoidWhen: [
        'Do not call this throwing boundary to test whether a value is supported; run the actual admission operation.',
        'Do not invent a second violation vocabulary outside the existing portable policy.'
      ]
    },
    zh: {
      purpose:
        '把已有可移植策略违规交给规范错误分类，保留原始二进制守卫和祖先失败原因；显式元数据只记录诊断，不创建另一遍遍历。',
      quickStart:
        "import {\n  raiseRpcPortableViolation,\n  RpcPortableViolation,\n} from '@migaia/rpc-contract/portable'\nexport function rejectValue(cause: unknown): never {\n  return raiseRpcPortableViolation(RpcPortableViolation.invalid, cause)\n}",
      options: [],
      scenarios: [
        '转换既有可移植遍历器产生的非法标量或记录规则失败。',
        '把原生二进制守卫失败保留为实际底层诊断原因。'
      ],
      avoidWhen: [
        '不要用此抛错边界探测值是否支持，应运行实际准入操作。',
        '不要在既有可移植策略之外发明第二套违规词汇。'
      ]
    }
  },
  'rpc-contract:portable:rpcNativePortableStrategy': {
    en: {
      purpose:
        'Pure strict own-data policy preserving genuine native leaves; negotiated support and transfer still belong to the carrier.',
      quickStart:
        "import { createPortableWalker } from '@migaia/serialize'\nimport { rpcNativePortableStrategy } from '@migaia/rpc-contract/portable'\nconst walker = createPortableWalker(rpcNativePortableStrategy)\nconst value = walker.value({ amount: 42 })",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '纯严格自有数据策略，保留真实原生叶子，协商支持及转移仍属于载体。',
      quickStart:
        "import { createPortableWalker } from '@migaia/serialize'\nimport { rpcNativePortableStrategy } from '@migaia/rpc-contract/portable'\nconst walker = createPortableWalker(rpcNativePortableStrategy)\nconst value = walker.value({ amount: 42 })",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:portable:rpcPortableBackingLength': {
    en: {
      purpose: 'Read intrinsic complete backing byteLength without trusting a public property.',
      quickStart:
        "import { rpcPortableBackingLength } from '@migaia/rpc-contract/portable'\nconst length = rpcPortableBackingLength(new ArrayBuffer(8))",
      options: [],
      scenarios: [
        'Account for the entire backing buffer rather than only one subview when the policy requires it.',
        'Read a genuine buffer length without executing a shadowed public byteLength getter.'
      ],
      avoidWhen: [
        'Do not pass arbitrary objects as a branding test; the intrinsic requires a real admitted buffer.',
        'Use rpcPortableViewLength when the budget concerns only the visible Uint8Array window.'
      ]
    },
    zh: {
      purpose:
        '对已通过品牌接纳的 ArrayBuffer 调用内在长度读取器，取得完整背板字节数，不信任调用者遮蔽属性，也不遍历其内容。',
      quickStart:
        "import { rpcPortableBackingLength } from '@migaia/rpc-contract/portable'\nconst length = rpcPortableBackingLength(new ArrayBuffer(8))",
      options: [],
      scenarios: [
        '策略要求时按完整背板计额，而非只按一个子视图。',
        '读取真实缓冲区长度时不执行被遮蔽的公开 byteLength 访问器。'
      ],
      avoidWhen: [
        '不要把任意对象传入充当品牌检查，内在读取要求已接纳真实缓冲区。',
        '配额只针对 Uint8Array 可见窗口时，应使用 rpcPortableViewLength。'
      ]
    }
  },
  'rpc-contract:portable:rpcPortableViewLength': {
    en: {
      purpose: 'Read intrinsic visible Uint8Array byteLength without traversing its contents.',
      quickStart:
        "import { rpcPortableViewLength } from '@migaia/rpc-contract/portable'\nconst length = rpcPortableViewLength(new Uint8Array(8))",
      options: [],
      scenarios: [
        'Measure a typed-array subview according to its visible byte window.',
        'Avoid trusting an application-defined byteLength property on a genuine byte view.'
      ],
      avoidWhen: [
        'Use rpcPortableBackingLength when the quota charges the complete ArrayBuffer storage.',
        'Do not use the intrinsic as a generic byte-source adapter or a content validator.'
      ]
    },
    zh: {
      purpose:
        '对已接纳的 Uint8Array 使用内在字节长度读取器，取得当前可见视图大小；不扫描字节，也不把整个背板大小误算为视图长度。',
      quickStart:
        "import { rpcPortableViewLength } from '@migaia/rpc-contract/portable'\nconst length = rpcPortableViewLength(new Uint8Array(8))",
      options: [],
      scenarios: [
        '按类型化数组子视图的可见字节窗口计量。',
        '对真实字节视图计量时不信任应用定义的 byteLength 属性。'
      ],
      avoidWhen: [
        '配额按完整 ArrayBuffer 存储计费时，应使用 rpcPortableBackingLength。',
        '不要把内在读取当作通用字节源适配器或内容校验器。'
      ]
    }
  },
  'rpc-contract:portable:rpcWirePortableStrategy': {
    en: {
      purpose:
        'Pure serialize-walker policy for finite scalars, parent-before-child getter capture, frozen snapshots and inline bytes tags.',
      quickStart:
        "import { createPortableWalker } from '@migaia/serialize'\nimport { rpcWirePortableStrategy } from '@migaia/rpc-contract/portable'\nconst walker = createPortableWalker(rpcWirePortableStrategy)\nconst value = walker.value({ amount: 42 })",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose:
        '供序列化遍历器使用的纯策略，负责有限标量、父先子后访问器捕获、冻结快照及内联字节标签。',
      quickStart:
        "import { createPortableWalker } from '@migaia/serialize'\nimport { rpcWirePortableStrategy } from '@migaia/rpc-contract/portable'\nconst walker = createPortableWalker(rpcWirePortableStrategy)\nconst value = walker.value({ amount: 42 })",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:schema-wire-error:default': {
    en: {
      purpose:
        'Published JSON Schema for the flat root/nodes protocol error graph. Load it as JSON data in your existing validator. normalizeRpcWireError additionally enforces graph indices and aggregate budgets; neither schema nor normalization authenticates a source or reconstructs local provenance.',
      quickStart:
        "import schema from '@migaia/rpc-contract/schema/wire-error' with { type: 'json' }\nconst schemaId = schema.$id",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose:
        '平面根及节点协议错误图随包发布的数据模式。把它作为数据交给既有校验器；纯错误图规范化器还执行图索引及累计预算检查。模式及规范化都不认证来源或重建本地来源权限。',
      quickStart:
        "import schema from '@migaia/rpc-contract/schema/wire-error' with { type: 'json' }\nconst schemaId = schema.$id",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-contract:schema-protocol:default': {
    en: {
      purpose:
        'Published JSON Schema for the one semantic handshake/call/group/control/directory grammar. Structural validation is only the data entry: pure normalizers and actual Session/task owners still enforce cross-field, native-capability, generation and lifecycle constraints.',
      quickStart:
        "import schema from '@migaia/rpc-contract/schema/protocol' with { type: 'json' }\nconst schemaId = schema.$id",
      options: [],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose:
        '唯一语义握手、调用、分组、控制及目录语法随包发布的数据模式。结构校验只是数据入口，纯规范化器及实际会话任务所有者仍执行字段关联、原生能力、代际及生命周期约束。',
      quickStart:
        "import schema from '@migaia/rpc-contract/schema/protocol' with { type: 'json' }\nconst schemaId = schema.$id",
      options: [],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-plugin-process:index:isProcessChild': {
    en: {
      purpose:
        'Read the native launcher discovery marker for same-entry Process startup without opening IO. A retained positive classification survives marker consumption; it does not verify credentials or grant parent transport ownership.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      options: [],
      scenarios: [
        'Branch before parent-only top-level work when using a supported spawn:true entry.',
        'Select the genuine child connectToParent path after native launcher discovery.'
      ],
      avoidWhen: [
        'Do not use this boolean as authentication of a remote process or a business request.',
        'Do not set a copied marker to manufacture child ownership; use the actual launch/bootstrap path.'
      ]
    },
    zh: {
      purpose:
        '读取原生启动器发现标记，供同一入口区分进程父子分支，不打开 IO；消费标记后保留正分类，但该判断不验证凭据，也不授予父连接所有权。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      options: [],
      scenarios: [
        '使用受支持的 spawn:true 入口时，在父端专属顶层工作之前分支。',
        '原生启动器完成发现后，选择真实子端 connectToParent 路径。'
      ],
      avoidWhen: [
        '不要把此布尔值作为远端进程或业务请求已经认证的证明。',
        '不要复制标记来制造子端所有权，应使用实际启动及引导路径。'
      ]
    }
  },
  'rpc-plugin-process:index:processPlugin': {
    en: {
      purpose:
        'Define one cold Process transport from exactly one spawn, connect.target, listen or genuine connectToParent source. Installation acquires its actual native IO and supervision; Host owns Sessions, directory admission and business calls.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'base',
          description: 'Module URL used to resolve a relative `entry`.',
          whenToUse: 'Module URL used to resolve a relative `entry`.'
        },
        {
          name: 'command',
          description: 'Executable to run instead of `entry`, e.g. `python3`.',
          whenToUse: 'Executable to run instead of `entry`, e.g. `python3`.'
        },
        {
          name: 'args',
          description: 'Arguments of `command`, or extra arguments.',
          whenToUse: 'Arguments of `command`, or extra arguments.'
        },
        {
          name: 'cwd',
          description:
            'Working-directory path passed to the native child launcher; controls child-process relative paths without changing the local module-resolution base.',
          whenToUse:
            'Working-directory path passed to the native child launcher; controls child-process relative paths without changing the local module-resolution base.'
        },
        {
          name: 'env',
          description: '`{ inherit, set }`: variable names to inherit and values to set.',
          whenToUse: '`{ inherit, set }`: variable names to inherit and values to set.'
        },
        {
          name: 'wrap',
          description:
            'Rewrites the computed launch command (e.g. to run inside `sandbox-exec` or `bwrap`) on every launch, restart and replace. Must keep stdin/stdout and environment, and forward the exit code.',
          whenToUse:
            'Rewrites the computed launch command (e.g. to run inside `sandbox-exec` or `bwrap`) on every launch, restart and replace. Must keep stdin/stdout and environment, and forward the exit code.'
        },
        {
          name: 'stdio',
          description:
            'stdio routing; default `{ stdin: "channel", stdout: "channel", stderr: "drain" }`.',
          whenToUse:
            'stdio routing; default `{ stdin: "channel", stdout: "channel", stderr: "drain" }`.'
        },
        {
          name: 'limits',
          description: 'Limits such as `callWallTimeMs` per call.',
          whenToUse: 'Limits such as `callWallTimeMs` per call.'
        },
        {
          name: 'permissions',
          description: 'Runtime permissions (Deno).',
          whenToUse: 'Runtime permissions (Deno).'
        },
        {
          name: 'token',
          description:
            'Shared secret checked in the handshake; required for TCP, explicit socket paths and Windows pipes. Generate it per deployment and never log it.',
          whenToUse:
            'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
          defaultValue: 'Not set: named endpoints rely on OS user permissions.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'supervision',
          description:
            'Overrides the original supervisor restart, startup, stop and other policies; retains the same execution-unit owner without installing another supervisor.',
          whenToUse:
            'Overrides the original supervisor restart, startup, stop and other policies; retains the same execution-unit owner without installing another supervisor.'
        },
        {
          name: 'onNotice',
          description:
            'Receives expected launcher notices, such as the best-effort termination warning, instead of `report`.',
          whenToUse:
            'Receives expected launcher notices, such as the best-effort termination warning, instead of `report`.'
        },
        {
          name: 'stdio.stdin',
          description:
            'Route child input through the RPC channel or ignore it. Native stdio and bootstrap ownership remain with the process launcher.',
          whenToUse:
            'Route child input through the RPC channel or ignore it. Native stdio and bootstrap ownership remain with the process launcher.',
          defaultValue: '`channel`: retain the channel input.'
        },
        {
          name: 'stdio.stdout',
          description:
            'Select channel output, continuously drained output, or ignored output without changing the launcher owner.',
          whenToUse:
            'Select channel output, continuously drained output, or ignored output without changing the launcher owner.',
          defaultValue: '`channel`: expose stdout as the RPC byte channel.'
        },
        {
          name: 'stdio.stderr',
          description:
            'Choose whether the native launcher drains or ignores child stderr; stderr is never the RPC response channel.',
          whenToUse:
            'Choose whether the native launcher drains or ignores child stderr; stderr is never the RPC response channel.',
          defaultValue: '`drain`: consume stderr from process startup.'
        },
        {
          name: 'limits.memoryBytes',
          description:
            'Requested process memory limit in bytes, forwarded to the original supervisor and native launcher; unsupported enforcement follows the isolation policy.',
          whenToUse:
            'Requested process memory limit in bytes, forwarded to the original supervisor and native launcher; unsupported enforcement follows the isolation policy.',
          defaultValue: 'Omitted: no explicit memory limit is requested.'
        },
        {
          name: 'limits.cpuTimeMs',
          description:
            'Requested process CPU time limit in milliseconds; native enforcement depends on the chosen launcher capability and isolation policy.',
          whenToUse:
            'Requested process CPU time limit in milliseconds; native enforcement depends on the chosen launcher capability and isolation policy.',
          defaultValue: 'Omitted: no explicit CPU time limit is requested.'
        },
        {
          name: 'limits.callWallTimeMs',
          description:
            'Wall-clock cap for a call, consumed by the existing RPC caller rather than enforced as an operating-system process limit.',
          whenToUse:
            'Wall-clock cap for a call, consumed by the existing RPC caller rather than enforced as an operating-system process limit.',
          defaultValue: 'Omitted: no additional call wall-time cap is requested.'
        },
        {
          name: 'report',
          description:
            'Receives native background and cleanup failures; operation rejections retain original causes.',
          whenToUse:
            'Receives native background and cleanup failures; operation rejections retain original causes.',
          defaultValue: 'Omitted: configured Host reporter, then effective default.'
        },
        {
          name: 'verify',
          description:
            'Listener side: `(auth, peer) => principalId` validating the client credential; throw to reject.',
          whenToUse:
            'Require an application principal for a listener rather than relying only on same-user socket permissions.',
          defaultValue: 'Not set: the `token` comparison is used.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'connectTimeoutMs',
          description:
            'Original dial/named-lookup wait budget, separate from connect.timeoutMs handshake.',
          whenToUse:
            'Original dial/named-lookup wait budget, separate from connect.timeoutMs handshake.',
          defaultValue: 'Omitted: original short-source default 5000 ms.',
          example:
            "import { randomUUID } from 'node:crypto'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\n\nconst address = 'service-' + randomUUID()\nconst server = await createRpcHost({\n  plugins: [processPlugin({ listen: address })],\n  provide: { double: (value: number) => value * 2 },\n})\ntry {\n  const client = await createRpcHost({\n    self: { name: 'client-a', instanceId: randomUUID() },\n    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],\n    provide: { clientValue: (value: string) => 'client:' + value },\n  })\n  try {\n    console.log(await client.process.request('double', 21))\n    console.log(await server.process.send('client-a', 'clientValue', 'ready'))\n  } finally {\n    await client.close()\n  }\n} finally {\n  await server.close()\n}"
        },
        {
          name: 'name',
          description: 'Local native registration name, separate from accepted remote identity.',
          whenToUse: 'Local native registration name, separate from accepted remote identity.',
          defaultValue: 'Omitted: the native registration default.'
        },
        {
          name: 'expose',
          description:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          whenToUse:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          defaultValue: 'Omitted: no ordinary Feature output selected.'
        },
        {
          name: 'connect',
          description:
            'connect.target selects a native source. connect.timeoutMs without target only decorates the selected source handshake.',
          whenToUse:
            'connect.target selects a native source. connect.timeoutMs without target only decorates the selected source handshake.',
          defaultValue: 'Omitted: original handshake policy.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'connect.timeoutMs',
          description:
            'One finite nonnegative millisecond budget shared by identity and capability preparation; phases do not reset it, and it does not set business-call or task-stop deadlines.',
          whenToUse:
            'One finite nonnegative millisecond budget shared by identity and capability preparation; phases do not reset it, and it does not set business-call or task-stop deadlines.',
          defaultValue: 'Omitted: original source defaults.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'spawn',
          description:
            'Current entry, explicit entry, short options, or original full native source. No complete callable object is a raw source.',
          whenToUse:
            'Current entry, explicit entry, short options, or original full native source. No complete callable object is a raw source.',
          defaultValue: 'Absent in parent/connect/listen modes.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'connectToParent',
          description: 'true only in the genuine native child, using actual first-frame authority.',
          whenToUse: 'true only in the genuine native child, using actual first-frame authority.',
          defaultValue: 'Absent outside parent connection mode.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'connect.target',
          description: 'Explicit named, socket or original native outbound source.',
          whenToUse: 'Explicit named, socket or original native outbound source.',
          defaultValue: 'Required in outbound connect mode only.',
          example:
            "import { randomUUID } from 'node:crypto'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\n\nconst address = 'service-' + randomUUID()\nconst server = await createRpcHost({\n  plugins: [processPlugin({ listen: address })],\n  provide: { double: (value: number) => value * 2 },\n})\ntry {\n  const client = await createRpcHost({\n    self: { name: 'client-a', instanceId: randomUUID() },\n    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],\n    provide: { clientValue: (value: string) => 'client:' + value },\n  })\n  try {\n    console.log(await client.process.request('double', 21))\n    console.log(await server.process.send('client-a', 'clientValue', 'ready'))\n  } finally {\n    await client.close()\n  }\n} finally {\n  await server.close()\n}"
        },
        {
          name: 'listen',
          description:
            'Original named/socket listener admitting independent bidirectional sessions.',
          whenToUse: 'Original named/socket listener admitting independent bidirectional sessions.',
          defaultValue: 'Absent outside listen mode.',
          example:
            "import { randomUUID } from 'node:crypto'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\n\nconst address = 'service-' + randomUUID()\nconst server = await createRpcHost({\n  plugins: [processPlugin({ listen: address })],\n  provide: { double: (value: number) => value * 2 },\n})\ntry {\n  const client = await createRpcHost({\n    self: { name: 'client-a', instanceId: randomUUID() },\n    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],\n    provide: { clientValue: (value: string) => 'client:' + value },\n  })\n  try {\n    console.log(await client.process.request('double', 21))\n    console.log(await server.process.send('client-a', 'clientValue', 'ready'))\n  } finally {\n    await client.close()\n  }\n} finally {\n  await server.close()\n}"
        },
        {
          name: 'namespace',
          description: 'Unique Host property exposing this transport calls and extensions.',
          whenToUse: 'Unique Host property exposing this transport calls and extensions.',
          defaultValue: 'Omitted: the factory namespace.'
        },
        {
          name: 'features',
          description:
            'Complete call and supported native feature definitions scoped to this transport. Per-call timeout and retry take instances or false.',
          whenToUse:
            'Complete call and supported native feature definitions scoped to this transport. Per-call timeout and retry take instances or false.',
          defaultValue: 'Omitted: no optional policy installed by this field.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'parentLoss',
          description: 'Actual child parent-loss exit, optional grace and native liveness probe.',
          whenToUse: 'Actual child parent-loss exit, optional grace and native liveness probe.',
          defaultValue: 'Omitted: the automatic child source supplies its native policy.'
        }
      ],
      scenarios: [
        'Launch a managed child and call its advertised methods through the installed process namespace.',
        'Borrow an explicit local dial or listener recipe while keeping native acquisition and cleanup with its source.'
      ],
      avoidWhen: [
        'Do not supply several source arms or a callback returning a prebuilt Peer.',
        'Use Browser transports in browser realms; this factory requires a supported server runtime.'
      ]
    },
    zh: {
      purpose:
        '通过 spawn、connect.target、listen 或真实 connectToParent 四种来源之一声明冷进程传输，安装时获取实际原生 IO 与监督资源；会话、目录准入和业务调用仍由 Host 拥有。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'base',
          description: '解析相对 `entry` 时使用的模块 URL。',
          whenToUse: '解析相对 `entry` 时使用的模块 URL。'
        },
        {
          name: 'command',
          description: '代替 `entry` 运行的可执行程序，例如 `python3`。',
          whenToUse: '代替 `entry` 运行的可执行程序，例如 `python3`。'
        },
        {
          name: 'args',
          description: '`command` 的参数，或额外的命令行参数。',
          whenToUse: '`command` 的参数，或额外的命令行参数。'
        },
        {
          name: 'cwd',
          description:
            '传给原生启动器的子进程工作目录路径，影响子进程的相对路径解析，不改变本端模块的解析基准。',
          whenToUse:
            '传给原生启动器的子进程工作目录路径，影响子进程的相对路径解析，不改变本端模块的解析基准。'
        },
        {
          name: 'env',
          description: '`{ inherit, set }`：要继承的变量名与要设置的值。',
          whenToUse: '`{ inherit, set }`：要继承的变量名与要设置的值。'
        },
        {
          name: 'wrap',
          description:
            '在每次启动、重启与替换时改写计算出的启动命令（例如放进 `sandbox-exec` 或 `bwrap`）。必须保留 stdin/stdout 与环境变量，并转发退出码。',
          whenToUse:
            '在每次启动、重启与替换时改写计算出的启动命令（例如放进 `sandbox-exec` 或 `bwrap`）。必须保留 stdin/stdout 与环境变量，并转发退出码。'
        },
        {
          name: 'stdio',
          description:
            '子进程标准输入输出的走向；默认 `{ stdin: "channel", stdout: "channel", stderr: "drain" }`。',
          whenToUse:
            '子进程标准输入输出的走向；默认 `{ stdin: "channel", stdout: "channel", stderr: "drain" }`。'
        },
        {
          name: 'limits',
          description: '资源限制，例如单次调用的 `callWallTimeMs`。',
          whenToUse: '资源限制，例如单次调用的 `callWallTimeMs`。'
        },
        {
          name: 'permissions',
          description: '子进程的运行时权限设置（用于 Deno）。',
          whenToUse: '子进程的运行时权限设置（用于 Deno）。'
        },
        {
          name: 'token',
          description:
            '握手中校验的共享密钥；TCP、显式 socket 路径与 Windows 命名管道必须设置。每次部署生成，切勿写入日志。',
          whenToUse: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。',
          defaultValue: '不设置：命名端点依赖操作系统的用户权限。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'supervision',
          description:
            '覆盖原监督器的重启、启动与停止预算等策略，继续使用同一执行单元所有者，不额外创建监督器。',
          whenToUse:
            '覆盖原监督器的重启、启动与停止预算等策略，继续使用同一执行单元所有者，不额外创建监督器。'
        },
        {
          name: 'onNotice',
          description: '代替 `report` 接收预期的 launcher 提示，例如尽力终止的警告。',
          whenToUse: '代替 `report` 接收预期的 launcher 提示，例如尽力终止的警告。'
        },
        {
          name: 'stdio.stdin',
          description: '将子进程输入接入 RPC 通道或忽略，由进程启动器保留标准输入及启动帧归属。',
          whenToUse: '将子进程输入接入 RPC 通道或忽略，由进程启动器保留标准输入及启动帧归属。',
          defaultValue: '`channel`：保留通道输入。'
        },
        {
          name: 'stdio.stdout',
          description: '选择通道输出、持续排空输出或忽略输出，不改变启动器归属。',
          whenToUse: '选择通道输出、持续排空输出或忽略输出，不改变启动器归属。',
          defaultValue: '`channel`：将标准输出作为 RPC 字节通道。'
        },
        {
          name: 'stdio.stderr',
          description: '选择由原生启动器排空或忽略子进程标准错误，标准错误不会作为 RPC 响应通道。',
          whenToUse: '选择由原生启动器排空或忽略子进程标准错误，标准错误不会作为 RPC 响应通道。',
          defaultValue: '`drain`：从进程启动起持续消费标准错误。'
        },
        {
          name: 'limits.memoryBytes',
          description:
            '请求的进程内存上限，单位为字节，转交原监督器及原生启动器；不支持的强制限制沿用隔离策略。',
          whenToUse:
            '请求的进程内存上限，单位为字节，转交原监督器及原生启动器；不支持的强制限制沿用隔离策略。',
          defaultValue: '省略时不请求显式内存上限。'
        },
        {
          name: 'limits.cpuTimeMs',
          description:
            '请求的进程 CPU 时间上限，单位为毫秒，能否原生强制执行取决于所选启动器能力及隔离策略。',
          whenToUse:
            '请求的进程 CPU 时间上限，单位为毫秒，能否原生强制执行取决于所选启动器能力及隔离策略。',
          defaultValue: '省略时不请求显式 CPU 时间上限。'
        },
        {
          name: 'limits.callWallTimeMs',
          description:
            '单次调用的墙钟时间上限，由既有 RPC 调用方消费，不作为操作系统进程限制强制执行。',
          whenToUse:
            '单次调用的墙钟时间上限，由既有 RPC 调用方消费，不作为操作系统进程限制强制执行。',
          defaultValue: '省略时不增加调用墙钟时间上限。'
        },
        {
          name: 'report',
          description: '接收原生后台及清理失败；操作拒绝保留原始原因。',
          whenToUse: '接收原生后台及清理失败；操作拒绝保留原始原因。',
          defaultValue: '省略时使用宿主显式报告器，再使用有效默认报告器。'
        },
        {
          name: 'verify',
          description: '监听端：校验客户端凭据的 `(auth, peer) => principalId`；抛错表示拒绝。',
          whenToUse: '监听端需要应用主体身份，而不能仅依赖同用户套接字权限时设置。',
          defaultValue: '不设置：使用 `token` 比较。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'connectTimeoutMs',
          description: '原拨号或命名查找等待预算，与握手期限分开。',
          whenToUse: '原拨号或命名查找等待预算，与握手期限分开。',
          defaultValue: '省略时使用原简写来源默认五千毫秒。',
          example:
            "import { randomUUID } from 'node:crypto'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\n\nconst address = 'service-' + randomUUID()\nconst server = await createRpcHost({\n  plugins: [processPlugin({ listen: address })],\n  provide: { double: (value: number) => value * 2 },\n})\ntry {\n  const client = await createRpcHost({\n    self: { name: 'client-a', instanceId: randomUUID() },\n    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],\n    provide: { clientValue: (value: string) => 'client:' + value },\n  })\n  try {\n    console.log(await client.process.request('double', 21))\n    console.log(await server.process.send('client-a', 'clientValue', 'ready'))\n  } finally {\n    await client.close()\n  }\n} finally {\n  await server.close()\n}"
        },
        {
          name: 'name',
          description: '本地原生登记名称，与已接纳的远端身份分开。',
          whenToUse: '本地原生登记名称，与已接纳的远端身份分开。',
          defaultValue: '省略时使用原生登记默认名称。'
        },
        {
          name: 'expose',
          description: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          whenToUse: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          defaultValue: '省略时不选取普通功能输出。'
        },
        {
          name: 'connect',
          description: '连接目标选择原生来源；不含目标的握手超时选项仅修饰已选来源的握手。',
          whenToUse: '连接目标选择原生来源；不含目标的握手超时选项仅修饰已选来源的握手。',
          defaultValue: '省略时使用原握手策略。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'connect.timeoutMs',
          description:
            '身份与能力准备共用的一次有限非负毫秒预算，各阶段不重置期限，也不作为业务调用或任务停止期限。',
          whenToUse:
            '身份与能力准备共用的一次有限非负毫秒预算，各阶段不重置期限，也不作为业务调用或任务停止期限。',
          defaultValue: '省略时使用原来源默认。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'spawn',
          description:
            '当前入口、显式入口、简写选项或原完整原生来源，完整调用对象不能充当原始来源。',
          whenToUse: '当前入口、显式入口、简写选项或原完整原生来源，完整调用对象不能充当原始来源。',
          defaultValue: '子端、连接或监听模式不提供。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'connectToParent',
          description: '仅在真实原生子端取真值，使用实际首帧权限。',
          whenToUse: '仅在真实原生子端取真值，使用实际首帧权限。',
          defaultValue: '非连接父端模式不提供。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'\n\nif (await isProcessChild()) {\n  await createRpcHost({\n    plugins: [processPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const host = await createRpcHost({\n    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    console.log(await host.process.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'connect.target',
          description: '显式命名、套接字或原原生出站来源。',
          whenToUse: '显式命名、套接字或原原生出站来源。',
          defaultValue: '仅出站连接模式必填。',
          example:
            "import { randomUUID } from 'node:crypto'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\n\nconst address = 'service-' + randomUUID()\nconst server = await createRpcHost({\n  plugins: [processPlugin({ listen: address })],\n  provide: { double: (value: number) => value * 2 },\n})\ntry {\n  const client = await createRpcHost({\n    self: { name: 'client-a', instanceId: randomUUID() },\n    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],\n    provide: { clientValue: (value: string) => 'client:' + value },\n  })\n  try {\n    console.log(await client.process.request('double', 21))\n    console.log(await server.process.send('client-a', 'clientValue', 'ready'))\n  } finally {\n    await client.close()\n  }\n} finally {\n  await server.close()\n}"
        },
        {
          name: 'listen',
          description: '接纳独立双向会话的原命名或套接字监听者。',
          whenToUse: '接纳独立双向会话的原命名或套接字监听者。',
          defaultValue: '非监听模式不提供。',
          example:
            "import { randomUUID } from 'node:crypto'\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\n\nconst address = 'service-' + randomUUID()\nconst server = await createRpcHost({\n  plugins: [processPlugin({ listen: address })],\n  provide: { double: (value: number) => value * 2 },\n})\ntry {\n  const client = await createRpcHost({\n    self: { name: 'client-a', instanceId: randomUUID() },\n    plugins: [processPlugin({ connect: { target: address, timeoutMs: 1500 } })],\n    provide: { clientValue: (value: string) => 'client:' + value },\n  })\n  try {\n    console.log(await client.process.request('double', 21))\n    console.log(await server.process.send('client-a', 'clientValue', 'ready'))\n  } finally {\n    await client.close()\n  }\n} finally {\n  await server.close()\n}"
        },
        {
          name: 'namespace',
          description: '宿主发布此传输调用及扩展的唯一属性名。',
          whenToUse: '宿主发布此传输调用及扩展的唯一属性名。',
          defaultValue: '省略时使用工厂默认命名空间。'
        },
        {
          name: 'features',
          description:
            '此传输作用域的完整调用及受支持原生功能定义；逐次调用的超时和重试使用完整实例或关闭值。',
          whenToUse:
            '此传输作用域的完整调用及受支持原生功能定义；逐次调用的超时和重试使用完整实例或关闭值。',
          defaultValue: '省略时不通过此字段安装可选策略。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'parentLoss',
          description: '实际子端父进程丢失时的退出、可选宽限及原生活性探测。',
          whenToUse: '实际子端父进程丢失时的退出、可选宽限及原生活性探测。',
          defaultValue: '省略时由自动子端来源提供原生策略。'
        }
      ],
      scenarios: [
        '启动受管理子进程，并通过已安装 process 命名空间调用其公布方法。',
        '借用明确的本地拨号或监听配方，由原来源持有获取及清理职责。'
      ],
      avoidWhen: [
        '不要同时提供多个来源分支，也不要传返回预制 Peer 的回调。',
        '浏览器运行域应使用 Browser 传输，此工厂要求受支持服务端运行时。'
      ]
    }
  },
  'rpc-plugin-process:features:IpcLogEventName': {
    en: {
      purpose:
        'Exact local names for high/low backlog crossings, rejected admission, native send failure and captured stderr. These observations describe their actual connection owner, not wire messages or remote acknowledgments.',
      quickStart:
        "import { IpcLogEventName } from '@migaia/rpc-plugin-process/features/flow-control'\nconsole.log(IpcLogEventName)",
      options: [],
      scenarios: [
        'Dispatch ipc.backlog.high and ipc.backlog.low observations without parsing human messages.',
        'Separate ipc.stderr records from native write failure and admission rejection records.'
      ],
      avoidWhen: [
        'Do not send these names as RPC control operations to the remote provider.',
        'Do not interpret ipc.send.failed as proof that the remote application never executed.'
      ]
    },
    zh: {
      purpose:
        '这是积压高低水位、准入拒绝、原生发送失败及已捕获标准错误的精确本地事件名；记录描述实际连接所有者，不是线上消息或远端执行确认。',
      quickStart:
        "import { IpcLogEventName } from '@migaia/rpc-plugin-process/features/flow-control'\nconsole.log(IpcLogEventName)",
      options: [],
      scenarios: [
        '无需解析人类消息即可分发积压高低水位观察。',
        '把标准错误记录与原生发送失败、准入拒绝记录区分。'
      ],
      avoidWhen: [
        '不要把这些名称作为 RPC 控制操作发送给远端提供方。',
        '不要把发送失败事件当作远端应用从未执行的证明。'
      ]
    }
  },
  'rpc-plugin-process:features:flowControl': {
    en: {
      purpose:
        'Create a complete per-connection native write admission feature with independent data and control capacities. Capacity remains held through actual physical completion; the feature does not count provider executions.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}",
      options: [
        {
          name: 'maxPendingData',
          description:
            'Maximum pending business-data frames in the original physical send queue; an explicit value overrides that lane, while omission retains the source data capacity.',
          whenToUse:
            'Maximum pending business-data frames in the original physical send queue; an explicit value overrides that lane, while omission retains the source data capacity.',
          defaultValue:
            'Omitted: retain the existing data lane capacity for pending business frames.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'maxPendingControl',
          description:
            'Maximum pending protocol-control frames in the original physical send queue; this lane is configured independently, and omission retains the source control capacity.',
          whenToUse:
            'Maximum pending protocol-control frames in the original physical send queue; this lane is configured independently, and omission retains the source control capacity.',
          defaultValue:
            'Omitted: retain the existing control lane capacity for pending protocol frames.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        'Reserve control capacity while ordinary process writes saturate the data lane.',
        'Share the exact same feature definition with sendQueue so one capacity owner admits both paths.'
      ],
      avoidWhen: [
        'Do not install two independent flow gates on one connection to enforce the same capacity.',
        'Use limits for provider concurrency; native backlog capacity is a different layer.'
      ]
    },
    zh: {
      purpose:
        '创建每连接完整原生写入准入功能，分别保留业务与控制容量，额度持续到实际物理写入完成；它计量原生积压，不统计远端提供方执行并发。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}",
      options: [
        {
          name: 'maxPendingData',
          description:
            '原物理发送队列中等待业务数据帧的容量上限，显式值覆盖该通道，省略时保留来源原数据通道容量。',
          whenToUse:
            '原物理发送队列中等待业务数据帧的容量上限，显式值覆盖该通道，省略时保留来源原数据通道容量。',
          defaultValue: '省略时保留原队列容量。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'maxPendingControl',
          description:
            '原物理发送队列中等待协议控制帧的容量上限，显式值独立覆盖，省略时保留来源原控制通道容量。',
          whenToUse:
            '原物理发送队列中等待协议控制帧的容量上限，显式值独立覆盖，省略时保留来源原控制通道容量。',
          defaultValue: '省略时保留原队列容量。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        '普通进程写入占满业务通道时，仍为控制消息保留容量。',
        '向 sendQueue 借出同一完整功能定义，让两条路径由唯一容量所有者准入。'
      ],
      avoidWhen: [
        '不要在同一连接为同一容量安装两个独立流控门。',
        '提供方并发应使用 limits，原生积压容量属于另一层。'
      ]
    }
  },
  'rpc-plugin-process:features:ipcLog': {
    en: {
      purpose:
        'Create a complete connection-local observer for the original backlog event source and available native stderr. The caller supplies the sink; logging does not install a capacity gate or change physical write settlement.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}",
      options: [
        {
          name: 'report',
          description:
            'Receive original IPC records; thrown or rejected failures use the original reporting route.',
          whenToUse:
            'Receive original IPC records; thrown or rejected failures use the original reporting route.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        'Export actual backlog crossings and send failures from a connection shared with flowControl.',
        'Capture a spawned process stderr stream through the existing native observation owner.'
      ],
      avoidWhen: [
        'Do not expect ipcLog alone to apply queue limits or backpressure.',
        'Use the readonly RPC probe collector for semantic call history instead of treating native logs as execution tracing.'
      ]
    },
    zh: {
      purpose:
        '创建连接本地完整观察功能，接收原积压事件源及实际可用的原生标准错误；调用者提供日志接收端，单独日志不会安装容量门或改变物理写入结算。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}",
      options: [
        {
          name: 'report',
          description: '接收原进程通信记录，抛错或拒绝走原报告路径。',
          whenToUse: '接收原进程通信记录，抛错或拒绝走原报告路径。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        '从与 flowControl 共享的连接导出真实积压水位与发送失败。',
        '通过既有原生观察所有者捕获已启动进程的标准错误流。'
      ],
      avoidWhen: [
        '不要期待仅安装 ipcLog 就施加队列限制或背压。',
        '语义调用历史应使用只读探针收集器，不应把原生日志当作执行跟踪。'
      ]
    }
  },
  'rpc-plugin-process:features:sendQueue': {
    en: {
      purpose:
        'Create a complete per-connection FIFO feature that awaits each original native write. It borrows one capacity owner, including an explicitly shared flowControl definition, and releases queued cancellation receipts at settlement.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}",
      options: [
        {
          name: 'maxPendingData',
          description:
            'Maximum pending business-data frames in the original physical send queue; an explicit value overrides that lane, while omission retains the source data capacity.',
          whenToUse:
            'Maximum pending business-data frames in the original physical send queue; an explicit value overrides that lane, while omission retains the source data capacity.',
          defaultValue:
            'Omitted: retain the existing data lane capacity for pending business frames.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'maxPendingControl',
          description:
            'Maximum pending protocol-control frames in the original physical send queue; this lane is configured independently, and omission retains the source control capacity.',
          whenToUse:
            'Maximum pending protocol-control frames in the original physical send queue; this lane is configured independently, and omission retains the source control capacity.',
          defaultValue:
            'Omitted: retain the existing control lane capacity for pending protocol frames.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'flow',
          description:
            'Exact complete flowControl definition shared with this queue, avoiding a second capacity owner.',
          whenToUse:
            'Exact complete flowControl definition shared with this queue, avoiding a second capacity owner.',
          defaultValue: 'Omitted: the queue creates and owns its flow.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        'Preserve physical send order while a process channel experiences slow native writes.',
        'Bound waiting writes with a shared data/control gate and cancel only their own queued entries.'
      ],
      avoidWhen: [
        'Do not configure independent capacities alongside an explicit flow option; that would duplicate policy.',
        'Do not use this queue as request retry, provider concurrency or an application task scheduler.'
      ]
    },
    zh: {
      purpose:
        '创建每连接完整先进先出功能，逐个等待原生写入完成，借用唯一容量所有者或显式共享的 flowControl 定义，并在结算时释放排队取消回执。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}",
      options: [
        {
          name: 'maxPendingData',
          description:
            '原物理发送队列中等待业务数据帧的容量上限，显式值覆盖该通道，省略时保留来源原数据通道容量。',
          whenToUse:
            '原物理发送队列中等待业务数据帧的容量上限，显式值覆盖该通道，省略时保留来源原数据通道容量。',
          defaultValue: '省略时保留原队列容量。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'maxPendingControl',
          description:
            '原物理发送队列中等待协议控制帧的容量上限，显式值独立覆盖，省略时保留来源原控制通道容量。',
          whenToUse:
            '原物理发送队列中等待协议控制帧的容量上限，显式值独立覆盖，省略时保留来源原控制通道容量。',
          defaultValue: '省略时保留原队列容量。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'flow',
          description: '与此队列共享的精确完整流控定义，避免另一容量所有者。',
          whenToUse: '与此队列共享的精确完整流控定义，避免另一容量所有者。',
          defaultValue: '省略时队列创建并拥有流控。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        '进程通道原生写入较慢时，保持实际发送顺序。',
        '用共享业务及控制容量门约束等待写入，只取消各自排队条目。'
      ],
      avoidWhen: [
        '显式提供 flow 时，不要再配置独立容量以免重复策略。',
        '不要把此队列当作请求重试、提供方并发或应用任务调度器。'
      ]
    }
  },
  'rpc-plugin-process:features-send-queue:IpcSendQueue': {
    en: {
      purpose:
        'Lower-level installed FIFO borrows one IpcFlowControl and the original Utils limiter. It owns queued cancellation and close admission while the same native write Promise owns physical completion.',
      quickStart:
        "import { IpcSendQueue } from '@migaia/rpc-plugin-process/features/send-queue'\nimport {\n  flowControl,\n  type IProcessFeatureContext,\n} from '@migaia/rpc-plugin-process/features'\n\nexport function nativeAdmission(context: IProcessFeatureContext) {\n  return new IpcSendQueue(flowControl({ maxPendingData: 32 }), context)\n}",
      options: [],
      scenarios: [
        'Serialize original native sends for a custom Process feature integration.',
        'Remove a still-queued logical write without cancelling another connection operation.'
      ],
      avoidWhen: [
        'Use sendQueue in application feature arrays rather than manually constructing this installed value.',
        'Do not infer serialized provider execution from serialized physical writes.'
      ]
    },
    zh: {
      purpose:
        '底层安装值借用唯一 IpcFlowControl 与原 Utils 限流器，拥有排队取消及关闭准入；实际物理完成仍由同一个原生写入 Promise 表示。',
      quickStart:
        "import { IpcSendQueue } from '@migaia/rpc-plugin-process/features/send-queue'\nimport {\n  flowControl,\n  type IProcessFeatureContext,\n} from '@migaia/rpc-plugin-process/features'\n\nexport function nativeAdmission(context: IProcessFeatureContext) {\n  return new IpcSendQueue(flowControl({ maxPendingData: 32 }), context)\n}",
      options: [],
      scenarios: [
        '为自定义 Process 功能集成串行化原生发送。',
        '移除尚在排队的逻辑写入，不取消另一连接操作。'
      ],
      avoidWhen: [
        '应用功能数组应使用 sendQueue，不应手工构造底层安装值。',
        '物理写入串行不代表远端提供方执行也串行。'
      ]
    }
  },
  'rpc-plugin-process:features-send-queue:default': {
    en: {
      purpose:
        'Create a complete connection-local FIFO feature. The queue waits for each original native write Promise and borrows one flow capacity owner.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}",
      options: [
        {
          name: 'maxPendingData',
          description:
            'Maximum pending business-data frames in the original physical send queue; an explicit value overrides that lane, while omission retains the source data capacity.',
          whenToUse:
            'Maximum pending business-data frames in the original physical send queue; an explicit value overrides that lane, while omission retains the source data capacity.',
          defaultValue:
            'Omitted: retain the existing data lane capacity for pending business frames.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'maxPendingControl',
          description:
            'Maximum pending protocol-control frames in the original physical send queue; this lane is configured independently, and omission retains the source control capacity.',
          whenToUse:
            'Maximum pending protocol-control frames in the original physical send queue; this lane is configured independently, and omission retains the source control capacity.',
          defaultValue:
            'Omitted: retain the existing control lane capacity for pending protocol frames.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'flow',
          description:
            'Exact complete flowControl definition shared with this queue, avoiding a second capacity owner.',
          whenToUse:
            'Exact complete flowControl definition shared with this queue, avoiding a second capacity owner.',
          defaultValue: 'Omitted: the queue creates and owns its flow.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '创建连接本地的完整先进先出功能，等待每个原生写入承诺并借用唯一流控容量所有者。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}",
      options: [
        {
          name: 'maxPendingData',
          description:
            '原物理发送队列中等待业务数据帧的容量上限，显式值覆盖该通道，省略时保留来源原数据通道容量。',
          whenToUse:
            '原物理发送队列中等待业务数据帧的容量上限，显式值覆盖该通道，省略时保留来源原数据通道容量。',
          defaultValue: '省略时保留原队列容量。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'maxPendingControl',
          description:
            '原物理发送队列中等待协议控制帧的容量上限，显式值独立覆盖，省略时保留来源原控制通道容量。',
          whenToUse:
            '原物理发送队列中等待协议控制帧的容量上限，显式值独立覆盖，省略时保留来源原控制通道容量。',
          defaultValue: '省略时保留原队列容量。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'flow',
          description: '与此队列共享的精确完整流控定义，避免另一容量所有者。',
          whenToUse: '与此队列共享的精确完整流控定义，避免另一容量所有者。',
          defaultValue: '省略时队列创建并拥有流控。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-plugin-process:features-log:default': {
    en: {
      purpose:
        'Create a complete local log feature for actual backlog, send failures and captured stderr. Logging alone does not install flow control.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}",
      options: [
        {
          name: 'report',
          description:
            'Receive original IPC records; thrown or rejected failures use the original reporting route.',
          whenToUse:
            'Receive original IPC records; thrown or rejected failures use the original reporting route.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '为实际积压、发送失败及捕获的标准错误创建完整本地日志功能；单独日志不会启用流控。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}",
      options: [
        {
          name: 'report',
          description: '接收原进程通信记录，抛错或拒绝走原报告路径。',
          whenToUse: '接收原进程通信记录，抛错或拒绝走原报告路径。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-plugin-process:features-flow-control:IpcFlowControl': {
    en: {
      purpose:
        'Lower-level installed owner of data/control counts, watermark crossings and original native write settlement. Custom native authors supply the genuine Process feature context; ordinary applications use flowControl.',
      quickStart:
        "import { IpcFlowControl } from '@migaia/rpc-plugin-process/features/flow-control'\nimport {\n  flowControl,\n  type IProcessFeatureContext,\n} from '@migaia/rpc-plugin-process/features'\n\nexport function nativeAdmission(context: IProcessFeatureContext) {\n  return new IpcFlowControl({ maxPendingData: 32 }, context)\n}",
      options: [],
      scenarios: [
        'Integrate a custom native sender with the existing run and whenIdle ownership.',
        'Observe immutable backlog events from the same gate that admits physical writes.'
      ],
      avoidWhen: [
        'Do not instantiate it as a second Host or a provider pending-call registry.',
        'Prefer flowControl for normal transport features instead of constructing native installation context.'
      ]
    },
    zh: {
      purpose:
        '这是持有业务及控制计数、水位越界和原生写入结算的底层安装值；自定义原生作者需提供真实 Process 功能上下文，普通应用应使用 flowControl 工厂。',
      quickStart:
        "import { IpcFlowControl } from '@migaia/rpc-plugin-process/features/flow-control'\nimport {\n  flowControl,\n  type IProcessFeatureContext,\n} from '@migaia/rpc-plugin-process/features'\n\nexport function nativeAdmission(context: IProcessFeatureContext) {\n  return new IpcFlowControl({ maxPendingData: 32 }, context)\n}",
      options: [],
      scenarios: [
        '把自定义原生发送器接到既有 run 与 whenIdle 所有权。',
        '从准入物理写入的同一流控门观察不可变积压事件。'
      ],
      avoidWhen: [
        '不要把它构造成第二宿主或提供方待决调用登记表。',
        '正常传输功能应选 flowControl，不应自行构造原生安装上下文。'
      ]
    }
  },
  'rpc-plugin-process:features-flow-control:default': {
    en: {
      purpose:
        'Create one complete two-lane native-write admission feature. A sendQueue may share this exact definition.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}",
      options: [
        {
          name: 'maxPendingData',
          description:
            'Maximum pending business-data frames in the original physical send queue; an explicit value overrides that lane, while omission retains the source data capacity.',
          whenToUse:
            'Maximum pending business-data frames in the original physical send queue; an explicit value overrides that lane, while omission retains the source data capacity.',
          defaultValue:
            'Omitted: retain the existing data lane capacity for pending business frames.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'maxPendingControl',
          description:
            'Maximum pending protocol-control frames in the original physical send queue; this lane is configured independently, and omission retains the source control capacity.',
          whenToUse:
            'Maximum pending protocol-control frames in the original physical send queue; this lane is configured independently, and omission retains the source control capacity.',
          defaultValue:
            'Omitted: retain the existing control lane capacity for pending protocol frames.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [],
      avoidWhen: []
    },
    zh: {
      purpose: '创建完整的双通道原生写入接纳功能，发送队列可共享此精确定义。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}",
      options: [
        {
          name: 'maxPendingData',
          description:
            '原物理发送队列中等待业务数据帧的容量上限，显式值覆盖该通道，省略时保留来源原数据通道容量。',
          whenToUse:
            '原物理发送队列中等待业务数据帧的容量上限，显式值覆盖该通道，省略时保留来源原数据通道容量。',
          defaultValue: '省略时保留原队列容量。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        },
        {
          name: 'maxPendingControl',
          description:
            '原物理发送队列中等待协议控制帧的容量上限，显式值独立覆盖，省略时保留来源原控制通道容量。',
          whenToUse:
            '原物理发送队列中等待协议控制帧的容量上限，显式值独立覆盖，省略时保留来源原控制通道容量。',
          defaultValue: '省略时保留原队列容量。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { processPlugin } from '@migaia/rpc-plugin-process'\nimport { flowControl, sendQueue, ipcLog } from '@migaia/rpc-plugin-process/features'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function openWorker(entry: URL) {\n  const flow = flowControl({ maxPendingData: 32, maxPendingControl: 8 })\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.error(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      processPlugin({\n        spawn: entry,\n        features: [\n          flow,\n          sendQueue({ flow }),\n          ipcLog({\n            report(record) {\n              console.error(record)\n            },\n          }),\n          timeout({ ms: 1500 }),\n        ],\n      }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [],
      avoidWhen: []
    }
  },
  'rpc-plugin-thread:index:isThreadChild': {
    en: {
      purpose:
        'Asynchronously discover a genuine library-launched server Worker. Node reads the original workerData/parentPort; Web-style server workers may await and retain the first native bootstrap for the later transport installation.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [threadPlugin({ spawn: true })] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      options: [],
      scenarios: [
        'Branch a supported same-entry spawn:true module into parent and native Worker roles.',
        'Reuse the captured native child bootstrap when installing connectToParent.'
      ],
      avoidWhen: [
        'Do not use this helper to identify browser Workers; this package selects server runtimes.',
        'Use an explicit built Worker entry when self-spawn is unsupported by the application runner or bundling.'
      ]
    },
    zh: {
      purpose:
        '异步识别本库启动的真实服务端 Worker：Node 读取原 workerData 与 parentPort，Web 风格服务端线程可能等待并保留首个原生引导，供后续传输安装复用。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [threadPlugin({ spawn: true })] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      options: [],
      scenarios: [
        '把受支持的同入口 spawn:true 模块分成父端与原生 Worker 角色。',
        '安装 connectToParent 时复用已经捕获的原生子端引导。'
      ],
      avoidWhen: [
        '不要用此辅助函数识别浏览器 Worker，此包选择服务端运行时。',
        '应用运行器或打包环境不支持自身启动时，应提供明确编译后的 Worker 入口。'
      ]
    }
  },
  'rpc-plugin-thread:index:threadPlugin': {
    en: {
      purpose:
        'Define one cold server Thread transport from a real spawn recipe or genuine parent connection. Native Worker creation and supervision stay with the source; the installed namespace exposes Host calls and actual member controls.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [threadPlugin({ spawn: true })] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'name',
          description: 'Local native registration name, separate from accepted remote identity.',
          whenToUse: 'Local native registration name, separate from accepted remote identity.',
          defaultValue: 'Omitted: the native registration default.'
        },
        {
          name: 'namespace',
          description: 'Unique Host property exposing this transport calls and extensions.',
          whenToUse: 'Unique Host property exposing this transport calls and extensions.',
          defaultValue: 'Omitted: the factory namespace.'
        },
        {
          name: 'expose',
          description:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          whenToUse:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          defaultValue: 'Omitted: no ordinary Feature output selected.'
        },
        {
          name: 'report',
          description:
            'Receives native background and cleanup failures; operation rejections retain original causes.',
          whenToUse:
            'Receives native background and cleanup failures; operation rejections retain original causes.',
          defaultValue: 'Omitted: configured Host reporter, then effective default.'
        },
        {
          name: 'features',
          description:
            'Complete call and supported native feature definitions scoped to this transport. Per-call timeout and retry take instances or false.',
          whenToUse:
            'Complete call and supported native feature definitions scoped to this transport. Per-call timeout and retry take instances or false.',
          defaultValue: 'Omitted: no optional policy installed by this field.',
          example:
            "import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin } from '@migaia/rpc-plugin-thread'\nimport { timeout, retry } from '@migaia/rpc-host/features'\n\ntype IWorkerApi = {\n  values(end: number): AsyncIterable<number>\n  wait(value: number): number\n  bytes(value: Uint8Array<ArrayBuffer>): number\n}\n\nconst plugins = [\n  threadPlugin({\n    name: 'worker',\n    spawn: new URL('./worker.js', import.meta.url),\n    features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n  }),\n] as const\n\ntype IThreadHost = IRpcHost<IWorkerApi, typeof plugins>\n\nexport function open() {\n  return createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n}\n\nexport async function firstValue(host: IThreadHost) {\n  const stream = host.thread.peers.worker.values(3)\n  try {\n    return await stream.next()\n  } finally {\n    await stream.return?.()\n  }\n}\n\nexport function work(host: IThreadHost, signal: AbortSignal) {\n  return host.thread.send('worker', 'wait', 21, {\n    signal,\n    timeout: timeout({ ms: 500 }),\n    retry: false,\n  })\n}\n\nexport function sendBytes(host: IThreadHost, bytes: Uint8Array<ArrayBuffer>) {\n  return host.thread.send('worker', 'bytes', bytes, { transfer: [bytes.buffer] })\n}\n\nexport async function inspectAndRestart(host: IThreadHost) {\n  const before = await host.thread.members.get('worker')\n  await host.thread.members.restart('worker')\n  return before\n}"
        },
        {
          name: 'spawn',
          description:
            'Current entry, explicit entry, short options, or original full native source. No complete callable object is a raw source.',
          whenToUse:
            'Current entry, explicit entry, short options, or original full native source. No complete callable object is a raw source.',
          defaultValue: 'Absent in parent/connect/listen modes.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [threadPlugin({ spawn: true })] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'connectToParent',
          description: 'true only in the genuine native child, using actual first-frame authority.',
          whenToUse: 'true only in the genuine native child, using actual first-frame authority.',
          defaultValue: 'Absent outside parent connection mode.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [threadPlugin({ spawn: true })] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        }
      ],
      scenarios: [
        'Launch a Node, Bun or Deno Worker using the supported runtime recipe and advertise its methods.',
        'Attach the real native parent port inside a worker that received the library bootstrap.'
      ],
      avoidWhen: [
        'Use dedicatedWorkerPlugin or sharedWorkerPlugin for browser Worker realms.',
        'Do not return a completed RPC Peer from a spawn callback; supply the actual native source recipe.'
      ]
    },
    zh: {
      purpose:
        '通过真实启动配方或原生父连接声明冷服务端线程传输，由原来源创建并监督 Worker；已安装命名空间提供 Host 调用及真实成员控制，不另建业务端点。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [threadPlugin({ spawn: true })] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'name',
          description: '本地原生登记名称，与已接纳的远端身份分开。',
          whenToUse: '本地原生登记名称，与已接纳的远端身份分开。',
          defaultValue: '省略时使用原生登记默认名称。'
        },
        {
          name: 'namespace',
          description: '宿主发布此传输调用及扩展的唯一属性名。',
          whenToUse: '宿主发布此传输调用及扩展的唯一属性名。',
          defaultValue: '省略时使用工厂默认命名空间。'
        },
        {
          name: 'expose',
          description: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          whenToUse: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          defaultValue: '省略时不选取普通功能输出。'
        },
        {
          name: 'report',
          description: '接收原生后台及清理失败；操作拒绝保留原始原因。',
          whenToUse: '接收原生后台及清理失败；操作拒绝保留原始原因。',
          defaultValue: '省略时使用宿主显式报告器，再使用有效默认报告器。'
        },
        {
          name: 'features',
          description:
            '此传输作用域的完整调用及受支持原生功能定义；逐次调用的超时和重试使用完整实例或关闭值。',
          whenToUse:
            '此传输作用域的完整调用及受支持原生功能定义；逐次调用的超时和重试使用完整实例或关闭值。',
          defaultValue: '省略时不通过此字段安装可选策略。',
          example:
            "import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin } from '@migaia/rpc-plugin-thread'\nimport { timeout, retry } from '@migaia/rpc-host/features'\n\ntype IWorkerApi = {\n  values(end: number): AsyncIterable<number>\n  wait(value: number): number\n  bytes(value: Uint8Array<ArrayBuffer>): number\n}\n\nconst plugins = [\n  threadPlugin({\n    name: 'worker',\n    spawn: new URL('./worker.js', import.meta.url),\n    features: [timeout({ ms: 1500 }), retry({ attempts: 2 })],\n  }),\n] as const\n\ntype IThreadHost = IRpcHost<IWorkerApi, typeof plugins>\n\nexport function open() {\n  return createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n}\n\nexport async function firstValue(host: IThreadHost) {\n  const stream = host.thread.peers.worker.values(3)\n  try {\n    return await stream.next()\n  } finally {\n    await stream.return?.()\n  }\n}\n\nexport function work(host: IThreadHost, signal: AbortSignal) {\n  return host.thread.send('worker', 'wait', 21, {\n    signal,\n    timeout: timeout({ ms: 500 }),\n    retry: false,\n  })\n}\n\nexport function sendBytes(host: IThreadHost, bytes: Uint8Array<ArrayBuffer>) {\n  return host.thread.send('worker', 'bytes', bytes, { transfer: [bytes.buffer] })\n}\n\nexport async function inspectAndRestart(host: IThreadHost) {\n  const before = await host.thread.members.get('worker')\n  await host.thread.members.restart('worker')\n  return before\n}"
        },
        {
          name: 'spawn',
          description:
            '当前入口、显式入口、简写选项或原完整原生来源，完整调用对象不能充当原始来源。',
          whenToUse: '当前入口、显式入口、简写选项或原完整原生来源，完整调用对象不能充当原始来源。',
          defaultValue: '子端、连接或监听模式不提供。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [threadPlugin({ spawn: true })] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'connectToParent',
          description: '仅在真实原生子端取真值，使用实际首帧权限。',
          whenToUse: '仅在真实原生子端取真值，使用实际首帧权限。',
          defaultValue: '非连接父端模式不提供。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [threadPlugin({ spawn: true })] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        }
      ],
      scenarios: [
        '使用受支持运行时配方启动 Node、Bun 或 Deno Worker 并公布其方法。',
        '在收到本库引导的工作线程内接入真实原生父端口。'
      ],
      avoidWhen: [
        '浏览器 Worker 运行域应使用 dedicatedWorkerPlugin 或 sharedWorkerPlugin。',
        '不要让启动回调返回已构造 RPC Peer，应提供实际原生来源配方。'
      ]
    }
  },
  'rpc-plugin-browser:index:broadcastChannelPlugin': {
    en: {
      purpose:
        'Borrow an existing same-origin BroadcastChannel for real multiparty discovery and independent per-peer handshakes. Channel membership is separate from accepted RPC identity; disposal leaves and unsubscribes without closing the caller channel.',
      quickStart:
        "// Other deployed participants provide double; the caller owns the borrowed channel.\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askParticipants(channel: BroadcastChannel) {\n  const host = await createRpcHost({\n    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  try {\n    return await host.broadcastChannel.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}\n",
      options: [
        {
          name: 'name',
          description: 'Local native registration name, separate from accepted remote identity.',
          whenToUse: 'Local native registration name, separate from accepted remote identity.',
          defaultValue: 'Omitted: the native registration default.'
        },
        {
          name: 'expose',
          description:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          whenToUse:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          defaultValue: 'Omitted: no ordinary Feature output selected.'
        },
        {
          name: 'connect',
          description: 'Settings for the sole Session handshake budget.',
          whenToUse: 'Settings for the sole Session handshake budget.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'connect.timeoutMs',
          description: 'Finite nonnegative Session negotiation budget in milliseconds.',
          whenToUse: 'Finite nonnegative Session negotiation budget in milliseconds.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'channel',
          description:
            'Actual BroadcastChannel created and owned by the application; the Host borrows it for messaging and does not close the native channel on Host shutdown.',
          whenToUse:
            'Actual BroadcastChannel created and owned by the application; the Host borrows it for messaging and does not close the native channel on Host shutdown.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function listenOnChannel(channel: BroadcastChannel) {\n  return createRpcHost({\n    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],\n    provide: { double: (value: number) => value * 2 },\n  })\n}"
        },
        {
          name: 'namespace',
          description: 'Unique Host property exposing this transport calls and extensions.',
          whenToUse: 'Unique Host property exposing this transport calls and extensions.',
          defaultValue: 'Omitted: the factory namespace.'
        },
        {
          name: 'features',
          description: 'Complete call-feature instances scoped to this transport.',
          whenToUse: 'Complete call-feature instances scoped to this transport.',
          defaultValue: 'Omitted: no optional policy installed by this field.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        'Connect several tabs or workers that share one actual same-origin channel.',
        'Keep each discovered physical route independently admitted under one transport namespace.'
      ],
      avoidWhen: [
        'Do not treat a channel name or discovery sender string as authenticated peer identity.',
        'Use a transfer-capable one-to-one carrier when the application requires native buffer transfer.'
      ]
    },
    zh: {
      purpose:
        '借用既有同源 BroadcastChannel 完成真实多方发现和逐对端独立握手，频道成员关系不同于已接纳 RPC 身份；销毁发送离开并移除订阅，不关闭调用者频道。',
      quickStart:
        "// 其他已部署参与者提供双倍方法；调用方仍拥有借入频道。\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askParticipants(channel: BroadcastChannel) {\n  const host = await createRpcHost({\n    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  try {\n    return await host.broadcastChannel.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}\n",
      options: [
        {
          name: 'name',
          description: '本地原生登记名称，与已接纳的远端身份分开。',
          whenToUse: '本地原生登记名称，与已接纳的远端身份分开。',
          defaultValue: '省略时使用原生登记默认名称。'
        },
        {
          name: 'expose',
          description: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          whenToUse: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          defaultValue: '省略时不选取普通功能输出。'
        },
        {
          name: 'connect',
          description: '唯一会话握手预算的设置。',
          whenToUse: '唯一会话握手预算的设置。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'connect.timeoutMs',
          description: '会话协商使用的有限非负毫秒预算。',
          whenToUse: '会话协商使用的有限非负毫秒预算。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'channel',
          description:
            '应用创建并拥有的实际广播频道，宿主只借用它收发消息，关闭宿主不会代替应用关闭频道。',
          whenToUse:
            '应用创建并拥有的实际广播频道，宿主只借用它收发消息，关闭宿主不会代替应用关闭频道。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function listenOnChannel(channel: BroadcastChannel) {\n  return createRpcHost({\n    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],\n    provide: { double: (value: number) => value * 2 },\n  })\n}"
        },
        {
          name: 'namespace',
          description: '宿主发布此传输调用及扩展的唯一属性名。',
          whenToUse: '宿主发布此传输调用及扩展的唯一属性名。',
          defaultValue: '省略时使用工厂默认命名空间。'
        },
        {
          name: 'features',
          description: '作用于此传输的完整调用功能实例。',
          whenToUse: '作用于此传输的完整调用功能实例。',
          defaultValue: '省略时不通过此字段安装可选策略。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        '连接共享真实同源频道的多个页面或工作程序。',
        '在一个传输命名空间下独立接纳每条已发现物理路由。'
      ],
      avoidWhen: [
        '不要把频道名或发现发送方字符串当作已认证对端身份。',
        '应用需要原生缓冲区转移时，应使用支持转移的一对一载体。'
      ]
    }
  },
  'rpc-plugin-browser:index:dedicatedWorkerPlugin': {
    en: {
      purpose:
        'Borrow an already-created Worker or its worker-side global through native EventTarget messaging. Host owns protocol admission and removes its subscriptions; the application keeps Worker creation and terminate ownership.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    return await host.worker.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'name',
          description: 'Local native registration name, separate from accepted remote identity.',
          whenToUse: 'Local native registration name, separate from accepted remote identity.',
          defaultValue: 'Omitted: the native registration default.'
        },
        {
          name: 'expose',
          description:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          whenToUse:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          defaultValue: 'Omitted: no ordinary Feature output selected.'
        },
        {
          name: 'connect',
          description: 'Settings for the sole Session handshake budget.',
          whenToUse: 'Settings for the sole Session handshake budget.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'connect.timeoutMs',
          description: 'Finite nonnegative Session negotiation budget in milliseconds.',
          whenToUse: 'Finite nonnegative Session negotiation budget in milliseconds.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'worker',
          description:
            'Actual browser Worker or its global sending/receiving surface supplied by the application; the Host borrows native listeners and neither launches nor terminates the Worker.',
          whenToUse:
            'Actual browser Worker or its global sending/receiving surface supplied by the application; the Host borrows native listeners and neither launches nor terminates the Worker.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    return await host.worker.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'namespace',
          description: 'Unique Host property exposing this transport calls and extensions.',
          whenToUse: 'Unique Host property exposing this transport calls and extensions.',
          defaultValue: 'Omitted: the factory namespace.'
        },
        {
          name: 'features',
          description: 'Complete call-feature instances scoped to this transport.',
          whenToUse: 'Complete call-feature instances scoped to this transport.',
          defaultValue: 'Omitted: no optional policy installed by this field.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        'Connect a page to an application-created dedicated Worker over its actual message operations.',
        'Install the same factory on worker self to expose worker-side methods.'
      ],
      avoidWhen: [
        'Do not expect this factory to construct, restart or terminate the borrowed Worker.',
        'Use threadPlugin for managed server-runtime Workers rather than substituting browser discovery.'
      ]
    },
    zh: {
      purpose:
        '通过原生 EventTarget 消息借用已创建 Worker 或工作端全局，Host 拥有协议准入并移除其订阅；Worker 创建与 terminate 权限仍由应用持有。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    return await host.worker.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'name',
          description: '本地原生登记名称，与已接纳的远端身份分开。',
          whenToUse: '本地原生登记名称，与已接纳的远端身份分开。',
          defaultValue: '省略时使用原生登记默认名称。'
        },
        {
          name: 'expose',
          description: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          whenToUse: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          defaultValue: '省略时不选取普通功能输出。'
        },
        {
          name: 'connect',
          description: '唯一会话握手预算的设置。',
          whenToUse: '唯一会话握手预算的设置。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'connect.timeoutMs',
          description: '会话协商使用的有限非负毫秒预算。',
          whenToUse: '会话协商使用的有限非负毫秒预算。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'worker',
          description:
            '应用提供的实际浏览器工作程序或其全局收发面，宿主借用原生监听，不负责创建或终止工作程序。',
          whenToUse:
            '应用提供的实际浏览器工作程序或其全局收发面，宿主借用原生监听，不负责创建或终止工作程序。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    return await host.worker.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'namespace',
          description: '宿主发布此传输调用及扩展的唯一属性名。',
          whenToUse: '宿主发布此传输调用及扩展的唯一属性名。',
          defaultValue: '省略时使用工厂默认命名空间。'
        },
        {
          name: 'features',
          description: '作用于此传输的完整调用功能实例。',
          whenToUse: '作用于此传输的完整调用功能实例。',
          defaultValue: '省略时不通过此字段安装可选策略。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        '通过实际消息操作连接页面与应用创建的专用 Worker。',
        '在 worker self 安装同一工厂，公开工作端方法。'
      ],
      avoidWhen: [
        '不要期待此工厂构造、重启或终止借用的 Worker。',
        '受管理服务端 Worker 应使用 threadPlugin，不要替换为浏览器发现。'
      ]
    }
  },
  'rpc-plugin-browser:index:rtcDataChannelPlugin': {
    en: {
      purpose:
        'Borrow a reliable ordered RTCDataChannel after application signaling. ordered must be true and both retransmission limits must be null; the caller retains the native channel and RTCPeerConnection lifetime.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callRtc(channel: RTCDataChannel) {\n  const host = await createRpcHost({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })],\n  })\n  try {\n    return await host.rtcDataChannel.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'name',
          description: 'Local native registration name, separate from accepted remote identity.',
          whenToUse: 'Local native registration name, separate from accepted remote identity.',
          defaultValue: 'Omitted: the native registration default.'
        },
        {
          name: 'expose',
          description:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          whenToUse:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          defaultValue: 'Omitted: no ordinary Feature output selected.'
        },
        {
          name: 'connect',
          description: 'Settings for the sole Session handshake budget.',
          whenToUse: 'Settings for the sole Session handshake budget.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'connect.timeoutMs',
          description: 'Finite nonnegative Session negotiation budget in milliseconds.',
          whenToUse: 'Finite nonnegative Session negotiation budget in milliseconds.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'rtcDataChannel',
          description:
            'Application-supplied reliable ordered native data channel; the Host borrows its messaging interface while signaling, creation and native closure remain application-owned.',
          whenToUse:
            'Application-supplied reliable ordered native data channel; the Host borrows its messaging interface while signaling, creation and native closure remain application-owned.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callRtc(channel: RTCDataChannel) {\n  const host = await createRpcHost({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })],\n  })\n  try {\n    return await host.rtcDataChannel.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'namespace',
          description: 'Unique Host property exposing this transport calls and extensions.',
          whenToUse: 'Unique Host property exposing this transport calls and extensions.',
          defaultValue: 'Omitted: the factory namespace.'
        },
        {
          name: 'features',
          description: 'Complete call-feature instances scoped to this transport.',
          whenToUse: 'Complete call-feature instances scoped to this transport.',
          defaultValue: 'Omitted: no optional policy installed by this field.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        'Run the canonical protocol over a real reliable channel supplied by existing WebRTC signaling.',
        'Retire RPC work when the native channel emits its actual close or error event.'
      ],
      avoidWhen: [
        'Do not supply unordered or partially reliable channels to this ordered protocol transport.',
        'Do not expect the plugin to negotiate WebRTC or close the caller RTCPeerConnection.'
      ]
    },
    zh: {
      purpose:
        '应用完成信令后借用可靠有序 RTCDataChannel，ordered 必须为 true，重传次数及报文存活期限必须均为 null；原生频道及对等连接生命周期仍由调用者持有。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callRtc(channel: RTCDataChannel) {\n  const host = await createRpcHost({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })],\n  })\n  try {\n    return await host.rtcDataChannel.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'name',
          description: '本地原生登记名称，与已接纳的远端身份分开。',
          whenToUse: '本地原生登记名称，与已接纳的远端身份分开。',
          defaultValue: '省略时使用原生登记默认名称。'
        },
        {
          name: 'expose',
          description: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          whenToUse: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          defaultValue: '省略时不选取普通功能输出。'
        },
        {
          name: 'connect',
          description: '唯一会话握手预算的设置。',
          whenToUse: '唯一会话握手预算的设置。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'connect.timeoutMs',
          description: '会话协商使用的有限非负毫秒预算。',
          whenToUse: '会话协商使用的有限非负毫秒预算。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'rtcDataChannel',
          description:
            '应用提供的可靠有序原生数据频道，宿主借用其消息接口；信令、频道创建与原生关闭仍由应用负责。',
          whenToUse:
            '应用提供的可靠有序原生数据频道，宿主借用其消息接口；信令、频道创建与原生关闭仍由应用负责。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callRtc(channel: RTCDataChannel) {\n  const host = await createRpcHost({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })],\n  })\n  try {\n    return await host.rtcDataChannel.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'namespace',
          description: '宿主发布此传输调用及扩展的唯一属性名。',
          whenToUse: '宿主发布此传输调用及扩展的唯一属性名。',
          defaultValue: '省略时使用工厂默认命名空间。'
        },
        {
          name: 'features',
          description: '作用于此传输的完整调用功能实例。',
          whenToUse: '作用于此传输的完整调用功能实例。',
          defaultValue: '省略时不通过此字段安装可选策略。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        '在已有 WebRTC 信令提供的真实可靠频道上运行规范协议。',
        '原生频道发出真实关闭或错误事件时，使对应 RPC 工作退场。'
      ],
      avoidWhen: [
        '不要把无序或部分可靠频道交给此有序协议传输。',
        '不要期待插件完成 WebRTC 协商或关闭调用者的对等连接。'
      ]
    }
  },
  'rpc-plugin-browser:index:serviceWorkerPlugin': {
    en: {
      purpose:
        'On a page, borrow a ServiceWorker send target and a separate message receiver. In worker mode resolve native event.source.id through Clients.get and maintain independent Client routes; application payload identity claims do not select a route.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost({\n    plugins: [\n      serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker }),\n    ],\n  })\n  try {\n    return await host.serviceWorker.request('version')\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'name',
          description: 'Local native registration name, separate from accepted remote identity.',
          whenToUse: 'Local native registration name, separate from accepted remote identity.',
          defaultValue: 'Omitted: the native registration default.'
        },
        {
          name: 'expose',
          description:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          whenToUse:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          defaultValue: 'Omitted: no ordinary Feature output selected.'
        },
        {
          name: 'connect',
          description: 'Settings for the sole Session handshake budget.',
          whenToUse: 'Settings for the sole Session handshake budget.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'connect.timeoutMs',
          description: 'Finite nonnegative Session negotiation budget in milliseconds.',
          whenToUse: 'Finite nonnegative Session negotiation budget in milliseconds.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'serviceWorker',
          description: 'Actual page-side sending target. Mutually exclusive with clients.',
          whenToUse: 'Actual page-side sending target. Mutually exclusive with clients.',
          defaultValue: 'Absent in worker listener mode.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost({\n    plugins: [\n      serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker }),\n    ],\n  })\n  try {\n    return await host.serviceWorker.request('version')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'receiver',
          description:
            'Local receiving container independent of the sending target, normally navigator.serviceWorker on a page; receives native messages returned by the selected target.',
          whenToUse:
            'Local receiving container independent of the sending target, normally navigator.serviceWorker on a page; receives native messages returned by the selected target.',
          defaultValue: 'Omitted: navigator.serviceWorker when present.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost({\n    plugins: [\n      serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker }),\n    ],\n  })\n  try {\n    return await host.serviceWorker.request('version')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'clients',
          description: 'Real worker scope with clients.get and native message subscription.',
          whenToUse: 'Real worker scope with clients.get and native message subscription.',
          defaultValue: 'Absent in page mode.'
        },
        {
          name: 'namespace',
          description: 'Unique Host property exposing this transport calls and extensions.',
          whenToUse: 'Unique Host property exposing this transport calls and extensions.',
          defaultValue: 'Omitted: the factory namespace.'
        },
        {
          name: 'features',
          description: 'Complete call-feature instances scoped to this transport.',
          whenToUse: 'Complete call-feature instances scoped to this transport.',
          defaultValue: 'Omitted: no optional policy installed by this field.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        'Connect a controlled page to its real active worker using the page message container.',
        'Serve several native Clients from one worker while preserving per-Client handshake isolation.'
      ],
      avoidWhen: [
        'Do not route by a peer id embedded in event.data instead of the native Client source.',
        'Do not expect plugin disposal to unregister the ServiceWorker or manage its browser lifetime.'
      ]
    },
    zh: {
      purpose:
        '页面侧借用 ServiceWorker 发送目标及独立消息接收面；工作端经 Clients.get 解析原生 event.source.id，保持各 Client 路由独立，业务载荷自报身份不能选择路由。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost({\n    plugins: [\n      serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker }),\n    ],\n  })\n  try {\n    return await host.serviceWorker.request('version')\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'name',
          description: '本地原生登记名称，与已接纳的远端身份分开。',
          whenToUse: '本地原生登记名称，与已接纳的远端身份分开。',
          defaultValue: '省略时使用原生登记默认名称。'
        },
        {
          name: 'expose',
          description: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          whenToUse: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          defaultValue: '省略时不选取普通功能输出。'
        },
        {
          name: 'connect',
          description: '唯一会话握手预算的设置。',
          whenToUse: '唯一会话握手预算的设置。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'connect.timeoutMs',
          description: '会话协商使用的有限非负毫秒预算。',
          whenToUse: '会话协商使用的有限非负毫秒预算。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'serviceWorker',
          description: '实际页面发送目标，与客户端监听来源互斥。',
          whenToUse: '实际页面发送目标，与客户端监听来源互斥。',
          defaultValue: '子端监听模式不提供。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost({\n    plugins: [\n      serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker }),\n    ],\n  })\n  try {\n    return await host.serviceWorker.request('version')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'receiver',
          description:
            '与发送目标独立的本地接收容器，页面端通常为 navigator.serviceWorker，用于接收目标返回的原生消息。',
          whenToUse:
            '与发送目标独立的本地接收容器，页面端通常为 navigator.serviceWorker，用于接收目标返回的原生消息。',
          defaultValue: '省略时使用存在的原生服务工作程序容器。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost({\n    plugins: [\n      serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker }),\n    ],\n  })\n  try {\n    return await host.serviceWorker.request('version')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'clients',
          description: '带原生客户端查询和消息订阅的真实子端域。',
          whenToUse: '带原生客户端查询和消息订阅的真实子端域。',
          defaultValue: '页面模式不提供。'
        },
        {
          name: 'namespace',
          description: '宿主发布此传输调用及扩展的唯一属性名。',
          whenToUse: '宿主发布此传输调用及扩展的唯一属性名。',
          defaultValue: '省略时使用工厂默认命名空间。'
        },
        {
          name: 'features',
          description: '作用于此传输的完整调用功能实例。',
          whenToUse: '作用于此传输的完整调用功能实例。',
          defaultValue: '省略时不通过此字段安装可选策略。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        '通过页面消息容器连接受控页面与真实活动工作程序。',
        '从一个工作程序服务多个原生 Client，同时保持逐 Client 握手隔离。'
      ],
      avoidWhen: [
        '不要按 event.data 内嵌对端标识替代原生 Client 来源来路由。',
        '不要期待插件销毁会注销 ServiceWorker 或管理浏览器中的工作程序寿命。'
      ]
    }
  },
  'rpc-plugin-browser:index:sharedWorkerPlugin': {
    en: {
      purpose:
        'Borrow one page-side SharedWorker port or listen on the real worker connect scope. Every accepted MessagePort gets its own Host handshake; removing one connection leaves sibling ports and the caller Worker lifetime intact.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(worker: SharedWorker) {\n  const host = await createRpcHost({\n    plugins: [sharedWorkerPlugin({ sharedWorker: worker })],\n  })\n  try {\n    return await host.sharedWorker.request('value')\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'sharedWorker.port',
          description:
            'The actual port supplied by the page-owned SharedWorker; the plugin subscribes to it without closing the borrowed port.',
          whenToUse:
            'The actual port supplied by the page-owned SharedWorker; the plugin subscribes to it without closing the borrowed port.',
          defaultValue: 'Absent in listen mode; required through sharedWorker in page mode.'
        },
        {
          name: 'name',
          description: 'Local native registration name, separate from accepted remote identity.',
          whenToUse: 'Local native registration name, separate from accepted remote identity.',
          defaultValue: 'Omitted: the native registration default.'
        },
        {
          name: 'expose',
          description:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          whenToUse:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          defaultValue: 'Omitted: no ordinary Feature output selected.'
        },
        {
          name: 'connect',
          description: 'Settings for the sole Session handshake budget.',
          whenToUse: 'Settings for the sole Session handshake budget.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'connect.timeoutMs',
          description: 'Finite nonnegative Session negotiation budget in milliseconds.',
          whenToUse: 'Finite nonnegative Session negotiation budget in milliseconds.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'sharedWorker',
          description:
            'Actual SharedWorker whose port is borrowed. Mutually exclusive with listen.',
          whenToUse: 'Actual SharedWorker whose port is borrowed. Mutually exclusive with listen.',
          defaultValue: 'Absent in listener mode.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(worker: SharedWorker) {\n  const host = await createRpcHost({\n    plugins: [sharedWorkerPlugin({ sharedWorker: worker })],\n  })\n  try {\n    return await host.sharedWorker.request('value')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'listen',
          description: 'Native SharedWorker connect-event scope issuing actual ports.',
          whenToUse: 'Native SharedWorker connect-event scope issuing actual ports.',
          defaultValue: 'Absent in page mode.'
        },
        {
          name: 'namespace',
          description: 'Unique Host property exposing this transport calls and extensions.',
          whenToUse: 'Unique Host property exposing this transport calls and extensions.',
          defaultValue: 'Omitted: the factory namespace.'
        },
        {
          name: 'features',
          description: 'Complete call-feature instances scoped to this transport.',
          whenToUse: 'Complete call-feature instances scoped to this transport.',
          defaultValue: 'Omitted: no optional policy installed by this field.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        'Attach an application-created SharedWorker page port without transferring native ownership.',
        'Accept several genuine connect events on a worker scope and isolate their Sessions.'
      ],
      avoidWhen: [
        'Do not install two active listeners on the same native connect scope.',
        'Do not close the borrowed SharedWorker or port through an RPC disposal assumption; the caller owns it.'
      ]
    },
    zh: {
      purpose:
        '借用页面侧 SharedWorker 端口，或在真实工作端 connect 域监听；每个接纳的 MessagePort 独立进行 Host 握手，移除一条连接不影响兄弟端口及调用者工作程序寿命。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(worker: SharedWorker) {\n  const host = await createRpcHost({\n    plugins: [sharedWorkerPlugin({ sharedWorker: worker })],\n  })\n  try {\n    return await host.sharedWorker.request('value')\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'sharedWorker.port',
          description:
            '页面持有的共享工作程序提供的实际端口；插件订阅该借入端口，关闭插件不会关闭物理端口。',
          whenToUse:
            '页面持有的共享工作程序提供的实际端口；插件订阅该借入端口，关闭插件不会关闭物理端口。',
          defaultValue: '监听模式不提供；页面模式通过 sharedWorker 提供。'
        },
        {
          name: 'name',
          description: '本地原生登记名称，与已接纳的远端身份分开。',
          whenToUse: '本地原生登记名称，与已接纳的远端身份分开。',
          defaultValue: '省略时使用原生登记默认名称。'
        },
        {
          name: 'expose',
          description: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          whenToUse: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          defaultValue: '省略时不选取普通功能输出。'
        },
        {
          name: 'connect',
          description: '唯一会话握手预算的设置。',
          whenToUse: '唯一会话握手预算的设置。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'connect.timeoutMs',
          description: '会话协商使用的有限非负毫秒预算。',
          whenToUse: '会话协商使用的有限非负毫秒预算。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'sharedWorker',
          description: '借入端口的实际共享工作程序，与监听来源互斥。',
          whenToUse: '借入端口的实际共享工作程序，与监听来源互斥。',
          defaultValue: '监听模式不提供。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(worker: SharedWorker) {\n  const host = await createRpcHost({\n    plugins: [sharedWorkerPlugin({ sharedWorker: worker })],\n  })\n  try {\n    return await host.sharedWorker.request('value')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'listen',
          description: '签发实际端口的原生共享工作程序连接事件域。',
          whenToUse: '签发实际端口的原生共享工作程序连接事件域。',
          defaultValue: '页面模式不提供。'
        },
        {
          name: 'namespace',
          description: '宿主发布此传输调用及扩展的唯一属性名。',
          whenToUse: '宿主发布此传输调用及扩展的唯一属性名。',
          defaultValue: '省略时使用工厂默认命名空间。'
        },
        {
          name: 'features',
          description: '作用于此传输的完整调用功能实例。',
          whenToUse: '作用于此传输的完整调用功能实例。',
          defaultValue: '省略时不通过此字段安装可选策略。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        '接入应用创建的 SharedWorker 页面端口，不转移原生所有权。',
        '在工作域接纳多个真实 connect 事件，并隔离对应会话。'
      ],
      avoidWhen: [
        '不要在同一原生 connect 域安装两个活动监听器。',
        '不要假设 RPC 销毁会关闭借用工作程序或端口，它们由调用者持有。'
      ]
    }
  },
  'rpc-plugin-browser:index:webTransportPlugin': {
    en: {
      purpose:
        'Borrow a WebTransport session, await its readiness and open one reliable bidirectional byte stream. The plugin owns the acquired stream reader/writer cleanup while the enclosing session remains caller-owned.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport {\n  webTransportPlugin,\n  type IWebTransportPluginOptions,\n} from '@migaia/rpc-plugin-browser'\n\nexport async function callReliableSession(\n  session: IWebTransportPluginOptions['session'],\n) {\n  const host = await createRpcHost({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    return await host.webTransport.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'name',
          description: 'Local native registration name, separate from accepted remote identity.',
          whenToUse: 'Local native registration name, separate from accepted remote identity.',
          defaultValue: 'Omitted: the native registration default.'
        },
        {
          name: 'expose',
          description:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          whenToUse:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          defaultValue: 'Omitted: no ordinary Feature output selected.'
        },
        {
          name: 'connect',
          description: 'Settings for the sole Session handshake budget.',
          whenToUse: 'Settings for the sole Session handshake budget.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'connect.timeoutMs',
          description: 'Finite nonnegative Session negotiation budget in milliseconds.',
          whenToUse: 'Finite nonnegative Session negotiation budget in milliseconds.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'session',
          description:
            'Application-established reliable session with createBidirectionalStream; counterpart must implement the compatible byte RPC protocol.',
          whenToUse:
            'Application-established reliable session with createBidirectionalStream; counterpart must implement the compatible byte RPC protocol.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport {\n  webTransportPlugin,\n  type IWebTransportPluginOptions,\n} from '@migaia/rpc-plugin-browser'\n\nexport async function callReliableSession(\n  session: IWebTransportPluginOptions['session'],\n) {\n  const host = await createRpcHost({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    return await host.webTransport.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'namespace',
          description: 'Unique Host property exposing this transport calls and extensions.',
          whenToUse: 'Unique Host property exposing this transport calls and extensions.',
          defaultValue: 'Omitted: the factory namespace.'
        },
        {
          name: 'features',
          description: 'Complete call-feature instances scoped to this transport.',
          whenToUse: 'Complete call-feature instances scoped to this transport.',
          defaultValue: 'Omitted: no optional policy installed by this field.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        'Carry framed RPC bytes over one reliable stream from an existing WebTransport connection.',
        'Release both acquired stream locks when native acquisition or Session cleanup fails.'
      ],
      avoidWhen: [
        'Use a separate application protocol for datagrams; this factory accepts only reliable streams.',
        'Do not expect Host close to call session.close on the borrowed WebTransport session.'
      ]
    },
    zh: {
      purpose:
        '借用 WebTransport 会话，等待其就绪并打开一条可靠双向字节流；插件拥有已取得读写流的清理，外围会话仍由调用者持有，不提供数据报式 RPC。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport {\n  webTransportPlugin,\n  type IWebTransportPluginOptions,\n} from '@migaia/rpc-plugin-browser'\n\nexport async function callReliableSession(\n  session: IWebTransportPluginOptions['session'],\n) {\n  const host = await createRpcHost({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    return await host.webTransport.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'name',
          description: '本地原生登记名称，与已接纳的远端身份分开。',
          whenToUse: '本地原生登记名称，与已接纳的远端身份分开。',
          defaultValue: '省略时使用原生登记默认名称。'
        },
        {
          name: 'expose',
          description: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          whenToUse: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          defaultValue: '省略时不选取普通功能输出。'
        },
        {
          name: 'connect',
          description: '唯一会话握手预算的设置。',
          whenToUse: '唯一会话握手预算的设置。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'connect.timeoutMs',
          description: '会话协商使用的有限非负毫秒预算。',
          whenToUse: '会话协商使用的有限非负毫秒预算。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'session',
          description: '应用已建立且能创建双向流的可靠会话，对端须实现兼容字节调用协议。',
          whenToUse: '应用已建立且能创建双向流的可靠会话，对端须实现兼容字节调用协议。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport {\n  webTransportPlugin,\n  type IWebTransportPluginOptions,\n} from '@migaia/rpc-plugin-browser'\n\nexport async function callReliableSession(\n  session: IWebTransportPluginOptions['session'],\n) {\n  const host = await createRpcHost({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })],\n  })\n  try {\n    return await host.webTransport.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'namespace',
          description: '宿主发布此传输调用及扩展的唯一属性名。',
          whenToUse: '宿主发布此传输调用及扩展的唯一属性名。',
          defaultValue: '省略时使用工厂默认命名空间。'
        },
        {
          name: 'features',
          description: '作用于此传输的完整调用功能实例。',
          whenToUse: '作用于此传输的完整调用功能实例。',
          defaultValue: '省略时不通过此字段安装可选策略。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        '在既有 WebTransport 连接的一条可靠流上传递分帧 RPC 字节。',
        '原生获取或会话清理失败时，释放实际取得的两个流锁。'
      ],
      avoidWhen: [
        '数据报应使用独立应用协议，此工厂只接纳可靠流。',
        '不要期待 Host 关闭会对借用 WebTransport 会话调用 session.close。'
      ]
    }
  },
  'rpc-plugin-browser:index:windowPlugin': {
    en: {
      purpose:
        'Borrow an actual Window target with an explicit origin and a native message receiver. Incoming events must match both target identity and origin; the plugin does not create, navigate or close the caller Window.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })],\n  })\n  try {\n    return await host.window.request('title')\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'name',
          description: 'Local native registration name, separate from accepted remote identity.',
          whenToUse: 'Local native registration name, separate from accepted remote identity.',
          defaultValue: 'Omitted: the native registration default.'
        },
        {
          name: 'expose',
          description:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          whenToUse:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          defaultValue: 'Omitted: no ordinary Feature output selected.'
        },
        {
          name: 'connect',
          description: 'Settings for the sole Session handshake budget.',
          whenToUse: 'Settings for the sole Session handshake budget.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'connect.timeoutMs',
          description: 'Finite nonnegative Session negotiation budget in milliseconds.',
          whenToUse: 'Finite nonnegative Session negotiation budget in milliseconds.',
          defaultValue: 'Omitted: Host handshake default.'
        },
        {
          name: 'window',
          description:
            'Application-selected Window or iframe message destination; origin restricts delivery, and this target does not replace the local receiving container.',
          whenToUse:
            'Application-selected Window or iframe message destination; origin restricts delivery, and this target does not replace the local receiving container.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })],\n  })\n  try {\n    return await host.window.request('title')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'origin',
          description:
            'Required nonempty destination origin. Wildcard requires explicit unsafe opt-in.',
          whenToUse:
            'Required nonempty destination origin. Wildcard requires explicit unsafe opt-in.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })],\n  })\n  try {\n    return await host.window.request('title')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'receiver',
          description:
            'Local native receiving surface configured separately from the sending target; received events must still satisfy the selected origin and peer checks.',
          whenToUse:
            'Local native receiving surface configured separately from the sending target; received events must still satisfy the selected origin and peer checks.',
          defaultValue: 'Omitted: original default receiver.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })],\n  })\n  try {\n    return await host.window.request('title')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'allowUnsafeTargetOrigin',
          description:
            'Explicit true permits wildcard target origin; real source checking remains.',
          whenToUse: 'Explicit true permits wildcard target origin; real source checking remains.',
          defaultValue: 'Omitted/false: wildcard rejected.'
        },
        {
          name: 'namespace',
          description: 'Unique Host property exposing this transport calls and extensions.',
          whenToUse: 'Unique Host property exposing this transport calls and extensions.',
          defaultValue: 'Omitted: the factory namespace.'
        },
        {
          name: 'features',
          description: 'Complete call-feature instances scoped to this transport.',
          whenToUse: 'Complete call-feature instances scoped to this transport.',
          defaultValue: 'Omitted: no optional policy installed by this field.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        'Connect a page to a known iframe or opener using its actual Window object and exact origin.',
        'Keep inbound receiving scope distinct from the borrowed outbound Window target.'
      ],
      avoidWhen: [
        'Do not use a wildcard origin without the explicit unsafe opt-in; source identity still must match.',
        'Do not treat a payload senderId as a replacement for native event.source filtering.'
      ]
    },
    zh: {
      purpose:
        '借用真实 Window 目标、显式来源域及原生消息接收面，入站事件同时匹配目标身份与来源域；插件不创建、导航或关闭调用者窗口。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })],\n  })\n  try {\n    return await host.window.request('title')\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'name',
          description: '本地原生登记名称，与已接纳的远端身份分开。',
          whenToUse: '本地原生登记名称，与已接纳的远端身份分开。',
          defaultValue: '省略时使用原生登记默认名称。'
        },
        {
          name: 'expose',
          description: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          whenToUse: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          defaultValue: '省略时不选取普通功能输出。'
        },
        {
          name: 'connect',
          description: '唯一会话握手预算的设置。',
          whenToUse: '唯一会话握手预算的设置。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'connect.timeoutMs',
          description: '会话协商使用的有限非负毫秒预算。',
          whenToUse: '会话协商使用的有限非负毫秒预算。',
          defaultValue: '省略时使用宿主握手默认值。'
        },
        {
          name: 'window',
          description:
            '应用指定的页面或内嵌页面消息发送目标，配合 origin 限定投递范围，不作为本地消息接收容器。',
          whenToUse:
            '应用指定的页面或内嵌页面消息发送目标，配合 origin 限定投递范围，不作为本地消息接收容器。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })],\n  })\n  try {\n    return await host.window.request('title')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'origin',
          description: '必填非空目标来源域，通配值须显式不安全选择。',
          whenToUse: '必填非空目标来源域，通配值须显式不安全选择。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })],\n  })\n  try {\n    return await host.window.request('title')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'receiver',
          description:
            '本地原生消息接收面，与发送目标分开配置，接收事件仍须满足已选来源与对端校验。',
          whenToUse: '本地原生消息接收面，与发送目标分开配置，接收事件仍须满足已选来源与对端校验。',
          defaultValue: '省略时使用原默认接收面。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })],\n  })\n  try {\n    return await host.window.request('title')\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'allowUnsafeTargetOrigin',
          description: '显式真值允许通配目标来源域，真实来源校验仍保留。',
          whenToUse: '显式真值允许通配目标来源域，真实来源校验仍保留。',
          defaultValue: '省略或假值时拒绝通配。'
        },
        {
          name: 'namespace',
          description: '宿主发布此传输调用及扩展的唯一属性名。',
          whenToUse: '宿主发布此传输调用及扩展的唯一属性名。',
          defaultValue: '省略时使用工厂默认命名空间。'
        },
        {
          name: 'features',
          description: '作用于此传输的完整调用功能实例。',
          whenToUse: '作用于此传输的完整调用功能实例。',
          defaultValue: '省略时不通过此字段安装可选策略。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    },\n  })\n  return createRpcHost({\n    plugins: [\n      observer,\n      windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] }),\n    ],\n  })\n}"
        }
      ],
      scenarios: [
        '使用实际窗口对象和精确来源域，连接页面与已知 iframe 或打开者。',
        '将入站接收域与借用的出站 Window 目标明确分开。'
      ],
      avoidWhen: [
        '未显式启用不安全选项时不要使用通配来源域，来源对象仍必须匹配。',
        '不要用载荷中的 senderId 替代原生 event.source 筛选。'
      ]
    }
  },
  'rpc-plugin-coroutines:index:coroutinePlugin': {
    en: {
      purpose:
        'Run a cooperative task over a real MessageChannel or borrow the opaque connection delivered to that task. The original supervisor owns stop and replacement; tasks share the event loop and cannot preempt synchronous blocking.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  heartbeat()\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\ntry {\n  console.log(await parent.coroutine.request('double', 21))\n} finally {\n  await parent.close()\n}",
      options: [
        {
          name: 'name',
          description: 'Local native registration name, separate from accepted remote identity.',
          whenToUse: 'Local native registration name, separate from accepted remote identity.',
          defaultValue: 'Omitted: the native registration default.'
        },
        {
          name: 'namespace',
          description: 'Unique Host property exposing this transport calls and extensions.',
          whenToUse: 'Unique Host property exposing this transport calls and extensions.',
          defaultValue: 'Omitted: the factory namespace.'
        },
        {
          name: 'expose',
          description:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          whenToUse:
            'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
          defaultValue: 'Omitted: no ordinary Feature output selected.'
        },
        {
          name: 'report',
          description:
            'Receives native background and cleanup failures; operation rejections retain original causes.',
          whenToUse:
            'Receives native background and cleanup failures; operation rejections retain original causes.',
          defaultValue: 'Omitted: configured Host reporter, then effective default.'
        },
        {
          name: 'features',
          description:
            'Complete call and supported native feature definitions scoped to this transport. Per-call timeout and retry take instances or false.',
          whenToUse:
            'Complete call and supported native feature definitions scoped to this transport. Per-call timeout and retry take instances or false.',
          defaultValue: 'Omitted: no optional policy installed by this field.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  heartbeat()\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\ntry {\n  console.log(await parent.coroutine.request('double', 21))\n} finally {\n  await parent.close()\n}"
        },
        {
          name: 'spawn',
          description:
            'Actual task function. Returning settles its generation and closes native ports.',
          whenToUse:
            'Actual task function. Returning settles its generation and closes native ports.',
          defaultValue: 'Absent in child mode.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  heartbeat()\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\ntry {\n  console.log(await parent.coroutine.request('double', 21))\n} finally {\n  await parent.close()\n}"
        },
        {
          name: 'connectToParent',
          description:
            'Exact opaque context.connect issued by this task invocation, not copied or reused.',
          whenToUse:
            'Exact opaque context.connect issued by this task invocation, not copied or reused.',
          defaultValue: 'Absent in spawn mode.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  heartbeat()\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\ntry {\n  console.log(await parent.coroutine.request('double', 21))\n} finally {\n  await parent.close()\n}"
        },
        {
          name: 'supervisor',
          description:
            'Original restart, terminalPolicy, startupTimeoutMs, stop, budget and heartbeat policy.',
          whenToUse:
            'Original restart, terminalPolicy, startupTimeoutMs, stop, budget and heartbeat policy.',
          defaultValue: 'Omitted: original supervisor defaults.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  heartbeat()\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\ntry {\n  console.log(await parent.coroutine.request('double', 21))\n} finally {\n  await parent.close()\n}"
        }
      ],
      scenarios: [
        'Exercise bidirectional Host calls in a task when native process or Worker isolation is unnecessary.',
        'Install a repeatable spawn source with the native pool feature for bounded cooperative members.'
      ],
      avoidWhen: [
        'Choose Process or Thread for code that needs native isolation or can block the event loop.',
        'Do not copy a connect token or pool a parent-only token; only its genuine task source can lend it.'
      ]
    },
    zh: {
      purpose:
        '经真实 MessageChannel 运行协作任务，或借用交给该任务的不可伪造连接；原监督器拥有停止与替换，任务共享事件循环，不能抢占同步阻塞。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  heartbeat()\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\ntry {\n  console.log(await parent.coroutine.request('double', 21))\n} finally {\n  await parent.close()\n}",
      options: [
        {
          name: 'name',
          description: '本地原生登记名称，与已接纳的远端身份分开。',
          whenToUse: '本地原生登记名称，与已接纳的远端身份分开。',
          defaultValue: '省略时使用原生登记默认名称。'
        },
        {
          name: 'namespace',
          description: '宿主发布此传输调用及扩展的唯一属性名。',
          whenToUse: '宿主发布此传输调用及扩展的唯一属性名。',
          defaultValue: '省略时使用工厂默认命名空间。'
        },
        {
          name: 'expose',
          description: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          whenToUse: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。',
          defaultValue: '省略时不选取普通功能输出。'
        },
        {
          name: 'report',
          description: '接收原生后台及清理失败；操作拒绝保留原始原因。',
          whenToUse: '接收原生后台及清理失败；操作拒绝保留原始原因。',
          defaultValue: '省略时使用宿主显式报告器，再使用有效默认报告器。'
        },
        {
          name: 'features',
          description:
            '此传输作用域的完整调用及受支持原生功能定义；逐次调用的超时和重试使用完整实例或关闭值。',
          whenToUse:
            '此传输作用域的完整调用及受支持原生功能定义；逐次调用的超时和重试使用完整实例或关闭值。',
          defaultValue: '省略时不通过此字段安装可选策略。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  heartbeat()\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\ntry {\n  console.log(await parent.coroutine.request('double', 21))\n} finally {\n  await parent.close()\n}"
        },
        {
          name: 'spawn',
          description: '实际任务函数，返回会结束本代并关闭原生端口。',
          whenToUse: '实际任务函数，返回会结束本代并关闭原生端口。',
          defaultValue: '子端模式不提供。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  heartbeat()\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\ntry {\n  console.log(await parent.coroutine.request('double', 21))\n} finally {\n  await parent.close()\n}"
        },
        {
          name: 'connectToParent',
          description: '本次任务调用签发的精确不透明句柄，不可复制或复用。',
          whenToUse: '本次任务调用签发的精确不透明句柄，不可复制或复用。',
          defaultValue: '启动模式不提供。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  heartbeat()\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\ntry {\n  console.log(await parent.coroutine.request('double', 21))\n} finally {\n  await parent.close()\n}"
        },
        {
          name: 'supervisor',
          description: '原重启、终态、启动期限、停止、预算与心跳策略。',
          whenToUse: '原重启、终态、启动期限、停止、预算与心跳策略。',
          defaultValue: '省略时使用原监督默认。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {\n  const child = await createRpcHost({\n    plugins: [coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  heartbeat()\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\ntry {\n  console.log(await parent.coroutine.request('double', 21))\n} finally {\n  await parent.close()\n}"
        }
      ],
      scenarios: [
        '无需原生进程或 Worker 隔离时，在任务内执行双向 Host 调用。',
        '为可重复启动来源安装原生池功能，约束协作成员数量。'
      ],
      avoidWhen: [
        '需要原生隔离或可能阻塞事件循环的代码应选择进程或线程。',
        '不要复制连接令牌或池化仅父连接令牌，只有真实任务来源能借出它。'
      ]
    }
  },
  'rpc-plugin-pool:index:RPC_POOL_PEER_ID': {
    en: {
      purpose:
        'The exact logical address pool exposed by the installed same-transport origin. Hidden member instance ids stay in native member controls rather than becoming independent direct-call targets on the Host.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\nimport { pool } from '@migaia/rpc-plugin-pool'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [\n    threadPlugin({ spawn: true, features: [pool({ size: 3, maxQueue: 32 })] }),\n  ] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.send('pool', 'double', 21))\n    await host.thread.pool.resize(2)\n    console.log(host.thread.pool.stats().targetSize)\n  } finally {\n    await host.close()\n  }\n}",
      options: [],
      scenarios: [
        'Address the single logical pool target when the namespace also requires an explicit target.',
        'Distinguish public pool routing from native members.list inspection of private resources.'
      ],
      avoidWhen: [
        'Do not use a private member id as a new direct target merely because it appears in member queries.',
        'Do not equate this logical label with a peer authentication credential or physical carrier id.'
      ]
    },
    zh: {
      purpose:
        '这是同载体来源安装后公开的精确逻辑地址 pool，隐藏成员实例标识保留在原生成员控制中，不会变成 Host 上独立的定向调用目标。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\nimport { pool } from '@migaia/rpc-plugin-pool'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [\n    threadPlugin({ spawn: true, features: [pool({ size: 3, maxQueue: 32 })] }),\n  ] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.send('pool', 'double', 21))\n    await host.thread.pool.resize(2)\n    console.log(host.thread.pool.stats().targetSize)\n  } finally {\n    await host.close()\n  }\n}",
      options: [],
      scenarios: [
        '命名空间需要显式目标时，指定唯一逻辑池目标。',
        '区分公开池路由与 members.list 对私有原生资源的检查。'
      ],
      avoidWhen: [
        '不要仅因成员查询展示私有标识，就把它当作新的定向目标。',
        '不要把逻辑标签等同于对端认证凭据或物理载体标识。'
      ]
    }
  },
  'rpc-plugin-pool:index:RpcPoolState': {
    en: {
      purpose:
        'Scheduling phases reported by pool.stats: open admits work, closing fences new work and drains accepted operations, and closed follows native cleanup attempts. These states are independent from each member supervisor generation.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\nimport { pool } from '@migaia/rpc-plugin-pool'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [\n    threadPlugin({ spawn: true, features: [pool({ size: 3, maxQueue: 32 })] }),\n  ] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.send('pool', 'double', 21))\n    await host.thread.pool.resize(2)\n    console.log(host.thread.pool.stats().targetSize)\n  } finally {\n    await host.close()\n  }\n}",
      options: [],
      scenarios: [
        'Show that a pool has fenced new calls while previously accepted operations are draining.',
        'Report the terminal scheduler phase after every original member cleanup attempt.'
      ],
      avoidWhen: [
        'Do not infer individual member health or restart readiness from this aggregate phase.',
        'Do not use closed as an error code or proof that all cleanup attempts succeeded.'
      ]
    },
    zh: {
      purpose:
        'pool.stats 报告的调度阶段：open 接纳工作，closing 阻止新工作并排空已接纳操作，closed 表示原生清理尝试已完成；它们独立于各成员监督代际。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\nimport { pool } from '@migaia/rpc-plugin-pool'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [\n    threadPlugin({ spawn: true, features: [pool({ size: 3, maxQueue: 32 })] }),\n  ] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.send('pool', 'double', 21))\n    await host.thread.pool.resize(2)\n    console.log(host.thread.pool.stats().targetSize)\n  } finally {\n    await host.close()\n  }\n}",
      options: [],
      scenarios: [
        '展示池已阻止新调用，而先前接纳操作仍在排空。',
        '原成员清理均已尝试后，报告终态调度阶段。'
      ],
      avoidWhen: [
        '不要从聚合阶段推断单个成员健康或重启就绪。',
        '不要把 closed 当作错误码或所有清理尝试成功的证明。'
      ]
    }
  },
  'rpc-plugin-pool:index:pool': {
    en: {
      purpose:
        'Create a complete same-transport native pool feature for repeatable Process, Thread or Coroutine acquisition. Install it in that transport features array; private members share one logical pool target and the original bounded FIFO scheduler.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\nimport { pool } from '@migaia/rpc-plugin-pool'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [\n    threadPlugin({ spawn: true, features: [pool({ size: 3, maxQueue: 32 })] }),\n  ] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.send('pool', 'double', 21))\n    await host.thread.pool.resize(2)\n    console.log(host.thread.pool.stats().targetSize)\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'size',
          description:
            'Required positive integer target; installation waits for that many independent members.',
          whenToUse:
            'Required positive integer target; installation waits for that many independent members.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\nimport { pool } from '@migaia/rpc-plugin-pool'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [\n    threadPlugin({ spawn: true, features: [pool({ size: 3, maxQueue: 32 })] }),\n  ] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.send('pool', 'double', 21))\n    await host.thread.pool.resize(2)\n    console.log(host.thread.pool.stats().targetSize)\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'maxQueue',
          description: 'Bounded waiting FIFO length; zero rejects when no slot is free.',
          whenToUse: 'Bounded waiting FIFO length; zero rejects when no slot is free.',
          defaultValue: 'Omitted: 256 waiting entries.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\nimport { pool } from '@migaia/rpc-plugin-pool'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [\n    threadPlugin({ spawn: true, features: [pool({ size: 3, maxQueue: 32 })] }),\n  ] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.send('pool', 'double', 21))\n    await host.thread.pool.resize(2)\n    console.log(host.thread.pool.stats().targetSize)\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'idleTimeoutMs',
          description:
            'Finite positive milliseconds at most 2147483647; retirement keeps targetSize for later refill.',
          whenToUse:
            'Finite positive milliseconds at most 2147483647; retirement keeps targetSize for later refill.',
          defaultValue: 'Omitted: disable idle retirement.'
        },
        {
          name: 'scheduler',
          description:
            'Borrowed original idle scheduler only, not native restart or call deadlines.',
          whenToUse: 'Borrowed original idle scheduler only, not native restart or call deadlines.',
          defaultValue: 'Omitted: systemScheduler.'
        }
      ],
      scenarios: [
        'Bound native parallel members while dispatching through one logical namespace target.',
        'Resize or retire idle members while accepted calls keep their original member completion.'
      ],
      avoidWhen: [
        'Do not mix unrelated media or install pool as a standalone transport plugin.',
        'Do not use listener-only or parent-only sources that cannot open independent members.'
      ]
    },
    zh: {
      purpose:
        '为可重复获取的进程、线程或协程来源创建同载体完整原生池功能，装入该传输 features 数组；私有成员共享一个逻辑 pool 目标及原有有界先进先出调度器。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\nimport { pool } from '@migaia/rpc-plugin-pool'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [\n    threadPlugin({ spawn: true, features: [pool({ size: 3, maxQueue: 32 })] }),\n  ] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.send('pool', 'double', 21))\n    await host.thread.pool.resize(2)\n    console.log(host.thread.pool.stats().targetSize)\n  } finally {\n    await host.close()\n  }\n}",
      options: [
        {
          name: 'size',
          description: '必填正整数目标，安装等待相应数量独立成员。',
          whenToUse: '必填正整数目标，安装等待相应数量独立成员。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\nimport { pool } from '@migaia/rpc-plugin-pool'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [\n    threadPlugin({ spawn: true, features: [pool({ size: 3, maxQueue: 32 })] }),\n  ] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.send('pool', 'double', 21))\n    await host.thread.pool.resize(2)\n    console.log(host.thread.pool.stats().targetSize)\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'maxQueue',
          description: '有界等待队列长度，零表示无空闲槽时拒绝。',
          whenToUse: '有界等待队列长度，零表示无空闲槽时拒绝。',
          defaultValue: '省略时允许二百五十六个等待项。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\nimport { pool } from '@migaia/rpc-plugin-pool'\n\ntype IWorkerApi = { double(value: number): number }\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 },\n  })\n} else {\n  const plugins = [\n    threadPlugin({ spawn: true, features: [pool({ size: 3, maxQueue: 32 })] }),\n  ] as const\n  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\n  try {\n    console.log(await host.thread.send('pool', 'double', 21))\n    await host.thread.pool.resize(2)\n    console.log(host.thread.pool.stats().targetSize)\n  } finally {\n    await host.close()\n  }\n}"
        },
        {
          name: 'idleTimeoutMs',
          description: '不超过限定整数上界的有限正毫秒，空闲退休保留目标容量供后续补齐。',
          whenToUse: '不超过限定整数上界的有限正毫秒，空闲退休保留目标容量供后续补齐。',
          defaultValue: '省略时不进行空闲退休。'
        },
        {
          name: 'scheduler',
          description: '仅借用原空闲调度器，不接管原生重启或调用期限。',
          whenToUse: '仅借用原空闲调度器，不接管原生重启或调用期限。',
          defaultValue: '省略时使用系统调度器。'
        }
      ],
      scenarios: [
        '通过一个逻辑命名空间目标分发，同时限制原生成员并行数量。',
        '调整池大小或退回空闲成员时，已接纳调用保留原成员完成关系。'
      ],
      avoidWhen: [
        '不要混合无关媒介，也不要把 pool 当作独立传输插件安装。',
        '不能独立打开成员的仅监听或仅父连接来源不适合池化。'
      ]
    }
  },
  'rpc-plugin-devtools:index:devtoolsPlugin': {
    en: {
      purpose:
        'Install a genuine readonly observation flow backed by one caller-owned collector. Query, watch, stats, describe and close are that same collector methods; each Host installation owns only its emitter subscription.',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [tools, coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [tools, coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.coroutine.request('double', 21))\n  console.log((await next).value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      options: [
        {
          name: 'methods',
          description:
            'Exact method path filter supplied by the application; methodless control events remain observable.',
          whenToUse:
            'Exact method path filter supplied by the application; methodless control events remain observable.',
          defaultValue: 'No method filter; all method-bearing events are eligible.'
        },
        {
          name: 'sample',
          description:
            'Deterministic sampling fraction in the interval greater than zero through one, using sender/message identity rather than random per-stage decisions.',
          whenToUse:
            'Deterministic sampling fraction in the interval greater than zero through one, using sender/message identity rather than random per-stage decisions.',
          defaultValue: '`1`, retaining all eligible identities before retention limits.'
        },
        {
          name: 'capture',
          description:
            'Explicit stages whose content may be read. Select names from RpcProbeStageName in @migaia/rpc-host/plugins/probe and keep capture within initially subscribed stages.',
          whenToUse:
            'Explicit stages whose content may be read. Select names from RpcProbeStageName in @migaia/rpc-host/plugins/probe and keep capture within initially subscribed stages.',
          defaultValue: 'No content capture; observation remains metadata-only.'
        },
        {
          name: 'redact',
          description:
            'Synchronous callback receiving numeric RpcProbeStage and captured content. Return the retained replacement; never retain the reusable event view. Collector executes it during ingestion, log executes it at the canonical emitter.',
          whenToUse:
            'Set it when explicitly captured content contains data that should not be retained or logged. Return a replacement, or `undefined` to discard content. Omitting it retains the captured reference unchanged; a thrown error is reported and that content is dropped.',
          defaultValue: 'No redactor; explicitly captured content retains its original reference.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [tools, coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [tools, coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.coroutine.request('double', 21))\n  console.log((await next).value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        {
          name: 'onError',
          description:
            'Synchronous observer receiving an original diagnostic error. Return nothing; observer failures are reported through the host failure channel without changing the RPC operation.',
          whenToUse:
            'Set this callback when a diagnostic failure should reach the application monitor. It receives collector observation failures without replacing a business result. Omission keeps the documented host reporter for the owning component.',
          defaultValue: 'Uses the Core hostRethrowReporter failure channel.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [tools, coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [tools, coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.coroutine.request('double', 21))\n  console.log((await next).value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        {
          name: 'stages',
          description:
            'Initial stage names from Core RpcProbeStageName; physical stages require explicit selection and selection alone never enables capture.',
          whenToUse:
            'Use `message` for logical calls and `peer` for connection lifecycle. Add `envelope`, `encoded`, `frame`, `protected` or `carrier` to inspect those physical processing steps. Omission selects message and peer; choosing a stage never enables content capture by itself.',
          defaultValue: '`["message", "peer"]`; physical stages are not subscribed.',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [tools, coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [tools, coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.coroutine.request('double', 21))\n  console.log((await next).value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        {
          name: 'maxEvents',
          description:
            'Main-ring positive safe integer capacity, at most the JavaScript array length limit; newest events evict oldest events.',
          whenToUse:
            'Main-ring positive safe integer capacity, at most the JavaScript array length limit; newest events evict oldest events.',
          defaultValue: '10000 retained events in the main ring.'
        },
        {
          name: 'maxContentBytes',
          description:
            'Nonnegative safe integer budget for content retained by the main query ring; independent recording/watch references and opaque-object sizing are outside this byte total. It is not a process-wide memory ceiling; excess content drops while metadata stays.',
          whenToUse:
            'Nonnegative safe integer budget for content retained by the main query ring; independent recording/watch references and opaque-object sizing are outside this byte total. It is not a process-wide memory ceiling; excess content drops while metadata stays.',
          defaultValue: '8388608 bytes, or eight mebibytes.'
        },
        {
          name: 'maxInterned',
          description:
            'Positive safe integer reader name-table bound, at most floor(sqrt(MAX_SAFE_INTEGER)) minus one; overflow uses an explicit marker.',
          whenToUse:
            'Positive safe integer reader name-table bound, at most floor(sqrt(MAX_SAFE_INTEGER)) minus one; overflow uses an explicit marker.',
          defaultValue: '65536 names; ingestion itself retains raw string references.'
        },
        {
          name: 'exposeContent',
          description:
            'Allows captured content across the portable service boundary; local query and stopped recordings already use their retained captured content.',
          whenToUse:
            'Allows captured content across the portable service boundary; local query and stopped recordings already use their retained captured content.',
          defaultValue: 'false; service responses omit captured content.'
        }
      ],
      scenarios: [
        'Share a collector across several Hosts to inspect their actual emitted call and carrier observations.',
        'Query bounded history or record observations without modifying provider execution.'
      ],
      avoidWhen: [
        'Do not use the collector to authorize calls, mutate frames or intervene in execution.',
        'Do not assume Host disposal closes a shared collector or produces stages unavailable from a carrier.'
      ]
    },
    zh: {
      purpose:
        '安装由一个调用者持有收集器支撑的真实只读观察信息流，查询、观察、统计、描述及关闭均为同一收集器方法；每个 Host 安装只拥有自身发射器订阅。',
      quickStart:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [tools, coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [tools, coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.coroutine.request('double', 21))\n  console.log((await next).value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}",
      options: [
        {
          name: 'methods',
          description: '应用提供的精确方法路径筛选列表，不含方法名的控制事件仍可观察。',
          whenToUse: '应用提供的精确方法路径筛选列表，不含方法名的控制事件仍可观察。',
          defaultValue: '默认不筛选方法，所有带方法名事件均可进入后续选择。'
        },
        {
          name: 'sample',
          description:
            '大于零且小于或等于一的确定性采样比例，按发送者与消息身份采样，而非逐阶段随机决定。',
          whenToUse:
            '大于零且小于或等于一的确定性采样比例，按发送者与消息身份采样，而非逐阶段随机决定。',
          defaultValue: '默认 `1`，在保留上限生效前接纳所有符合条件的身份。'
        },
        {
          name: 'capture',
          description:
            '显式允许读取内容的阶段，名称来自 `@migaia/rpc-host/plugins/probe` 的阶段名表，必须为初始订阅阶段的子集。',
          whenToUse:
            '显式允许读取内容的阶段，名称来自 `@migaia/rpc-host/plugins/probe` 的阶段名表，必须为初始订阅阶段的子集。',
          defaultValue: '默认不捕获内容，仅观察元数据。'
        },
        {
          name: 'redact',
          description:
            '接收数字阶段与已捕获内容的同步回调，返回需要保留的替代值；不可保留复用事件视图，采集器在摄取时执行，日志探针在规范发射器执行。',
          whenToUse:
            '显式捕获的内容包含不应保存或记录的数据时，设置此回调。返回替换值，或返回 `undefined` 丢弃内容。省略时原样保留捕获引用；抛错会被报告，并丢弃本次内容。',
          defaultValue: '默认无脱敏回调，显式捕获内容保留其原始引用。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [tools, coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [tools, coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.coroutine.request('double', 21))\n  console.log((await next).value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        {
          name: 'onError',
          description:
            '接收原始诊断错误的同步观察回调，无需返回值；观察回调失败经宿主失败通道报告，不改变远程调用操作结果。',
          whenToUse:
            '诊断失败需要进入应用监控时，设置这个回调。它接收采集器观察回调的失败，不替换业务结果。省略时使用所属组件文档中说明的宿主报告函数。',
          defaultValue: '默认使用核心包的宿主重新抛出报告通道。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [tools, coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [tools, coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.coroutine.request('double', 21))\n  console.log((await next).value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        {
          name: 'stages',
          description: '核心规范阶段名中的初始订阅，物理阶段需显式选择，选择本身不会开启内容捕获。',
          whenToUse:
            '用 `message` 观察逻辑调用，用 `peer` 观察连接生命周期。需要检查封装、编码、分帧、保护后内容或物理载体时，分别增加 `envelope`、`encoded`、`frame`、`protected` 或 `carrier`。省略时选择消息与连接阶段；选中阶段本身不会开启内容捕获。',
          defaultValue: '默认 `["message", "peer"]`，不订阅物理阶段。',
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'\nimport { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'\n\nasync function untilStopped(signal: AbortSignal): Promise<void> {\n  let complete!: () => void\n  const stopped = new Promise<void>((resolve) => {\n    complete = resolve\n  })\n  signal.addEventListener('abort', complete, { once: true })\n  if (signal.aborted) complete()\n  try {\n    await stopped\n  } finally {\n    signal.removeEventListener('abort', complete)\n  }\n}\n\nconst tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })\nconst task: ICoroutineUserTask = async ({ connect, signal }) => {\n  const child = await createRpcHost({\n    plugins: [tools, coroutinePlugin({ connectToParent: connect })],\n    provide: { double: (value: number) => value * 2 },\n  })\n  try {\n    await untilStopped(signal)\n  } finally {\n    await child.close()\n  }\n}\n\ntype IWorkerApi = { double(value: number): number }\nconst plugins = [tools, coroutinePlugin({ spawn: task })] as const\nconst parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })\nconst watch = tools.watch({ stages: ['message'] })\ntry {\n  const next = watch.next()\n  console.log(await parent.coroutine.request('double', 21))\n  console.log((await next).value?.events.length)\n  console.log(tools.stats().methods)\n} finally {\n  await watch.return(undefined)\n  await parent.close()\n  tools.close()\n}"
        },
        {
          name: 'maxEvents',
          description: '主环正安全整数容量，不超过语言数组长度上限，新事件淘汰最旧事件。',
          whenToUse: '主环正安全整数容量，不超过语言数组长度上限，新事件淘汰最旧事件。',
          defaultValue: '默认主环保留 `10000` 个事件。'
        },
        {
          name: 'maxContentBytes',
          description:
            '主查询环保留内容的非负安全整数预算；独立录制、观察引用及不透明对象计量不属于同一字节总量，不是进程总内存上限；超额丢弃内容但保留元数据。',
          whenToUse:
            '主查询环保留内容的非负安全整数预算；独立录制、观察引用及不透明对象计量不属于同一字节总量，不是进程总内存上限；超额丢弃内容但保留元数据。',
          defaultValue: '默认 `8388608` 字节，即八兆二进制字节。'
        },
        {
          name: 'maxInterned',
          description:
            '读取时名称表的正安全整数上限，不超过最大安全整数平方根向下取整再减一，溢出使用显式标记。',
          whenToUse:
            '读取时名称表的正安全整数上限，不超过最大安全整数平方根向下取整再减一，溢出使用显式标记。',
          defaultValue: '默认 `65536` 个名称，摄取本身保留原始字符串引用。'
        },
        {
          name: 'exposeContent',
          description:
            '允许已捕获内容通过可移植服务边界，本地查询与停止录制已可使用保留的捕获内容。',
          whenToUse: '允许已捕获内容通过可移植服务边界，本地查询与停止录制已可使用保留的捕获内容。',
          defaultValue: '默认 `false`，服务响应省略捕获内容。'
        }
      ],
      scenarios: [
        '在多个 Host 间共享收集器，检查它们真实发出的调用及载体观察。',
        '在不修改提供方执行的前提下查询有界历史或录制观察。'
      ],
      avoidWhen: [
        '不要用收集器授权调用、修改帧或介入执行。',
        '不要假设 Host 销毁会关闭共享收集器，或产生载体无法提供的观察阶段。'
      ]
    }
  },
  'serialize:core:isCanonicalBase64url': {
    en: {
      purpose:
        'Check whether a string has the canonical unpadded Base64url spelling: URL-safe alphabet, permitted length and zero unused tail bits. Empty text is valid. This pure boolean operation does not decode bytes or authenticate their content.',
      quickStart:
        "import { isCanonicalBase64url } from '@migaia/serialize/core'\nconsole.log(isCanonicalBase64url('_w'))\nconsole.log(isCanonicalBase64url('_x'))\nconsole.log(isCanonicalBase64url('_w='))",
      options: [],
      scenarios: [
        'Validate a byte-string field that explicitly requires unpadded Base64url before accepting its wire spelling.',
        'Reject alternative tail-bit spellings such as _x when _w is the canonical representation of the same byte.'
      ],
      avoidWhen: [
        'Use an actual byte decoder when the application needs decoded bytes; this check returns only a boolean.',
        'Do not treat a valid alphabet or canonical spelling as proof of a signature, trusted sender or authorized content.'
      ]
    },
    zh: {
      purpose:
        '检查字符串是否采用不带填充的规范 Base64url 拼写：只含 URL 安全字母、编码长度合法且末尾未用位为零，空字符串也有效。此纯布尔检查不解码字节，也不认证内容。',
      quickStart:
        "import { isCanonicalBase64url } from '@migaia/serialize/core'\nconsole.log(isCanonicalBase64url('_w'))\nconsole.log(isCanonicalBase64url('_x'))\nconsole.log(isCanonicalBase64url('_w='))",
      options: [],
      scenarios: [
        '字段明确要求不带填充的 Base64url 时，在接纳其线格式拼写前检查规范性。',
        '同一字节应使用规范拼写 _w 时，拒绝末尾未用位非零的替代写法 _x。'
      ],
      avoidWhen: [
        '应用需要实际字节时应使用对应解码操作，此检查仅返回布尔值。',
        '不要把合法字母表或规范拼写当作签名有效、发送方可信或内容已获授权的证明。'
      ]
    }
  }
}

/** Every address is an actual current public entry and symbol, using the existing guide-key form. */
export const rpcApiGuides: Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> = {
  ...canonicalRpcGuides,
  'rpc-host:features-retry:retry': canonicalRpcGuides['rpc-host:features:retry']!,
  'rpc-host:features-timeout:timeout': canonicalRpcGuides['rpc-host:features:timeout']!,
  'rpc-host:sdk:createRpcStreamFrameDecoderWithLimit':
    canonicalRpcGuides['rpc-host:sdk:createRpcStreamFrameDecoder']!,
  'rpc-host:plugins-typegen:default': canonicalRpcGuides['rpc-host:plugins:typegen']!,
  'rpc-host:plugins-typegen:typegen': canonicalRpcGuides['rpc-host:plugins:typegen']!,
  'rpc-host:plugins-schema:default': canonicalRpcGuides['rpc-host:plugins:schema']!,
  'rpc-host:plugins-schema:schema': canonicalRpcGuides['rpc-host:plugins:schema']!,
  'rpc-host:plugins-auth:auth': canonicalRpcGuides['rpc-host:plugins:auth']!,
  'rpc-host:plugins-auth:default': canonicalRpcGuides['rpc-host:plugins:auth']!,
  'rpc-host:plugins-chunk:chunk': canonicalRpcGuides['rpc-host:plugins:chunk']!,
  'rpc-host:plugins-chunk:default': canonicalRpcGuides['rpc-host:plugins:chunk']!,
  'rpc-host:plugins-batch:batch': canonicalRpcGuides['rpc-host:plugins:batch']!,
  'rpc-host:plugins-batch:default': canonicalRpcGuides['rpc-host:plugins:batch']!,
  'rpc-host:plugins-limits:default': canonicalRpcGuides['rpc-host:plugins:limits']!,
  'rpc-host:plugins-limits:limits': canonicalRpcGuides['rpc-host:plugins:limits']!,
  'rpc-host:plugins-link-policy:default': canonicalRpcGuides['rpc-host:plugins:linkPolicy']!,
  'rpc-host:plugins-link-policy:linkPolicy': canonicalRpcGuides['rpc-host:plugins:linkPolicy']!,
  'rpc-host:plugins-idempotency:createRpcIdempotencyStore':
    canonicalRpcGuides['rpc-host:plugins:createRpcIdempotencyStore']!,
  'rpc-host:plugins-idempotency:default': canonicalRpcGuides['rpc-host:plugins:idempotency']!,
  'rpc-host:plugins-idempotency:idempotency': canonicalRpcGuides['rpc-host:plugins:idempotency']!,
  'rpc-host:plugins-probe:default': canonicalRpcGuides['rpc-host:plugins:probe']!,
  'rpc-host:plugins-probe:defineProbe': canonicalRpcGuides['rpc-host:plugins:defineProbe']!,
  'rpc-host:plugins-probe:probe': canonicalRpcGuides['rpc-host:plugins:probe']!,
  'rpc-contract:index:RPC_CORE_ERROR_SOURCE':
    canonicalRpcGuides['rpc-host:index:RPC_CORE_ERROR_SOURCE']!,
  'rpc-contract:index:RpcLifecycleError': canonicalRpcGuides['rpc-host:index:RpcLifecycleError']!,
  'rpc-contract:index:isRpcError': canonicalRpcGuides['rpc-host:index:isRpcError']!,
  'rpc-contract:index:isRpcErrorInstance': canonicalRpcGuides['rpc-host:index:isRpcErrorInstance']!,
  'rpc-contract:index:isRpcRemoteError': canonicalRpcGuides['rpc-host:index:isRpcRemoteError']!,
  'rpc-contract:index:isRpcTimeoutError': canonicalRpcGuides['rpc-host:index:isRpcTimeoutError']!,
  'rpc-contract:protocol:REMOTE_NAME_PATTERN':
    canonicalRpcGuides['rpc-contract:index:REMOTE_NAME_PATTERN']!,
  'rpc-contract:protocol:RPC_INVALID_DECLARATION_SEGMENT':
    canonicalRpcGuides['rpc-contract:index:RPC_INVALID_DECLARATION_SEGMENT']!,
  'rpc-contract:protocol:RPC_PROVIDER_DECLARATION_METHOD_MAX_CHARS':
    canonicalRpcGuides['rpc-contract:index:RPC_PROVIDER_DECLARATION_METHOD_MAX_CHARS']!,
  'rpc-contract:protocol:RPC_PROVIDER_DECLARATION_VERSION':
    canonicalRpcGuides['rpc-contract:index:RPC_PROVIDER_DECLARATION_VERSION']!,
  'rpc-contract:protocol:RPC_PROVIDER_METHOD_MAX_CHARS':
    canonicalRpcGuides['rpc-contract:index:RPC_PROVIDER_METHOD_MAX_CHARS']!,
  'rpc-contract:protocol:RPC_PROVIDER_MODES':
    canonicalRpcGuides['rpc-contract:index:RPC_PROVIDER_MODES']!,
  'rpc-contract:protocol:RPC_PROVIDER_RESERVED_NAMESPACE':
    canonicalRpcGuides['rpc-contract:index:RPC_PROVIDER_RESERVED_NAMESPACE']!,
  'rpc-contract:protocol:RpcCallMode': canonicalRpcGuides['rpc-contract:index:RpcCallMode']!,
  'rpc-contract:protocol:RpcCarrierFrameKind':
    canonicalRpcGuides['rpc-contract:index:RpcCarrierFrameKind']!,
  'rpc-contract:protocol:RpcEnvelopeViolation':
    canonicalRpcGuides['rpc-contract:index:RpcEnvelopeViolation']!,
  'rpc-contract:protocol:RpcHandshakeViolation':
    canonicalRpcGuides['rpc-contract:index:RpcHandshakeViolation']!,
  'rpc-contract:protocol:RpcProviderDeclarationLimit':
    canonicalRpcGuides['rpc-contract:index:RpcProviderDeclarationLimit']!,
  'rpc-contract:protocol:RpcProviderMode':
    canonicalRpcGuides['rpc-contract:index:RpcProviderMode']!,
  'rpc-contract:protocol:RpcRuntimeOutcomeState':
    canonicalRpcGuides['rpc-contract:index:RpcRuntimeOutcomeState']!,
  'rpc-contract:protocol:RpcRuntimeStoreContinuity':
    canonicalRpcGuides['rpc-contract:index:RpcRuntimeStoreContinuity']!,
  'rpc-contract:protocol:RpcRuntimeStoreKind':
    canonicalRpcGuides['rpc-contract:index:RpcRuntimeStoreKind']!,
  'rpc-contract:protocol:RpcShapeReason': canonicalRpcGuides['rpc-contract:index:RpcShapeReason']!,
  'rpc-contract:protocol:RpcStreamEvent': canonicalRpcGuides['rpc-contract:index:RpcStreamEvent']!,
  'rpc-contract:protocol:RpcStreamLimit': canonicalRpcGuides['rpc-contract:index:RpcStreamLimit']!,
  'rpc-contract:protocol:RpcStreamViolation':
    canonicalRpcGuides['rpc-contract:index:RpcStreamViolation']!,
  'rpc-contract:protocol:RpcWireBinaryProfile':
    canonicalRpcGuides['rpc-contract:index:RpcWireBinaryProfile']!,
  'rpc-contract:protocol:RpcWireBinaryStorage':
    canonicalRpcGuides['rpc-contract:index:RpcWireBinaryStorage']!,
  'rpc-contract:protocol:RpcWireCancel': canonicalRpcGuides['rpc-contract:index:RpcWireCancel']!,
  'rpc-contract:protocol:RpcWireCodecPattern':
    canonicalRpcGuides['rpc-contract:index:RpcWireCodecPattern']!,
  'rpc-contract:protocol:RpcWireControlOperation':
    canonicalRpcGuides['rpc-contract:index:RpcWireControlOperation']!,
  'rpc-contract:protocol:RpcWireDirectoryVersion':
    canonicalRpcGuides['rpc-contract:index:RpcWireDirectoryVersion']!,
  'rpc-contract:protocol:RpcWireExtensionPattern':
    canonicalRpcGuides['rpc-contract:index:RpcWireExtensionPattern']!,
  'rpc-contract:protocol:RpcWireField': canonicalRpcGuides['rpc-contract:index:RpcWireField']!,
  'rpc-contract:protocol:RpcWireHandshakeStep':
    canonicalRpcGuides['rpc-contract:index:RpcWireHandshakeStep']!,
  'rpc-contract:protocol:RpcWireJsonCodec':
    canonicalRpcGuides['rpc-contract:index:RpcWireJsonCodec']!,
  'rpc-contract:protocol:RpcWireKind': canonicalRpcGuides['rpc-contract:index:RpcWireKind']!,
  'rpc-contract:protocol:RpcWireLimit': canonicalRpcGuides['rpc-contract:index:RpcWireLimit']!,
  'rpc-contract:protocol:RpcWirePointer': canonicalRpcGuides['rpc-contract:index:RpcWirePointer']!,
  'rpc-contract:protocol:RpcWireProfile': canonicalRpcGuides['rpc-contract:index:RpcWireProfile']!,
  'rpc-contract:protocol:RpcWireStepState':
    canonicalRpcGuides['rpc-contract:index:RpcWireStepState']!,
  'rpc-contract:protocol:RpcWireStreamFinish':
    canonicalRpcGuides['rpc-contract:index:RpcWireStreamFinish']!,
  'rpc-contract:protocol:RpcWireVersion': canonicalRpcGuides['rpc-contract:index:RpcWireVersion']!,
  'rpc-contract:protocol:RuntimeApiMode': canonicalRpcGuides['rpc-contract:index:RuntimeApiMode']!,
  'rpc-contract:protocol:RuntimeApiModeSource':
    canonicalRpcGuides['rpc-contract:index:RuntimeApiModeSource']!,
  'rpc-contract:protocol:acceptRpcHandshake':
    canonicalRpcGuides['rpc-contract:index:acceptRpcHandshake']!,
  'rpc-contract:protocol:checkRpcDirectory':
    canonicalRpcGuides['rpc-contract:index:checkRpcDirectory']!,
  'rpc-contract:protocol:checkRpcProviderDeclaration':
    canonicalRpcGuides['rpc-contract:index:checkRpcProviderDeclaration']!,
  'rpc-contract:protocol:checkRpcRuntimeStreamFinish':
    canonicalRpcGuides['rpc-contract:index:checkRpcRuntimeStreamFinish']!,
  'rpc-contract:protocol:checkRpcRuntimeStreamIntent':
    canonicalRpcGuides['rpc-contract:index:checkRpcRuntimeStreamIntent']!,
  'rpc-contract:protocol:checkRpcRuntimeStreamTransition':
    canonicalRpcGuides['rpc-contract:index:checkRpcRuntimeStreamTransition']!,
  'rpc-contract:protocol:checkRpcStreamConsumerCredit':
    canonicalRpcGuides['rpc-contract:index:checkRpcStreamConsumerCredit']!,
  'rpc-contract:protocol:checkRpcStreamInitialSequence':
    canonicalRpcGuides['rpc-contract:index:checkRpcStreamInitialSequence']!,
  'rpc-contract:protocol:checkRpcStreamProducerCredit':
    canonicalRpcGuides['rpc-contract:index:checkRpcStreamProducerCredit']!,
  'rpc-contract:protocol:checkRpcStreamProgress':
    canonicalRpcGuides['rpc-contract:index:checkRpcStreamProgress']!,
  'rpc-contract:protocol:checkRpcStreamSequence':
    canonicalRpcGuides['rpc-contract:index:checkRpcStreamSequence']!,
  'rpc-contract:protocol:completeRpcHandshake':
    canonicalRpcGuides['rpc-contract:index:completeRpcHandshake']!,
  'rpc-contract:protocol:deserializeRpcWireError':
    canonicalRpcGuides['rpc-contract:index:deserializeRpcWireError']!,
  'rpc-contract:protocol:measurePortableStreamValue':
    canonicalRpcGuides['rpc-contract:index:measurePortableStreamValue']!,
  'rpc-contract:protocol:normalizeMethodSchema':
    canonicalRpcGuides['rpc-contract:index:normalizeMethodSchema']!,
  'rpc-contract:protocol:normalizeRpcBinaryManifest':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcBinaryManifest']!,
  'rpc-contract:protocol:normalizeRpcCallOptions':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcCallOptions']!,
  'rpc-contract:protocol:normalizeRpcCarrierFrame':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcCarrierFrame']!,
  'rpc-contract:protocol:normalizeRpcCompletion':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcCompletion']!,
  'rpc-contract:protocol:normalizeRpcDirectory':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcDirectory']!,
  'rpc-contract:protocol:normalizeRpcFrame':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcFrame']!,
  'rpc-contract:protocol:normalizeRpcGeneration':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcGeneration']!,
  'rpc-contract:protocol:normalizeRpcGroupResult':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcGroupResult']!,
  'rpc-contract:protocol:normalizeRpcHandshake':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcHandshake']!,
  'rpc-contract:protocol:normalizeRpcOutcome':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcOutcome']!,
  'rpc-contract:protocol:normalizeRpcOutcomeStore':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcOutcomeStore']!,
  'rpc-contract:protocol:normalizeRpcPortable':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcPortable']!,
  'rpc-contract:protocol:normalizeRpcRoute':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcRoute']!,
  'rpc-contract:protocol:normalizeRpcSteps':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcSteps']!,
  'rpc-contract:protocol:normalizeRpcStream':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcStream']!,
  'rpc-contract:protocol:normalizeRpcTask':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcTask']!,
  'rpc-contract:protocol:normalizeRpcTrace':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcTrace']!,
  'rpc-contract:protocol:normalizeRpcWireError':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcWireError']!,
  'rpc-contract:protocol:rpcWirePointer': canonicalRpcGuides['rpc-contract:index:rpcWirePointer']!,
  'rpc-contract:protocol:serializeRpcWireError':
    canonicalRpcGuides['rpc-contract:index:serializeRpcWireError']!,
  'rpc-contract:interfaces:RpcProbeDirection':
    canonicalRpcGuides['rpc-host:plugins-probe:RpcProbeDirection']!,
  'rpc-contract:interfaces:RpcProbeDirectionName':
    canonicalRpcGuides['rpc-host:plugins-probe:RpcProbeDirectionName']!,
  'rpc-contract:interfaces:RpcProbeKind':
    canonicalRpcGuides['rpc-host:plugins-probe:RpcProbeKind']!,
  'rpc-contract:interfaces:RpcProbeKindName':
    canonicalRpcGuides['rpc-host:plugins-probe:RpcProbeKindName']!,
  'rpc-contract:interfaces:RpcProbeOutcome':
    canonicalRpcGuides['rpc-host:plugins-probe:RpcProbeOutcome']!,
  'rpc-contract:interfaces:RpcProbeOutcomeName':
    canonicalRpcGuides['rpc-host:plugins-probe:RpcProbeOutcomeName']!,
  'rpc-contract:interfaces:RpcProbeStage':
    canonicalRpcGuides['rpc-host:plugins-probe:RpcProbeStage']!,
  'rpc-contract:interfaces:RpcProbeStageName':
    canonicalRpcGuides['rpc-host:plugins-probe:RpcProbeStageName']!,
  'rpc-contract:portable:RPC_PORTABLE_MAX_DEPTH':
    canonicalRpcGuides['rpc-contract:index:RPC_PORTABLE_MAX_DEPTH']!,
  'rpc-contract:portable:normalizePortable':
    canonicalRpcGuides['rpc-contract:index:normalizePortable']!,
  'rpc-contract:portable:normalizeRpcPortable':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcPortable']!,
  'rpc-contract:errors:RPC_CONTRACT_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_CONTRACT_SOURCE']!,
  'rpc-contract:errors:RPC_CORE_ERROR_SOURCE':
    canonicalRpcGuides['rpc-host:index:RPC_CORE_ERROR_SOURCE']!,
  'rpc-contract:errors:RpcAbortError': canonicalRpcGuides['rpc-contract:index:RpcAbortError']!,
  'rpc-contract:errors:RpcAuthenticationError':
    canonicalRpcGuides['rpc-contract:index:RpcAuthenticationError']!,
  'rpc-contract:errors:RpcChunkError': canonicalRpcGuides['rpc-contract:index:RpcChunkError']!,
  'rpc-contract:errors:RpcConfigurationError':
    canonicalRpcGuides['rpc-contract:index:RpcConfigurationError']!,
  'rpc-contract:errors:RpcConstructionError':
    canonicalRpcGuides['rpc-contract:index:RpcConstructionError']!,
  'rpc-contract:errors:RpcContractError':
    canonicalRpcGuides['rpc-contract:index:RpcContractError']!,
  'rpc-contract:errors:RpcContractErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcContractErrorCode']!,
  'rpc-contract:errors:RpcCoreErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcCoreErrorCode']!,
  'rpc-contract:errors:RpcCoreErrorText':
    canonicalRpcGuides['rpc-contract:index:RpcCoreErrorText']!,
  'rpc-contract:errors:RpcError': canonicalRpcGuides['rpc-contract:index:RpcError']!,
  'rpc-contract:errors:RpcErrorFamily': canonicalRpcGuides['rpc-contract:index:RpcErrorFamily']!,
  'rpc-contract:errors:RpcErrorReachLimit':
    canonicalRpcGuides['rpc-contract:index:RpcErrorReachLimit']!,
  'rpc-contract:errors:RpcJsonRpcWireError':
    canonicalRpcGuides['rpc-contract:index:RpcJsonRpcWireError']!,
  'rpc-contract:errors:RpcLifecycleError': canonicalRpcGuides['rpc-host:index:RpcLifecycleError']!,
  'rpc-contract:errors:RpcProtocolError':
    canonicalRpcGuides['rpc-contract:index:RpcProtocolError']!,
  'rpc-contract:errors:RpcProviderRejectionReason':
    canonicalRpcGuides['rpc-contract:index:RpcProviderRejectionReason']!,
  'rpc-contract:errors:RpcRemoteError': canonicalRpcGuides['rpc-contract:index:RpcRemoteError']!,
  'rpc-contract:errors:RpcSchemaValidationError':
    canonicalRpcGuides['rpc-contract:index:RpcSchemaValidationError']!,
  'rpc-contract:errors:RpcSerializationError':
    canonicalRpcGuides['rpc-contract:index:RpcSerializationError']!,
  'rpc-contract:errors:RpcTimeoutError': canonicalRpcGuides['rpc-contract:index:RpcTimeoutError']!,
  'rpc-contract:errors:RpcTransportError':
    canonicalRpcGuides['rpc-contract:index:RpcTransportError']!,
  'rpc-contract:errors:RpcWireErrorFallback':
    canonicalRpcGuides['rpc-contract:index:RpcWireErrorFallback']!,
  'rpc-contract:errors:RpcWireErrorField':
    canonicalRpcGuides['rpc-contract:index:RpcWireErrorField']!,
  'rpc-contract:errors:RpcWireErrorLimit':
    canonicalRpcGuides['rpc-contract:index:RpcWireErrorLimit']!,
  'rpc-contract:errors:RpcWireErrorUnknownFieldMode':
    canonicalRpcGuides['rpc-contract:index:RpcWireErrorUnknownFieldMode']!,
  'rpc-contract:errors:RpcWireErrorViolation':
    canonicalRpcGuides['rpc-contract:index:RpcWireErrorViolation']!,
  'rpc-contract:errors:RuntimeApiErrorText':
    canonicalRpcGuides['rpc-contract:index:RuntimeApiErrorText']!,
  'rpc-contract:errors:createContractError':
    canonicalRpcGuides['rpc-contract:index:createContractError']!,
  'rpc-contract:errors:deserializeRpcError':
    canonicalRpcGuides['rpc-contract:index:deserializeRpcError']!,
  'rpc-contract:errors:identifyContractCallbackFailure':
    canonicalRpcGuides['rpc-contract:index:identifyContractCallbackFailure']!,
  'rpc-contract:errors:identifyRpcBoundaryFailure':
    canonicalRpcGuides['rpc-contract:index:identifyRpcBoundaryFailure']!,
  'rpc-contract:errors:isRpcError': canonicalRpcGuides['rpc-host:index:isRpcError']!,
  'rpc-contract:errors:isRpcErrorInstance':
    canonicalRpcGuides['rpc-host:index:isRpcErrorInstance']!,
  'rpc-contract:errors:isRpcHandshakeExcerptFree':
    canonicalRpcGuides['rpc-contract:index:isRpcHandshakeExcerptFree']!,
  'rpc-contract:errors:isRpcRemoteError': canonicalRpcGuides['rpc-host:index:isRpcRemoteError']!,
  'rpc-contract:errors:isRpcTimeoutError': canonicalRpcGuides['rpc-host:index:isRpcTimeoutError']!,
  'rpc-contract:errors:normalizeRpcSerializedError':
    canonicalRpcGuides['rpc-contract:index:normalizeRpcSerializedError']!,
  'rpc-contract:errors:reachRpcError': canonicalRpcGuides['rpc-contract:index:reachRpcError']!,
  'rpc-contract:errors:redactRpcHandshakeFailure':
    canonicalRpcGuides['rpc-contract:index:redactRpcHandshakeFailure']!,
  'rpc-contract:errors:roleAdmissionMessage':
    canonicalRpcGuides['rpc-contract:index:roleAdmissionMessage']!,
  'rpc-contract:errors:safeRead': canonicalRpcGuides['rpc-contract:index:safeRead']!,
  'rpc-contract:errors:safeString': canonicalRpcGuides['rpc-contract:index:safeString']!,
  'rpc-contract:errors:serializeRpcError':
    canonicalRpcGuides['rpc-contract:index:serializeRpcError']!,
  'rpc-contract:errors:tagRpcError': canonicalRpcGuides['rpc-contract:index:tagRpcError']!,
  'rpc-contract:error-code:ERROR_SOURCE': canonicalRpcGuides['rpc-contract:index:ERROR_SOURCE']!,
  'rpc-contract:error-code:RPC_BROWSER_ERROR_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_BROWSER_ERROR_SOURCE']!,
  'rpc-contract:error-code:RPC_COROUTINE_ERROR_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_COROUTINE_ERROR_SOURCE']!,
  'rpc-contract:error-code:RPC_DEVTOOLS_ERROR_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_DEVTOOLS_ERROR_SOURCE']!,
  'rpc-contract:error-code:RPC_ENDPOINT_ERROR_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_ENDPOINT_ERROR_SOURCE']!,
  'rpc-contract:error-code:RPC_POOL_ERROR_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_POOL_ERROR_SOURCE']!,
  'rpc-contract:error-code:RPC_PROCESS_ERROR_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_PROCESS_ERROR_SOURCE']!,
  'rpc-contract:error-code:RPC_REMOTE_ERROR_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_REMOTE_ERROR_SOURCE']!,
  'rpc-contract:error-code:RPC_THREAD_ERROR_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_THREAD_ERROR_SOURCE']!,
  'rpc-contract:error-code:RpcAuthenticationRejectionReason':
    canonicalRpcGuides['rpc-contract:index:RpcAuthenticationRejectionReason']!,
  'rpc-contract:error-code:RpcBrowserErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcBrowserErrorCode']!,
  'rpc-contract:error-code:RpcContractErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcContractErrorCode']!,
  'rpc-contract:error-code:RpcCoreErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcCoreErrorCode']!,
  'rpc-contract:error-code:RpcCoroutineErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcCoroutineErrorCode']!,
  'rpc-contract:error-code:RpcDevtoolsErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcDevtoolsErrorCode']!,
  'rpc-contract:error-code:RpcPoolErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcPoolErrorCode']!,
  'rpc-contract:error-code:RpcProcessErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcProcessErrorCode']!,
  'rpc-contract:error-code:RpcRemoteLayerErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcRemoteLayerErrorCode']!,
  'rpc-contract:error-code:RpcThreadErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcThreadErrorCode']!,
  'rpc-plugin-process:features-send-queue:sendQueue':
    canonicalRpcGuides['rpc-plugin-process:features:sendQueue']!,
  'rpc-plugin-process:features-log:ipcLog':
    canonicalRpcGuides['rpc-plugin-process:features:ipcLog']!,
  'rpc-plugin-process:features-flow-control:IpcLogEventName':
    canonicalRpcGuides['rpc-plugin-process:features:IpcLogEventName']!,
  'rpc-plugin-process:features-flow-control:IpcSendClass':
    canonicalRpcGuides['rpc-contract:interfaces:IpcSendClass']!,
  'rpc-plugin-process:features-flow-control:flowControl':
    canonicalRpcGuides['rpc-plugin-process:features:flowControl']!,
  'rpc-plugin-process:index:RPC_PROCESS_ERROR_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_PROCESS_ERROR_SOURCE']!,
  'rpc-plugin-process:index:RpcProcessErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcProcessErrorCode']!,
  'rpc-plugin-process:features:IpcSendClass':
    canonicalRpcGuides['rpc-contract:interfaces:IpcSendClass']!,
  'rpc-plugin-thread:index:RPC_THREAD_ERROR_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_THREAD_ERROR_SOURCE']!,
  'rpc-plugin-thread:index:RpcThreadErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcThreadErrorCode']!,
  'rpc-plugin-browser:index:RPC_BROWSER_ERROR_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_BROWSER_ERROR_SOURCE']!,
  'rpc-plugin-browser:index:RpcBrowserErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcBrowserErrorCode']!,
  'rpc-plugin-coroutines:index:RPC_COROUTINE_ERROR_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_COROUTINE_ERROR_SOURCE']!,
  'rpc-plugin-coroutines:index:RpcCoroutineErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcCoroutineErrorCode']!,
  'rpc-plugin-pool:index:RPC_POOL_ERROR_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_POOL_ERROR_SOURCE']!,
  'rpc-plugin-pool:index:RpcPoolErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcPoolErrorCode']!,
  'rpc-plugin-devtools:index:RPC_DEVTOOLS_SOURCE':
    canonicalRpcGuides['rpc-contract:index:RPC_DEVTOOLS_ERROR_SOURCE']!,
  'rpc-plugin-devtools:index:RpcDevtoolsErrorCode':
    canonicalRpcGuides['rpc-contract:index:RpcDevtoolsErrorCode']!
}
