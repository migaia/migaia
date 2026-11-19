/**
 * Black-box parts: a JSX element that cannot be converted is kept as code. Its source is copied
 * into a component file with the imports and module-level declarations it references; state
 * variables become props bound to the page state. Component-local bindings cannot leave the page.
 */
import { dirname, relative, resolve } from 'node:path'
import { childNodes, type INode } from './ast.ts'
import { patternNames, type PageScope } from './scope.ts'

/** What a black box needs from its page. */
export type IBlackboxPlan =
  | {
      readonly ok: true
      readonly states: readonly string[]
      readonly imports: readonly string[]
      readonly declarations: readonly string[]
      readonly jsx: string
    }
  | { readonly ok: false; readonly local: string }

/** Names referenced inside a subtree and names it declares itself. */
export type IReferences = { readonly used: Set<string>; readonly declared: Set<string> }

/**
 * Collects identifier references of a subtree; recursion depth is the subtree depth. A subtree
 * already collected for an earlier black-box attempt is merged from `memo` instead of walked again,
 * so escalating a black box to its parent does not revisit the child's nodes.
 */
function collect(node: INode, references: IReferences, memo: WeakMap<INode, IReferences>): void {
  /** References of an earlier attempt on this subtree. */
  const known = memo.get(node)
  if (known !== undefined) {
    for (const name of known.used) references.used.add(name)
    for (const name of known.declared) references.declared.add(name)
    return
  }
  if (node.type === 'Identifier') references.used.add(String(node.name))
  if (node.type === 'JSXIdentifier' && /^[A-Z]/.test(String(node.name)))
    references.used.add(String(node.name))
  if (node.type === 'JSXMemberExpression' && (node.object as INode).type === 'JSXIdentifier')
    references.used.add(String((node.object as INode).name))
  if (node.type === 'VariableDeclarator')
    for (const name of patternNames(node.id as INode)) references.declared.add(name)
  if (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration'
  )
    for (const param of node.params as INode[])
      for (const name of patternNames(param)) references.declared.add(name)
  for (const child of childNodes(node)) {
    if (node.type === 'MemberExpression' && child === node.property && node.computed !== true)
      continue
    if (node.type === 'Property' && child === node.key && node.computed !== true) continue
    if (node.type === 'JSXAttribute' && child === node.name) continue
    if (node.type === 'JSXMemberExpression' && child === node.property) continue
    collect(child, references, memo)
  }
}

/** Import declaration text with relative specifiers rewritten for a file in another directory. */
function rewriteImport(text: string, pageFile: string, targetFile: string): string {
  return text.replace(
    /(from\s*|import\s*)(["'])(\.{1,2}\/[^"']*)\2/,
    (_match, prefix: string, quote: string, path: string) => {
      /** Specifier from the target directory. */
      const moved = relative(dirname(targetFile), resolve(dirname(pageFile), path))
      return `${prefix}${quote}${moved.startsWith('.') ? moved : `./${moved}`}${quote}`
    }
  )
}

/**
 * Plans a black box for an element: which state props, imports and module declarations it needs. A
 * reference to a setter, a form or another component-local binding fails the plan; the caller then
 * tries the parent element.
 */
export function planBlackbox(
  element: INode,
  source: string,
  scope: PageScope,
  pageFile: string,
  targetFile: string,
  memo: WeakMap<INode, IReferences>
): IBlackboxPlan {
  /** References of the element. */
  const references: IReferences = { used: new Set(), declared: new Set() }
  collect(element, references, memo)
  memo.set(element, references)
  /** State props. */
  const states: string[] = []
  /** Import texts, each declaration once. */
  const imports = new Set<string>()
  /** Module bindings the black box needs, directly or through other module declarations. */
  const needed = new Set<string>()
  // A Set visits entries added during iteration, so names used by a copied module declaration are
  // resolved in the same loop; each name is handled once.
  for (const name of references.used) {
    if (references.declared.has(name)) continue
    if (scope.states.has(name)) states.push(name)
    else if (scope.setters.has(name) || scope.locals.has(name) || scope.forms.has(name))
      return { ok: false, local: name }
    else if (scope.imports.has(name))
      imports.add(
        rewriteImport((scope.imports.get(name) as { text: string }).text, pageFile, targetFile)
      )
    else if (scope.moduleBindings.has(name) && !needed.has(name)) {
      needed.add(name)
      addDeclarationReferences(scope.moduleNodes.get(name) as INode, references, memo)
    }
  }
  return {
    ok: true,
    states,
    imports: [...imports],
    declarations: moduleDeclarations(scope, needed),
    jsx: source.slice(element.start, element.end)
  }
}

/** Adds the outside references of a module declaration to the black box's references. */
function addDeclarationReferences(
  declaration: INode,
  references: IReferences,
  memo: WeakMap<INode, IReferences>
): void {
  /** References of the declaration itself. */
  const own: IReferences = { used: new Set(), declared: new Set() }
  collect(declaration, own, memo)
  for (const name of own.used) if (!own.declared.has(name)) references.used.add(name)
}

/**
 * Texts of the needed module declarations in page source order, so a declaration always follows the
 * ones it reads; a declaration that binds several needed names appears once.
 */
function moduleDeclarations(scope: PageScope, needed: ReadonlySet<string>): string[] {
  /** Texts kept, in order. */
  const texts = new Set<string>()
  for (const [name, text] of scope.moduleBindings) if (needed.has(name)) texts.add(text)
  return [...texts]
}

/** Text of a black-box module. */
export function blackboxModule(
  plan: Extract<IBlackboxPlan, { ok: true }>,
  name: string,
  partId: string
): string {
  /** Parameter list: the state variables as props, or nothing. */
  const params =
    plan.states.length === 0
      ? ''
      : `{ ${plan.states.join(', ')} }: { ${plan.states.map((state) => `readonly ${state}?: any`).join('; ')} }`
  return [
    ...plan.imports,
    `import { definePart, definePartPlugin } from '@migaia/part-host'`,
    `import { bindReactComponent } from '@migaia/part-plugin-react'`,
    '',
    ...plan.declarations,
    '',
    `/** Page code kept as is; its state variables arrive as props. */`,
    `export function ${name}(${params}) {`,
    `  return (${plan.jsx})`,
    `}`,
    '',
    `/** Black-box part of the page code above. */`,
    `export const ${name}Part = definePart({ id: ${JSON.stringify(partId)} })`,
    '',
    `/** Plugin registering the black-box part. */`,
    `export default definePartPlugin({`,
    `  name: ${JSON.stringify(partId.slice(0, partId.lastIndexOf('@')))},`,
    `  parts: [${name}Part],`,
    `  implementations: [bindReactComponent(${name}Part, ${name})]`,
    `})`,
    ''
  ].join('\n')
}
