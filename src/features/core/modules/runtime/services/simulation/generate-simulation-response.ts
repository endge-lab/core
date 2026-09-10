import type { RuntimeArtifactReader } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { SimulationMockRequest } from '@/features/core/modules/source/domain/types/simulation-source.types'
import type { SourceFieldDefinition } from '@/features/core/modules/source/domain/types/source-expression.types'
import type { TypeProgramPayload, TypeSourceExpression, TypeSourceField } from '@/features/core/modules/source/domain/types/type-source.types'

const MAX_GENERATED_VALUES = 100_000

/** Создаёт воспроизводимый JSON response из compiled Type, не читая Source и не вызывая transport. */
export function generateSimulationResponse(
  contract: SourceFieldDefinition,
  request: SimulationMockRequest,
  artifacts: RuntimeArtifactReader,
  defaultSeed: string,
): unknown {
  let state = 2166136261
  for (const character of request.seed ?? defaultSeed) {
    state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0
  }
  let remaining = MAX_GENERATED_VALUES
  let serial = 0
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const visit = (
    expression: TypeSourceExpression,
    path: string,
    ancestors: ReadonlySet<string>,
    field?: TypeSourceField,
  ): unknown => {
    if (--remaining < 0) {
      throw new Error(`[Simulation] Ответ превышает лимит ${MAX_GENERATED_VALUES} значений.`)
    }
    if (expression.kind === 'reference') {
      if (ancestors.has(expression.identity)) {
        throw new Error(`[Simulation] Нельзя сгенерировать обязательную рекурсивную ссылку "${expression.identity}" (${path}).`)
      }
      const artifact = artifacts.getArtifact<TypeProgramPayload>('type', expression.identity)
      if (!artifact || artifact.status === 'error') {
        throw new Error(`[Simulation] Type "${expression.identity}" недоступен.`)
      }
      const type = artifact.payload
      if (type.definition) {
        return visit(type.definition, path, new Set([...ancestors, expression.identity]), field)
      }
      serial += 1
      if (type.category === 'reference') {
        return `simulation-${expression.identity}-${serial}`
      }
      switch (type.runtimeType ?? expression.identity) {
        case 'ID': {
          const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join('')
          return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`
        }
        case 'String': return `${field?.key ?? 'value'}-${serial}-${Math.floor(random() * 1000)}`
        case 'Number': {
          const minimum = field?.min ?? 0
          const maximum = field?.max ?? Math.max(minimum, 1000)
          if (maximum < minimum) {
            throw new Error(`[Simulation] Некорректный диапазон Number (${path}).`)
          }
          return Number.isInteger(minimum) && Number.isInteger(maximum)
            ? minimum + Math.floor(random() * (maximum - minimum + 1))
            : minimum + random() * (maximum - minimum)
        }
        case 'Boolean': return random() >= 0.5
        case 'Null': return null
        case 'Date': return new Date(Date.UTC(2025, 0, 1) + Math.floor(random() * 365) * 86400000).toISOString().slice(0, 10)
        case 'DateTime': return new Date(Date.UTC(2025, 0, 1) + Math.floor(random() * 31536000) * 1000).toISOString()
        case 'Time': return `${String(Math.floor(random() * 24)).padStart(2, '0')}:${String(Math.floor(random() * 60)).padStart(2, '0')}:00`
        case 'Any':
        case 'JSON':
        case 'Object': return {}
        default: throw new Error(`[Simulation] Генерация типа "${expression.identity}" не поддерживается. Укажите структурный Type.`)
      }
    }
    if (expression.kind === 'array') {
      const count = request.arrays[path] ?? 3
      if (!Number.isSafeInteger(count) || count < 0 || count > remaining) {
        throw new Error(`[Simulation] Недопустимый размер массива "${path}": ${count}.`)
      }
      return Array.from({ length: count }, () => visit(expression.items, `${path}[]`, ancestors))
    }
    if (expression.kind === 'enum') {
      if (!expression.values.length) {
        throw new Error(`[Simulation] Пустое перечисление (${path}).`)
      }
      return expression.values[Math.floor(random() * expression.values.length)]
    }
    if (expression.kind === 'union') {
      const variants = expression.variants.filter(item => item.kind !== 'reference' || !ancestors.has(item.identity))
      const nonNull = variants.filter(item => item.kind !== 'reference' || item.identity !== 'Null')
      const choices = nonNull.length ? nonNull : variants
      if (!choices.length) {
        throw new Error(`[Simulation] Рекурсивный union не имеет конечного варианта (${path}).`)
      }
      return visit(choices[Math.floor(random() * choices.length)]!, path, ancestors, field)
    }
    if (expression.kind === 'record') {
      return { item: visit(expression.values, `${path}.*`, ancestors) }
    }
    return Object.fromEntries(expression.fields.flatMap((item) => {
      if (item.optional && item.type.kind === 'reference' && ancestors.has(item.type.identity)) {
        return []
      }
      const fieldPath = path ? `${path}.${item.key}` : item.key
      const value = item.array ? { kind: 'array' as const, items: item.type } : item.type
      // Examples остаются подсказкой для scalar fields; размеры массивов задаёт Simulation.
      const examples = item.examples.filter(value => value === null || typeof value !== 'object')
      const sample = !item.array && item.type.kind !== 'array' && examples.length
        ? examples[Math.floor(random() * examples.length)]
        : visit(value, fieldPath, ancestors, item)
      return [[item.key, sample]]
    }))
  }
  const expression = contract.typeExpression ?? { kind: 'reference' as const, identity: contract.type }
  return visit(contract.array ? { kind: 'array', items: expression } : expression, '', new Set())
}
