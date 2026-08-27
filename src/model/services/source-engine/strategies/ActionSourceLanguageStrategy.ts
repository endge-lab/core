import type { SourceKind, SourceLanguageCompletion, SourceLanguageContext, SourceLanguageStrategy, SourceLanguageValidationResult } from '@/domain/types/source/source-engine.types'
import { compileActionSource } from '@/model/services/source-engine/compilers/action-source-compile'
import { resolveTypedSourceDocumentReference, typedSourceTypeReferenceHighlights } from '@/model/services/source-engine/source-document-reference'
import { createTypeScriptLikeSourceSyntax } from '@/model/services/source-engine/source-language-syntax'
import { ACTION_DEFAULT_SOURCE } from '@/model/services/source-engine/templates/action.default.source'
import { VALUE_EXPRESSION_COMPLETIONS, VALUE_EXPRESSION_FUNCTION_NAMES, VALUE_EXPRESSION_METHOD_NAMES } from '@/model/services/source-engine/value-expression-language'

const ACTION_SIGNATURES: Record<string, { label: string, documentation: string, parameters: string[] }> = {
  defineAction: { label: 'defineAction(definition)', documentation: 'Определяет контракт, последовательные именованные steps и явный output Action.', parameters: ['definition — { contract?, steps, output? }'] },
  action: { label: 'action({ identity, input })', documentation: 'Вызывает другую Action по identity и ожидает её output.', parameters: ['definition — Action identity и input'] },
  query: { label: 'query({ identity, input })', documentation: 'Выполняет Query как явный effect-step.', parameters: ['definition — Query identity и input'] },
  update: { label: 'update({ identity, input })', documentation: 'Применяет Update текущей Composition.', parameters: ['definition — Update identity и input'] },
  computation: { label: 'computation(identity, input)', documentation: 'Выполняет Computation и возвращает её result.', parameters: ['identity — static Computation identity', 'input — вычисляемое входное значение'] },
  operation: { label: 'operation({ input?, run, undo, redo? })', documentation: 'Выполняет отменяемый блок. undo обязателен; без input сохраняется текущий Action input.', parameters: ['definition — Operation snapshot и алгоритмы'] },
  typescript: { label: 'typescript({ inputs, compute })', documentation: 'Чистое синхронное sandbox-преобразование без сети, DOM, timers и Endge.', parameters: ['definition — explicit inputs и compute'] },
  input: { label: 'input(path?)', documentation: 'Читает Action input или Operation snapshot.', parameters: ['path — optional data path'] },
  output: { label: 'output(stepName)', documentation: 'Читает результат уже выполненного именованного step.', parameters: ['stepName — имя предыдущего step'] },
  runOutput: { label: 'runOutput()', documentation: 'Читает сохранённый result Operation.run внутри undo/redo.', parameters: [] },
  undoOutput: { label: 'undoOutput()', documentation: 'Читает сохранённый result Operation.undo внутри custom redo.', parameters: [] },
  dataView: { label: 'value.dataView(identity, props?)', documentation: 'Применяет DataView к текущему ValueExpression.', parameters: ['identity — DataView identity', 'props — optional props'] },
  convert: { label: 'value.convert(identity, options?)', documentation: 'Синхронно применяет Converter.', parameters: ['identity — Converter identity', 'options — optional converter options'] },
}

export class ActionSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:action'
  public readonly sourceKind: SourceKind = 'action'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Action Source',
    extension: '.endge-action.ts',
    keywords: ['defineAction', 'input', 'output', 'query', 'update', 'action', 'computation', 'operation', 'typescript', 'runOutput', 'undoOutput', ...VALUE_EXPRESSION_FUNCTION_NAMES],
    functions: ['defineAction', 'field', 'input', 'output', 'query', 'update', 'action', 'computation', 'operation', 'typescript', 'runOutput', 'undoOutput', ...VALUE_EXPRESSION_METHOD_NAMES],
    properties: ['contract', 'steps', 'output', 'identity', 'input', 'run', 'undo', 'redo'],
  })

  public supports(sourceKind: SourceKind | string): boolean { return sourceKind === this.sourceKind }
  public createDefaultSource(): string { return ACTION_DEFAULT_SOURCE }
  public validate(source: string): SourceLanguageValidationResult {
    const result = compileActionSource({ source })
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Action source contains validation errors.' }
  }

  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return [
      { label: 'defineAction', kind: 'snippet', insertText: ACTION_DEFAULT_SOURCE.trimEnd(), detail: 'Создать Source Action' },
      { label: 'operation', kind: 'snippet', insertText: 'operation({\n  run: query({ identity: \'query-identity\', input: {} }),\n  undo: query({ identity: \'query-identity\', input: {} }),\n})', detail: 'Отменяемая операция; input optional, undo обязателен' },
      { label: 'query', kind: 'snippet', insertText: 'query({ identity: \'query-identity\', input: {} })', detail: 'Выполнить Query' },
      { label: 'update', kind: 'snippet', insertText: 'update({ identity: \'update-identity\', input: {} })', detail: 'Выполнить Update' },
      { label: 'action', kind: 'snippet', insertText: 'action({ identity: \'action-identity\', input: {} })', detail: 'Выполнить вложенный Action' },
      { label: 'computation', kind: 'snippet', insertText: 'computation(\'computation-identity\', {})', detail: 'Выполнить Computation' },
      { label: 'typescript', kind: 'snippet', insertText: 'typescript({\n  inputs: {},\n  compute(inputs) {\n    return inputs\n  },\n})', detail: 'Чистое sandbox-преобразование' },
      ...(_context.documentSymbols ?? [])
        .filter(symbol => ['action', 'query', 'update', 'computation', 'data-view', 'converter'].includes(symbol.target))
        .map(symbol => ({
          label: symbol.identity,
          kind: 'value' as const,
          insertText: symbol.identity,
          detail: `${symbol.target} identity`,
          documentation: [symbol.displayName, symbol.description].filter(Boolean).join('\n\n') || undefined,
        })),
      ...VALUE_EXPRESSION_COMPLETIONS,
    ]
  }

  public resolveReference(context: SourceLanguageContext) {
    return resolveTypedSourceDocumentReference(context, { functions: { action: 'action', query: 'query', update: 'update', computation: 'computation' } })
  }

  public signatureHelp(context: SourceLanguageContext) {
    const call = activeCallAt(context)
    if (!call) {
      return null
    }
    const signature = ACTION_SIGNATURES[call.name]
    if (!signature) {
      return null
    }
    return {
      activeSignature: 0,
      activeParameter: Math.min(call.parameter, Math.max(0, signature.parameters.length - 1)),
      signatures: [{
        label: signature.label,
        documentation: signature.documentation,
        parameters: signature.parameters.map(label => ({ label })),
      }],
    }
  }

  public semanticHighlights(context: SourceLanguageContext) { return typedSourceTypeReferenceHighlights(context) }
}

function activeCallAt(context: SourceLanguageContext): { name: string, parameter: number } | null {
  if (!context.position) {
    return null
  }
  const lines = context.source.split('\n')
  const offset = lines.slice(0, context.position.lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0)
    + context.position.column - 1
  let depth = 0
  let open = -1
  for (let index = Math.min(offset - 1, context.source.length - 1); index >= 0; index -= 1) {
    const char = context.source[index]
    if (char === ')') {
      depth += 1
    }
    else if (char === '(') {
      if (depth === 0) { open = index; break }
      depth -= 1
    }
  }
  if (open < 0) {
    return null
  }
  const callee = context.source.slice(0, open).match(/([A-Z_$][\w$]*)\s*$/i)?.[1]
  if (!callee) {
    return null
  }
  let parameter = 0
  let nested = 0
  for (const char of context.source.slice(open + 1, offset)) {
    if ('([{'.includes(char)) {
      nested += 1
    }
    else if (')]}'.includes(char)) {
      nested = Math.max(0, nested - 1)
    }
    else if (char === ',' && nested === 0) {
      parameter += 1
    }
  }
  return { name: callee, parameter }
}
