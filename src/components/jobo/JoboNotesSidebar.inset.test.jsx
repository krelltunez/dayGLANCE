import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';

// The Do header sits inside the Plan/Do scroll area and the sidebar header
// does not, so with a visible scrollbar the sidebar's button would land that
// many pixels right of where it sat in the Do header. The header pads it by
// the measured width instead. MUTATION: drop the style and a nonzero inset
// renders no extra padding.
vi.mock('../../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => ({ dailyNotes: {} }) }));
vi.mock('../../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => ({}) }));
vi.mock('../../context/SyncContext.jsx', () => ({ useSyncCtx: () => ({}) }));
const { default: JoboNotesSidebar } = await import('./JoboNotesSidebar.jsx');

const header = (inset) => renderToStaticMarkup(
  <JoboNotesSidebar date="2026-09-28" task={null} t={(k) => k} headerAction={<button type="button">Notes</button>} headerInset={inset} />,
).match(/<div data-jobo-sidebar-header[^>]*>/)[0];

describe('the notes sidebar header', () => {
  it('pads its button by the Do side\'s scrollbar width', () => {
    expect(header(15)).toContain('padding-right:calc(0.75rem + 15px)');
  });

  it('adds nothing where scrollbars overlay', () => {
    expect(header(0)).not.toContain('padding-right');
  });
});
