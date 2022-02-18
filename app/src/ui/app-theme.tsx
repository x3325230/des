import * as React from 'react'
import {
  ApplicationTheme,
  getThemeName,
  getCurrentlyAppliedTheme,
  ICustomTheme,
} from './lib/application-theme'

interface IAppThemeProps {
  readonly theme: ApplicationTheme
  readonly useCustomTheme: boolean
  readonly customTheme?: ICustomTheme
}

/**
 * A pseudo-component responsible for adding the applicable CSS
 * class names to the body tag in order to apply the currently
 * selected theme.
 *
 * This component is a PureComponent, meaning that it'll only
 * render when its props changes (shallow comparison).
 *
 * This component does not render anything into the DOM, it's
 * purely (a)busing the component lifecycle to manipulate the
 * body class list.
 */
export class AppTheme extends React.PureComponent<IAppThemeProps> {
  public componentDidMount() {
    this.ensureTheme()
  }

  public componentDidUpdate() {
    this.ensureTheme()
  }

  public componentWillUnmount() {
    this.clearThemes()
  }

  private ensureTheme() {
    let themeToDisplay = this.props.theme

    if (this.props.theme === ApplicationTheme.System) {
      themeToDisplay = getCurrentlyAppliedTheme()
    }

    const newThemeClassName = `theme-${getThemeName(themeToDisplay)}`
    const body = document.body

    if (!body.classList.contains(newThemeClassName)) {
      this.clearThemes()
      body.classList.add(newThemeClassName)
    }

    this.setCustomTheme()
  }

  private setCustomTheme() {
    const { customTheme, useCustomTheme } = this.props
    if (customTheme === undefined || !useCustomTheme) {
      return
    }

    const body = document.body
    if (!body.classList.contains('theme-custom')) {
      body.classList.add('theme-custom')
    }

    const styles = document.createElement('style')
    styles.setAttribute('type', 'text/css')

    const {
      background,
      text,
      toolbarBackground,
      hoverItem,
      activeItem,
      activeText,
    } = customTheme

    styles.appendChild(
      document.createTextNode(
        `body.theme-custom {
            --background-color: ${background};
            --box-background-color: ${background};
            --box-alt-background-color: ${hoverItem};
            --box-border-color: ${hoverItem};
            --box-selected-background-color: ${background};
            --button-background: ${activeItem};
            --button-text-color: ${activeText};
            --secondary-button-background: ${background};
            --secondary-button-text-color: ${text};
            --text-color: ${text};
            --toolbar-background-color: ${toolbarBackground};
          }`
      )
      /*
      --diff-hunk-background-color: ${boxBackgroundColor};
            --diff-hunk-border-color: ${boxAltBackgroundColor};
            --diff-hunk-gutter-background-color: ${boxBackgroundColor};
            --diff-empty-row-background-color: ${boxBackgroundColor};
            --diff-gutter-color: ${backgroundColor};
            --diff-text-color: ${textColor};
            --diff-gutter-background-color: ${boxAltBackgroundColor};
            --diff-border-color: ${boxAltBackgroundColor};
            */
    )
    body.appendChild(styles)
  }

  private clearThemes() {
    const body = document.body

    for (const className of body.classList) {
      if (className.startsWith('theme-')) {
        body.classList.remove(className)
      }
    }
  }

  public render() {
    return null
  }
}
