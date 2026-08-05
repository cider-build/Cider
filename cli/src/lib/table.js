export function printTable(rows, columns, { emptyMessage, emptyValue = "" } = {}) {
  if (rows.length === 0) {
    if (emptyMessage) process.stdout.write(`${emptyMessage}\n`);
    return;
  }
  const cell = (row, column) => String(row[column] ?? emptyValue);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => cell(row, column).length)),
  );
  process.stdout.write(`${columns.map((column, index) => column.padEnd(widths[index])).join("  ")}\n`);
  for (const row of rows) {
    process.stdout.write(`${columns.map((column, index) => cell(row, column).padEnd(widths[index])).join("  ")}\n`);
  }
}
