import type { SourceContextPattern } from '@/features/core/modules/source/domain/types/source-context.types'

// Один вариант фрагмента: статический gql`...` или ветка contextSwitch.
export interface GraphQLFragmentVariant {
  // Условие ветки contextSwitch; `null` — default или фрагмент без contextSwitch.
  when: SourceContextPattern | null

  // Текст `fragment Имя on Тип { ... }` ровно с одним определением.
  document: string
}

// Фрагмент из поля `fragments` GraphQL Query или Stream graphqlSse.
export interface GraphQLFragmentSource {
  // Все варианты в порядке Source: [0] — default (или единственный), далее cases.
  variants: GraphQLFragmentVariant[]

  // Индекс варианта, выбранного при компиляции по фасетам сборки.
  selected: number
}

// Исходные части GraphQL document до подстановки фрагментов — для проверки каждого варианта редактором.
export interface GraphQLDocumentFragments {
  // Authored document operation без подставленных фрагментов из `fragments`.
  operation: string

  // Фрагменты по имени.
  fragments: Record<string, GraphQLFragmentSource>
}

// Итоговый document для одного сочетания фасетов.
export interface GraphQLDocumentVariant {
  // Сочетание фасетов, при котором получается этот document; `{}` — значения по умолчанию.
  context: SourceContextPattern

  // Document с подставленными фрагментами.
  document: string
}
