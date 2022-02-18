import { remote } from 'electron'
import { Disposable, IDisposable } from 'event-kit'

import {
  IAPIOrganization,
  IAPIPullRequest,
  IAPIFullRepository,
} from '../../lib/api'
import { shell } from '../../lib/app-shell'
import {
  CompareAction,
  Foldout,
  FoldoutType,
  ICompareFormUpdate,
  RepositorySectionTab,
  RebaseConflictState,
  isRebaseConflictState,
  isCherryPickConflictState,
  CherryPickConflictState,
} from '../../lib/app-state'
import { assertNever, fatalError } from '../../lib/fatal-error'
import {
  setGenericPassword,
  setGenericUsername,
} from '../../lib/generic-git-auth'
import {
  isGitRepository,
  RebaseResult,
  PushOptions,
  getCommitsBetweenCommits,
  getBranches,
} from '../../lib/git'
import { isGitOnPath } from '../../lib/is-git-on-path'
import {
  rejectOAuthRequest,
  requestAuthenticatedUser,
  resolveOAuthRequest,
} from '../../lib/oauth'
import {
  IOpenRepositoryFromURLAction,
  IUnknownAction,
  URLActionType,
} from '../../lib/parse-app-url'
import {
  matchExistingRepository,
  urlsMatch,
} from '../../lib/repository-matching'
import { Shell } from '../../lib/shells'
import { ILaunchStats, StatsStore } from '../../lib/stats'
import { AppStore } from '../../lib/stores/app-store'
import { validatedRepositoryPath } from '../../lib/stores/helpers/validated-repository-path'
import { RepositoryStateCache } from '../../lib/stores/repository-state-cache'
import { getTipSha } from '../../lib/tip'
import { initializeRebaseFlowForConflictedRepository } from '../../lib/rebase'

import { Account } from '../../models/account'
import { AppMenu, ExecutableMenuItem } from '../../models/app-menu'
import { IAuthor } from '../../models/author'
import { Branch, IAheadBehind } from '../../models/branch'
import { BranchesTab } from '../../models/branches-tab'
import { CloneRepositoryTab } from '../../models/clone-repository-tab'
import { CloningRepository } from '../../models/cloning-repository'
import { Commit, ICommitContext, CommitOneLine } from '../../models/commit'
import { ICommitMessage } from '../../models/commit-message'
import { DiffSelection, ImageDiffType, ITextDiff } from '../../models/diff'
import { FetchType } from '../../models/fetch'
import { GitHubRepository } from '../../models/github-repository'
import { ManualConflictResolution } from '../../models/manual-conflict-resolution'
import { Popup, PopupType } from '../../models/popup'
import { PullRequest } from '../../models/pull-request'
import {
  Repository,
  RepositoryWithGitHubRepository,
  isRepositoryWithGitHubRepository,
  getGitHubHtmlUrl,
  isRepositoryWithForkedGitHubRepository,
  getNonForkGitHubRepository,
} from '../../models/repository'
import { RetryAction, RetryActionType } from '../../models/retry-actions'
import {
  CommittedFileChange,
  WorkingDirectoryFileChange,
  WorkingDirectoryStatus,
} from '../../models/status'
import { TipState, IValidBranch } from '../../models/tip'
import { Banner, BannerType } from '../../models/banner'

import { ApplicationTheme } from '../lib/application-theme'
import { installCLI } from '../lib/install-cli'
import { executeMenuItem } from '../main-process-proxy'
import {
  CommitStatusStore,
  StatusCallBack,
  ICombinedRefCheck,
} from '../../lib/stores/commit-status-store'
import { MergeTreeResult } from '../../models/merge'
import { UncommittedChangesStrategy } from '../../models/uncommitted-changes-strategy'
import { RebaseFlowStep, RebaseStep } from '../../models/rebase-flow-step'
import { IStashEntry } from '../../models/stash-entry'
import { WorkflowPreferences } from '../../models/workflow-preferences'
import { resolveWithin } from '../../lib/path'
import {
  CherryPickFlowStep,
  CherryPickStepKind,
  CreateBranchStep,
} from '../../models/cherry-pick'
import { CherryPickResult } from '../../lib/git/cherry-pick'
import { sleep } from '../../lib/promise'
import { DragElement } from '../../models/drag-element'
import { findDefaultUpstreamBranch } from '../../lib/branch'

/**
 * An error handler function.
 *
 * If the returned {Promise} returns an error, it will be passed to the next
 * error handler. If it returns null, error propagation is halted.
 */
export type ErrorHandler = (
  error: Error,
  dispatcher: Dispatcher
) => Promise<Error | null>

/**
 * The Dispatcher acts as the hub for state. The StateHub if you will. It
 * decouples the consumer of state from where/how it is stored.
 */
export class Dispatcher {
  private readonly errorHandlers = new Array<ErrorHandler>()

  public constructor(
    private readonly appStore: AppStore,
    private readonly repositoryStateManager: RepositoryStateCache,
    private readonly statsStore: StatsStore,
    private readonly commitStatusStore: CommitStatusStore
  ) {}

  /** Load the initial state for the app. */
  public loadInitialState(): Promise<void> {
    return this.appStore.loadInitialState()
  }

  /**
   * Add the repositories at the given paths. If a path isn't a repository, then
   * this will post an error to that affect.
   */
  public addRepositories(
    paths: ReadonlyArray<string>
  ): Promise<ReadonlyArray<Repository>> {
    return this.appStore._addRepositories(paths)
  }

  /**
   * Add a tutorial repository.
   *
   * This method differs from the `addRepositories` method in that it
   * requires that the repository has been created on the remote and
   * set up to track it. Given that tutorial repositories are created
   * from the no-repositories blank slate it shouldn't be possible for
   * another repository with the same path to exist but in case that
   * changes in the future this method will set the tutorial flag on
   * the existing repository at the given path.
   */
  public addTutorialRepository(
    path: string,
    endpoint: string,
    apiRepository: IAPIFullRepository
  ) {
    return this.appStore._addTutorialRepository(path, endpoint, apiRepository)
  }

  /** Resume an already started onboarding tutorial */
  public resumeTutorial(repository: Repository) {
    return this.appStore._resumeTutorial(repository)
  }

  /** Suspend the onboarding tutorial and go to the no repositories blank slate view */
  public pauseTutorial(repository: Repository) {
    return this.appStore._pauseTutorial(repository)
  }

  /**
   * Remove the repositories represented by the given IDs from local storage.
   *
   * When `moveToTrash` is enabled, only the repositories that were successfully
   * deleted on disk are removed from the app. If some failed due to files being
   * open elsewhere, an error is thrown.
   */
  public async removeRepository(
    repository: Repository | CloningRepository,
    moveToTrash: boolean
  ): Promise<void> {
    return this.appStore._removeRepository(repository, moveToTrash)
  }

  /** Update the repository's `missing` flag. */
  public async updateRepositoryMissing(
    repository: Repository,
    missing: boolean
  ): Promise<Repository> {
    return this.appStore._updateRepositoryMissing(repository, missing)
  }

  /** Load the next batch of history for the repository. */
  public loadNextCommitBatch(repository: Repository): Promise<void> {
    return this.appStore._loadNextCommitBatch(repository)
  }

  /** Load the changed files for the current history selection. */
  public loadChangedFilesForCurrentSelection(
    repository: Repository
  ): Promise<void> {
    return this.appStore._loadChangedFilesForCurrentSelection(repository)
  }

  /**
   * Change the selected commit in the history view.
   *
   * @param repository The currently active repository instance
   *
   * @param sha The object id of one of the commits currently
   *            the history list, represented as a SHA-1 hash
   *            digest. This should match exactly that of Commit.Sha
   */
  public changeCommitSelection(
    repository: Repository,
    shas: ReadonlyArray<string>
  ): Promise<void> {
    return this.appStore._changeCommitSelection(repository, shas)
  }

  /**
   * Change the selected changed file in the history view.
   *
   * @param repository The currently active repository instance
   *
   * @param file A FileChange instance among those available in
   *            IHistoryState.changedFiles
   */
  public changeFileSelection(
    repository: Repository,
    file: CommittedFileChange
  ): Promise<void> {
    return this.appStore._changeFileSelection(repository, file)
  }

  /** Set the repository filter text. */
  public setRepositoryFilterText(text: string): Promise<void> {
    return this.appStore._setRepositoryFilterText(text)
  }

  /** Select the repository. */
  public selectRepository(
    repository: Repository | CloningRepository
  ): Promise<Repository | null> {
    return this.appStore._selectRepository(repository)
  }

  /** Change the selected section in the repository. */
  public changeRepositorySection(
    repository: Repository,
    section: RepositorySectionTab
  ): Promise<void> {
    return this.appStore._changeRepositorySection(repository, section)
  }

  /**
   * Changes the selection in the changes view to the working directory and
   * optionally selects one or more files from the working directory.
   *
   *  @param files An array of files to select when showing the working directory.
   *               If undefined this method will preserve the previously selected
   *               files or pick the first changed file if no selection exists.
   */
  public selectWorkingDirectoryFiles(
    repository: Repository,
    selectedFiles?: WorkingDirectoryFileChange[]
  ): Promise<void> {
    return this.appStore._selectWorkingDirectoryFiles(repository, selectedFiles)
  }

  /**
   * Changes the selection in the changes view to the stash entry view and
   * optionally selects a particular file from the current stash entry.
   *
   *  @param file  A file to select when showing the stash entry.
   *               If undefined this method will preserve the previously selected
   *               file or pick the first changed file if no selection exists.
   */
  public selectStashedFile(
    repository: Repository,
    file?: CommittedFileChange | null
  ): Promise<void> {
    return this.appStore._selectStashedFile(repository, file)
  }

  /**
   * Commit the changes which were marked for inclusion, using the given commit
   * summary and description and optionally any number of commit message trailers
   * which will be merged into the final commit message.
   */
  public async commitIncludedChanges(
    repository: Repository,
    context: ICommitContext
  ): Promise<boolean> {
    return this.appStore._commitIncludedChanges(repository, context)
  }

  /** Change the file's includedness. */
  public changeFileIncluded(
    repository: Repository,
    file: WorkingDirectoryFileChange,
    include: boolean
  ): Promise<void> {
    return this.appStore._changeFileIncluded(repository, file, include)
  }

  /** Change the file's line selection state. */
  public changeFileLineSelection(
    repository: Repository,
    file: WorkingDirectoryFileChange,
    diffSelection: DiffSelection
  ): Promise<void> {
    return this.appStore._changeFileLineSelection(
      repository,
      file,
      diffSelection
    )
  }

  /** Change the Include All state. */
  public changeIncludeAllFiles(
    repository: Repository,
    includeAll: boolean
  ): Promise<void> {
    return this.appStore._changeIncludeAllFiles(repository, includeAll)
  }

  /**
   * Refresh the repository. This would be used, e.g., when the app gains focus.
   */
  public refreshRepository(repository: Repository): Promise<void> {
    return this.appStore._refreshOrRecoverRepository(repository)
  }

  /**
   * Refresh the commit author of a repository. Required after changing git's
   * user name or email address.
   */
  public async refreshAuthor(repository: Repository): Promise<void> {
    return this.appStore._refreshAuthor(repository)
  }

  /** Show the popup. This will close any current popup. */
  public showPopup(popup: Popup): Promise<void> {
    return this.appStore._showPopup(popup)
  }

  /**
   * Close the current popup, if found
   *
   * @param popupType only close the popup if it matches this `PopupType`
   */
  public closePopup(popupType?: PopupType) {
    return this.appStore._closePopup(popupType)
  }

  /** Show the foldout. This will close any current popup. */
  public showFoldout(foldout: Foldout): Promise<void> {
    return this.appStore._showFoldout(foldout)
  }

  /** Close the current foldout. If opening a new foldout use closeFoldout instead. */
  public closeCurrentFoldout(): Promise<void> {
    return this.appStore._closeCurrentFoldout()
  }

  /** Close the specified foldout */
  public closeFoldout(foldout: FoldoutType): Promise<void> {
    return this.appStore._closeFoldout(foldout)
  }

  /** Check for remote commits that could affect the rebase operation */
  private async warnAboutRemoteCommits(
    repository: Repository,
    baseBranch: Branch,
    targetBranch: Branch
  ): Promise<boolean> {
    if (targetBranch.upstream === null) {
      return false
    }

    // if the branch is tracking a remote branch
    const upstreamBranchesMatching = await getBranches(
      repository,
      `refs/remotes/${targetBranch.upstream}`
    )

    if (upstreamBranchesMatching.length === 0) {
      return false
    }

    // and the remote branch has commits that don't exist on the base branch
    const remoteCommits = await getCommitsBetweenCommits(
      repository,
      baseBranch.tip.sha,
      targetBranch.upstream
    )

    return remoteCommits !== null && remoteCommits.length > 0
  }

  /** Initialize and start the rebase operation */
  public async startRebase(
    repository: Repository,
    baseBranch: Branch,
    targetBranch: Branch,
    commits: ReadonlyArray<CommitOneLine>,
    options?: { continueWithForcePush: boolean }
  ): Promise<void> {
    const { askForConfirmationOnForcePush } = this.appStore.getState()

    const hasOverriddenForcePushCheck =
      options !== undefined && options.continueWithForcePush

    if (askForConfirmationOnForcePush && !hasOverriddenForcePushCheck) {
      const showWarning = await this.warnAboutRemoteCommits(
        repository,
        baseBranch,
        targetBranch
      )

      if (showWarning) {
        this.setRebaseFlowStep(repository, {
          kind: RebaseStep.WarnForcePush,
          baseBranch,
          targetBranch,
          commits,
        })
        return
      }
    }

    this.initializeRebaseProgress(repository, commits)

    const startRebaseAction = () => {
      return this.rebase(repository, baseBranch, targetBranch)
    }

    this.setRebaseFlowStep(repository, {
      kind: RebaseStep.ShowProgress,
      rebaseAction: startRebaseAction,
    })
  }

  /**
   * Initialize and launch the rebase flow for a conflicted repository
   */
  public async launchRebaseFlow(repository: Repository, targetBranch: string) {
    await this.appStore._loadStatus(repository)

    const repositoryState = this.repositoryStateManager.get(repository)
    const { conflictState } = repositoryState.changesState

    if (conflictState === null || !isRebaseConflictState(conflictState)) {
      return
    }

    const updatedConflictState = {
      ...conflictState,
      targetBranch,
    }

    this.repositoryStateManager.updateChangesState(repository, () => ({
      conflictState: updatedConflictState,
    }))

    await this.setRebaseProgressFromState(repository)

    const initialStep = initializeRebaseFlowForConflictedRepository(
      updatedConflictState
    )

    this.setRebaseFlowStep(repository, initialStep)

    this.showPopup({
      type: PopupType.RebaseFlow,
      repository,
    })
  }

  /**
   * Create a new branch from the given starting point and check it out.
   *
   * If the startPoint argument is omitted the new branch will be created based
   * off of the current state of HEAD.
   */
  public createBranch(
    repository: Repository,
    name: string,
    startPoint: string | null,
    noTrackOption: boolean = false
  ): Promise<Branch | undefined> {
    return this.appStore._createBranch(
      repository,
      name,
      startPoint,
      noTrackOption
    )
  }

  /**
   * Create a new tag on the given target commit.
   */
  public createTag(
    repository: Repository,
    name: string,
    targetCommitSha: string
  ): Promise<void> {
    return this.appStore._createTag(repository, name, targetCommitSha)
  }

  /**
   * Deletes the passed tag.
   */
  public deleteTag(repository: Repository, name: string): Promise<void> {
    return this.appStore._deleteTag(repository, name)
  }

  /**
   * Show the tag creation dialog.
   */
  public showCreateTagDialog(
    repository: Repository,
    targetCommitSha: string,
    localTags: Map<string, string> | null,
    initialName?: string
  ): Promise<void> {
    return this.showPopup({
      type: PopupType.CreateTag,
      repository,
      targetCommitSha,
      initialName,
      localTags,
    })
  }

  /**
   * Show the confirmation dialog to delete a tag.
   */
  public showDeleteTagDialog(
    repository: Repository,
    tagName: string
  ): Promise<void> {
    return this.showPopup({
      type: PopupType.DeleteTag,
      repository,
      tagName,
    })
  }

  /** Check out the given branch. */
  public checkoutBranch(
    repository: Repository,
    branch: Branch,
    strategy?: UncommittedChangesStrategy
  ): Promise<Repository> {
    return this.appStore._checkoutBranch(repository, branch, strategy)
  }

  /** Push the current branch. */
  public push(repository: Repository): Promise<void> {
    return this.appStore._push(repository)
  }

  private pushWithOptions(repository: Repository, options?: PushOptions) {
    if (options !== undefined && options.forceWithLease) {
      this.dropCurrentBranchFromForcePushList(repository)
    }

    return this.appStore._push(repository, options)
  }

  /** Pull the current branch. */
  public pull(repository: Repository): Promise<void> {
    return this.appStore._pull(repository)
  }

  /** Fetch a specific refspec for the repository. */
  public fetchRefspec(
    repository: Repository,
    fetchspec: string
  ): Promise<void> {
    return this.appStore._fetchRefspec(repository, fetchspec)
  }

  /** Fetch all refs for the repository */
  public fetch(repository: Repository, fetchType: FetchType): Promise<void> {
    return this.appStore._fetch(repository, fetchType)
  }

  /** Publish the repository to GitHub with the given properties. */
  public publishRepository(
    repository: Repository,
    name: string,
    description: string,
    private_: boolean,
    account: Account,
    org: IAPIOrganization | null
  ): Promise<Repository> {
    return this.appStore._publishRepository(
      repository,
      name,
      description,
      private_,
      account,
      org
    )
  }

  /**
   * Post the given error. This will send the error through the standard error
   * handler machinery.
   */
  public async postError(error: Error): Promise<void> {
    let currentError: Error | null = error
    for (let i = this.errorHandlers.length - 1; i >= 0; i--) {
      const handler = this.errorHandlers[i]
      currentError = await handler(currentError, this)

      if (!currentError) {
        break
      }
    }

    if (currentError) {
      fatalError(
        `Unhandled error ${currentError}. This shouldn't happen! All errors should be handled, even if it's just by the default handler.`
      )
    }
  }

  /**
   * Post the given error. Note that this bypasses the standard error handler
   * machinery. You probably don't want that. See `Dispatcher.postError`
   * instead.
   */
  public presentError(error: Error): Promise<void> {
    return this.appStore._pushError(error)
  }

  /** Clear the given error. */
  public clearError(error: Error): Promise<void> {
    return this.appStore._clearError(error)
  }

  /**
   * Clone a missing repository to the previous path, and update it's
   * state in the repository list if the clone completes without error.
   */
  public cloneAgain(url: string, path: string): Promise<void> {
    return this.appStore._cloneAgain(url, path)
  }

  /** Clone the repository to the path. */
  public async clone(
    url: string,
    path: string,
    options?: { branch?: string; defaultBranch?: string }
  ): Promise<Repository | null> {
    return this.appStore._completeOpenInDesktop(async () => {
      const { promise, repository } = this.appStore._clone(url, path, options)
      await this.selectRepository(repository)
      const success = await promise
      // TODO: this exit condition is not great, bob
      if (!success) {
        return null
      }

      const addedRepositories = await this.addRepositories([path])
      const addedRepository = addedRepositories[0]
      await this.selectRepository(addedRepository)

      if (isRepositoryWithForkedGitHubRepository(addedRepository)) {
        this.showPopup({
          type: PopupType.ChooseForkSettings,
          repository: addedRepository,
        })
      }

      return addedRepository
    })
  }

  /** Changes the repository alias to a new name. */
  public changeRepositoryAlias(
    repository: Repository,
    newAlias: string | null
  ): Promise<void> {
    return this.appStore._changeRepositoryAlias(repository, newAlias)
  }

  /** Rename the branch to a new name. */
  public renameBranch(
    repository: Repository,
    branch: Branch,
    newName: string
  ): Promise<void> {
    return this.appStore._renameBranch(repository, branch, newName)
  }

  /**
   * Delete the branch. This will delete both the local branch and the remote
   * branch if includeUpstream is true, and then check out the default branch.
   */
  public deleteLocalBranch(
    repository: Repository,
    branch: Branch,
    includeUpstream?: boolean
  ): Promise<void> {
    return this.appStore._deleteBranch(repository, branch, includeUpstream)
  }

  /**
   * Delete the remote branch.
   */
  public deleteRemoteBranch(
    repository: Repository,
    branch: Branch
  ): Promise<void> {
    return this.appStore._deleteBranch(repository, branch)
  }

  /** Discard the changes to the given files. */
  public discardChanges(
    repository: Repository,
    files: ReadonlyArray<WorkingDirectoryFileChange>
  ): Promise<void> {
    return this.appStore._discardChanges(repository, files)
  }

  /** Discard the changes from the given diff selection. */
  public discardChangesFromSelection(
    repository: Repository,
    filePath: string,
    diff: ITextDiff,
    selection: DiffSelection
  ): Promise<void> {
    return this.appStore._discardChangesFromSelection(
      repository,
      filePath,
      diff,
      selection
    )
  }

  /** Undo the given commit. */
  public undoCommit(repository: Repository, commit: Commit): Promise<void> {
    return this.appStore._undoCommit(repository, commit)
  }

  /** Revert the commit with the given SHA */
  public revertCommit(repository: Repository, commit: Commit): Promise<void> {
    return this.appStore._revertCommit(repository, commit)
  }

  /**
   * Set the width of the repository sidebar to the given
   * value. This affects the changes and history sidebar
   * as well as the first toolbar section which contains
   * repo selection on all platforms and repo selection and
   * app menu on Windows.
   */
  public setSidebarWidth(width: number): Promise<void> {
    return this.appStore._setSidebarWidth(width)
  }

  /**
   * Set the update banner's visibility
   */
  public setUpdateBannerVisibility(isVisible: boolean) {
    return this.appStore._setUpdateBannerVisibility(isVisible)
  }

  /**
   * Set the banner state for the application
   */
  public setBanner(state: Banner) {
    return this.appStore._setBanner(state)
  }

  /**
   * Close the current banner, if found.
   *
   * @param bannerType only close the banner if it matches this `BannerType`
   */
  public clearBanner(bannerType?: BannerType) {
    return this.appStore._clearBanner(bannerType)
  }

  /**
   * Reset the width of the repository sidebar to its default
   * value. This affects the changes and history sidebar
   * as well as the first toolbar section which contains
   * repo selection on all platforms and repo selection and
   * app menu on Windows.
   */
  public resetSidebarWidth(): Promise<void> {
    return this.appStore._resetSidebarWidth()
  }

  /**
   * Set the width of the commit summary column in the
   * history view to the given value.
   */
  public setCommitSummaryWidth(width: number): Promise<void> {
    return this.appStore._setCommitSummaryWidth(width)
  }

  /**
   * Reset the width of the commit summary column in the
   * history view to its default value.
   */
  public resetCommitSummaryWidth(): Promise<void> {
    return this.appStore._resetCommitSummaryWidth()
  }

  /** Update the repository's issues from GitHub. */
  public refreshIssues(repository: GitHubRepository): Promise<void> {
    return this.appStore._refreshIssues(repository)
  }

  /** End the Welcome flow. */
  public endWelcomeFlow(): Promise<void> {
    return this.appStore._endWelcomeFlow()
  }

  /** Set the commit message input's focus. */
  public setCommitMessageFocus(focus: boolean) {
    this.appStore._setCommitMessageFocus(focus)
  }

  /**
   * Set the commit summary and description for a work-in-progress
   * commit in the changes view for a particular repository.
   */
  public setCommitMessage(
    repository: Repository,
    message: ICommitMessage
  ): Promise<void> {
    return this.appStore._setCommitMessage(repository, message)
  }

  /** Remove the given account from the app. */
  public removeAccount(account: Account): Promise<void> {
    return this.appStore._removeAccount(account)
  }

  /**
   * Ask the dispatcher to apply a transformation function to the current
   * state of the application menu.
   *
   * Since the dispatcher is asynchronous it's possible for components
   * utilizing the menu state to have an out-of-date view of the state
   * of the app menu which is why they're not allowed to transform it
   * directly.
   *
   * To work around potential race conditions consumers instead pass a
   * delegate which receives the updated application menu and allows
   * them to perform the necessary state transitions. The AppMenu instance
   * is itself immutable but does offer transformation methods and in
   * order for the state to be properly updated the delegate _must_ return
   * the latest transformed instance of the AppMenu.
   */
  public setAppMenuState(update: (appMenu: AppMenu) => AppMenu): Promise<void> {
    return this.appStore._setAppMenuState(update)
  }

  /**
   * Tell the main process to execute (i.e. simulate a click of) the given menu item.
   */
  public executeMenuItem(item: ExecutableMenuItem): Promise<void> {
    executeMenuItem(item)
    return Promise.resolve()
  }

  /**
   * Set whether or not to to add a highlight class to the app menu toolbar icon.
   * Used to highlight the button when the Alt key is pressed.
   *
   * Only applicable on non-macOS platforms.
   */
  public setAccessKeyHighlightState(highlight: boolean): Promise<void> {
    return this.appStore._setAccessKeyHighlightState(highlight)
  }

  /** Merge the named branch into the current branch. */
  public mergeBranch(
    repository: Repository,
    branch: string,
    mergeStatus: MergeTreeResult | null
  ): Promise<void> {
    return this.appStore._mergeBranch(repository, branch, mergeStatus)
  }

  /**
   * Update the per-repository list of branches that can be force-pushed
   * after a rebase is completed.
   */
  private addRebasedBranchToForcePushList = (
    repository: Repository,
    tipWithBranch: IValidBranch,
    beforeRebaseSha: string
  ) => {
    // if the commit id of the branch is unchanged, it can be excluded from
    // this list
    if (tipWithBranch.branch.tip.sha === beforeRebaseSha) {
      return
    }

    const currentState = this.repositoryStateManager.get(repository)
    const { rebasedBranches } = currentState.branchesState

    const updatedMap = new Map<string, string>(rebasedBranches)
    updatedMap.set(
      tipWithBranch.branch.nameWithoutRemote,
      tipWithBranch.branch.tip.sha
    )

    this.repositoryStateManager.updateBranchesState(repository, () => ({
      rebasedBranches: updatedMap,
    }))
  }

  private dropCurrentBranchFromForcePushList = (repository: Repository) => {
    const currentState = this.repositoryStateManager.get(repository)
    const { rebasedBranches, tip } = currentState.branchesState

    if (tip.kind !== TipState.Valid) {
      return
    }

    const updatedMap = new Map<string, string>(rebasedBranches)
    updatedMap.delete(tip.branch.nameWithoutRemote)

    this.repositoryStateManager.updateBranchesState(repository, () => ({
      rebasedBranches: updatedMap,
    }))
  }

  /**
   * Update the rebase state to indicate the user has resolved conflicts in the
   * current repository.
   */
  public setConflictsResolved(repository: Repository) {
    return this.appStore._setConflictsResolved(repository)
  }

  /**
   * Initialize the progress in application state based on the known commits
   * that will be applied in the rebase.
   *
   * @param commits the list of commits that exist on the target branch which do
   *                not exist on the base branch
   */
  public initializeRebaseProgress(
    repository: Repository,
    commits: ReadonlyArray<CommitOneLine>
  ) {
    return this.appStore._initializeRebaseProgress(repository, commits)
  }

  /**
   * Update the rebase progress in application state by querying the Git
   * repository state.
   */
  public setRebaseProgressFromState(repository: Repository) {
    return this.appStore._setRebaseProgressFromState(repository)
  }

  /**
   * Move the rebase flow to a new state.
   */
  public setRebaseFlowStep(
    repository: Repository,
    step: RebaseFlowStep
  ): Promise<void> {
    return this.appStore._setRebaseFlowStep(repository, step)
  }

  /** End the rebase flow and cleanup any related app state */
  public endRebaseFlow(repository: Repository) {
    return this.appStore._endRebaseFlow(repository)
  }

  /** Starts a rebase for the given base and target branch */
  public async rebase(
    repository: Repository,
    baseBranch: Branch,
    targetBranch: Branch
  ): Promise<void> {
    const stateBefore = this.repositoryStateManager.get(repository)

    const beforeSha = getTipSha(stateBefore.branchesState.tip)

    log.info(
      `[rebase] starting rebase for ${targetBranch.name} at ${beforeSha}`
    )
    log.info(
      `[rebase] to restore the previous state if this completed rebase is unsatisfactory:`
    )
    log.info(`[rebase] - git checkout ${targetBranch.name}`)
    log.info(`[rebase] - git reset ${beforeSha} --hard`)

    const result = await this.appStore._rebase(
      repository,
      baseBranch,
      targetBranch
    )

    await this.appStore._loadStatus(repository)

    const stateAfter = this.repositoryStateManager.get(repository)
    const { tip } = stateAfter.branchesState
    const afterSha = getTipSha(tip)

    log.info(
      `[rebase] completed rebase - got ${result} and on tip ${afterSha} - kind ${tip.kind}`
    )

    if (result === RebaseResult.ConflictsEncountered) {
      const { conflictState } = stateAfter.changesState
      if (conflictState === null) {
        log.warn(
          `[rebase] conflict state after rebase is null - unable to continue`
        )
        return
      }

      if (!isRebaseConflictState(conflictState)) {
        log.warn(
          `[rebase] conflict state after rebase is not rebase conflicts - unable to continue`
        )
        return
      }

      const conflictsWithBranches: RebaseConflictState = {
        ...conflictState,
        baseBranch: baseBranch.name,
        targetBranch: targetBranch.name,
      }

      this.switchToConflicts(repository, conflictsWithBranches)
    } else if (result === RebaseResult.CompletedWithoutError) {
      if (tip.kind !== TipState.Valid) {
        log.warn(
          `[rebase] tip after completing rebase is ${tip.kind} but this should be a valid tip if the rebase completed without error`
        )
        return
      }

      this.statsStore.recordRebaseSuccessWithoutConflicts()

      await this.completeRebase(
        repository,
        {
          type: BannerType.SuccessfulRebase,
          targetBranch: targetBranch.name,
          baseBranch: baseBranch.name,
        },
        tip,
        beforeSha
      )
    } else if (result === RebaseResult.Error) {
      // we were unable to successfully start the rebase, and an error should
      // be shown through the default error handling infrastructure, so we can
      // just abandon the rebase for now
      this.endRebaseFlow(repository)
    }
  }

  /** Abort the current rebase and refreshes the repository status */
  public async abortRebase(repository: Repository) {
    await this.appStore._abortRebase(repository)
    await this.appStore._loadStatus(repository)
  }

  /**
   * Continue with the rebase after the user has resolved all conflicts with
   * tracked files in the working directory.
   */
  public async continueRebase(
    repository: Repository,
    workingDirectory: WorkingDirectoryStatus,
    conflictsState: RebaseConflictState
  ): Promise<void> {
    const stateBefore = this.repositoryStateManager.get(repository)
    const {
      targetBranch,
      baseBranch,
      originalBranchTip,
      manualResolutions,
    } = conflictsState

    const beforeSha = getTipSha(stateBefore.branchesState.tip)

    log.info(`[continueRebase] continuing rebase for ${beforeSha}`)

    const result = await this.appStore._continueRebase(
      repository,
      workingDirectory,
      manualResolutions
    )
    await this.appStore._loadStatus(repository)

    const stateAfter = this.repositoryStateManager.get(repository)
    const { tip } = stateAfter.branchesState
    const afterSha = getTipSha(tip)

    log.info(
      `[continueRebase] completed rebase - got ${result} and on tip ${afterSha} - kind ${tip.kind}`
    )

    if (result === RebaseResult.ConflictsEncountered) {
      const { conflictState } = stateAfter.changesState
      if (conflictState === null) {
        log.warn(
          `[continueRebase] conflict state after rebase is null - unable to continue`
        )
        return
      }

      if (!isRebaseConflictState(conflictState)) {
        log.warn(
          `[continueRebase] conflict state after rebase is not rebase conflicts - unable to continue`
        )
        return
      }

      // ensure branches are persisted when transitioning back to conflicts
      const conflictsWithBranches: RebaseConflictState = {
        ...conflictState,
        baseBranch,
        targetBranch,
      }

      this.switchToConflicts(repository, conflictsWithBranches)
    } else if (result === RebaseResult.CompletedWithoutError) {
      if (tip.kind !== TipState.Valid) {
        log.warn(
          `[continueRebase] tip after completing rebase is ${tip.kind} but this should be a valid tip if the rebase completed without error`
        )
        return
      }

      this.statsStore.recordRebaseSuccessAfterConflicts()

      await this.completeRebase(
        repository,
        {
          type: BannerType.SuccessfulRebase,
          targetBranch: targetBranch,
          baseBranch: baseBranch,
        },
        tip,
        originalBranchTip
      )
    }
  }

  /** Switch the rebase flow to show the latest conflicts */
  private switchToConflicts = (
    repository: Repository,
    conflictState: RebaseConflictState
  ) => {
    this.setRebaseFlowStep(repository, {
      kind: RebaseStep.ShowConflicts,
      conflictState,
    })
  }

  /** Tidy up the rebase flow after reaching the end */
  private async completeRebase(
    repository: Repository,
    banner: Banner,
    tip: IValidBranch,
    originalBranchTip: string
  ): Promise<void> {
    this.closePopup()

    this.setBanner(banner)

    if (tip.kind === TipState.Valid) {
      this.addRebasedBranchToForcePushList(repository, tip, originalBranchTip)
    }

    this.endRebaseFlow(repository)

    await this.refreshRepository(repository)
  }

  /** aborts an in-flight merge and refreshes the repository's status */
  public async abortMerge(repository: Repository) {
    await this.appStore._abortMerge(repository)
    await this.appStore._loadStatus(repository)
  }

  /**
   * commits an in-flight merge and shows a banner if successful
   *
   * @param repository
   * @param workingDirectory
   * @param successfulMergeBannerState information for banner to be displayed if merge is successful
   */
  public async finishConflictedMerge(
    repository: Repository,
    workingDirectory: WorkingDirectoryStatus,
    successfulMergeBanner: Banner
  ) {
    // get manual resolutions in case there are manual conflicts
    const repositoryState = this.repositoryStateManager.get(repository)
    const { conflictState } = repositoryState.changesState
    if (conflictState === null) {
      // if this doesn't exist, something is very wrong and we shouldn't proceed 😢
      log.error(
        'Conflict state missing during finishConflictedMerge. No merge will be committed.'
      )
      return
    }
    const result = await this.appStore._finishConflictedMerge(
      repository,
      workingDirectory,
      conflictState.manualResolutions
    )
    if (result !== undefined) {
      this.setBanner(successfulMergeBanner)
    }
  }

  /** Record the given launch stats. */
  public recordLaunchStats(stats: ILaunchStats): Promise<void> {
    return this.appStore._recordLaunchStats(stats)
  }

  /** Report any stats if needed. */
  public reportStats(): Promise<void> {
    return this.appStore._reportStats()
  }

  /** Changes the URL for the remote that matches the given name  */
  public setRemoteURL(
    repository: Repository,
    name: string,
    url: string
  ): Promise<void> {
    return this.appStore._setRemoteURL(repository, name, url)
  }

  /** Open the URL in a browser */
  public openInBrowser(url: string): Promise<boolean> {
    return this.appStore._openInBrowser(url)
  }

  /** Add the pattern to the repository's gitignore. */
  public appendIgnoreRule(
    repository: Repository,
    pattern: string | string[]
  ): Promise<void> {
    return this.appStore._appendIgnoreRule(repository, pattern)
  }

  /** Opens a Git-enabled terminal setting the working directory to the repository path */
  public async openShell(
    path: string,
    ignoreWarning: boolean = false
  ): Promise<void> {
    const gitFound = await isGitOnPath()
    if (gitFound || ignoreWarning) {
      this.appStore._openShell(path)
    } else {
      this.appStore._showPopup({
        type: PopupType.InstallGit,
        path,
      })
    }
  }

  /**
   * Opens a path in the external editor selected by the user.
   */
  public async openInExternalEditor(fullPath: string): Promise<void> {
    return this.appStore._openInExternalEditor(fullPath)
  }

  /**
   * Persist the given content to the repository's root .gitignore.
   *
   * If the repository root doesn't contain a .gitignore file one
   * will be created, otherwise the current file will be overwritten.
   */
  public saveGitIgnore(repository: Repository, text: string): Promise<void> {
    return this.appStore._saveGitIgnore(repository, text)
  }

  /** Set whether the user has opted out of stats reporting. */
  public setStatsOptOut(
    optOut: boolean,
    userViewedPrompt: boolean
  ): Promise<void> {
    return this.appStore.setStatsOptOut(optOut, userViewedPrompt)
  }

  public moveToApplicationsFolder() {
    remote.app.moveToApplicationsFolder?.()
  }

  /**
   * Clear any in-flight sign in state and return to the
   * initial (no sign-in) state.
   */
  public resetSignInState(): Promise<void> {
    return this.appStore._resetSignInState()
  }

  /**
   * Initiate a sign in flow for github.com. This will put the store
   * in the Authentication step ready to receive user credentials.
   */
  public beginDotComSignIn(): Promise<void> {
    return this.appStore._beginDotComSignIn()
  }

  /**
   * Initiate a sign in flow for a GitHub Enterprise instance. This will
   * put the store in the EndpointEntry step ready to receive the url
   * to the enterprise instance.
   */
  public beginEnterpriseSignIn(): Promise<void> {
    return this.appStore._beginEnterpriseSignIn()
  }

  /**
   * Attempt to advance from the EndpointEntry step with the given endpoint
   * url. This method must only be called when the store is in the authentication
   * step or an error will be thrown.
   *
   * The provided endpoint url will be validated for syntactic correctness as
   * well as connectivity before the promise resolves. If the endpoint url is
   * invalid or the host can't be reached the promise will be rejected and the
   * sign in state updated with an error to be presented to the user.
   *
   * If validation is successful the store will advance to the authentication
   * step.
   */
  public setSignInEndpoint(url: string): Promise<void> {
    return this.appStore._setSignInEndpoint(url)
  }

  /**
   * Attempt to advance from the authentication step using a username
   * and password. This method must only be called when the store is
   * in the authentication step or an error will be thrown. If the
   * provided credentials are valid the store will either advance to
   * the Success step or to the TwoFactorAuthentication step if the
   * user has enabled two factor authentication.
   *
   * If an error occurs during sign in (such as invalid credentials)
   * the authentication state will be updated with that error so that
   * the responsible component can present it to the user.
   */
  public setSignInCredentials(
    username: string,
    password: string
  ): Promise<void> {
    return this.appStore._setSignInCredentials(username, password)
  }

  /**
   * Initiate an OAuth sign in using the system configured browser.
   * This method must only be called when the store is in the authentication
   * step or an error will be thrown.
   *
   * The promise returned will only resolve once the user has successfully
   * authenticated. If the user terminates the sign-in process by closing
   * their browser before the protocol handler is invoked, by denying the
   * protocol handler to execute or by providing the wrong credentials
   * this promise will never complete.
   */
  public requestBrowserAuthentication(): Promise<void> {
    return this.appStore._requestBrowserAuthentication()
  }

  /**
   * Initiate an OAuth sign in using the system configured browser to GitHub.com.
   *
   * The promise returned will only resolve once the user has successfully
   * authenticated. If the user terminates the sign-in process by closing
   * their browser before the protocol handler is invoked, by denying the
   * protocol handler to execute or by providing the wrong credentials
   * this promise will never complete.
   */
  public async requestBrowserAuthenticationToDotcom(): Promise<void> {
    await this.beginDotComSignIn()
    return this.requestBrowserAuthentication()
  }

  /**
   * Attempt to complete the sign in flow with the given OTP token.\
   * This method must only be called when the store is in the
   * TwoFactorAuthentication step or an error will be thrown.
   *
   * If the provided token is valid the store will advance to
   * the Success step.
   *
   * If an error occurs during sign in (such as invalid credentials)
   * the authentication state will be updated with that error so that
   * the responsible component can present it to the user.
   */
  public setSignInOTP(otp: string): Promise<void> {
    return this.appStore._setSignInOTP(otp)
  }

  /**
   * Launch a sign in dialog for authenticating a user with
   * GitHub.com.
   */
  public async showDotComSignInDialog(): Promise<void> {
    await this.appStore._beginDotComSignIn()
    await this.appStore._showPopup({ type: PopupType.SignIn })
  }

  /**
   * Launch a sign in dialog for authenticating a user with
   * a GitHub Enterprise instance.
   */
  public async showEnterpriseSignInDialog(): Promise<void> {
    await this.appStore._beginEnterpriseSignIn()
    await this.appStore._showPopup({ type: PopupType.SignIn })
  }

  /**
   * Show a dialog that helps the user create a fork of
   * their local repo.
   */
  public async showCreateForkDialog(
    repository: RepositoryWithGitHubRepository
  ): Promise<void> {
    await this.appStore._showCreateForkDialog(repository)
  }

  /**
   * Register a new error handler.
   *
   * Error handlers are called in order starting with the most recently
   * registered handler. The error which the returned {Promise} resolves to is
   * passed to the next handler, etc. If the handler's {Promise} resolves to
   * null, error propagation is halted.
   */
  public registerErrorHandler(handler: ErrorHandler): Disposable {
    this.errorHandlers.push(handler)

    return new Disposable(() => {
      const i = this.errorHandlers.indexOf(handler)
      if (i >= 0) {
        this.errorHandlers.splice(i, 1)
      }
    })
  }

  /**
   * Update the location of an existing repository and clear the missing flag.
   */
  public async relocateRepository(repository: Repository): Promise<void> {
    const window = remote.getCurrentWindow()
    const { filePaths } = await remote.dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
    })

    if (filePaths.length > 0) {
      const newPath = filePaths[0]
      await this.updateRepositoryPath(repository, newPath)
    }
  }

  /**
   * Change the workflow preferences for the specified repository.
   *
   * @param repository            The repository to update.
   * @param workflowPreferences   The object with the workflow settings to use.
   */
  public async updateRepositoryWorkflowPreferences(
    repository: Repository,
    workflowPreferences: WorkflowPreferences
  ) {
    await this.appStore._updateRepositoryWorkflowPreferences(
      repository,
      workflowPreferences
    )
  }

  /** Update the repository's path. */
  private async updateRepositoryPath(
    repository: Repository,
    path: string
  ): Promise<void> {
    await this.appStore._updateRepositoryPath(repository, path)
  }

  public async setAppFocusState(isFocused: boolean): Promise<void> {
    await this.appStore._setAppFocusState(isFocused)

    if (isFocused) {
      this.commitStatusStore.startBackgroundRefresh()
    } else {
      this.commitStatusStore.stopBackgroundRefresh()
    }
  }

  /**
   * Find an existing repository that can be used for checking out
   * the passed pull request.
   *
   * This method will try to find an opened repository that matches the
   * HEAD repository of the PR first and if not found it will try to
   * find an opened repository that matches the BASE repository of the PR.
   * Matching in this context means that either the origin remote or the
   * upstream remote url are equal to the PR ref repository URL.
   *
   * With this logic we try to select the best suited repository to open
   * a PR when triggering a "Open PR from Desktop" action from a browser.
   *
   * @param pullRequest the pull request object received from the API.
   */
  private getRepositoryFromPullRequest(
    pullRequest: IAPIPullRequest
  ): RepositoryWithGitHubRepository | null {
    const state = this.appStore.getState()
    const repositories = state.repositories
    const headUrl = pullRequest.head.repo?.clone_url
    const baseUrl = pullRequest.base.repo?.clone_url

    // This likely means that the base repository has been deleted
    // and we don't support checking out from refs/pulls/NNN/head
    // yet so we'll bail for now.
    if (headUrl === undefined || baseUrl === undefined) {
      return null
    }

    for (const repository of repositories) {
      if (this.doesRepositoryMatchUrl(repository, headUrl)) {
        return repository
      }
    }

    for (const repository of repositories) {
      if (this.doesRepositoryMatchUrl(repository, baseUrl)) {
        return repository
      }
    }

    return null
  }

  private doesRepositoryMatchUrl(
    repo: Repository | CloningRepository,
    url: string
  ): repo is RepositoryWithGitHubRepository {
    if (repo instanceof Repository && isRepositoryWithGitHubRepository(repo)) {
      const originRepoUrl = repo.gitHubRepository.htmlURL
      const upstreamRepoUrl = repo.gitHubRepository.parent?.htmlURL ?? null

      if (originRepoUrl !== null && urlsMatch(originRepoUrl, url)) {
        return true
      }

      if (upstreamRepoUrl !== null && urlsMatch(upstreamRepoUrl, url)) {
        return true
      }
    }

    return false
  }

  private async openRepositoryFromUrl(action: IOpenRepositoryFromURLAction) {
    const { url, pr, branch, filepath } = action

    let repository: Repository | null

    if (pr !== null) {
      repository = await this.openPullRequestFromUrl(url, pr)
    } else if (branch !== null) {
      repository = await this.openBranchNameFromUrl(url, branch)
    } else {
      repository = await this.openOrCloneRepository(url)
    }

    if (repository === null) {
      return
    }

    if (filepath !== null) {
      const resolved = await resolveWithin(repository.path, filepath)

      if (resolved !== null) {
        shell.showItemInFolder(resolved)
      } else {
        log.error(
          `Prevented attempt to open path outside of the repository root: ${filepath}`
        )
      }
    }
  }

  private async openBranchNameFromUrl(
    url: string,
    branchName: string
  ): Promise<Repository | null> {
    const repository = await this.openOrCloneRepository(url)

    if (repository === null) {
      return null
    }

    // ensure a fresh clone repository has it's in-memory state
    // up-to-date before performing the "Clone in Desktop" steps
    await this.appStore._refreshRepository(repository)

    await this.checkoutLocalBranch(repository, branchName)

    return repository
  }

  private async openPullRequestFromUrl(
    url: string,
    pr: string
  ): Promise<RepositoryWithGitHubRepository | null> {
    const pullRequest = await this.appStore.fetchPullRequest(url, pr)

    if (pullRequest === null) {
      return null
    }

    // Find the repository where the PR is created in Desktop.
    let repository: Repository | null = this.getRepositoryFromPullRequest(
      pullRequest
    )

    if (repository !== null) {
      await this.selectRepository(repository)
    } else {
      repository = await this.openOrCloneRepository(url)
    }

    if (repository === null) {
      log.warn(
        `Open Repository from URL failed, did not find or clone repository: ${url}`
      )
      return null
    }
    if (!isRepositoryWithGitHubRepository(repository)) {
      log.warn(
        `Received a non-GitHub repository when opening repository from URL: ${url}`
      )
      return null
    }

    // ensure a fresh clone repository has it's in-memory state
    // up-to-date before performing the "Clone in Desktop" steps
    await this.appStore._refreshRepository(repository)

    if (pullRequest.head.repo === null) {
      return null
    }

    await this.appStore._checkoutPullRequest(
      repository,
      pullRequest.number,
      pullRequest.head.repo.owner.login,
      pullRequest.head.repo.clone_url,
      pullRequest.head.ref
    )

    return repository
  }

  public async dispatchURLAction(action: URLActionType): Promise<void> {
    switch (action.name) {
      case 'oauth':
        try {
          log.info(`[Dispatcher] requesting authenticated user`)
          const user = await requestAuthenticatedUser(action.code, action.state)
          if (user) {
            resolveOAuthRequest(user)
          } else if (user === null) {
            rejectOAuthRequest(new Error('Unable to fetch authenticated user.'))
          }
        } catch (e) {
          rejectOAuthRequest(e)
        }

        if (__DARWIN__) {
          // workaround for user reports that the application doesn't receive focus
          // after completing the OAuth signin in the browser
          const window = remote.getCurrentWindow()
          if (!window.isFocused()) {
            log.info(
              `refocusing the main window after the OAuth flow is completed`
            )
            window.focus()
          }
        }
        break

      case 'open-repository-from-url':
        this.openRepositoryFromUrl(action)
        break

      case 'open-repository-from-path':
        // user may accidentally provide a folder within the repository
        // this ensures we use the repository root, if it is actually a repository
        // otherwise we consider it an untracked repository
        const path = (await validatedRepositoryPath(action.path)) || action.path
        const state = this.appStore.getState()
        let existingRepository = matchExistingRepository(
          state.repositories,
          path
        )

        // in case this is valid git repository, there is no need to ask
        // user for confirmation and it can be added automatically
        if (existingRepository == null) {
          const isRepository = await isGitRepository(path)
          if (isRepository) {
            const addedRepositories = await this.addRepositories([path])
            existingRepository = addedRepositories[0]
          }
        }

        if (existingRepository) {
          await this.selectRepository(existingRepository)
          this.statsStore.recordAddExistingRepository()
        } else {
          await this.showPopup({
            type: PopupType.AddRepository,
            path,
          })
        }
        break

      default:
        const unknownAction: IUnknownAction = action
        log.warn(
          `Unknown URL action: ${
            unknownAction.name
          } - payload: ${JSON.stringify(unknownAction)}`
        )
    }
  }

  /**
   * Sets the user's preference so that moving the app to /Applications is not asked
   */
  public setAskToMoveToApplicationsFolderSetting(
    value: boolean
  ): Promise<void> {
    return this.appStore._setAskToMoveToApplicationsFolderSetting(value)
  }

  /**
   * Sets the user's preference so that confirmation to remove repo is not asked
   */
  public setConfirmRepoRemovalSetting(value: boolean): Promise<void> {
    return this.appStore._setConfirmRepositoryRemovalSetting(value)
  }

  /**
   * Sets the user's preference so that confirmation to discard changes is not asked
   */
  public setConfirmDiscardChangesSetting(value: boolean): Promise<void> {
    return this.appStore._setConfirmDiscardChangesSetting(value)
  }

  /**
   * Sets the user's preference for handling uncommitted changes when switching branches
   */
  public setUncommittedChangesStrategySetting(
    value: UncommittedChangesStrategy
  ): Promise<void> {
    return this.appStore._setUncommittedChangesStrategySetting(value)
  }

  /**
   * Sets the user's preference for an external program to open repositories in.
   */
  public setExternalEditor(editor: string): Promise<void> {
    return this.appStore._setExternalEditor(editor)
  }

  /**
   * Sets the user's preferred shell.
   */
  public setShell(shell: Shell): Promise<void> {
    return this.appStore._setShell(shell)
  }

  private async checkoutLocalBranch(repository: Repository, branch: string) {
    let shouldCheckoutBranch = true

    const state = this.repositoryStateManager.get(repository)
    const branches = state.branchesState.allBranches

    const { tip } = state.branchesState

    if (tip.kind === TipState.Valid) {
      shouldCheckoutBranch = tip.branch.nameWithoutRemote !== branch
    }

    const localBranch = branches.find(b => b.nameWithoutRemote === branch)

    // N.B: This looks weird, and it is. _checkoutBranch used
    // to behave this way (silently ignoring checkout) when given
    // a branch name string that does not correspond to a local branch
    // in the git store. When rewriting _checkoutBranch
    // to remove the support for string branch names the behavior
    // was moved up to this method to not alter the current behavior.
    //
    // https://youtu.be/IjmtVKOAHPM
    if (shouldCheckoutBranch && localBranch !== undefined) {
      await this.checkoutBranch(repository, localBranch)
    }
  }

  private async openOrCloneRepository(url: string): Promise<Repository | null> {
    const state = this.appStore.getState()
    const repositories = state.repositories
    const existingRepository = repositories.find(r =>
      this.doesRepositoryMatchUrl(r, url)
    )

    if (existingRepository) {
      return await this.selectRepository(existingRepository)
    }

    return this.appStore._startOpenInDesktop(() => {
      this.changeCloneRepositoriesTab(CloneRepositoryTab.Generic)
      this.showPopup({
        type: PopupType.CloneRepository,
        initialURL: url,
      })
    })
  }

  /**
   * Install the CLI tool.
   *
   * This is used only on macOS.
   */
  public async installCLI() {
    try {
      await installCLI()

      this.showPopup({ type: PopupType.CLIInstalled })
    } catch (e) {
      log.error('Error installing CLI', e)

      this.postError(e)
    }
  }

  /** Prompt the user to authenticate for a generic git server. */
  public promptForGenericGitAuthentication(
    repository: Repository | CloningRepository,
    retry: RetryAction
  ): Promise<void> {
    return this.appStore.promptForGenericGitAuthentication(repository, retry)
  }

  /** Save the generic git credentials. */
  public async saveGenericGitCredentials(
    hostname: string,
    username: string,
    password: string
  ): Promise<void> {
    log.info(`storing generic credentials for '${hostname}' and '${username}'`)
    setGenericUsername(hostname, username)

    try {
      await setGenericPassword(hostname, username, password)
    } catch (e) {
      log.error(
        `Error saving generic git credentials: ${username}@${hostname}`,
        e
      )

      this.postError(e)
    }
  }

  /** Perform the given retry action. */
  public async performRetry(retryAction: RetryAction): Promise<void> {
    switch (retryAction.type) {
      case RetryActionType.Push:
        return this.push(retryAction.repository)

      case RetryActionType.Pull:
        return this.pull(retryAction.repository)

      case RetryActionType.Fetch:
        return this.fetch(retryAction.repository, FetchType.UserInitiatedTask)

      case RetryActionType.Clone:
        await this.clone(retryAction.url, retryAction.path, retryAction.options)
        break

      case RetryActionType.Checkout:
        await this.checkoutBranch(retryAction.repository, retryAction.branch)
        break

      case RetryActionType.Merge:
        return this.mergeBranch(
          retryAction.repository,
          retryAction.theirBranch,
          null
        )

      case RetryActionType.Rebase:
        return this.rebase(
          retryAction.repository,
          retryAction.baseBranch,
          retryAction.targetBranch
        )
      case RetryActionType.CherryPick:
        return this.cherryPick(
          retryAction.repository,
          retryAction.targetBranch,
          retryAction.commits,
          retryAction.sourceBranch
        )
      case RetryActionType.CreateBranchForCherryPick:
        return this.startCherryPickWithBranchName(
          retryAction.repository,
          retryAction.targetBranchName,
          retryAction.startPoint,
          retryAction.noTrackOption,
          retryAction.commits,
          retryAction.sourceBranch
        )
      default:
        return assertNever(retryAction, `Unknown retry action: ${retryAction}`)
    }
  }

  /** Change the selected image diff type. */
  public changeImageDiffType(type: ImageDiffType): Promise<void> {
    return this.appStore._changeImageDiffType(type)
  }

  /** Change the hide whitespace in changes diff setting */
  public onHideWhitespaceInChangesDiffChanged(
    hideWhitespaceInDiff: boolean,
    repository: Repository
  ): Promise<void> {
    return this.appStore._setHideWhitespaceInChangesDiff(
      hideWhitespaceInDiff,
      repository
    )
  }

  /** Change the hide whitespace in history diff setting */
  public onHideWhitespaceInHistoryDiffChanged(
    hideWhitespaceInDiff: boolean,
    repository: Repository,
    file: CommittedFileChange | null = null
  ): Promise<void> {
    return this.appStore._setHideWhitespaceInHistoryDiff(
      hideWhitespaceInDiff,
      repository,
      file
    )
  }

  /** Change the side by side diff setting */
  public onShowSideBySideDiffChanged(showSideBySideDiff: boolean) {
    return this.appStore._setShowSideBySideDiff(showSideBySideDiff)
  }

  /** Install the global Git LFS filters. */
  public installGlobalLFSFilters(force: boolean): Promise<void> {
    return this.appStore._installGlobalLFSFilters(force)
  }

  /** Install the LFS filters */
  public installLFSHooks(
    repositories: ReadonlyArray<Repository>
  ): Promise<void> {
    return this.appStore._installLFSHooks(repositories)
  }

  /** Change the selected Clone Repository tab. */
  public changeCloneRepositoriesTab(tab: CloneRepositoryTab): Promise<void> {
    return this.appStore._changeCloneRepositoriesTab(tab)
  }

  /**
   * Request a refresh of the list of repositories that
   * the provided account has explicit permissions to access.
   * See ApiRepositoriesStore for more details.
   */
  public refreshApiRepositories(account: Account) {
    return this.appStore._refreshApiRepositories(account)
  }

  /** Change the selected Branches foldout tab. */
  public changeBranchesTab(tab: BranchesTab): Promise<void> {
    return this.appStore._changeBranchesTab(tab)
  }

  /**
   * Open the Explore page at the GitHub instance of this repository
   */
  public showGitHubExplore(repository: Repository): Promise<void> {
    return this.appStore._showGitHubExplore(repository)
  }

  /**
   * Open the Create Pull Request page on GitHub after verifying ahead/behind.
   *
   * Note that this method will present the user with a dialog in case the
   * current branch in the repository is ahead or behind the remote.
   * The dialog lets the user choose whether get in sync with the remote
   * or open the PR anyway. This is distinct from the
   * openCreatePullRequestInBrowser method which immediately opens the
   * create pull request page without showing a dialog.
   */
  public createPullRequest(repository: Repository): Promise<void> {
    return this.appStore._createPullRequest(repository)
  }

  /**
   * Show the current pull request on github.com
   */
  public showPullRequest(repository: Repository): Promise<void> {
    return this.appStore._showPullRequest(repository)
  }

  /**
   * Immediately open the Create Pull Request page on GitHub.
   *
   * See the createPullRequest method for more details.
   */
  public openCreatePullRequestInBrowser(
    repository: Repository,
    branch: Branch
  ): Promise<void> {
    return this.appStore._openCreatePullRequestInBrowser(repository, branch)
  }

  /**
   * Update the existing `upstream` remote to point to the repository's parent.
   */
  public updateExistingUpstreamRemote(repository: Repository): Promise<void> {
    return this.appStore._updateExistingUpstreamRemote(repository)
  }

  /** Ignore the existing `upstream` remote. */
  public ignoreExistingUpstreamRemote(repository: Repository): Promise<void> {
    return this.appStore._ignoreExistingUpstreamRemote(repository)
  }

  /** Checks out a PR whose ref exists locally or in a forked repo. */
  public async checkoutPullRequest(
    repository: RepositoryWithGitHubRepository,
    pullRequest: PullRequest
  ): Promise<void> {
    if (pullRequest.head.gitHubRepository.cloneURL === null) {
      return
    }

    return this.appStore._checkoutPullRequest(
      repository,
      pullRequest.pullRequestNumber,
      pullRequest.head.gitHubRepository.owner.login,
      pullRequest.head.gitHubRepository.cloneURL,
      pullRequest.head.ref
    )
  }

  /**
   * Set whether the user has chosen to hide or show the
   * co-authors field in the commit message component
   *
   * @param repository Co-author settings are per-repository
   */
  public setShowCoAuthoredBy(
    repository: Repository,
    showCoAuthoredBy: boolean
  ) {
    return this.appStore._setShowCoAuthoredBy(repository, showCoAuthoredBy)
  }

  /**
   * Update the per-repository co-authors list
   *
   * @param repository Co-author settings are per-repository
   * @param coAuthors  Zero or more authors
   */
  public setCoAuthors(
    repository: Repository,
    coAuthors: ReadonlyArray<IAuthor>
  ) {
    return this.appStore._setCoAuthors(repository, coAuthors)
  }

  /**
   * Initialize the compare state for the current repository.
   */
  public initializeCompare(
    repository: Repository,
    initialAction?: CompareAction
  ) {
    return this.appStore._initializeCompare(repository, initialAction)
  }

  /**
   * Update the compare state for the current repository
   */
  public executeCompare(repository: Repository, action: CompareAction) {
    return this.appStore._executeCompare(repository, action)
  }

  /** Update the compare form state for the current repository */
  public updateCompareForm<K extends keyof ICompareFormUpdate>(
    repository: Repository,
    newState: Pick<ICompareFormUpdate, K>
  ) {
    return this.appStore._updateCompareForm(repository, newState)
  }

  /**
   *  update the manual resolution method for a file
   */
  public updateManualConflictResolution(
    repository: Repository,
    path: string,
    manualResolution: ManualConflictResolution | null
  ) {
    return this.appStore._updateManualConflictResolution(
      repository,
      path,
      manualResolution
    )
  }

  public async confirmOrForcePush(repository: Repository) {
    const { askForConfirmationOnForcePush } = this.appStore.getState()

    const { branchesState } = this.repositoryStateManager.get(repository)
    const { tip } = branchesState

    if (tip.kind !== TipState.Valid) {
      log.warn(`Could not find a branch to perform force push`)
      return
    }

    const { upstream } = tip.branch

    if (upstream === null) {
      log.warn(`Could not find an upstream branch which will be pushed`)
      return
    }

    if (askForConfirmationOnForcePush) {
      this.showPopup({
        type: PopupType.ConfirmForcePush,
        repository,
        upstreamBranch: upstream,
      })
    } else {
      await this.performForcePush(repository)
    }
  }

  public async performForcePush(repository: Repository) {
    await this.pushWithOptions(repository, {
      forceWithLease: true,
    })

    await this.appStore._loadStatus(repository)
  }

  public setConfirmForcePushSetting(value: boolean) {
    return this.appStore._setConfirmForcePushSetting(value)
  }

  /**
   * Converts a local repository to use the given fork
   * as its default remote and associated `GitHubRepository`.
   */
  public async convertRepositoryToFork(
    repository: RepositoryWithGitHubRepository,
    fork: IAPIFullRepository
  ): Promise<Repository> {
    return this.appStore._convertRepositoryToFork(repository, fork)
  }

  /**
   * Updates the application state to indicate a conflict is in-progress
   * as a result of a pull and increments the relevant metric.
   */
  public mergeConflictDetectedFromPull() {
    return this.statsStore.recordMergeConflictFromPull()
  }

  /**
   * Updates the application state to indicate a conflict is in-progress
   * as a result of a merge and increments the relevant metric.
   */
  public mergeConflictDetectedFromExplicitMerge() {
    return this.statsStore.recordMergeConflictFromExplicitMerge()
  }

  /**
   * Increments the `mergeIntoCurrentBranchMenuCount` metric
   */
  public recordMenuInitiatedMerge() {
    return this.statsStore.recordMenuInitiatedMerge()
  }

  /**
   * Increments the `rebaseIntoCurrentBranchMenuCount` metric
   */
  public recordMenuInitiatedRebase() {
    return this.statsStore.recordMenuInitiatedRebase()
  }

  /**
   * Increments the `updateFromDefaultBranchMenuCount` metric
   */
  public recordMenuInitiatedUpdate() {
    return this.statsStore.recordMenuInitiatedUpdate()
  }

  /**
   * Increments the `mergesInitiatedFromComparison` metric
   */
  public recordCompareInitiatedMerge() {
    return this.statsStore.recordCompareInitiatedMerge()
  }

  /**
   * Set the application-wide theme
   */
  public setSelectedTheme(theme: ApplicationTheme) {
    return this.appStore._setSelectedTheme(theme)
  }

  /**
   * Increments either the `repoWithIndicatorClicked` or
   * the `repoWithoutIndicatorClicked` metric
   */
  public recordRepoClicked(repoHasIndicator: boolean) {
    return this.statsStore.recordRepoClicked(repoHasIndicator)
  }

  /**
   * Increments the `createPullRequestCount` metric
   */
  public recordCreatePullRequest() {
    return this.statsStore.recordCreatePullRequest()
  }

  public recordWelcomeWizardInitiated() {
    return this.statsStore.recordWelcomeWizardInitiated()
  }

  public recordCreateRepository() {
    this.statsStore.recordCreateRepository()
  }

  public recordAddExistingRepository() {
    this.statsStore.recordAddExistingRepository()
  }

  /**
   * Increments the `mergeConflictsDialogDismissalCount` metric
   */
  public recordMergeConflictsDialogDismissal() {
    this.statsStore.recordMergeConflictsDialogDismissal()
  }

  /**
   * Increments the `mergeConflictsDialogReopenedCount` metric
   */
  public recordMergeConflictsDialogReopened() {
    this.statsStore.recordMergeConflictsDialogReopened()
  }

  /**
   * Increments the `anyConflictsLeftOnMergeConflictsDialogDismissalCount` metric
   */
  public recordAnyConflictsLeftOnMergeConflictsDialogDismissal() {
    this.statsStore.recordAnyConflictsLeftOnMergeConflictsDialogDismissal()
  }

  /**
   * Increments the `guidedConflictedMergeCompletionCount` metric
   */
  public recordGuidedConflictedMergeCompletion() {
    this.statsStore.recordGuidedConflictedMergeCompletion()
  }

  /**
   * Increments the `unguidedConflictedMergeCompletionCount` metric
   */
  public recordUnguidedConflictedMergeCompletion() {
    this.statsStore.recordUnguidedConflictedMergeCompletion()
  }

  // TODO: more rebase-related actions

  /**
   * Increments the `rebaseConflictsDialogDismissalCount` metric
   */
  public recordRebaseConflictsDialogDismissal() {
    this.statsStore.recordRebaseConflictsDialogDismissal()
  }

  /**
   * Increments the `rebaseConflictsDialogReopenedCount` metric
   */
  public recordRebaseConflictsDialogReopened() {
    this.statsStore.recordRebaseConflictsDialogReopened()
  }

  /** Increments the `errorWhenSwitchingBranchesWithUncommmittedChanges` metric */
  public recordErrorWhenSwitchingBranchesWithUncommmittedChanges() {
    return this.statsStore.recordErrorWhenSwitchingBranchesWithUncommmittedChanges()
  }

  /**
   * Refresh the list of open pull requests for the given repository.
   */
  public refreshPullRequests(repository: Repository): Promise<void> {
    return this.appStore._refreshPullRequests(repository)
  }

  /**
   * Attempt to retrieve a commit status for a particular
   * ref. If the ref doesn't exist in the cache this function returns null.
   *
   * Useful for component who wish to have a value for the initial render
   * instead of waiting for the subscription to produce an event.
   */
  public tryGetCommitStatus(
    repository: GitHubRepository,
    ref: string
  ): ICombinedRefCheck | null {
    return this.commitStatusStore.tryGetStatus(repository, ref)
  }

  /**
   * Subscribe to commit status updates for a particular ref.
   *
   * @param repository The GitHub repository to use when looking up commit status.
   * @param ref        The commit ref (can be a SHA or a Git ref) for which to
   *                   fetch status.
   * @param callback   A callback which will be invoked whenever the
   *                   store updates a commit status for the given ref.
   */
  public subscribeToCommitStatus(
    repository: GitHubRepository,
    ref: string,
    callback: StatusCallBack
  ): IDisposable {
    return this.commitStatusStore.subscribe(repository, ref, callback)
  }

  /**
   * Creates a stash for the current branch. Note that this will
   * override any stash that already exists for the current branch.
   *
   * @param repository
   * @param showConfirmationDialog  Whether to show a confirmation dialog if an
   *                                existing stash exists (defaults to true).
   */
  public createStashForCurrentBranch(
    repository: Repository,
    showConfirmationDialog: boolean = true
  ) {
    return this.appStore._createStashForCurrentBranch(
      repository,
      showConfirmationDialog
    )
  }

  /** Drops the given stash in the given repository */
  public dropStash(repository: Repository, stashEntry: IStashEntry) {
    return this.appStore._dropStashEntry(repository, stashEntry)
  }

  /** Pop the given stash in the given repository */
  public popStash(repository: Repository, stashEntry: IStashEntry) {
    return this.appStore._popStashEntry(repository, stashEntry)
  }

  /**
   * Set the width of the commit summary column in the
   * history view to the given value.
   */
  public setStashedFilesWidth = (width: number): Promise<void> => {
    return this.appStore._setStashedFilesWidth(width)
  }

  /**
   * Reset the width of the commit summary column in the
   * history view to its default value.
   */
  public resetStashedFilesWidth = (): Promise<void> => {
    return this.appStore._resetStashedFilesWidth()
  }

  /** Hide the diff for stashed changes */
  public hideStashedChanges(repository: Repository) {
    return this.appStore._hideStashedChanges(repository)
  }

  /**
   * Increment the number of times the user has opened their external editor
   * from the suggested next steps view
   */
  public recordSuggestedStepOpenInExternalEditor(): Promise<void> {
    return this.statsStore.recordSuggestedStepOpenInExternalEditor()
  }

  /**
   * Increment the number of times the user has opened their repository in
   * Finder/Explorer from the suggested next steps view
   */
  public recordSuggestedStepOpenWorkingDirectory(): Promise<void> {
    return this.statsStore.recordSuggestedStepOpenWorkingDirectory()
  }

  /**
   * Increment the number of times the user has opened their repository on
   * GitHub from the suggested next steps view
   */
  public recordSuggestedStepViewOnGitHub(): Promise<void> {
    return this.statsStore.recordSuggestedStepViewOnGitHub()
  }

  /**
   * Increment the number of times the user has used the publish repository
   * action from the suggested next steps view
   */
  public recordSuggestedStepPublishRepository(): Promise<void> {
    return this.statsStore.recordSuggestedStepPublishRepository()
  }

  /**
   * Increment the number of times the user has used the publish branch
   * action branch from the suggested next steps view
   */
  public recordSuggestedStepPublishBranch(): Promise<void> {
    return this.statsStore.recordSuggestedStepPublishBranch()
  }

  /**
   * Increment the number of times the user has used the Create PR suggestion
   * in the suggested next steps view.
   */
  public recordSuggestedStepCreatePullRequest(): Promise<void> {
    return this.statsStore.recordSuggestedStepCreatePullRequest()
  }

  /**
   * Increment the number of times the user has used the View Stash suggestion
   * in the suggested next steps view.
   */
  public recordSuggestedStepViewStash(): Promise<void> {
    return this.statsStore.recordSuggestedStepViewStash()
  }

  /** Record when the user takes no action on the stash entry */
  public recordNoActionTakenOnStash(): Promise<void> {
    return this.statsStore.recordNoActionTakenOnStash()
  }

  /** Record when the user views the stash entry */
  public recordStashView(): Promise<void> {
    return this.statsStore.recordStashView()
  }

  /** Call when the user opts to skip the pick editor step of the onboarding tutorial */
  public skipPickEditorTutorialStep(repository: Repository) {
    return this.appStore._skipPickEditorTutorialStep(repository)
  }

  /**
   * Call when the user has either created a pull request or opts to
   * skip the create pull request step of the onboarding tutorial
   */
  public markPullRequestTutorialStepAsComplete(repository: Repository) {
    return this.appStore._markPullRequestTutorialStepAsComplete(repository)
  }

  /**
   * Increments the `forksCreated ` metric` indicating that the user has
   * elected to create a fork when presented with a dialog informing
   * them that they don't have write access to the current repository.
   */
  public recordForkCreated() {
    return this.statsStore.recordForkCreated()
  }

  /**
   * Create a tutorial repository using the given account. The account
   * determines which host (i.e. GitHub.com or a GHES instance) that
   * the tutorial repository should be created on.
   *
   * @param account The account (and thereby the GitHub host) under
   *                which the repository is to be created created
   */
  public createTutorialRepository(account: Account) {
    return this.appStore._createTutorialRepository(account)
  }

  /** Open the issue creation page for a GitHub repository in a browser */
  public async openIssueCreationPage(repository: Repository): Promise<boolean> {
    // Default to creating issue on parent repo
    // See https://github.com/desktop/desktop/issues/9232 for rationale
    const url = getGitHubHtmlUrl(repository)
    if (url !== null) {
      this.statsStore.recordIssueCreationWebpageOpened()
      return this.appStore._openInBrowser(`${url}/issues/new/choose`)
    } else {
      return false
    }
  }

  public setRepositoryIndicatorsEnabled(repositoryIndicatorsEnabled: boolean) {
    this.appStore._setRepositoryIndicatorsEnabled(repositoryIndicatorsEnabled)
  }

  public setCommitSpellcheckEnabled(commitSpellcheckEnabled: boolean) {
    this.appStore._setCommitSpellcheckEnabled(commitSpellcheckEnabled)
  }

  public recordDiffOptionsViewed() {
    return this.statsStore.recordDiffOptionsViewed()
  }

  /**
   * Move the cherry pick flow to a new state.
   */
  public setCherryPickFlowStep(
    repository: Repository,
    step: CherryPickFlowStep
  ): Promise<void> {
    return this.appStore._setCherryPickFlowStep(repository, step)
  }

  /** Initialize and start the cherry pick operation */
  public async initializeCherryPickFlow(
    repository: Repository,
    commits: ReadonlyArray<CommitOneLine>
  ): Promise<void> {
    this.appStore._initializeCherryPickProgress(repository, commits)
    this.switchCherryPickingFlowToShowProgress(repository)
  }

  private logHowToRevertCherryPick(
    targetBranchName: string,
    beforeSha: string | null
  ) {
    log.info(
      `[cherryPick] starting cherry-pick for ${targetBranchName} at ${beforeSha}`
    )
    log.info(
      `[cherryPick] to restore the previous state if this completed cherry-pick is unsatisfactory:`
    )
    log.info(`[cherryPick] - git checkout ${targetBranchName}`)
    log.info(`[cherryPick] - git reset ${beforeSha} --hard`)
  }

  /** Starts a cherry pick of the given commits onto the target branch */
  public async cherryPick(
    repository: Repository,
    targetBranch: Branch,
    commits: ReadonlyArray<CommitOneLine>,
    sourceBranch: Branch | null
  ): Promise<void> {
    this.initializeCherryPickFlow(repository, commits)
    this.dismissCherryPickIntro()

    const retry: RetryAction = {
      type: RetryActionType.CherryPick,
      repository,
      targetBranch,
      commits,
      sourceBranch,
    }

    if (this.appStore._checkForUncommittedChanges(repository, retry)) {
      this.appStore._endCherryPickFlow(repository)
      return
    }

    const { tip } = targetBranch
    this.appStore._setCherryPickTargetBranchUndoSha(repository, tip.sha)

    if (commits.length > 1) {
      this.statsStore.recordCherryPickMultipleCommits()
    }

    const nameAfterCheckout = await this.appStore._checkoutBranchReturnName(
      repository,
      targetBranch
    )

    if (nameAfterCheckout === undefined) {
      log.error('[cherryPick] - Failed to check out the target branch.')
      this.endCherryPickFlow(repository)
      return
    }

    const result = await this.appStore._cherryPick(repository, commits)

    if (result !== CherryPickResult.UnableToStart) {
      this.logHowToRevertCherryPick(nameAfterCheckout, tip.sha)
    }

    this.processCherryPickResult(
      repository,
      result,
      nameAfterCheckout,
      commits,
      sourceBranch
    )
  }

  public async startCherryPickWithBranchName(
    repository: Repository,
    targetBranchName: string,
    startPoint: string | null,
    noTrackOption: boolean = false,
    commits: ReadonlyArray<CommitOneLine>,
    sourceBranch: Branch | null
  ): Promise<void> {
    const retry: RetryAction = {
      type: RetryActionType.CreateBranchForCherryPick,
      repository,
      targetBranchName,
      startPoint,
      noTrackOption,
      commits,
      sourceBranch,
    }

    if (this.appStore._checkForUncommittedChanges(repository, retry)) {
      this.appStore._endCherryPickFlow(repository)
      return
    }

    const targetBranch = await this.appStore._createBranch(
      repository,
      targetBranchName,
      startPoint,
      noTrackOption,
      false
    )

    if (targetBranch === undefined) {
      log.error(
        '[startCherryPickWithBranchName] - Unable to create branch for cherry-pick operation'
      )
      this.endCherryPickFlow(repository)
      return
    }

    this.appStore._setCherryPickBranchCreated(repository, true)
    this.statsStore.recordCherryPickBranchCreatedCount()
    return this.cherryPick(repository, targetBranch, commits, sourceBranch)
  }

  /**
   * This method starts a cherry pick after drag and dropping on a branch.
   * It needs to:
   *  - get the current branch,
   *  - get the commits dragged from cherry picking state
   *  - invoke popup
   *  - invoke cherry pick
   */
  public async startCherryPickWithBranch(
    repository: Repository,
    targetBranch: Branch
  ): Promise<void> {
    const { branchesState, cherryPickState } = this.repositoryStateManager.get(
      repository
    )

    if (
      cherryPickState.step == null ||
      cherryPickState.step.kind !== CherryPickStepKind.CommitsChosen
    ) {
      log.error(
        '[cherryPick] Invalid Cherry-picking State: Could not determine selected commits.'
      )
      this.endCherryPickFlow(repository)
      return
    }

    const { tip } = branchesState
    if (tip.kind !== TipState.Valid) {
      this.endCherryPickFlow(repository)
      throw new Error(
        'Tip is not in a valid state, which is required to start the cherry-pick flow.'
      )
    }
    const sourceBranch = tip.branch
    const commits = cherryPickState.step.commits

    this.showPopup({
      type: PopupType.CherryPick,
      repository,
      commits,
      sourceBranch,
    })

    this.statsStore.recordCherryPickViaDragAndDrop()
    this.setCherryPickBranchCreated(repository, false)
    this.cherryPick(repository, targetBranch, commits, sourceBranch)
  }

  /**
   * Method to start a cherry-pick after drag and dropping onto a pull request.
   */
  public async startCherryPickWithPullRequest(
    repository: RepositoryWithGitHubRepository,
    pullRequest: PullRequest
  ) {
    const { pullRequestNumber, head } = pullRequest
    const { ref, gitHubRepository } = head
    const {
      cloneURL,
      owner: { login },
    } = gitHubRepository

    let targetBranch
    if (cloneURL !== null) {
      targetBranch = await this.appStore._findPullRequestBranch(
        repository,
        pullRequestNumber,
        login,
        cloneURL,
        ref
      )
    }

    if (targetBranch === undefined) {
      log.error(
        '[cherryPick] Could not determine target branch for cherry-pick operation - aborting cherry-pick.'
      )
      this.endCherryPickFlow(repository)
      return
    }

    return this.startCherryPickWithBranch(repository, targetBranch)
  }

  /**
   * Continue with the cherryPick after the user has resolved all conflicts with
   * tracked files in the working directory.
   */
  public async continueCherryPick(
    repository: Repository,
    files: ReadonlyArray<WorkingDirectoryFileChange>,
    conflictsState: CherryPickConflictState,
    commits: ReadonlyArray<CommitOneLine>,
    sourceBranch: Branch | null
  ): Promise<void> {
    await this.switchCherryPickingFlowToShowProgress(repository)

    const result = await this.appStore._continueCherryPick(
      repository,
      files,
      conflictsState.manualResolutions
    )

    if (result === CherryPickResult.CompletedWithoutError) {
      this.statsStore.recordCherryPickSuccessfulWithConflicts()
    }

    this.processCherryPickResult(
      repository,
      result,
      conflictsState.targetBranchName,
      commits,
      sourceBranch
    )
  }

  /**
   * Obtains the current app conflict state and switches cherry pick flow to
   * show conflicts step
   */
  private startConflictCherryPickFlow(repository: Repository): void {
    const stateAfter = this.repositoryStateManager.get(repository)
    const { conflictState } = stateAfter.changesState
    if (conflictState === null || !isCherryPickConflictState(conflictState)) {
      log.error(
        '[cherryPick] - conflict state was null or not in a cherry-pick conflict state - unable to continue'
      )
      this.endCherryPickFlow(repository)
      return
    }
    this.setCherryPickFlowStep(repository, {
      kind: CherryPickStepKind.ShowConflicts,
      conflictState,
    })
    this.statsStore.recordCherryPickConflictsEncountered()
  }

  /** Tidy up the cherry pick flow after reaching the end */
  /** Wrap cherry pick up actions:
   * - closes flow popup
   * - displays success banner
   * - clears out cherry pick flow state
   */
  private async completeCherryPick(
    repository: Repository,
    targetBranchName: string,
    countCherryPicked: number,
    sourceBranch: Branch | null
  ): Promise<void> {
    this.closePopup()

    const banner: Banner = {
      type: BannerType.SuccessfulCherryPick,
      targetBranchName,
      countCherryPicked,
      onUndoCherryPick: () => {
        this.undoCherryPick(
          repository,
          targetBranchName,
          sourceBranch,
          countCherryPicked
        )
      },
    }
    this.setBanner(banner)

    this.appStore._endCherryPickFlow(repository)

    this.statsStore.recordCherryPickSuccessful()

    await this.refreshRepository(repository)
  }

  /** Aborts an ongoing cherry pick and switches back to the source branch. */
  public async abortCherryPick(
    repository: Repository,
    sourceBranch: Branch | null
  ) {
    await this.appStore._abortCherryPick(repository, sourceBranch)
    await this.appStore._loadStatus(repository)
    this.appStore._endCherryPickFlow(repository)
    await this.refreshRepository(repository)
  }

  /**
   * Update the cherry pick state to indicate the user has resolved conflicts in
   * the current repository.
   */
  public setCherryPickConflictsResolved(repository: Repository) {
    return this.appStore._setCherryPickConflictsResolved(repository)
  }

  /**
   * Moves cherry pick flow step to progress and defers to allow user to
   * see the cherry picking progress dialog instead of suddenly appearing
   * and disappearing again.
   */
  private async switchCherryPickingFlowToShowProgress(repository: Repository) {
    this.setCherryPickFlowStep(repository, {
      kind: CherryPickStepKind.ShowProgress,
    })
    await sleep(500)
  }

  /**
   * Processes the cherry pick result.
   *  1. Completes the cherry pick with banner if successful.
   *  2. Moves cherry pick flow if conflicts.
   *  3. Handles errors.
   */
  private async processCherryPickResult(
    repository: Repository,
    cherryPickResult: CherryPickResult,
    targetBranchName: string,
    commits: ReadonlyArray<CommitOneLine>,
    sourceBranch: Branch | null
  ): Promise<void> {
    // This will update the conflict state of the app. This is needed to start
    // conflict flow if cherry pick results in conflict.
    await this.appStore._loadStatus(repository)

    switch (cherryPickResult) {
      case CherryPickResult.CompletedWithoutError:
        await this.changeCommitSelection(repository, [commits[0].sha])
        await this.completeCherryPick(
          repository,
          targetBranchName,
          commits.length,
          sourceBranch
        )
        break
      case CherryPickResult.ConflictsEncountered:
        this.startConflictCherryPickFlow(repository)
        break
      case CherryPickResult.UnableToStart:
        // This is an expected error such as not being able to checkout the
        // target branch which means the cherry pick operation never started or
        // was cleanly aborted.
        this.appStore._endCherryPickFlow(repository)
        break
      default:
        // If the user closes error dialog and tries to cherry pick again, it
        // will fail again due to ongoing cherry pick. Thus, if we get to an
        // unhandled error state, we want to abort any ongoing cherry pick.
        // A known error is if a user attempts to cherry pick a merge commit.
        this.appStore._clearCherryPickingHead(repository, sourceBranch)
        this.appStore._endCherryPickFlow(repository)
        this.appStore._closePopup()
    }
  }

  /**
   * Update the cherry pick progress in application state by querying the Git
   * repository state.
   */
  public setCherryPickProgressFromState(repository: Repository) {
    return this.appStore._setCherryPickProgressFromState(repository)
  }

  /** Method to dismiss cherry pick intro */
  public dismissCherryPickIntro(): void {
    this.appStore._dismissCherryPickIntro()
  }

  /**
   * This method will perform a hard reset back to the tip of the target branch
   * before the cherry pick happened.
   */
  private async undoCherryPick(
    repository: Repository,
    targetBranchName: string,
    sourceBranch: Branch | null,
    commitsCount: number
  ): Promise<void> {
    const result = await this.appStore._undoCherryPick(
      repository,
      targetBranchName,
      sourceBranch,
      commitsCount
    )
    if (result) {
      this.statsStore.recordCherryPickUndone()
    }
  }

  /** Method to record cherry pick initiated via the context menu. */
  public recordCherryPickViaContextMenu() {
    this.statsStore.recordCherryPickViaContextMenu()
  }

  /** Method to record cherry pick started via drag and drop and canceled. */
  public recordCherryPickDragStartedAndCanceled() {
    this.statsStore.recordCherryPickDragStartedAndCanceled()
  }

  /** Method to reset cherry picking state. */
  public endCherryPickFlow(repository: Repository) {
    this.appStore._endCherryPickFlow(repository)
  }

  /** Method to set the drag element */
  public setDragElement(dragElement: DragElement): void {
    this.appStore._setDragElement(dragElement)
  }

  /** Method to clear the drag element */
  public clearDragElement(): void {
    this.appStore._setDragElement(null)
  }

  /** Set Cherry Pick Flow Step For Create Branch */
  public async setCherryPickCreateBranchFlowStep(
    repository: Repository,
    targetBranchName: string
  ): Promise<void> {
    const { branchesState, cherryPickState } = this.repositoryStateManager.get(
      repository
    )
    const { defaultBranch, allBranches, tip } = branchesState

    if (tip.kind === TipState.Unknown) {
      this.appStore._clearCherryPickingHead(repository, null)
      this.appStore._endCherryPickFlow(repository)
      log.error('Tip is in unknown state. Cherry-pick aborted.')
      return
    }

    const isGHRepo = isRepositoryWithGitHubRepository(repository)
    const upstreamGhRepo = isGHRepo
      ? getNonForkGitHubRepository(repository as RepositoryWithGitHubRepository)
      : null
    const upstreamDefaultBranch = isGHRepo
      ? findDefaultUpstreamBranch(
          repository as RepositoryWithGitHubRepository,
          allBranches
        )
      : null

    const step: CreateBranchStep = {
      kind: CherryPickStepKind.CreateBranch,
      allBranches,
      defaultBranch,
      upstreamDefaultBranch,
      upstreamGhRepo,
      tip,
      targetBranchName,
    }

    await this.appStore._setCherryPickFlowStep(repository, step)

    if (
      cherryPickState.step == null ||
      cherryPickState.step.kind !== CherryPickStepKind.CommitsChosen
    ) {
      // Started from context menu, cherry pick flow popup already open
      return
    }

    const sourceBranch = tip.kind === TipState.Valid ? tip.branch : null

    // If invoked from drag/drop, we need to show the cherry pick flow popup
    this.showPopup({
      type: PopupType.CherryPick,
      repository,
      commits: cherryPickState.step.commits,
      sourceBranch,
    })
  }

  /** Set cherry-pick branch created state */
  public setCherryPickBranchCreated(
    repository: Repository,
    branchCreated: boolean
  ): void {
    this.appStore._setCherryPickBranchCreated(repository, branchCreated)
  }

  /** Gets a branches ahead behind remote or null if doesn't exist on remote */
  public async getBranchAheadBehind(
    repository: Repository,
    branch: Branch
  ): Promise<IAheadBehind | null> {
    return this.appStore._getBranchAheadBehind(repository, branch)
  }
}
