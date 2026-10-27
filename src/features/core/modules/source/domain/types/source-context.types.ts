// Условие по выбранным фасетам: ключ — identity фасета, значение — identity документа.
// Отсутствующий ключ означает любое значение фасета.
export type SourceContextPattern = Readonly<Record<string, string>>

// Значения контекста сборки, которые компилятор Source подставляет в выражения как константы.
export interface SourceContextValues {
  // Выбранные документы фасетов текущего boot: facet identity → document identity.
  facets: Readonly<Record<string, string>>

  // Публичная проекция effective Configuration — та же, что `$context.config` в SFC.
  config: Readonly<Record<string, unknown>>

  // Активные фасеты домена (identity); `undefined` — список неизвестен, проверка имени фасета пропускается.
  knownFacets?: readonly string[]
}
