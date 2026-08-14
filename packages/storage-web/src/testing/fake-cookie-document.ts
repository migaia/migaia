/**
 * 模拟 `document.cookie` 的读写不对称语义：getter 返回全部可见 cookie 的 拼接字符串；setter 每次只写入/删除一个 cookie（由赋值串里的 name=
 * 决定）。 真实浏览器对 Secure/SameSite/domain 的强制校验不在此模拟范围内——那些 只能在 e2e 用真实浏览器验证（见 SDD §12.4）。
 */
export const fakeCookieDocument = (): { cookie: string } => {
  const jar = new Map<string, string>();

  return {
    get cookie(): string {
      return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    },
    set cookie(assignment: string) {
      const [firstPair, ...attributes] = assignment.split(';').map((part) => part.trim());
      const eq = firstPair.indexOf('=');
      if (eq === -1) return;
      const name = firstPair.slice(0, eq);
      const rawValue = firstPair.slice(eq + 1);

      const expiresAttribute = attributes.find((attribute) =>
        attribute.toLowerCase().startsWith('expires=')
      );
      if (expiresAttribute) {
        const expires = new Date(expiresAttribute.slice('expires='.length));
        if (expires.getTime() <= Date.now()) {
          jar.delete(name);
          return;
        }
      }
      jar.set(name, rawValue);
    }
  };
};
