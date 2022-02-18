import { shell } from '../../helpers/test-app-shell'
import {
  setupEmptyRepository,
  setupFixtureRepository,
  setupLocalForkOfRepository,
} from '../../helpers/repositories'

import { Repository } from '../../../src/models/repository'
import {
  TipState,
  IDetachedHead,
  IValidBranch,
  IUnbornRepository,
} from '../../../src/models/tip'
import { GitStore } from '../../../src/lib/stores'
import { GitProcess } from 'dugite'
import {
  getBranchesPointedAt,
  createBranch,
  deleteBranch,
  getBranches,
  git,
  checkoutBranch,
} from '../../../src/lib/git'
import { StatsStore, StatsDatabase } from '../../../src/lib/stats'
import { UiActivityMonitor } from '../../../src/ui/lib/ui-activity-monitor'
import { assertNonNullable } from '../../../src/lib/fatal-error'

describe('git/branch', () => {
  let statsStore: StatsStore

  beforeEach(() => {
    statsStore = new StatsStore(
      new StatsDatabase('test-StatsDatabase'),
      new UiActivityMonitor()
    )
  })

  describe('tip', () => {
    it('returns unborn for new repository', async () => {
      const repository = await setupEmptyRepository()

      const store = new GitStore(repository, shell, statsStore)
      await store.loadStatus()
      const tip = store.tip

      expect(tip.kind).toEqual(TipState.Unborn)
      const unborn = tip as IUnbornRepository
      expect(unborn.ref).toEqual('master')
    })

    it('returns correct ref if checkout occurs', async () => {
      const repository = await setupEmptyRepository()

      await GitProcess.exec(['checkout', '-b', 'not-master'], repository.path)

      const store = new GitStore(repository, shell, statsStore)
      await store.loadStatus()
      const tip = store.tip

      expect(tip.kind).toEqual(TipState.Unborn)
      const unborn = tip as IUnbornRepository
      expect(unborn.ref).toEqual('not-master')
    })

    it('returns detached for arbitrary checkout', async () => {
      const path = await setupFixtureRepository('detached-head')
      const repository = new Repository(path, -1, null, false)

      const store = new GitStore(repository, shell, statsStore)
      await store.loadStatus()
      const tip = store.tip

      expect(tip.kind).toEqual(TipState.Detached)
      const detached = tip as IDetachedHead
      expect(detached.currentSha).toEqual(
        '2acb028231d408aaa865f9538b1c89de5a2b9da8'
      )
    })

    it('returns current branch when on a valid HEAD', async () => {
      const path = await setupFixtureRepository('repo-with-many-refs')
      const repository = new Repository(path, -1, null, false)

      const store = new GitStore(repository, shell, statsStore)
      await store.loadStatus()
      const tip = store.tip

      expect(tip.kind).toEqual(TipState.Valid)
      const onBranch = tip as IValidBranch
      expect(onBranch.branch.name).toEqual('commit-with-long-description')
      expect(onBranch.branch.tip.sha).toEqual(
        'dfa96676b65e1c0ed43ca25492252a5e384c8efd'
      )
      expect(onBranch.branch.tip.author.name).toEqual('Brendan Forster')
    })

    it('returns non-origin remote', async () => {
      const path = await setupFixtureRepository('repo-with-multiple-remotes')
      const repository = new Repository(path, -1, null, false)

      const store = new GitStore(repository, shell, statsStore)
      await store.loadStatus()
      const tip = store.tip

      expect(tip.kind).toEqual(TipState.Valid)
      const valid = tip as IValidBranch
      expect(valid.branch.remote).toEqual('bassoon')
    })
  })

  describe('upstreamWithoutRemote', () => {
    it('returns the upstream name without the remote prefix', async () => {
      const path = await setupFixtureRepository('repo-with-multiple-remotes')
      const repository = new Repository(path, -1, null, false)

      const store = new GitStore(repository, shell, statsStore)
      await store.loadStatus()
      const tip = store.tip

      expect(tip.kind).toEqual(TipState.Valid)

      const valid = tip as IValidBranch
      expect(valid.branch.remote).toEqual('bassoon')
      expect(valid.branch.upstream).toEqual('bassoon/master')
      expect(valid.branch.upstreamWithoutRemote).toEqual('master')
    })
  })

  describe('getBranchesPointedAt', () => {
    let repository: Repository
    describe('in a local repo', () => {
      beforeEach(async () => {
        const path = await setupFixtureRepository('test-repo')
        repository = new Repository(path, -1, null, false)
      })

      it('finds one branch name', async () => {
        const branches = await getBranchesPointedAt(repository, 'HEAD')
        expect(branches).toHaveLength(1)
        expect(branches![0]).toEqual('master')
      })

      it('finds no branch names', async () => {
        const branches = await getBranchesPointedAt(repository, 'HEAD^')
        expect(branches).toHaveLength(0)
      })

      it('returns null on a malformed committish', async () => {
        const branches = await getBranchesPointedAt(repository, 'MERGE_HEAD')
        expect(branches).toBeNull()
      })
    })

    describe('in a repo with identical branches', () => {
      beforeEach(async () => {
        const path = await setupFixtureRepository('repo-with-multiple-remotes')
        repository = new Repository(path, -1, null, false)
        await createBranch(repository, 'other-branch', null)
      })
      it('finds multiple branch names', async () => {
        const branches = await getBranchesPointedAt(repository, 'HEAD')
        expect(branches).toHaveLength(2)
        expect(branches).toContain('other-branch')
        expect(branches).toContain('master')
      })
    })
  })

  describe('deleteBranch', () => {
    let repository: Repository

    beforeEach(async () => {
      const path = await setupFixtureRepository('test-repo')
      repository = new Repository(path, -1, null, false)
    })

    it('deletes local branches', async () => {
      const name = 'test-branch'
      await createBranch(repository, name, null)
      const [branch] = await getBranches(repository, `refs/heads/${name}`)
      assertNonNullable(branch, `Could not create branch ${name}`)

      const ref = `refs/heads/${name}`

      expect(branch).not.toBeNull()
      expect(await getBranches(repository, ref)).toBeArrayOfSize(1)

      await deleteBranch(repository, branch!, null, false)

      expect(await getBranches(repository, ref)).toBeArrayOfSize(0)
    })

    it('deletes remote branches', async () => {
      const name = 'test-branch'
      const branch = await createBranch(repository, name, null)
      const localRef = `refs/heads/${name}`

      expect(branch).not.toBeNull()
      expect(await getBranches(repository, localRef)).toBeArrayOfSize(1)

      const fork = await setupLocalForkOfRepository(repository)

      const remoteRef = `refs/remotes/origin/${name}`
      const [remoteBranch] = await getBranches(fork, remoteRef)
      expect(remoteBranch).not.toBeUndefined()

      await checkoutBranch(fork, null, remoteBranch)
      await git(['checkout', '-'], fork.path, 'checkoutPrevious')

      expect(await getBranches(fork, localRef)).toBeArrayOfSize(1)
      expect(await getBranches(repository, localRef)).toBeArrayOfSize(1)

      const [localBranch] = await getBranches(fork, localRef)
      expect(localBranch).not.toBeUndefined()

      await deleteBranch(fork, localBranch, null, true)

      expect(await getBranches(fork, localRef)).toBeArrayOfSize(0)
      expect(await getBranches(fork, remoteRef)).toBeArrayOfSize(0)
      expect(await getBranches(repository, localRef)).toBeArrayOfSize(0)
    })

    it('handles attempted delete of removed remote branch', async () => {
      const name = 'test-branch'
      const branch = await createBranch(repository, name, null)
      const localRef = `refs/heads/${name}`

      expect(branch).not.toBeNull()
      expect(await getBranches(repository, localRef)).toBeArrayOfSize(1)

      const fork = await setupLocalForkOfRepository(repository)

      const remoteRef = `refs/remotes/origin/${name}`
      const [remoteBranch] = await getBranches(fork, remoteRef)
      expect(remoteBranch).not.toBeUndefined()

      await checkoutBranch(fork, null, remoteBranch)
      await git(['checkout', '-'], fork.path, 'checkoutPrevious')

      expect(await getBranches(fork, localRef)).toBeArrayOfSize(1)
      expect(await getBranches(repository, localRef)).toBeArrayOfSize(1)

      const [upstreamBranch] = await getBranches(repository, localRef)
      expect(upstreamBranch).not.toBeUndefined()
      await deleteBranch(repository, upstreamBranch, null, true)
      expect(await getBranches(repository, localRef)).toBeArrayOfSize(0)

      const [localBranch] = await getBranches(fork, localRef)
      expect(localBranch).not.toBeUndefined()

      await deleteBranch(fork, localBranch, null, true)

      expect(await getBranches(fork, localRef)).toBeArrayOfSize(0)
      expect(await getBranches(fork, remoteRef)).toBeArrayOfSize(0)
      expect(await getBranches(repository, localRef)).toBeArrayOfSize(0)
    })
  })
})
