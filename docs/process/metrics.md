# GitHub Desktop Metrics
Desktop is a free, open source product that is maintained and worked on by the small, distributed team of @desktop/core, @desktop/comrades, and the general open-source community. As a result, we do not have the resources to do continuous, detailed user studies of GitHub Desktop users and usage. In other words, we love you, we want to build the right features to help you, and yet we don't know enough about you as a whole to make informed prioritization decisions.

We measure certain events in the GitHub Desktop app in order to learn more about how you are using the app. This helps us prioritize features and bugs and understand what things are most important to the largest number of people. Our understanding of these metrics is supplemented by some user research, usability testing, and feedback from the community. This document is intended to provide information about each thing we're measuring and what we're using it for.

You can always see our recently released user-facing features and fixes in the [release notes](https://desktop.github.com/release-notes/) of our marketing page, and example usage data [here](https://desktop.github.com/usage-data/).

## Dimensions
These are general metrics about users that are aggregated to understand general user behavior and to help us segment usage patterns. These helps us prioritize work, predict technical and performance implications of our features, and plan for devOps needs.

| Metric | Description | Justification |
|:--|:--|:--|
| `dotComAccount` | Flag that is set if the user is logged in with a GitHub.com account | Informs us on the percentage of people who use Desktop with GitHub.com, so we can more accurately prioritize GitHub workflows in Desktop. |
| `enterpriseAccount` | Flag that is set if the user is logged in with a GitHub Enterprise Server account. | Informs us on the percentage of people who use Desktop with an Enterprise Server instance of GitHub, so we can more accurately prioritize Enterprise-related bugs. |
| `eventType` | Always set to usage. | Specifies that this data is related to GitHub Desktop usage, so we can filter it correctly in our analytics. |
| `gitHubRepositoryCount` | The number of GitHub repositories. | To understand the typical number of repositories tracked in Desktop that are hosted on GitHub, so we can more accurately prioritize GitHub workflows in Desktop. |
| `guid` | The unique ID of a Desktop installation. | This allows us to aggregate metrics across multiple days, so we can understand how many people use Desktop per week or per month, and how many people use a particular feature per month.  |
| `osVersion` | The OS version. | To identify the most common versions of operating systems people use Desktop on, so we can more accurately prioritize version-specific bugs. |
| `platform` | The OS. | To understand which platforms are most popular among people who use Desktop, so we can more accurately prioritize platform-specific bugs.  |
| `repositoryCount` | The total number of tracked repositories in Desktop. | To understand the typical number of repositories tracked in Desktop, so we can make appropriate decisions in terms of performance and UI. |
| `selectedTerminalEmulator` | The name of the currently selected terminal emulator at the time of stats submission. | To understand what percentage of people have a shell detected and what the most common ones are as certain features allow for opening in shell. |
| `selectedTextEditor` | The name of the currently selected text editor at the time of stats submission. | To understand what percentage of people have an editor detected and what the most common ones are as certain features send users to their editor. |
| `theme` | The name of the currently selected theme/application appearance as set at time of stats submission. | To understand usage patterns of the Dark Theme feature, so we can more accurately prioritize theme-related bugs. |
| `version` | The version of Desktop. | To visualize update rates and performance metrics for each version of Desktop, so we can track whether users are staying up-to-date and which older versions are active. |

## Measures
These are general metrics about feature usage and specific feature behaviors. These help us understand our users' mental map of the application, hypothesize pain points within the application, and aid in feature and bugfix planning so that we can improve workflows that are more likely to benefit users.

<!-- The `active` field is marked with an `*` because it's actually a dimension that was defined as a measure. Since it is represented in source that way, it is mimiced in this doc. -->
| Metric | Description | Justification |
|:--|:--|:--|
| `active*` | Flag indicating whether the app has been interacted with during the current reporting window. | To identify users who are actively using Desktop versus those who have it open but never interact with it. |
| `anyConflictsLeftOnMergeConflictsDialogDismissalCount` | The number of times there were any merge conflicts present when the Merge Conflicts Dialog is dismissed. | To understand whether people dismiss the dialog after resolving conflicts for one last check or just want to back out of the guided flow entirely. |
| `branchComparisons` | The number of times a branch is compared to an arbitrary branch. | To understand usage patterns around the compare branches feature. |
| `coAuthoredCommits` | The number of commits created with one or more co-authors. | To understand usage patterns of commits made in Desktop. |
| `commits` | The number of commits made. | To understand usage patterns of commits made in Desktop. |
| `commitsToProtectedBranch` | The number of commits made to a protected branch. | To understand whether the app could guide users depending on the repository configuration. |
| `commitsToRepositoryWithBranchProtections` | The number of commits made to a repository which has branch protections enabled. | To understand whether the app could guide users depending on the repository configuration. |
| `createPullRequestCount` | The number of times the user is taken to the create pull request page on GitHub.com. | To understand how people are creating pull requests via Desktop. |
| `defaultBranchComparisons` | The number of times a branch is compared to the default branch. | To understand usage patterns around the compare branches feature. |
| `divergingBranchBannerDismissal` | The number of times the user dismisses the diverged branch notification. | To understand usage patterns around the notification of diverging from the default branch feature. |
| `divergingBranchBannerDisplayed` | The number of times the diverged branch notification is displayed. | To understand usage patterns around the notification of diverging from the default branch feature. |
| `divergingBranchBannerInfluencedMerge` | The number of times the user merges from the compare view after getting to that state from the diverged branch notification compare CTA button. | To understand usage patterns around the notification of diverging from the default branch feature. |
| `divergingBranchBannerInitatedMerge` | The number of times the user merges from the diverged branch notification merge CTA button. | To understand usage patterns around the notification of diverging from the default branch feature. |
| `divergingBranchBannerInitiatedCompare` | The number of times the user compares from the diverged branch notification compare CTA button. | To understand usage patterns around the notification of diverging from the default branch feature. |
| `dotcomCommits` | The number of time the user made a commit to a repo hosted on Github.com. | To understand the total percentage of commits made to GitHub repos compared to GitHub Enterprise Server and other remotes to help prioritize our work and focus areas |
| `dotcomPushCount` | The number of time the user pushed commits to a repo hosted on Github.com. | To understand how often users are pushing their work to a GitHub remote |
| `dotcomForcePushCount` | The number of time the user pushed commits to a repo hosted on Github.com with `--force-with-lease` enabled. | To understand how often users are pushing their work and rewriting history to a GitHub remote |
| `enterpriseCommits` | The number of times the user made a commit to a repo hosted on a GitHub Enterprise Server instance. | To understand the total percentage of commits made to GitHub Enterprise Server repos to help prioritize our work associated with enterprise use of GitHub Desktop compared to GitHub |
| `enterprisePushCount` | The number of time the user pushed commits to a repo hosted on GitHub Enterprise Server. | To understand how often users are pushing their work to a GitHub Enterprise Server remote  |
| `enterpriseForcePushCount` | The number of time the user pushed commits to a repo hosted on GitHub Enterprise Server with `--force-with-lease` enabled. | To understand how often users are pushing their work and rewriting history to a GitHub Enterprise Server remote |
| `externalPushCount` | The number of time the user pushed commits to a repo not hosted on GitHub or GitHub Enterprise Server. | To understand how often users are pushing their work to a non-GitHub remote |
| `externalForcePushCount` | The number of time the user pushed commits to a repo not hosted on GitHub or GitHub Enterprise Server with `--force-with-lease` enabled. | To understand how often users are pushing their work and rewriting history to a non-GitHub remote |
| `guidedConflictedMergeCompletionCount` | The number of times a conflicted merge is completed from the Merge Conflicts Dialog. | To understand how many times people prefer to finish the merge in the guided flow after resolving conflicts. |
| `loadTime` | The time (in milliseconds) it takes from when loading begins to loading end. | To make sure new versions of Desktop are not regressing on performance. |
| `mainReadyTime` | The time (in milliseconds) it takes from when our main process code is first loaded until the app `ready` event is emitted. | To make sure new versions of Desktop are not regressing on performance. |
| `mergeAbortedAfterConflictsCount` | The number of times the user aborts a merge after a merge conflict. | To understand the frequency of merges that are never completed after attempting to merge and hitting a merge conflict |
| `mergeConflictFromExplicitMergeCount` | The number of times a `git merge` initiated by Desktop resulted in a merge conflict for the user. | To understand how often people encounter a merge conflict in Desktop. |
| `mergeConflictFromPullCount` | The number of times a `git pull` initiated by Desktop resulted in a merge conflict for the user. | To understand how often people encounter a merge conflict in Desktop. |
| `mergeConflictsDialogDismissalCount` | The number of times the Merge Conflicts Dialog is dismissed. | To understand how frequently people prefer a different merge conflicts flow than the guided one. |
| `mergeConflictsDialogReopenedCount` | The number of times the Merge Conflicts Dialog is reopened from the Merge Conflicts Banner. | To understand whether people find value in both the guided and unguided merge conflicts flow. |
| `mergedWithCleanMergeHintCount` | The number of times the user has merged after seeing the 'no conflicts' merge hint. | To understand how many "clean" merges there are |
| `mergedWithConflictWarningHintCount` | The number of times the user has merged after seeing the 'you have XX conflicted files' warning. | To understand how frequently people are merging even though they know there will be conflicts |
| `mergedWithLoadingHintCount` | The number of times the user merged before seeing the result of the merge hint. | To understand how many people are merging before learning whether there will be conflicts or not |
| `mergeIntoCurrentBranchMenuCount` | The number of times the `Branch -> Merge Into Current Branch` menu item is used. | To understand usage patterns around the compare branches feature. |
| `mergesInitiatedFromComparison` | The number of times a merge is initiated in the `compare` sidebar. | To understand usage patterns around the compare branches feature. |
| `mergeSuccessAfterConflictsCount` | The number of times the user successfully completes a merge after a merge conflict. | To understand how effectively users are able to resolve conflicts and complete their merge successfully |
| `openShellCount` | The number of times the user has opened a shell from the app. | To understand if people need to use the command line because of missing features. |
| `partialCommits` | The number of partial commits. | To understand usage patterns of commits made in Desktop. |
| `prBranchCheckouts` | The number of times the user checks out a branch using the PR menu. | To understand usage patterns around the PR checkout menu. |
| `pullWithDefaultSettingCount` | The number of times a user has pulled with `pull.rebase` unset or set to `false`. | To understand how many users have "pull with rebase" enabled as part of their workflow. |
| `pullWithRebaseCount` |  The number of times a user performed a pull with `pull.rebase` in config set to `true`. | To understand how many users have "pull with rebase" enabled as part of their workflow. |
| `rebaseAbortedAfterConflictsCount` | The number of times an aborted rebase is detected in the app. | To understand whether users are exiting the rebase conflicts flow after encountering trouble. |
| `rebaseConflictsDialogDismissalCount` | The number of times the rebase conflicts dialog is dismissed. | To understand how users respond when they encounter rebase conflicts. |
| `rebaseConflictsDialogReopenedCount` | The number of times the rebase conflicts dialog is reopened. |To understand how users respond when they encounter rebase conflicts. |
| `rebaseCurrentBranchMenuCount` | The number of times the `Branch -> Rebase Current Branch` menu item is used. | To understand how often users start a rebase in the app. |
| `rebaseSuccessAfterConflictsCount` |  The number of times a successful rebase is made in the app after the user resolved conflicts. | To understand whether users are able to complete the rebase conflicts flow. |
| `rebaseSuccessWithoutConflictsCount` | The number of times a successful rebase is made in the app without the user needing to resolve conflicts. | To understand how frequently people are rebasing compared to merging. |
| `rendererReadyTime` | The time (in milliseconds) it takes from when our renderer process code is first loaded until the renderer `ready` event is emitted. | To make sure new versions of Desktop are not regressing on performance. |
| `repoWithIndicatorClicked` | The numbers of times a repo with indicators is clicked on repo list view. | To understand usage patterns around the repository indicators feature. |
| `repoWithoutIndicatorClicked` | The numbers of times a repo without indicators is clicked on repo list view.  | To understand usage patterns around the repository indicators feature. |
| `unattributedCommits` | The number of commits that will go unattributed to GitHub users. | To understand how frequently commits in GitHub Desktop are unattributed and how highly we should prioritize design for those instances |
| `unguidedConflictedMergeCompletionCount` | The number of times a conflicted merge is completed from the diff/changes view. | To understand how many times people prefer to finish the merge in the changes/diff view after resolving conflicts. |
| `updateFromDefaultBranchMenuCount` | The number of times the `Branch -> Update From Default Branch` menu item is used. | To understand usage patterns around the compare branches feature. |
| `stashEntriesCreatedOutsideDesktop` | The number of stash entries created outside of Desktop | To understand how much of an impact Desktop has in reducing context switching. |
| `errorWhenSwitchingBranchesWithUncommmittedChanges` | The number of times the user is presented with the error message "Some of your changes would be overwritten" | To understand the potential impact of stashing in reducing the number of errors experienced when switching branches. |
