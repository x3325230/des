import * as OS from 'os'
import * as URL from 'url'
import { Account } from '../models/account'

import {
  request,
  parsedResponse,
  HTTPMethod,
  APIError,
  urlWithQueryString,
} from './http'
import { AuthenticationMode } from './2fa'
import { uuid } from './uuid'
import { getAvatarWithEnterpriseFallback } from './gravatar'
import { getDefaultEmail } from './email'

/**
 * Optional set of configurable settings for the fetchAll method
 */
interface IFetchAllOptions<T> {
  /**
   * The number of results to ask for on each page when making
   * requests to paged API endpoints.
   */
  perPage?: number

  /**
   * An optional predicate which determines whether or not to
   * continue loading results from the API. This can be used
   * to put a limit on the number of results to return from
   * a paged API resource.
   *
   * As an example, to stop loading results after 500 results:
   *
   * `(results) => results.length < 500`
   *
   * @param results  All results retrieved thus far
   */
  continue?: (results: ReadonlyArray<T>) => boolean

  /**
   * Calculate the next page path given the response.
   *
   * Optional, see `getNextPagePathFromLink` for the default
   * implementation.
   */
  getNextPagePath?: (response: Response) => string | null

  /**
   * Whether or not to silently suppress request errors and
   * return the results retrieved thus far. If this field is
   * `true` the fetchAll method will suppress errors (this is
   * also the default behavior if no value is provided for
   * this field). Setting this field to false will cause the
   * fetchAll method to throw if it encounters an API error
   * on any page.
   */
  suppressErrors?: boolean
}

const username: () => Promise<string> = require('username')

const ClientID = process.env.TEST_ENV ? '' : __OAUTH_CLIENT_ID__
const ClientSecret = process.env.TEST_ENV ? '' : __OAUTH_SECRET__

if (!ClientID || !ClientID.length || !ClientSecret || !ClientSecret.length) {
  log.warn(
    `DESKTOP_OAUTH_CLIENT_ID and/or DESKTOP_OAUTH_CLIENT_SECRET is undefined. You won't be able to authenticate new users.`
  )
}

type GitHubAccountType = 'User' | 'Organization'

/** The OAuth scopes we need. */
const Scopes = ['repo', 'user']

enum HttpStatusCode {
  NotModified = 304,
  NotFound = 404,
}

/** The note URL used for authorizations the app creates. */
const NoteURL = 'https://desktop.github.com/'

/**
 * Information about a repository as returned by the GitHub API.
 */
export interface IAPIRepository {
  readonly clone_url: string
  readonly ssh_url: string
  readonly html_url: string
  readonly name: string
  readonly owner: IAPIIdentity
  readonly private: boolean
  readonly fork: boolean
  readonly default_branch: string
  readonly pushed_at: string
  readonly parent: IAPIRepository | null
}

/**
 * Information about a commit as returned by the GitHub API.
 */
export interface IAPICommit {
  readonly sha: string
  readonly author: IAPIIdentity | {} | null
}

/**
 * Entity returned by the `/user/orgs` endpoint.
 *
 * Because this is specific to one endpoint it omits the `type` member from
 * `IAPIIdentity` that callers might expect.
 */
export interface IAPIOrganization {
  readonly id: number
  readonly url: string
  readonly login: string
  readonly avatar_url: string
}

/**
 * Minimum subset of an identity returned by the GitHub API
 */
export interface IAPIIdentity {
  readonly id: number
  readonly url: string
  readonly login: string
  readonly avatar_url: string
  readonly type: GitHubAccountType
}

/**
 * Complete identity details returned in some situations by the GitHub API.
 *
 * If you are not sure what is returned as part of an API response, you should
 * use `IAPIIdentity` as that contains the known subset of an identity and does
 * not cover scenarios where privacy settings of a user control what information
 * is returned.
 */
interface IAPIFullIdentity {
  readonly id: number
  readonly url: string
  readonly login: string
  readonly avatar_url: string

  /**
   * The user's real name or null if the user hasn't provided
   * a real name for their public profile.
   */
  readonly name: string | null

  /**
   * The email address for this user or null if the user has not
   * specified a public email address in their profile.
   */
  readonly email: string | null
  readonly type: GitHubAccountType
}

/** The users we get from the mentionables endpoint. */
export interface IAPIMentionableUser {
  readonly avatar_url: string

  /**
   * Note that this may be an empty string *or* null in the case where the user
   * has no public email address.
   */
  readonly email: string | null

  readonly login: string

  readonly name: string
}

/**
 * Error thrown by `fetchUpdatedPullRequests` when receiving more results than
 * what the `maxResults` parameter allows for.
 */
export class MaxResultsError extends Error {}

/**
 * `null` can be returned by the API for legacy reasons. A non-null value is
 * set for the primary email address currently, but in the future visibility
 * may be defined for each email address.
 */
export type EmailVisibility = 'public' | 'private' | null

/**
 * Information about a user's email as returned by the GitHub API.
 */
export interface IAPIEmail {
  readonly email: string
  readonly verified: boolean
  readonly primary: boolean
  readonly visibility: EmailVisibility
}

/** Information about an issue as returned by the GitHub API. */
export interface IAPIIssue {
  readonly number: number
  readonly title: string
  readonly state: 'open' | 'closed'
  readonly updated_at: string
}

/** The combined state of a ref. */
export type APIRefState = 'failure' | 'pending' | 'success'

/**
 * The API response for a combined view of a commit
 * status for a given ref
 */
export interface IAPIRefStatusItem {
  readonly state: APIRefState
  readonly target_url: string
  readonly description: string
  readonly context: string
  readonly id: number
}

/** The API response to a ref status request. */
export interface IAPIRefStatus {
  readonly state: APIRefState
  readonly total_count: number
  readonly statuses: ReadonlyArray<IAPIRefStatusItem>
}

/** Branch information returned by the GitHub API */
export interface IAPIBranch {
  /**
   * The name of the branch stored on the remote.
   *
   * NOTE: this is NOT a fully-qualified ref (i.e. `refs/heads/master`)
   */
  readonly name: string
  /**
   * Branch protection settings:
   *
   *  - `true` indicates that the branch is protected in some way
   *  - `false` indicates no branch protection set
   */
  readonly protected: boolean
}

interface IAPIPullRequestRef {
  readonly ref: string
  readonly sha: string

  /**
   * The repository in which this ref lives. It could be null if the repository
   * has been deleted since the PR was opened.
   */
  readonly repo: IAPIRepository | null
}

/** Information about a pull request as returned by the GitHub API. */
export interface IAPIPullRequest {
  readonly number: number
  readonly title: string
  readonly created_at: string
  readonly updated_at: string
  readonly user: IAPIIdentity
  readonly head: IAPIPullRequestRef
  readonly base: IAPIPullRequestRef
  readonly state: 'open' | 'closed'
}

/** The metadata about a GitHub server. */
export interface IServerMetadata {
  /**
   * Does the server support password-based authentication? If not, the user
   * must go through the OAuth flow to authenticate.
   */
  readonly verifiable_password_authentication: boolean
}

/** The server response when handling the OAuth callback (with code) to obtain an access token */
interface IAPIAccessToken {
  readonly access_token: string
  readonly scope: string
  readonly token_type: string
}

/** The partial server response when creating a new authorization on behalf of a user */
interface IAPIAuthorization {
  readonly token: string
}

/** The response we receive from fetching mentionables. */
interface IAPIMentionablesResponse {
  readonly etag: string | null
  readonly users: ReadonlyArray<IAPIMentionableUser>
}

/** The response for search results. */
interface ISearchResults<T> {
  readonly items: ReadonlyArray<T>
}

/**
 * Parses the Link header from GitHub and returns the 'next' path
 * if one is present.
 *
 * If no link rel next header is found this method returns null.
 */
function getNextPagePathFromLink(response: Response): string | null {
  const linkHeader = response.headers.get('Link')

  if (!linkHeader) {
    return null
  }

  for (const part of linkHeader.split(',')) {
    // https://github.com/philschatz/octokat.js/blob/5658abe442e8bf405cfda1c72629526a37554613/src/plugins/pagination.js#L17
    const match = part.match(/<([^>]+)>; rel="([^"]+)"/)

    if (match && match[2] === 'next') {
      const nextURL = URL.parse(match[1])
      return nextURL.path || null
    }
  }

  return null
}

/**
 * Parses the 'next' Link header from GitHub using
 * `getNextPagePathFromLink`. Unlike `getNextPagePathFromLink`
 * this method will attempt to double the page size when
 * the current page index and the page size allows for it
 * leading to a ramp up in page size.
 *
 * This might sound confusing, and it is, but the primary use
 * case for this is when retrieving updated PRs. By specifying
 * an initial page size of, for example, 10 this method will
 * increase the page size to 20 once the second page has been
 * loaded. See the table below for an example. The ramp-up
 * will stop at a page size of 100 since that's the maximum
 * that the GitHub API supports.
 *
 * ```
 * |-----------|------|-----------|-----------------|
 * | Request # | Page | Page size | Retrieved items |
 * |-----------|------|-----------|-----------------|
 * | 1         | 1    | 10        | 10              |
 * | 2         | 2    | 10        | 20              |
 * | 3         | 2    | 20        | 40              |
 * | 4         | 2    | 40        | 80              |
 * | 5         | 2    | 80        | 160             |
 * | 6         | 3    | 80        | 240             |
 * | 7         | 4    | 80        | 320             |
 * | 8         | 5    | 80        | 400             |
 * | 9         | 5    | 100       | 500             |
 * |-----------|------|-----------|-----------------|
 * ```
 * This algorithm means we can have the best of both worlds.
 * If there's a small number of changed pull requests since
 * our last update we'll do small requests that use minimal
 * bandwidth but if we encounter a repository where a lot
 * of PRs have changed since our last fetch (like a very
 * active repository or one we haven't fetched in a long time)
 * we'll spool up our page size in just a few requests and load
 * in bulk.
 *
 * As an example I used a very active internal repository and
 * asked for all PRs updated in the last 24 hours which was 320.
 * With the previous regime of fetching with a page size of 10
 * that obviously took 32 requests. With this new regime it
 * would take 7.
 */
export function getNextPagePathWithIncreasingPageSize(response: Response) {
  const nextPath = getNextPagePathFromLink(response)

  if (!nextPath) {
    return null
  }

  const { pathname, query } = URL.parse(nextPath, true)
  const { per_page, page } = query

  const pageSize = typeof per_page === 'string' ? parseInt(per_page, 10) : NaN
  const pageNumber = typeof page === 'string' ? parseInt(page, 10) : NaN

  if (!pageSize || !pageNumber) {
    return nextPath
  }

  // Confusing, but we're looking at the _next_ page path here
  // so the current is whatever came before it.
  const currentPage = pageNumber - 1

  // Number of received items thus far
  const received = currentPage * pageSize

  // Can't go above 100, that's the max the API will allow.
  const nextPageSize = Math.min(100, pageSize * 2)

  // Have we received exactly the amount of items
  // such that doubling the page size and loading the
  // second page would seamlessly fit? No sense going
  // above 100 since that's the max the API supports
  if (pageSize !== nextPageSize && received % nextPageSize === 0) {
    query.per_page = `${nextPageSize}`
    query.page = `${received / nextPageSize + 1}`
    return URL.format({ pathname, query })
  }

  return nextPath
}

/**
 * Returns an ISO 8601 time string with second resolution instead of
 * the standard javascript toISOString which returns millisecond
 * resolution. The GitHub API doesn't return dates with milliseconds
 * so we won't send any back either.
 */
function toGitHubIsoDateString(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * An object for making authenticated requests to the GitHub API
 */
export class API {
  private endpoint: string
  private token: string

  /** Create a new API client from the given account. */
  public static fromAccount(account: Account): API {
    return new API(account.endpoint, account.token)
  }

  /** Create a new API client for the endpoint, authenticated with the token. */
  public constructor(endpoint: string, token: string) {
    this.endpoint = endpoint
    this.token = token
  }

  /** Fetch a repo by its owner and name. */
  public async fetchRepository(
    owner: string,
    name: string
  ): Promise<IAPIRepository | null> {
    try {
      const response = await this.request('GET', `repos/${owner}/${name}`)
      if (response.status === HttpStatusCode.NotFound) {
        log.warn(`fetchRepository: '${owner}/${name}' returned a 404`)
        return null
      }
      return await parsedResponse<IAPIRepository>(response)
    } catch (e) {
      log.warn(`fetchRepository: an error occurred for '${owner}/${name}'`, e)
      return null
    }
  }

  /** Fetch all repos a user has access to. */
  public async fetchRepositories(): Promise<ReadonlyArray<
    IAPIRepository
  > | null> {
    try {
      return await this.fetchAll<IAPIRepository>('user/repos')
    } catch (error) {
      log.warn(`fetchRepositories: ${error}`)
      return null
    }
  }

  /** Fetch the logged in account. */
  public async fetchAccount(): Promise<IAPIFullIdentity> {
    try {
      const response = await this.request('GET', 'user')
      const result = await parsedResponse<IAPIFullIdentity>(response)
      return result
    } catch (e) {
      log.warn(`fetchAccount: failed with endpoint ${this.endpoint}`, e)
      throw e
    }
  }

  /** Fetch the current user's emails. */
  public async fetchEmails(): Promise<ReadonlyArray<IAPIEmail>> {
    try {
      const response = await this.request('GET', 'user/emails')
      const result = await parsedResponse<ReadonlyArray<IAPIEmail>>(response)

      return Array.isArray(result) ? result : []
    } catch (e) {
      log.warn(`fetchEmails: failed with endpoint ${this.endpoint}`, e)
      return []
    }
  }

  /** Fetch a commit from the repository. */
  public async fetchCommit(
    owner: string,
    name: string,
    sha: string
  ): Promise<IAPICommit | null> {
    try {
      const path = `repos/${owner}/${name}/commits/${sha}`
      const response = await this.request('GET', path)
      if (response.status === HttpStatusCode.NotFound) {
        log.warn(`fetchCommit: '${path}' returned a 404`)
        return null
      }
      return await parsedResponse<IAPICommit>(response)
    } catch (e) {
      log.warn(`fetchCommit: returned an error '${owner}/${name}@${sha}'`, e)
      return null
    }
  }

  /** Search for a user with the given public email. */
  public async searchForUserWithEmail(
    email: string
  ): Promise<IAPIIdentity | null> {
    if (email.length === 0) {
      return null
    }

    try {
      const params = { q: `${email} in:email type:user` }
      const url = urlWithQueryString('search/users', params)
      const response = await this.request('GET', url)
      const result = await parsedResponse<ISearchResults<IAPIIdentity>>(
        response
      )
      const items = result.items
      if (items.length) {
        // The results are sorted by score, best to worst. So the first result
        // is our best match.
        return items[0]
      } else {
        return null
      }
    } catch (e) {
      log.warn(`searchForUserWithEmail: not found '${email}'`, e)
      return null
    }
  }

  /** Fetch all the orgs to which the user belongs. */
  public async fetchOrgs(): Promise<ReadonlyArray<IAPIOrganization>> {
    try {
      return await this.fetchAll<IAPIOrganization>('user/orgs')
    } catch (e) {
      log.warn(`fetchOrgs: failed with endpoint ${this.endpoint}`, e)
      return []
    }
  }

  /** Create a new GitHub repository with the given properties. */
  public async createRepository(
    org: IAPIOrganization | null,
    name: string,
    description: string,
    private_: boolean
  ): Promise<IAPIRepository> {
    try {
      const apiPath = org ? `orgs/${org.login}/repos` : 'user/repos'
      const response = await this.request('POST', apiPath, {
        name,
        description,
        private: private_,
      })

      return await parsedResponse<IAPIRepository>(response)
    } catch (e) {
      if (e instanceof APIError) {
        if (org !== null) {
          throw new Error(
            `Unable to create repository for organization '${
              org.login
            }'. Verify that it exists, that it's a paid organization, and that you have permission to create a repository there.`
          )
        }
        throw e
      }

      log.error(`createRepository: failed with endpoint ${this.endpoint}`, e)
      throw new Error(
        `Unable to publish repository. Please check if you have an internet connection and try again.`
      )
    }
  }

  /**
   * Fetch the issues with the given state that have been created or updated
   * since the given date.
   */
  public async fetchIssues(
    owner: string,
    name: string,
    state: 'open' | 'closed' | 'all',
    since: Date | null
  ): Promise<ReadonlyArray<IAPIIssue>> {
    const params: { [key: string]: string } = {
      state,
    }
    if (since && !isNaN(since.getTime())) {
      params.since = toGitHubIsoDateString(since)
    }

    const url = urlWithQueryString(`repos/${owner}/${name}/issues`, params)
    try {
      const issues = await this.fetchAll<IAPIIssue>(url)

      // PRs are issues! But we only want Really Seriously Issues.
      return issues.filter((i: any) => !i.pullRequest)
    } catch (e) {
      log.warn(`fetchIssues: failed for repository ${owner}/${name}`, e)
      throw e
    }
  }

  /** Fetch all open pull requests in the given repository. */
  public async fetchAllOpenPullRequests(owner: string, name: string) {
    const url = urlWithQueryString(`repos/${owner}/${name}/pulls`, {
      state: 'open',
    })
    try {
      return await this.fetchAll<IAPIPullRequest>(url)
    } catch (e) {
      log.warn(`failed fetching open PRs for repository ${owner}/${name}`, e)
      throw e
    }
  }

  /**
   * Fetch all pull requests in the given repository that have been
   * updated on or after the provided date.
   *
   * Note: The GitHub API doesn't support providing a last-updated
   * limitation for PRs like it does for issues so we're emulating
   * the issues API by sorting PRs descending by last updated and
   * only grab as many pages as we need to until we no longer receive
   * PRs that have been update more recently than the `since`
   * parameter.
   *
   * If there's more than `maxResults` updated PRs since the last time
   * we fetched this method will throw an error such that we can abort
   * this strategy and commence loading all open PRs instead.
   */
  public async fetchUpdatedPullRequests(
    owner: string,
    name: string,
    since: Date,
    // 320 is chosen because with a ramp-up page size starting with
    // a page size of 10 we'll reach 320 in exactly 7 pages. See
    // getNextPagePathWithIncreasingPageSize
    maxResults = 320
  ) {
    const sinceTime = since.getTime()
    const url = urlWithQueryString(`repos/${owner}/${name}/pulls`, {
      state: 'all',
      sort: 'updated',
      direction: 'desc',
    })

    try {
      const prs = await this.fetchAll<IAPIPullRequest>(url, {
        // We use a page size smaller than our default 100 here because we
        // expect that the majority use case will return much less than
        // 100 results. Given that as long as _any_ PR has changed we'll
        // get the full list back (PRs doesn't support ?since=) we want
        // to keep this number fairly conservative in order to not use
        // up bandwidth needlessly while balancing it such that we don't
        // have to use a lot of requests to update our database. We then
        // ramp up the page size (see getNextPagePathWithIncreasingPageSize)
        // if it turns out there's a lot of updated PRs.
        perPage: 10,
        getNextPagePath: getNextPagePathWithIncreasingPageSize,
        continue(results) {
          if (results.length >= maxResults) {
            throw new MaxResultsError('got max pull requests, aborting')
          }

          // Given that we sort the results in descending order by their
          // updated_at field we can safely say that if the last item
          // is modified after our sinceTime then haven't reached the
          // end of updated PRs.
          const last = results[results.length - 1]
          return last !== undefined && Date.parse(last.updated_at) > sinceTime
        },
        // We can't ignore errors here as that might mean that we haven't
        // retrieved enough pages to fully capture the changes since the
        // last time we updated. Ignoring errors here would mean that we'd
        // store an incorrect lastUpdated field in the database.
        suppressErrors: false,
      })
      return prs.filter(pr => Date.parse(pr.updated_at) >= sinceTime)
    } catch (e) {
      log.warn(`failed fetching updated PRs for repository ${owner}/${name}`, e)
      throw e
    }
  }

  /**
   * Get the combined status for the given ref.
   *
   * Note: Contrary to many other methods in this class this will not
   * suppress or log errors, callers must ensure that they handle errors.
   */
  public async fetchCombinedRefStatus(
    owner: string,
    name: string,
    ref: string
  ): Promise<IAPIRefStatus> {
    const path = `repos/${owner}/${name}/commits/${ref}/status`
    const response = await this.request('GET', path)
    return await parsedResponse<IAPIRefStatus>(response)
  }

  public async fetchProtectedBranches(
    owner: string,
    name: string
  ): Promise<ReadonlyArray<IAPIBranch>> {
    const path = `repos/${owner}/${name}/branches?protected=true`
    try {
      const response = await this.request('GET', path)
      return await parsedResponse<IAPIBranch[]>(response)
    } catch (err) {
      log.info(
        `[fetchProtectedBranches] unable to list protected branches`,
        err
      )
      return new Array<IAPIBranch>()
    }
  }

  /**
   * Authenticated requests to a paginating resource such as issues.
   *
   * Follows the GitHub API hypermedia links to get the subsequent
   * pages when available, buffers all items and returns them in
   * one array when done.
   */
  private async fetchAll<T>(path: string, options?: IFetchAllOptions<T>) {
    const buf = new Array<T>()
    const opts: IFetchAllOptions<T> = { perPage: 100, ...options }
    const params = { per_page: `${opts.perPage}` }

    let nextPath: string | null = urlWithQueryString(path, params)
    do {
      const response: Response = await this.request('GET', nextPath)
      if (opts.suppressErrors !== false && !response.ok) {
        log.warn(`fetchAll: '${path}' returned a ${response.status}`)
        return buf
      }

      const items = await parsedResponse<ReadonlyArray<T>>(response)
      if (items) {
        buf.push(...items)
      }

      nextPath = opts.getNextPagePath
        ? opts.getNextPagePath(response)
        : getNextPagePathFromLink(response)
    } while (nextPath && (!opts.continue || opts.continue(buf)))

    return buf
  }

  /** Make an authenticated request to the client's endpoint with its token. */
  private request(
    method: HTTPMethod,
    path: string,
    body?: Object,
    customHeaders?: Object
  ): Promise<Response> {
    return request(this.endpoint, this.token, method, path, body, customHeaders)
  }

  /**
   * Get the allowed poll interval for fetching. If an error occurs it will
   * return null.
   */
  public async getFetchPollInterval(
    owner: string,
    name: string
  ): Promise<number | null> {
    const path = `repos/${owner}/${name}/git`
    try {
      const response = await this.request('HEAD', path)
      const interval = response.headers.get('x-poll-interval')
      if (interval) {
        const parsed = parseInt(interval, 10)
        return isNaN(parsed) ? null : parsed
      }
      return null
    } catch (e) {
      log.warn(`getFetchPollInterval: failed for ${owner}/${name}`, e)
      return null
    }
  }

  /** Fetch the mentionable users for the repository. */
  public async fetchMentionables(
    owner: string,
    name: string,
    etag: string | null
  ): Promise<IAPIMentionablesResponse | null> {
    // NB: this custom `Accept` is required for the `mentionables` endpoint.
    const headers: any = {
      Accept: 'application/vnd.github.jerry-maguire-preview',
    }

    if (etag) {
      headers['If-None-Match'] = etag
    }

    try {
      const path = `repos/${owner}/${name}/mentionables/users`
      const response = await this.request('GET', path, undefined, headers)

      if (response.status === HttpStatusCode.NotFound) {
        log.warn(`fetchMentionables: '${path}' returned a 404`)
        return null
      }

      if (response.status === HttpStatusCode.NotModified) {
        return null
      }
      const users = await parsedResponse<ReadonlyArray<IAPIMentionableUser>>(
        response
      )
      const etag = response.headers.get('etag')
      return { users, etag }
    } catch (e) {
      log.warn(`fetchMentionables: failed for ${owner}/${name}`, e)
      return null
    }
  }

  /**
   * Retrieve the public profile information of a user with
   * a given username.
   */
  public async fetchUser(login: string): Promise<IAPIFullIdentity | null> {
    try {
      const response = await this.request(
        'GET',
        `users/${encodeURIComponent(login)}`
      )

      if (response.status === 404) {
        return null
      }

      return await parsedResponse<IAPIFullIdentity>(response)
    } catch (e) {
      log.warn(`fetchUser: failed with endpoint ${this.endpoint}`, e)
      throw e
    }
  }
}

export enum AuthorizationResponseKind {
  Authorized,
  Failed,
  TwoFactorAuthenticationRequired,
  UserRequiresVerification,
  PersonalAccessTokenBlocked,
  Error,
  EnterpriseTooOld,
}

export type AuthorizationResponse =
  | { kind: AuthorizationResponseKind.Authorized; token: string }
  | { kind: AuthorizationResponseKind.Failed; response: Response }
  | {
      kind: AuthorizationResponseKind.TwoFactorAuthenticationRequired
      type: AuthenticationMode
    }
  | { kind: AuthorizationResponseKind.Error; response: Response }
  | { kind: AuthorizationResponseKind.UserRequiresVerification }
  | { kind: AuthorizationResponseKind.PersonalAccessTokenBlocked }
  | { kind: AuthorizationResponseKind.EnterpriseTooOld }

/**
 * Create an authorization with the given login, password, and one-time
 * password.
 */
export async function createAuthorization(
  endpoint: string,
  login: string,
  password: string,
  oneTimePassword: string | null
): Promise<AuthorizationResponse> {
  const creds = Buffer.from(`${login}:${password}`, 'utf8').toString('base64')
  const authorization = `Basic ${creds}`
  const optHeader = oneTimePassword ? { 'X-GitHub-OTP': oneTimePassword } : {}

  const note = await getNote()

  const response = await request(
    endpoint,
    null,
    'POST',
    'authorizations',
    {
      scopes: Scopes,
      client_id: ClientID,
      client_secret: ClientSecret,
      note: note,
      note_url: NoteURL,
      fingerprint: uuid(),
    },
    {
      Authorization: authorization,
      ...optHeader,
    }
  )

  try {
    const result = await parsedResponse<IAPIAuthorization>(response)
    if (result) {
      const token = result.token
      if (token && typeof token === 'string' && token.length) {
        return { kind: AuthorizationResponseKind.Authorized, token }
      }
    }
  } catch (e) {
    if (response.status === 401) {
      const otpResponse = response.headers.get('x-github-otp')
      if (otpResponse) {
        const pieces = otpResponse.split(';')
        if (pieces.length === 2) {
          const type = pieces[1].trim()
          switch (type) {
            case 'app':
              return {
                kind: AuthorizationResponseKind.TwoFactorAuthenticationRequired,
                type: AuthenticationMode.App,
              }
            case 'sms':
              return {
                kind: AuthorizationResponseKind.TwoFactorAuthenticationRequired,
                type: AuthenticationMode.Sms,
              }
            default:
              return { kind: AuthorizationResponseKind.Failed, response }
          }
        }
      }

      return { kind: AuthorizationResponseKind.Failed, response }
    }

    const apiError = e instanceof APIError && e.apiError
    if (apiError) {
      if (
        response.status === 403 &&
        apiError.message ===
          'This API can only be accessed with username and password Basic Auth'
      ) {
        // Authorization API does not support providing personal access tokens
        return { kind: AuthorizationResponseKind.PersonalAccessTokenBlocked }
      } else if (response.status === 422) {
        if (apiError.errors) {
          for (const error of apiError.errors) {
            const isExpectedResource =
              error.resource.toLowerCase() === 'oauthaccess'
            const isExpectedField = error.field.toLowerCase() === 'user'
            if (isExpectedField && isExpectedResource) {
              return {
                kind: AuthorizationResponseKind.UserRequiresVerification,
              }
            }
          }
        } else if (
          apiError.message === 'Invalid OAuth application client_id or secret.'
        ) {
          return { kind: AuthorizationResponseKind.EnterpriseTooOld }
        }
      }
    }
  }

  return { kind: AuthorizationResponseKind.Error, response }
}

/** Fetch the user authenticated by the token. */
export async function fetchUser(
  endpoint: string,
  token: string
): Promise<Account> {
  const api = new API(endpoint, token)
  try {
    const user = await api.fetchAccount()
    const emails = await api.fetchEmails()
    const defaultEmail = getDefaultEmail(emails)
    const avatarURL = getAvatarWithEnterpriseFallback(
      user.avatar_url,
      defaultEmail,
      endpoint
    )
    return new Account(
      user.login,
      endpoint,
      token,
      emails,
      avatarURL,
      user.id,
      user.name || user.login
    )
  } catch (e) {
    log.warn(`fetchUser: failed with endpoint ${endpoint}`, e)
    throw e
  }
}

/** Get metadata from the server. */
export async function fetchMetadata(
  endpoint: string
): Promise<IServerMetadata | null> {
  const url = `${endpoint}/meta`

  try {
    const response = await request(endpoint, null, 'GET', 'meta', undefined, {
      'Content-Type': 'application/json',
    })

    const result = await parsedResponse<IServerMetadata>(response)
    if (!result || result.verifiable_password_authentication === undefined) {
      return null
    }

    return result
  } catch (e) {
    log.error(
      `fetchMetadata: unable to load metadata from '${url}' as a fallback`,
      e
    )
    return null
  }
}

/** The note used for created authorizations. */
async function getNote(): Promise<string> {
  let localUsername = 'unknown'
  try {
    localUsername = await username()
  } catch (e) {
    log.error(
      `getNote: unable to resolve machine username, using '${localUsername}' as a fallback`,
      e
    )
  }

  return `GitHub Desktop on ${localUsername}@${OS.hostname()}`
}

/**
 * Map a repository's URL to the endpoint associated with it. For example:
 *
 * https://github.com/desktop/desktop -> https://api.github.com
 * http://github.mycompany.com/my-team/my-project -> http://github.mycompany.com/api
 */
export function getEndpointForRepository(url: string): string {
  const parsed = URL.parse(url)
  if (parsed.hostname === 'github.com') {
    return getDotComAPIEndpoint()
  } else {
    return `${parsed.protocol}//${parsed.hostname}/api`
  }
}

/**
 * Get the URL for the HTML site. For example:
 *
 * https://api.github.com -> https://github.com
 * http://github.mycompany.com/api -> http://github.mycompany.com/
 */
export function getHTMLURL(endpoint: string): string {
  // In the case of GitHub.com, the HTML site lives on the parent domain.
  //  E.g., https://api.github.com -> https://github.com
  //
  // Whereas with Enterprise Server, it lives on the same domain but without the
  // API path:
  //  E.g., https://github.mycompany.com/api/v3 -> https://github.mycompany.com
  //
  // We need to normalize them.
  if (endpoint === getDotComAPIEndpoint()) {
    return 'https://github.com'
  } else {
    const parsed = URL.parse(endpoint)
    return `${parsed.protocol}//${parsed.hostname}`
  }
}

/**
 * Get the API URL for an HTML URL. For example:
 *
 * http://github.mycompany.com -> http://github.mycompany.com/api/v3
 */
export function getEnterpriseAPIURL(endpoint: string): string {
  const parsed = URL.parse(endpoint)
  return `${parsed.protocol}//${parsed.hostname}/api/v3`
}

/** Get github.com's API endpoint. */
export function getDotComAPIEndpoint(): string {
  // NOTE:
  // `DESKTOP_GITHUB_DOTCOM_API_ENDPOINT` only needs to be set if you are
  // developing against a local version of GitHub the Website, and need to debug
  // the server-side interaction. For all other cases you should leave this
  // unset.
  const envEndpoint = process.env['DESKTOP_GITHUB_DOTCOM_API_ENDPOINT']
  if (envEndpoint && envEndpoint.length > 0) {
    return envEndpoint
  }

  return 'https://api.github.com'
}

/** Get the account for the endpoint. */
export function getAccountForEndpoint(
  accounts: ReadonlyArray<Account>,
  endpoint: string
): Account | null {
  return accounts.find(a => a.endpoint === endpoint) || null
}

export function getOAuthAuthorizationURL(
  endpoint: string,
  state: string
): string {
  const urlBase = getHTMLURL(endpoint)
  const scope = encodeURIComponent(Scopes.join(' '))
  return `${urlBase}/login/oauth/authorize?client_id=${ClientID}&scope=${scope}&state=${state}`
}

export async function requestOAuthToken(
  endpoint: string,
  code: string
): Promise<string | null> {
  try {
    const urlBase = getHTMLURL(endpoint)
    const response = await request(
      urlBase,
      null,
      'POST',
      'login/oauth/access_token',
      {
        client_id: ClientID,
        client_secret: ClientSecret,
        code: code,
      }
    )
    const result = await parsedResponse<IAPIAccessToken>(response)
    return result.access_token
  } catch (e) {
    log.warn(`requestOAuthToken: failed with endpoint ${endpoint}`, e)
    return null
  }
}
