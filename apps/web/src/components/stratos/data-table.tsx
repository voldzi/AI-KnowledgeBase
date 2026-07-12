"use client";

import { DataTable, type DataTableColumn, type DataTableProps } from "@voldzi/stratos-ui";
import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_PREFIX = "akb:data-table-widths:v1:";

type ColumnWidths = Record<string, number>;

export type StratosDataTableColumn<Row> = DataTableColumn<Row>;

export type StratosDataTableProps<Row> = DataTableProps<Row> & {
  /** Stable identifier used to persist widths. Falls back to the table label and column ids. */
  columnWidthStorageKey?: string;
};

function storageKey<Row>(props: StratosDataTableProps<Row>): string {
  const identity = props.columnWidthStorageKey
    ?? [props["aria-label"] ?? "table", ...props.columns.map((column) => column.id)].join(":");
  return `${STORAGE_PREFIX}${identity}`;
}

function readColumnWidths(key: string): ColumnWidths {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1])
      )
    );
  } catch {
    return {};
  }
}

function clampColumnWidth<Row>(column: DataTableColumn<Row>, width: number): number {
  return Math.min(column.maxWidth ?? 720, Math.max(column.minWidth ?? 64, Math.round(width)));
}

export function StratosDataTable<Row>(props: StratosDataTableProps<Row>) {
  const { columnWidthStorageKey: _columnWidthStorageKey, columns, onColumnResize, ...tableProps } = props;
  const key = storageKey(props);
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>({});

  useEffect(() => {
    setColumnWidths(readColumnWidths(key));
  }, [key]);

  const resizableColumns = useMemo(
    () => columns.map((column) => {
      const storedWidth = columnWidths[column.id];
      return storedWidth === undefined
        ? column
        : { ...column, width: clampColumnWidth(column, storedWidth) };
    }),
    [columnWidths, columns]
  );

  const handleColumnResize = useCallback((columnId: string, width: number) => {
    const column = columns.find((candidate) => candidate.id === columnId);
    if (!column || column.resizable === false) {
      return;
    }
    const nextWidth = clampColumnWidth(column, width);
    setColumnWidths((current) => {
      const next = { ...current, [columnId]: nextWidth };
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Resizing must keep working when browser storage is unavailable.
      }
      return next;
    });
    onColumnResize?.(columnId, nextWidth);
  }, [columns, key, onColumnResize]);

  return (
    <DataTable
      {...tableProps}
      columns={resizableColumns}
      onColumnResize={handleColumnResize}
    />
  );
}
