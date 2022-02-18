import * as React from 'react'

import {
  syntaxHighlightLine,
  DiffRow,
  DiffRowType,
  IDiffRowData,
} from './diff-helpers'
import { ILineTokens } from '../../lib/highlighter/types'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import { narrowNoNewlineSymbol } from './text-diff'
import { shallowEquals, structuralEquals } from '../../lib/equality'

interface ISideBySideDiffRowProps {
  /**
   * The row data. This contains most of the information used to render the row.
   */
  readonly row: DiffRow

  /**
   * Whether the diff is selectable or read-only.
   */
  readonly isDiffSelectable: boolean

  /**
   * Whether the row belongs to a hunk that is hovered.
   */
  readonly isHunkHovered: boolean

  /**
   * Whether to display the rows side by side.
   */
  readonly showSideBySideDiff: boolean

  /**
   * Called when a line selection is started. Called with the
   * diff line number and a flag to indicate if the user is
   * selecting or unselecting lines.
   * (only relevant when isDiffSelectable is true)
   */
  readonly onStartSelection: (diffLineNumber: number, select: boolean) => void

  /**
   * Called when a line selection is updated. Called with the
   * currently hovered diff line number.
   * (only relevant when isDiffSelectable is true)
   */
  readonly onUpdateSelection: (diffLineNumber: number) => void

  /**
   * Called when the user hovers the hunk handle. Called with the start
   * line of the hunk.
   * (only relevant when isDiffSelectable is true)
   */
  readonly onMouseEnterHunk: (hunkStartLine: number) => void

  /**
   * Called when the user unhovers the hunk handle. Called with the start
   * line of the hunk.
   * (only relevant when isDiffSelectable is true)
   */
  readonly onMouseLeaveHunk: (hunkStartLine: number) => void

  /**
   * Called when the user clicks on the hunk handle. Called with the start
   * line of the hunk and a flag indicating whether to select or unselect
   * the hunk.
   * (only relevant when isDiffSelectable is true)
   */
  readonly onClickHunk: (hunkStartLine: number, select: boolean) => void

  /**
   * Called when the user right-clicks a line number. Called with the
   * clicked diff line number.
   * (only relevant when isDiffSelectable is true)
   */
  readonly onContextMenuLine: (diffLineNumber: number) => void

  /**
   * Called when the user right-clicks a hunk handle. Called with the start
   * line of the hunk.
   * (only relevant when isDiffSelectable is true)
   */
  readonly onContextMenuHunk: (hunkStartLine: number) => void

  /**
   * Called when the user right-clicks text on the diff.
   */
  readonly onContextMenuText: () => void
}

export class SideBySideDiffRow extends React.Component<
  ISideBySideDiffRowProps
> {
  public render() {
    const row = this.props.row

    switch (row.type) {
      case DiffRowType.Hunk:
        return (
          <div className="row hunk-info">
            {this.renderLineNumber()}
            {this.renderContentFromString(row.content)}
          </div>
        )
      case DiffRowType.Context:
        if (!this.props.showSideBySideDiff) {
          return (
            <div className="row context">
              <div className="before">
                {this.renderLineNumbers([
                  row.beforeLineNumber,
                  row.afterLineNumber,
                ])}
                {this.renderContentFromString(row.content, row.tokens)}
              </div>
            </div>
          )
        }

        return (
          <div className="row context">
            <div className="before">
              {this.renderLineNumber(row.beforeLineNumber)}
              {this.renderContentFromString(row.content, row.tokens)}
            </div>
            <div className="after">
              {this.renderLineNumber(row.afterLineNumber)}
              {this.renderContentFromString(row.content, row.tokens)}
            </div>
          </div>
        )

      case DiffRowType.Added: {
        if (!this.props.showSideBySideDiff) {
          return (
            <div
              className="row added"
              onMouseEnter={this.onMouseEnterLineNumber}
            >
              <div className="after">
                {this.renderLineNumbers(
                  [undefined, row.data.lineNumber],
                  row.data.isSelected
                )}

                {this.renderHunkHandle()}
                {this.renderContent(row.data)}
              </div>
            </div>
          )
        }

        return (
          <div className="row added" onMouseEnter={this.onMouseEnterLineNumber}>
            <div className="before">
              {this.renderLineNumber()}
              {this.renderContentFromString('')}
            </div>
            {this.renderHunkHandle()}
            <div className="after">
              {this.renderLineNumber(row.data.lineNumber, row.data.isSelected)}
              {this.renderContent(row.data)}
            </div>
          </div>
        )
      }
      case DiffRowType.Deleted: {
        if (!this.props.showSideBySideDiff) {
          return (
            <div
              className="row deleted"
              onMouseEnter={this.onMouseEnterLineNumber}
            >
              <div className="before">
                {this.renderLineNumbers(
                  [row.data.lineNumber, undefined],
                  row.data.isSelected
                )}
                {this.renderHunkHandle()}
                {this.renderContent(row.data)}
              </div>
            </div>
          )
        }

        return (
          <div
            className="row deleted"
            onMouseEnter={this.onMouseEnterLineNumber}
          >
            <div className="before">
              {this.renderLineNumber(row.data.lineNumber, row.data.isSelected)}
              {this.renderContent(row.data)}
            </div>
            {this.renderHunkHandle()}
            <div className="after">
              {this.renderLineNumber()}
              {this.renderContentFromString('')}
            </div>
          </div>
        )
      }
      case DiffRowType.Modified: {
        return (
          <div className="row modified">
            <div className="before" onMouseEnter={this.onMouseEnterLineNumber}>
              {this.renderLineNumber(
                row.beforeData.lineNumber,
                row.beforeData.isSelected
              )}
              {this.renderContent(row.beforeData)}
            </div>
            {this.renderHunkHandle()}
            <div className="after" onMouseEnter={this.onMouseEnterLineNumber}>
              {this.renderLineNumber(
                row.afterData.lineNumber,
                row.afterData.isSelected
              )}
              {this.renderContent(row.afterData)}
            </div>
          </div>
        )
      }
    }
  }

  public shouldComponentUpdate(nextProps: ISideBySideDiffRowProps) {
    const { row: prevRow, ...restPrevProps } = this.props
    const { row: nextRow, ...restNextProps } = nextProps

    if (!structuralEquals(prevRow, nextRow)) {
      return true
    }

    return !shallowEquals(restPrevProps, restNextProps)
  }

  private renderContentFromString(
    line: string,
    tokensArray: ReadonlyArray<ILineTokens> = []
  ) {
    return this.renderContent({
      content: line,
      noNewLineIndicator: false,
      tokens: tokensArray,
    })
  }

  private renderContent(
    data: Pick<IDiffRowData, 'content' | 'noNewLineIndicator' | 'tokens'>
  ) {
    return (
      <div className="content" onContextMenu={this.props.onContextMenuText}>
        {syntaxHighlightLine(data.content, data.tokens)}
        {data.noNewLineIndicator && (
          <Octicon
            symbol={narrowNoNewlineSymbol}
            title="No newline at end of file"
          />
        )}
      </div>
    )
  }

  private renderHunkHandle() {
    if (!this.props.isDiffSelectable) {
      return null
    }

    return (
      <div
        className="hunk-handle"
        onMouseEnter={this.onMouseEnterHunk}
        onMouseLeave={this.onMouseLeaveHunk}
        onClick={this.onClickHunk}
        onContextMenu={this.onContextMenuHunk}
      ></div>
    )
  }

  /**
   * Renders the line number box.
   *
   * @param lineNumbers Array with line numbers to display.
   * @param isSelected  Whether the line has been selected.
   *                    If undefined is passed, the line is treated
   *                    as non-selectable.
   */
  private renderLineNumbers(
    lineNumbers: Array<number | undefined>,
    isSelected?: boolean
  ) {
    if (!this.props.isDiffSelectable || isSelected === undefined) {
      return (
        <div className="line-number">
          {lineNumbers.map((lineNumber, index) => (
            <span key={index}>{lineNumber}</span>
          ))}
        </div>
      )
    }

    return (
      <div
        className={classNames([
          'line-number',
          'selectable',
          {
            'line-selected': isSelected,
            hover: this.props.isHunkHovered,
          },
        ])}
        onMouseDown={this.onMouseDownLineNumber}
        onContextMenu={this.onContextMenuLineNumber}
      >
        {lineNumbers.map((lineNumber, index) => (
          <span key={index}>{lineNumber}</span>
        ))}
      </div>
    )
  }

  /**
   * Renders the line number box.
   *
   * @param lineNumber  Line number to display.
   * @param isSelected  Whether the line has been selected.
   *                    If undefined is passed, the line is treated
   *                    as non-selectable.
   */
  private renderLineNumber(lineNumber?: number, isSelected?: boolean) {
    return this.renderLineNumbers([lineNumber], isSelected)
  }

  /**
   * Returns the data object for the current row if the current row is
   * added, deleted or modified, null otherwise.
   *
   * On modified rows it normally returns the data corresponding to the
   * previous state. In this situation an optional targetElement param can
   * be passed which will be used to infer either the previous or the next
   * state data (based on which column the target element belongs).
   *
   * @param targetElement Optional element to pass to infer which data to use
   *                      on modified rows.
   */
  private getDiffData(targetElement?: Element): IDiffRowData | null {
    const row = this.props.row

    if (row.type === DiffRowType.Added || row.type === DiffRowType.Deleted) {
      return row.data
    }

    if (row.type !== DiffRowType.Modified) {
      return null
    }

    return targetElement?.closest('.after') ? row.afterData : row.beforeData
  }

  private onMouseDownLineNumber = (evt: React.MouseEvent) => {
    if (evt.buttons === 2) {
      return
    }

    const data = this.getDiffData(evt.currentTarget)
    if (data === null) {
      return
    }

    this.props.onStartSelection(data.diffLineNumber, !data.isSelected)
  }

  private onMouseEnterLineNumber = (evt: React.MouseEvent) => {
    const data = this.getDiffData(evt.currentTarget)
    if (data === null) {
      return
    }

    this.props.onUpdateSelection(data.diffLineNumber)
  }

  private onMouseEnterHunk = () => {
    if ('hunkStartLine' in this.props.row) {
      this.props.onMouseEnterHunk(this.props.row.hunkStartLine)
    }
  }

  private onMouseLeaveHunk = () => {
    if ('hunkStartLine' in this.props.row) {
      this.props.onMouseLeaveHunk(this.props.row.hunkStartLine)
    }
  }

  private onClickHunk = () => {
    // Since the hunk handler lies between the previous and the next columns,
    // when clicking on it on modified lines we cannot know if we should
    // use the state of the previous or the next line to know whether we should
    // select or unselect the hunk.
    // To workaround this, we're relying on the logic of `getDiffData()` to have
    // a consistent behaviour (which will use the previous column state in this case).
    const data = this.getDiffData()
    if (data === null) {
      return
    }

    if ('hunkStartLine' in this.props.row) {
      this.props.onClickHunk(this.props.row.hunkStartLine, !data.isSelected)
    }
  }

  private onContextMenuLineNumber = (evt: React.MouseEvent) => {
    const data = this.getDiffData(evt.currentTarget)
    if (data === null) {
      return
    }

    this.props.onContextMenuLine(data.diffLineNumber)
  }

  private onContextMenuHunk = () => {
    if ('hunkStartLine' in this.props.row) {
      this.props.onContextMenuHunk(this.props.row.hunkStartLine)
    }
  }
}
