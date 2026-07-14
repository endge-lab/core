import type { SourceLanguageCompletion } from '@/domain/types/source/source-engine.types'

/** Общий vocabulary ValueExpression, подключаемый всеми domain source languages. */
export const VALUE_EXPRESSION_FUNCTION_NAMES = [
  'get', 'getOr', 'pick', 'omit', 'match', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte',
  'inList', 'includes', 'and', 'or', 'not', 'isNil', 'isEmpty', 'has',
  'leftJoin', 'fullJoin', 'lookupOne', 'lookupMany',
]

export const VALUE_EXPRESSION_METHOD_NAMES = [
  'get', 'getOr', 'has', 'defaultTo',
  'pick', 'omit', 'merge', 'defaults', 'compact', 'keys', 'values', 'entries',
  'map', 'where', 'reject', 'find', 'some', 'every', 'flatMap', 'flatten', 'uniq', 'uniqBy', 'concat', 'take', 'drop',
  'sortBy', 'groupBy', 'keyBy',
  'size', 'sum', 'sumBy', 'min', 'max', 'minBy', 'maxBy',
  'trim', 'lowerCase', 'upperCase', 'split', 'join',
  'by', 'byAny', 'coalesce', 'enrich',
]

export const VALUE_EXPRESSION_COMPLETIONS: SourceLanguageCompletion[] = [
  { label: 'get', kind: 'function', insertText: `get('path')`, detail: 'Selector: читает путь текущего значения' },
  { label: 'match', kind: 'function', insertText: 'match({})', detail: 'Predicate: сопоставляет поля объекта' },
  { label: 'eq', kind: 'function', insertText: 'eq(get(\'path\'), value)', detail: 'Predicate: строгое равенство' },
  { label: 'and', kind: 'function', insertText: 'and()', detail: 'Predicate: логическое И' },
  { label: 'or', kind: 'function', insertText: 'or()', detail: 'Predicate: логическое ИЛИ' },
  { label: 'leftJoin', kind: 'function', insertText: `leftJoin(left, right).by('id')`, detail: 'Left join двух коллекций' },
  { label: 'fullJoin', kind: 'function', insertText: `fullJoin(left, right).byAny('id')`, detail: 'Full join двух коллекций' },
  { label: 'lookupOne', kind: 'function', insertText: `lookupOne(source).by('foreignId')`, detail: 'Одна связанная запись по id текущего объекта' },
  { label: 'lookupMany', kind: 'function', insertText: `lookupMany(source).by('foreignId')`, detail: 'Все связанные записи по id текущего объекта' },
  ...VALUE_EXPRESSION_METHOD_NAMES.map(name => ({
    label: `.${name}`,
    kind: 'function' as const,
    insertText: `.${name}()`,
    detail: 'Общий immutable ValueExpression method',
  })),
]
