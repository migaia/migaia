/** Joins class names, skipping empty values (stands in for shadcn's clsx + tailwind-merge helper). */
export function cn(...inputs: (string | false | null | undefined)[]): string {
  return inputs.filter(Boolean).join(' ')
}
