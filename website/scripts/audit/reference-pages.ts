/**
 * Rendered-page audit (`PAGE-ZH`, `CODE-ZH`): crawls every Chinese API page of each library on a
 * running site and reports English prose outside code, signatures and identifiers, and English
 * comments inside example code. Complements `reference.ts`, which checks the data; this checks what
 * a reader actually sees, including any text that bypassed the reference.
 *
 * Usage (site from `bun run dev` or a preview server): bun scripts/audit/reference-pages.ts
 * http://localhost:5180 logger plugin-host
 *
 * Exit code 1 when any finding exists.
 */

/** Command-line base URL and library slugs. */
const [base, ...libraries] = process.argv.slice(2)
if (!base || libraries.length === 0) {
  console.error('usage: bun scripts/audit/reference-pages.ts <base-url> <library...>')
  process.exit(2)
}

/** English prose: four or more words outside identifiers. */
const ENGLISH_RUN = /[A-Za-z][\w'-]*(?:[ ,]+[A-Za-z][\w'-]*){3,}/

/** Decodes the few HTML entities React emits in text. */
function decode(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/** Extracts the article column; navigation, rails and footer are interface chrome. */
function articleOf(html: string): string {
  const start = html.indexOf('<article class="article-column"')
  if (start < 0) return ''
  const end = html.indexOf('</article>', start)
  return html.slice(start, end < 0 ? undefined : end)
}

/** Reader prose of an article: code, signatures, disclosures and identifiers removed. */
function proseOf(article: string): string[] {
  const stripped = article
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<figure class="code-frame"[\s\S]*?<\/figure>/g, ' ')
    .replace(/<details[\s\S]*?<\/details>/g, ' ')
    .replace(/<code[\s\S]*?<\/code>/g, ' ')
    .replace(/<(?:nav|aside)[\s\S]*?<\/(?:nav|aside)>/g, ' ')
  return stripped
    .split(/<\/?(?:p|li|dd|dt|td|th|h[1-6]|figcaption|div|section|span|a)\b[^>]*>/)
    .map((chunk) =>
      decode(chunk.replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
}

/** Comments of every example code block (signature blocks are verbatim declarations). */
function exampleComments(article: string): string[] {
  const blocks =
    article.match(/<figure class="code-frame" data-code-kind="example"[\s\S]*?<\/figure>/g) ?? []
  return blocks.flatMap((block) => {
    const pre = decode((block.match(/<pre[\s\S]*?<\/pre>/)?.[0] ?? '').replace(/<[^>]+>/g, ''))
    return pre.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? []
  })
}

/** Total findings across every page. */
let total = 0
for (const library of libraries) {
  /** Pages still to visit and pages already queued. */
  const queue = [`/zh/docs/${library}/api`]
  const seen = new Set(queue)
  /** Findings of this library. */
  const findings: string[] = []
  while (queue.length > 0) {
    const path = queue.shift()!
    const response = await fetch(new URL(path, base))
    if (!response.ok) {
      findings.push(`[PAGE] ${path} — HTTP ${response.status}`)
      continue
    }
    const html = await response.text()
    for (const match of html.matchAll(/href="(\/zh\/docs\/[^"#?]+)"/g)) {
      const href = match[1]!
      if (href.startsWith(`/zh/docs/${library}/api/`) && !seen.has(href)) {
        seen.add(href)
        queue.push(href)
      }
    }
    const article = articleOf(html)
    for (const prose of proseOf(article)) {
      const run = prose.match(ENGLISH_RUN)
      if (run) findings.push(`[PAGE-ZH] ${path} — "${run[0]}" in: ${prose.slice(0, 120)}`)
    }
    for (const comment of exampleComments(article))
      if (/[A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){2,}/.test(comment.replace(/`[^`]*`/g, '')))
        findings.push(`[CODE-ZH] ${path} — ${comment.slice(0, 100)}`)
  }
  total += findings.length
  console.log(`${library}: ${seen.size} page(s), ${findings.length} finding(s)`)
  for (const finding of findings) console.log(`  ${finding}`)
}
process.exitCode = total > 0 ? 1 : 0

export {}
