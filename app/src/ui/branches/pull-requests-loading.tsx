import * as React from 'react'
import { FilterList, IFilterListItem } from '../lib/filter-list'
import {
  PullRequestListItem,
  IPullRequestListItemProps,
} from './pull-request-list-item'
import { RowHeight } from './pull-request-list'

const FacadeCount = 6

const prLoadingItemProps: IPullRequestListItemProps = {
  loading: true,
  author: '',
  created: new Date(0),
  number: 0,
  title: '',
  matches: { title: [], subtitle: [] },
  status: {
    sha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    totalCount: 1,
    state: 'pending',
    pullRequestNumber: 0,
    statuses: [],
  },
}

/** The placeholder for when pull requests are still loading. */
export class PullRequestsLoading extends React.Component<{}, {}> {
  public render() {
    const items: Array<IFilterListItem> = []
    for (let i = 0; i < FacadeCount; i++) {
      items.push({
        text: [''],
        id: i.toString(),
      })
    }

    const groups = [
      {
        identifier: '',
        items,
      },
    ]

    return (
      <FilterList<IFilterListItem>
        className="pull-request-list"
        rowHeight={RowHeight}
        groups={groups}
        selectedItem={null}
        renderItem={this.renderItem}
        invalidationProps={groups}
        disabled={true}
      />
    )
  }

  private renderItem = (item: IFilterListItem) => {
    return <PullRequestListItem {...prLoadingItemProps} />
  }
}
