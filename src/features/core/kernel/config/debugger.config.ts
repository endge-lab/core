import type { EndgeBootContext } from '@/features/core/kernel/types/bootstrap.types'
import type { EndgeFederationContext, EndgeLifecycleNodeDescriptor } from '@/features/federation/types/federation.types'

const DEBUGGER_MODULES = new Set(['context', 'workspace', 'domainRepository', 'domain', 'bridge'])

/** Debugger boots an empty Domain and Bridge; it never runs the inspected application. */
export function selectCoreLifecycleNodes(nodes: readonly EndgeLifecycleNodeDescriptor[], ctx: EndgeFederationContext): readonly EndgeLifecycleNodeDescriptor[] {
  const options = ctx as EndgeBootContext
  if (options.mode !== 'debugger') {
    if (!options.dataProvider) {
      throw new Error('[Endge] dataProvider is required in application mode')
    }
    return nodes
  }
  if (options.bridge?.role !== 'configurator' || options.bridge.debug !== true || !options.scope.workspaceIdentity || options.dataProvider || options.domainProvider) {
    throw new Error('[Endge] Debugger requires a configurator bridge, workspace scope and no domain provider')
  }
  return nodes.filter(node => node.kind === 'module' && DEBUGGER_MODULES.has(node.key))
}
