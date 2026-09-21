export const DATA_VIEW_DEFAULT_SOURCE = `defineDataView({
  mode: 'pipeline',

  steps: [
    from('legs').as('leg'),

    join('attrs').by({
      left: 'leg.id',
      right: 'legId',
      as: 'legAttrs',
    }),

    map({
      ...spread('leg'),

      attrs: path('legAttrs.items'),
    }),
  ],
})
`
