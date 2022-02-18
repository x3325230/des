import { git } from './core'
import {
  CommittedFileChange,
  AppFileStatusKind,
  PlainFileStatus,
  CopiedOrRenamedFileStatus,
  UntrackedFileStatus,
} from '../../models/status'
import { Repository } from '../../models/repository'
import { Commit } from '../../models/commit'
import { CommitIdentity } from '../../models/commit-identity'
import {
  getTrailerSeparatorCharacters,
  parseRawUnfoldedTrailers,
} from './interpret-trailers'
import { getCaptures } from '../helpers/regex'

/**
 * Map the raw status text from Git to an app-friendly value
 * shamelessly borrowed from GitHub Desktop (Windows)
 */
function mapStatus(
  rawStatus: string,
  oldPath?: string
): PlainFileStatus | CopiedOrRenamedFileStatus | UntrackedFileStatus {
  const status = rawStatus.trim()

  if (status === 'M') {
    return { kind: AppFileStatusKind.Modified }
  } // modified
  if (status === 'A') {
    return { kind: AppFileStatusKind.New }
  } // added
  if (status === '?') {
    return { kind: AppFileStatusKind.Untracked }
  } // untracked
  if (status === 'D') {
    return { kind: AppFileStatusKind.Deleted }
  } // deleted
  if (status === 'R' && oldPath != null) {
    return { kind: AppFileStatusKind.Renamed, oldPath }
  } // renamed
  if (status === 'C' && oldPath != null) {
    return { kind: AppFileStatusKind.Copied, oldPath }
  } // copied

  // git log -M --name-status will return a RXXX - where XXX is a percentage
  if (status.match(/R[0-9]+/) && oldPath != null) {
    return { kind: AppFileStatusKind.Renamed, oldPath }
  }

  // git log -C --name-status will return a CXXX - where XXX is a percentage
  if (status.match(/C[0-9]+/) && oldPath != null) {
    return { kind: AppFileStatusKind.Copied, oldPath }
  }

  return { kind: AppFileStatusKind.Modified }
}

/**
 * Get the repository's commits using `revisionRange` and limited to `limit`
 */
export async function getCommits(
  repository: Repository,
  revisionRange: string,
  limit: number,
  additionalArgs: ReadonlyArray<string> = []
): Promise<ReadonlyArray<Commit>> {
  const delimiter = '1F'
  const delimiterString = String.fromCharCode(parseInt(delimiter, 16))
  const prettyFormat = [
    '%H', // SHA
    '%h', // short SHA
    '%s', // summary
    '%b', // body
    // author identity string, matching format of GIT_AUTHOR_IDENT.
    //   author name <author email> <author date>
    // author date format dependent on --date arg, should be raw
    '%an <%ae> %ad',
    '%cn <%ce> %cd',
    '%P', // parent SHAs,
    '%(trailers:unfold,only)',
    '%D', // refs
  ].join(`%x${delimiter}`)

  const result = await git(
    [
      'log',
      revisionRange,
      `--date=raw`,
      `--max-count=${limit}`,
      `--pretty=${prettyFormat}`,
      '-z',
      '--no-show-signature',
      '--no-color',
      ...additionalArgs,
      '--',
    ],
    repository.path,
    'getCommits',
    { successExitCodes: new Set([0, 128]) }
  )

  // if the repository has an unborn HEAD, return an empty history of commits
  if (result.exitCode === 128) {
    return new Array<Commit>()
  }

  const out = result.stdout
  const lines = out.split('\0')
  // Remove the trailing empty line
  lines.splice(-1, 1)

  if (lines.length === 0) {
    return []
  }

  const trailerSeparators = await getTrailerSeparatorCharacters(repository)

  const commits = lines.map(line => {
    const pieces = line.split(delimiterString)
    const sha = pieces[0]
    const shortSha = pieces[1]
    const summary = pieces[2]
    const body = pieces[3]
    const authorIdentity = pieces[4]
    const committerIdentity = pieces[5]
    const shaList = pieces[6]

    const parentSHAs = shaList.length ? shaList.split(' ') : []
    const trailers = parseRawUnfoldedTrailers(pieces[7], trailerSeparators)
    const tags = getCaptures(pieces[8], /tag: ([^\s,]+)/g)
      .filter(i => i[0] !== undefined)
      .map(i => i[0])
    const author = CommitIdentity.parseIdentity(authorIdentity)

    if (!author) {
      throw new Error(`Couldn't parse author identity for '${shortSha}'`)
    }

    const committer = CommitIdentity.parseIdentity(committerIdentity)

    if (!committer) {
      throw new Error(`Couldn't parse committer identity for '${shortSha}'`)
    }

    return new Commit(
      sha,
      shortSha,
      summary,
      body,
      author,
      committer,
      parentSHAs,
      trailers,
      tags
    )
  })

  return commits
}

/** Get the files that were changed in the given commit. */
export async function getChangedFiles(
  repository: Repository,
  sha: string
): Promise<ReadonlyArray<CommittedFileChange>> {
  // opt-in for rename detection (-M) and copies detection (-C)
  // this is equivalent to the user configuring 'diff.renames' to 'copies'
  // NOTE: order here matters - doing -M before -C means copies aren't detected
  const args = [
    'log',
    sha,
    '-C',
    '-M',
    '-m',
    '-1',
    '--no-show-signature',
    '--first-parent',
    '--name-status',
    '--format=format:',
    '-z',
    '--',
  ]
  const result = await git(args, repository.path, 'getChangedFiles')

  return parseChangedFiles(result.stdout, sha)
}

/**
 * Parses git `log` or `diff` output into a list of changed files
 * (see `getChangedFiles` for an example of use)
 *
 * @param stdout raw ouput from a git `-z` and `--name-status` flags
 * @param committish commitish command was run against
 */
export function parseChangedFiles(
  stdout: string,
  committish: string
): ReadonlyArray<CommittedFileChange> {
  const lines = stdout.split('\0')
  // Remove the trailing empty line
  lines.splice(-1, 1)
  const files: CommittedFileChange[] = []
  for (let i = 0; i < lines.length; i++) {
    const statusText = lines[i]

    let oldPath: string | undefined = undefined

    if (
      statusText.length > 0 &&
      (statusText[0] === 'R' || statusText[0] === 'C')
    ) {
      oldPath = lines[++i]
    }

    const status = mapStatus(statusText, oldPath)

    const path = lines[++i]

    files.push(new CommittedFileChange(path, status, committish))
  }

  return files
}

/** Get the commit for the given ref. */
export async function getCommit(
  repository: Repository,
  ref: string
): Promise<Commit | null> {
  const commits = await getCommits(repository, ref, 1)
  if (commits.length < 1) {
    return null
  }

  return commits[0]
}
