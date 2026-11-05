// The notes box of a project (Project Planner) or a goal (goal detail, #2076),
// over the state in hooks/useEntityNotes.js. Same interaction and height
// policy as the task notes panel (#2067): a formatted preview that switches to
// the editor on click, Shift+Enter or clicking away to save, and both states
// sized to their content up to the shared cap (utils/autoSizeTextarea.js),
// scrolling past it. The editor can also be dragged taller on desktop.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ExternalLink } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { renderFormattedText } from '../../utils/textFormatting.jsx';
import { autoSizeTextarea } from '../../utils/autoSizeTextarea.js';
import { describeAgo } from '../../utils/bridgeStatus.js';
import { activeLocale } from '../../utils/localeFormatting.js';

/**
 * @param {object} props
 * @param {ReturnType<import('../../hooks/useEntityNotes.js').default>} props.state
 * @param {string} [props.accentHex]   focus ring colour (the project's or goal's)
 * @param {string} [props.label]       heading for an entity without a linked note
 * @param {boolean} [props.showLabel]  false where the host already names the
 *        note (the goal card's header carries its link and Open in Obsidian)
 * @param {string} [props.className]
 */
export default function EntityNotesBox({ state, accentHex, label, showLabel = true, className = '' }) {
  const { darkMode, borderClass, textPrimary, textSecondary, hoverBg, isMobile } = useDayPlannerCtx();
  const { t } = useTranslation();
  const { notes, setNotes, editing, setEditing, editWhenEmpty = true, vault, vaultNotes, noteLink, save, openInObsidian } = state;
  // Back to the preview after saving; an emptied box stays the editor only
  // where an empty box starts as one.
  const finish = () => { save(); if (notes.trim() || !editWhenEmpty) setEditing(false); };
  const empty = !notes.trim();
  const maxH = 'max-h-[60vh]';
  const reportedMs = vaultNotes && vault.reportedAt ? Date.parse(vault.reportedAt) : NaN;

  return (
    <div className={`flex flex-col gap-1 flex-shrink-0 ${className}`} data-notes-source={vaultNotes ? 'vault' : 'record'}>
      {showLabel && <label className={`text-xs font-medium ${textSecondary} flex items-center gap-1.5`}>
        {vaultNotes && <BookOpen size={11} />}
        <span className="flex-1">{vaultNotes ? noteLink.name : (label ?? t('task.notes', 'Notes'))}</span>
        {vaultNotes && openInObsidian && (
          <button
            type="button"
            onClick={() => openInObsidian(noteLink.name)}
            title={t('task.openWikiNoteInObsidian', { name: noteLink.name })}
            aria-label={t('task.openWikiNoteInObsidian', { name: noteLink.name })}
            className={`flex items-center gap-1 px-1 py-0.5 rounded font-normal ${textSecondary} ${hoverBg}`}
          >
            <ExternalLink size={11} />
            <span>{t('task.openInObsidian')}</span>
          </button>
        )}
      </label>}
      {vaultNotes && vault.loading ? (
        <p className={`text-xs italic ${textSecondary}`}>{t('planner.notesLoading', 'Loading from the linked note…')}</p>
      ) : vaultNotes && vault.unavailable ? (
        <p data-notes-in-vault={vault.error === 'not_found' ? 'missing' : 'unreadable'} className={`text-xs italic ${vault.error === 'not_found' ? 'text-amber-500' : textSecondary}`}>
          {vault.error === 'not_found'
            ? t('planner.notesNoteMissing', 'The linked note was not found in the vault. Check the note name, or create the note in Obsidian.')
            : vault.error
              ? t('planner.notesLoadFailed', { error: vault.error })
              : t('planner.notesInVault', 'Notes live in the linked note in Obsidian.')}
        </p>
      ) : editing ? (
        <textarea
          // Opened from the preview: take the keyboard. An empty box that
          // starts as the editor leaves focus where it is.
          autoFocus={!!notes.trim()}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          // Open at the note's own height, then follow it as it is typed.
          ref={autoSizeTextarea}
          onInput={e => autoSizeTextarea(e.currentTarget)}
          onBlur={finish}
          onKeyDown={e => {
            if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault();
              finish();
            }
          }}
          placeholder={t('planner.notesPlaceholder', 'Add notes... (**bold**, *italic*, __underline__, URLs) - Shift+Enter to save')}
          rows={3}
          data-notes-editor
          className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 ${maxH} ${isMobile ? 'resize-none' : 'resize-y'} ${
            darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
          }`}
          style={accentHex ? { '--tw-ring-color': accentHex } : undefined}
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          data-notes-preview
          data-notes-empty={empty ? '' : undefined}
          className={empty
            ? `px-2 py-1 text-xs italic rounded-lg cursor-text ${textSecondary} ${hoverBg}`
            : `px-3 py-2 text-sm rounded-lg border ${borderClass} cursor-text whitespace-pre-wrap overflow-y-auto ${maxH} ${textPrimary} ${hoverBg}`}
          title={t('planner.clickToEditNotes', 'Click to edit notes')}
        >
          {empty ? t('task.notesPlaceholder', 'Add notes...') : renderFormattedText(notes)}
        </div>
      )}
      {Number.isFinite(reportedMs) && !vault.loading && !vault.unavailable && (
        // The section came from the plugin's report, not a file here (#2291):
        // say how old it is.
        <p data-notes-reported={vault.reportedAt} className={`text-xs italic ${textSecondary}`}>
          {t('planner.notesReportedByObsidian', { when: describeAgo(reportedMs, Date.now(), activeLocale()) })}
        </p>
      )}
      {vaultNotes && vault.conflict && (
        <p data-notes-conflict className="text-xs text-amber-500">{t('planner.notesChanged')}</p>
      )}
    </div>
  );
}
