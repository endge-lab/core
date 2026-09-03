import type { EndgeDomainPlain } from '@/domain/types/document/domain-export.type'
import type { EndgeDomain_Module } from '@/model/modules/domain/EndgeDomain_Module'

/** Преобразует локальный Domain в serializable snapshot и восстанавливает его без transport-зависимостей. */
export class DomainSnapshotCodec {
  private readonly _materialize: (snapshot: EndgeDomainPlain) => EndgeDomain_Module

  /** Получает materializer явно и не зависит от глобальной Federation. */
  public constructor(materialize: (snapshot: EndgeDomainPlain) => EndgeDomain_Module) {
    this._materialize = materialize
  }

  /** Сериализует текущее persisted-состояние Domain в plain object. */
  public serialize(domain: EndgeDomain_Module): EndgeDomainPlain {
    return domain.toPlain()
  }

  /** Восстанавливает независимый Domain из локального plain snapshot. */
  public deserialize(snapshot: EndgeDomainPlain): EndgeDomain_Module {
    return this._materialize(snapshot)
  }
}
