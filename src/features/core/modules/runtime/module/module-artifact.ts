import type { ModuleReference } from './module-reference'
import type { EndgeModule } from '@/features/federation/EndgeModule'
import type { EndgeFederationContext } from '@/features/federation/types/federation.types'

export interface ScopedModuleContext extends EndgeFederationContext {
  readonly scopeId: string
  readonly attachment: string
  readonly reference: Readonly<ModuleReference>
  readonly signal: AbortSignal
  register: (channel: string, key: string, value: unknown) => () => void
}

export type ScopedModule = Pick<EndgeModule<ScopedModuleContext>, 'setup' | 'load' | 'build' | 'start' | 'reset'> & {
  pause?: () => Promise<void> | void
  resume?: () => Promise<void> | void
}

export interface ModuleArtifact {
  create: () => ScopedModule
  installStyle?: (visualToken: string) => () => void
}

export interface ModuleManifest extends ModuleReference {
  formatVersion: 1
  hostApi: 1
  contributes?: { renderers?: ModuleRendererDescriptor[] }
}

export interface ModuleRendererDescriptor {
  primitive: string
  id: string
  label: string
}

export type ModuleArtifactLoader = (reference: Readonly<ModuleReference>, signal: AbortSignal) => Promise<ModuleArtifact>

export interface ModuleContribution<T = unknown> {
  value: T
  visualToken: string
}

export function createLocalModuleLoader(
  entries: readonly { reference: ModuleReference, artifact: ModuleArtifact }[],
  fallback?: ModuleArtifactLoader,
): ModuleArtifactLoader {
  const artifacts = new Map(entries.map(({ reference, artifact }) => [moduleReferenceKey(reference), artifact]))
  return async (reference, signal) => {
    signal.throwIfAborted()
    const artifact = artifacts.get(moduleReferenceKey(reference))
    if (artifact) {
      return artifact
    }
    if (fallback) {
      return fallback(reference, signal)
    }
    throw new Error(`Module "${reference.identity}@${reference.version}" is unavailable.`)
  }
}

export function moduleReferenceKey(reference: Readonly<ModuleReference>): string {
  return `${reference.identity}@${reference.version}`
}
