import type { RuntimeArtifactReader } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { SimulationFieldConstraints } from '@/features/core/modules/source/domain/types/simulation-source.types'
import type { SourceFieldDefinition } from '@/features/core/modules/source/domain/types/source-expression.types'
import type { TypeProgramPayload, TypeSourceExpression, TypeSourceField } from '@/features/core/modules/source/domain/types/type-source.types'

/** Проекция compiled Type в JSON Schema. Генерация значений принадлежит внешнему сервису. */
export function createSimulationSchema(
  contract: Pick<SourceFieldDefinition, 'type' | 'typeExpression' | 'array'>,
  artifacts: RuntimeArtifactReader,
  arrays: Record<string, number> = {},
  fields: Record<string, SimulationFieldConstraints> = {},
  useExamples = true,
): Record<string, unknown> {
  const applied = new Set<string>()
  const visit = (expression: TypeSourceExpression, path: string, ancestors: ReadonlySet<string>, field?: TypeSourceField): Record<string, unknown> => {
    let schema: Record<string, unknown>
    if (expression.kind === 'reference') {
      if (ancestors.has(expression.identity)) {
        throw new Error(`[Simulation] Рекурсивный Type не поддерживается: ${expression.identity}.`)
      }
      const artifact = artifacts.getArtifact<TypeProgramPayload>('type', expression.identity)
      if (!artifact || artifact.status === 'error') {
        throw new Error(`[Simulation] Type "${expression.identity}" недоступен.`)
      }
      const type = artifact.payload
      if (type.definition) {
        return visit(type.definition, path, new Set([...ancestors, expression.identity]), field)
      }
      switch (type.runtimeType ?? expression.identity) {
        case 'ID':
          schema = { type: 'string', format: 'uuid' }
          break
        case 'String':
          schema = { type: 'string' }
          break
        case 'Number':
          schema = { type: 'number', ...(field?.min == null ? {} : { minimum: field.min }), ...(field?.max == null ? {} : { maximum: field.max }) }
          break
        case 'Boolean':
          schema = { type: 'boolean' }
          break
        case 'Null':
          schema = { type: 'null' }
          break
        case 'Date':
          schema = { type: 'string', format: 'date' }
          break
        case 'Time':
          schema = { type: 'string', format: 'time' }
          break
        case 'DateTime':
          schema = { type: 'string', format: 'date-time' }
          break
        default:
          throw new Error(`[Simulation] Type "${expression.identity}" требует структурный контракт.`)
      }
    }
    else if (expression.kind === 'array') {
      const count = Object.hasOwn(arrays, path) ? arrays[path] : undefined
      if (count != null && (!Number.isInteger(count) || count < 0 || count > 100)) {
        throw new Error(`[Simulation] Размер массива "${path}" должен быть от 0 до 100.`)
      }
      schema = { type: 'array', items: visit(expression.items, `${path}[]`, ancestors), ...(count == null ? {} : { minItems: count, maxItems: count }) }
    }
    else if (expression.kind === 'enum') {
      schema = { enum: expression.values }
    }
    else if (expression.kind === 'union') {
      schema = { oneOf: expression.variants.map(value => visit(value, path, ancestors)) }
    }
    else if (expression.kind === 'record') {
      schema = { type: 'object', additionalProperties: visit(expression.values, `${path}.*`, ancestors) }
    }
    else {
      schema = {
        type: 'object',
        properties: Object.fromEntries(expression.fields.map(item => [item.key, visit(item.array ? { kind: 'array', items: item.type } : item.type, path ? `${path}.${item.key}` : item.key, ancestors, item)])),
        required: expression.fields.filter(item => !item.optional).map(item => item.key),
        additionalProperties: false,
      }
    }
    if (useExamples && field?.examples.length) {
      schema.examples = field.examples
    }
    const constraints = Object.hasOwn(fields, path) ? fields[path] : undefined
    if (constraints) {
      applied.add(path)
      if (constraints.enum) {
        const valid = constraints.enum.filter(value => (!Array.isArray(schema.enum) || schema.enum.includes(value)) && (!schema.type || (schema.type === 'string' && typeof value === 'string') || (schema.type === 'number' && typeof value === 'number') || (schema.type === 'boolean' && typeof value === 'boolean')))
        if (valid.length !== constraints.enum.length) {
          throw new Error(`[Simulation] enum несовместим с Type поля "${path}".`)
        }
        schema.enum = valid
      }
      if (constraints.minimum != null || constraints.maximum != null) {
        if (schema.type !== 'number') {
          throw new Error(`[Simulation] Числовые ограничения требуют Number: "${path}".`)
        }
        if (constraints.minimum != null) {
          schema.minimum = Math.max(Number(schema.minimum ?? -Infinity), constraints.minimum)
        }
        if (constraints.maximum != null) {
          schema.maximum = Math.min(Number(schema.maximum ?? Infinity), constraints.maximum)
        }
        if (Number(schema.minimum ?? -Infinity) > Number(schema.maximum ?? Infinity)) {
          throw new Error(`[Simulation] Пустой диапазон поля "${path}".`)
        }
      }
    }
    return schema
  }
  const expression = contract.typeExpression ?? { kind: 'reference' as const, identity: contract.type }
  const schema = visit(contract.array ? { kind: 'array', items: expression } : expression, '', new Set())
  for (const path of Object.keys(fields)) {
    if (!applied.has(path)) {
      throw new Error(`[Simulation] Поле "${path}" отсутствует в Type.`)
    }
  }
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...schema }
}
