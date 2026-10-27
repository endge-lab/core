import type { RComponentSFC_IR_Tag } from '@/features/core/modules/domain/types/component/sfc/ir.types'

const SFC_TAGS = [
  'Text',
  'DateTime',
  'Number',
  'Icon',
  'Badge',
  'Dot',
  'Box',
  'Flex',
  'Grid',
  'Divider',
  'Input',
  'Textarea',
  'Checkbox',
  'Select',
  'Tooltip',
  'TooltipTrigger',
  'TooltipContent',
  'Component',
  'Table',
  'Column',
  'Cell',
  'ColumnMenu',
  'CellMenu',
  'RowMenu',
  'MenuItem',
  'MenuSeparator',
  'Editable',
  'Variant',
] as const satisfies readonly RComponentSFC_IR_Tag[]

const stringArray = { type: 'array', items: { type: 'string' } } as const

/**
 * JSON Schema (draft 2020-12) формата `endge-ui/v1`: снимок и патч.
 * `$defs.snapshot` и `$defs.patch` — корневые формы; корень схемы принимает любую из них.
 */
export const ENDGE_UI_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://endge.dev/schemas/endge-ui/v1.json',
  title: 'Endge JSON UI endge-ui/v1',
  oneOf: [{ $ref: '#/$defs/snapshot' }, { $ref: '#/$defs/patch' }],
  $defs: {
    json: {},
    marker: {
      type: 'object',
      required: ['code', 'severity', 'message'],
      additionalProperties: false,
      properties: {
        code: { type: 'string' },
        severity: { enum: ['info', 'warning', 'error'] },
        message: { type: 'string' },
      },
    },
    menu: {
      type: 'object',
      required: ['items'],
      additionalProperties: false,
      properties: {
        items: {
          type: 'array',
          items: {
            oneOf: [
              {
                type: 'object',
                required: ['kind', 'id', 'label', 'action'],
                additionalProperties: false,
                properties: {
                  kind: { const: 'item' },
                  id: { type: 'string' },
                  label: { type: 'string' },
                  action: { type: 'string' },
                  icon: { type: 'string' },
                  disabled: { type: 'boolean' },
                },
              },
              {
                type: 'object',
                required: ['kind', 'id'],
                additionalProperties: false,
                properties: { kind: { const: 'separator' }, id: { type: 'string' } },
              },
            ],
          },
        },
      },
    },
    editable: {
      type: 'object',
      required: ['active', 'value', 'triggers'],
      additionalProperties: false,
      properties: {
        active: { type: 'boolean' },
        value: { $ref: '#/$defs/json' },
        draft: { $ref: '#/$defs/json' },
        triggers: { type: 'array' },
      },
    },
    table: {
      type: 'object',
      required: ['rowKey', 'columns', 'rowCount', 'offset', 'limit'],
      additionalProperties: false,
      properties: {
        rowKey: { type: 'string' },
        rowCount: { type: 'integer', minimum: 0 },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1 },
        columns: {
          type: 'array',
          items: {
            type: 'object',
            required: ['key', 'title'],
            additionalProperties: false,
            properties: {
              key: { type: 'string' },
              title: { type: 'string' },
              width: { type: 'number' },
              align: { type: 'string' },
              sortable: { type: 'boolean' },
              menu: { $ref: '#/$defs/menu' },
            },
          },
        },
      },
    },
    node: {
      type: 'object',
      required: ['id', 'type', 'props', 'children'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        type: { enum: [...SFC_TAGS, '#text', '#row', '#cell'] },
        props: { type: 'object' },
        children: { type: 'array', items: { $ref: '#/$defs/node' } },
        text: { type: 'string' },
        events: stringArray,
        classes: stringArray,
        states: stringArray,
        parts: stringArray,
        style: { type: 'object', additionalProperties: { type: 'string' } },
        component: { type: 'string' },
        editable: { $ref: '#/$defs/editable' },
        table: { $ref: '#/$defs/table' },
        menu: { $ref: '#/$defs/menu' },
        markers: { type: 'array', items: { $ref: '#/$defs/marker' } },
      },
    },
    snapshot: {
      type: 'object',
      required: ['format', 'revision', 'component', 'roots'],
      additionalProperties: false,
      properties: {
        format: { const: 'endge-ui/v1' },
        revision: { type: 'integer', minimum: 1 },
        component: { type: ['string', 'null'] },
        roots: { type: 'array', items: { $ref: '#/$defs/node' } },
        markers: { type: 'array', items: { $ref: '#/$defs/marker' } },
      },
    },
    patchOperation: {
      oneOf: [
        {
          type: 'object',
          required: ['op', 'id'],
          additionalProperties: false,
          properties: {
            op: { const: 'update' },
            id: { type: 'string' },
            set: { type: 'object' },
            unset: stringArray,
          },
        },
        {
          type: 'object',
          required: ['op', 'id', 'children'],
          additionalProperties: false,
          properties: {
            op: { const: 'children' },
            id: { type: ['string', 'null'] },
            children: {
              type: 'array',
              items: {
                oneOf: [
                  { $ref: '#/$defs/node' },
                  { type: 'object', required: ['ref'], additionalProperties: false, properties: { ref: { type: 'string' } } },
                ],
              },
            },
          },
        },
        {
          type: 'object',
          required: ['op', 'id', 'node'],
          additionalProperties: false,
          properties: { op: { const: 'replace' }, id: { type: 'string' }, node: { $ref: '#/$defs/node' } },
        },
        {
          type: 'object',
          required: ['op', 'markers'],
          additionalProperties: false,
          properties: { op: { const: 'markers' }, markers: { type: 'array', items: { $ref: '#/$defs/marker' } } },
        },
      ],
    },
    patch: {
      type: 'object',
      required: ['format', 'baseRevision', 'revision', 'ops'],
      additionalProperties: false,
      properties: {
        format: { const: 'endge-ui/v1' },
        baseRevision: { type: 'integer', minimum: 1 },
        revision: { type: 'integer', minimum: 1 },
        ops: { type: 'array', items: { $ref: '#/$defs/patchOperation' } },
      },
    },
  },
} as const

export interface EndgeUIJsonSchemaIssue {
  path: string
  message: string
}

type SchemaNode = Record<string, unknown>

/**
 * Проверяет значение по `ENDGE_UI_JSON_SCHEMA` (подмножество draft 2020-12, которое
 * использует эта схема: type, enum, const, required, properties, additionalProperties,
 * items, oneOf, $ref, minimum, minLength). Полноценный валидатор host может заменить на Ajv.
 */
export function validateEndgeUIJson(value: unknown, form: 'snapshot' | 'patch' | 'any' = 'any'): EndgeUIJsonSchemaIssue[] {
  const root = form === 'any' ? ENDGE_UI_JSON_SCHEMA : { $ref: `#/$defs/${form}` }
  const issues: EndgeUIJsonSchemaIssue[] = []
  validate(value, root as SchemaNode, '$', issues)
  return issues
}

function resolveRef(ref: string): SchemaNode {
  const name = /^#\/\$defs\/(\w+)$/.exec(ref)?.[1]
  const resolved = name ? (ENDGE_UI_JSON_SCHEMA.$defs as Record<string, unknown>)[name] : undefined
  if (!resolved) {
    throw new Error(`[EndgeUI] Unknown schema reference: ${ref}`)
  }
  return resolved as SchemaNode
}

function typeOf(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number'
  }
  return typeof value
}

function matchesType(value: unknown, expected: unknown): boolean {
  const actual = typeOf(value)
  return (Array.isArray(expected) ? expected : [expected]).some(type => type === actual || (type === 'number' && actual === 'integer'))
}

function validate(value: unknown, schema: SchemaNode, path: string, issues: EndgeUIJsonSchemaIssue[]): void {
  if (typeof schema.$ref === 'string') {
    validate(value, resolveRef(schema.$ref), path, issues)
    return
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => {
      const nested: EndgeUIJsonSchemaIssue[] = []
      validate(value, candidate as SchemaNode, path, nested)
      return nested.length === 0
    }).length
    if (matches !== 1) {
      issues.push({ path, message: `must match exactly one schema in oneOf (matched ${matches})` })
    }
  }
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    issues.push({ path, message: `must be ${JSON.stringify(schema.type)}` })
    return
  }
  if ('const' in schema && value !== schema.const) {
    issues.push({ path, message: `must be ${JSON.stringify(schema.const)}` })
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    issues.push({ path, message: 'must be one of the allowed values' })
  }
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    issues.push({ path, message: `must be >= ${schema.minimum}` })
  }
  if (typeof schema.minLength === 'number' && typeof value === 'string' && value.length < schema.minLength) {
    issues.push({ path, message: `must have length >= ${schema.minLength}` })
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validate(item, schema.items as SchemaNode, `${path}[${index}]`, issues))
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!Object.hasOwn(record, key)) {
        issues.push({ path, message: `must have required property "${key}"` })
      }
    }
    const properties = (schema.properties ?? {}) as Record<string, SchemaNode>
    for (const [key, item] of Object.entries(record)) {
      if (properties[key]) {
        validate(item, properties[key], `${path}.${key}`, issues)
      }
      else if (schema.additionalProperties === false) {
        issues.push({ path, message: `must not have additional property "${key}"` })
      }
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validate(item, schema.additionalProperties as SchemaNode, `${path}.${key}`, issues)
      }
    }
  }
}
