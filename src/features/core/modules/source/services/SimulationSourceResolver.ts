import type { ProgramDependency } from '@/features/core/modules/program/domain/types/program.types'
import type { CompositionSourceDocument } from '@/features/core/modules/source/domain/types/composition-source.types'
import type { SimulationRuntimeOverride, SimulationSourceCatalog, SimulationSourceCompileResult, SimulationSourceInput } from '@/features/core/modules/source/domain/types/simulation-source.types'
import type { TypeSourceExpression } from '@/features/core/modules/source/domain/types/type-source.types'

import { compileCompositionSource } from '@/features/core/modules/source/services/compilers/composition-source-compile'
import { compileQuerySource } from '@/features/core/modules/source/services/compilers/query-source-compile'
import { compileTypeSource } from '@/features/core/modules/source/services/compilers/type-source-compile'

interface SimulationCompositionBranch {
  owner: SimulationSourceInput
  document: CompositionSourceDocument
  scopePath: string
}

export interface SimulationSourceTarget {
  alias: string
  kind: 'composition' | 'scope' | 'query' | 'unsupported'
  identity: string
  branch: SimulationCompositionBranch | null
}

interface QueryArrayContract {
  paths: string[]
  dependencies: ProgramDependency[]
  errors: string[]
}

/** Read-only разрешение aliases и контрактов; не создаёт RuntimeHost или generator payload. */
export class SimulationSourceResolver {
  private readonly _compositions = new Map<string, SimulationCompositionBranch | null>()
  private readonly _queryContracts = new Map<string, QueryArrayContract>()

  public constructor(private readonly _catalog: SimulationSourceCatalog) {}

  public composition(identity: string): SimulationCompositionBranch | null {
    if (this._compositions.has(identity)) {
      return this._compositions.get(identity) ?? null
    }
    const owner = this._catalog.compositions.find(item => item.identity === identity)
    const compiled = owner ? compileCompositionSource(owner.source, owner.sourceVersion) : null
    const document = compiled?.diagnostics.some(item => item.severity === 'error') ? null : compiled?.document ?? null
    const branch = owner && document ? { owner, document, scopePath: 'scope_default' } : null
    this._compositions.set(identity, branch)
    return branch
  }

  public children(branch: SimulationCompositionBranch): SimulationSourceTarget[] {
    const runtimes: SimulationSourceTarget[] = branch.document.runtimes
      .filter(runtime => runtime.scopePath === branch.scopePath)
      .map(runtime => ({
        alias: branch.scopePath === 'scope_default' ? runtime.name : runtime.path.slice(branch.scopePath.length + 1),
        kind: runtime.kind === 'composition' || runtime.kind === 'query' ? runtime.kind : 'unsupported',
        identity: runtime.identity,
        branch: runtime.kind === 'composition' ? this.composition(runtime.identity) : null,
      }))
    const scopes: SimulationSourceTarget[] = branch.document.scopes
      .filter(scope => scope.parentPath === branch.scopePath)
      .map(scope => ({ alias: scope.name, kind: 'scope', identity: branch.owner.identity, branch: { ...branch, scopePath: scope.path } }))
    return [...runtimes, ...scopes]
  }

  public target(identity: string, aliases: readonly string[]): SimulationSourceTarget | null {
    let branch = this.composition(identity)
    let target: SimulationSourceTarget | null = branch ? { alias: '', kind: 'composition', identity, branch } : null
    for (const alias of aliases) {
      if (!branch) {
        return null
      }
      target = this.children(branch).find(child => child.alias === alias) ?? null
      branch = target?.branch ?? null
    }
    return target
  }

  public queryContract(identity: string): QueryArrayContract {
    const cached = this._queryContracts.get(identity)
    if (cached) {
      return cached
    }
    const result: QueryArrayContract = { paths: [], dependencies: [], errors: [] }
    this._queryContracts.set(identity, result)
    const query = this._catalog.queries.find(item => item.identity === identity)
    if (!query) {
      result.errors.push(`Query "${identity}" не найден.`)
      return result
    }
    result.dependencies.push({ entityType: 'query', id: query.id, identity, role: 'simulation-request' })
    const compiledQuery = compileQuerySource(query.source)
    const document = compiledQuery.document
    if (query.sourceVersion !== 2 || !document || compiledQuery.diagnostics.some(item => item.severity === 'error')) {
      result.errors.push(`Query "${identity}" содержит ошибки Source.`)
      return result
    }
    const contracts = document.outputs
      .filter(output => output.source.type === 'response' && !output.source.path && !output.source.expression && !output.transforms.length && output.contract)
      .map(output => output.contract!)
    const unique = new Map(contracts.map(contract => [JSON.stringify({ type: contract.type, expression: contract.typeExpression, array: contract.array }), contract]))
    if (unique.size !== 1) {
      result.errors.push(unique.size ? `Query "${identity}" содержит неоднозначные контракты корневого response.` : `Query "${identity}" требует контракт output().from(response()).contract(field(Type)) для корневого ответа.`)
      return result
    }
    const contract = [...unique.values()][0]
    const expression: TypeSourceExpression = contract.typeExpression ?? { kind: 'reference', identity: contract.type }
    const paths = new Set<string>()
    const dependencies = new Set<string>()
    const walk = (value: TypeSourceExpression, path: string, visited: ReadonlySet<string>): void => {
      if (value.kind === 'reference') {
        if (visited.has(value.identity)) {
          return
        }
        const type = this._catalog.types.find(item => item.identity === value.identity)
        if (!dependencies.has(value.identity)) {
          dependencies.add(value.identity)
          result.dependencies.push({ entityType: 'type', id: type?.id ?? value.identity, identity: value.identity, role: 'simulation-response-contract' })
        }
        if (!type) {
          result.errors.push(`Тип "${value.identity}" не найден.`)
        }
        else if (!type.isPrimitive) {
          const compiledType = compileTypeSource(type.source, type.sourceVersion)
          const definition = compiledType.document?.definition
          if (!definition || compiledType.diagnostics.some(item => item.severity === 'error')) {
            result.errors.push(`Тип "${value.identity}" содержит ошибки Source.`)
          }
          else {
            walk(definition, path, new Set([...visited, value.identity]))
          }
        }
        else if (!path && (value.identity === 'Any' || value.identity === 'Object')) {
          result.errors.push(`Тип "${value.identity}" не описывает структуру корневого ответа.`)
        }
      }
      else if (value.kind === 'array') {
        paths.add(path)
        walk(value.items, `${path}[]`, visited)
      }
      else if (value.kind === 'object') {
        for (const field of value.fields) {
          const fieldPath = path ? `${path}.${field.key}` : field.key
          walk(field.array ? { kind: 'array', items: field.type } : field.type, fieldPath, visited)
        }
      }
      else if (value.kind === 'union') {
        value.variants.forEach(variant => walk(variant, path, visited))
      }
      else if (value.kind === 'record') {
        // У record нет статических имён ключей; контракт значения всё равно проверяется.
        walk(value.values, `${path}.*`, visited)
      }
    }
    walk(contract.array ? { kind: 'array', items: expression } : expression, '', new Set())
    result.paths = [...paths].filter(path => !path.includes('.*')).sort()
    result.errors = [...new Set(result.errors)]
    return result
  }

  public analyze(result: SimulationSourceCompileResult): SimulationSourceCompileResult {
    if (!result.document) {
      return result
    }
    const diagnostics = [...result.diagnostics]
    const dependencies: ProgramDependency[] = []
    const report = (code: string, message: string, sourcePath: string): void => {
      diagnostics.push({ severity: 'error', code, message, sourcePath, ...result.locations[sourcePath] })
    }
    const addComposition = (identity: string): void => {
      const owner = this._catalog.compositions.find(item => item.identity === identity)
      dependencies.push({ entityType: 'composition', id: owner?.id ?? identity, identity, role: 'simulation-target' })
    }
    const root = this.composition(result.document.target)
    if (result.document.target) {
      addComposition(result.document.target)
      if (!root) {
        report('simulation-target-unresolved', `Composition "${result.document.target}" отсутствует или содержит ошибки Source.`, 'target')
      }
    }
    const visit = (overrides: SimulationRuntimeOverride[], branch: SimulationCompositionBranch, path: string): void => {
      const children = this.children(branch)
      for (const override of overrides) {
        const currentPath = `${path}.${override.alias}`
        const target = children.find(child => child.alias === override.alias)
        if (!target) {
          report('simulation-runtime-missing', `Alias "${override.alias}" отсутствует в Composition "${branch.owner.identity}".`, currentPath)
          continue
        }
        if (target.kind === 'composition') {
          addComposition(target.identity)
        }
        if (target.kind === 'unsupported') {
          report('simulation-runtime-unsupported', `Подмена "${override.alias}" не поддерживается: Simulation v1 описывает только Query request.`, currentPath)
        }
        if (override.request) {
          if (target.kind !== 'query') {
            report('simulation-request-target', 'request разрешён только для Query runtime.', `${currentPath}.request`)
          }
          else {
            const contract = this.queryContract(target.identity)
            dependencies.push(...contract.dependencies)
            contract.errors.forEach(message => report('simulation-response-contract', message, `${currentPath}.request`))
            if (!contract.errors.length) {
              for (const key of Object.keys(override.request.arrays)) {
                if (!contract.paths.includes(key)) {
                  report('simulation-array-path', `Путь "${key}" не является статическим массивом корневого ответа Query "${target.identity}".`, `${currentPath}.request.arrays.${key}`)
                }
              }
            }
          }
        }
        if (override.runtimes) {
          if (target.branch) {
            visit(override.runtimes, target.branch, `${currentPath}.runtimes`)
          }
          else {
            report('simulation-runtimes-target', 'Вложенные runtimes требуют доступной Composition или scope.', `${currentPath}.runtimes`)
          }
        }
      }
    }
    if (root) {
      visit(result.document.runtimes, root, 'overrides.runtimes')
    }
    const unique = new Map(dependencies.map(item => [`${item.entityType}:${item.identity}`, item]))
    return { ...result, diagnostics, dependencies: [...unique.values()], artifact: diagnostics.some(item => item.severity === 'error') ? null : result.artifact }
  }
}
