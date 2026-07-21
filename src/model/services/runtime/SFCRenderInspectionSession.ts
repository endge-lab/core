import type {
  SFCRenderInspectionNode,
  SFCRenderInspectionNodeInput,
  SFCRenderInspectionSessionLike,
  SFCRenderInspectionTreeNode,
} from '@/domain/types/runtime/sfc-render-inspection.type'

/**
 * Хранит opt-in проекцию живых SFC instances без зависимости от Vue, DOM или canvas.
 */
export class SFCRenderInspectionSession implements SFCRenderInspectionSessionLike {
  private readonly _nodes = new Map<string, SFCRenderInspectionNode>()
  private readonly _idsByStableKey = new Map<string, string>()
  private readonly _stableKeysById = new Map<string, string>()
  private readonly _listeners = new Set<() => void>()
  private _counter = 0
  private _notifyPending = false

  /** Регистрирует или обновляет один instance и возвращает его opaque id. */
  public registerNode(input: SFCRenderInspectionNodeInput): string {
    const stableKey = this._makeStableKey(input)
    const id = this._idsByStableKey.get(stableKey) ?? `sfc-ri-${++this._counter}`
    this._idsByStableKey.set(stableKey, id)
    this._stableKeysById.set(id, stableKey)
    this._nodes.set(id, {
      ...input,
      id,
      componentStack: [...input.componentStack],
      updatedAt: Date.now(),
    })
    this._scheduleNotify()
    return id
  }

  /** Удаляет instance после unmount renderer-owned physical node. */
  public unregisterNode(id: string): void {
    if (!this._nodes.has(id)) return
    const pending = [id]
    while (pending.length > 0) {
      const currentId = pending.pop()!
      for (const node of this._nodes.values()) {
        if (node.parentId === currentId) pending.push(node.id)
      }
      this._deleteNode(currentId)
    }
    this._scheduleNotify()
  }

  /** Возвращает зарегистрированный instance по opaque id. */
  public getNode(id: string): SFCRenderInspectionNode | null {
    return this._nodes.get(id) ?? null
  }

  /** Строит текущую иерархию без сохранения отдельного дублирующего дерева. */
  public getTree(runtimeId?: string): SFCRenderInspectionTreeNode[] {
    const source = [...this._nodes.values()].filter(node => !runtimeId || node.runtimeId === runtimeId)
    const treeById = new Map<string, SFCRenderInspectionTreeNode>()
    for (const node of source) treeById.set(node.id, { ...node, children: [] })

    const roots: SFCRenderInspectionTreeNode[] = []
    for (const node of source) {
      const treeNode = treeById.get(node.id)!
      const parent = node.parentId ? treeById.get(node.parentId) : null
      if (parent) parent.children.push(treeNode)
      else roots.push(treeNode)
    }
    return roots
  }

  /** Подписывает UI на batched изменения inspection projection. */
  public subscribe(listener: () => void): VoidFunction {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  /** Очищает instances одного runtime root. */
  public clearRuntime(runtimeId: string): void {
    const ids = [...this._nodes.values()]
      .filter(node => node.runtimeId === runtimeId)
      .map(node => node.id)
    if (ids.length === 0) return
    for (const id of ids) this._deleteNode(id)
    this._scheduleNotify()
  }

  /** Полностью очищает короткоживущую debug session. */
  public clear(): void {
    if (this._nodes.size === 0 && this._idsByStableKey.size === 0) return
    this._nodes.clear()
    this._idsByStableKey.clear()
    this._stableKeysById.clear()
    this._scheduleNotify()
  }

  private _makeStableKey(input: SFCRenderInspectionNodeInput): string {
    return [
      input.runtimeId,
      input.scope,
      input.componentIdentity,
      input.nodeId,
      input.kind,
      input.tag,
    ].join('\u0000')
  }

  private _deleteNode(id: string): void {
    this._nodes.delete(id)
    const stableKey = this._stableKeysById.get(id)
    if (stableKey) this._idsByStableKey.delete(stableKey)
    this._stableKeysById.delete(id)
  }

  private _scheduleNotify(): void {
    if (this._notifyPending) return
    this._notifyPending = true
    queueMicrotask(() => {
      this._notifyPending = false
      for (const listener of this._listeners) listener()
    })
  }
}
