import { ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
};

export function DataTable<T extends { id?: string | number }>({
  rows,
  columns,
  empty = "No data",
  onRowClick,
}: {
  rows: T[];
  columns: Column<T>[];
  empty?: string;
  onRowClick?: (row: T) => void;
}) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-5 py-10 text-center text-base text-neutral-500">
        {empty}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
      <table className="w-full text-base">
        <thead className="bg-neutral-900/60 text-left text-sm uppercase tracking-wide text-neutral-500">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`px-4 py-3 font-medium ${c.className ?? ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows.map((row, i) => (
            <tr
              key={(row.id as string) ?? i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? "cursor-pointer hover:bg-neutral-800/40" : ""}
            >
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 text-neutral-200 ${c.className ?? ""}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
