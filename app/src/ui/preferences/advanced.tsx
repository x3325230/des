import * as React from 'react'
import { DialogContent } from '../dialog'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { LinkButton } from '../lib/link-button'
import { SamplesURL } from '../../lib/stats'
import { UncommittedChangesStrategyKind } from '../../models/uncommitted-changes-strategy'
import { RadioButton } from '../lib/radio-button'

interface IAdvancedPreferencesProps {
  readonly optOutOfUsageTracking: boolean
  readonly uncommittedChangesStrategyKind: UncommittedChangesStrategyKind
  readonly repositoryIndicatorsEnabled: boolean
  readonly onOptOutofReportingchanged: (checked: boolean) => void
  readonly onUncommittedChangesStrategyKindChanged: (
    value: UncommittedChangesStrategyKind
  ) => void
  readonly onRepositoryIndicatorsEnabledChanged: (enabled: boolean) => void
}

interface IAdvancedPreferencesState {
  readonly optOutOfUsageTracking: boolean
  readonly uncommittedChangesStrategyKind: UncommittedChangesStrategyKind
}

export class Advanced extends React.Component<
  IAdvancedPreferencesProps,
  IAdvancedPreferencesState
> {
  public constructor(props: IAdvancedPreferencesProps) {
    super(props)

    this.state = {
      optOutOfUsageTracking: this.props.optOutOfUsageTracking,
      uncommittedChangesStrategyKind: this.props.uncommittedChangesStrategyKind,
    }
  }

  private onReportingOptOutChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    const value = !event.currentTarget.checked

    this.setState({ optOutOfUsageTracking: value })
    this.props.onOptOutofReportingchanged(value)
  }

  private onUncommittedChangesStrategyKindChanged = (
    value: UncommittedChangesStrategyKind
  ) => {
    this.setState({ uncommittedChangesStrategyKind: value })
    this.props.onUncommittedChangesStrategyKindChanged(value)
  }

  private onRepositoryIndicatorsEnabledChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onRepositoryIndicatorsEnabledChanged(event.currentTarget.checked)
  }

  private reportDesktopUsageLabel() {
    return (
      <span>
        Help GitHub Desktop improve by submitting{' '}
        <LinkButton uri={SamplesURL}>usage stats</LinkButton>
      </span>
    )
  }

  public render() {
    return (
      <DialogContent>
        <div className="advanced-section">
          <h2>If I have changes and I switch branches...</h2>

          <RadioButton
            value={UncommittedChangesStrategyKind.AskForConfirmation}
            checked={
              this.state.uncommittedChangesStrategyKind ===
              UncommittedChangesStrategyKind.AskForConfirmation
            }
            label="Ask me where I want the changes to go"
            onSelected={this.onUncommittedChangesStrategyKindChanged}
          />

          <RadioButton
            value={UncommittedChangesStrategyKind.MoveToNewBranch}
            checked={
              this.state.uncommittedChangesStrategyKind ===
              UncommittedChangesStrategyKind.MoveToNewBranch
            }
            label="Always bring my changes to my new branch"
            onSelected={this.onUncommittedChangesStrategyKindChanged}
          />

          <RadioButton
            value={UncommittedChangesStrategyKind.StashOnCurrentBranch}
            checked={
              this.state.uncommittedChangesStrategyKind ===
              UncommittedChangesStrategyKind.StashOnCurrentBranch
            }
            label="Always stash and leave my changes on the current branch"
            onSelected={this.onUncommittedChangesStrategyKindChanged}
          />
        </div>
        <div className="advanced-section">
          <h2>Background updates</h2>
          <Checkbox
            label="Periodically fetch and refresh status of all repositories"
            value={
              this.props.repositoryIndicatorsEnabled
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onRepositoryIndicatorsEnabledChanged}
          />
          <p className="git-settings-description">
            Allows the display of up-to-date status indicators in the repository
            list. Disabling this may improve performance with many repositories.
          </p>
        </div>
        <div className="advanced-section">
          <h2>Usage</h2>
          <Checkbox
            label={this.reportDesktopUsageLabel()}
            value={
              this.state.optOutOfUsageTracking
                ? CheckboxValue.Off
                : CheckboxValue.On
            }
            onChange={this.onReportingOptOutChanged}
          />
        </div>
      </DialogContent>
    )
  }
}
