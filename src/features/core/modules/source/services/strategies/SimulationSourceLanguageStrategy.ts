import type { SimulationSourceCatalog } from '@/features/core/modules/source/domain/types/simulation-source.types'
import type { SourceKind, SourceLanguageCompletion, SourceLanguageContext, SourceLanguageStrategy, SourceLanguageValidationResult } from '@/features/core/modules/source/domain/types/source-engine.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { compileSimulationSource } from '@/features/core/modules/source/services/compilers/simulation-source-compile'
import { propertyName } from '@/features/core/modules/source/services/compilers/source-expression-compile'
import { SimulationSourceResolver } from '@/features/core/modules/source/services/SimulationSourceResolver'
import { resolveSourceDocumentReference } from '@/features/core/modules/source/services/source-document-reference'
import { createTypeScriptLikeSourceSyntax } from '@/features/core/modules/source/services/source-language-syntax'
import { SIMULATION_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/simulation.default.source'

export class SimulationSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:simulation'
  public readonly sourceKind: SourceKind = 'simulation'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Simulation Source',
    extension: '.endge-simulation.ts',
    keywords: ['defineSimulation', 'composition', 'mockRequest'],
    functions: ['defineSimulation', 'composition', 'mockRequest'],
    properties: ['target', 'overrides', 'runtimes', 'request', 'seed', 'arrays'],
  })

  public constructor(private readonly _catalog: () => SimulationSourceCatalog) {}

  public supports(sourceKind: SourceKind | string): boolean { return sourceKind === this.sourceKind }
  public createDefaultSource(): string { return SIMULATION_DEFAULT_SOURCE }

  public validate(source: string): SourceLanguageValidationResult {
    const result = new SimulationSourceResolver(this._catalog()).analyze(compileSimulationSource(source))
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Simulation source contains validation errors.' }
  }

  public completions(context: SourceLanguageContext): SourceLanguageCompletion[] {
    const catalog = this._catalog()
    const position = context.position
    const offset = position ? context.source.split('\n').slice(0, position.lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0) + position.column - 1 : context.source.length
    const prefix = context.source.slice(0, offset)
    if (/\bcomposition\s*\(\s*['"][^'"]*$/.test(prefix)) {
      return catalog.compositions.map(item => ({ label: item.identity, kind: 'value', insertText: item.identity, detail: item.displayName || 'Composition' }))
    }
    const location = objectAt(context.source, offset)
    const definition = compileSimulationSource(context.source).document
    const resolver = new SimulationSourceResolver(catalog)
    if (location && definition?.target && location.path[0] === 'overrides') {
      const aliases: string[] = []
      let index = 1
      while (location.path[index] === 'runtimes' && index + 1 < location.path.length) {
        aliases.push(location.path[index + 1])
        index += 2
      }
      const target = resolver.target(definition.target, aliases)
      const remaining = location.path.slice(index)
      if (target?.branch && remaining.length === 1 && remaining[0] === 'runtimes') {
        return resolver.children(target.branch)
          .filter(child => child.kind !== 'unsupported' && !location.keys.includes(child.alias))
          .map(child => ({
            label: child.alias,
            kind: 'property',
            insertText: `${sourceKey(child.alias)}: ${child.kind === 'query' ? '{\n  request: mockRequest({ arrays: {} }),\n}' : '{\n  runtimes: {},\n}'},`,
            detail: `${child.kind}: ${child.identity}`,
          }))
      }
      if (target?.kind === 'query' && remaining.join('.') === 'request.arrays') {
        return resolver.queryContract(target.identity).paths.filter(path => !location.keys.includes(path)).map(path => ({ label: path || '(корневой массив)', kind: 'property', insertText: `${sourceKey(path)}: 50,`, detail: 'Количество элементов массива ответа Query' }))
      }
      if (target?.kind === 'query' && remaining.length === 0) {
        return [{ label: 'request', kind: 'snippet', insertText: 'request: mockRequest({\n  arrays: {},\n}),', detail: 'Описание подмены Query request' }].filter(item => !location.keys.includes(item.label)) as SourceLanguageCompletion[]
      }
      if (target?.branch && remaining.length === 0) {
        return [{ label: 'runtimes', kind: 'property', insertText: 'runtimes: {},', detail: 'Aliases вложенной Composition' }].filter(item => !location.keys.includes(item.label)) as SourceLanguageCompletion[]
      }
    }
    return [
      { label: 'defineSimulation', kind: 'snippet', insertText: SIMULATION_DEFAULT_SOURCE, detail: 'Создать Simulation Source' },
      { label: 'target', kind: 'property', insertText: 'target: composition(\'\'),', detail: 'Целевая Composition' },
      { label: 'overrides', kind: 'property', insertText: 'overrides: { runtimes: {} },', detail: 'Дерево подмен' },
      { label: 'mockRequest', kind: 'function', insertText: 'mockRequest({ arrays: {} })', detail: 'Описание подмены запроса' },
      { label: 'seed', kind: 'property', insertText: 'seed: \'simulation\',', detail: 'Seed будущей генерации' },
      { label: 'arrays', kind: 'property', insertText: 'arrays: {},', detail: 'Количество элементов массивов ответа' },
    ]
  }

  public resolveReference(context: SourceLanguageContext) {
    return resolveSourceDocumentReference(context, { functions: { composition: 'composition' } })
  }
}

function sourceKey(value: string): string {
  return /^[A-Z_$][\w$]*$/i.test(value) ? value : JSON.stringify(value)
}

/** AST-контекст сохраняет уровень aliases, включая пустые object literals при вводе. */
function objectAt(source: string, offset: number): { path: string[], keys: string[] } | null {
  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'], errorRecovery: true })
    let result: { path: string[], keys: string[] } | null = null
    const visit = (node: t.Node, path: string[]): void => {
      if (node.start == null || node.end == null || offset < node.start || offset > node.end) {
        return
      }
      if (t.isObjectExpression(node)) {
        result = { path, keys: node.properties.flatMap(property => t.isObjectProperty(property) && !property.shorthand ? [propertyName(property.key) ?? ''] : []) }
        for (const property of node.properties) {
          if (t.isObjectProperty(property)) {
            visit(property.value, [...path, propertyName(property.key) ?? ''])
          }
        }
        return
      }
      for (const key of t.VISITOR_KEYS[node.type] ?? []) {
        const value = (node as unknown as Record<string, unknown>)[key]
        for (const child of Array.isArray(value) ? value : [value]) {
          if (child && typeof child === 'object' && 'type' in child) {
            visit(child as t.Node, path)
          }
        }
      }
    }
    visit(ast, [])
    return result
  }
  catch {
    return null
  }
}
