import type { DeliveryFacetSelection } from '../types/endge-bundle.types'
import type { EndgeExecutionContextFacetCandidate } from '@/features/core/modules/runtime/domain/execution-context.types'

export function expandDeliveryFacets(
  selection: DeliveryFacetSelection,
  available: readonly EndgeExecutionContextFacetCandidate[],
): Record<string, string>[] {
  const active = available.filter(facet => facet.documents.length > 0)
  if (Object.keys(selection).length !== active.length) {
    throw new Error('[Bundle] Build selections must cover every active facet')
  }

  let contexts: Record<string, string>[] = [{}]
  for (const facet of active) {
    const selected = selection[facet.identity]
    if (!selected || (selected.mode === 'one' && !facet.documents.includes(selected.identity))) {
      throw new Error(`[Bundle] Invalid selection for facet "${facet.identity}"`)
    }
    if (selected.mode === 'all' && facet.identity === 'tenant') {
      throw new Error('[Bundle] Select a single tenant for delivery')
    }
    const choices = selected.mode === 'all' ? [...facet.documents].sort() : [selected.identity]
    contexts = contexts.flatMap(context => choices.map(identity => ({ ...context, [facet.identity]: identity })))
  }
  return contexts
}
