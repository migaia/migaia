import type { ILibraryReference } from './contract.js'

/** Current public log-host behavior, examples and ownership contracts. */
export const logHostReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Create an asynchronous plugin host for logging, with explicit output and lifecycle ownership.',
        zh: '创建异步日志插件宿主，明确输出与生命周期所有权。'
      },
      example:
        "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')"
    },
    plugin: {
      summary: {
        en: 'Author output plugins and entry/gate/format descriptors; reuse canonical error projection.',
        zh: '编写输出插件及条目、门槛、格式描述符，复用规范错误投影。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { defineOutputPlugin } from '@migaia/log-host/plugin'\n\nconst output = defineOutputPlugin({\n  name: 'audit', batchable: false, consumesText: false,\n  deliver(records) { for (const record of records) console.log(record.entry.message) }\n})\nconst log = createLogHost({ plugins: [output] })\nlog.log('audit', 'saved')\nawait log.shutdown('manual')"
    },
    features: {
      summary: {
        en: 'Select threshold, filtering, UUID, formatting, batching, retry and timeout policies.',
        zh: '选择门槛、过滤、标识、格式、批量、重试和超时策略。'
      },
      example:
        "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')"
    },
    'features/threshold': {
      summary: {
        en: 'Apply a severity threshold per output; non-level tags retain their category.',
        zh: '按输出应用级别门槛，非级别标签保留分类。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { thresholdFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [thresholdFeature({ level: 'warn' })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    },
    'features/filter': {
      summary: {
        en: 'Use an initial predicate and reversible added filters without mutating another owner.',
        zh: '使用初始谓词及可撤销追加过滤器，不改写其它所有者。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { filterFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [filterFeature({ filters: [(entry) => entry.message !== 'private'] })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    },
    'features/uuid': {
      summary: {
        en: 'Annotate accepted entries once; keep display policy independent from formatting.',
        zh: '为接纳条目标注一次标识，显示策略与格式独立。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { uuidFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [uuidFeature({ display: false })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    },
    'features/format': {
      summary: {
        en: 'Select json/plain formatting; every scope admits one format and output format wins.',
        zh: '选择结构化或纯文本格式；每个作用域最多一个格式，输出级优先。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { formatFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [formatFeature({ format: 'json' })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    },
    'features/batch': {
      summary: {
        en: 'Collect bounded FIFO batches per output and drain partial batches on flush.',
        zh: '按输出收集有界先入先出批次，排空时交付不完整批次。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { batchFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [batchFeature({ maxSize: 20, maxWaitMs: 1000 })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    },
    'features/retry': {
      summary: {
        en: 'Retry failed delivery through canonical utils policy; attempts include the first call.',
        zh: '通过规范底层策略重试交付失败，总次数包括首次调用。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { retryFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [retryFeature({ attempts: 3, backoff: 200 })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    },
    'features/timeout': {
      summary: {
        en: 'Bound each attempt cooperatively; keep delivery primary ahead of ordered cleanup errors.',
        zh: '协作限制每次尝试，交付主错误先于有序清理错误。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { timeoutFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [timeoutFeature({ ms: 10000 })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    }
  },
  symbols: {
    createLogHost: {
      role: 'factory',
      purpose: {
        en: 'Capture construction options once, install the initial tuple synchronously and return a frozen facade. Log methods return before ordered asynchronous admission; flush/shutdown always fulfill and report failures.',
        zh: '一次捕获创建选项，同步安装初始插件元组并返回冻结外观。日志调用在有序异步接纳前返回；排空与关闭总是兑现，并通过失败通道报告错误。'
      },
      params: {
        options: {
          en: 'Optional plugin tuple, host features, context and borrowed runtime capabilities.',
          zh: '可选插件元组、宿主特性、上下文和借用运行能力。'
        }
      },
      returns: {
        en: 'A frozen host facade whose extension methods are inferred from the initial plugin tuple.',
        zh: '返回冻结宿主外观，扩展方法由初始插件元组推导。'
      },
      example:
        "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
      options: 'ILogHostOptions'
    },
    levelPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Add debug/info/warn/error/fatal and atLevel. Threshold and filtering remain separate host features.',
        zh: '添加五个级别方法及按级别派发；门槛与过滤仍由独立宿主特性负责。'
      },
      params: {},
      returns: {
        en: 'An installable plugin granting debug/info/warn/error/fatal and atLevel.',
        zh: '返回可安装插件，授予五个级别方法及 atLevel。'
      },
      example:
        "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
      optionDocs: {}
    },
    forwardPlugin: {
      role: 'enhancer',
      purpose: {
        en: 'Forward entries to deduplicated structural targets while preventing self/cycle registration. Source flush waits for forwarded work.',
        zh: '转发到去重后的结构化目标，注册时拒绝自身或循环；源排空等待转发工作。'
      },
      params: {
        options: {
          en: 'Required targets array of borrowed ctx/dispatchRaw/flush facades.',
          zh: '必填 targets 数组，各目标提供借用的 ctx、dispatchRaw 与 flush。'
        }
      },
      returns: {
        en: 'An installable plugin borrowing the listed targets; it does not close them.',
        zh: '返回借用所列目标的可安装插件，不关闭这些目标。'
      },
      example:
        "import { createLogHost, forwardPlugin } from '@migaia/log-host'\n\nconst target = createLogHost({ topic: 'audit' })\nconst source = createLogHost({ plugins: [forwardPlugin({ targets: [target] })] })\nsource.log('info', 'saved')\nawait source.shutdown('manual')\nawait target.shutdown('manual')",
      optionDocs: {
        targets: {
          summary: {
            en: 'Borrow targets exposing ctx/dispatchRaw/flush; target lifetime remains independent.',
            zh: '借用提供上下文、原始派发和排空的目标；目标生命周期仍独立。'
          }
        }
      }
    },
    thresholdFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Apply a severity threshold per output; non-level tags retain their category.',
        zh: '按输出应用级别门槛，非级别标签保留分类。'
      },
      params: {
        options: {
          en: 'Optional level, default debug; change it later through the returned descriptor.setLevel().',
          zh: '可选 level，默认 debug；之后通过返回描述符的 setLevel() 修改。'
        }
      },
      returns: {
        en: 'An issued gate descriptor with setLevel(level), shared deliberately when the descriptor is reused.',
        zh: '返回带 setLevel(level) 的门槛描述符，复用描述符时明确共享门槛状态。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { thresholdFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [thresholdFeature({ level: 'warn' })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      optionDocs: {}
    },
    filterFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Use an initial predicate and reversible added filters without mutating another owner.',
        zh: '使用初始谓词及可撤销追加过滤器，不改写其它所有者。'
      },
      params: {
        options: {
          en: 'Optional filters array in insertion order; default empty.',
          zh: '可选 filters 谓词数组，按插入顺序执行，默认空数组。'
        }
      },
      returns: {
        en: 'An issued gate descriptor with add(predicate), which returns a removal handle for that registration only.',
        zh: '返回带 add(predicate) 的过滤描述符；追加操作返回只移除该次注册的句柄。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { filterFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [filterFeature({ filters: [(entry) => entry.message !== 'private'] })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      optionDocs: {}
    },
    uuidFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Annotate accepted entries once; keep display policy independent from formatting.',
        zh: '为接纳条目标注一次标识，显示策略与格式独立。'
      },
      params: {
        options: {
          en: 'Optional display flag, default false; UUID generation still occurs.',
          zh: '可选 display 标记，默认 false；仍然生成标识。'
        }
      },
      returns: {
        en: 'An entry-stage descriptor usable at host scope; output-local installation is rejected.',
        zh: '返回宿主级条目阶段描述符；输出级安装会被拒绝。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { uuidFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [uuidFeature({ display: false })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      optionDocs: {}
    },
    formatFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Select json/plain formatting; every scope admits one format and output format wins.',
        zh: '选择结构化或纯文本格式；每个作用域最多一个格式，输出级优先。'
      },
      params: {
        options: {
          en: 'Required format: json or plain.',
          zh: '必填 format，只接受 json 或 plain。'
        }
      },
      returns: {
        en: 'One json/plain format descriptor; a text output may override it, while entry-only outputs skip it.',
        zh: '返回一个结构化或纯文本格式描述符；文本输出可覆盖，仅条目输出跳过它。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { formatFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [formatFeature({ format: 'json' })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      optionDocs: {}
    },
    batchFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Collect bounded FIFO batches per output and drain partial batches on flush.',
        zh: '按输出收集有界先入先出批次，排空时交付不完整批次。'
      },
      params: {
        options: {
          en: 'Optional maxSize=20, maxWaitMs=2000, maxConcurrentBatches=1, maxPendingBatches=1024 and drainTimeoutMs=3000.',
          zh: '可选批量参数：maxSize=20、maxWaitMs=2000、maxConcurrentBatches=1、maxPendingBatches=1024、drainTimeoutMs=3000。'
        }
      },
      returns: {
        en: 'A delivery descriptor; each installed batchable output owns its own FIFO batch state.',
        zh: '返回交付描述符；每个可批量输出独立拥有先入先出批次状态。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { batchFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [batchFeature({ maxSize: 20, maxWaitMs: 1000 })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      optionDocs: {}
    },
    retryFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Retry failed delivery through canonical utils policy; attempts include the first call.',
        zh: '通过规范底层策略重试交付失败，总次数包括首次调用。'
      },
      params: {
        options: {
          en: 'Required attempts including the first call; optional numeric/function backoff defaults to zero.',
          zh: '必填 attempts，包含首次调用；可选数值或函数 backoff，默认零。'
        }
      },
      returns: {
        en: 'A delivery descriptor with an explicit total attempt count and backoff policy.',
        zh: '返回包含明确总尝试次数与退避策略的交付描述符。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { retryFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [retryFeature({ attempts: 3, backoff: 200 })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      optionDocs: {}
    },
    timeoutFeature: {
      role: 'enhancer',
      purpose: {
        en: 'Bound each attempt cooperatively; keep delivery primary ahead of ordered cleanup errors.',
        zh: '协作限制每次尝试，交付主错误先于有序清理错误。'
      },
      params: {
        options: {
          en: 'Required finite nonnegative ms for each attempt.',
          zh: '必填有限非负 ms，逐次尝试生效。'
        }
      },
      returns: {
        en: 'A delivery descriptor bounding each attempt through the shared scheduler and cancellation owner.',
        zh: '返回通过共享调度及取消所有者限制每次尝试的交付描述符。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { timeoutFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [timeoutFeature({ ms: 10000 })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      optionDocs: {}
    },
    defaultLogFailureReporter: {
      role: 'operation',
      purpose: {
        en: 'Report an unhandled logging failure through the host console boundary; reporter failures are contained without recursion.',
        zh: '通过宿主控制台边界报告未处理日志失败；报告器自身失败会被收住，不递归报告。'
      },
      params: {
        error: {
          en: 'Original unhandled error retained by the failure owner.',
          zh: '由失败所有者保留的原始未处理错误。'
        }
      },
      returns: {
        en: 'No return value; reporter and console failures remain contained.',
        zh: '无返回值；报告器及控制台失败会被收住。'
      },
      example:
        "import { defaultLogFailureReporter } from '@migaia/log-host'\n\ndefaultLogFailureReporter(new Error('delivery failed'))"
    },
    defineLogFeature: {
      role: 'operation',
      purpose: {
        en: 'Issue a host-recognized entry/gate/format descriptor; delivery policies remain built-in factories.',
        zh: '签发宿主认可的条目、门槛或格式描述符，交付策略仍由内置工厂提供。'
      },
      params: {
        definition: {
          en: 'A kind and exactly one entry stage, gate predicate or format implementation.',
          zh: '提供 kind，以及一个条目阶段、门槛谓词或格式实现。'
        }
      },
      returns: {
        en: 'A frozen, host-recognized descriptor for one entry, gate or format phase.',
        zh: '返回冻结且可被宿主识别的条目、门槛或格式阶段描述符。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { defineLogFeature } from '@migaia/log-host/plugin'\n\nconst redact = defineLogFeature({\n  kind: 'redact', phase: 'entry',\n  stage(entry) { return { ...entry, message: entry.message.replace(/secret/gu, '[redacted]') } }\n})\nconst log = createLogHost({ features: [redact] })\nlog.log('audit', 'secret')\nawait log.shutdown('manual')"
    },
    defineOutputPlugin: {
      role: 'operation',
      purpose: {
        en: 'Install one output with tracked delivery and host-owned policies. Entry-only definitions omit defaultFormat and receive no text or format placeholder.',
        zh: '安装受追踪交付与宿主策略的输出；仅条目定义省略默认格式，接收时没有文本或格式占位。'
      },
      params: {
        definition: {
          en: 'Output name, batchability, delivery function and text-consumption branch; optional install, features and retry classifiers.',
          zh: '提供输出名称、批量能力、交付函数与文本消费分支；可选安装、特性及重试分类器。'
        }
      },
      returns: {
        en: 'An installable output plugin retaining inferred install() extensions and host-owned delivery policies.',
        zh: '返回可安装输出插件，保留 install() 扩展推导并使用宿主交付策略。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { defineOutputPlugin } from '@migaia/log-host/plugin'\n\nconst output = defineOutputPlugin({\n  name: 'audit', batchable: false, consumesText: false,\n  deliver(records) { for (const record of records) console.log(record.entry.message) }\n})\nconst log = createLogHost({ plugins: [output] })\nlog.log('audit', 'saved')\nawait log.shutdown('manual')"
    },
    projectLogEntry: {
      role: 'operation',
      purpose: {
        en: 'Replace error.raw with the canonical serialized error chain while preserving other entry fields.',
        zh: '用规范序列化错误链替换原始错误字段，同时保留其它条目字段。'
      },
      params: {
        entry: {
          en: 'An admitted ILogEntry retaining its original native Error reference locally.',
          zh: '已接纳的 ILogEntry，本地保留原生 Error 引用。'
        }
      },
      returns: {
        en: 'A wire-safe error projection of the entry; native error.raw is omitted and the bounded original error chain is serialized.',
        zh: '返回条目的线上错误投影；省略 error.raw，并序列化有界原始错误链。'
      },
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { defineOutputPlugin, projectLogEntry } from '@migaia/log-host/plugin'\n\nconst audit = defineOutputPlugin({\n  name: 'audit', batchable: false, consumesText: false,\n  deliver(records) { for (const record of records) console.log(JSON.stringify(projectLogEntry(record.entry))) }\n})\nconst log = createLogHost({ plugins: [audit] })\nlog.log('audit', 'saved')\nawait log.shutdown('manual')"
    },
    LogLevel: {
      role: 'constant',
      purpose: {
        en: 'Ordered standard severity values used by level methods and thresholdFeature.',
        zh: '级别方法与门槛特性使用的有序标准级别。'
      }
    },
    LogHostStatus: {
      role: 'constant',
      purpose: {
        en: 'Current asynchronous host admission/lifecycle status.',
        zh: '当前异步宿主接纳与生命周期状态。'
      }
    },
    LogHostErrorCode: {
      role: 'error',
      purpose: {
        en: 'Semantic codes owned by this package. Read together with source logging.',
        zh: '本包拥有的语义错误码，与来源 `logging` 一起解释。'
      }
    },
    LOG_HOST_ERROR_SOURCE: {
      role: 'error',
      purpose: {
        en: 'The stable logging domain identifies errors constructed by this package.',
        zh: '稳定的 `logging` 来源用于识别由本包创建的错误。'
      }
    }
  },
  types: {
    ILogEntry: {
      summary: {
        en: 'One log entry as stages, hooks and sinks see it.',
        zh: '管线阶段、钩子与 sink 看到的一条日志条目。'
      },
      members: {
        id: {
          summary: {
            en: 'Entry id `log_<n>`, increasing within the process.',
            zh: '条目 id，格式为 `log_<n>`，在进程内递增。'
          }
        },
        tag: {
          summary: {
            en: 'Tag given to `log()` / `dispatchRaw()` or by a plugin (`info`, `thinking`).',
            zh: '由 `log()` / `dispatchRaw()` 或插件给出的标签（如 `info`、`thinking`）。'
          }
        },
        time: {
          summary: {
            en: 'Creation time; a replacement entry must keep a `Date` of the current realm.',
            zh: '创建时间；替换条目时必须保留当前 realm 的 `Date`。'
          }
        },
        message: {
          summary: {
            en: 'Message text of the entry.',
            zh: '日志的消息文本，可包含 `%s` 占位符。'
          }
        },
        args: {
          summary: {
            en: 'Extra values passed after the message.',
            zh: '消息之后传入的附加值。'
          }
        },
        meta: {
          summary: {
            en: 'Structured metadata given to `dispatchRaw()`.',
            zh: '通过 `dispatchRaw()` 传入的结构化元数据。'
          }
        },
        context: {
          summary: {
            en: 'Context path such as ["api", "users"]; when dispatchRaw omits it, the entry copies ctx.path, whose constructor default is [].',
            zh: '条目所属路径，例如 `["api", "users"]`；`dispatchRaw` 省略时复制 `ctx.path`，构造路径默认 `[]`。'
          }
        },
        error: {
          summary: {
            en: 'Local projection of an Error argument, retaining its original native object; HTTP/formatFeature JSON serialize a bounded chain instead of raw. See IErrorInfo.',
            zh: '`Error` 参数的本地投影，保留原生对象；网络与格式特性的结构化输出改用有界错误链而不发送原对象，见 `IErrorInfo`。'
          }
        },
        data: {
          summary: {
            en: 'Plugin data area: uuid writes uuid and reasoning sets silent so console skips the entry. A forwarded sink copy also contains display-only topicChain; the internal cycle-detection symbol remains hidden.',
            zh: '插件数据区：`uuidFeature()` 写入 `uuid`，`reasoningPlugin()` 设置 `silent: true` 使控制台跳过。转发后的输出端副本含仅供展示的 `topicChain`，内部循环检测符号不外泄。'
          }
        }
      }
    },
    IErrorInfo: {
      summary: {
        en: 'Local error projection on entry.error with native raw identity for console/custom sinks. HTTP and formatFeature JSON use the shared bounded source/code/name/message/stack/cause/errors projection without raw; unclassified business errors use diagnostic unknown/UNKNOWN placeholders.',
        zh: '保存在 `entry.error` 上的本地错误投影，供控制台及自定义输出使用原生对象。上传与颜色插件结构化输出使用共享有界链，保留来源、错误码、名称、消息、堆栈及原因和聚合分支，不含 `raw`；未分类业务错误使用诊断占位 `unknown/UNKNOWN`。'
      },
      members: {
        name: {
          summary: {
            en: 'Error name such as `TypeError`.',
            zh: '原生错误对象的名称，例如 `TypeError`。'
          }
        },
        message: {
          summary: {
            en: 'Message text of the original error.',
            zh: '原始错误对象上的 message 文本。'
          }
        },
        stack: {
          summary: {
            en: 'Stack text, when available.',
            zh: '调用栈文本（可获得时才有）。'
          }
        },
        raw: {
          summary: {
            en: 'The exact original Error for local inspection. Generic JSON may serialize enumerable own custom properties even though built-in native fields are usually non-enumerable. Built-in HTTP/formatFeature JSON deliberately omit raw and project the full bounded chain.',
            zh: '供本地检查的原始错误对象。普通序列化仍可能输出可枚举自有字段，原生内置字段通常不可枚举；内置上传与颜色插件结构化输出明确省略 `raw` 并投影完整有界链。'
          }
        }
      }
    },
    IRawEntryInput: {
      summary: {
        en: 'Input of `dispatchRaw()`: `tag` and `message` are required, the other entry fields optional.',
        zh: '`dispatchRaw()` 的输入：`tag` 与 `message` 必填，其它条目字段可选。'
      },
      members: {
        tag: {
          summary: {
            en: 'Tag of the entry, such as `audit`.',
            zh: '日志条目的标签，例如 `audit` 或 `info`。'
          }
        },
        time: {
          summary: {
            en: 'Creation time; a replacement entry must keep a `Date` of the current realm.',
            zh: '创建时间；替换条目时必须保留当前 realm 的 `Date`。'
          }
        },
        message: {
          summary: {
            en: 'Message text of the entry.',
            zh: '该日志条目要记录的消息文本。'
          }
        },
        args: {
          summary: {
            en: 'Extra values passed after the message.',
            zh: '消息之后传入的附加值。'
          }
        },
        meta: {
          summary: {
            en: 'Structured metadata given to `dispatchRaw()`.',
            zh: '通过 `dispatchRaw()` 传入的结构化元数据。'
          }
        },
        context: {
          summary: {
            en: 'Context path such as ["api", "users"]; when dispatchRaw omits it, the entry copies ctx.path, whose constructor default is [].',
            zh: '条目所属路径，例如 `["api", "users"]`；`dispatchRaw` 省略时复制 `ctx.path`，构造路径默认 `[]`。'
          }
        },
        error: {
          summary: {
            en: 'Local projection of an Error argument, retaining its original native object; HTTP/formatFeature JSON serialize a bounded chain instead of raw. See IErrorInfo.',
            zh: '`Error` 参数的本地投影，保留原生对象；网络与格式特性的结构化输出改用有界错误链而不发送原对象，见 `IErrorInfo`。'
          }
        },
        data: {
          summary: {
            en: 'Plugin data area: uuid writes uuid and reasoning sets silent so console skips the entry. A forwarded sink copy also contains display-only topicChain; the internal cycle-detection symbol remains hidden.',
            zh: '插件数据区：`uuidFeature()` 写入 `uuid`，`reasoningPlugin()` 设置 `silent: true` 使控制台跳过。转发后的输出端副本含仅供展示的 `topicChain`，内部循环检测符号不外泄。'
          }
        }
      }
    },
    ILogFailure: {
      summary: {
        en: 'Argument of `onFailure()` callbacks.',
        zh: '`onFailure()` 回调收到的失败信息：来源与错误。'
      },
      members: {
        source: {
          summary: {
            en: 'Which stage of the logger failed.',
            zh: '失败发生在 logger 的哪个环节。'
          },
          values: {
            defer: {
              en: 'A task given to `defer()` threw.',
              zh: '交给 `defer()` 的任务抛错。'
            },
            hook: {
              en: 'A hook threw or rejected.',
              zh: '某个钩子抛错或 reject。'
            },
            sink: {
              en: 'A sink threw or rejected (console, upload, file).',
              zh: '某个 sink 抛错或 reject（控制台、上报、文件）。'
            },
            pipeline: {
              en: 'A stage threw or returned an invalid entry.',
              zh: '某个管线阶段抛错或返回了无效条目。'
            },
            flush: {
              en: 'A registered plugin onFlush callback failed.',
              zh: '已注册的插件 onFlush 回调失败。'
            },
            forward: {
              en: 'A forwardPlugin target failed to accept or flush forwarded work.',
              zh: 'forwardPlugin 目标接纳或排空转发工作失败。'
            },
            shutdown: {
              en: 'A shutdown handler or plugin cleanup failed.',
              zh: '收尾函数或插件清理失败。'
            }
          }
        },
        error: {
          summary: {
            en: 'The thrown value, often with a `LogHostErrorCode`.',
            zh: '抛出的值，通常带有 `LogHostErrorCode` 错误码。'
          }
        }
      }
    },
    ILevelPluginExt: {
      summary: {
        en: 'Severity methods preserve message placeholders and native argument order. Install levelPlugin for these methods; thresholdFeature and filterFeature independently decide each output admission.',
        zh: '级别方法保留消息占位符与原生参数顺序；安装分级插件获得这些方法，门槛与过滤由独立特性决定每个输出的接纳。'
      },
      scenarios: [
        {
          en: 'Install standard severity methods, and retain a separate thresholdFeature descriptor when runtime threshold changes are needed.',
          zh: '安装标准级别方法；需要运行时调整门槛时，单独保留 thresholdFeature 描述符。'
        }
      ],
      example:
        "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
      members: {
        debug: {
          summary: {
            en: 'Creates a log entry tagged `debug`.',
            zh: '创建带 `debug` 标签的日志条目（调试细节，生产环境通常被过滤）。'
          },
          params: {
            args: {
              en: 'Message text followed by extra values, as with `console`.',
              zh: '消息文本及其后的附加值，用法与 `console` 相同。'
            }
          },
          returns: {
            en: 'Nothing; filtered entries are dropped silently.',
            zh: '无返回值；被过滤的条目会被静默丢弃。'
          },
          example: "log.debug('order %s processed', orderId)"
        },
        info: {
          summary: {
            en: 'Creates a log entry tagged `info`.',
            zh: '创建带 `info` 标签的日志条目（常规运行信息）。'
          },
          params: {
            args: {
              en: 'Message text followed by extra values, as with `console`.',
              zh: '消息文本及其后的附加值，用法与 `console` 相同。'
            }
          },
          returns: {
            en: 'Nothing; filtered entries are dropped silently.',
            zh: '无返回值；被过滤的条目会被静默丢弃。'
          },
          example: "log.info('order %s processed', orderId)"
        },
        warn: {
          summary: {
            en: 'Creates a log entry tagged `warn`.',
            zh: '创建带 `warn` 标签的日志条目（需要关注但不影响运行的情况）。'
          },
          params: {
            args: {
              en: 'Message text followed by extra values, as with `console`.',
              zh: '消息文本及其后的附加值，用法与 `console` 相同。'
            }
          },
          returns: {
            en: 'Nothing; filtered entries are dropped silently.',
            zh: '无返回值；被过滤的条目会被静默丢弃。'
          },
          example: "log.warn('order %s processed', orderId)"
        },
        error: {
          summary: {
            en: 'Creates a log entry tagged `error`.',
            zh: '创建带 `error` 标签的日志条目（操作失败）。'
          },
          params: {
            args: {
              en: 'Message text followed by extra values, as with `console`.',
              zh: '消息文本及其后的附加值，用法与 `console` 相同。'
            }
          },
          returns: {
            en: 'Nothing; filtered entries are dropped silently.',
            zh: '无返回值；被过滤的条目会被静默丢弃。'
          },
          example: "log.error('order %s processed', orderId)"
        },
        fatal: {
          summary: {
            en: 'Creates a log entry tagged `fatal`.',
            zh: '创建带 `fatal` 标签的日志条目（无法继续运行的严重失败）。'
          },
          params: {
            args: {
              en: 'Message text followed by extra values, as with `console`.',
              zh: '消息文本及其后的附加值，用法与 `console` 相同。'
            }
          },
          returns: {
            en: 'Nothing; filtered entries are dropped silently.',
            zh: '无返回值；被过滤的条目会被静默丢弃。'
          },
          example: "log.fatal('order %s processed', orderId)"
        },
        atLevel: {
          summary: {
            en: 'Attach an explicit severity to a category entry without replacing its tag; independent gate features decide delivery.',
            zh: '为分类条目附加显式级别且不替换原标签；独立门槛特性决定交付。'
          },
          params: {
            level: {
              en: 'debug, info, warn, error or fatal.',
              zh: '本次使用的标准级别：`debug`、`info`、`warn`、`error` 或 `fatal`，决定门槛判断。'
            },
            entry: {
              en: 'The existing IRawEntryInput schema.',
              zh: '本次要分发的 `IRawEntryInput`，含必填标签与消息，可保留附加参数及错误对象。'
            }
          },
          returns: {
            en: 'No return value; category entries use the same ordered asynchronous admission as log().',
            zh: '无返回值；分类条目与 log() 使用同一有序异步接纳路径。'
          },
          example: "log.atLevel('debug', { tag: 'storage', message: 'get' })"
        }
      }
    },
    ILogContext: {
      summary: {
        en: 'Frozen context of a logger, read from `log.ctx` or `core.ctx`.',
        zh: 'logger 的冻结上下文，通过 `log.ctx` 或 `core.ctx` 读取。'
      },
      members: {
        id: {
          summary: {
            en: 'Stable host identity captured from the supplied or native identifier generator; forwarding uses internal ownership bookkeeping.',
            zh: '从注入或原生标识生成器捕获的稳定宿主身份；转发另用内部所有权记录。'
          }
        },
        options: {
          summary: {
            en: 'The frozen `options` given to `createLogHost()`, readable by every plugin.',
            zh: '传给 `createLogHost()` 的 `options`，已冻结，所有插件都可读取。'
          }
        },
        path: {
          summary: {
            en: 'Default `context` of entries, from the `context` option.',
            zh: '日志条目的默认上下文路径，来自 `context` 选项。'
          }
        },
        topic: {
          summary: {
            en: 'The `topic` option, shown in the forwarding chain of `extends()`.',
            zh: '`topic` 选项的值，在 `extends()` 的转发链中展示。'
          }
        },
        createdAt: {
          summary: {
            en: 'Time at which the logger was constructed.',
            zh: '该 logger 实例被构造出来的时间。'
          }
        },
        env: {
          summary: {
            en: 'Environment detected at construction: `isTTY` and `isCI`.',
            zh: '构造时检测到的运行环境：`isTTY` 与 `isCI`。'
          }
        }
      }
    },
    ILogHostOptions: {
      summary: {
        en: 'Capture construction options once, install the initial tuple synchronously and return a frozen facade. Log methods return before ordered asynchronous admission; flush/shutdown always fulfill and report failures.',
        zh: '一次捕获创建选项，同步安装初始插件元组并返回冻结外观。日志调用在有序异步接纳前返回；排空与关闭总是兑现，并通过失败通道报告错误。'
      },
      members: {
        plugins: {
          summary: {
            en: 'Initial typed plugin tuple installed synchronously.',
            zh: '同步安装的初始类型化插件元组。'
          },
          default: {
            en: 'Empty tuple.',
            zh: '空元组。'
          }
        },
        features: {
          summary: {
            en: 'Host policies used as defaults for compatible outputs.',
            zh: '兼容输出端使用的宿主默认策略。'
          },
          default: {
            en: 'No explicit features.',
            zh: '没有显式特性。'
          }
        },
        context: {
          summary: {
            en: 'Copied initial display context path.',
            zh: '复制的初始显示上下文路径。'
          },
          default: {
            en: 'Empty path.',
            zh: '空路径。'
          }
        },
        topic: {
          summary: {
            en: 'Display topic appended during forwarding.',
            zh: '转发时追加的显示主题。'
          },
          default: {
            en: 'Empty topic.',
            zh: '空主题。'
          }
        },
        maxPending: {
          summary: {
            en: 'Bound unprocessed entries; overflow drops the oldest and reports QUEUE_OVERFLOW.',
            zh: '限制未处理条目；超限丢最旧项并报告队列溢出。'
          },
          default: {
            en: '10000.',
            zh: '一万条。'
          }
        },
        scheduler: {
          summary: {
            en: 'Borrow one scheduler source; callbacks must run after schedule returns its receipt.',
            zh: '借用调度来源；回调必须在调度返回凭据后执行。'
          },
          default: {
            en: 'Canonical system scheduler.',
            zh: '规范系统调度器。'
          }
        },
        randomUUID: {
          summary: {
            en: 'Borrow the identifier generator used by UUID features.',
            zh: '借用标识特性使用的生成函数。'
          },
          default: {
            en: 'Native UUID generator.',
            zh: '原生标识生成器。'
          }
        },
        report: {
          summary: {
            en: 'Receive failures without successful onFailure handling; reporter errors are contained.',
            zh: '接收未被成功失败监听处理的错误；报告器错误会被收住。'
          },
          default: {
            en: 'defaultLogFailureReporter.',
            zh: '宿主默认失败报告器。'
          }
        },
        execution: {
          summary: {
            en: 'Peer plugin-host mutation and drain budgets.',
            zh: '底层插件宿主的变更与排空预算。'
          },
          default: {
            en: 'Peer defaults.',
            zh: '底层缺省预算。'
          }
        }
      }
    },
    ILogHost: {
      summary: {
        en: 'Frozen factory facade with original peer configuration and plugin handles; no public raw/useSink/runtime-manager authority.',
        zh: '冻结的工厂外观，保留底层配置和插件句柄，不授予原始输出、接收器注册或全局运行管理权。'
      },
      members: {
        ctx: {
          summary: {
            en: 'Frozen construction context shared with installed plugins.',
            zh: '与已安装插件共享的冻结创建上下文。'
          },
          example:
            "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')"
        },
        config: {
          summary: {
            en: 'Original peer configuration handle; mutation remains serialized.',
            zh: '原底层配置句柄，配置变更仍按序执行。'
          },
          example:
            "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')"
        },
        status: {
          summary: {
            en: 'Current host lifecycle and admission phase.',
            zh: '当前宿主生命周期与准入阶段。'
          },
          example:
            "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')"
        },
        log: {
          summary: {
            en: 'Return synchronously and queue one structured entry for ordered asynchronous processing.',
            zh: '同步返回并将一条结构化条目加入有序异步处理。'
          },
          example:
            "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
          params: {
            tag: {
              en: 'Entry category; thresholdFeature checks standard levels and the explicit atLevel severity, while filterFeature checks every tag.',
              zh: '条目分类；门槛特性检查标准级别及 atLevel 显式级别，过滤特性检查所有标签。'
            },
            message: {
              en: 'Message text; `%s`, `%d`, `%o` placeholders are left for the console sink.',
              zh: '消息文本；`%s`、`%d`、`%o` 占位符交给控制台 sink 处理。'
            },
            args: {
              en: 'Extra values stored in `entry.args` in order.',
              zh: '按顺序保存到 `entry.args` 的附加值。'
            }
          },
          returns: {
            en: 'No return value; ordered asynchronous delivery failures are reported through onFailure.',
            zh: '无返回值；有序异步交付失败通过 onFailure 报告。'
          }
        },
        dispatchRaw: {
          summary: {
            en: 'Queue an explicit entry while preserving host-generated identity and shallow containers.',
            zh: '加入显式条目，保留宿主生成的身份与浅层容器。'
          },
          example:
            "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
          params: {
            input: {
              en: 'Required tag and message, plus optional args (default []), meta (undefined), data ({}), context (constructor context), error (first Error argument projected to name/message/stack/raw, otherwise undefined) and time (current Date). The core assigns id; callers cannot supply it. Metadata/data keys such as orderId and route are application-defined. Containers are copied, nested application values stay shared.',
              zh: '`tag` 与 `message` 必填；可选 `args` 默认 `[]`，`meta` 默认 `undefined`，`data` 默认 `{}`，`context` 默认构造路径，`error` 默认取首个 Error 参数的名称、消息、堆栈及原对象投影，未找到时为 `undefined`，`time` 默认当前日期。`id` 由核心分配，调用者不能提供；`orderId`、`route` 等键由应用定义，容器会复制，嵌套业务值仍共享。'
            }
          },
          returns: {
            en: 'No return value; every accepted entry follows the ordered asynchronous pipeline.',
            zh: '无返回值；每条已接纳条目都经过有序异步管线。'
          }
        },
        usePipeline: {
          summary: {
            en: 'Install an asynchronous entry stage and retain its idempotent removal handle.',
            zh: '安装异步条目阶段，并保留可幂等撤销的移除句柄。'
          },
          example:
            "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
          params: {
            stage: {
              en: 'The stage function; call `next` at most once.',
              zh: '阶段函数；`next` 最多调用一次。'
            }
          },
          returns: {
            en: 'An idempotent function removing this middleware stage.',
            zh: '返回幂等函数，移除该中间件阶段。'
          }
        },
        onFailure: {
          summary: {
            en: 'Register one failure observer; observer failures go to the terminal reporter without recursion.',
            zh: '登记一个失败观察者；观察者失败交终端报告器，不递归报告。'
          },
          example:
            "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
          params: {
            fn: {
              en: '`({ source, error }) => void`; see `ILogFailure`.',
              zh: '`({ source, error }) => void`，参数说明见 `ILogFailure`。'
            }
          },
          returns: {
            en: 'An idempotent function removing this failure listener.',
            zh: '返回幂等函数，移除该失败监听器。'
          }
        },
        onShutdown: {
          summary: {
            en: 'Register a final handler; structured logs remain admitted during handlers.',
            zh: '登记最终处理器；处理器执行期间仍接纳结构化日志。'
          },
          example:
            "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
          params: {
            fn: {
              en: '`(reason) => void | Promise<void>`; `reason` is the value passed to `shutdown()`.',
              zh: '`(reason) => void | Promise<void>`；`reason` 是传给 `shutdown()` 的值。'
            }
          },
          returns: {
            en: 'An idempotent function removing this shutdown listener.',
            zh: '返回幂等函数，移除该关闭监听器。'
          }
        },
        flush: {
          summary: {
            en: 'Share the current bounded drain and wait for accepted entries and output work; always fulfill.',
            zh: '共享当前有界排空，等待已接纳条目和输出工作，并总是兑现。'
          },
          example:
            "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
          returns: {
            en: 'A Promise<void> that fulfills after accepted work settles; failures use the failure channel.',
            zh: '返回等待已接纳工作结算后兑现的 Promise<void>；失败使用失败通道。'
          }
        },
        shutdown: {
          summary: {
            en: 'Share the terminal Promise, run final handlers, drain and dispose the original plugins; always fulfill.',
            zh: '共享终结承诺，执行最终处理器、排空并释放原插件，总是兑现。'
          },
          example:
            "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
          params: {
            reason: {
              en: 'Why it closes: `manual` from application code; `signal`, `uncaughtException`, `unhandledRejection` are passed by `process()`.',
              zh: '关闭原因：应用代码传 `manual`；`signal`、`uncaughtException`、`unhandledRejection` 由 `process()` 插件传入。'
            }
          },
          returns: {
            en: 'The terminal disposal-result Promise; repeated shutdown calls reuse the same Promise.',
            zh: '返回终结释放结果 Promise；重复关闭复用同一 Promise。'
          }
        },
        use: {
          summary: {
            en: 'Install an additional typed tuple through the original plugin-host mutation queue.',
            zh: '经原插件宿主变更队列安装附加类型化元组。'
          },
          example:
            "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
          params: {
            plugins: {
              en: 'Plugin objects created by factories such as `level()` or `http(config)`.',
              zh: '由 `level()`、`http(config)` 等工厂函数创建的插件对象。'
            }
          },
          returns: {
            en: 'A Promise of per-plugin handles; initial host extension inference is unchanged by later installation.',
            zh: '返回逐插件句柄的 Promise；后续安装不改变初始宿主扩展类型推导。'
          }
        },
        unUse: {
          summary: {
            en: 'Release an installed plugin through the original peer removal result and cleanup ordering.',
            zh: '经原底层移除结果及清理顺序释放已安装插件。'
          },
          example:
            "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
          params: {
            name: {
              en: 'Plugin name, such as `LEVEL_PLUGIN_NAME` (`level`).',
              zh: '插件名称，例如 `LEVEL_PLUGIN_NAME`（即 `level`）。'
            }
          }
        }
      },
      example:
        "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
      scenarios: [
        {
          en: 'One service owns its output plugins and awaits final drain.',
          zh: '由一个服务拥有输出插件并等待最后排空。'
        }
      ]
    },
    ILogPluginCore: {
      summary: {
        en: 'Public ILogPluginCore contract used at the logging host boundary; retain original peer types and native payload identities.',
        zh: '日志宿主边界的 `ILogPluginCore` 契约，保留原底层类型与原生负载身份。'
      },
      members: {}
    },
    ILogPlugin: {
      summary: {
        en: 'Public ILogPlugin contract used at the logging host boundary; retain original peer types and native payload identities.',
        zh: '日志宿主边界的 `ILogPlugin` 契约，保留原底层类型与原生负载身份。'
      },
      members: {}
    },
    ILogPluginConstraint: {
      summary: {
        en: 'Public ILogPluginConstraint contract used at the logging host boundary; retain original peer types and native payload identities.',
        zh: '日志宿主边界的 `ILogPluginConstraint` 契约，保留原底层类型与原生负载身份。'
      },
      members: {}
    },
    IPluginExtensions: {
      summary: {
        en: 'Public IPluginExtensions contract used at the logging host boundary; retain original peer types and native payload identities.',
        zh: '日志宿主边界的 `IPluginExtensions` 契约，保留原底层类型与原生负载身份。'
      },
      members: {}
    },
    ILogFeatureDefinition: {
      summary: {
        en: 'Public ILogFeatureDefinition contract used at the logging host boundary; retain original peer types and native payload identities.',
        zh: '日志宿主边界的 `ILogFeatureDefinition` 契约，保留原底层类型与原生负载身份。'
      },
      members: {}
    },
    ILogFeature: {
      summary: {
        en: 'Public ILogFeature contract used at the logging host boundary; retain original peer types and native payload identities.',
        zh: '日志宿主边界的 `ILogFeature` 契约，保留原底层类型与原生负载身份。'
      },
      members: {}
    },
    ILogProjectedEntry: {
      summary: {
        en: 'Public ILogProjectedEntry contract used at the logging host boundary; retain original peer types and native payload identities.',
        zh: '日志宿主边界的 `ILogProjectedEntry` 契约，保留原底层类型与原生负载身份。'
      },
      members: {}
    },
    ILogOutputRecord: {
      summary: {
        en: 'Public ILogOutputRecord contract used at the logging host boundary; retain original peer types and native payload identities.',
        zh: '日志宿主边界的 `ILogOutputRecord` 契约，保留原底层类型与原生负载身份。'
      },
      members: {}
    },
    ILogHostErrorCode: {
      summary: {
        en: 'Public ILogHostErrorCode contract used at the logging host boundary; retain original peer types and native payload identities.',
        zh: '日志宿主边界的 `ILogHostErrorCode` 契约，保留原底层类型与原生负载身份。'
      },
      members: {}
    },
    IShutdownReason: {
      summary: {
        en: 'Public IShutdownReason contract used at the logging host boundary; retain original peer types and native payload identities.',
        zh: '日志宿主边界的 `IShutdownReason` 契约，保留原底层类型与原生负载身份。'
      },
      members: {}
    }
  },
  enums: {
    LogLevel: {
      summary: {
        en: 'Ordered standard severity values used by level methods and thresholdFeature.',
        zh: '级别方法与门槛特性使用的有序标准级别。'
      },
      values: {
        debug: {
          en: 'Select debug severity for a standard log entry.',
          zh: '为标准日志条目选择 `debug` 级别。'
        },
        info: {
          en: 'Select info severity for a standard log entry.',
          zh: '为标准日志条目选择 `info` 级别。'
        },
        warn: {
          en: 'Select warn severity for a standard log entry.',
          zh: '为标准日志条目选择 `warn` 级别。'
        },
        error: {
          en: 'Select error severity for a standard log entry.',
          zh: '为标准日志条目选择 `error` 级别。'
        },
        fatal: {
          en: 'Select fatal severity for a standard log entry.',
          zh: '为标准日志条目选择 `fatal` 级别。'
        }
      }
    },
    LogHostStatus: {
      summary: {
        en: 'Current asynchronous host admission/lifecycle status.',
        zh: '当前异步宿主接纳与生命周期状态。'
      },
      values: {
        active: {
          en: 'Accept normal entries.',
          zh: '接纳普通条目。'
        },
        flushing: {
          en: 'Drain accepted work while preserving ordered admission.',
          zh: '排空已接纳工作并保持有序接纳。'
        },
        shuttingDown: {
          en: 'Run terminal handlers and drain before disposal.',
          zh: '释放前执行终结处理器并排空。'
        },
        closed: {
          en: 'Ignore new entries after terminal disposal.',
          zh: '终结释放后忽略新条目。'
        }
      }
    }
  },
  enhancers: {
    levelPlugin: {
      kind: 'plugin',
      target: 'ILogHost',
      summary: {
        en: 'Add debug/info/warn/error/fatal and atLevel. Threshold and filtering remain separate host features.',
        zh: '添加五个级别方法及按级别派发；门槛与过滤仍由独立宿主特性负责。'
      },
      install:
        "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Add debug/info/warn/error/fatal and atLevel. Threshold and filtering remain separate host features.',
          zh: '添加五个级别方法及按级别派发；门槛与过滤仍由独立宿主特性负责。'
        }
      ],
      example:
        "import { createLogHost, levelPlugin } from '@migaia/log-host'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })\nlog.info('request complete', { requestId: 'r1' })\nawait log.flush()\nawait log.shutdown('manual')"
    },
    forwardPlugin: {
      kind: 'plugin',
      target: 'ILogHost',
      summary: {
        en: 'Forward entries to deduplicated structural targets while preventing self/cycle registration. Source flush waits for forwarded work.',
        zh: '转发到去重后的结构化目标，注册时拒绝自身或循环；源排空等待转发工作。'
      },
      install:
        "import { createLogHost, forwardPlugin } from '@migaia/log-host'\n\nconst target = createLogHost({ topic: 'audit' })\nconst source = createLogHost({ plugins: [forwardPlugin({ targets: [target] })] })\nsource.log('info', 'saved')\nawait source.shutdown('manual')\nawait target.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Forward entries to deduplicated structural targets while preventing self/cycle registration. Source flush waits for forwarded work.',
          zh: '转发到去重后的结构化目标，注册时拒绝自身或循环；源排空等待转发工作。'
        }
      ],
      example:
        "import { createLogHost, forwardPlugin } from '@migaia/log-host'\n\nconst target = createLogHost({ topic: 'audit' })\nconst source = createLogHost({ plugins: [forwardPlugin({ targets: [target] })] })\nsource.log('info', 'saved')\nawait source.shutdown('manual')\nawait target.shutdown('manual')"
    },
    thresholdFeature: {
      kind: 'feature',
      target: 'ILogHost',
      summary: {
        en: 'Apply a severity threshold per output; non-level tags retain their category.',
        zh: '按输出应用级别门槛，非级别标签保留分类。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { thresholdFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [thresholdFeature({ level: 'warn' })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Apply a severity threshold per output; non-level tags retain their category.',
          zh: '按输出应用级别门槛，非级别标签保留分类。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { thresholdFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [thresholdFeature({ level: 'warn' })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    },
    filterFeature: {
      kind: 'feature',
      target: 'ILogHost',
      summary: {
        en: 'Use an initial predicate and reversible added filters without mutating another owner.',
        zh: '使用初始谓词及可撤销追加过滤器，不改写其它所有者。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { filterFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [filterFeature({ filters: [(entry) => entry.message !== 'private'] })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Use an initial predicate and reversible added filters without mutating another owner.',
          zh: '使用初始谓词及可撤销追加过滤器，不改写其它所有者。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { filterFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [filterFeature({ filters: [(entry) => entry.message !== 'private'] })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    },
    uuidFeature: {
      kind: 'feature',
      target: 'ILogHost',
      summary: {
        en: 'Annotate accepted entries once; keep display policy independent from formatting.',
        zh: '为接纳条目标注一次标识，显示策略与格式独立。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { uuidFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [uuidFeature({ display: false })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Annotate accepted entries once; keep display policy independent from formatting.',
          zh: '为接纳条目标注一次标识，显示策略与格式独立。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { uuidFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [uuidFeature({ display: false })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    },
    formatFeature: {
      kind: 'feature',
      target: 'ILogHost',
      summary: {
        en: 'Select json/plain formatting; every scope admits one format and output format wins.',
        zh: '选择结构化或纯文本格式；每个作用域最多一个格式，输出级优先。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { formatFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [formatFeature({ format: 'json' })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Select json/plain formatting; every scope admits one format and output format wins.',
          zh: '选择结构化或纯文本格式；每个作用域最多一个格式，输出级优先。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { formatFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [formatFeature({ format: 'json' })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    },
    batchFeature: {
      kind: 'feature',
      target: 'ILogHost',
      summary: {
        en: 'Collect bounded FIFO batches per output and drain partial batches on flush.',
        zh: '按输出收集有界先入先出批次，排空时交付不完整批次。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { batchFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [batchFeature({ maxSize: 20, maxWaitMs: 1000 })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Collect bounded FIFO batches per output and drain partial batches on flush.',
          zh: '按输出收集有界先入先出批次，排空时交付不完整批次。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { batchFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [batchFeature({ maxSize: 20, maxWaitMs: 1000 })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    },
    retryFeature: {
      kind: 'feature',
      target: 'ILogHost',
      summary: {
        en: 'Retry failed delivery through canonical utils policy; attempts include the first call.',
        zh: '通过规范底层策略重试交付失败，总次数包括首次调用。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { retryFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [retryFeature({ attempts: 3, backoff: 200 })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Retry failed delivery through canonical utils policy; attempts include the first call.',
          zh: '通过规范底层策略重试交付失败，总次数包括首次调用。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { retryFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [retryFeature({ attempts: 3, backoff: 200 })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    },
    timeoutFeature: {
      kind: 'feature',
      target: 'ILogHost',
      summary: {
        en: 'Bound each attempt cooperatively; keep delivery primary ahead of ordered cleanup errors.',
        zh: '协作限制每次尝试，交付主错误先于有序清理错误。'
      },
      install:
        "import { createLogHost } from '@migaia/log-host'\nimport { timeoutFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [timeoutFeature({ ms: 10000 })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')",
      grants: [],
      scenarios: [
        {
          en: 'Bound each attempt cooperatively; keep delivery primary ahead of ordered cleanup errors.',
          zh: '协作限制每次尝试，交付主错误先于有序清理错误。'
        }
      ],
      example:
        "import { createLogHost } from '@migaia/log-host'\nimport { timeoutFeature } from '@migaia/log-host/features'\nimport { consolePlugin } from '@migaia/log-plugin-console'\n\nconst log = createLogHost({ plugins: [consolePlugin()], features: [timeoutFeature({ ms: 10000 })] })\nlog.log('warn', 'request complete')\nawait log.shutdown('manual')"
    }
  }
}
