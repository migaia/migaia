import type { ILibraryReference } from './contract.js'

/** Current public log-plugin-file behavior, examples and ownership contracts. */
export const logFileReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Append formatted records as one newline-terminated batch through a borrowed writer.',
        zh: '通过借用写入器，将已格式化条目作为末尾带换行的一批追加。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { filePlugin } from '@migaia/log-plugin-file'\n\nconst log = createLogHost({ plugins: [filePlugin({\n  path: 'app.jsonl',\n  writer: { append: async (path, text) => { console.log(path, text) } }\n})] })\nlog.log('info', 'saved')\nawait log.shutdown('manual')"
    }
  },
  symbols: {
    filePlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Append one batch with one writer call and rotate after configured thresholds. Native Node/Bun append uses node:fs; Deno uses writeTextFile with append:true. Browser entry requires a writer.',
        zh: '每批追加一次，并在达到配置阈值后轮转；不同宿主使用原生追加能力，浏览器入口要求注入写入器。'
      },
      params: {
        options: {
          en: 'Required file path with optional writer, rotation limits and delivery features.',
          zh: '必填文件路径，以及可选写入器、轮转限制与交付特性。'
        }
      },
      returns: {
        en: 'A text output plugin whose accepted writes drain through the host; an injected writer remains caller-owned.',
        zh: '返回通过宿主排空已接纳写入的文本输出插件；注入写入器始终由调用方拥有。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { filePlugin } from '@migaia/log-plugin-file'\n\nconst log = createLogHost({ plugins: [filePlugin({\n  path: 'app.jsonl',\n  writer: { append: async (path, text) => { console.log(path, text) } }\n})] })\nlog.log('info', 'saved')\nawait log.shutdown('manual')",
      optionDocs: {
        path: {
          summary: {
            en: 'Nonempty file path passed unchanged to append and rotate.',
            zh: '传给追加与轮转能力的非空文件路径。'
          }
        },
        writer: {
          summary: {
            en: 'Borrow append(path,text) and optional rotate(path); the plugin never closes it.',
            zh: '借用追加与可选轮转方法，插件不会关闭写入器。'
          },
          default: {
            en: 'Runtime-native append; unavailable in browser.',
            zh: '使用宿主原生追加；浏览器无默认能力。'
          }
        },
        rotate: {
          summary: {
            en: 'Positive entry/byte thresholds; writer.rotate must exist at creation.',
            zh: '正整数条目数或字节阈值；创建时必须提供轮转方法。'
          },
          default: {
            en: 'No rotation.',
            zh: '不执行轮转。'
          }
        },
        features: {
          summary: {
            en: 'Select host batching and formatting for this output.',
            zh: '为本输出选择宿主批量与格式策略。'
          },
          default: {
            en: 'JSON formatting without implicit batching.',
            zh: '缺省 JSON 格式，不隐式批量。'
          }
        }
      }
    },
    LogFileErrorCode: {
      role: 'error',
      purpose: {
        en: 'Semantic codes owned by this package. Read together with source logging.file.',
        zh: '本包拥有的语义错误码，与来源 `logging.file` 一起解释。'
      }
    },
    LOG_FILE_ERROR_SOURCE: {
      role: 'error',
      purpose: {
        en: 'The stable logging.file domain identifies errors constructed by this package.',
        zh: '稳定的 `logging.file` 来源用于识别由本包创建的错误。'
      }
    }
  },
  types: {
    IFilePluginConfig: {
      summary: {
        en: 'Append one batch with one writer call and rotate after configured thresholds. Native Node/Bun append uses node:fs; Deno uses writeTextFile with append:true. Browser entry requires a writer.',
        zh: '每批追加一次，并在达到配置阈值后轮转；不同宿主使用原生追加能力，浏览器入口要求注入写入器。'
      },
      members: {
        path: {
          summary: {
            en: 'Nonempty file path passed unchanged to append and rotate.',
            zh: '传给追加与轮转能力的非空文件路径。'
          }
        },
        writer: {
          summary: {
            en: 'Borrow append(path,text) and optional rotate(path); the plugin never closes it.',
            zh: '借用追加与可选轮转方法，插件不会关闭写入器。'
          },
          default: {
            en: 'Runtime-native append; unavailable in browser.',
            zh: '使用宿主原生追加；浏览器无默认能力。'
          }
        },
        rotate: {
          summary: {
            en: 'Positive entry/byte thresholds; writer.rotate must exist at creation.',
            zh: '正整数条目数或字节阈值；创建时必须提供轮转方法。'
          },
          default: {
            en: 'No rotation.',
            zh: '不执行轮转。'
          }
        },
        features: {
          summary: {
            en: 'Select host batching and formatting for this output.',
            zh: '为本输出选择宿主批量与格式策略。'
          },
          default: {
            en: 'JSON formatting without implicit batching.',
            zh: '缺省 JSON 格式，不隐式批量。'
          }
        }
      }
    }
  },
  enums: {},
  enhancers: {
    filePlugin: {
      kind: 'plugin',
      target: 'ILogHost',
      summary: {
        en: 'Append one batch with one writer call and rotate after configured thresholds. Native Node/Bun append uses node:fs; Deno uses writeTextFile with append:true. Browser entry requires a writer.',
        zh: '每批追加一次，并在达到配置阈值后轮转；不同宿主使用原生追加能力，浏览器入口要求注入写入器。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { filePlugin } from '@migaia/log-plugin-file'\n\nconst log = createLogHost({ plugins: [filePlugin({\n  path: 'app.jsonl',\n  writer: { append: async (path, text) => { console.log(path, text) } }\n})] })\nlog.log('info', 'saved')\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Append one batch with one writer call and rotate after configured thresholds. Native Node/Bun append uses node:fs; Deno uses writeTextFile with append:true. Browser entry requires a writer.',
          zh: '每批追加一次，并在达到配置阈值后轮转；不同宿主使用原生追加能力，浏览器入口要求注入写入器。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { filePlugin } from '@migaia/log-plugin-file'\n\nconst log = createLogHost({ plugins: [filePlugin({\n  path: 'app.jsonl',\n  writer: { append: async (path, text) => { console.log(path, text) } }\n})] })\nlog.log('info', 'saved')\nawait log.shutdown('manual')"
    }
  }
}
