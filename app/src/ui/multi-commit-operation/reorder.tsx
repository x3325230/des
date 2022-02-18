import { RebaseConflictState } from '../../lib/app-state'
import { MultiCommitOperationKind } from '../../models/multi-commit-operation'
import { BaseMultiCommitOperation } from './base-multi-commit-operation'

export abstract class Reorder extends BaseMultiCommitOperation {
  protected onBeginOperation = () => {
    const {
      repository,
      dispatcher,
      state: { operationDetail },
    } = this.props

    if (operationDetail.kind !== MultiCommitOperationKind.Reorder) {
      this.endFlowInvalidState()
      return
    }

    const { beforeCommit, lastRetainedCommitRef, commits } = operationDetail

    return dispatcher.reorderCommits(
      repository,
      commits,
      beforeCommit,
      lastRetainedCommitRef,
      true
    )
  }

  protected onContinueAfterConflicts = async (): Promise<void> => {
    const {
      repository,
      dispatcher,
      workingDirectory,
      conflictState,
      state: { operationDetail },
    } = this.props

    if (
      conflictState === null ||
      operationDetail.kind !== MultiCommitOperationKind.Reorder
    ) {
      this.endFlowInvalidState()
      return
    }

    const {
      commits,
      currentTip,
      targetBranch,
      originalBranchTip,
    } = operationDetail

    await dispatcher.switchMultiCommitOperationToShowProgress(repository)

    const rebaseConflictState: RebaseConflictState = {
      kind: 'rebase',
      currentTip,
      targetBranch: targetBranch.name,
      baseBranch: undefined,
      originalBranchTip,
      baseBranchTip: currentTip,
      manualResolutions: conflictState.manualResolutions,
    }

    const rebaseResult = await dispatcher.continueRebase(
      MultiCommitOperationKind.Reorder,
      repository,
      workingDirectory,
      rebaseConflictState
    )

    return dispatcher.processMultiCommitOperationRebaseResult(
      MultiCommitOperationKind.Reorder,
      repository,
      rebaseResult,
      commits.length,
      targetBranch.name
    )
  }

  protected onAbort = async (): Promise<void> => {
    const { repository, dispatcher } = this.props
    this.onFlowEnded()
    return dispatcher.abortRebase(repository)
  }

  protected onConflictsDialogDismissed = () => {
    this.onInvokeConflictsDialogDismissed('reordering commits on')
  }
}
