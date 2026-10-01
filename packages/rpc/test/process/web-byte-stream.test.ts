import { describe, expect, it } from 'vitest'
import { webByteStream } from '../../src/process/adapters/web-byte-stream.js'

/** Native Web Streams provide deterministic read, write, EOF, and close behavior. */
function streams(closePhysical: () => void | Promise<void> = () => undefined) {
  /** The fixture controls input production without a wall-clock timeout. */
  let input!: ReadableStreamDefaultController<Uint8Array>
  /** Written chunks prove one physical writer owns the port. */
  const output: Uint8Array[] = []
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      input = controller
    }
  })
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      output.push(chunk)
    }
  })
  return { channel: webByteStream(readable, writable, closePhysical), input, output }
}

describe('Web byte stream adapter', () => {
  it('[A8] reads and writes without adding a second frame queue', async () => {
    const port = streams()
    const seen = new Promise<Uint8Array>((resolve) => {
      port.channel.onData((chunk) => resolve(chunk))
    })
    const incoming = new Uint8Array([1, 2, 3])
    port.input.enqueue(incoming)
    expect(await seen).toEqual(incoming)
    const outbound = new Uint8Array([4, 5])
    await port.channel.write(outbound)
    expect(port.output).toEqual([outbound])
    await port.channel.close()
    await expect(port.channel.write(outbound)).rejects.toMatchObject({
      code: 'PROCESS_CHANNEL_CLOSED'
    })
    let late: unknown
    port.channel.onClose((reason) => {
      late = reason
    })
    expect(late).toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
  })

  it('[A8] turns physical EOF into one terminal channel event', async () => {
    /** The physical close callback runs only after the stream reaches EOF. */
    let physicalCloses = 0
    const port = streams(() => {
      physicalCloses++
    })
    const closed = new Promise<unknown>((resolve) => {
      port.channel.onClose(resolve)
    })
    port.channel.onData(() => undefined)
    port.input.close()
    expect(await closed).toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
    await port.channel.close()
    expect(physicalCloses).toBe(1)
  })

  it('[A8] reports original physical cleanup failure through the close cause', async () => {
    const failure = new Error('physical close failed')
    const port = streams(() => {
      throw failure
    })
    await expect(port.channel.close()).rejects.toMatchObject({
      code: 'PROCESS_CHANNEL_CLOSED',
      cause: expect.objectContaining({ errors: [failure] })
    })
  })

  it('[A8] closes after a native reader failure', async () => {
    const port = streams()
    const failure = new Error('reader failed')
    const closed = new Promise<unknown>((resolve) => {
      port.channel.onClose(resolve)
    })
    port.channel.onData(() => undefined)
    port.input.error(failure)
    expect(await closed).toBe(failure)
  })
})
