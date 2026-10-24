import type { ILibraryReference, IText } from './contract.js'
import { storagePluginObjectCases } from './storage-plugin-object-cases.js'
/** Bilingual reference sentences share one concrete public module inventory. */
const t = (en: string, zh: string): IText => ({ en, zh })
/**
 * Object documentation describes native behavior without exposing its private filesystem layout
 * API.
 */
export const storagePluginObjectReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Install one object backend through objectBackendPlugin and read the shared blob capability.',
        '通过 objectBackendPlugin 安装对象后端，再使用共享对象能力读写内容与元数据。'
      )
    },
    fs: {
      summary: t(
        'Create the single native Node/Bun/Deno filesystem driver descriptor.',
        '创建惰性文件系统驱动描述，安装时由当前运行时的原生文件接口接管实际读写。'
      )
    },
    s3: {
      summary: t(
        'Create a native S3 client driver with bounded multipart and native conditions.',
        '创建对象服务驱动描述，使用官方客户端执行有界分段上传与原生条件写入。'
      )
    },
    'features/presign': {
      summary: t(
        'Install official SDK request signing only on the S3 driver.',
        '为对象服务驱动安装官方请求签名特性，生成上传或下载请求而不传输对象内容。'
      )
    }
  },
  symbols: {
    objectBackendPlugin: {
      role: 'factory',
      purpose: t(
        'Define one lazy object backend and its selected Features. Native resources open only during host installation.',
        '定义惰性对象后端及选定 Feature；仅在宿主安装时打开原生资源。'
      ),
      params: {
        features: t(
          'Optional Features targeted at the exact objectBackendKind.',
          '可选 Feature，必须指向精确 objectBackendKind。'
        )
      },
      optionDocs: {
        id: {
          summary: t(
            'Backend ID declared here and later passed to host.backend.',
            '此处声明并随后传给 host.backend 的后端标识。'
          ),
          default: t('object selects the default object backend name.', 'object，默认对象后端名。')
        },
        driver: {
          summary: t(
            'Authentic fsObjectDriver or s3ObjectDriver descriptor.',
            '由文件系统或对象服务工厂返回的真实惰性驱动描述。'
          )
        }
      },
      optionCases: [
        { ...storagePluginObjectCases.objectBackendPlugin![0]!, covers: ['id', 'driver'] }
      ],
      returns: t(
        'An exact-id storage backend plugin; no connection or directory is opened by the factory.',
        '精确 id 的后端插件，工厂不打开连接或目录。'
      ),
      cases: storagePluginObjectCases.objectBackendPlugin
    },
    objectBackendKind: {
      role: 'constant',
      purpose: t(
        'Authenticate object Feature targets and their native exposure by exact identity.',
        '通过精确令牌身份校验对象特性的挂载目标，使其仅访问所属后端的原生暴露。'
      )
    },
    ObjectDriverKind: {
      role: 'constant',
      purpose: t(
        'Name the two actual object driver families without constructing either.',
        '标识文件系统与对象服务两种真实原生驱动族，本常量本身不构造或打开任何驱动。'
      )
    },
    ERROR_SOURCE: {
      role: 'constant',
      purpose: t(
        'Registered native object error domain storage.backend.object.',
        '以登记的 storage.backend.object 领域识别原生对象适配失败，原始原因继续保留在错误链。'
      )
    },
    ObjectErrorCode: {
      role: 'constant',
      purpose: t(
        'Classify native failure, corrupt object data and unknown commit acknowledgment while retaining native causes.',
        '分类原生失败、对象数据损坏与提交确认未知，并保留原生原因。'
      )
    },
    fsObjectDriver: {
      role: 'factory',
      purpose: t(
        'Capture a trusted plugin-managed directory without I/O. The selected runtime adapter opens it during installation.',
        '无 I/O 捕获可信插件专用目录，安装时由选定运行时适配打开。'
      ),
      options: 'IFsObjectDriverOptions',
      optionCases: [{ ...storagePluginObjectCases.fsObjectDriver![0]!, covers: ['root'] }],
      returns: t(
        'Authentic lazy filesystem driver; one real directory supports one active writer per process.',
        '真实惰性文件系统驱动，一个真实目录仅支持本进程内一个活动写实例。'
      ),
      cases: storagePluginObjectCases.fsObjectDriver
    },
    s3ObjectDriver: {
      role: 'factory',
      purpose: t(
        'Capture one borrowed SDK client or owned-client configuration. Detect conditional writes through the original host detection window.',
        '捕获借用 SDK client 或自有 client 配置，通过原宿主检测窗口验证条件写。'
      ),
      options: 'IS3ObjectDriverOptions',
      optionCases: [
        {
          ...storagePluginObjectCases.s3ObjectDriver![0]!,
          covers: [
            'client',
            'bucket',
            'prefix',
            'multipartThresholdBytes',
            'partBytes',
            'partConcurrency'
          ]
        },
        { ...storagePluginObjectCases.objectPresignFeature![0]!, covers: ['config'] }
      ],
      returns: t(
        'Authentic lazy S3 descriptor. Modification requests send once; unknown commit acknowledgment is never replayed automatically.',
        '真实惰性 S3 描述；修改请求仅发送一次，提交确认未知时不自动重放。'
      ),
      cases: storagePluginObjectCases.s3ObjectDriver
    },
    objectPresignFeature: {
      role: 'factory',
      purpose: t(
        'Add store.api.presign upload/download signing with the same native S3 client and organized keys. Filesystem installation rejects this Feature.',
        '用相同原生 S3 client 与组织键增加 store.api.presign 上传、下载签名；文件系统安装拒绝该 Feature。'
      ),
      returns: t(
        'An object Feature with an empty transaction projection; signing executes no object transfer.',
        '对象 Feature，事务投影为空；签名不执行对象传输。'
      ),
      cases: storagePluginObjectCases.objectPresignFeature
    }
  },
  types: {
    IObjectDriver: {
      summary: t(
        'Authentic immutable descriptor issued by a native driver factory.',
        '原生驱动工厂签发的真实不可变描述。'
      ),
      scenarios: [
        t(
          'Keep a lazy driver descriptor and pass it to objectBackendPlugin for host-owned installation.',
          '保留惰性驱动描述，再传给 objectBackendPlugin，由宿主负责安装与资源释放。'
        )
      ],
      example: storagePluginObjectCases.objectBackendPlugin![0]!.example,
      members: {
        kind: {
          summary: t('fs or s3 selects the real native family.', 'fs 或 s3，选择真实原生驱动族。'),
          values: { enum: 'ObjectDriverKind' }
        }
      }
    },
    IObjectStore: {
      summary: t(
        'Original storage resource with the independent shared blob capability; no KV, SQL or transaction projection.',
        '具备独立共享 blob 能力的原存储资源，不提供 KV、SQL 或事务投影。'
      ),
      members: {}
    },
    IObjectAddress: {
      summary: t(
        'Already-organized native address supplied only to an installed S3 Feature.',
        '仅提供给已安装 S3 Feature 的组织化原生地址。'
      ),
      members: {
        bucket: {
          summary: t(
            'Native bucket selected by the driver configuration.',
            '原驱动配置选定的原生对象桶名称。'
          )
        },
        key: {
          summary: t(
            'Configuration prefix plus canonical ordered organization key.',
            '配置前缀与规范保序组织键。'
          )
        }
      }
    },
    IObjectPostCommitError: {
      summary: t(
        'A confirmed write whose required metadata follow-up failed. Inspect the original cause and do not replay automatically.',
        '已确认写后必需元数据补读失败；检查原始 cause，不自动重放。'
      ),
      members: {
        committed: {
          summary: t(
            'Always true; the native write itself was confirmed.',
            '始终为 true，原生写本身已确认。'
          )
        }
      }
    },
    IFsObjectDriverOptions: {
      summary: t(
        'Trusted plugin-managed native filesystem target.',
        '可信插件专用原生文件系统目标。'
      ),
      members: {
        root: {
          summary: t(
            'Nonempty directory path resolved to one absolute realpath on installation. Cross-process writers are unsupported.',
            '非空目录路径，安装时解析为绝对 realpath；不支持跨进程共写。'
          )
        }
      }
    },
    IS3ObjectDriverOptions: {
      summary: t(
        'Exactly one borrowed client or owned-client config and one native bucket.',
        '精确选择借用 client 或自有 client 配置，并指定原生 bucket。'
      ),
      members: {
        client: {
          summary: t(
            'Borrowed official S3Client; never copied, reconfigured or destroyed.',
            '借用官方 S3Client，不复制、重配或销毁。'
          ),
          default: t('Omitted requires config.', '省略时须提供 config。')
        },
        config: {
          summary: t(
            'Official SDK configuration used to create one owned client at installation.',
            '安装时创建自有 client 的官方 SDK 配置。'
          ),
          default: t('Omitted requires client.', '省略时须提供 client。')
        },
        bucket: {
          summary: t(
            'Nonempty existing native bucket; the backend does not create buckets.',
            '非空已有原生 bucket，后端不创建桶。'
          )
        },
        prefix: {
          summary: t(
            'Native prefix outside the organization segment.',
            '位于组织段之外的原生前缀。'
          ),
          default: t('Empty string adds no configuration prefix.', '空串，不增加配置前缀。')
        },
        multipartThresholdBytes: {
          summary: t(
            'Positive safe integer byte threshold for known-size input; streams always use multipart except empty streams.',
            '已知大小输入的正安全整数字节阈值；流除空流外均用 multipart。'
          ),
          default: t(
            '16 MiB triggers multipart for known-size content.',
            '已知大小内容达到十六兆字节时分段上传。'
          )
        },
        partBytes: {
          summary: t(
            'Positive safe integer part size at least 5 MiB; the final part may be smaller.',
            '至少 5 MiB 的正安全整数段大小，最后一段可更小。'
          ),
          default: t('8 MiB per nonfinal part.', '每个非末尾分段缺省八兆字节。')
        },
        partConcurrency: {
          summary: t(
            'Positive safe integer bound on outstanding native part requests.',
            '活动原生段请求数的正安全整数上限。'
          ),
          default: t('4 outstanding parts.', '最多并发四个分段请求。')
        }
      }
    },
    IObjectSignedRequest: {
      summary: t(
        'Official SDK-signed request; send its exact headers and method to its URL.',
        '官方 SDK 签名请求，向 URL 发送精确 headers 与 method。'
      ),
      members: {
        url: {
          summary: t(
            'Credential-bound URL; never place it in ordinary operation hooks.',
            '受凭据有效期约束的 URL，不进入普通操作 hooks。'
          )
        },
        method: {
          summary: t(
            'PUT uploads and GET downloads.',
            '上传请求使用 PUT，下载请求使用 GET，须按签名方法发送。'
          )
        },
        headers: {
          summary: t(
            'All content, metadata, range and condition headers required by this signature.',
            '此签名必需的全部内容、metadata、范围和条件头。'
          )
        }
      }
    },
    IObjectPresignUploadOptions: {
      summary: t(
        'Native signed-upload content and condition inputs.',
        '原生上传签名的内容与条件输入。'
      ),
      members: {
        expiresInSeconds: {
          summary: t(
            'Integer seconds from 1 through 604800.',
            '签名有效期的整数秒数，范围为一至六十万四千八百。'
          ),
          default: t('900 seconds, capped by credential expiry.', '900 秒，同时受凭据失效约束。')
        },
        contentType: {
          summary: t(
            'Native content type included in the signature.',
            '包含在签名中的原生内容类型。'
          ),
          default: t('No content type header.', '不设置内容类型头。')
        },
        metadata: {
          summary: t(
            'Lowercase HTTP-token names with ASCII header values; frozen at admission.',
            '小写 HTTP token 名称与 ASCII 头值，准入时冻结。'
          ),
          default: t('Empty metadata.', '空 metadata。')
        },
        ifMatch: {
          summary: t(
            'Opaque native etag required at commit; excludes ifNoneMatch.',
            '提交时要求匹配的不透明原生 etag，与 ifNoneMatch 互斥。'
          ),
          default: t('No etag condition.', '不设置 etag 条件。')
        },
        ifNoneMatch: {
          summary: t(
            'Only true is valid: require absence at native commit.',
            '只接受 true，要求原生提交时不存在对象。'
          ),
          default: t('No absence condition.', '不设置不存在条件。')
        },
        ctx: {
          summary: t(
            'Original caller cancellation and deadline context.',
            '调用方原有的存储取消信号与期限上下文。'
          ),
          default: t('No caller cancellation or deadline.', '不设置调用方取消或期限。')
        }
      }
    },
    IObjectPresignDownloadOptions: {
      summary: t(
        'Native signed-download expiry and inclusive range.',
        '原生下载签名的期限与闭区间范围。'
      ),
      members: {
        expiresInSeconds: {
          summary: t(
            'Integer seconds from 1 through 604800.',
            '签名有效期的整数秒数，范围为一至六十万四千八百。'
          ),
          default: t('900 seconds, capped by credential expiry.', '900 秒，同时受凭据失效约束。')
        },
        range: {
          summary: t(
            'Nonnegative safe-integer start and optional inclusive end at least start.',
            '非负安全整数 start，以及可选、不小于 start 的闭区间 end。'
          ),
          default: t('Full object download.', '下载完整对象。')
        },
        ctx: {
          summary: t(
            'Original caller cancellation and deadline context.',
            '调用方原有的存储取消信号与期限上下文。'
          ),
          default: t('No caller cancellation or deadline.', '不设置调用方取消或期限。')
        }
      }
    },
    IObjectErrorCode: {
      summary: t(
        'Registered union for native I/O, invalid persisted data and unknown commit outcomes.',
        '登记的原生读写失败、持久数据无效与提交结果未知错误码联合。'
      ),
      members: {}
    },
    IObjectPresignApi: {
      summary: t(
        'Installed native S3 request signing with no transfer or transaction authority.',
        '已安装原生 S3 请求签名，不具备传输或事务权限。'
      ),
      members: {
        upload: {
          summary: t('Sign one organized native upload.', '为单个组织键签名原生上传。'),
          params: {
            key: t('Logical string object key.', '逻辑字符串对象键。'),
            options: t(
              'Optional content, metadata, condition and expiry options.',
              '可选内容、metadata、条件和期限。'
            )
          },
          returns: t('Signed PUT URL and required headers.', '签名 PUT URL 与必需头。'),
          example: storagePluginObjectCases.objectPresignFeature![0]!.example
        },
        download: {
          summary: t('Sign one organized native download.', '为单个组织键签名原生下载。'),
          params: {
            key: t('Logical string object key.', '逻辑字符串对象键。'),
            options: t('Optional inclusive range and expiry options.', '可选闭区间范围与期限。')
          },
          returns: t('Signed GET URL and required headers.', '签名 GET URL 与必需头。'),
          example: "const request = await host.backend('object').api.presign.download('receipt')"
        }
      }
    }
  },
  enums: {
    ObjectDriverKind: {
      summary: t('Actual supported native driver families.', '实际支持的原生驱动族。'),
      values: {
        fs: t('Single-writer native local filesystem.', '单写实例原生本地文件系统。'),
        s3: t('Official SDK-backed S3-compatible service.', '由官方 SDK 接入的 S3 兼容服务。')
      }
    },
    ObjectErrorCode: {
      summary: t('Registered native object error categories.', '登记的原生对象错误类别。'),
      values: {
        failed: t(
          'Native I/O, signing or close failed; inspect cause and committed before replaying.',
          '原生 I/O、签名或关闭失败；重放前检查 cause 与 committed。'
        ),
        dataInvalid: t(
          'An existing object pointer, sidecar or required response cannot be decoded.',
          '已有对象 pointer、sidecar 或必要响应无法解码。'
        ),
        commitUnknown: t(
          'A dispatched atomic commit has no confirmed outcome; inspect head.',
          '已发出的原子提交未确认结果，应 head 核实。'
        )
      }
    }
  },
  enhancers: {}
}
