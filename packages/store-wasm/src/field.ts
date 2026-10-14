// Forwards the field construction protocol now owned by the store layer. The protocol has no WASM-specific behavior.
// Moving ownership removes `reactive-store.ts`'s reverse static dependency on WASM. Reexports preserve existing imports.
export {
  FIELD_BUILDER,
  isFieldBuilder,
  type IFieldBuilder,
  type IFieldContext
} from '@migaia/store-light'
