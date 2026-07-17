import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import type { RMockContentSource, RMockContentType } from '@/domain/types/mock'
import { REntity } from '@/domain/entities/reflect/REntity'

/** Persisted mock-документ. Payload остается source of truth для identity и связей. */
export class RMock extends REntity {
  @Expose()
  override displayName: string = ''

  @Expose()
  override description: string | null = null

  @Expose()
  contentSource: RMockContentSource = 'document'

  @Expose()
  contentType: RMockContentType = 'application/json'

  @Expose()
  source: string = '{}'

  @Expose()
  codeRef: string | null = null

  /** Создает доменную модель из Payload response. */
  static fromPayload(json: any): RMock {
    return RMock.fromPlain({
      ...json,
      name: json?.displayName ?? json?.name,
      folderId: relationToId(json?.folder ?? json?.folderId),
    }, json)
  }

  /** Создает доменную модель из portable plain source. */
  static fromPlain(json: any, storageMeta?: any): RMock {
    const mock = new RMock()
    mock.id = json?.id
    mock.identity = String(json?.identity ?? '').trim()
    mock.name = String(json?.name ?? json?.displayName ?? mock.identity)
    mock.displayName = String(json?.displayName ?? mock.name)
    mock.description = json?.description ?? null
    mock.contentSource = json?.contentSource === 'code-provider' ? 'code-provider' : 'document'
    mock.contentType = json?.contentType === 'text/plain' ? 'text/plain' : 'application/json'
    mock.source = typeof json?.source === 'string' ? json.source : '{}'
    mock.codeRef = String(json?.codeRef ?? '').trim() || null
    mock.folderId = json?.folderId ?? relationToId(json?.folder) ?? null
    mock.isSystem = json?.isSystem === true
    mock.inherited = json?.inherited === true
    mock.meta = isPlainObject(json?.meta) ? { ...json.meta } : {}
    mock.active = json?.active !== false
    mock.deletedAt = json?.deletedAt ?? null
    mock.author = json?.author ?? null
    if (storageMeta)
      mock.applyStorageMeta(storageMeta)
    return mock
  }

  /** Возвращает portable persisted representation. */
  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName,
      description: this.description,
      contentSource: this.contentSource,
      contentType: this.contentType,
      source: this.source,
      codeRef: this.codeRef,
      folderId: this.folderId ?? null,
      meta: this.meta ?? {},
      active: this.active !== false,
      inherited: this.inherited === true,
      isSystem: this.isSystem === true,
      deletedAt: this.deletedAt ?? null,
      author: this.author ?? null,
    }
  }

  /** Проверяет persisted contract mock-документа. */
  override compile(): void {
    this.clearValidationErrors()
    if (!this.identity)
      this.addValidationError('Mock.identity не задан')
    if (!this.displayName)
      this.addValidationError('Mock.displayName не задан')
    if (this.contentSource === 'code-provider') {
      if (!this.codeRef)
        this.addValidationError('Mock.codeRef не задан для code-provider')
      return
    }
    if (this.contentType === 'application/json') {
      try {
        JSON.parse(this.source)
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.addValidationError(`Mock.source содержит некорректный JSON: ${message}`)
      }
    }
  }

  /** Создает копию документа с новым identity. */
  override duplicate(options: DuplicateOptions): RMock {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.id = undefined
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return RMock.fromPlain(plain)
  }
}

function relationToId(value: any): string | number | null {
  if (value == null)
    return null
  if (typeof value === 'object')
    return relationToId(value.id ?? value.value)
  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
