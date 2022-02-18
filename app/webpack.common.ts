import * as path from 'path'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import CleanWebpackPlugin from 'clean-webpack-plugin'
import webpack from 'webpack'
import merge from 'webpack-merge'
import { getChannel } from '../script/dist-info'
import { getReplacements } from './app-info'

const channel = getChannel()

export const externals = ['7zip']
if (channel === 'development') {
  externals.push('devtron')
}

const outputDir = 'out'
export const replacements = getReplacements()

const commonConfig: webpack.Configuration = {
  optimization: {
    noEmitOnErrors: true,
  },
  externals: externals,
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, '..', outputDir),
    libraryTarget: 'commonjs2',
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        include: path.resolve(__dirname, 'src'),
        use: [
          {
            loader: 'awesome-typescript-loader',
            options: {
              useBabel: true,
              useCache: true,
            },
          },
        ],
        exclude: /node_modules/,
      },
      {
        test: /\.node$/,
        loader: 'awesome-node-loader',
        options: {
          name: '[name].[ext]',
        },
      },
    ],
  },
  plugins: [
    new CleanWebpackPlugin([outputDir], { verbose: false }),
    // This saves us a bunch of bytes by pruning locales (which we don't use)
    // from moment.
    new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),
  ],
  resolve: {
    extensions: ['.js', '.ts', '.tsx'],
  },
  node: {
    __dirname: false,
    __filename: false,
  },
}

// Hack: The file-metadata plugin has substantial dependencies
// (plist, DOMParser, etc) and it's only applicable on macOS.
//
// Therefore, when compiling on other platforms, we replace it
// with a tiny shim instead.
const shimFileMetadata = {
  resolve: {
    alias: {
      'file-metadata': path.resolve(
        __dirname,
        'src',
        'lib',
        'helpers',
        'file-metadata.js'
      ),
    },
  },
}

export const main = merge(
  {},
  commonConfig,
  {
    entry: { main: path.resolve(__dirname, 'src/main-process/main') },
    target: 'electron-main',
    plugins: [
      new webpack.DefinePlugin(
        Object.assign({}, replacements, {
          __PROCESS_KIND__: JSON.stringify('main'),
        })
      ),
    ],
  },
  process.platform !== 'darwin' ? shimFileMetadata : {}
)

export const renderer = merge({}, commonConfig, {
  entry: { renderer: path.resolve(__dirname, 'src/ui/index') },
  target: 'electron-renderer',
  module: {
    rules: [
      {
        test: /\.(jpe?g|png|gif|ico)$/,
        use: ['file?name=[path][name].[ext]'],
      },
      {
        test: /\.cmd$/,
        loader: 'file-loader',
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'static', 'index.html'),
      chunks: ['renderer'],
    }),
    new webpack.DefinePlugin(
      Object.assign({}, replacements, {
        __PROCESS_KIND__: JSON.stringify('ui'),
      })
    ),
  ],
})

export const crash = merge({}, commonConfig, {
  entry: { crash: path.resolve(__dirname, 'src/crash/index') },
  target: 'electron-renderer',
  plugins: [
    new HtmlWebpackPlugin({
      title: 'GitHub Desktop',
      filename: 'crash.html',
      chunks: ['crash'],
    }),
    new webpack.DefinePlugin(
      Object.assign({}, replacements, {
        __PROCESS_KIND__: JSON.stringify('crash'),
      })
    ),
  ],
})

export const cli = merge({}, commonConfig, {
  entry: { cli: path.resolve(__dirname, 'src/cli/main') },
  target: 'node',
  plugins: [
    new webpack.DefinePlugin(
      Object.assign({}, replacements, {
        __PROCESS_KIND__: JSON.stringify('cli'),
      })
    ),
  ],
})

export const highlighter = merge({}, commonConfig, {
  entry: { highlighter: path.resolve(__dirname, 'src/highlighter/index') },
  output: {
    libraryTarget: 'var',
    chunkFilename: 'highlighter/[name].js',
  },
  optimization: {
    namedChunks: true,
    splitChunks: {
      cacheGroups: {
        modes: {
          enforce: true,
          name: (mod, chunks) => {
            const builtInMode = /node_modules[\\\/]codemirror[\\\/]mode[\\\/](\w+)[\\\/]/i.exec(
              mod.resource
            )
            if (builtInMode) {
              return `mode/${builtInMode[1]}`
            }
            const external = /node_modules[\\\/]codemirror-mode-(\w+)[\\\/]/i.exec(
              mod.resource
            )
            if (external) {
              return `ext/${external[1]}`
            }
            return 'common'
          },
        },
      },
    },
  },
  target: 'webworker',
  plugins: [
    new webpack.DefinePlugin(
      Object.assign({}, replacements, {
        __PROCESS_KIND__: JSON.stringify('highlighter'),
      })
    ),
  ],
  resolve: {
    // We don't want to bundle all of CodeMirror in the highlighter. A web
    // worker doesn't have access to the DOM and most of CodeMirror's core
    // code is useless to us in that context. So instead we use this super
    // nifty subset of codemirror that defines the minimal context needed
    // to run a mode inside of node. Now, we're not running in node
    // but CodeMirror doesn't have to know about that.
    alias: {
      codemirror$: 'codemirror/addon/runmode/runmode.node.js',
      '../lib/codemirror$': '../addon/runmode/runmode.node.js',
      '../../lib/codemirror$': '../../addon/runmode/runmode.node.js',
      '../../addon/runmode/runmode$': '../../addon/runmode/runmode.node.js',
    },
  },
})

highlighter.module!.rules = [
  {
    test: /\.ts$/,
    include: path.resolve(__dirname, 'src/highlighter'),
    use: [
      {
        loader: 'awesome-typescript-loader',
        options: {
          useBabel: true,
          useCache: true,
          configFileName: path.resolve(
            __dirname,
            'src/highlighter/tsconfig.json'
          ),
        },
      },
    ],
    exclude: /node_modules/,
  },
]
