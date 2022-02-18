/* eslint-disable no-sync */

import { setupFixtureRepository } from '../helpers/repositories'
import { openSync } from '../helpers/temp'
import { validatedRepositoryPath } from '../../src/lib/stores/helpers/validated-repository-path'

describe('validatedRepositoryPath', () => {
  it('returns the path to the repository', async () => {
    const testRepoPath = await setupFixtureRepository('test-repo')
    const result = await validatedRepositoryPath(testRepoPath)
    expect(result).toBe(testRepoPath)
  })

  it('returns null if the path is not a repository', async () => {
    const testRepoPath = openSync('repo-test').path
    const result = await validatedRepositoryPath(testRepoPath)
    expect(result).toBeNull()
  })
})
