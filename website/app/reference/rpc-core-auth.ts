/** Authentication field semantics verified against core/middleware/authentication.ts and typing.ts. */
import type { IMemberDoc, IText } from './contract.js'

/** Builds explicit bilingual prose. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Every stage receives the same endpoint-owned public context. */
const context = t(
  'IRpcAuthenticationContext issued by the endpoint: direction is outbound/inbound, endpointId is its local identifier and platform is its configured IRpcPlatformValue.',
  '端点签发的认证上下文：方向为出站或入站，端点标识来自本端，平台为已配置的 `IRpcPlatformValue`。'
)
/** Captures a real sync/async transform and the value it must hand to the next stage. */
const transform = (
  en: string,
  zh: string,
  input: IText,
  result: IText,
  omitted: IText
): IMemberDoc => ({
  summary: t(en, zh),
  params: { value: input, context },
  returns: result,
  default: omitted
})
/** Configuration stays owned by the canonical authentication middleware. */
export const authenticationOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  encrypt: transform(
    'Outbound sync/async encryption runs after the endpoint wraps its encoded value with replay metadata and before signing. Throw/rejection normally becomes AUTHENTICATION_FAILED with its cause.',
    '出站同步或异步加密在端点为编码值包装重放元数据后、签名前执行；抛错或拒绝通常成为保留原因的认证失败。',
    t(
      'Replay-bound authentication envelope produced by the endpoint, including its encoded payload; not the bare application payload.',
      '端点生成、绑定重放信息的认证信封，包含编码载荷，不是裸应用负载。'
    ),
    t(
      'Encrypted value or its Promise, passed unchanged into sign.',
      '返回加密值或其承诺，原样传入签名阶段。'
    ),
    t(
      'Omit encryption only together with decrypt; sign then receives the unencrypted authentication envelope.',
      '省略加密时也必须省略 decrypt，sign 将直接接收未加密的认证信封。'
    )
  ),
  decrypt: transform(
    'Inbound sync/async decryption runs on the value recovered by verify. The endpoint then validates the recovered authentication envelope and replay binding.',
    '入站同步或异步解密处理验证阶段恢复的值；随后端点校验恢复的认证信封与重放绑定。',
    t('Verified protected value returned by verify.', '验证阶段返回的已验证受保护值。'),
    t(
      'Recovered replay-bound authentication envelope or its Promise; throw/rejection normally becomes AUTHENTICATION_FAILED with the original cause.',
      '返回恢复的重放绑定认证信封或其承诺；抛错或拒绝通常成为保留原始原因的认证失败。'
    ),
    t(
      'Without decrypt, encrypt must also be absent; the value recovered by verify is checked directly as an authentication envelope.',
      '不提供 decrypt 时也不能提供 encrypt；verify 恢复的值将直接作为认证信封校验。'
    )
  ),
  sign: transform(
    'Outbound sync/async signing runs after optional encryption and returns the complete protected frame representation. Signing and verification are required even without encryption.',
    '出站同步或异步签名在可选加密后执行，返回完整受保护帧表示；即使不加密，也必须配置签名与验证。',
    t(
      'Encrypted value when encrypt exists, otherwise the replay-bound authentication envelope.',
      '存在加密阶段时接收加密值，否则接收重放绑定认证信封。'
    ),
    t(
      'Signed representation or its Promise; throw/rejection normally becomes AUTHENTICATION_FAILED. Keep the declared encodedType output domain.',
      '返回签名表示或其承诺；抛错或拒绝通常成为认证失败，输出须符合声明的编码值域。'
    ),
    t(
      'Required for authentication: omitting sign makes configuration invalid, because encryption also requires signing.',
      '启用认证必须提供 sign；省略它会使配置非法，因为使用加密同样要求签名。'
    )
  ),
  verify: transform(
    'Inbound sync/async verification receives the protected frame and must recover its authenticated inner value; returning a boolean is not a verification verdict protocol.',
    '入站同步或异步验证接收受保护帧，必须恢复其经过认证的内部值；布尔返回值不是验证结论协议。',
    t(
      'Protected value received at the authentication pipeline edge.',
      '从认证管线边界接收到的受保护值。'
    ),
    t(
      'Authenticated inner value or its Promise, passed to decrypt when configured; reject or throw on invalid signatures. Local reporting retains the original verification failure, which may be sensitive; the peer receives a sanitized summary. Other returned values still undergo envelope/replay validation.',
      '返回认证内部值或其承诺，配置了解密时传给解密；签名非法时应拒绝或抛错，本地报告保留可能敏感的原校验失败，对端只接收净化摘要，其它返回值仍需通过信封及重放校验。'
    ),
    t(
      'Required counterpart of sign; a signing configuration without verify is rejected before the endpoint is activated.',
      'verify 是 sign 必须配套的验证阶段；提供签名却缺少验证时，端点会在激活前拒绝配置。'
    )
  ),
  encodedType: {
    summary: t(
      'Declared protected-output domain must match the next physical pipeline edge. Encrypt/decrypt and sign/verify are complete pairs, at least signing is required, and encryption additionally requires signing.',
      '声明的受保护输出域须匹配后续物理管线边界；加解密与签名验证各自须完整，至少配置签名，加密还必须有签名。'
    ),
    default: t(
      'any: do not impose a declared protected-output value category.',
      '`any`：不声明额外受保护输出值类别。'
    ),
    values: {
      any: t(
        'Leave the declared output domain unconstrained; transforms may still change representation.',
        '不限制声明输出值域，转换仍可改变表示。'
      ),
      string: t(
        'Declare that the protected output is text for the subsequent pipeline edge.',
        '声明受保护输出为文本，供后续管线边界使用。'
      ),
      uint8array: t(
        'Declare that the protected output is a byte array for the subsequent pipeline edge.',
        '声明受保护输出为字节数组，供后续管线边界使用。'
      )
    }
  }
}
