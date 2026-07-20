import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/domain/types/source/source-engine.types'

import { compileTypeSource } from '@/model/services/source-engine/compilers/type-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/model/services/source-engine/source-language-syntax'
import { resolveSourceDocumentReference } from '@/model/services/source-engine/source-document-reference'
import { TYPE_DEFAULT_SOURCE } from '@/model/services/source-engine/templates/type.default.source'

export class TypeSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:type'
  public readonly sourceKind: SourceKind = 'type'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Type Source',
    extension: '.endge-type.ts',
    keywords: ['defineType', 'objectOf', 'enumOf', 'unionOf', 'arrayOf'],
    functions: ['field', 'type', 'description', 'min', 'max', 'example', 'array', 'optional'],
  })

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public createDefaultSource(): string {
    return TYPE_DEFAULT_SOURCE
  }

  public validate(source: string): SourceLanguageValidationResult {
    const result = compileTypeSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Type source contains validation errors.' }
  }

  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return TYPE_COMPLETIONS
  }

  public resolveReference(context: SourceLanguageContext) {
    return resolveSourceDocumentReference(context, {
      functions: {
        field: 'type',
        type: 'type',
      },
    })
  }
}

const TYPE_COMPLETIONS: SourceLanguageCompletion[] = [
  { label: 'defineType.object', kind: 'snippet', insertText: TYPE_DEFAULT_SOURCE.trimEnd(), detail: 'Object Type source' },
  { label: 'defineType.enum', kind: 'snippet', insertText: `defineType(enumOf([\n  'draft',\n  'active',\n]))`, detail: 'Enum Type source' },
  { label: 'defineType.union', kind: 'snippet', insertText: `defineType(unionOf(\n  type('FirstType'),\n  type('SecondType'),\n))`, detail: 'Union Type source' },
  { label: 'defineType.array', kind: 'snippet', insertText: `defineType(arrayOf(\n  type('ItemType'),\n))`, detail: 'Array Type source' },
  { label: 'field', kind: 'function', insertText: `field('String')`, detail: 'Object field type' },
  {
    label: 'field.object',
    kind: 'snippet',
    insertText: `field(objectOf({
  property: field('String'),
}))`,
    detail: 'Anonymous inline object field',
  },
  {
    label: 'objectOf',
    kind: 'function',
    insertText: `objectOf({
  property: field('String'),
})`,
    detail: 'Anonymous inline object type expression',
  },
  { label: 'description', kind: 'function', insertText: `.description('')`, detail: 'Field description' },
  { label: 'optional', kind: 'function', insertText: `.optional()`, detail: 'Optional field' },
  { label: 'array', kind: 'function', insertText: `.array()`, detail: 'Array field' },
  { label: 'min', kind: 'function', insertText: `.min(0)`, detail: 'Minimum Number value' },
  { label: 'max', kind: 'function', insertText: `.max(1)`, detail: 'Maximum Number value' },
  { label: 'example', kind: 'function', insertText: `.example(null)`, detail: 'Static JSON example' },
]
