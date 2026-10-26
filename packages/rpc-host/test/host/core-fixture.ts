/** Public new-profile hosts use real SDK transport installation and the existing test carrier. */
import { createRpcHost, defaultRpcReporter, type IRpcHostOptions } from '@migaia/rpc-host'
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { assert } from 'vitest'
import type {
  IRpcTransportContext,
  IRpcCarrierCodec,
  IRpcAttachedSession,
  IRpcCarrier,
  IRpcConnectionContext,
  IRpcSessionHandle
} from '@migaia/rpc-contract/interfaces'
import { MemoryCarrier } from '../fixtures/core-carrier.js'

/** Extra cold plugins are optional and install before the actual connecting transport. */
type ICoreConnectionOptions = Omit<IRpcHostOptions, 'self' | 'plugins'> &
  Partial<Pick<IRpcHostOptions, 'plugins'>>

/** Cold physical storage facts select the real codec's original inline or native capture policy. */
type ICoreCodec = Readonly<{
  create(): IRpcCarrierCodec
  nativeBinary: boolean
  closingWrites?: true
}>

/** Each genuine connecting native source owns exactly its original two physical endpoints. */
class CoreMemoryConnection {
  /** Accepted native context belongs to the original server installation, never a host facade. */
  readonly #server: IRpcTransportContext
  /** A client's host identity is independent from both carrier ids. */
  readonly #name: string
  /** The physical pair is exposed only for the existing native close-failure oracle. */
  readonly pair: readonly [MemoryCarrier, MemoryCarrier]

  /** Prepare cold native endpoints; actual attach happens only inside the client install hook. */
  constructor(server: IRpcTransportContext, name: string, key: string, codec?: ICoreCodec) {
    this.#server = server
    this.#name = name
    /** Two simultaneous subscriptions occur before either asynchronous hello can write. */
    const left = new MemoryCarrier(
      `${key}-server`,
      undefined,
      codec?.create(),
      codec?.nativeBinary,
      codec?.closingWrites
    )
    /** The opposite original endpoint is owned by the client's native installation. */
    const right = new MemoryCarrier(
      `${key}-client`,
      undefined,
      codec?.create(),
      codec?.nativeBinary,
      codec?.closingWrites
    )
    left.link(right)
    right.link(left)
    this.pair = [left, right]
  }

  /** Only the public root and SDK definition create either host/session owner. */
  async connect(options: ICoreConnectionOptions, instanceId: string) {
    /** Cold metadata is reusable; the actual receiving native core performs installation. */
    const plugin = defineTransportPlugin({
      name: 'core-memory-client-transport',
      namespace: this.#server.namespace,
      closingWrites: this.pair[0].closingWrites,
      open: this.#open
    })
    /** The real transport hook joins both original handshake completions before publishing client. */
    const host = await createRpcHost({
      ...options,
      self: { name: this.#name, instanceId },
      plugins: [...(options.plugins ?? []), plugin],
      report: options.report ?? (() => undefined)
    })
    return { host, pair: this.pair }
  }

  /** Two installed listener owners reuse this exact physical pair without constructing another Host. */
  readonly link = (context: IRpcTransportContext) => this.#open(context)

  /** The native client install owns both actual attachment operations and their original receipts. */
  readonly #open = async (context: IRpcTransportContext) => {
    /** Server and client subscribe synchronously before asynchronous pure handshake work. */
    const accepted = this.#server.attach(this.pair[0])
    /** The client resource is attached through its own genuine native context. */
    const connected = context.attach(this.pair[1])
    await Promise.all([accepted.ready, connected.ready])
    return { dispose: () => undefined }
  }
}

/** A real listener-style fixture stores only SDK native admission authority and cold definitions. */
class CoreMemoryServer {
  /** One native transport install receives this context and no business request facade. */
  #context: IRpcTransportContext | undefined
  /** Each physical connection gets unique local ids even when peer names intentionally collide. */
  #serial = 0
  /** Native listener disposal prevents later fixture acquisitions. */
  #closed = false
  /** A cold optional codec factory lends real SDK capture to each original physical endpoint. */
  readonly #codec: ICoreCodec | undefined
  /** Public root options keep the original baseline construction shape. */
  readonly options: IRpcHostOptions
  /** The genuine cold definition may join a public host with other transport namespaces. */
  readonly transport

  /** Construct no running host, carrier, second installation registry or alternate codec. */
  constructor(
    name: string,
    instanceId: string,
    namespace: string,
    features: readonly unknown[],
    expose: readonly string[],
    codec?: ICoreCodec
  ) {
    this.#codec = codec
    this.transport = defineTransportPlugin({
      name: `${namespace}-${name}-transport`,
      namespace,
      closingWrites: codec?.closingWrites,
      features,
      expose,
      open: this.#open
    })
    this.options = {
      self: { name, instanceId },
      plugins: [this.transport],
      report: () => undefined
    }
  }

  /** Connect a real public host through the listener's already installed native authority. */
  readonly connect = (name: string, options: ICoreConnectionOptions = {}, instanceId = name) => {
    if (!this.#context || this.#closed) throw new Error('core memory listener is not installed')
    return new CoreMemoryConnection(
      this.#context,
      name,
      `core-${this.#context.namespace}-${++this.#serial}-${instanceId}`,
      this.#codec
    ).connect(options, instanceId)
  }

  /** Borrow the canonical accepted handle/view directly; native tests keep no second identity index. */
  lookup(address: string): IRpcAttachedSession | undefined {
    return this.#context?.lookup(address)
  }

  /** Admit a native remote endpoint without attaching its independently owned local endpoint. */
  accept(carrier: IRpcCarrier, connection?: IRpcConnectionContext): IRpcSessionHandle {
    if (!this.#context || this.#closed) throw new Error('core memory listener is not installed')
    return this.#context.attach(carrier, undefined, connection)
  }

  /** Join only genuine installed native contexts through the same original pair/attach owner. */
  readonly link = async (other: CoreMemoryServer): Promise<void> => {
    assert(this.#context && other.#context && !this.#closed && !other.#closed)
    /** The remote listener owns one endpoint; this original listener owns the other. */
    const connection = new CoreMemoryConnection(
      other.#context,
      this.options.self!.name,
      `core-${this.#context.namespace}-${++this.#serial}-${this.options.self!.instanceId}-link`,
      this.#codec
    )
    await connection.link(this.#context)
  }

  /** Native plugin-host owns the exact listener cleanup returned here. */
  readonly #open = (context: IRpcTransportContext) => {
    this.#context = context
    return {
      dispose: () => {
        this.#closed = true
        this.#context = undefined
      }
    }
  }
}

/** Keep this bounded fixture beside its public host oracles; it never enters production exports. */
export function coreMemoryServer(
  name: string,
  instanceId = name,
  namespace = 'memory',
  features: readonly unknown[] = [],
  expose: readonly string[] = [],
  codec?: ICoreCodec
) {
  return new CoreMemoryServer(name, instanceId, namespace, features, expose, codec)
}

/** Connect public hosts over the original pair; remote plugins precede its actual native transport. */
export async function connectedCoreHosts(
  local: IRpcHostOptions['provide'] = {},
  remote: IRpcHostOptions['provide'] = {},
  report?: (error: unknown) => void,
  codec?: ICoreCodec,
  remoteReport = report,
  remotePlugins?: IRpcHostOptions['plugins']
) {
  /** The first actual native installation accepts the second without another carrier abstraction. */
  const server = coreMemoryServer('a', 'test-pair-a', 'memory', [], [], codec)
  /** Undefined report intentionally exercises the real host's default reporter. */
  const a = await createRpcHost({ ...server.options, provide: local, report })
  try {
    /** Client acquisition reuses CoreMemoryConnection and its genuine ready handshakes. */
    const connected = await server.connect(
      'b',
      { provide: remote, report: remoteReport, plugins: remotePlugins },
      'test-pair-b'
    )
    /** Cleanup borrows only these real host owners, never generated request/stream methods. */
    const owners = { a, b: connected.host }
    return {
      ...owners,
      pair: connected.pair,
      close: async () => {
        await Promise.all([owners.a.close(), owners.b.close()])
      }
    }
  } catch (primary) {
    try {
      await a.close()
    } catch (cleanup) {
      ;(report ?? defaultRpcReporter)(cleanup)
    }
    throw primary
  }
}
