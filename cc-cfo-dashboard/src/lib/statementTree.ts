export interface StatementTreeLikeRow {
  id: string;
  depth?: number;
}

function getDepth(row: StatementTreeLikeRow) {
  return row.depth ?? 0;
}

export function getExpandableRowIds<T extends StatementTreeLikeRow>(rows: T[]) {
  const ids = new Set<string>();

  for (let index = 0; index < rows.length - 1; index += 1) {
    if (getDepth(rows[index + 1]) > getDepth(rows[index])) {
      ids.add(rows[index].id);
    }
  }

  return ids;
}

export function getVisibleTreeRows<T extends StatementTreeLikeRow>(rows: T[], collapsedRowIds: Set<string>) {
  const visibleRows: T[] = [];
  const expandableRowIds = getExpandableRowIds(rows);
  const hiddenDepths: number[] = [];

  rows.forEach((row) => {
    const depth = getDepth(row);

    while (hiddenDepths.length && depth <= hiddenDepths[hiddenDepths.length - 1]) {
      hiddenDepths.pop();
    }

    if (hiddenDepths.length) {
      return;
    }

    visibleRows.push(row);

    if (expandableRowIds.has(row.id) && collapsedRowIds.has(row.id)) {
      hiddenDepths.push(depth);
    }
  });

  return visibleRows;
}
