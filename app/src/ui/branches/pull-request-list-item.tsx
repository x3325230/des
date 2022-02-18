import * as React from 'react'
import moment from 'moment'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import * as OcticonSymbol from '../octicons/octicons.generated'
import { CIStatus } from './ci-status'
import { HighlightText } from '../lib/highlight-text'
import { IMatches } from '../../lib/fuzzy-find'
import { GitHubRepository } from '../../models/github-repository'
import { Dispatcher } from '../dispatcher'
import { dragAndDropManager } from '../../lib/drag-and-drop-manager'
import { DropTargetType } from '../../models/drag-drop'

export interface IPullRequestListItemProps {
  /** The title. */
  readonly title: string

  /** The number as received from the API. */
  readonly number: number

  /** The date on which the PR was opened. */
  readonly created: Date

  /** The author login. */
  readonly author: string

  /** Whether or not the PR is in draft mode. */
  readonly draft: boolean

  /**
   * Whether or not this list item is a skeleton item
   * put in place while the pull request information is
   * being loaded. This adds a special 'loading' class
   * to the container and prevents any text from rendering
   * inside the list item.
   */
  readonly loading?: boolean

  /** The characters in the PR title to highlight */
  readonly matches: IMatches

  readonly dispatcher: Dispatcher

  /** The GitHub repository to use when looking up commit status. */
  readonly repository: GitHubRepository

  /** When a drag element has landed on a pull request */
  readonly onDropOntoPullRequest: (prNumber: number) => void
}

/** Pull requests as rendered in the Pull Requests list. */
export class PullRequestListItem extends React.Component<
  IPullRequestListItemProps
> {
  private getSubtitle() {
    if (this.props.loading === true) {
      return undefined
    }

    const timeAgo = moment(this.props.created).fromNow()
    const subtitle = `#${this.props.number} opened ${timeAgo} by ${this.props.author}`

    return this.props.draft ? `${subtitle} • Draft` : subtitle
  }

  private onMouseEnter = () => {
    if (dragAndDropManager.isDragInProgress) {
      dragAndDropManager.emitEnterDropTarget({
        type: DropTargetType.Branch,
        branchName: this.props.title,
      })
    }
  }

  private onMouseLeave = () => {
    if (dragAndDropManager.isDragInProgress) {
      dragAndDropManager.emitLeaveDropTarget()
    }
  }

  private onMouseUp = () => {
    if (dragAndDropManager.isDragInProgress) {
      this.props.onDropOntoPullRequest(this.props.number)
    }
  }

  public render() {
    const title = this.props.loading === true ? undefined : this.props.title
    const subtitle = this.getSubtitle()
    const matches = this.props.matches
    const className = classNames('pull-request-item', {
      loading: this.props.loading === true,
      open: !this.props.draft,
      draft: this.props.draft,
    })

    return (
      <div
        className={className}
        onMouseEnter={this.onMouseEnter}
        onMouseLeave={this.onMouseLeave}
        onMouseUp={this.onMouseUp}
      >
        <div>
          <Octicon className="icon" symbol={OcticonSymbol.gitPullRequest} />
        </div>
        <div className="info">
          <div className="title" title={title}>
            <HighlightText text={title || ''} highlight={matches.title} />
          </div>
          <div className="subtitle" title={subtitle}>
            <HighlightText text={subtitle || ''} highlight={matches.subtitle} />
          </div>
        </div>
        {this.renderPullRequestStatus()}
      </div>
    )
  }

  private renderPullRequestStatus() {
    const ref = `refs/pull/${this.props.number}/head`
    return (
      <div className="ci-status-container">
        <CIStatus
          dispatcher={this.props.dispatcher}
          repository={this.props.repository}
          commitRef={ref}
        />
      </div>
    )
  }
}
