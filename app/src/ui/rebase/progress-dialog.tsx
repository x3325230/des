import * as React from 'react'

import { formatRebaseValue } from '../../lib/rebase'

import { RichText } from '../lib/rich-text'

import { Dialog, DialogContent } from '../dialog'
import { Octicon, OcticonSymbol } from '../octicons'
import { IMultiCommitOperationProgress } from '../../models/progress'

interface IRebaseProgressDialogProps {
  /** Progress information about the current rebase */
  readonly progress: IMultiCommitOperationProgress

  readonly emoji: Map<string, string>
}

export class RebaseProgressDialog extends React.Component<
  IRebaseProgressDialogProps
> {
  private onDismissed = () => {
    // this dialog is undismissable, but I need to handle the event
  }

  public render() {
    const {
      position,
      totalCommitCount,
      value,
      currentCommitSummary,
    } = this.props.progress

    // ensure progress always starts from 1
    const count = position <= 1 ? 1 : position

    const progressValue = formatRebaseValue(value)
    return (
      <Dialog
        dismissable={false}
        onDismissed={this.onDismissed}
        id="rebase-progress"
        title="Rebase in progress"
      >
        <DialogContent>
          <div>
            <progress value={progressValue} />

            <div className="details">
              <div className="green-circle">
                <Octicon symbol={OcticonSymbol.check} />
              </div>
              <div className="summary">
                <div className="message">
                  Commit {count} of {totalCommitCount}
                </div>
                <div className="detail">
                  <RichText
                    emoji={this.props.emoji}
                    text={currentCommitSummary || ''}
                  />
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }
}
