import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/domain/types/source/source-engine.types'

import { compileConfigurationSource } from '@/model/services/source-engine/compilers/configuration-source-compile'
import { typeReferenceHighlights } from '@/model/services/source-engine/source-document-reference'
import { createTypeScriptLikeSourceSyntax } from '@/model/services/source-engine/source-language-syntax'
import { CONFIGURATION_DEFAULT_SOURCE } from '@/model/services/source-engine/templates/configuration.default.source'
import { collectConfigurationTypeSourceReferences, resolveConfigurationTypeSourceReference } from '@/model/services/source-engine/type-source-references'

const CONFIGURATION_COMPLETIONS: SourceLanguageCompletion[] = [
  { label: 'defineConfig', kind: 'snippet', insertText: CONFIGURATION_DEFAULT_SOURCE.trimEnd(), detail: 'Configuration category' },
  { label: 'value', kind: 'snippet', insertText: `value(String, '')`, detail: 'Typed configuration value' },
  { label: 'TriggerSet', kind: 'value', insertText: 'TriggerSet', detail: 'Interaction trigger array' },
  { label: 'JSON', kind: 'value', insertText: 'JSON', detail: 'Any JSON value' },
  { label: 'label', kind: 'function', insertText: `.label('')`, detail: 'Editor label' },
  { label: 'description', kind: 'function', insertText: `.description('')`, detail: 'Editor description' },
  { label: 'min', kind: 'function', insertText: '.min(0)', detail: 'Minimum Number value' },
  { label: 'max', kind: 'function', insertText: '.max(100)', detail: 'Maximum Number value' },
  { label: 'step', kind: 'function', insertText: '.step(1)', detail: 'Number editor step' },
]

export class ConfigurationSourceLanguageStrategy implements SourceLanguageStrategy {
  readonly id = 'source-language:configuration'
  readonly sourceKind: SourceKind = 'configuration'
  readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Configuration Source',
    extension: '.endge-config.ts',
    keywords: ['defineConfig', 'value', 'objectOf', 'recordOf', 'enumOf', 'unionOf', 'arrayOf'],
    functions: ['label', 'description', 'min', 'max', 'step'],
  })

  supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  createDefaultSource(): string {
    return CONFIGURATION_DEFAULT_SOURCE
  }

  validate(source: string, context?: SourceLanguageContext): SourceLanguageValidationResult {
    const catalog = (context?.typeSymbols ?? []).map((symbol, index) => ({
      id: index,
      identity: symbol.identity,
      displayName: symbol.displayName ?? symbol.identity,
      category: symbol.category ?? 'user',
      sourceVersion: 1,
      definition: symbol.definition ?? null,
      entityReference: symbol.entityReference,
      status: 'valid' as const,
    }))
    const result = compileConfigurationSource(source, catalog)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Configuration source contains validation errors.' }
  }

  completions(context: SourceLanguageContext): SourceLanguageCompletion[] {
    const types = (context.typeSymbols ?? []).map<SourceLanguageCompletion>(item => ({
      label: item.identity,
      kind: 'value',
      insertText: item.identity,
      detail: `${item.category ?? 'user'} configuration type`,
      documentation: item.displayName,
    }))
    return [...CONFIGURATION_COMPLETIONS, ...types]
  }

  resolveReference(context: SourceLanguageContext) {
    return resolveConfigurationTypeSourceReference(context)
  }

  semanticHighlights(context: SourceLanguageContext) {
    return typeReferenceHighlights(context, collectConfigurationTypeSourceReferences(context.source))
  }
}
