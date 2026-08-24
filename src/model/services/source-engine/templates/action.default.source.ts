export const ACTION_DEFAULT_SOURCE = `defineAction({
  contract: {
    input: field('Object'),
    output: field('Object'),
  },

  steps: {
    result: input(),
  },

  output: output('result'),
})
`
