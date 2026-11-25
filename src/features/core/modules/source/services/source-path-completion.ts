import type { ComputationProgramPayload } from '@/features/core/modules/domain/types/computation/computation-program.types'
import type { ActionProgramPayload } from '@/features/core/modules/program/domain/types/action-program.types'
import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'
import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'
import type { SourceEngineCompileResult, SourceLanguageCompletion, SourceLanguageContext } from '@/features/core/modules/source/domain/types/source-engine.types'
import type { SourceFieldDefinition } from '@/features/core/modules/source/domain/types/source-expression.types'
import type { TypeSourceExpression } from '@/features/core/modules/source/domain/types/type-source.types'
import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { Endge } from '@/features/core/kernel/endge'
import { compileSourceExpression } from '@/features/core/modules/source/services/compilers/source-expression-compile'
import { compositionCompletionTypes, resolveProgramCompletionType, storeCompletionType } from '@/features/core/modules/source/services/program-completion-types'
import {
  completionCollectionSelectors,
  completionItemType,
  completionTypeField,
  completionTypeFields,
  inferSourceExpressionType,
  readCompletionType,
  sampleCompletionType,
  sourceFieldCompletionType,
  sourceFieldsCompletionType,
} from '@/features/core/modules/source/services/source-completion-types'
import { positionToOffset } from '@/features/core/modules/source/services/source-document-reference'

const readersByKind: Readonly<Record<string, readonly string[]>> = {
  'composition': ['prop', 'fromData', 'fromStore', 'fromOutput', 'get', 'getOr', 'has'],
  'query': ['prop', 'response', 'data', 'get', 'getOr', 'has'],
  'data-view': ['prop', 'get', 'getOr', 'has', 'path', 'value', 'row'],
  'computation': ['input', 'get', 'getOr', 'has'],
  'action': ['input', 'get', 'getOr', 'has'],
  'stream': ['prop'],
  'update': ['data', 'item', 'parent', 'get', 'getOr', 'has'],
}

interface PathCursor {
  reader: string
  call: t.CallExpression
  ancestors: t.Node[]
  source: string
  path: string
  prefix: string
  start: number
  end: number
}

export function completeSourcePath(
  kind: string,
  context: SourceLanguageContext,
  compile: (source: string) => SourceEngineCompileResult,
): SourceLanguageCompletion[] | null {
  const readers = readersByKind[kind]
  const offset = positionToOffset(context.source, context.position)
  if (!readers || offset == null) {
    return null
  }
  const cursor = findPathCursor(context.source, offset, readers)
  if (!cursor) {
    return null
  }

  const catalog = new Map(context.typeSymbols?.map(symbol => [symbol.identity, symbol.definition]))
  const resolveType = (identity: string) => catalog.get(identity) ?? resolveProgramCompletionType(identity)
  const artifact = compile(cursor.source).artifact as {
    props?: SourceFieldDefinition[]
    sourceDocument?: ActionProgramPayload['sourceDocument']
    mockData?: unknown
    contract?: { input: SourceFieldDefinition }
  } | undefined
  const props = sourceFieldsCompletionType(artifact?.props ?? [])
  const response = kind === 'query' && artifact?.mockData != null ? sampleCompletionType(artifact.mockData) : undefined
  const composition = kind === 'composition' && artifact
    ? compositionCompletionTypes(artifact as unknown as CompositionProgramPayload, resolveType)
    : undefined
  const storeIdentity = kind === 'update' && context.ownerIdentity
    ? Endge.program.getUpdateArtifact(context.ownerIdentity)?.payload.storeIdentity
    ?? Endge.domain.getUpdate(context.ownerIdentity)?.storeIdentity
    : undefined
  const store = storeIdentity ? storeCompletionType(storeIdentity, resolveType) : undefined
  const input = kind === 'data-view' && artifact?.contract
    ? sourceFieldCompletionType(artifact.contract.input)
    : undefined
  const scope = { resolveType, reads: { 'prop': props, response, 'value': input, 'update-data': store }, current: input, read: composition?.read }
  const infer = (node: t.Node | null | undefined, current = scope.current) => {
    if (!t.isExpression(node)) {
      return undefined
    }
    const diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[] = []
    const expression = compileSourceExpression(node, diagnostics, 'completion')
    return inferSourceExpressionType(expression, { ...scope, current })
  }
  let type: TypeSourceExpression | undefined
  switch (cursor.reader) {
    case 'prop':
      type = props
      break
    case 'input': {
      if (kind === 'action') {
        const field = artifact?.sourceDocument?.contract.input
        type = field ? sourceFieldCompletionType(field) : undefined
        break
      }
      const field = (artifact as ComputationProgramPayload | undefined)?.input
      type = field ? sourceFieldCompletionType({ key: '', type: field.type, array: field.isArray === true, optional: field.optional === true }) : undefined
      break
    }
    case 'fromData':
    case 'fromStore': {
      const data = composition?.readData(cursor.path)
        ?? (cursor.reader === 'fromStore' ? readStorePath(cursor.path, resolveType) : undefined)
      return toItems(data
        ? completionTypeFields(data, resolveType)
        : cursor.path ? [] : composition?.dataNames.map(name => completionTypeField(name)) ?? [], cursor)
    }
    case 'fromOutput': {
      const first = cursor.call.arguments[0]
      const output = t.isStringLiteral(first) ? composition?.readOutput(first.value, cursor.path) : undefined
      return toItems(completionTypeFields(output, resolveType), cursor)
    }
    case 'response':
      type = response
      break
    case 'data':
      type = kind === 'query' ? response : store
      break
    case 'value':
      type = input
      break
    default: {
      const current = cursor.ancestors.reduce<TypeSourceExpression | undefined>((current, ancestor, index) => {
        if (!t.isCallExpression(ancestor)) {
          return current
        }
        const callee = ancestor.callee
        const argument = cursor.ancestors[index + 1] ?? cursor.call
        if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)
          && completionCollectionSelectors.has(callee.property.name) && ancestor.arguments[0] === argument) {
          return completionItemType(infer(callee.object, current), resolveType)
        }
        if (t.isIdentifier(callee) && completionCollectionSelectors.has(callee.name) && ancestor.arguments[1] === argument) {
          return completionItemType(infer(ancestor.arguments[0], current), resolveType)
        }
        return current
      }, scope.current)
      const callee = cursor.call.callee
      type = t.isMemberExpression(callee)
        ? infer(callee.object, current)
        : cursor.call.arguments.length > 1 && t.isStringLiteral(cursor.call.arguments[1])
          ? infer(cursor.call.arguments[0], current)
          : current
    }
  }

  return toItems(completionTypeFields(readCompletionType(type, cursor.path, resolveType), resolveType), cursor)
}

function readStorePath(path: string, resolveType: Parameters<typeof storeCompletionType>[1]): TypeSourceExpression | undefined {
  for (let end = path.length; end > 0; end = path.lastIndexOf('.', end - 1)) {
    const store = storeCompletionType(path.slice(0, end), resolveType)
    if (store) {
      return readCompletionType(store, path.slice(end), resolveType)
    }
  }
}

function toItems(fields: ReturnType<typeof completionTypeFields>, cursor: PathCursor): SourceLanguageCompletion[] {
  return fields
    .filter(field => field.key.toLowerCase().startsWith(cursor.prefix.toLowerCase()) && /^[\w$-]+$/.test(field.key))
    .map(field => ({
      label: field.key,
      kind: 'property',
      insertText: field.key,
      detail: field.type.kind === 'reference' ? field.type.identity : field.type.kind,
      documentation: field.description,
      replace: { start: cursor.start, end: cursor.end },
    }))
}

function findPathCursor(source: string, offset: number, readers: readonly string[]): PathCursor | null {
  const match = /['"]([\w$.[\]=-]*)$/.exec(source.slice(0, offset))
  if (!match) {
    return null
  }
  const prefix = match[1].match(/[\w$-]*$/)?.[0] ?? ''
  const start = offset - prefix.length
  const end = offset + (source.slice(offset).match(/^[\w$-]*/)?.[0].length ?? 0)
  const path = match[1].slice(0, match[1].length - prefix.length).replace(/\.$/, '')
  const quoteStart = offset - match[0].length
  // Keep the edited argument syntactically valid even when a new path ends with a dot.
  const parseable = `${source.slice(0, start)}__endgeCompletion${source.slice(end)}`
  let ast: t.File
  try {
    ast = parse(parseable, { sourceType: 'module', plugins: ['typescript'], errorRecovery: true })
  }
  catch {
    return null
  }
  const ancestors = nodesAt(ast, quoteStart)
  const literal = ancestors.at(-1)
  const call = ancestors.at(-2)
  if (!t.isStringLiteral(literal) || literal.start !== quoteStart || !t.isCallExpression(call)) {
    return null
  }
  const callee = call.callee
  const reader = t.isIdentifier(callee)
    ? callee.name
    : t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property) ? callee.property.name : ''
  const index = call.arguments.indexOf(literal)
  const pathIndex = reader === 'fromOutput'
    ? 1
    : ['get', 'getOr', 'has'].includes(reader) && t.isIdentifier(callee) && index === 1 ? 1 : 0
  if (!readers.includes(reader) || index !== pathIndex) {
    return null
  }

  return { reader, call, ancestors: ancestors.slice(0, -2), source: parseable, path, prefix, start, end }
}

function nodesAt(node: t.Node, offset: number): t.Node[] {
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const value: unknown = node[key as keyof typeof node]
    for (const child of Array.isArray(value) ? value : [value]) {
      if (t.isNode(child) && child.start != null && child.end != null && child.start <= offset && offset < child.end) {
        return [node, ...nodesAt(child, offset)]
      }
    }
  }
  return [node]
}
