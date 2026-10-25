/** Private connection credentials reach only the configured authentication resolver. */
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { probe } from '@migaia/rpc-host/plugins/probe'
import { defineFlowPlugin, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { coreMemoryServer } from '../../host/core-fixture.js'
import { MemoryCarrier } from '../../fixtures/core-carrier.js'

/** Original public constructions and carrier ids retain independent connection credentials. */
function credentialTransport(server: ReturnType<typeof coreMemoryServer>, label: string) {
  /** The existing native fixture owns both raw endpoints, without a second handshake or codec. */
  const operation = {
    server,
    label,
    local: new MemoryCarrier(`${label}-local`),
    remote: new MemoryCarrier(`${label}-remote`)
  }
  operation.local.link(operation.remote)
  operation.remote.link(operation.local)
  return defineTransportPlugin({
    name: `credentials-${label}`,
    namespace: 'memory',
    async open(context) {
      /** Trusted native authentication is separate from the connection's secret material. */
      const accepted = operation.server.accept(operation.remote, {
        credentials: `server-${operation.label}`,
        authentication: { principalId: `native-${operation.label}` }
      })
      /** Client attachment borrows only this connection's original native secret. */
      const connected = context.attach(operation.local, undefined, {
        credentials: `client-${operation.label}`
      })
      await Promise.all([accepted.ready, connected.ready])
      return { dispose() {} }
    }
  })
}

it.each([false, true])(
  'isolates private credentials with application verifier %s',
  async (application) => {
    /** Observe resolver inputs independently from ordinary named-pipeline context inspection. */
    const observed = {
      credentials: [] as { carrierId: string; value: unknown }[],
      contexts: [] as string[],
      captures: [] as string[],
      reports: [] as unknown[]
    }
    /** The original listener context owns every accepted Session, including two simultaneous peers. */
    const server = coreMemoryServer('server', 'credential-server')
    /** Ordinary stages must never receive the private value, even by enumerating the full context. */
    const inspect = defineFlowPlugin({
      name: 'inspect-credential-context',
      setup: () => ({
        stages: {
          handshakeOutbound(payload, next) {
            observed.contexts.push(JSON.stringify(payload.context))
            // A stage may forward an immutable copy while preserving the original result slot.
            return next({ ...payload, context: { ...payload.context } })
          }
        }
      })
    })
    /** The existing auth resolver is the sole recipient of the connection's borrowed credentials. */
    const authentication = auth({
      credentials(context) {
        observed.credentials.push({ carrierId: context.carrierId, value: context.credentials })
        return context.credentials
      },
      ...(application
        ? {
            verifyCredentials: (value: unknown) =>
              typeof value === 'string' ? { principalId: 'application-principal' } : undefined
          }
        : {})
    })
    /** Explicit content capture must still respect the private native bootstrap boundary. */
    const observation = probe({
      stages: ['envelope', 'encoded', 'frame', 'carrier', 'protected'],
      capture: ['envelope', 'encoded', 'frame', 'carrier', 'protected'],
      emit(view) {
        /** Snapshot borrowed content synchronously while the original view is valid. */
        const content = JSON.stringify(view.content)
        if (content) observed.captures.push(content)
      }
    })
    /** Real public Host installation preserves native principal fallback without an app verifier. */
    const host = await createRpcHost({
      ...server.options,
      plugins: [inspect, authentication, observation, server.transport],
      provide: { echo: (value: unknown) => value },
      report: (error) => observed.reports.push(error)
    })
    /** Each connected public Host remains owned until all isolation assertions have completed. */
    const clients: { close(): Promise<void> }[] = []
    try {
      for (const label of ['a', 'b']) {
        /** No auth dependency or capability is declared by this actual transport definition. */
        const client = await createRpcHost({
          self: { name: label, instanceId: `credential-${label}` },
          plugins: [authentication, observation, credentialTransport(server, label)],
          report: (error) => observed.reports.push(error)
        })
        clients.push(client)
        expect(await client.memory.send('server', 'echo', label)).toBe(label)
        expect(server.lookup(label)?.view.authentication?.principalId).toBe(
          application ? 'application-principal' : `native-${label}`
        )
      }
      expect(new Set(observed.credentials.map((entry) => entry.value))).toEqual(
        new Set(['server-a', 'client-a', 'server-b', 'client-b'])
      )
      for (const entry of observed.credentials)
        expect(entry.value).toBe(
          entry.carrierId.endsWith('-local')
            ? `client-${entry.carrierId[0]}`
            : `server-${entry.carrierId[0]}`
        )
      expect(observed.contexts.length).toBeGreaterThan(0)
      expect(observed.contexts.some((content) => /server-[ab]|client-[ab]/.test(content))).toBe(
        false
      )
      expect(observed.captures.length).toBeGreaterThan(0)
      expect(observed.captures.some((content) => /server-[ab]|client-[ab]/.test(content))).toBe(
        false
      )
      expect(JSON.stringify(server.lookup('a')?.view)).not.toContain('server-a')
      expect(observed.reports).toEqual([])
    } finally {
      await Promise.all(clients.map((client) => client.close()))
      await host.close()
    }
  }
)
