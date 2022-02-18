import * as React from 'react'
import { Dispatcher } from '../dispatcher'
import * as OcticonSymbol from '../octicons/octicons.generated'
import { syncClockwise } from '../octicons'
import {
  Repository,
  isRepositoryWithGitHubRepository,
} from '../../models/repository'
import { TipState } from '../../models/tip'
import { ToolbarDropdown, DropdownState } from './dropdown'
import {
  FoldoutType,
  IRepositoryState,
  isRebaseConflictState,
} from '../../lib/app-state'
import { BranchesContainer, PullRequestBadge } from '../branches'
import { assertNever } from '../../lib/fatal-error'
import { BranchesTab } from '../../models/branches-tab'
import { PullRequest } from '../../models/pull-request'
import classNames from 'classnames'
import { dragAndDropManager } from '../../lib/drag-and-drop-manager'
import { DragType } from '../../models/drag-drop'
import { CICheckRunPopover } from '../check-runs/ci-check-run-popover'
import { IRefCheck } from '../../lib/ci-checks/ci-checks'
import { PopupType } from '../../models/popup'
import { getCommit } from '../../lib/git'

interface IBranchDropdownProps {
  readonly dispatcher: Dispatcher

  /** The currently selected repository. */
  readonly repository: Repository

  /** The current repository state as derived from AppState */
  readonly repositoryState: IRepositoryState

  /** Whether or not the branch dropdown is currently open */
  readonly isOpen: boolean

  /**
   * An event handler for when the drop down is opened, or closed, by a pointer
   * event or by pressing the space or enter key while focused.
   *
   * @param state    - The new state of the drop down
   */
  readonly onDropDownStateChanged: (state: DropdownState) => void

  /** The currently selected tab. */
  readonly selectedTab: BranchesTab

  /** The open pull requests in the repository. */
  readonly pullRequests: ReadonlyArray<PullRequest>

  /** The pull request associated with the current branch. */
  readonly currentPullRequest: PullRequest | null

  /** Are we currently loading pull requests? */
  readonly isLoadingPullRequests: boolean

  /** Whether this component should show its onboarding tutorial nudge arrow */
  readonly shouldNudge: boolean

  readonly showCIStatusPopover: boolean
}

/**
 * A drop down for selecting the currently checked out branch.
 */
export class BranchDropdown extends React.Component<IBranchDropdownProps> {
  private renderBranchFoldout = (): JSX.Element | null => {
    const repositoryState = this.props.repositoryState
    const branchesState = repositoryState.branchesState

    const tip = repositoryState.branchesState.tip
    const currentBranch = tip.kind === TipState.Valid ? tip.branch : null

    return (
      <BranchesContainer
        allBranches={branchesState.allBranches}
        recentBranches={branchesState.recentBranches}
        currentBranch={currentBranch}
        defaultBranch={branchesState.defaultBranch}
        dispatcher={this.props.dispatcher}
        repository={this.props.repository}
        selectedTab={this.props.selectedTab}
        pullRequests={this.props.pullRequests}
        currentPullRequest={this.props.currentPullRequest}
        isLoadingPullRequests={this.props.isLoadingPullRequests}
      />
    )
  }

  private onDropDownStateChanged = (state: DropdownState) => {
    // Don't allow opening the drop down when checkout is in progress
    if (state === 'open' && this.props.repositoryState.checkoutProgress) {
      return
    }

    this.props.onDropDownStateChanged(state)
  }

  public render() {
    const { repositoryState } = this.props
    const { branchesState, checkoutProgress, changesState } = repositoryState
    const { tip } = branchesState
    const { conflictState } = changesState

    const tipKind = tip.kind

    let icon: OcticonSymbol.OcticonSymbolType = OcticonSymbol.gitBranch
    let iconClassName: string | undefined = undefined
    let title: string
    let description = __DARWIN__ ? 'Current Branch' : 'Current branch'
    let canOpen = true
    let disabled = false
    let tooltip: string

    if (this.props.currentPullRequest) {
      icon = OcticonSymbol.gitPullRequest
    }

    if (tip.kind === TipState.Unknown) {
      // TODO: this is bad and I feel bad
      return null
    } else if (tip.kind === TipState.Unborn) {
      title = tip.ref
      tooltip = `Current branch is ${tip.ref}`
      canOpen = branchesState.allBranches.some(
        b => !b.isDesktopForkRemoteBranch
      )
    } else if (tip.kind === TipState.Detached) {
      title = `On ${tip.currentSha.substr(0, 7)}`
      tooltip = 'Currently on a detached HEAD'
      icon = OcticonSymbol.gitCommit
      description = 'Detached HEAD'
    } else if (tip.kind === TipState.Valid) {
      title = tip.branch.name
      tooltip = `Current branch is ${title}`
    } else {
      return assertNever(tip, `Unknown tip state: ${tipKind}`)
    }

    let progressValue: number | undefined = undefined

    if (checkoutProgress) {
      title = checkoutProgress.targetBranch
      description = __DARWIN__ ? 'Switching to Branch' : 'Switching to branch'

      if (checkoutProgress.value > 0) {
        const friendlyProgress = Math.round(checkoutProgress.value * 100)
        description = `${description} (${friendlyProgress}%)`
      }

      progressValue = checkoutProgress.value
      icon = syncClockwise
      iconClassName = 'spin'
      canOpen = false
    } else if (conflictState !== null && isRebaseConflictState(conflictState)) {
      title = conflictState.targetBranch
      description = 'Rebasing branch'
      icon = OcticonSymbol.gitBranch
      canOpen = false
      disabled = true
    }

    const isOpen = this.props.isOpen
    const currentState: DropdownState = isOpen && canOpen ? 'open' : 'closed'
    const buttonClassName = classNames('nudge-arrow', {
      'nudge-arrow-up': this.props.shouldNudge,
    })

    return (
      <>
        <ToolbarDropdown
          className="branch-button"
          icon={icon}
          iconClassName={iconClassName}
          title={title}
          description={description}
          tooltip={isOpen ? undefined : tooltip}
          onDropdownStateChanged={this.onDropDownStateChanged}
          dropdownContentRenderer={this.renderBranchFoldout}
          dropdownState={currentState}
          disabled={disabled}
          showDisclosureArrow={canOpen}
          progressValue={progressValue}
          buttonClassName={buttonClassName}
          onMouseEnter={this.onMouseEnter}
        >
          {this.renderPullRequestInfo()}
        </ToolbarDropdown>
        {this.props.showCIStatusPopover && this.renderPopover()}
      </>
    )
  }

  /**
   * Method to capture when the mouse is over the branch dropdown button.
   *
   * We currently only use this in conjunction with dragging cherry picks so
   * that we can open the branch menu when dragging a commit over it.
   */
  private onMouseEnter = (): void => {
    if (dragAndDropManager.isDragOfTypeInProgress(DragType.Commit)) {
      dragAndDropManager.emitEnterDragZone('branch-button')
      this.props.dispatcher.showFoldout({ type: FoldoutType.Branch })
    }
  }

  private onBadgeClick = () => {
    this.togglePopover()
  }

  private togglePopover() {
    if (this.props.showCIStatusPopover) {
      this.closePopover()
    } else {
      this.props.dispatcher.closeFoldout(FoldoutType.Branch)
      this.openPopover()
    }
  }

  private openPopover = () => {
    this.props.dispatcher.setShowCIStatusPopover(true)
  }

  private closePopover = (event?: MouseEvent) => {
    if (event === undefined) {
      this.props.dispatcher.setShowCIStatusPopover(false)
      return
    }

    const { target } = event
    const prBadgeElem = document.getElementById('pr-badge')
    if (
      prBadgeElem !== null &&
      target !== null &&
      target instanceof Node &&
      prBadgeElem.contains(target)
    ) {
      return
    }

    this.props.dispatcher.setShowCIStatusPopover(false)
  }

  private renderPopover() {
    const pr = this.props.currentPullRequest
    const { tip } = this.props.repositoryState.branchesState
    // It is ok if it doesn't exist, we just can't retrieve actions workflows
    const currentBranchName = tip.kind === TipState.Valid ? tip.branch.name : ''

    if (pr === null) {
      return null
    }

    return (
      <CICheckRunPopover
        prNumber={pr.pullRequestNumber}
        dispatcher={this.props.dispatcher}
        repository={pr.base.gitHubRepository}
        branchName={currentBranchName}
        closePopover={this.closePopover}
        onCheckRunsLoaded={this.onCheckRunsLoaded}
      />
    )
  }

  private onCheckRunsLoaded = async (checks: ReadonlyArray<IRefCheck>) => {
    const { dispatcher, repository, currentPullRequest } = this.props

    if (
      !isRepositoryWithGitHubRepository(repository) ||
      currentPullRequest === null
    ) {
      return
    }

    const commit = await getCommit(repository, currentPullRequest.head.sha)

    if (commit === null) {
      return
    }

    dispatcher.setShowCIStatusPopover(false)
    dispatcher.showPopup({
      type: PopupType.PullRequestChecksFailed,
      repository,
      pullRequest: currentPullRequest,
      needsSelectRepository: false,
      commitMessage: commit.summary,
      commitSha: commit.sha,
      checks,
    })
  }

  private renderPullRequestInfo() {
    const pr = this.props.currentPullRequest

    if (pr === null) {
      return null
    }

    return (
      <PullRequestBadge
        number={pr.pullRequestNumber}
        dispatcher={this.props.dispatcher}
        repository={pr.base.gitHubRepository}
        onBadgeClick={this.onBadgeClick}
      />
    )
  }
}
