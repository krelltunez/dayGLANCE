import { useState } from 'react';

const useGTDFrames = () => {
  const [gtdFrames, setGtdFrames] = useState(() => {
    try {
      const saved = localStorage.getItem('day-planner-gtd-frames');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [showFramesModal, setShowFramesModal] = useState(false);
  const [framesModalTab, setFramesModalTab] = useState('frames'); // 'frames' | 'schedule'
  const [editingFrame, setEditingFrame] = useState(null); // frame object being edited, or 'new' for create
  const [smartScheduleResults, setSmartScheduleResults] = useState(null); // AI scheduling results
  const [smartScheduleLoading, setSmartScheduleLoading] = useState(false);
  const [smartScheduleError, setSmartScheduleError] = useState('');
  const [smartScheduleAccepted, setSmartScheduleAccepted] = useState({}); // { taskId: true/false }
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleResults, setRescheduleResults] = useState(null);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleError, setRescheduleError] = useState('');
  const [rescheduleAccepted, setRescheduleAccepted] = useState({});
  const [frameContextMenu, setFrameContextMenu] = useState(null); // { x, y, frameId, dateStr }
  const [quickAddFrameModal, setQuickAddFrameModal] = useState(null); // { dateStr, startMinutes, endMinutes }
  const [frameAdjustModal, setFrameAdjustModal] = useState(null); // { frameId, dateStr, start, end }
  const [frameAdjustTimeField, setFrameAdjustTimeField] = useState(null); // 'start' | 'end' | null
  const [frameScheduleModal, setFrameScheduleModal] = useState(null); // { frameId, dateStr, frame }

  return {
    gtdFrames, setGtdFrames,
    showFramesModal, setShowFramesModal,
    framesModalTab, setFramesModalTab,
    editingFrame, setEditingFrame,
    smartScheduleResults, setSmartScheduleResults,
    smartScheduleLoading, setSmartScheduleLoading,
    smartScheduleError, setSmartScheduleError,
    smartScheduleAccepted, setSmartScheduleAccepted,
    showRescheduleModal, setShowRescheduleModal,
    rescheduleResults, setRescheduleResults,
    rescheduleLoading, setRescheduleLoading,
    rescheduleError, setRescheduleError,
    rescheduleAccepted, setRescheduleAccepted,
    frameContextMenu, setFrameContextMenu,
    quickAddFrameModal, setQuickAddFrameModal,
    frameAdjustModal, setFrameAdjustModal,
    frameAdjustTimeField, setFrameAdjustTimeField,
    frameScheduleModal, setFrameScheduleModal,
  };
};

export default useGTDFrames;
