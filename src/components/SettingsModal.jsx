import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Settings, X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import SettingsTopicNav from './settings/SettingsTopicNav.jsx';
import SettingsTopicPage from './settings/SettingsTopicPage.jsx';
import { TOPICS, visibleTopics, initialTopicId, readRememberedTopic, rememberTopic } from './settings/settingsTopics.js';
import { searchSettings } from './settings/settingsSearch.js';
import useSettingsSections from './settings/useSettingsSections.js';
import { revealSettingsSection } from './settings/settingsLink.js';
import { useTranslation } from 'react-i18next';
import { LauncherPromoCard, useLauncherPromo } from './LauncherPromo.jsx';

const SettingsModal = () => {
  const { t } = useTranslation();
  const {
    setShowSettings, darkMode, cardBg, borderClass, textPrimary, textSecondary,
    settingsLink, setSettingsLink,
  } = useDayPlannerCtx();

  // Every block of the dialog, with the condition under which it renders
  // anything (settings/useSettingsSections.js). A topic page is a list of
  // these; separators go between the visible ones only (#2075).
  const sections = useSettingsSections();

  // GLANCElauncher, once (utils/launcherPromo.js). Android tablets in
  // landscape use this dialog rather than the phone's Settings page, so the
  // one-time card lives here too; everywhere else it never shows.
  const launcherPromo = useLauncherPromo();

  // The topic list shows only topics with something to show on this device,
  // and opens on the topic last used here (docs/settings-redesign.md).
  const listedTopics = visibleTopics(sections);
  const [chosenTopic, setChosenTopic] = useState(readRememberedTopic);
  const activeTopicId = initialTopicId(chosenTopic, listedTopics);
  const activeTopic = TOPICS.find((topic) => topic.id === activeTopicId);
  const selectTopic = (id) => { setChosenTopic(id); rememberTopic(id); setSettingsQuery(''); };

  // Search lists the matching settings in the page's place; choosing one opens
  // its topic scrolled to it, and marks it for a moment so the eye finds it.
  const [settingsQuery, setSettingsQuery] = useState('');
  const [scrollToSection, setScrollToSection] = useState(null);
  const searchResults = settingsQuery ? searchSettings(settingsQuery, sections, t) : [];
  const openSearchResult = (result) => { selectTopic(result.topicId); setScrollToSection(result.sectionKey); };
  // Each topic opens at its top, not at the last page's scroll offset; before
  // paint, and before a search result or link scrolls to its section.
  const scrollRef = useRef(null);
  useLayoutEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [activeTopicId]);
  useEffect(() => {
    if (!scrollToSection) return undefined;
    const key = scrollToSection;
    setScrollToSection(null);
    return revealSettingsSection(key);
  }, [scrollToSection, activeTopicId]);

  // A link from elsewhere in the app opens its topic, scrolled to its section
  // (settings/settingsLink.js). Read once, then cleared.
  useEffect(() => {
    if (!settingsLink) return;
    setSettingsLink(null);
    if (!listedTopics.some((topic) => topic.id === settingsLink.topic)) return;
    selectTopic(settingsLink.topic);
    if (settingsLink.section) setScrollToSection(settingsLink.section);
  }, [settingsLink]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
            {/* Grows with the window past lg (#2075): the two columns had a
                768px cap on any screen, so a large or full-screen window
                still read Settings through a narrow, short box. */}
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-dialog-title"
              data-settings-dialog
              className={`${cardBg} rounded-lg shadow-xl ${borderClass} border max-w-2xl lg:max-w-4xl xl:max-w-5xl w-full mx-4 h-[85vh] lg:h-[90vh] flex flex-col overflow-hidden`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* The header stays put while the page scrolls, with a Close
                  control in reach from anywhere (#2075). Escape closes too
                  (hooks/useModalClose.js). The dialog keeps one height, so
                  switching topics never makes it jump. */}
              <div data-settings-header className={`flex-shrink-0 ${cardBg} border-b ${borderClass} px-6 py-4 flex items-center gap-3`}>
                <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                  <Settings size={20} className="text-blue-600 dark:text-blue-400" />
                </div>
                <h3 id="settings-dialog-title" className={`flex-1 text-lg font-semibold ${textPrimary}`}>{t('settings.title')}</h3>
                <button
                  type="button"
                  data-settings-close
                  onClick={() => setShowSettings(false)}
                  className={`p-1.5 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} transition-colors`}
                  title={t('common.close')}
                  aria-label={t('common.close')}
                >
                  <X size={18} className={textSecondary} />
                </button>
              </div>
              <div className="flex flex-1 min-h-0">
              <SettingsTopicNav
                topics={listedTopics}
                sections={sections}
                activeId={activeTopicId}
                onSelect={selectTopic}
                query={settingsQuery}
                onQuery={setSettingsQuery}
                darkMode={darkMode}
                textPrimary={textPrimary}
                textSecondary={textSecondary}
                borderClass={borderClass}
              />
              <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto p-6" data-settings-scroll>

                {settingsQuery ? (
                  <div data-settings-results className="space-y-1">
                    {searchResults.length === 0 ? (
                      <p className={`text-sm ${textSecondary}`}>{t('spotlight.noResults')}</p>
                    ) : searchResults.map((result) => {
                      const topic = TOPICS.find((entry) => entry.id === result.topicId);
                      const topicLabel = t(topic.labelKey, topic.fallback);
                      return (
                        <button
                          key={result.sectionKey}
                          type="button"
                          data-settings-result={result.sectionKey}
                          onClick={() => openSearchResult(result)}
                          className={`w-full text-left px-3 py-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} transition-colors`}
                        >
                          <span className={`block text-sm font-medium ${textPrimary}`}>
                            {result.title}{result.match && <span className={`font-normal ${textSecondary}`}>{' · '}{result.match}</span>}
                          </span>
                          {topicLabel !== result.title && <span className={`block text-xs ${textSecondary}`}>{topicLabel}</span>}
                        </button>
                      );
                    })}
                  </div>
                ) : (<>
                  {launcherPromo.showCard && (
                    <div className="mb-6" data-settings-launcher-promo>
                      <LauncherPromoCard
                        url={launcherPromo.url}
                        onDismiss={launcherPromo.dismiss}
                        cardBg={cardBg} borderClass={borderClass} textPrimary={textPrimary} textSecondary={textSecondary}
                      />
                    </div>
                  )}
                  <SettingsTopicPage key={activeTopicId} topic={activeTopic} sections={sections} borderClass={borderClass} />
                </>)}
              </div>
              </div>
            </div>
          </div>
        );
};

export default SettingsModal;
