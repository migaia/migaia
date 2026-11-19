/** What a page module declares: imports, module bindings, its component and the component's locals. */
import { isNode, literalValue, unwrap, type INode } from './ast.ts'

/** One imported binding. */
export type IImportBinding = {
  /** Module specifier as written. */
  readonly source: string
  /** Imported name, `default` for default imports. */
  readonly imported: string
  /** Source text of the whole import declaration. */
  readonly text: string
}

/** One `useState` variable of the component. */
export type IStateVariable = {
  readonly setter: string | undefined
  readonly initial: { readonly ok: boolean; readonly value?: unknown }
}

/** Facts of one page module. */
export class PageScope {
  /** Imports by local name. */
  readonly imports = new Map<string, IImportBinding>()
  /** Top-level declarations other than imports and the component, by name, with their text. */
  readonly moduleBindings = new Map<string, string>()
  /** Top-level declaration nodes by name, for reading literal initialisers. */
  readonly moduleNodes = new Map<string, INode>()
  /** State variables of the component. */
  readonly states = new Map<string, IStateVariable>()
  /** Setter names of the state variables. */
  readonly setters = new Set<string>()
  /** `useForm` variables of the component. */
  readonly forms = new Set<string>()
  /** Other local bindings of the component body, with their text. */
  readonly locals = new Map<string, string>()
  /** Name of the converted component. */
  component: string | undefined
  /** Returned JSX of the component. */
  root: INode | undefined

  /** Reads the program. */
  constructor(program: INode, source: string) {
    for (const statement of program.body as INode[]) this.#top(statement, source)
  }

  /** Records one top-level statement. */
  #top(statement: INode, source: string): void {
    if (statement.type === 'ImportDeclaration') {
      this.#import(statement, source)
      return
    }
    /** Declaration behind an export. */
    const declaration =
      statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
        ? (statement.declaration as INode | undefined)
        : statement
    if (declaration === undefined || declaration === null) return
    if (
      declaration.type === 'FunctionDeclaration' &&
      statement !== declaration &&
      this.component === undefined &&
      /^[A-Z]/.test(String((declaration.id as INode | undefined)?.name ?? '')) &&
      this.#component(declaration, source)
    )
      return
    for (const name of declaredNames(declaration)) {
      this.moduleBindings.set(name, source.slice(declaration.start, declaration.end))
      this.moduleNodes.set(name, declaration)
    }
  }

  /** Records an import declaration's bindings. */
  #import(statement: INode, source: string): void {
    /** Declaration text. */
    const text = source.slice(statement.start, statement.end)
    for (const specifier of statement.specifiers as INode[]) {
      /** Local name. */
      const local = String((specifier.local as INode).name)
      /** Imported name. */
      const imported =
        specifier.type === 'ImportSpecifier'
          ? String((specifier.imported as INode).name ?? (specifier.imported as INode).value)
          : 'default'
      this.imports.set(local, { source: String((statement.source as INode).value), imported, text })
    }
  }

  /** Takes a function as the page component when its body ends in one JSX return. */
  #component(declaration: INode, source: string): boolean {
    /** Body statements. */
    const statements = ((declaration.body as INode | undefined)?.body ?? []) as INode[]
    /** Return statements of the body's top level. */
    const returns = statements.filter((statement) => statement.type === 'ReturnStatement')
    /** Returned JSX. */
    const jsx = unwrap(returns[0]?.argument)
    if (returns.length !== 1 || (jsx?.type !== 'JSXElement' && jsx?.type !== 'JSXFragment'))
      return false
    this.component = String((declaration.id as INode).name)
    this.root = jsx
    for (const statement of statements) this.#local(statement, source)
    return true
  }

  /** Records one statement of the component body. */
  #local(statement: INode, source: string): void {
    if (statement.type === 'VariableDeclaration')
      for (const declarator of statement.declarations as INode[])
        this.#declarator(declarator, source)
    else
      for (const name of declaredNames(statement))
        this.locals.set(name, source.slice(statement.start, statement.end))
  }

  /** Records `useState`, `useForm` and other declarators. */
  #declarator(declarator: INode, source: string): void {
    /** Initialiser call. */
    const init = unwrap(declarator.init)
    /** Called function name. */
    const callee = init?.type === 'CallExpression' ? String((init.callee as INode).name ?? '') : ''
    /** Declared pattern. */
    const id = declarator.id as INode
    if (callee === 'useState' && id.type === 'ArrayPattern') {
      /** Value and setter elements. */
      const [value, setter] = id.elements as (INode | null)[]
      if (value?.type !== 'Identifier') return
      this.states.set(String(value.name), {
        setter: setter?.type === 'Identifier' ? String(setter.name) : undefined,
        initial: literalValue((init?.arguments as unknown[] | undefined)?.[0])
      })
      if (setter?.type === 'Identifier') this.setters.add(String(setter.name))
      return
    }
    if (callee === 'useForm' && id.type === 'Identifier') {
      this.forms.add(String(id.name))
      return
    }
    for (const name of patternNames(id))
      this.locals.set(name, source.slice(declarator.start, declarator.end))
  }
}

/** Names a declaration statement introduces. */
export function declaredNames(declaration: INode): string[] {
  if (
    (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') &&
    isNode(declaration.id)
  )
    return [String(declaration.id.name)]
  if (declaration.type === 'VariableDeclaration')
    return (declaration.declarations as INode[]).flatMap((declarator) =>
      patternNames(declarator.id as INode)
    )
  if (
    declaration.type === 'TSTypeAliasDeclaration' ||
    declaration.type === 'TSInterfaceDeclaration'
  )
    return [String((declaration.id as INode).name)]
  return []
}

/** Names bound by a binding pattern. */
export function patternNames(pattern: INode | null | undefined): string[] {
  if (pattern === null || pattern === undefined) return []
  if (pattern.type === 'Identifier') return [String(pattern.name)]
  if (pattern.type === 'ArrayPattern')
    return (pattern.elements as (INode | null)[]).flatMap((element) => patternNames(element))
  if (pattern.type === 'ObjectPattern')
    return (pattern.properties as INode[]).flatMap((property) =>
      patternNames((property.type === 'RestElement' ? property.argument : property.value) as INode)
    )
  if (pattern.type === 'AssignmentPattern') return patternNames(pattern.left as INode)
  if (pattern.type === 'RestElement') return patternNames(pattern.argument as INode)
  return []
}
