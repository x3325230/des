import * as React from 'react'
import { OcticonSymbolType } from './octicons.generated'
import classNames from 'classnames'
import { createUniqueId, releaseUniqueId } from '../lib/id-pool'
import ReactDOM from 'react-dom'

interface IOcticonProps {
  /**
   * An instance of an object conforming to the OcticonSymbol
   * type. Supports custom paths as well as those provided
   * through the static properties of the OcticonSymbol class.
   */
  readonly symbol: OcticonSymbolType

  /**
   * An optional classname that will be appended to the default
   * class name 'octicon'
   */
  readonly className?: string

  /**
   * An optional string to use as a tooltip for the icon
   */
  readonly title?: string
}

/**
 * A React component for displaying octicon symbols in SVG format.
 *
 * Note that the aspect ratios of the octicons will always be preserved
 * which is why the width and height properties specify the maximum and
 * not the minimum size.
 *
 * Usage: `<Octicon symbol={OcticonSymbol.mark_github} />`
 */
export class Octicon extends React.Component<IOcticonProps, {}> {
  private titleId: string | null = null

  public componentWillUnmount() {
    if (this.titleId !== null) {
      releaseUniqueId(this.titleId)
    }
  }

  public render() {
    const { symbol, title } = this.props
    const viewBox = `0 0 ${symbol.w} ${symbol.h}`
    const className = classNames('octicon', this.props.className)

    let labelledBy: string | undefined = undefined
    let titleElem: JSX.Element | null = null

    if (title && title.length > 0) {
      if (this.titleId === null) {
        this.titleId = createUniqueId('Octicon_Title')
      }
      labelledBy = this.titleId
      titleElem = <title id={this.titleId}>{title}</title>
    }

    // Hide the octicon from screen readers when it's only being used
    // as a visual without any attached meaning applicable to users
    // consuming the app through an accessibility interface.
    const ariaHidden = labelledBy === undefined ? 'true' : undefined

    return (
      <svg
        aria-labelledby={labelledBy}
        aria-hidden={ariaHidden}
        className={className}
        version="1.1"
        viewBox={viewBox}
      >
        {titleElem}
        <path fillRule={symbol.fr} d={symbol.d} />
      </svg>
    )
  }
}

/**
 * Create an Octicon element for the DOM, wrapped in a div element.
 *
 * @param symbol    OcticonSymbol to render in the element.
 * @param className Optional class to add to the wrapper element.
 * @param id        Optional identifier to set to the wrapper element.
 */
export function createOcticonElement(
  symbol: OcticonSymbolType,
  className?: string,
  id?: string
) {
  const wrapper = document.createElement('div')
  wrapper.id = id ?? ''
  if (className !== undefined) {
    wrapper.classList.add(className)
  }
  const octicon = <Octicon symbol={symbol} />
  ReactDOM.render(octicon, wrapper)
  return wrapper
}
