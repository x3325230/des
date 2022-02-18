import * as React from 'react'
import { Commit } from '../../models/commit'
import { GitHubRepository } from '../../models/github-repository'
import { IAvatarUser, getAvatarUsersForCommit } from '../../models/avatar'
import { RichText } from '../lib/rich-text'
import { RelativeTime } from '../relative-time'
import { getDotComAPIEndpoint } from '../../lib/api'
import { clipboard } from 'electron'
import { showContextualMenu } from '../main-process-proxy'
import { CommitAttribution } from '../lib/commit-attribution'
import { AvatarStack } from '../lib/avatar-stack'
import { IMenuItem } from '../../lib/menu-item'
import { Octicon, OcticonSymbol } from '../octicons'
import {
  enableGitTagsDisplay,
  enableGitTagsCreation,
} from '../../lib/feature-flag'

interface ICommitProps {
  readonly gitHubRepository: GitHubRepository | null
  readonly commit: Commit
  readonly emoji: Map<string, string>
  readonly isLocal: boolean
  readonly onRevertCommit?: (commit: Commit) => void
  readonly onViewCommitOnGitHub?: (sha: string) => void
  readonly onCreateTag?: (targetCommitSha: string) => void
  readonly onDeleteTag?: (tagName: string) => void
  readonly showUnpushedIndicator: boolean
  readonly unpushedIndicatorTitle?: string
  readonly unpushedTags?: ReadonlyArray<string>
}

interface ICommitListItemState {
  readonly avatarUsers: ReadonlyArray<IAvatarUser>
}

/** A component which displays a single commit in a commit list. */
export class CommitListItem extends React.PureComponent<
  ICommitProps,
  ICommitListItemState
> {
  public constructor(props: ICommitProps) {
    super(props)

    this.state = {
      avatarUsers: getAvatarUsersForCommit(
        props.gitHubRepository,
        props.commit
      ),
    }
  }

  public componentWillReceiveProps(nextProps: ICommitProps) {
    if (nextProps.commit !== this.props.commit) {
      this.setState({
        avatarUsers: getAvatarUsersForCommit(
          nextProps.gitHubRepository,
          nextProps.commit
        ),
      })
    }
  }

  public render() {
    const commit = this.props.commit
    const {
      author: { date },
    } = commit

    return (
      <div className="commit" onContextMenu={this.onContextMenu}>
        <div className="info">
          <RichText
            className="summary"
            emoji={this.props.emoji}
            text={commit.summary}
            renderUrlsAsLinks={false}
          />
          <div className="description">
            <AvatarStack users={this.state.avatarUsers} />
            <div className="byline">
              <CommitAttribution
                gitHubRepository={this.props.gitHubRepository}
                commit={commit}
              />
              {renderRelativeTime(date)}
            </div>
          </div>
        </div>
        {this.renderCommitIndicators()}
      </div>
    )
  }

  private renderCommitIndicators() {
    const tagIndicator = enableGitTagsDisplay()
      ? renderCommitListItemTags(this.props.commit.tags)
      : null

    const unpushedIndicator = this.renderUnpushedIndicator()

    if (tagIndicator || unpushedIndicator) {
      return (
        <div className="commit-indicators">
          {tagIndicator}
          {unpushedIndicator}
        </div>
      )
    }

    return null
  }

  private renderUnpushedIndicator() {
    if (!this.props.showUnpushedIndicator) {
      return null
    }

    return (
      <div
        className="unpushed-indicator"
        title={this.props.unpushedIndicatorTitle}
      >
        <Octicon symbol={OcticonSymbol.arrowUp} />
      </div>
    )
  }

  private onCopySHA = () => {
    clipboard.writeText(this.props.commit.sha)
  }

  private onViewOnGitHub = () => {
    if (this.props.onViewCommitOnGitHub) {
      this.props.onViewCommitOnGitHub(this.props.commit.sha)
    }
  }

  private onCreateTag = () => {
    if (this.props.onCreateTag) {
      this.props.onCreateTag(this.props.commit.sha)
    }
  }

  private onContextMenu = (event: React.MouseEvent<any>) => {
    event.preventDefault()

    let viewOnGitHubLabel = 'View on GitHub'
    const gitHubRepository = this.props.gitHubRepository

    if (
      gitHubRepository &&
      gitHubRepository.endpoint !== getDotComAPIEndpoint()
    ) {
      viewOnGitHubLabel = 'View on GitHub Enterprise'
    }

    const items: IMenuItem[] = [
      {
        label: __DARWIN__
          ? 'Revert Changes in Commit'
          : 'Revert changes in commit',
        action: () => {
          if (this.props.onRevertCommit) {
            this.props.onRevertCommit(this.props.commit)
          }
        },
        enabled: this.props.onRevertCommit !== undefined,
      },
    ]

    if (enableGitTagsCreation()) {
      items.push({
        label: 'Create Tag…',
        action: this.onCreateTag,
        enabled: this.props.onCreateTag !== undefined,
      })

      const deleteTagsMenuItem = this.getDeleteTagsMenuItem()

      if (deleteTagsMenuItem !== null) {
        items.push(
          {
            type: 'separator',
          },
          deleteTagsMenuItem
        )
      }
    }

    items.push(
      { type: 'separator' },
      {
        label: 'Copy SHA',
        action: this.onCopySHA,
      },
      {
        label: viewOnGitHubLabel,
        action: this.onViewOnGitHub,
        enabled: !this.props.isLocal && !!gitHubRepository,
      }
    )

    showContextualMenu(items)
  }

  private getDeleteTagsMenuItem(): IMenuItem | null {
    const { unpushedTags, onDeleteTag, commit } = this.props

    if (
      onDeleteTag === undefined ||
      unpushedTags === undefined ||
      commit.tags.length === 0
    ) {
      return null
    }

    if (commit.tags.length === 1) {
      const tagName = commit.tags[0]

      return {
        label: `Delete tag ${tagName}`,
        action: () => onDeleteTag(tagName),
        enabled: unpushedTags.includes(tagName),
      }
    }

    // Convert tags to a Set to avoid O(n^2)
    const unpushedTagsSet = new Set(unpushedTags)

    return {
      label: 'Delete tag…',
      submenu: commit.tags.map(tagName => {
        return {
          label: tagName,
          action: () => onDeleteTag(tagName),
          enabled: unpushedTagsSet.has(tagName),
        }
      }),
    }
  }
}

function renderRelativeTime(date: Date) {
  return (
    <>
      {` • `}
      <RelativeTime date={date} abbreviate={true} />
    </>
  )
}

function renderCommitListItemTags(tags: ReadonlyArray<string>) {
  if (tags.length === 0) {
    return null
  }
  const [firstTag] = tags
  return (
    <span className="tag-indicator">
      <span className="tag-name" key={firstTag}>
        {firstTag}
      </span>
      {tags.length > 1 && (
        <span key={tags.length} className="tag-indicator-more" />
      )}
    </span>
  )
}
