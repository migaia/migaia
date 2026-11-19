/** Project chart that was not extracted; pages that use it keep it as a black box. */
export function Chart({ title }: { readonly title: string }) {
  return <figure data-chart="">{title}</figure>
}
