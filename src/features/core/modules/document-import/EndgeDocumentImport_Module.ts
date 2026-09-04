import type {
  DocumentImportApplyItemResult,
  DocumentImportApplyRequest,
  DocumentImportApplyResult,
  DocumentImportCandidate,
  DocumentImportDiagnostic,
  DocumentImportFormat,
  DocumentImportPlan,
  DocumentImportPrepareRequest,
} from '@/features/core/modules/document-import/domain/types/document-import.type'
import type { DocumentImportParser, ParsedDocumentImportCandidate } from '@/features/core/modules/document-import/services/parsers/DocumentImportParser'
import type { RType } from '@/features/core/modules/domain/entities/RType'

import { Endge } from '@/features/core/kernel/endge'
import { GraphQLDocumentImportParser } from '@/features/core/modules/document-import/services/parsers/GraphQLDocumentImportParser'
import { OpenAPIDocumentImportParser } from '@/features/core/modules/document-import/services/parsers/OpenAPIDocumentImportParser'
import { createNewDomainDocument } from '@/features/core/modules/domain/documents/domain-document-descriptors'
import { EndgeModule } from '@/features/federation/EndgeModule'

interface InternalDocumentImportPlan {
  publicPlan: DocumentImportPlan
  drafts: ReadonlyMap<string, ParsedDocumentImportCandidate>
}

/** Владеет подготовкой и применением внешних схем как Domain-документов Endge. */
export class EndgeDocumentImport_Module extends EndgeModule {
  /** Format-specific parsers и единственный активный подтверждаемый plan. */
  private readonly _graphQLParser = new GraphQLDocumentImportParser()
  private readonly _openAPIParser = new OpenAPIDocumentImportParser()
  private _activePlan: InternalDocumentImportPlan | null = null
  private _planSequence = 0
  private _applying = false

  /**
   * ----------------------------------------
   * PUBLIC
   * ----------------------------------------
   */

  /** Разбирает внешний документ и создаёт renderer-neutral plan без изменения Domain. */
  public prepare(request: DocumentImportPrepareRequest): DocumentImportPlan {
    const source = request.source.trim()
    const parser = this._resolveParser(request.format)
    const parsed = source
      ? parser.parse(request.source)
      : {
          candidates: [],
          diagnostics: [{
            severity: 'error' as const,
            code: 'document-import-source-empty',
            message: 'Import source is empty.',
          }],
          skipped: [],
        }
    const drafts = new Map<string, ParsedDocumentImportCandidate>()
    const candidates = parsed.candidates.map((draft): DocumentImportCandidate => {
      const sourceDiagnostics = this._validateTypeSource(draft)
      const diagnostics = [...draft.diagnostics, ...sourceDiagnostics]
      const invalid = diagnostics.some(item => item.severity === 'error')
      const conflict = Endge.types.getDefinition(draft.identity) != null
      drafts.set(draft.id, draft)
      return {
        id: draft.id,
        documentType: 'type',
        identity: draft.identity,
        displayName: draft.displayName,
        description: draft.description,
        status: invalid ? 'invalid' : conflict ? 'conflict' : 'ready',
        sourcePreview: draft.source,
        summary: {
          fields: draft.fields,
          requiredFields: draft.requiredFields,
        },
        diagnostics,
      }
    })
    const publicPlan: DocumentImportPlan = {
      id: `document-import-${Date.now()}-${++this._planSequence}`,
      format: request.format,
      sourceName: request.sourceName?.trim() || undefined,
      createdAt: new Date().toISOString(),
      candidates,
      diagnostics: parsed.diagnostics,
      skipped: parsed.skipped,
    }
    this._activePlan = { publicPlan, drafts }
    this.notify()
    return clonePlan(publicPlan)
  }

  /** Создаёт только подтверждённых кандидатов из ранее подготовленного plan. */
  public async apply(request: DocumentImportApplyRequest): Promise<DocumentImportApplyResult> {
    const plan = this._activePlan
    if (!plan || plan.publicPlan.id !== request.planId) {
      throw new Error('Document import plan is no longer active. Prepare the source again.')
    }
    if (this._applying) {
      throw new Error('Document import is already running.')
    }
    if (!Endge.domainRepository.capabilities.mutations) {
      throw new Error('Current Domain provider does not support mutations.')
    }

    const selectedCandidateIds = [...new Set(request.selectedCandidateIds)]
    if (selectedCandidateIds.length === 0) {
      throw new Error('Select at least one document to import.')
    }
    this._assertDestination(request.destination.folderId)
    for (const candidateId of selectedCandidateIds) {
      if (!plan.drafts.has(candidateId)) {
        throw new Error(`Document import candidate is not part of the active plan: ${candidateId}`)
      }
    }

    this._applying = true
    const items: DocumentImportApplyItemResult[] = []
    try {
      for (const candidateId of selectedCandidateIds) {
        const candidate = plan.publicPlan.candidates.find(item => item.id === candidateId)!
        const draft = plan.drafts.get(candidateId)!
        if (candidate.status === 'invalid') {
          items.push({
            candidateId,
            identity: draft.identity,
            status: 'skipped',
            message: 'Candidate contains errors.',
          })
          continue
        }
        if (Endge.types.getDefinition(draft.identity)) {
          items.push({
            candidateId,
            identity: draft.identity,
            status: 'skipped',
            message: 'A Type with this identity already exists.',
          })
          continue
        }

        try {
          const type = createNewDomainDocument('type', {
            identity: draft.identity,
            name: draft.displayName,
            folderId: request.destination.folderId,
          }) as RType
          type.description = draft.description ?? null
          type.source = draft.source
          type.sourceVersion = 1
          await Endge.domainRepository.createDocument({
            documentType: 'type',
            identity: type.identity,
            mode: 'model',
            model: type,
          })
          items.push({ candidateId, identity: draft.identity, status: 'imported' })
        }
        catch (error) {
          items.push({
            candidateId,
            identity: draft.identity,
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
    finally {
      this._applying = false
      this._activePlan = null
      this.notify()
    }

    return {
      planId: request.planId,
      imported: items.filter(item => item.status === 'imported').length,
      skipped: items.filter(item => item.status === 'skipped').length,
      failed: items.filter(item => item.status === 'failed').length,
      items,
    }
  }

  /** Сбрасывает неподтверждённый import plan при reset Core context. */
  public override reset(): void {
    this._activePlan = null
    this._applying = false
    this.notify()
  }

  /**
   * ----------------------------------------
   * PRIVATE
   * ----------------------------------------
   */

  /** Выбирает внутренний parser без публичного registry до появления extension use case. */
  private _resolveParser(format: DocumentImportFormat): DocumentImportParser {
    if (format === 'graphql') {
      return this._graphQLParser
    }
    if (format === 'openapi') {
      return this._openAPIParser
    }
    throw new Error(`Unsupported document import format: ${String(format)}`)
  }

  /** Проверяет сгенерированный Type Source через публичный Source owner. */
  private _validateTypeSource(candidate: ParsedDocumentImportCandidate): DocumentImportDiagnostic[] {
    const result = Endge.source.compile('type', candidate.source)
    return (result.diagnostics ?? []).map(diagnostic => normalizeSourceDiagnostic(diagnostic, candidate.id))
  }

  /** Запрещает помещение Type в папку другого Domain section. */
  private _assertDestination(folderId: string | number | null): void {
    if (folderId == null) {
      return
    }
    const folder = Endge.domain.getFolder(folderId)
    if (!folder) {
      throw new Error(`Type destination folder was not found: ${String(folderId)}`)
    }
    if (folder.entityType && folder.entityType !== 'types') {
      throw new Error(`Folder "${folder.identity}" does not accept Type documents.`)
    }
  }
}

function normalizeSourceDiagnostic(value: unknown, candidateId: string): DocumentImportDiagnostic {
  const diagnostic = value != null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  const severity = diagnostic.severity === 'error' || diagnostic.severity === 'warning' || diagnostic.severity === 'info'
    ? diagnostic.severity
    : 'error'
  return {
    severity,
    code: typeof diagnostic.code === 'string' ? diagnostic.code : 'document-import-type-source-invalid',
    message: typeof diagnostic.message === 'string' ? diagnostic.message : String(value),
    candidateId,
  }
}

function clonePlan(plan: DocumentImportPlan): DocumentImportPlan {
  return {
    ...plan,
    candidates: plan.candidates.map(candidate => ({
      ...candidate,
      summary: { ...candidate.summary },
      diagnostics: candidate.diagnostics.map(diagnostic => ({ ...diagnostic })),
    })),
    diagnostics: plan.diagnostics.map(diagnostic => ({ ...diagnostic })),
    skipped: plan.skipped.map(item => ({ ...item })),
  }
}
