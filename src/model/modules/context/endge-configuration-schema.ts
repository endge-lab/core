import type { EndgeConfigurationValues } from '@/domain/types/configuration/configuration.type'
import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'
import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type { EndgeConfigurationSchemaEntry, EndgeJSONValue } from '@/domain/types/source/configuration-source.types'
import type { TypeProgramCatalogEntry } from '@/domain/types/source/type-source.types'

import { validateConfigurationValue } from '@/domain/configuration/configuration-value'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Endge } from '@/model/kernel/endge'
import { compileConfigurationSource } from '@/model/services/source-engine/compilers/configuration-source-compile'
import { compileTypeSource } from '@/model/services/source-engine/compilers/type-source-compile'

const PUBLIC_SYSTEM_KEYS = new Set([
  'vars',
  'locales',
  'defaultLocale',
  'fallbackLocale',
  'themes',
  'defaultTheme',
  'timezones',
  'defaultTimezone',
  'defaultAuthProfileIdentity',
  'sfcAdapterIds',
  'defaultSfcAdapterId',
  'sfcEditing',
  'tooltips',
  'diagnostics',
  'values',
  '__proto__',
  'prototype',
  'constructor',
])

/** Compiles Configuration schemas before effective context resolution. */
export class EndgeConfigurationSchemaModule extends EndgeModule {
  private _entries: EndgeConfigurationSchemaEntry[] = []
  private _types: TypeProgramCatalogEntry[] = []
  private _valueDiagnostics = new Map<string, Omit<ProgramDiagnostic, 'entityRef'>[]>()

  override build(_ctx: EndgeBootContext): void {
    this._types = buildEarlyTypeCatalog()
    this._entries = Endge.domain.getConfigurations()
      .filter(item => item.deletedAt == null && item.active !== false)
      .sort((left, right) => (left.displayName || left.identity).localeCompare(right.displayName || right.identity) || left.identity.localeCompare(right.identity))
      .map((entity) => {
        const diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[] = []
        if (PUBLIC_SYSTEM_KEYS.has(entity.identity)) {
          diagnostics.push({
            severity: 'error',
            code: 'configuration-identity-reserved',
            message: `Configuration identity "${entity.identity}" conflicts with a public system configuration key.`,
            sourcePath: 'identity',
          })
        }
        if (entity.sourceVersion !== 1) {
          diagnostics.push({
            severity: 'error',
            code: 'configuration-source-version-invalid',
            message: 'Configuration sourceVersion must be 1.',
            sourcePath: 'sourceVersion',
          })
        }
        const result = compileConfigurationSource(entity.source, this._types)
        diagnostics.push(...result.diagnostics)
        return {
          id: entity.id,
          identity: entity.identity,
          displayName: entity.displayName || entity.name || entity.identity,
          description: entity.description,
          sourceVersion: entity.sourceVersion,
          document: diagnostics.some(item => item.severity === 'error') ? null : result.document,
          diagnostics,
          status: diagnostics.some(item => item.severity === 'error') ? 'error' as const : diagnostics.length ? 'warning' as const : 'valid' as const,
        }
      })
    this.notify()
  }

  override reset(): void {
    this._entries = []
    this._types = []
    this._valueDiagnostics.clear()
    this.notify()
  }

  list(): EndgeConfigurationSchemaEntry[] {
    return this._entries.map(entry => this._withValueDiagnostics(entry))
  }

  get(identity: string): EndgeConfigurationSchemaEntry | null {
    const entry = this._entries.find(item => item.identity === identity)
    return entry ? this._withValueDiagnostics(entry) : null
  }

  get typeCatalog(): TypeProgramCatalogEntry[] {
    return [...this._types]
  }

  get errors(): Array<{ identity: string, diagnostic: Omit<ProgramDiagnostic, 'entityRef'> }> {
    return this.list().flatMap(entry => entry.diagnostics
      .filter(diagnostic => diagnostic.severity === 'error')
      .map(diagnostic => ({ identity: entry.identity, diagnostic })))
  }

  /** Applies defaults, ignores stale keys and records incompatible active values for Compiler Problems. */
  resolveValues(input: EndgeConfigurationValues): EndgeConfigurationValues {
    const result: EndgeConfigurationValues = {}
    this._valueDiagnostics.clear()
    for (const entry of this._entries) {
      if (!entry.document) {
        continue
      }
      const category: Record<string, EndgeJSONValue> = {}
      const persisted = input[entry.identity] ?? {}
      const activeFieldKeys = new Set(entry.document.values.map(field => field.key))
      for (const field of entry.document.values) {
        const value = Object.hasOwn(persisted, field.key)
          ? persisted[field.key]
          : field.defaultValue
        const validation = validateConfigurationValue(field.type, value, this._types, `${entry.identity}.${field.key}`)
        if (!validation.ok) {
          this._valueDiagnostics.set(entry.identity, [
            ...(this._valueDiagnostics.get(entry.identity) ?? []),
            ...validation.diagnostics,
          ])
          category[field.key] = clone(value)
          continue
        }
        category[field.key] = clone(value)
      }
      const staleDiagnostics = Object.keys(persisted)
        .filter(key => !activeFieldKeys.has(key))
        .map(key => ({
          severity: 'warning' as const,
          code: 'configuration-value-stale',
          message: `Configuration value "${entry.identity}.${key}" is not declared by the active source and is ignored until that field is restored.`,
          sourcePath: `${entry.identity}.${key}`,
        }))
      if (staleDiagnostics.length) {
        this._valueDiagnostics.set(entry.identity, [
          ...(this._valueDiagnostics.get(entry.identity) ?? []),
          ...staleDiagnostics,
        ])
      }
      result[entry.identity] = category
    }
    return result
  }

  private _withValueDiagnostics(entry: EndgeConfigurationSchemaEntry): EndgeConfigurationSchemaEntry {
    const diagnostics = [...entry.diagnostics, ...(this._valueDiagnostics.get(entry.identity) ?? [])]
    return {
      ...entry,
      diagnostics,
      status: diagnostics.some(item => item.severity === 'error') ? 'error' : diagnostics.length ? 'warning' : 'valid',
    }
  }
}

function buildEarlyTypeCatalog(): TypeProgramCatalogEntry[] {
  return Endge.types.listResolved().map((type, index) => {
    const primitiveKind = String(type.meta?.primitiveKind ?? '').trim()
    const category: TypeProgramCatalogEntry['category'] = primitiveKind === 'reference'
      ? 'reference'
      : type.isPrimitive ? 'primitive' : 'user'
    const compiled = type.isPrimitive || category === 'reference'
      ? null
      : compileTypeSource(type.source, type.sourceVersion)
    const diagnostics = compiled?.diagnostics ?? []
    return {
      id: type.id ?? index,
      identity: type.identity,
      displayName: type.displayName || type.name || type.identity,
      category,
      sourceVersion: Number(type.sourceVersion ?? 1) || 1,
      definition: compiled?.document?.definition ?? null,
      runtimeType: type.isPrimitive ? String(type.meta?.runtimeType ?? type.identity) : undefined,
      entityReference: category === 'reference'
        ? { target: String(type.meta?.target ?? ''), storage: type.meta?.storage === 'identity' ? 'identity' : 'id' }
        : undefined,
      status: diagnostics.some(item => item.severity === 'error') ? 'error' : diagnostics.length ? 'warning' : 'valid',
    }
  })
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
