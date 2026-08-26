# @endge/core

Core компилирует persisted Source в `Endge.program` и исполняет только готовые Program artifacts. Runtime hosts владеют live-state и внешними ресурсами; renderer получает производную модель и не становится вторым источником истины.

## Source-first Vocab

```ts
defineVocab({
  provider: payload({
    baseUrl: env('ENDPOINT_VOCABS_SERVICE'),
    collection: 'airlines',
    auth: { mode: 'inherit' },
  }),
  mock: mock('aodb-fixtures').path('lookups.airlines'),
  outputs: {
    items: output().from(response()),
  },
})
```

`vocab('airlines')` в Composition продолжает ссылаться на identity документа. В live-режиме Payload reader агрегирует страницы и применяет ordered DataView/Converter pipeline. В mock-режиме provider, auth и SSE не запускаются: используется explicit Mock JSON или `[]`.

Полный нормативный контракт находится в `docs/frontend/packages/core/contracts/vocab-source.md` корневого монорепозитория.
