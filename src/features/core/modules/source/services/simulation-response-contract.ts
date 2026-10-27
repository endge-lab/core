import type { QueryOutputSource } from '@/features/core/modules/source/domain/types/query-source.types'
import type { SourceFieldDefinition } from '@/features/core/modules/source/domain/types/source-expression.types'
import type { TypeSourceExpression, TypeSourceField } from '@/features/core/modules/source/domain/types/type-source.types'

// Выход Query в Source document или в Program artifact.
export interface SimulationResponseOutput {
  source: QueryOutputSource
  transforms?: readonly unknown[]
  dataViews?: readonly unknown[]
  contract?: SourceFieldDefinition | null
}

export type SimulationResponseContract = Pick<SourceFieldDefinition, 'type' | 'typeExpression' | 'array'>

export type SimulationResponseContractResult
  = | { contract: SimulationResponseContract, error?: undefined }
    | { contract: null, error: string }

/**
 * Контракт ответа Query для mockRequest.
 * REST и GraphQL: единственный корневой output().from(response()|data()).contract(field(Type)).
 * GraphQL без корневого контракта: объект data операции собирается из выходов
 * output().from(data('a.b')).contract(field(Type)) по их статическим путям.
 */
export function resolveSimulationResponseContract(
  identity: string,
  outputs: readonly SimulationResponseOutput[],
  graphql: boolean,
): SimulationResponseContractResult {
  const plain = outputs.filter(output => output.source.type === 'response'
    && !output.source.expression
    && !output.transforms?.length
    && !output.dataViews?.length
    && output.contract)
  const roots = unique(plain.filter(output => output.source.type === 'response' && !output.source.path).map(output => output.contract!))
  if (roots.size > 1) {
    return { contract: null, error: `Query "${identity}" содержит неоднозначные контракты корневого response.` }
  }
  if (roots.size === 1) {
    return { contract: [...roots.values()][0]! }
  }
  if (!graphql) {
    return { contract: null, error: `Query "${identity}" требует контракт output().from(response()).contract(field(Type)) для корневого ответа.` }
  }
  const fields = new Map<string, SimulationResponseContract>()
  for (const output of plain) {
    const path = output.source.type === 'response' ? output.source.path! : ''
    const contract = output.contract!
    const existing = fields.get(path)
    if (existing && key(existing) !== key(contract)) {
      return { contract: null, error: `Query "${identity}" содержит разные контракты для data('${path}').` }
    }
    fields.set(path, contract)
  }
  if (!fields.size) {
    return { contract: null, error: `GraphQL Query "${identity}" требует контракт output().from(data('field')).contract(field(Type)) хотя бы для одного выхода.` }
  }
  const paths = [...fields.keys()].sort()
  for (const path of paths) {
    if (path.split('.').some(segment => !segment || /^\d+$/.test(segment))) {
      return { contract: null, error: `Путь data('${path}') Query "${identity}" должен состоять из имён полей без индексов массивов.` }
    }
    const nested = paths.find(other => other.startsWith(`${path}.`))
    if (nested) {
      return { contract: null, error: `Query "${identity}" описывает контракт и data('${path}'), и вложенного data('${nested}'): оставьте один из них.` }
    }
  }
  const root: TypeSourceField[] = []
  for (const path of paths) {
    const segments = path.split('.')
    let level = root
    for (const segment of segments.slice(0, -1)) {
      let field = level.find(item => item.key === segment)
      if (!field) {
        field = { key: segment, type: { kind: 'object', fields: [] }, optional: false, array: false, examples: [] }
        level.push(field)
      }
      level = (field.type as Extract<TypeSourceExpression, { kind: 'object' }>).fields
    }
    const contract = fields.get(path)!
    level.push({
      key: segments.at(-1)!,
      type: contract.typeExpression ?? { kind: 'reference', identity: contract.type },
      optional: false,
      array: contract.array,
      examples: [],
    })
  }
  return { contract: { type: 'Object', typeExpression: { kind: 'object', fields: root }, array: false } }
}

function key(contract: SimulationResponseContract): string {
  return JSON.stringify({ type: contract.type, expression: contract.typeExpression, array: contract.array })
}

function unique(contracts: SimulationResponseContract[]): Map<string, SimulationResponseContract> {
  return new Map(contracts.map(contract => [key(contract), contract]))
}
