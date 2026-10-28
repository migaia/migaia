import type { ILibraryReference } from './contract.js'

/** Current public log-plugin-process behavior, examples and ownership contracts. */
export const logProcessReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Share signal listeners by borrowed process identity and drain hosts before exit.',
        zh: '按借用进程身份共享信号监听，并在退出前排空宿主。'
      },
      example:
        "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\nimport { processPlugin } from '@migaia/log-plugin-process'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin(), processPlugin()] })\nlog.onShutdown(() => { log.info('shutdown started') })\nlog.info('ready')\nawait log.shutdown('manual')"
    }
  },
  symbols: {
    processPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Group compatible hosts by process object. Signals and crashes share shutdown work; beforeExit only flushes. Final removal restores listeners and any intercepted exit function.',
        zh: '按进程对象对兼容宿主分组；信号与崩溃共享关闭过程，退出前事件只排空。最后移除时撤销监听并恢复拦截的退出函数。'
      },
      params: {
        options: {
          en: 'Optional borrowed process, crash capture, shutdown timeout and exit interception policy.',
          zh: '可选借用进程、崩溃捕获、关闭超时及退出拦截策略。'
        }
      },
      returns: {
        en: 'An installable process-lifecycle plugin; compatible hosts share one listener group without owning the borrowed process.',
        zh: '返回进程生命周期插件；兼容宿主共用一个监听组且不接管借用进程。'
      },
      example:
        "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\nimport { processPlugin } from '@migaia/log-plugin-process'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin(), processPlugin()] })\nlog.onShutdown(() => { log.info('shutdown started') })\nlog.info('ready')\nawait log.shutdown('manual')",
      optionDocs: {
        process: {
          summary: {
            en: 'Borrow env/on/removeListener/exit with original receiver identity.',
            zh: '借用环境、注册、移除及退出方法，保留原接收者身份。'
          },
          default: {
            en: 'Recognized server process; absent capability is inert.',
            zh: '使用识别的服务端进程，缺失时不安装监听。'
          }
        },
        captureCrashes: {
          summary: {
            en: 'Record crash events before their existing shutdown path.',
            zh: '在既有崩溃关闭路径前记录错误。'
          },
          default: {
            en: 'true.',
            zh: '启用。'
          }
        },
        shutdownTimeoutMs: {
          summary: {
            en: 'Bound graceful flush/shutdown waits in milliseconds.',
            zh: '限制优雅排空和关闭等待的毫秒预算。'
          },
          default: {
            en: '3000 milliseconds.',
            zh: '三千毫秒。'
          }
        },
        interceptProcessExit: {
          summary: {
            en: 'Capture the original exit function, wait for bounded flush, then restore exact identity on removal.',
            zh: '捕获原退出函数并等待受限排空，移除时恢复精确身份。'
          },
          default: {
            en: 'false.',
            zh: '不拦截。'
          }
        }
      }
    },
    LogProcessErrorCode: {
      role: 'error',
      purpose: {
        en: 'Semantic codes owned by this package. Read together with source logging.process.',
        zh: '本包拥有的语义错误码，与来源 `logging.process` 一起解释。'
      }
    },
    LOG_PROCESS_ERROR_SOURCE: {
      role: 'error',
      purpose: {
        en: 'The stable logging.process domain identifies errors constructed by this package.',
        zh: '稳定的 `logging.process` 来源用于识别由本包创建的错误。'
      }
    }
  },
  types: {
    IProcessPluginConfig: {
      summary: {
        en: 'Group compatible hosts by process object. Signals and crashes share shutdown work; beforeExit only flushes. Final removal restores listeners and any intercepted exit function.',
        zh: '按进程对象对兼容宿主分组；信号与崩溃共享关闭过程，退出前事件只排空。最后移除时撤销监听并恢复拦截的退出函数。'
      },
      members: {
        process: {
          summary: {
            en: 'Borrow env/on/removeListener/exit with original receiver identity.',
            zh: '借用环境、注册、移除及退出方法，保留原接收者身份。'
          },
          default: {
            en: 'Recognized server process; absent capability is inert.',
            zh: '使用识别的服务端进程，缺失时不安装监听。'
          }
        },
        captureCrashes: {
          summary: {
            en: 'Record crash events before their existing shutdown path.',
            zh: '在既有崩溃关闭路径前记录错误。'
          },
          default: {
            en: 'true.',
            zh: '启用。'
          }
        },
        shutdownTimeoutMs: {
          summary: {
            en: 'Bound graceful flush/shutdown waits in milliseconds.',
            zh: '限制优雅排空和关闭等待的毫秒预算。'
          },
          default: {
            en: '3000 milliseconds.',
            zh: '三千毫秒。'
          }
        },
        interceptProcessExit: {
          summary: {
            en: 'Capture the original exit function, wait for bounded flush, then restore exact identity on removal.',
            zh: '捕获原退出函数并等待受限排空，移除时恢复精确身份。'
          },
          default: {
            en: 'false.',
            zh: '不拦截。'
          }
        }
      }
    }
  },
  enums: {},
  enhancers: {
    processPlugin: {
      kind: 'plugin',
      target: 'ILogHost',
      summary: {
        en: 'Group compatible hosts by process object. Signals and crashes share shutdown work; beforeExit only flushes. Final removal restores listeners and any intercepted exit function.',
        zh: '按进程对象对兼容宿主分组；信号与崩溃共享关闭过程，退出前事件只排空。最后移除时撤销监听并恢复拦截的退出函数。'
      },
      install:
        "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\nimport { processPlugin } from '@migaia/log-plugin-process'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin(), processPlugin()] })\nlog.onShutdown(() => { log.info('shutdown started') })\nlog.info('ready')\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Group compatible hosts by process object. Signals and crashes share shutdown work; beforeExit only flushes. Final removal restores listeners and any intercepted exit function.',
          zh: '按进程对象对兼容宿主分组；信号与崩溃共享关闭过程，退出前事件只排空。最后移除时撤销监听并恢复拦截的退出函数。'
        }
      ],
      example:
        "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\nimport { processPlugin } from '@migaia/log-plugin-process'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin(), processPlugin()] })\nlog.onShutdown(() => { log.info('shutdown started') })\nlog.info('ready')\nawait log.shutdown('manual')"
    }
  }
}
