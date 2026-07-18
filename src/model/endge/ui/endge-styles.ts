import type {
  EndgeStyleMatchNode,
  AcquireEndgeStyleOptions,
  EndgeStyleLease,
  EndgeStylePlacement,
  EndgeStyleResolvedDeclaration,
  EndgeStyleSheetArtifact,
  EndgeStyleTargetProfile,
} from '@/domain/types/style'
import type { EndgeStyleProgramPayload, ProgramArtifact } from '@/domain/types/program'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Endge } from '@/model/endge/kernel/endge'
import { resolveEndgeStyleDeclarations } from '@/model/services/style'

export interface EndgeStyleResolver {
  readonly target: EndgeStyleTargetProfile
  resolve: (node: EndgeStyleMatchNode, theme?: string) => Record<string, EndgeStyleResolvedDeclaration>
}

/** Neutral style registry. Renderer materializers consume its artifacts/resolver. */
export class EndgeStyles extends EndgeModule {
  private _unsubscribeProgram: (() => void) | null = null
  private readonly _placements = new Map<string, {
    artifact: EndgeStyleSheetArtifact
    boundaryId: string
    orderKey: string
    owners: Map<string, { ownerScopeId: string, suspended: boolean }>
  }>()
  private _leaseSequence = 0
  private _transactionDepth = 0
  private _notificationPending = false

  public override start(): void {
    if (this._unsubscribeProgram) return
    this._unsubscribeProgram = Endge.program.subscribe(() => {
      const available = new Map(this.getAvailableArtifacts().map(artifact => [artifact.identity, artifact]))
      for (const placement of this._placements.values()) {
        const replacement = available.get(placement.artifact.identity)
        if (replacement)
          placement.artifact = replacement
      }
      this.notify()
    })
  }

  /** Returns valid compiled artifacts. Availability does not activate a style. */
  public getAvailableArtifacts(): EndgeStyleSheetArtifact[] {
    const rankByIdentity = new Map(
      Endge.domain.getStyles()
        .filter(style => style.active !== false && !style.deletedAt)
        .sort((left, right) => {
          const rank = (style: typeof left) => style.managedBy === 'system' ? 0 : 1
          return rank(left) - rank(right) || left.identity.localeCompare(right.identity)
        })
        .map((style, index) => [style.identity, index]),
    )
    return Endge.program.getArtifacts()
      .filter((artifact): artifact is ProgramArtifact<EndgeStyleProgramPayload> => artifact.ref.entityType === 'style' && artifact.status !== 'error')
      .sort((left, right) => (rankByIdentity.get(left.ref.identity) ?? Number.MAX_SAFE_INTEGER) - (rankByIdentity.get(right.ref.identity) ?? Number.MAX_SAFE_INTEGER))
      .map(artifact => artifact.payload.stylesheet)
  }

  /** Returns only placements acquired by live runtime owners. */
  public getActivePlacements(): EndgeStylePlacement[] {
    return [...this._placements.entries()]
      .map(([id, placement]): EndgeStylePlacement => {
        const activeOwners = [...placement.owners.values()].filter(owner => !owner.suspended)
        return {
          id,
          artifactIdentity: placement.artifact.identity,
          artifact: placement.artifact,
          ownerScopeIds: activeOwners.map(owner => owner.ownerScopeId),
          boundaryId: placement.boundaryId,
          orderKey: placement.orderKey,
          state: activeOwners.length ? 'active' : 'suspended',
          referenceCount: placement.owners.size,
        }
      })
      .filter(placement => placement.state === 'active')
      .sort((left, right) => left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id))
  }

  public getActiveArtifacts(): EndgeStyleSheetArtifact[] {
    return this.getActivePlacements().map(placement => placement.artifact)
  }

  public acquireStyle(options: AcquireEndgeStyleOptions): EndgeStyleLease {
    const ownerScopeId = required(options.ownerScopeId, 'ownerScopeId')
    const boundaryId = required(options.boundaryId, 'boundaryId')
    const artifact = options.artifact ?? this.getAvailableArtifacts().find(item => item.identity === options.artifactIdentity)
    if (!artifact)
      throw new Error(`[EndgeStyles] Style artifact "${options.artifactIdentity ?? ''}" is missing.`)
    const orderKey = String(options.orderKey ?? artifact.identity).trim() || artifact.identity
    const placementId = `${artifact.identity}:${artifact.sourceHash}:${boundaryId}:${orderKey}`
    const placement = this._placements.get(placementId) ?? {
      artifact,
      boundaryId,
      orderKey,
      owners: new Map<string, { ownerScopeId: string, suspended: boolean }>(),
    }
    this._placements.set(placementId, placement)
    const leaseId = `style-lease:${++this._leaseSequence}`
    placement.owners.set(leaseId, { ownerScopeId, suspended: false })
    let released = false
    const lease: EndgeStyleLease = {
      id: leaseId,
      kind: 'style',
      artifactIdentity: artifact.identity,
      ownerScopeId,
      boundaryId,
      orderKey,
      get suspended() { return placement.owners.get(leaseId)?.suspended ?? true },
      suspend: () => {
        const owner = placement.owners.get(leaseId)
        if (!owner || owner.suspended) return
        owner.suspended = true
        this._changed()
      },
      resume: () => {
        const owner = placement.owners.get(leaseId)
        if (!owner || !owner.suspended) return
        owner.suspended = false
        this._changed()
      },
      release: () => {
        if (released) return
        released = true
        placement.owners.delete(leaseId)
        if (!placement.owners.size)
          this._placements.delete(placementId)
        this._changed()
      },
      pause: () => lease.suspend(),
      dispose: () => lease.release(),
    }
    this._changed()
    return lease
  }

  public transaction<T>(operation: () => T): T {
    this._transactionDepth += 1
    const finish = () => {
      this._transactionDepth -= 1
      if (!this._transactionDepth && this._notificationPending) {
        this._notificationPending = false
        this.notify()
      }
    }
    try {
      const result = operation()
      if (result && typeof (result as any).then === 'function')
        return (result as any).finally(finish)
      finish()
      return result
    }
    catch (error) {
      finish()
      throw error
    }
  }

  /** Creates a renderer-neutral resolver over the active program snapshot. */
  public createResolver(target: EndgeStyleTargetProfile): EndgeStyleResolver {
    const placements = this.getActivePlacements()
    return {
      target,
      resolve: (node, theme = Endge.ui.theme) => {
        const artifacts = placements
          .filter(placement => !node.runtimeScopeIds || node.runtimeScopeIds.has(placement.boundaryId))
          .map(placement => placement.artifact)
        return resolveEndgeStyleDeclarations(artifacts, node, target, theme)
      },
    }
  }

  public override reset(): void {
    this._unsubscribeProgram?.()
    this._unsubscribeProgram = null
    this._placements.clear()
    this._notificationPending = false
    this._transactionDepth = 0
  }

  private _changed(): void {
    if (this._transactionDepth) {
      this._notificationPending = true
      return
    }
    this.notify()
  }
}

function required(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!normalized)
    throw new Error(`[EndgeStyles] ${field} is required.`)
  return normalized
}
