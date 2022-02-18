import * as React from 'react'
import {
  getCheckDurationInSeconds,
  IRefCheck,
  IRefCheckOutput,
  RefCheckOutputType,
} from '../../lib/stores/commit-status-store'

import { Octicon } from '../octicons'
import { getClassNameForCheck, getSymbolForCheck } from './ci-status'
import classNames from 'classnames'
import { Button } from '../lib/button'
import { encodePathAsUrl } from '../../lib/path'
import { ActionsLogParser } from '../../lib/actions-log-parser/action-log-parser'
import {
  ILogLineTemplateData,
  IParsedContent,
} from '../../lib/actions-log-parser/actions-log-parser-objects'

// TODO: Get empty graphic for logs?
const BlankSlateImage = encodePathAsUrl(
  __dirname,
  'static/empty-no-pull-requests.svg'
)

interface ICICheckRunListItemProps {
  /** The check run to display **/
  readonly checkRun: IRefCheck

  /** Whether call for actions logs is pending */
  readonly loadingActionLogs: boolean

  /** Whether tcall for actions workflows is pending */
  readonly loadingActionWorkflows: boolean

  /** Whether to show the logs for this check run */
  readonly showLogs: boolean

  /** Callback for when a check run is clicked */
  readonly onCheckRunClick: (checkRun: IRefCheck) => void

  /** Callback to opens check runs on GitHub */
  readonly onViewOnGitHub: (checkRun: IRefCheck) => void
}

/** The CI check list item. */
export class CICheckRunListItem extends React.PureComponent<
  ICICheckRunListItemProps
> {
  private logGroup: ILogLineTemplateData[] = []

  private onCheckRunClick = () => {
    this.props.onCheckRunClick(this.props.checkRun)
  }

  private onViewOnGitHub = () => {
    this.props.onViewOnGitHub(this.props.checkRun)
  }

  private isNoAdditionalInfoToDisplay(output: IRefCheckOutput): boolean {
    return (
      this.isNoOutputText(output) &&
      (output.summary === undefined ||
        output.summary === null ||
        output.summary.trim() === '')
    )
  }

  private isNoOutputText(output: IRefCheckOutput): boolean {
    return (
      output.type === RefCheckOutputType.Default &&
      (output.text === null || output.text.trim() === '')
    )
  }

  private renderActionsLogOutput = (output: IRefCheckOutput) => {
    if (output.type === RefCheckOutputType.Default) {
      return null
    }

    return output.steps.map((step, i) => {
      const header = (
        <div className="ci-check-run-log-step" key={i}>
          <div className="ci-check-status-symbol">
            <Octicon
              className={classNames(
                'ci-status',
                `ci-status-${getClassNameForCheck(step)}`
              )}
              symbol={getSymbolForCheck(step)}
              title={step.name}
            />
          </div>
          <div className="ci-check-run-log-step-name">{step.name}</div>
          <div>{getCheckDurationInSeconds(step)}s</div>
        </div>
      )

      let logs = null
      if (step.log) {
        const logParser = new ActionsLogParser(step.log, '')
        const logLinesTemplateData = logParser.getParsedLogLinesTemplateData()
        logs = logLinesTemplateData.map((ll, i) =>
          this.renderLogLine(ll, i, logLinesTemplateData[i + 1]?.inGroup)
        )
      }

      return (
        <>
          {header}
          {logs}
        </>
      )
    })
  }

  private renderLogLine(
    lineData: ILogLineTemplateData,
    index: number,
    nextLineDataInGroup: boolean
  ): JSX.Element | null {
    if ((lineData.isGroup || lineData.inGroup) && nextLineDataInGroup) {
      this.logGroup.push(lineData)
      return null
    } else if (this.logGroup.length > 0) {
      this.logGroup.push(lineData)
      const logGroupSummary = this.logGroup[0]
      const logGroupBody = this.logGroup.slice(1).map((v, i) => {
        const cn = classNames('line', v.className)
        return (
          <div className={cn} key={i}>
            <span className="line-number">{v.lineNumber}</span>
            {this.renderLogLineContentTemplate(v)}
          </div>
        )
      })
      this.logGroup = []

      const cn = classNames('line', logGroupSummary.className)
      return (
        <div className={cn} key={index}>
          <span className="line-number">{logGroupSummary.lineNumber}</span>
          <details className="log-group" open={logGroupSummary.groupExpanded}>
            <summary>
              {this.renderLogLineContentTemplate(logGroupSummary)}
            </summary>
            {logGroupBody}
          </details>
        </div>
      )
    }

    const cn = classNames('line', lineData.className)
    return (
      <div className={cn} key={index}>
        <span className="line-number">{lineData.lineNumber}</span>
        {this.renderLogLineContentTemplate(lineData)}
      </div>
    )
  }

  private renderLogLineContentTemplate(
    lineData: ILogLineTemplateData
  ): JSX.Element {
    let contentPrefixClassName: string | undefined
    let contentPrefixAdj: string | undefined

    if (lineData.isError) {
      contentPrefixClassName = 'error-text'
      contentPrefixAdj = 'Error'
    } else if (lineData.isWarning) {
      contentPrefixClassName = 'warning-text'
      contentPrefixAdj = 'Warning'
    } else if (lineData.isNotice) {
      contentPrefixClassName = 'notice-text'
      contentPrefixAdj = 'Notice'
    }

    return (
      <span className="line-content">
        {contentPrefixAdj && contentPrefixClassName ? (
          <span className={contentPrefixClassName}>{contentPrefixAdj}: </span>
        ) : null}
        {this.renderLogLineInnerContent(lineData.lineContent)}
      </span>
    )
  }

  private renderLogLineInnerContent(data: IParsedContent[]): JSX.Element[] {
    return data.map((d, i) => {
      const output = d.output.map((v, i) => {
        return (
          <span key={i}>
            {v.entry}
            {v.entryUrl !== undefined ? (
              <a target="_blank" rel="noopener noreferrer" href={v.entryUrl}>
                {v.entryUrl}
              </a>
            ) : null}
            {v.afterUrl}
          </span>
        )
      })

      return (
        <span key={i}>
          <span className={classNames(...d.classes)}>{output}</span>
        </span>
      )
    })
  }

  private renderNonActionsLogOutput = (output: IRefCheckOutput) => {
    if (output.type === RefCheckOutputType.Actions || output.text === null) {
      return null
    }

    // TODO: Html needs santized. Later PR
    return <div dangerouslySetInnerHTML={{ __html: output.text }}></div>
  }

  private renderMetaOutput = (
    output: IRefCheckOutput,
    checkRunName: string
  ) => {
    const { title, summary } = output

    // Don't display something empty or redundant
    const displayTitle =
      title !== null &&
      title.trim() !== '' &&
      title.trim().toLocaleLowerCase() !==
        checkRunName.trim().toLocaleLowerCase()

    const displaySummary =
      summary !== null && summary !== undefined && summary.trim() !== ''

    return (
      <div>
        {displayTitle ? <div>{title}</div> : null}
        {displaySummary ? <pre>{summary}</pre> : null}
      </div>
    )
  }

  private renderEmptyLogOutput = () => {
    return (
      <div className="no-logs-to-display">
        No additional information to display.
      </div>
    )
  }

  private renderLoadingLogs = () => {
    return (
      <div className="loading-logs">
        <img src={BlankSlateImage} className="blankslate-image" />
        <div className="title">Hang tight</div>
        <div className="loading-blurb">Loading the logs as fast as I can!</div>
      </div>
    )
  }

  private renderViewOnGitHub = () => {
    return (
      <div className="view-on-github">
        <Button onClick={this.onViewOnGitHub}>View on GitHub</Button>
      </div>
    )
  }

  private hasActionsWorkflowLogs() {
    return this.props.checkRun.actionsWorkflowRunId !== undefined
  }

  private renderLogs = () => {
    const {
      loadingActionLogs,
      loadingActionWorkflows,
      checkRun: { output, name },
    } = this.props

    if (
      loadingActionWorkflows ||
      (this.hasActionsWorkflowLogs() && loadingActionLogs)
    ) {
      return this.renderLoadingLogs()
    }

    return (
      <div className="ci-check-list-item-logs">
        <div className="ci-check-list-item-logs-output">
          {this.isNoAdditionalInfoToDisplay(output)
            ? this.renderEmptyLogOutput()
            : null}
          {this.renderMetaOutput(output, name)}
          {this.renderActionsLogOutput(output)}
          {this.renderNonActionsLogOutput(output)}
        </div>
        {this.renderViewOnGitHub()}
      </div>
    )
  }

  public render() {
    const { checkRun, showLogs } = this.props

    return (
      <>
        <div
          className="ci-check-list-item list-item"
          onClick={this.onCheckRunClick}
        >
          <div className="ci-check-status-symbol">
            <Octicon
              className={classNames(
                'ci-status',
                `ci-status-${getClassNameForCheck(checkRun)}`
              )}
              symbol={getSymbolForCheck(checkRun)}
              title={checkRun.description}
            />
          </div>

          <div className="ci-check-list-item-detail">
            <div className="ci-check-name">{checkRun.name}</div>
            <div className="ci-check-description" title={checkRun.description}>
              {checkRun.description}
            </div>
          </div>
        </div>
        {showLogs ? this.renderLogs() : null}
      </>
    )
  }
}
