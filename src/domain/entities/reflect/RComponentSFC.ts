import { Expose } from 'class-transformer'

import { type DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { RComponentCore } from '@/domain/entities/reflect/RComponentCore'
import { serializeSFCSourceParts } from '@/model/services/compiler/component-sfc/component-sfc-source-parts'
import type { RComponentRenderTarget } from '@/domain/types/component/component-core.types'
import type { RComponentSFCSource_Parts } from '@/domain/types/component/sfc'
import { ComponentType } from '@/domain/types/document/document.types'

/**
 * Новый SFC-компонент Endge.
 *
 * Это persisted source-first модель. Она не содержит runtime-представления:
 * sourceParts, diagnostics, AST и IR вычисляются runtime-host.
 */
export class RComponentSFC extends RComponentCore {
  /** Внутренний маркер SFC-компонента новой ветки. */
  @Expose()
  override kind: string = 'component-sfc'

  /** Тип доменного документа и Payload documentType. */
  @Expose()
  type: ComponentType.SFC = ComponentType.SFC

  /** Canonical .endge source: script/template/style в одном тексте. */
  @Expose()
  source: string = ''

  /** Опциональный пользовательский tag для прямого вызова компонента из SFC template. */
  @Expose()
  tag: string | null = null

  constructor() {
    super()
    this.sourceKind = 'component-sfc'
    this.supportedTargets = ['dom', 'canvas']
  }

  /** Возвращает canonical source компонента. */
  override getSource(): string {
    return this.source
  }

  /** Обновляет canonical source без изменения runtime-derived состояния. */
  setSource(source: string): void {
    this.source = source ?? ''
  }

  /** Собирает persisted source из вкладок редактора. */
  setSourceParts(parts: RComponentSFCSource_Parts): void {
    this.source = serializeSFCSourceParts(parts)
  }

  /** Создает копию SFC-компонента как новый доменный документ. */
  override duplicate(options: DuplicateOptions): RComponentSFC {
    const copy = new RComponentSFC()
    this.copyCoreFieldsTo(copy)
    copy.id = undefined as unknown as number
    copy.identity = options.identity
    copy.name = options.name ?? this.name
    copy.displayName = options.name ?? this.displayName
    copy.folderId = null
    copy.source = this.source
    copy.tag = null
    return copy
  }

  /** Возвращает plain-форму для domain dump/export. */
  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName,
      description: this.description,
      folderId: this.folderId ?? null,
      isSystem: this.isSystem,
      inherited: this.inherited,
      meta: { ...this.meta },
      kind: this.kind,
      type: this.type,
      sourceKind: this.sourceKind,
      modelVersion: this.modelVersion,
      supportedTargets: [...this.supportedTargets],
      source: this.source,
      tag: this.tag,
    }
  }

  /** Восстанавливает SFC-компонент из plain schema или Payload-normalized объекта. */
  static fromPlain(raw: any): RComponentSFC {
    const component = new RComponentSFC()
    const sourceParts = raw?.sourceParts as RComponentSFCSource_Parts | undefined

    component.id = raw?.id
    component.identity = String(raw?.identity ?? '')
    component.displayName = String(raw?.displayName ?? raw?.name ?? raw?.identity ?? '')
    component.name = String(raw?.name ?? component.displayName)
    component.description = raw?.description ?? null
    component.folderId = raw?.folderId ?? raw?.folder ?? null
    component.isSystem = Boolean(raw?.isSystem ?? false)
    component.inherited = Boolean(raw?.inherited ?? false)
    component.meta = normalizeMeta(raw?.meta)
    component.modelVersion = Number(raw?.modelVersion ?? 1)
    component.supportedTargets = normalizeTargets(raw?.supportedTargets)
    component.tag = normalizeTag(raw?.tag)
    component.source = typeof raw?.source === 'string'
      ? raw.source
      : sourceParts
        ? serializeSFCSourceParts(sourceParts)
        : ''
    component.applyStorageMeta(raw ?? {})

    return component
  }
}

/** Нормализует опциональный пользовательский tag без навязывания namespace. */
function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  return raw.trim() || null
}

/** Нормализует ссылку на проект из Payload relation или plain-значения. */
/** Нормализует список поддерживаемых targets и оставляет только v1-значения. */
function normalizeTargets(raw: unknown): RComponentRenderTarget[] {
  if (!Array.isArray(raw)) return ['dom', 'canvas']

  const targets = raw.filter((target): target is RComponentRenderTarget => target === 'dom' || target === 'canvas')
  return targets.length ? targets : ['dom', 'canvas']
}

/** Нормализует meta так, чтобы модель не делила mutable объект с Payload. */
function normalizeMeta(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {}
}
