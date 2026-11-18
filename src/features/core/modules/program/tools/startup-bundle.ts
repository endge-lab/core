import type { ExecutionBundle, PortableProgramArtifact } from '../domain/types/execution-bundle.types'
import type { ComponentSFCProgramPayload, ProgramArtifact } from '../domain/types/program.types'
import type { RComponentSFC_IR_Node } from '@/features/core/modules/domain/types/component/sfc/ir.types'
import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'
import { collectProgramArtifactTypes } from './execution-bundle'

// A transport projection, never a second owner of Program state.
export function selectStartupBundle(bundle: ExecutionBundle, programId: string): ExecutionBundle {
  const startup = bundle.catalog.workspace?.startupCompositionIdentity
  if (!startup) {
    throw new Error('[Bundle] Startup Composition is required for a context-specific export')
  }
  const byReference = new Map<string, [string, PortableProgramArtifact]>()
  const projected = Object.fromEntries(Object.entries(bundle.artifacts).map(([key, artifact]) => [key, executionArtifact(artifact)]))
  for (const entry of Object.entries(projected)) {
    const { ref } = entry[1]
    byReference.set(`${ref.entityType}:${ref.id}`, entry)
    byReference.set(`${ref.entityType}:${ref.identity}`, entry)
  }
  const root = byReference.get(`composition:${startup}`)
  if (!root) {
    throw new Error(`[Bundle] Startup Composition "${startup}" has no artifact`)
  }
  const selected = new Map<string, PortableProgramArtifact>()
  const hostActions = new Set<string>()
  const pending: Array<[string, PortableProgramArtifact]> = []
  let specialized = false
  do {
    selected.clear()
    hostActions.clear()
    pending.push(root)
    while (pending.length) {
      const [key, artifact] = pending.pop()!
      if (selected.has(key)) {
        continue
      }
      selected.set(key, artifact)
      const local: ProgramArtifact[] = [artifact]
      while (local.length) {
        const current = local.pop()!
        local.push(...current.children ?? [])
        for (const dependency of current.dependencies) {
          if (dependency.validationOnly) {
            continue
          }
          const target = byReference.get(`${dependency.entityType}:${dependency.identity ?? dependency.id}`)
            ?? byReference.get(`${dependency.entityType}:${dependency.id}`)
          if (target) {
            pending.push(target)
          }
          else if (dependency.entityType === 'action') {
            hostActions.add(String(dependency.identity ?? dependency.id))
          }
        }
      }
    }
    specialized = specializePortDefaults([...selected.values()])
  } while (specialized)
  const artifacts = Object.fromEntries(selected)
  const componentIdentities = new Set([...selected.values()].filter(artifact => artifact.ref.entityType === 'component-sfc').map(artifact => artifact.ref.identity))
  const documents = Object.fromEntries(Object.entries(bundle.catalog.documents)
    .filter(([, document]) => document.artifactKeys.some(key => selected.has(key)))
    .map(([key, document]) => [key, {
      ...document,
      folderId: null,
      workspaceFolderId: null,
      artifactKeys: document.artifactKeys.filter(key => selected.has(key)),
    }]))
  return {
    ...bundle,
    exportScope: 'startup-composition',
    programId,
    catalog: { workspace: bundle.catalog.workspace, folders: {}, documents },
    artifacts,
    requirements: {
      hostControllers: (bundle.requirements.hostControllers ?? []).filter(requirement => [...selected.values()].some(artifact => artifact.ref.entityType === 'controller' && artifact.ref.identity === requirement.identity)),
      artifactTypes: collectProgramArtifactTypes([...selected.values()]),
      componentTags: bundle.requirements.componentTags.filter(tag => componentIdentities.has(tag.identity)),
      ...(bundle.requirements.hostActions?.length
        ? {
            hostActions: bundle.requirements.hostActions.filter(action => hostActions.has(action.identity)),
          }
        : {}),
    },
  }
}

function executionArtifact(artifact: ProgramArtifact): PortableProgramArtifact {
  const payload = artifact.payload as Record<string, unknown>
  const { sourceDocument, previewProps: _previewProps, previewOptions: _previewOptions, ...executable } = payload
  if (artifact.ref.entityType === 'component-sfc' && executable.dependencies) {
    const { contextValidation: _validation, ...dependencies } = executable.dependencies as Record<string, unknown>
    executable.dependencies = dependencies
  }
  return {
    ...artifact,
    // Compiler diagnostics may quote a rejected context variant.
    diagnostics: [],
    dependencies: artifact.dependencies.filter(dependency => !dependency.validationOnly)
      .map(({ validationOnly: _validationOnly, ...dependency }) => dependency),
    payload: stripValidationMetadata({
      ...executable,
      ...(artifact.ref.entityType === 'action' ? { sourceDocument } : {}),
    }) as PortableProgramArtifact['payload'],
    ...(artifact.children ? { children: artifact.children.map(executionArtifact) } : {}),
  }
}

function stripValidationMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripValidationMetadata)
  }
  if (value == null || typeof value !== 'object') {
    return value
  }
  const record = value as Record<string, unknown>
  // User literals and metadata are opaque data, never compiler syntax.
  if (record.kind === 'literal' || record.type === 'literal') {
    return record
  }
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    if (key === 'contextSwitch' && typeof record.identity === 'string' && typeof record.kind === 'string') {
      continue
    }
    if (key === 'contextVariants' && typeof record.kind === 'string') {
      continue
    }
    if (key === 'typeVariants' && typeof record.key === 'string' && typeof record.type === 'string') {
      continue
    }
    if (key === 'source' && record.kind === 'expression' && record.expression) {
      result[key] = ''
      continue
    }
    result[key] = ['metadata', 'mockData', 'defaultValue', 'examples'].includes(key) ? item : stripValidationMetadata(item)
  }
  return result
}

// Defaults are not execution dependencies when every reachable call supplies an override.
// Retarget the unused default to one of those providers; the public port contract stays intact.
function specializePortDefaults(artifacts: PortableProgramArtifact[]): boolean {
  const incoming = new Map<string, Array<Map<string, string>>>()
  const add = (identity: string, bindings = new Map<string, string>()) => {
    const calls = incoming.get(identity) ?? []
    calls.push(bindings)
    incoming.set(identity, calls)
  }
  for (const artifact of artifacts) {
    if (artifact.ref.entityType === 'composition') {
      for (const runtime of (artifact.payload as unknown as CompositionProgramPayload).runtimes) {
        if (runtime.kind === 'component') {
          add(runtime.identity)
        }
      }
    }
    if (artifact.ref.entityType !== 'component-sfc') {
      continue
    }
    const payload = artifact.payload as unknown as ComponentSFCProgramPayload
    if (!payload.ir) {
      throw new Error('[Bundle] Component has no executable IR')
    }
    const staticTargets = new Set<string>()
    const visit = (nodes: RComponentSFC_IR_Node[]): void => {
      for (const node of nodes) {
        if (node.kind !== 'element') {
          continue
        }
        if (node.tag === 'Component' && node.props.is?.kind === 'literal' && typeof node.props.is.value === 'string') {
          const identity = node.props.is.value
          staticTargets.add(identity)
          add(identity, new Map(node.portBindings?.map(binding => [`${binding.kind}:${binding.port}`, binding.identity])))
        }
        visit(node.children)
      }
    }
    visit(payload.ir.template.roots)
    // Required component providers and other indirect calls remain conservative.
    for (const dependency of artifact.dependencies) {
      if (dependency.entityType === 'component-sfc' && !staticTargets.has(String(dependency.identity ?? dependency.id))) {
        add(String(dependency.identity ?? dependency.id))
      }
    }
  }
  let changed = false
  for (const artifact of artifacts) {
    if (artifact.ref.entityType !== 'component-sfc') {
      continue
    }
    const calls = incoming.get(artifact.ref.identity)
    if (!calls?.length) {
      continue
    }
    const payload = artifact.payload as unknown as ComponentSFCProgramPayload
    if (!payload.ir) {
      throw new Error('[Bundle] Component has no executable IR')
    }
    for (const [kind, ports] of Object.entries(payload.ir.script.ports.require) as Array<[string, Array<{ name: string, defaultIdentity?: string }>]>) {
      const providerKind = kind === 'queries' ? 'query' : kind === 'actions' ? 'action' : kind === 'computations' ? 'computation' : 'component'
      for (const port of ports) {
        const key = `${providerKind}:${port.name}`
        const replacement = calls.map(call => call.get(key)).filter((identity): identity is string => identity !== undefined).sort()[0]
        if (!replacement || !calls.every(call => call.has(key)) || replacement === port.defaultIdentity || hasExecutableIdentity(payload.ir.template, port.defaultIdentity)) {
          continue
        }
        const original = port.defaultIdentity
        port.defaultIdentity = replacement
        if (providerKind === 'computation') {
          for (const call of payload.ir.script.portCalls) {
            if (call.port === port.name && call.defaultIdentity === original) {
              call.defaultIdentity = replacement
            }
          }
        }
        if (providerKind === 'component') {
          const retarget = (nodes: RComponentSFC_IR_Node[]): void => {
            for (const node of nodes) {
              if (node.kind !== 'element') {
                continue
              }
              if (node.port?.port === port.name && node.port.defaultIdentity === original) {
                node.port.defaultIdentity = replacement
                if (node.props.is?.kind === 'literal' && node.props.is.value === original) {
                  node.props.is.value = replacement
                }
              }
              retarget(node.children)
            }
          }
          retarget(payload.ir.template.roots)
        }
        changed = true
        const role = `port-default-${providerKind}`
        const stillRequired = ports.some(other => other.defaultIdentity === original)
        for (const dependency of artifact.dependencies) {
          if (!stillRequired && dependency.role === role && dependency.identity === original) {
            dependency.id = replacement
            dependency.identity = replacement
          }
        }
        if (stillRequired) {
          continue
        }
        // SFC's portable compiler summary also contains provider identities.
        if (providerKind === 'query' || providerKind === 'action') {
          const summary = providerKind === 'query' ? payload.dependencies.queries : payload.dependencies.actions
          for (let i = 0; i < summary.length; i++) {
            if (summary[i] === original) {
              summary[i] = replacement
            }
          }
        }
        else {
          const summary = providerKind === 'component' ? payload.dependencies.components : payload.dependencies.computations
          for (const dependency of summary) {
            if (dependency.role === role && dependency.id === original) {
              dependency.id = replacement
            }
          }
        }
        changed = true
      }
    }
  }
  return changed
}

function hasExecutableIdentity(value: unknown, identity: string | undefined): boolean {
  if (!identity || value == null || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(item => hasExecutableIdentity(item, identity))
  }
  const record = value as Record<string, unknown>
  if (record.identity === identity) {
    return true
  }
  return Object.values(record).some(item => hasExecutableIdentity(item, identity))
}
