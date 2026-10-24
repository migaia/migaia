import type { ILibraryReference } from './contract.js'
import { storagePluginArchiveCases } from './storage-plugin-archive-cases.js'
/** Archive prose describes the same finite native business paths in both languages. */
export const storagePluginArchiveReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Install archivePlugin after publishing transactional records and blob storage to archive, retrieve and sweep one organization’s history.',
        zh: '先发布事务记录与对象存储，再安装归档插件，归档、读取和清扫当前组织的历史。'
      }
    }
  },
  symbols: {
    archivePlugin: {
      role: 'enhancer',
      options: 'IArchivePluginOptions',
      purpose: {
        en: 'Install explicit run/get/sweep methods without claiming a backend kind or closing borrowed storage.',
        zh: '安装显式 run/get/sweep 方法，不声明后端种类或关闭借用存储。'
      },
      params: {
        options: {
          en: 'Literal extension ID, earlier hot/cold backend IDs and ordered rules.',
          zh: '扩展字面量标识、更早热冷后端标识与有序规则。'
        }
      },
      returns: {
        en: 'An ordinary typed extension handle for host.use and current-org methods.',
        zh: '供 host.use 安装并支持当前组织方法的普通类型扩展句柄。'
      },
      cases: storagePluginArchiveCases.archivePlugin
    },
    ERROR_SOURCE: {
      role: 'constant',
      purpose: {
        en: 'Identify archive-owned failures with the registered storage.backend.archive domain while original storage errors retain their domains.',
        zh: '以登记的 storage.backend.archive 领域识别归档自有失败，原存储错误继续保留各自领域。'
      }
    },
    ArchiveErrorCode: {
      role: 'constant',
      purpose: {
        en: 'Distinguish installation, call argument, archive work and corrupt-segment failures so callers can choose what to correct before retrying.',
        zh: '区分安装选项、调用参数、归档工作与段损坏失败，帮助调用方确定重试前应修正的内容。'
      }
    }
  },
  types: {
    IArchiveRule: {
      summary: {
        en: 'One ordered candidate rule captured during installation.',
        zh: '安装时捕获的一条有序候选规则。'
      },
      members: {
        name: {
          summary: {
            en: 'Unique nonempty rule identity used by run selection.',
            zh: '供 run 选择的非空唯一规则名。'
          }
        },
        prefix: {
          summary: {
            en: 'UTF-16 string prefix bounding the original ordered record iterator.',
            zh: '约束原有序记录迭代器的 UTF-16 字符串前缀。'
          }
        },
        where: {
          params: {
            cutoffMs: {
              en: 'Single run wall clock minus olderThanMs.',
              zh: '本次唯一墙钟减去 olderThanMs。'
            }
          },
          returns: {
            en: 'Shared where DSL compiled once for this selected rule.',
            zh: '对此已选规则编译一次的共享 where DSL。'
          },
          whenToUse: {
            en: 'Choose records eligible at this retention cutoff.',
            zh: '选择保留截止时间内应归档的记录。'
          },
          example: storagePluginArchiveCases.archivePlugin![0]!.example,
          summary: {
            en: 'Called once with the run cutoff to construct the shared query predicate.',
            zh: '以本次截止时间调用一次，构建共享查询谓词。'
          }
        },
        olderThanMs: {
          summary: {
            en: 'Nonnegative safe integer subtracted from the single run wall clock.',
            zh: '从本次唯一墙钟时间减去的非负安全整数。'
          }
        },
        segmentBytes: {
          default: {
            en: '1,048,576 uncompressed UTF-8 bytes.',
            zh: '1,048,576 个未压缩 UTF-8 字节。'
          },
          summary: {
            en: 'Positive uncompressed UTF-8 budget; an oversized row forms its own segment.',
            zh: '未压缩 UTF-8 正字节上限，超大单行独立成段。'
          }
        }
      }
    },
    IArchivePluginOptions: {
      optionCases: [
        { ...storagePluginArchiveCases.archivePlugin![0]!, covers: ['id', 'hot', 'cold', 'rules'] }
      ],
      summary: {
        en: 'Later-batch ordinary extension borrowing previously published storage.',
        zh: '后续批次安装并借用已发布存储的普通扩展。'
      },
      members: {
        id: {
          summary: {
            en: 'Literal extension identity and private metadata namespace.',
            zh: '扩展字面量身份和私有元数据命名空间。'
          }
        },
        hot: {
          summary: {
            en: 'Earlier transactional records backend permitting external I/O.',
            zh: '允许外部 I/O 的更早事务记录后端。'
          }
        },
        cold: {
          summary: {
            en: 'Earlier genuine blob backend retaining immutable segments.',
            zh: '保留不可变段的更早真实 blob 后端。'
          }
        },
        rules: {
          summary: {
            en: 'Nonempty declaration order; overlapping candidates belong to the first matching rule.',
            zh: '非空声明顺序，重叠候选属于首条匹配规则。'
          }
        }
      }
    },
    IArchiveRunOptions: {
      summary: {
        en: 'Candidate selection and the original operation cancellation budget.',
        zh: '候选选择和原操作取消预算。'
      },
      members: {
        rule: {
          default: {
            en: 'All installed rules, in declaration order.',
            zh: '按声明顺序选择所有已安装规则。'
          },
          summary: {
            en: 'Select one installed rule by its exact name.',
            zh: '按精确名称选择已安装规则。'
          }
        },
        limit: {
          default: { en: 'No candidate limit.', zh: '不额外限制候选数量。' },
          summary: {
            en: 'Positive safe integer bound on distinct matching candidates.',
            zh: '限制不重复匹配候选的正安全整数。'
          }
        },
        signal: {
          default: { en: 'No caller cancellation signal.', zh: '不提供调用方取消信号。' },
          summary: {
            en: 'Original cooperative cancellation signal.',
            zh: '原协作取消信号。'
          }
        },
        timeoutMs: {
          default: { en: 'No extra operation deadline.', zh: '不提供额外操作期限。' },
          summary: {
            en: 'Original shared operation deadline in milliseconds.',
            zh: '原共享操作的毫秒期限。'
          }
        },
        pageSize: {
          default: {
            en: 'The native iterator chooses its original page size.',
            zh: '原生迭代器选择原页大小。'
          },
          summary: {
            en: 'Original record iterator page-size hint from 1 through 4096.',
            zh: '1 至 4096 的原记录迭代页大小提示。'
          }
        },
        orgId: {
          default: { en: 'The host-bound current organization.', zh: '宿主绑定的当前组织。' },
          summary: {
            en: 'When supplied, must match the host-bound organization.',
            zh: '提供时必须匹配宿主绑定的组织。'
          }
        }
      }
    },
    IArchiveGetOptions: {
      summary: {
        en: 'Read control with an explicit opt-in restore.',
        zh: '带显式可选恢复的读取控制。'
      },
      members: {
        restore: {
          default: {
            en: 'false: return the canonical value without restoring.',
            zh: 'false：返回规范值，不写回热层。'
          },
          summary: {
            en: 'Restore only after complete EOF validation and the finite hot/manifest recheck.',
            zh: '完整 EOF 校验和有限热值/清单复核后才恢复。'
          }
        },
        signal: {
          default: { en: 'No caller cancellation signal.', zh: '不提供调用方取消信号。' },
          summary: {
            en: 'Original cooperative cancellation signal.',
            zh: '原协作取消信号。'
          }
        },
        timeoutMs: {
          default: { en: 'No extra operation deadline.', zh: '不提供额外操作期限。' },
          summary: {
            en: 'Original shared operation deadline in milliseconds.',
            zh: '原共享操作的毫秒期限。'
          }
        },
        pageSize: {
          default: {
            en: 'The native iterator chooses its original page size.',
            zh: '原生迭代器选择原页大小。'
          },
          summary: {
            en: 'Original record iterator page-size hint from 1 through 4096.',
            zh: '1 至 4096 的原记录迭代页大小提示。'
          }
        },
        orgId: {
          default: { en: 'The host-bound current organization.', zh: '宿主绑定的当前组织。' },
          summary: {
            en: 'When supplied, must match the host-bound organization.',
            zh: '提供时必须匹配宿主绑定的组织。'
          }
        }
      }
    },
    IArchiveRunResult: {
      summary: {
        en: 'Certainly committed run progress.',
        zh: '确定已提交的运行进度。'
      },
      members: {
        archived: {
          summary: {
            en: 'Hot records deleted atomically with their manifests and references.',
            zh: '与清单和引用数原子删除的热记录数。'
          }
        },
        skipped: {
          summary: {
            en: 'Uploaded candidates that changed or disappeared before commit.',
            zh: '提交前改变或消失的已上传候选数。'
          }
        },
        segments: {
          summary: {
            en: 'Committed segments with at least one accepted manifest.',
            zh: '至少接受一条清单的已提交段数。'
          }
        }
      }
    },
    IArchiveSweepResult: {
      summary: {
        en: 'Counts from actual opaque-list pages and confirmed native removals.',
        zh: '来自真实不透明分页与已确认原生删除的维护数量。'
      },
      members: {
        scanned: {
          summary: {
            en: 'Native listed objects examined under the plugin prefix.',
            zh: '插件前缀下实际检查的原生列举对象数。'
          }
        },
        removed: {
          summary: {
            en: 'Objects whose original native remove returned true.',
            zh: '原生 remove 实际返回 true 的对象数。'
          }
        }
      }
    },
    IArchiveErrorCode: {
      summary: {
        en: 'Registered archive failure code union.',
        zh: '登记的归档失败码联合。'
      },
      members: {}
    },
    IArchiveApi: {
      summary: {
        en: 'Flat archive functions named from the plugin id, without disposal authority.',
        zh: '按插件 id 命名的平铺归档函数，不提供关闭方法。'
      },
      scenarios: [
        {
          en: 'Explicit retention, read-through history and orphan maintenance.',
          zh: '显式保留、历史穿透读取与孤儿维护。'
        }
      ],
      example:
        "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { archivePlugin } from '@migaia/storage-plugin-archive'\n\nconst base = await createStorageHost({\n  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]\n})\nconst host = await base.use(\n  archivePlugin({\n    id: 'history',\n    hot: 'hot',\n    cold: 'cold',\n    rules: [{ name: 'old', prefix: 'event:', olderThanMs: 0, where: () => ({ old: true }) }]\n  })\n)\nawait host.detect()\ntry {\n  await host.backend('hot').putRecord({ old: true, answer: 42 }, 'event:one')\n  await host.extensions.historyRun()\n  console.log(await host.extensions.historyGet('event:one', { restore: true }))\n  await host.extensions.historySweep()\n} finally {\n  await host.dispose()\n}\n",
      members: {
        '${N}Run': {
          summary: {
            en: 'Upload bounded candidate segments and atomically commit unchanged rows.',
            zh: '上传有界候选段，原子提交未变行。'
          },
          params: {
            options: {
              en: 'Optional installed rule, candidate limit and original operation context.',
              zh: '可选已安装规则、候选上限和原操作上下文。'
            }
          },
          returns: {
            en: 'Certainly committed counts; work failures retain original causes and prior progress.',
            zh: '确定提交数量，工作失败保留原原因和先前进度。'
          },
          example:
            "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { archivePlugin } from '@migaia/storage-plugin-archive'\n\nconst base = await createStorageHost({\n  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]\n})\nconst host = await base.use(\n  archivePlugin({\n    id: 'history',\n    hot: 'hot',\n    cold: 'cold',\n    rules: [{ name: 'old', prefix: 'event:', olderThanMs: 0, where: () => ({ old: true }) }]\n  })\n)\nawait host.detect()\ntry {\n  await host.backend('hot').putRecord({ old: true, answer: 42 }, 'event:one')\n  await host.extensions.historyRun()\n  console.log(await host.extensions.historyGet('event:one', { restore: true }))\n  await host.extensions.historySweep()\n} finally {\n  await host.dispose()\n}\n"
        },
        '${N}Get': {
          summary: {
            en: 'Read hot first, otherwise validate the complete cold snapshot before a finite recheck.',
            zh: '先读热层，否则验证完整冷快照并有限复核。'
          },
          params: {
            key: {
              en: 'String business record key.',
              zh: '字符串业务记录键。'
            },
            options: {
              en: 'Original context and optional explicit restore.',
              zh: '原上下文和可选显式恢复。'
            }
          },
          returns: {
            en: 'Canonical collections value or undefined; a changed manifest requires explicit retry.',
            zh: '规范 collections 值或 undefined，清单改变时需显式重试。'
          },
          example:
            "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { archivePlugin } from '@migaia/storage-plugin-archive'\n\nconst base = await createStorageHost({\n  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]\n})\nconst host = await base.use(\n  archivePlugin({\n    id: 'history',\n    hot: 'hot',\n    cold: 'cold',\n    rules: [{ name: 'old', prefix: 'event:', olderThanMs: 0, where: () => ({ old: true }) }]\n  })\n)\nawait host.detect()\ntry {\n  await host.backend('hot').putRecord({ old: true, answer: 42 }, 'event:one')\n  await host.extensions.historyRun()\n  console.log(await host.extensions.historyGet('event:one', { restore: true }))\n  await host.extensions.historySweep()\n} finally {\n  await host.dispose()\n}\n"
        },
        '${N}Sweep': {
          summary: {
            en: 'Remove unreferenced matching-format objects under the original control lock.',
            zh: '在原控制锁内移除无引用且格式匹配的对象。'
          },
          params: {
            ctx: {
              en: 'Original cancellation and deadline context.',
              zh: '原取消与期限上下文。'
            }
          },
          returns: {
            en: 'Actual scanned and removed counts; the first removal failure stops later work.',
            zh: '真实扫描和删除数量，首个删除失败停止后续工作。'
          },
          example:
            "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { archivePlugin } from '@migaia/storage-plugin-archive'\n\nconst base = await createStorageHost({\n  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]\n})\nconst host = await base.use(\n  archivePlugin({\n    id: 'history',\n    hot: 'hot',\n    cold: 'cold',\n    rules: [{ name: 'old', prefix: 'event:', olderThanMs: 0, where: () => ({ old: true }) }]\n  })\n)\nawait host.detect()\ntry {\n  await host.backend('hot').putRecord({ old: true, answer: 42 }, 'event:one')\n  await host.extensions.historyRun()\n  console.log(await host.extensions.historyGet('event:one', { restore: true }))\n  await host.extensions.historySweep()\n} finally {\n  await host.dispose()\n}\n"
        }
      }
    }
  },
  enums: {
    ArchiveErrorCode: {
      summary: {
        en: 'Archive-owned failures; original host admission and contract conflicts stay with their owners.',
        zh: '归档拥有的失败，宿主准入与 contract 冲突保留原拥有者。'
      },
      values: {
        invalidOption: {
          en: 'Correct installation options before retrying.',
          zh: '重新安装插件前修正无效的安装选项。'
        },
        invalidArgument: {
          en: 'Correct the runtime key, rule or limit.',
          zh: '修正运行键、规则或上限。'
        },
        operationFailed: {
          en: 'Inspect the original cause and certainly committed progress before retrying.',
          zh: '重试前检查原原因和确定提交进度。'
        },
        segmentInvalid: {
          en: 'Retain metadata and repair an invalid referenced segment or directory.',
          zh: '保留元数据，修复无效引用段或目录。'
        }
      }
    }
  },
  enhancers: {
    archivePlugin: {
      kind: 'plugin',
      target: 'IStorageHost',
      scenarios: [
        { en: 'Explicit retention over published storage.', zh: '面向已发布存储的显式保留。' }
      ],
      install: storagePluginArchiveCases.archivePlugin![0]!.example,
      grants: [
        {
          signature: "host.extensions: IArchiveApi<'history'>",
          summary: {
            en: 'Run, read and sweep the current organization archive.',
            zh: '归档、读取和清扫当前组织历史。'
          }
        }
      ],
      summary: {
        en: 'Add three flat functions to root and organization views, prefixed by the plugin id. Each function uses its view’s organization.',
        zh: '向根及组织视图添加三个以插件 id 为前缀的平铺函数，每个函数使用对应视图的当前组织。'
      },
      example:
        "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { archivePlugin } from '@migaia/storage-plugin-archive'\n\nconst base = await createStorageHost({\n  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]\n})\nconst host = await base.use(\n  archivePlugin({\n    id: 'history',\n    hot: 'hot',\n    cold: 'cold',\n    rules: [{ name: 'old', prefix: 'event:', olderThanMs: 0, where: () => ({ old: true }) }]\n  })\n)\nawait host.detect()\ntry {\n  await host.backend('hot').putRecord({ old: true, answer: 42 }, 'event:one')\n  await host.extensions.historyRun()\n  console.log(await host.extensions.historyGet('event:one', { restore: true }))\n  await host.extensions.historySweep()\n} finally {\n  await host.dispose()\n}\n"
    }
  }
}
