import type {
  TypedBlankSlot,
  TypedFillTableColumn,
  TypedFillTableRow,
} from "../api/types";
import type { TypedBlankStatus } from "../lib/typedBlank";
import TypedCodeTemplate from "./TypedCodeTemplate";
import TypedTextTemplate from "./TypedTextTemplate";

interface TypedTableTemplateProps {
  columns: TypedFillTableColumn[];
  rows: TypedFillTableRow[];
  slots: TypedBlankSlot[];
  value: Record<string, string>;
  disabled?: boolean;
  statuses?: Record<string, TypedBlankStatus>;
  onChange: (next: Record<string, string>) => void;
}

/**
 * Renders a semantic table whose cells may hold text or code templates.
 *
 * Each row keeps its authored row/column relationship; code cells reuse the
 * same code renderer as standalone code questions, so blanks behave identically.
 */
export default function TypedTableTemplate({
  columns,
  rows,
  slots,
  value,
  disabled = false,
  statuses,
  onChange,
}: TypedTableTemplateProps) {
  return (
    <div className="typed-fill-table-wrap">
      <table className="typed-fill-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => {
                const cell = row.cells[column.id];
                return (
                  <td key={column.id}>
                    {cell?.type === "code" ? (
                      <TypedCodeTemplate
                        language={cell.language}
                        template={cell.template}
                        slots={slots}
                        value={value}
                        disabled={disabled}
                        statuses={statuses}
                        onChange={onChange}
                      />
                    ) : cell?.type === "text" ? (
                      <TypedTextTemplate
                        template={cell.template}
                        slots={slots}
                        value={value}
                        disabled={disabled}
                        statuses={statuses}
                        onChange={onChange}
                      />
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
