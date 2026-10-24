import type { ICaseDoc, IText } from './contract.js'
/** Reader examples retain their exact public imports and both language descriptions. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** The same signed request is sent with unchanged method and headers in both locales. */
const signedUploadExample = `import { createStorageHost } from '@migaia/storage-host'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { s3ObjectDriver } from '@migaia/storage-plugin-object/s3'
import { objectPresignFeature } from '@migaia/storage-plugin-object/features/presign'

await using host = await createStorageHost({ plugins: [objectBackendPlugin({
  driver: s3ObjectDriver({ config: { region: 'us-east-1' }, bucket: 'objects' })
}, { presign: objectPresignFeature() })] as const })
const request = await host.backend('object').api.presign.upload('receipt', {
  expiresInSeconds: 120, contentType: 'application/octet-stream', ifNoneMatch: true
})`
/** Shared native object examples use the same host/capability boundary as applications. */
export const storagePluginObjectCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  objectBackendPlugin: [
    {
      title: t('Read a bounded object snapshot', '读取有界对象快照'),
      problem: t(
        'An application needs object bytes and metadata without borrowing a raw filesystem or SDK connection.',
        '应用需要对象字节与元数据，不应借用原生文件系统或 SDK 连接。'
      ),
      example: `import { createStorageHost } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'

await using host = await createStorageHost({
  plugins: [objectBackendPlugin({
    id: 'object', driver: fsObjectDriver({ root: './objects' })
  })] as const
})
const objects = host.backend('object').use(blob)
await objects.put('receipt', new TextEncoder().encode('paid'))
const object = await objects.get('receipt', { range: { start: 0, end: 3 } })
if (object) {
  try { console.log(new TextDecoder().decode(await object.bytes())) }
  finally { await object.dispose() }
}`,
      result: t(
        'Prints paid. The content right and native file handle release through the original object resource.',
        '输出 paid；内容权限与原生句柄经原对象资源释放。'
      )
    }
  ],
  fsObjectDriver: [
    {
      title: t('Select one native filesystem entry', '使用单一原生文件系统入口'),
      problem: t(
        'The same application runs in Node, Bun or Deno and must use that runtime’s native file API.',
        '同一应用运行于 Node、Bun 或 Deno，需要使用对应原生文件 API。'
      ),
      example: `import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'
const driver = fsObjectDriver({ root: './objects' })`,
      result: t(
        'Constructs only a lazy descriptor. Installation detects the actual runtime and opens the plugin-managed directory.',
        '仅创建惰性描述，安装时识别实际运行时并打开插件专用目录。'
      )
    }
  ],
  s3ObjectDriver: [
    {
      title: t('Stream an upload through the shared object capability', '通过共享对象能力流式上传'),
      problem: t(
        'A service needs multipart uploads while preserving the original SDK client’s ownership.',
        '服务需要 multipart 上传，同时保留原 SDK client 的拥有权。'
      ),
      example: `import { S3Client } from '@aws-sdk/client-s3'
import { s3ObjectDriver } from '@migaia/storage-plugin-object/s3'

const client = new S3Client({ region: 'us-east-1' })
const driver = s3ObjectDriver({
  client, bucket: 'objects', prefix: 'app/',
  multipartThresholdBytes: 16 * 1024 * 1024,
  partBytes: 8 * 1024 * 1024, partConcurrency: 4
})`,
      result: t(
        'Constructs a borrowed-client descriptor. The installed backend uses bounded native multipart and never destroys this client.',
        '创建借用 client 的描述；已安装后端使用有界原生 multipart，始终不销毁此 client。'
      )
    }
  ],
  objectPresignFeature: [
    {
      title: t('Generate a native upload request', '生成原生上传请求'),
      problem: t(
        'A caller needs a short-lived upload URL with matching metadata and condition headers.',
        '调用方需要短期上传 URL，并携带匹配的元数据与条件头。'
      ),
      example: t(
        `${signedUploadExample}
// Send request.method and request.headers unchanged to request.url.`,
        `${signedUploadExample}
// 向 request.url 发送原样的 request.method 与 request.headers。`
      ),
      result: t(
        'Returns the official SDK-signed URL and every required header. Signing performs no upload and the URL also expires with its credentials.',
        '返回官方 SDK 签名 URL 与全部必需头；签名不执行上传，URL 也受凭据有效期限制。'
      )
    }
  ]
}
