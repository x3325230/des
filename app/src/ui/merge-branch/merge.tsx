import * as React from 'react'

import { getAheadBehind, mergeTree } from '../../lib/git'
import { Dispatcher } from '../dispatcher'

import { Branch } from '../../models/branch'
import { Repository } from '../../models/repository'

import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { BranchList, IBranchListItem, renderDefaultBranch } from '../branches'
import { revSymmetricDifference } from '../../lib/git'
import { IMatches } from '../../lib/fuzzy-find'
import { MergeTreeResult } from '../../models/merge'
import { ComputedAction } from '../../models/computed-action'
import { ActionStatusIcon } from '../lib/action-status-icon'
import { promiseWithMinimumTimeout } from '../../lib/promise'
import { truncateWithEllipsis } from '../../lib/truncate-with-ellipsis'
import { ClickSource } from '../lib/list'
import { Button } from '../lib/button'
import { Octicon, OcticonSymbol } from '../octicons'

interface IMergeProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository

  /**
   * See IBranchesState.defaultBranch
   */
  readonly defaultBranch: Branch | null

  /**
   * The currently checked out branch
   */
  readonly currentBranch: Branch

  /**
   * See IBranchesState.allBranches
   */
  readonly allBranches: ReadonlyArray<Branch>

  /**
   * See IBranchesState.recentBranches
   */
  readonly recentBranches: ReadonlyArray<Branch>

  /**
   * The branch to select when the merge dialog is opened
   */
  readonly initialBranch?: Branch

  /**
   * A function that's called when the dialog is dismissed by the user in the
   * ways described in the Dialog component's dismissable prop.
   */
  readonly onDismissed: () => void
}

interface IMergeState {
  /** The currently selected branch. */
  readonly selectedBranch: Branch | null

  /** The merge result of comparing the selected branch to the current branch */
  readonly mergeStatus: MergeTreeResult | null

  /**
   * The number of commits that would be brought in by the merge.
   * undefined if no branch is selected or still calculating the
   * number of commits.
   */
  readonly commitCount?: number

  /** The filter text to use in the branch selector */
  readonly filterText: string

  /** State properties for the split button */
  readonly showButtonOptions: boolean
  readonly isMergeOption: boolean
}

/** A component for merging a branch into the current branch. */
export class Merge extends React.Component<IMergeProps, IMergeState> {
  public constructor(props: IMergeProps) {
    super(props)

    const selectedBranch = this.resolveSelectedBranch()

    this.state = {
      selectedBranch,
      commitCount: undefined,
      filterText: '',
      mergeStatus: null,
      showButtonOptions: false,
      isMergeOption: true,
    }
  }

  public componentDidMount() {
    const branch = this.state.selectedBranch
    if (!branch) {
      return
    }

    this.updateMergeStatus(branch)
  }

  private onFilterTextChanged = (filterText: string) => {
    this.setState({ filterText })
  }

  private onItemClick = (branch: Branch, source: ClickSource) => {
    if (source.kind !== 'keyboard' || source.event.key !== 'Enter') {
      return
    }

    source.event.preventDefault()
    const { selectedBranch } = this.state

    if (selectedBranch !== null && selectedBranch.name === branch.name) {
      this.merge()
    }
  }

  private onSelectionChanged = async (selectedBranch: Branch | null) => {
    if (selectedBranch != null) {
      this.setState({ selectedBranch })
      await this.updateMergeStatus(selectedBranch)
    } else {
      this.setState({ selectedBranch, commitCount: 0, mergeStatus: null })
    }
  }

  private renderMergeInfo() {
    const { currentBranch } = this.props
    const { selectedBranch, mergeStatus, commitCount } = this.state

    if (
      mergeStatus == null ||
      currentBranch == null ||
      selectedBranch == null ||
      currentBranch.name === selectedBranch.name ||
      commitCount == null
    ) {
      return null
    }

    return (
      <div className="merge-status-component">
        <ActionStatusIcon
          status={this.state.mergeStatus}
          classNamePrefix="merge-status"
        />
        <p className="merge-info">
          {this.renderMergeStatusMessage(
            mergeStatus,
            selectedBranch,
            currentBranch,
            commitCount
          )}
        </p>
      </div>
    )
  }

  private renderMergeStatusMessage(
    mergeStatus: MergeTreeResult,
    branch: Branch,
    currentBranch: Branch,
    commitCount: number
  ): JSX.Element {
    if (mergeStatus.kind === ComputedAction.Loading) {
      return this.renderLoadingMergeMessage()
    }

    if (mergeStatus.kind === ComputedAction.Clean) {
      return this.renderCleanMergeMessage(branch, currentBranch, commitCount)
    }

    if (mergeStatus.kind === ComputedAction.Invalid) {
      return this.renderInvalidMergeMessage()
    }

    return this.renderConflictedMergeMessage(
      branch,
      currentBranch,
      mergeStatus.conflictedFiles
    )
  }

  private renderLoadingMergeMessage() {
    return (
      <React.Fragment>
        Checking for ability to merge automatically...
      </React.Fragment>
    )
  }

  private renderCleanMergeMessage(
    branch: Branch,
    currentBranch: Branch,
    commitCount: number
  ) {
    if (commitCount === 0) {
      return (
        <React.Fragment>
          {`This branch is up to date with `}
          <strong>{branch.name}</strong>
        </React.Fragment>
      )
    }

    const pluralized = commitCount === 1 ? 'commit' : 'commits'
    return (
      <React.Fragment>
        This will merge
        <strong>{` ${commitCount} ${pluralized}`}</strong>
        {` from `}
        <strong>{branch.name}</strong>
        {` into `}
        <strong>{currentBranch.name}</strong>
      </React.Fragment>
    )
  }

  private renderInvalidMergeMessage() {
    return (
      <React.Fragment>
        Unable to merge unrelated histories in this repository
      </React.Fragment>
    )
  }

  private renderConflictedMergeMessage(
    branch: Branch,
    currentBranch: Branch,
    count: number
  ) {
    const pluralized = count === 1 ? 'file' : 'files'
    return (
      <React.Fragment>
        There will be
        <strong>{` ${count} conflicted ${pluralized}`}</strong>
        {` when merging `}
        <strong>{branch.name}</strong>
        {` into `}
        <strong>{currentBranch.name}</strong>
      </React.Fragment>
    )
  }

  private renderBranch = (item: IBranchListItem, matches: IMatches) => {
    return renderDefaultBranch(item, matches, this.props.currentBranch)
  }

  private canMergeSelectedBranch() {
    const selectedBranch = this.state.selectedBranch
    const currentBranch = this.props.currentBranch

    const selectedBranchIsCurrentBranch =
      selectedBranch !== null &&
      currentBranch !== null &&
      selectedBranch.name === currentBranch.name

    const isBehind =
      this.state.commitCount !== undefined && this.state.commitCount > 0

    const canMergeBranch =
      this.state.mergeStatus === null ||
      this.state.mergeStatus.kind !== ComputedAction.Invalid

    return (
      selectedBranch !== null &&
      !selectedBranchIsCurrentBranch &&
      isBehind &&
      canMergeBranch
    )
  }

  private onSelecteMerge = (isMergeOption: boolean) => {
    return () => {
      this.setState({
        showButtonOptions: false,
        isMergeOption: isMergeOption,
      })
    }
  }

  private renderSplitButtonOptions() {
    if (!this.state.showButtonOptions) {
      return
    }

    const selectedBranch = this.state.selectedBranch
    const currentBranch = this.props.currentBranch
    return (
      <div className="split-button-options">
        <ul>
          <li onClick={this.onSelecteMerge(true)}>
            {this.state.isMergeOption ? (
              <Octicon
                className="selected-option-indicator"
                symbol={OcticonSymbol.check}
              />
            ) : null}
            <div className="option-title">Create a merge commit</div>
            <div className="option-description">
              All commits from{' '}
              <strong>
                {selectedBranch ? selectedBranch.name : 'this branch'}
              </strong>{' '}
              will be added to{' '}
              <strong>
                {currentBranch ? currentBranch.name : 'the base branch'}
              </strong>{' '}
              via a merge commit.
            </div>
          </li>
          <li onClick={this.onSelecteMerge(false)}>
            {!this.state.isMergeOption ? (
              <Octicon
                className="selected-option-indicator"
                symbol={OcticonSymbol.check}
              />
            ) : null}
            <div className="option-title">Squash and Merge</div>
            <div className="option-description">
              The commits in{' '}
              <strong>
                {selectedBranch ? selectedBranch.name : 'this branch'}
              </strong>{' '}
              will be combined into one commit in{' '}
              <strong>
                {currentBranch ? currentBranch.name : 'the base branch'}
              </strong>
              .
            </div>
          </li>
        </ul>
      </div>
    )
  }

  private renderSelectedOption() {
    const selectedBranch = this.state.selectedBranch
    const currentBranch = this.props.currentBranch
    return (
      <>
        {!this.state.isMergeOption ? 'Squash and ' : null}Merge{' '}
        <strong>{selectedBranch ? selectedBranch.name : ''}</strong> into{' '}
        <strong>{currentBranch ? currentBranch.name : ''}</strong>
      </>
    )
  }

  private openSplitButtonDropdown = () => {
    this.setState({ showButtonOptions: !this.state.showButtonOptions })
  }

  public render() {
    const selectedBranch = this.state.selectedBranch
    const currentBranch = this.props.currentBranch
    const disabled = !this.canMergeSelectedBranch()

    // the amount of characters to allow before we truncate was chosen arbitrarily
    const currentBranchName = truncateWithEllipsis(
      this.props.currentBranch.name,
      40
    )
    return (
      <Dialog
        id="merge"
        onDismissed={this.props.onDismissed}
        onSubmit={this.merge}
        title={
          <>
            Merge into <strong>{currentBranchName}</strong>
          </>
        }
      >
        <DialogContent>
          <BranchList
            allBranches={this.props.allBranches}
            currentBranch={currentBranch}
            defaultBranch={this.props.defaultBranch}
            recentBranches={this.props.recentBranches}
            filterText={this.state.filterText}
            onFilterTextChanged={this.onFilterTextChanged}
            selectedBranch={selectedBranch}
            onSelectionChanged={this.onSelectionChanged}
            canCreateNewBranch={false}
            renderBranch={this.renderBranch}
            onItemClick={this.onItemClick}
          />
        </DialogContent>
        <DialogFooter>
          {this.renderMergeInfo()}
          <div className="split-button">
            <Button disabled={disabled} type="submit">
              {this.renderSelectedOption()}
            </Button>
            <Button
              disabled={disabled}
              className="dropdown-button"
              onClick={this.openSplitButtonDropdown}
              type="button"
            >
              <Octicon symbol={OcticonSymbol.triangleDown} />
            </Button>
            {this.renderSplitButtonOptions()}
          </div>
        </DialogFooter>
      </Dialog>
    )
  }

  private async updateMergeStatus(branch: Branch) {
    this.setState({ mergeStatus: { kind: ComputedAction.Loading } })

    const { currentBranch } = this.props

    if (currentBranch != null) {
      const mergeStatus = await promiseWithMinimumTimeout(
        () => mergeTree(this.props.repository, currentBranch, branch),
        500
      )

      this.setState({ mergeStatus })
    }

    const range = revSymmetricDifference('', branch.name)
    const aheadBehind = await getAheadBehind(this.props.repository, range)
    const commitCount = aheadBehind ? aheadBehind.behind : 0

    if (this.state.selectedBranch !== branch) {
      // The branch changed while we were waiting on the result of `getAheadBehind`.
      this.setState({ commitCount: undefined })
    } else {
      this.setState({ commitCount })
    }
  }

  private merge = () => {
    if (!this.canMergeSelectedBranch()) {
      return
    }

    const branch = this.state.selectedBranch
    if (!branch) {
      return
    }

    this.props.dispatcher.mergeBranch(
      this.props.repository,
      branch.name,
      this.state.mergeStatus
    )
    this.props.onDismissed()
  }

  /**
   * Returns the branch to use as the selected branch
   *
   * The initial branch is used if passed
   * otherwise, the default branch will be used iff it's
   * not the currently checked out branch
   */
  private resolveSelectedBranch() {
    const { currentBranch, defaultBranch, initialBranch } = this.props

    if (initialBranch !== undefined) {
      return initialBranch
    }

    return currentBranch === defaultBranch ? null : defaultBranch
  }
}
