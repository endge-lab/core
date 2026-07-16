import type { DocumentDraftOptions } from '@/domain/types/document/document-draft.type'
import type { DomainDocumentType, RDocument } from '@/domain/types/document/document.types'

import { RAction } from '@/domain/entities/reflect/RAction'
import { RAuthProfile } from '@/domain/entities/reflect/RAuthProfile'
import { RComponentDSL } from '@/domain/entities/reflect/RComponentDSL'
import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RComponentTable } from '@/domain/entities/reflect/RComponentTable'
import { RComposition } from '@/domain/entities/reflect/RComposition'
import { RDataView } from '@/domain/entities/reflect/RDataView'
import { REnvironment } from '@/domain/entities/reflect/REnvironment'
import { RFilter } from '@/domain/entities/reflect/RFilter'
import { RI18nBundle } from '@/domain/entities/reflect/RI18nBundle'
import { RIntegration } from '@/domain/entities/reflect/RIntegration'
import { RNavigation } from '@/domain/entities/reflect/RNavigation'
import { RPage } from '@/domain/entities/reflect/RPage'
import { RPageTemplate } from '@/domain/entities/reflect/RPageTemplate'
import { RPolicy } from '@/domain/entities/reflect/RPolicy'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RStore } from '@/domain/entities/reflect/RStore'
import { RMock } from '@/domain/entities/reflect/RMock'
import { RComputation } from '@/domain/entities/reflect/RComputation'
import { RStyle } from '@/domain/entities/reflect/RStyle'
import { RTenant } from '@/domain/entities/reflect/RTenant'
import { RVocabs } from '@/domain/entities/reflect/RVocabs'
import { ComponentType, FilterType, QueryType } from '@/domain/types/document/document.types'
import { Endge } from '@/model/endge/kernel/endge'
import { COMPONENT_SFC_DEFAULT_SOURCE } from '@/model/services/compiler/component-sfc/templates/component-sfc.default.source'

/** Создаёт черновики документов без регистрации и сохранения. */
export class DocumentDraftFactory {
  /** Создаёт валидный черновик с defaults конкретного типа. */
  public static create(type: DomainDocumentType, options: DocumentDraftOptions): RDocument {
    const identity = options.identity.trim()
    if (!identity)
      throw new Error('Document identity is required.')

    const title = options.name?.trim() || identity
    const folderId = options.folderId ?? undefined

    switch (type) {
      case ComponentType.DSL: {
        const item = new RComponentDSL()
        item.identity = identity
        item.name = title
        item.type = type
        if (folderId != null) {
          item.folderId = folderId
          ;(item as any).group = folderId
        }
        return item
      }

      case ComponentType.Table: {
        const item = new RComponentTable()
        item.identity = identity
        item.type = type
        item.name = title
        if (folderId != null) {
          item.folderId = folderId
          ;(item as any).group = folderId
        }
        return item
      }

      case ComponentType.SFC: {
        const item = new RComponentSFC()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.source = COMPONENT_SFC_DEFAULT_SOURCE
        item.supportedTargets = ['dom', 'canvas']
        item.modelVersion = 1
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case QueryType.GraphQL:
      case QueryType.REST:
      case QueryType.Custom: {
        const item = new RQuery()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.type = type
        item.source = Endge.source.createDefault('query')
        item.sourceVersion = 2
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'data-view': {
        const item = new RDataView()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.source = Endge.source.createDefault('data-view')
        item.sourceVersion = 1
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'composition': {
        const item = new RComposition()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.source = Endge.source.createDefault('composition')
        item.sourceVersion = 1
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'store': {
        const item = new RStore()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.source = Endge.source.createDefault('store')
        item.sourceVersion = 1
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'mock': {
        const item = new RMock()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.contentSource = 'document'
        item.contentType = 'application/json'
        item.source = '{}'
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'computation': {
        const item = new RComputation()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.source = Endge.source.createDefault('computation')
        item.sourceVersion = 1
        item.contractVersion = 1
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case FilterType.DefaultFilter: {
        const item = new RFilter()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.source = Endge.source.createDefault('filter')
        item.sourceVersion = 1
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'action': {
        const item = new RAction()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.definition = {
          version: 1,
          entrypoint: 'flow-entry',
          nodes: [],
          edges: [],
        }
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'integration': {
        const item = new RIntegration()
        item.identity = identity
        item.name = title
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'environment': {
        const item = new REnvironment()
        item.identity = identity
        item.name = title
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'policy': {
        const item = new RPolicy()
        item.identity = identity
        item.name = title
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'tenant': {
        const item = new RTenant()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.code = identity
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'style': {
        const item = new RStyle()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.sourceVersion = 1
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'page-template': {
        const item = new RPageTemplate()
        item.identity = identity
        item.name = title
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'page': {
        const item = new RPage()
        item.identity = identity
        item.name = title
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'navigation': {
        const item = new RNavigation()
        item.identity = identity
        item.name = title
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'vocabs': {
        const item = new RVocabs()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.mode = 'internal'
        item.active = true
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'i18n-bundles': {
        const item = new RI18nBundle()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.locales = { ru: {}, en: {} }
        item.active = true
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      case 'auth-profile': {
        const item = new RAuthProfile()
        item.identity = identity
        item.name = title
        item.displayName = title
        item.adapterId = 'manual_token'
        item.config = {}
        item.credentialRefs = {}
        item.persist = 'localStorage'
        item.active = true
        if (folderId != null)
          item.folderId = folderId
        return item
      }

      default:
        throw new Error(`Unknown DocumentType: ${type}`)
    }
  }
}
