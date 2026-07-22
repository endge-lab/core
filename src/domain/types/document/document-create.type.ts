import type { DomainDocumentType } from './document.types'

/** Запрос на безопасное создание нового документа без update существующего identity. */
export type DocumentCreateRequest =
  | {
      documentType: DomainDocumentType
      identity: string
      mode: 'model'
      model: unknown
    }
  | {
      documentType: DomainDocumentType
      identity: string
      mode: 'payload'
      payload: Record<string, unknown>
    }

/** Результат create-flow после регистрации документа в домене. */
export interface DocumentCreateResult {
  documentType: DomainDocumentType
  identity: string
}
