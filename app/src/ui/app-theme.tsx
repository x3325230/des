import * as React from 'react'
import {
  ApplicationTheme,
  getThemeName,
  getCurrentlyAppliedTheme,
  ICustomTheme,
} from './lib/application-theme'

interface IAppThemeProps {
  readonly theme: ApplicationTheme
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

    if (body.classList.contains(newThemeClassName)) {
      // return
    }

    this.clearThemes()

    body.classList.add(newThemeClassName)
    body.classList.add('theme-custom')
    this.setCustomTheme()
  }

  private setCustomTheme() {
    const { customTheme } = this.props
    if (customTheme === undefined) {
      return
    }

    const body = document.body
    const styles = document.createElement('style')
    styles.setAttribute('type', 'text/css')

    const {
      backgroundColor,
      // boxBackgroundColor,
      // boxAltBackgroundColor,
      boxBorderColor,
      boxSelectedBackgroundColor,
      buttonBackground,
      buttonTextColor,
      secondaryButtonBackground,
      secondaryButtonTextColor,
      textColor,
      toolbarBackgroundColor,
    } = customTheme // this.props.customTheme

    styles.appendChild(
      document.createTextNode(
        `body.theme-custom {
            --background-color: ${backgroundColor};
            --box-background-color: ${backgroundColor};
            --box-alt-background-color: ${backgroundColor};
            --box-border-color: ${boxBorderColor};
            --box-selected-background-color: ${boxSelectedBackgroundColor};
            --button-background: ${buttonBackground};
            --button-text-color: ${buttonTextColor};
            --secondary-button-background: ${secondaryButtonBackground};
            --secondary-button-text-color: ${secondaryButtonTextColor};
            --text-color: ${textColor};
            --toolbar-background-color: ${toolbarBackgroundColor};
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
