import { clipboard } from 'electron'
import * as React from 'react'
import moment from 'moment'

import { IMatches } from '../../lib/fuzzy-find'

import { Octicon, OcticonSymbol } from '../octicons'
import { HighlightText } from '../lib/highlight-text'
import { showContextualMenu } from '../main-process-proxy'
import { IMenuItem } from '../../lib/menu-item'
import { String } from 'aws-sdk/clients/apigateway'
import { dragAndDropManager } from '../../lib/drag-and-drop-manager'
import { DragType, DropTargetType } from '../../models/drag-drop'

interface IBranchListItemProps {
  /** The name of the branch */
  readonly name: string

  /** Specifies whether this item is currently selected */
  readonly isCurrentBranch: boolean

  /** The date may be null if we haven't loaded the tip commit yet. */
  readonly lastCommitDate: Date | null

  /** The characters in the branch name to highlight */
  readonly matches: IMatches

  /** Specifies whether the branch is local */
  readonly isLocal: boolean

  readonly onRenameBranch?: (branchName: string) => void

  readonly onDeleteBranch?: (branchName: string) => void

  /** When a drag element has landed on a branch that is not current */
  readonly onDropOntoBranch?: (branchName: String) => void

  /** When a drag element has landed on the current branch */
  readonly onDropOntoCurrentBranch?: () => void
}

/** The branch component. */
export class BranchListItem extends React.Component<IBranchListItemProps, {}> {
  private onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()

    /*
      There are multiple instances in the application where a branch list item
      is rendered. We only want to be able to rename or delete them on the
      branch dropdown menu. Thus, other places simply will not provide these
      methods, such as the merge and rebase logic.
    */
    const { onRenameBranch, onDeleteBranch, name, isLocal } = this.props
    if (onRenameBranch === undefined && onDeleteBranch === undefined) {
      return
    }

    const items: Array<IMenuItem> = []

    if (onRenameBranch !== undefined) {
      items.push({
        label: 'Rename…',
        action: () => onRenameBranch(name),
        enabled: isLocal,
      })
    }

    items.push({
      label: __DARWIN__ ? 'Copy Branch Name' : 'Copy branch name',
      action: () => clipboard.writeText(name),
    })

    items.push({ type: 'separator' })

    if (onDeleteBranch !== undefined) {
      items.push({
        label: 'Delete…',
        action: () => onDeleteBranch(name),
      })
    }

    showContextualMenu(items)
  }

  private onMouseEnter = () => {
    if (dragAndDropManager.isDragOfTypeInProgress(DragType.Commit)) {
      dragAndDropManager.emitEnterDropTarget({
        type: DropTargetType.Branch,
        branchName: this.props.name,
      })
    }
  }

  private onMouseLeave = () => {
    if (dragAndDropManager.isDragOfTypeInProgress(DragType.Commit)) {
      dragAndDropManager.emitLeaveDropTarget()
    }
  }

  private onMouseUp = () => {
    const {
      onDropOntoBranch,
      onDropOntoCurrentBranch,
      name,
      isCurrentBranch,
    } = this.props

    if (!dragAndDropManager.isDragOfTypeInProgress(DragType.Commit)) {
      return
    }

    if (onDropOntoBranch !== undefined && !isCurrentBranch) {
      onDropOntoBranch(name)
    }

    if (onDropOntoCurrentBranch !== undefined && isCurrentBranch) {
      onDropOntoCurrentBranch()
    }
  }

  public render() {
    const lastCommitDate = this.props.lastCommitDate
    const isCurrentBranch = this.props.isCurrentBranch
    const name = this.props.name

    const date = lastCommitDate ? moment(lastCommitDate).fromNow() : ''
    const icon = isCurrentBranch ? OcticonSymbol.check : OcticonSymbol.gitBranch
    const infoTitle = isCurrentBranch
      ? 'Current branch'
      : lastCommitDate
      ? lastCommitDate.toString()
      : ''

    return (
      <div
        onContextMenu={this.onContextMenu}
        className="branches-list-item"
        onMouseEnter={this.onMouseEnter}
        onMouseLeave={this.onMouseLeave}
        onMouseUp={this.onMouseUp}
      >
        <Octicon className="icon" symbol={icon} />
        <div className="name" title={name}>
          <HighlightText text={name} highlight={this.props.matches.title} />
        </div>
        <div className="description" title={infoTitle}>
          {date}
        </div>
      </div>
    )
  }
}
