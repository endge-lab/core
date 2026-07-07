import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { RField } from '@/domain/entities/reflect/RField'
import type {
  QuerySourceDocument,
  QuerySourceField,
  QuerySourceFilterItem,
  QuerySourceGenerateResult,
} from '@/domain/types/query-source.types'

type LegacyQueryFields = RQuery & {
  method?: string
  headers?: unknown
  timeoutMs?: number
  sendAsFormUrlencoded?: boolean
}

/** Генерирует query source v1 из текущих persisted/legacy полей RQuery. */
export function generateQuerySource(query: RQuery): QuerySourceGenerateResult {
  const document = createQuerySourceDocument(query)

  return {
    document,
    source: printQuerySourceDocument(document),
  }
}

/** Создает canonical QuerySourceDocument из persisted/legacy RQuery. */
export function createQuerySourceDocument(query: RQuery): QuerySourceDocument {
  const legacy = query as LegacyQueryFields

  return {
    kind: 'rest',
    request: {
      endpoint: String(query.endpoint ?? ''),
      path: String(query.query ?? ''),
      method: String(legacy.method ?? 'POST'),
      headers: normalizeHeaders(legacy.headers),
      auth: query.auth ?? { mode: 'token' },
      timeoutMs: typeof legacy.timeoutMs === 'number' ? legacy.timeoutMs : undefined,
      formUrlencoded: legacy.sendAsFormUrlencoded ? true : undefined,
    },
    params: fieldsMapToRecord(query.params),
    filters: {
      mode: query.filterMode ?? 'merge',
      items: query.filters.map(filter => {
        if (filter.mode === 'reference') {
          return {
            mode: 'reference',
            filterId: String(filter.filterId ?? ''),
          }
        }

        return {
          mode: 'inline',
          value: parseInlineFilter(filter.inlineJson),
        }
      }),
    },
    response: {
      subField: query.subField ?? 'items',
      return: fieldToDocument(query.returnField),
    },
    mock: {
      enabled: Boolean(query.mockDataEnabled),
      data: parseMockData(query.mockData),
    },
  }
}

/** Печатает canonical QuerySourceDocument в стабильный source v1. */
export function printQuerySourceDocument(document: QuerySourceDocument): string {
  const requestEntries: Array<[string, string]> = [
    ['endpoint', printStringOrVar(document.request.endpoint)],
    ['path', printStringOrVar(document.request.path)],
    ['method', printValue(document.request.method)],
    ['headers', printValue(document.request.headers, 2)],
    ['auth', printValue(document.request.auth, 2)],
  ]

  if (typeof document.request.timeoutMs === 'number')
    requestEntries.push(['timeoutMs', printValue(document.request.timeoutMs)])
  if (document.request.formUrlencoded)
    requestEntries.push(['formUrlencoded', 'true'])

  return `defineQuery({
  kind: 'rest',

  request: ${printObjectEntries(requestEntries, 1)},

  params: ${printFieldRecord(document.params, 1)},

  filters: {
    mode: ${printValue(document.filters.mode)},
    items: ${printFilterItems(document.filters.items, 2)},
  },

  response: {
    subField: ${printValue(document.response.subField)},
    return: ${document.response.return ? printField(document.response.return) : 'null'},
  },

  mock: {
    enabled: ${document.mock.enabled ? 'true' : 'false'},
    data: ${printValue(document.mock.data, 2)},
  },
})
`
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers))
    return {}

  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers))
    out[key] = String(value)

  return out
}

function fieldsMapToRecord(params: Map<string, RField> | undefined): Record<string, QuerySourceField> {
  const out: Record<string, QuerySourceField> = {}
  for (const [name, field] of params ?? new Map<string, RField>())
    out[name] = fieldToDocument(field) ?? { type: 'Unknown' }

  return out
}

function fieldToDocument(field: RField | undefined): QuerySourceField | null {
  if (!field)
    return null
  const type = String(field.type ?? '').trim()
  if (!type)
    return null

  const params: Record<string, QuerySourceField> = {}
  for (const [name, param] of field.params ?? new Map<string, RField>()) {
    const next = fieldToDocument(param)
    if (next)
      params[name] = next
  }

  return {
    type,
    isArray: field.isArray || undefined,
    optional: field.optional || undefined,
    params: Object.keys(params).length ? params : undefined,
  }
}

function parseInlineFilter(raw: string | null): Record<string, unknown> {
  if (!raw)
    return {}

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  }
  catch {
    return {}
  }
}

function parseMockData(raw: unknown): unknown {
  if (typeof raw !== 'string')
    return raw ?? null

  try {
    return JSON.parse(raw)
  }
  catch {
    return raw
  }
}

function printFilterItems(items: QuerySourceFilterItem[], depth: number): string {
  if (!items.length)
    return '[]'

  const indent = '  '.repeat(depth)
  const childIndent = '  '.repeat(depth + 1)
  const lines = items.map(item => {
    if (item.mode === 'reference')
      return `${childIndent}filter.reference(${printValue(item.filterId)}),`

    return `${childIndent}filter.inline(${printValue(item.value, depth + 1)}),`
  })

  return `[\n${lines.join('\n')}\n${indent}]`
}

function printFieldRecord(fields: Record<string, QuerySourceField>, depth: number): string {
  const entries = Object.entries(fields)
  if (!entries.length)
    return '{}'

  const indent = '  '.repeat(depth)
  const childIndent = '  '.repeat(depth + 1)
  const lines = entries.map(([key, value]) => `${childIndent}${printKey(key)}: ${printField(value)},`)
  return `{\n${lines.join('\n')}\n${indent}}`
}

function printField(field: QuerySourceField): string {
  let out = `field(${printValue(field.type)})`
  if (field.isArray)
    out += '.array()'
  if (field.optional)
    out += '.optional()'
  if (field.params && Object.keys(field.params).length)
    out += `.params(${printFieldRecord(field.params, 0)})`

  return out
}

function printObjectEntries(entries: Array<[string, string]>, depth: number): string {
  const indent = '  '.repeat(depth)
  const childIndent = '  '.repeat(depth + 1)
  const lines = entries.map(([key, value]) => `${childIndent}${printKey(key)}: ${value},`)
  return `{\n${lines.join('\n')}\n${indent}}`
}

function printValue(value: unknown, depth = 0): string {
  if (value === undefined)
    return 'undefined'
  if (value === null)
    return 'null'
  if (typeof value === 'string')
    return quote(value)
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (Array.isArray(value))
    return printArray(value, depth)
  if (typeof value === 'object')
    return printPlainObject(value as Record<string, unknown>, depth)

  return quote(String(value))
}

function printArray(value: unknown[], depth: number): string {
  if (!value.length)
    return '[]'

  const indent = '  '.repeat(depth)
  const childIndent = '  '.repeat(depth + 1)
  const lines = value.map(item => `${childIndent}${printValue(item, depth + 1)},`)
  return `[\n${lines.join('\n')}\n${indent}]`
}

function printPlainObject(value: Record<string, unknown>, depth: number): string {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined)
  if (!entries.length)
    return '{}'

  const indent = '  '.repeat(depth)
  const childIndent = '  '.repeat(depth + 1)
  const lines = entries.map(([key, item]) => `${childIndent}${printKey(key)}: ${printValue(item, depth + 1)},`)
  return `{\n${lines.join('\n')}\n${indent}}`
}

function printStringOrVar(value: string): string {
  const match = value.match(/^\{([^{}'"]+)\}$/)
  return match ? `env(${quote(match[1])})` : quote(value)
}

function printKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key)
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
}
