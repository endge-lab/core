import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/features/core/modules/source/domain/types/source-engine.types'

import { collectTypeDefinitionReferences, validateTypeDefinitionReferences } from '@/features/core/modules/compiler/services/type/type-program-validation'
import { compileTypeSource } from '@/features/core/modules/source/services/compilers/type-source-compile'
import { typeReferenceHighlights } from '@/features/core/modules/source/services/source-document-reference'
import { createTypeScriptLikeSourceSyntax } from '@/features/core/modules/source/services/source-language-syntax'
import { collectTypeSourceReferences, normalizeTypeSourceReferences, resolveTypeSourceReference } from '@/features/core/modules/source/services/type-source-references'
import { serializeTypeSourceReference } from '@/features/core/modules/source/services/type-source-serialize'
import { TYPE_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/type.default.source'

const TYPE_COMPLETIONS: SourceLanguageCompletion[] = [
  { label: 'defineType.object', kind: 'snippet', insertText: TYPE_DEFAULT_SOURCE.trimEnd(), detail: 'Object Type source' },
  { label: 'defineType.enum', kind: 'snippet', insertText: `defineType(enumOf([\n  'draft',\n  'active',\n]))`, detail: 'Enum Type source' },
  { label: 'defineType.union', kind: 'snippet', insertText: `defineType(unionOf(\n  FirstType,\n  SecondType,\n))`, detail: 'Union Type source' },
  { label: 'defineType.array', kind: 'snippet', insertText: `defineType(arrayOf(\n  ItemType,\n))`, detail: 'Array Type source' },
  { label: 'field', kind: 'function', insertText: `field(String)`, detail: 'Object field type' },
  {
    label: 'field.object',
    kind: 'snippet',
    insertText: `field(objectOf({
  property: field(String),
}))`,
    detail: 'Anonymous inline object field',
  },
  {
    label: 'objectOf',
    kind: 'function',
    insertText: `objectOf({
  property: field(String),
})`,
    detail: 'Anonymous inline object type expression',
  },
  {
    label: 'recordOf',
    kind: 'function',
    insertText: `recordOf(objectOf({
  property: field(String),
}))`,
    detail: 'String-keyed dictionary type expression',
  },
  { label: 'description', kind: 'function', insertText: `.description('')`, detail: 'Field description' },
  { label: 'optional', kind: 'function', insertText: `.optional()`, detail: 'Optional field' },
  { label: 'array', kind: 'function', insertText: `.array()`, detail: 'Array field' },
  { label: 'min', kind: 'function', insertText: `.min(0)`, detail: 'Minimum Number value' },
  { label: 'max', kind: 'function', insertText: `.max(1)`, detail: 'Maximum Number value' },
  { label: 'example', kind: 'function', insertText: `.example(null)`, detail: 'Static JSON example' },
]

export class TypeSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:type'
  public readonly sourceKind: SourceKind = 'type'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Type Source',
    extension: '.endge-type.ts',
    keywords: ['defineType', 'objectOf', 'recordOf', 'enumOf', 'unionOf', 'arrayOf'],
    functions: ['field', 'type', 'description', 'min', 'max', 'example', 'array', 'optional'],
  })

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public createDefaultSource(): string {
    return TYPE_DEFAULT_SOURCE
  }

  public normalize(source: string): string {
    return normalizeTypeSourceReferences(source)
  }

  public validate(source: string, context?: SourceLanguageContext): SourceLanguageValidationResult {
    const result = compileTypeSource(source)
    const symbols = context?.typeSymbols
    const registryDiagnostics = symbols
      ? validateTypeDefinitionReferences(
          result.document?.definition ?? null,
          new Set(symbols.map(item => item.identity)),
        )
      : []
    const diagnosticIdentities = symbols
      ? collectTypeDefinitionReferences(result.document?.definition ?? null)
          .filter(identity => identity === 'Any' || !symbols.some(symbol => symbol.identity === identity))
      : []
    const references = collectTypeSourceReferences(source)
    const diagnostics = [
      ...result.diagnostics,
      ...registryDiagnostics.map((item, index) => {
        const reference = references.find(candidate => candidate.identity === diagnosticIdentities[index])
        return reference ? { ...item, ...reference.range } : item
      }),
    ]
    const ok = !diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics, message: ok ? undefined : 'Type source contains validation errors.' }
  }

  public completions(context: SourceLanguageContext): SourceLanguageCompletion[] {
    const known = new Set(TYPE_COMPLETIONS.map(item => item.label))
    const symbols = (context.typeSymbols ?? [])
      .filter(item => item.identity !== context.ownerIdentity && !known.has(item.identity))
      .map<SourceLanguageCompletion>(item => ({
        label: item.identity,
        kind: 'value',
        insertText: serializeTypeSourceReference(item.identity),
        detail: `${item.category ?? 'user'} type`,
        documentation: item.displayName && item.displayName !== item.identity ? item.displayName : undefined,
      }))
    return [...TYPE_COMPLETIONS, ...symbols]
  }

  public resolveReference(context: SourceLanguageContext) {
    return resolveTypeSourceReference(context)
  }

  public semanticHighlights(context: SourceLanguageContext) {
    return typeReferenceHighlights(context, collectTypeSourceReferences(context.source))
  }
}
