import {
  APICheckStatus,
  APICheckConclusion,
  IAPIWorkflowJobStep,
  IAPIRefCheckRun,
  IAPIRefStatusItem,
  IAPIWorkflowJob,
  API,
  IAPIWorkflowJobs,
  IAPIWorkflowRun,
} from '../api'
import JSZip from 'jszip'
import moment from 'moment'

/**
 * A Desktop-specific model closely related to a GitHub API Check Run.
 *
 * The RefCheck object abstracts the difference between the legacy
 * Commit Status objects and the modern Check Runs and unifies them
 * under one common interface. Since all commit statuses can be
 * represented as Check Runs but not all Check Runs can be represented
 * as statuses the model closely aligns with Check Runs.
 */
export interface IRefCheck {
  readonly id: number
  readonly name: string
  readonly description: string
  readonly status: APICheckStatus
  readonly conclusion: APICheckConclusion | null
  readonly appName: string
  readonly checkSuiteId: number | null // API status don't have check suite id's
  readonly output: IRefCheckOutput
  readonly htmlUrl: string | null
  readonly actionsWorkflowRunId?: number
  readonly logs_url?: string
}

/**
 * There are two types of check run outputs.
 *
 * 1. From GitHub Actions, which comes in steps with individual log texts,
 *    statuses, and duration info.
 * 2. From any other check run app, which comes with a generic string of
 *    whatever the check run app provides.
 */
export type IRefCheckOutput =
  | {
      readonly title: string | null
      readonly summary?: string | null
      readonly type: RefCheckOutputType.Actions
      readonly steps: ReadonlyArray<IAPIWorkflowJobStep>
    }
  | {
      readonly title: string | null
      readonly summary?: string | null
      readonly type: RefCheckOutputType.Default
      // This text is whatever a check run app decides to place in it.
      // It may include html.
      readonly text: string | null
    }

export enum RefCheckOutputType {
  Actions = 'Actions',
  Default = 'Default',
}

/**
 * A combined view of all legacy commit statuses as well as
 * check runs for a particular Git reference.
 */
export interface ICombinedRefCheck {
  readonly status: APICheckStatus
  readonly conclusion: APICheckConclusion | null
  readonly checks: ReadonlyArray<IRefCheck>
}

/**
 * Given a zipped list of logs from a workflow job, parses the different job
 * steps.
 */
export async function parseJobStepLogs(
  logZip: JSZip,
  job: IAPIWorkflowJob
): Promise<ReadonlyArray<IAPIWorkflowJobStep>> {
  try {
    const jobFolder = logZip.folder(job.name)
    if (jobFolder === null) {
      return job.steps
    }

    const stepsWLogs = new Array<IAPIWorkflowJobStep>()
    for (const step of job.steps) {
      const stepName = step.name.replace('/', '')
      const stepFileName = `${step.number}_${stepName}.txt`
      const stepLogFile = jobFolder.file(stepFileName)
      if (stepLogFile === null) {
        stepsWLogs.push(step)
        continue
      }

      const log = await stepLogFile.async('text')
      stepsWLogs.push({ ...step, log })
    }
    return stepsWLogs
  } catch (e) {
    log.warn('Could not parse logs for: ' + job.name)
  }

  return job.steps
}

/**
 * Convert a legacy API commit status to a fake check run
 */
export function apiStatusToRefCheck(apiStatus: IAPIRefStatusItem): IRefCheck {
  let state: APICheckStatus
  let conclusion: APICheckConclusion | null = null

  if (apiStatus.state === 'success') {
    state = APICheckStatus.Completed
    conclusion = APICheckConclusion.Success
  } else if (apiStatus.state === 'pending') {
    state = APICheckStatus.InProgress
  } else {
    state = APICheckStatus.Completed
    conclusion = APICheckConclusion.Failure
  }

  return {
    id: apiStatus.id,
    name: apiStatus.context,
    description: getCheckRunShortDescription(state, conclusion),
    status: state,
    conclusion,
    appName: '',
    checkSuiteId: null,
    output: {
      type: RefCheckOutputType.Default,
      title: null,
      text: null,
    },
    htmlUrl: null,
  }
}

/**
 * Returns the user-facing adjective for a given check run conclusion.
 */
export function getCheckRunConclusionAdjective(
  conclusion: APICheckConclusion | null
): string {
  if (conclusion === null) {
    return 'In progress'
  }

  switch (conclusion) {
    case APICheckConclusion.ActionRequired:
      return 'Action required'
    case APICheckConclusion.Canceled:
      return 'Canceled'
    case APICheckConclusion.TimedOut:
      return 'Timed out'
    case APICheckConclusion.Failure:
      return 'Failed'
    case APICheckConclusion.Neutral:
      return 'Neutral'
    case APICheckConclusion.Success:
      return 'Successful'
    case APICheckConclusion.Skipped:
      return 'Skipped'
    case APICheckConclusion.Stale:
      return 'Marked as stale'
  }
}

/**
 * Method to generate a user friendly short check run description such as
 * "Successful in xs", "In Progress", "Failed after 1m"
 *
 * If the duration is not provided, it will omit the preposition and duration
 * context. Also, conclusions such as `Skipped`, 'Action required`, `Marked as
 * stale` don't make sense with duration context so it is ommited.
 *
 * @param status - The overall check status, something like completed, pending,
 * or failing...
 * @param conclusion - The conclusion of the check, something like success or
 * skipped...
 * @param durationSeconds - The time in seconds it took to complete.
 */
function getCheckRunShortDescription(
  status: APICheckStatus,
  conclusion: APICheckConclusion | null,
  durationSeconds?: number
): string {
  if (status !== APICheckStatus.Completed || conclusion === null) {
    return 'In progress'
  }

  const adjective = getCheckRunConclusionAdjective(conclusion)

  // Some conclusions such as 'Action required' or 'Skipped' don't make sense
  // with time context so we just return them.
  if (
    [
      APICheckConclusion.ActionRequired,
      APICheckConclusion.Skipped,
      APICheckConclusion.Stale,
    ].includes(conclusion)
  ) {
    return adjective
  }

  const preposition = conclusion === APICheckConclusion.Success ? 'in' : 'after'

  if (durationSeconds !== undefined && durationSeconds > 0) {
    const duration =
      durationSeconds < 60
        ? `${durationSeconds}s`
        : `${Math.round(durationSeconds / 60)}m`
    return `${adjective} ${preposition} ${duration}`
  }

  return adjective
}

/**
 * Attempts to get the duration of a check run in seconds.
 * If it fails, it returns 0
 */
export function getCheckDurationInSeconds(
  checkRun: IAPIRefCheckRun | IAPIWorkflowJobStep
): number {
  try {
    // This could fail if the dates cannot be parsed.
    const completedAt = new Date(checkRun.completed_at).getTime()
    const startedAt = new Date(checkRun.started_at).getTime()
    const duration = (completedAt - startedAt) / 1000

    if (!isNaN(duration)) {
      return duration
    }
  } catch (e) {}

  return 0
}

/**
 * Convert an API check run object to a RefCheck model
 */
export function apiCheckRunToRefCheck(checkRun: IAPIRefCheckRun): IRefCheck {
  return {
    id: checkRun.id,
    name: checkRun.name,
    description: getCheckRunShortDescription(
      checkRun.status,
      checkRun.conclusion,
      getCheckDurationInSeconds(checkRun)
    ),
    status: checkRun.status,
    conclusion: checkRun.conclusion,
    appName: checkRun.app.name,
    checkSuiteId: checkRun.check_suite.id,
    output: {
      ...checkRun.output,
      type: RefCheckOutputType.Default,
    },
    htmlUrl: checkRun.html_url,
  }
}

/**
 * Combines a list of check runs into a single combined check with global status
 * and conclusion.
 */
export function createCombinedCheckFromChecks(
  checks: ReadonlyArray<IRefCheck>
): ICombinedRefCheck | null {
  if (checks.length === 0) {
    // This case is distinct from when we fail to call the API in
    // that this means there are no checks or statuses so we should
    // clear whatever info we've got for this ref.
    return null
  }

  if (checks.length === 1) {
    // If we've got exactly one check then we can mirror its status
    // and conclusion 1-1 without having to create an aggregate status
    const { status, conclusion } = checks[0]
    return { status, conclusion, checks }
  }

  if (checks.some(isIncompleteOrFailure)) {
    return {
      status: APICheckStatus.Completed,
      conclusion: APICheckConclusion.Failure,
      checks,
    }
  } else if (checks.every(isSuccess)) {
    return {
      status: APICheckStatus.Completed,
      conclusion: APICheckConclusion.Success,
      checks,
    }
  } else {
    return { status: APICheckStatus.InProgress, conclusion: null, checks }
  }
}

/**
 * Whether the check is either incomplete or has failed
 */
export function isIncompleteOrFailure(check: IRefCheck) {
  return isIncomplete(check) || isFailure(check)
}

/**
 * Whether the check is incomplete (timed out, stale or cancelled).
 *
 * The terminology here is confusing and deserves explanation. An
 * incomplete check is a check run that has been started and who's
 * state is 'completed' but it never got to produce a conclusion
 * because it was either cancelled, it timed out, or GitHub marked
 * it as stale.
 */
export function isIncomplete(check: IRefCheck) {
  if (check.status === 'completed') {
    switch (check.conclusion) {
      case 'timed_out':
      case 'stale':
      case 'cancelled':
        return true
    }
  }

  return false
}

/** Whether the check has failed (failure or requires action) */
export function isFailure(check: IRefCheck | IAPIWorkflowJobStep) {
  if (check.status === 'completed') {
    switch (check.conclusion) {
      case 'failure':
      case 'action_required':
        return true
    }
  }

  return false
}

/** Whether the check can be considered successful (success, neutral or skipped) */
export function isSuccess(check: IRefCheck) {
  if (check.status === 'completed') {
    switch (check.conclusion) {
      case 'success':
      case 'neutral':
      case 'skipped':
        return true
    }
  }

  return false
}

/**
 * In some cases there may be multiple check runs reported for a
 * reference. In that case GitHub.com will pick only the latest
 * run for each check name to present in the PR merge footer and
 * only the latest run counts towards the mergeability of a PR.
 *
 * We use the check suite id as a proxy for determining what's
 * the "latest" of two check runs with the same name.
 */
export function getLatestCheckRunsByName(
  checkRuns: ReadonlyArray<IAPIRefCheckRun>
): ReadonlyArray<IAPIRefCheckRun> {
  const latestCheckRunsByName = new Map<string, IAPIRefCheckRun>()

  for (const checkRun of checkRuns) {
    const current = latestCheckRunsByName.get(checkRun.name)
    if (
      current === undefined ||
      current.check_suite.id < checkRun.check_suite.id
    ) {
      latestCheckRunsByName.set(checkRun.name, checkRun)
    }
  }

  return [...latestCheckRunsByName.values()]
}

/**
 * Retrieve GitHub Actions job and logs for the check runs.
 */
export async function getLatestPRWorkflowRunsLogsForCheckRun(
  api: API,
  owner: string,
  repo: string,
  checkRuns: ReadonlyArray<IRefCheck>
): Promise<ReadonlyArray<IRefCheck>> {
  const logCache = new Map<string, JSZip>()
  const jobsCache = new Map<number, IAPIWorkflowJobs | null>()
  const mappedCheckRuns = new Array<IRefCheck>()
  for (const cr of checkRuns) {
    if (cr.actionsWorkflowRunId === undefined || cr.logs_url === undefined) {
      mappedCheckRuns.push(cr)
      continue
    }

    // Multiple check runs match a single workflow run.
    // We can prevent several job network calls by caching them.
    const workFlowRunJobs =
      jobsCache.get(cr.actionsWorkflowRunId) ??
      (await api.fetchWorkflowRunJobs(owner, repo, cr.actionsWorkflowRunId))
    jobsCache.set(cr.actionsWorkflowRunId, workFlowRunJobs)

    // Here check run and jobs only share their names.
    // Thus, unfortunately cannot match on a numerical id.
    const matchingJob = workFlowRunJobs?.jobs.find(j => j.name === cr.name)
    if (matchingJob === undefined) {
      mappedCheckRuns.push(cr)
      continue
    }

    // One workflow can have the logs for multiple check runs.. no need to
    // keep retrieving it. So we are hashing it.
    const logZip =
      logCache.get(cr.logs_url) ??
      (await api.fetchWorkflowRunJobLogs(cr.logs_url))
    if (logZip === null) {
      mappedCheckRuns.push(cr)
      continue
    }

    logCache.set(cr.logs_url, logZip)

    mappedCheckRuns.push({
      ...cr,
      htmlUrl: matchingJob.html_url,
      output: {
        ...cr.output,
        type: RefCheckOutputType.Actions,
        steps: await parseJobStepLogs(logZip, matchingJob),
      },
    })
  }

  return mappedCheckRuns
}

/**
 * Retrieves the jobs and logs URLs from a list of check runs. Retruns a list
 * with the same check runs augmented with the job and logs URLs.
 *
 * @param api API instance used to retrieve the jobs and logs URLs
 * @param owner Owner of the repository
 * @param repo Name of the repository
 * @param branchName Name of the branch to which the check runs belong
 * @param checkRuns List of check runs to augment
 */
export async function getCheckRunActionsJobsAndLogURLS(
  api: API,
  owner: string,
  repo: string,
  branchName: string,
  checkRuns: ReadonlyArray<IRefCheck>
): Promise<ReadonlyArray<IRefCheck>> {
  const latestWorkflowRuns = await getLatestPRWorkflowRuns(
    api,
    owner,
    repo,
    branchName
  )

  if (latestWorkflowRuns.length === 0) {
    return checkRuns
  }

  return getCheckRunWithActionsJobAndLogURLs(checkRuns, latestWorkflowRuns)
}

// Gets only the latest PR workflow runs hashed by name
async function getLatestPRWorkflowRuns(
  api: API,
  owner: string,
  name: string,
  branchName: string
): Promise<ReadonlyArray<IAPIWorkflowRun>> {
  const wrMap = new Map<number, IAPIWorkflowRun>()
  const allBranchWorkflowRuns = await api.fetchPRWorkflowRuns(
    owner,
    name,
    branchName
  )

  if (allBranchWorkflowRuns === null) {
    return []
  }

  // When retrieving Actions Workflow runs it returns all present and past
  // workflow runs for the given branch name. For each workflow name, we only
  // care about showing the latest run.
  for (const wr of allBranchWorkflowRuns.workflow_runs) {
    const storedWR = wrMap.get(wr.workflow_id)
    if (storedWR === undefined) {
      wrMap.set(wr.workflow_id, wr)
      continue
    }

    const storedWRDate = new Date(storedWR.created_at)
    const givenWRDate = new Date(wr.created_at)
    if (storedWRDate.getTime() < givenWRDate.getTime()) {
      wrMap.set(wr.workflow_id, wr)
    }
  }

  return Array.from(wrMap.values())
}

function getCheckRunWithActionsJobAndLogURLs(
  checkRuns: ReadonlyArray<IRefCheck>,
  actionWorkflowRuns: ReadonlyArray<IAPIWorkflowRun>
): ReadonlyArray<IRefCheck> {
  if (actionWorkflowRuns.length === 0 || checkRuns.length === 0) {
    return checkRuns
  }

  const mappedCheckRuns = new Array<IRefCheck>()
  for (const cr of checkRuns) {
    const matchingWR = actionWorkflowRuns.find(
      wr => wr.check_suite_id === cr.checkSuiteId
    )
    if (matchingWR === undefined) {
      mappedCheckRuns.push(cr)
      continue
    }

    const { id, logs_url } = matchingWR
    mappedCheckRuns.push({
      ...cr,
      actionsWorkflowRunId: id,
      logs_url,
    })
  }

  return mappedCheckRuns
}

/**
 *  Gets the duration of a check run or job step formatted in minutes and
 *  seconds.
 */
export function getFormattedCheckRunDuration(
  checkRun: IAPIRefCheckRun | IAPIWorkflowJobStep
): string {
  return moment
    .duration(getCheckDurationInSeconds(checkRun), 'seconds')
    .format('d[d] h[h] m[m] s[s]', { largest: 4 })
}
