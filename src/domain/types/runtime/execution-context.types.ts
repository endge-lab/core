/** Structural context одного полного boot/build lifecycle. */
export interface EndgeExecutionContext {
  tenantIdentity: string
  projectIdentity: string
  environmentIdentity: string
}

export interface EndgeExecutionContextProjectCandidate {
  identity: string
  allowedEnvironmentIds: readonly number[]
}

export interface EndgeExecutionContextEnvironmentCandidate {
  id: string | number
  identity: string
}

export interface EndgeExecutionContextResolutionInput {
  explicit?: Partial<EndgeExecutionContext>
  tenants: readonly string[]
  projects: readonly EndgeExecutionContextProjectCandidate[]
  environments: readonly EndgeExecutionContextEnvironmentCandidate[]
}
