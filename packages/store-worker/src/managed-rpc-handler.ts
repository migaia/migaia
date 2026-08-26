import type { IWebRpcEndpoint } from '@migaia/web-rpc'

/**
 * Worker 侧托管的 RPC 消息处理器。
 *
 * 生命周期遵循 `lifecycle-extraction.sdd.md` §4.1：`disposeAsync()` 不存在，`dispose()` 是唯一 异步释放入口并恒返回
 * `Promise<void>`；同步的「停止接受新工作」用 `close()`，它只标记不可用、 不执行用户清理。
 */
export type IManagedRpcHandler = {
  (message: unknown): Promise<void>
  /**
   * 唯一异步释放入口。先 `close()`，再等待底层 endpoint 初始化并执行 `endpoint.dispose()`； 不吞清理错误（失败会 reject），重复调用复用同一个
   * Promise。
   */
  dispose(): Promise<void>
  /** 同步标记不可用：仅置 `disposed = true`，不执行底层释放。幂等。 */
  close(): void
  readonly pendingCount: number
  readonly disposed: boolean
}

type IManagedEndpoint<TTargetId extends string = string> = Pick<
  IWebRpcEndpoint<TTargetId, 'automatic', false>,
  'dispose'
>

export function toManagedRpcHandler<TTargetId extends string = string>(
  endpointPromise: Promise<IManagedEndpoint<TTargetId>>,
  deliver: (message: unknown) => void
): IManagedRpcHandler {
  let pendingCount = 0
  let disposed = false
  let disposePromise: Promise<void> | undefined

  const handler = (async (message: unknown): Promise<void> => {
    if (disposed) return
    pendingCount += 1
    try {
      await endpointPromise
      deliver(message)
      await Promise.resolve()
    } finally {
      pendingCount -= 1
    }
  }) as IManagedRpcHandler

  handler.close = () => {
    disposed = true
  }

  handler.dispose = () => {
    if (disposePromise === undefined) {
      disposePromise = (async () => {
        handler.close()
        const endpoint = await endpointPromise
        await endpoint.dispose()
      })()
    }
    return disposePromise
  }

  Object.defineProperty(handler, 'pendingCount', { get: () => pendingCount })
  Object.defineProperty(handler, 'disposed', { get: () => disposed })
  return handler
}
