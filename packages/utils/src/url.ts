/**
 * A URL given either as text or as any object with an `href`, such as a WHATWG `URL`. It lets
 * runtime-neutral packages accept `new URL(...)` without depending on DOM or Node type
 * declarations; consumers read the text form through `readUrlHref`.
 */
export type IUrlLike = string | Readonly<{ href: string }>

/**
 * Returns the text form of a URL-like value: the string itself, or the object's `href`. It performs
 * no parsing or validation; callers that need a valid URL keep their own checks.
 */
export function readUrlHref(value: IUrlLike): string {
  return typeof value === 'string' ? value : value.href
}

/**
 * True for the object form of `IUrlLike`: a non-null object whose `href` is a string. Used to tell
 * a URL object apart from option objects in source unions; it does not check that `href` parses.
 */
export function isUrlObject(value: unknown): value is Readonly<{ href: string }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly href?: unknown }).href === 'string'
  )
}
