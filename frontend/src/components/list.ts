import { useState } from "react";

export { DataTable } from "./data-table/data-table";
export { PageHead } from "./page-head/page-head";
export { Pager } from "./pager/pager";
export { Row } from "./row/row";
export { RowActions } from "./row-actions/row-actions";
export { SearchField } from "./search-field/search-field";
export { StatusFilter } from "./status-filter/status-filter";
export { Toolbar } from "./toolbar/toolbar";

export function useSearchedPage<T>(
  items: T[],
  matches: (item: T, needle: string) => boolean,
  perPage: number,
) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const needle = query.trim().toLowerCase();
  const filtered = items.filter((item) => matches(item, needle));
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pages - 1);
  return {
    query,
    setQuery: (value: string) => {
      setQuery(value);
      setPage(0);
    },
    page: current,
    setPage,
    pages,
    total: filtered.length,
    slice: filtered.slice(current * perPage, (current + 1) * perPage),
  };
}
