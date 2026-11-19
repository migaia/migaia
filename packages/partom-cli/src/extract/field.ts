/** Field protocol inference for extracted form controls; fixed syntactic rules, in order. */
import type { IFieldBehavior } from '@migaia/part-contract'

/** Field protocol plus the callback prop its change event maps to. */
export type IInferredField = { readonly field: IFieldBehavior; readonly callback: string }

/** Props typed as a native input or textarea, with or without `React.` and `WithoutRef`. */
const NATIVE_PROPS = /ComponentProps(?:WithoutRef)?<\s*["'](?:input|textarea)["']\s*>/
/** A component whose JSX renders `<XPrimitive.Root`. */
const PRIMITIVE_ROOT = /<\s*\w+\.Root\b/

/** Radix packages whose root is a checked control; fixed size two. */
const CHECKED_PACKAGES = ['@radix-ui/react-checkbox', '@radix-ui/react-switch'] as const
/** Radix package whose root is a value control. */
const VALUE_PACKAGE = '@radix-ui/react-select'

/**
 * Field protocol of a component from its own source text and the file's imports, or undefined.
 * Native input props map `change`/`onChange` read from the event target; Radix checkbox and switch
 * roots map `checkedChange`/`onCheckedChange`; a Radix select root maps `valueChange`.
 */
export function inferField(
  source: string,
  imports: ReadonlySet<string>
): IInferredField | undefined {
  if (NATIVE_PROPS.test(source))
    return {
      field: { value: 'value', change: 'change', read: 'target-value' },
      callback: 'onChange'
    }
  if (!PRIMITIVE_ROOT.test(source)) return undefined
  if (CHECKED_PACKAGES.some((name) => imports.has(name)))
    return {
      field: { value: 'checked', change: 'checkedChange', read: 'detail' },
      callback: 'onCheckedChange'
    }
  if (imports.has(VALUE_PACKAGE))
    return {
      field: { value: 'value', change: 'valueChange', read: 'detail' },
      callback: 'onValueChange'
    }
  return undefined
}
