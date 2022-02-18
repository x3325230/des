import { getDotComAPIEndpoint, IAPIEmail } from '../lib/api'

/**
 * A GitHub account, representing the user found on GitHub The Website or GitHub Enterprise Server.
 *
 * This contains a token that will be used for operations that require authentication.
 */
export class Account {
  /** Create an account which can be used to perform unauthenticated API actions */
  public static anonymous(): Account {
    return new Account('', getDotComAPIEndpoint(), '', [], '', -1, '')
  }

  /**
   * Create an instance of an account
   *
   * @param login The login name for this account
   * @param endpoint The server for this account - GitHub or a GitHub Enterprise Server instance
   * @param token The access token used to perform operations on behalf of this account
   * @param emails The current list of email addresses associated with the account
   * @param avatarURL The profile URL to render for this account
   * @param id The GitHub.com or GitHub Enterprise Server database id for this account.
   * @param name The friendly name associated with this account
   */
  public constructor(
    public readonly login: string,
    public readonly endpoint: string,
    public readonly token: string,
    public readonly emails: ReadonlyArray<IAPIEmail>,
    public readonly avatarURL: string,
    public readonly id: number,
    public readonly name: string
  ) {}

  public withToken(token: string): Account {
    return new Account(
      this.login,
      this.endpoint,
      token,
      this.emails,
      this.avatarURL,
      this.id,
      this.name
    )
  }
}
