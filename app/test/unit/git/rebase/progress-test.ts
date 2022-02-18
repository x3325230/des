import { IStatusResult } from '../../../../src/lib/git'
import {
  rebase,
  RebaseResult,
  getRebaseSnapshot,
} from '../../../../src/lib/git'
import { createRepository as createShortRebaseTest } from '../../../helpers/repository-builder-rebase-test'
import { createRepository as createLongRebaseTest } from '../../../helpers/repository-builder-long-rebase-test'
import { getStatusOrThrow } from '../../../helpers/status'
import { GitRebaseSnapshot } from '../../../../src/models/rebase'
import { setupEmptyDirectory } from '../../../helpers/repositories'
import { getBranchOrError } from '../../../helpers/git'

const baseBranchName = 'base-branch'
const featureBranchName = 'this-is-a-feature'

describe('git/rebase', () => {
  describe('skips a normal repository', () => {
    it('returns null for rebase progress', async () => {
      const repository = await setupEmptyDirectory()

      const progress = await getRebaseSnapshot(repository)

      expect(progress).toEqual(null)
    })
  })

  describe('can parse progress', () => {
    let result: RebaseResult
    let snapshot: GitRebaseSnapshot | null
    let status: IStatusResult

    beforeEach(async () => {
      const repository = await createShortRebaseTest(
        baseBranchName,
        featureBranchName
      )

      const featureBranch = await getBranchOrError(
        repository,
        featureBranchName
      )

      const baseBranch = await getBranchOrError(repository, baseBranchName)

      result = await rebase(repository, baseBranch, featureBranch)

      snapshot = await getRebaseSnapshot(repository)

      status = await getStatusOrThrow(repository)
    })

    it('returns a value indicating conflicts were encountered', () => {
      expect(result).toBe(RebaseResult.ConflictsEncountered)
    })

    it('status detects REBASE_HEAD', () => {
      expect(snapshot).not.toEqual(null)
      const s = snapshot!
      expect(s.commits.length).toEqual(1)
      expect(s.commits[0].summary).toEqual('Feature Branch!')

      expect(s.progress.rebasedCommitCount).toEqual(1)
      expect(s.progress.totalCommitCount).toEqual(1)
      expect(s.progress.currentCommitSummary).toEqual('Feature Branch!')
      expect(s.progress.value).toEqual(1)
    })

    it('is a detached HEAD state', () => {
      expect(status.currentBranch).toBeUndefined()
    })
  })

  describe('can parse progress for long rebase', () => {
    let result: RebaseResult
    let snapshot: GitRebaseSnapshot | null
    let status: IStatusResult

    beforeEach(async () => {
      const repository = await createLongRebaseTest(
        baseBranchName,
        featureBranchName
      )

      const featureBranch = await getBranchOrError(
        repository,
        featureBranchName
      )

      const baseBranch = await getBranchOrError(repository, baseBranchName)

      result = await rebase(repository, baseBranch, featureBranch)

      snapshot = await getRebaseSnapshot(repository)

      status = await getStatusOrThrow(repository)
    })

    it('returns a value indicating conflicts were encountered', () => {
      expect(result).toBe(RebaseResult.ConflictsEncountered)
    })

    it('status detects REBASE_HEAD', () => {
      expect(snapshot).not.toEqual(null)
      const s = snapshot!
      expect(s.commits.length).toEqual(10)
      expect(s.commits[0].summary).toEqual('Feature Branch First Commit!')

      expect(s.progress.rebasedCommitCount).toEqual(1)
      expect(s.progress.totalCommitCount).toEqual(10)
      expect(s.progress.currentCommitSummary).toEqual(
        'Feature Branch First Commit!'
      )
      expect(s.progress.value).toEqual(0.1)
    })

    it('is a detached HEAD state', () => {
      expect(status.currentBranch).toBeUndefined()
    })
  })
})
