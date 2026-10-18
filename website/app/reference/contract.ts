/**
 * Reference documentation contract: the single source of truth for every reader-facing sentence on
 * an API page of an audited library.
 *
 * A library is "audited" once `app/reference/<lib>.ts` exists and is registered in
 * `app/reference/index.ts`. From then on its API pages render only text from that file (no English
 * fallback on Chinese pages, no first-sentence truncation, no wildcard option copy shared between
 * unrelated APIs), and `bun scripts/audit/reference.ts <lib>` must report zero findings.
 *
 * The rules below are enforced mechanically by `scripts/audit/reference.ts` (data) and
 * `scripts/audit/reference-pages.ts` (rendered HTML). Each rule has a stable id that appears in
 * audit findings. Do not weaken a rule to pass an audit; write the missing text instead.
 *
 * Coverage rules (what must be documented):
 *
 * - `REF-MODULE` every public entry point (module) has a `modules` entry: what it is for and which of
 *   its APIs a reader starts from. It replaces README excerpts on the module page.
 * - `REF-SYMBOL` every exported runtime symbol (function, class, const) has a `symbols` entry with
 *   `role` and a full `purpose`.
 * - `REF-PARAM` every parameter of a function (except the options bag documented by `options`) has a
 *   `params` entry; every non-void function has `returns`.
 * - `REF-OPTION` every field of an options/config parameter is documented: summary, `default` for
 *   optional fields, and `values` when the field type is a literal union or an enum-like constant
 *   type.
 * - `REF-ENUM` every enum-like constant (object of literal values) has an `enums` entry that explains
 *   each key: when to choose it and what happens.
 * - `REF-TYPE` every exported type/interface/class has a `types` entry with a summary and a doc for
 *   every member (own and composed members on its surface).
 * - `REF-MEMBER` a method member has summary, a doc for each parameter, `returns` (also for `void`:
 *   say what the call achieves), and an `example`; a property member has a summary.
 * - `REF-ENHANCER` a symbol whose `role` is `enhancer` has an `enhancers` entry (what the host gains
 *   after installation, see `IEnhancerDoc`).
 *
 * Construction cycle (the order in which a reference is written; every node is bilingual and
 * carries a description plus a usage example, and the audits fail on any node left open):
 *
 * 1. Module node: what the entry point is for and which API a reader starts from (`modules`).
 * 2. API node: role, purpose, signature types; for each parameter: what it means, which values are
 *    allowed, and where the caller gets the value (`TXT-ORIGIN`).
 * 3. Options node: every field, nested fields by dotted path, `default` for optional fields, every
 *    literal or enum value explained (`values`). An enum value is itself a node: go to 6.
 * 4. Callback node: for a function-typed parameter or field, what the library passes in (each argument
 *    is a parameter node, go to 2), what it expects back, sync or async, and what a throw does.
 * 5. Return node: type plus description of what the caller holds and what it is for; failures (error
 *    code, when) and lifecycle (dispose, idempotency) belong here too.
 * 6. Closure check: is the returned, option, callback or enum type defined in this library? Yes:
 *    document it as a type/enum node (`types`, `enums`) and run steps 2-5 for each of its members
 *    (methods are API nodes, properties need summary). No (native or other package): stop and point
 *    to it in backticks.
 * 7. Enhancer node: for a plugin, middleware, feature, transport or adapter, list what the host gains
 *    after installation (`IEnhancerDoc.grants`); each granted member is an API node and goes back
 *    to 2.
 * 8. Pairing check: does this node only work, or only make sense, together with another API (a
 *    listener that must exist, a factory that must be passed with its counterpart, a plugin that
 *    must be installed first)? Yes: name the partner in backticks with a pairing word (`搭配`, `配合`,
 *    `配套`, `一起使用`) and write the example so it calls both (`REF-PAIRED`). A lone call of half a
 *    pair is not an example.
 * 9. Done when every node reached through 2-8 is visited once and both audits report zero.
 *
 * Text rules (how it must be written):
 *
 * - `TXT-ZH` Chinese text contains Chinese prose; English words appear only as identifiers in
 *   backticks. A run of four or more English words outside backticks fails.
 * - `TXT-EN` English text contains no CJK characters.
 * - `TXT-DEPTH` a summary explains behaviour, not the name: it may not just restate the member name
 *   or its type, and must reach a minimum length.
 * - `TXT-NO-STUB` no placeholders (`TODO`, `TBD`, `...`, `/* ... *\/`, `待补充`).
 * - `TXT-SCOPE` text of one API may not describe another API's behaviour as if it were its own (for
 *   example a file plugin option that talks about installing `http()`). Mentions of other exports
 *   must be backticked and serve as a pointer.
 * - `TXT-ORIGIN` a parameter or field named like an identifier (`taskId`, `instanceId`, `leaseToken`,
 *   `pluginKey`) says where its value comes from: the API that returns it, the call that sets it,
 *   or who issues it.
 * - `REF-PAIRED` a Chinese sentence with a pairing word (`搭配`, `配合`, `配套`, `一起使用`, `联用`, `结合使用`,
 *   `成对使用`, `调用后才`, `才生效`) names the partner API in backticks, and the node's example (a property
 *   falls back to its type's example) contains at least one named partner. Unnamed partners ("trace
 *   监听者") fail review: name the API that creates them.
 * - `CODE-ZH` code comments inside an example shown on Chinese pages are Chinese; use the `{ en, zh
 *   }` form of `ICode` when an example has comments.
 *
 * Page rules (rendered output):
 *
 * - `PAGE-ZH` a Chinese API page shows no English prose outside code, signatures and identifiers;
 *   checked against the running site by `reference-pages.ts`.
 * - `PAGE-COVERAGE` every localized prose leaf and shared/localized example of the full authored
 *   reference appears in its own module/symbol article in that locale. Ownership comes from the
 *   generated manifest, including unlinked type pages, module-qualified entries and case-collision
 *   slugs. Summaries, callback/property params, nested/composed member descriptions, returns,
 *   defaults, values, usage notes, scenarios, examples and enhancer grants are all checked. Loader
 *   serialization, other pages, declaration signatures and hover notes never satisfy coverage. Code
 *   is identified by its schema-owned example/install field; parameters or value keys named
 *   `example` or `install` remain prose. Named comparison rules: `COVER-WHITESPACE-BACKTICKS`
 *   removes layout whitespace and inline-code delimiters; `COVER-TERM-POPOVER` removes only
 *   injected library-reference hover notes; `COVER-LINK-LABEL` compares supported Markdown links by
 *   visible label; `COVER-DISPLAY-LIBRARY` applies InlineText's package/packages to
 *   library/libraries substitution while preserving identifiers and GitHub Packages;
 *   `COVER-CODE-LAYOUT` compares example tokens ignoring whitespace and optional trailing commas
 *   while retaining literals and comments; `COVER-PUBLIC-IMPORT` applies the canonical
 *   public-import rewrite. No fuzzy match or exclusion of an authored description is permitted.
 * - `PAGE-LINK` every actual in-site anchor on an audited page resolves to a successful response
 *   containing an article. A 200 shell without an article fails. Fragment links share the owning
 *   article check; external links are outside this rule. Findings identify source and destination.
 */

/** One text in both site locales. */
export type IText = Readonly<{ en: string; zh: string }>

/**
 * Example code. A plain string is shared by both locales and must not contain prose comments; use
 * `{ en, zh }` when the example carries comments so each locale reads its own language.
 */
export type ICode = string | IText

/**
 * What a runtime symbol is for, which decides the required documentation. - `factory`: creates an
 * instance the caller keeps (channel, runtime, host, peer); its returned instance type must be
 * documented in `types`. - `enhancer`: does nothing alone and adds capability once installed into a
 * host (plugin, middleware, feature, transport, adapter, policy, host definition, store field);
 * needs an `enhancers` entry. - `operation`: performs one action and returns a result (helpers,
 * codecs, checks). - `constant`: an enum-like constant or a fixed value; enum-like constants need
 * an `enums` entry. - `error`: an error class, error-code table or error source marker.
 */
export const SymbolRole = {
  factory: 'factory',
  enhancer: 'enhancer',
  operation: 'operation',
  constant: 'constant',
  error: 'error'
} as const

export type SymbolRole = keyof typeof SymbolRole

/** Documentation of one member of a type surface, or one field of an options bag. */
export type IMemberDoc = Readonly<{
  /** What the member does or holds, and its observable effect. Never just the member name. */
  summary: IText
  /** Meaning of each declared parameter, keyed by parameter name. Required for every parameter. */
  params?: Readonly<Record<string, IText>>
  /**
   * What the result means and how failure shows. Required for every method, including `void`
   * methods (describe what has happened once the call returns).
   */
  returns?: IText
  /**
   * Default used when an optional field is omitted, with its effect, e.g. `{ zh: '`false`：…' }`.
   * Required for every optional field of an options bag.
   */
  default?: IText
  /**
   * Allowed values of a literal-union or enum-typed field, keyed by the literal value (not the
   * constant key): `{ recursive: {...}, queued: {...} }`. Use `{ enum: 'EventDispatchPolicy' }` to
   * reuse the documented values of an enum-like constant.
   */
  values?: Readonly<Record<string, IText>> | Readonly<{ enum: string }>
  /** Why a caller picks this member instead of a neighbouring one. */
  whenToUse?: IText
  /** Runnable snippet. Required for methods. */
  example?: ICode
}>

/** Documentation of one exported type, interface or class, and of an instance surface. */
export type ITypeDoc = Readonly<{
  /**
   * Declared type whose members describe this entry, for a constructor constant or factory whose
   * declared result cannot be resolved (`Logger: IStaticLoggerCtor` → `ILoggerCore`).
   */
  surface?: string
  /** What the value is, who creates and owns it, and its key semantics. */
  summary: IText
  /** Application scenarios; required for instance types returned by factories. */
  scenarios?: readonly IText[]
  /** End-to-end example exercising the main members; required for instance types. */
  example?: ICode
  /** Docs of every member on the surface, keyed by member name (overloads share one doc). */
  members: Readonly<Record<string, IMemberDoc>>
}>

/** Documentation of one enum-like constant. */
export type IEnumDoc = Readonly<{
  /** What the set of values controls and where it is used (which option, which state). */
  summary: IText
  /** Meaning of each key: when to choose it and what happens. Keyed by constant key. */
  values: Readonly<Record<string, IText>>
}>

/** Documentation of one exported runtime symbol (function, class, const). */
export type ISymbolDoc = Readonly<{
  role: SymbolRole
  /** Full introduction rendered without truncation: what it does, when to use it, key behaviour. */
  purpose: IText
  /** Meaning of each non-options parameter, keyed by parameter name. */
  params?: Readonly<Record<string, IText>>
  /** What the result is and how failure shows; required for functions that return a value. */
  returns?: IText
  /**
   * Name of the options type whose `types` entry documents the fields of this symbol's options
   * table. Use `optionDocs` instead when the options bag has no named type.
   */
  options?: string
  /** Field docs for an anonymous options bag. */
  optionDocs?: Readonly<Record<string, IMemberDoc>>
  /** Minimal runnable example shown first on the page. */
  example?: ICode
  /** Concrete situation explained immediately before the minimal example. */
  exampleIntro?: IText
  /** Observable result explained immediately after the minimal example. */
  exampleResult?: IText
  /** When to use it. */
  scenarios?: readonly IText[]
  /** When not to use it, with the alternative. */
  avoid?: readonly IText[]
}>

/**
 * How an enhancer attaches to its host. The kind only decides the reader-facing label; install
 * mechanics are spelled out by each guide's `install` snippet.
 */
export const EnhancerKind = {
  /** Installed through a plugin host's `use()` or a host's `plugins` option. */
  plugin: 'plugin',
  /** A stage inserted into a pipeline that wraps every value the host processes. */
  middleware: 'middleware',
  /** A capability one plugin exposes for other plugins to consume. */
  feature: 'feature',
  /** A byte/message carrier that connects an RPC peer or endpoint to another realm. */
  transport: 'transport',
  /** A runtime-specific binding (launcher, channel factory, backend) chosen per environment. */
  adapter: 'adapter',
  /** A policy object that changes how the host decides (routing, scheduling, admission). */
  policy: 'policy',
  /** A host definition registered into a supervisor that spawns instances of it (Tray hosts). */
  host: 'host',
  /** A custom field type plugged into a store definition through the FieldBuilder protocol. */
  field: 'field'
} as const

export type EnhancerKind = keyof typeof EnhancerKind

/** One API an enhancer adds to its host, its plugin handle, or its extension object. */
export type IGrantDoc = IMemberDoc &
  Readonly<{
    /** Reader-facing call form including its receiver, e.g. `logger.setLevel(level)`. */
    signature: string
  }>

/** What a host can do after one enhancer is installed. */
export type IEnhancerDoc = Readonly<{
  kind: EnhancerKind
  /** Host type or instance that receives the capability, e.g. `Logger` or `IRuntimePeer`. */
  target: string
  /** What the host can do after installation and what it lacks without it. */
  summary: IText
  /** Minimal installation snippet: create host, install enhancer. */
  install: ICode
  /** APIs that become callable after installation; empty only when behaviour alone changes. */
  grants: readonly IGrantDoc[]
  /** Observable behaviour changes of existing host APIs. */
  behaviors?: readonly IText[]
  scenarios: readonly IText[]
  /** End-to-end example: install, use the granted capability, release. */
  example: ICode
}>

/** Documentation of one public entry point (`index`, `plugins`, `adapters/node`, ...). */
export type IModuleDoc = Readonly<{
  /** What the entry point is for, when to import it, and which APIs to start from. */
  summary: IText
  /** Short orientation example importing from this entry point. */
  example?: ICode
}>

/** Complete reference documentation of one audited library. */
export type ILibraryReference = Readonly<{
  /** Entry points keyed by module name as in the manifest (`index`, `plugins`, `adapters/node`). */
  modules: Readonly<Record<string, IModuleDoc>>
  /** Runtime symbols keyed by name; `<module>:<name>` when two entry points export one name. */
  symbols: Readonly<Record<string, ISymbolDoc>>
  /** Types, interfaces and classes keyed by name (or `<module>:<name>`). */
  types: Readonly<Record<string, ITypeDoc>>
  /** Enum-like constants keyed by constant name. */
  enums: Readonly<Record<string, IEnumDoc>>
  /** Enhancers keyed by the exported symbol that creates them. */
  enhancers: Readonly<Record<string, IEnhancerDoc>>
}>
