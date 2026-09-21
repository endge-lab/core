export const COMPOSITION_DEFAULT_SOURCE = `defineComposition({
  activateOn: manual(),

  data: {},

  resources: {},

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
