import type { EndgeBundle } from '@/features/core/kernel/types/endge-bundle.types'
import type { EndgePortableDocuments } from '@/features/core/modules/domain/types/document/domain-export.type'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Raph } from '@raphy-js/raph'
import { afterEach, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { EndgeBundleCodec_Service } from '@/features/core/kernel/services/EndgeBundleCodec_Service'
import { collectDeliveryModules, selectDeliveryProgram } from '@/features/core/kernel/tools/bundle-delivery'
import { QUERY_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/query.default.source'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'
import { createTenantInspectorBundle } from '@/test/fixtures/tenant-inspector-bundle'

const open = { scope: { workspaceIdentity: 'workspace-test' }, vars: {} }
const facet = (identity: string) => ({ id: identity, identity, displayName: identity })
function document(facetIdentity: string, identity: string, patch = {}) {
  return {
    ...facet(identity),
    id: `${facetIdentity}/${identity}`,
    facetIdentity,
    configuration: { mode: 'inherit', patch },
  }
}
function query(identity: string) {
  return {
    ...facet(identity),
    sourceVersion: 2,
    source: QUERY_DEFAULT_SOURCE.replace('endpoint: \'\'', `endpoint: 'https://${identity}.example.test'`),
  }
}

afterEach(async () => {
  await Endge.reset()
  Raph.reset()
})

it('packs and boots the selected tenant and all selected channels without foreign artifacts or modules', async () => {
  const legacySelection = { tenant: 'customer-b', deployment: 'staging', channel: 'web' }
  const deliveryFacets = { tenant: 'customer-a', deployment: 'production', channel: 'mobile' }
  const baseModule = { identity: 'foreign-module-b', version: '1.0.0', rendererId: 'foreign' }
  const selectedModule = { identity: 'selected-module-a', version: '2.0.0', rendererId: 'selected' }
  const timelineModule = { identity: 'rms-ui', version: '1.0.0' }
  const timelinePresets = ['rms-load', 'rms-shifts'].map(name => ({ ...timelineModule, name }))
  const rendererPatch = { defaultRenderers: { Table: { op: 'set', value: selectedModule } }, vars: { entries: [
    { op: 'upsert', key: 'selected-var', value: { name: 'selected-var', defaultValue: 'TENANT_A_PRIVATE' } },
  ] } }
  const base = createTenantInspectorBundle()
  const documents = Object.fromEntries(Object.keys(base.documents).map(key => [key, []])) as unknown as EndgePortableDocuments
  const workspace = { ...TEST_ENDGE_WORKSPACE, startupCompositionIdentity: 'app' }
  vi.spyOn(Endge.bridge, 'start').mockImplementation(() => {})
  await Endge.boot({
    ...open,
    dataProvider: 'bundle',
    context: { facets: legacySelection },
    bundleSource: {
      ...base,
      workspace: {
        ...workspace,
        dataMode: 'production',
        configuration: {
          ...workspace.configuration,
          defaultRenderers: { Table: baseModule, Badge: { identity: 'unused-badge', version: '1.0.0', rendererId: 'badge' } },
          timelinePresets,
        },
      },
      installedIntegrations: [],
      documents: {
        ...documents,
        'facets': [facet('tenant'), facet('deployment'), facet('channel')],
        'facet-documents': [
          document('tenant', 'customer-a', rendererPatch),
          document('tenant', 'customer-b', { vars: { entries: [
            { op: 'upsert', key: 'foreign-var', value: { name: 'foreign-var', defaultValue: 'TENANT_B_PRIVATE' } },
          ] } }),
          document('channel', 'web'),
          document('channel', 'mobile'),
          document('deployment', 'production'),
          document('deployment', 'staging', { vars: { entries: [
            { op: 'upsert', key: 'stage-var', value: { name: 'stage-var', defaultValue: 'STAGING_PRIVATE' } },
          ] } }),
        ],
        'queries': [query('selected-web'), query('selected-mobile'), query('customer-b-private'), query('selected-tenant-unreachable')],
        'components': [{ ...facet('selected-table'), modelVersion: 1, source: '<template><Table :rows="[]" /></template>' }],
        'compositions': [{
          ...facet('app'),
          source: `defineComposition({ runtimes: { screen: contextSwitch({
          default: composition('customer-b-branch'),
          cases: [{ when: { tenant: 'customer-a' }, use: composition('customer-a-branch') }],
        }) } })`,
        }, {
          ...facet('customer-a-branch'),
          source: `defineComposition({
          resources: { visual: module('selected-module-a', '2.0.0') },
          runtimes: { table: component('selected-table'), request: contextSwitch({
            default: query('selected-web'),
            cases: [{ when: { channel: 'mobile' }, use: query('selected-mobile') }],
          }) },
        })`,
        }, {
          ...facet('customer-b-branch'),
          source: `defineComposition({
          resources: { visual: module('foreign-module-b', '1.0.0') },
          runtimes: { request: query('customer-b-private') },
        })`,
        }],
      },
    },
  })

  const result = await Endge.buildSavedDelivery({
    tenant: { mode: 'one', identity: 'customer-a' },
    deployment: { mode: 'one', identity: 'production' },
    channel: { mode: 'all' },
  })
  expect(Endge.context.getExecutionContext().facets).toEqual(legacySelection)
  expect(result.bundles).toHaveLength(2)
  for (const variant of result.bundles) {
    expect(variant.context.configuration.defaultRenderers?.Table).toEqual(selectedModule)
    expect(variant.context.configuration.timelinePresets).toEqual(timelinePresets)
    expect(collectDeliveryModules(variant)).toEqual([{ identity: selectedModule.identity, version: selectedModule.version }, timelineModule])
  }
  await expect(Endge.buildSavedDelivery({ tenant: { mode: 'all' }, channel: { mode: 'all' }, deployment: { mode: 'all' } })).rejects.toThrow('single tenant')
  const [bundle, ...variants] = result.bundles
  const packed: EndgeBundle = {
    format: 'endge-bundle',
    version: 2,
    bundle,
    delivery: {
      variants,
      modules: [{
        manifest: { identity: selectedModule.identity, version: selectedModule.version, formatVersion: 1, hostApi: 1 },
        js: `export default ({ vue }) => ({
          setup(context) {
            context.register('endge.vue.renderers', 'Table/selected', () => vue.h('div', { class: 'selected' }, 'SELECTED_MODULE_PAYLOAD'))
          },
          load() {}, build() {}, start() {}, reset() {},
        })`,
        css: ':scope { color: rgb(255, 0, 0); }',
      }, {
        manifest: { ...timelineModule, formatVersion: 1, hostApi: 1 },
        js: 'export default () => ({})',
      }],
    },
  }
  const codec = new EndgeBundleCodec_Service()
  const bytes = await codec.encode(packed, 'gzip')
  if (process.env.ENDGE_BUNDLE_REVIEW_DIR) {
    mkdirSync(process.env.ENDGE_BUNDLE_REVIEW_DIR, { recursive: true })
    writeFileSync(join(process.env.ENDGE_BUNDLE_REVIEW_DIR, 'customer-a.endge-bundle.gz'), bytes)
  }
  const decoded = await codec.decode(bytes)
  const serialized = JSON.stringify(decoded)
  for (const forbidden of ['customer-b', 'foreign-module-b', 'TENANT_B_PRIVATE', 'STAGING_PRIVATE', 'selected-tenant-unreachable', 'unused-badge', 'contextSwitch']) {
    expect(serialized).not.toContain(forbidden)
  }
  expect(serialized).toContain('TENANT_A_PRIVATE')
  expect(serialized).toContain('SELECTED_MODULE_PAYLOAD')
  expect(decoded.delivery?.modules).toHaveLength(2)
  const selected = selectDeliveryProgram(decoded.bundle!, decoded.delivery!, deliveryFacets)
  expect(Object.values(selected.artifacts).map(artifact => artifact.ref.identity)).toEqual(expect.arrayContaining(['app', 'customer-a-branch', 'selected-mobile']))
  expect(JSON.stringify(selected)).not.toContain('selected-web')
  expect(() => selectDeliveryProgram(decoded.bundle!, decoded.delivery!, legacySelection)).toThrow('No program')
  const withForeign = structuredClone(packed)
  const foreign = Endge.program.exportBundle({ scope: 'startup-composition' }).artifacts['query:customer-b-private']!
  withForeign.bundle!.artifacts['query:customer-b-private'] = foreign
  await expect(codec.encode(withForeign)).rejects.toThrow('Unreachable documents or artifacts')
  await expect(codec.encode({
    ...packed,
    delivery: { ...packed.delivery!, modules: [
      ...packed.delivery!.modules!,
      { manifest: { identity: baseModule.identity, version: baseModule.version, formatVersion: 1, hostApi: 1 }, js: 'foreign' },
    ] },
  })).rejects.toThrow('unrelated delivery module')
  await expect(codec.encode({
    ...packed,
    delivery: { ...packed.delivery!, modules: packed.delivery!.modules!.slice(0, 1) },
  })).rejects.toThrow('Missing delivery modules')

  await Endge.reset()
  const moduleLoader = vi.fn(async () => ({ create: () => ({ setup() {}, load() {}, build() {}, start() {}, reset() {} }) }))
  await Endge.bootDelivery(decoded, deliveryFacets, { ...open, moduleLoader })
  const session = await Endge.runtime.mountStartup()
  expect(Endge.program.getQueryArtifact('selected-mobile')).toBeTruthy()
  expect(Endge.program.getQueryArtifact('customer-b-private')).toBeNull()
  expect(moduleLoader).toHaveBeenCalledTimes(1)
  expect(moduleLoader).toHaveBeenCalledWith({ identity: selectedModule.identity, version: selectedModule.version }, expect.any(AbortSignal))
  await Endge.runtime.prepareWorkspaceModules()
  expect(moduleLoader).toHaveBeenCalledWith(timelineModule, expect.any(AbortSignal))
  await session.unmount()
})
