export const COMPOSITION_DEFAULT_SOURCE = `defineComposition({
  runtimes: {
    query: query('query-identity')
      .withProps({}),
  },

  reactions: [
    onMount().run('query'),
  ],

  outputs: {
    query: output().fromRuntime('query'),
  },
})
`
