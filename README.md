# @endge/core

Endge Core owns Domain documents, Source compilation, the validated Program registry and runtime lifecycle. Renderers consume compiled contracts; runtime does not parse authored Source. Public TypeScript API is exported from the package entrypoint.

## Controllers

Controllers require Core `1.2.0-dev.15` (compiler `program-v5`). Controllers are code-owned definitions and local providers executed as registered, parent-owned runtime hosts. They are not persisted documents and have no `/controllers` collection. A definition is serializable; a provider factory stays executable host code and never enters a Bundle.

```ts
// Source fragment inside a Composition; dependencies must exist in that workspace.
runtimes: {
  window: controller('endge.collection-window')
    .withProps({ paging: 'cursor', batchSize: 100, maxLoadedRows: 1000 })
    .withDependencies({
      state: { store: data('state'), path: 'window', update: 'window-commit' },
      load: { query: 'window-page', output: 'page' },
    }),
}
```

Host SDK: `Endge.runtime.controllers.define(definition)`, `provide({identity,key,create})` and `await mount(identity,{owner,props,dependencies,instanceId?})`. Owner is an actual registered host or its id. Instances support props, commands, output snapshots/subscriptions and async disposal through the same runtime registry as Composition. Unregister is rejected while instances are active.

Provider callbacks receive operation contexts: `start(context)`, `setProps(props,context)`, `command(name,input,context)`, `pause()`, `resume(context)`, `destroy()`. Capture the callback's context for async work; do not retain the factory context across lifecycle or props generations. Context props are frozen snapshots. Pause, changed props and teardown invalidate old publications, Store commits, Query starts and command completions. Provider-owned external effects must honor cancellation too.

The built-in `endge.collection-window` supports cursor and offset/limit, bidirectional demand, one active Query, generation cancellation, key deduplication and a retained contiguous memory window. Store holds `{revision,rowsRevision,blocks}`. A guarded Update atomically sets the whole state from `input('next')` only when its revision equals `input('expectedRevision')`; the adapter verifies the commit. Query owns transport; Controller owns loading/error, demand, retention and retry. Table owns viewport geometry and scroll anchor, with `@endge/ui-vue@2.0.0-dev.14`.

The row cap is soft: visible rows, prefetch corridor and explicitly retained keys protect blocks. Applications call retain/release for dirty editors; detection is not automatic. With no `load.cache`, evicted pages are fetched again. Optional memory/IndexedDB page caching has separate budgets and freshness policies, described below. There is no global server scrollbar, remote seek or timer-driven TTL deletion. Server ordering/filtering and continuation metadata must be correct.

Full Source and SDK examples accompany Docs `0.11.0`: `docs/reference/controllers.md`, `docs/guides/collection-window.md`, `docs/agents/controllers.md`, and `docs/public/examples/controllers/`. Install the exact Core and UI Vue versions above. The historical Core `1.2.13` does not include Controllers.

## Bundles

Compiler builds controller definition artifacts and `requirements.hostControllers` (identity/providerKey). Program/Execution Bundle carries definitions and capability requirements, not factories. The target host must register the matching provider; missing provider fails explicitly. Runtime executes the compiled contract, including SDK mounts. Older bundles without this optional requirement remain readable; source changes require the current compiler snapshot.

## Local verification

Use the package scripts for build, lint and typecheck. Run tests only when authorized by the task. A successful Source compile does not prove network, renderer or deployment readiness. The documentation examples execute a built Core and use its own dependency graph.


### Retention and page cache

`endge.collection-window` accepts `retention: { beforeRows, afterRows }` independently of the soft `maxLoadedRows` cap. Its Query binding may declare `cache: { key, storage: 'memory' | 'indexeddb', strategy, maxAgeMs, maxStaleMs, onError, maxEntries, maxBytes }`. Omit cache to preserve the existing Query-only path. Cache data is separate from Store and execution bundles.

`cache-first`, `network-first`, and `stale-while-revalidate` share the normal Query pipeline. Value-only revalidation preserves row order and anchor; structural changes expose `refreshPending` and stop extension until explicit `refresh`. `clearCache` preserves active rows; `reset` preserves cached pages. Retain protects eviction, not unsaved edits. IndexedDB is a bounded best-effort cache with observable write completion, not a complete offline database.

See `guides/collection-window-cache` in the documentation source and `docs/public/examples/controllers/page-cache.mjs` for executable Source and SDK examples. Install the exact versions listed above when running these examples.
