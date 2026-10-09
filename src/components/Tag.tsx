import type { ReactNode } from 'react';

/** The tilted label motif from Förrådet. */
export function Tag({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-block -rotate-1 rounded-sm bg-primary px-2 py-0.5 font-narrow text-xs font-semibold tracking-wide text-primary-foreground uppercase ${className}`}
    >
      {children}
    </span>
  );
}
