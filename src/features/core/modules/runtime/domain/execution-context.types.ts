/** Structural context одного полного boot/build lifecycle. */
export interface EndgeExecutionContext {
  readonly facets: Readonly<Record<string, string>>
}

export interface EndgeExecutionContextFacetCandidate {
  identity: string
  position: number
  documents: readonly string[]
}

export interface EndgeExecutionContextResolutionInput {
  explicit?: Partial<EndgeExecutionContext>
  facets: readonly EndgeExecutionContextFacetCandidate[]
}
