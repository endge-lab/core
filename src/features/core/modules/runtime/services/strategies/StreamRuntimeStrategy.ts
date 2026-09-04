import type { RuntimeStrategy } from '@/features/core/modules/runtime/domain/runtime-strategy.types'
import type { ResolveAuthSession } from '@/features/core/modules/runtime/services/transports/BrowserSseStreamTransportFactory'
import { RStream } from '@/features/core/modules/domain/entities/RStream'
import { StreamRuntimeHost } from '@/features/core/modules/runtime/hosts/StreamRuntimeHost'
import { BrowserSseStreamTransportFactory } from '@/features/core/modules/runtime/services/transports/BrowserSseStreamTransportFactory'

export class StreamRuntimeStrategy implements RuntimeStrategy<RStream, StreamRuntimeHost> {
  public readonly id = 'runtime:stream'
  public readonly entityType = 'stream' as const

  public constructor(private readonly _resolveAuthSession: ResolveAuthSession) {}

  public supports(model: unknown): model is RStream {
    return model instanceof RStream || (model as any)?.type === 'stream'
  }

  public create(ctx: Parameters<RuntimeStrategy<RStream, StreamRuntimeHost>['create']>[0]) {
    const injectedFactory = ctx.meta.streamTransportFactory
    const transportFactory = injectedFactory && typeof injectedFactory.open === 'function'
      ? injectedFactory
      : new BrowserSseStreamTransportFactory(this._resolveAuthSession)
    return StreamRuntimeHost.createRuntime({
      id: ctx.id,
      model: ctx.model,
      meta: ctx.meta,
      parent: ctx.parent,
      artifacts: ctx.artifacts,
      transportFactory,
    })
  }
}
