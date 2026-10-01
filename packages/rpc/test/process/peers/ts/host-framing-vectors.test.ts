import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  normalizeRemoteContract,
  normalizeRemoteHostCatalog,
  normalizeRemoteControlShape
} from '@migaia/rpc/remote'
import {
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame
} from '@migaia/rpc/contract/framing/stream'

/** Compact binary fixtures preserve every byte without checking in a 16 MiB literal. */
type IBytes = string | { repeatHex: string; count: number }
/** One published framing oracle specifies exact outputs and first failure. */
type IFrameCase = {
  id: string
  payloadHex?: string
  payload?: IBytes
  encodedPrefixHex?: string
  chunksHex?: string[]
  chunks?: IBytes[]
  framesHex?: string[]
  frames?: IBytes[]
  finish: boolean
  error?: { code: string }
}
/** Published schema semantic outcomes differ deliberately for key identity and ordering. */
type IRemoteCase = {
  id: string
  value: unknown
  definition?: Parameters<typeof normalizeRemoteControlShape>[0]
  semanticValid: boolean
}
/** Expand a vector specification into the payload bytes observed by the public decoder. */
function expand(value: IBytes): Uint8Array {
  if (typeof value === 'string') return Buffer.from(value, 'hex')
  /** Repeated pattern is independent of the decoder's allocation and length policy. */
  const pattern = Buffer.from(value.repeatHex, 'hex')
  /** A compact vector may contain arbitrary binary payload, not UTF-8 JSON. */
  const bytes = new Uint8Array(pattern.length * value.count)
  for (let offset = 0; offset < bytes.length; offset += pattern.length) bytes.set(pattern, offset)
  return bytes
}
/** Read only tracked vector artifacts; no ignored document becomes a runtime dependency. */
const vector = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../../schema/vectors/${name}.json`, import.meta.url), 'utf8')
  )

describe('public peer framing vectors', () => {
  /** Each case asserts the byte sequence, encoding prefix, terminal error and finish boundary. */
  const cases = vector('stream-framing') as IFrameCase[]
  it.each(cases)('$id', (entry) => {
    /** Decoder callbacks retain actual outputs before any possible terminal failure. */
    const frames: Uint8Array[] = []
    /** One framing fault terminates this decoder; later faults cannot replace the first. */
    const errors: unknown[] = []
    /** This is the production decoder reached through its public package export. */
    const decoder = createRpcStreamFrameDecoder({
      onFrame: (frame) => frames.push(frame),
      onError: (error) => errors.push(error)
    })
    for (const chunk of entry.chunksHex ?? entry.chunks ?? []) decoder.push(expand(chunk))
    if (entry.finish) decoder.finish()
    /** Buffer equality compares all payload bytes without allocating an assertion diff per byte. */
    const expectedFrames = (entry.framesHex ?? entry.frames ?? []).map(expand)
    expect(frames.length).toBe(expectedFrames.length)
    for (const [index, frame] of frames.entries())
      expect(Buffer.from(frame).equals(Buffer.from(expectedFrames[index]!))).toBe(true)
    if (entry.error) {
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject(entry.error)
    } else expect(errors).toEqual([])
    if (entry.encodedPrefixHex) {
      /** Encoding uses the same public framing contract as the inbound byte stream. */
      const payload = expand(entry.payloadHex ?? entry.payload!)
      expect(
        Buffer.from(encodeRpcStreamFrame(payload)).equals(
          Buffer.concat([Buffer.from(entry.encodedPrefixHex, 'hex'), payload])
        )
      ).toBe(true)
    }
    decoder.close()
  })
})

describe('public peer remote vectors', () => {
  /** Public normalizers prove value preservation on acceptance and canonical error on rejection. */
  const contracts = vector('remote-contract') as { contracts: IRemoteCase[] }
  it.each(contracts.contracts)('contract/$id', (entry) => {
    if (entry.semanticValid) expect(normalizeRemoteContract(entry.value)).toEqual(entry.value)
    else
      expect(() => normalizeRemoteContract(entry.value)).toThrow(
        expect.objectContaining({ source: '@migaia/rpc/remote', code: 'REMOTE_CONTRACT_INVALID' })
      )
  })
  /** Host oracle includes the schema-valid but semantically invalid catalog and unsorted inspect. */
  const host = vector('remote-host-control') as { catalogs: IRemoteCase[]; controls: IRemoteCase[] }
  it.each(host.catalogs)('catalog/$id', (entry) => {
    if (entry.semanticValid) expect(normalizeRemoteHostCatalog(entry.value)).toEqual(entry.value)
    else
      expect(() => normalizeRemoteHostCatalog(entry.value)).toThrow(
        expect.objectContaining({ code: 'REMOTE_CONTRACT_INVALID' })
      )
  })
  it.each(host.controls)('control/$id', (entry) => {
    if (entry.semanticValid)
      expect(normalizeRemoteControlShape(entry.definition!, entry.value)).toEqual(entry.value)
    else
      expect(() => normalizeRemoteControlShape(entry.definition!, entry.value)).toThrow(
        expect.objectContaining({ code: 'REMOTE_CONTRACT_INVALID' })
      )
  })
})
