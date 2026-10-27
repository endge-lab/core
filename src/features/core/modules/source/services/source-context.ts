import type { EndgeBuildContext } from '@/features/core/modules/configuration/domain/types/configuration.type'
import type { SourceContextPattern, SourceContextValues } from '@/features/core/modules/source/domain/types/source-context.types'

import { createEndgePublicConfigurationSnapshot } from '@/features/core/modules/configuration/domain/endge-configuration'

const valuesByBuildContext = new WeakMap<EndgeBuildContext, SourceContextValues>()
const valuesWithFacetsByBuildContext = new WeakMap<EndgeBuildContext, SourceContextValues>()

let activeContext: SourceContextValues | undefined

// Выполняет синхронную компиляцию Source с заданным контекстом сборки.
export function runWithSourceContext<T>(context: SourceContextValues | undefined, run: () => T): T {
  const previous = activeContext
  activeContext = context
  try {
    return run()
  }
  finally {
    activeContext = previous
  }
}

// Возвращает контекст текущей компиляции; `undefined` — Source компилируется вне сборки (редактор, изолированный вызов).
export function getSourceContext(): SourceContextValues | undefined {
  return activeContext
}

// Строит значения контекста из immutable build context; результат кэшируется на объект build context.
// knownFacets — активные фасеты домена этого boot (для предупреждения о неизвестном фасете).
export function createSourceContextValues(buildContext: EndgeBuildContext, knownFacets?: readonly string[]): SourceContextValues {
  if (knownFacets) {
    let withFacets = valuesWithFacetsByBuildContext.get(buildContext)
    if (!withFacets) {
      withFacets = Object.freeze({ ...createSourceContextValues(buildContext), knownFacets: Object.freeze([...knownFacets]) })
      valuesWithFacetsByBuildContext.set(buildContext, withFacets)
    }
    return withFacets
  }
  let values = valuesByBuildContext.get(buildContext)
  if (!values) {
    values = Object.freeze({
      facets: Object.freeze({ ...buildContext.execution.facets }),
      config: createEndgePublicConfigurationSnapshot(buildContext.configuration) as Readonly<Record<string, unknown>>,
    })
    valuesByBuildContext.set(buildContext, values)
  }
  return values
}

// Проверяет, что все условия pattern совпадают с выбранными фасетами.
export function matchesContextPattern(pattern: SourceContextPattern, facets: Readonly<Record<string, string>>): boolean {
  return Object.entries(pattern).every(([key, value]) => facets[key] === value)
}

// Pattern-ы пересекаются, если существует выбор фасетов, при котором совпадают оба.
export function contextPatternsOverlap(left: SourceContextPattern, right: SourceContextPattern): boolean {
  return Object.keys(left).every(key => right[key] == null || right[key] === left[key])
    && Object.keys(right).every(key => left[key] == null || left[key] === right[key])
}

// Возвращает пары case одинаковой специфичности, которые могут совпасть одновременно.
export function findAmbiguousContextCases(cases: readonly { when: SourceContextPattern }[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  for (let left = 0; left < cases.length; left++) {
    for (let right = left + 1; right < cases.length; right++) {
      const first = cases[left]!.when
      const second = cases[right]!.when
      if (Object.keys(first).length === Object.keys(second).length && contextPatternsOverlap(first, second)) {
        pairs.push([left, right])
      }
    }
  }
  return pairs
}

// Выбирает совпавший case с наибольшим числом условий; `null` — нужен default.
export function selectContextCase(
  cases: readonly { when: SourceContextPattern }[],
  facets: Readonly<Record<string, string>>,
): number | null {
  let selected: number | null = null
  let specificity = -1
  for (const [index, branch] of cases.entries()) {
    const size = Object.keys(branch.when).length
    if (size > specificity && matchesContextPattern(branch.when, facets)) {
      selected = index
      specificity = size
    }
  }
  return selected
}
