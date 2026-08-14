import styles from "./pager.module.css";

export function Pager({
  page,
  pages,
  total,
  shown,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  shown: number;
  onPage: (page: number) => void;
}) {
  const from = total === 0 ? 0 : page * shown + 1;
  const to = Math.min(total, (page + 1) * shown);

  return (
    <div className={styles.foot}>
      <span>{total === 0 ? "No records" : `${from} to ${to} of ${total}`}</span>
      {pages > 1 && (
        <div className={styles.pages}>
          {Array.from({ length: pages }, (_, index) => (
            <button
              key={index}
              type="button"
              className={
                index === page
                  ? `${styles.page} ${styles.current}`
                  : styles.page
              }
              aria-current={index === page ? "page" : undefined}
              aria-label={`Page ${index + 1}`}
              onClick={() => onPage(index)}
            >
              {index + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
