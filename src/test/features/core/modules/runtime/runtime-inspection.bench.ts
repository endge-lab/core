import { bench, describe } from 'vitest'
import { serializeDiagnosticsJson } from '@/features/core/modules/diagnostics/domain/diagnostics-snapshot'
import { EndgeRuntime_Module } from '@/features/core/modules/runtime/EndgeRuntime_Module'
import { inspectionFixture } from './fixtures/runtime-inspection'

const snapshot = inspectionFixture(1000)
snapshot.data = { rows: Array.from({ length: 10_000 }, (_, id) => ({ id, name: `Row ${id}`, value: id * 2 })) }
snapshot.render = {
  styles: [],
  hosts: Object.fromEntries(snapshot.runtime.hosts.map(host => [host.id, {
    kind: 'component-sfc' as const,
    input: { kind: 'raph' as const, bindings: { rows: { path: 'rows' } } },
    computations: [{ identity: 'total', input: { count: 10 }, status: 'success' as const, loading: false, value: 20, error: null }],
    dataMeta: {},
  }])),
}
const runtime = new EndgeRuntime_Module()
runtime.setup({ mode: 'debugger', scope: {}, vars: {} })
runtime.applyInspectionSnapshot(snapshot)
const options = { time: 300, warmupTime: 100, iterations: 10 }

/** Ограниченный синтетический профиль сравнивает цену полных данных и лёгких статусов. */
describe('runtime inspection: 1000 hosts и 10000 строк', () => {
  bench('сериализация JSON-safe снимка с данными', () => {
    JSON.stringify(serializeDiagnosticsJson(snapshot).value)
  }, options)
  bench('проверка и импорт готового снимка', () => {
    runtime.applyInspectionSnapshot(snapshot)
  }, options)
  bench('применение одного статуса без сериализации данных', () => {
    runtime.applyInspectionEvent({ id: 'host-500', previous: 'running', value: 'paused' })
  }, options)
})
