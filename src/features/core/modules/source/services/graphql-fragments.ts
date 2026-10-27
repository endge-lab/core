import type { DocumentNode } from 'graphql'
import type {
  GraphQLDocumentFragments,
  GraphQLDocumentVariant,
} from '@/features/core/modules/source/domain/types/graphql-fragments.types'
import type { SourceContextPattern } from '@/features/core/modules/source/domain/types/source-context.types'
import type { GraphQLDocumentDiagnostic, GraphQLSchemaInput } from '@/features/core/modules/source/services/graphql-schema'

import { Kind, parse, visit } from 'graphql'

import { validateGraphQLDocument } from '@/features/core/modules/source/services/graphql-schema'
import { selectContextCase } from '@/features/core/modules/source/services/source-context'

// Имена spread-ов и переменных, использованных в GraphQL document.
export interface GraphQLDocumentUsage {
  spreads: Set<string>
  variables: Set<string>
}

// Собирает `...Имя` и `$переменные` из уже разобранного document.
export function collectGraphQLDocumentUsage(document: DocumentNode): GraphQLDocumentUsage {
  const spreads = new Set<string>()
  const variables = new Set<string>()
  visit(document, {
    FragmentSpread(node) {
      spreads.add(node.name.value)
    },
    VariableDefinition() {
      // Объявление переменной в operation не является её использованием.
      return false
    },
    Variable(node) {
      variables.add(node.name.value)
    },
  })
  return { spreads, variables }
}

/**
 * Подставляет фрагменты в document operation: добавляются только фрагменты, достижимые из
 * operation (в том числе через вложенные spread). `pick` выбирает текст фрагмента по имени.
 */
export function composeGraphQLDocument(
  operation: string,
  pick: (name: string) => string | undefined,
): string {
  let parsedOperation: DocumentNode
  try {
    parsedOperation = parse(operation)
  }
  catch {
    return operation
  }
  const appended: string[] = []
  const visited = new Set<string>()
  const queue = [...collectGraphQLDocumentUsage(parsedOperation).spreads]
  while (queue.length) {
    const name = queue.shift()!
    if (visited.has(name)) {
      continue
    }
    visited.add(name)
    const text = pick(name)
    if (text == null) {
      continue
    }
    appended.push(text.trim())
    try {
      queue.push(...collectGraphQLDocumentUsage(parse(text)).spreads)
    }
    catch {
      // Синтаксис фрагмента проверяет компилятор Source.
    }
  }
  return appended.length ? `${operation.trimEnd()}\n\n${appended.join('\n\n')}\n` : operation
}

/**
 * Возвращает document для каждого различимого сочетания фасетов: default и условие каждого
 * case всех фрагментов. Одинаковые documents объединяются (остаётся первое сочетание).
 */
export function createGraphQLDocumentVariants(source: GraphQLDocumentFragments): GraphQLDocumentVariant[] {
  const contexts: SourceContextPattern[] = [{}]
  const seenContexts = new Set<string>(['{}'])
  for (const fragment of Object.values(source.fragments)) {
    for (const variant of fragment.variants) {
      if (!variant.when) {
        continue
      }
      const key = JSON.stringify(Object.entries(variant.when).sort(([left], [right]) => left.localeCompare(right)))
      if (!seenContexts.has(key)) {
        seenContexts.add(key)
        contexts.push(variant.when)
      }
    }
  }

  const result: GraphQLDocumentVariant[] = []
  const seenDocuments = new Set<string>()
  for (const context of contexts) {
    const document = composeGraphQLDocument(source.operation, (name) => {
      const fragment = source.fragments[name]
      if (!fragment) {
        return undefined
      }
      // variants[0] — default, остальные — cases contextSwitch с непустым when.
      const cases = fragment.variants.slice(1).map(variant => ({ when: variant.when ?? {}, document: variant.document }))
      const selected = selectContextCase(cases, context)
      return selected == null ? fragment.variants[0]?.document : cases[selected]!.document
    })
    if (!seenDocuments.has(document)) {
      seenDocuments.add(document)
      result.push({ context, document })
    }
  }
  return result
}

// Результат проверки одного варианта document по схеме.
export interface GraphQLDocumentVariantValidation extends GraphQLDocumentVariant {
  diagnostics: GraphQLDocumentDiagnostic[]
}

// Проверяет по схеме document каждого варианта фрагментов (API W3a `validateGraphQLDocument`).
export function validateGraphQLDocumentVariants(
  schema: GraphQLSchemaInput,
  source: GraphQLDocumentFragments,
): GraphQLDocumentVariantValidation[] {
  return createGraphQLDocumentVariants(source).map(variant => ({
    ...variant,
    diagnostics: validateGraphQLDocument(schema, variant.document),
  }))
}

// Имена фрагментов, определённых в самом document.
export function readGraphQLFragmentDefinitions(document: DocumentNode): Set<string> {
  return new Set(document.definitions
    .filter(definition => definition.kind === Kind.FRAGMENT_DEFINITION)
    .map(definition => definition.name.value))
}
