import * as React from 'react'
import { IStashEntry } from '../../models/stash-entry'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { Button } from '../lib/button'
import { ButtonGroup } from '../lib/button-group'
import { PopupType } from '../../models/popup'
import { Octicon, OcticonSymbol } from '../octicons'

interface IStashDiffHeaderProps {
  readonly stashEntry: IStashEntry
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly isWorkingTreeClean: boolean
}

interface IStashDiffHeaderState {
  readonly isRestoring: boolean
}

/**
 * Component to provide the actions that can be performed
 * on a stash while viewing a stash diff
 */
export class StashDiffHeader extends React.Component<
  IStashDiffHeaderProps,
  IStashDiffHeaderState
> {
  public constructor(props: IStashDiffHeaderProps) {
    super(props)

    this.state = {
      isRestoring: false,
    }
  }

  public render() {
    const { isWorkingTreeClean } = this.props

    // we pass `false` to `ButtonGroup` below because it assumes
    // the "submit" button performs the destructive action.
    // In this case the destructive action is performed by the
    // non-submit button so we _lie_ to the props to get
    // the correct button ordering
    return (
      <div className="header">
        <h3>Stashed changes</h3>
        <div className="row">
          <ButtonGroup destructive={false}>
            <Button
              disabled={!isWorkingTreeClean || this.state.isRestoring}
              onClick={this.onRestoreClick}
              type="submit"
            >
              Restore
            </Button>
            <Button
              disabled={this.state.isRestoring}
              onClick={this.onDiscardClick}
            >
              Discard
            </Button>
          </ButtonGroup>
          {this.renderExplanatoryText()}
        </div>
      </div>
    )
  }

  private renderExplanatoryText() {
    const { isWorkingTreeClean } = this.props

    if (isWorkingTreeClean || this.state.isRestoring) {
      return (
        <div className="explanatory-text">
          <span className="text">
            <strong>Restore</strong> will move your stashed files to the Changes
            list.
          </span>
        </div>
      )
    }

    return (
      <div className="explanatory-text">
        <Octicon symbol={OcticonSymbol.alert} />
        <span className="text">
          Unable to restore stash when changes are present on your branch.
        </span>
      </div>
    )
  }

  private onDiscardClick = () => {
    const { dispatcher, repository, stashEntry } = this.props
    dispatcher.showPopup({
      type: PopupType.ConfirmDiscardStash,
      stash: stashEntry,
      repository,
    })
  }

  private onRestoreClick = async () => {
    const { dispatcher, repository, stashEntry } = this.props

    this.setState({ isRestoring: true }, () => {
      dispatcher.popStash(repository, stashEntry)
    })
  }
}
