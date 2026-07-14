# Service layer

`model/services` — явный service layer ядра. Он содержит application и engine operations, которые координируют domain entities, runtime contracts и внешние dependencies.

## Placement rule

Путь строится по формуле:

```text
model/services/<subsystem>/<role>.ts
```

- `auth`, `query`, `runtime`, `source-engine`, `compiler`, `document` обозначают subsystem-владельца.
- `Executor`, `Registry`, `Strategy`, `Client`, `Compiler`, `Controller` обозначают точную роль class.
- `Service` используется только для service facade, когда более точного role name нет.
- Shared/public contracts живут в `domain/types/<subsystem>`, а не рядом с implementation.
- Local implementation types остаются рядом с единственным владельцем.

## Naming

Class-based files используют точное имя exported class:

```text
QueryExecutor.ts           -> QueryExecutor
RuntimeStrategyRegistry.ts -> RuntimeStrategyRegistry
KeycloakAuthClient.ts      -> KeycloakAuthClient
AuthTokenService.ts        -> AuthTokenService
```

Functional modules используют kebab-case:

```text
component-sfc-compile.ts
source-expression-evaluate.ts
table-commands.ts
```

Не используй `_Service`, `ServiceName_Service.ts` или `.service.ts`.
