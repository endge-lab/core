import { Raph } from '@endge/raph'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { EndgeBundleCodec_Service } from '@/features/core/kernel/services/EndgeBundleCodec_Service'
import { RAction } from '@/features/core/modules/domain/entities/RAction'
import { RComponentSFC } from '@/features/core/modules/domain/entities/RComponentSFC'
import { RComposition } from '@/features/core/modules/domain/entities/RComposition'
import { RComputation } from '@/features/core/modules/domain/entities/RComputation'
import { RConfiguration } from '@/features/core/modules/domain/entities/RConfiguration'
import { RDataView } from '@/features/core/modules/domain/entities/RDataView'
import { RFilter } from '@/features/core/modules/domain/entities/RFilter'
import { RFolder } from '@/features/core/modules/domain/entities/RFolder'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { RSimulation } from '@/features/core/modules/domain/entities/RSimulation'
import { RStore } from '@/features/core/modules/domain/entities/RStore'
import { RStream } from '@/features/core/modules/domain/entities/RStream'
import { RStyle } from '@/features/core/modules/domain/entities/RStyle'
import { RType } from '@/features/core/modules/domain/entities/RType'
import { RUpdate } from '@/features/core/modules/domain/entities/RUpdate'
import { RVocabs } from '@/features/core/modules/domain/entities/RVocabs'
import { EndgeProgram_Module } from '@/features/core/modules/program/EndgeProgram_Module'
import { restoreProgramArtifactSource } from '@/features/core/modules/program/tools/restore-program-source'
import { ACTION_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/action.default.source'
import { COMPUTATION_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/computation.default.source'
import { DATA_VIEW_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/data-view.default.source'
import { FILTER_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/filter.default.source'
import { QUERY_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/query.default.source'
import { STORE_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/store.default.source'
import { STREAM_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/stream.default.source'
import { TYPE_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/type.default.source'
import { UPDATE_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/update.default.source'
import { VOCAB_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/vocab.default.source'
import {
  prepareTestCompilerContext,
  resetTestCompilerContext,
} from '@/test/helpers/compiler-context'

beforeEach(prepareTestCompilerContext)
afterEach(async () => {
  vi.restoreAllMocks()
  Endge.inspection.reset()
  await Endge.runtime.reset()
  resetTestCompilerContext()
  Raph.app.reset()
})

describe('actual compiler → portable Program', () => {
  it('сохраняет требование к встроенному Action без сериализации провайдера', () => {
    const dispose = Endge.actions.define({
      identity: 'bundle.host-action',
      origin: { kind: 'builtin', owner: 'test-host' },
      defaultImplementation: { kind: 'provider', providerKey: 'test-host.action' },
    })
    try {
      Endge.domain.addComponentSFC(Object.assign(new RComponentSFC(), {
        id: 'host-component',
        identity: 'host-component',
        source: `<template><Text @click="action({ identity: 'bundle.host-action' })" /></template>`,
      }))
      Endge.compiler.build({} as never)
      const bundle = Endge.program.exportBundle()
      expect(bundle.requirements.hostActions).toEqual([
        { identity: 'bundle.host-action', owner: 'test-host', providerKey: 'test-host.action' },
      ])
      const program = new EndgeProgram_Module()
      program.installBundle(program.prepareInstall(bundle))
      expect(program.exportBundle()).toEqual(bundle)
      const invalid = structuredClone(bundle)
      delete invalid.requirements.hostActions
      expect(() => program.prepareInstall(invalid)).toThrow('Missing artifact dependency')
      expect(program.exportBundle()).toEqual(bundle)
    }
    finally {
      dispose()
    }
  })

  it('round trips all supported compiler payloads, AST and dependencies', async () => {
    for (const folder of [
      { id: 'root', identity: 'root', displayName: 'Workspace', scope: 'workspace' },
      { id: 'child', identity: 'child', displayName: 'Nested', scope: 'workspace', parent: 'root', icon: 'Monitor', color: '#abcdef' },
      { id: 'sfc', identity: 'sfc', displayName: 'Components', scope: 'collection', entityType: 'components' },
    ]) {
      Endge.domain.addFolder(Object.assign(new RFolder(), folder))
    }
    const entries = [
      [RAction, 'addAction'],
      [RComponentSFC, 'addComponentSFC'],
      [RComposition, 'addComposition'],
      [RComputation, 'addComputation'],
      [RDataView, 'addDataView'],
      [RFilter, 'addFilter'],
      [RQuery, 'addQuery'],
      [RSimulation, 'addSimulation'],
      [RStore, 'addStore'],
      [RStream, 'addStream'],
      [RStyle, 'addStyle'],
      [RType, 'addType'],
      [RUpdate, 'addUpdate'],
      [RVocabs, 'addVocab'],
      [RConfiguration, 'addConfiguration'],
    ] as const
    for (const [index, [Constructor, method]] of entries.entries()) {
      const model = new Constructor()
      Object.assign(model, {
        id: index + 1,
        workspaceFolderId: 'child',
        identity: `bundle-${index}`,
        name: `Bundle ${index}`,
        displayName: `Bundle ${index}`,
      })
      if (model instanceof RStore) {
        model.source = STORE_DEFAULT_SOURCE.replace('raw:', 'items:')
      }
      if (model instanceof RStream) {
        model.source = STREAM_DEFAULT_SOURCE
      }
      if (model instanceof RFilter) {
        model.source = FILTER_DEFAULT_SOURCE
      }
      if (model instanceof RVocabs) {
        model.source = VOCAB_DEFAULT_SOURCE
      }
      if (model instanceof RUpdate) {
        model.source = UPDATE_DEFAULT_SOURCE
      }
      if (model instanceof RUpdate) {
        model.storeIdentity = 'bundle-8'
      }
      if (model instanceof RSimulation) {
        model.source
          = 'defineSimulation({ target: composition(\'bundle-2\'), dataMode: \'mock\', overrides: { runtimes: {} } })'
      }
      if (model instanceof RComposition) {
        model.source
          = 'defineComposition({ data: {}, runtimes: {}, resources: {}, outputs: {} })'
      }
      if (model instanceof RType) {
        model.source = TYPE_DEFAULT_SOURCE
      }
      if (model instanceof RStyle) {
        model.source = '/* style comment */ Text { color: red; }'
      }
      if (model instanceof RQuery) {
        model.source = QUERY_DEFAULT_SOURCE
      }
      if (model instanceof RDataView) {
        model.source = DATA_VIEW_DEFAULT_SOURCE
      }
      if (model instanceof RAction) {
        model.source = ACTION_DEFAULT_SOURCE
      }
      if (model instanceof RComputation) {
        model.source = COMPUTATION_DEFAULT_SOURCE
      }
      if (model instanceof RComponentSFC) {
        model.folderId = 'sfc'
        model.source
          = '<template><!-- retained --><Text>Hello</Text></template>'
      }
      (Endge.domain[method] as (value: unknown) => void)(model)
    }
    Endge.configurationSchema.build({} as never)
    Endge.configuration.build({
      dataProvider: 'plain',
      scope: {},
      vars: {},
      context: { facets: { region: 'eu', channel: 'web' } },
    })
    const exceptions: unknown[] = []
    const startSpan = Endge.diagnostics.startSpan.bind(Endge.diagnostics)
    const observe = (
      span: ReturnType<typeof startSpan>,
    ): ReturnType<typeof startSpan> => {
      const record = span.recordException.bind(span)
      const child = span.startChild.bind(span)
      span.recordException = (error, options) => {
        exceptions.push(error)
        return record(error, options)
      }
      span.startChild = (...args) => observe(child(...args))
      return span
    }
    vi.spyOn(Endge.diagnostics, 'startSpan').mockImplementation((...args) =>
      observe(startSpan(...args)),
    )
    Endge.compiler.build({} as never)
    expect(exceptions).toEqual([])
    expect(
      Endge.program
        .getArtifacts()
        .flatMap(value =>
          value.diagnostics.filter(item => item.severity === 'error'),
        ),
    ).toEqual([])
    expect(Endge.program.status).not.toBe('error')
    expect(Endge.program.programId).toBeTruthy()
    for (const artifact of Endge.program.getArtifacts()) {
      Endge.program.getArtifactByRef(artifact.ref)
    }
    expect(
      Endge.program
        .getDiagnostics()
        .filter(item => item.severity === 'error'),
    ).toEqual([])
    const id = Endge.program.programId
    for (const includeAst of [false, true]) {
      const exported = Endge.program.exportBundle({ includeAst })
      expect(exported.programId).toBe(id)
      expect(exported.catalog.folders.child).toMatchObject({ parentId: 'root', scope: 'workspace', icon: 'Monitor', color: '#abcdef' })
      expect(exported.catalog.documents['component-sfc:2']).toMatchObject({ id: '2', folderId: 'sfc', workspaceFolderId: 'child', documentType: 'component-sfc' })
      const invalid = structuredClone(exported)
      Object.assign(invalid.catalog.folders.child!, { icon: 42 })
      expect(() => Endge.program.prepareInstall(invalid)).toThrow('Invalid folder presentation')
      expect(exported.catalog.documents['filter:6']).toMatchObject({ id: '6', identity: 'bundle-5', workspaceFolderId: 'child' })
      for (const key of Object.keys(exported.artifacts)) {
        const invalid = structuredClone(exported)
        invalid.artifacts[key]!.payload = {}
        expect(() => new EndgeProgram_Module().prepareInstall(invalid), key).toThrow()
      }
      for (const artifact of Object.values(exported.artifacts).filter(value =>
        value.ref.identity.startsWith('bundle-'),
      )) {
        expect(
          Boolean((artifact.payload as { ast?: unknown }).ast),
          artifact.ref.entityType,
        ).toBe(includeAst)
      }
      expect(
        new Set(
          Object.values(exported.artifacts).map(
            value => value.ref.entityType,
          ),
        ).size,
      ).toBe(15)
      const codec = new EndgeBundleCodec_Service()
      for (const format of ['json', 'gzip'] as const) {
        const decoded = await codec.decode(
          await codec.encode(
            { format: 'endge-bundle', version: 1, bundle: exported },
            format,
          ),
        )
        const target = new EndgeProgram_Module()
        target.installBundle(target.prepareInstall(decoded.bundle!))
        expect(target.exportBundle({ includeAst })).toEqual(exported)
        const component = target.getArtifact('component-sfc', 'bundle-1')!
        expect(restoreProgramArtifactSource(component)).toEqual(
          includeAst ? expect.stringContaining('<!-- retained -->') : null,
        )
      }
    }
  })
})
