import { describe, expect, it } from 'vitest'
import { defineHost } from '@migaia/plugin-host'
import { createCoroutinePlugin, normalizeRemoteContract } from '../../dist/remote/index.js'
import type { IRpcAuthenticationConfig } from '../../dist/core/index.js'

/** The string signature wraps encrypted frames exactly as a real application boundary does. */
type ISignedFrame = Readonly<{ text: string; mac: number[] }>

/** AES-GCM carries its per-frame IV beside ciphertext before HMAC signs the whole value. */
type IEncryptedFrame = Readonly<{ iv: number[]; body: number[] }>

/** Create actual WebCrypto transforms; verification rejects raw startup control objects. */
async function protection(unprotected: unknown[]): Promise<IRpcAuthenticationConfig> {
  /** Both peers intentionally share the same application keys in this same-realm coroutine. */
  const hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify'
  ])
  /** Encryption remains asynchronous, preserving the public transform ordering under cleanup. */
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ])
  /** Transform text always uses the same portable UTF-8 wire representation. */
  const encoder = new TextEncoder()
  /** Decrypted bytes return to the authenticated application envelope unchanged. */
  const decoder = new TextDecoder()
  return {
    encodedType: 'string',
    encrypt: async (value) => {
      /** Each actual encrypted frame uses a fresh nonce, including close/control data. */
      const iv = crypto.getRandomValues(new Uint8Array(12))
      /** The authentication owner supplies the exact envelope that must survive the round trip. */
      const body = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aes,
        encoder.encode(JSON.stringify(value))
      )
      return { iv: Array.from(iv), body: Array.from(new Uint8Array(body)) }
    },
    decrypt: async (value) => {
      /** HMAC verification must already have returned the original ciphertext envelope. */
      const encrypted = value as IEncryptedFrame
      /** Native authentication failures remain reachable through the Core authentication error. */
      const body = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) },
        aes,
        new Uint8Array(encrypted.body)
      )
      return JSON.parse(decoder.decode(body))
    },
    sign: async (value) => {
      /** The complete ciphertext envelope is signed before string encoding reaches the port. */
      const text = JSON.stringify(value)
      /** The receiver independently verifies the native HMAC rather than trusting a fixture tag. */
      const mac = await crypto.subtle.sign('HMAC', hmac, encoder.encode(text))
      return JSON.stringify({ text, mac: Array.from(new Uint8Array(mac)) })
    },
    verify: async (value) => {
      if (typeof value !== 'string') unprotected.push(value)
      /** Raw objects fail the same application JSON parsing used in the reported example. */
      const signed = JSON.parse(String(value)) as ISignedFrame
      expect(
        await crypto.subtle.verify(
          'HMAC',
          hmac,
          new Uint8Array(signed.mac),
          encoder.encode(signed.text)
        )
      ).toBe(true)
      return JSON.parse(signed.text)
    }
  }
}

describe('coroutine authentication cleanup', () => {
  it('keeps raw identity acknowledgements outside AES-GCM and HMAC ingress', async () => {
    /** Only unexpected unprotected inputs are retained, without recording ciphertext or keys. */
    const unprotected: unknown[] = []
    /** Every report must remain observable, including errors that surface while Hosts dispose. */
    const reports: unknown[] = []
    /** Parent and child use the exact same supported public authentication configuration. */
    const authentication = await protection(unprotected)
    /** Parent mode owns supervision and child task cancellation through the existing family. */
    const service = createCoroutinePlugin<{
      math: { calc: { double(value: number): number } }
    }>({
      name: 'math',
      authentication,
      self: { name: 'math-parent', instanceId: 'authenticated-parent' },
      report: (error) => reports.push(error),
      supervisor: { restart: { mode: 'never' }, startupTimeoutMs: 2000 },
      task: async ({ connect, signal }) => {
        /** Child mode reuses the genuine opaque connection and the canonical message recipe. */
        const parent = createCoroutinePlugin({
          name: 'parent',
          authentication,
          self: { name: 'math-child', instanceId: 'authenticated-child' },
          report: (error) => reports.push(error),
          connect,
          contract: normalizeRemoteContract({
            schemaVersion: 1,
            plugin: 'math',
            features: { calc: { methods: { double: { mode: 'request', idempotent: true } } } }
          }),
          provide: { math: { calc: { double: (value: number) => value * 2 } } }
        })
        /** The child's installed plugin closes before its task releases the physical ports. */
        const child = defineHost<Record<string, never>, never, readonly [typeof parent]>({
          host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
        })
        try {
          await child.use(parent)
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', () => resolve(), { once: true })
          })
        } finally {
          await child.dispose()
        }
      }
    })
    /** The public Host boundary must preserve both the business value and clean shutdown. */
    const host = defineHost<Record<string, never>, never, readonly [typeof service]>({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    try {
      await host.use(service)
      expect(await host.coroutine!.request('math', 'math.calc.double', 21)).toBe(42)
    } finally {
      await host.dispose()
    }
    expect(unprotected).toEqual([])
    expect(reports).toEqual([])
  })
})
