import type { EndgeDomainPlain } from '@/domain/types/document/domain-export.type'

import { EndgeDomain } from '@/model/modules/domain/endge-domain'

/** Преобразует локальный Domain в serializable snapshot и восстанавливает его без transport-зависимостей. */
export class DomainSnapshotCodec {
  /** Сериализует текущее persisted-состояние Domain в plain object. */
  public serialize(domain: EndgeDomain): EndgeDomainPlain {
    return domain.toPlain()
  }

  /** Восстанавливает независимый Domain из локального plain snapshot. */
  public deserialize(snapshot: EndgeDomainPlain): EndgeDomain {
    return EndgeDomain.fromPlain(snapshot)
  }
}
