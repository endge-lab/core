import type { RuntimeInspectionSnapshot } from '@/features/core/modules/runtime/domain/runtime-inspection.types'

/** Два экземпляра одного документа имеют независимые runtime ids и пути данных. */
export function inspectionFixture(count = 2): RuntimeInspectionSnapshot {
  return {
    version: 1,
    runtime: {
      generatedAt: 10,
      total: count,
      byStatus: { running: count },
      deletedTotal: 0,
      deletedHosts: [],
      scopes: [],
      hosts: Array.from({ length: count }, (_, index) => ({
        id: `host-${index}`,
        parentId: null,
        basePath: `runtime.instance${index}`,
        entityType: 'store',
        entityIdentity: 'shared-store',
        runtimeType: 'StoreRuntimeHost',
        title: `Instance ${index}`,
        status: 'running',
        createdAt: index + 1,
        updatedAt: 10,
        removedAt: null,
        resources: [],
        channels: [],
        capabilities: [],
        meta: {},
        context: {},
      })),
    },
    data: { runtime: { instance0: { rows: [{ id: 1 }] }, instance1: { rows: [{ id: 2 }] } } },
    dataGeneratedAt: 10,
  }
}
