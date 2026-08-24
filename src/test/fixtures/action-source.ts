export const ACTION_SOURCE_WITH_OPERATION = `defineAction({
  contract: {
    input: field('Object'),
    output: field('Object'),
  },
  steps: {
    normalized: input('value').convert('string-trim').upperCase(),
    validation: computation('schedule.validate-carrier', {
      value: output('normalized'),
    }),
    edit: operation({
      input: {
        id: input('id'),
        value: output('normalized'),
        previousValue: input('previousValue'),
      },
      run: {
        steps: {
          remote: query({ identity: 'schedule-update', input: input() }),
        },
        output: output('remote'),
      },
      undo: {
        steps: {
          remote: query({ identity: 'schedule-update', input: input() }),
        },
        output: output('remote'),
      },
    }),
  },
  output: {
    value: output('normalized'),
    validation: output('validation'),
    request: output('edit'),
  },
})`
