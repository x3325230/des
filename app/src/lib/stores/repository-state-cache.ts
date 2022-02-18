import { Branch } from '../../models/branch'
import { Commit } from '../../models/commit'
import { PullRequest } from '../../models/pull-request'
import { Repository } from '../../models/repository'
import {
  CommittedFileChange,
  WorkingDirectoryFileChange,
  WorkingDirectoryStatus,
} from '../../models/status'
import { TipState } from '../../models/tip'
import {
  HistoryTabMode,
  IBranchesState,
  IChangesState,
  ICompareState,
  IRepositoryState,
  RepositorySectionTab,
  ICommitSelection,
  IRebaseState,
  ChangesSelectionKind,
  ICherryPickState,
  IMultiCommitOperationUndoState,
  IMultiCommitOperationState,
} from '../app-state'
import { merge } from '../merge'
import { DefaultCommitMessage } from '../../models/commit-message'

export class RepositoryStateCache {
  private readonly repositoryState = new Map<string, IRepositoryState>()

  /** Get the state for the repository. */
  public get(repository: Repository): IRepositoryState {
    const existing = this.repositoryState.get(repository.hash)
    if (existing != null) {
      return existing
    }

    const newItem = getInitialRepositoryState()
    this.repositoryState.set(repository.hash, newItem)
    return newItem
  }

  public update<K extends keyof IRepositoryState>(
    repository: Repository,
    fn: (state: IRepositoryState) => Pick<IRepositoryState, K>
  ) {
    const currentState = this.get(repository)
    const newValues = fn(currentState)
    const newState = merge(currentState, newValues)

    const isSameLastLocalCommit =
      currentState.localCommitSHAs.length > 0 &&
      newState.localCommitSHAs.length > 0 &&
      currentState.localCommitSHAs[0] === newState.localCommitSHAs[0]

    // Only keep the "is amending" state if the last local commit hasn't changed
    // and there is no "fixing conflicts" state.
    const newIsAmending =
      newState.isAmending &&
      isSameLastLocalCommit &&
      newState.changesState.conflictState === null

    this.repositoryState.set(repository.hash, {
      ...newState,
      isAmending: newIsAmending,
    })
  }

  public updateCompareState<K extends keyof ICompareState>(
    repository: Repository,
    fn: (state: ICompareState) => Pick<ICompareState, K>
  ) {
    this.update(repository, state => {
      const compareState = state.compareState
      const newValues = fn(compareState)

      return { compareState: merge(compareState, newValues) }
    })
  }

  public updateChangesState<K extends keyof IChangesState>(
    repository: Repository,
    fn: (changesState: IChangesState) => Pick<IChangesState, K>
  ) {
    this.update(repository, state => {
      const changesState = state.changesState
      const newState = merge(changesState, fn(changesState))
      return { changesState: newState }
    })
  }

  public updateCommitSelection<K extends keyof ICommitSelection>(
    repository: Repository,
    fn: (state: ICommitSelection) => Pick<ICommitSelection, K>
  ) {
    this.update(repository, state => {
      const { commitSelection } = state
      const newState = merge(commitSelection, fn(commitSelection))
      return { commitSelection: newState }
    })
  }

  public updateBranchesState<K extends keyof IBranchesState>(
    repository: Repository,
    fn: (branchesState: IBranchesState) => Pick<IBranchesState, K>
  ) {
    this.update(repository, state => {
      const changesState = state.branchesState
      const newState = merge(changesState, fn(changesState))
      return { branchesState: newState }
    })
  }

  public updateRebaseState<K extends keyof IRebaseState>(
    repository: Repository,
    fn: (branchesState: IRebaseState) => Pick<IRebaseState, K>
  ) {
    this.update(repository, state => {
      const { rebaseState } = state
      const newState = merge(rebaseState, fn(rebaseState))
      return { rebaseState: newState }
    })
  }

  public updateCherryPickState<K extends keyof ICherryPickState>(
    repository: Repository,
    fn: (state: ICherryPickState) => Pick<ICherryPickState, K>
  ) {
    this.update(repository, state => {
      const { cherryPickState } = state
      const newState = merge(cherryPickState, fn(cherryPickState))
      return { cherryPickState: newState }
    })
  }

  public updateMultiCommitOperationUndoState<
    K extends keyof IMultiCommitOperationUndoState
  >(
    repository: Repository,
    fn: (
      state: IMultiCommitOperationUndoState | null
    ) => Pick<IMultiCommitOperationUndoState, K> | null
  ) {
    this.update(repository, state => {
      const { multiCommitOperationUndoState } = state
      const computedState = fn(multiCommitOperationUndoState)
      const newState =
        computedState === null
          ? null
          : merge(multiCommitOperationUndoState, computedState)
      return { multiCommitOperationUndoState: newState }
    })
  }

  public updateMultiCommitOperationState<
    K extends keyof IMultiCommitOperationState
  >(
    repository: Repository,
    fn: (
      state: IMultiCommitOperationState
    ) => Pick<IMultiCommitOperationState, K>
  ) {
    this.update(repository, state => {
      const { multiCommitOperationState } = state
      if (multiCommitOperationState === null) {
        throw new Error('Cannot update a null state.')
      }

      const newState = merge(
        multiCommitOperationState,
        fn(multiCommitOperationState)
      )
      return { multiCommitOperationState: newState }
    })
  }

  public initializeMultiCommitOperationState(
    repository: Repository,
    multiCommitOperationState: IMultiCommitOperationState
  ) {
    this.update(repository, () => {
      return { multiCommitOperationState }
    })
  }

  public clearMultiCommitOperationState(repository: Repository) {
    this.update(repository, () => {
      return { multiCommitOperationState: null }
    })
  }
}

function getInitialRepositoryState(): IRepositoryState {
  return {
    commitSelection: {
      shas: [],
      file: null,
      changedFiles: new Array<CommittedFileChange>(),
      diff: null,
    },
    changesState: {
      workingDirectory: WorkingDirectoryStatus.fromFiles(
        new Array<WorkingDirectoryFileChange>()
      ),
      selection: {
        kind: ChangesSelectionKind.WorkingDirectory,
        selectedFileIDs: [],
        diff: null,
      },
      commitMessage: DefaultCommitMessage,
      coAuthors: [],
      showCoAuthoredBy: false,
      conflictState: null,
      stashEntry: null,
      currentBranchProtected: false,
    },
    selectedSection: RepositorySectionTab.Changes,
    branchesState: {
      tip: { kind: TipState.Unknown },
      defaultBranch: null,
      allBranches: new Array<Branch>(),
      recentBranches: new Array<Branch>(),
      openPullRequests: new Array<PullRequest>(),
      currentPullRequest: null,
      isLoadingPullRequests: false,
      rebasedBranches: new Map<string, string>(),
    },
    compareState: {
      formState: {
        kind: HistoryTabMode.History,
      },
      tip: null,
      mergeStatus: null,
      showBranchList: false,
      filterText: '',
      commitSHAs: [],
      branches: new Array<Branch>(),
      recentBranches: new Array<Branch>(),
      defaultBranch: null,
    },
    rebaseState: {
      step: null,
      progress: null,
      commits: null,
      userHasResolvedConflicts: false,
    },
    commitAuthor: null,
    commitLookup: new Map<string, Commit>(),
    localCommitSHAs: [],
    localTags: null,
    tagsToPush: null,
    aheadBehind: null,
    remote: null,
    isPushPullFetchInProgress: false,
    isCommitting: false,
    isAmending: false,
    lastFetched: null,
    checkoutProgress: null,
    pushPullFetchProgress: null,
    revertProgress: null,
    cherryPickState: {
      step: null,
      progress: null,
      userHasResolvedConflicts: false,
      targetBranchUndoSha: null,
      branchCreated: false,
    },
    multiCommitOperationUndoState: null,
    multiCommitOperationState: null,
  }
}
