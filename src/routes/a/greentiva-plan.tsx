import { createFileRoute } from '@tanstack/react-router';
import { marked } from 'marked';
import { useMemo } from 'react';
import { Tag } from '../../components/Tag';
import plan from '../../../docs/greentiva/ARCHITECTURE.md?raw';

export const Route = createFileRoute('/a/greentiva-plan')({
  component: GreenTivaPlan,
});

/**
 * GreenTIVA: for now this page only shows the architecture and validation
 * plan (docs/greentiva/ARCHITECTURE.md), rendered from the same file so the
 * two never drift. It contains no calculators and is not linked from the
 * homepage. The patient-specific module stays unbuilt until the regulatory
 * route in section 7 of the plan is decided.
 */
function GreenTivaPlan() {
  // The markdown is this repo's own file, not user input.
  const html = useMemo(() => marked.parse(plan, { async: false }) as string, []);

  return (
    <main className="mx-auto max-w-3xl px-4 pt-12 pb-24 sm:px-8">
      <Tag>Förslag</Tag>
      <p className="mt-4 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Detta är en plan, inte ett verktyg. Ingen kod för beräkning av läkemedel finns ännu, och inget här
        får användas kliniskt.
      </p>
      <article
        className="greentiva-doc mt-8"
        // biome-ignore lint: own static markdown
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </main>
  );
}
