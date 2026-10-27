/** Exercises configurable forwarding across actual Process and nested Worker sources. */
import { expect, it } from 'vitest'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import {
  RpcProbeStage,
  RpcProbeDirection,
  RpcProbeOutcome,
  RpcProbeForwardRejection
} from '@migaia/rpc-contract/interfaces'
import {
  ForwardFixture,
  type IForwardFixtureOptions,
  type IForwardNodeSnapshot
} from './fixtures/forward-observation.ts'

/** Native source acquisition, bootstrap and Session negotiation remain the public transport's work. */
async function topology(options: IForwardFixtureOptions): Promise<IRpcHost> {
  /** The process recipe receives only application fixture options, not source or Session facts. */
  const host = await createRpcHost({
    self: { name: 'a', instanceId: 'a21-origin' },
    plugins: [
      processPlugin({
        name: ForwardFixture.b,
        spawn: {
          entry: new URL('./fixtures/forward-process-b.ts', import.meta.url),
          args: [JSON.stringify(options)]
        }
      })
    ]
  })
  try {
    await host.process.send(ForwardFixture.b, ForwardFixture.ready)
    return host
  } catch (error) {
    await host.close()
    throw error
  }
}

it('forwards two native hops and exposes each hop through probe and default Devtools', async () => {
  /** B and c use their unchanged default forwarding ceilings. */
  const host = await topology({ observed: true })
  try {
    expect(
      await host.process.send(ForwardFixture.b, ForwardFixture.forwarded, 42, {
        trace: ForwardFixture.trace
      })
    ).toEqual({ rendered: 42 })
    /** This query goes to actual providers; its different trace cannot contaminate render rows. */
    const b = (await host.process.send(
      ForwardFixture.b,
      ForwardFixture.inspect
    )) as IForwardNodeSnapshot
    /** The nested snapshots originate from the same accepted Worker sources used by render. */
    const c = b.child!
    const d = c.child!
    expect(d.renderCalls).toBe(1)
    /** Actual forwarding node ids are private route facts, distinct from public endpoint ids. */
    const bForward = b.observations!.probe.filter((event) => event.stage === RpcProbeStage.forward)
    const cForward = c.observations!.probe.filter((event) => event.stage === RpcProbeStage.forward)
    expect(bForward).toHaveLength(2)
    expect(cForward).toHaveLength(2)
    /** Each genuine forwarding emitter supplies its own append without a private debug port. */
    const originId = bForward[0]!.route[0]!
    const bNodeId = bForward[1]!.route[1]!
    const cNodeId = cForward[1]!.route[2]!
    for (const id of [originId, bNodeId, cNodeId]) expect(id).toEqual(expect.any(String))
    expect(new Set([originId, bNodeId, cNodeId]).size).toBe(3)
    for (const [node, hop, received, sent] of [
      [b, 1, [originId], [originId, bNodeId]],
      [c, 2, [originId, bNodeId], [originId, bNodeId, cNodeId]]
    ] as const) {
      /** Borrowed probe arrays were copied synchronously by their original callback. */
      const probe = node.observations!.probe.filter(
        (event) => event.stage === RpcProbeStage.forward
      )
      expect(probe.map((event) => event.outcome)).toEqual([
        RpcProbeOutcome.received,
        RpcProbeOutcome.sent
      ])
      expect(probe.map((event) => event.hop)).toEqual([hop, hop])
      expect(probe.map((event) => event.endpointId)).toEqual([node.selfId, node.selfId])
      expect(probe.map((event) => event.maxHops)).toEqual([3, 3])
      expect(probe.map((event) => event.route)).toEqual([received, sent])
      /** Default collector stages retain forwarding rows in the same real message timeline. */
      const timeline = node.observations!.devtools.filter((event) => event.stage === 'forward')
      expect(timeline.map((event) => event.outcome)).toEqual(['received', 'sent'])
      expect(timeline.map((event) => event.hop)).toEqual([hop, hop])
      expect(timeline.map((event) => event.route)).toEqual([received, sent])
      expect(timeline.map((event) => event.messageId)).toEqual(
        probe.map((event) => event.messageId)
      )
    }
    /** The final actual provider receives the route without becoming another forwarding host. */
    const inbound = d.observations!.probe.find(
      (event) =>
        event.stage === RpcProbeStage.message && event.direction === RpcProbeDirection.inbound
    )
    expect(inbound).toMatchObject({ hop: 2, route: [originId, bNodeId, cNodeId] })
  } finally {
    await host.close()
  }
})

it('applies c own hop ceiling before d business is entered', async () => {
  /** Only the second actual forwarding host changes its own admitted configuration. */
  const host = await topology({ observed: true, cMaxHops: 1 })
  try {
    /** Preserve the actual remote error for its original diagnostic route assertion below. */
    let rejection: unknown
    /** The observer rethrows the same received error; it does not project or replace it. */
    const pending = host.process
      .send(ForwardFixture.b, ForwardFixture.forwarded, 42, { trace: ForwardFixture.trace })
      .catch((error: unknown) => {
        rejection = error
        throw error
      })
    await expect(pending).rejects.toMatchObject({
      source: 'rpc.endpoint',
      code: 'FORWARD_HOP_LIMIT'
    })
    /** Actual downstream provider state distinguishes refusal from a successful hidden delivery. */
    const b = (await host.process.send(
      ForwardFixture.b,
      ForwardFixture.inspect
    )) as IForwardNodeSnapshot
    const c = b.child!
    const d = c.child!
    expect(d.renderCalls).toBe(0)
    /** The first real forwarding node's handoff is the already-traversed refusal route. */
    const bSent = b.observations!.probe.find(
      (event) => event.stage === RpcProbeStage.forward && event.outcome === RpcProbeOutcome.sent
    )
    expect(bSent).toBeDefined()
    expect(rejection).toMatchObject({ route: bSent!.route })
    /** The real refusal records c's own policy and the original already-traversed route. */
    const forward = c.observations!.probe.filter((event) => event.stage === RpcProbeStage.forward)
    expect(forward.map((event) => event.outcome)).toEqual([
      RpcProbeOutcome.received,
      RpcProbeOutcome.rejected
    ])
    expect(forward[1]).toMatchObject({
      hop: 2,
      maxHops: 1,
      route: bSent!.route,
      rejection: RpcProbeForwardRejection.hopLimit
    })
  } finally {
    await host.close()
  }
})

it.each([0, 17, 1.5])(
  'rejects unsupported maxHops=%s during public construction',
  async (maxHops) => {
    /** A valid cold source avoids testing an earlier missing-transport rejection. */
    const transport = processPlugin({
      name: ForwardFixture.b,
      spawn: new URL('./fixtures/forward-process-b.ts', import.meta.url)
    })
    expect(() => createRpcHost({ plugins: [transport], forward: { maxHops } })).toThrowError(
      expect.objectContaining({ source: 'rpc.endpoint', code: 'INVALID_CONFIG' })
    )
  }
)

it('keeps actual native forwarding functional without probe or Devtools installed', async () => {
  /**
   * This path installs neither observer plugin; allocation absence is paired with owner source
   * proof.
   */
  const host = await topology({ observed: false })
  try {
    expect(await host.process.send(ForwardFixture.b, ForwardFixture.forwarded, 42)).toEqual({
      rendered: 42
    })
  } finally {
    await host.close()
  }
})
