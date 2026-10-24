/** Bilingual public boundary and original ownership contracts. */
import { rpcPluginOptionDocs } from './rpc-runtime-shared.js'
import { rpcApiGuides } from '../rpc-api-guides.js'
import type { ILibraryReference } from './contract.js'

/** Authored public reference; author primitives retain their actual parameter and resource owners. */
export const rpcBrowserReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Choose one of seven actual browser carriers and install it in createRpcHost. Both sides use the compatible RPC protocol. Native objects are borrowed; host closure releases only its sessions/subscriptions, with reliable WebTransport stream ownership handled separately.',
        zh: '选择七种实际浏览器载体之一安装到宿主，双方使用兼容调用协议。原生对象为借入，宿主关闭仅释放其会话和订阅，可靠网络传输流单独按归属清理。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
    }
  },
  symbols: {
    RPC_BROWSER_ERROR_SOURCE: {
      role: 'constant',
      purpose: {
        en: 'The `source` value (`@migaia/rpc/browser`) of Peer configuration and decoding errors of this package; compare it before branching on `code`.',
        zh: '本包 Peer 配置错误与解码错误上的 `source` 值（`@migaia/rpc/browser`）；先比对它确认来源，再按 `code` 分支处理。'
      },
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      }
    },
    RpcBrowserErrorCode: {
      role: 'constant',
      purpose: {
        en: 'Table of the stable error codes of this package; values are the strings on `error.code`.',
        zh: '本包稳定错误码的对照表；值就是错误对象 `error.code` 上的字符串。'
      },
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      }
    },

    windowPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:windowPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:windowPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Create a Window transport that accepts messages only when both the configured origin and native event.source match the intended peer.',
        zh: '创建与实际窗口通信的传输，同时核对配置的来源域和原生事件来源，仅接收目标窗口发来的匹配消息。'
      },
      options: 'IWindowPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    },
    dedicatedWorkerPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:dedicatedWorkerPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:dedicatedWorkerPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Borrow an actual page Worker or Worker self through the original EventTarget transport. No terminate is acquired.',
        zh: '经原事件目标传输借用实际页面工作程序或子端自身，不获取终止权限。'
      },
      options: 'IWorkerPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    },
    sharedWorkerPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:sharedWorkerPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:sharedWorkerPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Choose sharedWorker on the page or listen on a real connect-event scope. Each MessagePort has independent acceptance; closing one leaves other sessions intact.',
        zh: '页面选择共享工作程序，子端选择真实连接事件监听域，每个消息端口独立接纳，关闭一条会话不影响其他会话。'
      },
      options: 'ISharedWorkerPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    },
    broadcastChannelPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:broadcastChannelPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:broadcastChannelPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Join a real multiparty BroadcastChannel using original discovery, join/leave, and independent source proofs. The channel name is not peer identity; no transfer list exists.',
        zh: '经原发现、加入退出及独立来源证明接入真实多参与者频道，频道名不是对端身份，也没有转移列表。'
      },
      options: 'IBroadcastChannelPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    },
    serviceWorkerPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:serviceWorkerPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:serviceWorkerPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Separate page send target from receiver. Worker mode resolves actual event.source.id through clients.get before per-client handshake; payload claims grant no authority.',
        zh: '页面发送目标与接收面分开；子端经原生客户端查询解析真实事件来源标识后逐客户端握手，载荷自报不授予权限。'
      },
      options: 'IServiceWorkerPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    },
    rtcDataChannelPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:rtcDataChannelPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:rtcDataChannelPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Admit only ordered=true with maxRetransmits and maxPacketLifeTime both null. Applications own WebRTC negotiation and final native close.',
        zh: '仅接纳有序且重传次数、存活期限均为空的可靠频道，应用拥有协商及最终原生关闭。'
      },
      options: 'IRtcDataChannelPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    },
    webTransportPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:webTransportPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:webTransportPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Await the borrowed session.ready and create exactly one reliable bidirectional byte stream. Own reader/writer cleanup, not session.close; no datagram RPC.',
        zh: '等待借入会话就绪并只创建一条可靠双向字节流，拥有读写流清理而不关闭整个会话，不提供数据报调用。'
      },
      options: 'IWebTransportPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    }
  },
  types: {
    IRpcBrowserErrorCode: {
      summary: {
        en: 'Union of `RpcBrowserErrorCode` values.',
        zh: '`RpcBrowserErrorCode` 全部取值组成的联合类型。'
      },
      members: {}
    },

    IWindowPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost<{ title(): string }>({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })]\n  })\n  try {\n    return await host.request('title')\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        window: {
          summary: {
            en: 'Application-selected Window or iframe message destination; origin restricts delivery, and this target does not replace the local receiving container.',
            zh: '应用指定的页面或内嵌页面消息发送目标，配合 origin 限定投递范围，不作为本地消息接收容器。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost<{ title(): string }>({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })]\n  })\n  try {\n    return await host.request('title')\n  } finally {\n    await host.close()\n  }\n}"
        },
        origin: {
          summary: {
            en: 'Required nonempty destination origin. Wildcard requires explicit unsafe opt-in.',
            zh: '必填非空目标来源域，通配值须显式不安全选择。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost<{ title(): string }>({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })]\n  })\n  try {\n    return await host.request('title')\n  } finally {\n    await host.close()\n  }\n}"
        },
        receiver: {
          summary: {
            en: 'Local native receiving surface configured separately from the sending target; received events must still satisfy the selected origin and peer checks.',
            zh: '本地原生消息接收面，与发送目标分开配置，接收事件仍须满足已选来源与对端校验。'
          },
          default: {
            en: 'Omitted: original default receiver.',
            zh: '省略时使用原默认接收面。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost<{ title(): string }>({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })]\n  })\n  try {\n    return await host.request('title')\n  } finally {\n    await host.close()\n  }\n}"
        },
        allowUnsafeTargetOrigin: {
          summary: {
            en: 'Explicit true permits wildcard target origin; real source checking remains.',
            zh: '显式真值允许通配目标来源域，真实来源校验仍保留。'
          },
          default: {
            en: 'Omitted/false: wildcard rejected.',
            zh: '省略或假值时拒绝通配。'
          }
        }
      }
    },
    IWorkerPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        worker: {
          summary: {
            en: 'Actual browser Worker or its global sending/receiving surface supplied by the application; the Host borrows native listeners and neither launches nor terminates the Worker.',
            zh: '应用提供的实际浏览器工作程序或其全局收发面，宿主借用原生监听，不负责创建或终止工作程序。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
        }
      }
    },
    ISharedWorkerPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(worker: SharedWorker) {\n  const host = await createRpcHost<{ value(): number }>({\n    plugins: [sharedWorkerPlugin({ sharedWorker: worker })]\n  })\n  try {\n    return await host.request('value')\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        'sharedWorker.port': {
          summary: {
            en: 'The actual port supplied by the page-owned SharedWorker; the plugin subscribes to it without closing the borrowed port.',
            zh: '页面持有的共享工作程序提供的实际端口；插件订阅该借入端口，关闭插件不会关闭物理端口。'
          },
          default: {
            en: 'Absent in listen mode; required through sharedWorker in page mode.',
            zh: '监听模式不提供；页面模式通过 sharedWorker 提供。'
          }
        },

        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        sharedWorker: {
          summary: {
            en: 'Actual SharedWorker whose port is borrowed. Mutually exclusive with listen.',
            zh: '借入端口的实际共享工作程序，与监听来源互斥。'
          },
          default: {
            en: 'Absent in listener mode.',
            zh: '监听模式不提供。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(worker: SharedWorker) {\n  const host = await createRpcHost<{ value(): number }>({\n    plugins: [sharedWorkerPlugin({ sharedWorker: worker })]\n  })\n  try {\n    return await host.request('value')\n  } finally {\n    await host.close()\n  }\n}"
        },
        listen: {
          summary: {
            en: 'Native SharedWorker connect-event scope issuing actual ports.',
            zh: '签发实际端口的原生共享工作程序连接事件域。'
          },
          default: {
            en: 'Absent in page mode.',
            zh: '页面模式不提供。'
          }
        }
      }
    },
    IBroadcastChannelPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function listenOnChannel(channel: BroadcastChannel) {\n  const host = await createRpcHost({\n    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  return host\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        channel: {
          summary: {
            en: 'Actual BroadcastChannel created and owned by the application; the Host borrows it for messaging and does not close the native channel on Host shutdown.',
            zh: '应用创建并拥有的实际广播频道，宿主只借用它收发消息，关闭宿主不会代替应用关闭频道。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function listenOnChannel(channel: BroadcastChannel) {\n  const host = await createRpcHost({\n    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  return host\n}"
        }
      }
    },
    IServiceWorkerPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost<{ version(): string }>({\n    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]\n  })\n  try {\n    return await host.request('version')\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        serviceWorker: {
          summary: {
            en: 'Actual page-side sending target. Mutually exclusive with clients.',
            zh: '实际页面发送目标，与客户端监听来源互斥。'
          },
          default: {
            en: 'Absent in worker listener mode.',
            zh: '子端监听模式不提供。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost<{ version(): string }>({\n    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]\n  })\n  try {\n    return await host.request('version')\n  } finally {\n    await host.close()\n  }\n}"
        },
        receiver: {
          summary: {
            en: 'Local receiving container independent of the sending target, normally navigator.serviceWorker on a page; receives native messages returned by the selected target.',
            zh: '与发送目标独立的本地接收容器，页面端通常为 navigator.serviceWorker，用于接收目标返回的原生消息。'
          },
          default: {
            en: 'Omitted: navigator.serviceWorker when present.',
            zh: '省略时使用存在的原生服务工作程序容器。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost<{ version(): string }>({\n    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]\n  })\n  try {\n    return await host.request('version')\n  } finally {\n    await host.close()\n  }\n}"
        },
        clients: {
          summary: {
            en: 'Real worker scope with clients.get and native message subscription.',
            zh: '带原生客户端查询和消息订阅的真实子端域。'
          },
          default: {
            en: 'Absent in page mode.',
            zh: '页面模式不提供。'
          }
        }
      }
    },
    IRtcDataChannelPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callRtc(channel: RTCDataChannel) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        rtcDataChannel: {
          summary: {
            en: 'Application-supplied reliable ordered native data channel; the Host borrows its messaging interface while signaling, creation and native closure remain application-owned.',
            zh: '应用提供的可靠有序原生数据频道，宿主借用其消息接口；信令、频道创建与原生关闭仍由应用负责。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callRtc(channel: RTCDataChannel) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
        }
      }
    },
    IWebTransportPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport async function callReliableSession(session: IWebTransportPluginOptions['session']) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        session: {
          summary: {
            en: 'Application-established reliable session with createBidirectionalStream; counterpart must implement the compatible byte RPC protocol.',
            zh: '应用已建立且能创建双向流的可靠会话，对端须实现兼容字节调用协议。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport async function callReliableSession(session: IWebTransportPluginOptions['session']) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
        }
      }
    },
    IBrowserPluginOptions: {
      summary: {
        en: 'Shared cold registration, exposure and handshake policy; it provides no source authority by itself.',
        zh: '共用冷登记、公开及握手策略，本身不提供来源权限。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        }
      }
    }
  },
  enums: {
    RpcBrowserErrorCode: {
      summary: {
        en: 'Stable error codes of `@migaia/rpc-plugin-browser`.',
        zh: '`@migaia/rpc-plugin-browser` 的稳定错误码及其触发场景。'
      },
      values: {
        windowOriginRequired: {
          en: '`WINDOW_ORIGIN_REQUIRED`: a window Peer needs a non-empty `origin`.',
          zh: '`WINDOW_ORIGIN_REQUIRED`：创建窗口 Peer 时必须提供非空的 `origin`。'
        },
        rtcChannelUnreliable: {
          en: '`RTC_CHANNEL_UNRELIABLE`: the RTC channel is unordered or has retransmit limits.',
          zh: '`RTC_CHANNEL_UNRELIABLE`：RTC 频道无序或设置了重传限制。'
        },
        listenerAlreadyBound: {
          en: '`LISTENER_ALREADY_BOUND`: the SharedWorker scope already has a listener; close it first.',
          zh: '`LISTENER_ALREADY_BOUND`：该 SharedWorker 作用域已有监听器；需先关闭它。'
        },
        invalidPeerSource: {
          en: '`INVALID_PEER_SOURCE`: give exactly one supported `connect` or `listen`.',
          zh: '`INVALID_PEER_SOURCE`：必须且只能提供一个受支持的 `connect` 或 `listen`。'
        },
        messageDecodeFailed: {
          en: '`MESSAGE_DECODE_FAILED`: an RTC message is not valid JSON; see `cause`.',
          zh: '`MESSAGE_DECODE_FAILED`：收到的 RTC 消息不是合法的 JSON；原因见 `cause`。'
        }
      }
    }
  },
  enhancers: {
    windowPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Validate both explicit origin and the actual native event.source.',
        zh: '同时验证显式来源域及实际原生事件来源。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost<{ title(): string }>({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })]\n  })\n  try {\n    return await host.request('title')\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost<{ title(): string }>({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })]\n  })\n  try {\n    return await host.request('title')\n  } finally {\n    await host.close()\n  }\n}"
    },
    dedicatedWorkerPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Borrow an actual page Worker or Worker self through the original EventTarget transport. No terminate is acquired.',
        zh: '经原事件目标传输借用实际页面工作程序或子端自身，不获取终止权限。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
    },
    sharedWorkerPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Choose sharedWorker on the page or listen on a real connect-event scope. Each MessagePort has independent acceptance; closing one leaves other sessions intact.',
        zh: '页面选择共享工作程序，子端选择真实连接事件监听域，每个消息端口独立接纳，关闭一条会话不影响其他会话。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(worker: SharedWorker) {\n  const host = await createRpcHost<{ value(): number }>({\n    plugins: [sharedWorkerPlugin({ sharedWorker: worker })]\n  })\n  try {\n    return await host.request('value')\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(worker: SharedWorker) {\n  const host = await createRpcHost<{ value(): number }>({\n    plugins: [sharedWorkerPlugin({ sharedWorker: worker })]\n  })\n  try {\n    return await host.request('value')\n  } finally {\n    await host.close()\n  }\n}"
    },
    broadcastChannelPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Join a real multiparty BroadcastChannel using original discovery, join/leave, and independent source proofs. The channel name is not peer identity; no transfer list exists.',
        zh: '经原发现、加入退出及独立来源证明接入真实多参与者频道，频道名不是对端身份，也没有转移列表。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function listenOnChannel(channel: BroadcastChannel) {\n  const host = await createRpcHost({\n    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  return host\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function listenOnChannel(channel: BroadcastChannel) {\n  const host = await createRpcHost({\n    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  return host\n}"
    },
    serviceWorkerPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Separate page send target from receiver. Worker mode resolves actual event.source.id through clients.get before per-client handshake; payload claims grant no authority.',
        zh: '页面发送目标与接收面分开；子端经原生客户端查询解析真实事件来源标识后逐客户端握手，载荷自报不授予权限。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost<{ version(): string }>({\n    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]\n  })\n  try {\n    return await host.request('version')\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost<{ version(): string }>({\n    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]\n  })\n  try {\n    return await host.request('version')\n  } finally {\n    await host.close()\n  }\n}"
    },
    rtcDataChannelPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Admit only ordered=true with maxRetransmits and maxPacketLifeTime both null. Applications own WebRTC negotiation and final native close.',
        zh: '仅接纳有序且重传次数、存活期限均为空的可靠频道，应用拥有协商及最终原生关闭。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callRtc(channel: RTCDataChannel) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callRtc(channel: RTCDataChannel) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
    },
    webTransportPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Await the borrowed session.ready and create exactly one reliable bidirectional byte stream. Own reader/writer cleanup, not session.close; no datagram RPC.',
        zh: '等待借入会话就绪并只创建一条可靠双向字节流，拥有读写流清理而不关闭整个会话，不提供数据报调用。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport async function callReliableSession(session: IWebTransportPluginOptions['session']) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport async function callReliableSession(session: IWebTransportPluginOptions['session']) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
    }
  }
}
