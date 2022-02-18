enum ProgrammingLanguage {
  JavaScript,
  TypeScript,
  HTML,
  CSS,
  Java,
}

function describeProgrammingLanguage(language: ProgrammingLanguage): string {
  switch (language) {
    case ProgrammingLanguage.JavaScript:
      return `Yeah.. It is pretty good.`
    case ProgrammingLanguage.TypeScript:
      return 'Better than javascript.'
    case ProgrammingLanguage.HTML:
      return 'Are you sure that is a programming language?'
    case ProgrammingLanguage.CSS:
      return 'Really?'
    case ProgrammingLanguage.Java:
      return 'Java java!'
    default:
      return `Don't know what you are talking  about..`
  }
}

describe('universe-demo-describeProgrammingLanguage', () => {
  it('it describes javascript', () => {
    const result = describeProgrammingLanguage(ProgrammingLanguage.JavaScript)
    expect(result).toBe('Yeah..  It is pretty good.')
  })

  it('it can not descripe java', () => {
    const result = describeProgrammingLanguage(ProgrammingLanguage.Java)
    expect(result).toBe(`Java java!`)
  })
})
