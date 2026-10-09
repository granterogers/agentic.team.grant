/**
 * A canonical form of JavaScript source for comparing what the platform STORES (transpiled by its own toolchain) with what this repository
 * would upload (TypeScript), used by `reconcile-live.ts`.
 *
 * Why not strings: the two are formatted differently (trailing commas, line breaks, redundant parentheses, comments dropped), so a literal or
 * token count says nothing about behaviour; a context-free scanner even mis-reads a regular expression as a string and reports hundreds of
 * "missing literals" that are not there. This parses both sides, drops what has no meaning (comments, redundant parentheses, trivia) and
 * keeps everything that has: node kinds, nesting, identifiers, literal values, operators and ORDER. Two sources with the same canonical
 * statement list do the same thing; a changed literal, operator, identifier, call or statement order is a difference.
 *
 * What it deliberately does not hide: a class whose field initialisers one toolchain lowers into the constructor and the other keeps as
 * fields reads as different under `compareStoredWithSource`. `compareLowered` is the second, named tier for exactly that one difference
 * (the source is transpiled with `useDefineForClassFields: false` and initialiser-less field declarations are ignored on both sides); a
 * file that is identical only under it is reported as such, never as identical.
 */
import ts from 'typescript'

const parse = (text: string): ts.SourceFile =>
  ts.createSourceFile('x.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)

// `lowered` ignores a class field declared WITHOUT an initialiser (it only reserves a name the constructor assigns), which is the one thing the
// two toolchains emit differently once initialisers are lowered into the constructor.
const canon = (n: ts.Node, lowered = false): string => {
  let node = n
  while (ts.isParenthesizedExpression(node)) node = node.expression
  let leaf = ''
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) leaf = node.text
  else if (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    ts.isRegularExpressionLiteral(node)
  )
    leaf = node.text
  else if (
    node.kind === ts.SyntaxKind.TemplateHead ||
    node.kind === ts.SyntaxKind.TemplateMiddle ||
    node.kind === ts.SyntaxKind.TemplateTail
  )
    leaf = (node as ts.TemplateLiteralLikeNode).text
  else if (ts.isBinaryExpression(node)) leaf = ts.tokenToString(node.operatorToken.kind) ?? ''
  else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
    leaf = ts.tokenToString(node.operator) ?? ''
  const kids: string[] = []
  ts.forEachChild(node, (c) => {
    if (lowered && ts.isPropertyDeclaration(c) && c.initializer === undefined) return
    kids.push(canon(c, lowered))
  })
  const head = ts.SyntaxKind[node.kind] + (leaf === '' ? '' : `:${leaf}`)
  return kids.length === 0 ? head : `${head}(${kids.join(',')})`
}

/** The canonical form of each top-level statement, in order. */
export const canonicalStatements = (text: string): string[] =>
  parse(text).statements.map((s) => canon(s))

/** TypeScript to the JavaScript the platform would store: types erased, comments dropped. Nothing else is changed. */
export const toJavaScript = (typescript: string, lowerClassFields = false): string =>
  ts.transpileModule(typescript, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      ...(lowerClassFields ? { useDefineForClassFields: false } : {}),
    },
  }).outputText

/** The canonical statements with class-field initialisers lowered into the constructor on the source side, for the one known toolchain difference. */
export const loweredStatements = (text: string, fromTypeScript: boolean): string[] =>
  parse(fromTypeScript ? toJavaScript(text, true) : text).statements.map((st) => canon(st, true))

export type Comparison = {
  readonly identical: boolean
  readonly statements: number
  readonly same: number
  readonly differing: number
}

/** Compare a stored JavaScript file with TypeScript source, statement by statement, in order. */
export const compareStoredWithSource = (stored: string, source: string): Comparison => {
  const a = canonicalStatements(stored)
  const b = canonicalStatements(toJavaScript(source))
  const n = Math.max(a.length, b.length)
  let same = 0
  for (let i = 0; i < n; i += 1) if (a[i] !== undefined && a[i] === b[i]) same += 1
  return {
    identical: a.length === b.length && same === a.length,
    statements: n,
    same,
    differing: n - same,
  }
}

/** As `compareStoredWithSource`, but tolerant of exactly one thing: class fields lowered into the constructor. */
export const compareLowered = (stored: string, source: string): Comparison => {
  const a = loweredStatements(stored, false)
  const b = loweredStatements(source, true)
  const n = Math.max(a.length, b.length)
  let same = 0
  for (let i = 0; i < n; i += 1) if (a[i] !== undefined && a[i] === b[i]) same += 1
  return {
    identical: a.length === b.length && same === a.length,
    statements: n,
    same,
    differing: n - same,
  }
}
