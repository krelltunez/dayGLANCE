import React from 'react';
import { BarChart3, X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const WeeklyReviewReminderCard = () => {
  const {
    showWeeklyReviewReminder, setShowWeeklyReviewReminder,
    showWeeklyReview, setShowWeeklyReview,
    weeklyReviewDismissedRef, lastWeeklyReviewFiredRef,
    darkMode,
    cardBg, borderClass, textPrimary, textSecondary,
  } = useDayPlannerCtx();

  if (!showWeeklyReviewReminder || showWeeklyReview) return null;

  return (
        <div className="fixed bottom-6 right-6 z-50 w-64">
          <div className={`${cardBg} rounded-lg shadow-xl ${borderClass} border p-3`}>
            <div className="flex items-start gap-2">
              <BarChart3 size={16} className="text-purple-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${textPrimary}`}>Weekly Review</p>
                <p className={`text-xs ${textSecondary}`}>Time for your weekly review!</p>
              </div>
              <button
                onClick={() => { weeklyReviewDismissedRef.current = lastWeeklyReviewFiredRef.current; localStorage.setItem('day-planner-weekly-review-dismissed', lastWeeklyReviewFiredRef.current); setShowWeeklyReviewReminder(false); }}
                className={`${textSecondary} hover:${textPrimary} flex-shrink-0`}
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center justify-center gap-2 mt-2">
              <button
                onClick={() => { weeklyReviewDismissedRef.current = lastWeeklyReviewFiredRef.current; localStorage.setItem('day-planner-weekly-review-dismissed', lastWeeklyReviewFiredRef.current); setShowWeeklyReview(true); setShowWeeklyReviewReminder(false); }}
                className="px-2.5 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
              >
                Open Review
              </button>
              <button
                onClick={() => { weeklyReviewDismissedRef.current = lastWeeklyReviewFiredRef.current; localStorage.setItem('day-planner-weekly-review-dismissed', lastWeeklyReviewFiredRef.current); setShowWeeklyReviewReminder(false); }}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'}`}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>

  );
};

export default WeeklyReviewReminderCard;
