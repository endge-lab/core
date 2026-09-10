import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'
import type { SimulationFieldConstraints, SimulationMockRequest, SimulationMockStream, SimulationRuntimeOverride, SimulationSourceCompileResult, SimulationTargetReference } from '@/features/core/modules/source/domain/types/simulation-source.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { diagnostic, propertyName } from '@/features/core/modules/source/services/compilers/source-expression-compile'

type Diagnostic = Omit<ProgramDiagnostic, 'entityRef'>

/** Разбирает только whitelist Simulation v1, не исполняя authored Source. */
export function compileSimulationSource(source: string, sourceVersion = 1): SimulationSourceCompileResult {
  const diagnostics: Diagnostic[] = []
  const locations: SimulationSourceCompileResult['locations'] = {}
  const result: SimulationSourceCompileResult = { ast: null, document: null, artifact: null, diagnostics, dependencies: [], locations }
  if (sourceVersion !== 1) {
    diagnostics.push(diagnostic('error', 'simulation-source-version', 'Simulation поддерживает sourceVersion 1.'))
  }
  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    result.ast = ast
    const statements = ast.program.body.filter(node => !t.isEmptyStatement(node))
    const statement = statements[0]
    const expression = t.isExpressionStatement(statement) ? statement.expression : null
    if (statements.length !== 1 || !isCall(expression, 'defineSimulation')) {
      diagnostics.push(diagnostic('error', 'simulation-source-definition', 'Source должен содержать один defineSimulation({...}).', undefined, statement))
      return result
    }
    const definition = object(expression.arguments[0], 'defineSimulation', ['target', 'dataMode', 'overrides'])
    const targetCall = definition.get('target')
    let target: SimulationTargetReference = { entityType: 'composition', identity: '' }
    if ((!isCall(targetCall, 'composition') && !isCall(targetCall, 'project')) || !t.isStringLiteral(targetCall.arguments[0]) || !targetCall.arguments[0].value.trim()) {
      diagnostics.push(diagnostic('error', 'simulation-target-required', 'Выберите target: composition(\'identity\') или project(\'identity\').', 'target', targetCall ?? expression))
    }
    else {
      target = { entityType: isCall(targetCall, 'project') ? 'project' : 'composition', identity: targetCall.arguments[0].value.trim() }
    }
    const modeNode = definition.get('dataMode')
    let dataMode: 'live' | 'mock' | undefined
    if (modeNode) {
      if (t.isStringLiteral(modeNode) && (modeNode.value === 'live' || modeNode.value === 'mock')) {
        dataMode = modeNode.value
      }
      else {
        diagnostics.push(diagnostic('error', 'simulation-data-mode', 'dataMode должен быть строкой \'live\' или \'mock\'. Для наследования не указывайте свойство.', 'dataMode', modeNode))
      }
    }
    const overrides = object(definition.get('overrides'), 'overrides', ['runtimes'])
    const runtimes = readRuntimes(overrides.get('runtimes'), 'overrides.runtimes')
    result.document = { target, ...(dataMode ? { dataMode } : {}), runtimes }
    if (!diagnostics.some(item => item.severity === 'error')) {
      result.artifact = { type: 'simulation', sourceVersion, ...result.document }
    }
  }
  catch (error: unknown) {
    const failure = error as { message?: string, pos?: number }
    diagnostics.push({ severity: 'error', code: 'simulation-source-parse', message: `Не удалось разобрать Simulation Source: ${failure.message ?? String(error)}`, start: failure.pos, end: failure.pos == null ? undefined : failure.pos + 1 })
  }
  return result

  function object(node: t.Node | null | undefined, path: string, allowed?: readonly string[]): Map<string, t.Expression> {
    const properties = new Map<string, t.Expression>()
    if (!t.isObjectExpression(node)) {
      diagnostics.push(diagnostic('error', 'simulation-object-required', `${path} должен быть object literal.`, path, node))
      return properties
    }
    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed || property.shorthand || !t.isExpression(property.value)) {
        diagnostics.push(diagnostic('error', 'simulation-property-shape', 'Поддерживаются только явные свойства object literal.', path, property))
        continue
      }
      const key = propertyName(property.key)
      if (key == null) {
        diagnostics.push(diagnostic('error', 'simulation-property-name', 'Свойство должно иметь статическое имя.', path, property))
        continue
      }
      const propertyPath = path === 'defineSimulation' ? key : `${path}.${key}`
      if (property.start != null && property.end != null) {
        locations[propertyPath] = { start: property.start, end: property.end }
      }
      if (properties.has(key)) {
        diagnostics.push(diagnostic('error', 'simulation-property-duplicate', `Свойство "${key}" указано повторно.`, propertyPath, property))
      }
      if (allowed && !allowed.includes(key)) {
        diagnostics.push(diagnostic('error', 'simulation-property-unsupported', `Свойство "${key}" не поддерживается Simulation v1.`, propertyPath, property))
      }
      properties.set(key, property.value)
    }
    return properties
  }

  function readRuntimes(node: t.Node | null | undefined, path: string): SimulationRuntimeOverride[] {
    return [...object(node, path)].map(([alias, value]) => {
      const runtimePath = `${path}.${alias}`
      const properties = object(value, runtimePath, ['runtimes', 'request', 'stream'])
      const override: SimulationRuntimeOverride = { alias }
      if (properties.has('runtimes')) {
        override.runtimes = readRuntimes(properties.get('runtimes'), `${runtimePath}.runtimes`)
      }
      if (properties.has('request')) {
        override.request = readRequest(properties.get('request'), `${runtimePath}.request`)
      }
      if (properties.has('stream')) {
        override.stream = readStream(properties.get('stream'), `${runtimePath}.stream`)
      }
      return override
    })
  }

  function readStream(node: t.Node | null | undefined, path: string): SimulationMockStream | undefined {
    if (!isCall(node, 'mockStream')) {
      diagnostics.push(diagnostic('error', 'simulation-stream-shape', 'stream должен иметь вид mockStream({ type, event, intervalMs?, itemsPerMessage?, seed?, fields? }).', path, node))
      return undefined
    }
    const options = object(node.arguments[0], path, ['type', 'event', 'intervalMs', 'itemsPerMessage', 'seed', 'fields'])
    const type = options.get('type')
    const event = options.get('event')
    const identity = t.isIdentifier(type) ? type.name : t.isStringLiteral(type) ? type.value : ''
    const stream: SimulationMockStream = { kind: 'mock-stream', type: identity, event: t.isStringLiteral(event) ? event.value : '', intervalMs: 1000, itemsPerMessage: 1, fields: Object.create(null) }
    if (!identity || !stream.event.trim()) {
      diagnostics.push(diagnostic('error', 'simulation-stream-contract', 'Укажите существующий Type и строковое имя event.', path, node))
    }
    for (const [key, min, max] of [['intervalMs', 100, 60000], ['itemsPerMessage', 1, 100]] as const) {
      const value = options.get(key)
      if (!value) {
        continue
      }
      if (!t.isNumericLiteral(value) || !Number.isInteger(value.value) || value.value < min || value.value > max) {
        diagnostics.push(diagnostic('error', 'simulation-stream-range', `${key}: допустимо целое число ${min}…${max}.`, `${path}.${key}`, value))
      }
      else {
        stream[key] = value.value
      }
    }
    const seed = options.get('seed')
    if (seed) {
      if (t.isStringLiteral(seed)) {
        stream.seed = seed.value
      }
      else {
        diagnostics.push(diagnostic('error', 'simulation-seed-shape', 'seed должен быть строкой.', `${path}.seed`, seed))
      }
    }
    if (options.has('fields')) {
      for (const [field, value] of object(options.get('fields'), `${path}.fields`)) {
        const constraints: SimulationFieldConstraints = {}
        for (const [key, literal] of object(value, `${path}.fields.${field}`, ['enum', 'minimum', 'maximum'])) {
          if (key === 'enum' && t.isArrayExpression(literal) && literal.elements.length && literal.elements.every(item => t.isStringLiteral(item) || t.isNumericLiteral(item) || t.isBooleanLiteral(item))) {
            constraints.enum = literal.elements.map(item => (item as t.StringLiteral | t.NumericLiteral | t.BooleanLiteral).value)
          }
          else if ((key === 'minimum' || key === 'maximum') && (t.isNumericLiteral(literal) || (t.isUnaryExpression(literal, { operator: '-' }) && t.isNumericLiteral(literal.argument)))) {
            constraints[key] = t.isNumericLiteral(literal) ? literal.value : -(literal.argument as t.NumericLiteral).value
          }
          else {
            diagnostics.push(diagnostic('error', 'simulation-field-constraint', 'Ожидается непустой enum скаляров или числовая граница.', `${path}.fields.${field}.${key}`, literal))
          }
        }
        stream.fields[field] = constraints
      }
    }
    return stream
  }

  function readRequest(node: t.Node | null | undefined, path: string): SimulationMockRequest | undefined {
    if (!isCall(node, 'mockRequest')) {
      diagnostics.push(diagnostic('error', 'simulation-request-shape', 'request должен иметь вид mockRequest({ seed?, arrays?, useExamples? }).', path, node))
      return undefined
    }
    const options = object(node.arguments[0], path, ['seed', 'arrays', 'useExamples'])
    const request: SimulationMockRequest = { kind: 'mock-request', arrays: Object.create(null) }
    const useExamples = options.get('useExamples')
    if (useExamples) {
      if (t.isBooleanLiteral(useExamples)) {
        request.useExamples = useExamples.value
      }
      else {
        diagnostics.push(diagnostic('error', 'simulation-use-examples-shape', 'useExamples должен быть boolean literal.', `${path}.useExamples`, useExamples))
      }
    }
    const seed = options.get('seed')
    if (seed) {
      if (!t.isStringLiteral(seed)) {
        diagnostics.push(diagnostic('error', 'simulation-seed-shape', 'seed должен быть строковым литералом.', `${path}.seed`, seed))
      }
      else {
        request.seed = seed.value
      }
    }
    if (options.has('arrays')) {
      for (const [key, count] of object(options.get('arrays'), `${path}.arrays`)) {
        if (!t.isNumericLiteral(count) || !Number.isSafeInteger(count.value) || count.value < 0 || count.value > 100) {
          diagnostics.push(diagnostic('error', 'simulation-array-count', 'Количество элементов должно быть целым числом от 0 до 100.', `${path}.arrays.${key}`, count))
        }
        else {
          request.arrays[key] = count.value
        }
      }
    }
    return request
  }
}

function isCall(node: t.Node | null | undefined, name: string): node is t.CallExpression {
  return t.isCallExpression(node) && t.isIdentifier(node.callee, { name }) && node.arguments.length === 1 && !node.typeParameters && !node.typeArguments
}
