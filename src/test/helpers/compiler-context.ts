import { Endge } from '@/features/core/kernel/endge'
import { RFacet } from '@/features/core/modules/domain/entities/RFacet'
import { RFacetDocument } from '@/features/core/modules/domain/entities/RFacetDocument'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

/** Подготавливает минимальный resolved build context для compiler contract tests. */
export function prepareTestCompilerContext(): void {
  Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
  Endge.domain.addFacet(RFacet.fromPlain({ id: 9101, identity: 'region', displayName: 'Region', position: 0 }))
  Endge.domain.addFacetDocument(RFacetDocument.fromPlain({ id: 9102, facetIdentity: 'region', identity: 'eu', displayName: 'Europe', configuration: { mode: 'inherit', patch: {} } }))
  Endge.domain.addFacet(RFacet.fromPlain({ id: 9103, identity: 'channel', displayName: 'Channel', position: 1 }))
  Endge.domain.addFacetDocument(RFacetDocument.fromPlain({ id: 9104, facetIdentity: 'channel', identity: 'web', displayName: 'Web', configuration: { mode: 'inherit', patch: {} } }))
  Endge.configuration.build({
    dataProvider: 'plain',
    scope: {},
    vars: {},
    context: { facets: { region: 'eu', channel: 'web' } },
  })
}

/** Очищает build context и связанные test-owned owners. */
export function resetTestCompilerContext(): void {
  Endge.configuration.reset()
  Endge.program.clear()
  Endge.domain.reset()
  Endge.workspace.reset()
}
