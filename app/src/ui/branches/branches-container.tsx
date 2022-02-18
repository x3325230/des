import * as React from 'react'

import { PullRequest } from '../../models/pull-request'
import { Repository, nameOf } from '../../models/repository'
import { Branch } from '../../models/branch'
import { BranchesTab } from '../../models/branches-tab'
import { PopupType } from '../../models/popup'

import { Dispatcher } from '../dispatcher'
import { FoldoutType } from '../../lib/app-state'
import { assertNever } from '../../lib/fatal-error'

import { TabBar } from '../tab-bar'

import { Row } from '../lib/row'
import { Octicon, OcticonSymbol } from '../octicons'
import { Button } from '../lib/button'

import { BranchList } from './branch-list'
import { PullRequestList } from './pull-request-list'
import { IBranchListItem } from './group-branches'
import { renderDefaultBranch } from './branch-renderer'
import { IMatches } from '../../lib/fuzzy-find'
import { startTimer } from '../lib/timing'
import {
  UncommittedChangesStrategyKind,
  UncommittedChangesStrategy,
  askToStash,
} from '../../models/uncommitted-changes-strategy'

interface IBranchesContainerProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly selectedTab: BranchesTab
  readonly allBranches: ReadonlyArray<Branch>
  readonly defaultBranch: Branch | null
  readonly currentBranch: Branch | null
  readonly recentBranches: ReadonlyArray<Branch>
  readonly pullRequests: ReadonlyArray<PullRequest>

  /** The pull request associated with the current branch. */
  readonly currentPullRequest: PullRequest | null

  /** Are we currently loading pull requests? */
  readonly isLoadingPullRequests: boolean

  readonly currentBranchProtected: boolean
}

interface IBranchesContainerState {
  readonly selectedBranch: Branch | null
  readonly selectedPullRequest: PullRequest | null
  readonly branchFilterText: string
  readonly pullRequestFilterText: string
}

/** The unified Branches and Pull Requests component. */
export class BranchesContainer extends React.Component<
  IBranchesContainerProps,
  IBranchesContainerState
> {
  public constructor(props: IBranchesContainerProps) {
    super(props)

    this.state = {
      selectedBranch: props.currentBranch,
      selectedPullRequest: props.currentPullRequest,
      branchFilterText: '',
      pullRequestFilterText: '',
    }
  }

  private getBranchName = (): string => {
    const { currentBranch, defaultBranch } = this.props
    if (currentBranch != null) {
      return currentBranch.name
    }

    if (defaultBranch != null) {
      return defaultBranch.name
    }

    return 'master'
  }

  public render() {
    const branchName = this.getBranchName()
    return (
      <div className="branches-container">
        {this.renderTabBar()}
        {this.renderSelectedTab()}
        <Row className="merge-button-row">
          <Button className="merge-button" onClick={this.onMergeClick}>
            <Octicon className="icon" symbol={OcticonSymbol.gitMerge} />
            <span title={`Merge a branch into ${branchName}`}>
              Choose a branch to merge into <strong>{branchName}</strong>
            </span>
          </Button>
        </Row>
      </div>
    )
  }

  private renderOpenPullRequestsBubble() {
    const { pullRequests } = this.props

    if (pullRequests.length > 0) {
      return <span className="count">{pullRequests.length}</span>
    }

    return null
  }

  private renderTabBar() {
    if (!this.props.repository.gitHubRepository) {
      return null
    }

    return (
      <TabBar
        onTabClicked={this.onTabClicked}
        selectedIndex={this.props.selectedTab}
      >
        <span>Branches</span>
        <span className="pull-request-tab">
          {__DARWIN__ ? 'Pull Requests' : 'Pull requests'}
          {this.renderOpenPullRequestsBubble()}
        </span>
      </TabBar>
    )
  }

  private renderBranch = (item: IBranchListItem, matches: IMatches) => {
    return renderDefaultBranch(item, matches, this.props.currentBranch)
  }

  private renderSelectedTab() {
    let tab = this.props.selectedTab
    if (!this.props.repository.gitHubRepository) {
      tab = BranchesTab.Branches
    }

    switch (tab) {
      case BranchesTab.Branches:
        return (
          <BranchList
            defaultBranch={this.props.defaultBranch}
            currentBranch={this.props.currentBranch}
            allBranches={this.props.allBranches}
            recentBranches={this.props.recentBranches}
            onItemClick={this.onBranchItemClick}
            filterText={this.state.branchFilterText}
            onFilterTextChanged={this.onBranchFilterTextChanged}
            selectedBranch={this.state.selectedBranch}
            onSelectionChanged={this.onBranchSelectionChanged}
            canCreateNewBranch={true}
            onCreateNewBranch={this.onCreateBranchWithName}
            renderBranch={this.renderBranch}
          />
        )

      case BranchesTab.PullRequests: {
        return this.renderPullRequests()
      }
    }

    return assertNever(tab, `Unknown Branches tab: ${tab}`)
  }

  private renderPullRequests() {
    const repository = this.props.repository.gitHubRepository

    if (repository === null) {
      return null
    }

    const pullRequests = this.props.pullRequests
    const repo = this.props.repository
    const isOnDefaultBranch =
      this.props.defaultBranch &&
      this.props.currentBranch &&
      this.props.defaultBranch.name === this.props.currentBranch.name

    return (
      <PullRequestList
        key="pr-list"
        pullRequests={pullRequests}
        selectedPullRequest={this.state.selectedPullRequest}
        repositoryName={nameOf(repo)}
        isOnDefaultBranch={!!isOnDefaultBranch}
        onSelectionChanged={this.onPullRequestSelectionChanged}
        onCreateBranch={this.onCreateBranch}
        onCreatePullRequest={this.onCreatePullRequest}
        filterText={this.state.pullRequestFilterText}
        onFilterTextChanged={this.onPullRequestFilterTextChanged}
        onItemClick={this.onPullRequestClicked}
        onDismiss={this.onDismiss}
        renderPostFilter={this.renderPullRequestPostFilter}
        dispatcher={this.props.dispatcher}
        repository={repository}
        isLoadingPullRequests={this.props.isLoadingPullRequests}
      />
    )
  }

  private onRefreshPullRequests = () => {
    this.props.dispatcher.refreshPullRequests(this.props.repository)
  }

  private renderPullRequestPostFilter = () => {
    return (
      <Button
        disabled={this.props.isLoadingPullRequests}
        onClick={this.onRefreshPullRequests}
        tooltip="Refresh the list of pull requests"
      >
        <Octicon
          symbol={OcticonSymbol.sync}
          className={this.props.isLoadingPullRequests ? 'spin' : undefined}
        />
      </Button>
    )
  }

  private onTabClicked = (tab: BranchesTab) => {
    this.props.dispatcher.changeBranchesTab(tab)
  }

  private onDismiss = () => {
    this.props.dispatcher.closeFoldout(FoldoutType.Branch)
  }

  private onMergeClick = () => {
    this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    this.props.dispatcher.showPopup({
      type: PopupType.MergeBranch,
      repository: this.props.repository,
    })
  }

  private onBranchItemClick = (branch: Branch) => {
    this.props.dispatcher.closeFoldout(FoldoutType.Branch)

    const { currentBranch, repository, currentBranchProtected } = this.props

    if (currentBranch == null || currentBranch.name !== branch.name) {
      const timer = startTimer('checkout branch from list', repository)

      // Never prompt to stash changes if someone is switching away from a protected branch
      const strategy: UncommittedChangesStrategy = currentBranchProtected
        ? {
            kind: UncommittedChangesStrategyKind.MoveToNewBranch,
            transientStashEntry: null,
          }
        : askToStash

      this.props.dispatcher
        .checkoutBranch(repository, branch, strategy)
        .then(() => timer.done())
    }
  }

  private onBranchSelectionChanged = (selectedBranch: Branch | null) => {
    this.setState({ selectedBranch })
  }

  private onBranchFilterTextChanged = (text: string) => {
    this.setState({ branchFilterText: text })
  }

  private onCreateBranchWithName = (name: string) => {
    const { repository, currentBranchProtected } = this.props

    this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    this.props.dispatcher.showPopup({
      type: PopupType.CreateBranch,
      repository,
      currentBranchProtected,
      initialName: name,
    })
  }

  private onCreateBranch = () => {
    this.onCreateBranchWithName('')
  }

  private onPullRequestFilterTextChanged = (text: string) => {
    this.setState({ pullRequestFilterText: text })
  }

  private onPullRequestSelectionChanged = (
    selectedPullRequest: PullRequest | null
  ) => {
    this.setState({ selectedPullRequest })
  }

  private onCreatePullRequest = () => {
    this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    this.props.dispatcher.createPullRequest(this.props.repository)
  }

  private onPullRequestClicked = (pullRequest: PullRequest) => {
    this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    const timer = startTimer(
      'checkout pull request from list',
      this.props.repository
    )
    this.props.dispatcher
      .checkoutPullRequest(this.props.repository, pullRequest)
      .then(() => timer.done())

    this.onPullRequestSelectionChanged(pullRequest)
  }
}
