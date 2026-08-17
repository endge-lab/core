import type { DomainDocumentType } from './document.types'

/** Ссылка на persisted-документ для перемещения внутри домена. */
export interface EndgeDomainDocumentMove {
  documentId: string | number
  documentType: DomainDocumentType
}
