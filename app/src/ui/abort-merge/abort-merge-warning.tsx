import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Dispatcher } from '../dispatcher'
import { PopupType } from '../../models/popup'
import { Repository } from '../../models/repository'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'

interface IAbortMergeWarningProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly onDismissed: () => void
  readonly ourBranch: string
  readonly theirBranch?: string
}

/**
 * Modal to tell the user their merge encountered conflicts
 */
export class AbortMergeWarning extends React.Component<
  IAbortMergeWarningProps,
  {}
> {
  /**
   *  Aborts the merge and dismisses the modal
   */
  private onSubmit = async () => {
    await this.props.dispatcher.abortMerge(this.props.repository)
    this.props.onDismissed()
  }

  /**
   *  dismisses the modal and shows the merge conflicts modal
   */
  private onCancel = () => {
    this.props.onDismissed()
    this.props.dispatcher.showPopup({
      type: PopupType.MergeConflicts,
      repository: this.props.repository,
      ourBranch: this.props.ourBranch,
      theirBranch: this.props.theirBranch,
    })
  }

  private renderTextContent(ourBranch: string, theirBranch?: string) {
    let firstParagraph

    if (theirBranch !== undefined) {
      firstParagraph = (
        <p>
          {'Are you sure you want to abort merging '}
          <strong>{theirBranch}</strong>
          {' into '}
          <strong>{ourBranch}</strong>?
        </p>
      )
    } else {
      firstParagraph = (
        <p>
          {'Are you sure you want to abort merging into '}
          <strong>{ourBranch}</strong>?
        </p>
      )
    }

    return (
      <div className="column-left">
        {firstParagraph}
        <p>
          Aborting this merge will take you back to the pre-merge state and the
          conflicts you've already resolved will still be present.
        </p>
      </div>
    )
  }

  public render() {
    return (
      <Dialog
        id="abort-merge-warning"
        title={__DARWIN__ ? 'Confirm Abort Merge' : 'Confirm abort merge'}
        onDismissed={this.onCancel}
        onSubmit={this.onSubmit}
        type="warning"
      >
        <DialogContent>
          {this.renderTextContent(this.props.ourBranch, this.props.theirBranch)}
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            destructive={true}
            okButtonText={__DARWIN__ ? 'Abort Merge' : 'Abort merge'}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
