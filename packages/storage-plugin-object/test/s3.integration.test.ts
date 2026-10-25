import { describe, it, expect, onTestFinished, vi } from 'vitest'
import { S3Client } from '@aws-sdk/client-s3'
import { createStorageHost } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '../src/index.js'
import { s3ObjectDriver } from '../src/s3.js'

/**
 * The shared launcher owns service addresses and credentials; no backend-local defaults duplicate
 * it.
 */
const endpoint = process.env.MIGAIA_S3_ENDPOINT
describe('real S3-compatible object service', () => {
  it.skipIf(!endpoint)(
    'runs bytes, streams, ranges, conditions and paging against the configured service',
    async () => {
      const prefix = `storage-object-test/${crypto.randomUUID()}/`
      /**
       * Observe the real SDK send method without replacing the service or configured-client
       * ownership.
       */
      const native = vi.spyOn(S3Client.prototype, 'send')
      onTestFinished(() => native.mockRestore())
      const host = await createStorageHost({
        plugins: [
          objectBackendPlugin({
            driver: s3ObjectDriver({
              config: {
                endpoint,
                region: process.env.MIGAIA_S3_REGION,
                forcePathStyle: true,
                credentials: {
                  accessKeyId: process.env.MIGAIA_S3_ACCESS_KEY_ID!,
                  secretAccessKey: process.env.MIGAIA_S3_SECRET_ACCESS_KEY!
                }
              },
              bucket: process.env.MIGAIA_S3_BUCKET!,
              prefix,
              multipartThresholdBytes: 5 * 1024 * 1024,
              partBytes: 5 * 1024 * 1024
            })
          })
        ] as const
      })
      const objects = host.backend('object').use(blob)
      native.mockClear()
      try {
        const initial = await objects.put('file', new Uint8Array([1, 2, 3]), {
          metadata: { owner: 'ada' },
          ifNoneMatch: true
        })
        expect((await objects.head('file'))!.etag).toBe(initial.etag)
        const range = await objects.get('file', { range: { start: 1, end: 2 } })
        expect(await range!.bytes()).toEqual(new Uint8Array([2, 3]))
        expect(range!.info.size).toBe(3)
        await expect(
          objects.put('file', new Uint8Array([4]), { ifNoneMatch: true })
        ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
        await objects.put('file', new Uint8Array([4]), { ifMatch: initial.etag })
        await objects.put(
          'stream',
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([5, 6]))
              controller.close()
            }
          })
        )
        const first = await objects.list({ limit: 1 })
        expect(first.items.map((item) => item.key)).toEqual(['file'])
        expect(
          (await objects.list({ limit: 1, after: first.next })).items.map((item) => item.key)
        ).toEqual(['stream'])
        expect(await objects.removeByPrefix('')).toBe(2)
        expect(native.mock.calls.map(([command]) => command.constructor.name)).toEqual(
          expect.arrayContaining([
            'PutObjectCommand',
            'HeadObjectCommand',
            'GetObjectCommand',
            'ListObjectsV2Command',
            'DeleteObjectCommand'
          ])
        )
        expect(native.mock.calls.map(([command]) => command.input)).toContainEqual(
          expect.objectContaining({ Range: 'bytes=1-2' })
        )
        expect(native.mock.calls.map(([command]) => command.input)).toContainEqual(
          expect.objectContaining({ IfMatch: initial.etag })
        )
      } finally {
        try {
          await objects.removeByPrefix('')
        } finally {
          await host.dispose()
        }
      }
    }
  )
})
