import type { IOperationContext } from '../types/context';

/**
 * Schema 层是面向开发者的开放契约，不绑定任何校验库，也不强制使用。 `encode`/`decode` 处理领域表示（`Date` ↔ ISO 串、内部字段裁剪），与 §7 codec
 * 处理的存储格式（对象 ↔ 字符串/字节）分工不同。执行顺序： 写入 validate → encode → codec.encode，读取 codec.decode → decode →
 * validate。
 */
export type ISchemaAdapter<TDomain, TStored = TDomain> = {
  readonly name: string;
  /** 异步：允许 async refinement 与远程校验。同步 schema 库包装成 resolved Promise。 */
  validate(value: unknown, ctx?: IOperationContext): Promise<TDomain>;
  /** 领域对象 → 存储表示。不实现则恒等。 */
  encode?(value: TDomain, ctx?: IOperationContext): Promise<TStored>;
  /** 存储表示 → 领域对象。不实现则恒等。 */
  decode?(raw: TStored, ctx?: IOperationContext): Promise<TDomain>;
  /** 写入前的可选归一化，默认等同 validate。 */
  normalize?(value: TDomain, ctx?: IOperationContext): Promise<TDomain>;
};
