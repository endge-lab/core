/** Базовый source нового Filter v1. */
export const FILTER_DEFAULT_SOURCE = `defineFilter({
  fields: {
    search: field('String')
      .optional()
      .default(''),
  },

  outputs: {
    request: output().json(({ value }) =>
      compact({
        where: {
          search: value('search'),
        },
      }),
    ),
  },
})
`
