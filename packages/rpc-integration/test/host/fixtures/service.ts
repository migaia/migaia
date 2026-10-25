import type { IRpcContext, IRpcHost } from '@migaia/rpc-host'

/** The parent exposes one scalar capability and a real generator to each direct native child. */
export type IParentApi = {
  parentRequest(value: number): number
  parentValues(value: number): AsyncGenerator<number>
}

/** Public examples retain typed scalar and generator results without a low-level endpoint API. */
export type IChildApi = {
  childRequest(value: number): number
  childValues(value: number): AsyncGenerator<number>
  reverseRequest(value: number): Promise<number>
  reverseValues(value: number): AsyncGenerator<number>
}

/** The actual caller identity directs reverse work back to that same accepted connection. */
export function childService(opening: () => Promise<IRpcHost<IParentApi>>, namespace: string) {
  return {
    /** Distinguishable scalar work proves provider execution rather than handshake success. */
    childRequest: (value: number) => value * 2,
    /** The canonical generator path carries two separate yielded items. */
    childValues: async function* (value: number) {
      yield value
      yield value + 1
    },
    /** The remote provider originates a new genuine request on its existing parent connection. */
    reverseRequest: async (value: number, context: IRpcContext) =>
      (await opening())[namespace]!.send(context.senderId, 'parentRequest', value),
    /** The remote provider consumes the parent's genuine stream before forwarding its items. */
    reverseValues: async function* (value: number, context: IRpcContext) {
      const host = await opening()
      /**
       * Explicit streaming selects the generator mode without relying on optional directory
       * schemas.
       */
      const stream = host[namespace]!.stream('parentValues', value, { targetId: context.senderId })
      for await (const item of stream) yield item
    }
  }
}
