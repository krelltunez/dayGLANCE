import { useState, useEffect } from 'react';

const useTagFilter = () => {
  const [selectedTags, setSelectedTags] = useState(() => {
    const saved = localStorage.getItem('day-planner-selected-tags');
    return saved ? JSON.parse(saved) : [];
  });
  const [showUntagged, setShowUntagged] = useState(() => {
    const saved = localStorage.getItem('day-planner-show-untagged');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [showMobileTagFilter, setShowMobileTagFilter] = useState(false);

  // Persist selectedTags to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-selected-tags', JSON.stringify(selectedTags));
  }, [selectedTags]);

  // Persist showUntagged to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-show-untagged', JSON.stringify(showUntagged));
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

  return {
    selectedTags, setSelectedTags,
    showUntagged, setShowUntagged,
    showMobileTagFilter, setShowMobileTagFilter,
    toggleTag, clearTagFilter,
  };
};

export default useTagFilter;
