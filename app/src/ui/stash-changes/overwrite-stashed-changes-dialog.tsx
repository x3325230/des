import React = require('react')
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Repository } from '../../models/repository'
import { Branch } from '../../models/branch'
import { Dispatcher } from '../dispatcher'
import { ButtonGroup } from '../lib/button-group'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { stashOnCurrentBranch } from '../../models/uncommitted-changes-strategy'

interface IOverwriteStashProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly branchToCheckout: Branch
  readonly onDismissed: () => void
}

interface IOverwriteStashState {
  readonly isCheckingOutBranch: boolean
}

/**
 * Dialog that alerts user that their stash will be overwritten
 */
export class OverwriteStash extends React.Component<
  IOverwriteStashProps,
  IOverwriteStashState
> {
  public constructor(props: IOverwriteStashProps) {
    super(props)

    this.state = {
      isCheckingOutBranch: false,
    }
  }

  public render() {
    const title = __DARWIN__ ? 'Overwrite Stash?' : 'Overwrite stash?'

    return (
      <Dialog
        id="overwrite-stash"
        type="warning"
        title={title}
        loading={this.state.isCheckingOutBranch}
        disabled={this.state.isCheckingOutBranch}
        onSubmit={this.props.onDismissed}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <Row>
            Are you sure you want to proceed? This will overwrite your existing
            stash with your current changes.
          </Row>
        </DialogContent>
        <DialogFooter>
          <ButtonGroup destructive={true}>
            <Button type="submit">Cancel</Button>
            <Button onClick={this.onSubmit}>Overwrite</Button>
          </ButtonGroup>
        </DialogFooter>
      </Dialog>
    )
  }

  private onSubmit = async () => {
    const { dispatcher, repository, branchToCheckout, onDismissed } = this.props

    this.setState({
      isCheckingOutBranch: true,
    })

    try {
      await dispatcher.checkoutBranch(
        repository,
        branchToCheckout,
        stashOnCurrentBranch
      )
    } finally {
      this.setState({
        isCheckingOutBranch: false,
      })
    }

    onDismissed()
  }
}
