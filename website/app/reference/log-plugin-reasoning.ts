import type { ILibraryReference } from './contract.js'

/** Current public log-plugin-reasoning behavior, examples and ownership contracts. */
export const logReasoningReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Stream original model text and publish complete phases as silent audit entries.',
        zh: '原样输出模型文本，并将完整阶段发布为静默审计条目。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { reasoningPlugin } from '@migaia/log-plugin-reasoning'\n\nconst log = createLogHost({ plugins: [reasoningPlugin({\n  write: (text) => { globalThis.console.log(text) },\n  labels: { thinking: 'Plan' }\n})] })\nlog.startThinking()\nlog.thinking('check cache')\nlog.startResponse()\nlog.response('42')\nlog.endResponse()\nawait log.shutdown('manual')"
    }
  },
  symbols: {
    reasoningPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Add six phase methods. Switching finishes the previous nonempty phase; empty or unfinished disposed buffers publish nothing. Streamed text has no plugin-added ANSI.',
        zh: '添加六个阶段方法；切换先结束上一非空阶段，空缓冲及释放时未完成的文本不发布条目。流式文本不添加颜色转义。'
      },
      params: {
        options: {
          en: 'Optional write callback, phase labels and asyncOutput flag; the writer is borrowed.',
          zh: '可选写入回调、阶段标签及 asyncOutput 标记；写入器始终借用。'
        }
      },
      returns: {
        en: 'An installable plugin granting six thinking/response stream methods.',
        zh: '返回授予思考与响应六个流式方法的可安装插件。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { reasoningPlugin } from '@migaia/log-plugin-reasoning'\n\nconst log = createLogHost({ plugins: [reasoningPlugin({\n  write: (text) => { globalThis.console.log(text) },\n  labels: { thinking: 'Plan' }\n})] })\nlog.startThinking()\nlog.thinking('check cache')\nlog.startResponse()\nlog.response('42')\nlog.endResponse()\nawait log.shutdown('manual')",
      optionDocs: {
        write: {
          summary: {
            en: 'Receive each original text chunk; synchronous failures enter the host failure channel.',
            zh: '接收每段原始文本；同步失败进入宿主失败通道。'
          },
          default: {
            en: 'Recognized stdout.write, then console fallback.',
            zh: '先借用标准输出，否则回退控制台。'
          }
        },
        labels: {
          summary: {
            en: 'Optional thinking/response headings; text and newline boundaries are retained.',
            zh: '可选思考与响应标题；保留原文本及换行边界。'
          },
          default: {
            en: 'Thinking... for thinking, no response heading.',
            zh: '思考标题为 Thinking...，响应不加标题。'
          }
        },
        asyncOutput: {
          summary: {
            en: "Schedule token writes and completed entries through the host's tracked defer work.",
            zh: '通过宿主追踪的延后任务安排文本与完成条目。'
          },
          default: {
            en: 'false; token writing is synchronous.',
            zh: '关闭，文本写入同步。'
          }
        }
      }
    },
    LogReasoningErrorCode: {
      role: 'error',
      purpose: {
        en: 'Semantic codes owned by this package. This empty table declares no package-owned errors.',
        zh: '本包没有自定义语义错误码；借用能力的原错误由宿主失败通道接收。'
      }
    },
    ReasoningPhase: {
      role: 'constant',
      purpose: {
        en: 'Stable phase values used by completed reasoning audit entries.',
        zh: '完成推理审计条目使用的稳定阶段值。'
      }
    }
  },
  types: {
    IReasoningPluginConfig: {
      summary: {
        en: 'Add six phase methods. Switching finishes the previous nonempty phase; empty or unfinished disposed buffers publish nothing. Streamed text has no plugin-added ANSI.',
        zh: '添加六个阶段方法；切换先结束上一非空阶段，空缓冲及释放时未完成的文本不发布条目。流式文本不添加颜色转义。'
      },
      members: {
        write: {
          summary: {
            en: 'Receive each original text chunk; synchronous failures enter the host failure channel.',
            zh: '接收每段原始文本；同步失败进入宿主失败通道。'
          },
          default: {
            en: 'Recognized stdout.write, then console fallback.',
            zh: '先借用标准输出，否则回退控制台。'
          }
        },
        labels: {
          summary: {
            en: 'Optional thinking/response headings; text and newline boundaries are retained.',
            zh: '可选思考与响应标题；保留原文本及换行边界。'
          },
          default: {
            en: 'Thinking... for thinking, no response heading.',
            zh: '思考标题为 Thinking...，响应不加标题。'
          }
        },
        asyncOutput: {
          summary: {
            en: "Schedule token writes and completed entries through the host's tracked defer work.",
            zh: '通过宿主追踪的延后任务安排文本与完成条目。'
          },
          default: {
            en: 'false; token writing is synchronous.',
            zh: '关闭，文本写入同步。'
          }
        }
      }
    }
  },
  enums: {
    ReasoningPhase: {
      summary: {
        en: 'Stable phase values used by completed reasoning audit entries.',
        zh: '完成推理审计条目使用的稳定阶段值。'
      },
      values: {
        idle: {
          en: 'No section is active.',
          zh: '没有活动段落。'
        },
        thinking: {
          en: 'Accumulate thinking text.',
          zh: '积累思考文本。'
        },
        responding: {
          en: 'Accumulate response text; completed tag remains response.',
          zh: '积累响应文本，完成条目标签仍为 response。'
        }
      }
    }
  },
  enhancers: {
    reasoningPlugin: {
      kind: 'plugin',
      target: 'ILogHost',
      summary: {
        en: 'Add six phase methods. Switching finishes the previous nonempty phase; empty or unfinished disposed buffers publish nothing. Streamed text has no plugin-added ANSI.',
        zh: '添加六个阶段方法；切换先结束上一非空阶段，空缓冲及释放时未完成的文本不发布条目。流式文本不添加颜色转义。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { reasoningPlugin } from '@migaia/log-plugin-reasoning'\n\nconst log = createLogHost({ plugins: [reasoningPlugin({\n  write: (text) => { globalThis.console.log(text) },\n  labels: { thinking: 'Plan' }\n})] })\nlog.startThinking()\nlog.thinking('check cache')\nlog.startResponse()\nlog.response('42')\nlog.endResponse()\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Add six phase methods. Switching finishes the previous nonempty phase; empty or unfinished disposed buffers publish nothing. Streamed text has no plugin-added ANSI.',
          zh: '添加六个阶段方法；切换先结束上一非空阶段，空缓冲及释放时未完成的文本不发布条目。流式文本不添加颜色转义。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { reasoningPlugin } from '@migaia/log-plugin-reasoning'\n\nconst log = createLogHost({ plugins: [reasoningPlugin({\n  write: (text) => { globalThis.console.log(text) },\n  labels: { thinking: 'Plan' }\n})] })\nlog.startThinking()\nlog.thinking('check cache')\nlog.startResponse()\nlog.response('42')\nlog.endResponse()\nawait log.shutdown('manual')"
    }
  }
}
