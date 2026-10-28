/** Real native children exercise closing calls through the same public namespace as business work. */
import { createRpcHost, type IRpcHost, type IRpcClosingEvent } from '@migaia/rpc-host'
import type { IRpcTransportPlugin } from '@migaia/rpc-host/sdk'
import { RpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { limitsFeature } from '@migaia/rpc-host/plugins/limits'

/** Each mode chooses an existing public close trigger rather than a fixture-only production seam. */
export type ICloseFixtureMode = 'namespace' | 'host' | 'limits' | 'idle'

/** Stable fixture values correlate actual child providers, wire errors and parent observations. */
export const CloseFixture = {
  child: 'worker',
  namespace: 'native',
  primary: 'native close',
  cause: 'original close cause',
  notify: 'closing-notify',
  request: 'closing-request',
  summary: 'closing-summary',
  hook: 'closing hook failure',
  invalid: 'Unexpected native closing fixture result',
  local: 'independent parent close'
} as const

/** Both transports serialize the same native error chain without custom protocol handling. */
export function closeFixtureReason(): RpcError {
  return new RpcError(
    RpcCoreErrorCode.transport,
    CloseFixture.primary,
    new RpcError(RpcCoreErrorCode.endpointDisposed, CloseFixture.cause)
  )
}

/** Both native modes expose the same supported public namespace. */
type ICloseChildHost = IRpcHost<
  Record<never, never>,
  readonly IRpcTransportPlugin<'native', object, true>[]
>

/** One real child owns its provider counters and closing workload without a closure component. */
class CloseChild {
  /** The selected trigger configures the original limits owner or public lifecycle method. */
  readonly #mode: ICloseFixtureMode
  /** Public native installation is the only readiness barrier used by the actual providers. */
  readonly #opening: Promise<ICloseChildHost>
  /** Only a real namespace close request enables the keepalive workload. */
  #active = false
  /** A closing inbound refusal must not enter this original business provider a second time. */
  #echoCalls = 0

  /** Construct the public Host with genuine native acquisition and optional original limits. */
  constructor(plugin: IRpcTransportPlugin<'native', object, true>, mode: ICloseFixtureMode) {
    this.#mode = mode
    this.#opening = createRpcHost({
      plugins: [
        ...(mode === 'limits'
          ? [limitsFeature({ maxPayloadBytes: 32, violationLimit: 1 })]
          : mode === 'idle'
            ? [limitsFeature({ idleTimeoutMs: 500 })]
            : []),
        plugin
      ] as const,
      report: () => undefined,
      provide: {
        echo: this.#echo,
        /** Preserve the actual captured portable record without a fixture-specific codec. */
        echoPayload: (value: unknown) => value,
        /** Only the Process acceptance case uses this actual child pid for its owned kill trigger. */
        nativePid: () => process.pid,
        /**
         * The original pending provider is deliberately left unanswered until its native owner
         * stops.
         */
        hang: () => new Promise<never>(() => undefined),
        /** A one-way trigger does not wait for a reply on the Session being retired. */
        beginClose: this.#beginClose
      }
    })
  }

  /** Attach the real public closing hook only after native installation commits. */
  async open(): Promise<void> {
    const host = await this.#opening
    host.native.onClosing(this.#onClosing)
  }

  /** Actual business entry is distinguishable from a rejected or fabricated reply. */
  readonly #echo = (value: number): number => {
    this.#echoCalls += 1
    return value
  }

  /** Namespace and whole-Host disposal both enter the same physical Session owner. */
  readonly #beginClose = async (): Promise<void> => {
    this.#active = this.#mode === 'namespace'
    const host = await this.#opening
    await (this.#mode === 'host' ? host.close : host.native.close)(closeFixtureReason())
  }

  /** Keepalive calls use the original namespace, provider and CallTable throughout closing. */
  readonly #onClosing = async ({ peer }: IRpcClosingEvent): Promise<void> => {
    if (!this.#active) return
    const host = await this.#opening
    await host.native.notify('mark', CloseFixture.notify, { keepalive: true })
    /** This result must arrive through the original CallTable while Session is still closing. */
    const response = await host.native.send(peer.peerId, 'answer', CloseFixture.request, {
      keepalive: true
    })
    /** Ordinary admission and quota rejection remain separately observable before final close. */
    const ordinary = await host.native
      .send(peer.peerId, 'answer', 'ordinary')
      .catch((error: unknown) =>
        error instanceof Error ? (error as Error & { code?: string }).code : undefined
      )
    /** This payload alone exceeds the default byte quota, independent of any framing overhead. */
    const quota = await host.native
      .send(peer.peerId, 'answer', 'x'.repeat(65537), { keepalive: true })
      .catch((error: unknown) =>
        error instanceof Error ? (error as Error & { code?: string }).code : undefined
      )
    if (typeof response !== 'number' || typeof ordinary !== 'string' || typeof quota !== 'string')
      throw new RpcError(RpcCoreErrorCode.internal, CloseFixture.invalid)
    await host.native.notify(
      'mark',
      { kind: CloseFixture.summary, response, ordinary, quota, echoCalls: this.#echoCalls },
      { keepalive: true }
    )
  }
}

/** Open an actual parent source and let its Session own every close write and cleanup. */
export function runCloseChild(
  plugin: IRpcTransportPlugin<'native', object, true>,
  mode: ICloseFixtureMode = 'namespace'
): Promise<void> {
  return new CloseChild(plugin, mode).open()
}
