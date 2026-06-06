"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

export interface StratosDataTableCellContext {
  rowIndex: number;
  rowId: string;
  columnId: string;
}

export interface StratosDataTableColumn<Row> {
  id: string;
  label: ReactNode;
  width?: number | string;
  align?: "start" | "center" | "end";
  className?: string;
  headerClassName?: string;
  sortable?: boolean;
  sortAccessor?: (row: Row) => Date | number | string | null | undefined;
  render: (row: Row, context: StratosDataTableCellContext) => ReactNode;
}

type StratosDataTableSortDirection = "asc" | "desc";

export interface StratosDataTableProps<Row> {
  rows: Row[];
  columns: Array<StratosDataTableColumn<Row>>;
  getRowId: (row: Row) => string;
  getRowClassName?: (row: Row) => string | undefined;
  selectableRows?: boolean;
  selectedRowIds?: Iterable<string>;
  onSelectedRowIdsChange?: (selectedRowIds: string[]) => void;
  filterRow?: ReactNode;
  emptyLabel?: ReactNode;
  className?: string;
  "aria-label"?: string;
  onRowClick?: (row: Row, event: MouseEvent<HTMLDivElement>) => void;
}

function normalizeWidth(width: StratosDataTableColumn<unknown>["width"]) {
  if (typeof width === "number") {
    return `${width}px`;
  }
  return width ?? "minmax(140px, 1fr)";
}

export function StratosDataTable<Row>({
  rows,
  columns,
  getRowId,
  getRowClassName,
  selectableRows = false,
  selectedRowIds,
  onSelectedRowIdsChange,
  filterRow,
  emptyLabel = "No rows",
  className,
  "aria-label": ariaLabel,
  onRowClick
}: StratosDataTableProps<Row>) {
  const selectedRowIdSet = new Set(selectedRowIds ?? []);
  const [sortState, setSortState] = useState<{ columnId: string; direction: StratosDataTableSortDirection } | null>(null);
  const visibleColumns = selectableRows
    ? [
        {
          id: "__select",
          label: "",
          width: 44,
          align: "center" as const,
          render: () => null
        },
        ...columns
      ]
    : columns;
  const tableStyle = {
    "--stratos-data-table-template": visibleColumns.map((column) => normalizeWidth(column.width)).join(" ")
  } as CSSProperties;
  const sortedRows = useMemo(() => {
    if (!sortState) {
      return rows;
    }
    const sortedColumn = columns.find((column) => column.id === sortState.columnId);
    if (!sortedColumn?.sortAccessor) {
      return rows;
    }
    return [...rows].sort((left, right) => {
      const leftValue = normalizeSortValue(sortedColumn.sortAccessor?.(left));
      const rightValue = normalizeSortValue(sortedColumn.sortAccessor?.(right));
      if (leftValue === rightValue) {
        return 0;
      }
      if (leftValue === null) {
        return 1;
      }
      if (rightValue === null) {
        return -1;
      }
      const direction = sortState.direction === "asc" ? 1 : -1;
      return leftValue > rightValue ? direction : -direction;
    });
  }, [columns, rows, sortState]);
  const allVisibleRowIds = sortedRows.map(getRowId);
  const allVisibleRowsSelected = allVisibleRowIds.length > 0 && allVisibleRowIds.every((rowId) => selectedRowIdSet.has(rowId));

  function toggleSort(column: StratosDataTableColumn<Row>) {
    if (!column.sortable || !column.sortAccessor) {
      return;
    }
    setSortState((current) => {
      if (current?.columnId !== column.id) {
        return { columnId: column.id, direction: "asc" };
      }
      if (current.direction === "asc") {
        return { columnId: column.id, direction: "desc" };
      }
      return null;
    });
  }

  function toggleRow(rowId: string) {
    const nextSelected = new Set(selectedRowIdSet);
    if (nextSelected.has(rowId)) {
      nextSelected.delete(rowId);
    } else {
      nextSelected.add(rowId);
    }
    onSelectedRowIdsChange?.(Array.from(nextSelected));
  }

  function toggleAllVisibleRows() {
    const nextSelected = new Set(selectedRowIdSet);
    if (allVisibleRowsSelected) {
      allVisibleRowIds.forEach((rowId) => nextSelected.delete(rowId));
    } else {
      allVisibleRowIds.forEach((rowId) => nextSelected.add(rowId));
    }
    onSelectedRowIdsChange?.(Array.from(nextSelected));
  }

  return (
    <div className={["stratos-data-table", className ?? ""].filter(Boolean).join(" ")} style={tableStyle} role="table" aria-label={ariaLabel}>
      <div className="stratos-data-table-header" role="row">
        {visibleColumns.map((column, columnIndex) => (
          <div
            className={["stratos-data-table-header-cell", column.align ? `is-${column.align}` : "", column.headerClassName ?? ""]
              .filter(Boolean)
              .join(" ")}
            key={column.id}
            role="columnheader"
            data-column-id={column.id}
            data-column-index={columnIndex}
          >
            {column.id === "__select" && selectableRows ? (
              <input
                aria-label="Select all visible rows"
                checked={allVisibleRowsSelected}
                className="stratos-data-table-checkbox"
                type="checkbox"
                onChange={toggleAllVisibleRows}
              />
            ) : column.sortable ? (
              <button
                className="stratos-data-table-sort"
                type="button"
                aria-label={`Sort by ${String(column.label)}`}
                aria-sort={sortState?.columnId === column.id ? (sortState.direction === "asc" ? "ascending" : "descending") : "none"}
                onClick={() => toggleSort(column)}
              >
                <span>{column.label}</span>
                {sortState?.columnId === column.id ? (
                  sortState.direction === "asc" ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />
                ) : (
                  <ArrowUpDown size={14} aria-hidden="true" />
                )}
              </button>
            ) : (
              column.label
            )}
          </div>
        ))}
      </div>
      {filterRow ? (
        <div className="stratos-data-table-filter-row" role="row">
          {filterRow}
        </div>
      ) : null}
      <div className="stratos-data-table-body" role="rowgroup">
        {sortedRows.length === 0 ? (
          <div className="stratos-data-table-empty">{emptyLabel}</div>
        ) : (
          sortedRows.map((row, rowIndex) => {
            const rowId = getRowId(row);
            const isSelected = selectedRowIdSet.has(rowId);
            return (
              <div
                className={["stratos-data-table-row", isSelected ? "is-selected" : "", onRowClick ? "is-clickable" : "", getRowClassName?.(row)]
                  .filter(Boolean)
                  .join(" ")}
                key={rowId}
                role="row"
                aria-selected={isSelected || undefined}
                data-row-index={rowIndex}
                data-stratos-table-row="true"
                onClick={onRowClick ? (event) => onRowClick(row, event) : undefined}
              >
                {selectableRows ? (
                  <div className="stratos-data-table-cell is-center" role="cell" data-column-id="__select" data-column-index={0}>
                    <input
                      aria-label={`Select row ${rowIndex + 1}`}
                      checked={isSelected}
                      className="stratos-data-table-checkbox"
                      type="checkbox"
                      onChange={() => toggleRow(rowId)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </div>
                ) : null}
                {columns.map((column, columnIndex) => {
                  const renderedColumnIndex = selectableRows ? columnIndex + 1 : columnIndex;
                  return (
                    <div
                      className={["stratos-data-table-cell", column.align ? `is-${column.align}` : "", column.className ?? ""]
                        .filter(Boolean)
                        .join(" ")}
                      key={column.id}
                      role="cell"
                      tabIndex={0}
                      data-column-id={column.id}
                      data-column-index={renderedColumnIndex}
                    >
                      {column.render(row, { rowIndex, rowId, columnId: column.id })}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function normalizeSortValue(value: Date | number | string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    return value.toLocaleLowerCase();
  }
  return value;
}
