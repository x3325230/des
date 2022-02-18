import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Row } from '../lib/row'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'

interface IUsageStatsChangeProps {
  readonly onSetStatsOptOut: (optOut: boolean) => void
  readonly onDismissed: () => void
  readonly onOpenUsageDataUrl: () => void
}

interface IUsageStatsChangeState {
  readonly optOutOfUsageTracking: boolean
}

/**
 * The dialog shown if the user has not seen the details about how our usage
 * tracking has changed
 */
export class UsageStatsChange extends React.Component<
  IUsageStatsChangeProps,
  IUsageStatsChangeState
> {
  public constructor(props: IUsageStatsChangeProps) {
    super(props)

    this.state = {
      optOutOfUsageTracking: false,
    }
  }

  public render() {
    return (
      <Dialog
        id="usage-reporting"
        title={
          __DARWIN__ ? 'Usage Reporting Changes' : 'Usage reporting changes'
        }
        dismissable={false}
        onDismissed={this.onDismissed}
        onSubmit={this.onDismissed}
        type="normal"
      >
        <DialogContent>
          <Row>
            GitHub Desktop has introduced a change around how it reports usage
            stats, to help us better understand how our GitHub users get value
            from Desktop:
          </Row>
          <Row>
            <ul>
              <li>
                <span>
                  <strong>If you are signed into a GitHub account</strong>, your
                  GitHub.com account ID will be included in the periodic usage
                  stats.
                </span>
              </li>
              <li>
                <span>
                  <strong>
                    If you are only signed into a GitHub Enterprise Server
                    account, or only using Desktop with non-GitHub remotes
                  </strong>
                  , nothing is going to change.
                </span>
              </li>
            </ul>
          </Row>
          <Row className="selection">
            <Checkbox
              label="Help GitHub Desktop improve by submitting usage stats"
              value={
                this.state.optOutOfUsageTracking
                  ? CheckboxValue.Off
                  : CheckboxValue.On
              }
              onChange={this.onReportingOptOutChanged}
            />
          </Row>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Continue"
            cancelButtonText={__DARWIN__ ? 'More Info' : 'More info'}
            onCancelButtonClick={this.viewMoreInfo}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onReportingOptOutChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    const value = !event.currentTarget.checked
    this.setState({ optOutOfUsageTracking: value })
  }

  private onDismissed = () => {
    this.props.onSetStatsOptOut(this.state.optOutOfUsageTracking)
    this.props.onDismissed()
  }

  private viewMoreInfo = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    this.props.onOpenUsageDataUrl()
  }
}
