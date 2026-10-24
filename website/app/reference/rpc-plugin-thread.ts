/**
 * Bilingual public reference for @migaia/rpc-plugin-thread; native and call ownership follow the
 * actual package API.
 */
import { rpcPluginOptionDocs } from './rpc-runtime-shared.js'
import type { ILibraryReference } from './contract.js'

/** Authored public modules, symbols, configuration and ownership contracts. */
export const rpcThreadsReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'One cold native transport using original bootstrap, supervision, drain and native exit owners. Both sides provide methods over the same actual host endpoint. Node, Bun and Deno only; browser Workers belong to rpc-plugin-browser.',
        zh: '一个使用原启动、监督、排空和原生退出所有者的冷传输，双方在同一实际宿主端点提供方法。仅承载服务端原生线程，浏览器工作程序归浏览器插件。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
    }
  },
  symbols: {
    isThreadChild: {
      role: 'operation',
      purpose: {
        en: 'Tells whether the current module runs inside a Worker started by this library, so one file can branch between parent and Worker for `spawn: true`.',
        zh: '判断当前模块是否运行在由本库启动的 Worker 中，使同一个文件可以在 `spawn: true` 时区分父线程与 Worker 两个分支。'
      },
      returns: {
        en: 'Resolves `true` in a library-launched Worker; it does not authorise foreign Workers.',
        zh: '在由本库启动的 Worker 中 resolve 为 `true`；它不会为外部 Worker 授权。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      avoid: [
        {
          en: 'Self spawn is unsupported in browsers, Electron, REPL/eval sessions, bundled executables and entries controlled by a test runner; use an explicit built Worker URL.',
          zh: '浏览器、Electron、交互或求值入口、打包二进制及由测试运行器持有的入口不支持同文件自启动；应使用明确的已构建工作线程 URL。'
        }
      ]
    },
    RPC_THREAD_ERROR_SOURCE: {
      role: 'constant',
      purpose: {
        en: 'The `source` value (`@migaia/rpc/threads`) of errors owned by this package; call errors come from `@migaia/rpc/core`.',
        zh: '本包自有错误的 `source` 值（`@migaia/rpc/threads`）；超时、取消等调用层错误则来自 `@migaia/rpc/core`。'
      },
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
      }
    },
    RpcThreadErrorCode: {
      role: 'constant',
      purpose: {
        en: 'Error codes owned by this package; currently only `THREAD_USAGE_SAMPLE_FAILED`.',
        zh: '本包自有的错误码对照表；目前只有资源采样失败 `THREAD_USAGE_SAMPLE_FAILED` 一项。'
      },
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
      }
    },

    threadPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'One cold native transport using original bootstrap, supervision, drain and native exit owners. Both sides provide methods over the same actual host endpoint.',
        zh: '一个使用原启动、监督、排空和原生退出所有者的冷传输，双方在同一实际宿主端点提供方法。'
      },
      options: 'IThreadPluginOptions',
      returns: {
        en: 'Exact registered transport definition for createRpcHost.plugins or ordinary PluginHost.use; acquisition begins only on installation.',
        zh: '返回供统一宿主或普通插件宿主安装的精确登记传输定义，仅安装时开始获取资源。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
    }
  },
  types: {
    IRpcThreadErrorCode: {
      summary: {
        en: 'Union of `RpcThreadErrorCode` values.',
        zh: '`RpcThreadErrorCode` 全部取值组成的联合类型。'
      },
      members: {}
    },
    IThreadCommonOptions: {
      summary: {
        en: 'Cold native options borrowing original policy and reporter owners.',
        zh: '借用原策略与报告所有者的冷原生选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      members: {
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
            en: 'Use the report session’s signing and verification policy when both channel ends require authenticated traffic. openSignedReportChannel supplies the matching remote configuration. Omission adds no authentication middleware.',
            zh: '报表会话两端要求认证消息时，使用该会话已有的签名及校验策略。openSignedReportChannel 提供匹配的对端配置。省略时不增加认证中间件。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
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
            en: 'Receives background errors that no call can reject with.',
            zh: '接收无法通过调用 reject 的后台错误。'
          },
          default: {
            en: '`defaultRpcReporter`.',
            zh: '`defaultRpcReporter`，使用默认控制台报告路径。'
          },
          whenToUse: {
            en: 'Set a sink when the application needs to collect background or contained failures separately from request rejections. Omitting it uses defaultRpcReporter and console.error; it does not make a failed request successful.',
            zh: '应用需要把后台或隔离失败与请求拒绝分开记录时设置。省略时使用 defaultRpcReporter 和 console.error；它不会让失败请求成功。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
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
            en: 'Use it on managed proxy paths that generate keys for retryable calls. A borrowed direct connect/listen peer does not read it. Omission uses defaultRpcId in proxy paths and leaves direct call-option keys unchanged.',
            zh: '需要为可重试调用生成键的托管代理路径使用此项。借用的直接 connect/listen Peer 不读取它。省略时代理路径使用 defaultRpcId，直接调用选项中的键保持原语义。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        retryPort: {
          summary: {
            en: 'Advanced application-supplied retry dispatch port for remote-proxy paths; it receives the original retry input and returns the selected dispatch result. Direct createRpcHost assembly does not read it itself.',
            zh: '高级应用重试派发端口，供远程代理路径接收原始重试输入并返回所选派发结果；直接运行时连接组装本身不读取它。'
          },
          default: {
            en: 'Omitted: the remote proxy keeps its original retry dispatch owner; no second retry policy is installed by a direct peer.',
            zh: '省略时远程代理保留原重试派发拥有者，直接连接不会额外安装另一套重试策略。'
          }
        },
        name: {
          summary: {
            en: 'Application-selected local registration name, independent of remote self.name.',
            zh: '应用选择的本地登记名，与远端自身名称分开。'
          },
          default: {
            en: 'Omitted: original family registration name.',
            zh: '省略时使用原家族登记名。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        connect: {
          summary: {
            en: 'SDK handshake preparation options, not a second physical source.',
            zh: '作者工具的握手准备选项，不是第二个物理来源。'
          },
          default: {
            en: 'Omitted: original handshake policy.',
            zh: '省略时使用原握手策略。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: original source defaults.',
            zh: '省略时使用原来源默认。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        }
      }
    },
    IThreadPluginOptions: {
      summary: {
        en: 'Exactly one source plus shared options; invalid or conflicting sources reject before native acquisition.',
        zh: '一个来源加上共用选项，非法或冲突来源在获取原生资源前拒绝。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      members: {
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
            en: 'Use the report session’s signing and verification policy when both channel ends require authenticated traffic. openSignedReportChannel supplies the matching remote configuration. Omission adds no authentication middleware.',
            zh: '报表会话两端要求认证消息时，使用该会话已有的签名及校验策略。openSignedReportChannel 提供匹配的对端配置。省略时不增加认证中间件。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
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
            en: 'Receives background errors that no call can reject with.',
            zh: '接收无法通过调用 reject 的后台错误。'
          },
          default: {
            en: '`defaultRpcReporter`.',
            zh: '`defaultRpcReporter`，使用默认控制台报告路径。'
          },
          whenToUse: {
            en: 'Set a sink when the application needs to collect background or contained failures separately from request rejections. Omitting it uses defaultRpcReporter and console.error; it does not make a failed request successful.',
            zh: '应用需要把后台或隔离失败与请求拒绝分开记录时设置。省略时使用 defaultRpcReporter 和 console.error；它不会让失败请求成功。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
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
            en: 'Use it on managed proxy paths that generate keys for retryable calls. A borrowed direct connect/listen peer does not read it. Omission uses defaultRpcId in proxy paths and leaves direct call-option keys unchanged.',
            zh: '需要为可重试调用生成键的托管代理路径使用此项。借用的直接 connect/listen Peer 不读取它。省略时代理路径使用 defaultRpcId，直接调用选项中的键保持原语义。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        retryPort: {
          summary: {
            en: 'Advanced application-supplied retry dispatch port for remote-proxy paths; it receives the original retry input and returns the selected dispatch result. Direct createRpcHost assembly does not read it itself.',
            zh: '高级应用重试派发端口，供远程代理路径接收原始重试输入并返回所选派发结果；直接运行时连接组装本身不读取它。'
          },
          default: {
            en: 'Omitted: the remote proxy keeps its original retry dispatch owner; no second retry policy is installed by a direct peer.',
            zh: '省略时远程代理保留原重试派发拥有者，直接连接不会额外安装另一套重试策略。'
          }
        },
        name: {
          summary: {
            en: 'Application-selected local registration name, independent of remote self.name.',
            zh: '应用选择的本地登记名，与远端自身名称分开。'
          },
          default: {
            en: 'Omitted: original family registration name.',
            zh: '省略时使用原家族登记名。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        connect: {
          summary: {
            en: 'SDK handshake preparation options, not a second physical source.',
            zh: '作者工具的握手准备选项，不是第二个物理来源。'
          },
          default: {
            en: 'Omitted: original handshake policy.',
            zh: '省略时使用原握手策略。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: original source defaults.',
            zh: '省略时使用原来源默认。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        spawn: {
          summary: {
            en: 'Current entry, explicit entry, short options, or original full native source. No complete callable object is a raw source.',
            zh: '当前入口、显式入口、简写选项或原完整原生来源，完整调用对象不能充当原始来源。'
          },
          default: {
            en: 'Absent in parent/connect/listen modes.',
            zh: '子端、连接或监听模式不提供。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
        },
        connectToParent: {
          summary: {
            en: 'true only in the genuine native child, using actual first-frame authority.',
            zh: '仅在真实原生子端取真值，使用实际首帧权限。'
          },
          default: {
            en: 'Absent outside parent connection mode.',
            zh: '非连接父端模式不提供。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
          values: {
            true: {
              en: 'Adopt the actual parent bootstrap source.',
              zh: '采用实际父端启动来源。'
            }
          }
        }
      }
    },
    IThreadSpawnSource: {
      summary: {
        en: 'Actual explicit plugin source union; short forms normalize through the original native owner.',
        zh: '插件的实际显式来源联合，简写通过原原生所有者归一化。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      members: {}
    }
  },
  enums: {
    RpcThreadErrorCode: {
      summary: {
        en: 'Error codes owned by `@migaia/rpc-plugin-thread`.',
        zh: '`@migaia/rpc-plugin-thread` 自有的错误码及其含义。'
      },
      values: {
        usageSampleFailed: {
          en: '`THREAD_USAGE_SAMPLE_FAILED`: sampling Worker CPU or memory failed; show the value as unavailable, the Worker keeps running.',
          zh: '`THREAD_USAGE_SAMPLE_FAILED`：采样 Worker 的 CPU 或内存失败；把该值显示为不可用即可，Worker 继续运行。'
        }
      }
    }
  },
  enhancers: {
    threadPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'One cold native transport using original bootstrap, supervision, drain and native exit owners. Both sides provide methods over the same actual host endpoint.',
        zh: '一个使用原启动、监督、排空和原生退出所有者的冷传输，双方在同一实际宿主端点提供方法。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [
        {
          en: 'Original source ownership retains native control, generation, replacement and cleanup.',
          zh: '原来源所有权保留原生控制、代次、替换和清理。'
        }
      ],
      scenarios: [
        {
          en: 'Use the actual native runtime selected by the application.',
          zh: '使用应用选定的实际原生运行时。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'\n\nif (await isThreadChild()) {\n  await createRpcHost({\n    plugins: [threadPlugin({ connectToParent: true })],\n    provide: { double: (value: number) => value * 2 }\n  })\n} else {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [threadPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    console.log(await host.request('double', 21))\n  } finally {\n    await host.close()\n  }\n}"
    }
  }
}
