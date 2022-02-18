import { Repository } from './repository'
import { CloneOptions } from './clone-options'
import { Branch } from './branch'

/** The types of actions that can be retried. */
export enum RetryActionType {
  Push = 1,
  Pull,
  Fetch,
  Clone,
  Checkout,
  Merge,
  Rebase,
}

/** The retriable actions and their associated data. */
export type RetryAction =
  | { type: RetryActionType.Push; repository: Repository }
  | { type: RetryActionType.Pull; repository: Repository }
  | { type: RetryActionType.Fetch; repository: Repository }
  | {
      type: RetryActionType.Clone
      name: string
      url: string
      path: string
      options: CloneOptions
    }
  | {
      type: RetryActionType.Checkout
      repository: Repository
      branch: Branch
    }
  | {
      type: RetryActionType.Merge
      repository: Repository
      currentBranch: string
      theirBranch: string
    }
  | {
      type: RetryActionType.Rebase
      repository: Repository
      baseBranch: Branch
      targetBranch: Branch
    }
