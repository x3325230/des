import * as React from 'react'
import {
  ApplicationTheme,
  getThemeName,
  ICustomTheme,
} from '../lib/application-theme'
import { SketchPicker } from 'react-color'

// The variable references are to ~primer-support/lib/variables/color-system.scss
// Below is a js duplication of variables in _dark.scss and variable.scss
const primer = {
  gray900: '#24292e',
  gray800: '#2f363d',
  gray700: '#444d56',
  gray300: '#d1d5da',
  gray200: '#e1e4e8',
  gray100: '#f6f8fa',
  gray000: '#fafbfc',
  white: '#fff',
  blue: '#0366d6',
}

const defaultThemes = {
  dark: {
    backgroundColor: primer.gray900,
    // boxBackgroundColor: '#3b3b3b', // #{darken($gray-900, 3%)};
    // boxAltBackgroundColor: primer.gray800,
    boxBorderColor: '#141414', // not in primer
    boxSelectedBackgroundColor: primer.gray700,
    buttonBackground: primer.blue,
    buttonTextColor: primer.white,
    secondaryButtonBackground: primer.gray800,
    secondaryButtonTextColor: primer.gray300,
    textColor: primer.gray300,
    toolbarBackgroundColor: '#1c2125', //#{darken($gray-900, 3%)};
  },
  light: {
    backgroundColor: primer.white,
    // boxBackgroundColor: primer.white,
    // boxAltBackgroundColor: primer.gray100,
    boxBorderColor: primer.gray200,
    boxSelectedBackgroundColor: '#ebeef1', // not in primer
    buttonBackground: primer.blue,
    buttonTextColor: primer.white,
    secondaryButtonBackground: primer.gray000,
    secondaryButtonTextColor: primer.gray900,
    textColor: primer.gray900,
    toolbarBackgroundColor: primer.gray900,
  },
}

interface ICustomThemeSelectorProps {
  readonly selectedTheme: ApplicationTheme
  readonly customTheme?: ICustomTheme
  readonly onCustomThemeChanged: (customTheme: ICustomTheme) => void
}

interface ICustomThemeSelectorState {
  readonly customTheme: ICustomTheme
  readonly selectedThemeOptionColor: keyof ICustomTheme
  readonly isPopoverOpen: boolean
}

export class CustomThemeSelector extends React.Component<
  ICustomThemeSelectorProps,
  ICustomThemeSelectorState
> {
  public constructor(props: ICustomThemeSelectorProps) {
    super(props)

    let { customTheme } = this.props
    if (customTheme === undefined) {
      const theme = getThemeName(this.props.selectedTheme)
      if (theme === 'system') {
        return
      }
      customTheme = defaultThemes[theme]
    }

    this.state = {
      customTheme: customTheme,
      isPopoverOpen: false,
      selectedThemeOptionColor: 'backgroundColor',
    }
  }

  private onThemeChange = (color: { hex: string }) => {
    this.closePopover()
    this.setState({
      customTheme: {
        ...this.state.customTheme,
        [this.state.selectedThemeOptionColor]: color.hex,
      },
    })
    this.props.onCustomThemeChanged(this.state.customTheme)
  }

  private openPopover = () => {
    this.setState(prevState => {
      if (prevState.isPopoverOpen === false) {
        return { isPopoverOpen: true }
      }
      return null
    })
  }

  private closePopover = () => {
    this.setState(prevState => {
      if (prevState.isPopoverOpen) {
        return { isPopoverOpen: false }
      }
      return null
    })
  }

  private onSwatchClick = (selectedThemeOptionColor: keyof ICustomTheme) => {
    return () => {
      this.setState({ selectedThemeOptionColor })
      this.openPopover()
    }
  }

  private renderPopover() {
    if (!this.state.isPopoverOpen) {
      return
    }

    return (
      <div className="color-picker-container">
        <SketchPicker
          color={this.state.customTheme[this.state.selectedThemeOptionColor]}
          onChangeComplete={this.onThemeChange}
        ></SketchPicker>
      </div>
    )
  }

  private renderThemeOptions() {
    const themePropTitleMap = new Map([
      ['textColor', 'Text'],
      ['backgroundColor', 'Background'],
      ['boxBackgroundColor', 'Box Background'],
      ['boxBorderColor', 'Box Border'],
      ['boxSelectedBackgroundColor', 'Box Selected Background'],
      ['boxAltBackgroundColor', 'Box Alt Background'],
      ['toolbarBackgroundColor', 'Toolbar Background'],
      ['buttonBackground', 'Button Background'],
      ['buttonTextColor', 'Button Text'],
      ['secondaryButtonBackground', 'Button Secondary Background'],
      ['secondaryButtonTextColor', 'Button Secondary Text'],
    ])

    return Object.entries(this.state.customTheme).map(([key, value], i) => {
      const keyTyped = key as keyof ICustomTheme
      return (
        <div key={i}>
          <span
            className="theme-option-swatch"
            onClick={this.onSwatchClick(keyTyped)}
            style={{
              backgroundColor: value,
            }}
          ></span>
          {' -  '}
          {themePropTitleMap.get(key)}
        </div>
      )
    })
  }

  public render() {
    return (
      <>
        <div>{this.renderThemeOptions()}</div>
        {this.renderPopover()}
      </>
    )
  }
}
