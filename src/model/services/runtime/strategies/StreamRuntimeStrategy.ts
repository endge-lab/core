import type { RuntimeStrategy } from '@/domain/types/runtime/runtime-strategy.types'
import { RStream } from '@/domain/entities/reflect/RStream'
import { StreamRuntimeHost } from '@/domain/entities/runtime/hosts/StreamRuntimeHost'
import { BrowserSseStreamTransportFactory } from '@/model/services/runtime/transports/BrowserSseStreamTransportFactory'

export class StreamRuntimeStrategy implements RuntimeStrategy<RStream, StreamRuntimeHost> {
  public readonly id = 'runtime:stream'
  public readonly entityType = 'stream' as const

  public supports(model: unknown): model is RStream {
    return model instanceof RStream || (model as any)?.type === 'stream'
  }

  public create(ctx: Parameters<RuntimeStrategy<RStream, StreamRuntimeHost>['create']>[0]) {
    const injectedFactory = ctx.meta.streamTransportFactory
    const transportFactory = injectedFactory && typeof injectedFactory.open === 'function'
      ? injectedFactory
      : new BrowserSseStreamTransportFactory()
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
