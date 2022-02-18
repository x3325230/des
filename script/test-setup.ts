/* eslint-disable no-sync */

import * as fs from 'fs'
import * as cp from 'child_process'
import { getLogFiles } from './review-logs'
import { getProductName } from '../app/package-info'
import { getDistPath } from './dist-info'
import { isCircleCI, isRunningOnFork, isGitHubActions } from './build-platforms'

if (
  (isCircleCI() || isGitHubActions()) &&
  process.platform === 'darwin' &&
  !isRunningOnFork()
) {
  const archive = `${getDistPath()}/${getProductName()}.app`
  try {
    console.log('validating signature of Desktop app')
    cp.execSync(`codesign -dv --verbose=4 '${archive}'`)
  } catch (err) {
    process.exit(1)
  }
  console.log('\n\n')
}

const output = cp.execSync('git config -l --show-origin', { encoding: 'utf-8' })
console.log(`Git config:\n${output}\n\n`)

// delete existing log files
getLogFiles().forEach(file => {
  console.log(`deleting ${file}`)
  fs.unlinkSync(file)
})
