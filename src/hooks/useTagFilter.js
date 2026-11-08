import { useState, useEffect } from 'react';
import { writeItem } from '../utils/storageWrites.js';
import { HIDDEN_PROJECTS_KEY, readHiddenProjects, toggleHiddenGroup } from '../utils/calendarFilter.js';

const useTagFilter = () => {
  const [selectedTags, setSelectedTags] = useState(() => {
    const saved = localStorage.getItem('day-planner-selected-tags');
    return saved ? JSON.parse(saved) : [];
  });
  const [showUntagged, setShowUntagged] = useState(() => {
    const saved = localStorage.getItem('day-planner-show-untagged');
    return saved !== null ? JSON.parse(saved) : true;
  });
  // Projects the calendar hides (#2307), per device like the tags. Ids that
  // name no active project stay saved and are ignored where they are read
  // (utils/calendarFilter.js liveHiddenProjectIds).
  const [hiddenProjects, setHiddenProjects] = useState(() => readHiddenProjects());
  const [showMobileTagFilter, setShowMobileTagFilter] = useState(false);

  // Persist selectedTags to localStorage
  useEffect(() => {
    writeItem('day-planner-selected-tags', JSON.stringify(selectedTags));
  }, [selectedTags]);

  useEffect(() => {
    writeItem(HIDDEN_PROJECTS_KEY, JSON.stringify(hiddenProjects));
  }, [hiddenProjects]);

  // Persist showUntagged to localStorage
  useEffect(() => {
    writeItem('day-planner-show-untagged', JSON.stringify(showUntagged));
  }, [showUntagged]);

  // Close tag filter on ESC and blur the trigger button
  useEffect(() => {
    if (!showMobileTagFilter) return;
    const handleTagFilterEsc = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMobileTagFilter(false);
        if (document.activeElement) document.activeElement.blur();
      }
    };
    document.addEventListener('keydown', handleTagFilterEsc);
    return () => document.removeEventListener('keydown', handleTagFilterEsc);
  }, [showMobileTagFilter]);

  const toggleTag = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const clearTagFilter = () => {
    setSelectedTags([]);
  };

  const toggleHiddenProject = (id) => {
    setHiddenProjects(prev =>
      prev.some(p => String(p) === String(id))
        ? prev.filter(p => String(p) !== String(id))
        : [...prev, id]
    );
  };

  // An area, a goal or the standalone projects at once (#2332): all hidden
  // becomes none, anything less becomes all.
  const toggleHiddenProjectGroup = (ids) => {
    setHiddenProjects(prev => toggleHiddenGroup(prev, ids));
  };

  // "Show all" in the Hide projects section: nothing hidden, stale ids included.
  const showAllProjects = () => {
    setHiddenProjects([]);
  };

  return {
    selectedTags, setSelectedTags,
    showUntagged, setShowUntagged,
    showMobileTagFilter, setShowMobileTagFilter,
    toggleTag, clearTagFilter,
    hiddenProjects, setHiddenProjects,
    toggleHiddenProject, toggleHiddenProjectGroup, showAllProjects,
  };
};

export default useTagFilter;
