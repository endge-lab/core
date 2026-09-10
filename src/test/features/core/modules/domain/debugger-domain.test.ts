import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { EndgeDebuggerReadOnlyError } from '@/features/core/kernel/errors/EndgeDebuggerReadOnlyError'
import { readOnlyDocument } from '@/features/core/kernel/tools/read-only-document'
import { createDefaultEndgeConfiguration } from '@/features/core/modules/configuration/domain/endge-configuration'
import { EndgeDomain_Module } from '@/features/core/modules/domain/EndgeDomain_Module'

async function bootDebugger() {
  vi.spyOn(Endge.bridge, 'start').mockImplementation(() => {})
  await Endge.boot({ mode: 'debugger', scope: { workspaceIdentity: 'workspace' }, vars: {}, bridge: { role: 'configurator', serverUrl: 'http://localhost:8080', debug: true } })
}

afterEach(async () => {
  await Endge.reset()
  vi.restoreAllMocks()
})

describe('debugger inspection boundary', () => {
  /** Debugger подключает owner Runtime, сохраняя запрет на исполнение и Raph-фазы. */
  it('подключает пассивный Runtime без компиляции, hosts и Raph-фаз', async () => {
    const build = vi.spyOn(Endge.program, 'build')
    const addPhase = vi.spyOn(Raph, 'addPhase')
    const addNode = vi.spyOn(Raph.app, 'addNode')
    await bootDebugger()
    expect(Endge.mode).toBe('debugger')
    expect(Endge.domain.getProjects()).toEqual([])
    expect(build).not.toHaveBeenCalled()
    expect(addPhase).not.toHaveBeenCalled()
    expect(addNode).not.toHaveBeenCalled()
    expect(Endge.runtime.snapshot().hosts).toEqual([])
    await Endge.reset()
    expect(Endge.runtime.inspection.runtime.hosts).toEqual([])
    expect(Endge.mode).toBe('application')
  })

  it('replaces every collection with one notification and preserves the old Domain on malformed input', async () => {
    await bootDebugger()
    Endge.domain.replaceFromPlain({ projects: [{ id: 1, identity: 'first', name: 'First' }], environments: [{ id: 2, identity: 'dev', name: 'Dev' }] })
    const changed = vi.fn()
    const off = Endge.domain.subscribe(changed)
    Endge.domain.replaceFromPlain({ projects: [{ id: 3, identity: 'second', name: 'Second' }] })
    expect(changed).toHaveBeenCalledTimes(1)
    expect(Endge.domain.getProject('first')).toBeNull()
    expect(Endge.domain.getEnvironments()).toEqual([])
    expect(() => Endge.domain.replaceFromPlain({ projects: {} })).toThrow('Invalid snapshot collection')
    expect(Endge.domain.getProject('second')?.id).toBe(3)
    expect(changed).toHaveBeenCalledTimes(1)
    off()
  })

  it('protects root and nested mutations and fails repository writes before invoking a provider', async () => {
    await bootDebugger()
    Endge.domain.replaceFromPlain({ projects: [{ id: 1, identity: 'first', name: 'First', allowedEnvironmentIds: [2], meta: { label: 'original' } }] })
    const project = Endge.domain.getProject('first')!
    expect(() => {
      project.name = 'Changed'
    }).toThrow(EndgeDebuggerReadOnlyError)
    expect(() => project.allowedEnvironmentIds.push(3)).toThrow(EndgeDebuggerReadOnlyError)
    expect(() => {
      project.meta.label = 'Changed'
    }).toThrow(EndgeDebuggerReadOnlyError)
    expect(() => Endge.domain.merge({ projects: [] })).toThrow(EndgeDebuggerReadOnlyError)
    expect(() => Endge.runtime.createAppScope({ id: 'forbidden', rootPath: 'forbidden' })).toThrow(EndgeDebuggerReadOnlyError)
    await expect(Endge.domainRepository.saveDocument('workspace', 'project', { model: { id: 1 } })).rejects.toThrow(EndgeDebuggerReadOnlyError)
    expect(project.name).toBe('First')
    expect(project.allowedEnvironmentIds).toEqual([2])
    expect(project.meta.label).toBe('original')
  })

  it('validates snapshot context before replacement and restores the local scope after reset', async () => {
    const original = Endge.context.serialize()
    await bootDebugger()
    const context = { ...original, workspace: 'remote', tenant: 'remote-tenant', user: 'remote-user' }
    const snapshot = {
      format: 'endge-diagnostics-snapshot',
      version: 2,
      domain: { projects: [{ id: 1, identity: 'remote-project', name: 'Remote' }] },
      federation: { nodes: [
        { kind: 'module', key: 'workspace', status: 'captured', snapshot: { identity: 'remote', displayName: 'Remote', configuration: createDefaultEndgeConfiguration() } },
        { kind: 'module', key: 'context', status: 'captured', snapshot: context },
      ] },
    } as unknown as DiagnosticsSnapshot
    const execute = vi.spyOn(Endge.commands, 'execute')
    const published = vi.fn()
    const stop = Endge.events.onAny(published)
    Endge.replaceDebuggerSnapshot(snapshot)
    expect(execute).not.toHaveBeenCalled()
    expect(published).not.toHaveBeenCalled()
    expect(Endge.context.serialize().user).toBe('remote-user')
    Endge.context.applyEvent({ name: 'context:locale-changed', payload: { previous: Endge.context.currentLocale, value: 'en' } })
    expect(Endge.context.serialize().locale).toBe('en')
    expect(execute).not.toHaveBeenCalled()
    stop()
    context.workspace = 'mismatch'
    expect(() => Endge.replaceDebuggerSnapshot(snapshot)).toThrow('do not match')
    expect(Endge.domain.getProject('remote-project')?.name).toBe('Remote')
    expect(Endge.context.serialize().workspace).toBe('remote')
    await Endge.reset()
    expect(Endge.context.serialize()).toEqual(original)
  })

  it('keeps materialized Maps and Dates readable while blocking all their mutations', () => {
    const value = readOnlyDocument({ fields: new Map([['name', { required: true }]]), dates: new Date('2026-09-09T00:00:00Z'), tags: new Set(['original']) })
    expect(value.fields.size).toBe(1)
    expect([...value.fields][0][1].required).toBe(true)
    expect(value.dates.toISOString()).toBe('2026-09-09T00:00:00.000Z')
    expect([...value.tags]).toEqual(['original'])
    expect(() => value.fields.set('other', { required: false })).toThrow(EndgeDebuggerReadOnlyError)
    expect(() => {
      value.fields.get('name')!.required = false
    }).toThrow(EndgeDebuggerReadOnlyError)
    expect(() => {
      [...value.fields.values()][0].required = false
    }).toThrow(EndgeDebuggerReadOnlyError)
    expect(() => value.dates.setTime(0)).toThrow(EndgeDebuggerReadOnlyError)
    expect(() => value.tags.add('other')).toThrow(EndgeDebuggerReadOnlyError)
  })

  it('keeps ordinary independently materialized Domain writable', () => {
    const domain = EndgeDomain_Module.fromPlain({ projects: [{ id: 1, identity: 'first', name: 'First' }] })
    domain.getProject('first')!.name = 'Changed'
    expect(domain.getProject('first')!.name).toBe('Changed')
  })
})
