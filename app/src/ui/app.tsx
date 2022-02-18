import * as React from 'react'
import { ipcRenderer, remote } from 'electron'
import { TransitionGroup, CSSTransition } from 'react-transition-group'

import {
  IAppState,
  RepositorySectionTab,
  FoldoutType,
  SelectionType,
  HistoryTabMode,
} from '../lib/app-state'
import { Dispatcher } from './dispatcher'
import { AppStore, GitHubUserStore, IssuesStore } from '../lib/stores'
import { assertNever } from '../lib/fatal-error'
import { shell } from '../lib/app-shell'
import { updateStore, UpdateStatus } from './lib/update-store'
import { RetryAction } from '../models/retry-actions'
import { shouldRenderApplicationMenu } from './lib/features'
import { matchExistingRepository } from '../lib/repository-matching'
import { getDotComAPIEndpoint } from '../lib/api'
import { ILaunchStats, SamplesURL } from '../lib/stats'
import { getVersion, getName } from './lib/app-proxy'
import { getOS } from '../lib/get-os'
import { validatedRepositoryPath } from '../lib/stores/helpers/validated-repository-path'
import { MenuEvent } from '../main-process/menu'
import {
  Repository,
  getGitHubHtmlUrl,
  getNonForkGitHubRepository,
  isRepositoryWithGitHubRepository,
} from '../models/repository'
import { Branch } from '../models/branch'
import { PreferencesTab } from '../models/preferences'
import { findItemByAccessKey, itemIsSelectable } from '../models/app-menu'
import { Account } from '../models/account'
import { TipState } from '../models/tip'
import { CloneRepositoryTab } from '../models/clone-repository-tab'
import { CloningRepository } from '../models/cloning-repository'

import { TitleBar, ZoomInfo, FullScreenInfo } from './window'

import { RepositoriesList } from './repositories-list'
import { RepositoryView } from './repository'
import { RenameBranch } from './rename-branch'
import { DeleteBranch } from './delete-branch'
import { CloningRepositoryView } from './cloning-repository'
import {
  Toolbar,
  ToolbarDropdown,
  DropdownState,
  PushPullButton,
  BranchDropdown,
  RevertProgress,
} from './toolbar'
import { OcticonSymbol, iconForRepository } from './octicons'
import { showCertificateTrustDialog, sendReady } from './main-process-proxy'
import { DiscardChanges } from './discard-changes'
import { Welcome } from './welcome'
import { AppMenuBar } from './app-menu'
import { UpdateAvailable, renderBanner } from './banners'
import { Preferences } from './preferences'
import { Merge } from './merge-branch'
import { RepositorySettings } from './repository-settings'
import { AppError } from './app-error'
import { MissingRepository } from './missing-repository'
import { AddExistingRepository, CreateRepository } from './add-repository'
import { CloneRepository } from './clone-repository'
import { CreateBranch } from './create-branch'
import { SignIn } from './sign-in'
import { InstallGit } from './install-git'
import { EditorError } from './editor'
import { About } from './about'
import { Publish } from './publish-repository'
import { Acknowledgements } from './acknowledgements'
import { UntrustedCertificate } from './untrusted-certificate'
import { NoRepositoriesView } from './no-repositories'
import { ConfirmRemoveRepository } from './remove-repository'
import { TermsAndConditions } from './terms-and-conditions'
import { PushBranchCommits } from './branches'
import { CLIInstalled } from './cli-installed'
import { GenericGitAuthentication } from './generic-git-auth'
import { ShellError } from './shell'
import { InitializeLFS, AttributeMismatch } from './lfs'
import { UpstreamAlreadyExists } from './upstream-already-exists'
import { ReleaseNotes } from './release-notes'
import { DeletePullRequest } from './delete-branch/delete-pull-request-dialog'
import { MergeConflictsDialog, CommitConflictsWarning } from './merge-conflicts'
import { AppTheme } from './app-theme'
import { ApplicationTheme } from './lib/application-theme'
import { RepositoryStateCache } from '../lib/stores/repository-state-cache'
import { AbortMergeWarning } from './abort-merge'
import { isConflictedFile } from '../lib/status'
import { PopupType, Popup } from '../models/popup'
import { OversizedFiles } from './changes/oversized-files-warning'
import { UsageStatsChange } from './usage-stats-change'
import { PushNeedsPullWarning } from './push-needs-pull'
import { RebaseFlow, ConfirmForcePush } from './rebase'
import {
  initializeNewRebaseFlow,
  initializeRebaseFlowForConflictedRepository,
  isCurrentBranchForcePush,
} from '../lib/rebase'
import { BannerType } from '../models/banner'
import { StashAndSwitchBranch } from './stash-changes/stash-and-switch-branch-dialog'
import { OverwriteStash } from './stash-changes/overwrite-stashed-changes-dialog'
import { ConfirmDiscardStashDialog } from './stashing/confirm-discard-stash'
import { CreateTutorialRepositoryDialog } from './no-repositories/create-tutorial-repository-dialog'
import { enableForkyCreateBranchUI } from '../lib/feature-flag'
import { ConfirmExitTutorial } from './tutorial'
import { TutorialStep, isValidTutorialStep } from '../models/tutorial-step'
import { WorkflowPushRejectedDialog } from './workflow-push-rejected/workflow-push-rejected'
import { SAMLReauthRequiredDialog } from './saml-reauth-required/saml-reauth-required'
import { CreateForkDialog } from './forks/create-fork-dialog'
import { findDefaultUpstreamBranch } from '../lib/branch'
import { GitHubRepository } from '../models/github-repository'
import { CreateTag } from './create-tag'
import { DeleteTag } from './delete-tag'
import { ChooseForkSettings } from './choose-fork-settings'
import { DiscardSelection } from './discard-changes/discard-selection-dialog'
import { LocalChangesOverwrittenDialog } from './local-changes-overwritten/local-changes-overwritten-dialog'
import memoizeOne from 'memoize-one'

const MinuteInMilliseconds = 1000 * 60
const HourInMilliseconds = MinuteInMilliseconds * 60

/**
 * Check for updates every 4 hours
 */
const UpdateCheckInterval = 4 * HourInMilliseconds

/**
 * Send usage stats every 4 hours
 */
const SendStatsInterval = 4 * HourInMilliseconds

interface IAppProps {
  readonly dispatcher: Dispatcher
  readonly repositoryStateManager: RepositoryStateCache
  readonly appStore: AppStore
  readonly issuesStore: IssuesStore
  readonly gitHubUserStore: GitHubUserStore
  readonly startTime: number
}

export const dialogTransitionTimeout = {
  enter: 250,
  exit: 100,
}

export const bannerTransitionTimeout = { enter: 500, exit: 400 }

/**
 * The time to delay (in ms) from when we've loaded the initial state to showing
 * the window. This is try to give Chromium enough time to flush our latest DOM
 * changes. See https://github.com/desktop/desktop/issues/1398.
 */
const ReadyDelay = 100

export class App extends React.Component<IAppProps, IAppState> {
  private loading = true

  /**
   * Used on non-macOS platforms to support the Alt key behavior for
   * the custom application menu. See the event handlers for window
   * keyup and keydown.
   */
  private lastKeyPressed: string | null = null

  private updateIntervalHandle?: number

  /**
   * Gets a value indicating whether or not we're currently showing a
   * modal dialog such as the preferences, or an error dialog.
   */
  private get isShowingModal() {
    return this.state.currentPopup !== null || this.state.errors.length > 0
  }

  /**
   * Returns a memoized instance of onPopupDismissed() bound to the
   * passed popupType, so it can be used in render() without creating
   * multiple instances when the component gets re-rendered.
   */
  private getOnPopupDismissedFn = memoizeOne((popupType: PopupType) => {
    return () => this.onPopupDismissed(popupType)
  })

  public constructor(props: IAppProps) {
    super(props)

    props.dispatcher.loadInitialState().then(() => {
      this.loading = false
      this.forceUpdate()

      requestIdleCallback(
        () => {
          const now = performance.now()
          sendReady(now - props.startTime)

          requestIdleCallback(() => {
            this.performDeferredLaunchActions()
          })
        },
        { timeout: ReadyDelay }
      )
    })

    this.state = props.appStore.getState()
    props.appStore.onDidUpdate(state => {
      this.setState(state)
    })

    props.appStore.onDidError(error => {
      props.dispatcher.postError(error)
    })

    ipcRenderer.on(
      'menu-event',
      (event: Electron.IpcRendererEvent, { name }: { name: MenuEvent }) => {
        this.onMenuEvent(name)
      }
    )

    updateStore.onDidChange(state => {
      const status = state.status

      if (
        !(
          __RELEASE_CHANNEL__ === 'development' ||
          __RELEASE_CHANNEL__ === 'test'
        ) &&
        status === UpdateStatus.UpdateReady
      ) {
        this.props.dispatcher.setUpdateBannerVisibility(true)
      }
    })

    updateStore.onError(error => {
      log.error(`Error checking for updates`, error)

      this.props.dispatcher.postError(error)
    })

    ipcRenderer.on(
      'launch-timing-stats',
      (
        event: Electron.IpcRendererEvent,
        { stats }: { stats: ILaunchStats }
      ) => {
        console.info(`App ready time: ${stats.mainReadyTime}ms`)
        console.info(`Load time: ${stats.loadTime}ms`)
        console.info(`Renderer ready time: ${stats.rendererReadyTime}ms`)

        this.props.dispatcher.recordLaunchStats(stats)
      }
    )

    ipcRenderer.on(
      'certificate-error',
      (
        event: Electron.IpcRendererEvent,
        {
          certificate,
          error,
          url,
        }: { certificate: Electron.Certificate; error: string; url: string }
      ) => {
        this.props.dispatcher.showPopup({
          type: PopupType.UntrustedCertificate,
          certificate,
          url,
        })
      }
    )
  }

  public componentWillUnmount() {
    window.clearInterval(this.updateIntervalHandle)
  }

  private performDeferredLaunchActions() {
    // Loading emoji is super important but maybe less important that loading
    // the app. So defer it until we have some breathing space.
    this.props.appStore.loadEmoji()

    this.props.dispatcher.reportStats()
    setInterval(() => this.props.dispatcher.reportStats(), SendStatsInterval)

    this.props.dispatcher.installGlobalLFSFilters(false)

    setInterval(() => this.checkForUpdates(true), UpdateCheckInterval)
    this.checkForUpdates(true)

    log.info(`launching: ${getVersion()} (${getOS()})`)
    log.info(`execPath: '${process.execPath}'`)
  }

  private onMenuEvent(name: MenuEvent): any {
    // Don't react to menu events when an error dialog is shown.
    if (this.state.errors.length) {
      return
    }

    switch (name) {
      case 'push':
        return this.push()
      case 'force-push':
        return this.push({ forceWithLease: true })
      case 'pull':
        return this.pull()
      case 'show-changes':
        return this.showChanges()
      case 'show-history':
        return this.showHistory()
      case 'choose-repository':
        return this.chooseRepository()
      case 'add-local-repository':
        return this.showAddLocalRepo()
      case 'create-branch':
        return this.showCreateBranch()
      case 'show-branches':
        return this.showBranches()
      case 'remove-repository':
        return this.removeRepository(this.getRepository())
      case 'create-repository':
        return this.showCreateRepository()
      case 'rename-branch':
        return this.renameBranch()
      case 'delete-branch':
        return this.deleteBranch()
      case 'discard-all-changes':
        return this.discardAllChanges()
      case 'stash-all-changes':
        return this.stashAllChanges()
      case 'show-preferences':
        return this.props.dispatcher.showPopup({ type: PopupType.Preferences })
      case 'open-working-directory':
        return this.openCurrentRepositoryWorkingDirectory()
      case 'update-branch':
        this.props.dispatcher.recordMenuInitiatedUpdate()
        return this.updateBranch()
      case 'compare-to-branch':
        return this.showHistory(true)
      case 'merge-branch':
        this.props.dispatcher.recordMenuInitiatedMerge()
        return this.mergeBranch()
      case 'rebase-branch':
        this.props.dispatcher.recordMenuInitiatedRebase()
        return this.showRebaseDialog()
      case 'show-repository-settings':
        return this.showRepositorySettings()
      case 'view-repository-on-github':
        return this.viewRepositoryOnGitHub()
      case 'compare-on-github':
        return this.compareBranchOnDotcom()
      case 'create-issue-in-repository-on-github':
        return this.openIssueCreationOnGitHub()
      case 'open-in-shell':
        return this.openCurrentRepositoryInShell()
      case 'clone-repository':
        return this.showCloneRepo()
      case 'show-about':
        return this.showAbout()
      case 'boomtown':
        return this.boomtown()
      case 'go-to-commit-message':
        return this.goToCommitMessage()
      case 'open-pull-request':
        return this.openPullRequest()
      case 'install-cli':
        return this.props.dispatcher.installCLI()
      case 'open-external-editor':
        return this.openCurrentRepositoryInExternalEditor()
      case 'select-all':
        return this.selectAll()
      case 'show-release-notes-popup':
        return this.showFakeReleaseNotesPopup()
      case 'show-stashed-changes':
        return this.showStashedChanges()
      case 'hide-stashed-changes':
        return this.hideStashedChanges()
      case 'test-prune-branches':
        return this.testPruneBranches()
      case 'find-text':
        return this.findText()
      default:
        return assertNever(name, `Unknown menu event name: ${name}`)
    }
  }

  /**
   * Show a release notes popup for a fake release, intended only to
   * make it easier to verify changes to the popup. Has no meaning
   * about a new release being available.
   */
  private showFakeReleaseNotesPopup() {
    if (__DEV__) {
      this.props.dispatcher.showPopup({
        type: PopupType.ReleaseNotes,
        newRelease: {
          latestVersion: '42.7.99',
          datePublished: 'Awesomeber 71, 2025',
          pretext:
            'There is something so different here that we wanted to include some pretext for it',
          enhancements: [
            {
              kind: 'new',
              message: 'An awesome new feature!',
            },
            {
              kind: 'improved',
              message: 'This is so much better',
            },
            {
              kind: 'improved',
              message:
                'Testing links to profile pages by a mention to @shiftkey',
            },
          ],
          bugfixes: [
            {
              kind: 'fixed',
              message: 'Fixed this one thing',
            },
            {
              kind: 'fixed',
              message: 'Fixed this thing over here too',
            },
            {
              kind: 'fixed',
              message:
                'Testing links to issues by calling out #42. Assuming it is fixed by now.',
            },
          ],
          other: [
            {
              kind: 'other',
              message: 'In other news...',
            },
          ],
        },
      })
    }
  }

  private testPruneBranches() {
    if (!__DEV__) {
      return
    }

    this.props.appStore._testPruneBranches()
  }

  /**
   * Handler for the 'select-all' menu event, dispatches
   * a custom DOM event originating from the element which
   * currently has keyboard focus. Components have a chance
   * to intercept this event and implement their own 'select
   * all' logic.
   */
  private selectAll() {
    const event = new CustomEvent('select-all', {
      bubbles: true,
      cancelable: true,
    })

    if (
      document.activeElement != null &&
      document.activeElement.dispatchEvent(event)
    ) {
      remote.getCurrentWebContents().selectAll()
    }
  }

  /**
   * Handler for the 'find-text' menu event, dispatches
   * a custom DOM event originating from the element which
   * currently has keyboard focus (or the document if no element
   * has focus). Components have a chance to intercept this
   * event and implement their own 'find-text' logic. One
   * example of this custom event is the text diff which
   * will trigger a search dialog when seeing this event.
   */
  private findText() {
    const event = new CustomEvent('find-text', {
      bubbles: true,
      cancelable: true,
    })

    if (document.activeElement != null) {
      document.activeElement.dispatchEvent(event)
    } else {
      document.dispatchEvent(event)
    }
  }

  private boomtown() {
    setImmediate(() => {
      throw new Error('Boomtown!')
    })
  }

  private async goToCommitMessage() {
    await this.showChanges()
    this.props.dispatcher.setCommitMessageFocus(true)
  }

  private checkForUpdates(inBackground: boolean) {
    if (__LINUX__) {
      return
    }

    if (
      __RELEASE_CHANNEL__ === 'development' ||
      __RELEASE_CHANNEL__ === 'test'
    ) {
      return
    }

    updateStore.checkForUpdates(inBackground)
  }

  private getDotComAccount(): Account | null {
    const dotComAccount = this.state.accounts.find(
      a => a.endpoint === getDotComAPIEndpoint()
    )
    return dotComAccount || null
  }

  private getEnterpriseAccount(): Account | null {
    const enterpriseAccount = this.state.accounts.find(
      a => a.endpoint !== getDotComAPIEndpoint()
    )
    return enterpriseAccount || null
  }

  private updateBranch() {
    const { selectedState } = this.state
    if (
      selectedState == null ||
      selectedState.type !== SelectionType.Repository
    ) {
      return
    }

    const { state } = selectedState
    const defaultBranch = state.branchesState.defaultBranch
    if (!defaultBranch) {
      return
    }

    const { mergeStatus } = state.compareState
    this.props.dispatcher.mergeBranch(
      selectedState.repository,
      defaultBranch.name,
      mergeStatus
    )
  }

  private mergeBranch() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    this.props.dispatcher.showPopup({
      type: PopupType.MergeBranch,
      repository: state.repository,
    })
  }

  private compareBranchOnDotcom() {
    const htmlURL = this.getCurrentRepositoryGitHubURL()
    if (!htmlURL) {
      return
    }

    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    const branchTip = state.state.branchesState.tip
    if (
      branchTip.kind !== TipState.Valid ||
      !branchTip.branch.upstreamWithoutRemote
    ) {
      return
    }

    const compareURL = `${htmlURL}/compare/${branchTip.branch.upstreamWithoutRemote}`
    this.props.dispatcher.openInBrowser(compareURL)
  }

  private openCurrentRepositoryWorkingDirectory() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    this.showRepository(state.repository)
  }

  private renameBranch() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    const tip = state.state.branchesState.tip
    if (tip.kind === TipState.Valid) {
      this.props.dispatcher.showPopup({
        type: PopupType.RenameBranch,
        repository: state.repository,
        branch: tip.branch,
      })
    }
  }

  private deleteBranch() {
    const state = this.state.selectedState
    if (state === null || state.type !== SelectionType.Repository) {
      return
    }

    const tip = state.state.branchesState.tip

    if (tip.kind === TipState.Valid) {
      const currentPullRequest = state.state.branchesState.currentPullRequest
      if (currentPullRequest !== null) {
        this.props.dispatcher.showPopup({
          type: PopupType.DeletePullRequest,
          repository: state.repository,
          branch: tip.branch,
          pullRequest: currentPullRequest,
        })
      } else {
        const existsOnRemote = state.state.aheadBehind !== null

        this.props.dispatcher.showPopup({
          type: PopupType.DeleteBranch,
          repository: state.repository,
          branch: tip.branch,
          existsOnRemote: existsOnRemote,
        })
      }
    }
  }

  private discardAllChanges() {
    const state = this.state.selectedState

    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    const { workingDirectory } = state.state.changesState

    this.props.dispatcher.showPopup({
      type: PopupType.ConfirmDiscardChanges,
      repository: state.repository,
      files: workingDirectory.files,
      showDiscardChangesSetting: false,
      discardingAllChanges: true,
    })
  }

  private stashAllChanges() {
    const repository = this.getRepository()

    if (repository !== null && repository instanceof Repository) {
      this.props.dispatcher.createStashForCurrentBranch(repository)
    }
  }

  private showAddLocalRepo = () => {
    return this.props.dispatcher.showPopup({ type: PopupType.AddRepository })
  }

  private showCreateRepository = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.CreateRepository,
    })
  }

  private showCloneRepo = (cloneUrl?: string) => {
    let initialURL: string | null = null

    if (cloneUrl !== undefined) {
      this.props.dispatcher.changeCloneRepositoriesTab(
        CloneRepositoryTab.Generic
      )
      initialURL = cloneUrl
    }

    return this.props.dispatcher.showPopup({
      type: PopupType.CloneRepository,
      initialURL,
    })
  }

  private showCreateTutorialRepositoryPopup = () => {
    const account = this.getDotComAccount() || this.getEnterpriseAccount()

    if (account === null) {
      return
    }

    this.props.dispatcher.showPopup({
      type: PopupType.CreateTutorialRepository,
      account,
    })
  }

  private onResumeTutorialRepository = () => {
    const tutorialRepository = this.getSelectedTutorialRepository()
    if (!tutorialRepository) {
      return
    }

    this.props.dispatcher.resumeTutorial(tutorialRepository)
  }

  private getSelectedTutorialRepository() {
    const { selectedState } = this.state
    const selectedRepository =
      selectedState && selectedState.type === SelectionType.Repository
        ? selectedState.repository
        : null

    const isTutorialRepository =
      selectedRepository && selectedRepository.isTutorialRepository

    return isTutorialRepository ? selectedRepository : null
  }

  private showAbout() {
    this.props.dispatcher.showPopup({ type: PopupType.About })
  }

  private async showHistory(showBranchList: boolean = false) {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    await this.props.dispatcher.closeCurrentFoldout()

    await this.props.dispatcher.initializeCompare(state.repository, {
      kind: HistoryTabMode.History,
    })

    await this.props.dispatcher.changeRepositorySection(
      state.repository,
      RepositorySectionTab.History
    )

    await this.props.dispatcher.updateCompareForm(state.repository, {
      filterText: '',
      showBranchList,
    })
  }

  private showChanges() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    this.props.dispatcher.closeCurrentFoldout()
    return this.props.dispatcher.changeRepositorySection(
      state.repository,
      RepositorySectionTab.Changes
    )
  }

  private chooseRepository() {
    if (
      this.state.currentFoldout &&
      this.state.currentFoldout.type === FoldoutType.Repository
    ) {
      return this.props.dispatcher.closeFoldout(FoldoutType.Repository)
    }

    return this.props.dispatcher.showFoldout({
      type: FoldoutType.Repository,
    })
  }

  private showBranches() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    if (
      this.state.currentFoldout &&
      this.state.currentFoldout.type === FoldoutType.Branch
    ) {
      return this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    }

    return this.props.dispatcher.showFoldout({ type: FoldoutType.Branch })
  }

  private push(options?: { forceWithLease: boolean }) {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    if (options && options.forceWithLease) {
      this.props.dispatcher.confirmOrForcePush(state.repository)
    } else {
      this.props.dispatcher.push(state.repository)
    }
  }

  private async pull() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    this.props.dispatcher.pull(state.repository)
  }

  private showStashedChanges() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    this.props.dispatcher.selectStashedFile(state.repository)
  }

  private hideStashedChanges() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    this.props.dispatcher.hideStashedChanges(state.repository)
  }

  public componentDidMount() {
    document.ondragover = e => {
      if (e.dataTransfer != null) {
        if (this.isShowingModal) {
          e.dataTransfer.dropEffect = 'none'
        } else {
          e.dataTransfer.dropEffect = 'copy'
        }
      }

      e.preventDefault()
    }

    document.ondrop = e => {
      e.preventDefault()
    }

    document.body.ondrop = e => {
      if (this.isShowingModal) {
        return
      }
      if (e.dataTransfer != null) {
        const files = e.dataTransfer.files
        this.handleDragAndDrop(files)
      }
      e.preventDefault()
    }

    if (shouldRenderApplicationMenu()) {
      window.addEventListener('keydown', this.onWindowKeyDown)
      window.addEventListener('keyup', this.onWindowKeyUp)
    }
  }

  /**
   * On Windows pressing the Alt key and holding it down should
   * highlight the application menu.
   *
   * This method in conjunction with the onWindowKeyUp sets the
   * appMenuToolbarHighlight state when the Alt key (and only the
   * Alt key) is pressed.
   */
  private onWindowKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return
    }

    if (this.isShowingModal) {
      return
    }

    if (shouldRenderApplicationMenu()) {
      if (event.key === 'Shift' && event.altKey) {
        this.props.dispatcher.setAccessKeyHighlightState(false)
      } else if (event.key === 'Alt') {
        if (event.shiftKey) {
          return
        }
        // Immediately close the menu if open and the user hits Alt. This is
        // a Windows convention.
        if (
          this.state.currentFoldout &&
          this.state.currentFoldout.type === FoldoutType.AppMenu
        ) {
          // Only close it the menu when the key is pressed if there's an open
          // menu. If there isn't we should close it when the key is released
          // instead and that's taken care of in the onWindowKeyUp function.
          if (this.state.appMenuState.length > 1) {
            this.props.dispatcher.setAppMenuState(menu => menu.withReset())
            this.props.dispatcher.closeFoldout(FoldoutType.AppMenu)
          }
        }

        this.props.dispatcher.setAccessKeyHighlightState(true)
      } else if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (this.state.appMenuState.length) {
          const candidates = this.state.appMenuState[0].items
          const menuItemForAccessKey = findItemByAccessKey(
            event.key,
            candidates
          )

          if (menuItemForAccessKey && itemIsSelectable(menuItemForAccessKey)) {
            if (menuItemForAccessKey.type === 'submenuItem') {
              this.props.dispatcher.setAppMenuState(menu =>
                menu
                  .withReset()
                  .withSelectedItem(menuItemForAccessKey)
                  .withOpenedMenu(menuItemForAccessKey, true)
              )

              this.props.dispatcher.showFoldout({
                type: FoldoutType.AppMenu,
                enableAccessKeyNavigation: true,
                openedWithAccessKey: true,
              })
            } else {
              this.props.dispatcher.executeMenuItem(menuItemForAccessKey)
            }

            event.preventDefault()
          }
        }
      } else if (!event.altKey) {
        this.props.dispatcher.setAccessKeyHighlightState(false)
      }
    }

    this.lastKeyPressed = event.key
  }

  /**
   * Open the application menu foldout when the Alt key is pressed.
   *
   * See onWindowKeyDown for more information.
   */
  private onWindowKeyUp = (event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return
    }

    if (shouldRenderApplicationMenu()) {
      if (event.key === 'Alt') {
        this.props.dispatcher.setAccessKeyHighlightState(false)

        if (this.lastKeyPressed === 'Alt') {
          if (
            this.state.currentFoldout &&
            this.state.currentFoldout.type === FoldoutType.AppMenu
          ) {
            this.props.dispatcher.setAppMenuState(menu => menu.withReset())
            this.props.dispatcher.closeFoldout(FoldoutType.AppMenu)
          } else {
            this.props.dispatcher.showFoldout({
              type: FoldoutType.AppMenu,
              enableAccessKeyNavigation: true,
              openedWithAccessKey: false,
            })
          }
        }
      }
    }
  }

  private async handleDragAndDrop(fileList: FileList) {
    const paths = [...fileList].map(x => x.path)

    // If they're bulk adding repositories then just blindly try to add them.
    // But if they just dragged one, use the dialog so that they can initialize
    // it if needed.
    if (paths.length > 1) {
      const addedRepositories = await this.addRepositories(paths)
      if (addedRepositories.length > 0) {
        this.props.dispatcher.recordAddExistingRepository()
      }
    } else if (paths.length === 1) {
      // user may accidentally provide a folder within the repository
      // this ensures we use the repository root, if it is actually a repository
      // otherwise we consider it an untracked repository
      const first = paths[0]
      const path = (await validatedRepositoryPath(first)) ?? first

      const { repositories } = this.state
      const existingRepository = matchExistingRepository(repositories, path)

      if (existingRepository) {
        await this.props.dispatcher.selectRepository(existingRepository)
      } else {
        await this.showPopup({ type: PopupType.AddRepository, path })
      }
    }
  }

  private removeRepository = (
    repository: Repository | CloningRepository | null
  ) => {
    if (!repository) {
      return
    }

    if (repository instanceof CloningRepository || repository.missing) {
      this.props.dispatcher.removeRepository(repository, false)
      return
    }

    if (this.state.askForConfirmationOnRepositoryRemoval) {
      this.props.dispatcher.showPopup({
        type: PopupType.RemoveRepository,
        repository,
      })
    } else {
      this.props.dispatcher.removeRepository(repository, false)
    }
  }

  private onConfirmRepoRemoval = async (
    repository: Repository,
    deleteRepoFromDisk: boolean
  ) => {
    await this.props.dispatcher.removeRepository(repository, deleteRepoFromDisk)
  }

  private getRepository(): Repository | CloningRepository | null {
    const state = this.state.selectedState
    if (state == null) {
      return null
    }

    return state.repository
  }

  private async addRepositories(paths: ReadonlyArray<string>) {
    const repositories = await this.props.dispatcher.addRepositories(paths)
    if (repositories.length > 0) {
      this.props.dispatcher.selectRepository(repositories[0])
    }

    return repositories
  }

  private showRebaseDialog() {
    const repository = this.getRepository()

    if (!repository || repository instanceof CloningRepository) {
      return
    }

    const repositoryState = this.props.repositoryStateManager.get(repository)

    const initialStep = initializeNewRebaseFlow(repositoryState)

    this.props.dispatcher.setRebaseFlowStep(repository, initialStep)

    this.props.dispatcher.showPopup({
      type: PopupType.RebaseFlow,
      repository,
    })
  }

  private showRepositorySettings() {
    const repository = this.getRepository()

    if (!repository || repository instanceof CloningRepository) {
      return
    }
    this.props.dispatcher.showPopup({
      type: PopupType.RepositorySettings,
      repository,
    })
  }

  /**
   * Opens a browser to the issue creation page
   * of the current GitHub repository.
   */
  private openIssueCreationOnGitHub() {
    const repository = this.getRepository()
    // this will likely never be null since we disable the
    // issue creation menu item for non-GitHub repositories
    if (repository instanceof Repository) {
      this.props.dispatcher.openIssueCreationPage(repository)
    }
  }

  private viewRepositoryOnGitHub() {
    const repository = this.getRepository()

    if (repository instanceof Repository) {
      const url = getGitHubHtmlUrl(repository)

      if (url) {
        this.props.dispatcher.openInBrowser(url)
      }
    }
  }

  /** Returns the URL to the current repository if hosted on GitHub */
  private getCurrentRepositoryGitHubURL() {
    const repository = this.getRepository()

    if (
      !repository ||
      repository instanceof CloningRepository ||
      !repository.gitHubRepository
    ) {
      return null
    }

    return repository.gitHubRepository.htmlURL
  }

  private openCurrentRepositoryInShell = () => {
    const repository = this.getRepository()
    if (!repository) {
      return
    }

    this.openInShell(repository)
  }

  private openCurrentRepositoryInExternalEditor() {
    const repository = this.getRepository()
    if (!repository) {
      return
    }

    this.openInExternalEditor(repository)
  }

  /**
   * Conditionally renders a menu bar. The menu bar is currently only rendered
   * on Windows.
   */
  private renderAppMenuBar() {
    // We only render the app menu bar on Windows
    if (!__WIN32__) {
      return null
    }

    // Have we received an app menu from the main process yet?
    if (!this.state.appMenuState.length) {
      return null
    }

    // Don't render the menu bar during the welcome flow
    if (this.state.showWelcomeFlow) {
      return null
    }

    const currentFoldout = this.state.currentFoldout

    // AppMenuBar requires us to pass a strongly typed AppMenuFoldout state or
    // null if the AppMenu foldout is not currently active.
    const foldoutState =
      currentFoldout && currentFoldout.type === FoldoutType.AppMenu
        ? currentFoldout
        : null

    return (
      <AppMenuBar
        appMenu={this.state.appMenuState}
        dispatcher={this.props.dispatcher}
        highlightAppMenuAccessKeys={this.state.highlightAccessKeys}
        foldoutState={foldoutState}
        onLostFocus={this.onMenuBarLostFocus}
      />
    )
  }

  private onMenuBarLostFocus = () => {
    // Note: This event is emitted in an animation frame separate from
    // that of the AppStore. See onLostFocusWithin inside of the AppMenuBar
    // for more details. This means that it's possible that the current
    // app state in this component's state might be out of date so take
    // caution when considering app state in this method.
    this.props.dispatcher.closeFoldout(FoldoutType.AppMenu)
    this.props.dispatcher.setAppMenuState(menu => menu.withReset())
  }

  private renderTitlebar() {
    const inFullScreen = this.state.windowState === 'full-screen'

    const menuBarActive =
      this.state.currentFoldout &&
      this.state.currentFoldout.type === FoldoutType.AppMenu

    // When we're in full-screen mode on Windows we only need to render
    // the title bar when the menu bar is active. On other platforms we
    // never render the title bar while in full-screen mode.
    if (inFullScreen) {
      if (!__WIN32__ || !menuBarActive) {
        return null
      }
    }

    const showAppIcon = __WIN32__ && !this.state.showWelcomeFlow
    const inWelcomeFlow = this.state.showWelcomeFlow
    const inNoRepositoriesView = this.inNoRepositoriesViewState()

    // The light title bar style should only be used while we're in
    // the welcome flow as well as the no-repositories blank slate
    // on macOS. The latter case has to do with the application menu
    // being part of the title bar on Windows. We need to render
    // the app menu in the no-repositories blank slate on Windows but
    // the menu doesn't support the light style at the moment so we're
    // forcing it to use the dark style.
    const titleBarStyle =
      inWelcomeFlow || (__DARWIN__ && inNoRepositoriesView) ? 'light' : 'dark'

    return (
      <TitleBar
        showAppIcon={showAppIcon}
        titleBarStyle={titleBarStyle}
        windowState={this.state.windowState}
        windowZoomFactor={this.state.windowZoomFactor}
      >
        {this.renderAppMenuBar()}
      </TitleBar>
    )
  }

  private onPopupDismissed = (popupType: PopupType) => {
    return this.props.dispatcher.closePopup(popupType)
  }

  private onContinueWithUntrustedCertificate = (
    certificate: Electron.Certificate
  ) => {
    showCertificateTrustDialog(
      certificate,
      'Could not securely connect to the server, because its certificate is not trusted. Attackers might be trying to steal your information.\n\nTo connect unsafely, which may put your data at risk, you can “Always trust” the certificate and try again.'
    )
  }

  private onUpdateAvailableDismissed = () =>
    this.props.dispatcher.setUpdateBannerVisibility(false)

  private currentPopupContent(): JSX.Element | null {
    // Hide any dialogs while we're displaying an error
    if (this.state.errors.length) {
      return null
    }

    const popup = this.state.currentPopup

    if (!popup) {
      return null
    }

    const onPopupDismissedFn = this.getOnPopupDismissedFn(popup.type)

    switch (popup.type) {
      case PopupType.RenameBranch:
        const stash =
          this.state.selectedState !== null &&
          this.state.selectedState.type === SelectionType.Repository
            ? this.state.selectedState.state.changesState.stashEntry
            : null
        return (
          <RenameBranch
            key="rename-branch"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            branch={popup.branch}
            stash={stash}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.DeleteBranch:
        return (
          <DeleteBranch
            key="delete-branch"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            branch={popup.branch}
            existsOnRemote={popup.existsOnRemote}
            onDismissed={onPopupDismissedFn}
            onDeleted={this.onBranchDeleted}
          />
        )
      case PopupType.ConfirmDiscardChanges:
        const showSetting =
          popup.showDiscardChangesSetting === undefined
            ? true
            : popup.showDiscardChangesSetting
        const discardingAllChanges =
          popup.discardingAllChanges === undefined
            ? false
            : popup.discardingAllChanges

        return (
          <DiscardChanges
            key="discard-changes"
            repository={popup.repository}
            dispatcher={this.props.dispatcher}
            files={popup.files}
            confirmDiscardChanges={
              this.state.askForConfirmationOnDiscardChanges
            }
            showDiscardChangesSetting={showSetting}
            discardingAllChanges={discardingAllChanges}
            onDismissed={onPopupDismissedFn}
            onConfirmDiscardChangesChanged={this.onConfirmDiscardChangesChanged}
          />
        )
      case PopupType.ConfirmDiscardSelection:
        return (
          <DiscardSelection
            key="discard-selection"
            repository={popup.repository}
            dispatcher={this.props.dispatcher}
            file={popup.file}
            diff={popup.diff}
            selection={popup.selection}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.Preferences:
        return (
          <Preferences
            key="preferences"
            initialSelectedTab={popup.initialSelectedTab}
            dispatcher={this.props.dispatcher}
            dotComAccount={this.getDotComAccount()}
            confirmRepositoryRemoval={
              this.state.askForConfirmationOnRepositoryRemoval
            }
            confirmDiscardChanges={
              this.state.askForConfirmationOnDiscardChanges
            }
            confirmForcePush={this.state.askForConfirmationOnForcePush}
            uncommittedChangesStrategy={this.state.uncommittedChangesStrategy}
            selectedExternalEditor={this.state.selectedExternalEditor}
            optOutOfUsageTracking={this.state.optOutOfUsageTracking}
            enterpriseAccount={this.getEnterpriseAccount()}
            onDismissed={onPopupDismissedFn}
            selectedShell={this.state.selectedShell}
            selectedTheme={this.state.selectedTheme}
            automaticallySwitchTheme={this.state.automaticallySwitchTheme}
            repositoryIndicatorsEnabled={this.state.repositoryIndicatorsEnabled}
          />
        )
      case PopupType.MergeBranch: {
        const { repository, branch } = popup
        const state = this.props.repositoryStateManager.get(repository)

        const tip = state.branchesState.tip

        // we should never get in this state since we disable the menu
        // item in a detached HEAD state, this check is so TSC is happy
        if (tip.kind !== TipState.Valid) {
          return null
        }

        const currentBranch = tip.branch

        return (
          <Merge
            key="merge-branch"
            dispatcher={this.props.dispatcher}
            repository={repository}
            allBranches={state.branchesState.allBranches}
            defaultBranch={state.branchesState.defaultBranch}
            recentBranches={state.branchesState.recentBranches}
            currentBranch={currentBranch}
            initialBranch={branch}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.RepositorySettings: {
        const repository = popup.repository
        const state = this.props.repositoryStateManager.get(repository)

        return (
          <RepositorySettings
            key={`repository-settings-${repository.hash}`}
            remote={state.remote}
            dispatcher={this.props.dispatcher}
            repository={repository}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.SignIn:
        return (
          <SignIn
            key="sign-in"
            signInState={this.state.signInState}
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.AddRepository:
        return (
          <AddExistingRepository
            key="add-existing-repository"
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            path={popup.path}
          />
        )
      case PopupType.CreateRepository:
        return (
          <CreateRepository
            key="create-repository"
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            initialPath={popup.path}
          />
        )
      case PopupType.CloneRepository:
        return (
          <CloneRepository
            key="clone-repository"
            dotComAccount={this.getDotComAccount()}
            enterpriseAccount={this.getEnterpriseAccount()}
            initialURL={popup.initialURL}
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            selectedTab={this.state.selectedCloneRepositoryTab}
            onTabSelected={this.onCloneRepositoriesTabSelected}
            apiRepositories={this.state.apiRepositories}
            onRefreshRepositories={this.onRefreshRepositories}
          />
        )
      case PopupType.CreateBranch: {
        const state = this.props.repositoryStateManager.get(popup.repository)
        const branchesState = state.branchesState
        const repository = popup.repository

        if (branchesState.tip.kind === TipState.Unknown) {
          onPopupDismissedFn()
          return null
        }

        let upstreamGhRepo: GitHubRepository | null = null
        let upstreamDefaultBranch: Branch | null = null

        if (
          enableForkyCreateBranchUI() &&
          isRepositoryWithGitHubRepository(repository)
        ) {
          upstreamGhRepo = getNonForkGitHubRepository(repository)
          upstreamDefaultBranch = findDefaultUpstreamBranch(
            repository,
            branchesState.allBranches
          )
        }

        return (
          <CreateBranch
            key="create-branch"
            tip={branchesState.tip}
            defaultBranch={branchesState.defaultBranch}
            upstreamDefaultBranch={upstreamDefaultBranch}
            allBranches={branchesState.allBranches}
            repository={repository}
            upstreamGitHubRepository={upstreamGhRepo}
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            initialName={popup.initialName || ''}
          />
        )
      }
      case PopupType.InstallGit:
        return (
          <InstallGit
            key="install-git"
            onDismissed={onPopupDismissedFn}
            onOpenShell={this.onOpenShellIgnoreWarning}
            path={popup.path}
          />
        )
      case PopupType.About:
        const version = __DEV__ ? __SHA__.substr(0, 10) : getVersion()

        return (
          <About
            key="about"
            onDismissed={onPopupDismissedFn}
            applicationName={getName()}
            applicationVersion={version}
            onCheckForUpdates={this.onCheckForUpdates}
            onShowAcknowledgements={this.showAcknowledgements}
            onShowTermsAndConditions={this.showTermsAndConditions}
          />
        )
      case PopupType.PublishRepository:
        return (
          <Publish
            key="publish"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            accounts={this.state.accounts}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.UntrustedCertificate:
        return (
          <UntrustedCertificate
            key="untrusted-certificate"
            certificate={popup.certificate}
            url={popup.url}
            onDismissed={onPopupDismissedFn}
            onContinue={this.onContinueWithUntrustedCertificate}
          />
        )
      case PopupType.Acknowledgements:
        return (
          <Acknowledgements
            key="acknowledgements"
            onDismissed={onPopupDismissedFn}
            applicationVersion={getVersion()}
          />
        )
      case PopupType.RemoveRepository:
        return (
          <ConfirmRemoveRepository
            key="confirm-remove-repository"
            repository={popup.repository}
            onConfirmation={this.onConfirmRepoRemoval}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.TermsAndConditions:
        return (
          <TermsAndConditions
            key="terms-and-conditions"
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.PushBranchCommits:
        return (
          <PushBranchCommits
            key="push-branch-commits"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            branch={popup.branch}
            unPushedCommits={popup.unPushedCommits}
            onConfirm={this.openCreatePullRequestInBrowser}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.CLIInstalled:
        return (
          <CLIInstalled key="cli-installed" onDismissed={onPopupDismissedFn} />
        )
      case PopupType.GenericGitAuthentication:
        return (
          <GenericGitAuthentication
            key="generic-git-authentication"
            hostname={popup.hostname}
            onDismiss={onPopupDismissedFn}
            onSave={this.onSaveCredentials}
            retryAction={popup.retryAction}
          />
        )
      case PopupType.ExternalEditorFailed:
        const openPreferences = popup.openPreferences
        const suggestAtom = popup.suggestAtom

        return (
          <EditorError
            key="editor-error"
            message={popup.message}
            onDismissed={onPopupDismissedFn}
            showPreferencesDialog={this.onShowAdvancedPreferences}
            viewPreferences={openPreferences}
            suggestAtom={suggestAtom}
          />
        )
      case PopupType.OpenShellFailed:
        return (
          <ShellError
            key="shell-error"
            message={popup.message}
            onDismissed={onPopupDismissedFn}
            showPreferencesDialog={this.onShowAdvancedPreferences}
          />
        )
      case PopupType.InitializeLFS:
        return (
          <InitializeLFS
            key="initialize-lfs"
            repositories={popup.repositories}
            onDismissed={onPopupDismissedFn}
            onInitialize={this.initializeLFS}
          />
        )
      case PopupType.LFSAttributeMismatch:
        return (
          <AttributeMismatch
            key="lsf-attribute-mismatch"
            onDismissed={onPopupDismissedFn}
            onUpdateExistingFilters={this.updateExistingLFSFilters}
          />
        )
      case PopupType.UpstreamAlreadyExists:
        return (
          <UpstreamAlreadyExists
            key="upstream-already-exists"
            repository={popup.repository}
            existingRemote={popup.existingRemote}
            onDismissed={onPopupDismissedFn}
            onUpdate={this.onUpdateExistingUpstreamRemote}
            onIgnore={this.onIgnoreExistingUpstreamRemote}
          />
        )
      case PopupType.ReleaseNotes:
        return (
          <ReleaseNotes
            key="release-notes"
            emoji={this.state.emoji}
            newRelease={popup.newRelease}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.DeletePullRequest:
        return (
          <DeletePullRequest
            key="delete-pull-request"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            branch={popup.branch}
            onDismissed={onPopupDismissedFn}
            pullRequest={popup.pullRequest}
          />
        )
      case PopupType.MergeConflicts: {
        const { selectedState } = this.state
        if (
          selectedState === null ||
          selectedState.type !== SelectionType.Repository
        ) {
          return null
        }

        const {
          workingDirectory,
          conflictState,
        } = selectedState.state.changesState

        if (conflictState === null || conflictState.kind === 'rebase') {
          return null
        }

        return (
          <MergeConflictsDialog
            key="merge-conflicts-dialog"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            workingDirectory={workingDirectory}
            onDismissed={onPopupDismissedFn}
            openFileInExternalEditor={this.openFileInExternalEditor}
            resolvedExternalEditor={this.state.resolvedExternalEditor}
            openRepositoryInShell={this.openInShell}
            ourBranch={popup.ourBranch}
            theirBranch={popup.theirBranch}
            manualResolutions={conflictState.manualResolutions}
          />
        )
      }
      case PopupType.OversizedFiles:
        return (
          <OversizedFiles
            key="oversized-files"
            oversizedFiles={popup.oversizedFiles}
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            context={popup.context}
            repository={popup.repository}
          />
        )
      case PopupType.AbortMerge: {
        const { selectedState } = this.state
        if (
          selectedState === null ||
          selectedState.type !== SelectionType.Repository
        ) {
          return null
        }
        const { workingDirectory } = selectedState.state.changesState
        // double check that this repository is actually in merge
        const isInConflictedMerge = workingDirectory.files.some(file =>
          isConflictedFile(file.status)
        )
        if (!isInConflictedMerge) {
          return null
        }

        return (
          <AbortMergeWarning
            key="abort-merge-warning"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            onDismissed={onPopupDismissedFn}
            ourBranch={popup.ourBranch}
            theirBranch={popup.theirBranch}
          />
        )
      }
      case PopupType.UsageReportingChanges:
        return (
          <UsageStatsChange
            key="usage-stats-change"
            onOpenUsageDataUrl={this.openUsageDataUrl}
            onSetStatsOptOut={this.onSetStatsOptOut}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.CommitConflictsWarning:
        return (
          <CommitConflictsWarning
            key="commit-conflicts-warning"
            dispatcher={this.props.dispatcher}
            files={popup.files}
            repository={popup.repository}
            context={popup.context}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.PushNeedsPull:
        return (
          <PushNeedsPullWarning
            key="push-needs-pull"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.RebaseFlow: {
        const { selectedState, emoji } = this.state

        if (
          selectedState === null ||
          selectedState.type !== SelectionType.Repository
        ) {
          return null
        }

        const { changesState, rebaseState } = selectedState.state
        const { workingDirectory, conflictState } = changesState
        const { progress, step, userHasResolvedConflicts } = rebaseState

        if (conflictState !== null && conflictState.kind === 'merge') {
          log.warn(
            '[App] invalid state encountered - rebase flow should not be used when merge conflicts found'
          )
          return null
        }

        if (step === null) {
          log.warn(
            '[App] invalid state encountered - rebase flow should not be active when step is null'
          )
          return null
        }

        return (
          <RebaseFlow
            key="rebase-flow"
            repository={popup.repository}
            openFileInExternalEditor={this.openFileInExternalEditor}
            dispatcher={this.props.dispatcher}
            onFlowEnded={this.onRebaseFlowEnded}
            onDismissed={onPopupDismissedFn}
            workingDirectory={workingDirectory}
            progress={progress}
            step={step}
            userHasResolvedConflicts={userHasResolvedConflicts}
            askForConfirmationOnForcePush={
              this.state.askForConfirmationOnForcePush
            }
            resolvedExternalEditor={this.state.resolvedExternalEditor}
            openRepositoryInShell={this.openCurrentRepositoryInShell}
            onShowRebaseConflictsBanner={this.onShowRebaseConflictsBanner}
            emoji={emoji}
          />
        )
      }
      case PopupType.ConfirmForcePush: {
        const { askForConfirmationOnForcePush } = this.state

        return (
          <ConfirmForcePush
            key="confirm-force-push"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            upstreamBranch={popup.upstreamBranch}
            askForConfirmationOnForcePush={askForConfirmationOnForcePush}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.StashAndSwitchBranch: {
        const { repository, branchToCheckout } = popup
        const {
          branchesState,
          changesState,
        } = this.props.repositoryStateManager.get(repository)
        const { tip } = branchesState

        if (tip.kind !== TipState.Valid) {
          return null
        }

        const currentBranch = tip.branch
        const hasAssociatedStash = changesState.stashEntry !== null

        return (
          <StashAndSwitchBranch
            key="stash-and-switch-branch"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            currentBranch={currentBranch}
            branchToCheckout={branchToCheckout}
            hasAssociatedStash={hasAssociatedStash}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.ConfirmOverwriteStash: {
        const { repository, branchToCheckout: branchToCheckout } = popup
        return (
          <OverwriteStash
            key="overwrite-stash"
            dispatcher={this.props.dispatcher}
            repository={repository}
            branchToCheckout={branchToCheckout}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.ConfirmDiscardStash: {
        const { repository, stash } = popup

        return (
          <ConfirmDiscardStashDialog
            key="confirm-discard-stash-dialog"
            dispatcher={this.props.dispatcher}
            repository={repository}
            stash={stash}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.CreateTutorialRepository: {
        return (
          <CreateTutorialRepositoryDialog
            key="create-tutorial-repository-dialog"
            account={popup.account}
            progress={popup.progress}
            onDismissed={onPopupDismissedFn}
            onCreateTutorialRepository={this.onCreateTutorialRepository}
          />
        )
      }
      case PopupType.ConfirmExitTutorial: {
        return (
          <ConfirmExitTutorial
            key="confirm-exit-tutorial"
            onDismissed={onPopupDismissedFn}
            onContinue={this.onExitTutorialToHomeScreen}
          />
        )
      }
      case PopupType.PushRejectedDueToMissingWorkflowScope:
        return (
          <WorkflowPushRejectedDialog
            onDismissed={onPopupDismissedFn}
            rejectedPath={popup.rejectedPath}
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
          />
        )
      case PopupType.SAMLReauthRequired:
        return (
          <SAMLReauthRequiredDialog
            onDismissed={onPopupDismissedFn}
            organizationName={popup.organizationName}
            endpoint={popup.endpoint}
            retryAction={popup.retryAction}
            dispatcher={this.props.dispatcher}
          />
        )
      case PopupType.CreateFork:
        return (
          <CreateForkDialog
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            account={popup.account}
          />
        )
      case PopupType.CreateTag: {
        return (
          <CreateTag
            key="create-tag"
            repository={popup.repository}
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            targetCommitSha={popup.targetCommitSha}
            initialName={popup.initialName}
            localTags={popup.localTags}
          />
        )
      }
      case PopupType.DeleteTag: {
        return (
          <DeleteTag
            key="delete-tag"
            repository={popup.repository}
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            tagName={popup.tagName}
          />
        )
      }
      case PopupType.ChooseForkSettings: {
        return (
          <ChooseForkSettings
            repository={popup.repository}
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
          />
        )
      }
      case PopupType.LocalChangesOverwritten:
        const selectedState = this.state.selectedState

        const existingStash =
          selectedState !== null &&
          selectedState.type === SelectionType.Repository
            ? selectedState.state.changesState.stashEntry
            : null

        return (
          <LocalChangesOverwrittenDialog
            repository={popup.repository}
            dispatcher={this.props.dispatcher}
            hasExistingStash={existingStash !== null}
            retryAction={popup.retryAction}
            onDismissed={onPopupDismissedFn}
            files={popup.files}
          />
        )
      default:
        return assertNever(popup, `Unknown popup type: ${popup}`)
    }
  }

  private onExitTutorialToHomeScreen = () => {
    const tutorialRepository = this.getSelectedTutorialRepository()
    if (!tutorialRepository) {
      return false
    }

    this.props.dispatcher.pauseTutorial(tutorialRepository)
    return true
  }

  private onCreateTutorialRepository = (account: Account) => {
    this.props.dispatcher.createTutorialRepository(account)
  }

  private onShowRebaseConflictsBanner = (
    repository: Repository,
    targetBranch: string
  ) => {
    this.props.dispatcher.setBanner({
      type: BannerType.RebaseConflictsFound,
      targetBranch,
      onOpenDialog: async () => {
        const { changesState } = this.props.repositoryStateManager.get(
          repository
        )
        const { conflictState } = changesState

        if (conflictState === null || conflictState.kind === 'merge') {
          log.debug(
            `[App.onShowRebaseConflictsBanner] no conflict state found, ignoring...`
          )
          return
        }

        await this.props.dispatcher.setRebaseProgressFromState(repository)

        const initialStep = initializeRebaseFlowForConflictedRepository(
          conflictState
        )

        this.props.dispatcher.setRebaseFlowStep(repository, initialStep)

        this.props.dispatcher.showPopup({
          type: PopupType.RebaseFlow,
          repository,
        })
      },
    })
  }

  private onRebaseFlowEnded = (repository: Repository) => {
    this.props.dispatcher.endRebaseFlow(repository)
  }

  private onSetStatsOptOut = (optOut: boolean) => {
    this.props.appStore.setStatsOptOut(optOut, true)
    this.props.appStore.markUsageStatsNoteSeen()
    this.props.appStore._reportStats()
  }

  private openUsageDataUrl = () => {
    this.props.dispatcher.openInBrowser(SamplesURL)
  }

  private onUpdateExistingUpstreamRemote = (repository: Repository) => {
    this.props.dispatcher.updateExistingUpstreamRemote(repository)
  }

  private onIgnoreExistingUpstreamRemote = (repository: Repository) => {
    this.props.dispatcher.ignoreExistingUpstreamRemote(repository)
  }

  private updateExistingLFSFilters = () => {
    this.props.dispatcher.installGlobalLFSFilters(true)
  }

  private initializeLFS = (repositories: ReadonlyArray<Repository>) => {
    this.props.dispatcher.installLFSHooks(repositories)
  }

  private onCloneRepositoriesTabSelected = (tab: CloneRepositoryTab) => {
    this.props.dispatcher.changeCloneRepositoriesTab(tab)
  }

  private onRefreshRepositories = (account: Account) => {
    this.props.dispatcher.refreshApiRepositories(account)
  }

  private onShowAdvancedPreferences = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.Preferences,
      initialSelectedTab: PreferencesTab.Advanced,
    })
  }

  private onOpenShellIgnoreWarning = (path: string) => {
    this.props.dispatcher.openShell(path, true)
  }

  private onSaveCredentials = async (
    hostname: string,
    username: string,
    password: string,
    retryAction: RetryAction
  ) => {
    await this.props.dispatcher.saveGenericGitCredentials(
      hostname,
      username,
      password
    )

    this.props.dispatcher.performRetry(retryAction)
  }

  private onCheckForUpdates = () => this.checkForUpdates(false)

  private showAcknowledgements = () => {
    this.props.dispatcher.showPopup({ type: PopupType.Acknowledgements })
  }

  private showTermsAndConditions = () => {
    this.props.dispatcher.showPopup({ type: PopupType.TermsAndConditions })
  }

  private renderPopup() {
    const popupContent = this.currentPopupContent()

    return (
      <TransitionGroup>
        {popupContent && (
          <CSSTransition classNames="modal" timeout={dialogTransitionTimeout}>
            {popupContent}
          </CSSTransition>
        )}
      </TransitionGroup>
    )
  }

  private renderZoomInfo() {
    return <ZoomInfo windowZoomFactor={this.state.windowZoomFactor} />
  }

  private renderFullScreenInfo() {
    return <FullScreenInfo windowState={this.state.windowState} />
  }

  private clearError = (error: Error) => this.props.dispatcher.clearError(error)

  private onConfirmDiscardChangesChanged = (value: boolean) => {
    this.props.dispatcher.setConfirmDiscardChangesSetting(value)
  }

  private renderAppError() {
    return (
      <AppError
        errors={this.state.errors}
        onClearError={this.clearError}
        onShowPopup={this.showPopup}
        onRetryAction={this.onRetryAction}
      />
    )
  }

  private onRetryAction = (retryAction: RetryAction) => {
    this.props.dispatcher.performRetry(retryAction)
  }

  private showPopup = (popup: Popup) => {
    this.props.dispatcher.showPopup(popup)
  }

  private renderApp() {
    return (
      <div id="desktop-app-contents">
        {this.renderToolbar()}
        {this.renderBanner()}
        {this.renderRepository()}
        {this.renderPopup()}
        {this.renderAppError()}
      </div>
    )
  }

  private renderRepositoryList = (): JSX.Element => {
    const selectedRepository = this.state.selectedState
      ? this.state.selectedState.repository
      : null
    const externalEditorLabel = this.state.selectedExternalEditor
      ? this.state.selectedExternalEditor
      : undefined
    const shellLabel = this.state.selectedShell
    const filterText = this.state.repositoryFilterText
    return (
      <RepositoriesList
        filterText={filterText}
        onFilterTextChanged={this.onRepositoryFilterTextChanged}
        selectedRepository={selectedRepository}
        onSelectionChanged={this.onSelectionChanged}
        repositories={this.state.repositories}
        recentRepositories={this.state.recentRepositories}
        localRepositoryStateLookup={this.state.localRepositoryStateLookup}
        askForConfirmationOnRemoveRepository={
          this.state.askForConfirmationOnRepositoryRemoval
        }
        onRemoveRepository={this.removeRepository}
        onOpenInShell={this.openInShell}
        onShowRepository={this.showRepository}
        onOpenInExternalEditor={this.openInExternalEditor}
        externalEditorLabel={externalEditorLabel}
        shellLabel={shellLabel}
        dispatcher={this.props.dispatcher}
      />
    )
  }

  private openInShell = (repository: Repository | CloningRepository) => {
    if (!(repository instanceof Repository)) {
      return
    }

    this.props.dispatcher.openShell(repository.path)
  }

  private openFileInExternalEditor = (fullPath: string) => {
    this.props.dispatcher.openInExternalEditor(fullPath)
  }

  private openInExternalEditor = (
    repository: Repository | CloningRepository
  ) => {
    if (!(repository instanceof Repository)) {
      return
    }

    this.props.dispatcher.openInExternalEditor(repository.path)
  }

  private showRepository = (repository: Repository | CloningRepository) => {
    if (!(repository instanceof Repository)) {
      return
    }

    shell.showFolderContents(repository.path)
  }

  private onRepositoryDropdownStateChanged = (newState: DropdownState) => {
    if (newState === 'open') {
      this.props.dispatcher.showFoldout({ type: FoldoutType.Repository })
    } else {
      this.props.dispatcher.closeFoldout(FoldoutType.Repository)
    }
  }

  private onExitTutorial = () => {
    if (
      this.state.repositories.length === 1 &&
      isValidTutorialStep(this.state.currentOnboardingTutorialStep)
    ) {
      // If the only repository present is the tutorial repo,
      // prompt for confirmation and exit to the BlankSlateView
      this.props.dispatcher.showPopup({
        type: PopupType.ConfirmExitTutorial,
      })
    } else {
      // Otherwise pop open repositories panel
      this.onRepositoryDropdownStateChanged('open')
    }
  }

  private renderRepositoryToolbarButton() {
    const selection = this.state.selectedState

    const repository = selection ? selection.repository : null

    let icon: OcticonSymbol
    let title: string
    if (repository) {
      icon = iconForRepository(repository)
      title = repository.name
    } else if (this.state.repositories.length > 0) {
      icon = OcticonSymbol.repo
      title = __DARWIN__ ? 'Select a Repository' : 'Select a repository'
    } else {
      icon = OcticonSymbol.repo
      title = __DARWIN__ ? 'No Repositories' : 'No repositories'
    }

    const isOpen =
      this.state.currentFoldout &&
      this.state.currentFoldout.type === FoldoutType.Repository

    const currentState: DropdownState = isOpen ? 'open' : 'closed'

    const tooltip = repository && !isOpen ? repository.path : undefined

    const foldoutStyle: React.CSSProperties = {
      position: 'absolute',
      marginLeft: 0,
      width: this.state.sidebarWidth,
      minWidth: this.state.sidebarWidth,
      height: '100%',
      top: 0,
    }

    return (
      <ToolbarDropdown
        icon={icon}
        title={title}
        description={__DARWIN__ ? 'Current Repository' : 'Current repository'}
        tooltip={tooltip}
        foldoutStyle={foldoutStyle}
        onDropdownStateChanged={this.onRepositoryDropdownStateChanged}
        dropdownContentRenderer={this.renderRepositoryList}
        dropdownState={currentState}
      />
    )
  }

  private renderPushPullToolbarButton() {
    const selection = this.state.selectedState
    if (!selection || selection.type !== SelectionType.Repository) {
      return null
    }

    const state = selection.state
    const revertProgress = state.revertProgress
    if (revertProgress) {
      return <RevertProgress progress={revertProgress} />
    }

    let remoteName = state.remote ? state.remote.name : null
    const progress = state.pushPullFetchProgress

    const { conflictState } = state.changesState

    const rebaseInProgress =
      conflictState !== null && conflictState.kind === 'rebase'

    const { aheadBehind, branchesState } = state
    const { pullWithRebase, tip } = branchesState

    if (tip.kind === TipState.Valid && tip.branch.remote !== null) {
      remoteName = tip.branch.remote
    }

    const isForcePush = isCurrentBranchForcePush(branchesState, aheadBehind)

    return (
      <PushPullButton
        dispatcher={this.props.dispatcher}
        repository={selection.repository}
        aheadBehind={state.aheadBehind}
        numTagsToPush={state.tagsToPush !== null ? state.tagsToPush.length : 0}
        remoteName={remoteName}
        lastFetched={state.lastFetched}
        networkActionInProgress={state.isPushPullFetchInProgress}
        progress={progress}
        tipState={tip.kind}
        pullWithRebase={pullWithRebase}
        rebaseInProgress={rebaseInProgress}
        isForcePush={isForcePush}
        shouldNudge={
          this.state.currentOnboardingTutorialStep === TutorialStep.PushBranch
        }
      />
    )
  }

  private showCreateBranch = () => {
    const selection = this.state.selectedState

    // NB: This should never happen but in the case someone
    // manages to delete the last repository while the drop down is
    // open we'll just bail here.
    if (!selection || selection.type !== SelectionType.Repository) {
      return
    }

    // We explicitly disable the menu item in this scenario so this
    // should never happen.
    if (selection.state.branchesState.tip.kind === TipState.Unknown) {
      return
    }

    const repository = selection.repository

    return this.props.dispatcher.showPopup({
      type: PopupType.CreateBranch,
      repository,
    })
  }

  private openPullRequest = () => {
    const state = this.state.selectedState

    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    const currentPullRequest = state.state.branchesState.currentPullRequest
    const dispatcher = this.props.dispatcher

    if (currentPullRequest == null) {
      dispatcher.createPullRequest(state.repository)
      dispatcher.recordCreatePullRequest()
    } else {
      dispatcher.showPullRequest(state.repository)
    }
  }

  private openCreatePullRequestInBrowser = (
    repository: Repository,
    branch: Branch
  ) => {
    this.props.dispatcher.openCreatePullRequestInBrowser(repository, branch)
  }

  private onBranchDropdownStateChanged = (newState: DropdownState) => {
    if (newState === 'open') {
      this.props.dispatcher.showFoldout({ type: FoldoutType.Branch })
    } else {
      this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    }
  }

  private renderBranchToolbarButton(): JSX.Element | null {
    const selection = this.state.selectedState

    if (selection == null || selection.type !== SelectionType.Repository) {
      return null
    }

    const currentFoldout = this.state.currentFoldout

    const isOpen =
      currentFoldout !== null && currentFoldout.type === FoldoutType.Branch

    const repository = selection.repository
    const { branchesState } = selection.state

    return (
      <BranchDropdown
        dispatcher={this.props.dispatcher}
        isOpen={isOpen}
        onDropDownStateChanged={this.onBranchDropdownStateChanged}
        repository={repository}
        repositoryState={selection.state}
        selectedTab={this.state.selectedBranchesTab}
        pullRequests={branchesState.openPullRequests}
        currentPullRequest={branchesState.currentPullRequest}
        isLoadingPullRequests={branchesState.isLoadingPullRequests}
        shouldNudge={
          this.state.currentOnboardingTutorialStep === TutorialStep.CreateBranch
        }
      />
    )
  }

  // we currently only render one banner at a time
  private renderBanner(): JSX.Element | null {
    // The inset light title bar style without the toolbar
    // can't support banners at the moment. So for the
    // no-repositories blank slate we'll have to live without
    // them.
    if (this.inNoRepositoriesViewState()) {
      return null
    }

    let banner = null
    if (this.state.currentBanner !== null) {
      banner = renderBanner(
        this.state.currentBanner,
        this.props.dispatcher,
        this.onBannerDismissed
      )
    } else if (this.state.isUpdateAvailableBannerVisible) {
      banner = this.renderUpdateBanner()
    }
    return (
      <TransitionGroup>
        {banner && (
          <CSSTransition classNames="banner" timeout={bannerTransitionTimeout}>
            {banner}
          </CSSTransition>
        )}
      </TransitionGroup>
    )
  }

  private renderUpdateBanner() {
    return (
      <UpdateAvailable
        dispatcher={this.props.dispatcher}
        newRelease={updateStore.state.newRelease}
        onDismissed={this.onUpdateAvailableDismissed}
        key={'update-available'}
      />
    )
  }

  private onBannerDismissed = () => {
    this.props.dispatcher.clearBanner()
  }

  private renderToolbar() {
    /**
     * No toolbar if we're in the blank slate view.
     */
    if (this.inNoRepositoriesViewState()) {
      return null
    }

    return (
      <Toolbar id="desktop-app-toolbar">
        <div
          className="sidebar-section"
          style={{ width: this.state.sidebarWidth }}
        >
          {this.renderRepositoryToolbarButton()}
        </div>
        {this.renderBranchToolbarButton()}
        {this.renderPushPullToolbarButton()}
      </Toolbar>
    )
  }

  private renderRepository() {
    const state = this.state
    if (this.inNoRepositoriesViewState()) {
      return (
        <NoRepositoriesView
          dotComAccount={this.getDotComAccount()}
          enterpriseAccount={this.getEnterpriseAccount()}
          onCreate={this.showCreateRepository}
          onClone={this.showCloneRepo}
          onAdd={this.showAddLocalRepo}
          onCreateTutorialRepository={this.showCreateTutorialRepositoryPopup}
          onResumeTutorialRepository={this.onResumeTutorialRepository}
          tutorialPaused={this.isTutorialPaused()}
          apiRepositories={state.apiRepositories}
          onRefreshRepositories={this.onRefreshRepositories}
        />
      )
    }

    const selectedState = state.selectedState
    if (!selectedState) {
      return <NoRepositorySelected />
    }

    if (selectedState.type === SelectionType.Repository) {
      const externalEditorLabel = state.selectedExternalEditor
        ? state.selectedExternalEditor
        : undefined

      return (
        <RepositoryView
          // When switching repositories we want to remount the RepositoryView
          // component to reset the scroll positions.
          key={selectedState.repository.hash}
          repository={selectedState.repository}
          state={selectedState.state}
          dispatcher={this.props.dispatcher}
          emoji={state.emoji}
          sidebarWidth={state.sidebarWidth}
          commitSummaryWidth={state.commitSummaryWidth}
          stashedFilesWidth={state.stashedFilesWidth}
          issuesStore={this.props.issuesStore}
          gitHubUserStore={this.props.gitHubUserStore}
          onViewCommitOnGitHub={this.onViewCommitOnGitHub}
          imageDiffType={state.imageDiffType}
          hideWhitespaceInDiff={state.hideWhitespaceInDiff}
          showSideBySideDiff={state.showSideBySideDiff}
          focusCommitMessage={state.focusCommitMessage}
          askForConfirmationOnDiscardChanges={
            state.askForConfirmationOnDiscardChanges
          }
          accounts={state.accounts}
          externalEditorLabel={externalEditorLabel}
          resolvedExternalEditor={state.resolvedExternalEditor}
          onOpenInExternalEditor={this.openFileInExternalEditor}
          appMenu={state.appMenuState[0]}
          currentTutorialStep={state.currentOnboardingTutorialStep}
          onExitTutorial={this.onExitTutorial}
          isShowingModal={this.isShowingModal}
          isShowingFoldout={this.state.currentFoldout !== null}
        />
      )
    } else if (selectedState.type === SelectionType.CloningRepository) {
      return (
        <CloningRepositoryView
          repository={selectedState.repository}
          progress={selectedState.progress}
        />
      )
    } else if (selectedState.type === SelectionType.MissingRepository) {
      return (
        <MissingRepository
          repository={selectedState.repository}
          dispatcher={this.props.dispatcher}
        />
      )
    } else {
      return assertNever(selectedState, `Unknown state: ${selectedState}`)
    }
  }

  private renderWelcomeFlow() {
    return (
      <Welcome
        dispatcher={this.props.dispatcher}
        optOut={this.state.optOutOfUsageTracking}
        accounts={this.state.accounts}
        signInState={this.state.signInState}
      />
    )
  }

  public render() {
    if (this.loading) {
      return null
    }

    const className = this.state.appIsFocused ? 'focused' : 'blurred'

    const currentTheme = this.state.showWelcomeFlow
      ? ApplicationTheme.Light
      : this.state.selectedTheme

    return (
      <div id="desktop-app-chrome" className={className}>
        <AppTheme theme={currentTheme} />
        {this.renderTitlebar()}
        {this.state.showWelcomeFlow
          ? this.renderWelcomeFlow()
          : this.renderApp()}
        {this.renderZoomInfo()}
        {this.renderFullScreenInfo()}
      </div>
    )
  }

  private onRepositoryFilterTextChanged = (text: string) => {
    this.props.dispatcher.setRepositoryFilterText(text)
  }

  private onSelectionChanged = (repository: Repository | CloningRepository) => {
    this.props.dispatcher.selectRepository(repository)
    this.props.dispatcher.closeFoldout(FoldoutType.Repository)
  }

  private onViewCommitOnGitHub = async (SHA: string) => {
    const repository = this.getRepository()

    if (
      !repository ||
      repository instanceof CloningRepository ||
      !repository.gitHubRepository
    ) {
      return
    }

    const baseURL = repository.gitHubRepository.htmlURL

    if (baseURL) {
      this.props.dispatcher.openInBrowser(`${baseURL}/commit/${SHA}`)
    }
  }

  private onBranchDeleted = (repository: Repository) => {
    // In the event a user is in the middle of a compare
    // we need to exit out of the compare state after the
    // branch has been deleted. Calling executeCompare allows
    // us to do just that.
    this.props.dispatcher.executeCompare(repository, {
      kind: HistoryTabMode.History,
    })
  }

  private inNoRepositoriesViewState() {
    return this.state.repositories.length === 0 || this.isTutorialPaused()
  }

  private isTutorialPaused() {
    return this.state.currentOnboardingTutorialStep === TutorialStep.Paused
  }
}

function NoRepositorySelected() {
  return <div className="panel blankslate">No repository selected</div>
}
