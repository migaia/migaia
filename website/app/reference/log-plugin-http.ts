import type { ILibraryReference } from './contract.js'

/** Current public log-plugin-http behavior, examples and ownership contracts. */
export const logHttpReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Send the canonical entries envelope through one borrowed fetch attempt.',
        zh: '通过借用的请求能力发送规范条目包络，每次交付执行一次请求。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { batchFeature, retryFeature } from '@migaia/log-host/features'\nimport { httpPlugin } from '@migaia/log-plugin-http'\n\nconst log = createLogHost({ plugins: [httpPlugin({\n  url: 'memory-only',\n  features: [batchFeature({ maxSize: 2 }), retryFeature({ attempts: 2 })],\n  fetcher: async (_url, request) => {\n    console.log(request.body)\n    return new Response(null, { status: 200 })\n  }\n})] })\nlog.log('info', 'one')\nlog.log('info', 'two')\nawait log.shutdown('manual')"
    }
  },
  symbols: {
    httpPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Serialize projected entries once and POST them. HTTP consumes no text: host formatting is skipped, output formatting is rejected. Host features own batching, retries and timeouts.',
        zh: '将投影条目一次序列化后发送；本输出不消费文本，跳过宿主格式并拒绝输出级格式。批量、重试与超时由宿主特性负责。'
      },
      params: {
        options: {
          en: 'Required URL with optional headers, authToken, fetcher, Retry-After bound and delivery features; the wire method is fixed to POST.',
          zh: '必填 URL，以及可选请求头、令牌、fetcher、Retry-After 上限与交付特性；线上方法固定为 POST。'
        }
      },
      returns: {
        en: 'An entry-only output plugin; install it in createLogHost.plugins and configure delivery policies through features.',
        zh: '返回仅消费条目的输出插件；安装到 createLogHost.plugins，交付策略通过 features 配置。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { batchFeature, retryFeature } from '@migaia/log-host/features'\nimport { httpPlugin } from '@migaia/log-plugin-http'\n\nconst log = createLogHost({ plugins: [httpPlugin({\n  url: 'memory-only',\n  features: [batchFeature({ maxSize: 2 }), retryFeature({ attempts: 2 })],\n  fetcher: async (_url, request) => {\n    console.log(request.body)\n    return new Response(null, { status: 200 })\n  }\n})] })\nlog.log('info', 'one')\nlog.log('info', 'two')\nawait log.shutdown('manual')",
      optionDocs: {
        url: {
          summary: {
            en: 'Destination passed unchanged to the injected fetcher.',
            zh: '原样传给注入请求能力的目标地址。'
          }
        },
        fetcher: {
          summary: {
            en: 'Return a response with ok/status/headers.get; cooperate with the supplied AbortSignal.',
            zh: '返回包含成功标记、状态和响应头读取器的结果，并配合传入的取消信号。'
          },
          default: {
            en: 'globalThis.fetch; creation fails when absent.',
            zh: '使用全局请求函数；两种能力都缺失时创建失败。'
          }
        },
        headers: {
          summary: {
            en: 'Copied request headers; caller values override JSON content type.',
            zh: '创建时复制的请求头；调用方值覆盖缺省内容类型。'
          },
          default: {
            en: 'Content-Type application/json.',
            zh: '内容类型为 JSON。'
          }
        },
        authToken: {
          summary: {
            en: 'A nonempty value overrides Authorization using the bearer convention.',
            zh: '非空令牌按持票约定覆盖授权请求头。'
          },
          default: {
            en: 'No bearer override.',
            zh: '不覆盖授权头。'
          }
        },
        maxRetryAfterMs: {
          summary: {
            en: 'Finite nonnegative limit for strictly parsed server Retry-After advice.',
            zh: '严格解析服务器重试建议后的有限非负毫秒上限。'
          },
          default: {
            en: '30000 milliseconds.',
            zh: '三万毫秒。'
          }
        },
        features: {
          summary: {
            en: 'Use batchFeature, retryFeature and timeoutFeature; format descriptors are rejected.',
            zh: '选择批量、重试及超时特性；格式描述符在创建时被拒绝。'
          },
          default: {
            en: 'No implicit transport policy.',
            zh: '没有隐式传输策略。'
          }
        }
      }
    },
    LogHttpErrorCode: {
      role: 'error',
      purpose: {
        en: 'Semantic codes owned by this package. Read together with source logging.http.',
        zh: '本包拥有的语义错误码，与来源 `logging.http` 一起解释。'
      }
    },
    LOG_HTTP_ERROR_SOURCE: {
      role: 'error',
      purpose: {
        en: 'The stable logging.http domain identifies errors constructed by this package.',
        zh: '稳定的 `logging.http` 来源用于识别由本包创建的错误。'
      }
    }
  },
  types: {
    IHttpPluginConfig: {
      summary: {
        en: 'Serialize projected entries once and POST them. HTTP consumes no text: host formatting is skipped, output formatting is rejected. Host features own batching, retries and timeouts.',
        zh: '将投影条目一次序列化后发送；本输出不消费文本，跳过宿主格式并拒绝输出级格式。批量、重试与超时由宿主特性负责。'
      },
      members: {
        url: {
          summary: {
            en: 'Destination passed unchanged to the injected fetcher.',
            zh: '原样传给注入请求能力的目标地址。'
          }
        },
        fetcher: {
          summary: {
            en: 'Return a response with ok/status/headers.get; cooperate with the supplied AbortSignal.',
            zh: '返回包含成功标记、状态和响应头读取器的结果，并配合传入的取消信号。'
          },
          default: {
            en: 'globalThis.fetch; creation fails when absent.',
            zh: '使用全局请求函数；两种能力都缺失时创建失败。'
          }
        },
        headers: {
          summary: {
            en: 'Copied request headers; caller values override JSON content type.',
            zh: '创建时复制的请求头；调用方值覆盖缺省内容类型。'
          },
          default: {
            en: 'Content-Type application/json.',
            zh: '内容类型为 JSON。'
          }
        },
        authToken: {
          summary: {
            en: 'A nonempty value overrides Authorization using the bearer convention.',
            zh: '非空令牌按持票约定覆盖授权请求头。'
          },
          default: {
            en: 'No bearer override.',
            zh: '不覆盖授权头。'
          }
        },
        maxRetryAfterMs: {
          summary: {
            en: 'Finite nonnegative limit for strictly parsed server Retry-After advice.',
            zh: '严格解析服务器重试建议后的有限非负毫秒上限。'
          },
          default: {
            en: '30000 milliseconds.',
            zh: '三万毫秒。'
          }
        },
        features: {
          summary: {
            en: 'Use batchFeature, retryFeature and timeoutFeature; format descriptors are rejected.',
            zh: '选择批量、重试及超时特性；格式描述符在创建时被拒绝。'
          },
          default: {
            en: 'No implicit transport policy.',
            zh: '没有隐式传输策略。'
          }
        }
      }
    }
  },
  enums: {},
  enhancers: {
    httpPlugin: {
      kind: 'plugin',
      target: 'ILogHost',
      summary: {
        en: 'Serialize projected entries once and POST them. HTTP consumes no text: host formatting is skipped, output formatting is rejected. Host features own batching, retries and timeouts.',
        zh: '将投影条目一次序列化后发送；本输出不消费文本，跳过宿主格式并拒绝输出级格式。批量、重试与超时由宿主特性负责。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { batchFeature, retryFeature } from '@migaia/log-host/features'\nimport { httpPlugin } from '@migaia/log-plugin-http'\n\nconst log = createLogHost({ plugins: [httpPlugin({\n  url: 'memory-only',\n  features: [batchFeature({ maxSize: 2 }), retryFeature({ attempts: 2 })],\n  fetcher: async (_url, request) => {\n    console.log(request.body)\n    return new Response(null, { status: 200 })\n  }\n})] })\nlog.log('info', 'one')\nlog.log('info', 'two')\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Serialize projected entries once and POST them. HTTP consumes no text: host formatting is skipped, output formatting is rejected. Host features own batching, retries and timeouts.',
          zh: '将投影条目一次序列化后发送；本输出不消费文本，跳过宿主格式并拒绝输出级格式。批量、重试与超时由宿主特性负责。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { batchFeature, retryFeature } from '@migaia/log-host/features'\nimport { httpPlugin } from '@migaia/log-plugin-http'\n\nconst log = createLogHost({ plugins: [httpPlugin({\n  url: 'memory-only',\n  features: [batchFeature({ maxSize: 2 }), retryFeature({ attempts: 2 })],\n  fetcher: async (_url, request) => {\n    console.log(request.body)\n    return new Response(null, { status: 200 })\n  }\n})] })\nlog.log('info', 'one')\nlog.log('info', 'two')\nawait log.shutdown('manual')"
    }
  }
}
