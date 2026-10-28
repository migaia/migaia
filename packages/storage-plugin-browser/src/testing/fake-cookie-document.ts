/**
 * Models the asymmetric read and write behavior of `document.cookie`. The getter joins all visible
 * cookies into one string. Each setter assignment writes or deletes only the cookie selected by its
 * `name=` field. Does not model browser enforcement of `Secure`, `SameSite`, or `domain`. Those
 * rules require end-to-end verification in a real browser;.
 */
export const fakeCookieDocument = (): { cookie: string } => {
  const jar = new Map<string, string>()

  return {
    get cookie(): string {
      return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
    },
    set cookie(assignment: string) {
      const [firstPair, ...attributes] = assignment.split(';').map((part) => part.trim())
      const eq = firstPair.indexOf('=')
      if (eq === -1) return
      const name = firstPair.slice(0, eq)
      const rawValue = firstPair.slice(eq + 1)

      /** Native Max-Age takes precedence over Expires when both attributes are present. */
      const maxAgeAttribute = attributes.find((attribute) =>
        attribute.toLowerCase().startsWith('max-age=')
      )
      if (maxAgeAttribute !== undefined) {
        if (Number(maxAgeAttribute.slice('max-age='.length)) <= 0) {
          jar.delete(name)
          return
        }
        jar.set(name, rawValue)
        return
      }
      const expiresAttribute = attributes.find((attribute) =>
        attribute.toLowerCase().startsWith('expires=')
      )
      if (expiresAttribute) {
        const expires = new Date(expiresAttribute.slice('expires='.length))
        if (expires.getTime() <= Date.now()) {
          jar.delete(name)
          return
        }
      }
      jar.set(name, rawValue)
    }
  }
}
