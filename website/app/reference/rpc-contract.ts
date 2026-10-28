/**
 * Bilingual pure Contract reference for the eight public entries of the single RPC profile. Data
 * admission and explicit error metadata live here; execution, codecs, IO and lifecycle do not.
 */
import type {
  ILibraryReference,
  IMemberDoc,
  ISymbolDoc,
  IText,
  ITypeDoc,
  IEnumDoc
} from './contract.js'
import { rpcContractCases } from './rpc-contract-cases.ts'

/** Every visible sentence has both supported locales. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** A property description may specify how omission changes this exact contract. */
const p = (en: string, zh: string, fallback?: IText): IMemberDoc => ({
  summary: t(en, zh),
  ...(fallback ? { default: fallback } : {})
})
/** Method documentation follows the actual receiver, parameters and owned completion. */
const m = (
  en: string,
  zh: string,
  params: Record<string, IText>,
  returns: IText,
  example: string
): IMemberDoc => ({ summary: t(en, zh), params, returns, example })
/** Existing portable and independent error-tree prose remains under its unchanged public boundary. */
const symbols: Record<string, ISymbolDoc> = {
  normalizePortable: {
    role: 'operation',
    purpose: {
      en: 'Snapshots supported portable values without sending or executing a request. The default wire domain is null, boolean, finite number, string, array, plain record or a canonical bytes tag; Uint8Array becomes {$rpc: "bytes", base64url}. Records become frozen null-prototype snapshots.\n\nRejects cycles, nonfinite numbers and unsupported objects with INVALID_ENVELOPE. Ordinary record getters are read once and can execute user code. Native binary belongs to an independently negotiated profile, not the default wire result.',
      zh: '快照支持的可移植值，不发送或执行请求；默认线上值域为 `null`、布尔、有限数、字符串、数组、普通记录或规范字节标签，`Uint8Array` 转为 `{ $rpc: "bytes", base64url }`，记录成为冻结的空原型快照。\n\n循环、非有限数与不支持的对象以 `INVALID_ENVELOPE` 拒绝；普通记录访问器读取一次，可能执行用户代码；原生二进制属于独立协商形态，不是默认线上结果。'
    },
    params: {
      value: {
        en: 'Application or peer value requiring a portable data-only snapshot.',
        zh: '需要纯可移植数据快照的应用或对端值。'
      },
      depth: {
        en: 'Optional existing traversal depth, default 0 at the root; RPC_PORTABLE_MAX_DEPTH is 64. Ordinary application calls omit this traversal-integration parameter.',
        zh: '可选已有遍历深度，根默认为 `0`，`RPC_PORTABLE_MAX_DEPTH` 为 `64`，普通应用调用省略此遍历集成参数。'
      },
      active: {
        en: 'Optional caller-provided ancestor Set for the same traversal, default undefined with traversal-local cycle tracking. It tracks active ancestors rather than deduplicating all repeated references.',
        zh: '可选同一遍历的祖先 `Set`，默认 `undefined`，使用遍历本地循环追踪；它记录活动祖先，不对所有重复引用去重。'
      },
      nativeBinary: {
        en: 'Optional native-binary branch flag, default false; true admits native bytes, or a synchronous rejection callback supplies the failure boundary.',
        zh: '可选原生二进制分支标志，默认假；真值接纳原生字节，也可传同步拒绝回调提供失败边界。'
      }
    },
    returns: {
      en: 'IRpcWirePortableValue by default, or negotiated IRpcPortableValue with native binary enabled; invalid data throws INVALID_ENVELOPE.',
      zh: '默认返回 `IRpcWirePortableValue`，启用协商原生字节后返回 `IRpcPortableValue`；非法数据抛信封非法错误。'
    },
    example: {
      en: "import { normalizePortable } from '@migaia/rpc-contract/portable'\n\nconst source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }\nconst snapshot = normalizePortable(source)\nsource.profile.name = 'Grace'\nsource.bytes[0] = 99\nconsole.log(JSON.stringify(snapshot))\nconsole.log(Object.isFrozen(snapshot))",
      zh: "import { normalizePortable } from '@migaia/rpc-contract/portable'\n\nconst source = { profile: { name: 'Ada' }, bytes: new Uint8Array([1, 2, 3]) }\nconst snapshot = normalizePortable(source)\nsource.profile.name = 'Grace'\nsource.bytes[0] = 99\nconsole.log(JSON.stringify(snapshot))\nconsole.log(Object.isFrozen(snapshot))"
    }
  },
  serializeRpcError: {
    role: 'operation',
    purpose: {
      en: 'Projects any original thrown value into a bounded wire error tree while preserving semantic source/code, native name, remote stack and cause/aggregate descendants. Omitted unreadable data is reported.',
      zh: '把任意原始抛出值投影为有界线上错误树，保留语义来源、错误码、原生名称、远端堆栈及原因聚合后代；省略不可读数据时会上报。'
    },
    params: {
      value: {
        en: 'Original caught or rejected value from application execution.',
        zh: '应用执行中捕获或拒绝的原始值。'
      },
      options: {
        en: 'Required application IRpcSerializeErrorOptions; report receives pointer, field and original read/normalization error synchronously.',
        zh: '应用必需的 `IRpcSerializeErrorOptions`；上报同步接收指针、字段及原始读取或规范化错误。'
      },
      metadata: {
        en: 'Optional caller-held metadata, default undefined. summaries.get(error) chooses exact-reference presentation; routes.get(error) supplies bounded node routes. Each field defaults to absent, never creates runtime authority, and is separate from ordinary serialized properties.',
        zh: '可选调用方元数据，默认 `undefined`；`summaries.get(error)` 按精确引用选择展示，`routes.get(error)` 提供有界节点路由，两字段均默认省略，与普通序列化属性分开，也不创建运行权限。'
      }
    },
    returns: {
      en: 'IRpcSerializedError with bounded truncation markers; no shared last-result state.',
      zh: '返回带有界截断标记的 `IRpcSerializedError`，不存在共享上次结果状态。'
    },
    example: {
      en: "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst original = new RangeError('limit exceeded')\nObject.defineProperties(original, { source: { value: 'example' }, code: { value: 'LIMIT' } })\nconst primary = new TypeError('request failed', { cause: original })\nObject.defineProperties(primary, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst reports: unknown[] = []\nconst wire = serializeRpcError(primary, { report: (failure) => { reports.push(failure) } })\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof TypeError, restored.cause instanceof RangeError)\nconsole.log(restored.stack === primary.stack, (restored.cause as Error).stack === original.stack)\nconsole.log((restored as Error & { code: string }).code,\n  (restored.cause as Error & { code: string }).code, reports.length)",
      zh: "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst original = new RangeError('超过限制')\nObject.defineProperties(original, { source: { value: 'example' }, code: { value: 'LIMIT' } })\nconst primary = new TypeError('请求失败', { cause: original })\nObject.defineProperties(primary, { source: { value: 'example' }, code: { value: 'REQUEST' } })\nconst reports: unknown[] = []\nconst wire = serializeRpcError(primary, { report: (failure) => { reports.push(failure) } })\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof TypeError, restored.cause instanceof RangeError)\nconsole.log(restored.stack === primary.stack, (restored.cause as Error).stack === original.stack)\nconsole.log((restored as Error & { code: string }).code,\n  (restored.cause as Error & { code: string }).code, reports.length)"
    },
    options: 'IRpcSerializeErrorOptions'
  },
  deserializeRpcError: {
    role: 'operation',
    purpose: {
      en: 'Validates a complete received error tree before restoring native Error subclasses and original serialized stacks. It does not convert wire properties into local authority.',
      zh: '恢复原生错误子类及原始序列化堆栈之前，先校验完整接收错误树；线上属性不会变成本地权限。'
    },
    params: {
      value: {
        en: 'Untrusted serialized tree received from the peer or produced by serializeRpcError.',
        zh: '从对端收到或由 `serializeRpcError` 产生的未可信序列化树。'
      },
      options: {
        en: 'Optional IRpcWireErrorOptions; defaults reject unknown fields.',
        zh: '可选 `IRpcWireErrorOptions`，默认拒绝未知字段。'
      },
      routes: {
        en: 'Optional caller-owned WeakMap set port retaining admitted node-only diagnostic routes on restored Error references.',
        zh: '调用方可选拥有的弱映射写入端，按恢复错误引用保留已接纳节点诊断路由。'
      }
    },
    returns: {
      en: 'Restored native Error tree; malformed input throws INVALID_WIRE_ERROR before restoration.',
      zh: '返回恢复的原生错误树；异常输入在恢复前抛出线上错误非法错误。'
    },
    example:
      "import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'\nconst wire = serializeRpcError(new RangeError('invalid count', { cause: new Error('root') }), { report: console.error })\nconst restored = deserializeRpcError(wire)\nconsole.log(restored instanceof RangeError, restored.cause)",
    options: 'IRpcWireErrorOptions'
  },
  normalizeRpcSerializedError: {
    role: 'operation',
    purpose: {
      en: 'Validates and freezes a fresh wire error tree with deterministic first-violation order and fixed graph/string/byte limits.',
      zh: '按确定的首违规顺序及固定图、字符串、字节限制，校验并冻结新的线上错误树。'
    },
    params: {
      value: {
        en: 'Received untrusted serialized error record.',
        zh: '接收的未可信序列化错误记录。'
      },
      options: {
        en: 'Optional IRpcWireErrorOptions controlling unknown fields and warning callback.',
        zh: '可选 `IRpcWireErrorOptions`，控制未知字段及警告回调。'
      }
    },
    returns: {
      en: 'Fresh IRpcSerializedError; violations throw INVALID_WIRE_ERROR carrying pointer and violation.',
      zh: '返回新的 `IRpcSerializedError`；违规抛线上错误非法错误并携带指针及违规类别。'
    },
    example: 'const validated = normalizeRpcSerializedError(wire)',
    options: 'IRpcWireErrorOptions'
  },
  reachRpcError: {
    role: 'operation',
    purpose: {
      en: 'Lazily walks original causes, aggregate entries and cleanup failures by identity under the object visit limit; it observes originals rather than restored copies.',
      zh: '在对象访问上限内按身份惰性遍历原始原因、聚合条目及清理失败，观察原对象而非恢复副本。'
    },
    params: {
      value: {
        en: 'Original failure value whose reachable error graph should be inspected.',
        zh: '需要检查可达错误图的原始失败值。'
      },
      options: {
        en: 'Application report callback for property reads that fail during traversal.',
        zh: '应用提供的上报回调，接收遍历期间属性读取失败。'
      }
    },
    returns: {
      en: 'Native Generator yielding original reachable values up to RpcErrorReachLimit.',
      zh: '返回原生生成器，按访问上限产出可达原始值。'
    },
    example:
      'for (const failure of reachRpcError(error, { report: console.error })) console.log(failure)',
    options: 'IRpcSerializeErrorOptions'
  }
}
/** Retained standalone tree types are distinct from the protocol's indexed error graph. */
const types: Record<string, ITypeDoc> = {
  IRpcSerializedError: {
    summary: {
      en: 'Bounded language-neutral error tree preserving native name, original remote stack and causal descendants.',
      zh: '有界跨语言错误树，保留原生名称、原远端堆栈及原因后代。'
    },
    members: {
      source: {
        summary: {
          en: 'Stable semantic package source copied from the original error or supplied by the transport context.',
          zh: '从原始错误复制或由载体上下文提供的稳定语义来源。'
        }
      },
      code: {
        summary: {
          en: 'Stable semantic error code retained across serialization; classify it together with source.',
          zh: '序列化跨域保留的稳定语义错误码，应同时检查来源。'
        }
      },
      name: {
        summary: {
          en: 'Original native error class name or application-assigned diagnostic identity.',
          zh: '原生错误类名称，或应用指定的诊断身份名称。'
        }
      },
      message: {
        summary: {
          en: 'Diagnostic message preserved with the owning failure; never use it as an authorization decision.',
          zh: '随所属失败保留的诊断消息，不能据此作权限决定。'
        }
      },
      stack: {
        summary: {
          en: 'Original serialized stack text; restoration preserves it rather than regenerating a local stack.',
          zh: '原始序列化堆栈文本；恢复时保留该值而非重新生成本地堆栈。'
        }
      },
      cause: {
        summary: {
          en: 'Optional serialized primary cause node preserving the original causal chain.',
          zh: '保留原始原因链的可选序列化主原因节点。'
        }
      },
      errors: {
        summary: {
          en: 'Optional ordered serialized aggregate children preserving original failure order.',
          zh: '可选有序聚合错误子节点，保留原始失败顺序。'
        }
      },
      data: {
        summary: {
          en: 'Portable data carried by the owning wire node; never replaces its semantic discriminator.',
          zh: '所属线上节点携带的可移植数据，不替代其语义判别字段。'
        }
      },
      truncated: {
        summary: {
          en: 'True marks a deliberately bounded error projection; absence means this node was not marked truncated.',
          zh: '真值标识有意限界的错误投影；省略表示该节点未被标记截断。'
        },
        values: {
          true: {
            en: 'The serializer omitted information to stay within bounds.',
            zh: '序列化器为满足边界已经省略部分信息。'
          }
        }
      },
      route: {
        summary: {
          en: 'Optional one-to-four original node IDs, each 32 lowercase hexadecimal characters, held only as diagnostics.',
          zh: '可选一至四个原节点标识，每个为三十二位小写十六进制，仅作诊断。'
        }
      }
    }
  },
  IRpcWireErrorOptions: {
    summary: {
      en: 'Received bounded error-node unknown-field policy, defaulting to rejection.',
      zh: '收到有界错误节点时的未知字段策略，默认拒绝。'
    },
    members: {
      unknownFields: {
        summary: {
          en: 'Chooses rejection or ignored admission of unknown received error-node fields.',
          zh: '选择拒绝或忽略接纳收到的未知错误节点字段。'
        },
        default: {
          en: '`reject`; unknown fields fail validation.',
          zh: '默认拒绝，未知字段会使校验失败。'
        },
        values: {
          enum: 'RpcWireErrorUnknownFieldMode'
        },
        whenToUse: {
          en: 'Use reject for strict received-error schemas; it is the default. Use ignore only when additive fields may be dropped. The observer does not choose or change that policy.',
          zh: '需要严格接收错误结构时用 reject，它也是默认值。仅允许丢弃新增字段时用 ignore。观察回调不选择或改变策略。'
        },
        example:
          "import { deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst failure = deserializeRpcError(receivedError, {\n  unknownFields: 'ignore',\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field)\n})\nshowCheckoutFailure(failure)"
      },
      onUnknownField: {
        summary: {
          en: 'Optional synchronous application callback receives JSON pointer and unknown field name; returns void. A throw propagates from normalization.',
          zh: '可选应用同步回调接收对象指针及未知字段名称，返回空值；抛错从规范化调用传播。'
        },
        default: {
          en: 'Omitted; no observer is called. The default unknownFields policy still rejects unknown error-node fields.',
          zh: '默认省略，不调用观察者；默认 `unknownFields` 策略仍拒绝未知错误节点字段。'
        },
        whenToUse: {
          en: 'Use it with unknownFields ignore to record fields dropped from a newer peer’s error. Omit it for no observer; the default reject policy still rejects unknown fields.',
          zh: '使用 unknownFields ignore 接收新版本对端错误时，用它记录丢弃字段。省略时没有观察者；默认 reject 策略仍拒绝未知字段。'
        },
        example:
          "import { deserializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst failure = deserializeRpcError(receivedError, {\n  unknownFields: 'ignore',\n  onUnknownField: (pointer, field) => reportProtocolChange(pointer, field)\n})\nshowCheckoutFailure(failure)"
      }
    }
  },
  IRpcSerializeErrorOptions: {
    summary: {
      en: 'Required reporting policy for failures omitted from a bounded wire projection.',
      zh: '有界线上投影中省略失败所必须提供的上报策略。'
    },
    members: {
      report: {
        summary: {
          en: 'Application synchronous callback receives IRpcWireErrorFailure with pointer, field and original error; return void and avoid throwing.',
          zh: '应用同步回调接收含指针、字段及原错误的失败记录，返回空值并避免抛错。'
        },
        whenToUse: {
          en: 'Always supply a local diagnostic sink for failed reads or portable projections omitted from the wire error. The callback receives pointer, field and the original failure. There is no default reporter.',
          zh: '必须为线上错误省略的读取或可移植投影失败提供本地诊断接收方。回调接收 pointer、field 和原始失败。没有默认报告方。'
        },
        example:
          "import { serializeRpcError } from '@migaia/rpc-contract/errors'\n\nconst wire = serializeRpcError(checkoutFailure, {\n  report: (failure) => reportSerializationFailure(failure)\n})\nsendFailureToCheckout(wire)"
      }
    }
  },
  IRpcWireErrorFailure: {
    summary: {
      en: 'Serializer report value retaining the exact property-read or portable-normalization failure.',
      zh: '序列化上报值，保留精确属性读取或可移植规范化失败。'
    },
    members: {
      pointer: {
        summary: {
          en: 'JSON-pointer location assigned by the validator to identify the failing or unknown field.',
          zh: '校验器分配的对象指针位置，用来识别失败或未知字段。'
        }
      },
      field: {
        summary: {
          en: 'Field name read or reported at the associated pointer location.',
          zh: '关联指针位置上被读取或报告的字段名称。'
        }
      },
      error: {
        summary: {
          en: 'Original or serialized failure carried by this failed result, preserving its causal diagnostics.',
          zh: '当前失败结果携带的原始或序列化失败，保留其原因诊断。'
        }
      }
    }
  },
  IRpcErrorWireSummary: {
    summary: {
      en: 'Exact-reference presentation override selecting a diagnostic code/message without granting runtime rights.',
      zh: '按精确引用选择诊断错误码及消息的展示覆盖，不赋予运行权限。'
    },
    members: {
      code: {
        summary: {
          en: 'Stable semantic error code retained across serialization; classify it together with source.',
          zh: '序列化跨域保留的稳定语义错误码，应同时检查来源。'
        }
      },
      message: {
        summary: {
          en: 'Diagnostic message preserved with the owning failure; never use it as an authorization decision.',
          zh: '随所属失败保留的诊断消息，不能据此作权限决定。'
        }
      },
      preserveSerializedError: {
        summary: {
          en: 'True preserves this node’s existing serialized descendants rather than selecting a five-field summary.',
          zh: '真值保留该节点已有序列化后代，而非只选择五字段摘要。'
        },
        values: {
          true: {
            en: 'Keep the original serialized descendants in this projection.',
            zh: '在本次投影中保留原序列化后代。'
          }
        }
      }
    }
  },
  IRpcErrorWireMetadata: {
    summary: {
      en: 'Caller-held WeakMap readers choose diagnostic presentation and routes by exact native Error reference.',
      zh: '调用方持有的弱映射读取端，按精确原生错误引用选择诊断展示和路由。'
    },
    members: {
      summaries: {
        summary: {
          en: 'Optional WeakMap get port mapping original Error to IRpcErrorWireSummary; it conveys data only.',
          zh: '可选弱映射读取端，把原错误映射为诊断摘要，只携带数据。'
        }
      },
      routes: {
        summary: {
          en: 'Optional WeakMap get port mapping original Error to bounded node-only route diagnostics.',
          zh: '可选弱映射读取端，把原错误映射为有界纯节点路由诊断。'
        }
      }
    }
  },
  IRpcContractError: {
    summary: {
      en: 'Native Error with stable contract source and semantic code; the runtime class is preserved.',
      zh: '带稳定契约来源和语义错误码的原生错误，保持运行时错误类。'
    },
    members: {
      source: {
        summary: {
          en: 'Stable semantic package source copied from the original error or supplied by the transport context.',
          zh: '从原始错误复制或由载体上下文提供的稳定语义来源。'
        }
      },
      code: {
        summary: {
          en: 'Stable semantic error code retained across serialization; classify it together with source.',
          zh: '序列化跨域保留的稳定语义错误码，应同时检查来源。'
        },
        values: {
          enum: 'RpcContractErrorCode'
        }
      }
    }
  }
}
/** Stable surviving domains retain their original value explanations. */
const enums: Record<string, IEnumDoc> = {
  RpcEnvelopeViolation: {
    summary: {
      en: 'First-envelope failure categories used in coded diagnostics.',
      zh: '信封纯形状检查的首个失败类别，供诊断定位字段问题，不代表执行或会话状态。'
    },
    values: {
      read: {
        en: 'Reading a property failed; retain the original getter cause.',
        zh: '读取属性失败，保留原始读取器原因。'
      },
      type: {
        en: 'The received value has an unsupported native or scalar type.',
        zh: '接收值具有不支持的原生或标量类型。'
      },
      unknownKind: {
        en: 'The envelope discriminator is not a supported semantic kind.',
        zh: '信封判别字段不是受支持的语义种类。'
      },
      required: {
        en: 'A required protocol-owned field is absent or invalid.',
        zh: '协议拥有的必需字段缺失或无效。'
      },
      unknownField: {
        en: 'An extra field is forbidden by the selected closed grammar.',
        zh: '额外字段被所选封闭语法禁止。'
      },
      route: {
        en: 'Routing metadata violates its protocol-owned shape.',
        zh: '路由元数据违反协议拥有的形态。'
      },
      payload: {
        en: 'Application payload cannot be normalized as portable data.',
        zh: '应用载荷无法规范化为可移植数据。'
      },
      error: {
        en: 'Serialized failure data violates the bounded error grammar.',
        zh: '序列化失败数据违反有界错误语法。'
      }
    }
  },
  RpcHandshakeViolation: {
    summary: {
      en: 'First malformed handshake boundary without exposing authentication material.',
      zh: '握手纯准入失败的稳定分类，结合有界路径定位问题，同时避免回显认证材料。'
    },
    values: {
      read: {
        en: 'Reading a property failed; retain the original getter cause.',
        zh: '读取属性失败，保留原始读取器原因。'
      },
      encoding: {
        en: 'Received text bytes are not valid UTF-8 encoding.',
        zh: '接收的文本字节不是有效统一编码。'
      },
      bytes: {
        en: 'Encoded handshake exceeds its admitted byte ceiling.',
        zh: '编码握手超过允许的字节上限。'
      },
      type: {
        en: 'The received value has an unsupported native or scalar type.',
        zh: '接收值具有不支持的原生或标量类型。'
      },
      required: {
        en: 'A required protocol-owned field is absent or invalid.',
        zh: '协议拥有的必需字段缺失或无效。'
      },
      step: {
        en: 'The exchange received a control step in the wrong phase.',
        zh: '交换在错误阶段收到了控制步骤。'
      },
      baseline: {
        en: 'A mandatory protocol, version or codec baseline is missing.',
        zh: '缺少必需协议、版本或编解码基线。'
      },
      duplicate: {
        en: 'An offer repeats a version or capability identity.',
        zh: '提议重复了版本或能力身份标识。'
      },
      mismatch: {
        en: 'The selected agreement was not included in the local offer.',
        zh: '选定协议结果不在本地提议之中。'
      }
    }
  },
  RpcWireLimit: {
    summary: {
      en: 'Admission bounds for untrusted identifiers, offers and durations.',
      zh: '对未可信标识长度、握手提议数量及相对时长设置的准入边界，不替代执行期限所有者。'
    },
    values: {
      maxIdentifierChars: {
        en: 'At most 128 characters in an admitted identifier.',
        zh: '接纳的单个标识最多为 `128` 个字符。'
      },
      maxTraceChars: {
        en: 'At most 256 characters in optional trace metadata.',
        zh: '可选追踪元数据最多为 `256` 个字符。'
      },
      maxIdempotencyKeyChars: {
        en: 'At most 128 characters in one idempotency key.',
        zh: '单个幂等操作键最多为 `128` 个字符。'
      },
      maxDurationMs: {
        en: 'Relative millisecond durations cannot exceed 2147483647.',
        zh: '相对毫秒时长不能超过 `2147483647`。'
      },
      maxHandshakeBytes: {
        en: 'Reject first-channel negotiation exceeding 65536 bytes.',
        zh: '拒绝超过 `65536` 字节的首通道协商。'
      },
      maxVersions: {
        en: 'A handshake offer contains at most eight version proposals.',
        zh: '握手提议最多包含八个版本提案。'
      },
      maxCodecs: {
        en: 'A handshake offer contains at most sixteen codec identities.',
        zh: '握手提议最多包含十六个编解码身份。'
      },
      maxCapabilities: {
        en: 'A handshake offer contains at most sixty-four capability identities.',
        zh: '握手提议最多包含六十四个能力身份。'
      }
    }
  },
  RpcWireErrorUnknownFieldMode: {
    summary: {
      en: 'Received error-node policy for fields added by another peer version.',
      zh: '接收错误节点时处理其他版本新增字段的策略。'
    },
    values: {
      reject: {
        en: 'Reject extra error-node fields with INVALID_WIRE_ERROR.',
        zh: '遇到额外错误节点字段时以编码错误拒绝。'
      },
      ignore: {
        en: 'Ignore unknown fields while optionally invoking the warning callback.',
        zh: '忽略未知字段，同时可调用警告回调。'
      }
    }
  },
  RpcWireErrorLimit: {
    summary: {
      en: 'Shared serializer and validator limits for bounded cross-realm error graphs.',
      zh: '错误树与平面错误图共用的节点、文本和字节预算，保证跨域诊断投影保持有界。'
    },
    values: {
      maxNesting: {
        en: 'At most 48 total structural nesting levels are admitted.',
        zh: '允许的总结构嵌套层数最多为四十八。'
      },
      maxEmbeddingDepth: {
        en: 'At most 16 error embedding levels are admitted.',
        zh: '允许的错误嵌入层数最多为十六。'
      },
      maxNodes: {
        en: 'At most 1024 error nodes cross one wire boundary.',
        zh: '一次线上边界最多传递一千零二十四个错误节点。'
      },
      maxStringBytes: {
        en: 'Each sanitized string has at most 65536 UTF-8 bytes.',
        zh: '每个清理后的字符串最多为六万五千五百三十六字节。'
      },
      maxBytes: {
        en: 'The complete error payload is limited to 1048576 bytes.',
        zh: '完整错误载荷最多为一百零四万八千五百七十六字节。'
      }
    }
  },
  RpcErrorReachLimit: {
    summary: {
      en: 'Bound on visiting original JavaScript error graph objects, separate from wire node limits.',
      zh: '原始脚本错误图访问边界，与线上节点限制分开。'
    },
    values: {
      maxObjects: {
        en: 'Visit at most 4096 original object identities while traversing causes and aggregate entries.',
        zh: '遍历原因和聚合条目时最多访问四千零九十六个原始对象身份。'
      }
    }
  },
  RpcWireErrorFallback: {
    summary: {
      en: 'Stable projection for thrown values without complete semantic error identity.',
      zh: '没有完整语义错误身份的抛出值所用稳定投影。'
    },
    values: {
      source: {
        en: 'Use unknown when the thrown value supplies no semantic package source.',
        zh: '抛出值没有语义包来源时使用未知来源。'
      },
      code: {
        en: 'Use UNKNOWN when the thrown value supplies no semantic code.',
        zh: '抛出值没有语义错误码时使用未知错误码。'
      },
      name: {
        en: 'Use Error when a thrown value has no usable native class name.',
        zh: '抛出值没有可用原生类名时使用通用错误名称。'
      },
      nonErrorMessage: {
        en: 'Use non-error value thrown when an unstructured throw has no readable message.',
        zh: '非结构化抛出值没有可读消息时使用固定诊断文本。'
      }
    }
  },
  RpcWireErrorViolation: {
    summary: {
      en: 'Stable first-failure classifications for serialized error validation.',
      zh: '序列化错误校验的首个失败类别，结合指针定位具体违规字段而不反射原输入。'
    },
    values: {
      read: {
        en: 'Reading a property failed; retain the original getter cause.',
        zh: '读取属性失败，保留原始读取器原因。'
      },
      type: {
        en: 'The received value has an unsupported native or scalar type.',
        zh: '接收值具有不支持的原生或标量类型。'
      },
      required: {
        en: 'A required protocol-owned field is absent or invalid.',
        zh: '协议拥有的必需字段缺失或无效。'
      },
      unknownField: {
        en: 'An extra field is forbidden by the selected closed grammar.',
        zh: '额外字段被所选封闭语法禁止。'
      },
      emptyErrors: {
        en: 'An aggregate child list is present but empty.',
        zh: '聚合子错误列表存在但没有任何条目。'
      },
      truncatedValue: {
        en: 'The truncation marker is not the literal true value.',
        zh: '截断标记不是规定的真值字面量。'
      },
      dataPortable: {
        en: 'Error data cannot be admitted as legacy portable wire data.',
        zh: '错误数据无法作为传统可移植线上数据接纳。'
      },
      depth: {
        en: 'Error nesting or embedding exceeded its fixed depth ceiling.',
        zh: '错误嵌套或嵌入超过固定深度上限。'
      },
      nodes: {
        en: 'The error graph exceeded its admitted node count.',
        zh: '错误图超过允许接纳的节点数量。'
      },
      surrogate: {
        en: 'A wire string contains an unpaired UTF-16 surrogate.',
        zh: '线上字符串含有未配对的代理字符。'
      },
      stringBytes: {
        en: 'One string exceeds its fixed UTF-8 byte ceiling.',
        zh: '单个字符串超过固定编码字节上限。'
      },
      dataBytes: {
        en: 'Portable error data exceeds its admitted byte budget.',
        zh: '可移植错误数据超过允许字节预算。'
      },
      totalBytes: {
        en: 'The complete serialized error exceeds its total byte budget.',
        zh: '完整序列化错误超过总字节预算。'
      },
      jsonRpcShape: {
        en: 'The foreign JSON-RPC error object has invalid shape.',
        zh: '外部调用协议错误对象的形态非法。'
      },
      jsonRpcCode: {
        en: 'The foreign JSON-RPC numeric code is not valid.',
        zh: '外部调用协议数字错误码无效。'
      }
    }
  },
  RpcRuntimeOutcomeState: {
    summary: {
      en: 'Read-only lookup facts never guess whether business execution occurred.',
      zh: '幂等结果查询的只读状态分类，区分待决、未知及已完成，不把缺失结果推断为成功。'
    },
    values: {
      pending: {
        en: 'The original provider store holds a still-pending reservation.',
        zh: '原始提供方存储仍持有待定预留。'
      },
      done: {
        en: 'The original store holds the actual final business outcome.',
        zh: '原始存储持有实际最终业务结果。'
      },
      unknown: {
        en: 'The store has no retained outcome; this does not prove nonexecution.',
        zh: '存储没有保留结果，不能证明从未执行。'
      }
    }
  },
  RpcRuntimeStoreKind: {
    summary: {
      en: 'Original final-provider store owner and its availability.',
      zh: '最终提供方报告的实际存储种类，区分内存、外部与不可用，不由中继猜测保管状态。'
    },
    values: {
      memory: {
        en: 'The provider owns an in-memory idempotency store.',
        zh: '提供方拥有内存中的幂等存储。'
      },
      external: {
        en: 'The provider owns an external idempotency store.',
        zh: '提供方拥有外部持久幂等存储。'
      },
      unavailable: {
        en: 'No original outcome store is available for this lookup.',
        zh: '本次查询没有可用的原始结果存储。'
      }
    }
  },
  RpcRuntimeStoreContinuity: {
    summary: {
      en: 'Continuity is issued by the real store owner, never inferred from key expiry.',
      zh: '连续性由实际存储所有者签发，不由键过期推断。'
    },
    values: {
      retained: {
        en: 'The original store incarnation is still retained.',
        zh: '仍保留原来的存储实例及连续性。'
      },
      lost: {
        en: 'A real store replacement lost continuity since restart.',
        zh: '真实存储替换导致重启后连续性丢失。'
      },
      unavailable: {
        en: 'Store continuity cannot be observed because the store is unavailable.',
        zh: '存储不可用，因此无法观察其连续性。'
      }
    }
  },
  RpcStreamEvent: {
    summary: {
      en: 'Seven protocol stream events; the stream owner checks direction and held sequence.',
      zh: '七种协议流事件，由流所有者检查方向和已有序号。'
    },
    values: {
      open: {
        en: 'Producer opens an admitted stream at sequence zero.',
        zh: '生产方以零序号打开已准入的流。'
      },
      pull: {
        en: 'Consumer grants credit for exactly one next item.',
        zh: '消费方恰好授予下一个条目的额度。'
      },
      item: {
        en: 'Producer sends the one item authorized by held credit.',
        zh: '生产方发送已有额度授权的单个条目。'
      },
      end: {
        en: 'Producer reports normal completion of the stream.',
        zh: '生产方报告流已经正常完成。'
      },
      fail: {
        en: 'Producer reports a serialized terminal failure.',
        zh: '生产方报告序列化的终止失败。'
      },
      cancel: {
        en: 'Consumer requests cancellation with optional failure reason.',
        zh: '消费方携带可选失败原因请求取消。'
      },
      cancelled: {
        en: 'Producer acknowledges actual stream cancellation.',
        zh: '生产方确认流已经实际取消。'
      }
    }
  },
  RpcStreamViolation: {
    summary: {
      en: 'Stable first-failure categories for stream payload and credit checks.',
      zh: '流载荷、顺序及额度纯检查的首个失败类别，实际消费者和生产者仍拥有其运行状态。'
    },
    values: {
      event: {
        en: 'The stream event is unknown or invalid for its mode.',
        zh: '流事件未知或不适用于当前模式。'
      },
      direction: {
        en: 'The event arrived from the wrong producer/consumer direction.',
        zh: '事件来自错误的生产或消费方向。'
      },
      field: {
        en: 'The event carries a field forbidden in its variant.',
        zh: '事件携带当前形式禁止的字段。'
      },
      seq: {
        en: 'The sequence or held pull credit does not match.',
        zh: '序号或持有的拉取额度不匹配。'
      },
      budget: {
        en: 'The stream value exceeds its portable item byte ceiling.',
        zh: '流值超过可移植条目的字节上限。'
      }
    }
  },
  RpcStreamLimit: {
    summary: {
      en: 'Portable item and per-peer stream admission ceilings.',
      zh: '流协议的单项语义字节预算及每对端流数量上限，执行所有者仍负责实际计数与释放。'
    },
    values: {
      maxItemValueBytes: {
        en: 'One portable item value is limited to 16384 counted bytes.',
        zh: '单个可移植条目值最多计量一万六千三百八十四字节。'
      },
      maxOpenStreamsPerPeer: {
        en: 'One peer may retain at most 256 open streams.',
        zh: '单个对端最多保留二百五十六条打开的流。'
      }
    }
  }
}

/** Register one exact public domain and an example importing its canonical entry. */
function domain(
  name: string,
  module: string,
  en: string,
  zh: string,
  values: Record<string, IText>
): void {
  enums[name] = { summary: t(en, zh), values }
  symbols[name] = {
    role: name.endsWith('ErrorCode') ? 'error' : 'constant',
    purpose: t(en, zh),
    example: `import { ${name} } from '@migaia/rpc-contract/${name.endsWith('ErrorCode') ? 'error-code' : module}'\n\nconst values = ${name}`
  }
}
/** Document a pure operation with the source and result of every input. */
function operation(
  name: string,
  en: string,
  zh: string,
  params: Record<string, IText>,
  returns: IText,
  example: string
): void {
  symbols[name] = { role: 'operation', purpose: t(en, zh), params, returns, example }
}
/** Type nodes describe data or borrowed ports, without constructing an executing implementation. */
function dataType(
  name: string,
  en: string,
  zh: string,
  members: Record<string, IMemberDoc>,
  example?: string
): void {
  types[name] = { summary: t(en, zh), members, ...(example ? { example } : {}) }
}

/** A checked semantic message is data; this example never opens a connection. */
const callExample = `import { normalizeRpcFrame, RpcWireProfile } from '@migaia/rpc-contract/protocol'

const frame = normalizeRpcFrame({
  profile: RpcWireProfile,
  kind: 'call',
  id: 'job-1',
  route: {
    applicationVersion: '1', senderId: 'caller', receiverId: 'provider',
    targetId: 'provider', sentAt: 0, trace: 'checkout-1'
  },
  task: {
    mode: 'request', callerId: 'caller', method: 'math.add',
    callerGeneration: { kind: 'session', value: 1, providerId: 'caller' },
    targetGeneration: { kind: 'session', value: 1, providerId: 'provider' }
  },
  options: {},
  payload: [20, 22]
})`
/** The two offer values describe actual implementations; negotiation does not publish a Session. */
const handshakeExample = `import {
  acceptRpcHandshake, completeRpcHandshake, RpcWireProfile,
  type IRpcHello
} from '@migaia/rpc-contract/protocol'

function offer(name: string): IRpcHello {
  return {
    profile: RpcWireProfile, kind: 'handshake', step: 'hello',
    versions: [{ major: 2, minor: 0 }], codecs: ['json'], extensions: [],
    peer: { id: name, runtime: 'node' },
    directory: {
      schemaVersion: 3,
      self: {
        name, instanceId: name,
        generation: { kind: 'session', value: 1, providerId: name }
      },
      methods: []
    }
  }
}
const caller = offer('caller')
const provider = offer('provider')
const accepted = acceptRpcHandshake(caller, provider)
const agreement = completeRpcHandshake(caller, accepted)`
/** Flat wire errors retain graph edges; standalone error-tree helpers remain separate. */
const wireErrorExample = `import {
  serializeRpcWireError, deserializeRpcWireError
} from '@migaia/rpc-contract/protocol'

const cause = new RangeError('sample limit')
const original = new TypeError('sample operation', { cause })
const wire = serializeRpcWireError(original, { report: console.error })
const restored = deserializeRpcWireError(wire)`
/** Reusable field prose names the exact data source rather than granting execution rights. */
const fields: Record<string, IMemberDoc> = {
  profile: p(
    'Fixed `migaia.rpc/2` semantic profile; the sender selects no legacy fallback.',
    '固定为 `migaia.rpc/2` 的语义标识，发送方不能选择旧协议回退。'
  ),
  kind: p(
    'Closed frame discriminator selecting which remaining fields are admitted.',
    '闭合帧种类，用于决定其余字段的接纳规则。'
  ),
  id: p(
    'Correlation id issued by the originating call or control owner and echoed by its terminal.',
    '由发起调用或控制操作的所有者分配的关联标识，终态沿用原值。'
  ),
  route: p(
    'Routing facts supplied by the actual sending owner; forwarding preserves the selected task.',
    '由实际发送所有者提供的路由事实，转发保持原选定任务。'
  ),
  task: p(
    'Original caller, method and selected generation tuple; terminal frames must echo it.',
    '原始调用方、方法及选定代际组合，终态帧必须沿用。'
  ),
  applicationVersion: p(
    'Application-defined nonempty version label for this route, separate from protocol 2.0.',
    '应用提供的非空路由版本标签，与协议版本 `2.0` 分开。'
  ),
  senderId: p(
    'Immediate sending instance address supplied by the accepted source owner.',
    '已准入来源所有者提供的直接发送实例地址。'
  ),
  receiverId: p(
    'Selected immediate receiving instance address; intermediaries cannot infer it from a payload.',
    '选定的直接接收实例地址，中继不能从业务载荷推断。'
  ),
  targetId: p(
    'Original logical target address selected by the caller; forwarding retains this destination.',
    '调用方选定的原始逻辑目标地址，透明转发保持此目的地。'
  ),
  sentAt: p(
    'Sender-supplied nonnegative timestamp; it does not replace the local monotonic deadline clock.',
    '发送方提供的非负时间戳，不能替代本地单调期限时钟。'
  ),
  forwardRoute: p(
    'Bounded ordered Host node ids already traversed; diagnostic data grants no forwarding permission.',
    '已途经的有界有序宿主节点标识，诊断数据不授予转发权限。',
    t('Absent for a direct operation.', '直接操作默认省略。')
  ),
  trace: p(
    'Explicit caller correlation containing 1–256 printable ASCII characters; only this operation and its transparent forwarding inherit it.',
    '调用方显式提供的关联文本，含 `1–256` 个可打印 ASCII 字符，仅当前操作及其透明转发保持此值。',
    t('Absent; no implicit trace is created.', '默认省略，不隐式生成关联文本。')
  ),
  remainingMs: p(
    'Remaining relative deadline budget from the previous owner; forwarding can only reduce it.',
    '上一所有者传入的相对剩余期限预算，转发只能缩短。',
    t('Absent; no inherited deadline.', '默认省略，表示没有继承期限。')
  ),
  callerId: p(
    'Original caller instance id captured at call creation, not the current intermediary.',
    '创建调用时捕获的原始调用实例标识，不是当前中继。'
  ),
  callerGeneration: p(
    'Original caller generation issued by the actual Session or restart owner.',
    '由实际会话或重启所有者签发的原调用方代际。'
  ),
  targetGeneration: p(
    'Exact destination generation chosen for this operation; replacement cannot settle the old operation.',
    '本操作选定的精确目标代际，替代实例不能结算旧操作。'
  ),
  method: p(
    'Declared method name from the accepted provider directory; not an arbitrary Host property path.',
    '已准入提供方目录中的方法名，不是任意宿主属性路径。'
  ),
  providerId: p(
    'Provider instance address issued with the corresponding generation fact.',
    '随对应代际事实签发的提供方实例地址。'
  ),
  options: p(
    'Closed wire options for ordering, cancellation scope and idempotency; no local signal or feature instance.',
    '仅含顺序、取消范围与幂等键的闭合线上选项，不含本地信号或执行特性实例。'
  ),
  payload: p(
    'Optional admitted portable business input; actual undefined is represented by omission.',
    '可选且已接纳的可移植业务输入，实际未定义值通过省略表示。',
    t('Omitted input.', '默认省略输入。')
  ),
  orderKey: p(
    'Caller-selected FIFO key within the real provider owner; no physical queue is created by the type.',
    '调用方在实际提供方所有者内选择的顺序键，此类型不创建物理队列。',
    t('No explicit ordering key.', '默认无显式顺序键。')
  ),
  cancel: p(
    'Only `before-start` limits cancellation to work not yet admitted to business execution.',
    '仅允许 `before-start`，把取消限定为尚未进入业务执行的操作。',
    t('Omitted; normal operation cancellation remains active.', '默认省略，保持正常操作取消语义。')
  ),
  idempotencyKey: p(
    'Origin-issued bounded operation token reused only for the same semantic operation.',
    '发起方签发的有界操作令牌，仅同一语义操作可复用。',
    t('No explicit idempotency token.', '默认不提供幂等令牌。')
  ),
  result: p(
    'Admitted portable business result; an actual undefined result is omitted.',
    '已接纳的可移植业务结果，实际未定义结果省略。',
    t('Omitted for undefined.', '未定义时默认省略。')
  ),
  error: p(
    'Original local failure or admitted flat error graph, as selected by the surrounding contract.',
    '由所在契约确定的原本地失败或已准入平面错误图。'
  ),
  reason: p(
    'Optional original terminal reason, represented as a flat error graph on the wire.',
    '可选原终态原因，在线上使用平面错误图表示。',
    t('No explicit reason.', '默认无显式原因。')
  ),
  completion: p(
    'Actual business terminal including stream cleanup; it is not merely physical write completion.',
    '包含流清理的实际业务终态，不等同于物理写入完成。'
  ),
  source: p(
    'Stable diagnostic source supplied by the originating error owner; not authentication authority.',
    '由原错误所有者提供的稳定诊断来源，不是认证权限。'
  ),
  code: p(
    'Semantic diagnostic code retained independently of presentation text; remote codes grant no local control.',
    '独立于展示文本保留的语义错误码，远端码不授予本地控制权限。'
  ),
  name: p(
    'Owner-issued name used for the surrounding identity or diagnostic shape.',
    '由所有者提供、用于所在身份或诊断形态的名称。'
  ),
  message: p(
    'Bounded error presentation text; do not parse it to authorize retries or resource retirement.',
    '有界错误展示文本，不能解析它来授权重试或资源退场。'
  ),
  stack: p(
    'Original sender stack string; restoration does not substitute a receiving-side stack.',
    '原发送方堆栈文本，恢复时不替换为接收端堆栈。'
  ),
  data: p(
    'Portable diagnostic detail or carrier-owned opaque data, as specified by the enclosing type.',
    '由所在类型规定的可移植诊断详情或载体所有的非透明数据。'
  ),
  truncated: p(
    'Present only as true when the bounded projection omits graph or text content.',
    '仅在有界投影省略图或文本内容时出现，值只能为真。',
    t('Absent when no truncation is marked.', '未标记截断时省略。')
  ),
  namespace: p(
    'Host-local namespace fixed by the installed transport definition, never decoded from payload permissions.',
    '已安装传输定义确定的宿主本地命名空间，不能由载荷权限字段指定。'
  ),
  carrierId: p(
    'Exact local physical carrier id issued at acquisition; equal call ids on other carriers stay isolated.',
    '获取时签发的精确本地物理载体标识，其他载体上的相同调用标识保持隔离。'
  ),
  peerId: p(
    'Accepted direct instance address from the real Session view, distinct from its display name.',
    '真实会话视图中准入的直接实例地址，与显示名称分开。'
  ),
  generation: p(
    'Actual Session or restart generation; copied wire diagnostics cannot create native ownership.',
    '实际会话或重启代际，复制线上诊断不能生成原生所有权。'
  ),
  codec: p(
    'Actual codec selected from the bilateral handshake proposals.',
    '双边握手提议中实际选定的编解码身份。'
  ),
  extensions: p(
    'Actual extension proposals, selected membership or per-operation data, according to the enclosing contract.',
    '按所在契约表示实际扩展提议、选定集合或逐操作扩展数据。'
  ),
  signal: p(
    'Borrowed local cancellation signal; it is never serialized as a protocol option.',
    '借用的本地取消信号，绝不序列化为协议选项。'
  ),
  connectionSignal: p(
    'Actual Session lifetime fence retained even when one batched member removes its own signal.',
    '实际会话生命周期边界，即使某个批成员移除自身信号也保持有效。',
    t(
      'Absent when the surrounding owner does not lend a connection lifetime.',
      '所在所有者未借出连接生命周期时省略。'
    )
  ),
  transfer: p(
    'Explicit original ArrayBuffer identities authorized for the actual physical handoff.',
    '为实际物理交付显式授权的原始缓冲身份。',
    t(
      'No explicit transfer; native support alone grants no permission.',
      '默认无显式转移，原生支持本身不构成授权。'
    )
  ),
  onWriteStart: p(
    'Synchronous notification immediately before actual native handoff, after queues and cancellation admission.',
    '排队和取消接纳之后、真正原生交付之前的同步通知。',
    t('No handoff observer.', '默认无交付观察者。')
  ),
  sendClass: p(
    'Local data/control lane selection supplied before opaque frame transformations.',
    '非透明帧变换之前提供的本地数据或控制通道选择。',
    t('The native owner applies its ordinary data policy.', '由原生所有者采用普通数据策略。')
  ),
  sidecars: p(
    'Ordered original complete backing identities supplied by the same codec; not copied protocol data.',
    '同一编解码器提供的有序原始完整背板身份，不是复制的协议数据。'
  ),
  nodeId: p(
    'Optional accepted Host node id used for loop diagnostics, not a native process identity.',
    '用于环路诊断的可选准入宿主节点标识，不是原生进程身份。',
    t('No node id supplied.', '默认未提供节点标识。')
  ),
  methods: p(
    'Actual compiled method descriptions belonging to this provider or accepted Session.',
    '属于此提供方或已准入会话的实际编译方法描述。'
  ),
  nativeBinary: p(
    'True only for a carrier with genuine native backing support; caller metadata cannot enable it.',
    '仅真实支持原生背板的载体可为真，调用方元数据不能启用它。'
  ),
  maxFrameBytes: p(
    'Actual physical frame ceiling enforced before allocation or handoff by the carrier owner.',
    '由载体所有者在分配或交付前执行的实际物理帧上限。'
  ),
  ready: p(
    'Original Promise fulfilled after bilateral handshake and directory admission; failures reject it.',
    '双边握手及目录准入后兑现的原异步结果，失败时拒绝。'
  ),
  closed: p(
    'Original completion after Session work and its physical receiver subscription are released.',
    '会话工作及其物理接收订阅释放之后的原完成结果。'
  ),
  self: p(
    'Current genuine local identity supplied by the Host or verified native bootstrap owner.',
    '宿主或已验证原生引导所有者提供的当前真实本地身份。'
  ),
  observation: p(
    'Optional actual native observation port; absence must not be advertised as carrier-stage capability.',
    '可选真实原生观察端口，缺省时不能宣称具备载体阶段观察能力。',
    t('No native observation subscription.', '默认无原生观察订阅。')
  ),
  platform: p(
    'Physical platform label supplied by the acquired native medium, never inferred from a payload.',
    '获取的原生介质提供的物理平台标签，不从载荷猜测。'
  ),
  topology: p(
    'Actual exclusive, multiplexed or broadcast selection topology declared by the carrier.',
    '载体声明的实际独占、多路复用或广播选择拓扑。'
  ),
  encodedType: p(
    'Actual native representation label, distinct from the negotiated semantic codec name.',
    '实际原生表示标签，与协商的语义编解码名称分开。'
  ),
  authentication: p(
    'Actual installed protection mode from its auth owner; a descriptor does not authenticate a peer.',
    '认证所有者实际安装的保护模式，描述记录本身不认证对端。'
  ),
  endpointId: p(
    'Actual observing Host instance address; multi-carrier descriptions retain this same identity.',
    '实际观察宿主实例地址，多载体描述仍保持同一身份。'
  ),
  stageMask: p(
    'Bit mask of stages this actual installation can emit; it does not enable absent native observers.',
    '此实际安装可产生事件的阶段位掩码，不会启用缺失的原生观察者。'
  ),
  fastPath: p(
    'Optional fact supplied only by a real selected-path owner; obsolete protocol eligibility is not fabricated.',
    '仅由真实已选路径所有者提供的可选事实，不虚构旧协议资格证明。',
    t('Absent when no selected-path fact exists.', '没有选定路径事实时省略。')
  )
}
/** Reuse a property explanation only when its meaning is the same on these data records. */
function pick(names: readonly string[]): Record<string, IMemberDoc> {
  return Object.fromEntries(names.map((name) => [name, fields[name]!]))
}
/** The local metadata argument borrows exact-reference maps only for this pure operation. */
const metadataParam = t(
  'Optional caller-owned summary/route map ports; omission uses no retained provenance store.',
  '可选调用方持有的摘要与路由映射端口，省略时不使用任何保留的来源状态。'
)
/** A projector owns the single business-value walk and enforces an optional semantic byte budget. */
const projectorParam = t(
  'Optional synchronous IRpcPortableProjector; receives value, metadata and optional maxBytes, returns one admitted portable value or throws. Omission uses the canonical normalizer.',
  '可选同步投影函数，接收值、元数据及可选语义字节上限，返回一个已接纳可移植值或抛错；默认使用规范规范化器。'
)

dataType(
  'IRpcGeneration',
  'Exact generation issued by the native restart or physical Session owner.',
  '原生重启或物理会话所有者签发的精确代际。',
  {
    kind: p(
      'restart identifies a supervisor generation; session identifies a physical Session generation.',
      '`restart` 标识监管重启代际，`session` 标识物理会话代际。'
    ),
    value: p(
      'Nonnegative safe integer ordinal issued by that generation owner.',
      '由该代际所有者签发的非负安全整数序号。'
    ),
    providerId: fields.providerId!
  }
)
dataType(
  'IRpcTask',
  'Caller and selected target tuple echoed by results, errors, cancellation and stream traffic.',
  '由结果、错误、取消与流消息沿用的调用方与选定目标组合。',
  {
    ...pick(['callerId', 'callerGeneration', 'targetGeneration', 'method']),
    mode: p(
      'request, notify, stream, group or outcome selects this operation grammar.',
      '选择请求、通知、流、分组或结果查询的语法，分别使用 `request`、`notify`、`stream`、`group`、`outcome`。'
    )
  },
  callExample
)
dataType(
  'IRpcRoute',
  'One operation route preserves explicit correlation and a nonrefreshing inherited deadline.',
  '保持显式关联和不可重置继承期限的一次操作路由。',
  pick([
    'applicationVersion',
    'senderId',
    'receiverId',
    'targetId',
    'sentAt',
    'forwardRoute',
    'trace',
    'remainingMs'
  ]),
  callExample
)
dataType(
  'IRpcCallOptions',
  'Only portable wire options are sent; local signals, transfer and timeout/retry instances stay local.',
  '仅发送可移植线上选项，本地信号、转移与超时重试实例保留在本地。',
  pick(['orderKey', 'cancel', 'idempotencyKey']),
  `import type { IRpcCallOptions } from '@migaia/rpc-contract/protocol'
const options: IRpcCallOptions = { orderKey: 'cart', cancel: 'before-start', idempotencyKey: 'cart-1' }`
)
dataType(
  'IRpcWireErrorNode',
  'One indexed flat error node keeps sender diagnostics; references preserve shared and cyclic topology.',
  '索引平面错误图的一个节点，保留发送方诊断，并通过引用保持共享和循环拓扑。',
  {
    ...pick(['source', 'code', 'name', 'message', 'stack', 'data', 'truncated']),
    cause: p(
      'Optional zero-based index into this graph nodes array.',
      '指向本图节点数组的可选从零开始索引。'
    ),
    errors: p(
      'Nonempty ordered aggregate child indices into the same nodes array.',
      '指向同一节点数组的非空有序聚合子项索引。'
    ),
    route: p(
      'Optional bounded diagnostic Host node route for this exact error.',
      '此精确错误的可选有界诊断宿主节点路由。'
    )
  },
  wireErrorExample
)
dataType(
  'IRpcWireError',
  'The sole protocol error graph uses a root index and bounded nodes; it is not a nested error tree.',
  '唯一协议错误图由根索引和有界节点构成，不是嵌套错误树。',
  {
    root: p(
      'Valid zero-based selected root index, not necessarily zero.',
      '有效且从零开始的选定根索引，不要求根位于零。'
    ),
    nodes: p(
      'Bounded error nodes whose cause/errors indices must all reference this array.',
      '有界错误节点，所有原因及聚合索引必须指向此数组。'
    )
  },
  wireErrorExample
)
dataType(
  'IRpcStep',
  'One request-only business step in the ordered fail-stop group.',
  '有序遇错停止分组中一个仅请求模式的业务步骤。',
  pick(['method', 'payload'])
)
dataType(
  'IRpcStepOutcome',
  'A group preserves each success, its first failure and the untouched not-executed suffix.',
  '分组保留各成功项、首个失败及其后未执行的后缀。',
  {
    state: p(
      'success, failure or not-executed discriminates the admitted fields.',
      '成功、失败或未执行状态决定可接纳字段，分别为 `success`、`failure` 与 `not-executed`。'
    ),
    ...pick(['result', 'error'])
  }
)
dataType(
  'IRpcCompletion',
  'Stored business terminal for scalar/group operations, separate from physical write completion.',
  '标量或分组操作保存的业务终态，与物理写入完成分开。',
  {
    ok: p(
      'True selects an optional result; false requires the flat error graph.',
      '真值选择可选结果，假值要求平面错误图。'
    ),
    ...pick(['result', 'error'])
  }
)
dataType(
  'IRpcMethodDescription',
  'Accepted directory metadata describes permitted modes and schemas without executing validation.',
  '准入目录元数据描述允许的模式和数据模式，本身不执行校验。',
  {
    name: fields.method!,
    supportedModes: p(
      'Nonempty unique request/notify/stream modes actually offered by this route.',
      '此路由实际提供的非空且不重复请求、通知、流模式集合。'
    ),
    modeSource: p(
      'declared records explicit contract metadata; generated-routes records compiled routes.',
      '`declared` 表示显式契约元数据，`generated-routes` 表示编译的路由。'
    ),
    idempotent: p(
      'Optional request replay declaration; not proof that an optional replay implementation is installed.',
      '可选请求重放声明，不证明已安装可选重放实现。'
    ),
    forwardedVia: p(
      'Optional immediate forwarding connection name supplied by the directory owner.',
      '目录所有者提供的可选直接转发连接名称。'
    ),
    input: p(
      'Optional admitted input schema; actual validation belongs to the schema plugin.',
      '可选已接纳输入数据模式，实际校验属于数据模式插件。'
    ),
    output: p(
      'Optional admitted result schema; no validation runs during directory inspection.',
      '可选已接纳结果数据模式，检查目录时不执行校验。'
    ),
    yield: p('Optional admitted stream element schema.', '可选已接纳流元素数据模式。')
  }
)
dataType(
  'IRpcDirectory',
  'Version-three identity and method directory exchanged by handshake and directory updates.',
  '握手和目录更新交换的第三版身份与方法目录。',
  {
    schemaVersion: p(
      'Exactly 3 for this semantic directory; the local provider declaration has its own version 1.',
      '此语义目录固定为 `3`，本地提供方声明另用版本 `1`。'
    ),
    self: fields.self!,
    methods: p(
      'Up to 4096 unique method descriptions compiled once by the Host.',
      '最多 `4096` 个不重复方法描述，由宿主一次编译。'
    ),
    nodeId: fields.nodeId!
  },
  handshakeExample
)
dataType(
  'IRpcOutcomeStore',
  'Only the actual idempotency store reports its epoch and restart continuity.',
  '只有实际幂等存储报告自身纪元与重启连续性。',
  {
    kind: p(
      'memory/external require epoch and continuity; unavailable cannot claim retained outcomes.',
      '`memory` 或 `external` 要求纪元与连续性，`unavailable` 不能宣称保留结果。'
    ),
    epoch: p(
      'Opaque epoch issued by the actual available store, not a caller-generated generation.',
      '实际可用存储签发的非透明纪元，不是调用方生成的代际。'
    ),
    continuity: p(
      'retained, lost-since-restart or unavailable describes actual store custody.',
      '`retained`、`lost-since-restart` 或 `unavailable` 描述实际存储保管事实。'
    )
  }
)
dataType(
  'IRpcOutcome',
  'An original operation outcome retains its selected target generation and business terminal.',
  '原操作结果保留选定目标代际及业务终态。',
  {
    mode: p(
      'Original non-outcome operation mode; a lookup cannot itself become a retained outcome.',
      '原非查询操作模式，查询本身不能成为保留结果。'
    ),
    ...pick(['targetGeneration', 'completion'])
  }
)
dataType(
  'IRpcOutcomeLookupResult',
  'A lookup distinguishes pending, unknown and done without inferring absence as success.',
  '查询明确区分待决、未知和完成，不把缺失推断为成功。',
  {
    state: p(
      'pending/unknown provide store facts; done additionally requires outcome.',
      '`pending` 或 `unknown` 提供存储事实，`done` 还要求原操作结果。'
    ),
    store: p(
      'Actual store kind, epoch and continuity accompanying this lookup.',
      '随本次查询返回的实际存储种类、纪元与连续性。'
    ),
    outcome: p(
      'Present only for done; retains the original target generation and completion.',
      '仅完成时出现，保留原目标代际和完成结果。'
    )
  }
)
dataType(
  'IRpcStreamEvent',
  'One protocol stream event; sequence, demand and iterator ownership remain in Host.',
  '一个协议流事件，序号、需求和迭代器所有权保留在宿主。',
  {
    event: p(
      'open, pull, item, end, fail, cancelled or finish-without-items; each has a closed field shape.',
      '事件区分打开、拉取、条目、结束、失败、取消完成及无条目完成，使用各自闭合字段形态。'
    ),
    seq: p(
      'Nonnegative safe integer issued by the corresponding stream participant.',
      '由对应流参与方签发的非负安全整数序号。'
    ),
    value: fields.result!,
    error: fields.error!,
    reason: fields.reason!
  }
)
dataType(
  'IRpcEnvelopeCommon',
  'Correlation, route and task shared by operational frames after carrier decoding.',
  '载体解码后各操作帧共享的关联、路由和任务。',
  {
    ...pick(['profile', 'id', 'route', 'task']),
    extensions: p(
      'Optional versioned extension data; actual installed negotiation still decides execution.',
      '可选带版本扩展数据，实际执行仍取决于安装及协商。'
    )
  },
  callExample
)
dataType(
  'IRpcEnvelope',
  'The single closed operational union: call/group/result/error/cancel/stream/outcome.',
  '唯一闭合操作联合，涵盖调用、分组、结果、错误、取消、流及结果查询。',
  {
    ...types.IRpcEnvelopeCommon!.members,
    ...pick(['kind', 'options', 'payload', 'result', 'error', 'reason', 'idempotencyKey']),
    steps: p(
      'Ordered request-only group steps; not physical batching.',
      '有序且仅请求模式的分组步骤，不是物理合帧。'
    ),
    stream: p(
      'One admitted event belonging to the original task.',
      '属于原任务的一条已接纳流事件。'
    ),
    operation: p(
      'For outcome, lookup requests a key and result returns a discriminated store observation.',
      '用于结果查询时，`lookup` 请求幂等键，`result` 返回可区分的存储观察。'
    ),
    state: types.IRpcOutcomeLookupResult!.members.state!,
    store: types.IRpcOutcomeLookupResult!.members.store!,
    outcome: types.IRpcOutcomeLookupResult!.members.outcome!
  },
  callExample
)
dataType(
  'IRpcControlFrame',
  'A lifecycle control has correlation and route but does not invent a provider task.',
  '生命周期控制具有关联与路由，不虚构提供方任务。',
  {
    ...pick(['profile', 'kind', 'id', 'route', 'reason']),
    operation: p(
      'ping, pong or drain selects the actual Host control exchange.',
      '`ping`、`pong` 或 `drain` 选择实际宿主控制交换。'
    )
  }
)
dataType(
  'IRpcDirectoryFrame',
  'Replaces accepted descriptive method metadata without calling a reserved describe method.',
  '替换已准入方法描述元数据，不调用保留的描述方法。',
  {
    ...pick(['profile', 'kind', 'id', 'route']),
    directory: p(
      'Complete admitted version-three directory from this actual source.',
      '来自此实际来源的完整已接纳第三版目录。'
    )
  }
)
dataType(
  'IRpcHello',
  'An actual implementation offer carries original identity, directory and optional auth data.',
  '实际实现的提议携带原身份、目录和可选认证数据。',
  {
    ...pick(['profile', 'kind']),
    step: p(
      'Exactly hello; all versions/codecs/extensions are proposals, not selected authority.',
      '固定为 `hello`，其中版本、编解码与扩展是提议，不是已选权限。'
    ),
    versions: p(
      'Unique offered major/minor revisions; this implementation speaks 2.0.',
      '不重复的主次版本提议，本实现使用 `2.0`。'
    ),
    codecs: p(
      'Ordered unique actual codec ids, including the mandatory json baseline.',
      '有序且不重复的实际编解码身份，含必需的 `json` 基线。'
    ),
    extensions: p(
      'Unique versioned handlers actually installed by the offering implementation.',
      '提议方实际安装的不重复带版本处理器。'
    ),
    requiredExtensions: p(
      'Optional subset whose absence must reject negotiation.',
      '可选必需子集，缺失时必须拒绝协商。'
    ),
    peer: p(
      'Original diagnostic peer identity; not an authenticated principal.',
      '原诊断对端身份，不是已认证主体。'
    ),
    directory: p(
      'Original local schemaVersion 3 identity and methods.',
      '原本地第三版身份和方法目录。'
    ),
    auth: p(
      'Optional portable data supplied by the actual auth owner; pure negotiation does not verify credentials.',
      '实际认证所有者提供的可选可移植数据，纯协商不验证凭证。'
    )
  },
  handshakeExample
)
dataType(
  'IRpcAccept',
  'A selected version/codec/extensions agreement; its same shape also carries the initiator confirmation.',
  '选定版本、编解码及扩展的协议记录，同一形态也承载发起方确认。',
  {
    ...pick(['profile', 'kind']),
    step: p(
      'Exactly accept; does not by itself publish ready.',
      '固定为 `accept`，记录本身不发布就绪。'
    ),
    major: p(
      'Selected shared major revision from the original offer.',
      '从原提议选定的共有主版本。'
    ),
    minor: p('Selected shared minor revision within that major.', '在该主版本内选定的共有次版本。'),
    codec: fields.codec!,
    extensions: p(
      'Exact selected shared extension set, repeated unchanged in confirmation.',
      '精确选定的共有扩展集合，确认时保持不变。'
    ),
    peer: types.IRpcHello!.members.peer!,
    directory: types.IRpcHello!.members.directory!,
    auth: types.IRpcHello!.members.auth!
  },
  handshakeExample
)
dataType(
  'IRpcReject',
  'Handshake rejection carries the same flat diagnostic graph used by operation failures.',
  '握手拒绝携带与操作失败相同的平面诊断图。',
  {
    ...pick(['profile', 'kind', 'error']),
    step: p(
      'Exactly reject; completeRpcHandshake throws the classified rejection with the restored remote cause.',
      '固定为 `reject`，完成协商时抛出带恢复远端原因的分类拒绝。'
    )
  }
)
dataType(
  'IRpcHandshake',
  'The only hello/accept/reject union; native bilateral publication order belongs to Session.',
  '唯一的提议、接纳和拒绝联合，原生双边发布顺序属于会话。',
  {},
  handshakeExample
)
dataType(
  'IRpcSemanticFrame',
  'Handshake, operational, lifecycle-control or directory frame after one canonical decode.',
  '一次规范解码后得到的握手、操作、生命周期控制或目录帧。',
  {},
  callExample
)
dataType(
  'IRpcBinaryManifest',
  'Pure protected binary metadata describes whole backing lengths and digests; it neither hashes nor transfers.',
  '纯受保护二进制元数据描述完整背板长度及摘要，本身不执行哈希或转移。',
  {
    profile: p(
      'Exactly migaia.rpc.portable-binary/1; a binary representation version, not a second RPC protocol.',
      '固定为 `migaia.rpc.portable-binary/1`，是二进制表示版本，不是第二套远程调用协议。'
    ),
    storage: p(
      'inline or native selected by the real carrier; payload flags cannot grant support.',
      '实际载体选择的 `inline` 或 `native`，载荷标志不能授予支持。'
    ),
    envelope: p(
      'The original admitted operational envelope associated with these native leaves.',
      '与这些原生叶子关联的原已接纳操作帧。'
    ),
    backings: p(
      'Ordered complete backing descriptors, each with byteLength and SHA-256 text.',
      '有序完整背板描述，每项含字节长度及摘要文本。'
    )
  }
)
dataType(
  'IRpcPeerInfo',
  'Bounded diagnostic identity from an offer; custom lowercase runtime labels do not grant capabilities.',
  '提议中的有界诊断身份，自定义小写运行环境标签不授予能力。',
  {
    id: p('Peer-issued nonempty diagnostic id.', '对端签发的非空诊断标识。'),
    runtime: p(
      'Bounded lowercase runtime label such as node, python or a valid custom label.',
      '有界小写运行环境标签，例如 `node`、`python` 或合法自定义标签。'
    ),
    runtimeVersion: p(
      'Optional display version; absence is preserved.',
      '可选展示版本，省略状态保持。'
    ),
    implementation: p(
      'Optional implementation name/version display record; not an extension declaration.',
      '可选实现名称与版本展示记录，不是扩展声明。'
    )
  },
  handshakeExample
)
dataType(
  'IRpcHandshakeVersion',
  'One offered positive major and highest supported nonnegative minor revision.',
  '一个提议的正数主版本及其支持的最高非负次版本。',
  { major: types.IRpcAccept!.members.major!, minor: types.IRpcAccept!.members.minor! },
  handshakeExample
)

/** Interface examples borrow real resources from the transport; Contract creates none. */
const carrierExample = `import type { IRpcCarrier } from '@migaia/rpc-contract/interfaces'
export async function releaseCarrier(carrier: IRpcCarrier): Promise<void> {
  await carrier.close()
}`
/** A flow observes admitted traffic without replacing codec or Session ownership. */
const flowExample = `import type { IRpcFlowPluginDefinition } from '@migaia/rpc-contract/interfaces'
export const audit: IRpcFlowPluginDefinition = {
  name: 'audit',
  hooks: {
    handshake(value) { return value },
    envelope: {
      outbound(prepared) { return prepared },
      inbound(prepared) { return prepared }
    },
    frame: {
      async outbound(frame, context, next) { await next(frame, context.write) },
      async inbound(frame, _context, next) { await next(frame) }
    },
    dispatch: { inbound(_context, next) { return next() } },
    observe(event) { console.info(event.kind, event.namespace) }
  }
}`
/** Features are full executing instances; numeric durations are not instances. */
const featureExample =
  "import type { IRpcCallFeatures } from '@migaia/rpc-contract/interfaces'\nimport { timeoutFeature, retryFeature } from '@migaia/rpc-host/features'\nexport const features: IRpcCallFeatures = {\n  timeout: timeoutFeature({ ms: 1000 }), retry: retryFeature({ attempts: 2 })\n}"
/** Local cancellation stays with the borrowing operation. */
const signalParam = t(
  'Borrowed parent or attempt cancellation signal from the actual owner.',
  '实际所有者借出的父级或单次尝试取消信号。'
)
/** A reason is preserved before any separate wire projection. */
const reasonParam = t(
  'Original local reason from the closing or departing owner.',
  '关闭或离开所有者提供的原本地原因。'
)
/** Exact cleanup completion remains owned by the original resource. */
const closeMethod = m(
  'Close the actual resource and borrow its original idempotent completion.',
  '关闭实际资源并借用原幂等完成结果。',
  { reason: reasonParam },
  t(
    'The resource-owned close Promise; cleanup failures retain their original cause/errors chain.',
    '资源所有者的关闭异步结果，清理失败保持原原因或聚合链。'
  ),
  carrierExample
)
/** The native writer determines actual admission and transfer. */
const writeMethod = m(
  'Hand one opaque codec frame to the real ordered physical writer.',
  '把一个非透明编解码帧交给真实有序物理写入方。',
  {
    frame: t(
      'Frame from the same carrier codec or a negotiated frame plugin.',
      '同一载体编解码器或协商帧插件提供的帧。'
    ),
    options: t(
      'Optional local signal, transfer, lane, trace and handoff notification.',
      '可选本地信号、转移、通道、关联及交付通知。'
    )
  },
  t(
    'Completes at physical acceptance, not queue insertion; failures retain their original diagnostic.',
    '物理接纳时完成，而非入队时；失败保留原诊断。'
  ),
  `import type { IRpcCarrier, IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
export async function writeFrame(carrier: IRpcCarrier, frame: IRpcCarrierFrame) {
  await carrier.write(frame)
}`
)
/** Reporting carries diagnostics and cannot authorize business work. */
const reportMethod = m(
  'Report a failure this owner does not rethrow, preserving the original value.',
  '上报此所有者不重新抛出的失败，并保留原值。',
  {
    error: t('Exact caught failure from this operation or cleanup.', '本操作或清理捕获的精确失败。')
  },
  t(
    'Diagnostic delivery completes without settling business work.',
    '完成诊断交付，不结算业务工作。'
  ),
  `import type { IRpcFeatureContext } from '@migaia/rpc-contract/interfaces'
export function reportCleanup(context: IRpcFeatureContext, error: unknown) {
  context.report(error)
}`
)

dataType(
  'IRpcDispose',
  'Cleanup callable returned by the actual installed resource owner; completion may be synchronous or asynchronous.',
  '实际安装资源所有者返回的清理函数，可同步或异步完成。',
  {},
  `import type { IRpcDispose } from '@migaia/rpc-contract/interfaces'
export async function release(dispose: IRpcDispose) { await dispose() }`
)
dataType(
  'IRpcCarrierFrame',
  'Opaque codec message or negotiated extension frame; sidecars retain original backing identities.',
  '非透明编解码消息或协商扩展帧，旁挂背板保留原身份。',
  {
    kind: p(
      'message selects the chosen codec; extension requires an installed negotiated name@version handler.',
      '`message` 选择已选编解码器，`extension` 要求已安装且协商的带版本处理器。'
    ),
    data: fields.data!,
    extension: p(
      'Required only for extension frames and checked against selected membership.',
      '仅扩展帧必需，并按已选扩展集合检查。'
    ),
    sidecars: fields.sidecars!
  },
  carrierExample
)
dataType(
  'IRpcPreparedMessage',
  'Codec-owned prepared metadata is authenticated before original native values are restored.',
  '编解码器持有的预备元数据，原生值恢复前先完成认证。',
  {
    message: p(
      'Prepared or protected metadata, not yet admitted business input.',
      '预备或受保护元数据，尚不是已准入业务输入。'
    ),
    manifest: p(
      'Optional protected binary manifest from this same preparation.',
      '同一次准备生成的可选受保护二进制清单。'
    ),
    sidecars: fields.sidecars!
  }
)
dataType(
  'IRpcCodecContext',
  'One Session supplies negotiated codec, native support, exact transfer and explicit error metadata.',
  '一个会话提供协商编解码、原生支持、精确转移及显式错误元数据。',
  {
    ...pick(['codec', 'nativeBinary', 'maxFrameBytes', 'transfer']),
    errorMetadata: p(metadataParam.en, metadataParam.zh, t('No explicit maps.', '默认无显式映射。'))
  },
  carrierExample
)
/** Codec authors implement these operations around the fixed envelope-hook boundary. */
const codecExample = `import type {
  IRpcCarrierCodec, IRpcCodecContext
} from '@migaia/rpc-contract/interfaces'
import type { IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
export async function encode(
  codec: IRpcCarrierCodec, frame: IRpcSemanticFrame, context: IRpcCodecContext
) {
  const prepared = await codec.prepare(frame, context)
  return codec.encode(prepared, context)
}`
dataType(
  'IRpcCarrierCodec',
  'Executing codec port implemented by a real carrier; Contract declares four operations only.',
  '真实载体实现的执行编解码端口，契约只声明四个操作。',
  {
    prepare: m(
      'Capture binary shape once, preserving business key order and original backings.',
      '一次捕获二进制形态，保持业务键序及原始背板。',
      {
        message: t(
          'Admitted outgoing semantic frame from the Host.',
          '宿主提供的已接纳出站语义帧。'
        ),
        context: t('Actual Session codec context.', '实际会话编解码上下文。')
      },
      t('Prepared message before outbound envelope hooks.', '出站信封钩子之前的预备消息。'),
      codecExample
    ),
    encode: m(
      'Encode prepared metadata after outbound envelope hooks finish.',
      '出站信封钩子完成后编码预备元数据。',
      {
        message: t(
          'Preparation and hooks returned this metadata.',
          '准备操作和钩子返回的此元数据。'
        ),
        context: t(
          'Actual selected codec and local transfer facts.',
          '实际选定的编解码及本地转移事实。'
        )
      },
      t('One opaque frame or its Promise.', '一个非透明帧或其异步结果。'),
      codecExample
    ),
    decode: m(
      'Decode physical representation without exposing unauthenticated native values.',
      '解码物理表示，不暴露尚未认证的原生值。',
      {
        frame: t('Incoming frame from the same physical carrier.', '同一物理载体接收的帧。'),
        context: t('Negotiated context of that carrier.', '该载体的协商上下文。')
      },
      t('Prepared metadata for inbound envelope hooks.', '供入站信封钩子使用的预备元数据。'),
      carrierExample
    ),
    restore: m(
      'Restore admitted native values after inbound envelope hooks accept metadata.',
      '入站信封钩子接纳元数据后恢复已准入原生值。',
      {
        message: t('Prepared metadata accepted by inbound hooks.', '入站钩子已接纳的预备元数据。'),
        context: t('Same actual codec and transfer authority.', '同一实际编解码及转移权限。')
      },
      t(
        'Canonical semantic frame or its Promise; invalid data rejects.',
        '规范语义帧或其异步结果，非法数据拒绝。'
      ),
      carrierExample
    )
  },
  codecExample
)
dataType(
  'IRpcCarrierReceiver',
  'Host receiver attached to an acquired carrier; physical closure is separate from provider failure.',
  '附接到已获取载体的宿主接收方，物理关闭与提供方失败分开。',
  {
    frame: m(
      'Deliver one separated physical frame in carrier order.',
      '按载体顺序交付一个已分界物理帧。',
      {
        frame: t(
          'Actual opaque frame, not raw socket chunks.',
          '实际非透明帧，不是原始套接字分块。'
        )
      },
      t('The Host receives this frame.', '宿主收到此帧。'),
      carrierExample
    ),
    close: m(
      'Notify the Session once of terminal physical closure.',
      '向会话通知一次物理终态关闭。',
      { reason: reasonParam },
      t('The Session observes the original physical reason.', '会话观察原物理原因。'),
      carrierExample
    ),
    error: m(
      'Notify the Session of the original physical IO failure.',
      '向会话通知原物理输入输出失败。',
      { error: reportMethod.params!.error! },
      t('The actual Session observes the failure.', '实际会话观察到失败。'),
      carrierExample
    )
  },
  carrierExample
)
dataType(
  'IRpcCarrierWriteOptions',
  'Local physical authority stays outside serialized frames, including cancellation before handoff.',
  '本地物理权限保留在序列化帧之外，包括交付前取消。',
  pick(['sendClass', 'trace', 'transfer', 'signal', 'onWriteStart']),
  carrierExample
)
dataType(
  'IRpcCarrierObservationFacts',
  'Only an acquired native medium supplies real platform, representation and topology facts.',
  '只有已获取原生介质提供真实平台、表示及拓扑事实。',
  pick(['platform', 'encodedType', 'topology'])
)
dataType(
  'IRpcCarrierObservationEvent',
  'Borrowed raw event remains valid synchronously before transfer detach; an interested observer captures it.',
  '转移分离前同步有效的借用原始事件，由有意观察者捕获。',
  {
    direction: p(
      'Actual native inbound/outbound direction ordinal.',
      '实际原生入站或出站方向序号。'
    ),
    content: p(
      'Original physical reference; no unconditional copy is required.',
      '原物理引用，不要求无条件复制。'
    ),
    sizeBytes: p(
      'Actual byte size, or -1 when unavailable without another traversal.',
      '实际字节数，不另行遍历无法确定时为 `-1`。'
    ),
    transfer: fields.transfer!,
    detail: p(
      'Optional stage-owned scalar diagnostics, never control permissions.',
      '可选阶段所有的标量诊断，绝不是控制权限。'
    )
  }
)
dataType(
  'IRpcCarrierObservation',
  'Readonly native observation is independent from flow intervention and codecs.',
  '只读原生观察独立于信息流介入和编解码。',
  {
    facts: p('Actual cold facts of the acquired medium.', '已获取介质的实际冷事实。'),
    subscribe: m(
      'Borrow raw observations while this subscriber remains installed.',
      '仅订阅者仍安装期间借用原始观察。',
      {
        listener: t(
          'Synchronous listener receives the raw event before transfer detach.',
          '同步监听者在转移分离前接收原始事件。'
        )
      },
      t(
        'Exact subscriber cleanup; no subscriber requires no native capture.',
        '精确订阅清理，无订阅者时不需原生捕获。'
      ),
      carrierExample
    )
  },
  carrierExample
)
dataType(
  'IRpcCarrier',
  'One physical connection owns codec, ordered IO and receiver cleanup; it has no call table.',
  '一个物理连接拥有编解码、有序输入输出及接收清理，不含调用待决表。',
  {
    ...pick(['observation', 'id', 'nativeBinary']),
    codecs: p(
      'Ordered real codec proposals including mandatory json bootstrap.',
      '含必需 `json` 引导基线的有序真实编解码提议。'
    ),
    codec: p(
      'Actual executing codec for this physical carrier.',
      '此物理载体的实际执行编解码对象。'
    ),
    assertTransfer: m(
      'Reject explicit transfer when this acquired medium cannot perform it.',
      '已获取介质不能执行显式转移时拒绝。',
      {},
      t(
        'Normal return proves support, without creating caller permission.',
        '正常返回证明支持，不生成调用方授权。'
      ),
      carrierExample
    ),
    subscribe: m(
      'Install the Host receiver on this actual connection.',
      '在此实际连接上安装宿主接收方。',
      {
        receiver: t(
          'Host-owned frame/close/error callbacks for this binding.',
          '此绑定的宿主帧、关闭及错误回调。'
        )
      },
      t(
        'Exact native listener cleanup owned by this installation.',
        '本次安装拥有的精确原生监听清理。'
      ),
      carrierExample
    ),
    write: writeMethod,
    close: closeMethod
  },
  carrierExample
)

dataType(
  'IRpcSessionView',
  'Accepted readonly identity and precompiled method/extension lookup; mutable Session tables never escape.',
  '准入只读身份及预编译方法、扩展查询，不泄露可变会话表。',
  {
    ...pick(['nodeId', 'namespace', 'peerId', 'generation', 'methods', 'codec', 'extensions']),
    name: p(
      'Accepted display/forwarding name, distinct from instance identity.',
      '准入显示及转发名称，与实例身份分开。'
    )
  }
)
dataType(
  'IRpcSessionHandle',
  'The actual Session lends original ready/closed Promises and its stable close operation.',
  '实际会话借出原就绪、关闭异步结果及稳定关闭操作。',
  { ...pick(['ready', 'closed']), close: closeMethod }
)
dataType(
  'IRpcAttachedSession',
  'Native lookup borrows the original lifecycle handle and its accepted view together.',
  '原生查询同时借用原生命周期句柄及其准入视图。',
  {
    handle: p(
      'Original handle returned by attachment.',
      '真实附接操作返回的原会话句柄，调用方借用其原生命周期完成结果。'
    ),
    view: p(
      'Current accepted identity and methods of that same handle.',
      '同一句柄当前准入身份及方法。'
    )
  }
)
dataType(
  'IRpcPingOptions',
  'The real supervisor supplies health-control cancellation and its bounded local deadline.',
  '真实监管者提供健康控制取消及有界本地期限。',
  {
    timeoutMs: p(
      'Finite nonnegative health deadline or false to leave the supervisor deadline authoritative.',
      '有限非负健康期限，或假值以监管期限为准。',
      t(
        'Omitted; the Host health exchange applies its default.',
        '默认省略，由宿主健康交换采用默认期限。'
      )
    ),
    signal: fields.signal!
  }
)
dataType(
  'IRpcLocalSourceFacts',
  'Trusted native launch facts lend child identity and generation; decoded frames cannot mint these facts.',
  '可信原生启动事实借出子身份及代际，解码帧不能生成这些事实。',
  {
    ...pick(['self', 'generation']),
    expectedPeerId: p(
      'Original expected parent instance id supplied by native bootstrap custody.',
      '原生引导保管提供的原预期父级实例标识。'
    ),
    nativeGeneration: p(
      'Optional actual supervisor observer, never copied wire generation authority.',
      '可选实际监管观察者，绝不是复制的线上代际权限。'
    )
  }
)
/** Native control receives the installed context rather than constructing a fake resource. */
const contextExample = `import type {
  IRpcTransportContext, IRpcSessionHandle
} from '@migaia/rpc-contract/interfaces'
export async function health(context: IRpcTransportContext, handle: IRpcSessionHandle) {
  await context.ping(handle, { timeoutMs: 1000 })
}`
dataType(
  'IRpcTransportContext',
  'Actual native installation borrows explicit Session controls, never a per-session request facade.',
  '实际原生安装借用显式会话控制，不借出逐会话请求门面。',
  {
    ...pick(['namespace', 'signal']),
    self: m(
      'Read current Host identity before acquiring a native child.',
      '获取原生子实例前读取当前宿主身份。',
      {},
      t('Current directory self with its actual generation.', '含实际代际的当前目录自身身份。'),
      contextExample
    ),
    lookup: m(
      'Resolve a name or instance id through the canonical namespace index.',
      '通过规范命名空间索引解析名称或实例标识。',
      {
        address: t(
          'Actual accepted name/instance id, never an OS pid.',
          '实际准入名称或实例标识，不是系统进程号。'
        )
      },
      t(
        'Original handle/view, or undefined without an accepted match.',
        '原句柄及视图，无准入匹配则为未定义。'
      ),
      contextExample
    ),
    attach: m(
      'Attach one acquired carrier to the sole Session owner.',
      '把一个已获取载体附接到唯一会话所有者。',
      {
        carrier: t('Actual carrier with real codec and IO.', '带真实编解码及输入输出的实际载体。'),
        localSourceFacts: t(
          'Optional genuine native bootstrap facts, never copied auth credentials.',
          '可选真实原生引导事实，绝非复制的认证凭证。'
        )
      },
      t(
        'Original Session handle whose ready waits for bilateral admission.',
        '原会话句柄，其就绪等待双边准入。'
      ),
      contextExample
    ),
    openPrivateSession: m(
      'Use the same physical Session owner for an unpublished internal native member.',
      '未发布内部原生成员使用同一物理会话所有者。',
      {
        carrier: t('Acquired actual member carrier.', '已获取的实际成员载体。'),
        facts: t('Optional genuine native launch facts.', '可选真实原生启动事实。'),
        source: t('Original native resource index for this member.', '此成员的原原生资源索引。'),
        changed: t(
          'Optional synchronous accepted-metadata change callback.',
          '可选准入元数据变化同步回调。'
        )
      },
      t(
        'Private handle on the same Session, without another endpoint.',
        '同一会话的内部句柄，不创建另一端点。'
      ),
      contextExample
    ),
    attachOrigin: m(
      'Publish a logical projection after its actual native resources are ready.',
      '实际原生资源就绪后发布逻辑投影。',
      {
        binding: t(
          'Real scheduler and resource binding from this installed native plugin.',
          '此已安装原生插件提供的真实调度及资源绑定。'
        )
      },
      t(
        'Original logical lifecycle handle, updated only by native directory changes.',
        '原逻辑生命周期句柄，仅由原生目录变化更新。'
      ),
      contextExample
    ),
    detach: m(
      'Retire exactly an attached handle without selecting a same-name successor.',
      '精确退场已附接句柄，不选择同名后继。',
      { handle: t('Original returned Session handle.', '原返回会话句柄。'), reason: reasonParam },
      t('That Session original close Promise.', '该会话原关闭异步结果。'),
      contextExample
    ),
    ping: m(
      'Perform the real correlated health control exchange.',
      '执行真实关联健康控制交换。',
      {
        handle: t('Original actual Session handle.', '原实际会话句柄。'),
        options: t(
          'Optional IRpcPingOptions from this supervisor operation.',
          '此监管操作的可选健康控制选项。'
        )
      },
      t(
        'Healthy pong resolves; negative pong, departure or timeout rejects the original coded failure.',
        '健康回应时完成，否定回应、离开或超时以原带码失败拒绝。'
      ),
      contextExample
    ),
    drain: m(
      'Announce and join actual work with the remaining supervisor grace budget.',
      '使用监管剩余宽限预算公告并等待实际工作。',
      {
        handle: t('Exact Session being drained.', '精确排空的会话。'),
        remainingMs: t(
          'Remaining nonnegative grace milliseconds, never a refreshed full deadline.',
          '剩余非负宽限毫秒数，绝不重置完整期限。'
        )
      },
      t(
        'Actual drain completes or rejects with its coded failure.',
        '实际排空完成，或以其带码失败拒绝。'
      ),
      contextExample
    ),
    report: reportMethod
  },
  contextExample
)
dataType(
  'IRpcSessionSelection',
  'Native origin borrows one exact accepted carrier/view and real IO collaborators.',
  '原生来源借用精确准入载体及视图和真实输入输出协作者。',
  {
    carrierId: fields.carrierId!,
    view: types.IRpcAttachedSession!.members.view!,
    source: p(
      'Original target resource index for private member IO.',
      '用于内部成员输入输出的原目标资源索引。'
    ),
    origin: p(
      'Real selection lease retained until complete operation settlement.',
      '保持至完整操作结算的真实选择租约。'
    )
  }
)
dataType(
  'IRpcTargetSource',
  'Transport-owned exact carrier lookup and IO; logical targets do not encode or handshake.',
  '传输拥有的精确载体查询及输入输出，逻辑目标不编码或握手。',
  {
    current: m(
      'Resolve the original carrier id in the native resource index.',
      '在原生资源索引解析原载体标识。',
      { carrierId: t('Original acquired carrier id.', '原获取载体标识。') },
      t(
        'Exact current selection, or undefined after retirement.',
        '精确当前选择，退场后为未定义。'
      ),
      contextExample
    ),
    send: m(
      'Send on the original selected carrier through its actual Session.',
      '通过实际会话在原选定载体发送。',
      {
        carrierId: t('Original selected carrier id.', '原选定载体标识。'),
        frame: t('Admitted semantic frame of the selected task.', '选定任务的已接纳语义帧。'),
        options: writeMethod.params!.options!
      },
      writeMethod.returns!,
      contextExample
    ),
    assertTransfer: m(
      'Check transfer support of the selected native medium.',
      '检查选定原生介质的转移支持。',
      {
        carrierId: t('Original selected carrier id.', '原选定载体标识。'),
        options: t(
          'Optional local operation options with explicit transfer.',
          '含显式转移的可选本地操作选项。'
        )
      },
      t(
        'Returns normally when supported; otherwise throws before handoff.',
        '支持时正常返回，否则在交付前抛错。'
      ),
      contextExample
    ),
    nativeGeneration: m(
      'Borrow the actual supervisor observer, if this carrier has one.',
      '此载体拥有监管者时借用实际监管观察者。',
      { carrierId: t('Original acquired carrier id.', '原获取载体标识。') },
      t(
        'Real observer or undefined for ordinary Sessions; codes grant no authority.',
        '真实观察者，普通会话则为未定义，错误码不授予权限。'
      ),
      contextExample
    ),
    track: m(
      'Track complete business lifetime without replacing its original Promise.',
      '跟踪完整业务生命周期，不替换原异步结果。',
      {
        carrierId: t('Original carrier receiving the work.', '接收工作的原载体。'),
        promise: t('Original business/response completion.', '原业务及回应完成结果。')
      },
      t('The exact same Promise.', '身份相同的原异步结果。'),
      contextExample
    )
  }
)
dataType(
  'IRpcOriginSelection',
  'Actual native scheduler retains its member until original business completion, not merely write.',
  '实际原生调度器保持成员至原业务完成，不只等待写入。',
  {
    run: m(
      'Invoke with one actual selection while retaining its scheduler lease.',
      '保持调度租约时使用实际选择调用。',
      {
        invoke: t(
          'Receives IRpcSessionSelection and returns the complete original operation Promise.',
          '接收实际会话选择，返回原完整操作异步结果。'
        ),
        signal: signalParam
      },
      t(
        'Business result or original failure after releasing the native lease.',
        '释放原生租约后的业务结果或原失败。'
      ),
      contextExample
    )
  }
)
dataType(
  'IRpcPrivateSession',
  'Original physical Session lends private native IO/control without public target publication.',
  '原物理会话借出内部原生输入输出及控制，不发布公共目标。',
  {
    ...types.IRpcSessionHandle!.members,
    carrierId: fields.carrierId!,
    current: m(
      'Read the same Session accepted selection.',
      '读取同一会话的准入选择。',
      {},
      t(
        'Selection or undefined before admission/after retirement.',
        '准入选择，准入前或退场后为未定义。'
      ),
      contextExample
    ),
    send: {
      ...types.IRpcTargetSource!.members.send!,
      params: {
        frame: types.IRpcTargetSource!.members.send!.params!.frame!,
        options: types.IRpcTargetSource!.members.send!.params!.options!
      }
    },
    assertTransfer: {
      ...types.IRpcTargetSource!.members.assertTransfer!,
      params: { options: types.IRpcTargetSource!.members.assertTransfer!.params!.options! }
    },
    ping: {
      ...types.IRpcTransportContext!.members.ping!,
      params: { options: types.IRpcTransportContext!.members.ping!.params!.options! }
    },
    drain: {
      ...types.IRpcTransportContext!.members.drain!,
      params: { remainingMs: types.IRpcTransportContext!.members.drain!.params!.remainingMs! }
    },
    announceDirectory: m(
      'Publish this native member current method directory.',
      '发布此原生成员当前方法目录。',
      {},
      t(
        'Actual directory write completes, without a reserved describe call.',
        '实际目录写入完成，不执行保留描述调用。'
      ),
      contextExample
    ),
    track: {
      ...types.IRpcTargetSource!.members.track!,
      params: { promise: types.IRpcTargetSource!.members.track!.params!.promise! }
    }
  }
)
dataType(
  'IRpcOriginBinding',
  'A logical target lends native metadata and selection, never a second codec or receiver.',
  '逻辑目标借出原生元数据及选择，不创建第二编解码器或接收方。',
  {
    ...pick(['id', 'closed']),
    view: types.IRpcAttachedSession!.members.view!,
    origin: types.IRpcSessionSelection!.members.origin!,
    source: types.IRpcSessionSelection!.members.source!,
    assertTransfer: types.IRpcPrivateSession!.members.assertTransfer!,
    close: closeMethod,
    ping: types.IRpcPrivateSession!.members.ping!,
    drain: types.IRpcPrivateSession!.members.drain!,
    announceDirectory: types.IRpcPrivateSession!.members.announceDirectory!
  }
)
dataType(
  'IRpcOriginHandle',
  'One logical-origin handle updates only its original native directory projection.',
  '一个逻辑来源句柄仅更新其原原生目录投影。',
  {
    ...types.IRpcSessionHandle!.members,
    update: m(
      'Replace the readonly view from genuine native metadata changes.',
      '根据真实原生元数据变化替换只读视图。',
      {
        view: t('Current accepted facts from the native owner.', '原生所有者提供的当前准入事实。')
      },
      t('Projection changes without allocating a physical Session.', '投影改变，不分配物理会话。'),
      contextExample
    )
  }
)

dataType(
  'IRpcFlowContext',
  'Fixed intervention context exposes accepted facts without mutable call/provider/session tables.',
  '固定介入上下文提供准入事实，不暴露可变调用、提供方或会话表。',
  {
    ...pick(['namespace', 'carrierId', 'signal', 'connectionSignal']),
    session: p(
      'Accepted Session view; absent while the handshake is still pending.',
      '准入会话视图，握手尚未完成时省略。'
    ),
    direction: p(
      'Host-selected inbound/outbound direction, never controlled by message data.',
      '宿主选择的入站或出站方向，不由消息数据控制。'
    ),
    write: p(
      'Optional original physical write options retained through frame transforms.',
      '帧变换期间保留的可选原物理写入选项。'
    ),
    report: reportMethod
  },
  flowExample
)
dataType(
  'IRpcFrameWriteOptions',
  'Frame transformations may replace local physical options without putting them on the wire.',
  '帧变换可替换本地物理选项，不把这些选项写入协议。',
  {
    ...pick(['sendClass', 'trace', 'transfer', 'onWriteStart']),
    signal: p(
      'Original local signal, or false to remove one member cancellation while retaining the Session fence.',
      '原本地信号，或假值以移除一个成员的取消，同时保留会话边界。',
      t('The original member signal is inherited.', '默认继承原成员信号。')
    )
  },
  flowExample
)
dataType(
  'IRpcEnvelopeContext',
  'Envelope hooks borrow the actual codec restoration boundary and its cached admission.',
  '信封钩子借用实际编解码恢复边界及其缓存准入。',
  {
    ...types.IRpcFlowContext!.members,
    restore: m(
      'Ask the actual codec to restore prepared data once at its existing admission boundary.',
      '在既有准入边界请求实际编解码器恢复一次预备数据。',
      {
        prepared: t(
          'Original prepared message being checked by this hook.',
          '此钩子正在检查的原预备消息。'
        )
      },
      t(
        'Canonical semantic frame or undefined for a filtered foreign source, synchronously or asynchronously.',
        '同步或异步返回规范语义帧，外来来源被过滤时返回未定义。'
      ),
      flowExample
    )
  },
  flowExample
)
dataType(
  'IRpcFrameNext',
  'Ordered frame continuation retains physical write completion and local options for every emitted frame.',
  '有序帧续体为每个发出帧保持物理写入完成及本地选项。',
  {},
  `import type { IRpcFrameNext, IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
export async function continueFrame(next: IRpcFrameNext, frame: IRpcCarrierFrame) {
  await next(frame)
}`
)
dataType(
  'IRpcDispatchOutcome',
  'Dispatch returns a scalar, a Host-owned stream lifetime, or a quiet admitted-duplicate decision.',
  '分发返回标量、宿主拥有的流生命周期，或静默结束已接纳重复身份的决定。',
  {
    kind: p(
      'value selects an optional portable scalar; stream selects an AsyncIterable; drop executes no provider and sends no terminal.',
      '`value` 选择可选可移植标量，`stream` 选择异步可迭代值；`drop` 不执行提供方，也不发送终态。'
    ),
    value: p(
      'Portable result or actual stream iterable according to kind.',
      '按种类确定的可移植结果或实际流可迭代值。'
    ),
    transfer: fields.transfer!
  }
)
domain(
  'RpcDispatchDrop',
  'interfaces',
  'Frozen local dispatch decision for an admitted duplicate; the existing Host owner completes cleanup without another physical reply.',
  '已接纳重复身份的冻结本地分发决定；既有宿主所有者完成清理，不再发送物理回复。',
  {
    kind: t(
      'drop selects quiet completion; this value is not a wire frame.',
      'drop 选择静默完成；此值不是线上帧。'
    )
  }
)
dataType(
  'IRpcProviderRejection',
  'Frozen local refusal notice shared by execution limits and authentication replay; the reason identifies its actual owner.',
  '执行限制与认证重放共用的冻结本地拒绝通知；原因区分实际拒绝所有者。',
  {
    verifiedPeerKey: p(
      'Actual admitted peer identity used for the refused quota.',
      '拒绝配额使用的实际准入对端身份。'
    ),
    controllerKey: p(
      'Original correlation selected by the refusing owner.',
      '拒绝方所有者选择的原始关联键。'
    ),
    method: p(
      'Original admitted method name or group/outcome kind.',
      '原准入方法名称或分组、结果查询种类。'
    ),
    reason: p(
      'Canonical RpcProviderRejectionReason distinguishing the actual refusal branch.',
      '区分实际拒绝分支的规范 RpcProviderRejectionReason。'
    )
  }
)
dataType(
  'IRpcDispatchContext',
  'Provider completion includes real stream termination and cleanup, so leases cannot end at a mere write.',
  '提供方完成包含真实流终止与清理，租约不能只在写入时结束。',
  {
    ...types.IRpcFlowContext!.members,
    envelope: p(
      'Admitted call/group/outcome from the actual source.',
      '实际来源的已接纳调用、分组或结果查询。'
    ),
    completion: fields.completion!,
    started: m(
      'Read original admitted members started locally or handed downstream.',
      '读取已在本地开始或交给下游的原准入成员数。',
      {},
      t(
        'Count used to refund unused group credit; it does not claim remote execution.',
        '用于退还未使用分组额度的计数，不宣称远端已执行。'
      ),
      flowExample
    )
  },
  flowExample
)
dataType(
  'IRpcObservation',
  'Readonly fact record has no imperative carrier or Session mutation operation.',
  '只读事实记录不含命令式载体或会话变更操作。',
  {
    kind: p(
      'Stable owner-issued event kind, including RpcProbeObservationKind.',
      '稳定的所有者事件种类，包含规范探针事件种类。'
    ),
    ...pick(['namespace', 'peerId', 'carrierId', 'id']),
    data: p(
      'Owner-supplied borrowed event facts; decoded fields grant no execution authority.',
      '所有者提供的借用事件事实，解码字段不授予执行权限。'
    )
  },
  flowExample
)
/** Flow callbacks explicitly describe their one continuation and failure path. */
const hookMembers: Record<string, IMemberDoc> = {
  handshake: m(
    'Transform a hello/accept/reject at the fixed handshake point.',
    '在固定握手点变换提议、接纳或拒绝。',
    {
      value: t('Actual admitted handshake message.', '实际已接纳握手消息。'),
      context: t(
        'Host direction and original connection cancellation context.',
        '宿主方向及原连接取消上下文。'
      )
    },
    t(
      'Handshake or its Promise; rejection aborts this handshake.',
      '握手消息或其异步结果，拒绝会中止本次握手。'
    ),
    flowExample
  ),
  'envelope.outbound': m(
    'Transform prepared metadata after prepare and before encode.',
    '准备之后、编码之前变换预备元数据。',
    {
      value: t('Original codec-prepared metadata.', '原编解码预备元数据。'),
      context: t(
        'Actual envelope context with codec-owned restore.',
        '带编解码所有恢复操作的实际信封上下文。'
      )
    },
    t(
      'Prepared metadata or its Promise; failures reject this send.',
      '预备元数据或其异步结果，失败拒绝本次发送。'
    ),
    flowExample
  ),
  'envelope.inbound': m(
    'Admit protected metadata after decode and before restore.',
    '解码之后、恢复之前接纳受保护元数据。',
    {
      value: t('Actual decoded prepared metadata.', '实际解码得到的预备元数据。'),
      context: t(
        'Original inbound context; undefined restore silently filters a foreign source.',
        '原入站上下文，恢复为未定义时静默过滤外来来源。'
      )
    },
    t(
      'Accepted prepared metadata or its Promise; failure rejects this frame.',
      '已接纳预备元数据或其异步结果，失败拒绝此帧。'
    ),
    flowExample
  ),
  'frame.outbound': m(
    'Emit zero or more transformed frames through the original ordered continuation.',
    '通过原有序续体发出零个或多个变换帧。',
    {
      value: t('Actual encoded carrier frame.', '实际已编码载体帧。'),
      context: t('Original physical options and cancellation context.', '原物理选项及取消上下文。'),
      next: t(
        'Await each emitted frame physical write; preserve surviving member options.',
        '等待各发出帧物理写入，保持存活成员选项。'
      )
    },
    t(
      'Resolves only after every emitted write completes or fails.',
      '仅所有发出写入完成或失败后结算。'
    ),
    flowExample
  ),
  'frame.inbound': m(
    'Deliver complete admitted inner frames through the ordered continuation.',
    '通过有序续体交付完整已接纳内部帧。',
    {
      value: t('Incoming message or negotiated extension frame.', '收到的消息帧或协商扩展帧。'),
      context: t('Actual inbound source and connection lifetime.', '实际入站来源及连接生命周期。'),
      next: t(
        'Invoke once per complete inner frame in original carrier order.',
        '按原载体顺序为各完整内部帧调用一次。'
      )
    },
    t(
      'Completes this input processing; retains no independent RPC Session.',
      '完成此输入处理，不保留独立远程调用会话。'
    ),
    flowExample
  ),
  'dispatch.inbound': m(
    'Reject, replay or surround actual provider execution without owning its terminal.',
    '拒绝、重放或环绕实际提供方执行，不拥有其终态。',
    {
      context: t(
        'Actual operation envelope and full business completion.',
        '实际操作信封及完整业务完成结果。'
      ),
      next: t(
        'Original provider continuation; invoke at most once.',
        '原提供方续体，至多调用一次。'
      )
    },
    t(
      'Original scalar/stream outcome; thrown failures follow the canonical response/report boundary.',
      '原标量或流结果，抛出失败遵循规范回应及上报边界。'
    ),
    flowExample
  ),
  observe: m(
    'Observe synchronously without altering the message flow.',
    '同步观察，不改变消息流。',
    {
      event: t(
        'Original readonly IRpcObservation from the actual owner.',
        '实际所有者提供的原只读观察记录。'
      )
    },
    t(
      'Returns void; observer failures are reported and cannot replace execution.',
      '返回空值，观察者失败会被上报且不能替换执行。'
    ),
    flowExample
  )
}
dataType(
  'IRpcFlowHooks',
  'Only handshake, envelope, frame and dispatch intervene; observe is readonly and registration is cold.',
  '仅握手、信封、帧及分发可以介入，观察只读且注册限于冷阶段。',
  {
    ...hookMembers,
    envelope: p(
      'Optional outbound/inbound prepared-metadata hooks.',
      '可选出站及入站预备元数据钩子。'
    ),
    frame: p(
      'Optional ordered outbound/inbound physical-frame transformations.',
      '可选有序出站及入站物理帧变换。'
    ),
    dispatch: p('Optional actual inbound provider continuation.', '可选实际入站提供方续体。')
  },
  flowExample
)
dataType(
  'IRpcFlowPluginDefinition',
  'A complete cold flow definition has explicit namespace scope and only actual implemented extension proposals.',
  '完整冷信息流定义具有显式命名空间范围，仅提议实际实现的扩展。',
  {
    name: p(
      'Actual native plugin name used for dependency and installation order.',
      '用于依赖及安装顺序的实际原生插件名称。'
    ),
    namespaces: p(
      'Optional installed namespace list; omission covers the Host.',
      '可选已安装命名空间列表，省略时覆盖宿主。',
      t('All Host namespaces.', '默认覆盖宿主全部命名空间。')
    ),
    extensions: p(
      'Versioned frame handlers actually implemented by this plugin.',
      '此插件实际实现的带版本帧处理器。'
    ),
    requiredExtensions: types.IRpcHello!.members.requiredExtensions!,
    hooks: p(
      'Complete behavior at the fixed IRpcFlowHooks points.',
      '固定信息流钩子点的完整行为。'
    ),
    observationFacts: p(
      'Actual installed authentication fact from the owning plugin, never guessed from wire data.',
      '所属插件实际安装的认证事实，不从线上数据猜测。'
    )
  },
  flowExample
)
dataType(
  'IRpcNativeGeneration',
  'Borrow the real native supervisor generation; this contract does not create supervision.',
  '借用真实原生监管代际，此契约不创建监管。',
  {
    current: m(
      'Read the actual native generation and active flag.',
      '读取实际原生代际及活动标志。',
      {},
      t(
        'Current nonnegative generation and its actual availability.',
        '当前非负代际及其实际可用性。'
      ),
      featureExample
    ),
    onLeave: m(
      'Observe departure of exactly the original selected generation.',
      '观察精确原选定代际的离开。',
      {
        generation: t(
          'Ordinal captured from this actual supervisor current result.',
          '从此实际监管者当前结果捕获的序号。'
        ),
        listener: t(
          'Receives original departure reason once that generation leaves.',
          '该代际离开时接收原离开原因。'
        )
      },
      t(
        'Exact listener remover; cancellation must release it.',
        '精确监听移除函数，取消时必须释放。'
      ),
      featureExample
    ),
    whenReady: m(
      'Wait for a real ready generation after the original ordinal.',
      '等待原序号之后的真实就绪代际。',
      {
        afterGeneration: t(
          'Original captured generation, never a caller-invented replacement.',
          '原捕获代际，不是调用方虚构的替代。'
        ),
        signal: signalParam
      },
      t(
        'Actual next ready generation or original cancellation/failure.',
        '实际下一就绪代际或原取消及失败。'
      ),
      featureExample
    )
  }
)
dataType(
  'IRpcAvailableAttempt',
  'One actual accepted physical attempt lends leave/replacement facts without owning them.',
  '一次实际准入物理尝试借出离开及替代事实，不拥有这些事实。',
  {
    carrierId: fields.carrierId!,
    generation: p(
      'Present only for a real native supervisor generation; ordinary Sessions omit it.',
      '仅真实原生监管代际出现，普通会话省略。'
    ),
    onLeave: {
      ...types.IRpcNativeGeneration!.members.onLeave!,
      params: { listener: types.IRpcNativeGeneration!.members.onLeave!.params!.listener! }
    },
    whenReady: m(
      'Wait for the genuine accepted replacement through the existing owner.',
      '通过既有所有者等待真实准入替代。',
      { signal: signalParam },
      t(
        'Next actual IRpcAvailableAttempt; no timer or supervisor is created here.',
        '下一实际可用尝试，此处不创建计时器或监管者。'
      ),
      featureExample
    )
  }
)
dataType(
  'IRpcAttemptAvailability',
  'Origin borrows current actual Session/native availability without another lifecycle registry.',
  '来源借用当前实际会话及原生可用性，不创建另一生命周期注册表。',
  {
    current: m(
      'Read the actual accepted attempt, if one exists.',
      '读取当前存在的实际准入尝试。',
      {},
      t('Genuine attempt or undefined during absence.', '真实尝试，不存在时为未定义。'),
      featureExample
    )
  }
)
dataType(
  'IRpcAttemptFacts',
  'Readonly origin facts come from actual directory and availability admission, never remote error codes.',
  '只读来源事实来自实际目录及可用性准入，不来自远端错误码。',
  {
    method: fields.method!,
    idempotent: p(
      'True only when the original accepted request/group declaration permits replay.',
      '仅原准入请求或分组声明允许重放时为真。'
    ),
    idempotencyKey: fields.idempotencyKey!,
    availability: p(
      'Original actual physical availability port; absence does not authorize synthetic replay.',
      '原实际物理可用性端口，缺失不授权合成重放。'
    )
  }
)
dataType(
  'IRpcAttemptOptions',
  'A strategy supplies exact expected carrier/generation and observes only real native handoff.',
  '策略提供精确预期载体及代际，仅观察真实原生交付。',
  {
    expectedCarrierId: p(
      'Actual original carrier id selected through availability.',
      '通过实际可用性选择的原载体标识。'
    ),
    expectedGeneration: p(
      'Real supervisor ordinal captured before this replay attempt.',
      '本次重放尝试前捕获的真实监管序号。'
    ),
    idempotencyKey: fields.idempotencyKey!,
    onWriteStart: fields.onWriteStart!
  }
)
dataType(
  'IRpcAttempt',
  'Explicit originating execution input; inherited budget can only shorten and transit never executes retry.',
  '显式发起执行输入，继承预算只能缩短，中继不执行重试。',
  {
    ...pick(['signal', 'remainingMs']),
    facts: p(
      'Optional actual origin admission facts, not inferred from diagnostic identities.',
      '可选实际来源准入事实，不从诊断身份推断。'
    ),
    invoke: m(
      'Execute the real attempt with the selected signal and remaining budget.',
      '使用选定信号及剩余预算执行真实尝试。',
      {
        signal: signalParam,
        remainingMs: t(
          'Remaining inherited budget; elapsed time is deducted again by CallTable.',
          '继承剩余预算，调用所有者再次扣除已过时间。'
        ),
        options: t(
          'Optional original IRpcAttemptOptions with real selection/handoff facts.',
          '含真实选择及交付事实的可选原尝试选项。'
        )
      },
      t('Actual attempt result or original coded failure.', '实际尝试结果或原带码失败。'),
      featureExample
    )
  },
  featureExample
)
/** Timeout and retry share only their executing feature signature, not implementation policy. */
const featureRun = m(
  'Run complete owned strategy around the real originating attempt.',
  '围绕真实发起尝试运行完整自有策略。',
  {
    attempt: t(
      'Actual IRpcAttempt from the sole Host feature selector.',
      '唯一宿主特性选择器提供的实际尝试。'
    )
  },
  t(
    'Original operation result or strategy failure after owned timers/listeners are released.',
    '释放自有计时器及监听后的原操作结果或策略失败。'
  ),
  featureExample
)
dataType(
  'IRpcTimeoutFeature',
  'Full per-attempt timeout instance; owns deadline resources and respects shorter inherited budgets.',
  '完整逐尝试超时实例，拥有期限资源并遵守更短继承预算。',
  {
    kind: p(
      'Exactly timeout; complete run behavior is required.',
      '固定为 `timeout`，必须提供完整运行行为。'
    ),
    run: featureRun
  },
  featureExample
)
dataType(
  'IRpcRetryFeature',
  'Full origin retry instance owns attempts/backoff and generation-safe replay, never Session supervision.',
  '完整来源重试实例拥有尝试、退避及代际安全重放，不拥有会话监管。',
  {
    kind: p(
      'Exactly retry; partial configuration is not a feature.',
      '固定为 `retry`，局部配置不是特性。'
    ),
    run: featureRun
  },
  featureExample
)
dataType(
  'IRpcCallFeature',
  'A complete timeout or retry implementation installed on its actual transport or selected for one origin call.',
  '安装在实际传输或为单次来源调用选定的完整超时或重试实现。',
  {},
  featureExample
)
dataType(
  'IRpcCallFeatures',
  'Call override selects a full instance or false; omission inherits transport then link-policy defaults.',
  '调用覆盖选择完整实例或假值，省略时依次继承传输及链路策略默认值。',
  {
    timeout: p(
      'Complete timeout instance or false to disable the inherited instance.',
      '完整超时实例，或假值以禁用继承实例。',
      t('Inherit transport, then link policy.', '默认继承传输，再继承链路策略。')
    ),
    retry: p(
      'Complete origin retry instance or false; notify/outcome do not gain automatic replay.',
      '完整来源重试实例或假值，通知及结果查询不会因此自动重放。',
      t('Inherit transport, then link policy.', '默认继承传输，再继承链路策略。')
    )
  },
  featureExample
)
dataType(
  'IRpcFeatureContext',
  'Non-call features receive only actual owner identity, shutdown and reporting ports.',
  '非调用特性只接收实际所有者身份、关闭及上报端口。',
  {
    owner: p(
      'Definition identity issued by the actual installing plugin.',
      '实际安装插件签发的定义身份。'
    ),
    namespace: fields.namespace!,
    signal: fields.signal!,
    report: reportMethod
  }
)
dataType(
  'IRpcFeatureDefinition',
  'Plugin-owned feature installs complete behavior and returns its exact rollback/shutdown cleanup.',
  '插件拥有的特性安装完整行为，并返回精确回滚及关闭清理。',
  {
    kind: p(
      'Feature identity within its actual plugin owner, not a wire capability grant.',
      '实际所属插件内的特性身份，不是线上能力授权。'
    ),
    install: m(
      'Install into the concrete context supplied by this feature owner.',
      '安装到此特性所有者提供的具体上下文。',
      {
        context: t(
          'Actual owner-supplied generic context, not mutable Host internals.',
          '实际所有者提供的泛型上下文，不是可变宿主内部对象。'
        )
      },
      t(
        'value plus exact dispose, synchronously or asynchronously; failed acquisition must release its resources.',
        '同步或异步返回值及精确清理，获取失败必须释放自身资源。'
      ),
      featureExample
    )
  }
)
dataType(
  'IRpcTransportInstallation',
  'Native install result is the sole namespace extension publication path.',
  '原生安装结果是唯一命名空间扩展发布路径。',
  {
    namespaceExtensions: p(
      'Actual installation extension surface; reserved call methods cannot be overwritten.',
      '实际安装扩展表面，不能覆盖保留调用方法。'
    ),
    dispose: p(
      'Exact acquired resource/listener/member cleanup for rollback and shutdown.',
      '用于回滚及关闭的精确已获取资源、监听及成员清理。'
    )
  }
)
dataType(
  'IRpcTransportDefinition',
  'Cold transport definition owns one unique namespace and its native acquisition, features and cleanup.',
  '冷传输定义拥有唯一命名空间及其原生获取、特性和清理。',
  {
    name: types.IRpcFlowPluginDefinition!.members.name!,
    namespace: fields.namespace!,
    expose: p(
      'Explicit native Feature whitelist for ordinary PluginHosts; RPC Roots use their own provide catalog.',
      '普通插件宿主的显式原生特性白名单，远程调用根使用自身提供目录。'
    ),
    features: p(
      'Complete feature instances owned by this transport installation.',
      '此传输安装拥有的完整特性实例。'
    ),
    handshakeTimeoutMs: p(
      'Actual handshake budget in milliseconds using the existing Session clock.',
      '使用既有会话时钟的实际握手毫秒预算。',
      t('10000 milliseconds.', '默认 `10000` 毫秒。')
    ),
    open: m(
      'Acquire actual carriers during native installation.',
      '在原生安装期间获取实际载体。',
      {
        context: t('Actual transport context supplied by the Host.', '宿主提供的实际传输上下文。')
      },
      t(
        'Native installation extensions and exact dispose, synchronously or asynchronously.',
        '同步或异步返回原生安装扩展及精确清理。'
      ),
      contextExample
    )
  }
)

/** Live views are borrowed; application code copies before retaining them. */
const probeExample = `import type { IRpcProbeEventView } from '@migaia/rpc-contract/interfaces'
export function retainEvent(view: IRpcProbeEventView) {
  return { ...view }
}`
dataType(
  'IRpcProbeEventView',
  'Fixed mutable view reused by the actual emitter; valid only during its synchronous callback.',
  '实际发出方复用的固定可变视图，仅在同步回调期间有效。',
  {
    seq: p('Emitter-local sequence assigned by the real emitter.', '真实发出方分配的本地序号。'),
    carrierSeq: p(
      'Linked inbound physical sequence; -1 means no carrier link.',
      '关联的入站物理序号，`-1` 表示无载体关联。'
    ),
    at: p('Actual observing owner monotonic timestamp.', '实际观察所有者的单调时间戳。'),
    endpointId: fields.endpointId!,
    stage: p(
      'Numeric RpcProbeStage ordinal, not a message kind.',
      '规范探针阶段数字序号，不是消息种类。'
    ),
    direction: p(
      'Numeric outbound, inbound or local direction.',
      '数字表示的出站、入站或本地方向。'
    ),
    kind: p('Numeric RpcProbeKind interaction classification.', '探针交互种类的数字分类。'),
    outcome: p(
      'Numeric RpcProbeOutcome progress or settlement classification.',
      '探针进展或结算结果的数字分类。'
    ),
    messageId: fields.id!,
    method: fields.method!,
    variation: p(
      'Retained diagnostic slot; the single protocol has no variation dispatch API.',
      '保留诊断槽，单一协议不提供变体分发接口。'
    ),
    ...pick(['senderId', 'targetId', 'receiverId', 'peerId', 'trace']),
    sizeBytes: p(
      'Observed size, or -1 when this actual layer cannot determine it.',
      '已观察大小，此实际层无法确定时为 `-1`。'
    ),
    chunkIndex: p(
      'Chunk index only when known; -1 otherwise.',
      '仅已知时填写分片索引，否则为 `-1`。'
    ),
    chunkCount: p(
      'Actual chunk count only when known; -1 otherwise.',
      '仅已知时填写实际分片数，否则为 `-1`。'
    ),
    members: p(
      'Actual batch member count, or -1 for a non-batch event.',
      '实际批成员数，非批事件为 `-1`。'
    ),
    durationMs: p(
      'Actual owner duration at settlement, or -1 before settlement.',
      '结算时实际所有者时长，结算前为 `-1`。'
    ),
    rejection: p(
      'Actual provider refusal reason, never inferred from a shared error code.',
      '实际提供方拒绝原因，不从共用错误码推断。'
    ),
    lifecycle: p(
      'Actual handshake, ready or closing transition when applicable.',
      '适用时填写实际握手、就绪或关闭转换。'
    ),
    error: p(
      'Original local diagnostic reference; retaining a snapshot does not clone it.',
      '原本地诊断引用，保留快照不会复制此引用。'
    ),
    carrier: p(
      'Actual native observer label for this stage, when present.',
      '存在时填写此阶段实际原生观察者标签。'
    ),
    detail: p(
      'Borrowed stage-specific scalar details; follow the actual producer lifetime.',
      '借用的阶段专有标量详情，遵守实际生成方生命周期。'
    ),
    content: p(
      'Present only when selected capture/redaction admits it; mask zero performs no sampling or copy.',
      '仅选定捕获及脱敏接纳时出现，掩码为零时不采样或复制。'
    )
  },
  probeExample
)
dataType(
  'IRpcProbeObservation',
  'Actual owner supplies readonly stage facts; the emitter adds sequence and its local identity.',
  '实际所有者提供只读阶段事实，发出方补充序号及本地身份。',
  {
    ...Object.fromEntries(
      Object.entries(types.IRpcProbeEventView!.members).filter(
        ([name]) => name !== 'seq' && name !== 'endpointId'
      )
    ),
    transfer: fields.transfer!
  },
  probeExample
)
dataType(
  'IRpcProbeDescriptor',
  'Actual source and installed auth facts describe available stages; missing facts are not invented.',
  '实际来源及已安装认证事实描述可用阶段，不虚构缺失事实。',
  {
    ...pick([
      'endpointId',
      'namespace',
      'carrierId',
      'platform',
      'topology',
      'encodedType',
      'authentication',
      'fastPath',
      'stageMask'
    ]),
    carrier: p(
      'Actual available physical observer label, or unavailable when none exists.',
      '实际可用物理观察者标签，缺失时为 `unavailable`。'
    )
  }
)
dataType(
  'IRpcProbeStageName',
  'One configured name from the stable peer/message/envelope/encoded/frame/protected/carrier stage vocabulary.',
  '稳定对端、消息、信封、编码、帧、保护及载体阶段词汇中的一个配置名称。',
  {}
)

/** Advanced declarations and wire directories deliberately use different schema versions. */
const declarationExample = `import { checkRpcProviderDeclaration } from '@migaia/rpc-contract/protocol'
const checked = checkRpcProviderDeclaration({
  schemaVersion: 1, plugin: 'math',
  features: { api: { methods: {
    add: { mode: 'request', idempotent: true, input: { type: 'array' } }
  } } }
})
if (!checked.ok) throw new TypeError(checked.reason)
export const declaration = checked.value`
dataType(
  'IRpcProviderDeclaration',
  'Bounded local advanced declaration is inert data; it is not the schemaVersion-three accepted directory.',
  '有界本地高级声明是惰性数据，不是第三版已准入目录。',
  {
    schemaVersion: p(
      'Exactly 1 for the local advanced declaration.',
      '本地高级提供方声明的结构版本固定为 `1`，不能混作第三版线上目录。'
    ),
    plugin: p(
      'Actual declared plugin segment matching the bounded remote name grammar.',
      '符合有界远端名称语法的实际声明插件段。'
    ),
    features: p(
      'Nonempty feature table whose own entries are bounded and validated.',
      '非空特性表，其自有条目有界并经过校验。'
    )
  },
  declarationExample
)
dataType(
  'IRpcProviderFeatureDeclaration',
  'A declared Feature has a nonempty bounded method whitelist.',
  '声明特性具有非空有界方法白名单。',
  {
    methods: p(
      'Own method-name table of complete IRpcProviderMethodDeclaration values.',
      '由完整方法声明构成的自有方法名称表。'
    )
  },
  declarationExample
)
dataType(
  'IRpcProviderMethodDeclaration',
  'Explicit mode and request replay declaration with optional inert schemas.',
  '显式模式及请求重放声明，可带惰性数据模式。',
  {
    mode: p(
      'request, one-way, generator or async-generator; modes are not inferred from arbitrary methods.',
      '`request`、`one-way`、`generator` 或 `async-generator`，不从任意方法推断模式。'
    ),
    idempotent: p(
      'Required boolean; only request mode can declare replay permission.',
      '必需布尔值，仅请求模式可声明重放权限。'
    ),
    input: types.IRpcMethodDescription!.members.input!,
    output: types.IRpcMethodDescription!.members.output!,
    yield: types.IRpcMethodDescription!.members.yield!
  },
  declarationExample
)
dataType(
  'IRpcMethodSchema',
  'Closed portable JSON Schema subset with local references; no external IO or executable validator.',
  '闭合可移植数据模式子集，引用限于本地，不进行外部输入输出或执行校验器。',
  {
    type: p(
      'One or a nonempty unique union of null/boolean/object/array/number/integer/string.',
      '空值、布尔、对象、数组、数字、整数、字符串之一，或非空不重复联合。'
    ),
    properties: p('Own property-name to child-schema map.', '自有属性名到子数据模式的映射。'),
    required: p(
      'Unique property names required by the application schema.',
      '应用数据模式要求的不重复属性名称。'
    ),
    items: p('One admitted child schema for array elements.', '数组元素的一个已接纳子数据模式。'),
    enum: p(
      'Nonempty distinct portable values under JSON-value equality.',
      '按数据值相等规则判定不重复的非空可移植值集合。'
    ),
    const: p('One admitted portable constant.', '一个已接纳可移植常量。'),
    anyOf: p(
      'Nonempty child-schema alternatives.',
      '非空的子数据模式候选列表，输入满足其中任一模式即可匹配。'
    ),
    $defs: p(
      'Local named definitions only.',
      '当前模式内的命名定义，只允许通过本地引用访问，不读取外部资源。'
    ),
    $ref: p(
      'Inert local reference to an admitted definition; no remote URL resolution.',
      '指向已接纳定义的惰性本地引用，不解析远端网址。'
    )
  },
  declarationExample
)
dataType(
  'IRpcShapeCheck',
  'Discriminated successful snapshot or bounded nonreflecting diagnostic from a pure check.',
  '纯检查返回的可区分成功快照，或有界且不反射输入的诊断。',
  {
    ok: p(
      'True exposes value; false exposes reason/path and optional original cause.',
      '真值提供结果，假值提供原因、路径及可选原原因。'
    ),
    value: p('Frozen admitted result of this exact check.', '本次精确检查的冻结接纳结果。'),
    reason: p(
      'Stable RpcShapeReason, not untrusted input text.',
      '稳定形状原因，不是未可信输入文本。'
    ),
    path: p(
      'Bounded diagnostic path with invalid names replaced by a fixed placeholder.',
      '有界诊断路径，非法名称替换为固定占位文本。'
    ),
    cause: p(
      'Optional original read or portable failure, retained without being serialized automatically.',
      '可选原读取或可移植值失败，保留但不自动序列化。'
    )
  },
  declarationExample
)
dataType(
  'IRpcPortableProjector',
  'Synchronous pure value projection replaces the single payload walk, including an optional semantic byte limit.',
  '同步纯值投影替代唯一载荷遍历，可含语义字节上限。',
  {},
  `import { normalizeRpcPortable } from '@migaia/rpc-contract/portable'
import type { IRpcPortableProjector } from '@migaia/rpc-contract/protocol'
const project: IRpcPortableProjector = (value, metadata) => normalizeRpcPortable(value, metadata)`
)
dataType(
  'IRpcPortableBytes',
  'Wire byte tag uses canonical unpadded base64url for visible bytes, not a raw native backing.',
  '线上字节标签使用可见字节的规范无填充编码，不是原始原生背板。',
  {
    $rpc: p(
      'Exactly bytes; ordinary records cannot reuse the reserved marker.',
      '固定为 `bytes`，普通记录不能复用此保留标记。'
    ),
    base64url: p(
      'Canonical URL-safe unpadded encoding including valid unused bits.',
      '规范的网址安全无填充编码，包含合法未使用位。'
    )
  },
  `import { normalizePortable } from '@migaia/rpc-contract/portable'
const snapshot = normalizePortable(new Uint8Array([1, 2, 3]))`
)
dataType(
  'IRpcPortableRecord',
  'Recursive string-keyed portable record; normalized snapshots are frozen null-prototype objects.',
  '递归字符串键可移植记录，规范快照为冻结空原型对象。',
  {}
)
dataType(
  'IRpcWirePortableValue',
  'Finite scalar, bytes tag, recursive array or record without raw native buffers or views.',
  '有限标量、字节标签、递归数组或记录，不含原始原生缓冲或视图。',
  {}
)
dataType(
  'IRpcPortableValue',
  'Portable domain additionally permits genuine ArrayBuffer/Uint8Array only behind separately negotiated native support.',
  '可移植值域仅在另行协商原生支持后才额外允许真实缓冲及字节视图。',
  {}
)
types.IRpcErrorWireMetadata = {
  summary: t(
    'Explicit caller-owned exact-reference maps carry presentation and route provenance; Contract retains no process store.',
    '显式调用方精确引用映射携带展示及路由来源，契约不保留进程存储。'
  ),
  members: {
    summaries: p(
      'Optional WeakMap get/set port: exact Error to bounded IRpcErrorWireSummary. Factories can write only to this explicit port.',
      '可选弱映射读取及写入端口，把精确错误映射为有界摘要，工厂只能写入此显式端口。',
      t('No summary map.', '默认无摘要映射。')
    ),
    routes: p(
      'Optional WeakMap get/set port: exact Error to diagnostic node route. Data never grants forwarding permission.',
      '可选弱映射读取及写入端口，把精确错误映射为诊断节点路由，数据不授予转发权限。',
      t('No route map.', '默认无路由映射。')
    )
  }
}
types.IRpcErrorWireSummary = {
  summary: t(
    'Presentation selected for one exact original Error, independent of public source/code properties.',
    '针对一个精确原错误选择的展示策略，与公开来源和错误码属性分开。'
  ),
  members: {
    code: fields.code!,
    message: fields.message!,
    preserveSerializedError: p(
      'Only true retains existing serialized descendants instead of the compact five-field summary.',
      '仅真值保留原序列化后代，而不采用紧凑五字段摘要。',
      t('Omitted; use the compact presentation.', '默认省略，使用紧凑展示。')
    )
  }
}

/** Normalizers receive untrusted data, rather than a type assertion or a physical IO object. */
const valueParam = t(
  'Original unknown input at this data boundary; the normalizer validates its closed shape.',
  '此数据边界的原未知输入，规范化器检查其闭合形态。'
)
/** Explicit cause projection belongs to one operation and does not create error authority. */
const causeProjectorParam = t(
  'Optional synchronous original-cause projection; omission retains the original cause. It does not replace the value normalizer.',
  '可选同步原原因投影，省略时保留原原因，不替代值规范化器。'
)
/** One shared description applies only to strict protocol record normalizers. */
const strictReturn = t(
  'Fresh admitted data; accessors, unknown fields and invalid cross-field values throw a Contract-coded native error with original cause.',
  '新接纳数据，访问器、未知字段及非法关联值抛出带原原因的契约编码原生错误。'
)
operation(
  'normalizeRpcFrame',
  'Admit the one migaia.rpc/2 semantic union after decoding; this performs no Session or task admission.',
  '解码后接纳唯一语义协议联合，不执行会话或任务准入。',
  { value: valueParam, metadata: metadataParam, portable: projectorParam },
  strictReturn,
  callExample
)
operation(
  'normalizeRpcRoute',
  'Check closed routing metadata, printable trace and bounded relative budget without extending the deadline.',
  '检查闭合路由元数据、可打印关联文本及有界相对预算，不延长期限。',
  { value: valueParam, metadata: metadataParam },
  strictReturn,
  `import { normalizeRpcRoute } from '@migaia/rpc-contract/protocol'
const route = normalizeRpcRoute({
  applicationVersion: '1', senderId: 'a', receiverId: 'b', targetId: 'b', sentAt: 0
})`
)
operation(
  'normalizeRpcTrace',
  'Require 1–256 printable ASCII characters for explicit operation correlation.',
  '校验显式操作关联文本，只接纳 `1–256` 个可打印 ASCII 字符，省略时不生成追踪值。',
  { value: valueParam, metadata: metadataParam },
  t('The admitted string; no implicit trace is generated.', '已接纳字符串，不隐式生成关联文本。'),
  `import { normalizeRpcTrace } from '@migaia/rpc-contract/protocol'
const trace = normalizeRpcTrace('checkout-1')`
)
operation(
  'normalizeRpcCallOptions',
  'Check orderKey/cancel/idempotencyKey for the actual task mode; local executing options are excluded.',
  '按实际任务模式检查顺序、取消及幂等键，排除本地执行选项。',
  {
    value: valueParam,
    mode: t('Original admitted IRpcTask mode.', '原已接纳任务模式。'),
    metadata: metadataParam
  },
  strictReturn,
  `import { normalizeRpcCallOptions } from '@migaia/rpc-contract/protocol'
const options = normalizeRpcCallOptions({ orderKey: 'cart' }, 'request')`
)
operation(
  'normalizeRpcTask',
  'Check exact caller/target generation tuple and mode-dependent method fields.',
  '检查精确调用及目标代际组合和依赖模式的方法字段。',
  {
    value: valueParam,
    readRecord: t(
      'Optional record-reader integration callback; receives value, required/allowed schema, pointer, metadata and cause projector, returning an admitted own-data record. Ordinary callers omit it for strict admission.',
      '可选记录读取集成回调，接收值、必需及允许字段模式、指针、元数据及原因投影，返回已接纳自有数据记录；普通调用省略，采用严格准入。'
    ),
    metadata: metadataParam
  },
  strictReturn,
  callExample
)
operation(
  'normalizeRpcGeneration',
  'Check a restart/session kind, safe ordinal and original provider id; this does not create a supervisor.',
  '检查重启或会话种类、安全序号及原提供方标识，不创建监管者。',
  { value: valueParam, metadata: metadataParam },
  strictReturn,
  `import { normalizeRpcGeneration } from '@migaia/rpc-contract/protocol'
const generation = normalizeRpcGeneration({ kind: 'session', value: 1, providerId: 'b' })`
)
operation(
  'normalizeRpcSteps',
  'Check a nonempty bounded ordered request-only step list and project each payload once.',
  '检查非空有界有序请求步骤列表，各载荷仅投影一次。',
  { value: valueParam, portable: projectorParam, metadata: metadataParam },
  t(
    'Admitted steps; no provider executes during normalization.',
    '已接纳步骤，规范化期间不执行提供方。'
  ),
  `import { normalizeRpcSteps } from '@migaia/rpc-contract/protocol'
const steps = normalizeRpcSteps([{ method: 'math.add', payload: [20, 22] }])`
)
operation(
  'normalizeRpcPortable',
  'Use the strict negotiated-native portable policy: own data only, preserving genuine native leaf identities.',
  '使用严格协商原生可移植策略，仅接纳自有数据并保留真实原生叶子身份。',
  { value: valueParam, errorMetadata: metadataParam },
  t(
    'Frozen record/array snapshot with original native leaves; this does not grant carrier support or transfer permission.',
    '冻结记录及数组快照，保留原原生叶子，不授予载体支持或转移权限。'
  ),
  `import { normalizeRpcPortable } from '@migaia/rpc-contract/portable'
const native = new Uint8Array([1, 2, 3])
const snapshot = normalizeRpcPortable({ native })`
)
operation(
  'normalizeRpcHandshake',
  'Check the sole hello/accept/reject grammar using strict own-data fields; no getters are executed.',
  '使用严格自有数据字段检查唯一握手语法，不执行访问器。',
  { value: valueParam, metadata: metadataParam },
  strictReturn,
  handshakeExample
)
operation(
  'acceptRpcHandshake',
  'Select only real shared versions, codecs and installed extensions from two admitted offers.',
  '仅从两个已接纳提议选择真实共有版本、编解码及已安装扩展。',
  {
    offer: t(
      'Original remote hello actually received by the responder.',
      '响应方实际收到的原远端提议。'
    ),
    local: t(
      'Actual local hello with its own original identity/directory/auth.',
      '带自身原身份、目录及认证数据的实际本地提议。'
    ),
    metadata: metadataParam
  },
  t(
    'A selected accept record; incompatibility throws. The Host still owns reciprocal confirmation and publication.',
    '选定接纳记录，不兼容时抛错，互确认及发布仍属于宿主。'
  ),
  handshakeExample
)
operation(
  'completeRpcHandshake',
  'Check a received selection against the original initiating offer; a reject restores its remote cause.',
  '根据原发起提议检查收到的选择，拒绝记录会恢复其远端原因。',
  {
    offer: t(
      'The exact initiating hello whose proposals may be selected.',
      '允许被选定的精确原发起提议。'
    ),
    value: t(
      'Actual received accept or reject, not a fabricated ready receipt.',
      '实际收到的接纳或拒绝，不是虚构就绪回执。'
    ),
    metadata: metadataParam
  },
  t(
    'Admitted accept or a native classified handshake failure; does not send confirmation.',
    '已接纳协议或原生分类握手失败，不发送确认。'
  ),
  handshakeExample
)
operation(
  'normalizeRpcDirectory',
  'Check version-three identity and unique bounded method descriptions; schema validation remains plugin-owned.',
  '检查第三版身份及不重复有界方法描述，数据校验仍属于插件。',
  { value: valueParam, metadata: metadataParam, causeProjector: causeProjectorParam },
  strictReturn,
  handshakeExample
)
operation(
  'checkRpcDirectory',
  'Return a frozen successful directory or bounded nonreflecting diagnostic instead of throwing the shape result.',
  '返回冻结成功目录或有界非反射诊断，不把形状结果作为异常抛出。',
  { input: valueParam, metadata: metadataParam },
  t(
    'IRpcShapeCheck with actual original cause when a read/projection fails.',
    '形状检查结果，读取或投影失败时保留实际原原因。'
  ),
  handshakeExample
)
operation(
  'checkRpcProviderDeclaration',
  'Admit one bounded local schemaVersion-one advanced declaration before provider compilation.',
  '在提供方编译前接纳一个有界本地第一版高级声明。',
  { input: valueParam, metadata: metadataParam },
  t(
    'IRpcShapeCheck containing a frozen declaration or first bounded reason/path/cause.',
    '包含冻结声明，或首个有界原因、路径及原原因的形状结果。'
  ),
  declarationExample
)
operation(
  'normalizeMethodSchema',
  'Admit the closed portable schema subset and local references as inert data; no validator is compiled.',
  '把闭合可移植数据模式子集及本地引用接纳为惰性数据，不编译校验器。',
  { input: valueParam, metadata: metadataParam },
  strictReturn,
  `import { normalizeMethodSchema } from '@migaia/rpc-contract/protocol'
const schema = normalizeMethodSchema({ type: 'object', properties: { amount: { type: 'number' } } })`
)
operation(
  'normalizeRpcWireError',
  'Check indexed graph references, native diagnostic fields and aggregate budgets for the sole wire error grammar.',
  '检查唯一线上错误语法的索引图引用、原生诊断字段及累计预算。',
  { value: valueParam, metadata: metadataParam, causeProjector: causeProjectorParam },
  t(
    'Admitted flat root/nodes graph; invalid graph throws INVALID_WIRE_ERROR.',
    '已接纳根及节点平面图，非法图抛出 `INVALID_WIRE_ERROR`。'
  ),
  wireErrorExample
)
operation(
  'serializeRpcWireError',
  'Project the original JavaScript error graph into indexed nodes, preserving sharing/cycles and bounded native diagnostics.',
  '把原本地错误图投影为索引节点，保持共享、循环及有界原生诊断。',
  {
    value: t(
      'Original caught value, including cause and aggregate children.',
      '原捕获值，包含原因及聚合子项。'
    ),
    options: t(
      'Required report sink for omitted unreadable fields/projections; truncation alone need not report.',
      '必需报告端，用于省略的不可读字段及投影，单纯截断不一定报告。'
    ),
    metadata: metadataParam
  },
  t(
    'Bounded IRpcWireError; original errors are not mutated and no process metadata is retained.',
    '有界平面错误图，不修改原错误且不保留进程元数据。'
  ),
  wireErrorExample
)
operation(
  'deserializeRpcWireError',
  'Validate and restore indexed native errors while preserving sender stacks and graph topology.',
  '校验并恢复索引原生错误，保持发送方堆栈及图拓扑。',
  { value: valueParam, metadata: metadataParam },
  t(
    'Restored root Error; cross-realm objects are new identities and carry no local execution authority.',
    '恢复的根错误，跨运行域对象是新身份且不携带本地执行权限。'
  ),
  wireErrorExample
)
operation(
  'normalizeRpcCarrierFrame',
  'Admit a message or an actually negotiated extension outer frame, preserving sidecar references.',
  '接纳消息或实际协商扩展外层帧，保持旁挂背板引用。',
  {
    value: valueParam,
    negotiatedExtensions: t(
      'Actual accepted Session extension membership, supplied by its owner.',
      '实际已准入会话扩展集合，由其所有者提供。'
    ),
    metadata: metadataParam
  },
  strictReturn,
  `import { normalizeRpcCarrierFrame } from '@migaia/rpc-contract/protocol'
const frame = normalizeRpcCarrierFrame({ kind: 'message', data: '{}' }, new Set())`
)
operation(
  'normalizeRpcBinaryManifest',
  'Check pure envelope/backing length-digest metadata; actual digest computation and native transfer stay with the codec.',
  '检查纯信封及背板长度摘要元数据，实际摘要计算和原生转移保留在编解码器。',
  { value: valueParam, metadata: metadataParam, portable: projectorParam },
  strictReturn,
  callExample
)
operation(
  'normalizeRpcStream',
  'Check closed stream event fields and the semantic 16KiB value budget without scheduling pulls.',
  '检查闭合流事件字段及语义 `16KiB` 值预算，不调度拉取。',
  { value: valueParam, metadata: metadataParam, portable: projectorParam },
  strictReturn,
  `import { normalizeRpcStream } from '@migaia/rpc-contract/protocol'
const item = normalizeRpcStream({ event: 'item', seq: 1, value: 'ready' })`
)
operation(
  'normalizeRpcCompletion',
  'Check success/failure completion for its actual task mode, including ordered group results.',
  '按实际任务模式检查成功或失败完成结果，包含有序分组结果。',
  {
    value: valueParam,
    mode: t('Original selected task mode.', '原选定任务模式。'),
    metadata: metadataParam,
    portable: projectorParam
  },
  strictReturn,
  `import { normalizeRpcCompletion } from '@migaia/rpc-contract/protocol'
const completion = normalizeRpcCompletion({ ok: true, result: 42 }, 'request')`
)
operation(
  'normalizeRpcGroupResult',
  'Preserve successful prefix, first error and not-executed suffix in a group terminal.',
  '在分组终态保留成功前缀、首个错误及未执行后缀。',
  { value: valueParam, metadata: metadataParam, portable: projectorParam },
  strictReturn,
  `import { normalizeRpcGroupResult } from '@migaia/rpc-contract/protocol'
const results = normalizeRpcGroupResult([{ state: 'success', result: 42 }])`
)
operation(
  'normalizeRpcOutcome',
  'Check retained original mode/generation/completion without querying or creating a store.',
  '检查保留的原模式、代际和完成结果，不查询或创建存储。',
  { value: valueParam, metadata: metadataParam, portable: projectorParam },
  strictReturn,
  `import { normalizeRpcOutcome } from '@migaia/rpc-contract/protocol'
const outcome = normalizeRpcOutcome({
  mode: 'request', targetGeneration: { kind: 'session', value: 1, providerId: 'b' },
  completion: { ok: true, result: 42 }
})`
)
operation(
  'normalizeRpcOutcomeStore',
  'Check actual store kind/epoch/continuity facts; unknown outcome is not converted to success.',
  '检查实际存储种类、纪元及连续性事实，不把未知结果转换成成功。',
  { value: valueParam, metadata: metadataParam },
  strictReturn,
  `import { normalizeRpcOutcomeStore } from '@migaia/rpc-contract/protocol'
const store = normalizeRpcOutcomeStore({ kind: 'unavailable', continuity: 'unavailable' })`
)
operation(
  'rpcWirePointer',
  'Append one escaped key or index to a diagnostic JSON pointer, without reading a business object.',
  '向诊断指针追加一个已转义键或索引，不读取业务对象。',
  {
    parent: t('Existing pointer, empty at its root.', '已有指针，根为字符串空值。'),
    key: t(
      'Schema-owned key or actual array index to append.',
      '待追加的模式字段键或实际数组索引。'
    )
  },
  t('Pointer with tilde/slash escaped as ~0/~1.', '把波浪号及斜线转义为 `~0`、`~1` 的指针。'),
  `import { rpcWirePointer } from '@migaia/rpc-contract/protocol'
const path = rpcWirePointer('/payload', 'a/b')`
)
operation(
  'measurePortableStreamValue',
  'Measure already admitted values without encoding: numbers charge 24 bytes, native leaves charge actual intrinsic length.',
  '不编码地计量已接纳值，数字计 `24` 字节，原生叶子按实际内在长度计量。',
  {
    value: t(
      'Already normalized portable value, not arbitrary untrusted input.',
      '已规范化可移植值，不是任意未可信输入。'
    )
  },
  t(
    'Semantic accounting bytes; unpaired surrogate text yields Infinity. This does not enforce the limit itself.',
    '语义计额字节数，未配对代理文本返回无穷大，此操作本身不执行限额。'
  ),
  `import { measurePortableStreamValue } from '@migaia/rpc-contract/protocol'
const bytes = measurePortableStreamValue({ amount: 42 })`
)

/** Sequence checks return a violation; they never allocate a second stream or mutate held state. */
const checkReturn = t(
  'undefined when valid; otherwise the original coded stream error for the caller to handle. No stream state is changed.',
  '合法时返回未定义，否则返回由调用方处理的原带码流错误，不改变流状态。'
)
/** Optional pointers identify actual caller diagnostics only. */
const pointerParam = t(
  'Optional diagnostic pointer, default /seq; use /stream/seq for an embedded event.',
  '可选诊断指针，默认 `/seq`，嵌入事件可用 `/stream/seq`。'
)
for (const row of [
  [
    'checkRpcStreamInitialSequence',
    'Require sequence zero for the original open.',
    '检查首次流打开事件的序号必须为零，不分配流状态，也不启动任何拉取操作。',
    '{ seq: 0 }'
  ],
  [
    'checkRpcStreamSequence',
    'Require the actual held sequence; an absent exchange cannot acknowledge cancellation.',
    '要求实际保持的序号，不存在的交换不能确认取消。',
    '{ seq: 1 }, { seq: 1 }'
  ],
  [
    'checkRpcStreamProgress',
    'Permit a terminal to skip discarded items but never move backwards.',
    '检查终态序号不小于当前保持值，允许跳过已丢弃项目，但不允许序号倒退。',
    '{ seq: 2 }, { seq: 1 }'
  ],
  [
    'checkRpcStreamConsumerCredit',
    'Require both matching sequence and actual pending consumer credit.',
    '检查响应序号与调用方保持的序号一致，并确认消费者确有待决拉取额度。',
    '{ seq: 1 }, { seq: 1, pending: true }'
  ],
  [
    'checkRpcStreamProducerCredit',
    'Require matching sequence and a producer that is not already busy.',
    '检查拉取序号与生产方保持的序号一致，且没有另一项正在执行的生产操作。',
    '{ seq: 1 }, { seq: 1, busy: false }'
  ]
] as const) {
  const [name, en, zh, args] = row
  operation(
    name,
    en,
    zh,
    {
      payload: t('Actual admitted event sequence.', '实际已接纳事件序号。'),
      ...(name === 'checkRpcStreamInitialSequence'
        ? {}
        : {
            [name === 'checkRpcStreamSequence' ? 'expected' : 'state']: t(
              'Original caller-held sequence/credit state, read only after its sequence matches.',
              '原调用方保持的序号及额度状态，序号匹配后才读取额度。'
            )
          }),
      pointer: pointerParam
    },
    checkReturn,
    `import { ${name} } from '@migaia/rpc-contract/protocol'\nconst violation = ${name}(${args})`
  )
}
operation(
  'checkRpcRuntimeStreamTransition',
  'Check finish-without-items only against its original before-start call scope.',
  '仅针对原调用的启动前取消范围检查无项目结束事件。',
  {
    control: t(
      'Actual event discriminator received by the stream owner.',
      '流所有者收到的实际事件判别值。'
    ),
    options: t(
      'Original admitted call cancel option, not reconstructed later.',
      '原已接纳调用取消选项，不在事后重建。'
    )
  },
  checkReturn,
  `import { checkRpcRuntimeStreamTransition } from '@migaia/rpc-contract/protocol'
const violation = checkRpcRuntimeStreamTransition(
  { event: 'finish-without-items' }, { cancel: 'before-start' }
)`
)
operation(
  'checkRpcRuntimeStreamIntent',
  'Check the owner-held finish intent using the original call scope; a false intent imposes no finish rule.',
  '使用原调用范围检查所有者保持的结束意图，假意图不触发结束规则。',
  {
    intent: t(
      'Actual optional finish boolean held by the stream owner.',
      '流所有者保持的实际可选结束布尔值。'
    ),
    options: t('Original admitted call cancel option.', '原已接纳调用取消选项。')
  },
  checkReturn,
  `import { checkRpcRuntimeStreamIntent } from '@migaia/rpc-contract/protocol'
const violation = checkRpcRuntimeStreamIntent({ finish: true }, { cancel: 'before-start' })`
)
operation(
  'checkRpcRuntimeStreamFinish',
  'Require before-start scope when a compatible peer has actually received a finish control.',
  '兼容对端实际收到结束控制时要求启动前范围。',
  {
    options: t(
      'Original call options belonging to that exact stream.',
      '属于该精确流的原调用选项。'
    )
  },
  checkReturn,
  `import { checkRpcRuntimeStreamFinish } from '@migaia/rpc-contract/protocol'
const violation = checkRpcRuntimeStreamFinish({ cancel: 'before-start' })`
)
operation(
  'rpcCarrierWriteFacts',
  'Project control/data lane and explicit trace from admitted semantic headers without looking through codec output.',
  '从准入语义头投影控制或数据通道及显式关联，不穿透编解码输出。',
  { value: t('Original admitted semantic frame.', '原已接纳语义帧。') },
  t(
    'Local sendClass and optional trace; this does not write or queue anything.',
    '本地发送通道及可选关联，不执行写入或排队。'
  ),
  callExample +
    `\nimport { rpcCarrierWriteFacts } from '@migaia/rpc-contract/interfaces'\nconst write = rpcCarrierWriteFacts(frame)`
)
operation(
  'rpcProbeEnvelopeFacts',
  'Project compact admitted id, task method and route addresses for readonly observation.',
  '投影紧凑准入标识、任务方法及路由地址，用于只读观察。',
  {
    value: t(
      'Original admitted id/route and optional task, not an untrusted permission object.',
      '原已接纳标识、路由及可选任务，不是未可信权限对象。'
    )
  },
  t(
    'Borrowed message/method/address/trace facts with no observer sequence or local identity authority.',
    '借用消息、方法、地址及关联事实，不含观察序号或本地身份权限。'
  ),
  callExample +
    `\nimport { rpcProbeEnvelopeFacts } from '@migaia/rpc-contract/interfaces'\nconst facts = 'route' in frame ? rpcProbeEnvelopeFacts(frame) : undefined`
)
operation(
  'rpcProbeEnvelopeKind',
  'Map the single operational/control grammar to canonical probe interaction ordinals.',
  '把唯一操作及控制语法映射为规范探针交互序号。',
  {
    value: t(
      'Actual admitted operational envelope or control frame.',
      '实际已接纳操作信封或控制帧。'
    )
  },
  t(
    'RpcProbeKind only; no content traversal or event emission occurs.',
    '仅返回探针交互种类，不遍历内容或发出事件。'
  ),
  callExample +
    `\nimport { rpcProbeEnvelopeKind } from '@migaia/rpc-contract/interfaces'\nconst kind = 'task' in frame ? rpcProbeEnvelopeKind(frame) : undefined`
)
symbols.normalizePortable = {
  ...symbols.normalizePortable!,
  params: { ...symbols.normalizePortable!.params, errorMetadata: metadataParam },
  cases: rpcContractCases.normalizePortable
}
symbols.serializeRpcError = {
  ...symbols.serializeRpcError!,
  cases: rpcContractCases.serializeRpcError
}
for (const name of [
  'serializeRpcError',
  'deserializeRpcError',
  'normalizeRpcSerializedError',
  'reachRpcError'
]) {
  symbols[name] = {
    ...symbols[name]!,
    purpose: t(
      symbols[name]!.purpose.en +
        ' This standalone tree boundary is distinct from the protocol flat graph.',
      symbols[name]!.purpose.zh + '此独立错误树边界与协议平面错误图区分。'
    )
  }
}
operation(
  'createContractError',
  'Construct the canonical native Contract error and write provenance only through supplied explicit metadata.',
  '构造规范原生契约错误，仅通过传入显式元数据记录来源。',
  {
    code: t(
      'Actual scenario from RpcContractErrorCode, not arbitrary text.',
      '契约错误码表中的实际场景，不是任意文本。'
    ),
    cause: reasonParam,
    metadata: metadataParam
  },
  t(
    'RangeError for framing/budget codes, Error for callback/incompatible/rejected, otherwise TypeError; original cause remains reachable.',
    '分帧及预算码使用范围错误，回调、不兼容、拒绝使用普通错误，其余使用类型错误，原原因仍可达。'
  ),
  `import { createContractError } from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
const error = createContractError(RpcContractErrorCode.invalidEnvelope)`
)
operation(
  'identifyContractCallbackFailure',
  'Keep mutable native error identity and complete foreign codes; otherwise retain the original failure on the canonical callback error cause.',
  '保持可修改原生错误身份及完整外部错误码，否则把原失败保留在规范回调错误原因上。',
  { error: t('Original thrown callback value.', '回调原抛出值。'), metadata: metadataParam },
  t(
    'Original tagged Error where possible, or a native callback wrapper retaining original cause and attachment failures.',
    '尽可能返回原附码错误，否则返回保留原原因及附加失败的原生回调包装。'
  ),
  `import { identifyContractCallbackFailure } from '@migaia/rpc-contract/errors'
const original = new RangeError('callback range')
const error = identifyContractCallbackFailure(original)`
)
operation(
  'tagRpcError',
  'Attach endpoint diagnostic source/code to an existing native Error without replacing name, message, stack or object identity.',
  '向既有原生错误附加端点诊断来源及错误码，不替换名称、消息、堆栈或对象身份。',
  {
    error: t(
      'Original native Error that permits semantic property attachment.',
      '允许附加语义属性的原生错误。'
    ),
    code: t('Actual endpoint scenario from RpcCoreErrorCode.', '端点错误码表中的实际场景。')
  },
  t(
    'The same error with diagnostic source/code; this grants no local retry or retirement authority.',
    '附有诊断来源及错误码的同一错误，不授予本地重试或退场权限。'
  ),
  `import { tagRpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
const error = tagRpcError(new TypeError('invalid amount'), RpcCoreErrorCode.invalidConfig)`
)
operation(
  'identifyRpcBoundaryFailure',
  'Preserve an original mutable native error or complete foreign diagnostic identity; wrap only values that cannot retain it.',
  '保持原可修改原生错误或完整外部诊断身份，仅包装不能保留身份的值。',
  {
    error: t('Original value caught by the actual boundary owner.', '实际边界所有者捕获的原值。'),
    code: t(
      'Endpoint scenario selected for an otherwise unclassified native failure.',
      '为尚未分类原生失败选择的端点场景。'
    ),
    message: t(
      'Owner-maintained fallback used only when wrapping is necessary.',
      '仅必须包装时使用的所有者维护回退文本。'
    )
  },
  t(
    'Original error when possible; otherwise RpcError with original cause and secondary attachment failures.',
    '尽可能返回原错误，否则返回保留原原因及次要附加失败的诊断错误。'
  ),
  `import { identifyRpcBoundaryFailure } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
const error = identifyRpcBoundaryFailure('closed', RpcCoreErrorCode.transport, 'Channel closed')`
)
for (const [name, en, zh] of [
  [
    'isRpcError',
    'Recognize a readable string code only; source, known-code and local-authority checks are not implied.',
    '仅识别可读取字符串错误码，不蕴含来源、已知码或本地权限检查。'
  ],
  [
    'isRpcErrorInstance',
    'Recognize endpoint source, a known core code and a supported nonremote family, including restored cross-realm diagnostics.',
    '识别端点来源、已知核心码及支持的非远端错误家族，包含跨运行域恢复诊断。'
  ],
  [
    'isRpcRemoteError',
    'Recognize endpoint-source RpcRemoteError diagnostics with unrestricted remote string codes.',
    '识别端点来源的远端错误诊断，其远端字符串错误码不受核心码域限制。'
  ],
  [
    'isRpcTimeoutError',
    'Recognize endpoint-source TimeoutError with DEADLINE_EXCEEDED; this is diagnostic classification, not retry authority.',
    '识别端点来源且期限超出的超时错误，这是诊断分类，不是重试权限。'
  ]
] as const)
  operation(
    name,
    en,
    zh,
    {
      value: t(
        'Original unknown diagnostic; hostile property getters follow safeRead failure policy.',
        '原未知诊断，恶意属性读取遵循安全读取失败策略。'
      )
    },
    t(
      'Boolean type guard for this documented diagnostic shape only.',
      '仅针对所述诊断形态的布尔类型守卫。'
    ),
    `import { ${name} } from '@migaia/rpc-contract/errors'\nexport function classify(value: unknown) { return ${name}(value) }`
  )
operation(
  'safeRead',
  'Read one property once; an original read trap is synchronously reported or thrown as coded TypeError with original cause.',
  '只读取属性一次，原读取陷阱同步上报，或以带码类型错误和原原因抛出。',
  {
    value: t(
      'Unknown object or callable; nonobjects return undefined.',
      '未知对象或可调用值，非对象返回未定义。'
    ),
    key: t('Actual property key selected by the caller.', '调用方选择的实际属性键。'),
    report: t(
      'Optional synchronous callback receives key and original error, must return undefined. Reporter failure preserves both errors in order.',
      '可选同步回调接收键和原错误，必须返回未定义，报告器失败按序保留两个错误。'
    )
  },
  t(
    'Original property value, or undefined for absent/nonobject/reported failure; otherwise PROPERTY_READ_FAILED.',
    '原属性值，缺失、非对象或已报告失败返回未定义，否则抛出属性读取失败。'
  ),
  `import { safeRead } from '@migaia/rpc-contract/errors'
const code = safeRead<string>({ code: 'DECLINED' }, 'code')`
)
operation(
  'safeString',
  'Convert an untrusted value once; report conversion failure synchronously or throw coded TypeError retaining its cause.',
  '转换未可信值一次，同步报告转换失败或抛出保留原原因的带码类型错误。',
  {
    value: t('Original unknown display value.', '原未知展示值。'),
    fallback: t(
      'Optional fallback after reported conversion failure; default Unknown error.',
      '报告转换失败后的可选回退文本，默认为未知错误文本。'
    ),
    report: t(
      'Optional synchronous callback receives original error and returns undefined; a throw preserves both failures.',
      '可选同步回调接收原错误并返回未定义，抛错时保留两个失败。'
    )
  },
  t(
    'Converted text or configured reported-failure fallback; otherwise STRING_CONVERSION_FAILED.',
    '转换文本或已报告失败的回退文本，否则抛出字符串转换失败。'
  ),
  `import { safeString } from '@migaia/rpc-contract/errors'
const text = safeString(42)`
)
operation(
  'redactRpcHandshakeFailure',
  'Remove raw handshake diagnostic excerpts while preserving supported native error class and safe cause structure.',
  '移除原始握手诊断摘录，同时保持支持的原生错误类型及安全原因结构。',
  {
    cause: t(
      'Original handshake parser failure selected by its actual owner.',
      '实际所有者选定的原握手解析失败。'
    )
  },
  t(
    'Original safe value or redacted diagnostic projection; no authentication is performed.',
    '原安全值或脱敏诊断投影，不执行认证。'
  ),
  `import { redactRpcHandshakeFailure } from '@migaia/rpc-contract/errors'
export function redact(error: unknown) { return redactRpcHandshakeFailure(error) }`
)
operation(
  'isRpcHandshakeExcerptFree',
  'Check whether a diagnostic message omits a raw JSON handshake excerpt.',
  '检查诊断文本是否避免回显原始握手摘录，用于阻止认证材料进入错误展示。',
  {
    message: t('Actual diagnostic message to check.', '实际待检查诊断消息。'),
    json: t(
      'Actual original handshake JSON, retained only by its caller.',
      '实际原握手数据文本，仅由调用方保管。'
    )
  },
  t(
    'True when no protected excerpt is recognized; this does not validate credentials.',
    '未识别到受保护摘录时为真，不验证凭证。'
  ),
  `import { isRpcHandshakeExcerptFree } from '@migaia/rpc-contract/errors'
const safe = isRpcHandshakeExcerptFree('Handshake invalid', '{"auth":"fixture"}')`
)

operation(
  'roleAdmissionMessage',
  'Format the canonical diagnostic for an unsupported component role and slot.',
  '为不受支持的组件角色及安装位置生成诊断文本，不执行安装或授予组件权限。',
  {
    role: t('Actual role label selected by the admission owner.', '准入所有者选择的实际角色标签。'),
    slot: t('Actual target slot selected before installation.', '安装前选定的实际目标位置。'),
    key: t('Optional conflicting native property key.', '可选冲突原生属性键。')
  },
  t(
    'Stable display text; formatting never installs or authorizes a component.',
    '稳定展示文本，格式化不安装或授权组件。'
  ),
  `import { roleAdmissionMessage } from '@migaia/rpc-contract/errors'
const message = roleAdmissionMessage('transport', 'namespace', 'memory')`
)
operation(
  'captureRpcWirePortableRecord',
  'Shallowly snapshot parent enumerable string-key values before descendants, preserving getter order. Arrays defer to the walker.',
  '先于后代浅快照父级可枚举字符串键值，保持访问器顺序，数组交给遍历器。',
  {
    value: t(
      'Original ordinary/null-prototype object being visited by the existing walker.',
      '既有遍历器正在访问的原普通或空原型对象。'
    ),
    context: t(
      'Borrowed reject(reason,cause) and isCanonicalBase64url(text) callbacks from the same traversal; neither creates another walk.',
      '同一遍历借出的拒绝及规范编码谓词回调，不创建另一遍历。'
    )
  },
  t(
    'Captured entries and output/tag descriptor, or undefined for arrays; errors retain original getter/reflection causes.',
    '捕获条目及输出或标签描述，数组返回未定义，错误保留原访问器及反射原因。'
  ),
  `import {
  captureRpcWirePortableRecord, raiseRpcPortableViolation
} from '@migaia/rpc-contract/portable'
import { isCanonicalBase64url } from '@migaia/serialize/core'
const captured = captureRpcWirePortableRecord({ amount: 42 }, {
  reject: raiseRpcPortableViolation, isCanonicalBase64url
})`
)
operation(
  'assertRpcPortableRecordKey',
  'Reserve $rpc for complete admitted bytes tags rather than ordinary records.',
  '为完整已接纳字节标签保留 `$rpc`，普通记录不能使用。',
  {
    key: t(
      'Actual captured string key from the existing traversal.',
      '既有遍历捕获的实际字符串键。'
    ),
    context: t('The same traversal reject(reason,cause) callback.', '同一遍历的拒绝回调。')
  },
  t(
    'Returns void for ordinary keys; the reserved marker invokes the original reject port.',
    '普通键正常返回空值，保留标记调用原拒绝端口。'
  ),
  `import { assertRpcPortableRecordKey, raiseRpcPortableViolation } from '@migaia/rpc-contract/portable'
assertRpcPortableRecordKey('amount', { reject: raiseRpcPortableViolation })`
)
operation(
  'raiseRpcPortableViolation',
  'Route the existing portable policy violation while preserving raw binary/ancestor failures and canonical Contract causes.',
  '路由既有可移植策略违规，同时保持原二进制及祖先失败和规范契约原因。',
  {
    reason: t(
      'Actual RpcPortableViolation selected by the canonical walker policy.',
      '规范遍历策略选定的实际违规原因。'
    ),
    cause: reasonParam,
    errorMetadata: metadataParam
  },
  t(
    'Never returns: throws the original eligible cause or canonical INVALID_ENVELOPE with original cause.',
    '不会返回，抛出符合条件的原原因，或含原原因的规范信封错误。'
  ),
  `import { raiseRpcPortableViolation, RpcPortableViolation } from '@migaia/rpc-contract/portable'
export function rejectValue(cause: unknown): never {
  return raiseRpcPortableViolation(RpcPortableViolation.invalid, cause)
}`
)
for (const [name, type, en, zh] of [
  [
    'rpcPortableBackingLength',
    'ArrayBuffer',
    'Read intrinsic complete backing byteLength without trusting a public property.',
    '通过原生内在读取完整背板字节长度，不信任对象上可伪造的长度属性或执行内容遍历。'
  ],
  [
    'rpcPortableViewLength',
    'Uint8Array',
    'Read intrinsic visible Uint8Array byteLength without traversing its contents.',
    '通过原生内在读取视图可见字节长度，不遍历内容，也不改成完整背板长度。'
  ]
] as const)
  operation(
    name,
    en,
    zh,
    {
      value: t(
        `Actual genuine ${type} supplied by the current value owner.`,
        `当前值所有者提供的真实 ${type}。`
      )
    },
    t(
      'Intrinsic byte length; unsupported native values keep their native failure.',
      '内在字节长度，不支持的原生值保持原生失败。'
    ),
    `import { ${name} } from '@migaia/rpc-contract/portable'\nconst length = ${name}(new ${type}(8))`
  )
for (const [name, en, zh] of [
  [
    'rpcWirePortableStrategy',
    'Pure serialize-walker policy for finite scalars, parent-before-child getter capture, frozen snapshots and inline bytes tags.',
    '供序列化遍历器使用的纯策略，负责有限标量、父先子后访问器捕获、冻结快照及内联字节标签。'
  ],
  [
    'rpcNativePortableStrategy',
    'Pure strict own-data policy preserving genuine native leaves; negotiated support and transfer still belong to the carrier.',
    '纯严格自有数据策略，保留真实原生叶子，协商支持及转移仍属于载体。'
  ]
] as const)
  symbols[name] = {
    role: 'constant',
    purpose: t(en, zh),
    example: `import { createPortableWalker } from '@migaia/serialize'\nimport { ${name} } from '@migaia/rpc-contract/portable'\nconst walker = createPortableWalker(${name})\nconst value = walker.value({ amount: 42 })`
  }

dataType(
  'IRpcError',
  'Structural endpoint error diagnostics; copied source/code properties do not prove local execution ownership.',
  '结构端点错误诊断，复制来源及错误码属性不能证明本地执行所有权。',
  {
    source: fields.source!,
    code: fields.code!,
    cause: p(
      'Optional exact original local failure.',
      '可选原本地失败引用，保持精确对象身份并保留原原因链。'
    )
  }
)
dataType(
  'IRpcCleanupError',
  'One actual release failure keeps its resource label and exact original thrown value.',
  '一个实际释放失败保留资源标签及精确原抛出值。',
  {
    resource: p(
      'Label issued by the actual acquired resource owner.',
      '实际已获取资源所有者签发的标签。'
    ),
    error: p(
      'Exact original failure; it must not replace the construction primary.',
      '精确原失败，不能替换构造主错误。'
    )
  }
)
dataType(
  'IRpcPropertyReadReporter',
  'Synchronous guarded-property diagnostic callback receives key and original error and must return undefined.',
  '同步受控属性诊断回调接收键及原错误，必须返回未定义。',
  {},
  `import { safeRead } from '@migaia/rpc-contract/errors'
const value = safeRead({}, 'missing', ({ key, error }) => {
  console.error(key, error)
  return undefined
})`
)
/** Each public class is a real diagnostic constructor, never a factory for control provenance. */
const errorClasses = [
  [
    'RpcError',
    'Endpoint base diagnostic with explicit core code and original cause.',
    '具有显式核心错误码及原原因的端点基础诊断。',
    'Accept a registered core code, diagnostic message and optional cause to initialize the endpoint source and base error family.',
    '接收已登记核心错误码、诊断文本及可选原因，初始化端点来源与基础错误家族。'
  ],
  [
    'RpcSchemaValidationError',
    'Schema failure preserves validation detail and original cause.',
    '数据模式失败保留校验详情及原原因。',
    'Record validation data and an optional cause with SCHEMA_INVALID on the native schema-error subclass.',
    '在原生模式错误子类中记录校验数据及可选原因，使用模式非法语义错误码。'
  ],
  [
    'RpcConfigurationError',
    'Invalid configuration diagnostic preserves its original cause.',
    '非法配置诊断保留原原因。',
    'Initialize INVALID_CONFIG from the supplied configuration message and optional cause without acquiring installation resources.',
    '以传入配置文本及可选原因初始化配置非法诊断，不获取安装资源。'
  ],
  [
    'RpcConstructionError',
    'Partial construction keeps primary cause, ordered cleanup failures and optional pending cleanup.',
    '部分构造保留主原因、有序清理失败及可选待决清理。',
    'Capture the construction primary, ordered cleanupErrors and optional cleanupPromise on the configuration-error subclass.',
    '在配置错误子类上保存构造主原因、有序清理错误及可选清理完成结果。'
  ],
  [
    'RpcLifecycleError',
    'Actual lifecycle diagnostic keeps cleanup details and optional standard aggregate errors.',
    '实际生命周期诊断保留清理详情及可选标准聚合错误。',
    'Store the original cause and optional ordered release failures under ENDPOINT_DISPOSED; constructing the diagnostic does not release resources.',
    '以端点已释放语义保存原原因及可选有序释放失败，构造诊断本身不执行资源释放。'
  ],
  [
    'RpcSerializationError',
    'Payload/serialization diagnostic keeps the original failure.',
    '载荷或序列化诊断保留原失败。',
    'Associate the supplied payload message and optional cause with PAYLOAD_INVALID while encoding remains with its codec owner.',
    '将传入载荷文本及可选原因关联到载荷非法诊断，编码仍由编解码所有者执行。'
  ],
  [
    'RpcProtocolError',
    'Semantic protocol diagnostic preserves its original parser cause.',
    '语义协议诊断保留原解析原因。',
    'Use PROTOCOL_INVALID for the supplied interpretation failure and retain its optional cause on the native protocol-error subclass.',
    '以协议非法语义表示传入的解释失败，在原生协议错误子类上保留可选原因。'
  ],
  [
    'RpcContractError',
    'Application method-contract diagnostic retains the original cause.',
    '应用方法契约诊断保留原原因。',
    'Assign CONTRACT_INVALID to the supplied method or correlation rejection message and keep the optional original cause.',
    '为传入的方法或关联拒绝文本设置契约非法语义错误码，并保存可选原原因。'
  ],
  [
    'RpcTransportError',
    'Physical transport diagnostic does not itself prove whether remote work ran.',
    '物理传输诊断本身不证明远端工作是否执行。',
    'Initialize the TRANSPORT family from a physical IO message and optional cause without inferring the remote execution outcome.',
    '根据物理读写文本及可选原因初始化传输错误家族，不推断远端执行结果。'
  ],
  [
    'RpcAuthenticationError',
    'Protection or verification diagnostic retains the actual failure.',
    '保护或验证诊断保留实际失败。',
    'Build AUTHENTICATION_FAILED from the protection or verification message and optional cause; no credential or authenticated source is created.',
    '根据保护或验证文本及可选原因构造认证失败诊断，不创建凭据或已认证来源。'
  ],
  [
    'RpcChunkError',
    'Chunk/reassembly diagnostic retains the original rejected input cause.',
    '分片及重组诊断保留原拒绝输入原因。',
    'Record CHUNK_INVALID with the chunk rejection message and optional cause without allocating or changing reassembly state.',
    '使用分片非法语义记录分片拒绝文本及可选原因，不分配或改变重组状态。'
  ],
  [
    'RpcRemoteError',
    'Separate native Error subclass carries arbitrary remote string codes; it is not a RpcError subclass.',
    '独立原生错误子类携带任意远端字符串码，不是基础远程调用错误的子类。',
    'Initialize a separate Error subclass with the remote string code, message, optional application data and cause rather than converting the code to a local core code.',
    '以远端字符串码、文本、可选应用数据及原因初始化独立原生错误子类，不把该码转换为本地核心错误码。'
  ],
  [
    'RpcAbortError',
    'Cancellation diagnostic uses standard AbortError name and optional original cleanup completion.',
    '取消诊断采用标准中止名称及可选原清理完成结果。',
    'Initialize CANCELLED with an optional cleanup completion and cause, using the standard AbortError name and canonical message when omitted.',
    '初始化取消语义及可选清理完成结果与原因，使用标准中止名称，省略文本时采用规范默认值。'
  ],
  [
    'RpcTimeoutError',
    'Deadline diagnostic uses standard TimeoutError name and optional original cleanup completion.',
    '期限诊断采用标准超时名称及可选原清理完成结果。',
    'Initialize DEADLINE_EXCEEDED with the standard TimeoutError name and optional cleanup completion; omitting the message selects the canonical deadline text.',
    '以标准超时名称及可选清理完成结果初始化截止时间已到语义，省略文本时选择规范期限文本。'
  ]
] as const
for (const [name, en, zh, constructorEn, constructorZh] of errorClasses) {
  /**
   * Constructor fields come from this exact public native class, including its original cleanup
   * ports.
   */
  const params: Record<string, IText> = {
    message: t(
      'Actual owner-maintained diagnostic text; AbortError/TimeoutError have their canonical default when omitted.',
      '实际所有者维护的诊断文本，中止及超时错误省略时采用规范默认值。'
    )
  }
  if (name === 'RpcError' || name === 'RpcRemoteError') params.code = fields.code!.summary
  if (name === 'RpcRemoteError' || name === 'RpcSchemaValidationError')
    params.data = t('Original portable application/validation detail.', '原可移植应用及校验详情。')
  if (name !== 'RpcTimeoutError') params.cause = reasonParam
  if (name === 'RpcConstructionError' || name === 'RpcLifecycleError')
    params.cleanupErrors = t(
      'Original ordered resource/error pairs; never replace primary failure.',
      '原有序资源及错误组合，不能替换主失败。'
    )
  if (name === 'RpcConstructionError' || name === 'RpcAbortError' || name === 'RpcTimeoutError')
    params.cleanupPromise = t(
      'Optional actual rollback completion returning original cleanup failures.',
      '可选实际回滚完成结果，返回原清理失败。'
    )
  /** Each diagnostic example supplies the actual constructor-specific required arguments. */
  const args =
    name === 'RpcError'
      ? "RpcCoreErrorCode.internal, 'Operation failed'"
      : name === 'RpcRemoteError'
        ? "'DECLINED', 'Operation declined'"
        : name === 'RpcSchemaValidationError'
          ? "'Input rejected', { field: 'amount' }"
          : name === 'RpcConstructionError'
            ? "'Construction failed', new Error('primary'), []"
            : "'Operation failed'"
  /** The class is imported from its real pure error entry, without a Host call facade. */
  const example = `import { ${name} } from '@migaia/rpc-contract/errors'\n${name === 'RpcError' ? "import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'\n" : ''}const error = new ${name}(${args})`
  symbols[name] = {
    role: 'error',
    purpose: t(
      en + ' Constructing or restoring it grants no local control authority.',
      zh + '构造或恢复诊断不授予本地控制权限。'
    ),
    params,
    returns: t(
      'A new native diagnostic instance with its sender stack and documented semantic family.',
      '带构造端堆栈及所述语义家族的新原生诊断实例。'
    ),
    example
  }
  dataType(
    name,
    en,
    zh,
    {
      source: fields.source!,
      code: fields.code!,
      cause: p(
        'Original local cause when the constructor accepts one.',
        '构造器接收时提供的原本地原因。'
      ),
      name: p(
        'Canonical error family name; AbortError/TimeoutError retain standard names.',
        '规范错误家族名称，中止及超时保持标准名称。'
      ),
      message: fields.message!,
      stack: fields.stack!,
      ...(name === 'RpcError' || name === 'RpcConstructionError' || name === 'RpcLifecycleError'
        ? {
            cleanupErrors: p(
              'Original ordered resource release failures.',
              '原有序资源释放失败列表，保留清理发生次序而不替换主错误。'
            )
          }
        : {}),
      ...(name === 'RpcConstructionError' || name === 'RpcAbortError' || name === 'RpcTimeoutError'
        ? {
            cleanupPromise: p(
              'Optional original rollback completion; inspect it for later release failures.',
              '可选原回滚完成结果，可检查后续释放失败。'
            )
          }
        : {}),
      ...(name === 'RpcRemoteError' || name === 'RpcSchemaValidationError'
        ? { data: fields.data! }
        : {}),
      ...(name === 'RpcLifecycleError'
        ? {
            errors: p(
              'Optional standard aggregate children supplied by actual cleanup translation.',
              '实际清理转换提供的可选标准聚合子项。'
            )
          }
        : {}),
      constructor: m(
        constructorEn,
        constructorZh,
        params,
        t(
          'Original newly constructed diagnostic; no Session, timer or permission is created.',
          '原新构造诊断，不创建会话、计时器或权限。'
        ),
        example
      )
    },
    example
  )
}

/** Exact public literal domains and per-key meanings. */
domain(
  'RpcCallMode',
  'protocol',
  'Operation modes preserve distinct request, notify, stream, group and outcome completion boundaries.',
  '操作模式保持不同的请求、通知、流、分组及查询完成边界。',
  {
    request: {
      en: 'Scalar request with correlated completion.',
      zh: '请求等待关联标量终态。'
    },
    notify: {
      en: 'Physical notification without business acknowledgement.',
      zh: '通知仅等待物理写入，不增加业务确认。'
    },
    stream: {
      en: 'Actual Host-owned streaming operation.',
      zh: '实际宿主拥有拉取及终态清理。'
    },
    group: {
      en: 'Ordered fail-stop request group.',
      zh: '分组按序执行，首个失败即停止。'
    },
    outcome: {
      en: 'Actual idempotency outcome lookup.',
      zh: '查询实际保留的幂等结果。'
    }
  }
)
domain(
  'RpcCarrierFrameKind',
  'protocol',
  'Opaque codec messages and negotiated outer extensions do not create another semantic protocol.',
  '非透明编解码消息及协商外层扩展不创建另一语义协议。',
  {
    message: {
      en: 'Opaque message of the selected codec.',
      zh: '已选编解码拥有的非透明表示。'
    },
    extension: {
      en: 'Actual negotiated outer frame handler.',
      zh: '实际已安装且协商的带版本外层帧。'
    }
  }
)
domain(
  'RpcEnvelopeViolation',
  'protocol',
  'First-envelope failure categories used in coded diagnostics.',
  '信封纯形状检查的首个失败类别，供诊断定位字段问题，不代表执行或会话状态。',
  {
    read: {
      en: 'Reading a property failed; retain the original getter cause.',
      zh: '读取属性失败，保留原始读取器原因。'
    },
    type: {
      en: 'The received value has an unsupported native or scalar type.',
      zh: '接收值具有不支持的原生或标量类型。'
    },
    unknownKind: {
      en: 'The envelope discriminator is not a supported semantic kind.',
      zh: '信封判别字段不是受支持的语义种类。'
    },
    required: {
      en: 'A required protocol-owned field is absent or invalid.',
      zh: '协议拥有的必需字段缺失或无效。'
    },
    unknownField: {
      en: 'An extra field is forbidden by the selected closed grammar.',
      zh: '额外字段被所选封闭语法禁止。'
    },
    route: {
      en: 'Routing metadata violates its protocol-owned shape.',
      zh: '路由元数据违反协议拥有的形态。'
    },
    payload: {
      en: 'Application payload cannot be normalized as portable data.',
      zh: '应用载荷无法规范化为可移植数据。'
    },
    error: {
      en: 'Serialized failure data violates the bounded error grammar.',
      zh: '序列化失败数据违反有界错误语法。'
    }
  }
)
dataType(
  'RpcEnvelopeViolation',
  'First-envelope failure categories used in coded diagnostics.',
  '信封纯形状检查的首个失败类别，供诊断定位字段问题，不代表执行或会话状态。',
  {}
)
domain(
  'RpcHandshakeViolation',
  'protocol',
  'First malformed handshake boundary without exposing authentication material.',
  '握手纯准入失败的稳定分类，结合有界路径定位问题，同时避免回显认证材料。',
  {
    read: {
      en: 'Reading a property failed; retain the original getter cause.',
      zh: '读取属性失败，保留原始读取器原因。'
    },
    encoding: {
      en: 'Received text bytes are not valid UTF-8 encoding.',
      zh: '接收的文本字节不是有效统一编码。'
    },
    bytes: {
      en: 'Encoded handshake exceeds its admitted byte ceiling.',
      zh: '编码握手超过允许的字节上限。'
    },
    type: {
      en: 'The received value has an unsupported native or scalar type.',
      zh: '接收值具有不支持的原生或标量类型。'
    },
    required: {
      en: 'A required protocol-owned field is absent or invalid.',
      zh: '协议拥有的必需字段缺失或无效。'
    },
    step: {
      en: 'The exchange received a control step in the wrong phase.',
      zh: '交换在错误阶段收到了控制步骤。'
    },
    baseline: {
      en: 'A mandatory protocol, version or codec baseline is missing.',
      zh: '缺少必需协议、版本或编解码基线。'
    },
    duplicate: {
      en: 'An offer repeats a version or capability identity.',
      zh: '提议重复了版本或能力身份标识。'
    },
    mismatch: {
      en: 'The selected agreement was not included in the local offer.',
      zh: '选定协议结果不在本地提议之中。'
    }
  }
)
dataType(
  'RpcHandshakeViolation',
  'First malformed handshake boundary without exposing authentication material.',
  '握手纯准入失败的稳定分类，结合有界路径定位问题，同时避免回显认证材料。',
  {}
)
domain(
  'RpcProviderDeclarationLimit',
  'protocol',
  'Bounded local catalogs prevent unbounded description retention before compilation.',
  '本地提供方声明的插件、特性与方法数量边界，在编译前拒绝无界目录描述。',
  {
    pluginsPerCatalog: {
      en: 'Maximum declared plugins in one Host description.',
      zh: '每目录最多六十四插件。'
    },
    featuresPerContract: {
      en: 'Maximum features in one plugin contract.',
      zh: '每契约最多六十四特性。'
    },
    methodsPerFeature: {
      en: 'Maximum methods in one feature table.',
      zh: '每特性最多一百二十八方法。'
    },
    methodsPerCatalog: {
      en: 'Aggregate method budget across all contracts in a Host catalog.',
      zh: '整目录最多四千零九十六方法。'
    },
    detailPathChars: {
      en: 'Diagnostic paths cannot exceed the existing trace-character budget.',
      zh: '诊断路径最多二百五十六字符。'
    }
  }
)
domain(
  'RpcProviderMode',
  'protocol',
  'Explicit local declaration modes differ from the wire request/notify/stream vocabulary.',
  '显式本地声明模式与线上请求、通知及流词汇区分。',
  {
    request: {
      en: 'Scalar call requiring a returned result.',
      zh: '请求等待关联标量终态。'
    },
    oneWay: {
      en: 'Physical notification with no provider completion reply.',
      zh: '单向声明，对外使用通知。'
    },
    generator: {
      en: 'Declared synchronous generator served through the stream owner.',
      zh: '同步生成器声明，对外使用流。'
    },
    asyncGenerator: {
      en: 'Declared asynchronous generator served through the stream owner.',
      zh: '异步生成器声明，对外使用流。'
    }
  }
)
dataType(
  'RpcProviderMode',
  'Explicit local declaration modes differ from the wire request/notify/stream vocabulary.',
  '显式本地声明模式与线上请求、通知及流词汇区分。',
  {}
)
domain(
  'RpcRuntimeOutcomeState',
  'protocol',
  'Read-only lookup facts never guess whether business execution occurred.',
  '幂等结果查询的只读状态分类，区分待决、未知及已完成，不把缺失结果推断为成功。',
  {
    pending: {
      en: 'The original provider store holds a still-pending reservation.',
      zh: '原始提供方存储仍持有待定预留。'
    },
    done: {
      en: 'The original store holds the actual final business outcome.',
      zh: '原始存储持有实际最终业务结果。'
    },
    unknown: {
      en: 'The store has no retained outcome; this does not prove nonexecution.',
      zh: '存储没有保留结果，不能证明从未执行。'
    }
  }
)
dataType(
  'RpcRuntimeOutcomeState',
  'Read-only lookup facts never guess whether business execution occurred.',
  '幂等结果查询的只读状态分类，区分待决、未知及已完成，不把缺失结果推断为成功。',
  {}
)
domain(
  'RpcRuntimeStoreContinuity',
  'protocol',
  'Continuity is issued by the real store owner, never inferred from key expiry.',
  '连续性由实际存储所有者签发，不由键过期推断。',
  {
    retained: {
      en: 'The original store incarnation is still retained.',
      zh: '仍保留原来的存储实例及连续性。'
    },
    lost: {
      en: 'A real store replacement lost continuity since restart.',
      zh: '真实存储替换导致重启后连续性丢失。'
    },
    unavailable: {
      en: 'Store continuity cannot be observed because the store is unavailable.',
      zh: '存储不可用，因此无法观察其连续性。'
    }
  }
)
dataType(
  'RpcRuntimeStoreContinuity',
  'Continuity is issued by the real store owner, never inferred from key expiry.',
  '连续性由实际存储所有者签发，不由键过期推断。',
  {}
)
domain(
  'RpcRuntimeStoreKind',
  'protocol',
  'Original final-provider store owner and its availability.',
  '最终提供方报告的实际存储种类，区分内存、外部与不可用，不由中继猜测保管状态。',
  {
    memory: {
      en: 'The provider owns an in-memory idempotency store.',
      zh: '提供方拥有内存中的幂等存储。'
    },
    external: {
      en: 'The provider owns an external idempotency store.',
      zh: '提供方拥有外部持久幂等存储。'
    },
    unavailable: {
      en: 'No original outcome store is available for this lookup.',
      zh: '本次查询没有可用的原始结果存储。'
    }
  }
)
dataType(
  'RpcRuntimeStoreKind',
  'Original final-provider store owner and its availability.',
  '最终提供方报告的实际存储种类，区分内存、外部与不可用，不由中继猜测保管状态。',
  {}
)
domain(
  'RpcShapeReason',
  'protocol',
  'Bounded declaration/directory diagnostics; historical labels enable no retired profile.',
  '有界声明及目录诊断，历史标签不启用退役协议。',
  {}
)
dataType(
  'RpcShapeReason',
  'Bounded declaration/directory diagnostics; historical labels enable no retired profile.',
  '有界声明及目录诊断，历史标签不启用退役协议。',
  {}
)
domain(
  'RpcStreamEvent',
  'protocol',
  'Seven protocol stream events; the stream owner checks direction and held sequence.',
  '七种协议流事件，由流所有者检查方向和已有序号。',
  {
    open: {
      en: 'Producer opens an admitted stream at sequence zero.',
      zh: '生产方以零序号打开已准入的流。'
    },
    pull: {
      en: 'Consumer grants credit for exactly one next item.',
      zh: '消费方恰好授予下一个条目的额度。'
    },
    item: {
      en: 'Producer sends the one item authorized by held credit.',
      zh: '生产方发送已有额度授权的单个条目。'
    },
    end: {
      en: 'Producer reports normal completion of the stream.',
      zh: '生产方报告流已经正常完成。'
    },
    fail: {
      en: 'Producer reports a serialized terminal failure.',
      zh: '生产方报告序列化的终止失败。'
    },
    cancel: {
      en: 'Consumer requests cancellation with optional failure reason.',
      zh: '消费方携带可选失败原因请求取消。'
    },
    cancelled: {
      en: 'Producer acknowledges actual stream cancellation.',
      zh: '生产方确认流已经实际取消。'
    }
  }
)
dataType(
  'RpcStreamEvent',
  'Seven protocol stream events; the stream owner checks direction and held sequence.',
  '七种协议流事件，由流所有者检查方向和已有序号。',
  {}
)
domain(
  'RpcStreamLimit',
  'protocol',
  'Portable item and per-peer stream admission ceilings.',
  '流协议的单项语义字节预算及每对端流数量上限，执行所有者仍负责实际计数与释放。',
  {
    maxItemValueBytes: {
      en: 'One portable item value is limited to 16384 counted bytes.',
      zh: '单个可移植条目值最多计量一万六千三百八十四字节。'
    },
    maxOpenStreamsPerPeer: {
      en: 'One peer may retain at most 256 open streams.',
      zh: '单个对端最多保留二百五十六条打开的流。'
    }
  }
)
domain(
  'RpcStreamViolation',
  'protocol',
  'Stable first-failure categories for stream payload and credit checks.',
  '流载荷、顺序及额度纯检查的首个失败类别，实际消费者和生产者仍拥有其运行状态。',
  {
    event: {
      en: 'The stream event is unknown or invalid for its mode.',
      zh: '流事件未知或不适用于当前模式。'
    },
    direction: {
      en: 'The event arrived from the wrong producer/consumer direction.',
      zh: '事件来自错误的生产或消费方向。'
    },
    field: {
      en: 'The event carries a field forbidden in its variant.',
      zh: '事件携带当前形式禁止的字段。'
    },
    seq: {
      en: 'The sequence or held pull credit does not match.',
      zh: '序号或持有的拉取额度不匹配。'
    },
    budget: {
      en: 'The stream value exceeds its portable item byte ceiling.',
      zh: '流值超过可移植条目的字节上限。'
    }
  }
)
dataType(
  'RpcStreamViolation',
  'Stable first-failure categories for stream payload and credit checks.',
  '流载荷、顺序及额度纯检查的首个失败类别，实际消费者和生产者仍拥有其运行状态。',
  {}
)
domain(
  'RpcWireBinaryStorage',
  'protocol',
  'Actual carrier support selects inline or native backing representation, independently of caller transfer permission.',
  '实际载体支持选择内联或原生背板表示，与调用方转移权限分开。',
  {
    inline: {
      en: 'Encoded portable byte representation.',
      zh: '编码字节位于可移植表示内。'
    },
    native: {
      en: 'Original backings on actually supported native media.',
      zh: '真实支持的原生介质承载原始背板。'
    }
  }
)
domain(
  'RpcWireControlOperation',
  'protocol',
  'Host health and drain controls carry route/id without a provider task.',
  '宿主健康及排空控制携带路由及标识，不含提供方任务。',
  {
    ping: {
      en: 'Ask for an actual correlated health response.',
      zh: '请求实际关联健康回应。'
    },
    pong: {
      en: 'Reply to the original health control.',
      zh: '回应原健康检查控制标识，不能作为业务请求的完成确认。'
    },
    drain: {
      en: 'Announce actual remaining graceful budget.',
      zh: '公告实际剩余宽限排空预算。'
    }
  }
)
domain(
  'RpcWireField',
  'protocol',
  'Closed-shape field names are vocabulary; a listed key is not valid on every frame.',
  '闭合形态字段名仅为词汇，列出某键不表示每帧都允许它。',
  {
    generation: {
      en: 'Actual Session or restart generation; copied wire diagnostics cannot create native ownership.',
      zh: '实际会话或重启代际，复制线上诊断不能生成原生所有权。'
    },
    extension: {
      en: 'Selects the outer negotiated extension identity.',
      zh: '实际已安装且协商的带版本外层帧。'
    },
    profile: {
      en: 'Fixed `migaia.rpc/2` semantic profile; the sender selects no legacy fallback.',
      zh: '固定为 `migaia.rpc/2` 的语义标识，发送方不能选择旧协议回退。'
    },
    kind: {
      en: 'Closed frame discriminator selecting which remaining fields are admitted.',
      zh: '闭合帧种类，用于决定其余字段的接纳规则。'
    },
    id: {
      en: 'Correlation id issued by the originating call or control owner and echoed by its terminal.',
      zh: '由发起调用或控制操作的所有者分配的关联标识，终态沿用原值。'
    },
    route: {
      en: 'Routing facts supplied by the actual sending owner; forwarding preserves the selected task.',
      zh: '由实际发送所有者提供的路由事实，转发保持原选定任务。'
    },
    task: {
      en: 'Original caller, method and selected generation tuple; terminal frames must echo it.',
      zh: '原始调用方、方法及选定代际组合，终态帧必须沿用。'
    },
    options: {
      en: 'Closed wire options for ordering, cancellation scope and idempotency; no local signal or feature instance.',
      zh: '仅含顺序、取消范围与幂等键的闭合线上选项，不含本地信号或执行特性实例。'
    },
    payload: {
      en: 'Optional admitted portable business input; actual undefined is represented by omission.',
      zh: '可选且已接纳的可移植业务输入，实际未定义值通过省略表示。'
    },
    reason: {
      en: 'Optional original terminal reason, represented as a flat error graph on the wire.',
      zh: '可选原终态原因，在线上使用平面错误图表示。'
    },
    stream: {
      en: 'Selects the stream slot in the wire shape and its diagnostic pointer.',
      zh: '实际宿主拥有拉取及终态清理。'
    },
    completion: {
      en: 'Actual business terminal including stream cleanup; it is not merely physical write completion.',
      zh: '包含流清理的实际业务终态，不等同于物理写入完成。'
    },
    idempotencyKey: {
      en: 'Origin-issued bounded operation token reused only for the same semantic operation.',
      zh: '发起方签发的有界操作令牌，仅同一语义操作可复用。'
    },
    outcome: {
      en: 'Selects the outcome slot in the wire shape and its diagnostic pointer.',
      zh: '查询实际保留的幂等结果。'
    },
    callerId: {
      en: 'Original caller instance id captured at call creation, not the current intermediary.',
      zh: '创建调用时捕获的原始调用实例标识，不是当前中继。'
    },
    callerGeneration: {
      en: 'Original caller generation issued by the actual Session or restart owner.',
      zh: '由实际会话或重启所有者签发的原调用方代际。'
    },
    targetGeneration: {
      en: 'Exact destination generation chosen for this operation; replacement cannot settle the old operation.',
      zh: '本操作选定的精确目标代际，替代实例不能结算旧操作。'
    },
    method: {
      en: 'Declared method name from the accepted provider directory; not an arbitrary Host property path.',
      zh: '已准入提供方目录中的方法名，不是任意宿主属性路径。'
    },
    providerId: {
      en: 'Provider instance address issued with the corresponding generation fact.',
      zh: '随对应代际事实签发的提供方实例地址。'
    },
    orderKey: {
      en: 'Caller-selected FIFO key within the real provider owner; no physical queue is created by the type.',
      zh: '调用方在实际提供方所有者内选择的顺序键，此类型不创建物理队列。'
    },
    cancel: {
      en: 'Only `before-start` limits cancellation to work not yet admitted to business execution.',
      zh: '仅允许 `before-start`，把取消限定为尚未进入业务执行的操作。'
    },
    result: {
      en: 'Admitted portable business result; an actual undefined result is omitted.',
      zh: '已接纳的可移植业务结果，实际未定义结果省略。'
    },
    error: {
      en: 'Original local failure or admitted flat error graph, as selected by the surrounding contract.',
      zh: '由所在契约确定的原本地失败或已准入平面错误图。'
    },
    event: {
      en: 'Selects the event slot in the wire shape and its diagnostic pointer.',
      zh: '借用阶段事实，由发出方补充序号及身份。'
    },
    source: {
      en: 'Stable diagnostic source supplied by the originating error owner; not authentication authority.',
      zh: '由原错误所有者提供的稳定诊断来源，不是认证权限。'
    },
    code: {
      en: 'Semantic diagnostic code retained independently of presentation text; remote codes grant no local control.',
      zh: '独立于展示文本保留的语义错误码，远端码不授予本地控制权限。'
    },
    name: {
      en: 'Owner-issued name used for the surrounding identity or diagnostic shape.',
      zh: '由所有者提供、用于所在身份或诊断形态的名称。'
    },
    message: {
      en: 'Bounded error presentation text; do not parse it to authorize retries or resource retirement.',
      zh: '有界错误展示文本，不能解析它来授权重试或资源退场。'
    },
    stack: {
      en: 'Original sender stack string; restoration does not substitute a receiving-side stack.',
      zh: '原发送方堆栈文本，恢复时不替换为接收端堆栈。'
    },
    data: {
      en: 'Portable diagnostic detail or carrier-owned opaque data, as specified by the enclosing type.',
      zh: '由所在类型规定的可移植诊断详情或载体所有的非透明数据。'
    },
    truncated: {
      en: 'Present only as true when the bounded projection omits graph or text content.',
      zh: '仅在有界投影省略图或文本内容时出现，值只能为真。'
    },
    applicationVersion: {
      en: 'Application-defined nonempty version label for this route, separate from protocol 2.0.',
      zh: '应用提供的非空路由版本标签，与协议版本 `2.0` 分开。'
    },
    senderId: {
      en: 'Immediate sending instance address supplied by the accepted source owner.',
      zh: '已准入来源所有者提供的直接发送实例地址。'
    },
    receiverId: {
      en: 'Selected immediate receiving instance address; intermediaries cannot infer it from a payload.',
      zh: '选定的直接接收实例地址，中继不能从业务载荷推断。'
    },
    targetId: {
      en: 'Original logical target address selected by the caller; forwarding retains this destination.',
      zh: '调用方选定的原始逻辑目标地址，透明转发保持此目的地。'
    },
    sentAt: {
      en: 'Sender-supplied nonnegative timestamp; it does not replace the local monotonic deadline clock.',
      zh: '发送方提供的非负时间戳，不能替代本地单调期限时钟。'
    },
    forwardRoute: {
      en: 'Bounded ordered Host node ids already traversed; diagnostic data grants no forwarding permission.',
      zh: '已途经的有界有序宿主节点标识，诊断数据不授予转发权限。'
    },
    trace: {
      en: 'Explicit caller correlation containing 1–256 printable ASCII characters; only this operation and its transparent forwarding inherit it.',
      zh: '调用方显式提供的关联文本，含 `1–256` 个可打印 ASCII 字符，仅当前操作及其透明转发保持此值。'
    },
    remainingMs: {
      en: 'Remaining relative deadline budget from the previous owner; forwarding can only reduce it.',
      zh: '上一所有者传入的相对剩余期限预算，转发只能缩短。'
    },
    major: {
      en: 'Selects the major slot in the wire shape and its diagnostic pointer.',
      zh: '不兼容语义主版本为二。'
    },
    minor: {
      en: 'Selects the minor slot in the wire shape and its diagnostic pointer.',
      zh: '当前唯一协议的次版本固定为零，不能据此选择旧语法。'
    },
    codec: {
      en: 'Actual codec selected from the bilateral handshake proposals.',
      zh: '双边握手提议中实际选定的编解码身份。'
    },
    extensions: {
      en: 'Actual extension proposals, selected membership or per-operation data, according to the enclosing contract.',
      zh: '按所在契约表示实际扩展提议、选定集合或逐操作扩展数据。'
    },
    self: {
      en: 'Current genuine local identity supplied by the Host or verified native bootstrap owner.',
      zh: '宿主或已验证原生引导所有者提供的当前真实本地身份。'
    },
    methods: {
      en: 'Actual compiled method descriptions belonging to this provider or accepted Session.',
      zh: '属于此提供方或已准入会话的实际编译方法描述。'
    },
    nodeId: {
      en: 'Optional accepted Host node id used for loop diagnostics, not a native process identity.',
      zh: '用于环路诊断的可选准入宿主节点标识，不是原生进程身份。'
    },
    sidecars: {
      en: 'Ordered original complete backing identities supplied by the same codec; not copied protocol data.',
      zh: '同一编解码器提供的有序原始完整背板身份，不是复制的协议数据。'
    }
  }
)
domain(
  'RpcWireHandshakeStep',
  'protocol',
  'Actual offer, selected agreement and classified rejection share one handshake grammar.',
  '实际提议、选定协议及分类拒绝共用一套握手语法。',
  {
    hello: {
      en: 'Actual version/codec/extension proposal with original identity.',
      zh: '提议实际支持的版本、编解码、扩展及原身份目录。'
    },
    accept: {
      en: 'Selected agreement, also used for initiator confirmation.',
      zh: '选定协议，发起方确认复用同一形态。'
    },
    reject: {
      en: 'Classified flat diagnostic rejection.',
      zh: '携带平面错误图，不发布就绪。'
    }
  }
)
domain(
  'RpcWireKind',
  'protocol',
  'Closed semantic frame kinds select the only admitted protocol grammar.',
  '唯一协议的闭合帧种类集合，决定握手、业务操作、控制与目录各自允许的字段。',
  {
    handshake: {
      en: 'Host identity, directory and codec/extension negotiation.',
      zh: '真实物理订阅后开始握手。'
    },
    group: {
      en: 'Ordered fail-stop business steps, separate from optional physical batching.',
      zh: '分组按序执行，首个失败即停止。'
    },
    stream: {
      en: 'Credit-driven stream event for the original admitted task.',
      zh: '实际宿主拥有拉取及终态清理。'
    },
    outcome: {
      en: 'Optional idempotency plugin lookup or observed store fact.',
      zh: '查询实际保留的幂等结果。'
    }
  }
)
domain(
  'RpcWireLimit',
  'protocol',
  'Admission bounds for untrusted identifiers, offers and durations.',
  '对未可信标识长度、握手提议数量及相对时长设置的准入边界，不替代执行期限所有者。',
  {
    maxIdentifierChars: {
      en: 'At most 128 characters in an admitted identifier.',
      zh: '接纳的单个标识最多为 `128` 个字符。'
    },
    maxTraceChars: {
      en: 'At most 256 characters in optional trace metadata.',
      zh: '可选追踪元数据最多为 `256` 个字符。'
    },
    maxIdempotencyKeyChars: {
      en: 'At most 128 characters in one idempotency key.',
      zh: '单个幂等操作键最多为 `128` 个字符。'
    },
    maxDurationMs: {
      en: 'Relative millisecond durations cannot exceed 2147483647.',
      zh: '相对毫秒时长不能超过 `2147483647`。'
    },
    maxHandshakeBytes: {
      en: 'Reject first-channel negotiation exceeding 65536 bytes.',
      zh: '拒绝超过 `65536` 字节的首通道协商。'
    },
    maxVersions: {
      en: 'A handshake offer contains at most eight version proposals.',
      zh: '握手提议最多包含八个版本提案。'
    },
    maxCodecs: {
      en: 'A handshake offer contains at most sixteen codec identities.',
      zh: '握手提议最多包含十六个编解码身份。'
    },
    maxCapabilities: {
      en: 'A handshake offer contains at most sixty-four capability identities.',
      zh: '握手提议最多包含六十四个能力身份。'
    }
  }
)
domain(
  'RpcWirePointer',
  'protocol',
  'Canonical JSON-pointer roots identify the first pure validation failure.',
  '纯校验报告使用的规范指针根，指明首个违规的数据位置，不读取或反射业务内容。',
  {
    root: {
      en: 'The empty diagnostic pointer identifies the complete input root.',
      zh: '空指针表示整个输入根节点，不指向任何嵌套字段。'
    },
    profile: {
      en: 'Fixed `migaia.rpc/2` semantic profile; the sender selects no legacy fallback.',
      zh: '固定为 `migaia.rpc/2` 的语义标识，发送方不能选择旧协议回退。'
    },
    kind: {
      en: 'Closed frame discriminator selecting which remaining fields are admitted.',
      zh: '闭合帧种类，用于决定其余字段的接纳规则。'
    },
    id: {
      en: 'Correlation id issued by the originating call or control owner and echoed by its terminal.',
      zh: '由发起调用或控制操作的所有者分配的关联标识，终态沿用原值。'
    },
    route: {
      en: 'Routing facts supplied by the actual sending owner; forwarding preserves the selected task.',
      zh: '由实际发送所有者提供的路由事实，转发保持原选定任务。'
    },
    task: {
      en: 'Original caller, method and selected generation tuple; terminal frames must echo it.',
      zh: '原始调用方、方法及选定代际组合，终态帧必须沿用。'
    },
    options: {
      en: 'Closed wire options for ordering, cancellation scope and idempotency; no local signal or feature instance.',
      zh: '仅含顺序、取消范围与幂等键的闭合线上选项，不含本地信号或执行特性实例。'
    },
    payload: {
      en: 'Optional admitted portable business input; actual undefined is represented by omission.',
      zh: '可选且已接纳的可移植业务输入，实际未定义值通过省略表示。'
    },
    steps: {
      en: 'Diagnostic pointer "/steps".',
      zh: '指向分组步骤表的诊断根，具体步骤索引会继续追加到此路径。'
    },
    result: {
      en: 'Admitted portable business result; an actual undefined result is omitted.',
      zh: '已接纳的可移植业务结果，实际未定义结果省略。'
    },
    error: {
      en: 'Original local failure or admitted flat error graph, as selected by the surrounding contract.',
      zh: '由所在契约确定的原本地失败或已准入平面错误图。'
    },
    stream: {
      en: 'Actual Host-owned streaming operation.',
      zh: '实际宿主拥有拉取及终态清理。'
    },
    reason: {
      en: 'Optional original terminal reason, represented as a flat error graph on the wire.',
      zh: '可选原终态原因，在线上使用平面错误图表示。'
    },
    directory: {
      en: 'Diagnostic pointer "/directory".',
      zh: '指向握手或公告中目录记录的诊断根，字段违规路径在其后追加。'
    },
    handshake: {
      en: 'Diagnostic pointer "/handshake".',
      zh: '真实物理订阅后开始握手。'
    },
    extensions: {
      en: 'Actual extension proposals, selected membership or per-operation data, according to the enclosing contract.',
      zh: '按所在契约表示实际扩展提议、选定集合或逐操作扩展数据。'
    },
    requiredExtensions: {
      en: 'Diagnostic pointer "/requiredExtensions".',
      zh: '指向握手必需扩展列表，缺失协商能力的字段诊断从此处开始。'
    },
    nodes: {
      en: 'Diagnostic pointer "/nodes".',
      zh: '指向平面错误图节点数组，节点索引及其字段追加到此路径。'
    },
    store: {
      en: 'Diagnostic pointer "/store".',
      zh: '指向结果查询的存储事实记录，存储种类与连续性违规从此定位。'
    },
    outcome: {
      en: 'Actual idempotency outcome lookup.',
      zh: '查询实际保留的幂等结果。'
    },
    frame: {
      en: 'Diagnostic pointer "/frame".',
      zh: '指向载体外层帧的诊断根，不代表其中业务载荷的完整路径。'
    },
    manifest: {
      en: 'Diagnostic pointer "/manifest".',
      zh: '指向二进制背板清单的诊断根，用于定位长度、摘要及存储形态字段。'
    }
  }
)
domain(
  'RpcWireStepState',
  'protocol',
  'Ordered group outcomes retain first failure and unexecuted suffix.',
  '有序分组结果的状态分类，保留成功前缀、首个失败与未执行后缀，而不是并发批处理结果。',
  {
    success: {
      en: 'Executed successful step.',
      zh: '步骤成功执行，可带可移植结果。'
    },
    failure: {
      en: 'First failed step with flat error.',
      zh: '首个失败携带平面错误图。'
    },
    notExecuted: {
      en: 'Unexecuted suffix after first failure.',
      zh: '首个失败之后的步骤未执行。'
    }
  }
)
domain(
  'RpcWireVersion',
  'protocol',
  'Single semantic version 2.0; no older profile fallback.',
  '当前唯一语义版本为二点零，主次版本均参与握手选择，不自动回退已删除的协议语法。',
  {
    major: {
      en: 'Incompatible semantic revision 2.',
      zh: '不兼容语义主版本为二。'
    },
    minor: {
      en: 'Supported minor revision 0.',
      zh: '当前唯一协议的次版本固定为零，不能据此选择旧语法。'
    }
  }
)
domain(
  'RuntimeApiMode',
  'protocol',
  'Actual installed V2 runtime call routes.',
  '第二版运行时实际安装的调用路由模式，由真实安装能力确定可用操作。',
  {
    request: {
      en: 'Request one portable scalar result.',
      zh: '请求并等待单个可移植结果。'
    },
    notify: {
      en: 'Dispatch without a result.',
      zh: '派发后不等待返回结果。'
    },
    stream: {
      en: 'Read an asynchronous item sequence.',
      zh: '读取异步产出的元素序列。'
    }
  }
)
dataType(
  'RuntimeApiMode',
  'Actual installed V2 runtime call routes.',
  '第二版运行时实际安装的调用路由模式，由真实安装能力确定可用操作。',
  {}
)
domain(
  'RuntimeApiModeSource',
  'protocol',
  'Method metadata records whether actual modes were declared or generated from routes.',
  '方法元数据记录实际模式来自声明还是路由生成。',
  {
    declared: {
      en: 'Explicitly declared route modes.',
      zh: '执行模式来自提供方显式声明，调用方不靠函数名称猜测模式。'
    },
    generatedRoutes: {
      en: 'Modes from actual generated routes.',
      zh: '模式来自实际生成路由。'
    }
  }
)
dataType(
  'RuntimeApiModeSource',
  'Method metadata records whether actual modes were declared or generated from routes.',
  '方法元数据记录实际模式来自声明还是路由生成。',
  {}
)
domain(
  'IpcSendClass',
  'interfaces',
  'Whole-envelope admission reserves separate total capacities for business data and control messages.',
  '完整消息封装准入分别为业务数据及控制消息预留总容量。',
  {
    data: {
      en: 'Business requests, replies and stream data use the data lane.',
      zh: '业务请求、响应及流数据使用数据通道。'
    },
    control: {
      en: 'Cancellation, liveness and outcome control use reserved control capacity.',
      zh: '取消、存活及结果控制使用预留控制容量。'
    }
  }
)
dataType(
  'IpcSendClass',
  'Whole-envelope admission reserves separate total capacities for business data and control messages.',
  '完整消息封装准入分别为业务数据及控制消息预留总容量。',
  {}
)
domain(
  'RpcCallFeatureKind',
  'interfaces',
  'The sole selector recognizes complete executing timeout and retry instances.',
  '完整执行特性的种类标识，供唯一特性选择器区分超时与来源重试实例。',
  {
    timeout: {
      en: 'One complete instance owns an individual attempt deadline.',
      zh: '完整逐尝试期限运行实例。'
    },
    retry: {
      en: 'One complete instance owns originating generation replay.',
      zh: '完整且仅来源方使用的重放退避实例。'
    }
  }
)
domain(
  'RpcCarrierEncoding',
  'interfaces',
  'Raw native representation labels differ from selected semantic codec ids.',
  '原始原生表示标签与已选语义编解码身份不同。',
  {
    any: {
      en: 'Native structured representation.',
      zh: '使用实际载体支持的原生结构化值，而非要求文本编码。'
    },
    string: {
      en: 'Actual native text representation.',
      zh: '载体仅接受文本表示，编解码器必须交付字符串内容。'
    },
    uint8Array: {
      en: 'Actual native byte representation.',
      zh: '实际原生字节分块表示。'
    }
  }
)
domain(
  'RpcCarrierPlatform',
  'interfaces',
  'Actual acquired native platform labels are diagnostics, never authenticated capabilities.',
  '实际已获取原生平台标签仅作诊断，不是认证能力。',
  {
    broadcastChannel: {
      en: 'Same-origin broadcast channel.',
      zh: '实际同源广播通道提供消息交付，仍需独立完成会话身份准入。'
    },
    iframe: {
      en: 'Window or frame postMessage.',
      zh: '实际窗口或框架消息介质。'
    },
    memory: {
      en: 'Same-process reference delivery.',
      zh: '同一进程内的真实引用交付载体，常用于嵌入式连接与测试。'
    },
    messagePort: {
      en: 'An acquired native MessagePort supplies this physical connection.',
      zh: '使用已经获取的真实消息端口，端口保管仍属于原生安装。'
    },
    process: {
      en: 'Process IPC or native bytes.',
      zh: '实际进程通信或原生字节介质。'
    },
    rtcDataChannel: {
      en: 'Acquired RTC data channel.',
      zh: '实际已获取实时数据通道。'
    },
    webTransport: {
      en: 'Acquired WebTransport stream.',
      zh: '实际已获取网页传输流。'
    },
    worker: {
      en: 'A native Worker messaging interface supplies the physical delivery.',
      zh: '通过真实工作者消息接口交付内容，工作者生命周期仍属于原生所有者。'
    }
  }
)
domain(
  'RpcCarrierTopology',
  'interfaces',
  'Native resource acquisition supplies actual exclusive, multiplexed or broadcast topology.',
  '原生资源获取提供实际独占、多路复用或广播拓扑。',
  {
    exclusive: {
      en: 'One actual selected peer.',
      zh: '实际单一物理对端选择。'
    },
    multiplexed: {
      en: 'Multiple actual independent peers.',
      zh: '实际多独立物理对端选择。'
    },
    broadcast: {
      en: 'Actual native publication to listeners.',
      zh: '原生介质向实际监听者分发。'
    }
  }
)
domain(
  'RpcProbeAuthentication',
  'interfaces',
  'Only the actually installed auth owner supplies protection facts.',
  '观察描述中的认证模式只能由真实安装的认证所有者提供，不能从消息内容推断。',
  {
    none: {
      en: 'No installed transform claims protection.',
      zh: '实际认证安装未提供签名或加密变换，描述中明确为无保护。'
    },
    sign: {
      en: 'The real installed owner signs and verifies.',
      zh: '实际认证安装提供签名与验证，消息内容不经过加密变换。'
    },
    encryptSign: {
      en: 'The real installed owner also encrypts and decrypts.',
      zh: '实际安装加解密及签名验证。'
    }
  }
)
domain(
  'RpcProbeDirection',
  'interfaces',
  'Numeric traffic directions distinguish original outbound, inbound and local observations.',
  '数字流量方向区分原出站、入站及端点本地生命周期观察。',
  {
    outbound: {
      en: 'The original endpoint is sending toward its peer.',
      zh: '原端点正在向实际对端发送流量。'
    },
    inbound: {
      en: 'The original endpoint is receiving from its peer.',
      zh: '原端点正在从实际对端接收流量。'
    },
    local: {
      en: 'The event concerns local lifecycle or settlement only.',
      zh: '该事件只涉及本地生命周期或结算。'
    }
  }
)
dataType(
  'RpcProbeDirection',
  'Numeric traffic directions distinguish original outbound, inbound and local observations.',
  '数字流量方向区分原出站、入站及端点本地生命周期观察。',
  {}
)
domain(
  'RpcProbeKind',
  'interfaces',
  'Numeric interaction kinds identify which original operation an event concerns.',
  '数字交互种类标识事件涉及的原始请求、流及控制操作。',
  {
    request: {
      en: 'A correlated application request enters the owner.',
      zh: '关联应用请求进入原所有者的处理路径。'
    },
    response: {
      en: 'A scalar result replies to an original request.',
      zh: '标量结果响应一个原始关联请求。'
    },
    notify: {
      en: 'A one-way application notification has no result wait.',
      zh: '单向应用通知不建立业务结果等待。'
    },
    streamOpen: {
      en: 'A streaming interaction opens its original lifetime.',
      zh: '流式交互打开自身原始生命周期。'
    },
    streamChunk: {
      en: 'One item belongs to the original stream.',
      zh: '一个条目属于已经打开的原始流。'
    },
    streamClose: {
      en: 'The original stream ends, fails or closes.',
      zh: '原始流正常结束、失败或被关闭。'
    },
    cancel: {
      en: 'A cancellation observation concerns admitted work.',
      zh: '取消观察涉及已经准入的工作。'
    },
    control: {
      en: 'A protocol control observation carries no new business call.',
      zh: '协议控制观察不产生新的业务调用。'
    },
    lifecycle: {
      en: 'The event describes local lifecycle transitions.',
      zh: '该事件描述本地生命周期状态变化。'
    }
  }
)
dataType(
  'RpcProbeKind',
  'Numeric interaction kinds identify which original operation an event concerns.',
  '数字交互种类标识事件涉及的原始请求、流及控制操作。',
  {}
)
domain(
  'RpcProbeLifecycle',
  'interfaces',
  'Actual Session handshake, ready publication and closing supply lifecycle events.',
  '实际会话握手、就绪发布及关闭提供生命周期事件。',
  {
    handshake: {
      en: 'The physical subscription exists and the one handshake attempt is beginning.',
      zh: '真实物理订阅后开始握手。'
    },
    ready: {
      en: 'Actual negotiated identity has been admitted and published by the Session owner.',
      zh: '实际双边身份及目录准入后发布。'
    },
    closing: {
      en: 'The actual Session selected its terminal reason before releasing physical resources.',
      zh: '清理之前选定原终态原因。'
    }
  }
)
domain(
  'RpcProbeObservationKind',
  'interfaces',
  'Readonly facts use the same flow observer without a second pipeline.',
  '只读事实使用同一信息流观察者，不创建第二流水线。',
  {
    event: {
      en: 'A completed owner stage exposes borrowed facts without an intervention continuation.',
      zh: '借用阶段事实，由发出方补充序号及身份。'
    },
    descriptor: {
      en: 'Only actual installed source facts may describe the available observer capabilities.',
      zh: '仅实际来源及已安装保护事实。'
    }
  }
)
domain(
  'RpcProbeOutcome',
  'interfaces',
  'Numeric outcomes describe progress, admission and settlement at the observed stage.',
  '数字结果描述实际观察阶段中的操作进度、准入及最终结算。',
  {
    none: {
      en: 'No specific progress result applies to this event.',
      zh: '此事件不适用更具体的进度结果。'
    },
    created: {
      en: 'The original owner created the observed operation.',
      zh: '原所有者已经创建被观察的操作。'
    },
    sent: {
      en: 'The owning send boundary completed successfully.',
      zh: '所属发送边界已经成功完成发送。'
    },
    received: {
      en: 'The observing owner received the original value.',
      zh: '观察所有者已经收到原始输入值。'
    },
    admitted: {
      en: 'The original operation passed its admission checks.',
      zh: '原始操作已经通过自身准入检查。'
    },
    rejected: {
      en: 'The original operation failed its admission checks.',
      zh: '原始操作未能通过自身准入检查。'
    },
    settled: {
      en: 'The original operation completed its settlement.',
      zh: '原始操作已经完成自身结算过程。'
    },
    failed: {
      en: 'The observed original boundary completed with failure.',
      zh: '被观察的原始边界已经失败结束。'
    }
  }
)
dataType(
  'RpcProbeOutcome',
  'Numeric outcomes describe progress, admission and settlement at the observed stage.',
  '数字结果描述实际观察阶段中的操作进度、准入及最终结算。',
  {}
)
domain(
  'RpcProbeStage',
  'interfaces',
  'Stable numeric stages follow one operation from logical ownership to actual physical I/O.',
  '稳定数字阶段跟随一次操作，从逻辑所有权到实际物理读写。',
  {
    peer: {
      en: 'Peer lifecycle and local settlement observations.',
      zh: '对端生命周期及本地结算的观察阶段。'
    },
    message: {
      en: 'Logical application request or response observation.',
      zh: '应用逻辑请求或响应的观察阶段。'
    },
    envelope: {
      en: 'Normalized protocol envelope observation before encoding.',
      zh: '编码之前规范协议消息封装的观察阶段。'
    },
    encoded: {
      en: 'Encoded semantic payload observation before framing.',
      zh: '分帧之前已编码语义载荷的观察阶段。'
    },
    frame: {
      en: 'Physical frame observation before protection.',
      zh: '保护之前物理分帧结果的观察阶段。'
    },
    protected: {
      en: 'Protected carrier observation after signing or encryption.',
      zh: '签名或加密之后受保护传输对象的观察阶段。'
    },
    carrier: {
      en: 'Actual adapter send/receive observation at physical I/O.',
      zh: '物理读写中实际适配器发送接收的观察阶段。'
    }
  }
)
dataType(
  'RpcProbeStage',
  'Stable numeric stages follow one operation from logical ownership to actual physical I/O.',
  '稳定数字阶段跟随一次操作，从逻辑所有权到实际物理读写。',
  {}
)
domain(
  'RpcPortableField',
  'portable',
  'Reserved portable bytes tag discriminator and canonical data field.',
  '默认可移植字节标签的保留字段与判别值，供编码和严格准入识别规范字节数据。',
  {
    marker: {
      en: 'Reserved bytes tag marker key.',
      zh: '保留标记字段名为 `$rpc`，用于识别默认可移植字节标签。'
    },
    data: {
      en: 'Canonical unpadded visible-byte encoding field.',
      zh: '规范字节内容放在 `base64url` 字段，使用无填充编码。'
    },
    kind: {
      en: 'Only the bytes tag discriminator.',
      zh: '标记字段的字节判别值为 `bytes`，不表示任意对象可作字节输入。'
    }
  }
)
domain(
  'RpcPortableViolation',
  'portable',
  'Pure portable failures preserve original binary, ancestor and prototype causes.',
  '纯可移植准入的失败类别，区分二进制、循环祖先与不受支持原型等具体原因。',
  {}
)
domain(
  'RpcContractErrorCode',
  'errors',
  'The pure Contract package owns semantic codes for field admission, handshake selection and wire-error graph validation.',
  '纯契约包维护的语义错误码，标识字段准入、握手协商与错误图校验失败。',
  {
    callbackFailed: {
      en: '`CALLBACK_FAILED`: a warning, scheduler or cleanup callback failed without prior semantic identity. Native mutable errors retain identity, type and stack; other values stay on cause. Safe wire summaries do not expose callback text.',
      zh: '`CALLBACK_FAILED`：警告、计时或清理回调失败且没有既有语义身份；可修改原生错误保留身份、类型及堆栈，其它值保留在原因链；安全线上摘要不泄漏回调文本。'
    },
    invalidDescriptor: {
      en: '`INVALID_DESCRIPTOR`: invalid stable component identity/version; correct local configuration.',
      zh: '`INVALID_DESCRIPTOR`：稳定组件身份或版本非法，修正本地配置。'
    },
    invalidEnvelope: {
      en: '`INVALID_ENVELOPE`: reject the invalid semantic message without executing it.',
      zh: '`INVALID_ENVELOPE`：拒绝无效语义消息，不执行其中业务。'
    },
    invalidStream: {
      en: '`INVALID_STREAM`: reject the invalid event, sequence or value budget and terminate only its stream.',
      zh: '`INVALID_STREAM`：拒绝无效事件、序号或值预算，只终止所属流。'
    },
    invalidFrame: {
      en: '`INVALID_FRAME`: discard malformed physical or empty batch framing.',
      zh: '`INVALID_FRAME`：丢弃异常物理分帧或空攒批包装。'
    },
    frameLimitExceeded: {
      en: '`FRAME_LIMIT_EXCEEDED`: complete physical or retained reassembly bytes exceeded a bound.',
      zh: '`FRAME_LIMIT_EXCEEDED`：完整物理表示或保留重组字节超过边界。'
    },
    frameAssemblyExpired: {
      en: '`FRAME_ASSEMBLY_EXPIRED`: not all ordered fragments arrived before the assembly timer.',
      zh: '`FRAME_ASSEMBLY_EXPIRED`：重组计时到期前未收到全部有序分片。'
    },
    invalidWireError: {
      en: '`INVALID_WIRE_ERROR`: reject the malformed bounded serialized error tree.',
      zh: '`INVALID_WIRE_ERROR`：拒绝格式异常的有界序列化错误树。'
    },
    handshakeInvalid: {
      en: '`HANDSHAKE_INVALID`: malformed encoding, JSON or first-channel negotiation fields.',
      zh: '`HANDSHAKE_INVALID`：编码、对象文本或首通道协商字段异常。'
    },
    handshakeIncompatible: {
      en: '`HANDSHAKE_INCOMPATIBLE`: peer protocol, version or mandatory runtime baseline is incompatible.',
      zh: '`HANDSHAKE_INCOMPATIBLE`：对端协议、版本或必需运行基线不兼容。'
    },
    handshakeRejected: {
      en: '`HANDSHAKE_REJECTED`: the remote rejected negotiation; inspect the retained remote cause.',
      zh: '`HANDSHAKE_REJECTED`：远端拒绝协商，检查保留的远端原因。'
    },
    extensionNegotiationFailed: {
      en: 'A required extension is unavailable or received extension traffic was not negotiated. R6 / BC2 rejects it before application execution; configure compatible extensions.',
      zh: '实际必需扩展无法共同选定。'
    }
  }
)
domain(
  'RpcCoreErrorCode',
  'errors',
  'Stable semantic failure codes owned by the runtime-neutral Core execution layer.',
  '运行时中立核心执行层拥有的稳定语义失败码。',
  {
    hostTransportMissing: {
      en: 'Exactly one genuine transport is required before opening.',
      zh: '打开前必须提供一个真实传输。'
    },
    hostNamespaceDuplicate: {
      en: 'R3 / BC1 rejects duplicate transport namespaces before acquisition; choose distinct names.',
      zh: '冷批次宿主命名空间重名。'
    },
    featureCombinationConflict: {
      en: 'R8 / A8 rejects two same-kind call features on one plugin; keep one complete instance.',
      zh: '实际完整特性组合冲突。'
    },
    hostPluginInvalid: {
      en: 'A copied or fabricated object lacks registered SDK identity.',
      zh: '复制或伪造对象不具备作者工具登记身份。'
    },
    hostPeerNameDuplicate: {
      en: 'A same-name peer is responsive, or its one probe is already pending; reject the newcomer.',
      zh: '同名对端仍响应，或其唯一探测尚未完成，拒绝新连接。'
    },
    callbackFailed: {
      en: 'CALLBACK_FAILED: a construction or diagnostic callback failed; native mutable errors retain type, stack and identity, foreign semantic identities stay unchanged, and other values remain on cause.',
      zh: '回调失败错误：构造或诊断回调失败；可修改原生错误保留类型、堆栈及身份，外部语义身份保持不变，其它值保留在原因链。'
    },
    providerGenerationMismatch: {
      en: 'PROVIDER_GENERATION_MISMATCH: accepted caller/provider generation no longer matches the task; select the actual binding again.',
      zh: '提供方世代不匹配：已接受调用方或提供方世代与任务不符，应重新选择实际绑定。'
    },
    forwardLoop: {
      en: 'FORWARD_LOOP: signed route revisits this or the selected next Host; choose another route.',
      zh: '转发环路错误：签名路由再次访问当前或下一宿主，应选择其他路由。'
    },
    forwardHopLimit: {
      en: 'FORWARD_HOP_LIMIT: three forwarding nodes were already visited; use a direct channel or shorter route.',
      zh: '转发跳数超限：已经访问三个转发节点，应使用直接通道或更短路由。'
    },
    capabilityUnsupported: {
      en: 'CAPABILITY_UNSUPPORTED: actual peer agreement does not support the requested runtime mode or capability.',
      zh: '能力不支持错误：实际对端协议不支持请求的运行模式或能力。'
    },
    invalidConfig: {
      en: 'INVALID_CONFIG: factory, component, transport or transform configuration is invalid; inspect detail and correct local inputs.',
      zh: '配置非法错误：工厂、组件、传输对象或转换配置无效，应检查细节并修正本地输入。'
    },
    probeFailed: {
      en: 'PROBE_FAILED: a diagnostic emit/describe/redact callback failed; business execution remains isolated.',
      zh: '诊断失败错误：观察、描述或脱敏回调失败，业务执行保持隔离。'
    },
    providerDuplicated: {
      en: 'PROVIDER_DUPLICATED: provide registered a method that already has an owner; change the method or combine providers.',
      zh: '提供方重复错误：登记方法已经有所有者，应改名或合并提供方。'
    },
    protocolInvalid: {
      en: 'PROTOCOL_INVALID: codec/protocol/envelope behavior or correlated control is invalid; inspect original cause.',
      zh: '协议非法错误：编解码、消息封装行为或关联控制非法，应检查原始原因。'
    },
    contractInvalid: {
      en: 'CONTRACT_INVALID: method correlation, direction or contract identity fields violate the actual request contract.',
      zh: '契约非法错误：方法关联、方向或契约身份字段违反实际请求契约。'
    },
    payloadInvalid: {
      en: 'PAYLOAD_INVALID: data, physical batch encoding or error projection violates its selected codec boundary.',
      zh: '载荷非法错误：数据、物理攒批编码或错误投影违反所选编解码边界。'
    },
    providerNotFound: {
      en: 'PROVIDER_NOT_FOUND: the receiving endpoint has no registered provider for the requested method.',
      zh: '提供方不存在错误：接收端没有为所请求方法登记提供方。'
    },
    internal: {
      en: 'INTERNAL: provider threw unexpectedly; original error stays in local diagnostics while the peer receives a redacted failure.',
      zh: '内部错误：提供方发生意外抛错，原错误保留在本地诊断，对端收到脱敏失败。'
    },
    targetUnknown: {
      en: 'TARGET_UNKNOWN: target or receiver is unresolved, inactive or outside the original selected binding.',
      zh: '目标未知错误：目标或接收端未解析、不活动或不在原选定绑定内。'
    },
    endpointDisposed: {
      en: 'ENDPOINT_DISPOSED: an operation used a disposed endpoint; construct a new owner instead.',
      zh: '端点已释放错误：操作使用已释放端点，应构造新的所有者。'
    },
    cancelled: {
      en: 'CANCELLED: actual caller AbortSignal cancelled the local send; remote effects may already have occurred.',
      zh: '取消错误：实际调用方信号取消本地发送，远端效果可能已经发生。'
    },
    deadlineExceeded: {
      en: 'DEADLINE_EXCEEDED: the local operation deadline expired; treat this transmission attempt as failed.',
      zh: '截止超时错误：本地操作截止已经到期，本次传输尝试视为失败。'
    },
    contextExpired: {
      en: 'PROVIDER_CONTEXT_EXPIRED: success or failed was called after the original provider lifetime ended; no wire effect is produced.',
      zh: '提供方上下文过期错误：生命周期结束后调用结果方法，不产生线上效果。'
    },
    transport: {
      en: 'TRANSPORT: actual physical send or terminal channel failed; preserve original transport evidence before choosing recovery. The code alone never proves nonexecution; retry requires independent evidence or idempotency/outcome reconciliation.',
      zh: '传输错误：实际物理发送或通道终止失败，恢复前保留原传输对象证据；单凭此码不能证明未执行，重试须有独立证据或幂等结果核对。'
    },
    authenticationFailed: {
      en: 'AUTHENTICATION_FAILED: signing, verification, encryption, decryption or original replay binding failed; details stay local.',
      zh: '认证失败错误：签名、校验、加密、解密或原重放绑定失败，细节保持本地。'
    },
    schemaInvalid: {
      en: 'SCHEMA_INVALID: params/result parse rejected the method data; inspect normalized issues and original cause.',
      zh: '结构非法错误：入参或结果解析拒绝方法数据，应检查规范问题及原始原因。'
    },
    capabilityConflict: {
      en: 'CAPABILITY_CONFLICT: selected middleware/features publish conflicting keys or an ambiguous runtime instance.',
      zh: '能力冲突错误：所选中间件或功能发布冲突键，或运行实例有歧义。'
    },
    overloaded: {
      en: 'OVERLOADED: execution/replay/discovery/chunk capacity refused new work; inspect its independent reason channel.',
      zh: '过载错误：执行、重放、发现或分片容量拒绝新工作，应检查独立原因通道。'
    },
    streamResultUnknown: {
      en: 'STREAM_RESULT_UNKNOWN: transport may have sent a stream frame before rejecting; open a new stream without replaying items.',
      zh: '流结果未知错误：传输对象可能已发送帧后拒绝，应新建流，不重放条目。'
    },
    chunkInvalid: {
      en: 'CHUNK_INVALID: physical fragment grammar is invalid; hooks observe it and the frame is not replayed.',
      zh: '分片非法错误：物理分片语法非法，钩子观察该错误且不重放帧。'
    },
    propertyReadFailed: {
      en: 'PROPERTY_READ_FAILED: a getter/proxy failed without a valid synchronous reporter, or that reporter threw.',
      zh: '属性读取失败错误：读取器或代理失败且无有效同步上报，或上报自身抛错。'
    },
    idempotencyResultUnavailable: {
      en: 'IDEMPOTENCY_RESULT_UNAVAILABLE: business already ran but result was not retained; resolve outcome before another attempt.',
      zh: '幂等结果不可用错误：业务已执行但结果未保留，再次尝试前须确定结果。'
    },
    stringConversionFailed: {
      en: 'STRING_CONVERSION_FAILED: conversion or its required synchronous reporter failed; preserve original cause.',
      zh: '字符串转换失败错误：转换或所需同步上报失败，应保留原始原因。'
    }
  }
)
domain(
  'RpcErrorFamily',
  'errors',
  'Stable native Error.name families are diagnostics, not local operation authority.',
  '稳定原生错误名称家族是诊断，不是本地操作权限。',
  {
    rpc: {
      en: 'Base coded Core failure used by generic caller admission.',
      zh: '基础远程调用错误家族，可携带具体核心错误码与原原因。'
    },
    schema: {
      en: 'Schema admission failure retains its original data and cause.',
      zh: '数据模式校验错误家族，保留校验详情与原输入失败原因。'
    },
    configuration: {
      en: 'Invalid endpoint configuration remains a Core error family.',
      zh: '配置错误家族，表示实际公开配置不符合所属所有者要求。'
    },
    construction: {
      en: 'Partial construction failure preserves cleanup and the original cause.',
      zh: '构造失败家族，保留最初失败以及有序回滚清理错误。'
    },
    lifecycle: {
      en: 'Endpoint lifecycle failure preserves its cleanup details.',
      zh: '生命周期失败家族，描述真实安装或释放过程并保留原错误链。'
    },
    serialization: {
      en: 'Encoding and portable payload failures belong to this native family.',
      zh: '序列化错误家族，保留无法投影的字段与原读取失败原因。'
    },
    protocol: {
      en: 'Protocol validation keeps its Core family identity.',
      zh: '协议错误家族，表示线上字段或交互不符合受支持契约。'
    },
    contract: {
      en: 'Method contract failures retain their original Core identity.',
      zh: '纯契约错误家族，表示数据准入或协商失败而非运行权限。'
    },
    transport: {
      en: 'Physical transport failure remains distinguishable from a remote rejection.',
      zh: '传输错误家族，保留所属原生交付失败及其原始原因。'
    },
    authentication: {
      en: 'Authentication failures preserve the original coded Core class.',
      zh: '认证错误家族，表示实际认证所有者拒绝凭证或保护结果。'
    },
    chunk: {
      en: 'Chunk and reassembly failures retain their Core native family.',
      zh: '分片错误家族，表示实际分片处理违反其限额或重组契约。'
    },
    remote: {
      en: 'Received remote failures keep arbitrary remote codes and their own family.',
      zh: '远端诊断错误家族，保留远端字符串码、详情及原原因。'
    },
    abort: {
      en: 'Cancellation uses the standard AbortError name for cross-realm restoration.',
      zh: '中止诊断家族，保持标准名称并保留触发取消的原原因。'
    },
    timeout: {
      en: 'Deadline failure uses the standard TimeoutError name for cross-realm restoration.',
      zh: '完整逐尝试期限运行实例。'
    }
  }
)
domain(
  'RpcErrorReachLimit',
  'errors',
  'Bound on visiting original JavaScript error graph objects, separate from wire node limits.',
  '原始脚本错误图访问边界，与线上节点限制分开。',
  {
    maxObjects: {
      en: 'Visit at most 4096 original object identities while traversing causes and aggregate entries.',
      zh: '遍历原因和聚合条目时最多访问四千零九十六个原始对象身份。'
    }
  }
)
domain(
  'RpcJsonRpcWireError',
  'errors',
  'Retained diagnostic extension/source vocabulary; no JSON-RPC parser or mapping operation is exported.',
  '保留诊断扩展及来源词汇，不导出旧协议解析器或映射操作。',
  {
    dataKey: {
      en: 'Store the canonical wire error under data.migaiaWireError.',
      zh: '把规范线上错误存放在数据中的专用错误字段。'
    },
    foreignSource: {
      en: 'Use jsonrpc-2.0 when a foreign error has no canonical embedded tree.',
      zh: '外部错误没有嵌入规范树时使用固定外部来源。'
    }
  }
)
domain(
  'RpcProviderRejectionReason',
  'errors',
  'Actual local provider refusal branches sharing the public overload/capacity failure channel.',
  '共享公开过载容量失败通道的实际本地提供方拒绝分支。',
  {
    orderedQueueFull: {
      en: 'Waiting plus running ordered work exhausted the original provider quota.',
      zh: '等待和运行中的有序工作耗尽原提供方配额。'
    },
    groupConcurrency: {
      en: 'The complete group could not reserve every step execution lease.',
      zh: '完整分组不能为全部步骤预留执行租约。'
    },
    groupReplayFull: {
      en: 'The complete group could not reserve every original replay entry.',
      zh: '完整分组不能预留全部原始重放条目。'
    },
    concurrency: {
      en: 'Global or actual verified-peer execution concurrency is full.',
      zh: '全局或实际已验证对端的执行并发已满。'
    },
    replayLedgerFull: {
      en: 'Inbound request tombstones cannot retain another original identity.',
      zh: '入站请求标识记录已满，无法再保留新的请求身份。'
    },
    outboundReplayFull: {
      en: 'Active outbound identities and tombstones exhausted their ceiling.',
      zh: '活动请求和已结束请求的出站标识记录已达到保留上限。'
    },
    bindingExpired: {
      en: 'The actual verified binding expired before provider execution started.',
      zh: '实际已验证绑定在提供方开始执行前过期。'
    }
  }
)
dataType(
  'RpcProviderRejectionReason',
  'Actual local provider refusal branches sharing the public overload/capacity failure channel.',
  '共享公开过载容量失败通道的实际本地提供方拒绝分支。',
  {}
)
domain(
  'RpcWireErrorFallback',
  'errors',
  'Stable projection for thrown values without complete semantic error identity.',
  '没有完整语义错误身份的抛出值所用稳定投影。',
  {
    source: {
      en: 'Use unknown when the thrown value supplies no semantic package source.',
      zh: '抛出值没有语义包来源时使用未知来源。'
    },
    code: {
      en: 'Use UNKNOWN when the thrown value supplies no semantic code.',
      zh: '抛出值没有语义错误码时使用未知错误码。'
    },
    name: {
      en: 'Use Error when a thrown value has no usable native class name.',
      zh: '抛出值没有可用原生类名时使用通用错误名称。'
    },
    nonErrorMessage: {
      en: 'Use non-error value thrown when an unstructured throw has no readable message.',
      zh: '非结构化抛出值没有可读消息时使用固定诊断文本。'
    }
  }
)
domain(
  'RpcWireErrorLimit',
  'errors',
  'Shared serializer and validator limits for bounded cross-realm error graphs.',
  '错误树与平面错误图共用的节点、文本和字节预算，保证跨域诊断投影保持有界。',
  {
    maxNesting: {
      en: 'At most 48 total structural nesting levels are admitted.',
      zh: '允许的总结构嵌套层数最多为四十八。'
    },
    maxEmbeddingDepth: {
      en: 'At most 16 error embedding levels are admitted.',
      zh: '允许的错误嵌入层数最多为十六。'
    },
    maxNodes: {
      en: 'At most 1024 error nodes cross one wire boundary.',
      zh: '一次线上边界最多传递一千零二十四个错误节点。'
    },
    maxStringBytes: {
      en: 'Each sanitized string has at most 65536 UTF-8 bytes.',
      zh: '每个清理后的字符串最多为六万五千五百三十六字节。'
    },
    maxBytes: {
      en: 'The complete error payload is limited to 1048576 bytes.',
      zh: '完整错误载荷最多为一百零四万八千五百七十六字节。'
    }
  }
)
domain(
  'RpcWireErrorUnknownFieldMode',
  'errors',
  'Received error-node policy for fields added by another peer version.',
  '接收错误节点时处理其他版本新增字段的策略。',
  {
    reject: {
      en: 'Reject extra error-node fields with INVALID_WIRE_ERROR.',
      zh: '遇到额外错误节点字段时以编码错误拒绝。'
    },
    ignore: {
      en: 'Ignore unknown fields while optionally invoking the warning callback.',
      zh: '忽略未知字段，同时可调用警告回调。'
    }
  }
)
dataType(
  'RpcWireErrorUnknownFieldMode',
  'Received error-node policy for fields added by another peer version.',
  '接收错误节点时处理其他版本新增字段的策略。',
  {}
)
domain(
  'RpcWireErrorViolation',
  'errors',
  'Stable first-failure classifications for serialized error validation.',
  '序列化错误校验的首个失败类别，结合指针定位具体违规字段而不反射原输入。',
  {
    read: {
      en: 'Reading a property failed; retain the original getter cause.',
      zh: '读取属性失败，保留原始读取器原因。'
    },
    type: {
      en: 'The received value has an unsupported native or scalar type.',
      zh: '接收值具有不支持的原生或标量类型。'
    },
    required: {
      en: 'A required protocol-owned field is absent or invalid.',
      zh: '协议拥有的必需字段缺失或无效。'
    },
    unknownField: {
      en: 'An extra field is forbidden by the selected closed grammar.',
      zh: '额外字段被所选封闭语法禁止。'
    },
    emptyErrors: {
      en: 'An aggregate child list is present but empty.',
      zh: '聚合子错误列表存在但没有任何条目。'
    },
    truncatedValue: {
      en: 'The truncation marker is not the literal true value.',
      zh: '截断标记不是规定的真值字面量。'
    },
    dataPortable: {
      en: 'Error data cannot be admitted as legacy portable wire data.',
      zh: '错误数据无法作为传统可移植线上数据接纳。'
    },
    depth: {
      en: 'Error nesting or embedding exceeded its fixed depth ceiling.',
      zh: '错误嵌套或嵌入超过固定深度上限。'
    },
    nodes: {
      en: 'The error graph exceeded its admitted node count.',
      zh: '错误图超过允许接纳的节点数量。'
    },
    surrogate: {
      en: 'A wire string contains an unpaired UTF-16 surrogate.',
      zh: '线上字符串含有未配对的代理字符。'
    },
    stringBytes: {
      en: 'One string exceeds its fixed UTF-8 byte ceiling.',
      zh: '单个字符串超过固定编码字节上限。'
    },
    dataBytes: {
      en: 'Portable error data exceeds its admitted byte budget.',
      zh: '可移植错误数据超过允许字节预算。'
    },
    totalBytes: {
      en: 'The complete serialized error exceeds its total byte budget.',
      zh: '完整序列化错误超过总字节预算。'
    },
    jsonRpcShape: {
      en: 'The foreign JSON-RPC error object has invalid shape.',
      zh: '外部调用协议错误对象的形态非法。'
    },
    jsonRpcCode: {
      en: 'The foreign JSON-RPC numeric code is not valid.',
      zh: '外部调用协议数字错误码无效。'
    }
  }
)
dataType(
  'RpcWireErrorViolation',
  'Stable first-failure classifications for serialized error validation.',
  '序列化错误校验的首个失败类别，结合指针定位具体违规字段而不反射原输入。',
  {}
)
domain(
  'RpcAuthenticationRejectionReason',
  'error-code',
  'Handshake authentication rejection reasons distinguish an absent session from an invalid challenge; these values are diagnostic data.',
  '认证握手拒绝的具体原因，区分缺失会话与挑战字段非法，供诊断记录使用。',
  {
    sessionUnknown: {
      en: 'Receiver discarded or never issued this challenge; discard the cached challenge only.',
      zh: '真实认证挑战会话不存在。'
    },
    challengeInvalid: {
      en: 'Signed challenge fields have invalid grammar or direction; repair the frame contract.',
      zh: '真实认证挑战绑定无效。'
    }
  }
)
dataType(
  'RpcAuthenticationRejectionReason',
  'Handshake authentication rejection reasons distinguish an absent session from an invalid challenge; these values are diagnostic data.',
  '认证握手拒绝的具体原因，区分缺失会话与挑战字段非法，供诊断记录使用。',
  {}
)
domain(
  'RpcBrowserErrorCode',
  'error-code',
  'Browser-native configuration, source and connection failures retain their original native error and cause chain.',
  '浏览器原生载体的配置、来源及连接失败分类；应同时保留对应原生错误和原因链。',
  {
    windowOriginRequired: {
      en: 'Requires a nonempty explicit Window origin; provide the destination origin before connecting.',
      zh: '窗口连接缺少必需显式来源。'
    },
    rtcChannelUnreliable: {
      en: 'Requires ordered reliable RTC delivery; use a reliable channel or the Endpoint API.',
      zh: '实时数据通道不满足可靠有序要求。'
    },
    listenerAlreadyBound: {
      en: 'Allows one active listener per SharedWorker scope; close or reuse that listener first.',
      zh: '同一原生监听资源已绑定。'
    },
    invalidPeerSource: {
      en: 'Rejects conflicting or unsupported sources; supply one concrete connect source or listen scope.',
      zh: '浏览器原生对端的来源配置无效，不能据此建立连接。'
    },
    messageDecodeFailed: {
      en: 'Rejects malformed RTC JSON and retains the decoder cause; correct the remote wire input.',
      zh: '实际原生消息解码失败。'
    }
  }
)
domain(
  'RpcCoroutineErrorCode',
  'error-code',
  'Coroutine tasks, borrowed message ports and parent-child connections have distinct diagnostics; a code grants no generation control.',
  '协程任务、借用消息端口及父子连接的诊断分类；错误码本身不授予代际控制权。',
  {
    sourceInvalid: {
      en: 'Supply exactly one callable task or a genuine connection received by that task generation.',
      zh: '实际协程来源选择无效。'
    }
  }
)
domain(
  'RpcDevtoolsErrorCode',
  'error-code',
  'Collector, readonly service and recording failures retain the original service or storage cause instead of replacing it.',
  '调试收集、只读服务查询及记录文件的失败分类，使用时保留原服务或存储错误。',
  {
    serviceResultInvalid: {
      en: 'Captured service data cannot be encoded; inspect cause or disable content exposure.',
      zh: '调试服务返回值不符合查询结果契约，不能作为有效快照使用。'
    },
    invalidOption: {
      en: 'Collector options violate their supported domain; fix the option before construction.',
      zh: '调试收集器或记录会话的初始化选项不符合公开要求。'
    },
    closed: {
      en: 'Collector is closed; create a new instance rather than reviving retained resources.',
      zh: '调试收集器已经关闭，不能再接受新的收集操作。'
    },
    recordActive: {
      en: 'A recording already owns the collector; stop it before starting another.',
      zh: '已有记录会话正在运行，不能再次启动同一收集器的记录。'
    },
    recordNotActive: {
      en: 'No recording remains active; start one before stopping it.',
      zh: '尚无活动记录会话，不能执行要求已有记录的操作。'
    },
    recordFormatInvalid: {
      en: 'Record header or NDJSON is invalid; inspect cause and supply a version-1 record.',
      zh: '读取的调试记录格式无效，不能按受支持记录导入。'
    },
    redactFailed: {
      en: 'Redaction failed; report the original cause and discard content (collector).',
      zh: '调用方提供的脱敏函数执行失败，原失败保留在原因链上。'
    }
  }
)
domain(
  'RpcPoolErrorCode',
  'error-code',
  'Logical member-pool configuration, queuing, calls and cleanup have distinct failure codes; these never replace native supervision facts.',
  '逻辑成员池的配置、排队、调用及关闭失败分类，不替代原生成员的监管事实。',
  {
    invalidOptions: {
      en: 'Invalid construction or resize arguments are rejected before any native acquisition.',
      zh: '逻辑成员池配置不符合公开约束，创建时即拒绝。'
    },
    transportUnsupported: {
      en: 'Listener and parent-only sources cannot open independent members; choose spawn or connect.',
      zh: '实际传输不支持池来源。'
    },
    poolClosed: {
      en: 'Closing/closed admission rejects new calls, first stream next or resize; create another pool.',
      zh: '逻辑成员池已经关闭，不能再向其提交新调用。'
    },
    queueFull: {
      en: 'All available slots are reserved and the bounded FIFO is full; the new call never reaches a Peer.',
      zh: '成员池等待队列达到容量，当前调用不能继续排队。'
    },
    callAborted: {
      en: 'Queued cancellation removes only its FIFO entry; a native AbortError retains the signal reason on cause.',
      zh: '成员池中的调用被其真实取消信号中止，原原因保持可达。'
    },
    closeFailed: {
      en: 'Final close attempted all members but retained one or more close failures, including earlier retirement failures. Inspect AggregateError.errors/cause; the pool is terminal, not reopened.',
      zh: '成员池关闭时释放成员或资源失败，原清理错误保持可达。'
    }
  }
)
domain(
  'RpcProcessErrorCode',
  'error-code',
  'Native process launch, connection, handshake and supervision failures have stable diagnostic codes; remote codes grant no local authority.',
  '进程原生启动、连接、握手及监管的稳定诊断分类，不把远端诊断当作本地控制授权。',
  {
    usageSampleFailed: {
      en: 'Native PID sampling failed; report its cause and display unavailable without retrying.',
      zh: '真实原生用量采样失败。'
    },
    hostInvalidOption: {
      en: 'Host options are invalid before launch; callers must correct the named field.',
      zh: '进程宿主的原生来源或策略配置无效，不能开始获取资源。'
    },
    hostClosed: {
      en: 'Facade release has begun; callers must create a new facade instead of enqueueing work.',
      zh: '进程宿主已经关闭，拒绝启动或附接新的原生连接。'
    },
    handshakeTimeout: {
      en: 'Handshake exceeded its scheduler deadline; caller must open a new channel.',
      zh: '进程原生启动握手未在其所属预算内完成，连接被拒绝。'
    },
    authRejected: {
      en: 'Peer authorization failed; caller must not retry without valid credentials.',
      zh: '进程启动认证校验拒绝实际凭证，不能发布该连接。'
    },
    channelClosed: {
      en: 'A closed channel rejected work or its close observer/resource cleanup failed; inspect cause/errors.',
      zh: '进程原生通信通道已关闭，后续读写不能继续进行。'
    },
    connectFailed: {
      en: 'Dial or launch could not establish a channel; caller may inspect the original cause.',
      zh: '实际进程连接获取失败，原生连接错误保留在原因链。'
    },
    listenFailed: {
      en: 'The requested local listener could not bind; caller must choose an available address.',
      zh: '实际进程监听器启动失败，原生监听错误保留在原因链。'
    },
    pluginInvalidOption: {
      en: 'Invalid process-plugin options are rejected before launch; caller must correct the named field.',
      zh: '进程传输插件的公开选项无效，安装前即拒绝该定义。'
    },
    resilienceInvalidOption: {
      en: 'Invalid resilience limits, ownership, or health configuration; correct the named field before opening a connection.',
      zh: '进程恢复策略的公开参数无效，不能开始监管行为。'
    },
    connectionLimit: {
      en: 'A connection, call-rate, or payload limit rejected admission before provider execution.',
      zh: '进程监听器达到已配置连接容量，拒绝接纳新连接。'
    },
    instanceUnhealthy: {
      en: 'A shared target is suspended after an explicit instance-health event until a ready replacement exists.',
      zh: '被监管的进程实例未满足健康要求，由原生监管者处理。'
    },
    healthPingFailed: {
      en: 'An enabled native health ping returned false before its supervision deadline; the owner must restart the unit.',
      zh: '真实健康控制交换失败。'
    },
    terminalCall: {
      en: 'A terminal registration rejects new remote calls before they reach its inactive generation.',
      zh: '实际监管来源处于终态。'
    },
    liquidated: {
      en: 'A liquidated registration cannot restart; the caller must create a new registration.',
      zh: '进程监管资源已清退，不能再次借用其原生连接。'
    }
  }
)
domain(
  'RpcRemoteLayerErrorCode',
  'error-code',
  'Stable remote-layer errors and caller recovery actions.',
  '稳定的远程层错误及调用方恢复方式，区分契约错误、未接纳与结果未知。',
  {
    runtimeEventOverflow: {
      en: 'More than 100 unread passive events; query current state and resubscribe.',
      zh: '被动事件未读数量超过一百，应查询当前状态后重新订阅。'
    },
    contractInvalid: {
      en: 'Description or control payload is invalid; correct it before retry.',
      zh: '描述或控制负载不合法，修正后再重试。'
    },
    hostNotAdopted: {
      en: 'This connection lacks live adoption; perform host use before removal.',
      zh: '本连接尚未接纳当前登记，移除前先执行宿主安装接纳。'
    },
    startFailed: {
      en: 'Unit preparation or channel acquisition failed; inspect the cause.',
      zh: '执行单元准备或通道获取失败，应检查原始原因。'
    },
    closed: {
      en: 'Registration was released or generation left; wait for valid readiness.',
      zh: '登记已释放或代次已离开，应等待有效就绪状态。'
    },
    resultUnknown: {
      en: 'A sent request lost its result after departure; reconcile before repeating a non-idempotent operation.',
      zh: '已发送请求在离开后丢失结果，应先核对再重复非幂等操作。'
    }
  }
)
domain(
  'RpcThreadErrorCode',
  'error-code',
  'Worker-thread startup, messaging and shutdown diagnostics preserve the original thread failure and stack.',
  '工作线程启动、消息通道及关闭的诊断分类，原线程错误与堆栈仍应保留。',
  {
    usageSampleFailed: {
      en: 'Native Worker sampling failed; retain its cause and display unavailable.',
      zh: '真实原生用量采样失败。'
    }
  }
)

/** Complete field vocabulary borrows the corresponding canonical data member meaning. */
enums.RpcWireField = {
  ...enums.RpcWireField!,
  values: {
    ...enums.RpcWireField!.values,
    auth: types.IRpcHello!.members.auth!.summary,
    steps: types.IRpcEnvelope!.members.steps!.summary,
    operation: t(
      'The selected outcome lookup/result or control ping/pong/drain operation in its closed record.',
      '对应闭合记录中选定的结果查询操作或健康排空控制操作。'
    ),
    state: t(
      'Group success/failure/not-executed or outcome pending/unknown/done, according to its enclosing record.',
      '按所在记录表示分组成功、失败、未执行，或查询待决、未知及完成。'
    ),
    store: types.IRpcOutcomeLookupResult!.members.store!.summary,
    mode: types.IRpcTask!.members.mode!.summary,
    value: t(
      'Mode-dependent portable value or generation ordinal in its own closed record.',
      '在自身闭合记录中按模式确定的可移植值或代际序号。'
    ),
    timeoutMs: t(
      'Retained scalar vocabulary; not an allowed local timeout instance or numeric option on wire call options.',
      '保留的标量词汇，不允许把本地超时实例或数字选项写入线上调用选项。'
    ),
    ok: types.IRpcCompletion!.members.ok!.summary,
    seq: types.IRpcStreamEvent!.members.seq!.summary,
    epoch: types.IRpcOutcomeStore!.members.epoch!.summary,
    continuity: types.IRpcOutcomeStore!.members.continuity!.summary,
    root: types.IRpcWireError!.members.root!.summary,
    nodes: types.IRpcWireError!.members.nodes!.summary,
    cause: types.IRpcWireErrorNode!.members.cause!.summary,
    errors: types.IRpcWireErrorNode!.members.errors!.summary,
    step: types.IRpcHello!.members.step!.summary,
    versions: types.IRpcHello!.members.versions!.summary,
    codecs: types.IRpcHello!.members.codecs!.summary,
    requiredExtensions: types.IRpcHello!.members.requiredExtensions!.summary,
    peer: types.IRpcHello!.members.peer!.summary,
    runtime: types.IRpcPeerInfo!.members.runtime!.summary,
    runtimeVersion: types.IRpcPeerInfo!.members.runtimeVersion!.summary,
    implementation: types.IRpcPeerInfo!.members.implementation!.summary,
    directory: types.IRpcHello!.members.directory!.summary,
    schemaVersion: types.IRpcDirectory!.members.schemaVersion!.summary,
    instanceId: t(
      'Actual Host instance id issued by its identity owner, distinct from display name.',
      '实际宿主身份所有者签发的实例标识，与显示名称分开。'
    ),
    supportedModes: types.IRpcMethodDescription!.members.supportedModes!.summary,
    modeSource: types.IRpcMethodDescription!.members.modeSource!.summary,
    idempotent: types.IRpcMethodDescription!.members.idempotent!.summary,
    forwardedVia: types.IRpcMethodDescription!.members.forwardedVia!.summary,
    input: types.IRpcMethodDescription!.members.input!.summary,
    output: types.IRpcMethodDescription!.members.output!.summary,
    yield: types.IRpcMethodDescription!.members.yield!.summary,
    manifest: types.IRpcPreparedMessage!.members.manifest!.summary,
    storage: types.IRpcBinaryManifest!.members.storage!.summary,
    envelope: types.IRpcBinaryManifest!.members.envelope!.summary,
    backings: types.IRpcBinaryManifest!.members.backings!.summary,
    byteLength: t(
      'Intrinsic complete backing length recorded by its actual native owner.',
      '实际原生所有者记录的内在完整背板长度。'
    ),
    sha256: t(
      'Actual complete backing SHA-256 digest; Contract checks text shape but does not compute the digest.',
      '实际完整背板摘要，契约检查文本形态但不计算摘要。'
    )
  }
}
enums.RpcWireKind = {
  ...enums.RpcWireKind!,
  values: {
    ...enums.RpcWireKind!.values,
    call: t(
      'Invoke request, notify or stream according to task.mode.',
      '按任务模式发起请求、通知或流。'
    ),
    result: t(
      'Successful correlated terminal; actual undefined is omitted.',
      '成功关联终态，实际未定义值省略。'
    ),
    error: t(
      'Failed correlated terminal carries the flat error graph.',
      '失败关联终态携带平面错误图。'
    ),
    cancel: t(
      'Cancel the exact original task, including a written notify.',
      '取消精确原任务，包含已写出的通知。'
    ),
    control: t(
      'Actual ping, pong or drain without provider invocation.',
      '不调用提供方的实际健康及排空控制。'
    ),
    directory: t(
      'Replace accepted method metadata without reserved describe RPC.',
      '替换准入方法元数据，不执行保留描述调用。'
    )
  }
}
enums.RpcPortableViolation = {
  ...enums.RpcPortableViolation!,
  values: {
    invalid: t(
      'Unsupported portable domain or malformed reserved tag.',
      '不支持的可移植值域或非法保留标签。'
    ),
    rawBinary: t(
      'Original binary callback failure is thrown unchanged.',
      '原二进制回调失败原样抛出。'
    ),
    ancestor: t(
      'Original ancestor traversal failure remains unchanged.',
      '原祖先遍历失败保持不变。'
    ),
    prototype: t(
      'Prototype trap receives a Contract wrapper with the original cause.',
      '原型陷阱使用带原原因的契约包装。'
    )
  }
}
enums.RpcShapeReason = {
  ...enums.RpcShapeReason!,
  values: Object.fromEntries(
    [
      ['record', 'Unsupported closed object shape or prototype.', '闭合对象形态或原型不支持。'],
      [
        'unknown-field',
        'A field is outside its registered record shape.',
        '字段不属于已注册记录形态。'
      ],
      [
        'missing-field',
        'A mandatory registered field is absent.',
        '声明缺少其已注册的必需字段，不能继续编译该记录。'
      ],
      [
        'name',
        'Declared routing segment violates the bounded grammar.',
        '声明路由段违反有界语法。'
      ],
      [
        'plugins-limit',
        'Catalog exceeds its plugin limit before entry reads.',
        '条目读取前目录已超过插件上限。'
      ],
      [
        'features-limit',
        'Contract exceeds its feature limit before entry reads.',
        '条目读取前契约已超过特性上限。'
      ],
      [
        'methods-limit',
        'Feature exceeds its method limit.',
        '同一特性声明的方法数量超过本地准入上限。'
      ],
      [
        'catalog-methods-limit',
        'Aggregate catalog method limit exceeded.',
        '目录各特性的方法累计数量超过总准入上限。'
      ],
      [
        'version',
        'Description version is not admitted.',
        '声明或目录的结构版本不受当前纯准入器支持。'
      ],
      [
        'empty-table',
        'A mandatory table is empty.',
        '要求非空的声明表没有任何条目，不能据此建立提供方目录。'
      ],
      [
        'method-mode',
        'Declared execution mode is unsupported.',
        '方法声明的执行模式不在当前支持的四种本地模式中。'
      ],
      [
        'idempotency',
        'Replay declaration is missing, invalid or incompatible with its mode.',
        '重放声明缺失、非法或与模式不兼容。'
      ],
      ['catalog-plugin', 'Catalog key and declared plugin disagree.', '目录键与插件声明不一致。'],
      [
        'control-state',
        'Retained diagnostic for an unsupported control state; no deleted control API is enabled.',
        '不支持控制状态的保留诊断，不启用已删除控制接口。'
      ],
      [
        'control-revision',
        'Retained diagnostic for an invalid control revision.',
        '非法控制修订号的保留诊断。'
      ],
      [
        'control-features',
        'Retained diagnostic for an invalid control feature list.',
        '非法控制特性列表的保留诊断。'
      ],
      ['control', 'Invalid operation-specific control payload.', '操作专有控制载荷非法。'],
      [
        'portable',
        'Canonical portable normalization rejects or encounters a read failure.',
        '规范可移植规范化拒绝或遇到读取失败。'
      ],
      ['runtime-node', 'Directory node identity violates its domain.', '目录节点身份违反值域。'],
      [
        'runtime-methods',
        'Directory method table is invalid.',
        '线上目录的方法表形态非法，不能作为已接纳目录使用。'
      ],
      [
        'runtime-identity',
        'Connection identity violates its identifier budget.',
        '连接身份违反标识预算。'
      ],
      [
        'runtime-forward',
        'Forwarded method has an invalid immediate connection name.',
        '转发方法的直接连接名称非法。'
      ],
      [
        'runtime-method',
        'Directory method name is invalid or repeated.',
        '目录方法名称非法或重复。'
      ],
      [
        'runtime-modes',
        'No valid unique supported-mode set exists.',
        '不存在合法不重复支持模式集合。'
      ],
      [
        'runtime-mode-source',
        'Method metadata lacks a valid declaration source.',
        '方法元数据缺少合法声明来源。'
      ],
      [
        'runtime-idempotency',
        'Optional replay metadata is not boolean.',
        '可选重放元数据不是布尔值。'
      ],
      [
        'schema',
        'Closed schema subset or local reference is invalid.',
        '闭合数据模式子集或本地引用非法。'
      ],
      [
        'jsonrpc-stream',
        'Historical diagnostic label only; no old profile parser is available.',
        '仅历史诊断标签，不提供旧协议解析器。'
      ]
    ].map(([key, en, zh]) => [key!, t(en!, zh!)])
  )
}

/** Scalars describe their fixed boundary rather than suggesting an executing component. */
function scalar(name: string, module: string, en: string, zh: string): void {
  symbols[name] = {
    role: name.endsWith('SOURCE') || name === 'ERROR_SOURCE' ? 'error' : 'constant',
    purpose: t(en, zh),
    example: `import { ${name} } from '@migaia/rpc-contract/${module}'\nconst value = ${name}`
  }
}
for (const [name, en, zh] of [
  [
    'RpcWireProfile',
    'Fixed migaia.rpc/2 profile for the only semantic grammar.',
    '唯一语义协议的固定标识为 `migaia.rpc/2`，所有握手、业务与控制帧均须携带此值。'
  ],
  [
    'RpcWireStreamFinish',
    'Actual finish-without-items event intent; not cancellation of a new task.',
    '表示流消费者要求无项目完成的事件意图，只允许原调用声明启动前取消范围时使用。'
  ],
  [
    'RpcWireDirectoryVersion',
    'Accepted wire directory schemaVersion is exactly 3.',
    '唯一线上目录的结构版本固定为三，携带真实自身份、代际与方法声明，不恢复旧描述协议。'
  ],
  [
    'RpcWireJsonCodec',
    'Mandatory actual json startup codec identifier.',
    '握手必须提出的实际文本对象编解码身份为 `json`，其执行仍由载体编解码器负责。'
  ],
  [
    'RpcWireExtensionPattern',
    'Lowercase versioned extension grammar name@positive-version.',
    '协商扩展标识使用小写名称及正整数版本，只有真实安装并协商的处理器可以执行。'
  ],
  [
    'RpcWireCodecPattern',
    'Codec ids begin lowercase and have at most 32 lowercase/digit/dot/hyphen characters.',
    '编解码身份小写开头，最多三十二个小写、数字、点或连字符。'
  ],
  [
    'RpcWireBinaryProfile',
    'Fixed portable-binary representation revision, not a second RPC protocol.',
    '固定可移植二进制表示版本，不是第二套远程调用协议。'
  ],
  [
    'RpcWireCancel',
    'The only before-start cancellation scope literal.',
    '线上调用选项唯一支持的启动前取消范围，约束尚未开始业务执行的相关操作。'
  ],
  [
    'RPC_PROVIDER_DECLARATION_METHOD_MAX_CHARS',
    'Bounded full advanced declared method path: 122 characters.',
    '高级声明完整方法路径上限为一百二十二字符。'
  ],
  [
    'RPC_PROVIDER_DECLARATION_VERSION',
    'Local advanced provider declaration schemaVersion is exactly 1.',
    '本地高级提供方声明的结构版本固定为一，不同于线上目录所使用的第三版结构。'
  ],
  [
    'RPC_PROVIDER_MODES',
    'Frozen four local declaration modes; accepted wire modes remain a separate vocabulary.',
    '冻结的四个本地声明模式，准入线上模式为另一词汇。'
  ],
  [
    'RPC_INVALID_DECLARATION_SEGMENT',
    'Fixed invalid-key placeholder avoids reflecting malformed declaration names.',
    '声明校验报告非法键时使用的固定占位文本，避免把未可信原始名称回显到诊断路径。'
  ],
  [
    'RPC_PROVIDER_METHOD_MAX_CHARS',
    'Actual provider method identifier ceiling is 100 characters.',
    '本地提供方完整方法标识最多一百字符，包含编译后的点分路径而非仅末段名称。'
  ],
  [
    'RPC_PROVIDER_RESERVED_NAMESPACE',
    'migaia.remote. remains reserved by canonical provider admission.',
    '提供方准入保留 `migaia.remote.` 命名空间，应用声明不能占用其内部诊断方法路径。'
  ],
  [
    'REMOTE_NAME_PATTERN',
    'Bounded ASCII letter-first segment grammar, up to 40 characters.',
    '对端名称段必须以字母开头且不超过四十字符，供目录与路由名称准入使用。'
  ]
] as const)
  scalar(name, 'protocol', en, zh)
scalar(
  'RPC_PORTABLE_MAX_DEPTH',
  'portable',
  'Portable recursion depth is bounded at 64 with root depth zero.',
  '可移植规范化允许的最大递归深度为六十四，根从零计数，超过边界即拒绝。'
)
for (const [name, source] of [
  ['ERROR_SOURCE', 'rpc.contract'],
  ['RPC_ENDPOINT_ERROR_SOURCE', 'rpc.endpoint'],
  ['RPC_REMOTE_ERROR_SOURCE', 'rpc.remote'],
  ['RPC_PROCESS_ERROR_SOURCE', 'rpc.process'],
  ['RPC_THREAD_ERROR_SOURCE', 'rpc.thread'],
  ['RPC_BROWSER_ERROR_SOURCE', 'rpc.browser'],
  ['RPC_COROUTINE_ERROR_SOURCE', 'rpc.coroutine'],
  ['RPC_POOL_ERROR_SOURCE', 'rpc.pool'],
  ['RPC_DEVTOOLS_ERROR_SOURCE', 'rpc.devtools']
] as const)
  scalar(
    name,
    'error-code',
    `Canonical diagnostic source ${source}; import its matching code table from the same entry.`,
    `规范诊断来源为 ${source}，从同一入口导入对应错误码表。`
  )
scalar(
  'RPC_CONTRACT_SOURCE',
  'errors',
  'Canonical rpc.contract diagnostic source also exported with the standalone error tools.',
  '独立错误工具导出的契约来源标识，用于与语义错误码一起定位纯数据准入失败。'
)
scalar(
  'RPC_CORE_ERROR_SOURCE',
  'errors',
  'Canonical endpoint source rpc.endpoint for the native RPC error families.',
  '原生远程调用错误家族使用的规范端点诊断来源。'
)
scalar(
  'RpcWireErrorField',
  'errors',
  'Ordered serialized error-tree field names preserve first-failure read/validation order.',
  '有序序列化错误树字段名保持首个失败读取及校验顺序。'
)
for (const [name, en, zh] of [
  [
    'RpcProbeStageName',
    'Ordered stage names correspond to numeric RpcProbeStage ordinals.',
    '把数字观察阶段映射为可读名称，区分业务消息、编码、保护、帧与原生载体。'
  ],
  [
    'RpcProbeDirectionName',
    'Ordered outbound/inbound/local names correspond to direction ordinals.',
    '把数字观察方向映射为出站、入站及本地名称，供记录展示而非消息路由使用。'
  ],
  [
    'RpcProbeKindName',
    'Ordered interaction names correspond to numeric probe kinds.',
    '把数字交互种类映射为可读名称，保留请求、通知、取消及流等不同业务含义。'
  ],
  [
    'RpcProbeOutcomeName',
    'Ordered progress names correspond to numeric probe outcomes.',
    '把数字进展结果映射为可读名称，用于区分创建、交付、结算与失败等观察事实。'
  ]
] as const)
  scalar(name, 'interfaces', en, zh)

/** All eight actual entry points have a distinct reader task and a truthful public import. */
const modules: ILibraryReference['modules'] = {
  index: {
    summary: t(
      'Pure RPC contract aggregate: one protocol, carrier/flow/feature interfaces, portable policy and diagnostic contracts. Start with /protocol for compatible peer data or /interfaces for transport authoring. No Session, pending table, timer, connection or codec executor is constructed here.',
      '纯远程调用契约汇总，包含唯一协议、载体及信息流特性接口、可移植策略及诊断契约。兼容对端数据从协议入口开始，传输作者从接口入口开始；此包不构造会话、待决表、计时器、连接或编解码执行器。'
    ),
    example: callExample
  },
  protocol: {
    summary: t(
      'migaia.rpc/2 version 2.0, directory schemaVersion 3 and strict pure normalizers. Flat root/nodes errors preserve indexed topology. Handshake selection checks actual offers; bilateral ready publication remains Host-owned. JSON encoding, framing, hashing and native transfer belong to the actual carrier.',
      '唯一协议使用版本二点零、第三版目录及严格纯规范化器。根索引及节点错误图保持索引拓扑；握手选择检查实际提议，双边就绪发布仍属于宿主。编码、分帧、摘要及原生转移属于实际载体。'
    ),
    example: handshakeExample
  },
  interfaces: {
    summary: t(
      'Runtime-neutral borrowed ports for real carriers, Session handles, fixed flow hooks, complete timeout/retry features and readonly observation. These declarations do not implement IO or create lifecycle registries. Transport implementations live in Host SDK and concrete native plugins.',
      '运行环境中立借用端口，描述真实载体、会话句柄、固定信息流钩子、完整超时重试特性及只读观察。这些声明不实现输入输出或创建生命周期注册表；传输实现位于宿主开发接口及具体原生插件。'
    ),
    example: carrierExample
  },
  portable: {
    summary: t(
      'Normalize ordinary wire business values into frozen snapshots, or use the separately negotiated strict native policy. Ordinary wire getters are read once parent-before-child; protocol record admission rejects accessors. Pure strategies reuse the canonical serialize walker rather than another binary execution path.',
      '把普通线上业务值规范化为冻结快照，或使用另行协商的严格原生策略。普通线上访问器按父先子后读取一次，协议记录准入拒绝访问器；纯策略复用规范序列化遍历器，不提供另一二进制执行路径。'
    ),
    example: symbols.normalizePortable!.example
  },
  errors: {
    summary: t(
      'Native diagnostic classes, guarded property reads, explicit exact-reference metadata and bounded standalone error-tree tools. Protocol messages use /protocol flat error graphs. Restored source/code/name is diagnostic only; error construction never mints local retry, cancellation or resource ownership.',
      '原生诊断类、受控属性读取、显式精确引用元数据及有界独立错误树工具。协议消息使用协议入口的平面错误图；恢复的来源、错误码及名称仅作诊断，错误构造不生成本地重试、取消或资源所有权。'
    ),
    example: wireErrorExample
  },
  'error-code': {
    summary: t(
      'The single declaration owner for all RPC family source/code tables. Import this independent entry for semantic branching without pulling protocol/portable execution into a bundle; sideEffects:false permits normal tree shaking. No local control authority comes from copying a code.',
      '全远程调用家族来源及错误码表的唯一声明所有者。需要语义分支时导入此独立入口，避免把协议或可移植执行路径带入包；无副作用声明允许正常摇树优化。复制错误码不产生本地控制权限。'
    ),
    example: `import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
export const cancelled = RpcCoreErrorCode.cancelled`
  },
  'schema/wire-error': {
    summary: t(
      'Published JSON Schema for the flat root/nodes protocol error graph. Load it as JSON data in your existing validator. normalizeRpcWireError additionally enforces graph indices and aggregate budgets; neither schema nor normalization authenticates a source or reconstructs local provenance.',
      '平面根及节点协议错误图随包发布的数据模式。把它作为数据交给既有校验器；纯错误图规范化器还执行图索引及累计预算检查。模式及规范化都不认证来源或重建本地来源权限。'
    )
  },
  'schema/protocol': {
    summary: t(
      'Published JSON Schema for the one semantic handshake/call/group/control/directory grammar. Structural validation is only the data entry: pure normalizers and actual Session/task owners still enforce cross-field, native-capability, generation and lifecycle constraints.',
      '唯一语义握手、调用、分组、控制及目录语法随包发布的数据模式。结构校验只是数据入口，纯规范化器及实际会话任务所有者仍执行字段关联、原生能力、代际及生命周期约束。'
    )
  }
}

/** Diagnostic text tables retain literal text; their names do not re-enable removed APIs. */
symbols.RpcCoreErrorText = {
  role: 'constant',
  purpose: {
    en: 'Canonical RpcCoreErrorText literal messages and text factories. Diagnostic wording is retained even for historical fields; the table neither constructs a Session nor restores retired configuration or protocol entry points. Import the canonical field instead of duplicating its wording.',
    zh: '规范 `RpcCoreErrorText` 字面消息及文本工厂。历史字段仍保留诊断措辞，此表不构造会话，也不恢复已退役配置或协议入口。应导入规范字段，不在调用处复制诊断措辞。'
  },
  example:
    "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.callbackFailed"
}
types.RpcCoreErrorText = {
  summary: {
    en: 'Canonical RpcCoreErrorText literal messages and text factories. Diagnostic wording is retained even for historical fields; the table neither constructs a Session nor restores retired configuration or protocol entry points. Import the canonical field instead of duplicating its wording.',
    zh: '规范 `RpcCoreErrorText` 字面消息及文本工厂。历史字段仍保留诊断措辞，此表不构造会话，也不恢复已退役配置或协议入口。应导入规范字段，不在调用处复制诊断措辞。'
  },
  members: {
    callbackFailed: {
      summary: {
        en: 'Exact diagnostic text: `RPC callback failed`.',
        zh: '精确诊断文本为 `RPC callback failed`。'
      }
    },
    probeRuntimeNotInstalled: {
      summary: {
        en: 'Exact diagnostic text: `probe runtime not installed`.',
        zh: '精确诊断文本为 `probe runtime not installed`。'
      }
    },
    probeDefinitionInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Probe definition must be an object`.',
        zh: '精确诊断文本为 `Probe definition must be an object`。'
      }
    },
    probeStagesInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Probe stages must contain known stage names`.',
        zh: '精确诊断文本为 `Probe stages must contain known stage names`。'
      }
    },
    probeCaptureInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Probe capture must be a subset of stages`.',
        zh: '精确诊断文本为 `Probe capture must be a subset of stages`。'
      }
    },
    probeEmitInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Probe emit must be a function`.',
        zh: '精确诊断文本为 `Probe emit must be a function`。'
      }
    },
    probeRedactInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Probe redact must be a function`.',
        zh: '精确诊断文本为 `Probe redact must be a function`。'
      }
    },
    probeDescribeInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Probe describe must be a function`.',
        zh: '精确诊断文本为 `Probe describe must be a function`。'
      }
    },
    probeOnErrorInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Probe onError must be a function`.',
        zh: '精确诊断文本为 `Probe onError must be a function`。'
      }
    },
    probeSampleInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Probe sample must be in (0, 1]`.',
        zh: '精确诊断文本为 `Probe sample must be in (0, 1]`。'
      }
    },
    probeMethodsInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Probe methods must be an array of strings`.',
        zh: '精确诊断文本为 `Probe methods must be an array of strings`。'
      }
    },
    probeHostInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Probe host must be an extensible unregistered object without own probe fields`.',
        zh: '精确诊断文本为 `Probe host must be an extensible unregistered object without own probe fields`。'
      }
    },
    runtimeProcessTransferInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime process calls do not accept transfer`.',
        zh: '精确诊断文本为 `Runtime process calls do not accept transfer`。'
      }
    },
    runtimeBinaryInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime binary manifest is invalid`.',
        zh: '精确诊断文本为 `Runtime binary manifest is invalid`。'
      }
    },
    runtimeIngressFrameLimitExceeded: {
      summary: {
        en: 'Exact diagnostic text: `rpc frame limit exceeded`.',
        zh: '精确诊断文本为 `rpc frame limit exceeded`。'
      }
    },
    providerGenerationMismatch: {
      summary: {
        en: 'Exact diagnostic text: `Provider generation does not match the selected task`.',
        zh: '精确诊断文本为 `Provider generation does not match the selected task`。'
      }
    },
    runtimeIdempotencyConflict: {
      summary: {
        en: 'Exact diagnostic text: `Runtime idempotency key conflicts with its original operation`.',
        zh: '精确诊断文本为 `Runtime idempotency key conflicts with its original operation`。'
      }
    },
    runtimeGroupTargetsInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime group must use one local provider or one forwarding target`.',
        zh: '精确诊断文本为 `Runtime group must use one local provider or one forwarding target`。'
      }
    },
    runtimeGroupStepsInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime group steps are invalid`.',
        zh: '精确诊断文本为 `Runtime group steps are invalid`。'
      }
    },
    runtimeGroupResultTooLarge: {
      summary: {
        en: 'Exact diagnostic text: `Runtime group result exceeds the physical frame limit`.',
        zh: '精确诊断文本为 `Runtime group result exceeds the physical frame limit`。'
      }
    },
    authenticationSessionUnknown: {
      summary: {
        en: 'Exact diagnostic text: `Authentication challenge session is unknown`.',
        zh: '精确诊断文本为 `Authentication challenge session is unknown`。'
      }
    },
    authenticationChallengeInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Authentication challenge binding is invalid`.',
        zh: '精确诊断文本为 `Authentication challenge binding is invalid`。'
      }
    },
    forwardLoop: {
      summary: {
        en: 'Exact diagnostic text: `RPC forwarding route revisits a Host`.',
        zh: '精确诊断文本为 `RPC forwarding route revisits a Host`。'
      }
    },
    forwardHopLimit: {
      summary: {
        en: 'Exact diagnostic text: `RPC forwarding route exceeds three forwarding Hosts`.',
        zh: '精确诊断文本为 `RPC forwarding route exceeds three forwarding Hosts`。'
      }
    },
    capabilityUnsupported: {
      summary: {
        en: 'Exact diagnostic text: `Runtime operation capability is unavailable`.',
        zh: '精确诊断文本为 `Runtime operation capability is unavailable`。'
      }
    },
    componentShadowed: {
      summary: {
        en: 'Exact diagnostic text: `component-shadowed`.',
        zh: '精确诊断文本为 `component-shadowed`。'
      }
    },
    codecDescriptorInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Codec descriptor is invalid`.',
        zh: '精确诊断文本为 `Codec descriptor is invalid`。'
      }
    },
    framerDescriptorInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Framer descriptor is invalid`.',
        zh: '精确诊断文本为 `Framer descriptor is invalid`。'
      }
    },
    transportDescriptorInvalid: {
      summary: {
        en: 'Exact diagnostic text: `transport descriptor is invalid`.',
        zh: '精确诊断文本为 `transport descriptor is invalid`。'
      }
    },
    transportIdentityDescriptorInvalid: {
      summary: {
        en: 'Exact diagnostic text: `transport identity descriptor is invalid`.',
        zh: '精确诊断文本为 `transport identity descriptor is invalid`。'
      }
    },
    endpointRegistrationFailed: {
      summary: {
        en: 'Exact diagnostic text: `Endpoint registration failed`.',
        zh: '精确诊断文本为 `Endpoint registration failed`。'
      }
    },
    endpointDisposed: {
      summary: {
        en: 'Exact diagnostic text: `Endpoint disposed`.',
        zh: '精确诊断文本为 `Endpoint disposed`。'
      }
    },
    endpointDisposalCleanupFailed: {
      summary: {
        en: 'Exact diagnostic text: `Endpoint disposal completed with cleanup errors`.',
        zh: '精确诊断文本为 `Endpoint disposal completed with cleanup errors`。'
      }
    },
    endpointRouteOwned: {
      summary: {
        en: 'Exact diagnostic text: `endpoint route is already owned`.',
        zh: '精确诊断文本为 `endpoint route is already owned`。'
      }
    },
    streamRouteUnclaimed: {
      summary: {
        en: 'Exact diagnostic text: `stream route unavailable`.',
        zh: '精确诊断文本为 `stream route unavailable`。'
      }
    },
    endpointOwnerOwned: {
      summary: {
        en: 'Exact diagnostic text: `endpoint runtime owner is already registered`.',
        zh: '精确诊断文本为 `endpoint runtime owner is already registered`。'
      }
    },
    endpointModuleInvalid: {
      summary: {
        en: 'Exact diagnostic text: `endpoint module token is invalid`.',
        zh: '精确诊断文本为 `endpoint module token is invalid`。'
      }
    },
    endpointModuleDuplicated: {
      summary: {
        en: 'Exact diagnostic text: `endpoint module is duplicated`.',
        zh: '精确诊断文本为 `endpoint module is duplicated`。'
      }
    },
    ipcGateDuplicated: {
      summary: {
        en: 'Exact diagnostic text: `IPC send gate is already registered`.',
        zh: '精确诊断文本为 `IPC send gate is already registered`。'
      }
    },
    ipcGateMismatch: {
      summary: {
        en: 'Exact diagnostic text: `IPC send gate and Feature do not match`.',
        zh: '精确诊断文本为 `IPC send gate and Feature do not match`。'
      }
    },
    endpointModuleDependencyMissing: {
      summary: {
        en: 'Exact diagnostic text: `endpoint module dependency is missing`.',
        zh: '精确诊断文本为 `endpoint module dependency is missing`。'
      }
    },
    discoveryWaiterLimit: {
      summary: {
        en: 'Exact diagnostic text: `discovery waiter limit exceeded`.',
        zh: '精确诊断文本为 `discovery waiter limit exceeded`。'
      }
    },
    pingMiddlewareMissing: {
      summary: {
        en: 'Exact diagnostic text: `ping middleware is not installed`.',
        zh: '精确诊断文本为 `ping middleware is not installed`。'
      }
    },
    identifierInvalid: {
      summary: {
        en: 'Format the canonical identifierInvalid diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `identifierInvalid` 诊断，不执行校验或业务。'
      },
      params: {
        label: {
          en: 'Actual diagnostic label supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `label`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.identifierInvalid('sample')"
    },
    outboundReplayFull: {
      summary: {
        en: 'Exact diagnostic text: `Replay window is full`.',
        zh: '精确诊断文本为 `Replay window is full`。'
      }
    },
    eventListenerInvalid: {
      summary: {
        en: 'Exact diagnostic text: `event listener must be a function`.',
        zh: '精确诊断文本为 `event listener must be a function`。'
      }
    },
    methodInvalid: {
      summary: {
        en: 'Exact diagnostic text: `method must be a non-empty string`.',
        zh: '精确诊断文本为 `method must be a non-empty string`。'
      }
    },
    abortMiddlewareMissing: {
      summary: {
        en: 'Exact diagnostic text: `abort middleware is not installed`.',
        zh: '精确诊断文本为 `abort middleware is not installed`。'
      }
    },
    abortSignalInvalid: {
      summary: {
        en: 'Exact diagnostic text: `abort signal is invalid`.',
        zh: '精确诊断文本为 `abort signal is invalid`。'
      }
    },
    timeoutInvalid: {
      summary: {
        en: 'Exact diagnostic text: `timeoutMs must be false or a non-negative finite number`.',
        zh: '精确诊断文本为 `timeoutMs must be false or a non-negative finite number`。'
      }
    },
    schedulerInvalid: {
      summary: {
        en: 'Exact diagnostic text: `scheduler must provide now and schedule, and now() must return finite non-negative milliseconds`.',
        zh: '精确诊断文本为 `scheduler must provide now and schedule, and now() must return finite non-negative milliseconds`。'
      }
    },
    wallClockInvalid: {
      summary: {
        en: 'Exact diagnostic text: `wallClock must provide timestamp, and timestamp() must return non-negative safe-integer epoch milliseconds`.',
        zh: '精确诊断文本为 `wallClock must provide timestamp, and timestamp() must return non-negative safe-integer epoch milliseconds`。'
      }
    },
    remoteRequestFailed: {
      summary: {
        en: 'Exact diagnostic text: `Remote request failed`.',
        zh: '精确诊断文本为 `Remote request failed`。'
      }
    },
    propertyReadFailed: {
      summary: {
        en: 'Exact diagnostic text: `rpc property read failed`.',
        zh: '精确诊断文本为 `rpc property read failed`。'
      }
    },
    stringConversionFailed: {
      summary: {
        en: 'Exact diagnostic text: `rpc string conversion failed`.',
        zh: '精确诊断文本为 `rpc string conversion failed`。'
      }
    },
    unknownError: {
      summary: {
        en: 'Exact diagnostic text: `Unknown error`.',
        zh: '精确诊断文本为 `Unknown error`。'
      }
    },
    schemaValidationFailed: {
      summary: {
        en: 'Format the canonical schemaValidationFailed diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `schemaValidationFailed` 诊断，不执行校验或业务。'
      },
      params: {
        method: {
          en: 'Actual diagnostic method supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `method`。'
        },
        side: {
          en: 'Actual diagnostic side supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `side`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.schemaValidationFailed('sample', 'sample')"
    },
    schemaValidationFallback: {
      summary: {
        en: 'Exact diagnostic text: `Schema validation failed`.',
        zh: '精确诊断文本为 `Schema validation failed`。'
      }
    },
    pluginInstallResultInvalid: {
      summary: {
        en: 'Exact diagnostic text: `plugin install result is invalid`.',
        zh: '精确诊断文本为 `plugin install result is invalid`。'
      }
    },
    providerDescriptorInvalid: {
      summary: {
        en: 'Exact diagnostic text: `provider descriptor is invalid`.',
        zh: '精确诊断文本为 `provider descriptor is invalid`。'
      }
    },
    providerDuplicated: {
      summary: {
        en: 'Format the canonical providerDuplicated diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `providerDuplicated` 诊断，不执行校验或业务。'
      },
      params: {
        method: {
          en: 'Actual diagnostic method supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `method`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.providerDuplicated('sample')"
    },
    middlewareMustBePlugin: {
      summary: {
        en: 'Exact diagnostic text: `middleware must be a native WebRPC plugin`.',
        zh: '精确诊断文本为 `middleware must be a native WebRPC plugin`。'
      }
    },
    protocolEncodeFailed: {
      summary: {
        en: 'Exact diagnostic text: `Protocol encode failed`.',
        zh: '精确诊断文本为 `Protocol encode failed`。'
      }
    },
    transportSendFailed: {
      summary: {
        en: 'Exact diagnostic text: `Transport send failed`.',
        zh: '精确诊断文本为 `Transport send failed`。'
      }
    },
    invalidTransferList: {
      summary: {
        en: 'Exact diagnostic text: `Transfer list must be an array`.',
        zh: '精确诊断文本为 `Transfer list must be an array`。'
      }
    },
    transferUnsupportedForChunking: {
      summary: {
        en: 'Exact diagnostic text: `Transfer lists are unsupported for chunked messages`.',
        zh: '精确诊断文本为 `Transfer lists are unsupported for chunked messages`。'
      }
    },
    transferUnsupportedWithAuthentication: {
      summary: {
        en: 'Exact diagnostic text: `Transfer lists are unsupported with authentication`.',
        zh: '精确诊断文本为 `Transfer lists are unsupported with authentication`。'
      }
    },
    protocolEncodedType: {
      summary: {
        en: 'Format the canonical protocolEncodedType diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `protocolEncodedType` 诊断，不执行校验或业务。'
      },
      params: {
        encodedType: {
          en: 'Actual diagnostic encodedType supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `encodedType`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.protocolEncodedType('sample')"
    },
    protectedEncodedType: {
      summary: {
        en: 'Format the canonical protectedEncodedType diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `protectedEncodedType` 诊断，不执行校验或业务。'
      },
      params: {
        encodedType: {
          en: 'Actual diagnostic encodedType supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `encodedType`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.protectedEncodedType('sample')"
    },
    authenticationFailed: {
      summary: {
        en: 'Exact diagnostic text: `Authentication transform failed`.',
        zh: '精确诊断文本为 `Authentication transform failed`。'
      }
    },
    traceInvalid: {
      summary: {
        en: 'Exact diagnostic text: `trace must be 1-256 printable ASCII characters`.',
        zh: '精确诊断文本为 `trace must be 1-256 printable ASCII characters`。'
      }
    },
    idempotencyKeyInvalid: {
      summary: {
        en: 'Exact diagnostic text: `idempotencyKey is invalid`.',
        zh: '精确诊断文本为 `idempotencyKey is invalid`。'
      }
    },
    drainInvalid: {
      summary: {
        en: 'Exact diagnostic text: `drainMs must be a non-negative integer within the limit`.',
        zh: '精确诊断文本为 `drainMs must be a non-negative integer within the limit`。'
      }
    },
    idempotencyConfigInvalid: {
      summary: {
        en: 'Exact diagnostic text: `idempotency configuration is invalid`.',
        zh: '精确诊断文本为 `idempotency configuration is invalid`。'
      }
    },
    idempotencyResultUnavailable: {
      summary: {
        en: 'Exact diagnostic text: `Idempotency result is unavailable`.',
        zh: '精确诊断文本为 `Idempotency result is unavailable`。'
      }
    },
    idempotencyStoreFull: {
      summary: {
        en: 'Exact diagnostic text: `Idempotency store is full`.',
        zh: '精确诊断文本为 `Idempotency store is full`。'
      }
    },
    variationHandlerDuplicate: {
      summary: {
        en: 'Format the canonical variationHandlerDuplicate diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `variationHandlerDuplicate` 诊断，不执行校验或业务。'
      },
      params: {
        variation: {
          en: 'Actual diagnostic variation supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `variation`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.variationHandlerDuplicate('sample')"
    },
    manualQueryListenerDuplicate: {
      summary: {
        en: 'Exact diagnostic text: `only one manual query listener may be registered`.',
        zh: '精确诊断文本为 `only one manual query listener may be registered`。'
      }
    },
    webRPCRequestCancelled: {
      summary: {
        en: 'Exact diagnostic text: `Web RPC request cancelled`.',
        zh: '精确诊断文本为 `Web RPC request cancelled`。'
      }
    },
    webRPCRequestDeadlineExceeded: {
      summary: {
        en: 'Exact diagnostic text: `Web RPC request deadline exceeded`.',
        zh: '精确诊断文本为 `Web RPC request deadline exceeded`。'
      }
    },
    timeoutMustBeFalseOrANonNegativeFiniteNumber: {
      summary: {
        en: 'Exact diagnostic text: `timeout must be false or a non-negative finite number`.',
        zh: '精确诊断文本为 `timeout must be false or a non-negative finite number`。'
      }
    },
    queryListenerMustBeAFunction: {
      summary: {
        en: 'Exact diagnostic text: `query listener must be a function`.',
        zh: '精确诊断文本为 `query listener must be a function`。'
      }
    },
    broadcastTargetNotIdentifiable: {
      summary: {
        en: 'Format the canonical broadcastTargetNotIdentifiable diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `broadcastTargetNotIdentifiable` 诊断，不执行校验或业务。'
      },
      params: {
        targetId: {
          en: 'Actual diagnostic targetId supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `targetId`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.broadcastTargetNotIdentifiable('sample')"
    },
    unknownReceiver: {
      summary: {
        en: 'Format the canonical unknownReceiver diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `unknownReceiver` 诊断，不执行校验或业务。'
      },
      params: {
        receiverId: {
          en: 'Actual diagnostic receiverId supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `receiverId`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.unknownReceiver('sample')"
    },
    pinnedReceiverUnavailable: {
      summary: {
        en: 'Format the canonical pinnedReceiverUnavailable diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `pinnedReceiverUnavailable` 诊断，不执行校验或业务。'
      },
      params: {
        receiverId: {
          en: 'Actual diagnostic receiverId supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `receiverId`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.pinnedReceiverUnavailable('sample')"
    },
    receiverSelectorReturnedAnInvalidReceiver: {
      summary: {
        en: 'Exact diagnostic text: `receiverSelector returned an invalid receiver`.',
        zh: '精确诊断文本为 `receiverSelector returned an invalid receiver`。'
      }
    },
    selectedReceiverUnavailable: {
      summary: {
        en: 'Format the canonical selectedReceiverUnavailable diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `selectedReceiverUnavailable` 诊断，不执行校验或业务。'
      },
      params: {
        selected: {
          en: 'Actual diagnostic selected supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `selected`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.selectedReceiverUnavailable('sample')"
    },
    unknownTarget: {
      summary: {
        en: 'Format the canonical unknownTarget diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `unknownTarget` 诊断，不执行校验或业务。'
      },
      params: {
        targetId: {
          en: 'Actual diagnostic targetId supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `targetId`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.unknownTarget('sample')"
    },
    discoveryTimeoutMustBeFiniteAndNonNegative: {
      summary: {
        en: 'Exact diagnostic text: `discovery timeout must be finite and non-negative`.',
        zh: '精确诊断文本为 `discovery timeout must be finite and non-negative`。'
      }
    },
    discoveryAborted: {
      summary: {
        en: 'Exact diagnostic text: `Discovery aborted`.',
        zh: '精确诊断文本为 `Discovery aborted`。'
      }
    },
    discoveryCandidateIsInvalid: {
      summary: {
        en: 'Exact diagnostic text: `discovery candidate is invalid`.',
        zh: '精确诊断文本为 `discovery candidate is invalid`。'
      }
    },
    discoveryCandidateWasNotProducedByAVerifiedManualQuery: {
      summary: {
        en: 'Exact diagnostic text: `discovery candidate was not produced by a verified manual query`.',
        zh: '精确诊断文本为 `discovery candidate was not produced by a verified manual query`。'
      }
    },
    discoveryCandidateReceiverIdIsInvalid: {
      summary: {
        en: 'Exact diagnostic text: `discovery candidate receiverId is invalid`.',
        zh: '精确诊断文本为 `discovery candidate receiverId is invalid`。'
      }
    },
    discoveryCandidateWasRevoked: {
      summary: {
        en: 'Exact diagnostic text: `discovery candidate was revoked`.',
        zh: '精确诊断文本为 `discovery candidate was revoked`。'
      }
    },
    receiverLimitExceeded: {
      summary: {
        en: 'Exact diagnostic text: `receiver limit exceeded`.',
        zh: '精确诊断文本为 `receiver limit exceeded`。'
      }
    },
    verifiedDiscoveryBindingIsNoLongerAvailable: {
      summary: {
        en: 'Exact diagnostic text: `verified discovery binding is no longer available`.',
        zh: '精确诊断文本为 `verified discovery binding is no longer available`。'
      }
    },
    remoteDiscoveryTargetLimitExceeded: {
      summary: {
        en: 'Exact diagnostic text: `remote discovery target limit exceeded`.',
        zh: '精确诊断文本为 `remote discovery target limit exceeded`。'
      }
    },
    manualRevocationCapacityExceeded: {
      summary: {
        en: 'Exact diagnostic text: `manual revocation capacity exceeded`.',
        zh: '精确诊断文本为 `manual revocation capacity exceeded`。'
      }
    },
    discoveryCandidateUniqueTargetIdMustBeAString: {
      summary: {
        en: 'Exact diagnostic text: `discovery candidate uniqueTargetId must be a string`.',
        zh: '精确诊断文本为 `discovery candidate uniqueTargetId must be a string`。'
      }
    },
    queryRejectionReasonMustBeAString: {
      summary: {
        en: 'Exact diagnostic text: `query rejection reason must be a string`.',
        zh: '精确诊断文本为 `query rejection reason must be a string`。'
      }
    },
    manualDiscoveryIsUnavailable: {
      summary: {
        en: 'Exact diagnostic text: `manual discovery is unavailable`.',
        zh: '精确诊断文本为 `manual discovery is unavailable`。'
      }
    },
    discoveryRegistryClosed: {
      summary: {
        en: 'Exact diagnostic text: `discovery registry closed`.',
        zh: '精确诊断文本为 `discovery registry closed`。'
      }
    },
    connectMiddlewareIsRequired: {
      summary: {
        en: 'Exact diagnostic text: `connect middleware is required`.',
        zh: '精确诊断文本为 `connect middleware is required`。'
      }
    },
    idAndTargetIdsMustFitTheConfiguredIdentifierLimit: {
      summary: {
        en: 'Exact diagnostic text: `id and targetIds must fit the configured identifier limit`.',
        zh: '精确诊断文本为 `id and targetIds must fit the configured identifier limit`。'
      }
    },
    connectUniqueTargetIdFactoryFailed: {
      summary: {
        en: 'Exact diagnostic text: `connect.uniqueTargetId factory failed`.',
        zh: '精确诊断文本为 `connect.uniqueTargetId factory failed`。'
      }
    },
    outboundFrameAndTransportEncodedTypesAreIncompatible: {
      summary: {
        en: 'Exact diagnostic text: `outbound frame and transport encoded types are incompatible`.',
        zh: '精确诊断文本为 `outbound frame and transport encoded types are incompatible`。'
      }
    },
    factoryDescriptorIsInvalid: {
      summary: {
        en: 'Exact diagnostic text: `factory descriptor is invalid`.',
        zh: '精确诊断文本为 `factory descriptor is invalid`。'
      }
    },
    factoryDescriptorIsUnreadable: {
      summary: {
        en: 'Exact diagnostic text: `factory descriptor is unreadable`.',
        zh: '精确诊断文本为 `factory descriptor is unreadable`。'
      }
    },
    idMustBeANonEmptyString: {
      summary: {
        en: 'Exact diagnostic text: `id must be a non-empty string`.',
        zh: '精确诊断文本为 `id must be a non-empty string`。'
      }
    },
    middlewaresMustBeAnArray: {
      summary: {
        en: 'Exact diagnostic text: `middlewares must be an array`.',
        zh: '精确诊断文本为 `middlewares must be an array`。'
      }
    },
    targetIdsMustBeAnArray: {
      summary: {
        en: 'Exact diagnostic text: `targetIds must be an array`.',
        zh: '精确诊断文本为 `targetIds must be an array`。'
      }
    },
    targetIdsMustContainNonEmptyStrings: {
      summary: {
        en: 'Exact diagnostic text: `targetIds must contain non-empty strings`.',
        zh: '精确诊断文本为 `targetIds must contain non-empty strings`。'
      }
    },
    factoryCollectionIsUnreadable: {
      summary: {
        en: 'Exact diagnostic text: `factory collection is unreadable`.',
        zh: '精确诊断文本为 `factory collection is unreadable`。'
      }
    },
    duplicateMiddleware: {
      summary: {
        en: 'Format the canonical duplicateMiddleware diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `duplicateMiddleware` 诊断，不执行校验或业务。'
      },
      params: {
        name: {
          en: 'Actual diagnostic name supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `name`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.duplicateMiddleware('sample')"
    },
    middlewaresAreUnreadable: {
      summary: {
        en: 'Exact diagnostic text: `middlewares are unreadable`.',
        zh: '精确诊断文本为 `middlewares are unreadable`。'
      }
    },
    connectMiddlewareMustProvideTransport: {
      summary: {
        en: 'Exact diagnostic text: `connect middleware must provide transport`.',
        zh: '精确诊断文本为 `connect middleware must provide transport`。'
      }
    },
    uuidGeneratorMustReturnANonEmptyString: {
      summary: {
        en: 'Exact diagnostic text: `UUID generator must return a non-empty string`.',
        zh: '精确诊断文本为 `UUID generator must return a non-empty string`。'
      }
    },
    uuidConflict: {
      summary: {
        en: 'Format the canonical uuidConflict diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `uuidConflict` 诊断，不执行校验或业务。'
      },
      params: {
        id: {
          en: 'Actual diagnostic id supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `id`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.uuidConflict('sample')"
    },
    uuidUnavailable: {
      summary: {
        en: 'Exact diagnostic text: `UUID unavailable`.',
        zh: '精确诊断文本为 `UUID unavailable`。'
      }
    },
    bindingLimitsMustBePositiveSafeIntegers: {
      summary: {
        en: 'Exact diagnostic text: `binding limits must be positive safe integers`.',
        zh: '精确诊断文本为 `binding limits must be positive safe integers`。'
      }
    },
    providerAdmissionObserverMustBeAFunction: {
      summary: {
        en: 'Exact diagnostic text: `Provider admission observer must be a function`.',
        zh: '精确诊断文本为 `Provider admission observer must be a function`。'
      }
    },
    providerAdmissionObserverFailed: {
      summary: {
        en: 'Exact diagnostic text: `Provider admission observer failed`.',
        zh: '精确诊断文本为 `Provider admission observer failed`。'
      }
    },
    providerAdmissionLimitsMustBePositiveSafeIntegers: {
      summary: {
        en: 'Exact diagnostic text: `provider admission limits must be positive safe integers`.',
        zh: '精确诊断文本为 `provider admission limits must be positive safe integers`。'
      }
    },
    providerTransferMustBeABoundedArray: {
      summary: {
        en: 'Exact diagnostic text: `provider transfer must be a bounded array`.',
        zh: '精确诊断文本为 `provider transfer must be a bounded array`。'
      }
    },
    providerFailureMessageAndCodeMustBeStrings: {
      summary: {
        en: 'Exact diagnostic text: `provider failure message and code must be strings`.',
        zh: '精确诊断文本为 `provider failure message and code must be strings`。'
      }
    },
    requestReplayLedgerIsFull: {
      summary: {
        en: 'Exact diagnostic text: `Request replay ledger is full`.',
        zh: '精确诊断文本为 `Request replay ledger is full`。'
      }
    },
    providerAdmissionLimitReached: {
      summary: {
        en: 'Exact diagnostic text: `Provider admission limit reached`.',
        zh: '精确诊断文本为 `Provider admission limit reached`。'
      }
    },
    verifiedPeerBindingExpired: {
      summary: {
        en: 'Exact diagnostic text: `Verified peer binding expired`.',
        zh: '精确诊断文本为 `Verified peer binding expired`。'
      }
    },
    providerContextExpired: {
      summary: {
        en: 'Exact diagnostic text: `Provider context expired`.',
        zh: '精确诊断文本为 `Provider context expired`。'
      }
    },
    dispatchTargetIdMustBeANonEmptyString: {
      summary: {
        en: 'Exact diagnostic text: `dispatch target id must be a non-empty string`.',
        zh: '精确诊断文本为 `dispatch target id must be a non-empty string`。'
      }
    },
    providerNotFound: {
      summary: {
        en: 'Exact diagnostic text: `Provider not found`.',
        zh: '精确诊断文本为 `Provider not found`。'
      }
    },
    providerDidNotSettle: {
      summary: {
        en: 'Exact diagnostic text: `Provider did not settle`.',
        zh: '精确诊断文本为 `Provider did not settle`。'
      }
    },
    providerFailed: {
      summary: {
        en: 'Exact diagnostic text: `Provider failed`.',
        zh: '精确诊断文本为 `Provider failed`。'
      }
    },
    replayLimitsMustBePositiveSafeIntegers: {
      summary: {
        en: 'Exact diagnostic text: `replay limits must be positive safe integers`.',
        zh: '精确诊断文本为 `replay limits must be positive safe integers`。'
      }
    },
    requestReplayLimitsMustBePositiveSafeIntegers: {
      summary: {
        en: 'Exact diagnostic text: `request replay limits must be positive safe integers`.',
        zh: '精确诊断文本为 `request replay limits must be positive safe integers`。'
      }
    },
    pluginInstallFailureDetail: {
      summary: {
        en: 'Format the canonical pluginInstallFailureDetail diagnostic from the actual owner inputs; this performs no validation or execution.',
        zh: '按实际所有者输入格式化规范 `pluginInstallFailureDetail` 诊断，不执行校验或业务。'
      },
      params: {
        prefix: {
          en: 'Actual diagnostic prefix supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `prefix`。'
        },
        detail: {
          en: 'Actual diagnostic detail supplied by the owning admission or failure operation.',
          zh: '所属准入或失败操作提供的实际诊断参数 `detail`。'
        }
      },
      returns: {
        en: 'The stable formatted diagnostic string; original causes are kept by the actual error factory.',
        zh: '稳定格式化诊断文本，原原因由实际错误工厂保留。'
      },
      example:
        "import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'\nconst message = RpcCoreErrorText.pluginInstallFailureDetail('sample', 'sample')"
    }
  }
}
symbols.RuntimeApiErrorText = {
  role: 'constant',
  purpose: {
    en: 'Canonical RuntimeApiErrorText literal messages and text factories. Diagnostic wording is retained even for historical fields; the table neither constructs a Session nor restores retired configuration or protocol entry points. Import the canonical field instead of duplicating its wording.',
    zh: '规范 `RuntimeApiErrorText` 字面消息及文本工厂。历史字段仍保留诊断措辞，此表不构造会话，也不恢复已退役配置或协议入口。应导入规范字段，不在调用处复制诊断措辞。'
  },
  example:
    "import { RuntimeApiErrorText } from '@migaia/rpc-contract/errors'\nconst message = RuntimeApiErrorText.defaultTimeoutInvalid"
}
types.RuntimeApiErrorText = {
  summary: {
    en: 'Canonical RuntimeApiErrorText literal messages and text factories. Diagnostic wording is retained even for historical fields; the table neither constructs a Session nor restores retired configuration or protocol entry points. Import the canonical field instead of duplicating its wording.',
    zh: '规范 `RuntimeApiErrorText` 字面消息及文本工厂。历史字段仍保留诊断措辞，此表不构造会话，也不恢复已退役配置或协议入口。应导入规范字段，不在调用处复制诊断措辞。'
  },
  members: {
    defaultTimeoutInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime defaultTimeoutMs must be a positive finite number`.',
        zh: '精确诊断文本为 `Runtime defaultTimeoutMs must be a positive finite number`。'
      }
    },
    forwardOriginUnavailable: {
      summary: {
        en: 'Exact diagnostic text: `RPC forwarding origin node is unavailable`.',
        zh: '精确诊断文本为 `RPC forwarding origin node is unavailable`。'
      }
    },
    provideInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime provide must contain valid own data methods or groups`.',
        zh: '精确诊断文本为 `Runtime provide must contain valid own data methods or groups`。'
      }
    },
    sourceInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime Peer requires exactly one connection source`.',
        zh: '精确诊断文本为 `Runtime Peer requires exactly one connection source`。'
      }
    },
    identityInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime Peer identity is invalid`.',
        zh: '精确诊断文本为 `Runtime Peer identity is invalid`。'
      }
    },
    descriptionInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime method description is invalid`.',
        zh: '精确诊断文本为 `Runtime method description is invalid`。'
      }
    },
    methodUnavailable: {
      summary: {
        en: 'Exact diagnostic text: `Runtime method is not provided by this peer`.',
        zh: '精确诊断文本为 `Runtime method is not provided by this peer`。'
      }
    },
    resultInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime request result must be portable`.',
        zh: '精确诊断文本为 `Runtime request result must be portable`。'
      }
    },
    errorDataInvalid: {
      summary: {
        en: 'Exact diagnostic text: `RPC error data could not be serialized`.',
        zh: '精确诊断文本为 `RPC error data could not be serialized`。'
      }
    },
    peerInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime Peer is not prepared by the canonical owner`.',
        zh: '精确诊断文本为 `Runtime Peer is not prepared by the canonical owner`。'
      }
    },
    pluginNameInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime plugin name must be a non-empty string`.',
        zh: '精确诊断文本为 `Runtime plugin name must be a non-empty string`。'
      }
    },
    exposeInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime plugin expose must contain unique plugin names`.',
        zh: '精确诊断文本为 `Runtime plugin expose must contain unique plugin names`。'
      }
    },
    featureInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime plugin exposure requires own enumerable data methods`.',
        zh: '精确诊断文本为 `Runtime plugin exposure requires own enumerable data methods`。'
      }
    },
    featureConflict: {
      summary: {
        en: 'Exact diagnostic text: `Runtime plugin features contain conflicting method names`.',
        zh: '精确诊断文本为 `Runtime plugin features contain conflicting method names`。'
      }
    },
    targetInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime outlet target must be a non-empty string`.',
        zh: '精确诊断文本为 `Runtime outlet target must be a non-empty string`。'
      }
    },
    targetUnknown: {
      summary: {
        en: 'Exact diagnostic text: `Runtime outlet target is not a live connection`.',
        zh: '精确诊断文本为 `Runtime outlet target is not a live connection`。'
      }
    },
    targetAmbiguous: {
      summary: {
        en: 'Exact diagnostic text: `Runtime outlet target identifies multiple connections`.',
        zh: '精确诊断文本为 `Runtime outlet target identifies multiple connections`。'
      }
    },
    eventInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime event subscription is invalid`.',
        zh: '精确诊断文本为 `Runtime event subscription is invalid`。'
      }
    },
    controlBorrowed: {
      summary: {
        en: 'Exact diagnostic text: `Runtime target does not own native execution`.',
        zh: '精确诊断文本为 `Runtime target does not own native execution`。'
      }
    },
    stopInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime stop configuration is invalid`.',
        zh: '精确诊断文本为 `Runtime stop configuration is invalid`。'
      }
    },
    filterInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime query filter is invalid`.',
        zh: '精确诊断文本为 `Runtime query filter is invalid`。'
      }
    },
    hostControlInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime host exposure requires its managed Host catalog and resolver`.',
        zh: '精确诊断文本为 `Runtime host exposure requires its managed Host catalog and resolver`。'
      }
    },
    coroutineReplaceInvalid: {
      summary: {
        en: 'Exact diagnostic text: `Runtime coroutine replacement requires a task function`.',
        zh: '精确诊断文本为 `Runtime coroutine replacement requires a task function`。'
      }
    }
  }
}
dataType(
  'IRpcContractErrorCode',
  'Semantic value union from RpcContractErrorCode in /error-code; diagnostic typing grants no runtime ownership.',
  '错误码入口中 `RpcContractErrorCode` 的语义值联合，诊断类型不授予运行所有权。',
  {}
)
dataType(
  'IRpcCoreErrorCode',
  'Semantic value union from RpcCoreErrorCode in /error-code; diagnostic typing grants no runtime ownership.',
  '错误码入口中 `RpcCoreErrorCode` 的语义值联合，诊断类型不授予运行所有权。',
  {}
)
dataType(
  'IRpcRemoteLayerErrorCode',
  'Semantic value union from RpcRemoteLayerErrorCode in /error-code; diagnostic typing grants no runtime ownership.',
  '错误码入口中 `RpcRemoteLayerErrorCode` 的语义值联合，诊断类型不授予运行所有权。',
  {}
)
dataType(
  'IRpcProcessErrorCode',
  'Semantic value union from RpcProcessErrorCode in /error-code; diagnostic typing grants no runtime ownership.',
  '错误码入口中 `RpcProcessErrorCode` 的语义值联合，诊断类型不授予运行所有权。',
  {}
)
dataType(
  'IRpcThreadErrorCode',
  'Semantic value union from RpcThreadErrorCode in /error-code; diagnostic typing grants no runtime ownership.',
  '错误码入口中 `RpcThreadErrorCode` 的语义值联合，诊断类型不授予运行所有权。',
  {}
)
dataType(
  'IRpcBrowserErrorCode',
  'Semantic value union from RpcBrowserErrorCode in /error-code; diagnostic typing grants no runtime ownership.',
  '错误码入口中 `RpcBrowserErrorCode` 的语义值联合，诊断类型不授予运行所有权。',
  {}
)
dataType(
  'IRpcCoroutineErrorCode',
  'Semantic value union from RpcCoroutineErrorCode in /error-code; diagnostic typing grants no runtime ownership.',
  '错误码入口中 `RpcCoroutineErrorCode` 的语义值联合，诊断类型不授予运行所有权。',
  {}
)
dataType(
  'IRpcPoolErrorCode',
  'Semantic value union from RpcPoolErrorCode in /error-code; diagnostic typing grants no runtime ownership.',
  '错误码入口中 `RpcPoolErrorCode` 的语义值联合，诊断类型不授予运行所有权。',
  {}
)
dataType(
  'IRpcDevtoolsErrorCode',
  'Semantic value union from RpcDevtoolsErrorCode in /error-code; diagnostic typing grants no runtime ownership.',
  '错误码入口中 `RpcDevtoolsErrorCode` 的语义值联合，诊断类型不授予运行所有权。',
  {}
)

symbols.serializeRpcWireError = {
  ...symbols.serializeRpcWireError!,
  cases: rpcContractCases.serializeRpcWireError
}
enums.RpcWireLimit = {
  ...enums.RpcWireLimit!,
  values: {
    ...enums.RpcWireLimit!.values,
    maxCapabilities: t(
      'At most 64 actual versioned extensions in an offer; the retained constant key does not restore a capability selector.',
      '提议最多包含六十四个实际带版本扩展，保留常量键不恢复旧能力选择器。'
    )
  }
}
enums.RpcStreamEvent = {
  ...enums.RpcStreamEvent!,
  values: {
    ...enums.RpcStreamEvent!.values,
    cancel: t(
      'Retained stream vocabulary; the sole semantic grammar cancels through its correlated cancel envelope, not an extra stream event shape.',
      '保留流词汇，唯一语义语法通过关联取消信封取消，不增加一种流事件形态。'
    )
  }
}
for (const name of Object.keys(types).filter(
  (name) => name.startsWith('Rpc') && name.endsWith('Error') && name !== 'RpcRemoteError'
)) {
  /** Inherited diagnostic fields remain on every actual RpcError subclass. */
  const type = types[name]!
  if (symbols[name]?.role === 'error')
    types[name] = {
      ...type,
      members: {
        ...type.members,
        cleanupErrors:
          type.members.cleanupErrors ??
          p(
            'Original optional release failures inherited from RpcError, without replacing the primary cause.',
            '从基础错误继承的可选原释放失败，不替换主原因。'
          )
      }
    }
}
for (const module of ['schema/wire-error', 'schema/protocol'] as const) {
  symbols[`${module}:default`] = {
    role: 'constant',
    purpose: modules[module]!.summary,
    example: `import schema from '@migaia/rpc-contract/${module}' with { type: 'json' }\nconst schemaId = schema.$id`
  }
}
/** Literal text keys are a diagnostic domain, not a menu of configuration switches. */
enums.RuntimeApiErrorText = {
  summary: symbols.RuntimeApiErrorText!.purpose,
  values: Object.fromEntries(
    Object.entries(types.RuntimeApiErrorText!.members).map(([key, member]) => [key, member.summary])
  )
}
types.IRpcCallFeatures = {
  ...types.IRpcCallFeatures!,
  members: {
    timeout: {
      ...types.IRpcCallFeatures!.members.timeout!,
      whenToUse: t(
        'Provide a complete timeout instance to override inherited policy, or false to disable it.',
        '提供完整超时实例以覆盖继承策略，或用假值禁用。'
      ),
      values: { false: t('Disable the inherited timeout instance.', '禁用继承超时实例。') },
      example: featureExample + '\nexport const noDeadline: IRpcCallFeatures = { timeout: false }'
    },
    retry: {
      ...types.IRpcCallFeatures!.members.retry!,
      whenToUse: t(
        'Select real originating generation replay with a full retry instance; false disables inheritance.',
        '使用完整重试实例选择真实发起代际重放，假值禁用继承。'
      ),
      values: { false: t('Disable the inherited retry instance.', '禁用继承重试实例。') },
      example: featureExample + '\nexport const noReplay: IRpcCallFeatures = { retry: false }'
    }
  }
}

/**
 * A port example receives the genuine resource and invokes this exact method, preserving return
 * identity.
 */
function portExample(type: string, method: string, indexes: readonly number[]): string {
  /** The imported declaration name excludes example-only generic instantiation arguments. */
  const name = type.split('<')[0]!
  /** Indexed access preserves the actual public signature without declaring another DTO. */
  const parameters = indexes.map(
    (index) => `arg${index}: Parameters<${type}['${method}']>[${index}]`
  )
  return `import type { ${name} } from '@migaia/rpc-contract/interfaces'\nexport function usePort(\n  owner: ${type}${parameters.length ? ',\n  ' + parameters.join(',\n  ') : ''}\n) {\n  return owner.${method}(${indexes.map((index) => `arg${index}`).join(', ')})\n}`
}
/** These method signatures borrow real native resources; no fake carrier or Session is constructed. */
for (const [type, method, indexes] of [
  ['IRpcCarrier', 'assertTransfer', []],
  ['IRpcCarrier', 'subscribe', [0]],
  ['IRpcCarrier', 'write', [0, 1]],
  ['IRpcCarrier', 'close', []],
  ['IRpcCarrierReceiver', 'frame', [0]],
  ['IRpcCarrierReceiver', 'close', [0]],
  ['IRpcCarrierReceiver', 'error', [0]],
  ['IRpcCarrierObservation', 'subscribe', [0]],
  ['IRpcCarrierCodec', 'prepare', [0, 1]],
  ['IRpcCarrierCodec', 'encode', [0, 1]],
  ['IRpcCarrierCodec', 'decode', [0, 1]],
  ['IRpcCarrierCodec', 'restore', [0, 1]],
  ['IRpcSessionHandle', 'close', []],
  ['IRpcTransportContext', 'self', []],
  ['IRpcTransportContext', 'lookup', [0]],
  ['IRpcTransportContext', 'attach', [0, 1]],
  ['IRpcTransportContext', 'openPrivateSession', [0, 1, 2]],
  ['IRpcTransportContext', 'attachOrigin', [0]],
  ['IRpcTransportContext', 'detach', [0, 1]],
  ['IRpcTransportContext', 'ping', [0, 1]],
  ['IRpcTransportContext', 'drain', [0, 1]],
  ['IRpcTransportContext', 'report', [0]],
  ['IRpcTargetSource', 'current', [0]],
  ['IRpcTargetSource', 'send', [0, 1, 2]],
  ['IRpcTargetSource', 'assertTransfer', [0, 1]],
  ['IRpcTargetSource', 'nativeGeneration', [0]],
  ['IRpcTargetSource', 'track', [0, 1]],
  ['IRpcOriginSelection', 'run', [0, 1]],
  ['IRpcPrivateSession', 'current', []],
  ['IRpcPrivateSession', 'send', [0, 1]],
  ['IRpcPrivateSession', 'assertTransfer', [0]],
  ['IRpcPrivateSession', 'ping', [0]],
  ['IRpcPrivateSession', 'drain', [0]],
  ['IRpcPrivateSession', 'announceDirectory', []],
  ['IRpcPrivateSession', 'track', [0]],
  ['IRpcPrivateSession', 'close', []],
  ['IRpcOriginBinding', 'assertTransfer', [0]],
  ['IRpcOriginBinding', 'close', []],
  ['IRpcOriginBinding', 'ping', [0]],
  ['IRpcOriginBinding', 'drain', [0]],
  ['IRpcOriginBinding', 'announceDirectory', []],
  ['IRpcOriginHandle', 'update', [0]],
  ['IRpcOriginHandle', 'close', []],
  ['IRpcEnvelopeContext', 'restore', [0]],
  ['IRpcFlowContext', 'report', [0]],
  ['IRpcEnvelopeContext', 'report', [0]],
  ['IRpcDispatchContext', 'report', [0]],
  ['IRpcDispatchContext', 'started', []],
  ['IRpcNativeGeneration', 'current', []],
  ['IRpcNativeGeneration', 'onLeave', [0, 1]],
  ['IRpcNativeGeneration', 'whenReady', [0, 1]],
  ['IRpcAvailableAttempt', 'onLeave', [0]],
  ['IRpcAvailableAttempt', 'whenReady', []],
  ['IRpcAttemptAvailability', 'current', []],
  ['IRpcAttempt<unknown>', 'invoke', [0, 1, 2]],
  ['IRpcTimeoutFeature', 'run', [0]],
  ['IRpcRetryFeature', 'run', [0]],
  ['IRpcFeatureContext', 'report', [0]],
  ['IRpcFeatureDefinition', 'install', [0]],
  ['IRpcTransportDefinition', 'open', [0]]
] as const) {
  /** Member examples remain attached to the canonical declaration despite generic instantiation. */
  const name = type.split('<')[0]!
  /** Replace only this member's example; its actual semantic description remains unchanged. */
  const current = types[name]!
  types[name] = {
    ...current,
    members: {
      ...current.members,
      [method]: { ...current.members[method]!, example: portExample(type, method, indexes) }
    }
  }
}
for (const [name, example] of [
  [
    'normalizeRpcTask',
    callExample +
      `\nimport { normalizeRpcTask } from '@migaia/rpc-contract/protocol'\nconst task = 'task' in frame ? normalizeRpcTask(frame.task) : undefined`
  ],
  [
    'normalizeRpcHandshake',
    handshakeExample +
      `\nimport { normalizeRpcHandshake } from '@migaia/rpc-contract/protocol'\nconst hello = normalizeRpcHandshake(provider)`
  ],
  [
    'normalizeRpcDirectory',
    handshakeExample +
      `\nimport { normalizeRpcDirectory } from '@migaia/rpc-contract/protocol'\nconst directory = normalizeRpcDirectory(provider.directory)`
  ],
  [
    'checkRpcDirectory',
    handshakeExample +
      `\nimport { checkRpcDirectory } from '@migaia/rpc-contract/protocol'\nconst checked = checkRpcDirectory(provider.directory)`
  ],
  [
    'normalizeRpcBinaryManifest',
    callExample +
      `\nimport {\n  normalizeRpcBinaryManifest, RpcWireBinaryProfile\n} from '@migaia/rpc-contract/protocol'\nconst manifest = 'task' in frame ? normalizeRpcBinaryManifest({\n  profile: RpcWireBinaryProfile, storage: 'inline', envelope: frame, backings: []\n}) : undefined`
  ]
] as const)
  symbols[name] = { ...symbols[name]!, example }

/** Optional provenance is supplied by this caller; standalone helpers keep no hidden error store. */
symbols.deserializeRpcError = {
  ...symbols.deserializeRpcError!,
  params: {
    value: symbols.deserializeRpcError!.params!.value!,
    options: symbols.deserializeRpcError!.params!.options!,
    metadata: metadataParam
  }
}
symbols.normalizeRpcSerializedError = {
  ...symbols.normalizeRpcSerializedError!,
  params: {
    ...symbols.normalizeRpcSerializedError!.params,
    metadata: metadataParam,
    causeProjector: causeProjectorParam
  }
}
symbols.reachRpcError = {
  ...symbols.reachRpcError!,
  params: { ...symbols.reachRpcError!.params, metadata: metadataParam }
}

/** These checks receive only the original cancellation field, not all wire call options. */
const finishCancel = {
  ...types.IRpcCallOptions!.members.cancel!,
  values: {
    'before-start': t(
      'Authorize finish without an item only while the original business operation has not started.',
      '只在原业务操作尚未开始时，允许不产生条目的完成控制。'
    )
  },
  whenToUse: t(
    'Pass the actual original stream call scope when checking a finish control; do not infer it from a later cancellation.',
    '检查无条目完成控制时传入原流调用的实际范围，不从后续取消推断。'
  ),
  example: `import { checkRpcRuntimeStreamFinish } from '@migaia/rpc-contract/protocol'
const violation = checkRpcRuntimeStreamFinish({ cancel: 'before-start' })`
}
for (const name of [
  'checkRpcRuntimeStreamTransition',
  'checkRpcRuntimeStreamIntent',
  'checkRpcRuntimeStreamFinish'
])
  symbols[name] = { ...symbols[name]!, optionDocs: { cancel: finishCancel } }
symbols.serializeRpcWireError = {
  ...symbols.serializeRpcWireError!,
  options: 'IRpcSerializeErrorOptions',
  optionDocs: {
    report: {
      ...types.IRpcSerializeErrorOptions!.members.report!,
      example: `import { serializeRpcWireError } from '@migaia/rpc-contract/protocol'
const original = new Error('checkout failed')
const wire = serializeRpcWireError(original, { report: console.error })`
    }
  }
}

/**
 * Literal values reuse their actual canonical domain; a narrower member still states its exact
 * role.
 */
for (const [type, member, domain] of [
  ['IRpcCallFeature', 'kind', 'RpcCallFeatureKind'],
  ['IRpcTimeoutFeature', 'kind', 'RpcCallFeatureKind'],
  ['IRpcRetryFeature', 'kind', 'RpcCallFeatureKind'],
  ['IRpcCarrierObservationEvent', 'direction', 'RpcProbeDirection'],
  ['IRpcCarrierWriteOptions', 'sendClass', 'IpcSendClass'],
  ['IRpcFrameWriteOptions', 'sendClass', 'IpcSendClass'],
  ['IRpcProbeDescriptor', 'authentication', 'RpcProbeAuthentication'],
  ['IRpcEnvelope', 'kind', 'RpcWireKind'],
  ['IRpcHello', 'kind', 'RpcWireKind'],
  ['IRpcAccept', 'kind', 'RpcWireKind'],
  ['IRpcReject', 'kind', 'RpcWireKind'],
  ['IRpcControlFrame', 'kind', 'RpcWireKind'],
  ['IRpcControlFrame', 'operation', 'RpcWireControlOperation'],
  ['IRpcDirectoryFrame', 'kind', 'RpcWireKind'],
  ['IRpcEnvelope', 'state', 'RpcRuntimeOutcomeState'],
  ['IRpcOutcomeLookupResult', 'state', 'RpcRuntimeOutcomeState'],
  ['IRpcMethodDescription', 'modeSource', 'RuntimeApiModeSource'],
  ['IRpcProviderMethodDeclaration', 'mode', 'RpcProviderMode']
] as const) {
  /** The canonical node retains its original member semantics and example. */
  const current = types[type]!
  types[type] = {
    ...current,
    members: {
      ...current.members,
      [member]: { ...current.members[member]!, values: { enum: domain } }
    }
  }
}
types.IRpcCallFeature = {
  ...types.IRpcCallFeature!,
  members: {
    ...types.IRpcCallFeature!.members,
    kind: {
      summary: t(
        'Select the complete timeout or retry implementation; the discriminator alone never supplies execution behavior.',
        '区分完整超时或重试实现，单独提供判别值并不具备执行行为。'
      ),
      values: { enum: 'RpcCallFeatureKind' }
    }
  }
}
for (const name of ['IRpcFlowContext', 'IRpcEnvelopeContext', 'IRpcDispatchContext']) {
  /** Flow hooks use string directions, unlike numeric observation direction ordinals. */
  const current = types[name]!
  types[name] = {
    ...current,
    members: {
      ...current.members,
      direction: {
        ...current.members.direction!,
        values: {
          outbound: t(
            'The local owner is sending this operation toward its accepted peer.',
            '本地所有者正在向已准入对端发送当前操作。'
          ),
          inbound: t(
            'The local owner received this operation from its accepted physical source.',
            '本地所有者从已准入物理来源收到当前操作。'
          )
        }
      }
    }
  }
}
types.IRpcEnvelope = {
  ...types.IRpcEnvelope!,
  members: {
    ...types.IRpcEnvelope!.members,
    stream: {
      ...types.IRpcEnvelope!.members.stream!,
      values: { enum: 'RpcStreamEvent' }
    }
  }
}

/**
 * Handoff callbacks observe an existing native boundary; their return value never authorizes a
 * write.
 */
for (const name of ['IRpcAttemptOptions', 'IRpcFrameWriteOptions']) {
  /** The original option member is reused without adding another write receipt type. */
  const current = types[name]!
  types[name] = {
    ...current,
    members: {
      ...current.members,
      onWriteStart: {
        ...current.members.onWriteStart!,
        returns: t(
          'Return void synchronously. The native owner is about to hand off this write; a thrown callback failure follows that write’s original failure path.',
          '同步返回空值，原生所有者即将交付本次写入；回调抛错沿本次写入的原失败路径传播。'
        )
      }
    }
  }
}
for (const method of ['current', 'send', 'assertTransfer', 'nativeGeneration', 'track']) {
  /** A logical origin receives this exact physical selection from its native resource owner. */
  const current = types.IRpcTargetSource!
  types.IRpcTargetSource = {
    ...current,
    members: {
      ...current.members,
      [method]: {
        ...current.members[method]!,
        params: {
          ...current.members[method]!.params,
          carrierId: t(
            'Use carrierId from the IRpcSessionSelection returned by this native source or supplied to IRpcOriginSelection.run; it identifies that exact acquired physical session.',
            '使用此原生来源返回、或传入 `IRpcOriginSelection.run` 回调的 `IRpcSessionSelection.carrierId`，它标识该次获取的精确物理会话。'
          )
        }
      }
    }
  }
}

/**
 * Returned data shapes have distinct application scenarios; none of these records owns live
 * execution.
 */
const dataScenarios: Readonly<Record<string, IText>> = {
  IRpcSerializedError: t(
    'Retain a bounded standalone diagnostic tree from serializeRpcError before storing or displaying a failure outside the live operation.',
    '从独立错误序列化操作取得有界诊断树后，可保存或展示失败，而无需保留活动操作对象。'
  ),
  IRpcCarrierFrame: t(
    'A carrier codec returns this outer frame so the real physical writer can deliver its opaque data and original sidecars.',
    '载体编解码器返回此外层帧，由真实物理写入方交付其非透明数据及原旁挂背板。'
  ),
  IRpcAccept: t(
    'After comparing two genuine hello offers, retain the selected agreement for the Session’s reciprocal confirmation and eventual publication.',
    '比较两个真实提议之后，保留选定协议供会话互确认及最终发布使用；记录本身不发布就绪。'
  ),
  IRpcBinaryManifest: t(
    'Pass admitted backing lengths and digests through envelope protection; the codec still owns computing hashes and restoring native values.',
    '把已接纳背板长度及摘要传过信封保护边界，实际计算哈希与恢复原生值仍由编解码器负责。'
  ),
  IRpcCallOptions: t(
    'Build portable ordering, before-start cancellation and idempotency fields for one task while keeping local signals and feature instances outside the wire.',
    '为一个任务构造线上顺序、启动前取消及幂等字段，本地信号与特性实例不放入协议记录。'
  ),
  IRpcCompletion: t(
    'An idempotency owner records the actual scalar or group business terminal; physical write completion alone cannot produce this result.',
    '幂等所有者保存真实标量或分组业务终态，单凭物理写入完成不能产生此结果。'
  ),
  IRpcDirectory: t(
    'Admit a peer’s version-three identity and method descriptions before compiling the immutable method lookup used by calls.',
    '在调用所用的不可变方法查询表编译之前，先接纳对端第三版身份和方法描述目录。'
  ),
  IRpcGeneration: t(
    'Echo the native owner’s exact provider and ordinal in task correlation so a successor generation cannot settle its predecessor’s work.',
    '在任务关联中沿用原生所有者的精确提供方与序号，防止后继代际结算前代工作。'
  ),
  IRpcHandshake: t(
    'Normalize a decoded hello, accept or reject before the Session performs identity admission and the bilateral readiness sequence.',
    '会话执行身份准入与双边就绪时序之前，先规范化已解码的提议、接纳或拒绝记录。'
  ),
  IRpcMethodSchema: t(
    'Publish bounded input, output or yielded-value schema data in a provider declaration; an installed schema plugin performs validation later.',
    '在提供方声明中发布有界输入、结果或产出值的数据模式，实际校验交给已安装的数据模式插件。'
  ),
  IRpcOutcome: t(
    'Read a stored business result together with the original selected target generation rather than treating it as a new live response.',
    '读取保存的业务结果及其原选定目标代际，不把旧结果当成新的活动调用响应。'
  ),
  IRpcOutcomeStore: t(
    'A real idempotency store reports its kind, epoch and continuity with a lookup, including an explicit unavailable state.',
    '真实幂等存储在查询时报告种类、纪元及连续性，存储不可用时必须明确表达该事实。'
  ),
  IRpcRoute: t(
    'Forward the same operation with its explicit trace and a reduced remaining budget; a hop cannot refresh the caller’s deadline.',
    '转发同一操作时保留显式关联并缩短剩余预算，中继不能刷新调用方的原始期限。'
  ),
  IRpcSemanticFrame: t(
    'Dispatch a canonical decode result by its handshake, operational, control or directory discriminator before it reaches the owning Host operation.',
    '按握手、业务、控制或目录判别值分发规范解码结果，再交给所属宿主操作处理。'
  ),
  IRpcShapeCheck: t(
    'Inspect an untrusted directory or provider declaration without throwing the shape result; branch on ok before reading value or the first diagnostic.',
    '检查未可信目录或提供方声明时不把形状结果抛出，先区分成功状态，再读取快照或首个诊断。'
  ),
  IRpcStep: t(
    'Compose a bounded ordered request group, giving each step its own method and optional payload while keeping the group’s task correlation.',
    '组成有界有序请求分组，各步骤有自身方法和可选载荷，同时共同沿用分组任务关联。'
  ),
  IRpcStepOutcome: t(
    'Inspect a group’s successful prefix, first failure and untouched suffix without mistaking not-executed steps for successful undefined results.',
    '检查分组成功前缀、首个失败及未执行后缀，不把未执行步骤误当成成功的未定义结果。'
  ),
  IRpcStreamEvent: t(
    'Validate one stream event’s closed payload shape before its owner checks held sequence and credit; this data record schedules no iterator work.',
    '先校验单条流事件的闭合载荷形态，再由所有者检查已有序号和额度；此数据记录不调度迭代器。'
  ),
  IRpcTask: t(
    'Preserve caller and target generation tuples on every related result, error or cancellation so correlation cannot move to another task.',
    '每条关联结果、错误或取消都保留调用方与目标代际组合，防止把关联移到另一个任务。'
  ),
  IRpcWireError: t(
    'Transfer a bounded error graph through the single protocol while retaining shared causes and cycles by node index instead of recursive copies.',
    '通过唯一协议传递有界错误图，以节点索引保留共享原因与循环，不递归复制同一个错误。'
  ),
  IRpcCarrier: t(
    'A transport installation lends its genuinely acquired connection and exact subscription cleanup to the Host; Contract never creates the native resource.',
    '传输安装把真实获取的连接及精确订阅清理借给宿主，纯契约本身不创建原生资源。'
  ),
  IRpcSessionHandle: t(
    'Keep the exact lifecycle handle returned by attach to await accepted metadata and close that same physical Session idempotently.',
    '保留附接返回的精确生命周期句柄，等待准入元数据，并幂等关闭同一个物理会话。'
  ),
  IRpcTimeoutFeature: t(
    'Select a complete timeout instance for an originating attempt; its timer releases when the actual attempt settles and a shorter inherited budget wins.',
    '为来源尝试选择完整超时实例，实际尝试结算即释放计时器，并始终采用更短的继承预算。'
  ),
  IRpcRetryFeature: t(
    'Select a complete retry instance for a supported originating request or group; only genuine availability and handoff facts can authorize replay.',
    '为受支持的来源请求或分组选择完整重试实例，只有真实可用性及交付事实才能授权重放。'
  )
}
for (const [name, scenario] of Object.entries(dataScenarios))
  types[name] = { ...types[name]!, scenarios: [scenario] }

/** Each native error family is used for its own diagnostic boundary, never as a control capability. */
for (const [name, en, zh] of [
  [
    'RpcError',
    'Preserve a concrete endpoint code and its original local cause when an operation reports a classified failure.',
    '操作报告分类失败时，保留具体端点错误码及其原本地原因。'
  ],
  [
    'RpcSchemaValidationError',
    'Return schema rejection details with the original validation cause, without executing another validator in the error constructor.',
    '返回数据模式拒绝详情及原校验原因，错误构造器不再执行另一个校验器。'
  ],
  [
    'RpcConfigurationError',
    'Reject an unsupported local configuration before acquiring the resource that depends on it.',
    '在获取依赖该配置的资源之前，拒绝不受支持的本地配置。'
  ],
  [
    'RpcConstructionError',
    'Report failed acquisition with the original primary cause and ordered rollback failures still reachable.',
    '报告资源获取失败时，保持最初原因及有序回滚失败均可追溯。'
  ],
  [
    'RpcLifecycleError',
    'Report real lifecycle acquisition or release failure while preserving original cleanup errors rather than replacing the primary.',
    '报告真实生命周期获取或释放失败，保留原清理错误，不替换主原因。'
  ],
  [
    'RpcSerializationError',
    'Report a failed value or error projection with the original unreadable field failure preserved.',
    '报告值或错误投影失败时，保留不可读字段产生的原始失败。'
  ],
  [
    'RpcProtocolError',
    'Classify invalid peer protocol data while keeping its bounded diagnostic and original parser cause.',
    '对非法对端协议数据分类，同时保留有界诊断及原解析原因。'
  ],
  [
    'RpcContractError',
    'Represent a pure admission failure as a native error without granting authority to copied source or code fields.',
    '把纯数据准入失败表示为原生错误，不给复制的来源或错误码字段授予权限。'
  ],
  [
    'RpcTransportError',
    'Carry transport-family diagnostics while retaining the original native IO failure on the cause chain.',
    '携带传输家族诊断，并在原因链保留原生输入输出失败。'
  ],
  [
    'RpcAuthenticationError',
    'Report rejection by the actual authentication owner without including raw credentials in presentation text.',
    '报告实际认证所有者的拒绝，展示文本不能包含原始凭证。'
  ],
  [
    'RpcChunkError',
    'Report a chunk limit or reassembly failure under the chunk owner, preserving its original cause.',
    '由分片所有者报告限额或重组失败，并保留其原始原因。'
  ],
  [
    'RpcRemoteError',
    'Display an arbitrary remote code and diagnostic payload while treating them as remote data rather than local execution authority.',
    '展示任意远端错误码及诊断载荷，把它们视为远端数据而非本地执行权限。'
  ],
  [
    'RpcAbortError',
    'Preserve the original cancellation reason with the standard AbortError name when reporting an aborted operation.',
    '报告操作中止时保持标准中止错误名称，并保留原取消原因。'
  ],
  [
    'RpcTimeoutError',
    'Report expiration of an actual deadline with the standard TimeoutError name and its original reason, without starting a timer in the constructor.',
    '报告实际期限到期时保持标准超时错误名称及原原因，构造器本身不启动计时器。'
  ]
] as const)
  types[name] = { ...types[name]!, scenarios: [t(en, zh)] }

/**
 * Examples construct only admitted public data; no fake carrier, receiver, ready receipt or codec
 * is used.
 */
for (const [name, example] of [
  ['IRpcSerializedError', symbols.serializeRpcError!.example!],
  [
    'IRpcCarrierFrame',
    `import { normalizeRpcCarrierFrame } from '@migaia/rpc-contract/protocol'
const frame = normalizeRpcCarrierFrame({ kind: 'message', data: '{}' }, new Set())`
  ],
  [
    'IRpcGeneration',
    `import { normalizeRpcGeneration } from '@migaia/rpc-contract/protocol'
const generation = normalizeRpcGeneration({ kind: 'session', value: 1, providerId: 'worker-1' })`
  ],
  [
    'IRpcStep',
    `import { normalizeRpcSteps } from '@migaia/rpc-contract/protocol'
const steps = normalizeRpcSteps([{ method: 'cart.total', payload: { cart: 'cart-1' } }])
const firstStep = steps[0]`
  ],
  [
    'IRpcStepOutcome',
    `import { normalizeRpcGroupResult, serializeRpcWireError } from '@migaia/rpc-contract/protocol'
const failure = serializeRpcWireError(new Error('inventory unavailable'), { report: console.error })
const outcomes = normalizeRpcGroupResult([
  { state: 'success', result: 42 },
  { state: 'failure', error: failure },
  { state: 'not-executed' }
])`
  ],
  [
    'IRpcCompletion',
    `import { normalizeRpcCompletion } from '@migaia/rpc-contract/protocol'
const completion = normalizeRpcCompletion({ ok: true, result: 42 }, 'request')`
  ],
  ['IRpcOutcome', symbols.normalizeRpcOutcome!.example!],
  ['IRpcOutcomeStore', symbols.normalizeRpcOutcomeStore!.example!],
  [
    'IRpcStreamEvent',
    `import { normalizeRpcStream } from '@migaia/rpc-contract/protocol'
const item = normalizeRpcStream({ event: 'item', seq: 1, value: { stock: 42 } })`
  ],
  [
    'IRpcBinaryManifest',
    callExample +
      `
import { normalizeRpcBinaryManifest, RpcWireBinaryProfile } from '@migaia/rpc-contract/protocol'
if ('task' in frame) {
  const manifest = normalizeRpcBinaryManifest({
    profile: RpcWireBinaryProfile, storage: 'inline', envelope: frame, backings: []
  })
}`
  ]
] as const)
  types[name] = { ...types[name]!, example }

/** Host documentation borrows the completed canonical interface nodes without a reverse dependency. */
export const reference: ILibraryReference = { modules, symbols, types, enums, enhancers: {} }
