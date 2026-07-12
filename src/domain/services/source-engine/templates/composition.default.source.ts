export const COMPOSITION_DEFAULT_SOURCE = `defineComposition({
  data: {},

  runtimes: {
    query: query('query-identity')
      .withProps({}),
  },

  hooks: [
    onMount().run('query'),
  ],

  outputs: {},
})
`
