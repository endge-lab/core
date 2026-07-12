export const COMPOSITION_DEFAULT_SOURCE = `defineComposition({
  runtimes: {
    query: query('query-identity')
      .withProps({}),
  },

  hooks: [
    onMount().run('query'),
  ],

  outputs: {
    query: output().fromRuntime('query'),
  },
})
`
