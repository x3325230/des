import * as React from 'react'
import { Branch } from '../../models/branch'
import { IMatches } from '../../lib/fuzzy-find'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  OkCancelButtonGroup,
} from '../dialog'
import { BranchList, IBranchListItem, renderDefaultBranch } from '../branches'
import { ClickSource } from '../lib/list'
import { CherryPickPreview } from '../../models/cherry-pick'
import { ComputedAction } from '../../models/computed-action'
import { ActionStatusIcon } from '../lib/action-status-icon'
import { promiseWithMinimumTimeout } from '../../lib/promise'

interface IChooseTargetBranchDialogProps {
  /**
   * The currently checked out branch
   */
  readonly currentBranch: Branch

  /**
   * See IBranchesState.defaultBranch
   */
  readonly defaultBranch: Branch | null

  /**
   * See IBranchesState.allBranches
   */
  readonly allBranches: ReadonlyArray<Branch>

  /**
   * See IBranchesState.recentBranches
   */
  readonly recentBranches: ReadonlyArray<Branch>

  /**
   * A function that's called when the user selects a branch and hits start
   * cherry pick
   */
  readonly onCherryPick: (targetBranch: Branch) => void

  /**
   * A function that's called when the dialog is dismissed by the user in the
   * ways described in the Dialog component's dismissable prop.
   */
  readonly onDismissed: () => void

  /**
   * A function to determine if a selected branch will have
   * conflicts with the given cherry pick
   */
  readonly willCherryPickHaveConflicts: (
    targetBranch: Branch
  ) => Promise<boolean>
}

interface IChooseTargetBranchDialogState {
  /** The currently selected branch. */
  readonly selectedBranch: Branch | null

  /** The filter text to use in the branch selector */
  readonly filterText: string

  /** A preview of the cherry pick - i.e., cleanly or with conflicts */
  readonly cherryPickPreview: CherryPickPreview | null
}

/** A component for initiating a rebase of the current branch. */
export class ChooseTargetBranchDialog extends React.Component<
  IChooseTargetBranchDialogProps,
  IChooseTargetBranchDialogState
> {
  public constructor(props: IChooseTargetBranchDialogProps) {
    super(props)

    this.state = {
      selectedBranch: null,
      cherryPickPreview: null,
      filterText: '',
    }
  }

  private onFilterTextChanged = (filterText: string) => {
    this.setState({ filterText })
  }

  private onSelectionChanged = (selectedBranch: Branch | null) => {
    this.setState({ selectedBranch })

    if (selectedBranch !== null) {
      this.updateCherryPickPreview(selectedBranch)
    }
  }

  private renderBranch = (item: IBranchListItem, matches: IMatches) => {
    return renderDefaultBranch(item, matches, this.props.currentBranch)
  }

  private onEnterPressed = (branch: Branch, source: ClickSource) => {
    if (source.kind !== 'keyboard' || source.event.key !== 'Enter') {
      return
    }

    source.event.preventDefault()

    const { selectedBranch } = this.state

    if (selectedBranch !== null && selectedBranch.name === branch.name) {
      this.startCherryPick()
    }
  }

  private async updateCherryPickPreview(selectedBranch: Branch) {
    if (selectedBranch.name === this.props.currentBranch.name) {
      this.setState({
        cherryPickPreview: null,
      })
      return
    }

    this.setState({
      cherryPickPreview: {
        kind: ComputedAction.Loading,
      },
    })

    const haveConflicts = await promiseWithMinimumTimeout(async () => {
      return await this.props.willCherryPickHaveConflicts(selectedBranch)
    }, 500)

    this.setState({
      cherryPickPreview: {
        kind: haveConflicts ? ComputedAction.Conflicts : ComputedAction.Clean,
      },
    })
  }

  private canCherryPickOntoSelectedBranch() {
    const { selectedBranch } = this.state
    return selectedBranch !== null && !this.selectedBranchIsCurrentBranch()
  }

  private selectedBranchIsCurrentBranch() {
    const { selectedBranch } = this.state
    const currentBranch = this.props.currentBranch
    return (
      selectedBranch !== null &&
      currentBranch !== null &&
      selectedBranch.name === currentBranch.name
    )
  }

  private renderOkButtonText() {
    const okButtonText = 'Cherry pick commit'

    const { selectedBranch } = this.state
    if (selectedBranch !== null) {
      return (
        <>
          {okButtonText} to <strong>{selectedBranch.name}</strong>…
        </>
      )
    }

    return okButtonText
  }

  private renderCherryPickPreview() {
    return (
      <div className="cherry-pick-preview">
        <ActionStatusIcon
          status={this.state.cherryPickPreview}
          classNamePrefix="cherry-pick-preview"
        />
        <p className="cherry-pick-preview-message">
          {this.renderCherryPickPreviewMessage()}
        </p>
      </div>
    )
  }

  private renderCherryPickPreviewMessage() {
    const { selectedBranch, cherryPickPreview } = this.state

    if (
      cherryPickPreview == null ||
      selectedBranch === null ||
      this.selectedBranchIsCurrentBranch()
    ) {
      return null
    }

    switch (cherryPickPreview.kind) {
      case ComputedAction.Loading:
        return 'Checking for ability to cherry pick automatically...'
      case ComputedAction.Clean:
        // TODO: pluralize when implementing multiple commits
        return 'You can copy this commit without conflicts.'
      case ComputedAction.Conflicts:
        // TODO: pluralize when implementing multiple commits.
        return (
          <>
            Copying this commit to <strong>{selectedBranch.name}</strong> will
            result in a <strong>conflict</strong>.
          </>
        )
      default:
        return
    }
  }

  public render() {
    const tooltip = this.selectedBranchIsCurrentBranch()
      ? 'You are not able to cherry pick from and to the same branch'
      : undefined

    return (
      <Dialog
        id="cherry-pick"
        onDismissed={this.props.onDismissed}
        onSubmit={this.startCherryPick}
        dismissable={true}
        title={<strong>Cherry pick commit to a branch</strong>}
      >
        <DialogContent>
          <BranchList
            allBranches={this.props.allBranches}
            currentBranch={this.props.currentBranch}
            defaultBranch={this.props.defaultBranch}
            recentBranches={this.props.recentBranches}
            filterText={this.state.filterText}
            onFilterTextChanged={this.onFilterTextChanged}
            selectedBranch={this.state.selectedBranch}
            onSelectionChanged={this.onSelectionChanged}
            canCreateNewBranch={false}
            renderBranch={this.renderBranch}
            onItemClick={this.onEnterPressed}
          />
        </DialogContent>
        <DialogFooter>
          {this.renderCherryPickPreview()}
          <OkCancelButtonGroup
            okButtonText={this.renderOkButtonText()}
            okButtonDisabled={!this.canCherryPickOntoSelectedBranch()}
            okButtonTitle={tooltip}
            cancelButtonVisible={false}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private startCherryPick = async () => {
    const { selectedBranch } = this.state
    if (!selectedBranch) {
      return
    }

    this.props.onCherryPick(selectedBranch)
  }
}
