// 字段构造协议已上移到 store 层：它本来就没有任何 wasm 相关内容，放在这里却让
// reactive-store.ts 反向静态依赖了 wasm。这里保留转发，不破坏既有导入。
export {
  FIELD_BUILDER,
  isFieldBuilder,
  type IFieldBuilder,
  type IFieldContext
} from '@migaia/store-light';
