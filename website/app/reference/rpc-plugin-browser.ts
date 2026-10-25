/** Bilingual public reference for the current browser transport and feature ownership. */
import type { ILibraryReference } from './contract.js'

/** Concrete public package example with actual namespace and resource ownership. */
const example1 =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.worker.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example2 =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })]\n  })\n  try {\n    return await host.window.request('title')\n  } finally {\n    await host.close()\n  }\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example3 =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(worker: SharedWorker) {\n  const host = await createRpcHost({\n    plugins: [sharedWorkerPlugin({ sharedWorker: worker })]\n  })\n  try {\n    return await host.sharedWorker.request('value')\n  } finally {\n    await host.close()\n  }\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example4 =
  "// Other deployed participants provide double; the caller owns the borrowed channel.\nimport { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askParticipants(channel: BroadcastChannel) {\n  const host = await createRpcHost({\n    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  try {\n    return await host.broadcastChannel.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example5 =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost({\n    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]\n  })\n  try {\n    return await host.serviceWorker.request('version')\n  } finally {\n    await host.close()\n  }\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example6 =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callRtc(channel: RTCDataChannel) {\n  const host = await createRpcHost({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]\n  })\n  try {\n    return await host.rtcDataChannel.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example7 =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport async function callReliableSession(session: IWebTransportPluginOptions['session']) {\n  const host = await createRpcHost({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.webTransport.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"

/** Concrete public package example with actual namespace and resource ownership. */
const example8 =
  "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\nimport { timeout } from '@migaia/rpc-host/features/timeout'\nimport { probe } from '@migaia/rpc-host/plugins/probe'\n\nexport async function observeFrame(target: Window, origin: string) {\n  const observer = probe({\n    stages: ['peer'],\n    emit(view) {\n      console.log(view.lifecycle)\n    }\n  })\n  return createRpcHost({\n    plugins: [observer, windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] })]\n  })\n}"

/** Public configuration example for this native capability. */
const windowPluginScopeExample =
  "import { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport function transport(target: Window, origin: string) {\n  return windowPlugin({\n    window: target, origin,\n    namespace: 'support',\n    name: 'support-connection',\n    expose: ['math.double'],\n    connect: { timeoutMs: 1500 }\n  })\n}"

/** Public configuration example for this native capability. */
const dedicatedWorkerPluginScopeExample =
  "import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport function transport(worker: Worker) {\n  return dedicatedWorkerPlugin({\n    worker,\n    namespace: 'support',\n    name: 'support-connection',\n    expose: ['math.double'],\n    connect: { timeoutMs: 1500 }\n  })\n}"

/** Public configuration example for this native capability. */
const sharedWorkerPluginScopeExample =
  "import { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport function transport(worker: SharedWorker) {\n  return sharedWorkerPlugin({\n    sharedWorker: worker,\n    namespace: 'support',\n    name: 'support-connection',\n    expose: ['math.double'],\n    connect: { timeoutMs: 1500 }\n  })\n}"

/** Public configuration example for this native capability. */
const broadcastChannelPluginScopeExample =
  "import { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport function transport(channel: BroadcastChannel) {\n  return broadcastChannelPlugin({\n    channel,\n    namespace: 'support',\n    name: 'support-connection',\n    expose: ['math.double'],\n    connect: { timeoutMs: 1500 }\n  })\n}"

/** Public configuration example for this native capability. */
const serviceWorkerPluginScopeExample =
  "import { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport function transport(worker: ServiceWorker) {\n  return serviceWorkerPlugin({\n    serviceWorker: worker, receiver: navigator.serviceWorker,\n    namespace: 'support',\n    name: 'support-connection',\n    expose: ['math.double'],\n    connect: { timeoutMs: 1500 }\n  })\n}"

/** Public configuration example for this native capability. */
const rtcDataChannelPluginScopeExample =
  "import { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport function transport(channel: RTCDataChannel) {\n  return rtcDataChannelPlugin({\n    rtcDataChannel: channel,\n    namespace: 'support',\n    name: 'support-connection',\n    expose: ['math.double'],\n    connect: { timeoutMs: 1500 }\n  })\n}"

/** Public configuration example for this native capability. */
const webTransportPluginScopeExample =
  "import { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport function transport(session: IWebTransportPluginOptions['session']) {\n  return webTransportPlugin({\n    session,\n    namespace: 'support',\n    name: 'support-connection',\n    expose: ['math.double'],\n    connect: { timeoutMs: 1500 }\n  })\n}"

/** Public configuration example for this native capability. */
const serviceClientsExample =
  "import { serviceWorkerPlugin, type IServiceWorkerPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport function servingClients(clients: NonNullable<IServiceWorkerPluginOptions['clients']>) {\n  return serviceWorkerPlugin({ clients, namespace: 'clients' })\n}"

/** Public configuration example for this native capability. */
const sharedListenerExample =
  "import { sharedWorkerPlugin, type ISharedWorkerPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport function sharedListener(listen: NonNullable<ISharedWorkerPluginOptions['listen']>) {\n  return sharedWorkerPlugin({ listen, namespace: 'clients' })\n}"

/** Public configuration example for this native capability. */
const wildcardWindowExample =
  "import { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport function opaqueOriginFrame(target: Window) {\n  return windowPlugin({ window: target, origin: '*', allowUnsafeTargetOrigin: true })\n}"

/** Current public modules, configuration and installed capabilities. */
export const rpcBrowserReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Contract owns pure protocol, interfaces and errors. Host owns Sessions, calls and providers; this package owns borrowed browser messaging sources and reliable streams. Flow plugins use fixed hooks, and complete features own optional policy. Call through the transport namespace. Separate Hosts are usual; deliberate multi-transport installation uses distinct namespaces.',
        zh: '契约包拥有纯协议、接口及错误；宿主拥有会话、调用及提供方，本包拥有借用的浏览器消息来源及可靠流。流程插件使用固定钩子，完整功能拥有可选策略。通过传输命名空间调用；通常使用独立宿主，也可用不同命名空间明确隔离多传输安装。'
      },
      example: example1
    }
  },
  symbols: {
    RPC_BROWSER_ERROR_SOURCE: {
      role: 'constant',
      purpose: {
        en: 'Stable rpc.transport.browser source declared by @migaia/rpc-contract/error-code and re-exported here. Other RPC/native families retain their own source and code.',
        zh: '由契约包错误码入口声明并在此重导出的稳定来源 rpc.transport.browser；其他远程调用及原生家族保留自身来源与错误码。'
      },
      example: {
        en: example1,
        zh: example1
      }
    },
    RpcBrowserErrorCode: {
      role: 'constant',
      purpose: {
        en: 'Table of the stable error codes of this package; values are the strings on `error.code`.',
        zh: '本包稳定错误码的对照表；值就是错误对象 `error.code` 上的字符串。'
      },
      example: {
        en: example1,
        zh: example1
      }
    },
    windowPlugin: {
      example: {
        en: example2,
        zh: example2
      },
      role: 'enhancer',
      purpose: {
        en: 'Create a Window transport that accepts messages only when both the configured origin and native event.source match the intended peer.',
        zh: '创建与实际窗口通信的传输，同时核对配置的来源域和原生事件来源，仅接收目标窗口发来的匹配消息。'
      },
      options: 'IWindowPluginOptions',
      returns: {
        en: 'Cold SDK transport definition. Installation publishes its selected namespace; native resources remain owned according to this source recipe.',
        zh: '返回冷 SDK 传输定义；安装后发布所选命名空间，原生资源按此来源配方保留所有权。'
      }
    },
    dedicatedWorkerPlugin: {
      example: {
        en: example1,
        zh: example1
      },
      role: 'enhancer',
      purpose: {
        en: 'Borrow an actual page Worker or Worker self through the original EventTarget transport. No terminate is acquired.',
        zh: '经原事件目标传输借用实际页面工作程序或子端自身，不获取终止权限。'
      },
      options: 'IWorkerPluginOptions',
      returns: {
        en: 'Cold SDK transport definition. Installation publishes its selected namespace; native resources remain owned according to this source recipe.',
        zh: '返回冷 SDK 传输定义；安装后发布所选命名空间，原生资源按此来源配方保留所有权。'
      }
    },
    sharedWorkerPlugin: {
      example: {
        en: example3,
        zh: example3
      },
      role: 'enhancer',
      purpose: {
        en: 'Choose sharedWorker on the page or listen on a real connect-event scope. Each MessagePort has independent acceptance; closing one leaves other sessions intact.',
        zh: '页面选择共享工作程序，子端选择真实连接事件监听域，每个消息端口独立接纳，关闭一条会话不影响其他会话。'
      },
      options: 'ISharedWorkerPluginOptions',
      returns: {
        en: 'Cold SDK transport definition. Installation publishes its selected namespace; native resources remain owned according to this source recipe.',
        zh: '返回冷 SDK 传输定义；安装后发布所选命名空间，原生资源按此来源配方保留所有权。'
      }
    },
    broadcastChannelPlugin: {
      example: {
        en: example4,
        zh: example4
      },
      role: 'enhancer',
      purpose: {
        en: 'Join a real multiparty BroadcastChannel using original discovery, join/leave, and independent source proofs. The channel name is not peer identity; no transfer list exists.',
        zh: '经原发现、加入退出及独立来源证明接入真实多参与者频道，频道名不是对端身份，也没有转移列表。'
      },
      options: 'IBroadcastChannelPluginOptions',
      returns: {
        en: 'Cold SDK transport definition. Installation publishes its selected namespace; native resources remain owned according to this source recipe.',
        zh: '返回冷 SDK 传输定义；安装后发布所选命名空间，原生资源按此来源配方保留所有权。'
      }
    },
    serviceWorkerPlugin: {
      example: {
        en: example5,
        zh: example5
      },
      role: 'enhancer',
      purpose: {
        en: 'Separate page send target from receiver. Worker mode resolves actual event.source.id through clients.get before per-client handshake; payload claims grant no authority.',
        zh: '页面发送目标与接收面分开；子端经原生客户端查询解析真实事件来源标识后逐客户端握手，载荷自报不授予权限。'
      },
      options: 'IServiceWorkerPluginOptions',
      returns: {
        en: 'Cold SDK transport definition. Installation publishes its selected namespace; native resources remain owned according to this source recipe.',
        zh: '返回冷 SDK 传输定义；安装后发布所选命名空间，原生资源按此来源配方保留所有权。'
      }
    },
    rtcDataChannelPlugin: {
      example: {
        en: example6,
        zh: example6
      },
      role: 'enhancer',
      purpose: {
        en: 'Admit only ordered=true with maxRetransmits and maxPacketLifeTime both null. Applications own WebRTC negotiation and final native close.',
        zh: '仅接纳有序且重传次数、存活期限均为空的可靠频道，应用拥有协商及最终原生关闭。'
      },
      options: 'IRtcDataChannelPluginOptions',
      returns: {
        en: 'Cold SDK transport definition. Installation publishes its selected namespace; native resources remain owned according to this source recipe.',
        zh: '返回冷 SDK 传输定义；安装后发布所选命名空间，原生资源按此来源配方保留所有权。'
      }
    },
    webTransportPlugin: {
      example: {
        en: example7,
        zh: example7
      },
      role: 'enhancer',
      purpose: {
        en: 'Await the borrowed session.ready and create exactly one reliable bidirectional byte stream. Own reader/writer cleanup, not session.close; no datagram RPC.',
        zh: '等待借入会话就绪并只创建一条可靠双向字节流，拥有读写流清理而不关闭整个会话，不提供数据报调用。'
      },
      options: 'IWebTransportPluginOptions',
      returns: {
        en: 'Cold SDK transport definition. Installation publishes its selected namespace; native resources remain owned according to this source recipe.',
        zh: '返回冷 SDK 传输定义；安装后发布所选命名空间，原生资源按此来源配方保留所有权。'
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
      example: example2,
      members: {
        name: {
          summary: {
            en: 'Local native registration name, separate from accepted remote identity.',
            zh: '本地原生登记名称，与已接纳的远端身份分开。'
          },
          default: {
            en: 'Omitted: the native registration default.',
            zh: '省略时使用原生登记默认名称。'
          },
          example: windowPluginScopeExample
        },
        expose: {
          summary: {
            en: 'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
            zh: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。'
          },
          default: {
            en: 'Omitted: no ordinary Feature output selected.',
            zh: '省略时不选取普通功能输出。'
          },
          example: windowPluginScopeExample
        },
        connect: {
          summary: {
            en: 'Settings for the sole Session handshake budget.',
            zh: '唯一会话握手预算的设置。'
          },
          default: {
            en: 'Omitted: Host handshake default.',
            zh: '省略时使用宿主握手默认值。'
          },
          example: windowPluginScopeExample
        },
        'connect.timeoutMs': {
          summary: {
            en: 'Finite nonnegative Session negotiation budget in milliseconds.',
            zh: '会话协商使用的有限非负毫秒预算。'
          },
          default: {
            en: 'Omitted: inherit the Host Session budget in milliseconds; its built-in fallback is 10,000 ms.',
            zh: '省略时继承宿主会话的毫秒预算；内置回退值为 10,000 毫秒。'
          },
          example: windowPluginScopeExample
        },
        window: {
          summary: {
            en: 'Application-selected Window or iframe message destination; origin restricts delivery, and this target does not replace the local receiving container.',
            zh: '应用指定的页面或内嵌页面消息发送目标，配合 `origin` 限定实际投递范围，不作为本端接收器。'
          },
          example: example2
        },
        origin: {
          summary: {
            en: 'Required nonempty destination origin. Wildcard requires explicit unsafe opt-in.',
            zh: '必填非空目标来源域，通配值须显式不安全选择。'
          },
          example: example2
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
          example: example2
        },
        allowUnsafeTargetOrigin: {
          summary: {
            en: 'Explicit true permits wildcard target origin; real source checking remains.',
            zh: '显式真值允许通配目标来源域，真实来源校验仍保留。'
          },
          default: {
            en: 'Omitted/false: wildcard rejected.',
            zh: '省略或假值时拒绝通配。'
          },
          example: wildcardWindowExample
        },
        namespace: {
          summary: {
            en: 'Unique Host property exposing this transport calls and extensions.',
            zh: '宿主发布此传输调用及扩展的唯一属性名。'
          },
          default: {
            en: 'Omitted: the factory namespace.',
            zh: '省略时使用工厂默认命名空间。'
          },
          example: windowPluginScopeExample
        },
        features: {
          summary: {
            en: 'Complete call-feature instances scoped to this transport.',
            zh: '作用于此传输的完整调用功能实例。'
          },
          default: {
            en: 'Omitted: no optional policy installed by this field.',
            zh: '省略时不通过此字段安装可选策略。'
          },
          example: example8
        }
      }
    },
    IWorkerPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example: example1,
      members: {
        name: {
          summary: {
            en: 'Local native registration name, separate from accepted remote identity.',
            zh: '本地原生登记名称，与已接纳的远端身份分开。'
          },
          default: {
            en: 'Omitted: the native registration default.',
            zh: '省略时使用原生登记默认名称。'
          },
          example: dedicatedWorkerPluginScopeExample
        },
        expose: {
          summary: {
            en: 'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
            zh: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。'
          },
          default: {
            en: 'Omitted: no ordinary Feature output selected.',
            zh: '省略时不选取普通功能输出。'
          },
          example: dedicatedWorkerPluginScopeExample
        },
        connect: {
          summary: {
            en: 'Settings for the sole Session handshake budget.',
            zh: '唯一会话握手预算的设置。'
          },
          default: {
            en: 'Omitted: Host handshake default.',
            zh: '省略时使用宿主握手默认值。'
          },
          example: dedicatedWorkerPluginScopeExample
        },
        'connect.timeoutMs': {
          summary: {
            en: 'Finite nonnegative Session negotiation budget in milliseconds.',
            zh: '会话协商使用的有限非负毫秒预算。'
          },
          default: {
            en: 'Omitted: inherit the Host Session budget in milliseconds; its built-in fallback is 10,000 ms.',
            zh: '省略时继承宿主会话的毫秒预算；内置回退值为 10,000 毫秒。'
          },
          example: dedicatedWorkerPluginScopeExample
        },
        worker: {
          summary: {
            en: 'Actual browser Worker or its global sending/receiving surface supplied by the application; the Host borrows native listeners and neither launches nor terminates the Worker.',
            zh: '应用提供的实际浏览器工作程序或其全局收发面，宿主借用原生监听，不负责创建或终止工作程序。'
          },
          example: example1
        },
        namespace: {
          summary: {
            en: 'Unique Host property exposing this transport calls and extensions.',
            zh: '宿主发布此传输调用及扩展的唯一属性名。'
          },
          default: {
            en: 'Omitted: the factory namespace.',
            zh: '省略时使用工厂默认命名空间。'
          },
          example: dedicatedWorkerPluginScopeExample
        },
        features: {
          summary: {
            en: 'Complete call-feature instances scoped to this transport.',
            zh: '作用于此传输的完整调用功能实例。'
          },
          default: {
            en: 'Omitted: no optional policy installed by this field.',
            zh: '省略时不通过此字段安装可选策略。'
          },
          example: example8
        }
      }
    },
    ISharedWorkerPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example: example3,
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
          summary: {
            en: 'Local native registration name, separate from accepted remote identity.',
            zh: '本地原生登记名称，与已接纳的远端身份分开。'
          },
          default: {
            en: 'Omitted: the native registration default.',
            zh: '省略时使用原生登记默认名称。'
          },
          example: sharedWorkerPluginScopeExample
        },
        expose: {
          summary: {
            en: 'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
            zh: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。'
          },
          default: {
            en: 'Omitted: no ordinary Feature output selected.',
            zh: '省略时不选取普通功能输出。'
          },
          example: sharedWorkerPluginScopeExample
        },
        connect: {
          summary: {
            en: 'Settings for the sole Session handshake budget.',
            zh: '唯一会话握手预算的设置。'
          },
          default: {
            en: 'Omitted: Host handshake default.',
            zh: '省略时使用宿主握手默认值。'
          },
          example: sharedWorkerPluginScopeExample
        },
        'connect.timeoutMs': {
          summary: {
            en: 'Finite nonnegative Session negotiation budget in milliseconds.',
            zh: '会话协商使用的有限非负毫秒预算。'
          },
          default: {
            en: 'Omitted: inherit the Host Session budget in milliseconds; its built-in fallback is 10,000 ms.',
            zh: '省略时继承宿主会话的毫秒预算；内置回退值为 10,000 毫秒。'
          },
          example: sharedWorkerPluginScopeExample
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
          example: example3
        },
        listen: {
          summary: {
            en: 'Native SharedWorker connect-event scope issuing actual ports.',
            zh: '签发实际端口的原生共享工作程序连接事件域。'
          },
          default: {
            en: 'Absent in page mode.',
            zh: '页面模式不提供。'
          },
          example: sharedListenerExample
        },
        namespace: {
          summary: {
            en: 'Unique Host property exposing this transport calls and extensions.',
            zh: '宿主发布此传输调用及扩展的唯一属性名。'
          },
          default: {
            en: 'Omitted: the factory namespace.',
            zh: '省略时使用工厂默认命名空间。'
          },
          example: sharedWorkerPluginScopeExample
        },
        features: {
          summary: {
            en: 'Complete call-feature instances scoped to this transport.',
            zh: '作用于此传输的完整调用功能实例。'
          },
          default: {
            en: 'Omitted: no optional policy installed by this field.',
            zh: '省略时不通过此字段安装可选策略。'
          },
          example: example8
        }
      }
    },
    IBroadcastChannelPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example: example4,
      members: {
        name: {
          summary: {
            en: 'Local native registration name, separate from accepted remote identity.',
            zh: '本地原生登记名称，与已接纳的远端身份分开。'
          },
          default: {
            en: 'Omitted: the native registration default.',
            zh: '省略时使用原生登记默认名称。'
          },
          example: broadcastChannelPluginScopeExample
        },
        expose: {
          summary: {
            en: 'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
            zh: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。'
          },
          default: {
            en: 'Omitted: no ordinary Feature output selected.',
            zh: '省略时不选取普通功能输出。'
          },
          example: broadcastChannelPluginScopeExample
        },
        connect: {
          summary: {
            en: 'Settings for the sole Session handshake budget.',
            zh: '唯一会话握手预算的设置。'
          },
          default: {
            en: 'Omitted: Host handshake default.',
            zh: '省略时使用宿主握手默认值。'
          },
          example: broadcastChannelPluginScopeExample
        },
        'connect.timeoutMs': {
          summary: {
            en: 'Finite nonnegative Session negotiation budget in milliseconds.',
            zh: '会话协商使用的有限非负毫秒预算。'
          },
          default: {
            en: 'Omitted: inherit the Host Session budget in milliseconds; its built-in fallback is 10,000 ms.',
            zh: '省略时继承宿主会话的毫秒预算；内置回退值为 10,000 毫秒。'
          },
          example: broadcastChannelPluginScopeExample
        },
        channel: {
          summary: {
            en: 'Actual BroadcastChannel created and owned by the application; the Host borrows it for messaging and does not close the native channel on Host shutdown.',
            zh: '应用创建并拥有的实际广播频道，宿主只借用它收发消息，关闭宿主不会代替应用关闭频道。'
          },
          example: example4
        },
        namespace: {
          summary: {
            en: 'Unique Host property exposing this transport calls and extensions.',
            zh: '宿主发布此传输调用及扩展的唯一属性名。'
          },
          default: {
            en: 'Omitted: the factory namespace.',
            zh: '省略时使用工厂默认命名空间。'
          },
          example: broadcastChannelPluginScopeExample
        },
        features: {
          summary: {
            en: 'Complete call-feature instances scoped to this transport.',
            zh: '作用于此传输的完整调用功能实例。'
          },
          default: {
            en: 'Omitted: no optional policy installed by this field.',
            zh: '省略时不通过此字段安装可选策略。'
          },
          example: example8
        }
      }
    },
    IServiceWorkerPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example: example5,
      members: {
        name: {
          summary: {
            en: 'Local native registration name, separate from accepted remote identity.',
            zh: '本地原生登记名称，与已接纳的远端身份分开。'
          },
          default: {
            en: 'Omitted: the native registration default.',
            zh: '省略时使用原生登记默认名称。'
          },
          example: serviceWorkerPluginScopeExample
        },
        expose: {
          summary: {
            en: 'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
            zh: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。'
          },
          default: {
            en: 'Omitted: no ordinary Feature output selected.',
            zh: '省略时不选取普通功能输出。'
          },
          example: serviceWorkerPluginScopeExample
        },
        connect: {
          summary: {
            en: 'Settings for the sole Session handshake budget.',
            zh: '唯一会话握手预算的设置。'
          },
          default: {
            en: 'Omitted: Host handshake default.',
            zh: '省略时使用宿主握手默认值。'
          },
          example: serviceWorkerPluginScopeExample
        },
        'connect.timeoutMs': {
          summary: {
            en: 'Finite nonnegative Session negotiation budget in milliseconds.',
            zh: '会话协商使用的有限非负毫秒预算。'
          },
          default: {
            en: 'Omitted: inherit the Host Session budget in milliseconds; its built-in fallback is 10,000 ms.',
            zh: '省略时继承宿主会话的毫秒预算；内置回退值为 10,000 毫秒。'
          },
          example: serviceWorkerPluginScopeExample
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
          example: example5
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
          example: example5
        },
        clients: {
          summary: {
            en: 'Real worker scope with clients.get and native message subscription.',
            zh: '带原生客户端查询和消息订阅的真实子端域。'
          },
          default: {
            en: 'Absent in page mode.',
            zh: '页面模式不提供。'
          },
          example: serviceClientsExample
        },
        namespace: {
          summary: {
            en: 'Unique Host property exposing this transport calls and extensions.',
            zh: '宿主发布此传输调用及扩展的唯一属性名。'
          },
          default: {
            en: 'Omitted: the factory namespace.',
            zh: '省略时使用工厂默认命名空间。'
          },
          example: serviceWorkerPluginScopeExample
        },
        features: {
          summary: {
            en: 'Complete call-feature instances scoped to this transport.',
            zh: '作用于此传输的完整调用功能实例。'
          },
          default: {
            en: 'Omitted: no optional policy installed by this field.',
            zh: '省略时不通过此字段安装可选策略。'
          },
          example: example8
        }
      }
    },
    IRtcDataChannelPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example: example6,
      members: {
        name: {
          summary: {
            en: 'Local native registration name, separate from accepted remote identity.',
            zh: '本地原生登记名称，与已接纳的远端身份分开。'
          },
          default: {
            en: 'Omitted: the native registration default.',
            zh: '省略时使用原生登记默认名称。'
          },
          example: rtcDataChannelPluginScopeExample
        },
        expose: {
          summary: {
            en: 'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
            zh: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。'
          },
          default: {
            en: 'Omitted: no ordinary Feature output selected.',
            zh: '省略时不选取普通功能输出。'
          },
          example: rtcDataChannelPluginScopeExample
        },
        connect: {
          summary: {
            en: 'Settings for the sole Session handshake budget.',
            zh: '唯一会话握手预算的设置。'
          },
          default: {
            en: 'Omitted: Host handshake default.',
            zh: '省略时使用宿主握手默认值。'
          },
          example: rtcDataChannelPluginScopeExample
        },
        'connect.timeoutMs': {
          summary: {
            en: 'Finite nonnegative Session negotiation budget in milliseconds.',
            zh: '会话协商使用的有限非负毫秒预算。'
          },
          default: {
            en: 'Omitted: inherit the Host Session budget in milliseconds; its built-in fallback is 10,000 ms.',
            zh: '省略时继承宿主会话的毫秒预算；内置回退值为 10,000 毫秒。'
          },
          example: rtcDataChannelPluginScopeExample
        },
        rtcDataChannel: {
          summary: {
            en: 'Application-supplied reliable ordered native data channel; the Host borrows its messaging interface while signaling, creation and native closure remain application-owned.',
            zh: '应用提供的可靠有序原生数据频道，宿主借用其消息接口；信令、频道创建与原生关闭仍由应用负责。'
          },
          example: example6
        },
        namespace: {
          summary: {
            en: 'Unique Host property exposing this transport calls and extensions.',
            zh: '宿主发布此传输调用及扩展的唯一属性名。'
          },
          default: {
            en: 'Omitted: the factory namespace.',
            zh: '省略时使用工厂默认命名空间。'
          },
          example: rtcDataChannelPluginScopeExample
        },
        features: {
          summary: {
            en: 'Complete call-feature instances scoped to this transport.',
            zh: '作用于此传输的完整调用功能实例。'
          },
          default: {
            en: 'Omitted: no optional policy installed by this field.',
            zh: '省略时不通过此字段安装可选策略。'
          },
          example: example8
        }
      }
    },
    IWebTransportPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example: example7,
      members: {
        name: {
          summary: {
            en: 'Local native registration name, separate from accepted remote identity.',
            zh: '本地原生登记名称，与已接纳的远端身份分开。'
          },
          default: {
            en: 'Omitted: the native registration default.',
            zh: '省略时使用原生登记默认名称。'
          },
          example: webTransportPluginScopeExample
        },
        expose: {
          summary: {
            en: 'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
            zh: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。'
          },
          default: {
            en: 'Omitted: no ordinary Feature output selected.',
            zh: '省略时不选取普通功能输出。'
          },
          example: webTransportPluginScopeExample
        },
        connect: {
          summary: {
            en: 'Settings for the sole Session handshake budget.',
            zh: '唯一会话握手预算的设置。'
          },
          default: {
            en: 'Omitted: Host handshake default.',
            zh: '省略时使用宿主握手默认值。'
          },
          example: webTransportPluginScopeExample
        },
        'connect.timeoutMs': {
          summary: {
            en: 'Finite nonnegative Session negotiation budget in milliseconds.',
            zh: '会话协商使用的有限非负毫秒预算。'
          },
          default: {
            en: 'Omitted: inherit the Host Session budget in milliseconds; its built-in fallback is 10,000 ms.',
            zh: '省略时继承宿主会话的毫秒预算；内置回退值为 10,000 毫秒。'
          },
          example: webTransportPluginScopeExample
        },
        session: {
          summary: {
            en: 'Application-established reliable session with createBidirectionalStream; counterpart must implement the compatible byte RPC protocol.',
            zh: '应用已建立且能创建双向流的可靠会话，对端须实现兼容字节调用协议。'
          },
          example: example7
        },
        namespace: {
          summary: {
            en: 'Unique Host property exposing this transport calls and extensions.',
            zh: '宿主发布此传输调用及扩展的唯一属性名。'
          },
          default: {
            en: 'Omitted: the factory namespace.',
            zh: '省略时使用工厂默认命名空间。'
          },
          example: webTransportPluginScopeExample
        },
        features: {
          summary: {
            en: 'Complete call-feature instances scoped to this transport.',
            zh: '作用于此传输的完整调用功能实例。'
          },
          default: {
            en: 'Omitted: no optional policy installed by this field.',
            zh: '省略时不通过此字段安装可选策略。'
          },
          example: example8
        }
      }
    },
    IBrowserPluginOptions: {
      summary: {
        en: 'Shared cold registration, exposure and handshake policy; it provides no source authority by itself.',
        zh: '共用冷登记、公开及握手策略，本身不提供来源权限。'
      },
      example: example1,
      members: {
        name: {
          summary: {
            en: 'Local native registration name, separate from accepted remote identity.',
            zh: '本地原生登记名称，与已接纳的远端身份分开。'
          },
          default: {
            en: 'Omitted: the native registration default.',
            zh: '省略时使用原生登记默认名称。'
          }
        },
        expose: {
          summary: {
            en: 'Feature output paths selected on an ordinary PluginHost; createRpcHost uses its own provide catalog.',
            zh: '普通插件宿主选取的功能输出路径；远程调用宿主使用自身提供方目录。'
          },
          default: {
            en: 'Omitted: no ordinary Feature output selected.',
            zh: '省略时不选取普通功能输出。'
          }
        },
        connect: {
          summary: {
            en: 'Settings for the sole Session handshake budget.',
            zh: '唯一会话握手预算的设置。'
          },
          default: {
            en: 'Omitted: Host handshake default.',
            zh: '省略时使用宿主握手默认值。'
          }
        },
        'connect.timeoutMs': {
          summary: {
            en: 'Finite nonnegative Session negotiation budget in milliseconds.',
            zh: '会话协商使用的有限非负毫秒预算。'
          },
          default: {
            en: 'Omitted: inherit the Host Session budget in milliseconds; its built-in fallback is 10,000 ms.',
            zh: '省略时继承宿主会话的毫秒预算；内置回退值为 10,000 毫秒。'
          }
        },
        namespace: {
          summary: {
            en: 'Unique Host property exposing this transport calls and extensions.',
            zh: '宿主发布此传输调用及扩展的唯一属性名。'
          },
          default: {
            en: 'Omitted: the factory namespace.',
            zh: '省略时使用工厂默认命名空间。'
          }
        },
        features: {
          summary: {
            en: 'Complete call-feature instances scoped to this transport.',
            zh: '作用于此传输的完整调用功能实例。'
          },
          default: {
            en: 'Omitted: no optional policy installed by this field.',
            zh: '省略时不通过此字段安装可选策略。'
          },
          example: example8
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
        zh: '借用真实目标窗口及来源筛选建立双向命名空间调用，安装不拥有窗口关闭权限。'
      },
      install: example2,
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
      example: example2
    },
    dedicatedWorkerPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Borrow an actual page Worker or Worker self through the original EventTarget transport. No terminate is acquired.',
        zh: '经原事件目标传输借用实际页面工作程序或子端自身，不获取终止权限。'
      },
      install: example1,
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
      example: example1
    },
    sharedWorkerPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Choose sharedWorker on the page or listen on a real connect-event scope. Each MessagePort has independent acceptance; closing one leaves other sessions intact.',
        zh: '页面选择共享工作程序，子端选择真实连接事件监听域，每个消息端口独立接纳，关闭一条会话不影响其他会话。'
      },
      install: example3,
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
      example: example3
    },
    broadcastChannelPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Join a real multiparty BroadcastChannel using original discovery, join/leave, and independent source proofs. The channel name is not peer identity; no transfer list exists.',
        zh: '经原发现、加入退出及独立来源证明接入真实多参与者频道，频道名不是对端身份，也没有转移列表。'
      },
      install: example4,
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
      example: example4
    },
    serviceWorkerPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Separate page send target from receiver. Worker mode resolves actual event.source.id through clients.get before per-client handshake; payload claims grant no authority.',
        zh: '页面发送目标与接收面分开；子端经原生客户端查询解析真实事件来源标识后逐客户端握手，载荷自报不授予权限。'
      },
      install: example5,
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
      example: example5
    },
    rtcDataChannelPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Admit only ordered=true with maxRetransmits and maxPacketLifeTime both null. Applications own WebRTC negotiation and final native close.',
        zh: '仅接纳有序且重传次数、存活期限均为空的可靠频道，应用拥有协商及最终原生关闭。'
      },
      install: example6,
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
      example: example6
    },
    webTransportPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Await the borrowed session.ready and create exactly one reliable bidirectional byte stream. Own reader/writer cleanup, not session.close; no datagram RPC.',
        zh: '等待借入会话就绪并只创建一条可靠双向字节流，拥有读写流清理而不关闭整个会话，不提供数据报调用。'
      },
      install: example7,
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
      example: example7
    }
  }
}
