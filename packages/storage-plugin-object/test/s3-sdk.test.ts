import { Readable } from 'node:stream'
import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { S3Client } from '@aws-sdk/client-s3'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '../src/index.ts'
import { s3ObjectDriver } from '../src/s3.ts'
import { objectPresignFeature } from '../src/features/presign.ts'

/** SDK request-handler fixtures verify native SDK serialization, middleware and error identity only. */
type IRequest = {
  readonly method: string
  readonly path: string
  readonly headers: Record<string, string>
  readonly query: Record<string, string | undefined>
  readonly body?: unknown
}
/** Real service compatibility is deliberately not inferred from these finite SDK fixtures. */
type IResponse = {
  readonly statusCode: number
  readonly headers: Record<string, string>
  readonly body: Readable
}
/** Native SDK response bytes use its actual deserializer and stream mixin. */
function response(statusCode = 200, text = '', headers: Record<string, string> = {}): IResponse {
  return { statusCode, headers, body: Readable.from([Buffer.from(text)]) }
}
/** Deterministic native error responses carry the same protocol code/status consumed by the SDK. */
function failure(status: number, code: string): IResponse {
  return response(status, `<Error><Code>${code}</Code><Message>fixture error</Message></Error>`, {
    'content-type': 'application/xml'
  })
}
/** Native LastModified and opaque ETag must survive the actual SDK response decoder. */
const metadata = {
  etag: '"native"',
  'last-modified': 'Tue, 01 Jan 2030 00:00:00 GMT',
  'content-length': '2',
  'x-amz-meta-owner': 'ada'
}

/** One injected official client records physical sends while preserving its own retry configuration. */
async function installed(
  options: {
    readonly denyProbe?: boolean
    readonly business?: (request: IRequest) => IResponse | Promise<IResponse>
  } = {}
) {
  const requests: IRequest[] = []
  let probeWrites = 0
  const reports: unknown[] = []
  const client = new S3Client({
    endpoint: 'https://object-fixture.invalid',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
    maxAttempts: 3,
    followRegionRedirects: true,
    requestHandler: {
      async handle(value: unknown) {
        const request = value as IRequest
        requests.push(request)
        if (request.path.includes('.storage-probe/')) {
          if (options.denyProbe) return { response: failure(403, 'AccessDenied') }
          if (request.method === 'PUT')
            return {
              response:
                ++probeWrites === 1
                  ? response(200, '', { etag: '"probe"' })
                  : failure(412, 'PreconditionFailed')
            }
          return { response: response(204) }
        }
        if (request.method === 'HEAD' && request.path === '/bucket/')
          return { response: response() }
        return {
          response: options.business
            ? await options.business(request)
            : request.method === 'HEAD'
              ? response(200, '', metadata)
              : response(200, '', { etag: '"native"' })
        }
      }
    }
  })
  const destroy = vi.spyOn(client, 'destroy')
  const features = { presign: objectPresignFeature() }
  const host = await createStorageHost({
    report: (error) => {
      reports.push(error)
    },
    plugins: [
      objectBackendPlugin(
        {
          driver: s3ObjectDriver({
            client,
            bucket: 'bucket',
            partBytes: 5 * 1024 * 1024,
            partConcurrency: 2
          })
        },
        features
      )
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    client.destroy()
  })
  return { host, client, requests, reports, destroy, api: host.backend('object').use(blob) }
}

describe('official S3 SDK protocol integration', () => {
  it('soft-fails probe permissions, keeps unconditional I/O and rejects conditional input before taking its reader', async () => {
    const { api, reports, requests } = await installed({ denyProbe: true })
    expect(reports.length).toBeGreaterThan(0)
    const info = await api.put('file', new Uint8Array([1, 2]))
    expect(info).toMatchObject({
      size: 2,
      etag: '"native"',
      metadata: { owner: 'ada' },
      updatedAt: 1893456000000
    })
    const source = new ReadableStream<Uint8Array>({}, { highWaterMark: 0 })
    const reader = vi.spyOn(source, 'getReader')
    const before = requests.length
    await expect(api.put('file', source, { ifNoneMatch: true })).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY'
    })
    expect(reader).not.toHaveBeenCalled()
    expect(requests).toHaveLength(before)
  })

  it('uses one physical mutation send despite SDK retries and enabled region redirects', async () => {
    const { api, client, requests } = await installed({ business: () => failure(503, 'SlowDown') })
    const before = requests.length
    await expect(api.put('file', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'OBJECT_FAILED'
    })
    expect(requests.length - before).toBe(1)
    expect(await client.config.maxAttempts()).toBe(3)
    const redirect = await installed({
      business: () =>
        response(
          301,
          '<Error><Code>PermanentRedirect</Code><Message>fixture redirect</Message></Error>',
          { 'x-amz-bucket-region': 'us-west-2', 'content-type': 'application/xml' }
        )
    })
    const sent = redirect.requests.length
    await expect(redirect.api.put('file', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'OBJECT_FAILED'
    })
    expect(redirect.requests.length - sent).toBe(1)
  })

  it('marks confirmed writes whose LastModified follow-up fails and preserves the native first cause', async () => {
    const cause = new Error('head transport failed')
    const { api } = await installed({
      business: (request) => {
        if (request.method === 'HEAD') throw cause
        return response(200, '', { etag: '"native"' })
      }
    })
    await expect(api.put('file', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'OBJECT_FAILED',
      committed: true,
      cause
    })
  })

  it('sends conditions on multipart completion and aborts once when that operation is unsupported', async () => {
    const { api, requests } = await installed({
      business: (request) => {
        if (request.method === 'POST' && 'uploads' in request.query)
          return response(
            200,
            '<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>',
            { 'content-type': 'application/xml' }
          )
        if (request.method === 'PUT') return response(200, '', { etag: '"part"' })
        if (request.method === 'POST') return failure(501, 'NotImplemented')
        return response(204)
      }
    })
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.close()
      }
    })
    await expect(api.put('file', source, { ifNoneMatch: true })).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY'
    })
    const completion = requests.filter(
      (request) => request.method === 'POST' && request.query.uploadId
    )
    expect(completion).toHaveLength(1)
    expect(completion[0]!.headers['if-none-match']).toBe('*')
    expect(
      requests.filter((request) => request.method === 'DELETE' && request.query.uploadId)
    ).toHaveLength(1)
  })

  it('does not replay a dispatched commit with unknown acknowledgment', async () => {
    const cause = new Error('connection lost after send')
    const { api, requests } = await installed({
      business: () => {
        throw cause
      }
    })
    const before = requests.length
    await expect(api.put('file', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'OBJECT_COMMIT_UNKNOWN',
      cause
    })
    expect(requests.length - before).toBe(1)
  })

  it('bounds multipart concurrency, drains issued parts and aborts once after the first failure', async () => {
    const first = Promise.withResolvers<IResponse>()
    const second = Promise.withResolvers<IResponse>()
    const started = Promise.withResolvers<void>()
    let active = 0
    let maximum = 0
    let cancellations = 0
    let pulled = 0
    const { api, requests } = await installed({
      business: async (request) => {
        if (request.method === 'POST' && 'uploads' in request.query)
          return response(
            200,
            '<InitiateMultipartUploadResult><UploadId>bounded</UploadId></InitiateMultipartUploadResult>',
            { 'content-type': 'application/xml' }
          )
        if (request.method === 'PUT') {
          active++
          maximum = Math.max(maximum, active)
          if (active === 2) started.resolve()
          try {
            return await (request.query.partNumber === '1' ? first.promise : second.promise)
          } finally {
            active--
          }
        }
        expect(active).toBe(0)
        return response(204)
      }
    })
    const source = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled++
          controller.enqueue(new Uint8Array(5 * 1024 * 1024))
          if (pulled === 3) controller.close()
        },
        cancel() {
          cancellations++
        }
      },
      { highWaterMark: 0 }
    )
    const outcome = api.put('file', source).then(
      () => undefined,
      (error: unknown) => error
    )
    await started.promise
    expect(pulled).toBe(2)
    first.resolve(failure(503, 'SlowDown'))
    await vi.waitFor(() => expect(cancellations).toBe(1))
    expect(active).toBe(1)
    expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1)
    second.resolve(response(200, '', { etag: '"part-2"' }))
    expect(await outcome).toMatchObject({ code: 'OBJECT_FAILED' })
    expect(maximum).toBe(2)
    expect(pulled).toBe(2)
    expect(requests.filter((request) => request.query.partNumber)).toHaveLength(2)
    expect(
      requests.filter((request) => request.method === 'DELETE' && request.query.uploadId)
    ).toHaveLength(1)
    expect(
      requests.filter((request) => request.method === 'POST' && request.query.uploadId)
    ).toHaveLength(0)
  })

  it('signs exact organized headers with the borrowed official client and performs no request', async () => {
    const { host, requests, destroy } = await installed()
    const before = requests.length
    const signing = host.backend('object').api.presign!
    const signed = await signing.upload('file', {
      expiresInSeconds: 120,
      contentType: 'application/octet-stream',
      metadata: { owner: 'ada' },
      ifNoneMatch: true
    })
    expect(signed.headers).toEqual({
      'content-type': 'application/octet-stream',
      'x-amz-meta-owner': 'ada',
      'if-none-match': '*'
    })
    const url = new URL(signed.url)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('if-none-match')
    expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false)
    const other = await host
      .org(createOrgId())
      .backend('object')
      .api.presign!.download('file', { range: { start: 1, end: 3 } })
    expect(new URL(other.url).pathname).not.toBe(url.pathname)
    expect(other.headers).toEqual({ range: 'bytes=1-3' })
    expect(requests).toHaveLength(before)
    await host.dispose()
    expect(destroy).not.toHaveBeenCalled()
  })

  it('binds range content and metadata to one conditional GetObject response', async () => {
    const { api, requests } = await installed({
      business: (request) =>
        request.method === 'HEAD'
          ? response(200, '', { ...metadata, 'content-length': '4' })
          : response(206, 'ab', { ...metadata, 'content-range': 'bytes 1-2/4' })
    })
    const object = await api.get('file', { range: { start: 1, end: 2 } })
    expect(object!.info.size).toBe(4)
    expect(await object!.bytes()).toEqual(new Uint8Array([97, 98]))
    expect(requests[requests.length - 1]!.headers.range).toBe('bytes=1-2')
    expect(requests[requests.length - 1]!.headers['if-match']).toBe('"native"')
  })

  it('preserves a native download reader TypeError and its original stack', async () => {
    const cause = new TypeError('native response reader failed')
    const stack = cause.stack
    const { api, reports } = await installed({
      business: () => ({
        ...response(200, '', metadata),
        body: Readable.from(
          (async function* () {
            yield new Uint8Array([1])
            throw cause
          })()
        )
      })
    })
    const object = await api.get('file')
    await expect(object!.bytes()).rejects.toBe(cause)
    expect(cause).toBeInstanceOf(TypeError)
    expect(cause).toMatchObject({ source: 'storage.backend.object', code: 'OBJECT_FAILED' })
    expect(cause.stack).toBe(stack)
    expect(reports).toHaveLength(0)
  })
})
