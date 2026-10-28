import type { ILibraryReference } from './contract.js'

/** Current public log-plugin-console behavior, examples and ownership contracts. */
export const logConsoleReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Borrow a native console and stdout; pretty formatting preserves argument identity.',
        zh: '借用原生控制台与标准输出；美化格式保留原参数身份。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({\n  plugins: [consolePlugin({ console: globalThis.console })],\n  features: [prettyFeature({ color: 'never', timestamp: false })]\n})\nlog.log('info', 'user=%s', 'alice')\nlog.raw('progress\\r')\nawait log.shutdown('manual')"
    }
  },
  symbols: {
    consolePlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Route asynchronous entries by tag, skip silent entries, and add synchronous raw output without owning borrowed capabilities.',
        zh: '按标签路由异步条目、跳过静默条目，并提供同步原样输出，不接管借用能力。'
      },
      params: {
        options: {
          en: 'Optional borrowed console/stdout capabilities and output-scoped features.',
          zh: '可选借用控制台、标准输出能力及输出级特性。'
        }
      },
      returns: {
        en: 'An installable console output plugin granting synchronous raw(text).',
        zh: '返回授予同步 raw(text) 的可安装控制台输出插件。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({\n  plugins: [consolePlugin({ console: globalThis.console })],\n  features: [prettyFeature({ color: 'never', timestamp: false })]\n})\nlog.log('info', 'user=%s', 'alice')\nlog.raw('progress\\r')\nawait log.shutdown('manual')",
      optionDocs: {
        console: {
          summary: {
            en: 'Borrow log/warn/error methods and preserve their receiver.',
            zh: '借用控制台的三个输出方法并保留原接收者。'
          },
          default: {
            en: 'globalThis.console.',
            zh: '使用全局控制台。'
          }
        },
        stdout: {
          summary: {
            en: 'Borrow write(text) and optional isTTY; removing the plugin never closes it.',
            zh: '借用文本写入及可选终端标记；移除插件不会关闭该能力。'
          },
          default: {
            en: 'Recognized process.stdout, or console.log fallback.',
            zh: '使用识别出的进程标准输出，否则回退控制台。'
          }
        },
        features: {
          summary: {
            en: 'Output-scoped host policies override host defaults of the same kind.',
            zh: '输出级宿主策略覆盖同类宿主默认值。'
          },
          default: {
            en: 'No output overrides.',
            zh: '不覆盖宿主策略。'
          }
        }
      }
    },
    LogConsoleErrorCode: {
      role: 'error',
      purpose: {
        en: 'Semantic codes owned by this package. This empty table declares no package-owned errors.',
        zh: '本包没有自定义语义错误码；借用能力的原错误由宿主失败通道接收。'
      }
    },
    prettyFeature: {
      role: 'enhancer',
      purpose: {
        en: "Issue a format descriptor recognized by the console by opaque identity. Preserve native args/Error and the host's separate shallow metadata copy.",
        zh: '签发由控制台按不透明身份识别的格式描述符；保留原参数、错误及宿主独立的元数据浅副本。'
      },
      params: {
        options: {
          en: 'Optional color mode (auto) and timestamp flag (true).',
          zh: '可选 color 模式（默认 auto）及 timestamp 标记（默认 true）。'
        }
      },
      returns: {
        en: 'A host-recognized format descriptor whose native argument handling is recognized by the console output.',
        zh: '返回宿主识别的格式描述符，其原生参数处理由控制台输出按身份识别。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({\n  plugins: [consolePlugin({ console: globalThis.console })],\n  features: [prettyFeature({ color: 'never', timestamp: false })]\n})\nlog.log('info', 'user=%s', 'alice')\nlog.raw('progress\\r')\nawait log.shutdown('manual')",
      optionDocs: {
        color: {
          summary: {
            en: 'Explicit always/never wins; auto checks NO_COLOR, FORCE_COLOR, TTY, then CI.',
            zh: '显式总是或从不优先；自动模式依次检查环境强制项、终端和持续集成标记。'
          },
          default: {
            en: 'auto.',
            zh: '自动。'
          }
        },
        timestamp: {
          summary: {
            en: "Include the entry's original ISO timestamp in the pretty prefix.",
            zh: '在美化前缀中显示条目的原始时间。'
          },
          default: {
            en: 'true.',
            zh: '显示。'
          }
        }
      }
    },
    ConsoleColorMode: {
      role: 'constant',
      purpose: {
        en: 'Select automatic, forced or disabled ANSI coloring for prettyFeature.',
        zh: '为美化特性选择自动、强制或禁用颜色。'
      }
    }
  },
  types: {},
  enums: {
    ConsoleColorMode: {
      summary: {
        en: 'Select automatic, forced or disabled ANSI coloring for prettyFeature.',
        zh: '为美化特性选择自动、强制或禁用颜色。'
      },
      values: {
        auto: {
          en: 'Resolve environment and terminal policy.',
          zh: '按环境与终端策略决定。'
        },
        always: {
          en: 'Force the declared ANSI palette.',
          zh: '强制输出既定颜色。'
        },
        never: {
          en: 'Write the same prefix without ANSI.',
          zh: '输出相同前缀，不带颜色。'
        }
      }
    }
  },
  enhancers: {
    consolePlugin: {
      kind: 'plugin',
      target: 'ILogHost',
      summary: {
        en: 'Route asynchronous entries by tag, skip silent entries, and add synchronous raw output without owning borrowed capabilities.',
        zh: '按标签路由异步条目、跳过静默条目，并提供同步原样输出，不接管借用能力。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({\n  plugins: [consolePlugin({ console: globalThis.console })],\n  features: [prettyFeature({ color: 'never', timestamp: false })]\n})\nlog.log('info', 'user=%s', 'alice')\nlog.raw('progress\\r')\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Route asynchronous entries by tag, skip silent entries, and add synchronous raw output without owning borrowed capabilities.',
          zh: '按标签路由异步条目、跳过静默条目，并提供同步原样输出，不接管借用能力。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({\n  plugins: [consolePlugin({ console: globalThis.console })],\n  features: [prettyFeature({ color: 'never', timestamp: false })]\n})\nlog.log('info', 'user=%s', 'alice')\nlog.raw('progress\\r')\nawait log.shutdown('manual')"
    },
    prettyFeature: {
      kind: 'feature',
      target: 'ILogHost',
      summary: {
        en: "Issue a format descriptor recognized by the console by opaque identity. Preserve native args/Error and the host's separate shallow metadata copy.",
        zh: '签发由控制台按不透明身份识别的格式描述符；保留原参数、错误及宿主独立的元数据浅副本。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({\n  plugins: [consolePlugin({ console: globalThis.console })],\n  features: [prettyFeature({ color: 'never', timestamp: false })]\n})\nlog.log('info', 'user=%s', 'alice')\nlog.raw('progress\\r')\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: "Issue a format descriptor recognized by the console by opaque identity. Preserve native args/Error and the host's separate shallow metadata copy.",
          zh: '签发由控制台按不透明身份识别的格式描述符；保留原参数、错误及宿主独立的元数据浅副本。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({\n  plugins: [consolePlugin({ console: globalThis.console })],\n  features: [prettyFeature({ color: 'never', timestamp: false })]\n})\nlog.log('info', 'user=%s', 'alice')\nlog.raw('progress\\r')\nawait log.shutdown('manual')"
    }
  }
}
