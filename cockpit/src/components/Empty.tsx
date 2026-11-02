import type { ReactNode } from 'react';

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children !== undefined && <p>{children}</p>}
    </div>
  );
}
