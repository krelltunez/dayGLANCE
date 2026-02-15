import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { Plus, Clock, X, GripVertical, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Moon, Sun, Upload, Inbox, AlertCircle, Calendar, Check, RefreshCw, Palette, Trash2, Undo2, BarChart3, SkipForward, Hash, MoreHorizontal, Save, Menu, BrainCircuit, AlertTriangle, FileText, ExternalLink, CheckSquare, HelpCircle, Sparkles, Link, GripHorizontal, Play, Pause, Trophy, Cloud, Settings, Search, Bell, Target, TrendingUp, Zap, CalendarDays, Ban, Volume2, VolumeX, Pencil, Eye, Filter, Smartphone, CheckCircle, Pin, PinOff } from 'lucide-react';
import { mergeTaskArrays, mergeSyncData } from './mergeSync.js';

// Hook to determine how many days to show based on window width
const useVisibleDays = () => {
  const [visibleDays, setVisibleDays] = useState(() => {
    if (typeof window !== 'undefined') {
      if (window.innerWidth >= 1600) return 3;
      if (window.innerWidth >= 1200) return 2;
    }
    return 1;
  });

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1600) setVisibleDays(3);
      else if (window.innerWidth >= 1200) setVisibleDays(2);
      else setVisibleDays(1);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return visibleDays;
};

// Hook to detect device type using touch-primary detection + viewport width.
// Touch-primary (pointer: coarse + hover: none) distinguishes tablets from
// small desktop/laptop screens that happen to be under 1200px wide.
const useDeviceType = () => {
  const compute = () => {
    if (typeof window === 'undefined') return { isPhone: false, isMobile: false, isTablet: false };
    const w = window.innerWidth;
    const touchPrimary = window.matchMedia('(pointer: coarse) and (hover: none)').matches
      || (navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches);
    // Use screen dimensions for phone detection — Math.min gives the
    // physical short side regardless of current orientation.
    const shortSide = Math.min(screen.width, screen.height);
    const isPhone = touchPrimary && shortSide < 600;
    const isMobile = isPhone || w < 768;
    const isTablet = !isPhone && touchPrimary && w >= 768 && w < 1200;
    return { isPhone, isMobile, isTablet };
  };

  const [device, setDevice] = useState(compute);

  useEffect(() => {
    const update = () => setDevice(compute());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    // Also listen for pointer/hover changes (e.g. tablet keyboard attached/detached)
    const mq = window.matchMedia('(pointer: coarse) and (hover: none)');
    mq.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      mq.removeEventListener('change', update);
    };
  }, []);

  return device;
};

// Hook to detect landscape orientation
const useIsLandscape = () => {
  const [isLandscape, setIsLandscape] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth > window.innerHeight;
    }
    return false;
  });

  useEffect(() => {
    const handleChange = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    window.addEventListener('resize', handleChange);
    window.addEventListener('orientationchange', handleChange);
    return () => {
      window.removeEventListener('resize', handleChange);
      window.removeEventListener('orientationchange', handleChange);
    };
  }, []);

  return isLandscape;
};

// URL detection regex for notes
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

// Check if entire text is just a URL (with optional whitespace)
const isOnlyUrl = (text) => {
  if (!text) return false;
  const trimmed = text.trim();
  const match = trimmed.match(URL_REGEX);
  return match && match.length === 1 && match[0] === trimmed;
};

// Render formatted text with URLs, **bold**, *italic*, __underline__
const renderFormattedText = (text) => {
  if (!text) return null;

  const elements = [];
  let lastIndex = 0;
  let key = 0;

  // Combined regex for all formatting: **bold**, *italic*, __underline__, URLs
  const formatRegex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(__(.+?)__)|(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
  let match;

  while ((match = formatRegex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      elements.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
    }

    if (match[1]) {
      // **bold**
      elements.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      // *italic*
      elements.push(<em key={key++}>{match[4]}</em>);
    } else if (match[5]) {
      // __underline__
      elements.push(<span key={key++} className="underline">{match[6]}</span>);
    } else if (match[7]) {
      // URL
      elements.push(
        <a
          key={key++}
          href={match[7]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {match[7]}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    elements.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }

  return elements;
};

// Check if task has any notes or subtasks
const hasNotesOrSubtasks = (task) => {
  return (task.notes && task.notes.trim()) || (task.subtasks && task.subtasks.length > 0);
};

// Check if task has only a link (note is URL-only, no subtasks)
const isLinkOnlyTask = (task) => {
  if (task.subtasks && task.subtasks.length > 0) return false;
  return isOnlyUrl(task.notes);
};

// Get the link URL from a link-only task
const getLinkUrl = (task) => {
  return task.notes?.trim() || null;
};

// Check if task has only subtasks (no notes)
const hasOnlySubtasks = (task) => {
  return (!task.notes || !task.notes.trim()) && task.subtasks && task.subtasks.length > 0;
};

// Notes & Subtasks Panel component - defined outside DayPlanner to prevent remount on re-render
const NotesSubtasksPanel = ({
  task,
  isInbox,
  darkMode,
  updateTaskNotes,
  addSubtask,
  toggleSubtask,
  deleteSubtask,
  updateSubtaskTitle,
  compact = true, // Use compact mode for inbox, expanded for timeline
  noAutoFocus = false
}) => {
  const [editingSubtaskId, setEditingSubtaskId] = useState(null);
  const [editingSubtaskText, setEditingSubtaskText] = useState('');
  const [localNotes, setLocalNotes] = useState(task.notes || '');
  const [localSubtaskText, setLocalSubtaskText] = useState('');
  const [isEditingNotes, setIsEditingNotes] = useState(!task.notes); // Edit mode when no content
  const localNotesRef = useRef(localNotes);
  const taskNotesRef = useRef(task.notes || '');
  const taskIdRef = useRef(task.id);
  const isInboxRef = useRef(isInbox);
  const updateTaskNotesRef = useRef(updateTaskNotes);

  // Keep refs in sync
  useEffect(() => {
    localNotesRef.current = localNotes;
  }, [localNotes]);

  useEffect(() => {
    taskNotesRef.current = task.notes || '';
  }, [task.notes]);

  useEffect(() => {
    taskIdRef.current = task.id;
    isInboxRef.current = isInbox;
  }, [task.id, isInbox]);

  useEffect(() => {
    updateTaskNotesRef.current = updateTaskNotes;
  }, [updateTaskNotes]);

  // Sync local notes with task notes when task changes (e.g., switching between tasks)
  useEffect(() => {
    setLocalNotes(task.notes || '');
    setIsEditingNotes(!task.notes); // Edit mode when no content
  }, [task.id]);

  // Save notes on unmount only (e.g., when ESC is pressed or panel closes)
  useEffect(() => {
    return () => {
      if (localNotesRef.current !== taskNotesRef.current) {
        updateTaskNotesRef.current(taskIdRef.current, localNotesRef.current, isInboxRef.current);
      }
    };
  }, []); // Empty deps = only runs on mount/unmount

  const handleNotesChange = (e) => {
    setLocalNotes(e.target.value);
  };

  const handleNotesKeyDown = (e) => {
    // SHIFT+ENTER switches to preview mode
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      // Save notes and switch to preview
      if (localNotes !== (task.notes || '')) {
        updateTaskNotes(task.id, localNotes, isInbox);
      }
      if (localNotes) {
        setIsEditingNotes(false);
      }
    }
  };

  const handleNotesBlur = () => {
    // Save notes on blur
    if (localNotes !== (task.notes || '')) {
      updateTaskNotes(task.id, localNotes, isInbox);
    }
  };

  const handleAddSubtask = (e) => {
    e.preventDefault();
    if (localSubtaskText.trim()) {
      addSubtask(task.id, localSubtaskText, isInbox);
      setLocalSubtaskText('');
    }
  };

  const startEditingSubtask = (subtask) => {
    setEditingSubtaskId(subtask.id);
    setEditingSubtaskText(subtask.title);
  };

  const saveSubtaskEdit = () => {
    if (editingSubtaskText.trim()) {
      updateSubtaskTitle(task.id, editingSubtaskId, editingSubtaskText.trim(), isInbox);
    }
    setEditingSubtaskId(null);
    setEditingSubtaskText('');
  };

  const urlOnlyNote = isOnlyUrl(localNotes);
  const noteUrl = urlOnlyNote ? localNotes.trim() : null;

  return (
    <div
      className={`mt-2 p-3 rounded-lg ${darkMode ? 'bg-black/30' : 'bg-white/30'} text-white`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Notes section */}
      <div className="mb-3">
        <div className="text-xs font-semibold opacity-75 mb-1">Notes</div>
        {isEditingNotes ? (
          <textarea
            value={localNotes}
            onChange={handleNotesChange}
            onKeyDown={handleNotesKeyDown}
            onBlur={handleNotesBlur}
            placeholder="Add notes... (**bold**, *italic*, __underline__, URLs) - Shift+Enter for preview"
            className={`w-full bg-white/10 text-white text-sm px-2 py-1.5 rounded border border-white/20 outline-none focus:bg-white/20 focus:border-white/40 placeholder:text-white/40 ${compact ? 'resize-none' : 'resize-y'}`}
            rows={compact ? 3 : 8}
            autoFocus={!noAutoFocus}
          />
        ) : (
          <div
            onClick={() => setIsEditingNotes(true)}
            className="text-sm whitespace-pre-wrap cursor-text min-h-[4.5rem] p-2 rounded bg-white/10 hover:bg-white/15"
          >
            {urlOnlyNote ? (
              <a
                href={noteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-blue-300 hover:text-blue-200 font-medium break-all"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={14} className="flex-shrink-0" />
                {noteUrl}
              </a>
            ) : (
              renderFormattedText(localNotes)
            )}
          </div>
        )}
      </div>

      {/* Subtasks section */}
      <div>
        <div className="text-xs font-semibold opacity-75 mb-1">
          Subtasks {task.subtasks?.length > 0 && `(${task.subtasks.filter(st => st.completed).length}/${task.subtasks.length})`}
        </div>

        {/* Subtasks list */}
        {task.subtasks?.length > 0 && (
          <div className="space-y-1 mb-2">
            {task.subtasks.map((subtask) => (
              <div
                key={subtask.id}
                className="flex items-center gap-2 group"
              >
                <button
                  onClick={() => toggleSubtask(task.id, subtask.id, isInbox)}
                  className={`rounded flex-shrink-0 ${subtask.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                >
                  {subtask.completed && <Check size={10} strokeWidth={3} />}
                </button>
                {editingSubtaskId === subtask.id ? (
                  <input
                    type="text"
                    value={editingSubtaskText}
                    onChange={(e) => setEditingSubtaskText(e.target.value)}
                    onBlur={saveSubtaskEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveSubtaskEdit();
                      if (e.key === 'Escape') {
                        setEditingSubtaskId(null);
                        setEditingSubtaskText('');
                      }
                    }}
                    autoFocus
                    className="flex-1 bg-white/20 text-white text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                  />
                ) : (
                  <span
                    className={`flex-1 text-sm ${subtask.completed ? 'line-through opacity-60' : ''} cursor-text`}
                    onDoubleClick={() => startEditingSubtask(subtask)}
                  >
                    {subtask.title}
                  </span>
                )}
                <button
                  onClick={() => deleteSubtask(task.id, subtask.id, isInbox)}
                  className="md:opacity-0 md:group-hover:opacity-100 opacity-60 hover:bg-white/20 rounded p-0.5 transition-opacity"
                  title="Delete subtask"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add subtask input */}
        <form onSubmit={handleAddSubtask} className="flex items-center gap-2">
          <Plus size={14} className="opacity-50" />
          <input
            type="text"
            value={localSubtaskText}
            onChange={(e) => setLocalSubtaskText(e.target.value)}
            placeholder="Add subtask..."
            className="flex-1 bg-transparent text-white text-sm px-1 py-0.5 outline-none placeholder:text-white/40 border-b border-transparent focus:border-white/30"
          />
        </form>
      </div>
    </div>
  );
};

// Cloud sync provider abstraction
const cloudSyncProviders = {
  nextcloud: {
    name: 'Nextcloud / WebDAV',
    getFileUrl: (config) =>
      `${config.nextcloudUrl.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(config.username)}/dayglance/dayglance-sync.json`,
    getDirUrl: (config) =>
      `${config.nextcloudUrl.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(config.username)}/dayglance/`,
    getAuthHeaders: (config) => ({
      'X-WebDAV-Auth': 'Basic ' + btoa(config.username + ':' + config.appPassword)
    }),
    async upload(config, data) {
      const fileUrl = this.getFileUrl(config);
      const dirUrl = this.getDirUrl(config);
      const authHeaders = this.getAuthHeaders(config);
      const body = JSON.stringify(data);

      const doUpload = () =>
        fetch(`/api/webdav-proxy/?url=${fileUrl}`, {
          method: 'PUT',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body
        });

      let res = await doUpload();
      if (res.status === 404 || res.status === 409) {
        // Directory doesn't exist, create it
        await fetch(`/api/webdav-proxy/?url=${dirUrl}`, {
          method: 'MKCOL',
          headers: authHeaders
        });
        res = await doUpload();
      }
      if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
      return true;
    },
    async download(config) {
      const fileUrl = this.getFileUrl(config);
      const authHeaders = this.getAuthHeaders(config);

      const res = await fetch(`/api/webdav-proxy/?url=${fileUrl}`, {
        method: 'GET',
        headers: authHeaders
      });

      if (res.status === 404) return null; // No remote file yet
      if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      return res.json();
    },
    async test(config) {
      const dirUrl = this.getDirUrl(config);
      const authHeaders = this.getAuthHeaders(config);

      const res = await fetch(`/api/webdav-proxy/?url=${dirUrl}`, {
        method: 'PROPFIND',
        headers: { ...authHeaders, 'Depth': '0' }
      });

      if (res.status === 207 || res.status === 404) return { success: true };
      if (res.status === 401) return { success: false, error: 'Invalid credentials. Check your username and app password.' };
      return { success: false, error: `Unexpected response: ${res.status} ${res.statusText}` };
    },
    configFields: [
      { key: 'nextcloudUrl', label: 'Nextcloud URL', type: 'url', placeholder: 'https://cloud.example.com' },
      { key: 'username', label: 'Username', type: 'text', placeholder: 'your-username' },
      { key: 'appPassword', label: 'App Password', type: 'password', placeholder: 'xxxxx-xxxxx-xxxxx-xxxxx-xxxxx' }
    ]
  }
};

// Cloud sync settings form (extracted to avoid hooks-in-conditional issues)
const CloudSyncSettingsForm = ({ darkMode, textPrimary, textSecondary, borderClass, hoverBg, cloudSyncConfig, setCloudSyncConfig, cloudSyncTest, provider, currentProvider, onClose, cloudSyncLastSynced }) => {
  const [formData, setFormData] = useState(() => {
    const initial = { provider: currentProvider };
    provider.configFields.forEach(f => {
      initial[f.key] = cloudSyncConfig?.[f.key] || '';
    });
    return initial;
  });
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await cloudSyncTest({ ...formData, provider: currentProvider });
    setTestResult(result);
    setTesting(false);
  };

  const handleSave = () => {
    setCloudSyncConfig({ ...formData, provider: currentProvider, enabled: true });
    onClose();
  };

  const handleDisable = () => {
    setCloudSyncConfig({ ...cloudSyncConfig, enabled: false });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className={`block text-sm font-medium ${textSecondary} mb-1`}>Provider</label>
        <select
          value={currentProvider}
          disabled
          className={`w-full px-3 py-2 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700 text-white' : 'bg-gray-100'}`}
        >
          {Object.entries(cloudSyncProviders).map(([key, p]) => (
            <option key={key} value={key}>{p.name}</option>
          ))}
        </select>
      </div>

      {provider.configFields.map(field => (
        <div key={field.key}>
          <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{field.label}</label>
          <input
            type={field.type}
            placeholder={field.placeholder}
            value={formData[field.key] || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
            className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
          />
        </div>
      ))}

      <p className={`text-xs ${textSecondary}`}>
        Go to Nextcloud Settings &rarr; Security &rarr; Devices & sessions &rarr; Create new app password
      </p>

      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={testing || !formData.nextcloudUrl || !formData.username || !formData.appPassword}
          className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-lg transition-colors disabled:opacity-50`}
        >
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        {testResult && (
          <span className={`text-sm ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
            {testResult.success ? 'Connection successful!' : testResult.error}
          </span>
        )}
      </div>

      {cloudSyncLastSynced && (
        <p className={`text-xs ${textSecondary}`}>
          Last synced: {new Date(cloudSyncLastSynced).toLocaleString()}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-lg transition-colors`}
        >
          Cancel
        </button>
        {cloudSyncConfig?.enabled && (
          <button
            onClick={handleDisable}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Disable
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={!formData.nextcloudUrl || !formData.username || !formData.appPassword}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {cloudSyncConfig?.enabled ? 'Save' : 'Save & Enable'}
        </button>
      </div>
    </div>
  );
};

// Auto-backup IndexedDB wrapper
const autoBackupDB = {
  _db: null,
  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('dayglance-auto-backups', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('backups')) {
          const store = db.createObjectStore('backups', { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('frequency', 'frequency', { unique: false });
        }
      };
      req.onsuccess = () => { this._db = req.result; resolve(req.result); };
      req.onerror = () => reject(req.error);
    });
  },
  async saveBackup(frequency, data) {
    const db = await this.open();
    const timestamp = new Date().toISOString();
    const id = `auto-${frequency}-${timestamp}`;
    const record = { id, timestamp, frequency, data };
    return new Promise((resolve, reject) => {
      const tx = db.transaction('backups', 'readwrite');
      tx.objectStore('backups').put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  },
  async listBackups(frequency) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('backups', 'readonly');
      const store = tx.objectStore('backups');
      const req = frequency
        ? store.index('frequency').getAll(frequency)
        : store.getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
      req.onerror = () => reject(req.error);
    });
  },
  async getBackup(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('backups', 'readonly');
      const req = tx.objectStore('backups').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async deleteBackup(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('backups', 'readwrite');
      tx.objectStore('backups').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async pruneBackups(frequency, maxCount) {
    const all = await this.listBackups(frequency);
    if (all.length <= maxCount) return;
    const toDelete = all.slice(maxCount);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('backups', 'readwrite');
      const store = tx.objectStore('backups');
      toDelete.forEach(b => store.delete(b.id));
      tx.oncomplete = () => resolve(toDelete.length);
      tx.onerror = () => reject(tx.error);
    });
  }
};

// Auto-backup remote providers (separate from cloudSyncProviders which handles real-time sync)
const autoBackupProviders = {
  nextcloud: {
    name: 'Nextcloud / WebDAV',
    configFields: [
      { key: 'nextcloudUrl', label: 'Nextcloud URL', type: 'url', placeholder: 'https://cloud.example.com' },
      { key: 'username', label: 'Username', type: 'text', placeholder: 'your-username' },
      { key: 'appPassword', label: 'App Password', type: 'password', placeholder: 'xxxxx-xxxxx-xxxxx-xxxxx-xxxxx' }
    ],
    _getBackupDirUrl(config) {
      return `${config.nextcloudUrl.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(config.username)}/dayglance/backups/`;
    },
    _getAuthHeaders(config) {
      return { 'X-WebDAV-Auth': 'Basic ' + btoa(config.username + ':' + config.appPassword) };
    },
    async uploadBackup(config, data) {
      const dirUrl = this._getBackupDirUrl(config);
      const authHeaders = this._getAuthHeaders(config);
      const now = new Date();
      const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
      const filename = `dayglance-backup-${timestamp}.json`;
      const fileUrl = dirUrl + filename;
      const body = JSON.stringify(data);

      const doUpload = () =>
        fetch(`/api/webdav-proxy/?url=${fileUrl}`, {
          method: 'PUT',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body
        });

      let res = await doUpload();
      if (res.status === 404 || res.status === 409) {
        // Create /dayglance/ then /dayglance/backups/
        const parentDir = `${config.nextcloudUrl.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(config.username)}/dayglance/`;
        await fetch(`/api/webdav-proxy/?url=${parentDir}`, { method: 'MKCOL', headers: authHeaders });
        await fetch(`/api/webdav-proxy/?url=${dirUrl}`, { method: 'MKCOL', headers: authHeaders });
        res = await doUpload();
      }
      if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
      return filename;
    },
    async listBackups(config) {
      const dirUrl = this._getBackupDirUrl(config);
      const authHeaders = this._getAuthHeaders(config);
      const res = await fetch(`/api/webdav-proxy/?url=${dirUrl}`, {
        method: 'PROPFIND',
        headers: { ...authHeaders, 'Depth': '1' }
      });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`List failed: ${res.status}`);
      const xml = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');
      const responses = doc.querySelectorAll('response');
      const files = [];
      responses.forEach(r => {
        const href = r.querySelector('href')?.textContent || '';
        const filename = decodeURIComponent(href.split('/').filter(Boolean).pop());
        if (filename.startsWith('dayglance-backup-') && filename.endsWith('.json')) {
          const lastModified = r.querySelector('getlastmodified')?.textContent;
          files.push({ filename, lastModified: lastModified ? new Date(lastModified).toISOString() : null });
        }
      });
      return files.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
    },
    async downloadBackup(config, filename) {
      const fileUrl = this._getBackupDirUrl(config) + filename;
      const authHeaders = this._getAuthHeaders(config);
      const res = await fetch(`/api/webdav-proxy/?url=${fileUrl}`, {
        method: 'GET',
        headers: authHeaders
      });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return res.json();
    },
    async deleteBackup(config, filename) {
      const fileUrl = this._getBackupDirUrl(config) + filename;
      const authHeaders = this._getAuthHeaders(config);
      const res = await fetch(`/api/webdav-proxy/?url=${fileUrl}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      if (!res.ok && res.status !== 404) throw new Error(`Delete failed: ${res.status}`);
    },
    async testConnection(config) {
      const dirUrl = this._getBackupDirUrl(config);
      const authHeaders = this._getAuthHeaders(config);
      const res = await fetch(`/api/webdav-proxy/?url=${dirUrl}`, {
        method: 'PROPFIND',
        headers: { ...authHeaders, 'Depth': '0' }
      });
      if (res.status === 207 || res.status === 404) return { success: true };
      if (res.status === 401) return { success: false, error: 'Invalid credentials.' };
      return { success: false, error: `Unexpected response: ${res.status}` };
    }
  }
};

// Auto-backup retention limits
const AUTO_BACKUP_RETENTION = { hourly: 24, daily: 30, weekly: 12 };
const AUTO_BACKUP_INTERVALS = { hourly: 3600, daily: 86400, weekly: 604800 };

// Auto-Backup Settings Form (extracted to avoid hooks-in-conditional issues)
const AutoBackupSettingsForm = ({ config, setConfig, status, darkMode, textPrimary, textSecondary, borderClass, hoverBg, onRemoteBackupNow }) => {
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const localConfig = config.local;
  const remoteConfig = config.remote;
  const providerKey = remoteConfig.provider || 'nextcloud';
  const provider = autoBackupProviders[providerKey];

  const updateLocal = (updates) => setConfig(prev => ({ ...prev, local: { ...prev.local, ...updates } }));
  const updateRemote = (updates) => setConfig(prev => ({ ...prev, remote: { ...prev.remote, ...updates } }));

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await provider.testConnection(remoteConfig);
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    }
    setTesting(false);
  };

  return (
    <div className="space-y-6">
      {/* Local Backup Settings */}
      <div>
        <h4 className={`font-medium ${textPrimary} mb-3 flex items-center gap-2`}>
          <Save size={16} />
          Local Backups
        </h4>
        <div className="space-y-3 ml-1">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={localConfig.enabled}
              onChange={(e) => updateLocal({ enabled: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className={textPrimary}>Enable automatic local backups</span>
          </label>
          {localConfig.enabled && (
            <div className="ml-7">
              <label className={`block text-sm ${textSecondary} mb-1`}>Frequency</label>
              <select
                value={localConfig.frequency}
                onChange={(e) => updateLocal({ frequency: e.target.value })}
                className={`px-3 py-1.5 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
              >
                <option value="hourly">Hourly (keep 24)</option>
                <option value="daily">Daily (keep 30)</option>
                <option value="weekly">Weekly (keep 12)</option>
              </select>
              {status.local.lastBackup && (
                <p className={`text-xs ${textSecondary} mt-1`}>
                  Last backup: {new Date(status.local.lastBackup).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Remote Backup Settings */}
      <div>
        <h4 className={`font-medium ${textPrimary} mb-3 flex items-center gap-2`}>
          <Cloud size={16} />
          Remote Backups
        </h4>
        <div className="space-y-3 ml-1">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={remoteConfig.enabled}
              onChange={(e) => updateRemote({ enabled: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className={textPrimary}>Enable automatic remote backups</span>
          </label>
          <p className={`text-xs ${textSecondary} ml-7`}>
            Only enable on one device. If you use multiple devices, use Cloud Sync to keep them in sync and set up remote backups on your primary device only.
          </p>
          {remoteConfig.enabled && (
            <div className="ml-7 space-y-3">
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>Provider</label>
                <select
                  value={providerKey}
                  onChange={(e) => updateRemote({ provider: e.target.value })}
                  className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                >
                  {Object.entries(autoBackupProviders).map(([key, p]) => (
                    <option key={key} value={key}>{p.name}</option>
                  ))}
                </select>
              </div>

              {provider.configFields.map(field => (
                <div key={field.key}>
                  <label className={`block text-sm ${textSecondary} mb-1`}>{field.label}</label>
                  <input
                    type={field.type}
                    placeholder={field.placeholder}
                    value={remoteConfig[field.key] || ''}
                    onChange={(e) => updateRemote({ [field.key]: e.target.value })}
                    className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                  />
                </div>
              ))}

              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>Frequency</label>
                <select
                  value={remoteConfig.frequency}
                  onChange={(e) => updateRemote({ frequency: e.target.value })}
                  className={`px-3 py-1.5 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                >
                  <option value="hourly">Hourly (keep 24)</option>
                  <option value="daily">Daily (keep 30)</option>
                  <option value="weekly">Weekly (keep 12)</option>
                </select>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleTest}
                  disabled={testing || !remoteConfig.nextcloudUrl || !remoteConfig.username || !remoteConfig.appPassword}
                  className={`px-3 py-1.5 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-lg transition-colors disabled:opacity-50 text-sm`}
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  onClick={() => onRemoteBackupNow(remoteConfig.frequency)}
                  disabled={status.remote.status === 'backing-up' || !remoteConfig.nextcloudUrl || !remoteConfig.username || !remoteConfig.appPassword}
                  className={`px-3 py-1.5 ${darkMode ? 'bg-blue-700 hover:bg-blue-600' : 'bg-blue-500 hover:bg-blue-600'} text-white rounded-lg transition-colors disabled:opacity-50 text-sm`}
                >
                  {status.remote.status === 'backing-up' ? 'Backing up...' : 'Backup Now'}
                </button>
                {testResult && (
                  <span className={`text-sm ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
                    {testResult.success ? 'Connected!' : testResult.error}
                  </span>
                )}
              </div>

              {status.remote.lastBackup && (
                <p className={`text-xs ${textSecondary}`}>
                  Last backup: {new Date(status.remote.lastBackup).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const DayPlanner = () => {
  const _visibleDays = useVisibleDays();
  const { isPhone, isMobile, isTablet } = useDeviceType();
  const isLandscape = useIsLandscape();
  const [timelineScrolledAway, setTimelineScrolledAway] = useState(false);
  const [tabletActiveTab, setTabletActiveTab] = useState('glance'); // 'glance' | 'inbox' — for landscape tabbed panel
  // Override visible days: tablet uses orientation (static panel always present), mobile always 1, desktop uses width-based hook
  const visibleDays = isTablet ? (isLandscape ? 2 : 1) : isMobile ? 1 : _visibleDays;
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('day-planner-darkmode');
    return saved ? JSON.parse(saved) : false;
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return today;
  });
  const [tasks, setTasks] = useState([]);
  const [unscheduledTasks, setUnscheduledTasks] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false); // Track if initial data has been loaded
  const [recycleBin, setRecycleBin] = useState([]);
  const [recurringTasks, setRecurringTasks] = useState([]);
  const [showRecurrencePicker, setShowRecurrencePicker] = useState(false);
  const [recurringDeleteConfirm, setRecurringDeleteConfirm] = useState(null); // { taskId, dateStr }
  const [editingRecurrenceTaskId, setEditingRecurrenceTaskId] = useState(null); // recurring composite ID string
  const [showRecurrenceEndDatePicker, setShowRecurrenceEndDatePicker] = useState(null); // { source: 'edit' | 'new', templateId?: number }
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', startTime: '09:00', duration: 30 });
  const [draggedTask, setDraggedTask] = useState(null);
  const [dragSource, setDragSource] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [minimizedSections, setMinimizedSections] = useState(() => {
    const saved = localStorage.getItem('minimizedSections');
    return saved ? JSON.parse(saved) : {
      overdue: false,
      inbox: false,
      dayglance: false,
      dailySummary: false,
      allTimeSummary: false,
      recycleBin: false,
      tags: false
    };
  });
  const [selectedTags, setSelectedTags] = useState(() => {
    const saved = localStorage.getItem('day-planner-selected-tags');
    return saved ? JSON.parse(saved) : [];
  });
  const [showUntagged, setShowUntagged] = useState(() => {
    const saved = localStorage.getItem('day-planner-show-untagged');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [use24HourClock, setUse24HourClock] = useState(() => {
    const saved = localStorage.getItem('day-planner-use-24h-clock');
    return saved !== null ? JSON.parse(saved) : false;
  });
  const [pendingPriorities, setPendingPriorities] = useState({});
  const [syncUrl, setSyncUrl] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(null);
  const [expandedTaskMenu, setExpandedTaskMenu] = useState(null);
  const [expandedNotesTaskId, setExpandedNotesTaskId] = useState(null);
  const longPressTriggeredRef = useRef(false); // Track if long press just triggered to prevent click
  const longPressTimerRef = useRef(null);
  const hasCheckedInitialWelcome = useRef(false); // Track if we've done the initial welcome check
  const skipOnboardingPersist = useRef(false); // Skip persisting onboarding dismissal (for testing)
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [deadlinePickerTaskId, setDeadlinePickerTaskId] = useState(null); // Task ID for deadline date picker
  const [showNewTaskDeadlinePicker, setShowNewTaskDeadlinePicker] = useState(false); // Deadline dropdown for new inbox task
  const [showMonthView, setShowMonthView] = useState(false);
  const [viewedMonth, setViewedMonth] = useState(() => new Date());
  const [showEmptyBinConfirm, setShowEmptyBinConfirm] = useState(false);
  const [showMobileRecycleBin, setShowMobileRecycleBin] = useState(false);
  const [mobileReviewPage, setMobileReviewPage] = useState(0);
  const [showMobileDailySummary, setShowMobileDailySummary] = useState(false);
  const [showMobileTagFilter, setShowMobileTagFilter] = useState(false);
  const reviewScrollRef = useRef(null);
  const [syncNotification, setSyncNotification] = useState(null); // { type: 'success' | 'error' | 'info', message: string }
  const [isSyncing, setIsSyncing] = useState(false);
  const [calSyncStatus, setCalSyncStatus] = useState(null); // null | 'success' | 'error'
  const [calSyncLastSynced, setCalSyncLastSynced] = useState(() =>
    localStorage.getItem('day-planner-cal-sync-last-synced') || null
  );
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTaskText, setEditingTaskText] = useState('');
  const [taskCalendarUrl, setTaskCalendarUrl] = useState('');
  const [completedTaskUids, setCompletedTaskUids] = useState(new Set());
  const [pendingImportFile, setPendingImportFile] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importColor, setImportColor] = useState('bg-gray-600');
  const [pendingBackupFile, setPendingBackupFile] = useState(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showBackupMenu, setShowBackupMenu] = useState(false);
  const [weather, setWeather] = useState(null);
  const [dailyContent, setDailyContent] = useState({
    dadJoke: null,
    funFact: null,
    quote: null,
    history: null
  });
  const [contentRotation, setContentRotation] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved ? JSON.parse(saved) : false;
  });
  const [dragPreviewTime, setDragPreviewTime] = useState(null);
  const [dragPreviewDate, setDragPreviewDate] = useState(null);
  const [dragOverAllDay, setDragOverAllDay] = useState(null);
  const [dragOverInbox, setDragOverInbox] = useState(false);
  const [dragOverRecycleBin, setDragOverRecycleBin] = useState(false);
  const [hoverPreviewTime, setHoverPreviewTime] = useState(null);
  const [hoverPreviewDate, setHoverPreviewDate] = useState(null);
  const [isResizing, setIsResizing] = useState(false);
  const [inboxPriorityFilter, setInboxPriorityFilter] = useState(() => {
    const saved = localStorage.getItem('inboxPriorityFilter');
    return saved ? JSON.parse(saved) : 0;
  }); // 0 = show all, 1-3 = show >= that priority
  const [hideCompletedInbox, setHideCompletedInbox] = useState(() => {
    return localStorage.getItem('hideCompletedInbox') === 'true';
  });
  const [priorityPromptDismissed, setPriorityPromptDismissed] = useState(() => {
    return localStorage.getItem('priorityPromptDismissed') === 'true';
  });
  // Tablet layout state
  // Mobile layout state
  const [mobileActiveTab, setMobileActiveTab] = useState('dayglance');
  const [mobileWelcomeStep, setMobileWelcomeStep] = useState(0);
  const [desktopWelcomeStep, setDesktopWelcomeStep] = useState(0);
  const [mobileEditingTask, setMobileEditingTask] = useState(null);
  const [mobileEditIsInbox, setMobileEditIsInbox] = useState(false);
  const [mobileSettingsView, setMobileSettingsView] = useState('main');
  const [mobileDragPreviewTime, setMobileDragPreviewTime] = useState(null);
  const [mobileDragTaskIdState, setMobileDragTaskIdState] = useState(null);

  // Onboarding state - start false, set true after data loads if zero tasks
  const [showWelcome, setShowWelcome] = useState(false);
  const [sectionInfoDismissed, setSectionInfoDismissed] = useState(() => {
    const saved = localStorage.getItem('sectionInfoDismissed');
    return saved ? JSON.parse(saved) : { inbox: false, tags: false, recycleBin: false };
  });
  const [expandedSectionInfo, setExpandedSectionInfo] = useState(null); // 'inbox' | 'tags' | 'recycleBin' | null
  const [gettingStartedDismissed, setGettingStartedDismissed] = useState(() => {
    return localStorage.getItem('gettingStartedDismissed') === 'true';
  });
  const [onboardingComplete, setOnboardingComplete] = useState(false); // Session-only: user clicked "I'm Good to Go"
  const [onboardingProgress, setOnboardingProgress] = useState(() => {
    const saved = localStorage.getItem('onboardingProgress');
    return saved ? JSON.parse(saved) : {
      hasAddedInboxTask: false,
      hasAddedScheduledTask: false,
      hasDraggedToTimeline: false,
      hasAddedDeadline: false,
      hasSetPriority: false,
      hasAddedNotes: false,
      hasUsedTags: false,
      hasUsedActionButtons: false,
      hasCompletedTask: false,
      hasSetupSync: false,
      hasCreatedRecurring: false,
      hasSetupRoutines: false,
      hasUsedFocusMode: false,
    };
  });
  const [suggestions, setSuggestions] = useState([]); // Array of { type: 'tag'|'date'|'time', value, display, ... }
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionContext, setSuggestionContext] = useState(null); // 'newTask' | 'editing'
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(null); // task id or null
  const calendarRef = useRef(null);
  const suppressScrollAwayRef = useRef(false); // suppress scroll-away detection during programmatic scrolls
  const newTaskInputRef = useRef(null);
  const editingInputRef = useRef(null);
  const timeGridRef = useRef(null);
  const currentTimeRef = useRef(null);
  const priorityTimeouts = useRef({});
  const autoScrollInterval = useRef(null); // For drag auto-scroll
  const stickyHeaderRef = useRef(null); // For measuring sticky header height during drag
  const taskElementRefs = useRef({});
  const [taskWidths, setTaskWidths] = useState({});

  // Mobile swipe gesture refs
  const swipeTouchStartX = useRef(0);
  const swipeTouchStartY = useRef(0);
  const swipeCurrentOffset = useRef(0);
  const swipedTaskId = useRef(null);
  const swipeDirection = useRef(null); // 'left' | 'right' | null
  const swipeLocked = useRef(false);
  const swipeIsVertical = useRef(false);
  const swipeTaskElement = useRef(null);
  const swipeSchedulingInboxTaskId = useRef(null); // inbox task being scheduled via swipe

  // Mobile long-press drag refs
  const mobileDragActive = useRef(false);
  const mobileDragTaskId = useRef(null);
  const mobileDragTimer = useRef(null);
  const mobileDragOriginalTask = useRef(null);
  const mobileDragTouchStartPos = useRef({ x: 0, y: 0 });
  const mobileDragAutoScrollInterval = useRef(null);
  const mobileDragLastTouch = useRef({ clientX: 0, clientY: 0 });
  const mobileDragScrollDir = useRef(null);
  const mobileDragPreventScrollRef = useRef(null);
  const mobileDragStartScrollTop = useRef(0);
  const mobileDateHeaderRef = useRef(null);
  const mobileAllDaySectionRef = useRef(null);
  const mobileDragSourceType = useRef(null); // 'timeline' or 'allday'

  // Routines state
  const [routineDefinitions, setRoutineDefinitions] = useState({ monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [], everyday: [] });
  const [todayRoutines, setTodayRoutines] = useState([]);
  const [routinesDate, setRoutinesDate] = useState('');
  const [removedTodayRoutineIds, setRemovedTodayRoutineIds] = useState({});
  const [showRoutinesDashboard, setShowRoutinesDashboard] = useState(false);
  const [dashboardSelectedChips, setDashboardSelectedChips] = useState([]);
  const [routineAddingToBucket, setRoutineAddingToBucket] = useState(null);
  const [routineNewChipName, setRoutineNewChipName] = useState('');
  const [routineTimePickerChipId, setRoutineTimePickerChipId] = useState(null);
  const [routineDeleteConfirm, setRoutineDeleteConfirm] = useState(null); // { bucket, chipId, chipName }
  const [routineFocusedChipId, setRoutineFocusedChipId] = useState(null); // touch: first tap shows buttons, second executes
  const [routineDurationEditId, setRoutineDurationEditId] = useState(null); // id of routine chip being duration-edited on timeline

  // Keyboard shortcut cheat sheet
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  // Focus Mode state
  const [showFocusMode, setShowFocusMode] = useState(false);
  const [focusPhase, setFocusPhase] = useState('work'); // 'work' | 'shortBreak' | 'longBreak'
  const [focusTimerSeconds, setFocusTimerSeconds] = useState(0);
  const [focusCycleCount, setFocusCycleCount] = useState(0);
  const [focusSessionStart, setFocusSessionStart] = useState(null);
  const [focusWorkMinutes, setFocusWorkMinutes] = useState(25);
  const [focusBreakMinutes, setFocusBreakMinutes] = useState(5);
  const [focusLongBreakMinutes, setFocusLongBreakMinutes] = useState(15);
  const [focusCompletedTasks, setFocusCompletedTasks] = useState(new Set());
  const [focusShowStats, setFocusShowStats] = useState(false);
  const [focusShowSettings, setFocusShowSettings] = useState(true);
  const [focusTimerRunning, setFocusTimerRunning] = useState(false);
  const [focusTaskMinutes, setFocusTaskMinutes] = useState({});
  const [focusBlockTasks, setFocusBlockTasks] = useState([]);
  const wakeLockSentinel = useRef(null);
  const focusTimerRef = useRef(null);
  const focusModeAvailableRef = useRef(false);

  // Cloud Sync state
  const [cloudSyncConfig, setCloudSyncConfig] = useState(() => {
    const saved = localStorage.getItem('day-planner-cloud-sync-config');
    return saved ? JSON.parse(saved) : null;
  });
  const [cloudSyncStatus, setCloudSyncStatus] = useState('idle');
  const [cloudSyncError, setCloudSyncError] = useState(null);
  const [cloudSyncLastSynced, setCloudSyncLastSynced] = useState(() =>
    localStorage.getItem('day-planner-cloud-sync-last-synced') || null
  );
  const cloudSyncDebounceRef = useRef(null);
  const suppressCloudUploadRef = useRef(false);
  const suppressTimestampRef = useRef(false);
  const cloudSyncInProgressRef = useRef(false);
  const cloudSyncInitialDoneRef = useRef(false);
  const cloudSyncDownloadRef = useRef(null);
  const drainNotificationQueueRef = useRef(null);
  const [cloudSyncConflict, setCloudSyncConflict] = useState(null); // { remoteData, remoteModified }

  // Auto-Backup state
  const [autoBackupConfig, setAutoBackupConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('day-planner-auto-backup-config');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      local: { enabled: false, frequency: 'daily' },
      remote: { enabled: false, frequency: 'daily', provider: 'nextcloud' }
    };
  });
  const [autoBackupStatus, setAutoBackupStatus] = useState(() => ({
    local: { lastBackup: localStorage.getItem('day-planner-auto-backup-local-last') || null, status: 'idle' },
    remote: { lastBackup: localStorage.getItem('day-planner-auto-backup-remote-last') || null, status: 'idle' }
  }));
  const [showAutoBackupManager, setShowAutoBackupManager] = useState(false);
  const [autoBackupManagerTab, setAutoBackupManagerTab] = useState('settings'); // 'settings' | 'history'
  const [autoBackupHistory, setAutoBackupHistory] = useState({ local: [], remote: [] });
  const [autoBackupRestoreConfirm, setAutoBackupRestoreConfirm] = useState(null); // { type: 'local'|'remote', id, filename, timestamp }
  const autoBackupInProgressRef = useRef(false);

  // Undo/redo stacks (refs to avoid re-renders)
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const tasksRef = useRef(tasks);
  const unscheduledTasksRef = useRef(unscheduledTasks);
  const recycleBinRef = useRef(recycleBin);
  const recurringTasksRef = useRef(recurringTasks);

  // Undo/redo toast notification — { message: string, actionable: boolean }
  const [undoToast, setUndoToast] = useState(null);

  // Settings & Reminders modals
  const [showSettings, setShowSettings] = useState(false);
  const [showRemindersSettings, setShowRemindersSettings] = useState(false);
  const [reminderSettings, setReminderSettings] = useState(() => {
    const defaults = {
      enabled: false,
      inAppToasts: true,
      browserNotifications: false,
      morningReminderTime: '08:00',
      categories: {
        calendarEvents:  { before15: true, before10: false, before5: false, atStart: true, atEnd: false },
        calendarTasks:   { before15: true, before10: false, before5: false, atStart: true, atEnd: false },
        scheduledTasks:  { before15: true, before10: false, before5: false, atStart: true, atEnd: false },
        allDayTasks:     { morningReminder: true },
        recurringTasks:  { before15: true, before10: false, before5: false, atStart: true, atEnd: false },
      },
      preset: 'standard',
      weeklyReview: { enabled: true, day: 0, time: '19:00' }
    };
    try {
      const saved = localStorage.getItem('day-planner-reminder-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!parsed.weeklyReview) parsed.weeklyReview = defaults.weeklyReview;
        return parsed;
      }
    } catch {}
    return defaults;
  });
  const [activeReminders, setActiveReminders] = useState([]);
  const [showMorningTimePicker, setShowMorningTimePicker] = useState(false);
  const firedRemindersRef = useRef(new Set());
  const swMessageHandlersRef = useRef({});
  const lastReminderDateRef = useRef((() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })());
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('day-planner-sound-enabled');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const audioCtxRef = useRef(null);

  // Incomplete tasks modal
  const [showIncompleteTasks, setShowIncompleteTasks] = useState(null); // null | 'today' | 'allTime'

  // Weekly Review modal
  const [showWeeklyReview, setShowWeeklyReview] = useState(false);
  const [showWeeklyReviewTimePicker, setShowWeeklyReviewTimePicker] = useState(false);
  const [showWeeklyReviewReminder, setShowWeeklyReviewReminder] = useState(false);
  const lastWeeklyReviewFiredRef = useRef(
    localStorage.getItem('day-planner-weekly-review-fired') || ''
  );
  const weeklyReviewDismissedRef = useRef(
    localStorage.getItem('day-planner-weekly-review-dismissed') || ''
  );

  // Spotlight search
  const [showSpotlight, setShowSpotlight] = useState(false);
  const [spotlightQuery, setSpotlightQuery] = useState('');
  const [spotlightSelectedIndex, setSpotlightSelectedIndex] = useState(0);
  const spotlightInputRef = useRef(null);

  // Show all 24 hours (full day) - scrollable
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const firstHour = 0; // Always start at midnight for positioning
  const colors = [
    { name: 'Blue', class: 'bg-blue-500' },
    { name: 'Purple', class: 'bg-purple-500' },
    { name: 'Green', class: 'bg-green-500' },
    { name: 'Orange', class: 'bg-orange-500' },
    { name: 'Pink', class: 'bg-pink-500' },
    { name: 'Indigo', class: 'bg-indigo-500' },
    { name: 'Red', class: 'bg-red-500' },
    { name: 'Teal', class: 'bg-teal-500' },
    { name: 'Yellow', class: 'bg-yellow-500' },
  ];
  const durationOptions = [15, 30, 45, 60, 90, 120];

  // Try to lock orientation to portrait on phones (works for installed PWAs)
  useEffect(() => {
    if (isPhone && screen.orientation?.lock) {
      screen.orientation.lock('portrait').catch(() => {});
    }
  }, [isPhone]);

  // Clear swipe-scheduling ref if add-task modal was dismissed without submitting
  useEffect(() => {
    if (!showAddTask) {
      swipeSchedulingInboxTaskId.current = null;
    }
  }, [showAddTask]);

  // Measure task widths using ResizeObserver
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const newWidths = {};
      let hasChanges = false;

      for (const entry of entries) {
        const taskId = entry.target.dataset.taskId;
        if (taskId) {
          const width = entry.contentRect.width;
          if (taskWidths[taskId] !== width) {
            newWidths[taskId] = width;
            hasChanges = true;
          }
        }
      }

      if (hasChanges) {
        setTaskWidths(prev => ({ ...prev, ...newWidths }));
      }
    });

    // Observe all registered task elements
    Object.values(taskElementRefs.current).forEach(el => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [tasks, visibleDays, mobileActiveTab]); // Re-setup when tasks, visible days, or mobile tab change

  // Ref callback for task elements
  const setTaskRef = (taskId) => (element) => {
    if (element) {
      taskElementRefs.current[taskId] = element;
      // Measure after layout settles (calc-based widths need a frame to resolve)
      requestAnimationFrame(() => {
        if (!element.isConnected) return;
        const width = element.offsetWidth;
        if (width > 0 && taskWidths[taskId] !== width) {
          setTaskWidths(prev => ({ ...prev, [taskId]: width }));
        }
      });
    } else {
      delete taskElementRefs.current[taskId];
    }
  };

  const extractTags = (title) => {
    // Only match tags that start with a letter (not pure numbers)
    const matches = title.match(/#([a-zA-Z]\w*)/g);
    return matches ? matches.map(tag => tag.slice(1).toLowerCase()) : [];
  };

  const renderTitle = (title) => {
    // Only style tags that start with a letter (not pure numbers)
    const parts = title.split(/(#[a-zA-Z]\w*)/g);
    return parts.map((part, i) => {
      if (part.match(/^#[a-zA-Z]\w*$/)) {
        return <span key={i} className="text-xs italic opacity-75">{part}</span>;
      }
      return part;
    });
  };

  const highlightMatch = (text, query) => {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    // Truncate long text (e.g. notes) to ±30 chars around the match
    let display = text;
    let matchIdx = idx;
    if (text.length > 80) {
      const start = Math.max(0, idx - 30);
      const end = Math.min(text.length, idx + query.length + 30);
      display = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
      matchIdx = idx - start + (start > 0 ? 1 : 0);
    }
    return (
      <span>
        {display.slice(0, matchIdx)}
        <span className="font-bold text-blue-500">{display.slice(matchIdx, matchIdx + query.length)}</span>
        {display.slice(matchIdx + query.length)}
      </span>
    );
  };

  const renderTitleWithoutTags = (title) => {
    // Remove tags and trim extra whitespace
    return title.replace(/#[a-zA-Z]\w*/g, '').replace(/\s+/g, ' ').trim();
  };


  // Extract partial tag being typed at cursor position
  const getPartialTag = (text, cursorPos) => {
    // Scan backwards from cursor to find #
    let startIndex = cursorPos - 1;
    while (startIndex >= 0) {
      const char = text[startIndex];
      if (char === '#') {
        const partial = text.slice(startIndex + 1, cursorPos);
        // Only match if partial starts with a letter (valid tag format)
        if (partial === '' || /^[a-zA-Z]\w*$/.test(partial)) {
          return { tag: partial.toLowerCase(), startIndex };
        }
        return null;
      }
      // Stop if we hit a space or other non-word character (except # which we're looking for)
      if (!/\w/.test(char)) {
        return null;
      }
      startIndex--;
    }
    return null;
  };

  // Filter tags matching partial (case-insensitive prefix match)
  const getFilteredTags = (partial, allTagsList) => {
    if (!partial && partial !== '') return [];
    const lowerPartial = partial.toLowerCase();
    return allTagsList
      .filter(tag => tag.toLowerCase().startsWith(lowerPartial))
      .sort();
  };

  // Replace partial tag with completed tag
  const applyTagCompletion = (text, cursorPos, selectedTag) => {
    const partialInfo = getPartialTag(text, cursorPos);
    if (!partialInfo) return { text, newCursorPos: cursorPos };

    const before = text.slice(0, partialInfo.startIndex);
    const after = text.slice(cursorPos);
    const completedTag = `#${selectedTag}`;
    const newText = before + completedTag + after;
    const newCursorPos = before.length + completedTag.length;

    return { text: newText, newCursorPos };
  };

  // Extract partial date being typed at cursor position (triggered by @)
  const getPartialDate = (text, cursorPos) => {
    // Scan backwards from cursor to find @
    let startIndex = cursorPos - 1;
    while (startIndex >= 0) {
      const char = text[startIndex];
      if (char === '@') {
        const partial = text.slice(startIndex + 1, cursorPos);
        // Require at least 1 character after @ and allow letters, numbers, spaces, slashes, dashes
        if (partial.length >= 1 && /^[\w\s\/\-,]*$/.test(partial)) {
          return { partial, startIndex };
        }
        return null;
      }
      // Stop if we hit certain characters that wouldn't be part of a date
      if (/[#~!$%]/.test(char)) {
        return null;
      }
      startIndex--;
    }
    return null;
  };

  // Extract partial time being typed at cursor position (triggered by ~)
  const getPartialTime = (text, cursorPos) => {
    // Scan backwards from cursor to find ~
    let startIndex = cursorPos - 1;
    while (startIndex >= 0) {
      const char = text[startIndex];
      if (char === '~') {
        const partial = text.slice(startIndex + 1, cursorPos);
        // Require at least 1 character after ~ and allow letters, numbers, colons, spaces
        if (partial.length >= 1 && /^[\w\s:]*$/.test(partial)) {
          return { partial, startIndex };
        }
        return null;
      }
      // Stop if we hit certain characters that wouldn't be part of a time
      if (/[#@!$%]/.test(char)) {
        return null;
      }
      startIndex--;
    }
    return null;
  };

  // Extract partial deadline being typed at cursor position (triggered by $)
  const getPartialDeadline = (text, cursorPos) => {
    // Scan backwards from cursor to find $
    let startIndex = cursorPos - 1;
    while (startIndex >= 0) {
      const char = text[startIndex];
      if (char === '$') {
        const partial = text.slice(startIndex + 1, cursorPos);
        // Require at least 1 character after $ and allow letters, numbers, spaces, slashes, dashes
        if (partial.length >= 1 && /^[\w\s\/\-,]*$/.test(partial)) {
          return { partial, startIndex };
        }
        return null;
      }
      // Stop if we hit certain characters that wouldn't be part of a deadline
      if (/[#@~!%]/.test(char)) {
        return null;
      }
      startIndex--;
    }
    return null;
  };

  // Extract priority being typed at cursor position (triggered by !, !!, or !!!)
  const getPartialPriority = (text, cursorPos) => {
    // Scan backwards from cursor to count consecutive ! marks
    let endIndex = cursorPos;
    let startIndex = cursorPos - 1;
    let count = 0;

    while (startIndex >= 0 && text[startIndex] === '!') {
      count++;
      startIndex--;
    }

    if (count === 0) return null;

    // Require ! to be preceded by whitespace or start of string
    if (startIndex >= 0 && !/\s/.test(text[startIndex])) {
      return null;
    }

    // Cap at 3
    const priority = Math.min(count, 3);

    return {
      count: priority,
      startIndex: startIndex + 1,
      endIndex
    };
  };

  // Extract partial duration being typed at cursor position (triggered by %)
  const getPartialDuration = (text, cursorPos) => {
    let startIndex = cursorPos - 1;
    while (startIndex >= 0) {
      const char = text[startIndex];
      if (char === '%') {
        const partial = text.slice(startIndex + 1, cursorPos);
        if (/^\d*$/.test(partial)) {
          return { partial, startIndex, endIndex: cursorPos };
        }
        return null;
      }
      if (!/\d/.test(char)) return null;
      startIndex--;
    }
    return null;
  };

  // Parse flexible date formats and return ALL matching candidates for prefix
  const getDateCandidates = (partial) => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const currentYear = today.getFullYear();
    const lowerPartial = partial.toLowerCase().trim();
    if (!lowerPartial) return [];

    const candidates = [];

    // Natural language dates — prefix match
    const naturalDates = [
      { keywords: ['today', 'tod'], getDate: () => today, display: 'Today', keyword: 'today' },
      { keywords: ['tomorrow', 'tom'], getDate: () => { const d = new Date(today); d.setDate(d.getDate() + 1); return d; }, display: 'Tomorrow', keyword: 'tomorrow' },
      { keywords: ['yesterday'], getDate: () => { const d = new Date(today); d.setDate(d.getDate() - 1); return d; }, display: 'Yesterday', keyword: 'yesterday' },
    ];

    for (const nd of naturalDates) {
      if (nd.keywords.some(k => k.startsWith(lowerPartial) || lowerPartial === k)) {
        candidates.push({ date: nd.getDate(), display: nd.display, keyword: nd.keyword });
      }
    }

    // Day names (next occurrence) — prefix match
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayAbbrevs = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    for (let i = 0; i < dayNames.length; i++) {
      if (dayNames[i].startsWith(lowerPartial) || dayAbbrevs[i] === lowerPartial) {
        const targetDate = new Date(today);
        const currentDay = today.getDay();
        let daysToAdd = i - currentDay;
        if (daysToAdd <= 0) daysToAdd += 7;
        targetDate.setDate(targetDate.getDate() + daysToAdd);
        candidates.push({ date: targetDate, display: dayNames[i].charAt(0).toUpperCase() + dayNames[i].slice(1), keyword: dayNames[i] });
      }
    }

    // "next week" — prefix match
    if ('next week'.startsWith(lowerPartial) || lowerPartial === 'next week') {
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      candidates.push({ date: nextWeek, display: 'Next week', keyword: 'next week' });
    }

    // "next monday", "next tuesday", etc.
    const nextDayMatch = lowerPartial.match(/^next\s+(\w+)$/);
    if (nextDayMatch) {
      const dayName = nextDayMatch[1];
      for (let i = 0; i < dayNames.length; i++) {
        if (dayNames[i].startsWith(dayName) || dayAbbrevs[i] === dayName) {
          const targetDate = new Date(today);
          const currentDay = today.getDay();
          let daysToAdd = i - currentDay;
          if (daysToAdd <= 0) daysToAdd += 7;
          targetDate.setDate(targetDate.getDate() + daysToAdd);
          candidates.push({ date: targetDate, display: `Next ${dayNames[i].charAt(0).toUpperCase() + dayNames[i].slice(1)}`, keyword: `next ${dayNames[i]}` });
        }
      }
    }

    // Month names
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const monthAbbrevs = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

    // "Feb 15" or "February 15" or "Feb 15 2026" or "February 15, 2026"
    const monthDayMatch = lowerPartial.match(/^(\w+)\s+(\d{1,2})(?:[,\s]+(\d{4}))?$/);
    if (monthDayMatch) {
      const [, monthStr, dayStr, yearStr] = monthDayMatch;
      let monthIdx = monthNames.findIndex(m => m.startsWith(monthStr));
      if (monthIdx === -1) monthIdx = monthAbbrevs.findIndex(m => m === monthStr);
      if (monthIdx !== -1) {
        const day = parseInt(dayStr, 10);
        const year = yearStr ? parseInt(yearStr, 10) : currentYear;
        if (day >= 1 && day <= 31) {
          const targetDate = new Date(year, monthIdx, day, 12, 0, 0);
          if (!isNaN(targetDate.getTime())) {
            candidates.push({ date: targetDate, display: targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) });
          }
        }
      }
    }

    // MM-DD-YYYY or MM-DD
    const dashMatch = partial.match(/^(\d{1,2})-(\d{1,2})(?:-(\d{4}))?$/);
    if (dashMatch) {
      const [, monthStr, dayStr, yearStr] = dashMatch;
      const month = parseInt(monthStr, 10);
      const day = parseInt(dayStr, 10);
      const year = yearStr ? parseInt(yearStr, 10) : currentYear;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const targetDate = new Date(year, month - 1, day, 12, 0, 0);
        if (!isNaN(targetDate.getTime())) {
          candidates.push({ date: targetDate, display: targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) });
        }
      }
    }

    // M/D/YYYY or M/D
    const slashMatch = partial.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (slashMatch) {
      const [, monthStr, dayStr, yearStr] = slashMatch;
      const month = parseInt(monthStr, 10);
      const day = parseInt(dayStr, 10);
      const year = yearStr ? parseInt(yearStr, 10) : currentYear;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const targetDate = new Date(year, month - 1, day, 12, 0, 0);
        if (!isNaN(targetDate.getTime())) {
          candidates.push({ date: targetDate, display: targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) });
        }
      }
    }

    return candidates;
  };

  // Backward-compat wrapper: returns first match or null
  const parseFlexibleDate = (partial) => {
    const candidates = getDateCandidates(partial);
    return candidates.length > 0 ? candidates[0] : null;
  };

  // Parse flexible time formats and return ALL matching candidates for prefix
  const getTimeCandidates = (partial) => {
    const lowerPartial = partial.toLowerCase().trim();
    if (!lowerPartial) return [];

    const candidates = [];

    // Natural language times — prefix match
    const naturalTimes = [
      { keywords: ['noon'], time: '12:00', display: '12:00 PM (Noon)', keyword: 'noon' },
      { keywords: ['midnight'], time: '00:00', display: '12:00 AM (Midnight)', keyword: 'midnight' },
      { keywords: ['morning', 'morn'], time: '09:00', display: '9:00 AM (Morning)', keyword: 'morning' },
      { keywords: ['afternoon'], time: '14:00', display: '2:00 PM (Afternoon)', keyword: 'afternoon' },
      { keywords: ['evening', 'eve'], time: '18:00', display: '6:00 PM (Evening)', keyword: 'evening' },
      { keywords: ['night'], time: '21:00', display: '9:00 PM (Night)', keyword: 'night' },
    ];

    for (const nt of naturalTimes) {
      if (nt.keywords.some(k => k.startsWith(lowerPartial) || lowerPartial === k)) {
        candidates.push({ time: nt.time, display: nt.display, keyword: nt.keyword });
      }
    }

    // Bare number: e.g., "3" → 3:00 AM, 3:00 PM
    const bareNumberMatch = lowerPartial.match(/^(\d{1,2})$/);
    if (bareNumberMatch) {
      const num = parseInt(bareNumberMatch[1], 10);
      if (num >= 1 && num <= 12) {
        const amHour = num === 12 ? 0 : num;
        const pmHour = num === 12 ? 12 : num + 12;
        candidates.push({ time: `${amHour.toString().padStart(2, '0')}:00`, display: `${num}:00 AM`, keyword: `${num}am` });
        candidates.push({ time: `${pmHour.toString().padStart(2, '0')}:00`, display: `${num}:00 PM`, keyword: `${num}pm` });
      } else if (num >= 13 && num <= 23) {
        const displayHour = num > 12 ? num - 12 : num;
        candidates.push({ time: `${num.toString().padStart(2, '0')}:00`, display: `${displayHour}:00 PM`, keyword: `${num}:00` });
      }
    }

    // Number with partial am/pm: e.g., "3p" → 3:00 PM, "3a" → 3:00 AM
    const partialAmPmMatch = lowerPartial.match(/^(\d{1,2})(a|p)$/);
    if (partialAmPmMatch) {
      const num = parseInt(partialAmPmMatch[1], 10);
      const ap = partialAmPmMatch[2];
      if (num >= 1 && num <= 12) {
        if (ap === 'a') {
          const hour = num === 12 ? 0 : num;
          candidates.push({ time: `${hour.toString().padStart(2, '0')}:00`, display: `${num}:00 AM`, keyword: `${num}am` });
        } else {
          const hour = num === 12 ? 12 : num + 12;
          candidates.push({ time: `${hour.toString().padStart(2, '0')}:00`, display: `${num}:00 PM`, keyword: `${num}pm` });
        }
      }
    }

    // Number with colon and partial minutes: e.g., "3:" or "3:3" → quarter-hour options
    const colonPartialMatch = lowerPartial.match(/^(\d{1,2}):(\d?)$/);
    if (colonPartialMatch) {
      const hour = parseInt(colonPartialMatch[1], 10);
      const minPartial = colonPartialMatch[2];
      if (hour >= 1 && hour <= 12) {
        const minuteOptions = ['00', '15', '30', '45'].filter(m => m.startsWith(minPartial));
        for (const min of minuteOptions) {
          const amHour = hour === 12 ? 0 : hour;
          const pmHour = hour === 12 ? 12 : hour + 12;
          candidates.push({ time: `${amHour.toString().padStart(2, '0')}:${min}`, display: `${hour}:${min} AM`, keyword: `${hour}:${min}am` });
          candidates.push({ time: `${pmHour.toString().padStart(2, '0')}:${min}`, display: `${hour}:${min} PM`, keyword: `${hour}:${min}pm` });
        }
      } else if (hour >= 13 && hour <= 23) {
        const minuteOptions = ['00', '15', '30', '45'].filter(m => m.startsWith(minPartial));
        const displayHour = hour > 12 ? hour - 12 : hour;
        const ampm = hour >= 12 ? 'PM' : 'AM';
        for (const min of minuteOptions) {
          candidates.push({ time: `${hour.toString().padStart(2, '0')}:${min}`, display: `${displayHour}:${min} ${ampm}`, keyword: `${hour}:${min}` });
        }
      }
    }

    // Military time: HH:MM or H:MM (exact)
    const militaryMatch = partial.match(/^(\d{1,2}):(\d{2})$/);
    if (militaryMatch) {
      const hours = parseInt(militaryMatch[1], 10);
      const minutes = militaryMatch[2];
      if (hours >= 0 && hours <= 23 && !candidates.some(c => c.time === `${hours.toString().padStart(2, '0')}:${minutes}`)) {
        const timeStr = `${hours.toString().padStart(2, '0')}:${minutes}`;
        const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
        const ampm = hours >= 12 ? 'PM' : 'AM';
        candidates.push({ time: timeStr, display: `${displayHour}:${minutes} ${ampm}` });
      }
    }

    // 12-hour format: 2pm, 2:30pm, 2:30 pm, 2 pm
    const twelveHourMatch = lowerPartial.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
    if (twelveHourMatch) {
      let hours = parseInt(twelveHourMatch[1], 10);
      const minutes = twelveHourMatch[2] || '00';
      const ampm = twelveHourMatch[3];

      if (hours >= 1 && hours <= 12 && parseInt(minutes, 10) <= 59) {
        if (ampm === 'pm' && hours !== 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;

        const timeStr = `${hours.toString().padStart(2, '0')}:${minutes}`;
        if (!candidates.some(c => c.time === timeStr)) {
          const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
          const displayAmpm = hours >= 12 ? 'PM' : 'AM';
          candidates.push({ time: timeStr, display: `${displayHour}:${minutes} ${displayAmpm}` });
        }
      }
    }

    return candidates;
  };

  // Backward-compat wrapper: returns first match or null
  const parseFlexibleTime = (partial) => {
    const candidates = getTimeCandidates(partial);
    return candidates.length > 0 ? candidates[0] : null;
  };

  // Format time for display (respects 12h/24h setting)
  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    if (use24HourClock) return timeStr;
    const [hours, minutes] = timeStr.split(':').map(Number);
    const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${displayHour}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  // Remove detected date/time from title text
  const removeFromTitle = (text, startIndex, endIndex) => {
    const before = text.slice(0, startIndex);
    const after = text.slice(endIndex);
    // Clean up multiple spaces but preserve single trailing space for chaining
    return (before + after).replace(/\s+/g, ' ').trimStart();
  };

  // Autocomplete shortcut text in title when a suggestion is accepted
  // Replaces the partial text (e.g. "@to") with the full keyword (e.g. "@today")
  const completeShortcutText = (title, suggestion) => {
    if (!suggestion.keyword) return { text: title, cursorPos: title.length };
    const triggerChar = title[suggestion.startIndex]; // @, ~, $, etc.
    const before = title.slice(0, suggestion.startIndex);
    const after = title.slice(suggestion.endIndex);
    const completed = before + triggerChar + suggestion.keyword;
    return { text: completed + after, cursorPos: completed.length };
  };

  // Strip all special character sequences from a title before saving
  const cleanTitle = (title) => {
    return title
      .replace(/%\d+/g, '')           // %duration
      .replace(/@[\w\s/\-,]*/g, '')   // @date
      .replace(/~[\w\s:]*/g, '')      // ~time
      .replace(/\$[\w\s/\-,]*/g, '')  // $deadline
      .replace(/!{1,3}(?=\s|$)/g, '') // !priority
      .replace(/\s+/g, ' ')
      .trim();
  };

  useEffect(() => {
    loadData();
    fetchWeather();
    fetchAllDailyContent();

    // Rotate content every 15 minutes
    const rotationInterval = setInterval(() => {
      setContentRotation(prev => (prev + 1) % 4);
    }, 15 * 60 * 1000);

    // Refresh weather every hour
    const weatherInterval = setInterval(() => {
      fetchWeather();
    }, 60 * 60 * 1000);

    return () => {
      clearInterval(rotationInterval);
      clearInterval(weatherInterval);
    };
  }, []);

  // Close month view when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showMonthView && !e.target.closest('.month-view-container') && !e.target.closest('.month-view-toggle')) {
        setShowMonthView(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showMonthView]);

  // Close task menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (expandedTaskMenu && !e.target.closest('.task-menu-container')) {
        setExpandedTaskMenu(null);
      }
      if (showColorPicker && !e.target.closest('.color-picker-container')) {
        setShowColorPicker(null);
      }
      if (showDeadlinePicker && !e.target.closest('.deadline-picker-container')) {
        setShowDeadlinePicker(null);
      }
      if (expandedNotesTaskId && !e.target.closest('.notes-panel-container') && !e.target.closest('.notes-toggle-button')) {
        setExpandedNotesTaskId(null);
      }
      if (routineDurationEditId && !e.target.closest('.routine-duration-edit')) {
        setRoutineDurationEditId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [expandedTaskMenu, showColorPicker, showDeadlinePicker, expandedNotesTaskId, routineDurationEditId]);

  // Close notes panel on ESC
  useEffect(() => {
    if (!expandedNotesTaskId) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setExpandedNotesTaskId(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [expandedNotesTaskId]);

  // Auto-dismiss undo/redo toast — 4s for actionable (with Undo button), 2s for passive
  useEffect(() => {
    if (!undoToast) return;
    const delay = undoToast.actionable ? 4000 : 2000;
    const timer = setTimeout(() => setUndoToast(null), delay);
    return () => clearTimeout(timer);
  }, [undoToast]);

  // Keep undo/redo state refs in sync
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { unscheduledTasksRef.current = unscheduledTasks; }, [unscheduledTasks]);
  useEffect(() => { recycleBinRef.current = recycleBin; }, [recycleBin]);
  useEffect(() => { recurringTasksRef.current = recurringTasks; }, [recurringTasks]);

  // Persist darkMode to localStorage and update theme-color meta tag
  useEffect(() => {
    localStorage.setItem('day-planner-darkmode', JSON.stringify(darkMode));
    document.documentElement.classList.toggle('dark', darkMode);
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.setAttribute('content', darkMode ? '#1f2937' : '#2563eb');
  }, [darkMode]);

  // Persist minimizedSections to localStorage
  useEffect(() => {
    localStorage.setItem('minimizedSections', JSON.stringify(minimizedSections));
  }, [minimizedSections]);

  // Persist selectedTags to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-selected-tags', JSON.stringify(selectedTags));
  }, [selectedTags]);

  // Persist showUntagged to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-show-untagged', JSON.stringify(showUntagged));
  }, [showUntagged]);

  // Persist use24HourClock to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-use-24h-clock', JSON.stringify(use24HourClock));
  }, [use24HourClock]);

  // Persist reminderSettings to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-reminder-settings', JSON.stringify(reminderSettings));
  }, [reminderSettings]);

  // Persist soundEnabled to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-sound-enabled', JSON.stringify(soundEnabled));
  }, [soundEnabled]);

  // Persist sidebarCollapsed to localStorage
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', JSON.stringify(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // Persist inboxPriorityFilter to localStorage
  useEffect(() => {
    localStorage.setItem('inboxPriorityFilter', JSON.stringify(inboxPriorityFilter));
  }, [inboxPriorityFilter]);

  // Persist hideCompletedInbox to localStorage
  useEffect(() => {
    localStorage.setItem('hideCompletedInbox', hideCompletedInbox.toString());
  }, [hideCompletedInbox]);

  // Persist priorityPromptDismissed to localStorage
  useEffect(() => {
    localStorage.setItem('priorityPromptDismissed', priorityPromptDismissed.toString());
  }, [priorityPromptDismissed]);

  // Persist onboarding state to localStorage (handled in effect after hasZeroRealTasks is computed)

  useEffect(() => {
    if (!skipOnboardingPersist.current) {
      localStorage.setItem('sectionInfoDismissed', JSON.stringify(sectionInfoDismissed));
    }
  }, [sectionInfoDismissed]);

  useEffect(() => {
    if (gettingStartedDismissed && !skipOnboardingPersist.current) {
      localStorage.setItem('gettingStartedDismissed', 'true');
    }
  }, [gettingStartedDismissed]);

  useEffect(() => {
    localStorage.setItem('onboardingProgress', JSON.stringify(onboardingProgress));
  }, [onboardingProgress]);

  // Track for onboarding when sync is set up
  useEffect(() => {
    if (!onboardingProgress.hasSetupSync && (syncUrl.trim() || taskCalendarUrl.trim())) {
      setOnboardingProgress(prev => ({ ...prev, hasSetupSync: true }));
    }
  }, [syncUrl, taskCalendarUrl, onboardingProgress.hasSetupSync]);

  useEffect(() => {
    // Tick every 15s for responsive reminders; firedRemindersRef prevents duplicates
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Catch up on missed reminders and sync when tab becomes visible
  // Drain queued notification actions first, then update time and sync
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        // Process any queued SW notification actions (snooze/dismiss) before
        // updating time, so the reminder engine sees the updated task state
        drainNotificationQueueRef.current?.().then(() => {
          setCurrentTime(new Date());
          cloudSyncDownloadRef.current?.();
        }).catch(() => {
          setCurrentTime(new Date());
          cloudSyncDownloadRef.current?.();
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Focus Mode timer tick
  useEffect(() => {
    if (showFocusMode && focusTimerRunning && focusTimerSeconds > 0) {
      focusTimerRef.current = setInterval(() => {
        setFocusTimerSeconds(prev => {
          if (prev <= 1) return 0;
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(focusTimerRef.current);
    }
  }, [showFocusMode, focusTimerRunning, focusTimerSeconds > 0]);

  // Focus Mode timer end detection
  useEffect(() => {
    if (showFocusMode && focusTimerRunning && focusTimerSeconds === 0 && !focusShowSettings) {
      setFocusTimerRunning(false);
      handleFocusTimerEnd();
    }
  }, [focusTimerSeconds, showFocusMode, focusTimerRunning, focusShowSettings]);

  // Auto-refresh page at midnight (00:00:01) to reset the timeline to the new day
  useEffect(() => {
    const calculateMsUntilMidnight = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setDate(midnight.getDate() + 1);
      midnight.setHours(0, 0, 1, 0); // 00:00:01
      return midnight.getTime() - now.getTime();
    };

    const scheduleRefresh = () => {
      const msUntilMidnight = calculateMsUntilMidnight();
      return setTimeout(() => {
        window.location.reload();
      }, msUntilMidnight);
    };

    const midnightTimer = scheduleRefresh();

    return () => clearTimeout(midnightTimer);
  }, []);

  // Auto-sync calendars every 15 minutes when URLs are configured
  useEffect(() => {
    if (!syncUrl && !taskCalendarUrl) return;

    const syncTimer = setInterval(() => {
      syncAll({ silent: true });
    }, 15 * 60 * 1000); // 15 minutes

    return () => clearInterval(syncTimer);
  }, [syncUrl, taskCalendarUrl]);

  // Scroll timeline to start of current hour on date change / tab switch
  const scrollToCurrentHour = useCallback((smooth = false) => {
    const currentHour = new Date().getHours();
    const hourHeight = timeGridRef.current?.children?.[1]?.offsetHeight || 161;
    const scrollPosition = Math.max(0, currentHour * hourHeight);
    if (calendarRef.current) {
      if (smooth) {
        // Suppress scroll-away detection during the smooth scroll animation
        suppressScrollAwayRef.current = true;
        calendarRef.current.scrollTo({ top: scrollPosition, behavior: 'smooth' });
        // Re-enable after animation completes (smooth scroll typically takes ~300-500ms)
        setTimeout(() => { suppressScrollAwayRef.current = false; }, 600);
      } else {
        calendarRef.current.scrollTop = scrollPosition;
      }
    }
  }, []);

  useEffect(() => {
    const isToday = dateToString(selectedDate) === dateToString(new Date());
    if (isToday && calendarRef.current && (!isMobile || mobileActiveTab === 'timeline')) {
      setTimeout(() => scrollToCurrentHour(false), 100);
    }
  }, [selectedDate, isMobile, mobileActiveTab, scrollToCurrentHour]);

  // Detect when user scrolls away from current time (all form factors)
  useEffect(() => {
    // On mobile, only track when on timeline tab
    if (isMobile && mobileActiveTab !== 'timeline') { setTimelineScrolledAway(false); return; }
    const isToday = dateToString(selectedDate) === dateToString(new Date());
    if (!isToday) { setTimelineScrolledAway(false); return; }
    const el = calendarRef.current;
    if (!el) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking || suppressScrollAwayRef.current) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (suppressScrollAwayRef.current) return;
        const now = new Date();
        const hourHeight = timeGridRef.current?.children?.[1]?.offsetHeight || 161;
        const nowPos = (now.getHours() + now.getMinutes() / 60) * hourHeight;
        const viewTop = el.scrollTop;
        const viewBottom = viewTop + el.clientHeight;
        // Consider "scrolled away" when the current time line is fully outside the visible area
        setTimelineScrolledAway(nowPos < viewTop || nowPos > viewBottom);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // Delay initial check so the scroll-to-current-hour effect (100ms timeout) runs first
    const initialCheckTimer = setTimeout(onScroll, 200);
    return () => { el.removeEventListener('scroll', onScroll); clearTimeout(initialCheckTimer); };
  }, [isMobile, isTablet, selectedDate, mobileActiveTab]);

  // Auto-refocus timeline every 30 minutes on tablet and desktop
  useEffect(() => {
    if (isMobile) return;
    let intervalId = null;
    const now = new Date();
    // Calculate ms until next :00 or :30
    const min = now.getMinutes();
    const sec = now.getSeconds();
    const msToNext = ((min < 30 ? 30 : 60) - min) * 60000 - sec * 1000 - now.getMilliseconds();
    const timeoutId = setTimeout(() => {
      const isToday = dateToString(selectedDate) === dateToString(new Date());
      if (isToday && calendarRef.current) { setTimelineScrolledAway(false); scrollToCurrentHour(true); }
      // After the first aligned fire, set a regular 30-minute interval
      intervalId = setInterval(() => {
        const isTodayNow = dateToString(selectedDate) === dateToString(new Date());
        if (isTodayNow && calendarRef.current) { setTimelineScrolledAway(false); scrollToCurrentHour(true); }
      }, 30 * 60000);
    }, msToNext);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [isMobile, selectedDate, scrollToCurrentHour]);

  useEffect(() => {
    saveData();
    checkConflicts();
  }, [tasks, unscheduledTasks, recycleBin, taskCalendarUrl, completedTaskUids, recurringTasks, routineDefinitions, todayRoutines, routinesDate, removedTodayRoutineIds]);

  // Cloud sync: debounced upload on data changes
  useEffect(() => {
    if (!cloudSyncConfig?.enabled || !dataLoaded || suppressCloudUploadRef.current) return;
    if (cloudSyncDebounceRef.current) clearTimeout(cloudSyncDebounceRef.current);
    cloudSyncDebounceRef.current = setTimeout(() => {
      cloudSyncUpload();
    }, 5000);
    return () => { if (cloudSyncDebounceRef.current) clearTimeout(cloudSyncDebounceRef.current); };
  }, [tasks, unscheduledTasks, recycleBin, taskCalendarUrl, completedTaskUids, recurringTasks, routineDefinitions, todayRoutines, routinesDate, removedTodayRoutineIds, use24HourClock, cloudSyncConfig?.enabled]);

  // Cloud sync: download on app load or when sync is first enabled
  useEffect(() => {
    if (dataLoaded && cloudSyncConfig?.enabled) {
      cloudSyncDownload();
    } else if (dataLoaded && !cloudSyncConfig?.enabled) {
      // No cloud sync — allow local-modified timestamps immediately
      cloudSyncInitialDoneRef.current = true;
    }
  }, [dataLoaded, cloudSyncConfig?.enabled]);

  // Cloud sync: poll for remote changes every 60 seconds
  useEffect(() => {
    if (!cloudSyncConfig?.enabled) return;
    const pollTimer = setInterval(() => {
      cloudSyncDownload();
    }, 60 * 1000);
    return () => clearInterval(pollTimer);
  }, [cloudSyncConfig?.enabled]);

  // Persist cloud sync config
  useEffect(() => {
    if (cloudSyncConfig) {
      localStorage.setItem('day-planner-cloud-sync-config', JSON.stringify(cloudSyncConfig));
    } else {
      localStorage.removeItem('day-planner-cloud-sync-config');
    }
  }, [cloudSyncConfig]);

  // Persist auto-backup config
  useEffect(() => {
    localStorage.setItem('day-planner-auto-backup-config', JSON.stringify(autoBackupConfig));
  }, [autoBackupConfig]);

  // Auto-backup timer
  useEffect(() => {
    if (!dataLoaded) return;
    const localEnabled = autoBackupConfig.local.enabled;
    const remoteEnabled = autoBackupConfig.remote.enabled;
    if (!localEnabled && !remoteEnabled) return;

    const checkAndBackup = () => {
      const now = Date.now() / 1000;

      if (localEnabled) {
        // Read from localStorage directly to avoid stale closure
        const lastLocal = localStorage.getItem('day-planner-auto-backup-local-last');
        const elapsed = lastLocal ? now - new Date(lastLocal).getTime() / 1000 : Infinity;
        if (elapsed >= AUTO_BACKUP_INTERVALS[autoBackupConfig.local.frequency]) {
          performLocalBackup(autoBackupConfig.local.frequency);
        }
      }

      if (remoteEnabled) {
        const lastRemote = localStorage.getItem('day-planner-auto-backup-remote-last');
        const elapsed = lastRemote ? now - new Date(lastRemote).getTime() / 1000 : Infinity;
        if (elapsed >= AUTO_BACKUP_INTERVALS[autoBackupConfig.remote.frequency]) {
          performRemoteBackup(autoBackupConfig.remote.frequency);
        }
      }
    };

    // Check immediately on enable/frequency change
    checkAndBackup();

    // Then check every 60 seconds
    const timer = setInterval(checkAndBackup, 60 * 1000);
    return () => clearInterval(timer);
  }, [dataLoaded, autoBackupConfig.local.enabled, autoBackupConfig.local.frequency, autoBackupConfig.remote.enabled, autoBackupConfig.remote.frequency]);

  // Auto-clear today's routines on day rollover
  useEffect(() => {
    const todayStr = dateToString(new Date());
    if (routinesDate && routinesDate !== todayStr) {
      setTodayRoutines([]);
      setRoutinesDate(todayStr);
      setRemovedTodayRoutineIds({});
      localStorage.removeItem('day-planner-removed-today-routine-ids');
    }
  }, [currentTime]);

  const loadData = () => {
    try {
      const tasksData = localStorage.getItem('day-planner-tasks');
      const unscheduledData = localStorage.getItem('day-planner-unscheduled');
      const recycleBinData = localStorage.getItem('day-planner-recycle-bin');
      const darkModeData = localStorage.getItem('day-planner-darkmode');
      const syncUrlData = localStorage.getItem('day-planner-sync-url');
      const taskCalendarUrlData = localStorage.getItem('day-planner-task-calendar-url');
      const completedTaskUidsData = localStorage.getItem('day-planner-task-completed-uids');
      const recurringTasksData = localStorage.getItem('day-planner-recurring-tasks');
      const welcomeDismissed = localStorage.getItem('welcomeDismissed') === 'true';

      // Parse existing data and normalize defaults so localStorage and React
      // state stay in sync.  Without this write-back, stampTaskTimestamps detects
      // the added defaults as "changes" and re-stamps lastModified on every task
      // at app load, making stale local tasks win during the initial cloud merge.
      const parsedTasks = tasksData ? JSON.parse(tasksData).map(t => ({
        ...t,
        notes: t.notes ?? '',
        subtasks: t.subtasks ?? []
      })) : [];
      if (tasksData) localStorage.setItem('day-planner-tasks', JSON.stringify(parsedTasks));

      const parsedUnscheduled = unscheduledData ? JSON.parse(unscheduledData).map(t => ({
        ...t,
        notes: t.notes ?? '',
        subtasks: t.subtasks ?? []
      })) : [];
      if (unscheduledData) localStorage.setItem('day-planner-unscheduled', JSON.stringify(parsedUnscheduled));

      // Filter out imported tasks when checking if empty (only count user tasks)
      const userScheduledTasks = parsedTasks.filter(t => !t.imported);
      const userInboxTasks = parsedUnscheduled;

      // Show example tasks if both inbox and scheduled are empty (no saved tasks at all)
      const shouldShowExamples = userScheduledTasks.length === 0 && userInboxTasks.length === 0;

      if (shouldShowExamples) {
        // Create example tasks
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

        // Place example tasks around the current time so they're visible without scrolling
        const currentHour = today.getHours();
        const baseHour = Math.max(0, Math.min(20, currentHour - 1)); // 1 hour before now, clamped
        const toTime = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        const exampleScheduledTasks = [
          {
            id: 'example-scheduled-1',
            title: 'Example: Morning standup #work',
            startTime: toTime(baseHour, 0),
            duration: 30,
            date: todayStr,
            color: 'bg-blue-500',
            completed: false,
            isExample: true,
            notes: '',
            subtasks: []
          },
          {
            id: 'example-scheduled-2',
            title: 'Example: Deep work session #focus',
            startTime: toTime(baseHour + 1, 0),
            duration: 120,
            date: todayStr,
            color: 'bg-purple-500',
            completed: false,
            isExample: true,
            notes: 'Tasks can have notes! Try adding a link:\nhttps://example.com',
            subtasks: [
              { id: 'sub-1', title: 'Break down the problem', completed: true },
              { id: 'sub-2', title: 'Write initial code', completed: false },
              { id: 'sub-3', title: 'Test and refine', completed: false }
            ]
          },
          {
            id: 'example-allday-1',
            title: 'Example: Team offsite #work',
            startTime: '00:00',
            duration: 60,
            date: tomorrowStr,
            color: 'bg-green-500',
            completed: false,
            isAllDay: true,
            isExample: true,
            notes: '',
            subtasks: []
          }
        ];

        const exampleInboxTasks = [
          {
            id: 'example-inbox-1',
            title: 'Example: Review quarterly report #work #review',
            color: 'bg-amber-500',
            completed: false,
            priority: 0,
            isExample: true,
            notes: '',
            subtasks: []
          },
          {
            id: 'example-inbox-2',
            title: 'Example: Pay taxes #admin',
            color: 'bg-rose-500',
            completed: false,
            priority: 0,
            deadline: todayStr,
            isExample: true,
            notes: '',
            subtasks: []
          },
          {
            id: 'example-inbox-3',
            title: 'Example: Call mom #personal',
            color: 'bg-cyan-500',
            completed: true,
            priority: 0,
            isExample: true,
            notes: '',
            subtasks: []
          }
        ];

        const exampleRecycleBin = [
          {
            id: 'example-deleted-1',
            title: 'Example: Restore me!',
            color: 'bg-gray-500',
            completed: false,
            deletedAt: new Date().toISOString(),
            _deletedFrom: 'inbox',
            isExample: true,
            notes: '',
            subtasks: []
          }
        ];

        const exampleRecurringTasks = [
          {
            id: 'example-recurring-1',
            title: 'Example: TPS reports #work',
            startTime: toTime(baseHour, 30),
            duration: 30,
            color: 'bg-teal-500',
            isAllDay: false,
            notes: '',
            subtasks: [],
            recurrence: { type: 'daily', startDate: todayStr },
            completedDates: [],
            exceptions: {},
            isExample: true
          }
        ];

        // Keep any imported tasks, add example tasks
        setTasks([...parsedTasks.filter(t => t.imported), ...exampleScheduledTasks]);
        setUnscheduledTasks(exampleInboxTasks);
        setRecycleBin(exampleRecycleBin);
        setRecurringTasks(exampleRecurringTasks);
        setRoutineDefinitions(prev => ({
          ...prev,
          everyday: [{ id: 'example-routine-1', name: 'Unscheduled' }, { id: 'example-routine-2', name: 'Breaktime' }]
        }));
        setTodayRoutines([
          { id: 'example-routine-1', name: 'Unscheduled', bucket: 'everyday', startTime: null, duration: 15, isAllDay: true },
          { id: 'example-routine-2', name: 'Breaktime', bucket: 'everyday', startTime: toTime(baseHour + 3, 0), duration: 15, isAllDay: false }
        ]);
        setRoutinesDate(todayStr);
      } else {
        // Load normally
        setTasks(parsedTasks);
        setUnscheduledTasks(parsedUnscheduled.filter(t => !t.imported));
        if (recycleBinData) {
          setRecycleBin(JSON.parse(recycleBinData));
        }
      }

      if (darkModeData) {
        setDarkMode(JSON.parse(darkModeData));
      }
      if (syncUrlData) {
        setSyncUrl(JSON.parse(syncUrlData));
      }
      if (taskCalendarUrlData) {
        setTaskCalendarUrl(JSON.parse(taskCalendarUrlData));
      }
      if (completedTaskUidsData) {
        setCompletedTaskUids(new Set(JSON.parse(completedTaskUidsData)));
      }
      if (!shouldShowExamples) {
        if (recurringTasksData) {
          setRecurringTasks(JSON.parse(recurringTasksData));
        }

        // Load routines
        const routineDefsData = localStorage.getItem('day-planner-routine-definitions');
        const todayRoutinesData = localStorage.getItem('day-planner-today-routines');
        const routinesDateData = localStorage.getItem('day-planner-routines-date');
        if (routineDefsData) {
          setRoutineDefinitions(JSON.parse(routineDefsData));
        }
        const todayStr = dateToString(new Date());
        if (routinesDateData && routinesDateData === todayStr && todayRoutinesData) {
          setTodayRoutines(JSON.parse(todayRoutinesData));
          setRoutinesDate(todayStr);
          const removedData = localStorage.getItem('day-planner-removed-today-routine-ids');
          if (removedData) setRemovedTodayRoutineIds(JSON.parse(removedData));
        } else {
          // Auto-clear if different day
          setTodayRoutines([]);
          setRoutinesDate(todayStr);
          setRemovedTodayRoutineIds({});
          localStorage.removeItem('day-planner-removed-today-routine-ids');
        }
      }
    } catch (error) {
      console.log('No existing data found, starting fresh');
    }
    setDataLoaded(true);
  };

  // Stamp lastModified on tasks that changed since last save
  const stampTaskTimestamps = (currentTasks, storageKey) => {
    if (suppressTimestampRef.current) return currentTasks;
    const now = new Date().toISOString();
    let prev;
    try { prev = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { prev = []; }
    const prevMap = new Map(prev.map(t => [String(t.id), t]));
    return currentTasks.map(t => {
      const id = String(t.id);
      const prevTask = prevMap.get(id);
      if (prevTask && prevTask.lastModified) {
        const { lastModified: _a, ...prevRest } = prevTask;
        const { lastModified: _b, ...currRest } = t;
        if (JSON.stringify(prevRest) === JSON.stringify(currRest)) {
          return { ...t, lastModified: prevTask.lastModified };
        }
      }
      // Task is new or changed — stamp it now so other devices see the update
      return { ...t, lastModified: now };
    });
  };

  const saveData = () => {
    try {
      const stampedTasks = stampTaskTimestamps(tasks, 'day-planner-tasks');
      const stampedUnscheduled = stampTaskTimestamps(unscheduledTasks, 'day-planner-unscheduled');
      const stampedRecycleBin = stampTaskTimestamps(recycleBin, 'day-planner-recycle-bin');
      const stampedRecurring = stampTaskTimestamps(recurringTasks, 'day-planner-recurring-tasks');
      localStorage.setItem('day-planner-tasks', JSON.stringify(stampedTasks));
      localStorage.setItem('day-planner-unscheduled', JSON.stringify(stampedUnscheduled));
      localStorage.setItem('day-planner-recycle-bin', JSON.stringify(stampedRecycleBin));
      localStorage.setItem('day-planner-darkmode', JSON.stringify(darkMode));
      localStorage.setItem('day-planner-sync-url', JSON.stringify(syncUrl));
      localStorage.setItem('day-planner-task-calendar-url', JSON.stringify(taskCalendarUrl));
      localStorage.setItem('day-planner-task-completed-uids', JSON.stringify([...completedTaskUids]));
      localStorage.setItem('day-planner-recurring-tasks', JSON.stringify(stampedRecurring));
      localStorage.setItem('day-planner-routine-definitions', JSON.stringify(routineDefinitions));
      localStorage.setItem('day-planner-today-routines', JSON.stringify(todayRoutines));
      localStorage.setItem('day-planner-routines-date', routinesDate);
      localStorage.setItem('day-planner-removed-today-routine-ids', JSON.stringify(removedTodayRoutineIds));
      // Only update local-modified after initial cloud sync has run,
      // otherwise the initial loadData() sets it to "now" and overwrites remote
      if (!cloudSyncConfig?.enabled || cloudSyncInitialDoneRef.current) {
        localStorage.setItem('day-planner-cloud-sync-local-modified', new Date().toISOString());
      }
    } catch (error) {
      console.error('Error saving data:', error);
    }
  };

  const getNextQuarterHour = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    const nextQuarter = Math.ceil(minutes / 15) * 15;
    
    if (nextQuarter === 60) {
      now.setHours(now.getHours() + 1);
      now.setMinutes(0);
    } else {
      now.setMinutes(nextQuarter);
    }
    
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  };

  const fetchWeather = async () => {
    try {
      // Using Open-Meteo API (free, no API key needed)
      // Erie, CO coordinates: 40.0503, -105.0497
      const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=40.0503&longitude=-105.0497&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&timezone=America%2FDenver&forecast_days=6');
      const data = await response.json();
      
      if (data.current && data.daily) {
        // Build forecast array for next 5 days (starting from tomorrow)
        const forecast = [];
        for (let i = 1; i <= 5; i++) {
          // Append T12:00:00 to avoid timezone issues (date-only strings are parsed as UTC midnight)
          const date = new Date(data.daily.time[i] + 'T12:00:00');
          forecast.push({
            day: date.toLocaleDateString('en-US', { weekday: 'short' }),
            high: Math.round(data.daily.temperature_2m_max[i]),
            low: Math.round(data.daily.temperature_2m_min[i]),
            icon: getWeatherIcon(data.daily.weather_code[i]),
            code: data.daily.weather_code[i] // For debugging
          });
        }
        
        setWeather({
          temp: Math.round(data.current.temperature_2m),
          condition: getWeatherCondition(data.current.weather_code),
          icon: getWeatherIcon(data.current.weather_code),
          high: Math.round(data.daily.temperature_2m_max[0]),
          low: Math.round(data.daily.temperature_2m_min[0]),
          forecast: forecast
        });
      }
    } catch (error) {
      console.error('Failed to fetch weather:', error);
      // Set a fallback so we know it tried
      setWeather({
        temp: '--',
        condition: 'Unable to load',
        icon: '🌡️',
        high: '--',
        low: '--',
        forecast: []
      });
    }
  };

  const fetchAllDailyContent = async () => {
    const today = new Date().toDateString();
    const cached = localStorage.getItem('dailyContent');

    if (cached) {
      const { content, date } = JSON.parse(cached);
      if (date === today) {
        setDailyContent(content);
        return;
      }
    }

    const content = { dadJoke: null, funFact: null, quote: null, history: null };
    const decodeHTML = (str) => {
      if (!str) return str;
      const el = document.createElement('textarea');
      el.innerHTML = str;
      return el.value.replace(/`/g, "'");
    };

    // Fetch dad joke
    try {
      const response = await fetch('https://icanhazdadjoke.com/', {
        headers: { 'Accept': 'application/json' }
      });
      const data = await response.json();
      if (data.joke) content.dadJoke = decodeHTML(data.joke);
    } catch (error) {
      console.error('Failed to fetch dad joke:', error);
    }

    // Fetch fun fact
    try {
      const response = await fetch('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en');
      const data = await response.json();
      if (data.text) content.funFact = decodeHTML(data.text);
    } catch (error) {
      console.error('Failed to fetch fun fact:', error);
    }

    // Fetch quote
    try {
      const response = await fetch('https://dummyjson.com/quotes/random');
      const data = await response.json();
      if (data.quote) content.quote = { text: decodeHTML(data.quote), author: decodeHTML(data.author) };
    } catch (error) {
      console.error('Failed to fetch quote:', error);
    }

    // Fetch this day in history
    try {
      const now = new Date();
      const response = await fetch(`https://history.muffinlabs.com/date/${now.getMonth() + 1}/${now.getDate()}`);
      const data = await response.json();
      if (data.data?.Events?.length > 0) {
        const randomEvent = data.data.Events[Math.floor(Math.random() * data.data.Events.length)];
        content.history = { year: randomEvent.year, text: decodeHTML(randomEvent.text) };
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
    }

    setDailyContent(content);
    localStorage.setItem('dailyContent', JSON.stringify({ content, date: today }));
  };

  const getTaskCalendarStyle = (task, isDarkMode) => {
    if (!task.isTaskCalendar) return {};

    if (task.completed) {
      // Completed: solid muted gray with lower opacity
      return {
        backgroundColor: isDarkMode ? '#4b5563' : '#6b7280',
        opacity: 0.5
      };
    }

    // Active: -45° diagonal stripes
    const color1 = isDarkMode ? '#4b5563' : '#6b7280';
    const color2 = isDarkMode ? '#6b7280' : '#9ca3af';

    return {
      background: `repeating-linear-gradient(
        -45deg,
        ${color1},
        ${color1} 8px,
        ${color2} 8px,
        ${color2} 16px
      )`
    };
  };

  const getWeatherCondition = (code) => {
    if (code === 0) return 'Clear';
    if ([1, 2, 3].includes(code)) return 'Partly Cloudy';
    if ([45, 48].includes(code)) return 'Foggy';
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return 'Rainy';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snowy';
    if ([95, 96, 99].includes(code)) return 'Stormy';
    return 'Cloudy';
  };

  const getWeatherIcon = (code) => {
    // WMO Weather interpretation codes
    if (code === 0) return '☀️'; // Clear sky
    if (code === 1) return '🌤️'; // Mainly clear
    if (code === 2) return '⛅'; // Partly cloudy
    if (code === 3) return '☁️'; // Overcast
    if ([45, 48].includes(code)) return '🌁'; // Fog
    if ([51, 53, 55].includes(code)) return '🌦️'; // Drizzle
    if ([56, 57].includes(code)) return '🌧️'; // Freezing drizzle
    if ([61, 63, 65].includes(code)) return '🌧️'; // Rain
    if ([66, 67].includes(code)) return '🌧️'; // Freezing rain
    if ([71, 73, 75].includes(code)) return '🌨️'; // Snow fall
    if (code === 77) return '🌨️'; // Snow grains
    if ([80, 81, 82].includes(code)) return '🌧️'; // Rain showers
    if ([85, 86].includes(code)) return '🌨️'; // Snow showers
    if (code === 95) return '⛈️'; // Thunderstorm
    if ([96, 99].includes(code)) return '⛈️'; // Thunderstorm with hail
    
    console.warn('Unknown weather code:', code);
    return '☁️'; // Default fallback
  };

  const timeToMinutes = (time) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const minutesToTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  const dateToString = (date) => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Recurrence engine: compute occurrences of a recurring template in a date range
  const getOccurrencesInRange = (template, rangeStartStr, rangeEndStr) => {
    const rec = template.recurrence;
    if (!rec) return [];
    const results = [];
    const startDate = new Date(rec.startDate + 'T12:00:00');
    const rangeStart = new Date(rangeStartStr + 'T12:00:00');
    const rangeEnd = new Date(rangeEndStr + 'T12:00:00');
    const endDate = rec.endDate ? new Date(rec.endDate + 'T12:00:00') : null;
    let count = 0;
    const maxOcc = rec.maxOccurrences || Infinity;

    const addIfInRange = (d) => {
      if (count >= maxOcc) return false;
      if (endDate && d > endDate) return false;
      const ds = dateToString(d);
      if (template.exceptions && template.exceptions[ds]?.deleted) { count++; return true; }
      if (d >= rangeStart && d <= rangeEnd) results.push(ds);
      count++;
      return true;
    };

    if (rec.type === 'daily') {
      const cursor = new Date(startDate);
      while (cursor <= rangeEnd && count < maxOcc) {
        if (endDate && cursor > endDate) break;
        addIfInRange(cursor);
        cursor.setDate(cursor.getDate() + 1);
      }
    } else if (rec.type === 'weekly' || rec.type === 'biweekly') {
      const step = rec.type === 'biweekly' ? 2 : 1;
      const days = (rec.daysOfWeek && rec.daysOfWeek.length > 0) ? rec.daysOfWeek : [startDate.getDay()];
      // Find the week start (Sunday) of the start date
      const weekStart = new Date(startDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const cursor = new Date(weekStart);
      while (cursor <= rangeEnd && count < maxOcc) {
        for (const dow of days.sort((a, b) => a - b)) {
          const d = new Date(cursor);
          d.setDate(d.getDate() + dow);
          if (d < startDate) continue;
          if (endDate && d > endDate) break;
          if (d > rangeEnd) break;
          if (!addIfInRange(d)) break;
        }
        cursor.setDate(cursor.getDate() + 7 * step);
      }
    } else if (rec.type === 'monthly') {
      const cursor = new Date(startDate);
      cursor.setDate(1);
      while (cursor <= rangeEnd && count < maxOcc) {
        let target;
        if (rec.monthWeekday) {
          // Nth weekday of month (e.g., 1st Monday)
          const { week, day } = rec.monthWeekday;
          const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
          const firstDow = firstOfMonth.getDay();
          let offset = day - firstDow;
          if (offset < 0) offset += 7;
          target = new Date(firstOfMonth);
          target.setDate(1 + offset + (week - 1) * 7);
          // Verify still in same month
          if (target.getMonth() !== cursor.getMonth()) {
            cursor.setMonth(cursor.getMonth() + 1, 1);
            continue;
          }
        } else {
          const md = rec.monthDay || startDate.getDate();
          const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
          target = new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(md, daysInMonth));
        }
        target.setHours(12, 0, 0, 0);
        if (target >= startDate) {
          if (endDate && target > endDate) break;
          if (!addIfInRange(target)) break;
        }
        cursor.setMonth(cursor.getMonth() + 1, 1);
      }
    } else if (rec.type === 'yearly') {
      const cursor = new Date(startDate);
      while (cursor <= rangeEnd && count < maxOcc) {
        if (cursor >= startDate) {
          if (endDate && cursor > endDate) break;
          if (!addIfInRange(cursor)) break;
        }
        cursor.setFullYear(cursor.getFullYear() + 1);
      }
    }
    return results;
  };

  // Human-readable label for a recurrence pattern
  const getRecurrenceLabel = (rec) => {
    if (!rec) return 'None';
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const fullDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const ordinals = ['', '1st', '2nd', '3rd', '4th', '5th'];

    let label = 'Custom';
    if (rec.type === 'daily') label = 'Every day';
    else if (rec.type === 'weekly') {
      const days = rec.daysOfWeek && rec.daysOfWeek.length > 0
        ? rec.daysOfWeek.sort((a, b) => a - b).map(d => dayNames[d]).join(', ')
        : dayNames[new Date(rec.startDate + 'T12:00:00').getDay()];
      label = `Weekly on ${days}`;
    }
    else if (rec.type === 'biweekly') {
      const days = rec.daysOfWeek && rec.daysOfWeek.length > 0
        ? rec.daysOfWeek.sort((a, b) => a - b).map(d => dayNames[d]).join(', ')
        : dayNames[new Date(rec.startDate + 'T12:00:00').getDay()];
      label = `Every 2 weeks on ${days}`;
    }
    else if (rec.type === 'monthly') {
      if (rec.monthWeekday) {
        label = `Monthly on the ${ordinals[rec.monthWeekday.week]} ${fullDayNames[rec.monthWeekday.day]}`;
      } else {
        const d = rec.monthDay || new Date(rec.startDate + 'T12:00:00').getDate();
        const suffix = d === 1 || d === 21 || d === 31 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th';
        label = `Monthly on the ${d}${suffix}`;
      }
    }
    else if (rec.type === 'yearly') {
      const sd = new Date(rec.startDate + 'T12:00:00');
      label = `Yearly on ${monthNames[sd.getMonth()]} ${sd.getDate()}`;
    }

    if (rec.endDate) {
      const ed = new Date(rec.endDate + 'T12:00:00');
      label += ` until ${monthNames[ed.getMonth()].slice(0, 3)} ${ed.getDate()}`;
    } else if (rec.maxOccurrences) {
      label += ` (${rec.maxOccurrences} times)`;
    }
    return label;
  };

  const getRecurrencePresets = (dateStr) => {
    const taskDate = new Date(dateStr + 'T12:00:00');
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][taskDate.getDay()];
    const monthDay = taskDate.getDate();
    const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][taskDate.getMonth()];
    const suffix = monthDay === 1 || monthDay === 21 || monthDay === 31 ? 'st' : monthDay === 2 || monthDay === 22 ? 'nd' : monthDay === 3 || monthDay === 23 ? 'rd' : 'th';
    const weekOfMonth = Math.ceil(monthDay / 7);
    const ordinals = ['','1st','2nd','3rd','4th','5th'];

    return [
      { label: 'None', value: null },
      { label: 'Every day', value: { type: 'daily' } },
      taskDate.getDay() === 0 || taskDate.getDay() === 6
        ? { label: 'Every weekend (Sat-Sun)', value: { type: 'weekly', daysOfWeek: [0,6] } }
        : { label: 'Every weekday (Mon-Fri)', value: { type: 'weekly', daysOfWeek: [1,2,3,4,5] } },
      { label: `Every week on ${dayName}`, value: { type: 'weekly', daysOfWeek: [taskDate.getDay()] } },
      { label: `Every 2 weeks on ${dayName}`, value: { type: 'biweekly', daysOfWeek: [taskDate.getDay()] } },
      { label: `Monthly on the ${monthDay}${suffix}`, value: { type: 'monthly', monthDay: monthDay, monthWeekday: null } },
      { label: `Monthly on the ${ordinals[weekOfMonth]} ${dayName}`, value: { type: 'monthly', monthDay: null, monthWeekday: { week: weekOfMonth, day: taskDate.getDay() } } },
      { label: `Yearly on ${monthName} ${monthDay}`, value: { type: 'yearly' } },
    ];
  };

  const checkConflicts = () => {
    const dateStr = dateToString(selectedDate);
    // Exclude all-day tasks and imported events (not task calendar) from conflict detection
    // Include recurring task instances for this date
    const recurringForDate = [];
    for (const template of recurringTasks) {
      if (template.isAllDay) continue;
      const occs = getOccurrencesInRange(template, dateStr, dateStr);
      for (const ds of occs) {
        const exception = template.exceptions?.[ds];
        if (exception?.deleted) continue;
        recurringForDate.push({
          id: `recurring-${template.id}-${ds}`,
          startTime: exception?.startTime ?? template.startTime,
          duration: exception?.duration ?? template.duration,
          isAllDay: false,
        });
      }
    }
    const todayTasks = [...tasks.filter(t => t.date === dateStr && !t.isAllDay && (!t.imported || t.isTaskCalendar)), ...recurringForDate];
    const newConflicts = [];

    for (let i = 0; i < todayTasks.length; i++) {
      for (let j = i + 1; j < todayTasks.length; j++) {
        const task1 = todayTasks[i];
        const task2 = todayTasks[j];
        const start1 = timeToMinutes(task1.startTime);
        const end1 = start1 + task1.duration;
        const start2 = timeToMinutes(task2.startTime);
        const end2 = start2 + task2.duration;

        if ((start1 < end2 && end1 > start2)) {
          if (!newConflicts.find(c => c.includes(task1.id) && c.includes(task2.id))) {
            newConflicts.push([task1.id, task2.id, Math.min(start1, start2)]);
          }
        }
      }
    }
    setConflicts(newConflicts);
  };

  const getConflictingTasks = (task, allTasks) => {
    const start = timeToMinutes(task.startTime);
    const end = start + task.duration;

    return allTasks.filter(t => {
      if (t.id === task.id) return false;
      const tStart = timeToMinutes(t.startTime);
      const tEnd = tStart + t.duration;
      return start < tEnd && end > tStart;
    });
  };

  // Check if a task placement would conflict with imported calendar events or reminders
  // Returns { conflicted: boolean, adjustedStartTime: string, conflictingEvent: task }
  const getAdjustedTimeForImportedConflicts = (taskId, startTime, duration, dateStr) => {
    // Get all imported calendar events and task calendar reminders for this date
    const importedEvents = tasks.filter(t =>
      t.date === dateStr &&
      t.imported &&
      !t.isAllDay &&
      t.id !== taskId
    );

    // Also treat today's timeline-placed routine chips as obstacles
    const todayStr = dateToString(new Date());
    if (dateStr === todayStr) {
      todayRoutines.filter(r => !r.isAllDay && r.startTime).forEach(r => {
        importedEvents.push({ startTime: r.startTime, duration: r.duration, title: r.name, id: `routine-${r.id}` });
      });
    }

    if (importedEvents.length === 0) {
      return { conflicted: false, adjustedStartTime: startTime, conflictingEvent: null };
    }

    let currentStart = timeToMinutes(startTime);
    let currentEnd = currentStart + duration;
    let conflictingEvent = null;
    let wasAdjusted = false;

    // Keep adjusting until no conflicts with imported events
    let maxIterations = 100; // Prevent infinite loops
    while (maxIterations > 0) {
      maxIterations--;
      let foundConflict = false;

      for (const event of importedEvents) {
        const eventStart = timeToMinutes(event.startTime);
        const eventEnd = eventStart + event.duration;

        // Check for overlap
        if (currentStart < eventEnd && currentEnd > eventStart) {
          foundConflict = true;
          wasAdjusted = true;
          conflictingEvent = event;
          // Move to end of this event
          currentStart = eventEnd;
          currentEnd = currentStart + duration;
          break;
        }
      }

      if (!foundConflict) break;
    }

    // Cap at end of day
    if (currentStart >= 24 * 60) {
      currentStart = 24 * 60 - duration;
    }

    return {
      conflicted: wasAdjusted,
      adjustedStartTime: minutesToTime(currentStart),
      conflictingEvent
    };
  };

  const toggleSection = (sectionName) => {
    setMinimizedSections(prev => ({
      ...prev,
      [sectionName]: !prev[sectionName]
    }));
  };

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

  const selectAllTags = () => {
    setSelectedTags([...allTags]);
  };

  // Get today's date string for overdue comparisons
  const getTodayStr = () => dateToString(new Date());

  // Get overdue tasks: incomplete tasks past their end time + inbox tasks with past deadlines
  // Includes recurring instances for today (matches dayGLANCE widget behavior)
  const getOverdueTasks = () => {
    const todayStr = getTodayStr();
    const now = currentTime || new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const isOverdueToday = (t) => {
      if (t.date !== todayStr || t.isAllDay) return false;
      const [h, m] = (t.startTime || '00:00').split(':').map(Number);
      const endMinutes = h * 60 + m + (t.duration || 30);
      return endMinutes <= nowMinutes;
    };

    // Incomplete scheduled tasks from past dates (not imported events)
    // + today's tasks whose end time has passed
    const overdueScheduled = tasks.filter(t => {
      if (t.completed || t.imported || t.isExample) return false;
      if (t.date < todayStr) return true;
      return isOverdueToday(t);
    }).map(t => ({ ...t, _overdueType: 'scheduled' }));

    // Today's recurring instances past their end time
    const todayRecurring = expandedRecurringTasks.filter(t =>
      t.date === todayStr && !t.completed && !t.isExample && isOverdueToday(t)
    ).map(t => ({ ...t, _overdueType: 'scheduled' }));

    // Inbox tasks with past deadlines
    const overdueDeadlines = unscheduledTasks.filter(t =>
      t.deadline && t.deadline < todayStr && !t.completed && !t.isExample
    ).map(t => ({ ...t, _overdueType: 'deadline' }));

    return [...overdueScheduled, ...todayRecurring, ...overdueDeadlines];
  };

  // Get inbox tasks with deadlines for a specific date (not overdue)
  const getDeadlineTasksForDate = (dateStr) => {
    const todayStr = getTodayStr();
    return unscheduledTasks.filter(t =>
      t.deadline === dateStr && (t.deadline >= todayStr || t.completed)
    );
  };

  // Set deadline on inbox task
  const setDeadline = (taskId, deadline) => {
    pushUndo();
    setUnscheduledTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, deadline } : t
    ));
    setShowDeadlinePicker(null);
    // Track for onboarding
    if (!onboardingProgress.hasAddedDeadline) {
      setOnboardingProgress(prev => ({ ...prev, hasAddedDeadline: true }));
    }
  };

  // Clear deadline from inbox task
  const clearDeadline = (taskId) => {
    pushUndo();
    setUnscheduledTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, deadline: null } : t
    ));
    setShowDeadlinePicker(null);
  };

  // Format deadline date for display
  const formatDeadlineDate = (deadline) => {
    if (!deadline) return null;
    const todayStr = getTodayStr();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = dateToString(tomorrow);

    if (deadline === todayStr) return 'Today';
    if (deadline === tomorrowStr) return 'Tomorrow';

    const date = new Date(deadline + 'T12:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const cyclePriority = (taskId) => {
    pushUndo();
    const task = unscheduledTasks.find(t => t.id === taskId);
    const currentPriority = pendingPriorities[taskId] ?? task?.priority ?? 0;
    const newPriority = (currentPriority + 1) % 4;

    // Update visual immediately
    setPendingPriorities(prev => ({ ...prev, [taskId]: newPriority }));
    playUISound('click');

    // Track for onboarding
    if (!onboardingProgress.hasSetPriority) {
      setOnboardingProgress(prev => ({ ...prev, hasSetPriority: true }));
    }

    // Cancel any pending timeout for this task
    if (priorityTimeouts.current[taskId]) {
      clearTimeout(priorityTimeouts.current[taskId]);
    }

    // Update actual priority (triggers reorder) after delay
    // Longer delay allows for multiple clicks to reach desired priority
    priorityTimeouts.current[taskId] = setTimeout(() => {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, priority: newPriority } : t
      ));
      setPendingPriorities(prev => {
        const { [taskId]: _, ...rest } = prev;
        return rest;
      });
      delete priorityTimeouts.current[taskId];
    }, 1200);
  };

  const calculateConflictPosition = (task, allTasks) => {
    // Imported events (not task calendar) are excluded from layout logic - always full width
    if (task.imported && !task.isTaskCalendar) return { left: 2, right: 2, width: null, totalColumns: 1 };

    // Filter out imported events from conflict calculations
    const nonImportedTasks = allTasks.filter(t => !t.imported || t.isTaskCalendar);
    const conflicting = getConflictingTasks(task, nonImportedTasks);
    if (conflicting.length === 0) return { left: 2, right: 2, width: null, totalColumns: 1 };

    // Build the full conflict cluster using transitive closure
    const buildConflictCluster = (startTask) => {
      const cluster = new Set([startTask.id]);
      const queue = [startTask];

      while (queue.length > 0) {
        const current = queue.shift();
        const currentConflicts = getConflictingTasks(current, nonImportedTasks);
        for (const t of currentConflicts) {
          if (!cluster.has(t.id)) {
            cluster.add(t.id);
            queue.push(t);
          }
        }
      }

      return nonImportedTasks.filter(t => cluster.has(t.id));
    };

    const cluster = buildConflictCluster(task);

    // Sort by start time, then by id for stable column assignment during resize
    const sorted = [...cluster].sort((a, b) => {
      const aStart = timeToMinutes(a.startTime);
      const bStart = timeToMinutes(b.startTime);
      if (aStart !== bStart) return aStart - bStart;
      return String(a.id).localeCompare(String(b.id));
    });

    // Greedy column assignment: place each task in the first column where it fits
    const columns = []; // Each column tracks the end time of the last task in it
    const taskColumns = new Map();

    for (const t of sorted) {
      const tStart = timeToMinutes(t.startTime);
      const tEnd = tStart + t.duration;

      // Find first column where this task fits (doesn't overlap)
      let placed = false;
      for (let col = 0; col < columns.length; col++) {
        if (columns[col] <= tStart) {
          columns[col] = tEnd;
          taskColumns.set(t.id, col);
          placed = true;
          break;
        }
      }

      // If no column fits, create a new one
      if (!placed) {
        taskColumns.set(t.id, columns.length);
        columns.push(tEnd);
      }
    }

    const totalColumns = columns.length;
    const column = taskColumns.get(task.id);
    const allCompleted = cluster.every(t => t.completed);

    const widthPercent = 100 / totalColumns;
    const leftPercent = widthPercent * column;

    // Use tighter margins when all completed (no red border to account for)
    const margin = allCompleted ? '0.125rem' : '0.25rem';
    const totalMargin = allCompleted ? '0.25rem' : '0.5rem';

    return {
      left: `calc(${leftPercent}% + ${margin})`,
      right: 'auto',
      width: `calc(${widthPercent}% - ${totalMargin})`,
      totalColumns
    };
  };

  const wouldExceedMaxColumns = (droppedTask, startTime, dropDateStr, maxColumns = 3) => {
    // Get existing tasks for this date, excluding the dropped task if it's already scheduled
    // Also exclude imported events (not task calendar) from conflict calculations
    const existingRegular = tasks.filter(t => t.date === dropDateStr && t.id !== droppedTask.id && !t.isAllDay && (!t.imported || t.isTaskCalendar));
    // Include recurring task instances for this date
    const recurringForDate = [];
    for (const template of recurringTasks) {
      if (template.isAllDay) continue;
      const occs = getOccurrencesInRange(template, dropDateStr, dropDateStr);
      for (const ds of occs) {
        const rid = `recurring-${template.id}-${ds}`;
        if (rid === droppedTask.id) continue;
        const exception = template.exceptions?.[ds];
        recurringForDate.push({
          id: rid,
          startTime: exception?.startTime ?? template.startTime,
          duration: exception?.duration ?? template.duration,
          isAllDay: false,
        });
      }
    }
    const existingTasks = [...existingRegular, ...recurringForDate];

    // Create a hypothetical task with the new position
    const hypotheticalTask = { ...droppedTask, startTime, date: dropDateStr };
    const allTasks = [...existingTasks, hypotheticalTask];

    // Check if this task would conflict with anything
    const conflicting = getConflictingTasks(hypotheticalTask, allTasks);
    if (conflicting.length === 0) return false;

    // Build conflict cluster and calculate columns (same logic as calculateConflictPosition)
    const buildCluster = (startTask) => {
      const cluster = new Set([startTask.id]);
      const queue = [startTask];
      while (queue.length > 0) {
        const current = queue.shift();
        const currentConflicts = getConflictingTasks(current, allTasks);
        for (const t of currentConflicts) {
          if (!cluster.has(t.id)) {
            cluster.add(t.id);
            queue.push(t);
          }
        }
      }
      return allTasks.filter(t => cluster.has(t.id));
    };

    const cluster = buildCluster(hypotheticalTask);
    const sorted = [...cluster].sort((a, b) => {
      const aStart = timeToMinutes(a.startTime);
      const bStart = timeToMinutes(b.startTime);
      if (aStart !== bStart) return aStart - bStart;
      if (a.duration !== b.duration) return b.duration - a.duration;
      return String(a.id).localeCompare(String(b.id));
    });

    // Greedy column assignment
    const columns = [];
    for (const t of sorted) {
      const tStart = timeToMinutes(t.startTime);
      const tEnd = tStart + t.duration;
      let placed = false;
      for (let col = 0; col < columns.length; col++) {
        if (columns[col] <= tStart) {
          columns[col] = tEnd;
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push(tEnd);
      }
    }

    return columns.length > maxColumns;
  };

  const addTask = (toInbox = false) => {
    if (newTask.title.trim()) {
      pushUndo();
      const taskId = Date.now();
      const task = {
        id: taskId,
        title: cleanTitle(newTask.title),
        duration: newTask.duration,
        color: newTask.color || colors[0].class,
        completed: false,
        isAllDay: newTask.isAllDay || false,
        notes: '',
        subtasks: []
      };

      if (toInbox) {
        const inboxTask = { ...task, priority: newTask.priority ?? 0 };
        if (newTask.deadline) {
          inboxTask.deadline = newTask.deadline;
        }
        setUnscheduledTasks([...unscheduledTasks, inboxTask]);
      } else if (newTask.recurrence) {
        // Create recurring task template
        const taskDate = newTask.date || dateToString(selectedDate);
        const template = {
          id: taskId,
          title: cleanTitle(newTask.title),
          startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
          duration: newTask.duration,
          color: newTask.color || colors[0].class,
          isAllDay: newTask.isAllDay || false,
          notes: '',
          subtasks: [],
          recurrence: { ...newTask.recurrence, startDate: taskDate },
          completedDates: [],
          exceptions: {}
        };
        setRecurringTasks(prev => [...prev, template]);
        if (!onboardingProgress.hasCreatedRecurring) {
          setOnboardingProgress(prev => ({ ...prev, hasCreatedRecurring: true }));
        }
      } else {
        const requestedStartTime = newTask.isAllDay ? '00:00' : newTask.startTime;
        const taskDate = newTask.date || dateToString(selectedDate);

        // Check for conflicts with imported calendar events (not for all-day tasks)
        const { conflicted, adjustedStartTime, conflictingEvent } = newTask.isAllDay
          ? { conflicted: false, adjustedStartTime: requestedStartTime, conflictingEvent: null }
          : getAdjustedTimeForImportedConflicts(taskId, requestedStartTime, newTask.duration, taskDate);

        setTasks([...tasks, {
          ...task,
          startTime: adjustedStartTime,
          date: taskDate
        }]);

        // Show notification if task was rescheduled to avoid calendar conflict
        if (conflicted && conflictingEvent) {
          setSyncNotification({
            type: 'info',
            title: 'Task Rescheduled',
            message: `Task moved to ${adjustedStartTime} to avoid conflict with "${conflictingEvent.title}"`
          });
        }
      }

      // If scheduling from inbox swipe, remove the original inbox task
      if (swipeSchedulingInboxTaskId.current) {
        const inboxIdToRemove = swipeSchedulingInboxTaskId.current;
        setUnscheduledTasks(prev => prev.filter(t => t.id !== inboxIdToRemove));
        swipeSchedulingInboxTaskId.current = null;
      }

      setNewTask({ title: '', startTime: getNextQuarterHour(), duration: 30, date: dateToString(selectedDate), isAllDay: false, recurrence: null });
      setShowAddTask(false);

      // Track for onboarding
      if (toInbox && !onboardingProgress.hasAddedInboxTask) {
        setOnboardingProgress(prev => ({ ...prev, hasAddedInboxTask: true }));
      }
      if (!toInbox && !onboardingProgress.hasAddedScheduledTask) {
        setOnboardingProgress(prev => ({ ...prev, hasAddedScheduledTask: true }));
      }
      // Track if task has tags
      if (!onboardingProgress.hasUsedTags && extractTags(newTask.title).length > 0) {
        setOnboardingProgress(prev => ({ ...prev, hasUsedTags: true }));
      }
      playUISound('pop');
    }
  };

  const changeTaskColor = (taskId, newColor, fromInbox = false) => {
    pushUndo();
    // Handle recurring task instances - update the template
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      const templateId = Number(taskId.split('-')[1]);
      setRecurringTasks(prev => prev.map(t =>
        t.id === templateId ? { ...t, color: newColor } : t
      ));
      setShowColorPicker(null);
      return;
    }

    if (fromInbox) {
      setUnscheduledTasks(unscheduledTasks.map(task =>
        task.id === taskId ? { ...task, color: newColor } : task
      ));
    } else {
      setTasks(tasks.map(task =>
        task.id === taskId ? { ...task, color: newColor } : task
      ));
    }
    setShowColorPicker(null);
    // Track for onboarding
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  const parseRecurringId = (id) => {
    if (typeof id !== 'string' || !id.startsWith('recurring-')) return null;
    const parts = id.split('-');
    // Date is always the last 3 segments (YYYY-MM-DD), template ID is everything between
    const dateStr = parts.slice(-3).join('-');
    const rawTemplateId = parts.slice(1, -3).join('-');
    const templateId = /^\d+$/.test(rawTemplateId) ? Number(rawTemplateId) : rawTemplateId;
    return { templateId, dateStr };
  };

  const getTaskCategory = (task) => {
    if (task.isAllDay) return 'allDayTasks';
    if (typeof task.id === 'string' && task.id.startsWith('recurring-')) return 'recurringTasks';
    if (task.imported && task.isTaskCalendar) return 'calendarTasks';
    if (task.imported && !task.isTaskCalendar) return 'calendarEvents';
    return 'scheduledTasks';
  };

  const getReminderPoints = (task, catSettings, morningTime) => {
    if (!catSettings) return [];
    if (task.isAllDay) {
      if (!catSettings.morningReminder) return [];
      const [h, m] = morningTime.split(':').map(Number);
      return [{ key: `morning-${task.id}`, triggerMin: h * 60 + m, type: 'morning' }];
    }
    const startMin = timeToMinutes(task.startTime);
    const endMin = startMin + (task.duration || 0);
    const points = [];
    if (catSettings.before15) points.push({ key: `b15-${task.id}`, triggerMin: startMin - 15, type: 'before15' });
    if (catSettings.before10) points.push({ key: `b10-${task.id}`, triggerMin: startMin - 10, type: 'before10' });
    if (catSettings.before5) points.push({ key: `b5-${task.id}`, triggerMin: startMin - 5, type: 'before5' });
    if (catSettings.atStart) points.push({ key: `start-${task.id}`, triggerMin: startMin, type: 'start' });
    if (catSettings.atEnd) points.push({ key: `end-${task.id}`, triggerMin: endMin, type: 'end' });
    return points.filter(p => p.triggerMin >= 0);
  };

  const toggleComplete = (id, fromInbox = false) => {
    pushUndo();
    playUISound('tick');
    if (navigator.vibrate) navigator.vibrate(30);
    // Handle recurring task instances
    if (typeof id === 'string' && id.startsWith('recurring-')) {
      const { templateId, dateStr } = parseRecurringId(id);
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== templateId) return t;
        const completed = (t.completedDates || []).includes(dateStr);
        return {
          ...t,
          completedDates: completed
            ? (t.completedDates || []).filter(d => d !== dateStr)
            : [...(t.completedDates || []), dateStr]
        };
      }));
      if (!onboardingProgress.hasCompletedTask) {
        setOnboardingProgress(prev => ({ ...prev, hasCompletedTask: true }));
      }
      const wasCompleted = recurringTasks.find(t => t.id === templateId)?.completedDates?.includes(dateStr);
      if (!wasCompleted) {
        setUndoToast({ message: 'Task completed', actionable: true });
      }
      return;
    }

    // Track for onboarding - check if we're completing (not uncompleting) a task
    const taskToToggle = fromInbox
      ? unscheduledTasks.find(t => t.id === id)
      : tasks.find(t => t.id === id);
    if (!onboardingProgress.hasCompletedTask && taskToToggle && !taskToToggle.completed) {
      setOnboardingProgress(prev => ({ ...prev, hasCompletedTask: true }));
    }

    if (fromInbox) {
      // Use functional update to avoid stale closure overwriting concurrent state changes (e.g. moveToRecycleBin)
      setUnscheduledTasks(prev => prev.map(task =>
        task.id === id ? { ...task, completed: !task.completed, completedAt: !task.completed ? dateToString(new Date()) : null } : task
      ));
    } else {
      // Find the task to check if it's a task calendar item
      const task = tasks.find(t => t.id === id);
      if (task?.isTaskCalendar && task?.icalUid) {
        // Persist completion state for task calendar items
        setCompletedTaskUids(prev => {
          const newSet = new Set(prev);
          if (task.completed) {
            newSet.delete(task.icalUid);
          } else {
            newSet.add(task.icalUid);
          }
          return newSet;
        });
      }
      setTasks(prev => prev.map(task =>
        task.id === id ? { ...task, completed: !task.completed } : task
      ));
    }
    if (taskToToggle && !taskToToggle.completed) {
      setUndoToast({ message: 'Task completed', actionable: true });
    }
  };

  const postponeTask = (id) => {
    // Don't allow postponing recurring instances
    if (typeof id === 'string' && id.startsWith('recurring-')) return;
    const task = tasks.find(t => t.id === id);
    if (!task || !task.startTime || !task.date) return; // Only postpone scheduled tasks

    // Calculate next day's date based on task's current date
    const nextDay = new Date(task.date + 'T12:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDateStr = nextDay.toISOString().split('T')[0];

    // Check for conflicts with imported calendar events on the target date
    const { conflicted, conflictingEvent } = getAdjustedTimeForImportedConflicts(
      id, task.startTime, task.duration, nextDateStr
    );

    if (conflicted) {
      playUISound('error');
      setSyncNotification({
        type: 'error',
        title: "Can't Postpone",
        message: `Time slot conflicts with "${conflictingEvent?.title || 'a calendar event'}" on ${nextDateStr}`
      });
      return;
    }

    // Update the task with the new date (same time)
    setTasks(tasks.map(t =>
      t.id === id ? { ...t, date: nextDateStr } : t
    ));

    playUISound('slide');

    // Track for onboarding
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  const moveToInbox = (id) => {
    pushUndo();
    // Don't allow moving recurring instances to inbox
    if (typeof id === 'string' && id.startsWith('recurring-')) return;
    const task = tasks.find(t => t.id === id);
    if (!task || task.imported) return;

    // Remove scheduling info and move to inbox
    const unscheduledTask = {
      ...task,
      startTime: null,
      date: null,
      isAllDay: false,
      priority: task.priority || 0
    };

    setTasks(tasks.filter(t => t.id !== id));
    setUnscheduledTasks([...unscheduledTasks, unscheduledTask]);
    playUISound('slide');
    setUndoToast({ message: 'Moved to inbox', actionable: true });

    // Track for onboarding
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  const startEditingTask = (task, isInbox = false) => {
    if (task.imported) return; // Don't allow editing imported tasks
    // Reset any existing tag suggestions
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(0);
    setEditingTaskId(task.id);
    setEditingTaskText(task.title);
  };

  const saveTaskTitle = (isInbox = false) => {
    pushUndo();
    if (!editingTaskId || !editingTaskText.trim()) {
      cancelEditingTask();
      return;
    }

    const cleanedTitle = cleanTitle(editingTaskText);

    // Handle recurring task instances - update the template title
    if (typeof editingTaskId === 'string' && editingTaskId.startsWith('recurring-')) {
      const templateId = Number(editingTaskId.split('-')[1]);
      setRecurringTasks(prev => prev.map(t =>
        t.id === templateId ? { ...t, title: cleanedTitle } : t
      ));
    } else if (isInbox) {
      setUnscheduledTasks(unscheduledTasks.map(t =>
        t.id === editingTaskId ? { ...t, title: cleanedTitle } : t
      ));
    } else {
      setTasks(tasks.map(t =>
        t.id === editingTaskId ? { ...t, title: cleanedTitle } : t
      ));
    }

    // Track for onboarding if task has tags
    if (!onboardingProgress.hasUsedTags && extractTags(editingTaskText.trim()).length > 0) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedTags: true }));
    }

    setEditingTaskId(null);
    setEditingTaskText('');
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(0);
  };

  const cancelEditingTask = () => {
    setEditingTaskId(null);
    setEditingTaskText('');
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(0);
  };

  // Notes & Subtasks CRUD functions
  const updateTaskNotes = (taskId, notes, isInbox) => {
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      const templateId = Number(taskId.split('-')[1]);
      setRecurringTasks(prev => prev.map(t =>
        t.id === templateId ? { ...t, notes } : t
      ));
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, notes } : t
      ));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, notes } : t
      ));
    }
    // Track for onboarding when notes are added (not cleared)
    if (!onboardingProgress.hasAddedNotes && notes && notes.trim()) {
      setOnboardingProgress(prev => ({ ...prev, hasAddedNotes: true }));
    }
  };

  // Helper to update a recurring task template by ID
  const updateRecurringTemplate = (taskId, updater) => {
    const templateId = Number(taskId.split('-')[1]);
    setRecurringTasks(prev => prev.map(t => t.id === templateId ? updater(t) : t));
  };

  const updateRecurrencePattern = (templateId, dateStr, newRecurrence) => {
    setRecurringTasks(prev => prev.map(t => {
      if (t.id !== templateId) return t;
      // Use the 1st of the earlier month so changing monthly day doesn't skip the start month
      const origStart = t.recurrence.startDate;
      const earlierDate = origStart <= dateStr ? origStart : dateStr;
      const newStart = earlierDate.substring(0, 8) + '01';
      return { ...t, recurrence: { ...newRecurrence, startDate: newStart } };
    }));
  };

  const updateRecurrenceEndCondition = (templateId, { endDate, maxOccurrences }) => {
    setRecurringTasks(prev => prev.map(t => {
      if (t.id !== templateId) return t;
      const updated = { ...t.recurrence };
      delete updated.endDate;
      delete updated.maxOccurrences;
      if (endDate) updated.endDate = endDate;
      if (maxOccurrences) updated.maxOccurrences = maxOccurrences;
      return { ...t, recurrence: updated };
    }));
  };

  const addSubtask = (taskId, title, isInbox) => {
    if (!title.trim()) return;
    pushUndo();
    const newSubtask = {
      id: Date.now().toString(),
      title: title.trim(),
      completed: false
    };
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      updateRecurringTemplate(taskId, t => ({ ...t, subtasks: [...(t.subtasks || []), newSubtask] }));
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), newSubtask] } : t
      ));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), newSubtask] } : t
      ));
    }
    // Track for onboarding
    if (!onboardingProgress.hasAddedNotes) {
      setOnboardingProgress(prev => ({ ...prev, hasAddedNotes: true }));
    }
  };

  const toggleSubtask = (taskId, subtaskId, isInbox) => {
    pushUndo();
    const subtaskUpdater = t => ({
      ...t,
      subtasks: (t.subtasks || []).map(st =>
        st.id === subtaskId ? { ...st, completed: !st.completed } : st
      )
    });
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      updateRecurringTemplate(taskId, subtaskUpdater);
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    }
  };

  const deleteSubtask = (taskId, subtaskId, isInbox) => {
    pushUndo();
    const subtaskUpdater = t => ({
      ...t,
      subtasks: (t.subtasks || []).filter(st => st.id !== subtaskId)
    });
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      updateRecurringTemplate(taskId, subtaskUpdater);
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    }
  };

  const updateSubtaskTitle = (taskId, subtaskId, newTitle, isInbox) => {
    pushUndo();
    const subtaskUpdater = t => ({
      ...t,
      subtasks: (t.subtasks || []).map(st =>
        st.id === subtaskId ? { ...st, title: newTitle } : st
      )
    });
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      updateRecurringTemplate(taskId, subtaskUpdater);
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    }
  };

  const handleEditKeyDown = (e, isInbox = false) => {
    // Handle autocomplete keyboard navigation
    // Tags: TAB or SPACE accepts tag completion
    // Non-tags: SPACE accepts the suggestion and inserts a space
    // ENTER always saves; ESC always cancels
    if (showSuggestions && suggestions.length > 0) {
      const selected = suggestions[selectedSuggestionIndex];

      if (e.key === 'Tab' || e.key === ' ') {
        e.preventDefault();
        if (selected.type === 'tag') {
          applySuggestionForEdit(selected, e.target, isInbox);
        } else {
          const inputEl = e.target;
          // Autocomplete the shortcut text and append a space
          const { text: completed, cursorPos } = completeShortcutText(editingTaskText, selected);
          const newText = completed + ' ';
          // Apply the selected suggestion attribute
          if (selected.type === 'date' || selected.type === 'time') {
            if (isInbox) {
              setUnscheduledTasks(prev => prev.map(t => {
                if (t.id !== editingTaskId) return t;
                if (selected.type === 'date') return { ...t, scheduledDate: selected.value };
                return { ...t, scheduledTime: selected.value };
              }));
            } else if (selected.type === 'time') {
              const editingTask = tasks.find(t => t.id === editingTaskId);
              if (editingTask && !editingTask.isAllDay) {
                const { adjustedStartTime } = getAdjustedTimeForImportedConflicts(
                  editingTaskId, selected.value, editingTask.duration, editingTask.date
                );
                setTasks(prev => prev.map(t =>
                  t.id === editingTaskId ? { ...t, startTime: adjustedStartTime } : t
                ));
              } else {
                setTasks(prev => prev.map(t =>
                  t.id === editingTaskId ? { ...t, startTime: selected.value } : t
                ));
              }
            } else {
              setTasks(prev => prev.map(t =>
                t.id === editingTaskId ? { ...t, date: selected.value } : t
              ));
            }
          } else if (selected.type === 'deadline' && isInbox) {
            setUnscheduledTasks(prev => prev.map(t =>
              t.id === editingTaskId ? { ...t, deadline: selected.value } : t
            ));
          } else if (selected.type === 'priority' && isInbox) {
            setUnscheduledTasks(prev => prev.map(t =>
              t.id === editingTaskId ? { ...t, priority: selected.value } : t
            ));
          } else if (selected.type === 'duration') {
            if (isInbox) {
              setUnscheduledTasks(prev => prev.map(t =>
                t.id === editingTaskId ? { ...t, duration: selected.value } : t
              ));
            } else {
              setTasks(prev => prev.map(t =>
                t.id === editingTaskId ? { ...t, duration: selected.value } : t
              ));
            }
          }
          setEditingTaskText(newText);
          setShowSuggestions(false);
          setSuggestions([]);
          setSelectedSuggestionIndex(0);
          setTimeout(() => {
            if (inputEl) {
              const pos = cursorPos + 1;
              inputEl.selectionStart = pos;
              inputEl.selectionEnd = pos;
            }
          }, 0);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev + 1) % suggestions.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      saveTaskTitle(isInbox);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingTask();
    }
  };

  // Apply a suggestion for editing a task
  const applySuggestionForEdit = (suggestion, inputElement, isInbox) => {
    if (suggestion.type === 'tag') {
      // Complete the tag
      const cursorPos = inputElement?.selectionStart || editingTaskText.length;
      const { text: newText, newCursorPos } = applyTagCompletion(editingTaskText, cursorPos, suggestion.value);
      const textWithSpace = newText.slice(0, newCursorPos) + ' ' + newText.slice(newCursorPos);
      setEditingTaskText(textWithSpace);
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (inputElement) {
          inputElement.selectionStart = newCursorPos + 1;
          inputElement.selectionEnd = newCursorPos + 1;
        }
      }, 0);
    } else {
      // Autocomplete the shortcut text and apply the selected suggestion
      const { text: completed, cursorPos } = completeShortcutText(editingTaskText, suggestion);
      setEditingTaskText(completed);
      if (suggestion.type === 'date' || suggestion.type === 'time') {
        if (isInbox) {
          setUnscheduledTasks(prev => prev.map(t => {
            if (t.id !== editingTaskId) return t;
            if (suggestion.type === 'date') return { ...t, scheduledDate: suggestion.value };
            return { ...t, scheduledTime: suggestion.value };
          }));
        } else if (suggestion.type === 'time') {
          const editingTask = tasks.find(t => t.id === editingTaskId);
          if (editingTask && !editingTask.isAllDay) {
            const { adjustedStartTime } = getAdjustedTimeForImportedConflicts(
              editingTaskId, suggestion.value, editingTask.duration, editingTask.date
            );
            setTasks(prev => prev.map(t =>
              t.id === editingTaskId ? { ...t, startTime: adjustedStartTime } : t
            ));
          } else {
            setTasks(prev => prev.map(t =>
              t.id === editingTaskId ? { ...t, startTime: suggestion.value } : t
            ));
          }
        } else {
          setTasks(prev => prev.map(t =>
            t.id === editingTaskId ? { ...t, date: suggestion.value } : t
          ));
        }
      } else if (suggestion.type === 'deadline' && isInbox) {
        setUnscheduledTasks(prev => prev.map(t =>
          t.id === editingTaskId ? { ...t, deadline: suggestion.value } : t
        ));
      } else if (suggestion.type === 'priority' && isInbox) {
        setUnscheduledTasks(prev => prev.map(t =>
          t.id === editingTaskId ? { ...t, priority: suggestion.value } : t
        ));
      } else if (suggestion.type === 'duration') {
        if (isInbox) {
          setUnscheduledTasks(prev => prev.map(t =>
            t.id === editingTaskId ? { ...t, duration: suggestion.value } : t
          ));
        } else {
          setTasks(prev => prev.map(t =>
            t.id === editingTaskId ? { ...t, duration: suggestion.value } : t
          ));
        }
      }
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (inputElement) {
          inputElement.focus();
          inputElement.selectionStart = cursorPos;
          inputElement.selectionEnd = cursorPos;
        }
      }, 0);
    }
  };

  // Build suggestions from text (tags, dates, times)
  // isInbox: when true, skip date (@) and time (~) suggestions since inbox tasks don't get scheduled
  const buildSuggestions = (text, cursorPos, isInbox = false) => {
    const allSuggestions = [];

    // Check for partial tag at cursor (triggered by #)
    const tagInfo = getPartialTag(text, cursorPos);
    if (tagInfo) {
      const filtered = getFilteredTags(tagInfo.tag, allTags);
      filtered.forEach(tag => {
        allSuggestions.push({
          type: 'tag',
          value: tag,
          display: tag,
          startIndex: tagInfo.startIndex,
          endIndex: cursorPos
        });
      });
    }

    // Check for partial date at cursor (triggered by @) - skip for inbox tasks
    if (!isInbox) {
      const dateInfo = getPartialDate(text, cursorPos);
      if (dateInfo) {
        const candidates = getDateCandidates(dateInfo.partial);
        for (const parsed of candidates) {
          const dateStr = `${parsed.date.getFullYear()}-${(parsed.date.getMonth() + 1).toString().padStart(2, '0')}-${parsed.date.getDate().toString().padStart(2, '0')}`;
          allSuggestions.push({
            type: 'date',
            value: dateStr,
            display: parsed.display,
            keyword: parsed.keyword,
            startIndex: dateInfo.startIndex,
            endIndex: cursorPos
          });
        }
      }
    }

    // Check for partial time at cursor (triggered by ~) - skip for inbox tasks
    if (!isInbox) {
      const timeInfo = getPartialTime(text, cursorPos);
      if (timeInfo) {
        const candidates = getTimeCandidates(timeInfo.partial);
        for (const parsed of candidates) {
          allSuggestions.push({
            type: 'time',
            value: parsed.time,
            display: parsed.display,
            keyword: parsed.keyword,
            startIndex: timeInfo.startIndex,
            endIndex: cursorPos
          });
        }
      }
    }

    // Check for partial deadline at cursor (triggered by $) - only for inbox tasks
    if (isInbox) {
      const deadlineInfo = getPartialDeadline(text, cursorPos);
      if (deadlineInfo) {
        const candidates = getDateCandidates(deadlineInfo.partial);
        for (const parsed of candidates) {
          const dateStr = `${parsed.date.getFullYear()}-${(parsed.date.getMonth() + 1).toString().padStart(2, '0')}-${parsed.date.getDate().toString().padStart(2, '0')}`;
          allSuggestions.push({
            type: 'deadline',
            value: dateStr,
            display: `Deadline: ${parsed.display}`,
            keyword: parsed.keyword,
            startIndex: deadlineInfo.startIndex,
            endIndex: cursorPos
          });
        }
      }
    }

    // Check for priority at cursor (triggered by !, !!, !!!) - only for inbox tasks
    if (isInbox) {
      const priorityInfo = getPartialPriority(text, cursorPos);
      if (priorityInfo) {
        const priorityLabels = ['Low priority (!)', 'Medium priority (!!)', 'High priority (!!!)'];
        allSuggestions.push({
          type: 'priority',
          value: priorityInfo.count,
          display: priorityLabels[priorityInfo.count - 1],
          startIndex: priorityInfo.startIndex,
          endIndex: priorityInfo.endIndex
        });
      }
    }

    // Check for duration at cursor (triggered by %) - works for both inbox and scheduled
    // Shows 15-minute increment suggestions filtered by typed digits
    const durationInfo = getPartialDuration(text, cursorPos);
    if (durationInfo) {
      const increments = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240];
      const typed = durationInfo.partial;
      const matching = increments.filter(m => String(m).startsWith(typed));
      for (const mins of matching.slice(0, 4)) {
        const hrs = Math.floor(mins / 60);
        const rem = mins % 60;
        const display = hrs > 0
          ? `Duration: ${hrs}h${rem > 0 ? ` ${rem}m` : ''}`
          : `Duration: ${mins}m`;
        allSuggestions.push({
          type: 'duration',
          value: mins,
          display,
          keyword: String(mins),
          startIndex: durationInfo.startIndex,
          endIndex: durationInfo.endIndex
        });
      }
    }

    return allSuggestions
  };

  // Handle suggestions for editing task input
  const handleEditInputChange = (e, isInbox = false) => {
    const value = e.target.value;
    setEditingTaskText(value);
    editingInputRef.current = e.target;

    const cursorPos = e.target.selectionStart;
    const allSuggestions = buildSuggestions(value, cursorPos, isInbox);

    // Auto-apply attribute suggestions in real-time as the user types
    // Use first (best) match per type, not last
    const appliedTypes = new Set();
    for (const s of allSuggestions) {
      if (s.type === 'tag') continue;
      if (appliedTypes.has(s.type)) continue;
      appliedTypes.add(s.type);
      if (s.type === 'date' || s.type === 'time') {
        if (isInbox) {
          setUnscheduledTasks(prev => prev.map(t => {
            if (t.id !== editingTaskId) return t;
            if (s.type === 'date') return { ...t, scheduledDate: s.value };
            return { ...t, scheduledTime: s.value };
          }));
        } else if (s.type === 'time') {
          const editingTask = tasks.find(t => t.id === editingTaskId);
          if (editingTask && !editingTask.isAllDay) {
            const { adjustedStartTime } = getAdjustedTimeForImportedConflicts(
              editingTaskId, s.value, editingTask.duration, editingTask.date
            );
            setTasks(prev => prev.map(t =>
              t.id === editingTaskId ? { ...t, startTime: adjustedStartTime } : t
            ));
          } else {
            setTasks(prev => prev.map(t =>
              t.id === editingTaskId ? { ...t, startTime: s.value } : t
            ));
          }
        } else {
          setTasks(prev => prev.map(t =>
            t.id === editingTaskId ? { ...t, date: s.value } : t
          ));
        }
      } else if (s.type === 'deadline' && isInbox) {
        setUnscheduledTasks(prev => prev.map(t =>
          t.id === editingTaskId ? { ...t, deadline: s.value } : t
        ));
      } else if (s.type === 'priority' && isInbox) {
        setUnscheduledTasks(prev => prev.map(t =>
          t.id === editingTaskId ? { ...t, priority: s.value } : t
        ));
      } else if (s.type === 'duration') {
        if (isInbox) {
          setUnscheduledTasks(prev => prev.map(t =>
            t.id === editingTaskId ? { ...t, duration: s.value } : t
          ));
        } else {
          setTasks(prev => prev.map(t =>
            t.id === editingTaskId ? { ...t, duration: s.value } : t
          ));
        }
      }
    }

    if (allSuggestions.length > 0) {
      setSuggestions(allSuggestions);
      setSelectedSuggestionIndex(0);
      setShowSuggestions(true);
      setSuggestionContext('editing');
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  };

  // Handle suggestions for new task input
  const handleNewTaskInputChange = (e) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    const allSuggestions = buildSuggestions(value, cursorPos, newTask.openInInbox);

    // Auto-apply attribute suggestions in real-time as the user types
    const updates = { title: value };
    for (const s of allSuggestions) {
      // Use first (best) match per type, not last
      if (s.type === 'date' && !('date' in updates)) updates.date = s.value;
      else if (s.type === 'time' && !('startTime' in updates)) updates.startTime = s.value;
      else if (s.type === 'deadline' && !('deadline' in updates)) updates.deadline = s.value;
      else if (s.type === 'priority' && !('priority' in updates)) updates.priority = s.value;
      else if (s.type === 'duration' && !('duration' in updates)) updates.duration = s.value;
    }
    setNewTask({ ...newTask, ...updates });

    if (allSuggestions.length > 0) {
      setSuggestions(allSuggestions);
      setSelectedSuggestionIndex(0);
      setShowSuggestions(true);
      setSuggestionContext('newTask');
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  };

  // Handle keyboard for new task input with suggestions
  // Tags: TAB or SPACE accepts tag completion
  // Non-tags: SPACE accepts the suggestion and inserts a space
  // ENTER always submits; ESC bubbles up to close the modal
  const handleNewTaskInputKeyDown = (e) => {
    if (showSuggestions && suggestions.length > 0) {
      const selected = suggestions[selectedSuggestionIndex];

      if (e.key === 'Tab' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        if (selected.type === 'tag') {
          applySuggestionForNewTask(selected);
        } else {
          // Autocomplete the shortcut text and append a space
          const { text: completed, cursorPos } = completeShortcutText(newTask.title, selected);
          const newTitle = completed + ' ';
          const updates = { title: newTitle };
          if (selected.type === 'date') updates.date = selected.value;
          else if (selected.type === 'time') updates.startTime = selected.value;
          else if (selected.type === 'deadline') updates.deadline = selected.value;
          else if (selected.type === 'priority') updates.priority = selected.value;
          else if (selected.type === 'duration') updates.duration = selected.value;
          setNewTask({ ...newTask, ...updates });
          setShowSuggestions(false);
          setSuggestions([]);
          setSelectedSuggestionIndex(0);
          setTimeout(() => {
            if (newTaskInputRef.current) {
              const pos = cursorPos + 1; // after the space
              newTaskInputRef.current.selectionStart = pos;
              newTaskInputRef.current.selectionEnd = pos;
            }
          }, 0);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev + 1) % suggestions.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
    }
  };

  // Apply a suggestion for new task
  const applySuggestionForNewTask = (suggestion) => {
    if (suggestion.type === 'tag') {
      // Complete the tag
      const cursorPos = newTaskInputRef.current?.selectionStart || newTask.title.length;
      const { text: newText, newCursorPos } = applyTagCompletion(newTask.title, cursorPos, suggestion.value);
      const textWithSpace = newText.slice(0, newCursorPos) + ' ' + newText.slice(newCursorPos);
      setNewTask({ ...newTask, title: textWithSpace });
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (newTaskInputRef.current) {
          newTaskInputRef.current.selectionStart = newCursorPos + 1;
          newTaskInputRef.current.selectionEnd = newCursorPos + 1;
        }
      }, 0);
    } else {
      // Autocomplete the shortcut text and apply the selected suggestion
      const { text: completed, cursorPos } = completeShortcutText(newTask.title, suggestion);
      const updates = { title: completed };
      if (suggestion.type === 'date') updates.date = suggestion.value;
      else if (suggestion.type === 'time') updates.startTime = suggestion.value;
      else if (suggestion.type === 'deadline') updates.deadline = suggestion.value;
      else if (suggestion.type === 'priority') updates.priority = suggestion.value;
      else if (suggestion.type === 'duration') updates.duration = suggestion.value;
      setNewTask({ ...newTask, ...updates });
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (newTaskInputRef.current) {
          newTaskInputRef.current.focus();
          newTaskInputRef.current.selectionStart = cursorPos;
          newTaskInputRef.current.selectionEnd = cursorPos;
        }
      }, 0);
    }
  };

  // Close tag suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showSuggestions && !e.target.closest('.tag-autocomplete-container')) {
        setShowSuggestions(false);
        setSuggestions([]);
        setSelectedSuggestionIndex(0);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSuggestions]);

  // Reset tag suggestions when add task modal closes
  useEffect(() => {
    if (!showAddTask) {
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
    }
  }, [showAddTask]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Escape to close modals/dialogs (works even when focus is on body)
      if (e.key === 'Escape') {
        if (showSpotlight) {
          e.preventDefault();
          setShowSpotlight(false);
          return;
        }
        if (showShortcutHelp) {
          e.preventDefault();
          setShowShortcutHelp(false);
          return;
        }
        if (editingRecurrenceTaskId) {
          e.preventDefault();
          setEditingRecurrenceTaskId(null);
          return;
        }
        if (showMonthView) {
          e.preventDefault();
          setShowMonthView(false);
          return;
        }
        if (showAutoBackupManager) {
          e.preventDefault();
          setShowAutoBackupManager(false);
          setAutoBackupRestoreConfirm(null);
          return;
        }
        if (showBackupMenu) {
          e.preventDefault();
          setShowBackupMenu(false);
          return;
        }
        if (showSettings) {
          e.preventDefault();
          setShowSettings(false);
          return;
        }
        if (showRemindersSettings) {
          e.preventDefault();
          setShowRemindersSettings(false);
          return;
        }
        if (showWeeklyReview) {
          e.preventDefault();
          setShowWeeklyReview(false);
          return;
        }
        if (showAddTask) {
          e.preventDefault();
          if (showRecurrencePicker) {
            setShowRecurrencePicker(false);
          } else {
            setShowAddTask(false);
            setShowNewTaskDeadlinePicker(false);
          }
          return;
        }
      }

      // Undo/Redo — works even when focus is in an input/textarea
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          performUndo();
          return;
        }
        if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault();
          performRedo();
          return;
        }
      }

      // Cmd+K / Ctrl+K for spotlight search (works even in inputs)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowSpotlight(prev => {
          if (!prev) {
            setSpotlightQuery('');
            setSpotlightSelectedIndex(0);
            playUISound('spotlight');
          }
          return !prev;
        });
        return;
      }

      // '?' for shortcut cheat sheet (works even in inputs)
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Don't trigger in inputs unless it's already showing (to allow closing)
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
          return;
        }
        e.preventDefault();
        setShowShortcutHelp(prev => !prev);
        return;
      }

      // Don't trigger if typing in an input or textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      // Don't trigger shortcuts when a modal is open (except Escape and ? handled above)
      if (showAddTask || showFocusMode || showRoutinesDashboard || showShortcutHelp || showSpotlight || showSettings || showRemindersSettings || showWeeklyReview) {
        return;
      }

      const noModifiers = !e.ctrlKey && !e.metaKey && !e.altKey;

      // 'n' for new scheduled task
      if (e.key === 'n' && noModifiers) {
        e.preventDefault();
        setNewTask({
          title: '',
          startTime: hoverPreviewTime || getNextQuarterHour(),
          duration: 30,
          date: hoverPreviewDate ? dateToString(hoverPreviewDate) : dateToString(selectedDate),
          isAllDay: false,
          openInInbox: false
        });
        setHoverPreviewTime(null);
        setHoverPreviewDate(null);
        setShowAddTask(true);
      }

      // 'i' for new inbox task
      if (e.key === 'i' && noModifiers) {
        e.preventDefault();
        setNewTask({
          title: '',
          duration: 30,
          openInInbox: true
        });
        setShowAddTask(true);
      }

      // 'r' for routines dashboard
      if (e.key === 'r' && noModifiers) {
        e.preventDefault();
        setShowRoutinesDashboard(true);
      }

      // 'f' for focus mode (only when available)
      if (e.key === 'f' && noModifiers) {
        e.preventDefault();
        if (focusModeAvailableRef.current) {
          enterFocusMode();
        }
      }

      // ',' to collapse sidebar, '.' to expand sidebar
      if (e.key === ',' && noModifiers) {
        e.preventDefault();
        setSidebarCollapsed(true);
      }
      if (e.key === '.' && noModifiers) {
        e.preventDefault();
        setSidebarCollapsed(false);
      }

      // 'd' to toggle dark mode
      if (e.key === 'd' && noModifiers) {
        e.preventDefault();
        setDarkMode(prev => !prev);
      }

      // 't' to jump to today
      if (e.key === 't' && noModifiers) {
        e.preventDefault();
        goToToday();
        if (showMonthView) {
          const today = new Date();
          setViewedMonth(new Date(today.getFullYear(), today.getMonth(), 1));
        }
      }

      // 'm' to toggle month view
      if (e.key === 'm' && noModifiers) {
        e.preventDefault();
        setShowMonthView(prev => !prev);
      }

      // 'b' to toggle backup menu
      if (e.key === 'b' && noModifiers) {
        e.preventDefault();
        setShowBackupMenu(prev => !prev);
      }

      // Arrow left/right to navigate dates
      if (e.key === 'ArrowLeft' && noModifiers) {
        e.preventDefault();
        changeDate(-1);
        if (showMonthView) {
          // Sync viewed month after date change
          setSelectedDate(prev => {
            setViewedMonth(new Date(prev.getFullYear(), prev.getMonth(), 1));
            return prev;
          });
        }
      }
      if (e.key === 'ArrowRight' && noModifiers) {
        e.preventDefault();
        changeDate(1);
        if (showMonthView) {
          setSelectedDate(prev => {
            setViewedMonth(new Date(prev.getFullYear(), prev.getMonth(), 1));
            return prev;
          });
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [selectedDate, showAddTask, showRecurrencePicker, editingRecurrenceTaskId, showShortcutHelp, showFocusMode, showRoutinesDashboard, showMonthView, showBackupMenu, showAutoBackupManager, showSpotlight, showSettings, showRemindersSettings, showWeeklyReview, hoverPreviewTime, hoverPreviewDate]);

  // Mobile multi-finger long-press gestures: 2-finger hold = undo, 3-finger hold = redo
  useEffect(() => {
    if (!isMobile) return;
    let holdTimer = null;
    let startPositions = [];
    let fired = false;

    const cancel = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    };

    const onTouchStart = (e) => {
      const count = e.touches.length;
      if (count < 2) { cancel(); return; }
      startPositions = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
      fired = false;
      cancel();
      holdTimer = setTimeout(() => {
        fired = true;
        if (count === 2) performUndo();
        else if (count >= 3) performRedo();
      }, 300);
    };

    const onTouchMove = (e) => {
      if (!holdTimer) return;
      const moved = Array.from(e.touches).some((t, i) => {
        const start = startPositions[i];
        if (!start) return false;
        return Math.abs(t.clientX - start.x) > 20 || Math.abs(t.clientY - start.y) > 20;
      });
      if (moved) cancel();
    };

    const onTouchEnd = () => { cancel(); };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      cancel();
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [isMobile]);

  const moveToRecycleBin = (id, fromInbox = false) => {
    // Handle recurring task instances - show confirmation dialog
    if (typeof id === 'string' && id.startsWith('recurring-')) {
      const parts = id.split('-');
      const templateId = Number(parts[1]);
      const dateStr = parts.slice(2).join('-');
      setRecurringDeleteConfirm({ taskId: templateId, dateStr });
      return;
    }

    pushUndo();
    const task = fromInbox
      ? unscheduledTasks.find(t => t.id === id)
      : tasks.find(t => t.id === id);

    if (task) {
      // Close notes panel if this task was expanded
      if (expandedNotesTaskId === id) {
        setExpandedNotesTaskId(null);
      }
      // Store original location and deletion time with the task
      const taskWithMeta = {
        ...task,
        _deletedFrom: fromInbox ? 'inbox' : 'calendar',
        deletedAt: new Date().toISOString()
      };
      // Use functional updates to avoid stale closure overwriting concurrent state changes
      setRecycleBin(prev => [...prev, taskWithMeta]);
      if (fromInbox) {
        setUnscheduledTasks(prev => prev.filter(t => t.id !== id));
      } else {
        setTasks(prev => prev.filter(t => t.id !== id));
      }
      playUISound('swoosh');
      if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
      setUndoToast({ message: 'Task deleted', actionable: true });

      // Track for onboarding
      if (!onboardingProgress.hasUsedActionButtons) {
        setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
      }
    }
  };

  // Record a tombstone so cloud sync doesn't resurrect a deleted task/template
  const recordDeletedTaskTombstone = (taskId) => {
    const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}');
    tombstones[String(taskId)] = new Date().toISOString();
    localStorage.setItem('day-planner-deleted-task-ids', JSON.stringify(tombstones));
  };

  // Delete recurring task: this occurrence, all future, or entire series
  const deleteRecurringInstance = (mode) => {
    if (!recurringDeleteConfirm) return;
    pushUndo();
    const { taskId, dateStr } = recurringDeleteConfirm;

    if (mode === 'this') {
      // Add exception for this date
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t;
        return { ...t, exceptions: { ...t.exceptions, [dateStr]: { deleted: true } } };
      }));
    } else if (mode === 'future') {
      // Set end date to day before this occurrence
      const dayBefore = new Date(dateStr + 'T12:00:00');
      dayBefore.setDate(dayBefore.getDate() - 1);
      const endDate = dateToString(dayBefore);
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t;
        return { ...t, recurrence: { ...t.recurrence, endDate } };
      }));
    } else if (mode === 'series') {
      // Remove the entire template
      recordDeletedTaskTombstone(taskId);
      setRecurringTasks(prev => prev.filter(t => t.id !== taskId));
    }

    setRecurringDeleteConfirm(null);
  };

  const undeleteTask = (id) => {
    pushUndo();
    const task = recycleBin.find(t => t.id === id);
    if (task) {
      const { _deletedFrom, ...cleanTask } = task; // Remove metadata

      if (_deletedFrom === 'inbox') {
        setUnscheduledTasks(prev => [...prev, cleanTask]);
      } else {
        setTasks(prev => [...prev, cleanTask]);
      }

      setRecycleBin(prev => prev.filter(t => t.id !== id));
      playUISound('restore');
    }
  };

  const emptyRecycleBin = () => {
    setShowEmptyBinConfirm(true);
  };

  const confirmEmptyBin = () => {
    pushUndo();
    // Record tombstones for permanently deleted tasks (prevents resurrection during merge sync)
    const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}');
    const now = new Date().toISOString();
    recycleBin.forEach(t => { tombstones[String(t.id)] = now; });
    localStorage.setItem('day-planner-deleted-task-ids', JSON.stringify(tombstones));
    setRecycleBin([]);
    setShowEmptyBinConfirm(false);
    setShowMobileRecycleBin(false);
    playUISound('crumple');
  };

  const formatDate = (date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  const formatDateRange = (dates) => {
    if (dates.length === 1) {
      return formatDate(dates[0]);
    }
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const first = dates[0];
    const last = dates[dates.length - 1];

    if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
      // Same month: "Jan 31 - Feb 2"
      return `${months[first.getMonth()]} ${first.getDate()} - ${last.getDate()}, ${first.getFullYear()}`;
    } else if (first.getFullYear() === last.getFullYear()) {
      // Different months, same year: "Jan 31 - Feb 2, 2026"
      return `${months[first.getMonth()]} ${first.getDate()} - ${months[last.getMonth()]} ${last.getDate()}, ${first.getFullYear()}`;
    } else {
      // Different years
      return `${months[first.getMonth()]} ${first.getDate()}, ${first.getFullYear()} - ${months[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`;
    }
  };

  const formatShortDate = (date) => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  const changeDate = (direction) => {
    // Move by the number of visible days (1, 2, or 3) in the given direction
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + (direction * visibleDays));
    newDate.setHours(12, 0, 0, 0); // Maintain noon to avoid timezone issues
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0); // Set to noon to avoid timezone issues
    setSelectedDate(today);
  };

  const goToDate = (date) => {
    const newDate = new Date(date);
    newDate.setHours(12, 0, 0, 0);
    setSelectedDate(newDate);
    setShowMonthView(false);
  };

  const changeViewedMonth = (delta) => {
    setViewedMonth(prev => {
      const newMonth = new Date(prev);
      newMonth.setDate(1); // Set to 1st to avoid month rollover issues
      newMonth.setMonth(newMonth.getMonth() + delta);
      return newMonth;
    });
  };

  const handleSpotlightSelect = (result) => {
    setShowSpotlight(false);
    const { task, source } = result;

    const scrollAndHighlight = (selector, delay = 300) => {
      setTimeout(() => {
        const el = document.querySelector(selector);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-blue-400');
          setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 2000);
        }
      }, delay);
    };

    if (source === 'scheduled') {
      if (isMobile) {
        setMobileActiveTab('timeline');
      }
      goToDate(task.date);
      scrollAndHighlight(`[data-task-id="${task.id}"]`);
    } else if (source === 'inbox') {
      if (isMobile) {
        setMobileActiveTab('inbox');
      } else {
        setSidebarCollapsed(false);
        setMinimizedSections(prev => ({ ...prev, inbox: false }));
      }
      scrollAndHighlight(`[data-task-id="${task.id}"]`);
    } else if (source === 'recurring') {
      const date = task.startDate || dateToString(new Date());
      if (isMobile) {
        setMobileActiveTab('timeline');
      }
      goToDate(date);
    } else if (source === 'deleted') {
      if (!isMobile) {
        setSidebarCollapsed(false);
        setMinimizedSections(prev => ({ ...prev, recycleBin: false }));
        scrollAndHighlight(`[data-task-id="bin-${task.id}"]`);
      }
    }
  };

  const getMonthDays = () => {
    const year = viewedMonth.getFullYear();
    const month = viewedMonth.getMonth();
    
    // First day of the month
    const firstDay = new Date(year, month, 1);
    const firstDayOfWeek = firstDay.getDay(); // 0 = Sunday
    
    // Last day of the month
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    
    // Generate array of days
    const days = [];
    
    // Add empty slots for days before month starts
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add all days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    
    return days;
  };

  const hasTasksOnDate = (date) => {
    if (!date) return false;
    const dateStr = dateToString(date);
    if (tasks.some(task => task.date === dateStr)) return true;
    // Check recurring tasks for this date
    for (const template of recurringTasks) {
      const occs = getOccurrencesInRange(template, dateStr, dateStr);
      if (occs.length > 0) return true;
    }
    return false;
  };

  const openNewTaskForm = () => {
    setNewTask({
      title: '',
      startTime: hoverPreviewTime || getNextQuarterHour(),
      duration: 30,
      date: hoverPreviewDate ? dateToString(hoverPreviewDate) : dateToString(selectedDate),
      isAllDay: false,
      recurrence: null
    });
    setHoverPreviewTime(null);
    setHoverPreviewDate(null);
    setShowRecurrencePicker(false);
    setShowAddTask(true);
  };

  const openNewInboxTask = () => {
    setNewTask({
      title: '',
      startTime: getNextQuarterHour(),
      duration: 30,
      date: dateToString(selectedDate),
      isAllDay: false,
      openInInbox: true,
      deadline: null,
      priority: 0
    });
    setShowAddTask(true);
  };

  const openMobileEditTask = (task, isInbox) => {
    setMobileEditingTask(task);
    setMobileEditIsInbox(isInbox);
    if (isInbox) {
      setNewTask({
        title: task.title,
        duration: task.duration || 30,
        color: task.color || colors[0].class,
        openInInbox: true,
        deadline: task.deadline || null,
        priority: task.priority || 0,
        startTime: getNextQuarterHour(),
        date: dateToString(selectedDate),
        isAllDay: false,
      });
    } else {
      // Load recurrence from recurring template if editing a recurring task
      let recurrence = null;
      if (typeof task.id === 'string' && task.id.startsWith('recurring-')) {
        const parsed = parseRecurringId(task.id);
        if (parsed) {
          const template = recurringTasks.find(t => t.id === parsed.templateId);
          if (template?.recurrence) {
            recurrence = { ...template.recurrence };
          }
        }
      }
      setNewTask({
        title: task.title,
        startTime: task.startTime || getNextQuarterHour(),
        duration: task.duration || 30,
        date: task.date || dateToString(selectedDate),
        isAllDay: task.isAllDay || false,
        color: task.color || colors[0].class,
        recurrence,
      });
    }
    setShowAddTask(true);
  };

  const saveMobileEditTask = () => {
    if (!mobileEditingTask || !newTask.title.trim()) return;
    pushUndo();
    const taskId = mobileEditingTask.id;
    if (mobileEditIsInbox) {
      setUnscheduledTasks(prev => prev.map(t => t.id === taskId ? {
        ...t,
        title: cleanTitle(newTask.title),
        duration: newTask.duration,
        color: newTask.color || colors[0].class,
        deadline: newTask.deadline || null,
        priority: newTask.priority || 0,
      } : t));
    } else if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      const parsed = parseRecurringId(taskId);
      if (parsed) {
        if (!newTask.recurrence) {
          // Recurrence set to none: convert to regular scheduled task and remove recurring template
          const template = recurringTasks.find(t => t.id === parsed.templateId);
          const isCompleted = template?.completedDates?.includes(parsed.dateStr);
          const regularTask = {
            id: Date.now(),
            title: cleanTitle(newTask.title),
            startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
            duration: newTask.duration,
            color: newTask.color || colors[0].class,
            completed: isCompleted || false,
            isAllDay: newTask.isAllDay || false,
            notes: template?.notes || '',
            subtasks: template?.subtasks ? JSON.parse(JSON.stringify(template.subtasks)) : [],
            date: newTask.date || parsed.dateStr,
          };
          setTasks(prev => [...prev, regularTask]);
          recordDeletedTaskTombstone(parsed.templateId);
          setRecurringTasks(prev => prev.filter(t => t.id !== parsed.templateId));
        } else {
          setRecurringTasks(prev => prev.map(t => {
            if (t.id === parsed.templateId) {
              const updated = {
                ...t,
                exceptions: {
                  ...t.exceptions,
                  [parsed.dateStr]: {
                    ...(t.exceptions?.[parsed.dateStr] || {}),
                    title: cleanTitle(newTask.title),
                    startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
                    duration: newTask.duration,
                    isAllDay: newTask.isAllDay || false,
                    color: newTask.color || colors[0].class,
                  }
                }
              };
              // Update recurrence pattern on template if changed
              updated.recurrence = { ...newTask.recurrence, startDate: t.recurrence?.startDate || parsed.dateStr.substring(0, 8) + '01' };
              return updated;
            }
            return t;
          }));
        }
      }
    } else if (newTask.recurrence) {
      // Convert regular task to recurring: remove from tasks, create recurring template
      const existingTask = tasks.find(t => t.id === taskId);
      const taskDate = newTask.date || existingTask?.date || dateToString(selectedDate);
      const template = {
        id: Date.now(),
        title: cleanTitle(newTask.title),
        startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
        duration: newTask.duration,
        color: newTask.color || colors[0].class,
        isAllDay: newTask.isAllDay || false,
        notes: existingTask?.notes || '',
        subtasks: existingTask?.subtasks || [],
        recurrence: { ...newTask.recurrence, startDate: taskDate },
        completedDates: existingTask?.completed ? [taskDate] : [],
        exceptions: {}
      };
      setTasks(prev => prev.filter(t => t.id !== taskId));
      setRecurringTasks(prev => [...prev, template]);
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? {
        ...t,
        title: cleanTitle(newTask.title),
        startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
        duration: newTask.duration,
        date: newTask.date || t.date,
        isAllDay: newTask.isAllDay || false,
        color: newTask.color || colors[0].class,
      } : t));
    }
    setShowAddTask(false);
    setMobileEditingTask(null);
    setMobileEditIsInbox(false);
  };

  // --- Routines handlers ---
  const getDayName = (date) => {
    return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
  };

  const openRoutinesDashboard = () => {
    // Pre-populate center with chips already placed today
    setDashboardSelectedChips(todayRoutines.map(r => ({ id: r.id, name: r.name, bucket: r.bucket, startTime: r.startTime || null })));
    setRoutineAddingToBucket(null);
    setRoutineNewChipName('');
    setShowRoutinesDashboard(true);
  };

  const addRoutineChip = (bucket) => {
    const name = routineNewChipName.trim();
    if (!name) return;
    const chipId = Date.now();
    setRoutineDefinitions(prev => ({
      ...prev,
      [bucket]: [...prev[bucket], { id: chipId, name }]
    }));
    setRoutineNewChipName('');
    setRoutineAddingToBucket(null);
  };

  const deleteRoutineChip = (bucket, chipId) => {
    setRoutineDefinitions(prev => ({
      ...prev,
      [bucket]: prev[bucket].filter(c => c.id !== chipId)
    }));
    // Also remove from dashboard selected and today's routines if present
    setDashboardSelectedChips(prev => prev.filter(c => c.id !== chipId));
    setTodayRoutines(prev => prev.filter(r => r.id !== chipId));
    // Record tombstone so deletion syncs across devices
    const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-routine-chip-ids') || '{}');
    tombstones[String(chipId)] = new Date().toISOString();
    localStorage.setItem('day-planner-deleted-routine-chip-ids', JSON.stringify(tombstones));
  };

  const toggleRoutineChipSelection = (chip, bucket) => {
    const isSelected = dashboardSelectedChips.some(c => c.id === chip.id);
    if (isSelected) {
      setDashboardSelectedChips(prev => prev.filter(c => c.id !== chip.id));
    } else {
      setDashboardSelectedChips(prev => [...prev, { id: chip.id, name: chip.name, bucket, startTime: null }]);
    }
  };

  const handleRoutinesDone = () => {
    const todayStr = dateToString(new Date());
    // Preserve placement info for chips that were already placed on the timeline
    const existingMap = {};
    todayRoutines.forEach(r => { existingMap[r.id] = r; });

    const newTodayRoutines = dashboardSelectedChips.map(chip => {
      const existing = existingMap[chip.id];
      if (existing) {
        return { ...existing, name: chip.name, bucket: chip.bucket, startTime: chip.startTime, isAllDay: !chip.startTime };
      }
      return { id: chip.id, name: chip.name, bucket: chip.bucket, startTime: chip.startTime || null, duration: 15, isAllDay: !chip.startTime };
    });

    // Record tombstones for routines that were removed from today's list
    // so the removal syncs across devices instead of being re-added by merge.
    const newIds = new Set(newTodayRoutines.map(r => String(r.id)));
    const removedIds = todayRoutines.filter(r => !newIds.has(String(r.id)));
    if (removedIds.length > 0) {
      const now = new Date().toISOString();
      setRemovedTodayRoutineIds(prev => {
        const updated = { ...prev };
        removedIds.forEach(r => { updated[String(r.id)] = now; });
        return updated;
      });
    }
    // Clear tombstones for routines that were re-added
    const prevIds = new Set(todayRoutines.map(r => String(r.id)));
    const readdedIds = newTodayRoutines.filter(r => !prevIds.has(String(r.id)));
    if (readdedIds.length > 0) {
      setRemovedTodayRoutineIds(prev => {
        const updated = { ...prev };
        readdedIds.forEach(r => { delete updated[String(r.id)]; });
        return updated;
      });
    }

    setTodayRoutines(newTodayRoutines);
    setRoutinesDate(todayStr);
    setShowRoutinesDashboard(false);
    setRoutineTimePickerChipId(null);
    setRoutineFocusedChipId(null);
    if (!onboardingProgress.hasSetupRoutines) {
      setOnboardingProgress(prev => ({ ...prev, hasSetupRoutines: true }));
    }
  };

  // --- Focus Mode handlers ---
  const getAudioCtx = () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const playFocusSound = (type) => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      if (type === 'work') {
        // Ascending chime: C5 → E5
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(659, ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } else if (type === 'break') {
        // Descending chime: E5 → C5
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(523, ctx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
      } else if (type === 'complete') {
        // Staggered chord: C5 + E5 + G5
        [523, 659, 784].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.1);
          gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + i * 0.1 + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.7);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.1);
          osc.stop(ctx.currentTime + 0.8);
        });
      }
    } catch (e) { /* Audio API not available */ }
  };

  const playUISound = (type) => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      const now = ctx.currentTime;
      switch (type) {
        case 'pop': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, now);
          osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
          osc.frequency.exponentialRampToValueAtTime(600, now + 0.12);
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.15);
          break;
        }
        case 'swoosh': {
          // Two-note descending motif (E5 → B4)
          [659, 494].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.12, now + i * 0.09);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.1);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.09);
            osc.stop(now + i * 0.09 + 0.1);
          });
          break;
        }
        case 'slide': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(500, now);
          osc.frequency.exponentialRampToValueAtTime(300, now + 0.2);
          gain.gain.setValueAtTime(0.1, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.25);
          break;
        }
        case 'drop': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(150, now);
          osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.15);
          break;
        }
        case 'tick': {
          // Subtle clock-tick: short noise impulse through a tight bandpass
          const bufferSize = Math.floor(ctx.sampleRate * 0.015);
          const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
          const noise = ctx.createBufferSource();
          noise.buffer = buffer;
          const filter = ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.value = 3000;
          filter.Q.value = 5;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.06, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);
          noise.connect(filter).connect(gain).connect(ctx.destination);
          noise.start(now);
          noise.stop(now + 0.02);
          break;
        }
        case 'crumple': {
          const bufferSize = ctx.sampleRate * 0.2;
          const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
          const noise = ctx.createBufferSource();
          noise.buffer = buffer;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
          const filter = ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(2000, now);
          filter.frequency.exponentialRampToValueAtTime(400, now + 0.2);
          filter.Q.value = 1;
          noise.connect(filter).connect(gain).connect(ctx.destination);
          noise.start(now);
          noise.stop(now + 0.2);
          break;
        }
        case 'click': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.value = 1000;
          gain.gain.setValueAtTime(0.1, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.04);
          break;
        }
        case 'spotlight': {
          // Soft rising shimmer — two quick sine tones (G5 → B5)
          [784, 988].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, now + i * 0.07);
            gain.gain.linearRampToValueAtTime(0.1, now + i * 0.07 + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.12);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.07);
            osc.stop(now + i * 0.07 + 0.12);
          });
          break;
        }
        case 'restore': {
          // Quick ascending pop: low → high, like something bouncing back up
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(300, now);
          osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.15);
          break;
        }
        case 'undo': {
          // Quick ascending blip — reverse feel of swoosh
          [494, 659].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.12, now + i * 0.09);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.1);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.09);
            osc.stop(now + i * 0.09 + 0.1);
          });
          break;
        }
        case 'reminder': {
          // Ascending triad C5→E5→G5 with longer sustain
          [523, 659, 784].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, now + i * 0.15);
            gain.gain.linearRampToValueAtTime(0.18, now + i * 0.15 + 0.05);
            gain.gain.setValueAtTime(0.18, now + i * 0.15 + 0.25);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.6);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.15);
            osc.stop(now + i * 0.15 + 0.6);
          });
          break;
        }
        case 'error': {
          // Short double-buzz: two quick low-frequency oscillations
          [150, 120].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.12, now + i * 0.12);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.1);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.12);
            osc.stop(now + i * 0.12 + 0.1);
          });
          break;
        }
      }
    } catch (e) { /* Audio API not available */ }
  };

  // Undo/redo: snapshot all 4 state arrays
  const pushUndo = () => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-49),
      {
        tasks: JSON.parse(JSON.stringify(tasks)),
        unscheduledTasks: JSON.parse(JSON.stringify(unscheduledTasks)),
        recycleBin: JSON.parse(JSON.stringify(recycleBin)),
        recurringTasks: JSON.parse(JSON.stringify(recurringTasks)),
      }
    ];
    redoStackRef.current = [];
  };

  const performUndo = () => {
    if (undoStackRef.current.length === 0) return;
    const snapshot = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [
      ...redoStackRef.current,
      {
        tasks: JSON.parse(JSON.stringify(tasksRef.current)),
        unscheduledTasks: JSON.parse(JSON.stringify(unscheduledTasksRef.current)),
        recycleBin: JSON.parse(JSON.stringify(recycleBinRef.current)),
        recurringTasks: JSON.parse(JSON.stringify(recurringTasksRef.current)),
      }
    ];
    setTasks(snapshot.tasks);
    setUnscheduledTasks(snapshot.unscheduledTasks);
    setRecycleBin(snapshot.recycleBin);
    setRecurringTasks(snapshot.recurringTasks);
    playUISound('undo');
    setUndoToast({ message: 'Undone', actionable: false });
  };

  const performRedo = () => {
    if (redoStackRef.current.length === 0) return;
    const snapshot = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [
      ...undoStackRef.current,
      {
        tasks: JSON.parse(JSON.stringify(tasksRef.current)),
        unscheduledTasks: JSON.parse(JSON.stringify(unscheduledTasksRef.current)),
        recycleBin: JSON.parse(JSON.stringify(recycleBinRef.current)),
        recurringTasks: JSON.parse(JSON.stringify(recurringTasksRef.current)),
      }
    ];
    setTasks(snapshot.tasks);
    setUnscheduledTasks(snapshot.unscheduledTasks);
    setRecycleBin(snapshot.recycleBin);
    setRecurringTasks(snapshot.recurringTasks);
    playUISound('undo');
    setUndoToast({ message: 'Redone', actionable: false });
  };

  // Reminder snooze: push task start time forward 15 minutes
  const snoozeReminder = (reminder) => {
    pushUndo();
    setActiveReminders(prev => prev.filter(r => r.id !== reminder.id));
    const newStartMin = Math.min(timeToMinutes(reminder.startTime) + 15, 23 * 60 + 45);
    const newStartTime = minutesToTime(newStartMin);
    const parsed = parseRecurringId(reminder.taskId);
    if (parsed) {
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== parsed.templateId) return t;
        const exceptions = { ...(t.exceptions || {}) };
        exceptions[parsed.dateStr] = { ...(exceptions[parsed.dateStr] || {}), startTime: newStartTime };
        return { ...t, exceptions };
      }));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === reminder.taskId ? { ...t, startTime: newStartTime } : t
      ));
    }
    // Clear fired keys for this task so new-time reminders fire fresh
    const keysToRemove = [...firedRemindersRef.current].filter(k => k.includes(String(reminder.taskId)));
    keysToRemove.forEach(k => firedRemindersRef.current.delete(k));
  };

  const dismissReminder = (reminderId) => {
    setActiveReminders(prev => prev.filter(r => r.id !== reminderId));
  };

  const dismissAllReminders = () => {
    setActiveReminders([]);
  };

  // Reminder preset logic
  const applyReminderPreset = (name) => {
    const presets = {
      standard:   { before15: true, before10: false, before5: false, atStart: true, atEnd: false },
      aggressive: { before15: true, before10: false, before5: true,  atStart: true, atEnd: true },
      minimal:    { before15: false, before10: false, before5: false, atStart: true, atEnd: false },
    };
    const vals = presets[name];
    if (!vals) return;
    setReminderSettings(prev => ({
      ...prev,
      preset: name,
      categories: {
        ...prev.categories,
        calendarEvents:  { ...vals },
        calendarTasks:   { ...vals },
        scheduledTasks:  { ...vals },
        recurringTasks:  { ...vals },
        allDayTasks:     prev.categories.allDayTasks,
      },
    }));
  };

  const updateCategoryReminder = (category, field, value) => {
    setReminderSettings(prev => ({
      ...prev,
      preset: 'custom',
      categories: {
        ...prev.categories,
        [category]: { ...prev.categories[category], [field]: value },
      },
    }));
  };

  const enterFocusMode = () => {
    setShowFocusMode(true);
    setFocusShowSettings(true);
    setFocusShowStats(false);
    setFocusPhase('work');
    setFocusTimerSeconds(0);
    setFocusCycleCount(0);
    setFocusSessionStart(null);
    setFocusCompletedTasks(new Set());
    setFocusTimerRunning(false);
    setFocusTaskMinutes({});
    setFocusBlockTasks(computeFocusBlockTasks());
    setFocusWorkMinutes(25);
    setFocusBreakMinutes(5);
    setFocusLongBreakMinutes(15);
    // Request fullscreen
    try { document.documentElement.requestFullscreen?.(); } catch (e) {}
    // Request wake lock
    (async () => {
      try {
        if (navigator.wakeLock) {
          wakeLockSentinel.current = await navigator.wakeLock.request('screen');
        }
      } catch (e) {}
    })();
  };

  const startFocusTimer = () => {
    setFocusShowSettings(false);
    setFocusSessionStart(new Date());
    setFocusPhase('work');
    setFocusTimerSeconds(focusWorkMinutes * 60);
    setFocusTimerRunning(true);
    playFocusSound('work');
    if (!onboardingProgress.hasUsedFocusMode) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedFocusMode: true }));
    }
  };

  const exitFocusMode = (showStats = true) => {
    setFocusTimerRunning(false);
    if (focusTimerRef.current) {
      clearInterval(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    // Distribute partial work time for current in-progress work cycle
    const minutesCopy = { ...focusTaskMinutes };
    if (focusPhase === 'work' && focusTimerSeconds < focusWorkMinutes * 60) {
      const elapsedMinutes = (focusWorkMinutes * 60 - focusTimerSeconds) / 60;
      const activeTasks = focusBlockTasks.filter(t => !t.completed && !focusCompletedTasks.has(t.id));
      if (activeTasks.length > 0) {
        const perTask = elapsedMinutes / activeTasks.length;
        activeTasks.forEach(t => {
          minutesCopy[t.id] = (minutesCopy[t.id] || 0) + perTask;
        });
      }
    }
    if (Object.keys(minutesCopy).length > 0) {
      setTasks(prev => prev.map(t => {
        if (minutesCopy[t.id]) {
          return { ...t, focusMinutes: (t.focusMinutes || 0) + minutesCopy[t.id] };
        }
        return t;
      }));
    }
    if (showStats) {
      setFocusShowStats(true);
    } else {
      // Exit fullscreen and release wake lock only when closing entirely
      try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch (e) {}
      try { wakeLockSentinel.current?.release(); wakeLockSentinel.current = null; } catch (e) {}
      setShowFocusMode(false);
    }
  };

  const dismissFocusStats = () => {
    try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch (e) {}
    try { wakeLockSentinel.current?.release(); wakeLockSentinel.current = null; } catch (e) {}
    setFocusShowStats(false);
    setShowFocusMode(false);
  };

  const focusCompleteTask = (taskId) => {
    toggleComplete(taskId);
    setFocusCompletedTasks(prev => {
      const next = new Set(prev);
      next.add(taskId);
      return next;
    });
    playFocusSound('complete');
    // Auto-exit if all block tasks are completed
    const allDone = focusBlockTasks.every(t => t.completed || t.id === taskId || focusCompletedTasks.has(t.id));
    if (allDone) {
      setTimeout(() => exitFocusMode(true), 500);
    }
  };

  // Wrappers that update both real tasks and the focus snapshot
  const focusUpdateTaskNotes = (taskId, notes, isInbox) => {
    updateTaskNotes(taskId, notes, isInbox);
    setFocusBlockTasks(prev => prev.map(t => t.id === taskId ? { ...t, notes } : t));
  };
  const focusAddSubtask = (taskId, title, isInbox) => {
    addSubtask(taskId, title, isInbox);
    const newSt = { id: Date.now(), title, completed: false };
    setFocusBlockTasks(prev => prev.map(t => t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), newSt] } : t));
  };
  const focusToggleSubtask = (taskId, subtaskId, isInbox) => {
    toggleSubtask(taskId, subtaskId, isInbox);
    setFocusBlockTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: (t.subtasks || []).map(st => st.id === subtaskId ? { ...st, completed: !st.completed } : st) };
    }));
  };
  const focusDeleteSubtask = (taskId, subtaskId, isInbox) => {
    deleteSubtask(taskId, subtaskId, isInbox);
    setFocusBlockTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: (t.subtasks || []).filter(st => st.id !== subtaskId) };
    }));
  };
  const focusUpdateSubtaskTitle = (taskId, subtaskId, newTitle, isInbox) => {
    updateSubtaskTitle(taskId, subtaskId, newTitle, isInbox);
    setFocusBlockTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: (t.subtasks || []).map(st => st.id === subtaskId ? { ...st, title: newTitle } : st) };
    }));
  };

  const handleFocusTimerEnd = () => {
    if (focusPhase === 'work') {
      // Distribute work minutes across active (non-completed) block tasks
      const activeTasks = focusBlockTasks.filter(t => !t.completed && !focusCompletedTasks.has(t.id));
      if (activeTasks.length > 0) {
        const perTask = focusWorkMinutes / activeTasks.length;
        setFocusTaskMinutes(prev => {
          const next = { ...prev };
          activeTasks.forEach(t => {
            next[t.id] = (next[t.id] || 0) + perTask;
          });
          return next;
        });
      }
      const newCycle = focusCycleCount + 1;
      setFocusCycleCount(newCycle);
      if (newCycle % 4 === 0) {
        setFocusPhase('longBreak');
        setFocusTimerSeconds(focusLongBreakMinutes * 60);
        playFocusSound('break');
      } else {
        setFocusPhase('shortBreak');
        setFocusTimerSeconds(focusBreakMinutes * 60);
        playFocusSound('break');
      }
    } else {
      // Break ended → start work
      setFocusPhase('work');
      setFocusTimerSeconds(focusWorkMinutes * 60);
      playFocusSound('work');
    }
    setFocusTimerRunning(true);
  };

  const handleRoutineResizeStart = (routine, e) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);

    const startY = e.clientY;
    const startDuration = routine.duration;

    const handleMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const deltaMinutes = Math.round((deltaY / 80) * 60 / 15) * 15;
      const newDuration = Math.max(15, startDuration + deltaMinutes);
      setTodayRoutines(prev => prev.map(r => r.id === routine.id ? { ...r, duration: newDuration } : r));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Helper function to convert cursor Y position to time
  const getTimeFromCursorPosition = (e, options = {}) => {
    const { roundTo = 15, maxMinutes = 23 * 60 + 45, taskDuration = 0 } = options;
    const rect = calendarRef.current.getBoundingClientRect();
    const scrollTop = calendarRef.current.scrollTop;
    // Get header height (distance from container top to time grid top in content space)
    const headerHeight = timeGridRef.current ? timeGridRef.current.offsetTop : 0;
    // Calculate y position relative to the time grid content
    const y = Math.max(0, e.clientY - rect.top + scrollTop - headerHeight);

    const totalMinutesFromTop = positionToMinutes(y);

    // Round to nearest interval
    const totalMinutesRounded = Math.round(totalMinutesFromTop / roundTo) * roundTo;
    const hours = Math.floor(totalMinutesRounded / 60) + firstHour;
    const minutes = totalMinutesRounded % 60;

    const totalMinutes = Math.max(0, Math.min(maxMinutes - taskDuration, hours * 60 + minutes));
    return minutesToTime(totalMinutes);
  };

  const openNewTaskAtTime = (e, targetDate = null) => {
    // Only trigger if clicking on the empty calendar area, not on tasks
    if (e.target.classList.contains('calendar-slot')) {
      const clickedTime = getTimeFromCursorPosition(e);

      setNewTask({
        title: '',
        startTime: clickedTime,
        duration: 30,
        date: dateToString(targetDate || selectedDate),
        isAllDay: false
      });
      setShowAddTask(true);
    }
  };

  const handleCalendarMouseMove = (e, targetDate) => {
    if (draggedTask) return; // Don't show hover preview while dragging
    if (!e.target.classList.contains('calendar-slot')) {
      setHoverPreviewTime(null);
      setHoverPreviewDate(null);
      return;
    }
    const time = getTimeFromCursorPosition(e);
    setHoverPreviewTime(time);
    setHoverPreviewDate(targetDate);
  };

  const handleCalendarMouseLeave = () => {
    setHoverPreviewTime(null);
    setHoverPreviewDate(null);
  };

  // Measure actual hour row height from DOM (handles sub-pixel borders on high-DPI screens)
  const getHourHeight = () => {
    if (timeGridRef.current && timeGridRef.current.children.length > 2) {
      // Use second row (index 1) to avoid first row's border-t variation
      return timeGridRef.current.children[1].offsetHeight;
    }
    return 161; // fallback: 160px content + 1px border
  };

  // Convert minutes from midnight to pixel position using actual DOM row positions
  // This eliminates cumulative drift from sub-pixel border rounding on high-DPI screens
  const minutesToPosition = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (timeGridRef.current) {
      const children = timeGridRef.current.children;
      // Only use hour row children (first 24), not overlay divs that follow
      const numRows = Math.min(24, children.length);
      if (hours < numRows) {
        const rowTop = children[hours].offsetTop;
        if (mins === 0) return rowTop;
        const rowHeight = hours + 1 < numRows
          ? children[hours + 1].offsetTop - rowTop
          : children[hours].offsetHeight;
        return rowTop + mins * rowHeight / 60;
      }
    }
    // Fallback when DOM not available
    const hourHeight = 161;
    return hours * hourHeight + mins * 160 / 60;
  };

  // Convert pixel position (relative to time grid top) to minutes from midnight
  const positionToMinutes = (y) => {
    if (timeGridRef.current) {
      const children = timeGridRef.current.children;
      // Only use hour row children (first 24), not overlay divs that follow
      const numRows = Math.min(24, children.length);
      for (let i = 0; i < numRows; i++) {
        const rowTop = children[i].offsetTop;
        const nextTop = i + 1 < numRows
          ? children[i + 1].offsetTop
          : rowTop + children[i].offsetHeight;
        if (y < nextTop || i === numRows - 1) {
          const rowHeight = nextTop - rowTop;
          const pixelsIntoRow = Math.max(0, Math.min(y - rowTop, rowHeight));
          return i * 60 + (pixelsIntoRow / rowHeight) * 60;
        }
      }
    }
    // Fallback
    return (y / 161) * 60;
  };

  // Convert duration in minutes to pixel height
  const durationToHeight = (durationMinutes) => {
    const contentHeight = getHourHeight() - 1;
    return durationMinutes * contentHeight / 60;
  };

  const calculateTaskPosition = (task) => {
    const startMinutes = timeToMinutes(task.startTime);
    const endMinutes = startMinutes + task.duration;
    const top = Math.round(minutesToPosition(startMinutes));
    const endPos = Math.round(minutesToPosition(endMinutes));
    const height = endPos - top - 1; // -1 for consistent tiny gap between tasks
    return { top, height };
  };

  const handleDragStart = (task, source, e) => {
    setDraggedTask(task);
    setDragSource(source);
    setDragPreviewTime(null);
    setExpandedNotesTaskId(null); // Close notes panel when dragging
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragPreviewDate(null);
    setDragOverAllDay(null);
    setDragOverInbox(false);
    setDragOverRecycleBin(false);
    // Clear auto-scroll
    if (autoScrollInterval.current) {
      clearInterval(autoScrollInterval.current);
      autoScrollInterval.current = null;
    }
  };

  // --- Mobile swipe + long-press drag handlers ---
  const handleMobileTaskTouchStart = (e, task, taskType) => {
    // Skip swipe for all imported items (calendar events and task-calendar tasks are immovable)
    if (task.imported) return;
    const touch = e.touches[0];
    swipeTouchStartX.current = touch.clientX;
    swipeTouchStartY.current = touch.clientY;
    swipeCurrentOffset.current = 0;
    swipedTaskId.current = task.id;
    swipeDirection.current = null;
    swipeLocked.current = false;
    swipeIsVertical.current = false;
    swipeTaskElement.current = e.currentTarget;

    // Start long-press timer for timeline, all-day, and deadline tasks
    if ((taskType === 'timeline' || taskType === 'allday' || taskType === 'deadline') && !task.imported) {
      mobileDragTouchStartPos.current = { x: touch.clientX, y: touch.clientY };
      mobileDragTaskId.current = task.id;
      mobileDragOriginalTask.current = task;
      mobileDragSourceType.current = taskType;
      mobileDragTimer.current = setTimeout(() => {
        mobileDragActive.current = true;
        setMobileDragTaskIdState(task.id);
        // Capture initial scroll position and finger position for delta-based drag
        if (calendarRef.current) {
          mobileDragStartScrollTop.current = calendarRef.current.scrollTop;
          calendarRef.current.style.overflowY = 'hidden';
        }
        // Set initial preview based on source
        setMobileDragPreviewTime((taskType === 'allday' || taskType === 'deadline') ? 'all-day' : task.startTime);
        // Add native non-passive touchmove listener to prevent browser scroll
        // (React 18 registers touchmove as passive, so e.preventDefault() in onTouchMove is a no-op)
        const preventScroll = (e) => e.preventDefault();
        document.addEventListener('touchmove', preventScroll, { passive: false });
        mobileDragPreventScrollRef.current = preventScroll;
        // Haptic feedback
        if (navigator.vibrate) navigator.vibrate(50);
      }, 500);
    }
  };

  const handleMobileTaskTouchMove = (e) => {
    const touch = e.touches[0];
    const dx = touch.clientX - swipeTouchStartX.current;
    const dy = touch.clientY - swipeTouchStartY.current;

    // If drag is active, handle drag movement
    if (mobileDragActive.current) {
      e.preventDefault();
      handleMobileLongPressMove(touch);
      return;
    }

    // Cancel long-press if finger moved too far before timer fired
    if (mobileDragTimer.current) {
      const dragDist = Math.sqrt(
        Math.pow(touch.clientX - mobileDragTouchStartPos.current.x, 2) +
        Math.pow(touch.clientY - mobileDragTouchStartPos.current.y, 2)
      );
      if (dragDist > 10) {
        clearTimeout(mobileDragTimer.current);
        mobileDragTimer.current = null;
      }
    }

    // If touchstart was blocked (e.g. imported events), ignore swipe gestures
    if (swipedTaskId.current == null) return;

    // Swipe direction lock
    if (!swipeLocked.current) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx < 10 && absDy < 10) return;
      if (absDy > absDx) {
        swipeIsVertical.current = true;
        swipeLocked.current = true;
        return;
      }
      swipeLocked.current = true;
      swipeDirection.current = dx > 0 ? 'right' : 'left';
      // Show only the relevant swipe strip
      const parent = swipeTaskElement.current?.parentElement;
      if (parent) {
        const strip = parent.querySelector(`[data-swipe-strip="${swipeDirection.current}"]`);
        if (strip) strip.style.display = 'flex';
      }
    }

    if (swipeIsVertical.current) return;

    e.preventDefault();
    swipeCurrentOffset.current = dx;
    if (swipeTaskElement.current) {
      swipeTaskElement.current.style.transform = `translateX(${dx}px)`;
      swipeTaskElement.current.style.transition = 'none';
    }
  };

  const handleMobileTaskTouchEnd = (e, taskId, taskType) => {
    // Clear long-press timer
    if (mobileDragTimer.current) {
      clearTimeout(mobileDragTimer.current);
      mobileDragTimer.current = null;
    }

    // If drag was active, handle drag end
    if (mobileDragActive.current) {
      handleMobileLongPressEnd(e);
      return;
    }

    const offset = swipeCurrentOffset.current;
    const el = swipeTaskElement.current;

    // Helper to hide swipe strips
    const hideSwipeStrips = (element) => {
      const parent = element?.parentElement;
      if (parent) {
        parent.querySelectorAll('[data-swipe-strip]').forEach(strip => {
          strip.style.display = 'none';
        });
      }
    };

    // If touchstart was blocked (e.g. imported events), stale refs can cause false swipe actions — bail out
    if (swipedTaskId.current == null || swipedTaskId.current !== taskId) {
      if (el) { el.style.transform = ''; el.style.transition = ''; hideSwipeStrips(el); }
      swipeCurrentOffset.current = 0;
      swipedTaskId.current = null;
      return;
    }

    if (!el || swipeIsVertical.current || !swipeLocked.current) {
      // Reset
      if (el) {
        el.style.transform = '';
        el.style.transition = '';
        hideSwipeStrips(el);
      }
      swipeCurrentOffset.current = 0;
      swipedTaskId.current = null;
      return;
    }

    const elWidth = el.offsetWidth;
    const threshold = elWidth * 0.4;
    const isRecurring = typeof taskId === 'string' && taskId.startsWith('recurring-');
    const isRightSwipeBlocked = false;

    if (Math.abs(offset) > threshold && !isRightSwipeBlocked) {
      // Trigger action
      if (navigator.vibrate) navigator.vibrate(40);
      const direction = offset > 0 ? 'right' : 'left';
      // Animate off-screen
      el.style.transform = `translateX(${direction === 'right' ? elWidth : -elWidth}px)`;
      el.style.transition = 'transform 200ms ease-out';
      setTimeout(() => {
        if (direction === 'right') {
          if (taskType === 'timeline') {
            if (isRecurring) {
              // Recurring: trigger delete popup
              moveToRecycleBin(taskId);
            } else {
              moveToInbox(taskId);
            }
          } else if (taskType === 'allday') {
            if (isRecurring) {
              // Recurring: trigger delete popup
              moveToRecycleBin(taskId);
            } else {
              moveToInbox(taskId);
            }
          } else if (taskType === 'deadline') {
            // Clear deadline — moves back to regular inbox
            clearDeadline(taskId);
          } else if (taskType === 'inbox') {
            // Schedule: open edit modal as scheduled task
            const task = unscheduledTasks.find(t => t.id === taskId);
            if (task) {
              // Track which inbox task we're scheduling (removed on submit, restored on cancel)
              swipeSchedulingInboxTaskId.current = taskId;
              setMobileEditingTask(null);
              setNewTask({
                title: task.title,
                startTime: getNextQuarterHour(),
                duration: task.duration || 30,
                date: dateToString(selectedDate),
                isAllDay: false,
                color: task.color || colors[0].class,
                recurrence: null,
              });
              setShowAddTask(true);
            }
          }
        } else {
          // Left swipe = edit
          const isInbox = taskType === 'inbox' || taskType === 'deadline';
          const task = isInbox
            ? unscheduledTasks.find(t => t.id === taskId)
            : tasks.find(t => t.id === taskId) || (
                typeof taskId === 'string' && taskId.startsWith('recurring-')
                  ? expandedRecurringTasks.find(t => t.id === taskId)
                  : null
              );
          if (task && !task.imported) {
            openMobileEditTask(task, isInbox);
          }
        }
        // Reset element
        if (el) {
          el.style.transform = '';
          el.style.transition = '';
          hideSwipeStrips(el);
        }
      }, 200);
    } else {
      // Snap back
      el.style.transform = 'translateX(0)';
      el.style.transition = 'transform 200ms ease-out';
      setTimeout(() => {
        if (el) {
          el.style.transform = '';
          el.style.transition = '';
          hideSwipeStrips(el);
        }
      }, 200);
    }

    swipeCurrentOffset.current = 0;
    swipedTaskId.current = null;
  };

  // --- Mobile long-press drag handlers ---
  const updateMobileDragPreview = () => {
    if (!calendarRef.current || !mobileDragOriginalTask.current) return;
    const touch = mobileDragLastTouch.current;
    const calendarRect = calendarRef.current.getBoundingClientRect();
    const scrollTop = calendarRef.current.scrollTop;
    // Detect if finger is in the date header or all-day section (all-day zone)
    const headerBottom = mobileDateHeaderRef.current?.getBoundingClientRect().bottom ?? 0;
    const allDayBottom = mobileAllDaySectionRef.current?.getBoundingClientRect().bottom;
    const allDayZoneBottom = allDayBottom || headerBottom;
    if (touch.clientY < allDayZoneBottom) {
      setMobileDragPreviewTime('all-day');
      return;
    }
    // For all-day source tasks, use absolute position (finger = time)
    if (mobileDragSourceType.current === 'allday') {
      if (!timeGridRef.current) return;
      const headerHeight = timeGridRef.current.offsetTop;
      const y = Math.max(0, touch.clientY - calendarRect.top + scrollTop - headerHeight);
      const totalMinutes = positionToMinutes(y);
      const roundedMinutes = Math.round(totalMinutes / 15) * 15;
      const clampedMinutes = Math.max(0, Math.min(23 * 60 + 45, roundedMinutes));
      const hrs = Math.floor(clampedMinutes / 60);
      const mins = clampedMinutes % 60;
      setMobileDragPreviewTime(`${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`);
      return;
    }
    // For timeline source tasks, use delta-based computation (no jump)
    const currentY = touch.clientY - calendarRect.top + scrollTop;
    const startY = mobileDragTouchStartPos.current.y - calendarRect.top + mobileDragStartScrollTop.current;
    const deltaPixels = currentY - startY;
    const deltaMinutes = (deltaPixels / getHourHeight()) * 60;
    const originalMinutes = timeToMinutes(mobileDragOriginalTask.current.startTime);
    const newMinutes = originalMinutes + deltaMinutes;
    const roundedMinutes = Math.round(newMinutes / 15) * 15;
    const clampedMinutes = Math.max(0, Math.min(23 * 60 + 45, roundedMinutes));
    const hrs = Math.floor(clampedMinutes / 60);
    const mins = clampedMinutes % 60;
    const timeStr = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    setMobileDragPreviewTime(timeStr);
  };

  const handleMobileLongPressMove = (touch) => {
    if (!calendarRef.current) return;
    mobileDragLastTouch.current = { clientX: touch.clientX, clientY: touch.clientY };
    updateMobileDragPreview();

    // Auto-scroll near edges
    const allDayZoneBottom = mobileAllDaySectionRef.current?.getBoundingClientRect().bottom || mobileDateHeaderRef.current?.getBoundingClientRect().bottom || 0;
    const inAllDayZone = touch.clientY < allDayZoneBottom;
    const calendarRect = calendarRef.current.getBoundingClientRect();
    const scrollZoneSize = 60;
    // Measure scroll-up zone from below the sticky headers, not from calendar top
    const distFromTimeGridTop = touch.clientY - allDayZoneBottom;
    const distFromBottom = calendarRect.bottom - touch.clientY;

    let newDir = null;
    if (inAllDayZone) {
      // Don't auto-scroll while hovering over the all-day drop zone
    } else if (distFromTimeGridTop < scrollZoneSize && distFromTimeGridTop > 0) {
      newDir = 'up';
    } else if (distFromBottom < scrollZoneSize && distFromBottom > 0) {
      newDir = 'down';
    }

    if (newDir !== mobileDragScrollDir.current) {
      mobileDragScrollDir.current = newDir;
      if (mobileDragAutoScrollInterval.current) {
        clearInterval(mobileDragAutoScrollInterval.current);
        mobileDragAutoScrollInterval.current = null;
      }
      if (newDir) {
        const scrollSpeed = 8;
        mobileDragAutoScrollInterval.current = setInterval(() => {
          if (!calendarRef.current) return;
          const el = calendarRef.current;
          const maxScroll = el.scrollHeight - el.clientHeight;
          if (newDir === 'down' && el.scrollTop >= maxScroll) return;
          if (newDir === 'up' && el.scrollTop <= 0) return;
          el.scrollTop += (newDir === 'up' ? -scrollSpeed : scrollSpeed);
          updateMobileDragPreview();
        }, 16);
      }
    }
  };

  const handleMobileLongPressEnd = () => {
    if (mobileDragAutoScrollInterval.current) {
      clearInterval(mobileDragAutoScrollInterval.current);
      mobileDragAutoScrollInterval.current = null;
    }
    mobileDragScrollDir.current = null;
    // Re-enable scroll on timeline after drag
    if (calendarRef.current) calendarRef.current.style.overflowY = 'scroll';
    // Remove native touchmove prevention listener
    if (mobileDragPreventScrollRef.current) {
      document.removeEventListener('touchmove', mobileDragPreventScrollRef.current);
      mobileDragPreventScrollRef.current = null;
    }

    if (mobileDragActive.current && mobileDragPreviewTime && mobileDragOriginalTask.current) {
      const task = mobileDragOriginalTask.current;
      const droppingToAllDay = mobileDragPreviewTime === 'all-day';
      const newTime = droppingToAllDay ? '00:00' : mobileDragPreviewTime;
      const fromAllDay = mobileDragSourceType.current === 'allday';

      // Check for conflicts with imported calendar events and routines (same as desktop)
      let finalTime = newTime;
      let conflicted = false;
      let conflictingEvent = null;
      if (!droppingToAllDay && !task.isRoutineDrag) {
        const dropDateStr = dateToString(selectedDate);
        const result = getAdjustedTimeForImportedConflicts(
          task.id,
          newTime,
          task.duration || 30,
          dropDateStr
        );
        finalTime = result.adjustedStartTime;
        conflicted = result.conflicted;
        conflictingEvent = result.conflictingEvent;
      }

      // If dragging from all-day back to all-day, no change needed
      if (fromAllDay && droppingToAllDay) {
        // no-op
      } else if (task.isDeadlineDrag) {
        // Deadline task: move from unscheduled to scheduled
        pushUndo();
        setUnscheduledTasks(prev => prev.filter(t => t.id !== task.id));
        setTasks(prev => [...prev, {
          id: task.id,
          title: task.title,
          startTime: droppingToAllDay ? '00:00' : finalTime,
          duration: task.duration || 30,
          date: dateToString(selectedDate),
          isAllDay: droppingToAllDay,
          color: task.color || colors[0].class,
          notes: task.notes || '',
          subtasks: task.subtasks || [],
          completed: task.completed || false,
        }]);
      } else if (typeof task.id === 'string' && task.id.startsWith('recurring-')) {
        // Recurring task instances via exceptions
        const parsed = parseRecurringId(task.id);
        if (parsed) {
          pushUndo();
          setRecurringTasks(prev => prev.map(t => {
            if (t.id === parsed.templateId) {
              return {
                ...t,
                exceptions: {
                  ...t.exceptions,
                  [parsed.dateStr]: {
                    ...(t.exceptions?.[parsed.dateStr] || {}),
                    startTime: finalTime,
                    isAllDay: droppingToAllDay,
                    duration: task.duration,
                  }
                }
              };
            }
            return t;
          }));
        }
      } else if (task.isRoutineDrag) {
        // Routine chip: update time/all-day on todayRoutines
        if (droppingToAllDay) {
          setTodayRoutines(prev => prev.map(r => r.id === task.id ? { ...r, startTime: null, isAllDay: true } : r));
        } else {
          setTodayRoutines(prev => prev.map(r => r.id === task.id ? { ...r, startTime: newTime, isAllDay: false } : r));
        }
      } else {
        // Regular task: update time and isAllDay status
        pushUndo();
        setTasks(prev => prev.map(t => t.id === task.id ? {
          ...t,
          startTime: finalTime,
          isAllDay: droppingToAllDay,
        } : t));
      }
      // Show notification if task was rescheduled to avoid calendar conflict
      if (conflicted && conflictingEvent) {
        playUISound('error');
        setSyncNotification({
          type: 'info',
          title: 'Task Rescheduled',
          message: `Task moved to ${finalTime} to avoid conflict with "${conflictingEvent.title}"`
        });
      }
      if (!(fromAllDay && droppingToAllDay)) {
        playUISound(droppingToAllDay ? 'drop' : 'slide');
      }
    }

    mobileDragActive.current = false;
    mobileDragTaskId.current = null;
    mobileDragOriginalTask.current = null;
    mobileDragSourceType.current = null;
    setMobileDragPreviewTime(null);
    setMobileDragTaskIdState(null);
  };

  const updateDragAutoScroll = (e) => {
    if (!calendarRef.current) return;
    const calendarRect = calendarRef.current.getBoundingClientRect();
    // Account for sticky headers (date header + all-day section) when computing scroll-up zone
    const stickyHeight = stickyHeaderRef.current ? stickyHeaderRef.current.getBoundingClientRect().bottom - calendarRect.top : 0;
    const scrollZoneSize = 60;
    const scrollSpeed = 8;

    const cursorY = e.clientY;
    const effectiveTop = calendarRect.top + stickyHeight;
    const distanceFromTop = cursorY - effectiveTop;
    const distanceFromBottom = calendarRect.bottom - cursorY;

    if (autoScrollInterval.current) {
      clearInterval(autoScrollInterval.current);
      autoScrollInterval.current = null;
    }

    if (distanceFromTop < scrollZoneSize && distanceFromTop > 0 && calendarRef.current.scrollTop > 0) {
      autoScrollInterval.current = setInterval(() => {
        if (calendarRef.current) {
          calendarRef.current.scrollTop -= scrollSpeed;
        }
      }, 16);
    } else if (distanceFromBottom < scrollZoneSize && distanceFromBottom > 0) {
      autoScrollInterval.current = setInterval(() => {
        if (calendarRef.current) {
          const maxScroll = calendarRef.current.scrollHeight - calendarRef.current.clientHeight;
          if (calendarRef.current.scrollTop < maxScroll) {
            calendarRef.current.scrollTop += scrollSpeed;
          }
        }
      }, 16);
    }
  };

  const handleDragOver = (e, targetDate = null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Clear other drop indicators when back in timeline
    setDragOverAllDay(null);
    setDragOverInbox(false);
    setDragOverRecycleBin(false);

    // Show preview time while dragging
    if (draggedTask && calendarRef.current) {
      const time = getTimeFromCursorPosition(e, {
        maxMinutes: 24 * 60,
        taskDuration: draggedTask.duration
      });
      setDragPreviewTime(time);

      // Track which date column we're dragging over
      if (targetDate) {
        setDragPreviewDate(targetDate);
      }

      updateDragAutoScroll(e);
    }
  };

  const handleDragOverInbox = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Clear timeline preview when over inbox
    setDragPreviewTime(null);
    setDragOverAllDay(null);
    setDragOverRecycleBin(false);
    setDragOverInbox(true);
    // Clear auto-scroll when over inbox
    if (autoScrollInterval.current) {
      clearInterval(autoScrollInterval.current);
      autoScrollInterval.current = null;
    }
  };

  const handleDragOverRecycleBin = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Clear timeline preview when over recycle bin
    setDragPreviewTime(null);
    setDragOverAllDay(null);
    setDragOverInbox(false);
    setDragOverRecycleBin(true);
    // Clear auto-scroll when over recycle bin
    if (autoScrollInterval.current) {
      clearInterval(autoScrollInterval.current);
      autoScrollInterval.current = null;
    }
  };

  const handleDropOnCalendar = (e, targetDate = null) => {
    e.preventDefault();
    if (!draggedTask) return;

    // Routine chip drop — place on timeline (today only)
    if (dragSource === 'routine') {
      const dropDate = targetDate || dragPreviewDate || selectedDate;
      const dropDateStr = dateToString(dropDate);
      const todayStr = dateToString(new Date());
      if (dropDateStr !== todayStr) {
        setDraggedTask(null); setDragSource(null); setDragPreviewTime(null); setDragPreviewDate(null);
        return;
      }
      const startTime = getTimeFromCursorPosition(e, { maxMinutes: 24 * 60, taskDuration: draggedTask.duration });
      setTodayRoutines(prev => prev.map(r => r.id === draggedTask.id ? { ...r, startTime, isAllDay: false } : r));
      setDraggedTask(null); setDragSource(null); setDragPreviewTime(null); setDragPreviewDate(null);
      return;
    }

    const requestedStartTime = getTimeFromCursorPosition(e, {
      maxMinutes: 24 * 60,
      taskDuration: draggedTask.duration
    });

    // Use the target date from the column, falling back to dragPreviewDate or selectedDate
    const dropDate = targetDate || dragPreviewDate || selectedDate;
    const dropDateStr = dateToString(dropDate);

    // Check for conflicts with imported calendar events and adjust if needed
    const { conflicted, adjustedStartTime, conflictingEvent } = getAdjustedTimeForImportedConflicts(
      draggedTask.id,
      requestedStartTime,
      draggedTask.duration,
      dropDateStr
    );

    const startTime = adjustedStartTime;

    // Prevent drops that would create 4+ side-by-side tasks
    if (wouldExceedMaxColumns(draggedTask, startTime, dropDateStr)) {
      setDraggedTask(null);
      setDragSource(null);
      setDragPreviewTime(null);
      setDragPreviewDate(null);
      return;
    }

    pushUndo();
    if (dragSource === 'inbox') {
      setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
      const { priority, deadline, ...taskWithoutPriorityAndDeadline } = draggedTask;
      setTasks([...tasks, {
        ...taskWithoutPriorityAndDeadline,
        startTime,
        date: dropDateStr,
        isAllDay: false
      }]);
      // Track for onboarding
      if (!onboardingProgress.hasDraggedToTimeline) {
        setOnboardingProgress(prev => ({ ...prev, hasDraggedToTimeline: true }));
      }
    } else if (dragSource === 'calendar') {
      if (draggedTask.isRecurring) {
        const parsed = parseRecurringId(draggedTask.id);
        if (parsed) {
          const { templateId, dateStr: origDateStr } = parsed;
          if (origDateStr === dropDateStr) {
            // Same-date drag: store startTime override in exception
            setRecurringTasks(prev => prev.map(t => {
              if (t.id !== templateId) return t;
              return { ...t, exceptions: { ...t.exceptions, [origDateStr]: { ...t.exceptions?.[origDateStr], startTime } } };
            }));
          } else {
            // Cross-date drag: mark deleted on old date, create regular task on new date
            setRecurringTasks(prev => prev.map(t => {
              if (t.id !== templateId) return t;
              return { ...t, exceptions: { ...t.exceptions, [origDateStr]: { ...t.exceptions?.[origDateStr], deleted: true } } };
            }));
            const { id, isRecurring, recurringTemplateId, ...taskData } = draggedTask;
            setTasks([...tasks, { ...taskData, id: Date.now(), startTime, date: dropDateStr, isAllDay: false }]);
          }
        }
      } else {
        setTasks(tasks.map(t =>
          t.id === draggedTask.id
            ? { ...t, startTime, date: dropDateStr, isAllDay: false }
            : t
        ));
      }
    } else if (dragSource === 'recycleBin') {
      // Remove metadata and add to calendar
      const { _deletedFrom, ...cleanTask } = draggedTask;
      setRecycleBin(recycleBin.filter(t => t.id !== draggedTask.id));
      setTasks([...tasks, {
        ...cleanTask,
        startTime,
        date: dropDateStr,
        isAllDay: false
      }]);
    } else if (dragSource === 'overdue') {
      // Handle overdue tasks - they can be scheduled or deadline tasks
      if (draggedTask._overdueType === 'scheduled') {
        // Reschedule an existing scheduled task
        setTasks(tasks.map(t =>
          t.id === draggedTask.id
            ? { ...t, startTime, date: dropDateStr, isAllDay: false }
            : t
        ));
      } else if (draggedTask._overdueType === 'deadline') {
        // Schedule an overdue inbox task - remove from inbox, add to calendar
        setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
        const { priority, deadline, _overdueType, ...taskWithoutMeta } = draggedTask;
        setTasks([...tasks, {
          ...taskWithoutMeta,
          startTime,
          date: dropDateStr,
          isAllDay: false
        }]);
      }
    }

    // Show notification if task was rescheduled to avoid calendar conflict
    if (conflicted && conflictingEvent) {
      playUISound('error');
      setSyncNotification({
        type: 'info',
        title: 'Task Rescheduled',
        message: `Task moved to ${startTime} to avoid conflict with "${conflictingEvent.title}"`
      });
    }

    playUISound('drop');
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragPreviewDate(null);
  };

  const handleDropOnInbox = (e) => {
    e.preventDefault();
    if (!draggedTask) return;
    if (dragSource === 'routine') { setDraggedTask(null); setDragSource(null); setDragOverInbox(false); return; }

    // Only allow calendar, recycle bin, overdue scheduled tasks, and inbox tasks with deadlines to be moved to inbox
    if (dragSource !== 'calendar' && dragSource !== 'recycleBin' && dragSource !== 'overdue' && !(dragSource === 'inbox' && draggedTask.deadline)) return;

    pushUndo();
    if (dragSource === 'calendar') {
      if (draggedTask.isRecurring) {
        const parsed = parseRecurringId(draggedTask.id);
        if (parsed) {
          const { templateId, dateStr: origDateStr } = parsed;
          // Detach: mark deleted on original date, create regular inbox task
          setRecurringTasks(prev => prev.map(t => {
            if (t.id !== templateId) return t;
            return { ...t, exceptions: { ...t.exceptions, [origDateStr]: { ...t.exceptions?.[origDateStr], deleted: true } } };
          }));
          const { id, isRecurring, recurringTemplateId, startTime, date, ...taskData } = draggedTask;
          setUnscheduledTasks([...unscheduledTasks, { ...taskData, id: Date.now(), priority: taskData.priority || 0 }]);
        }
      } else {
        setTasks(tasks.filter(t => t.id !== draggedTask.id));
        const { startTime, date, ...taskWithoutSchedule } = draggedTask;
        setUnscheduledTasks([...unscheduledTasks, { ...taskWithoutSchedule, priority: taskWithoutSchedule.priority || 0 }]);
      }
    } else if (dragSource === 'recycleBin') {
      setRecycleBin(recycleBin.filter(t => t.id !== draggedTask.id));
      const { _deletedFrom, startTime, date, ...taskWithoutSchedule } = draggedTask;
      setUnscheduledTasks([...unscheduledTasks, { ...taskWithoutSchedule, priority: taskWithoutSchedule.priority || 0 }]);
    } else if (dragSource === 'overdue' && draggedTask._overdueType === 'scheduled') {
      // Move overdue scheduled task back to inbox
      setTasks(tasks.filter(t => t.id !== draggedTask.id));
      const { startTime, date, _overdueType, ...taskWithoutSchedule } = draggedTask;
      setUnscheduledTasks([...unscheduledTasks, { ...taskWithoutSchedule, priority: taskWithoutSchedule.priority || 0 }]);
    } else if (dragSource === 'overdue' && draggedTask._overdueType === 'deadline') {
      // Clear deadline from overdue inbox task to move it back to regular inbox view
      clearDeadline(draggedTask.id);
    } else if (dragSource === 'inbox' && draggedTask.deadline) {
      // Clear deadline from inbox task (moving from all-day section back to inbox)
      clearDeadline(draggedTask.id);
    }

    playUISound('slide');
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragOverInbox(false);
  };

  const handleDropOnRecycleBin = (e) => {
    e.preventDefault();
    if (!draggedTask) return;
    if (dragSource === 'routine') { setDraggedTask(null); setDragSource(null); setDragOverRecycleBin(false); return; }

    // Recurring tasks: delegate to existing moveToRecycleBin (shows 3-option delete dialog)
    if (draggedTask.isRecurring) {
      moveToRecycleBin(draggedTask.id);
      setDraggedTask(null);
      setDragSource(null);
      setDragPreviewTime(null);
      setDragOverRecycleBin(false);
      return;
    }

    pushUndo();
    // Determine source and clean up task metadata
    let deletedFrom = 'calendar';
    let cleanTask = { ...draggedTask };

    if (dragSource === 'inbox') {
      deletedFrom = 'inbox';
    } else if (dragSource === 'overdue') {
      if (draggedTask._overdueType === 'scheduled') {
        deletedFrom = 'calendar';
      } else {
        deletedFrom = 'inbox';
      }
      // Remove overdue metadata
      const { _overdueType, ...rest } = cleanTask;
      cleanTask = rest;
    }

    // Add to recycle bin with metadata about where it came from
    const taskWithMeta = {
      ...cleanTask,
      _deletedFrom: deletedFrom,
      deletedAt: new Date().toISOString()
    };
    setRecycleBin([...recycleBin, taskWithMeta]);

    // Remove from original location
    if (dragSource === 'inbox') {
      setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
    } else if (dragSource === 'calendar') {
      setTasks(tasks.filter(t => t.id !== draggedTask.id));
    } else if (dragSource === 'overdue') {
      if (draggedTask._overdueType === 'scheduled') {
        setTasks(tasks.filter(t => t.id !== draggedTask.id));
      } else {
        setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
      }
    }

    playUISound('swoosh');
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragOverRecycleBin(false);
  };

  const handleDropOnDateHeader = (e, targetDate) => {
    e.preventDefault();
    if (!draggedTask) return;

    // Routine chip drop — return to all-day (today only)
    if (dragSource === 'routine') {
      const dropDateStr = dateToString(targetDate);
      const todayStr = dateToString(new Date());
      if (dropDateStr !== todayStr) {
        setDraggedTask(null); setDragSource(null); setDragPreviewTime(null); setDragPreviewDate(null); setDragOverAllDay(null);
        return;
      }
      setTodayRoutines(prev => prev.map(r => r.id === draggedTask.id ? { ...r, startTime: null, isAllDay: true } : r));
      setDraggedTask(null); setDragSource(null); setDragPreviewTime(null); setDragPreviewDate(null); setDragOverAllDay(null);
      return;
    }

    const dropDateStr = dateToString(targetDate);

    pushUndo();
    if (dragSource === 'inbox') {
      setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
      const { priority, deadline, ...taskWithoutPriorityAndDeadline } = draggedTask;
      setTasks([...tasks, {
        ...taskWithoutPriorityAndDeadline,
        startTime: '00:00',
        date: dropDateStr,
        isAllDay: true
      }]);
    } else if (dragSource === 'calendar') {
      if (draggedTask.isRecurring) {
        const parsed = parseRecurringId(draggedTask.id);
        if (parsed) {
          const { templateId, dateStr: origDateStr } = parsed;
          // Detach: mark deleted on original date, create regular all-day task
          setRecurringTasks(prev => prev.map(t => {
            if (t.id !== templateId) return t;
            return { ...t, exceptions: { ...t.exceptions, [origDateStr]: { ...t.exceptions?.[origDateStr], deleted: true } } };
          }));
          const { id, isRecurring, recurringTemplateId, ...taskData } = draggedTask;
          setTasks([...tasks, { ...taskData, id: Date.now(), startTime: '00:00', date: dropDateStr, isAllDay: true }]);
        }
      } else {
        setTasks(tasks.map(t =>
          t.id === draggedTask.id
            ? { ...t, startTime: '00:00', date: dropDateStr, isAllDay: true }
            : t
        ));
      }
    } else if (dragSource === 'recycleBin') {
      const { _deletedFrom, ...cleanTask } = draggedTask;
      setRecycleBin(recycleBin.filter(t => t.id !== draggedTask.id));
      setTasks([...tasks, {
        ...cleanTask,
        startTime: '00:00',
        date: dropDateStr,
        isAllDay: true
      }]);
    } else if (dragSource === 'overdue') {
      // Handle overdue tasks - they can be scheduled or deadline tasks
      if (draggedTask._overdueType === 'scheduled') {
        // Reschedule an existing scheduled task to a new all-day slot
        setTasks(tasks.map(t =>
          t.id === draggedTask.id
            ? { ...t, startTime: '00:00', date: dropDateStr, isAllDay: true }
            : t
        ));
      } else if (draggedTask._overdueType === 'deadline') {
        // Schedule an overdue inbox task - remove from inbox, add to calendar
        setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
        const { priority, deadline, _overdueType, ...taskWithoutMeta } = draggedTask;
        setTasks([...tasks, {
          ...taskWithoutMeta,
          startTime: '00:00',
          date: dropDateStr,
          isAllDay: true
        }]);
      }
    }

    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragPreviewDate(null);
    setDragOverAllDay(null);
  };

  const handleResizeStart = (task, e) => {
    e.stopPropagation();
    e.preventDefault();
    pushUndo();
    setIsResizing(true);

    const startY = e.clientY;
    const startDuration = task.duration;

    const isRecurringTask = task.isRecurring;
    const recurringInfo = isRecurringTask ? parseRecurringId(task.id) : null;

    const handleMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const deltaMinutes = Math.round((deltaY / 80) * 60 / 15) * 15;
      const newDuration = Math.max(15, startDuration + deltaMinutes);

      if (isRecurringTask && recurringInfo) {
        const { templateId, dateStr } = recurringInfo;
        setRecurringTasks(prev => prev.map(t => {
          if (t.id !== templateId) return t;
          return { ...t, exceptions: { ...t.exceptions, [dateStr]: { ...t.exceptions?.[dateStr], duration: newDuration } } };
        }));
      } else {
        setTasks(prevTasks => prevTasks.map(t =>
          t.id === task.id ? { ...t, duration: newDuration } : t
        ));
      }
    };

    const handleMouseUp = () => {
      playUISound('tick');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const parseICS = (icsContent) => {
    // Unfold iCal line continuations (RFC 5545: lines starting with space/tab are continuations)
    const rawLines = icsContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const lines = [];
    for (const raw of rawLines) {
      if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
        lines[lines.length - 1] += raw.substring(1);
      } else {
        lines.push(raw.trim());
      }
    }
    const events = [];
    let currentEvent = null;
    let currentType = null; // 'event' or 'todo'

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line === 'BEGIN:VEVENT') {
        currentEvent = {};
        currentType = 'event';
      } else if (line === 'BEGIN:VTODO') {
        currentEvent = {};
        currentType = 'todo';
      } else if ((line === 'END:VEVENT' || line === 'END:VTODO') && currentEvent) {
        // For VTODOs, use DUE as dtstart if no DTSTART present
        if (currentType === 'todo' && !currentEvent.dtstart && currentEvent.due) {
          currentEvent.dtstart = currentEvent.due;
          currentEvent.isAllDay = currentEvent.dueIsAllDay;
        }
        if (currentEvent.summary && currentEvent.dtstart) {
          events.push(currentEvent);
        }
        currentEvent = null;
        currentType = null;
      } else if (currentEvent) {
        if (line.startsWith('SUMMARY')) {
          // Extract value after colon, handling parameters like SUMMARY;LANGUAGE=en:Text
          const colonIdx = line.indexOf(':');
          if (colonIdx !== -1) {
            // Unescape ICS escape sequences: \, -> , and \; -> ; and \\ -> \ and \n -> newline
            currentEvent.summary = line.substring(colonIdx + 1)
              .replace(/\\,/g, ',')
              .replace(/\\;/g, ';')
              .replace(/\\n/gi, '\n')
              .replace(/\\\\/g, '\\');
          }
        } else if (line.startsWith('DTSTART')) {
          // Detect all-day events (VALUE=DATE or 8-character date)
          if (line.includes('VALUE=DATE') || line.split(':')[1]?.length === 8) {
            currentEvent.isAllDay = true;
          }
          const dateStr = line.split(':')[1];
          currentEvent.dtstart = dateStr;
        } else if (line.startsWith('DTEND')) {
          const dateStr = line.split(':')[1];
          currentEvent.dtend = dateStr;
        } else if (line.startsWith('DUE')) {
          // Handle VTODO due dates
          if (line.includes('VALUE=DATE') || line.split(':')[1]?.length === 8) {
            currentEvent.dueIsAllDay = true;
          }
          const dateStr = line.split(':')[1];
          currentEvent.due = dateStr;
        } else if (line.startsWith('UID')) {
          const colonIdx = line.indexOf(':');
          if (colonIdx !== -1) {
            currentEvent.uid = line.substring(colonIdx + 1);
          }
        } else if (line.startsWith('RRULE:')) {
          currentEvent.rrule = line.substring(6);
        } else if (line.startsWith('EXDATE')) {
          const colonIdx = line.indexOf(':');
          if (colonIdx !== -1) {
            if (!currentEvent.exdates) currentEvent.exdates = [];
            currentEvent.exdates.push(line.substring(colonIdx + 1).substring(0, 8));
          }
        }
      }
    }

    // Expand events with RRULE into individual occurrences
    const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const curYear = new Date().getFullYear();
    const expandedEvents = [];

    for (const event of events) {
      if (!event.rrule) {
        expandedEvents.push(event);
        continue;
      }

      const rule = {};
      event.rrule.split(';').forEach(part => {
        const eq = part.indexOf('=');
        if (eq !== -1) rule[part.substring(0, eq)] = part.substring(eq + 1);
      });

      if (rule.FREQ !== 'YEARLY') {
        expandedEvents.push(event);
        continue;
      }

      const dtstr = event.dtstart;
      const sYear = parseInt(dtstr.substring(0, 4));
      const sMonth = parseInt(dtstr.substring(4, 6)) - 1;
      const sDay = parseInt(dtstr.substring(6, 8));
      const interval = parseInt(rule.INTERVAL || '1');
      const count = rule.COUNT ? parseInt(rule.COUNT) : null;
      const byMonth = rule.BYMONTH ? parseInt(rule.BYMONTH) - 1 : sMonth;
      const byDay = rule.BYDAY || null;
      const untilDate = rule.UNTIL ? new Date(
        parseInt(rule.UNTIL.substring(0, 4)),
        parseInt(rule.UNTIL.substring(4, 6)) - 1,
        parseInt(rule.UNTIL.substring(6, 8))
      ) : null;

      // Duration in days for all-day events
      let durDays = 1;
      if (event.dtend && event.isAllDay) {
        const s = new Date(sYear, sMonth, sDay);
        const e = new Date(parseInt(event.dtend.substring(0, 4)), parseInt(event.dtend.substring(4, 6)) - 1, parseInt(event.dtend.substring(6, 8)));
        durDays = Math.max(1, Math.round((e - s) / 86400000));
      }

      const maxYear = untilDate ? Math.min(untilDate.getFullYear(), curYear + 3) : curYear + 3;
      let occ = 0;

      for (let year = sYear; year <= maxYear; year += interval) {
        if (count && occ >= count) break;

        let occDate;
        if (byDay) {
          const m = byDay.match(/^(-?\d*)([A-Z]{2})$/);
          if (m && dayMap[m[2]] !== undefined) {
            const nth = m[1] ? parseInt(m[1]) : 1;
            const target = dayMap[m[2]];
            if (nth > 0) {
              const firstDow = new Date(year, byMonth, 1).getDay();
              occDate = new Date(year, byMonth, 1 + ((target - firstDow + 7) % 7) + (nth - 1) * 7);
            } else {
              const last = new Date(year, byMonth + 1, 0);
              occDate = new Date(year, byMonth, last.getDate() - ((last.getDay() - target + 7) % 7) + (nth + 1) * 7);
            }
          }
        } else {
          occDate = new Date(year, byMonth, sDay);
        }

        if (!occDate) continue;
        if (untilDate && occDate > untilDate) break;

        const occStr = fmt(occDate);
        if (event.exdates && event.exdates.includes(occStr)) continue;

        const newDtstart = event.isAllDay ? occStr : occStr + 'T' + dtstr.substring(9);
        let newDtend = event.dtend;
        if (event.dtend && event.isAllDay) {
          const endD = new Date(occDate);
          endD.setDate(endD.getDate() + durDays);
          newDtend = fmt(endD);
        }

        expandedEvents.push({
          ...event,
          dtstart: newDtstart,
          dtend: newDtend,
          rrule: undefined
        });
        occ++;
      }
    }

    return expandedEvents;
  };

  const parseDatetime = (dtstr) => {
    if (dtstr.length === 8) {
      return new Date(
        parseInt(dtstr.substr(0, 4)),
        parseInt(dtstr.substr(4, 2)) - 1,
        parseInt(dtstr.substr(6, 2))
      );
    } else if (dtstr.length >= 15) {
      return new Date(
        parseInt(dtstr.substr(0, 4)),
        parseInt(dtstr.substr(4, 2)) - 1,
        parseInt(dtstr.substr(6, 2)),
        parseInt(dtstr.substr(9, 2)),
        parseInt(dtstr.substr(11, 2))
      );
    }
    return new Date();
  };

  // Helper to expand multi-day events into separate tasks for each day
  const expandMultiDayEvent = (event, options = {}) => {
    const { asTaskCalendar = false, freshCompletedUids = new Set(), color: customColor, importSource = 'sync' } = options;
    const startDate = parseDatetime(event.dtstart);
    const endDate = event.dtend ? parseDatetime(event.dtend) : new Date(startDate.getTime() + 60 * 60 * 1000);
    const duration = Math.round((endDate - startDate) / (1000 * 60));

    const isAllDay = event.isAllDay ||
      (startDate.getHours() === 0 && startDate.getMinutes() === 0 && duration >= 1440);

    // Calculate number of days this event spans
    const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    // For all-day events, DTEND is exclusive (event on Jan 1-3 has DTEND of Jan 4)
    const dayCount = isAllDay
      ? Math.max(1, Math.round((endDateOnly - startDateOnly) / (1000 * 60 * 60 * 24)))
      : 1;

    const tasks = [];
    for (let i = 0; i < dayCount; i++) {
      const taskDate = new Date(startDateOnly);
      taskDate.setDate(taskDate.getDate() + i);

      const baseId = event.uid || `imported-${Date.now()}-${Math.random()}`;
      const dateStr = dateToString(taskDate);
      const taskId = dayCount > 1 ? `${baseId}-${dateStr}-day${i + 1}` : `${baseId}-${dateStr}`;

      // Add day indicator for multi-day events
      const titleSuffix = dayCount > 1 ? ` (Day ${i + 1}/${dayCount})` : '';

      tasks.push({
        id: taskId,
        icalUid: event.uid,
        title: event.summary + titleSuffix,
        startTime: `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`,
        duration: isAllDay ? 60 : (asTaskCalendar ? 15 : (duration > 0 ? duration : 60)),
        date: dateToString(taskDate),
        color: asTaskCalendar ? 'task-calendar' : (customColor || 'bg-gray-600'),
        completed: asTaskCalendar ? freshCompletedUids.has(event.uid) : false,
        imported: true,
        isTaskCalendar: asTaskCalendar,
        isAllDay: isAllDay,
        importSource: importSource
      });
    }

    return tasks;
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setPendingImportFile(file);
    setImportColor('bg-gray-600');
    setShowImportModal(true);
    e.target.value = '';
  };

  const processImportFile = (asTaskCalendar) => {
    if (!pendingImportFile) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const icsContent = event.target.result;
      const events = parseICS(icsContent);

      // Read fresh completedTaskUids from localStorage to avoid stale closure
      const freshCompletedUids = new Set(
        JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]')
      );

      const importedTasks = events.flatMap(event =>
        expandMultiDayEvent(event, { asTaskCalendar, freshCompletedUids, color: importColor, importSource: 'file' })
      );

      if (asTaskCalendar) {
        const kept = tasks.filter(t => !(t.isTaskCalendar && t.importSource === 'file'));
        setTasks([...kept, ...importedTasks]);
      } else {
        const kept = tasks.filter(t => !(t.imported && !t.isTaskCalendar && t.importSource === 'file'));
        setTasks([...kept, ...importedTasks]);
      }

      setPendingImportFile(null);
      setShowImportModal(false);

      const count = importedTasks.length;
      setSyncNotification({
        type: count > 0 ? 'success' : 'info',
        title: 'iCal Import',
        message: count > 0
          ? `Imported ${count} event${count !== 1 ? 's' : ''}`
          : 'No events found in the file'
      });
    };
    reader.readAsText(pendingImportFile);
  };

  // Export all app data as a JSON backup file
  const exportBackup = () => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        tasks: JSON.parse(localStorage.getItem('day-planner-tasks') || '[]'),
        unscheduledTasks: JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]'),
        recycleBin: JSON.parse(localStorage.getItem('day-planner-recycle-bin') || '[]'),
        darkMode: JSON.parse(localStorage.getItem('day-planner-darkmode') || 'false'),
        syncUrl: JSON.parse(localStorage.getItem('day-planner-sync-url') || 'null'),
        taskCalendarUrl: JSON.parse(localStorage.getItem('day-planner-task-calendar-url') || 'null'),
        completedTaskUids: JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]'),
        recurringTasks: JSON.parse(localStorage.getItem('day-planner-recurring-tasks') || '[]'),
        routineDefinitions: JSON.parse(localStorage.getItem('day-planner-routine-definitions') || '{}'),
        selectedTags: JSON.parse(localStorage.getItem('day-planner-selected-tags') || '[]'),
        minimizedSections: JSON.parse(localStorage.getItem('minimizedSections') || '{}'),
        cloudSyncConfig: JSON.parse(localStorage.getItem('day-planner-cloud-sync-config') || 'null'),
        reminderSettings: JSON.parse(localStorage.getItem('day-planner-reminder-settings') || 'null'),
        use24HourClock: JSON.parse(localStorage.getItem('day-planner-use-24h-clock') || 'false')
      }
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dayglance-backup-${dateToString(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Auto-backup: build payload (reuses buildSyncPayload data format)
  const buildAutoBackupPayload = () => ({
    type: 'auto-backup',
    version: 1,
    timestamp: new Date().toISOString(),
    data: {
      tasks: JSON.parse(localStorage.getItem('day-planner-tasks') || '[]'),
      unscheduledTasks: JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]'),
      recycleBin: JSON.parse(localStorage.getItem('day-planner-recycle-bin') || '[]'),
      darkMode: JSON.parse(localStorage.getItem('day-planner-darkmode') || 'false'),
      syncUrl: JSON.parse(localStorage.getItem('day-planner-sync-url') || 'null'),
      taskCalendarUrl: JSON.parse(localStorage.getItem('day-planner-task-calendar-url') || 'null'),
      completedTaskUids: JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]'),
      recurringTasks: JSON.parse(localStorage.getItem('day-planner-recurring-tasks') || '[]'),
      routineDefinitions: JSON.parse(localStorage.getItem('day-planner-routine-definitions') || '{}'),
      minimizedSections: JSON.parse(localStorage.getItem('minimizedSections') || '{}'),
      cloudSyncConfig: JSON.parse(localStorage.getItem('day-planner-cloud-sync-config') || 'null'),
      reminderSettings: JSON.parse(localStorage.getItem('day-planner-reminder-settings') || 'null')
    }
  });

  const performLocalBackup = async (frequency) => {
    try {
      setAutoBackupStatus(prev => ({ ...prev, local: { ...prev.local, status: 'backing-up' } }));
      const payload = buildAutoBackupPayload();
      await autoBackupDB.saveBackup(frequency, payload);
      await autoBackupDB.pruneBackups(frequency, AUTO_BACKUP_RETENTION[frequency]);
      const now = new Date().toISOString();
      localStorage.setItem('day-planner-auto-backup-local-last', now);
      setAutoBackupStatus(prev => ({ ...prev, local: { lastBackup: now, status: 'success' } }));
      setTimeout(() => setAutoBackupStatus(prev => ({
        ...prev, local: { ...prev.local, status: prev.local.status === 'success' ? 'idle' : prev.local.status }
      })), 3000);
    } catch (err) {
      console.error('Local auto-backup failed:', err);
      setAutoBackupStatus(prev => ({ ...prev, local: { ...prev.local, status: 'error' } }));
    }
  };

  const performRemoteBackup = async (frequency) => {
    if (autoBackupInProgressRef.current) return;
    autoBackupInProgressRef.current = true;
    try {
      setAutoBackupStatus(prev => ({ ...prev, remote: { ...prev.remote, status: 'backing-up' } }));
      const provider = autoBackupProviders[autoBackupConfig.remote.provider];
      if (!provider) throw new Error('No provider configured');
      const payload = buildAutoBackupPayload();
      await provider.uploadBackup(autoBackupConfig.remote, payload);
      // Prune remote backups
      const remoteFiles = await provider.listBackups(autoBackupConfig.remote);
      const maxKeep = AUTO_BACKUP_RETENTION[frequency];
      if (remoteFiles.length > maxKeep) {
        const toDelete = remoteFiles.slice(maxKeep);
        for (const f of toDelete) {
          await provider.deleteBackup(autoBackupConfig.remote, f.filename);
        }
      }
      const now = new Date().toISOString();
      localStorage.setItem('day-planner-auto-backup-remote-last', now);
      setAutoBackupStatus(prev => ({ ...prev, remote: { lastBackup: now, status: 'success' } }));
      setTimeout(() => setAutoBackupStatus(prev => ({
        ...prev, remote: { ...prev.remote, status: prev.remote.status === 'success' ? 'idle' : prev.remote.status }
      })), 3000);
    } catch (err) {
      console.error('Remote auto-backup failed:', err);
      setAutoBackupStatus(prev => ({ ...prev, remote: { ...prev.remote, status: 'error' } }));
    } finally {
      autoBackupInProgressRef.current = false;
    }
  };

  const restoreFromAutoBackup = async (backupId) => {
    try {
      const record = await autoBackupDB.getBackup(backupId);
      if (!record?.data?.data) throw new Error('Invalid backup record');
      applyRemoteData(record.data.data);
      window.location.reload();
    } catch (err) {
      alert('Failed to restore backup: ' + err.message);
    }
  };

  const restoreFromRemoteBackup = async (filename) => {
    try {
      const provider = autoBackupProviders[autoBackupConfig.remote.provider];
      if (!provider) throw new Error('No provider configured');
      const backup = await provider.downloadBackup(autoBackupConfig.remote, filename);
      if (!backup?.data) throw new Error('Invalid backup file');
      applyRemoteData(backup.data);
      window.location.reload();
    } catch (err) {
      alert('Failed to restore remote backup: ' + err.message);
    }
  };

  const loadAutoBackupHistory = async () => {
    try {
      const localBackups = await autoBackupDB.listBackups();
      let remoteBackups = [];
      if (autoBackupConfig.remote.enabled) {
        try {
          const provider = autoBackupProviders[autoBackupConfig.remote.provider];
          if (provider) remoteBackups = await provider.listBackups(autoBackupConfig.remote);
        } catch (err) {
          console.error('Failed to list remote backups:', err);
        }
      }
      setAutoBackupHistory({ local: localBackups, remote: remoteBackups });
    } catch (err) {
      console.error('Failed to load backup history:', err);
    }
  };

  const deleteLocalAutoBackup = async (id) => {
    await autoBackupDB.deleteBackup(id);
    setAutoBackupHistory(prev => ({ ...prev, local: prev.local.filter(b => b.id !== id) }));
  };

  const deleteRemoteAutoBackup = async (filename) => {
    const provider = autoBackupProviders[autoBackupConfig.remote.provider];
    if (provider) {
      await provider.deleteBackup(autoBackupConfig.remote, filename);
      setAutoBackupHistory(prev => ({ ...prev, remote: prev.remote.filter(b => b.filename !== filename) }));
    }
  };

  // Handle backup file selection
  const handleBackupFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPendingBackupFile(file);
    setShowBackupMenu(false);
    setShowRestoreConfirm(true);
    e.target.value = '';
  };

  // Restore data from backup file
  const restoreBackup = () => {
    if (!pendingBackupFile) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const backup = JSON.parse(e.target.result);

        // Validate structure
        if (!backup.data || !backup.version) {
          throw new Error('Invalid backup file format');
        }

        // Restore all data
        const { data } = backup;
        if (data.tasks) localStorage.setItem('day-planner-tasks', JSON.stringify(data.tasks));
        if (data.unscheduledTasks) localStorage.setItem('day-planner-unscheduled', JSON.stringify(data.unscheduledTasks));
        if (data.recycleBin) localStorage.setItem('day-planner-recycle-bin', JSON.stringify(data.recycleBin));
        if (data.darkMode !== undefined) localStorage.setItem('day-planner-darkmode', JSON.stringify(data.darkMode));
        if (data.syncUrl !== undefined) localStorage.setItem('day-planner-sync-url', JSON.stringify(data.syncUrl));
        if (data.taskCalendarUrl !== undefined) localStorage.setItem('day-planner-task-calendar-url', JSON.stringify(data.taskCalendarUrl));
        if (data.completedTaskUids) localStorage.setItem('day-planner-task-completed-uids', JSON.stringify(data.completedTaskUids));
        if (data.recurringTasks) localStorage.setItem('day-planner-recurring-tasks', JSON.stringify(data.recurringTasks));
        if (data.routineDefinitions) localStorage.setItem('day-planner-routine-definitions', JSON.stringify(data.routineDefinitions));
        if (data.selectedTags) localStorage.setItem('day-planner-selected-tags', JSON.stringify(data.selectedTags));
        if (data.minimizedSections) localStorage.setItem('minimizedSections', JSON.stringify(data.minimizedSections));
        if (data.cloudSyncConfig) localStorage.setItem('day-planner-cloud-sync-config', JSON.stringify(data.cloudSyncConfig));
        if (data.reminderSettings) localStorage.setItem('day-planner-reminder-settings', JSON.stringify(data.reminderSettings));
        if (data.use24HourClock !== undefined) localStorage.setItem('day-planner-use-24h-clock', JSON.stringify(data.use24HourClock));

        // Reload app to reflect changes
        window.location.reload();
      } catch (err) {
        alert('Failed to restore backup: ' + err.message);
        setPendingBackupFile(null);
        setShowRestoreConfirm(false);
      }
    };
    reader.readAsText(pendingBackupFile);
  };

  // Returns { success: boolean, count?: number, error?: string }
  const syncWithCalendar = async () => {
    if (!syncUrl) {
      return { success: false, error: 'no-url' };
    }

    try {
      // Use proxy to bypass CORS restrictions
      // Note: URL is not encoded because nginx's $arg_url doesn't auto-decode
      const proxyUrl = `/api/calendar-proxy/?url=${syncUrl}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Failed to fetch calendar');

      const icsContent = await response.text();
      const events = parseICS(icsContent);

      const importedTasks = events.flatMap(event =>
        expandMultiDayEvent(event, { asTaskCalendar: false })
      );

      // Remove old sync-sourced imported events (not task calendar) and add the fresh ones
      // Preserves file-imported events; uses functional form to avoid stale closures
      setTasks(prevTasks => {
        const kept = prevTasks.filter(t => !(t.imported && !t.isTaskCalendar && t.importSource !== 'file'));
        return [...kept, ...importedTasks];
      });
      return { success: true, count: importedTasks.length };
    } catch (error) {
      console.error('Sync error:', error);
      return { success: false, error: 'calendar' };
    }
  };

  // Returns { success: boolean, count?: number, error?: string }
  const syncTaskCalendar = async () => {
    if (!taskCalendarUrl) {
      return { success: false, error: 'no-url' };
    }

    try {
      const proxyUrl = `/api/calendar-proxy/?url=${taskCalendarUrl}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Failed to fetch task calendar');

      const icsContent = await response.text();
      const events = parseICS(icsContent);

      // Read fresh completedTaskUids from localStorage to avoid stale closure
      const freshCompletedUids = new Set(
        JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]')
      );

      const taskCalendarItems = events.flatMap(event =>
        expandMultiDayEvent(event, { asTaskCalendar: true, freshCompletedUids })
      );

      // Remove old sync-sourced task calendar items and add the fresh ones
      // Preserves file-imported task calendar items; uses functional form to avoid stale closures
      setTasks(prevTasks => {
        const kept = prevTasks.filter(t => !(t.isTaskCalendar && t.importSource !== 'file'));
        return [...kept, ...taskCalendarItems];
      });
      return { success: true, count: taskCalendarItems.length };
    } catch (error) {
      console.error('Task calendar sync error:', error);
      return { success: false, error: 'task-calendar' };
    }
  };

  // Combined sync function that shows a single notification
  const syncAll = async ({ silent = false } = {}) => {
    if (!syncUrl && !taskCalendarUrl) {
      if (!silent) setSyncNotification({ type: 'info', message: 'Please enter a calendar URL in sync settings' });
      return;
    }

    setIsSyncing(true);
    try {
      const [calendarResult, taskResult] = await Promise.all([
        syncWithCalendar(),
        syncTaskCalendar()
      ]);

      // Track status and last synced time
      const hasSuccess = calendarResult.success || taskResult.success;
      const hasError = (calendarResult.error === 'calendar') || (taskResult.error === 'task-calendar');

      if (hasSuccess) {
        const now = new Date().toISOString();
        setCalSyncLastSynced(now);
        localStorage.setItem('day-planner-cal-sync-last-synced', now);
      }
      setCalSyncStatus(hasError ? 'error' : hasSuccess ? 'success' : null);

      if (silent) return;

      // Build notification message
      const successes = [];
      const errors = [];

      if (calendarResult.success) {
        successes.push(`${calendarResult.count} event${calendarResult.count !== 1 ? 's' : ''}`);
      } else if (calendarResult.error === 'calendar') {
        errors.push('calendar');
      }

      if (taskResult.success) {
        successes.push(`${taskResult.count} task${taskResult.count !== 1 ? 's' : ''}`);
      } else if (taskResult.error === 'task-calendar') {
        errors.push('task calendar');
      }

      if (errors.length > 0 && successes.length === 0) {
        setSyncNotification({ type: 'error', message: `Failed to sync with ${errors.join(' and ')}. Make sure the URL is correct and publicly accessible.` });
      } else if (errors.length > 0) {
        setSyncNotification({ type: 'error', message: `Synced ${successes.join(' and ')}, but failed to sync ${errors.join(' and ')}` });
      } else if (successes.length > 0) {
        setSyncNotification({ type: 'success', message: `Synced ${successes.join(' and ')}` });
      }
    } finally {
      setIsSyncing(false);
    }
  };

  // Cloud sync functions
  const buildSyncPayload = () => ({
    version: 2,
    lastModified: new Date().toISOString(),
    data: {
      tasks: JSON.parse(localStorage.getItem('day-planner-tasks') || '[]'),
      unscheduledTasks: JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]'),
      recycleBin: JSON.parse(localStorage.getItem('day-planner-recycle-bin') || '[]'),
      syncUrl: JSON.parse(localStorage.getItem('day-planner-sync-url') || 'null'),
      taskCalendarUrl: JSON.parse(localStorage.getItem('day-planner-task-calendar-url') || 'null'),
      completedTaskUids: JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]'),
      recurringTasks: JSON.parse(localStorage.getItem('day-planner-recurring-tasks') || '[]'),
      routineDefinitions: JSON.parse(localStorage.getItem('day-planner-routine-definitions') || '{}'),
      todayRoutines: JSON.parse(localStorage.getItem('day-planner-today-routines') || '[]'),
      routinesDate: localStorage.getItem('day-planner-routines-date') || '',
      minimizedSections: JSON.parse(localStorage.getItem('minimizedSections') || '{}'),
      use24HourClock: JSON.parse(localStorage.getItem('day-planner-use-24h-clock') || 'false'),
      deletedTaskIds: JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}'),
      deletedRoutineChipIds: JSON.parse(localStorage.getItem('day-planner-deleted-routine-chip-ids') || '{}'),
      removedTodayRoutineIds: JSON.parse(localStorage.getItem('day-planner-removed-today-routine-ids') || '{}')
    }
  });

  const cloudSyncUpload = async () => {
    if (!cloudSyncConfig?.enabled || cloudSyncInProgressRef.current) return;
    const provider = cloudSyncProviders[cloudSyncConfig.provider];
    if (!provider) return;

    cloudSyncInProgressRef.current = true;
    const syncStart = Date.now();
    setCloudSyncStatus('uploading');
    setCloudSyncError(null);
    try {
      const payload = buildSyncPayload();
      await provider.upload(cloudSyncConfig, payload);
      const elapsed = Date.now() - syncStart;
      if (elapsed < 2000) await new Promise(r => setTimeout(r, 2000 - elapsed));
      const now = new Date().toISOString();
      setCloudSyncLastSynced(now);
      localStorage.setItem('day-planner-cloud-sync-last-synced', now);
      localStorage.setItem('day-planner-cloud-sync-local-modified', payload.lastModified);
      setCloudSyncStatus('success');
      setTimeout(() => setCloudSyncStatus((s) => s === 'success' ? 'idle' : s), 3000);
    } catch (err) {
      console.error('Cloud sync upload error:', err);
      setCloudSyncError(err.message);
      setCloudSyncStatus('error');
      setTimeout(() => setCloudSyncStatus((s) => s === 'error' ? 'idle' : s), 5000);
    } finally {
      cloudSyncInProgressRef.current = false;
    }
  };

  const applyRemoteData = (data) => {
    suppressCloudUploadRef.current = true;
    suppressTimestampRef.current = true;

    // Normalize task defaults so localStorage and React state are identical.
    // Without this, stampTaskTimestamps detects spurious differences (e.g.
    // missing notes/subtasks) and re-stamps lastModified, making stale local
    // tasks appear newer than actual remote changes during merge.
    const normalizeTasks = (tasks) => tasks.map(t => ({ ...t, notes: t.notes ?? '', subtasks: t.subtasks ?? [] }));
    const normalizedTasks = data.tasks ? normalizeTasks(data.tasks) : null;
    const normalizedUnsched = data.unscheduledTasks ? normalizeTasks(data.unscheduledTasks) : null;

    // Update localStorage
    if (normalizedTasks) localStorage.setItem('day-planner-tasks', JSON.stringify(normalizedTasks));
    if (normalizedUnsched) localStorage.setItem('day-planner-unscheduled', JSON.stringify(normalizedUnsched));
    if (data.recycleBin) localStorage.setItem('day-planner-recycle-bin', JSON.stringify(data.recycleBin));
    if (data.syncUrl !== undefined) localStorage.setItem('day-planner-sync-url', JSON.stringify(data.syncUrl));
    if (data.taskCalendarUrl !== undefined) localStorage.setItem('day-planner-task-calendar-url', JSON.stringify(data.taskCalendarUrl));
    if (data.completedTaskUids) localStorage.setItem('day-planner-task-completed-uids', JSON.stringify(data.completedTaskUids));
    if (data.recurringTasks) localStorage.setItem('day-planner-recurring-tasks', JSON.stringify(data.recurringTasks));
    if (data.routineDefinitions) localStorage.setItem('day-planner-routine-definitions', JSON.stringify(data.routineDefinitions));
    if (data.todayRoutines) localStorage.setItem('day-planner-today-routines', JSON.stringify(data.todayRoutines));
    if (data.routinesDate !== undefined) localStorage.setItem('day-planner-routines-date', data.routinesDate);
    // selectedTags and minimizedSections are per-device UI preferences — not synced to state
    if (data.minimizedSections) localStorage.setItem('minimizedSections', JSON.stringify(data.minimizedSections));
    if (data.use24HourClock !== undefined) localStorage.setItem('day-planner-use-24h-clock', JSON.stringify(data.use24HourClock));
    if (data.deletedTaskIds) localStorage.setItem('day-planner-deleted-task-ids', JSON.stringify(data.deletedTaskIds));
    if (data.deletedRoutineChipIds) localStorage.setItem('day-planner-deleted-routine-chip-ids', JSON.stringify(data.deletedRoutineChipIds));
    if (data.removedTodayRoutineIds) {
      localStorage.setItem('day-planner-removed-today-routine-ids', JSON.stringify(data.removedTodayRoutineIds));
      setRemovedTodayRoutineIds(data.removedTodayRoutineIds);
    }
    // darkMode, reminderSettings, and soundEnabled are device-specific — not synced

    // Update React state directly (avoid page reload)
    if (normalizedTasks) setTasks(normalizedTasks);
    if (normalizedUnsched) setUnscheduledTasks(normalizedUnsched);
    if (data.recycleBin) setRecycleBin(data.recycleBin);
    if (data.syncUrl !== undefined) setSyncUrl(data.syncUrl);
    if (data.taskCalendarUrl !== undefined) setTaskCalendarUrl(data.taskCalendarUrl);
    if (data.completedTaskUids) setCompletedTaskUids(new Set(data.completedTaskUids));
    if (data.recurringTasks) setRecurringTasks(data.recurringTasks);
    if (data.routineDefinitions) setRoutineDefinitions(data.routineDefinitions);
    if (data.todayRoutines) setTodayRoutines(data.todayRoutines);
    if (data.routinesDate !== undefined) setRoutinesDate(data.routinesDate);
    if (data.use24HourClock !== undefined) setUse24HourClock(data.use24HourClock);

    setTimeout(() => { suppressCloudUploadRef.current = false; suppressTimestampRef.current = false; }, 500);
  };

  const cloudSyncDownload = async () => {
    if (!cloudSyncConfig?.enabled) return;
    const provider = cloudSyncProviders[cloudSyncConfig.provider];
    if (!provider) return;

    if (cloudSyncInProgressRef.current) return;
    cloudSyncInProgressRef.current = true;
    const syncStart = Date.now();
    setCloudSyncStatus('downloading');
    setCloudSyncError(null);
    try {
      const remote = await provider.download(cloudSyncConfig);
      if (!remote) {
        // No remote file yet — do initial upload
        cloudSyncInProgressRef.current = false;
        await cloudSyncUpload();
        return;
      }

      const remoteModified = remote.lastModified;
      const hasNeverSynced = !localStorage.getItem('day-planner-cloud-sync-last-synced');

      if (hasNeverSynced && remoteModified) {
        // First sync on this device — ask user what to do
        // Keep inProgressRef locked so poll timer doesn't re-trigger
        setCloudSyncConflict({ remoteData: remote.data, remoteModified });
        setCloudSyncStatus('idle');
        // Don't release lock — conflict dialog handlers will release it
        return;
      }

      // Build local snapshot and merge with remote at the task level
      const localData = buildSyncPayload().data;
      const { data: mergedData, localChanged, remoteChanged } = mergeSyncData(localData, remote.data);

      if (localChanged) {
        applyRemoteData(mergedData);
        localStorage.setItem('day-planner-cloud-sync-local-modified', new Date().toISOString());
      }

      if (remoteChanged) {
        // Upload merged result so both sides converge
        cloudSyncInProgressRef.current = false;
        await cloudSyncUpload();
        // cloudSyncUpload sets its own success status
        return;
      }

      const elapsed = Date.now() - syncStart;
      if (elapsed < 2000) await new Promise(r => setTimeout(r, 2000 - elapsed));
      const now = new Date().toISOString();
      setCloudSyncLastSynced(now);
      localStorage.setItem('day-planner-cloud-sync-last-synced', now);
      setCloudSyncStatus('success');
      setTimeout(() => setCloudSyncStatus((s) => s === 'success' ? 'idle' : s), 3000);
    } catch (err) {
      console.error('Cloud sync download error:', err);
      setCloudSyncError(err.message);
      setCloudSyncStatus('error');
      setTimeout(() => setCloudSyncStatus((s) => s === 'error' ? 'idle' : s), 5000);
    } finally {
      cloudSyncInProgressRef.current = false;
      cloudSyncInitialDoneRef.current = true;
    }
  };

  // Keep ref updated so visibilitychange handler can call latest version
  cloudSyncDownloadRef.current = cloudSyncDownload;

  const cloudSyncTest = async (config) => {
    const provider = cloudSyncProviders[config.provider];
    if (!provider) return { success: false, error: 'Unknown provider' };
    try {
      return await provider.test(config);
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  // Deadline picker popover for inbox tasks
  const DeadlinePickerPopover = ({ taskId, currentDeadline, onClose }) => {
    const [showCalendar, setShowCalendar] = useState(false);
    const [calendarPos, setCalendarPos] = useState({ x: 0, y: 0 });
    const [openAbove, setOpenAbove] = useState(false);
    const popoverRef = useRef(null);
    const [viewDate, setViewDate] = useState(() => {
      if (currentDeadline) {
        const parts = currentDeadline.split('-');
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
      }
      return new Date();
    });

    useLayoutEffect(() => {
      if (popoverRef.current && !showCalendar) {
        const rect = popoverRef.current.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        setOpenAbove(rect.bottom > viewportHeight - 80);
      }
    }, [showCalendar]);

    useEffect(() => {
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (showCalendar) {
            setShowCalendar(false);
          } else {
            onClose();
          }
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [showCalendar, onClose]);

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const todayStr = dateToString(today);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = dateToString(tomorrow);

    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStr = dateToString(nextWeek);

    const handleQuickOption = (dateStr) => {
      setDeadline(taskId, dateStr);
    };

    const getDaysInMonth = () => {
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay.getDate();
      const startingDayOfWeek = firstDay.getDay();

      const days = [];
      for (let i = 0; i < startingDayOfWeek; i++) {
        days.push(null);
      }
      for (let i = 1; i <= daysInMonth; i++) {
        days.push(new Date(year, month, i));
      }
      return days;
    };

    const changeMonth = (delta) => {
      setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1));
    };

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    if (showCalendar) {
      const days = getDaysInMonth();
      const calWidth = 260;
      const calHeight = 340;
      const pad = 8;
      const clampedLeft = Math.max(pad, Math.min(calendarPos.x - calWidth / 2, window.innerWidth - calWidth - pad));
      const clampedTop = Math.max(pad, Math.min(calendarPos.y - 150, window.innerHeight - calHeight - pad));
      return (
        <div
            className="deadline-picker-container fixed z-[9999]"
            style={{ left: clampedLeft, top: clampedTop }}
          >
          <div
            className={`${cardBg} rounded-lg shadow-xl border ${borderClass} p-3 w-[260px]`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => changeMonth(-1)}
                className={`p-1 rounded ${hoverBg}`}
              >
                <ChevronLeft size={16} className={textSecondary} />
              </button>
              <span className={`text-sm font-semibold ${textPrimary}`}>
                {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
              </span>
              <button
                onClick={() => changeMonth(1)}
                className={`p-1 rounded ${hoverBg}`}
              >
                <ChevronRight size={16} className={textSecondary} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                <div key={i} className={`text-center text-xs font-semibold p-1 ${textSecondary}`}>
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {days.map((day, index) => {
                if (!day) {
                  return <div key={`empty-${index}`} className="p-1"></div>;
                }
                const dayStr = dateToString(day);
                const isSelected = dayStr === currentDeadline;
                const isToday = dayStr === todayStr;

                return (
                  <button
                    key={index}
                    onClick={() => {
                      setDeadline(taskId, dayStr);
                      onClose();
                    }}
                    className={`p-1 text-center text-sm rounded transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white font-bold'
                        : isToday
                          ? darkMode ? 'bg-blue-900 text-blue-200 font-semibold' : 'bg-blue-100 text-blue-900 font-semibold'
                          : darkMode
                            ? 'hover:bg-gray-700 text-gray-300'
                            : 'hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            <div className={`border-t ${borderClass} mt-2 pt-2 flex gap-2`}>
              <button
                onClick={() => setShowCalendar(false)}
                className={`flex-1 px-2 py-1 text-sm rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg}`}
              >
                Back
              </button>
              {currentDeadline && (
                <button
                  onClick={() => {
                    clearDeadline(taskId);
                    onClose();
                  }}
                  className="flex-1 px-2 py-1 text-sm rounded bg-red-600 text-white hover:bg-red-700"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div ref={popoverRef} className={`deadline-picker-container absolute ${openAbove ? 'bottom-full mb-1' : 'top-full mt-1'} right-0 z-30`}>
        <div
          className={`${cardBg} rounded-lg shadow-xl border ${borderClass} p-2 min-w-[160px]`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-1">
            <button
              onClick={() => handleQuickOption(todayStr)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
            >
              <Calendar size={14} />
              Today
            </button>
            <button
              onClick={() => handleQuickOption(tomorrowStr)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
            >
              <Calendar size={14} />
              Tomorrow
            </button>
            <button
              onClick={() => handleQuickOption(nextWeekStr)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
            >
              <Calendar size={14} />
              Next week
            </button>
            <div className={`border-t ${borderClass} my-1`}></div>
            <button
              onClick={(e) => {
                setCalendarPos({ x: e.clientX, y: e.clientY });
                setShowCalendar(true);
              }}
              className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
            >
              <Calendar size={14} />
              Pick date...
            </button>
            {currentDeadline && (
              <>
                <div className={`border-t ${borderClass} my-1`}></div>
                <button
                  onClick={() => clearDeadline(taskId)}
                  className={`w-full text-left px-3 py-2 rounded text-sm text-red-500 ${hoverBg} flex items-center gap-2`}
                >
                  <X size={14} />
                  Clear deadline
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const ClockTimePicker = ({ value, onChange, onClose }) => {
    const [selectedHour, setSelectedHour] = useState(parseInt(value.split(':')[0]));
    const [selectedMinute, setSelectedMinute] = useState(parseInt(value.split(':')[1]));
    const [isAM, setIsAM] = useState(parseInt(value.split(':')[0]) < 12);
    const [mode, setMode] = useState('hour');

    // Tablet-scaled sizes
    const clockSize = isTablet ? 320 : 240;
    const clockRadius = isTablet ? 130 : 100;
    const clockCenter = isTablet ? 160 : 120;
    const btnSize = isTablet ? 52 : 40;
    const btnHalf = btnSize / 2;

    const handleConfirm = () => {
      const timeStr = `${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`;
      onChange(timeStr);
      onClose();
    };

    const handleHourSelect = (hour24) => {
      setSelectedHour(hour24);
      setIsAM(hour24 < 12);
      setMode('minute');
    };

    const toggleAMPM = () => {
      const newIsAM = !isAM;
      setIsAM(newIsAM);
      if (newIsAM && selectedHour >= 12) {
        setSelectedHour(selectedHour - 12);
      } else if (!newIsAM && selectedHour < 12) {
        setSelectedHour(selectedHour + 12);
      }
    };

    const displayHour = use24HourClock
      ? selectedHour.toString().padStart(2, '0')
      : (selectedHour === 0 ? 12 : selectedHour > 12 ? selectedHour - 12 : selectedHour).toString();

    const renderClock = () => {
      const numbers = mode === 'hour'
        ? (use24HourClock ? Array.from({ length: 24 }, (_, i) => i) : Array.from({ length: 12 }, (_, i) => i + 1))
        : [0, 15, 30, 45];
      const radius = clockRadius;
      const centerX = clockCenter;
      const centerY = clockCenter;

      // For 12h mode: map display hour (1-12) to angle
      const getHourAngle = (num) => {
        if (use24HourClock) return num * 15 - 90;
        return num * 30 - 90; // 12 hours * 30 degrees each
      };

      const selectedAngle = mode === 'hour'
        ? (use24HourClock
          ? selectedHour * 15
          : ((selectedHour % 12 || 12) * 30))
        : selectedMinute * 6;

      return (
        <div className="relative" style={{ width: `${clockSize}px`, height: `${clockSize}px` }}>
          <svg width={clockSize} height={clockSize} className="absolute top-0 left-0">
            <circle cx={centerX} cy={centerY} r={radius} fill="none" stroke={darkMode ? '#374151' : '#e5e7eb'} strokeWidth="2" />

            {/* Selected time indicator */}
            <line
              x1={centerX}
              y1={centerY}
              x2={centerX + radius * Math.sin(selectedAngle * Math.PI / 180)}
              y2={centerY - radius * Math.cos(selectedAngle * Math.PI / 180)}
              stroke="#3b82f6"
              strokeWidth="2"
            />

            {/* Center dot */}
            <circle cx={centerX} cy={centerY} r="4" fill="#3b82f6" />
          </svg>

          {numbers.map((num) => {
            const angle = mode === 'hour' ? getHourAngle(num) : (num * 6 - 90);
            const x = centerX + radius * Math.cos(angle * Math.PI / 180);
            const y = centerY + radius * Math.sin(angle * Math.PI / 180);
            const isSelected = mode === 'hour'
              ? (use24HourClock ? num === selectedHour : num === (selectedHour % 12 || 12))
              : num === selectedMinute;

            return (
              <button
                key={num}
                onClick={() => {
                  if (mode === 'hour') {
                    if (use24HourClock) {
                      handleHourSelect(num);
                    } else {
                      // Convert 12h display to 24h internal
                      let hour24;
                      if (isAM) {
                        hour24 = num === 12 ? 0 : num;
                      } else {
                        hour24 = num === 12 ? 12 : num + 12;
                      }
                      handleHourSelect(hour24);
                    }
                  } else {
                    setSelectedMinute(num);
                  }
                }}
                className={`absolute rounded-full flex items-center justify-center transition-colors ${
                  isTablet ? 'text-base' : 'text-sm'
                } ${
                  isSelected
                    ? 'bg-blue-600 text-white'
                    : darkMode
                      ? 'hover:bg-gray-700 text-gray-300'
                      : 'hover:bg-gray-200 text-gray-700'
                }`}
                style={{
                  width: `${btnSize}px`,
                  height: `${btnSize}px`,
                  left: `${x - btnHalf}px`,
                  top: `${y - btnHalf}px`,
                }}
              >
                {mode === 'hour' ? num : num.toString().padStart(2, '0')}
              </button>
            );
          })}
        </div>
      );
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={onClose}>
        <div
          className={`${cardBg} rounded-lg shadow-xl ${isTablet ? 'p-8' : 'p-6'} ${borderClass} border`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className={`${isTablet ? 'text-xl' : 'text-lg'} font-semibold ${textPrimary}`}>Select Time</h3>
            <button onClick={onClose} className={`${isTablet ? 'p-2' : 'p-1'} rounded ${hoverBg}`}>
              <X size={isTablet ? 24 : 20} className={textSecondary} />
            </button>
          </div>

          <div className="flex justify-center mb-4">
            <div className="flex gap-2 items-center">
              <button
                onClick={() => setMode('hour')}
                className={`${isTablet ? 'text-4xl px-4 py-2' : 'text-3xl px-3 py-1'} font-bold rounded ${
                  mode === 'hour' ? 'bg-blue-600 text-white' : textSecondary
                }`}
              >
                {displayHour}
              </button>
              <span className={`${isTablet ? 'text-4xl' : 'text-3xl'} ${textPrimary}`}>:</span>
              <button
                onClick={() => setMode('minute')}
                className={`${isTablet ? 'text-4xl px-4 py-2' : 'text-3xl px-3 py-1'} font-bold rounded ${
                  mode === 'minute' ? 'bg-blue-600 text-white' : textSecondary
                }`}
              >
                {selectedMinute.toString().padStart(2, '0')}
              </button>
              {!use24HourClock && (
                <button
                  onClick={toggleAMPM}
                  className={`${isTablet ? 'text-xl px-3 py-2' : 'text-lg px-2 py-1'} font-bold rounded ml-1 ${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                >
                  {isAM ? 'AM' : 'PM'}
                </button>
              )}
            </div>
          </div>

          <div className="flex justify-center mb-4">
            {renderClock()}
          </div>

          <div className={`flex justify-end ${isTablet ? 'gap-3' : 'gap-2'}`}>
            <button
              onClick={onClose}
              className={`${isTablet ? 'px-6 py-3 text-base' : 'px-4 py-2'} rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg}`}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className={`${isTablet ? 'px-6 py-3 text-base' : 'px-4 py-2'} bg-blue-600 text-white rounded-lg hover:bg-blue-700`}
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    );
  };

  // FIX 2: Add missing DatePicker component
  const DatePicker = ({ value, onChange, onClose }) => {
    const [viewDate, setViewDate] = useState(() => {
      if (value) {
        const parts = value.split('-');
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
      }
      return new Date();
    });

    const getDaysInMonth = () => {
      const year = viewDate.getFullYear();
      const month = viewDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay.getDate();
      const startingDayOfWeek = firstDay.getDay();
      
      const days = [];
      // Add empty slots for days before the first of the month
      for (let i = 0; i < startingDayOfWeek; i++) {
        days.push(null);
      }
      // Add all days in the month
      for (let i = 1; i <= daysInMonth; i++) {
        days.push(new Date(year, month, i));
      }
      return days;
    };

    const changeMonth = (delta) => {
      setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1));
    };

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const days = getDaysInMonth();
    const today = dateToString(new Date());

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }} tabIndex={-1} ref={(el) => el && el.focus()}>
        <div
          className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => changeMonth(-1)}
              className={`p-2 rounded ${hoverBg}`}
            >
              <ChevronLeft size={20} className={textSecondary} />
            </button>
            <h3 className={`text-lg font-semibold ${textPrimary}`}>
              {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
            </h3>
            <button
              onClick={() => changeMonth(1)}
              className={`p-2 rounded ${hoverBg}`}
            >
              <ChevronRight size={20} className={textSecondary} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
              <div key={day} className={`text-center text-sm font-semibold p-2 ${textSecondary}`}>
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((day, index) => {
              if (!day) {
                return <div key={`empty-${index}`} className="p-2"></div>;
              }
              const dayStr = dateToString(day);
              const isSelected = dayStr === value;
              const isToday = dayStr === today;

              return (
                <button
                  key={index}
                  onClick={() => {
                    onChange(dayStr);
                    onClose();
                  }}
                  className={`p-2 text-center rounded-lg transition-colors ${
                    isSelected 
                      ? 'bg-blue-600 text-white font-bold' 
                      : isToday
                        ? darkMode ? 'bg-blue-900 text-blue-200 font-semibold' : 'bg-blue-100 text-blue-900 font-semibold'
                        : darkMode 
                          ? 'hover:bg-gray-700 text-gray-300' 
                          : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => {
                onChange(dateToString(new Date()));
                onClose();
              }}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Today
            </button>
            <button
              onClick={onClose}
              className={`flex-1 px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg}`}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  const todayTasks = tasks.filter(t => t.date === dateToString(selectedDate));

  // Extract all unique tags from calendar tasks that are affected by tag filtering
  // (excludes imported events since they bypass filtering, excludes completed tasks)
  const allTags = useMemo(() => {
    const tagSet = new Set();
    tasks.filter(t => !t.imported).forEach(task => {
      extractTags(task.title).forEach(tag => tagSet.add(tag));
    });
    recurringTasks.forEach(template => {
      extractTags(template.title).forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [tasks, recurringTasks]);

  // Getting Started checklist - uses persistent progress tracking
  const gettingStartedItems = useMemo(() => {
    return [
      { id: 'inbox', label: 'Add your first inbox task', completed: onboardingProgress.hasAddedInboxTask },
      { id: 'scheduled', label: 'Add your first scheduled task', completed: onboardingProgress.hasAddedScheduledTask },
      { id: 'drag', label: 'Drag a task to the timeline', completed: onboardingProgress.hasDraggedToTimeline },
      { id: 'deadline', label: 'Add a deadline to an inbox task', completed: onboardingProgress.hasAddedDeadline },
      { id: 'priority', label: 'Set a priority on an inbox task', completed: onboardingProgress.hasSetPriority },
      { id: 'notes', label: 'Add notes or subtasks to a task', completed: onboardingProgress.hasAddedNotes },
      { id: 'tags', label: 'Use #tags in a task title', completed: onboardingProgress.hasUsedTags },
      { id: 'actions', label: 'Use the action buttons on a task', completed: onboardingProgress.hasUsedActionButtons },
      { id: 'complete', label: 'Complete a task', completed: onboardingProgress.hasCompletedTask },
      { id: 'recurring', label: 'Create a recurring task', completed: onboardingProgress.hasCreatedRecurring },
      { id: 'routines', label: 'Set up a routine', completed: onboardingProgress.hasSetupRoutines },
      { id: 'focus', label: 'Try Focus Mode', completed: onboardingProgress.hasUsedFocusMode },
      { id: 'sync', label: 'Set up calendar sync', completed: onboardingProgress.hasSetupSync },
    ];
  }, [onboardingProgress]);

  const allGettingStartedComplete = gettingStartedItems.every(item => item.completed);

  // Check if user has zero real tasks (for showing onboarding)
  const hasZeroRealTasks = useMemo(() => {
    const realScheduledTasks = tasks.filter(t => !t.isExample && !t.imported);
    const realInboxTasks = unscheduledTasks.filter(t => !t.isExample);
    return realScheduledTasks.length === 0 && realInboxTasks.length === 0 && recurringTasks.filter(t => !t.isExample).length === 0;
  }, [tasks, unscheduledTasks, recurringTasks]);

  // Show onboarding when user has zero real tasks (and data is loaded, to prevent flash)
  const showOnboarding = dataLoaded && !onboardingComplete && hasZeroRealTasks;

  // Persist welcome dismissal only when user has real tasks
  useEffect(() => {
    if (!showWelcome && !hasZeroRealTasks) {
      localStorage.setItem('welcomeDismissed', 'true');
    }
  }, [showWelcome, hasZeroRealTasks]);

  // Show welcome only on initial load with zero tasks (not when zeroing out during session)
  useEffect(() => {
    if (dataLoaded && !hasCheckedInitialWelcome.current) {
      hasCheckedInitialWelcome.current = true;
      if (hasZeroRealTasks) {
        setShowWelcome(true);
        localStorage.removeItem('welcomeDismissed');
      } else {
        setShowWelcome(false);
      }
    }
  }, [dataLoaded, hasZeroRealTasks]);

  // Autocomplete dropdown component for tags, dates, and times
  const SuggestionAutocomplete = ({ suggestions, selectedIndex, onSelect }) => {
    if (suggestions.length === 0) return null;

    const getIcon = (type) => {
      switch (type) {
        case 'date': return <Calendar size={14} className="flex-shrink-0" />;
        case 'deadline': return <Calendar size={14} className="flex-shrink-0" />;
        case 'time': return <Clock size={14} className="flex-shrink-0" />;
        case 'duration': return <Clock size={14} className="flex-shrink-0" />;
        case 'priority': return <AlertCircle size={14} className="flex-shrink-0" />;
        default: return <Hash size={14} className="flex-shrink-0" />;
      }
    };

    return (
      <div className={`absolute top-full left-0 mt-1 ${cardBg} rounded-lg p-1 z-50 shadow-xl border ${borderClass} min-w-[160px] max-h-40 overflow-y-auto`}>
        {suggestions.map((suggestion, index) => (
          <button
            key={`${suggestion.type}-${suggestion.value}-${index}`}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(suggestion);
            }}
            onMouseDown={(e) => e.preventDefault()} // Prevent blur before click
            className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 ${
              index === selectedIndex
                ? 'bg-blue-500 text-white'
                : `${textPrimary} ${hoverBg}`
            }`}
          >
            {getIcon(suggestion.type)}
            <span className="truncate">{suggestion.display}</span>
          </button>
        ))}
      </div>
    );
  };

  // Compute array of visible dates based on selectedDate and visibleDays
  const visibleDates = useMemo(() => {
    return Array.from({ length: visibleDays }, (_, i) => {
      const date = new Date(selectedDate);
      date.setDate(date.getDate() + i);
      return date;
    });
  }, [selectedDate, visibleDays]);

  // Auto-select new tags when they appear
  useEffect(() => {
    const newTags = allTags.filter(tag => !selectedTags.includes(tag));
    if (newTags.length > 0) {
      setSelectedTags(prev => [...prev, ...newTags]);
    }
  }, [allTags]);

  // Filter tasks by selected tags (OR logic - show tasks matching ANY selected tag)
  // Untagged tasks are always shown — the filter only scopes tagged tasks
  const filterByTags = (taskList) => {
    return taskList.filter(task => {
      const taskTags = extractTags(task.title);
      // Imported events and untagged tasks always shown
      if (task.imported || taskTags.length === 0) return true;
      // If no tags are selected, hide tagged tasks
      if (selectedTags.length === 0) return false;
      // Show tagged tasks only if they match a selected tag
      return selectedTags.some(tag => taskTags.includes(tag));
    });
  };

  // Inbox tasks are not filtered by tags, only by priority
  // Deadline tasks stay in inbox (with calendar icon + deadline shown) AND appear
  // on the timeline all-day area on their deadline date for easy scheduling
  const todayStr = getTodayStr();
  const nonOverdueInboxTasks = unscheduledTasks;
  const filteredUnscheduledTasks = nonOverdueInboxTasks
    .filter(task => inboxPriorityFilter === 0 || (task.priority || 0) >= inboxPriorityFilter)
    .filter(task => !(task.completed && task.deadline)) // Completed deadline tasks are scheduled, not inbox
    .filter(task => !hideCompletedInbox || !task.completed)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const filteredTodayTasks = filterByTags(todayTasks);

  // Expand recurring task templates into virtual task instances for visible dates
  const expandedRecurringTasks = useMemo(() => {
    if (recurringTasks.length === 0) return [];
    const dateStrs = visibleDates.map(d => dateToString(d));
    const rangeStart = dateStrs[0];
    const rangeEnd = dateStrs[dateStrs.length - 1];
    const today = getTodayStr();
    const instances = [];
    for (const template of recurringTasks) {
      const occurrences = getOccurrencesInRange(template, rangeStart, rangeEnd);
      for (const dateStr of occurrences) {
        const completed = (template.completedDates || []).includes(dateStr);
        // Don't show past uncompleted recurring instances
        if (dateStr < today && !completed) continue;
        const exception = template.exceptions?.[dateStr];
        instances.push({
          id: `recurring-${template.id}-${dateStr}`,
          title: exception?.title ?? template.title,
          startTime: exception?.startTime ?? template.startTime,
          duration: exception?.duration ?? template.duration,
          color: exception?.color ?? template.color,
          completed,
          isAllDay: exception?.isAllDay ?? template.isAllDay ?? false,
          notes: template.notes || '',
          subtasks: template.subtasks || [],
          date: dateStr,
          isRecurring: true,
          recurringTemplateId: template.id,
          ...(template.isExample ? { isExample: true } : {}),
        });
      }
    }
    return instances;
  }, [recurringTasks, visibleDates]);

  // Reminder notification engine
  useEffect(() => {
    // Weekly review notification (independent of main reminder toggle)
    const wr = reminderSettings.weeklyReview;
    if (wr?.enabled) {
      const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
      const [wrH, wrM] = wr.time.split(':').map(Number);
      const wrMin = wrH * 60 + wrM;
      const endMin = 23 * 60 + 55; // 11:55 PM (before daily auto-refresh)
      if (currentTime.getDay() === wr.day && nowMin >= wrMin && nowMin < endMin) {
        // Compute ISO week string to prevent re-firing sound/notification
        const d = new Date(currentTime);
        d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
        const isoWeek = `${d.getFullYear()}-W${String(Math.ceil((((d - new Date(d.getFullYear(), 0, 4)) / 86400000) + 1) / 7)).padStart(2, '0')}`;
        // Show persistent reminder for the rest of the day (unless dismissed this week)
        if (weeklyReviewDismissedRef.current !== isoWeek) {
          setShowWeeklyReviewReminder(true);
        }
        // Play sound + browser notification only on initial fire
        if (lastWeeklyReviewFiredRef.current !== isoWeek) {
          lastWeeklyReviewFiredRef.current = isoWeek;
          localStorage.setItem('day-planner-weekly-review-fired', isoWeek);
          playUISound('reminder');
          if (reminderSettings.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              navigator.serviceWorker?.ready.then(reg => {
                reg.showNotification('dayGLANCE', {
                  body: 'Time for your weekly review!',
                  icon: '/icon-192.png',
                  tag: 'weekly-review',
                  actions: [
                    { action: 'open-weekly-review', title: 'Open Review' },
                    { action: 'dismiss', title: 'Dismiss' },
                  ],
                  data: { type: 'weekly-review' },
                });
              });
            } catch {}
          }
        }
      } else {
        setShowWeeklyReviewReminder(false);
      }
    } else {
      setShowWeeklyReviewReminder(false);
    }

    if (!reminderSettings.enabled) return;
    const todayStr = dateToString(currentTime);
    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();

    // Reset fired reminders at midnight
    if (lastReminderDateRef.current !== todayStr) {
      firedRemindersRef.current = new Set();
      lastReminderDateRef.current = todayStr;
    }

    // Gather all today's tasks
    const todayRegular = tasks.filter(t => t.date === todayStr);
    const todayRecurring = expandedRecurringTasks.filter(t => t.date === todayStr);
    const allTodayTasks = [...todayRegular, ...todayRecurring];

    const newReminders = [];
    for (const task of allTodayTasks) {
      if (task.completed) continue;
      const category = getTaskCategory(task);
      const catSettings = reminderSettings.categories[category];
      if (!catSettings) continue;
      const points = getReminderPoints(task, catSettings, reminderSettings.morningReminderTime);
      for (const point of points) {
        if (firedRemindersRef.current.has(point.key)) continue;
        // Fire if current time is within a 2-minute window of the trigger
        if (nowMin >= point.triggerMin && nowMin < point.triggerMin + 2) {
          firedRemindersRef.current.add(point.key);
          const messageMap = {
            before15: 'Starts in 15 minutes',
            before10: 'Starts in 10 minutes',
            before5: 'Starts in 5 minutes',
            start: 'Starting now',
            end: 'Ending now',
            morning: 'All-day task reminder',
          };
          newReminders.push({
            id: `${point.key}-${Date.now()}`,
            taskId: task.id,
            taskTitle: task.title,
            taskColor: task.color,
            startTime: task.startTime || null,
            message: messageMap[point.type] || 'Reminder',
            type: point.type,
            isCalendarEvent: task.imported && !task.isTaskCalendar,
            firedAt: Date.now(),
          });
        }
      }
    }

    if (newReminders.length > 0) {
      playUISound('reminder');
      if (reminderSettings.inAppToasts !== false) {
        const newTaskIds = new Set(newReminders.map(r => r.taskId));
        setActiveReminders(prev => [...prev.filter(r => !newTaskIds.has(r.taskId)), ...newReminders]);
      }
      if (reminderSettings.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        navigator.serviceWorker?.ready.then(reg => {
          for (const r of newReminders) {
            const actions = [];
            if (r.type === 'end' && !r.isCalendarEvent) {
              actions.push({ action: 'complete', title: 'Complete' });
            }
            if (r.type !== 'end' && r.type !== 'morning' && r.startTime) {
              actions.push({ action: 'snooze', title: 'Snooze 15m' });
            }
            actions.push({ action: 'dismiss', title: 'Dismiss' });
            try {
              reg.showNotification(r.taskTitle, {
                body: r.message,
                icon: '/icon-192.png',
                tag: r.id,
                actions,
                data: r,
              });
            } catch {}
          }
        });
      }
    }
  }, [currentTime, reminderSettings, tasks, expandedRecurringTasks]);

  // Auto-dismiss reminders based on type
  useEffect(() => {
    if (activeReminders.length === 0) return;
    const dismissMs = { before15: 870000, before10: 570000, before5: 270000, start: 600000, end: 300000 };
    const timer = setInterval(() => {
      const now = Date.now();
      setActiveReminders(prev => prev.filter(r => {
        const ttl = dismissMs[r.type];
        if (!ttl) return true; // morning (all-day) — keep until manually dismissed
        return now - r.firedAt < ttl;
      }));
    }, 30000);
    return () => clearInterval(timer);
  }, [activeReminders.length > 0]);

  // Keep SW message handler refs up to date (avoids stale closures)
  swMessageHandlersRef.current = { toggleComplete, snoozeReminder, dismissReminder, setShowWeeklyReview };

  // Process a notification action message (shared by postMessage and IndexedDB queue)
  const processNotificationAction = (msg) => {
    if (!msg || msg.type !== 'notification-action') return;
    const { action, data } = msg;
    const handlers = swMessageHandlersRef.current;
    if (action === 'open-weekly-review') {
      handlers.setShowWeeklyReview(true);
    } else if (action === 'complete' && data?.taskId) {
      handlers.toggleComplete(data.taskId);
      handlers.dismissReminder(data.id);
    } else if (action === 'snooze' && data) {
      handlers.snoozeReminder(data);
    } else if (action === 'dismiss' && data?.id) {
      handlers.dismissReminder(data.id);
    }
  };

  // Drain any queued notification actions from IndexedDB (fallback for mobile)
  const drainNotificationActionQueue = async (processItems = true) => {
    try {
      const req = indexedDB.open('dayglance-sw', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('actions', { autoIncrement: true });
      const db = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = reject; });
      const tx = db.transaction('actions', 'readwrite');
      const store = tx.objectStore('actions');
      if (processItems) {
        const all = await new Promise((resolve, reject) => { const r = store.getAll(); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
        if (all.length > 0) {
          for (const msg of all) processNotificationAction(msg);
        }
      }
      store.clear();
      db.close();
    } catch (e) {
      // IndexedDB not available or empty — no-op
    }
  };

  drainNotificationQueueRef.current = drainNotificationActionQueue;

  // Listen for service worker notification action messages
  // When postMessage arrives, process it and clear the IndexedDB queue to prevent double-processing
  useEffect(() => {
    if (!navigator.serviceWorker) return;
    const handler = (event) => {
      processNotificationAction(event.data);
      // Clear queue without re-processing (postMessage already handled the action)
      drainNotificationQueueRef.current?.(false).catch(() => {});
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, []);

  // Spotlight search results
  const spotlightResults = useMemo(() => {
    if (!showSpotlight || !spotlightQuery.trim()) return [];
    const q = spotlightQuery.trim().toLowerCase();
    const results = [];
    const now = new Date();
    const cutoff = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
    const cutoffStr = dateToString(cutoff);

    const matchTask = (task, source, sourceLabel, date) => {
      // Skip scheduled tasks older than 2 years
      if (date && date < cutoffStr) return;
      // Check title
      if (task.title.toLowerCase().includes(q)) {
        results.push({ task, source, sourceLabel, match: { field: 'title', text: task.title }, date });
        return;
      }
      // Check tags
      const tags = extractTags(task.title);
      const matchedTag = tags.find(t => t.toLowerCase().includes(q));
      if (matchedTag) {
        results.push({ task, source, sourceLabel, match: { field: 'tag', text: '#' + matchedTag }, date });
        return;
      }
      // Check notes
      if (task.notes && task.notes.toLowerCase().includes(q)) {
        results.push({ task, source, sourceLabel, match: { field: 'notes', text: task.notes }, date });
        return;
      }
      // Check subtasks
      const matchedSub = (task.subtasks || []).find(s => s.title.toLowerCase().includes(q));
      if (matchedSub) {
        results.push({ task, source, sourceLabel, match: { field: 'subtask', text: matchedSub.title }, date });
      }
    };

    // Scheduled tasks
    for (const task of tasks) {
      matchTask(task, 'scheduled', 'Scheduled', task.date);
    }
    // Inbox tasks
    for (const task of unscheduledTasks) {
      matchTask(task, 'inbox', 'Inbox', task.deadline || null);
    }
    // Recurring templates
    for (const template of recurringTasks) {
      matchTask(template, 'recurring', 'Recurring', template.startDate || null);
    }
    // Recycle bin
    for (const task of recycleBin) {
      matchTask(task, 'deleted', 'Deleted', task.date || null);
    }

    // Sort: title matches first, then source priority, then date
    const sourcePriority = { scheduled: 0, inbox: 1, recurring: 2, deleted: 3 };
    results.sort((a, b) => {
      const aTitle = a.match.field === 'title' ? 0 : 1;
      const bTitle = b.match.field === 'title' ? 0 : 1;
      if (aTitle !== bTitle) return aTitle - bTitle;
      const aPri = sourcePriority[a.source] ?? 4;
      const bPri = sourcePriority[b.source] ?? 4;
      if (aPri !== bPri) return aPri - bPri;
      return (b.date || '').localeCompare(a.date || '');
    });

    return results.slice(0, 50);
  }, [showSpotlight, spotlightQuery, tasks, unscheduledTasks, recurringTasks, recycleBin]);

  // Compute today's agenda for dayGLANCE section (excludes past events)
  const todayAgenda = useMemo(() => {
    const today = getTodayStr();
    const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

    // Include recurring instances for today
    const todayRecurring = expandedRecurringTasks.filter(t => t.date === today);
    const allTodayTasks = [...tasks, ...todayRecurring];

    const allDay = allTodayTasks.filter(t => t.date === today && t.isAllDay && !t.completed);
    const deadlines = unscheduledTasks.filter(t => t.deadline === today && t.deadline >= today && !t.completed);
    const scheduled = allTodayTasks.filter(t => {
      if (t.date !== today || t.isAllDay) return false;
      const [h, m] = (t.startTime || '0:0').split(':').map(Number);
      const endMinutes = h * 60 + m + (t.duration || 0);
      // Past: hide completed tasks and imported calendar events; keep incomplete user/task-calendar tasks
      if (endMinutes <= nowMinutes) return !t.completed && !(t.imported && !t.isTaskCalendar);
      return true;
    }).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    return [
      ...deadlines.map(t => ({ ...t, _agendaType: 'deadline' })),
      ...allDay.map(t => ({ ...t, _agendaType: 'allday' })),
      ...scheduled.map(t => ({ ...t, _agendaType: 'scheduled' })),
    ].filter(t => !t.isExample);
  }, [tasks, unscheduledTasks, currentTime, expandedRecurringTasks]);

  // Compute "now" marker position and inbox gap nudge for DayGlance agenda
  const agendaNowMarker = useMemo(() => {
    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
    const nowH = String(currentTime.getHours()).padStart(2, '0');
    const nowM = String(currentTime.getMinutes()).padStart(2, '0');
    const nowTimeStr = `${nowH}:${nowM}`;
    // Only consider scheduled (timed) tasks, sorted by start time
    const scheduled = todayAgenda.filter(t => t._agendaType === 'scheduled');
    // Find where "now" falls among scheduled tasks
    // insertAfterIndex: index in todayAgenda after which to insert the marker (-1 = before all)
    let insertAfterIndex = -1;
    let insideTask = false;
    if (scheduled.length > 0) {
      for (let i = 0; i < todayAgenda.length; i++) {
        const t = todayAgenda[i];
        if (t._agendaType !== 'scheduled') continue;
        const [h, m] = (t.startTime || '0:0').split(':').map(Number);
        const endMin = h * 60 + m + (t.duration || 0);
        if (nowMin >= endMin) {
          insertAfterIndex = i;
        } else if (nowMin >= h * 60 + m) {
          // Currently within this task — place marker before it (it shows "In Progress")
          insertAfterIndex = i - 1;
          insideTask = true;
          break;
        } else {
          break;
        }
      }
    }
    // Ensure the now-marker never appears above all-day or deadline tasks
    const lastNonScheduledIdx = todayAgenda.reduce((acc, t, i) => t._agendaType !== 'scheduled' ? i : acc, -1);
    if (insertAfterIndex < lastNonScheduledIdx) {
      insertAfterIndex = lastNonScheduledIdx;
    }
    // If no scheduled tasks, place marker after all items
    if (scheduled.length === 0) {
      insertAfterIndex = todayAgenda.length - 1;
    }
    // Calculate gap to next scheduled task
    let gapMinutes = 0;
    const nextScheduledIdx = todayAgenda.findIndex((t, i) => i > insertAfterIndex && t._agendaType === 'scheduled');
    if (nextScheduledIdx !== -1) {
      const next = todayAgenda[nextScheduledIdx];
      const [nh, nm] = (next.startTime || '0:0').split(':').map(Number);
      gapMinutes = (nh * 60 + nm) - nowMin;
    } else {
      // No more scheduled tasks — gap is rest of day (cap at a large number)
      gapMinutes = 24 * 60 - nowMin;
    }
    const incompleteInbox = unscheduledTasks.filter(t => !t.completed && !t.isExample);
    const showNudge = gapMinutes >= 60 && incompleteInbox.length > 0;
    return { insertAfterIndex, nowTimeStr, showNudge, inboxCount: incompleteInbox.length, gapMinutes, insideTask };
  }, [todayAgenda, currentTime, unscheduledTasks]);

  // Helper to get tasks for a specific date (must be after filterByTags)
  const getTasksForDate = (date) => {
    const dateStr = dateToString(date);
    const recurring = expandedRecurringTasks.filter(t => t.date === dateStr);
    return filterByTags([...tasks.filter(t => t.date === dateStr), ...recurring]);
  };

  // Focus mode availability: current task or back-to-back block >= 45 min remaining
  const focusModeAvailable = useMemo(() => {
    const now = currentTime;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayDateStr = dateToString(now);
    const todayTasks = getTasksForDate(now);

    // Get all non-completed timeline tasks happening now or in the future, sorted by start
    const timelineTasks = todayTasks
      .filter(t => !t.isAllDay && !t.completed && t.startTime)
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    // Find contiguous block that includes the current time
    // First, find tasks currently in progress
    const inProgress = timelineTasks.filter(t => {
      const start = timeToMinutes(t.startTime);
      const end = start + t.duration;
      return start <= nowMin && end > nowMin;
    });

    if (inProgress.length === 0) return false;

    // Find the earliest start and then extend forward through back-to-back tasks
    let blockStart = Math.min(...inProgress.map(t => timeToMinutes(t.startTime)));
    let blockEnd = Math.max(...inProgress.map(t => timeToMinutes(t.startTime) + t.duration));

    // Extend block forward with back-to-back or overlapping tasks
    let extended = true;
    while (extended) {
      extended = false;
      for (const t of timelineTasks) {
        const tStart = timeToMinutes(t.startTime);
        const tEnd = tStart + t.duration;
        if (tStart <= blockEnd && tEnd > blockEnd) {
          blockEnd = tEnd;
          extended = true;
        }
      }
    }

    const remainingMinutes = blockEnd - nowMin;
    return remainingMinutes >= 45;
  }, [currentTime, tasks, expandedRecurringTasks]);
  focusModeAvailableRef.current = focusModeAvailable;

  // Focus mode: compute the current block tasks (used to snapshot when entering focus mode)
  const computeFocusBlockTasks = () => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayTasks = getTasksForDate(now);

    const timelineTasks = todayTasks
      .filter(t => !t.isAllDay && !t.completed && t.startTime)
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    const inProgress = timelineTasks.filter(t => {
      const start = timeToMinutes(t.startTime);
      const end = start + t.duration;
      return start <= nowMin && end > nowMin;
    });

    if (inProgress.length === 0) return [];

    let blockEnd = Math.max(...inProgress.map(t => timeToMinutes(t.startTime) + t.duration));

    let extended = true;
    while (extended) {
      extended = false;
      for (const t of timelineTasks) {
        const tStart = timeToMinutes(t.startTime);
        const tEnd = tStart + t.duration;
        if (tStart <= blockEnd && tEnd > blockEnd) {
          blockEnd = tEnd;
          extended = true;
        }
      }
    }

    const blockStart = Math.min(...inProgress.map(t => timeToMinutes(t.startTime)));
    return timelineTasks.filter(t => {
      const tStart = timeToMinutes(t.startTime);
      const tEnd = tStart + t.duration;
      return tStart < blockEnd && tEnd > blockStart;
    });
  };

  // Calculate all-time stats (excluding imported events, including recurring)
  // Inbox tasks with deadlines are treated as "scheduled" since they appear on the timeline
  // Only count tasks up through today — future tasks aren't "incomplete" yet
  const nonImportedTasks = tasks.filter(t => !t.imported && t.date <= todayStr);
  const allCompletedTasks = nonImportedTasks.filter(t => t.completed);
  const deadlineInboxTasks = unscheduledTasks.filter(t => t.deadline && t.deadline <= todayStr);
  const deadlineInboxCompleted = deadlineInboxTasks.filter(t => t.completed);
  const recurringAllTimeStats = recurringTasks.reduce((acc, t) => {
    const occs = getOccurrencesInRange(t, t.recurrence?.startDate || todayStr, todayStr);
    const completedSet = new Set(t.completedDates || []);
    const completed = occs.filter(d => completedSet.has(d)).length;
    return {
      scheduled: acc.scheduled + occs.length,
      completed: acc.completed + completed,
      scheduledMinutes: acc.scheduledMinutes + occs.length * (t.duration || 0),
      completedMinutes: acc.completedMinutes + completed * (t.duration || 0),
    };
  }, { scheduled: 0, completed: 0, scheduledMinutes: 0, completedMinutes: 0 });
  const allTimeScheduledCount = nonImportedTasks.length + recurringAllTimeStats.scheduled + deadlineInboxTasks.length;
  const allTimeCompletedCount = allCompletedTasks.length + recurringAllTimeStats.completed + deadlineInboxCompleted.length;
  const totalCompletedMinutes = allCompletedTasks.reduce((sum, task) => sum + task.duration, 0) + recurringAllTimeStats.completedMinutes + deadlineInboxCompleted.reduce((sum, t) => sum + (t.duration || 0), 0);
  const totalScheduledMinutes = nonImportedTasks.reduce((sum, task) => sum + task.duration, 0) + recurringAllTimeStats.scheduledMinutes + deadlineInboxTasks.reduce((sum, t) => sum + (t.duration || 0), 0);

  // Daily Summary stats - always use actual current date, not selected date
  // Compute today's recurring instances directly from templates (not expandedRecurringTasks
  // which is scoped to visibleDates and would miss today when navigated away)
  const actualTodayStr = getTodayStr();
  const todayRecurringInstances = recurringTasks.flatMap(t => {
    const occs = getOccurrencesInRange(t, actualTodayStr, actualTodayStr);
    const completedSet = new Set(t.completedDates || []);
    return occs.map(dateStr => ({
      id: `recurring-${t.id}-${dateStr}`,
      title: t.title,
      date: dateStr,
      startTime: t.startTime,
      duration: t.duration,
      color: t.color,
      completed: completedSet.has(dateStr),
      isRecurring: true,
    }));
  });
  const todayDeadlineInboxTasks = unscheduledTasks.filter(t => t.deadline === actualTodayStr);
  const actualTodayTasks = [...tasks.filter(t => t.date === actualTodayStr), ...todayRecurringInstances, ...todayDeadlineInboxTasks];
  const actualTodayNonImportedTasks = actualTodayTasks.filter(t => !t.imported);
  const actualTodayCompletedTasks = actualTodayNonImportedTasks.filter(t => t.completed);
  const actualTodayCompletedMinutes = actualTodayCompletedTasks.reduce((sum, task) => sum + (task.duration || 0), 0);
  const actualTodayPlannedMinutes = actualTodayNonImportedTasks.reduce((sum, task) => sum + (task.duration || 0), 0);
  const actualTodayFocusMinutes = actualTodayNonImportedTasks.reduce((sum, t) => sum + (t.focusMinutes || 0), 0);
  const allTimeFocusMinutes = nonImportedTasks.reduce((sum, t) => sum + (t.focusMinutes || 0), 0) + deadlineInboxTasks.reduce((sum, t) => sum + (t.focusMinutes || 0), 0);

  // Inbox completion stats (tasks completed today from inbox, for "extra credit")
  // Exclude deadline tasks — they count as scheduled since they appear on the timeline
  const todayStr_ = getTodayStr();
  const inboxCompletedToday = unscheduledTasks.filter(t => t.completed && !t.deadline && t.completedAt && t.completedAt.startsWith(todayStr_));
  const inboxCompletedTodayCount = inboxCompletedToday.length;
  const inboxCompletedTodayMinutes = inboxCompletedToday.reduce((sum, t) => sum + (t.duration || 0), 0);
  const allTimeInboxCompleted = unscheduledTasks.filter(t => t.completed && !t.deadline);
  const allTimeInboxCompletedCount = allTimeInboxCompleted.length;
  const allTimeInboxCompletedMinutes = allTimeInboxCompleted.reduce((sum, t) => sum + (t.duration || 0), 0);

  // Incomplete task lists for modal
  // Don't flag tasks as incomplete if they haven't ended yet (still in progress or upcoming)
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const todayIncompleteTasks = actualTodayNonImportedTasks.filter(t => {
    if (t.completed) return false;
    // All-day tasks aren't incomplete until the day is over
    if (!t.startTime || t.isAllDay) return false;
    const [h, m] = t.startTime.split(':').map(Number);
    const taskEndMinutes = h * 60 + m + (t.duration || 0);
    if (taskEndMinutes > nowMinutes) return false; // still in progress or hasn't started
    return true;
  }).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  const allTimeIncompleteTasks = useMemo(() => {
    // For today's tasks, don't count ones that haven't ended yet (in-progress or upcoming)
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    const isTodayAndFuture = (t) => {
      if ((t.date || t.deadline) !== todayStr) return false;
      // All-day tasks aren't incomplete until the day is over
      if (!t.startTime || t.isAllDay) return true;
      const [h, m] = t.startTime.split(':').map(Number);
      return h * 60 + m + (t.duration || 0) > nowMins;
    };
    const regularIncomplete = nonImportedTasks.filter(t => !t.completed && !isTodayAndFuture(t));
    const recurringIncomplete = [];
    recurringTasks.forEach(t => {
      const occs = getOccurrencesInRange(t, t.recurrence?.startDate || todayStr, todayStr);
      const completedSet = new Set(t.completedDates || []);
      occs.forEach(dateStr => {
        if (!completedSet.has(dateStr) && !t.exceptions?.[dateStr]?.deleted) {
          const entry = {
            id: `recurring-${t.id}-${dateStr}`,
            title: t.title,
            date: dateStr,
            color: t.color,
            startTime: t.startTime,
            duration: t.duration,
            isRecurring: true,
          };
          if (!isTodayAndFuture(entry)) {
            recurringIncomplete.push(entry);
          }
        }
      });
    });
    const deadlineInboxIncomplete = unscheduledTasks.filter(t => t.deadline && t.deadline <= todayStr && !t.completed && !isTodayAndFuture(t));
    return [...regularIncomplete, ...recurringIncomplete, ...deadlineInboxIncomplete].sort((a, b) => ((a.date || a.deadline || '').localeCompare(b.date || b.deadline || '')) || (a.startTime || '').localeCompare(b.startTime || ''));
  }, [nonImportedTasks, recurringTasks, todayStr, unscheduledTasks]);

  const isToday = dateToString(selectedDate) === dateToString(new Date());
  const currentTimeMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const currentHour = currentTime.getHours();
  const currentTimeTop = minutesToPosition(currentTimeMinutes);
  const showCurrentTimeLine = isToday;

  const bgClass = darkMode ? 'bg-gray-900' : 'bg-gray-50';
  const cardBg = darkMode ? 'bg-gray-800' : 'bg-white';
  const borderClass = darkMode ? 'border-gray-700' : 'border-gray-200';
  const textPrimary = darkMode ? 'text-gray-100' : 'text-gray-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-gray-600';
  const hoverBg = darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100';

  return (
    <div className={`min-h-screen ${bgClass}`} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Landscape blocker overlay for phones only (not tablets or narrow desktop windows) */}
      {isPhone && isLandscape && (
        <div className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 ${bgClass}`}>
          <Smartphone className={`w-12 h-12 ${darkMode ? 'text-gray-500' : 'text-gray-400'} -rotate-90`} />
          <p className={`${darkMode ? 'text-gray-400' : 'text-gray-500'} text-center px-8`}>
            Please rotate your device to portrait mode
          </p>
        </div>
      )}
      {isMobile ? (
        <>
          {/* Mobile Layout */}
          <div style={{ paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }}>
            {/* Mobile Header */}
            {mobileActiveTab === 'timeline' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 ${showMonthView ? 'z-50' : 'z-30'}`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <button onClick={() => changeDate(-1)} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label="Previous day">
                    <ChevronLeft size={20} className={textSecondary} />
                  </button>
                  <div className="flex flex-col items-center gap-1">
                    <button
                      onClick={() => {
                        if (!showMonthView) setViewedMonth(new Date(selectedDate));
                        setShowMonthView(!showMonthView);
                      }}
                      className={`month-view-toggle ${textPrimary} font-bold text-lg px-2 py-1 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
                    >
                      {formatDateRange(visibleDates)}
                    </button>
                    {dateToString(selectedDate) !== dateToString(new Date()) && (
                      <button
                        onClick={goToToday}
                        className="px-3 py-0.5 text-xs bg-blue-600 text-white rounded-full hover:bg-blue-700 active:bg-blue-700 transition-colors"
                      >
                        Today
                      </button>
                    )}
                  </div>
                  <button onClick={() => changeDate(1)} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label="Next day">
                    <ChevronRight size={20} className={textSecondary} />
                  </button>
                </div>
                {/* Month View Popup for mobile */}
                {showMonthView && (
                  <div className={`month-view-container absolute left-4 right-4 top-full mt-1 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-4 z-50`}>
                    <div className="flex items-center justify-between mb-3">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); changeViewedMonth(-1); }}
                        className={`p-1 rounded ${hoverBg} transition-colors`}
                        aria-label="Previous month"
                      >
                        <ChevronLeft size={18} className={textSecondary} />
                      </button>
                      <div className={`font-bold ${textPrimary}`}>
                        {viewedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); changeViewedMonth(1); }}
                        className={`p-1 rounded ${hoverBg} transition-colors`}
                        aria-label="Next month"
                      >
                        <ChevronRight size={18} className={textSecondary} />
                      </button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 mb-2">
                      {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                        <div key={day} className={`text-xs font-semibold ${textSecondary} text-center`}>
                          {day}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {getMonthDays().map((day, index) => {
                        const isDayToday = day && day.toDateString() === new Date().toDateString();
                        const isSelected = day && day.toDateString() === selectedDate.toDateString();
                        const hasTasks = hasTasksOnDate(day);
                        return (
                          <button
                            key={index}
                            onClick={() => day && goToDate(day)}
                            disabled={!day}
                            className={`
                              h-10 rounded text-sm relative
                              ${!day ? 'invisible' : ''}
                              ${isSelected ? 'bg-blue-600 text-white font-bold' : ''}
                              ${!isSelected && isDayToday ? 'bg-blue-100 dark:bg-blue-900 font-semibold' : ''}
                              ${!isSelected && !isDayToday ? `${textPrimary} hover:bg-gray-100 dark:hover:bg-gray-700` : ''}
                              ${!day ? '' : 'cursor-pointer'}
                            `}
                          >
                            {day && day.getDate()}
                            {hasTasks && (
                              <div className={`absolute bottom-1 left-1/2 transform -translate-x-1/2 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-blue-600'}`} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {mobileActiveTab === 'inbox' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <h2 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
                    <Inbox size={20} /> Inbox
                  </h2>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setHideCompletedInbox(prev => !prev); playUISound('click'); }}
                      className={`${hoverBg} rounded px-1.5 py-1.5 transition-colors`}
                      title={hideCompletedInbox ? 'Completed tasks hidden (click to show)' : 'Showing completed tasks (click to hide)'}
                    >
                      <CheckCircle size={14} className={hideCompletedInbox ? (darkMode ? 'text-gray-500' : 'text-gray-400') : (darkMode ? 'text-blue-400' : 'text-blue-500')} />
                    </button>
                    <button
                      onClick={() => { setInboxPriorityFilter(prev => (prev + 1) % 4); playUISound('click'); }}
                      className={`flex gap-0.5 ${hoverBg} rounded px-2 py-1.5 transition-colors`}
                      title={inboxPriorityFilter === 0 ? 'Showing all priorities' : `Showing priority ${inboxPriorityFilter}+`}
                    >
                      {[0, 1, 2].map(i => (
                        <span
                          key={i}
                          className={`w-2.5 h-1 rounded-full ${
                            inboxPriorityFilter === 0
                              ? `${darkMode ? 'bg-gray-500' : 'bg-gray-400'}`
                              : i < inboxPriorityFilter
                                ? 'bg-blue-500'
                                : `${darkMode ? 'bg-gray-600' : 'bg-gray-300'}`
                          }`}
                        />
                      ))}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {mobileActiveTab === 'routines' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <h2 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
                    <Sparkles size={20} /> Routines
                  </h2>
                </div>
              </div>
            )}
            {mobileActiveTab === 'settings' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <h2 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
                    <Settings size={20} /> Settings
                  </h2>
                </div>
              </div>
            )}
            {mobileActiveTab === 'dayglance' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`}>
                <div className="flex items-center justify-center px-4 py-3">
                  <img
                    src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'}
                    alt="dayGLANCE"
                    className="h-8"
                  />
                </div>
              </div>
            )}

            {/* Mobile Tab Content */}
            {mobileActiveTab === 'timeline' && (
              <div className="px-0">
                {/* Reuse existing calendar grid for single day */}
                <div
                  ref={calendarRef}
                  className={`${cardBg} border ${borderClass} overflow-y-scroll overflow-x-hidden ${darkMode ? 'dark-scrollbar' : ''} relative`}
                  style={{ height: 'calc(100vh - 8rem - env(safe-area-inset-bottom, 0px))' }}
                >
                  {/* Sticky header group: date header + all-day section */}
                  <div ref={mobileDateHeaderRef} className={`sticky top-0 z-40 ${cardBg}`}>
                  <div className={`flex border-b ${borderClass} ${mobileDragPreviewTime === 'all-day' ? 'ring-2 ring-inset ring-blue-500' : ''}`}>
                    <div className={`w-12 flex-shrink-0 border-r ${borderClass} ${mobileDragPreviewTime === 'all-day' ? 'flex items-center justify-center' : ''}`}>
                      {mobileDragPreviewTime === 'all-day' && (
                        <span className="text-[9px] font-bold text-blue-500">ALL DAY</span>
                      )}
                    </div>
                    {visibleDates.map((date, idx) => {
                      const isDateToday = dateToString(date) === dateToString(new Date());
                      const dateStr = dateToString(date);
                      return (
                        <div
                          key={dateStr}
                          className={`flex-1 py-2 px-3 text-center ${idx > 0 ? `border-l ${borderClass}` : ''} ${mobileDragPreviewTime === 'all-day' ? (darkMode ? 'bg-blue-900/40' : 'bg-blue-100') : isDateToday ? (darkMode ? 'bg-blue-900/30' : 'bg-blue-50') : (darkMode ? 'bg-gray-700/50' : 'bg-gray-50')}`}
                          onClick={() => {
                            setNewTask({
                              title: '',
                              startTime: getNextQuarterHour(),
                              duration: 30,
                              date: dateStr,
                              isAllDay: true
                            });
                            setShowAddTask(true);
                          }}
                          title="Tap to add all-day task"
                        >
                          <div className={`font-bold text-sm ${isDateToday ? 'text-blue-600' : textPrimary}`}>
                            {formatShortDate(date)}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* All-day tasks - inside sticky header group */}
                  {(visibleDates.some(date => getTasksForDate(date).some(t => t.isAllDay && !t.isExample) || getDeadlineTasksForDate(dateToString(date)).some(t => !t.isExample)) || todayRoutines.some(r => r.isAllDay && !String(r.id).startsWith('example-'))) && (
                    <div ref={mobileAllDaySectionRef} className={`border-b ${borderClass} ${cardBg} ${mobileDragPreviewTime === 'all-day' ? 'ring-2 ring-inset ring-blue-500' : ''}`}>
                      <div className="flex">
                        <div className={`w-12 flex-shrink-0 px-2 py-2 text-[10px] font-semibold ${textSecondary} border-r ${borderClass} flex items-start justify-center`}>
                          ALL DAY
                        </div>
                        <div className="flex-1 min-w-0 p-2 space-y-1.5">
                          {visibleDates.map((date) => {
                            const dayTasks = getTasksForDate(date).filter(t => t.isAllDay && !t.isExample);
                            const dateStr = dateToString(date);
                            const deadlineTasks = getDeadlineTasksForDate(dateStr).filter(t => !t.isExample);
                            return (
                              <React.Fragment key={dateStr}>
                                {dayTasks.map((task) => {
                                  const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);
                                  const isImported = task.imported;
                                  return (
                                    <div key={task.id} className="relative rounded-lg overflow-hidden">
                                      {/* Swipe action strips */}
                                      {!isImported && (
                                        <>
                                          <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${typeof task.id === 'string' && task.id.startsWith('recurring-') ? (darkMode ? 'bg-red-900/80 text-red-300' : 'bg-red-100 text-red-600') : (darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600')} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                                            {typeof task.id === 'string' && task.id.startsWith('recurring-') ? (
                                              <><Trash2 size={14} className="mr-1" />Delete</>
                                            ) : (
                                              <><Inbox size={14} className="mr-1" />Inbox</>
                                            )}
                                          </div>
                                          <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                                            Edit<Settings size={14} className="ml-1" />
                                          </div>
                                        </>
                                      )}
                                    <div
                                      data-task-id={task.id}
                                      className={`relative ${task.isTaskCalendar ? '' : task.color} rounded-lg p-2.5 text-white text-sm select-none ${task.completed && !isImported ? 'opacity-50' : ''} ${mobileDragTaskIdState === task.id ? 'scale-105 shadow-2xl z-40' : ''}`}
                                      style={{ touchAction: 'pan-y', ...(taskCalendarStyle || {}) }}
                                      onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'allday')}
                                      onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                      onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'allday')}
                                    >
                                      <div className="flex items-center gap-2">
                                        {(!isImported || task.isTaskCalendar) && (
                                          <button
                                            onClick={() => toggleComplete(task.id)}
                                            className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center`}
                                          >
                                            {task.completed && <Check size={10} strokeWidth={3} />}
                                          </button>
                                        )}
                                        <Calendar size={14} className="flex-shrink-0" />
                                        <span className={`truncate flex-1 ${task.isTaskCalendar ? 'font-bold' : 'font-medium'} ${task.completed && !isImported ? 'line-through' : ''}`}>
                                          {renderTitle(task.title)}
                                        </span>
                                        {!isImported && (
                                          <>
                                            {typeof task.id === 'string' && task.id.startsWith('recurring-') && (
                                              <RefreshCw size={10} className="flex-shrink-0 opacity-60" />
                                            )}
                                            <button
                                              onMouseDown={() => {
                                                if (isLinkOnlyTask(task)) {
                                                  longPressTriggeredRef.current = false;
                                                  longPressTimerRef.current = setTimeout(() => {
                                                    longPressTriggeredRef.current = true;
                                                    setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                                  }, 500);
                                                }
                                              }}
                                              onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                              onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                              onTouchStart={(e) => {
                                                e.stopPropagation();
                                                if (isLinkOnlyTask(task)) {
                                                  longPressTriggeredRef.current = false;
                                                  longPressTimerRef.current = setTimeout(() => {
                                                    longPressTriggeredRef.current = true;
                                                    setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                                  }, 500);
                                                }
                                              }}
                                              onTouchEnd={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (isLinkOnlyTask(task)) {
                                                  if (!longPressTriggeredRef.current) {
                                                    window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                                  }
                                                  longPressTriggeredRef.current = false;
                                                } else {
                                                  setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                                }
                                              }}
                                              className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0 ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                            >
                                              {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                            </button>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); postponeTask(task.id); }}
                                              className="hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0"
                                            >
                                              <SkipForward size={14} />
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                    </div>
                                  );
                                })}
                                {deadlineTasks.map((task) => (
                                  <div key={`deadline-${task.id}`} className={`relative rounded-lg ${showDeadlinePicker === task.id ? '' : 'overflow-hidden'}`}>
                                    {/* Swipe action strips */}
                                    <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600'} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                                      <Inbox size={14} className="mr-1" />Inbox
                                    </div>
                                    <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                                      Edit<Settings size={14} className="ml-1" />
                                    </div>
                                  <div
                                    data-task-id={task.id}
                                    className={`relative ${task.color} rounded-lg p-2.5 text-white text-sm select-none border-2 border-dashed border-white/60 ${task.completed ? 'opacity-50' : 'opacity-90'} ${mobileDragTaskIdState === task.id ? 'scale-105 shadow-2xl z-40' : ''}`}
                                    style={{ touchAction: 'pan-y' }}
                                    onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...task, isDeadlineDrag: true }, 'deadline')}
                                    onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                    onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'deadline')}
                                  >
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => toggleComplete(task.id, true)}
                                        className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center`}
                                      >
                                        {task.completed && <Check size={10} strokeWidth={3} />}
                                      </button>
                                      <AlertCircle size={14} className="flex-shrink-0" />
                                      <span className={`truncate flex-1 font-medium ${task.completed ? 'line-through' : ''}`}>{renderTitle(task.title)}</span>
                                      <button
                                        onMouseDown={() => {
                                          if (isLinkOnlyTask(task)) {
                                            longPressTriggeredRef.current = false;
                                            longPressTimerRef.current = setTimeout(() => {
                                              longPressTriggeredRef.current = true;
                                              setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                            }, 500);
                                          }
                                        }}
                                        onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                        onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                        onTouchStart={(e) => {
                                          e.stopPropagation();
                                          if (isLinkOnlyTask(task)) {
                                            longPressTriggeredRef.current = false;
                                            longPressTimerRef.current = setTimeout(() => {
                                              longPressTriggeredRef.current = true;
                                              setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                            }, 500);
                                          }
                                        }}
                                        onTouchEnd={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (isLinkOnlyTask(task)) {
                                            if (!longPressTriggeredRef.current) {
                                              window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                            }
                                            longPressTriggeredRef.current = false;
                                          } else {
                                            setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                          }
                                        }}
                                        className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0 ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                      >
                                        {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                      </button>
                                      <div className="deadline-picker-container relative">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setShowDeadlinePicker(showDeadlinePicker === task.id ? null : task.id);
                                          }}
                                          className="hover:bg-white/20 rounded p-1 transition-colors bg-white/20 flex-shrink-0"
                                          title={task.deadline ? `Deadline: ${formatDeadlineDate(task.deadline)}` : 'Set deadline'}
                                        >
                                          <Calendar size={14} />
                                        </button>
                                        {showDeadlinePicker === task.id && (
                                          <DeadlinePickerPopover
                                            taskId={task.id}
                                            currentDeadline={task.deadline}
                                            onClose={() => setShowDeadlinePicker(null)}
                                          />
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  </div>
                                ))}
                                {/* Routine pills in all-day (today only) */}
                                {dateToString(date) === dateToString(new Date()) && todayRoutines.filter(r => r.isAllDay && !String(r.id).startsWith('example-')).map((routine) => (
                                  <div
                                    key={`routine-${routine.id}`}
                                    className={`rounded-full px-3 py-1 text-xs font-medium inline-block mr-1 mb-1 select-none ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'} ${mobileDragTaskIdState === routine.id ? 'scale-105 shadow-2xl z-40' : ''}`}
                                    style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                                    onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...routine, isRoutineDrag: true, duration: routine.duration || 15 }, 'allday')}
                                    onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                    onTouchEnd={(e) => handleMobileTaskTouchEnd(e, routine.id, 'allday')}
                                  >
                                    {routine.name}
                                  </div>
                                ))}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  </div>{/* end sticky header group */}

                  {/* Time grid */}
                  <div ref={timeGridRef} className="relative">
                    {hours.map((hour, index) => (
                      <div key={hour} className="relative">
                        <div className={`flex border-b ${index === 0 ? `border-t` : ''} ${borderClass}`}>
                          <div className={`w-12 flex-shrink-0 px-1 py-1 text-xs ${textSecondary} border-r ${borderClass} text-center`}>
                            {use24HourClock
                              ? `${hour.toString().padStart(2, '0')}:00`
                              : <>{hour === 0 ? 12 : hour > 12 ? hour - 12 : hour}<span className="text-[9px] ml-0.5">{hour >= 12 ? 'PM' : 'AM'}</span></>
                            }
                          </div>
                          {visibleDates.map((date, idx) => (
                            <div
                              key={dateToString(date)}
                              className={`flex-1 relative h-40 calendar-slot ${idx > 0 ? `border-l ${borderClass}` : ''}`}
                              data-date={dateToString(date)}
                              onClick={(e) => {
                                if (e.target.classList.contains('calendar-slot')) {
                                  const time = getTimeFromCursorPosition(e);
                                  setHoverPreviewTime(time);
                                  setHoverPreviewDate(date);
                                }
                              }}
                            ></div>
                          ))}
                        </div>
                        {/* Half-hour dashed line */}
                        <div className="absolute left-0 right-0 pointer-events-none" style={{ top: '80px' }}>
                          <div className={`flex border-b border-dashed ${borderClass} opacity-50`}>
                            <div className="w-12 flex-shrink-0"></div>
                            {visibleDates.map((date, idx) => (
                              <div key={dateToString(date)} className={`flex-1 ${idx > 0 ? `border-l ${borderClass}` : ''}`}></div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Task overlays */}
                    <div className="absolute top-0 left-12 right-0 bottom-0 pointer-events-none flex">
                      {visibleDates.map((date, dayIndex) => {
                        const dateStr = dateToString(date);
                        const isDateToday = dateStr === dateToString(new Date());
                        const dayTasks = getTasksForDate(date).filter(t => !t.isAllDay && !t.isExample);

                        return (
                          <div
                            key={dateStr}
                            className={`flex-1 relative ${dayIndex > 0 ? `border-l ${borderClass}` : ''}`}
                          >
                            {/* Current time line */}
                            {isDateToday && (
                              <div
                                className="absolute left-0 right-0 pointer-events-none z-10"
                                style={{ top: `${currentTimeTop}px` }}
                              >
                                <div className="flex items-center">
                                  <div className="w-2 h-2 bg-red-500 rounded-full -ml-1"></div>
                                  <div className="flex-1 h-0.5 bg-red-500"></div>
                                </div>
                              </div>
                            )}

                            {/* Mobile drag time preview */}
                            {mobileDragPreviewTime && mobileDragPreviewTime !== 'all-day' && (() => {
                              const dragMinutes = timeToMinutes(mobileDragPreviewTime);
                              const dragTop = Math.round(minutesToPosition(dragMinutes));
                              return (
                                <div
                                  className="absolute left-0 right-0 pointer-events-none z-20"
                                  style={{ top: `${dragTop}px` }}
                                >
                                  <div className="relative">
                                    <div className={`absolute bottom-0.5 left-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${darkMode ? 'bg-blue-500 text-white' : 'bg-blue-600 text-white'}`}>
                                      {formatTime(mobileDragPreviewTime)}
                                    </div>
                                    <div className="h-0.5 bg-blue-500"></div>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Hover preview line - shows selected time for new task via FAB */}
                            {hoverPreviewTime && !draggedTask && hoverPreviewDate && dateToString(hoverPreviewDate) === dateStr && (
                              <div
                                className="absolute left-0 right-0 pointer-events-none z-30"
                                style={{
                                  top: `${minutesToPosition(timeToMinutes(hoverPreviewTime))}px`
                                }}
                              >
                                <div className="absolute left-0 right-12 h-0.5 bg-blue-400/60"></div>
                                <div className="absolute right-1 bg-blue-500/80 text-white text-xs px-1.5 py-0.5 rounded -translate-y-1/2">
                                  {formatTime(hoverPreviewTime)}
                                </div>
                              </div>
                            )}

                            {/* Task blocks */}
                            {dayTasks.map(task => {
                              const { top, height } = calculateTaskPosition(task);
                              const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);
                              const mobileCalendarStyle = taskCalendarStyle;
                              const isRecurring = typeof task.id === 'string' && task.id.startsWith('recurring-');
                              const isImported = task.imported;
                              const isCalendarEvent = task.imported && !task.isTaskCalendar;
                              const isPastEvent = isCalendarEvent && isDateToday && (timeToMinutes(task.startTime) + task.duration) <= (new Date().getHours() * 60 + new Date().getMinutes());
                              const isConflicted = !task.isAllDay && dayTasks.some(other => {
                                if (other.id === task.id || other.isAllDay || other.completed) return false;
                                const s1 = timeToMinutes(task.startTime), e1 = s1 + task.duration;
                                const s2 = timeToMinutes(other.startTime), e2 = s2 + other.duration;
                                return s1 < e2 && e1 > s2;
                              });
                              const conflictPos = calculateConflictPosition(task, dayTasks);

                              // Layout tiers (matching desktop logic)
                              const isMicroHeight = height <= 40;
                              const taskWidth = taskWidths[task.id];
                              const isMeasured = taskWidth !== undefined;
                              const isNarrowWidth = taskWidth < 180;

                              // Mobile action buttons component
                              const MobileActionButtons = ({ inMenu = false }) => (
                                <>
                                  <button
                                    onMouseDown={() => {
                                      if (isLinkOnlyTask(task)) {
                                        longPressTriggeredRef.current = false;
                                        longPressTimerRef.current = setTimeout(() => {
                                          longPressTriggeredRef.current = true;
                                          setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                        }, 500);
                                      }
                                    }}
                                    onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                    onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                    onTouchStart={(e) => {
                                      e.stopPropagation();
                                      if (isLinkOnlyTask(task)) {
                                        longPressTriggeredRef.current = false;
                                        longPressTimerRef.current = setTimeout(() => {
                                          longPressTriggeredRef.current = true;
                                          setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                        }, 500);
                                      }
                                    }}
                                    onTouchEnd={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isLinkOnlyTask(task)) {
                                        if (!longPressTriggeredRef.current) {
                                          window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                        }
                                        longPressTriggeredRef.current = false;
                                      } else {
                                        setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                      }
                                    }}
                                    className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''} ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                  >
                                    {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                    {inMenu && <span className="text-xs">{isLinkOnlyTask(task) ? 'Open Link' : 'Notes'}</span>}
                                  </button>
                                  {!(typeof task.id === 'string' && task.id.startsWith('recurring-')) && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); postponeTask(task.id); }}
                                      className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                    >
                                      <SkipForward size={14} />
                                      {inMenu && <span className="text-xs">Postpone</span>}
                                    </button>
                                  )}
                                </>
                              );

                              return (
                                <div
                                  key={task.id}
                                  ref={setTaskRef(task.id)}
                                  data-task-id={task.id}
                                  className={`absolute pointer-events-auto rounded-lg ${expandedTaskMenu === task.id ? 'overflow-visible z-30' : 'overflow-hidden'} ${isConflicted && !task.completed ? 'ring-4 ring-red-500' : ''} ${(task.completed && !isImported) || isPastEvent ? 'opacity-50' : ''} ${mobileDragTaskIdState === task.id ? 'scale-105 shadow-2xl z-40' : ''}`}
                                  style={{
                                    top: `${top}px`,
                                    height: `${height}px`,
                                    minHeight: isMicroHeight ? '27px' : '39px',
                                    left: conflictPos.left,
                                    right: conflictPos.right,
                                    width: conflictPos.width,
                                    visibility: isMeasured ? 'visible' : 'hidden',
                                    transition: mobileDragTaskIdState === task.id ? 'transform 0.15s, box-shadow 0.15s' : undefined,
                                  }}
                                >
                                  {/* Swipe action strips - hidden until swipe direction determined */}
                                  {!task.imported && (
                                    <>
                                      <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${typeof task.id === 'string' && task.id.startsWith('recurring-') ? (darkMode ? 'bg-red-900/80 text-red-300' : 'bg-red-100 text-red-600') : (darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600')} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                                        {typeof task.id === 'string' && task.id.startsWith('recurring-') ? (
                                          <><Trash2 size={14} className="mr-1" />Delete</>
                                        ) : (
                                          <><Inbox size={14} className="mr-1" />Inbox</>
                                        )}
                                      </div>
                                      <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                                        Edit<Settings size={14} className="ml-1" />
                                      </div>
                                    </>
                                  )}
                                  {/* Task content with swipe + drag touch handlers */}
                                  <div
                                    className={`relative h-full select-none ${task.isTaskCalendar ? '' : task.color} rounded-lg shadow-sm ${task.isTaskCalendar ? '' : 'border border-white/20'}`}
                                    style={{ touchAction: 'pan-y', ...mobileCalendarStyle }}
                                    onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'timeline')}
                                    onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                    onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'timeline')}
                                  >
                                  {isCalendarEvent ? (
                                    <div className="h-full px-2 py-1.5 flex items-center gap-2 text-white">
                                      <span className="text-sm font-semibold truncate flex-1 min-w-0">
                                        {renderTitle(task.title)}
                                      </span>
                                      {!isNarrowWidth && (
                                        <div className="text-xs opacity-90 whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                                          <Clock size={10} />
                                          {formatTime(task.startTime)} • {task.duration}m
                                        </div>
                                      )}
                                    </div>
                                  ) : isImported ? (
                                    <div className="h-full px-2 py-1.5 flex items-center gap-1.5 text-white">
                                      <button
                                        onClick={() => toggleComplete(task.id)}
                                        className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-3.5 h-3.5 flex items-center justify-center`}
                                      >
                                        {task.completed && <Check size={8} strokeWidth={3} />}
                                      </button>
                                      <span className={`text-sm font-bold truncate flex-1 min-w-0 ${task.completed ? 'line-through' : ''}`}>
                                        {renderTitle(task.title)}
                                      </span>
                                      {!isNarrowWidth && (
                                        <div className="text-xs opacity-90 whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                                          <Clock size={10} />
                                          {formatTime(task.startTime)} • {task.duration}m
                                        </div>
                                      )}
                                    </div>
                                  ) : isMicroHeight && isNarrowWidth ? (
                                    /* MICRO NARROW: ... menu + checkbox + truncated title */
                                    <div className={`h-full px-1.5 py-1 flex items-center text-white justify-center`}>
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container absolute top-0.5 right-0.5 hover:bg-white/20 rounded p-0.5 transition-colors z-10"
                                      >
                                        <MoreHorizontal size={12} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            <MobileActionButtons inMenu={true} />
                                          </div>
                                        )}
                                      </button>
                                      <div className="flex items-center gap-1 min-w-0 pr-5">
                                        <button
                                          onClick={() => toggleComplete(task.id)}
                                          className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-3.5 h-3.5 flex items-center justify-center`}
                                        >
                                          {task.completed && <Check size={8} strokeWidth={3} />}
                                        </button>
                                        {isRecurring && <RefreshCw size={10} className="flex-shrink-0 opacity-60" />}
                                        <span className={`text-sm font-medium truncate ${task.completed ? 'line-through' : ''}`}>
                                          {renderTitle(task.title)}
                                        </span>
                                      </div>
                                    </div>
                                  ) : isMicroHeight ? (
                                    /* MICRO WIDE: checkbox + title + action buttons inline */
                                    <div className="h-full px-1.5 py-1 flex items-center justify-between gap-1 text-white">
                                      <div className="flex items-center gap-1 min-w-0">
                                        <button
                                          onClick={() => toggleComplete(task.id)}
                                          className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-3.5 h-3.5 flex items-center justify-center`}
                                        >
                                          {task.completed && <Check size={8} strokeWidth={3} />}
                                        </button>
                                        {isRecurring && <RefreshCw size={10} className="flex-shrink-0 opacity-60" />}
                                        <span className={`text-sm font-medium truncate ${task.completed ? 'line-through' : ''}`}>
                                          {renderTitle(task.title)}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-0.5 flex-shrink-0">
                                        <MobileActionButtons />
                                      </div>
                                    </div>
                                  ) : isNarrowWidth ? (
                                    /* NARROW: ... menu + checkbox + title, no time row */
                                    <div className="h-full px-2 py-1.5 flex flex-col text-white">
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container absolute top-1 right-1 hover:bg-white/20 rounded p-0.5 transition-colors z-10"
                                      >
                                        <MoreHorizontal size={14} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            <MobileActionButtons inMenu={true} />
                                          </div>
                                        )}
                                      </button>
                                      <div className="flex items-start gap-1 pr-6">
                                        <button
                                          onClick={() => toggleComplete(task.id)}
                                          className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center`}
                                        >
                                          {task.completed && <Check size={10} strokeWidth={3} />}
                                        </button>
                                        {isRecurring && <RefreshCw size={10} className="flex-shrink-0 opacity-60 mt-1" />}
                                        <span className={`text-sm font-medium leading-tight line-clamp-2 ${task.completed ? 'line-through' : ''}`}>
                                          {renderTitle(task.title)}
                                        </span>
                                      </div>
                                    </div>
                                  ) : (
                                    /* WIDE: checkbox + title + action buttons + time row */
                                    <div className="h-full px-2 py-1.5 flex flex-col text-white">
                                      <div className="flex items-start justify-between gap-1">
                                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                          <button
                                            onClick={() => toggleComplete(task.id)}
                                            className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center`}
                                          >
                                            {task.completed && <Check size={10} strokeWidth={3} />}
                                          </button>
                                          {isRecurring && <RefreshCw size={10} className="flex-shrink-0 opacity-60" />}
                                          <span className={`text-sm font-medium truncate ${task.completed ? 'line-through' : ''}`}>
                                            {renderTitle(task.title)}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-0.5 flex-shrink-0">
                                          <MobileActionButtons />
                                        </div>
                                      </div>
                                      {height >= 55 && (
                                        <div className="text-xs text-white/70 mt-0.5">
                                          {formatTime(task.startTime)} · {task.duration}m
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  </div>{/* end swipe content */}
                                </div>
                                );
                              })}

                            {/* Timeline routine pills (today only) */}
                            {dateStr === dateToString(new Date()) && (() => {
                              const timelineRoutines = todayRoutines.filter(r => !r.isAllDay && r.startTime && !String(r.id).startsWith('example-'));
                              if (timelineRoutines.length === 0) return null;

                              // Compute side-by-side columns for overlapping routine chips
                              const routineColumns = [];
                              const sorted = [...timelineRoutines].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
                              sorted.forEach(r => {
                                const rStart = timeToMinutes(r.startTime);
                                let placed = false;
                                for (let c = 0; c < routineColumns.length; c++) {
                                  const lastInCol = routineColumns[c][routineColumns[c].length - 1];
                                  if (timeToMinutes(lastInCol.startTime) + lastInCol.duration <= rStart) {
                                    routineColumns[c].push(r);
                                    placed = true;
                                    break;
                                  }
                                }
                                if (!placed) routineColumns.push([r]);
                              });
                              const colMap = {};
                              routineColumns.forEach((col, ci) => col.forEach(r => { colMap[r.id] = ci; }));
                              const overlapCount = {};
                              timelineRoutines.forEach(r => {
                                const rStart = timeToMinutes(r.startTime);
                                const rEnd = rStart + r.duration;
                                let maxCols = 1;
                                timelineRoutines.forEach(other => {
                                  if (other.id === r.id) return;
                                  const oStart = timeToMinutes(other.startTime);
                                  const oEnd = oStart + other.duration;
                                  if (rStart < oEnd && rEnd > oStart) maxCols++;
                                });
                                overlapCount[r.id] = maxCols;
                              });

                              const now = new Date();
                              const nowMinutes = now.getHours() * 60 + now.getMinutes();

                              return timelineRoutines.map(routine => {
                                const { top: rTop, height: rHeight } = calculateTaskPosition(routine);
                                const colIdx = colMap[routine.id];
                                const cols = overlapCount[routine.id];
                                const widthPercent = cols > 1 ? `${100 / cols}%` : '100%';
                                const leftPercent = cols > 1 ? `${(colIdx * 100) / cols}%` : '0%';
                                const endMinutes = timeToMinutes(routine.startTime) + routine.duration;
                                const isPast = endMinutes <= nowMinutes;

                                return (
                                  <div
                                    key={`routine-tl-${routine.id}`}
                                    className={`absolute pointer-events-auto select-none flex items-center justify-center ${isPast ? 'opacity-50' : ''} ${mobileDragTaskIdState === routine.id ? 'scale-105 shadow-2xl z-40' : ''}`}
                                    style={{
                                      touchAction: 'pan-y',
                                      WebkitTouchCallout: 'none',
                                      WebkitUserSelect: 'none',
                                      top: `${rTop}px`,
                                      height: `${Math.max(rHeight, 27)}px`,
                                      left: `calc(${leftPercent} + 4px)`,
                                      width: `calc(${widthPercent} - 8px)`,
                                    }}
                                    onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...routine, isRoutineDrag: true }, 'timeline')}
                                    onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                    onTouchEnd={(e) => handleMobileTaskTouchEnd(e, routine.id, 'timeline')}
                                  >
                                    <div className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                                    <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                                    <span className={`relative rounded-full px-3 py-1 text-xs font-medium ${darkMode ? 'bg-teal-700 text-teal-100' : 'bg-teal-600 text-white'}`}>{routine.name}</span>
                                    {/* Duration edit button (mobile) */}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setRoutineDurationEditId(routineDurationEditId === routine.id ? null : routine.id); }}
                                      className={`routine-duration-edit absolute bottom-0 right-0 translate-y-1/2 translate-x-1/4 z-10 rounded-full p-0.5 shadow-md border transition-colors ${darkMode ? 'bg-teal-700 border-teal-500 text-teal-200 active:bg-teal-600' : 'bg-teal-600 border-teal-400 text-white active:bg-teal-500'}`}
                                      aria-label="Edit duration"
                                    >
                                      <GripHorizontal size={12} />
                                    </button>
                                    {/* Duration edit popover */}
                                    {routineDurationEditId === routine.id && (
                                      <div
                                        className={`routine-duration-edit absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 ${darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'} border rounded-xl shadow-xl flex items-center gap-1 px-2 py-1.5`}
                                        onClick={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setTodayRoutines(prev => prev.map(r => r.id === routine.id ? { ...r, duration: Math.max(15, r.duration - 15) } : r)); }}
                                          className={`p-1 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700 active:bg-gray-600 text-gray-300' : 'hover:bg-gray-100 active:bg-gray-200 text-gray-600'}`}
                                          aria-label="Decrease duration"
                                        >
                                          <ChevronDown size={16} />
                                        </button>
                                        <span className={`text-xs font-semibold tabular-nums min-w-[3rem] text-center ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                                          {routine.duration}min
                                        </span>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setTodayRoutines(prev => prev.map(r => r.id === routine.id ? { ...r, duration: r.duration + 15 } : r)); }}
                                          className={`p-1 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700 active:bg-gray-600 text-gray-300' : 'hover:bg-gray-100 active:bg-gray-200 text-gray-600'}`}
                                          aria-label="Increase duration"
                                        >
                                          <ChevronUp size={16} />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Mobile notes panel overlay for timeline tasks (including deadline tasks) */}
                {expandedNotesTaskId && (() => {
                  const scheduledTask = visibleDates.reduce((found, date) => {
                    if (found) return found;
                    return getTasksForDate(date).find(t => t.id === expandedNotesTaskId);
                  }, null);
                  const deadlineTask = !scheduledTask ? unscheduledTasks.find(t => t.id === expandedNotesTaskId && t.deadline) : null;
                  const noteTask = scheduledTask || deadlineTask;
                  if (!noteTask) return null;
                  return (
                    <div className="notes-panel-container fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setExpandedNotesTaskId(null)}>
                      <div className="bg-black/30 absolute inset-0" />
                      <div
                        className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[60vh] overflow-y-auto`}
                        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
                          <div className={`font-medium ${textPrimary} truncate flex-1`}>{noteTask.title}</div>
                          <button onClick={() => setExpandedNotesTaskId(null)} className={`p-1 rounded-lg ${hoverBg} transition-colors`} aria-label="Close notes">
                            <X size={18} className={textSecondary} />
                          </button>
                        </div>
                        <div className="p-4">
                          <NotesSubtasksPanel
                            task={noteTask}
                            isInbox={!!deadlineTask}
                            darkMode={darkMode}
                            updateTaskNotes={updateTaskNotes}
                            addSubtask={addSubtask}
                            toggleSubtask={toggleSubtask}
                            deleteSubtask={deleteSubtask}
                            updateSubtaskTitle={updateSubtaskTitle}
                            noAutoFocus
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {mobileActiveTab === 'dayglance' && (
              <div className={`px-4 py-4 mobile-tab-fade-in`} style={{ minHeight: 'calc(100vh - 8rem - env(safe-area-inset-bottom, 0px))' }}>
                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={() => { setShowSpotlight(true); playUISound('spotlight'); }}
                    className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-gray-400'} transition-colors`}
                  >
                    <Search size={16} />
                    <span className="text-sm">Search tasks...</span>
                  </button>
                  {allTags.length > 0 && (
                    <button
                      onClick={() => setShowMobileTagFilter(true)}
                      className={`relative flex-shrink-0 px-2.5 self-stretch flex items-center rounded-lg transition-colors ${
                        !allTags.every(tag => selectedTags.includes(tag))
                          ? 'bg-blue-500 text-white'
                          : darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-gray-400'
                      }`}
                    >
                      <Filter size={16} />
                    </button>
                  )}
                </div>
                {/* Overdue tasks from past days */}
                {(() => {
                  const todayStr = getTodayStr();
                  const pastOverdue = getOverdueTasks().filter(t => {
                    if (t._overdueType === 'scheduled') return t.date < todayStr;
                    return true; // deadline overdue are always from past dates
                  });
                  if (pastOverdue.length === 0) return null;
                  return (
                    <div className={`mb-4 rounded-lg border ${darkMode ? 'border-orange-500/40 bg-orange-500/10' : 'border-orange-400/50 bg-orange-50'} overflow-hidden`}>
                      <button
                        onClick={() => toggleSection('overdue')}
                        className="w-full flex items-center justify-between px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={15} className="text-orange-500" />
                          <span className="text-sm font-semibold text-orange-500">Overdue</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${darkMode ? 'bg-orange-500/30 text-orange-300' : 'bg-orange-200 text-orange-700'}`}>
                            {pastOverdue.length}
                          </span>
                        </div>
                        {minimizedSections.overdue ? <ChevronDown size={16} className="text-orange-500" /> : <ChevronUp size={16} className="text-orange-500" />}
                      </button>
                      {!minimizedSections.overdue && (
                        <div className="px-3 pb-2.5 space-y-1">
                          {pastOverdue.map(task => (
                            <div
                              key={`mobile-overdue-${task.id}`}
                              className={`flex items-center gap-2.5 py-2 px-2 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white/80'}`}
                            >
                              <button
                                onClick={() => toggleComplete(task.id, task._overdueType === 'deadline')}
                                className={`w-5 h-5 rounded flex-shrink-0 border-2 ${task.completed
                                  ? 'border-orange-400 bg-orange-400'
                                  : darkMode ? 'border-orange-400/60 bg-white/10' : 'border-orange-400/60 bg-white'
                                } flex items-center justify-center`}
                              >
                                {task.completed && <Check size={12} strokeWidth={3} className="text-white" />}
                              </button>
                              <div className="flex-1 min-w-0">
                                <div className={`text-sm font-medium truncate ${task.completed ? 'line-through opacity-50' : textPrimary}`}>
                                  {renderTitle(task.title)}
                                </div>
                                <div className={`text-xs ${textSecondary} flex items-center gap-1 mt-0.5`}>
                                  {task._overdueType === 'scheduled' ? (
                                    <>
                                      <Clock size={10} />
                                      {formatDeadlineDate(task.date)} {!task.isAllDay && `• ${formatTime(task.startTime)}`}
                                    </>
                                  ) : (
                                    <>
                                      <AlertCircle size={10} />
                                      Due: {formatDeadlineDate(task.deadline)}
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={() => {
                                    if (task._overdueType === 'scheduled') {
                                      pushUndo();
                                      setTasks(prev => prev.filter(t => t.id !== task.id));
                                      const { startTime, date, duration, _overdueType, ...rest } = task;
                                      setUnscheduledTasks(prev => [...prev, { ...rest, priority: rest.priority || 0 }]);
                                      playUISound('slide');
                                      setUndoToast({ message: 'Moved to inbox', actionable: true });
                                    } else {
                                      clearDeadline(task.id);
                                      playUISound('slide');
                                      setUndoToast({ message: 'Deadline cleared', actionable: true });
                                    }
                                  }}
                                  className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'} active:scale-95 transition-transform`}
                                  title="Move to inbox"
                                >
                                  <Inbox size={14} />
                                </button>
                                <button
                                  onClick={() => moveToRecycleBin(task.id, task._overdueType === 'deadline')}
                                  className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'} active:scale-95 transition-transform`}
                                  title="Move to Recycle Bin"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {(() => { const filteredAgenda = filterByTags(todayAgenda); return (
                  <div className="space-y-1.5">
                    {filteredAgenda.flatMap((task, idx) => {
                      const mobileItems = [];
                      // Insert "Now" marker at the right position (skip when inside a task/event)
                      if (!agendaNowMarker.insideTask) {
                        if (idx === 0 && agendaNowMarker.insertAfterIndex < 0) {
                          const gapH = Math.floor(agendaNowMarker.gapMinutes / 60);
                          const gapM = agendaNowMarker.gapMinutes % 60;
                          const gapStr = gapH > 0 ? `${gapH}h${gapM > 0 ? ` ${gapM}m` : ''}` : `${gapM}m`;
                          mobileItems.push(
                            <div key="mobile-now-marker" className="flex gap-2.5 py-2.5">
                              <div className="w-1.5 rounded-full flex-shrink-0 bg-red-500" />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-red-500">{formatTime(agendaNowMarker.nowTimeStr)}, {gapStr} of free time</div>
                                {agendaNowMarker.inboxCount > 0 && (
                                  <div className="text-xs italic text-red-500 mt-0.5">Maybe tackle an inbox task?</div>
                                )}
                              </div>
                            </div>
                          );
                        } else if (idx > 0) {
                          // Check if we should insert marker before this task (by comparing with todayAgenda positions)
                          const prevTask = filteredAgenda[idx - 1];
                          const prevIdxInFull = todayAgenda.indexOf(prevTask);
                          const curIdxInFull = todayAgenda.indexOf(task);
                          if (prevIdxInFull <= agendaNowMarker.insertAfterIndex && curIdxInFull > agendaNowMarker.insertAfterIndex) {
                            const gapH = Math.floor(agendaNowMarker.gapMinutes / 60);
                            const gapM = agendaNowMarker.gapMinutes % 60;
                            const gapStr = gapH > 0 ? `${gapH}h${gapM > 0 ? ` ${gapM}m` : ''}` : `${gapM}m`;
                            mobileItems.push(
                              <div key="mobile-now-marker" className="flex gap-2.5 py-2.5">
                                <div className="w-1.5 rounded-full flex-shrink-0 bg-red-500" />
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium text-red-500">{formatTime(agendaNowMarker.nowTimeStr)}, {gapStr} of free time</div>
                                  {agendaNowMarker.inboxCount > 0 && (
                                    <div className="text-xs italic text-red-500 mt-0.5">Maybe tackle an inbox task?</div>
                                  )}
                                </div>
                              </div>
                            );
                          }
                        }
                      }
                      const colorClass = task.color === 'task-calendar' ? '' : task.color;
                      const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
                      let timeLabel = '';
                      let relativeLabel = '';
                      if (task._agendaType === 'allday') {
                        timeLabel = 'ALL DAY';
                      } else if (task._agendaType === 'deadline') {
                        timeLabel = 'DUE TODAY';
                      } else {
                        const [h, m] = (task.startTime || '0:0').split(':').map(Number);
                        const startMin = h * 60 + m;
                        const endMin = startMin + (task.duration || 0);
                        const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
                        const endM = String(endMin % 60).padStart(2, '0');
                        timeLabel = `${formatTime(task.startTime)} – ${formatTime(endH + ':' + endM)}`;
                        const diff = startMin - nowMin;
                        if (diff > 0) {
                          relativeLabel = diff >= 60 ? `in ${Math.floor(diff / 60)}h ${diff % 60 > 0 ? `${diff % 60}m` : ''}` : `in ${diff}m`;
                        } else if (diff === 0) {
                          relativeLabel = 'now';
                        } else if (nowMin < endMin && !task.completed) {
                          relativeLabel = 'In Progress';
                        } else if (nowMin >= endMin && !task.completed) {
                          relativeLabel = 'Overdue';
                        }
                      }
                      mobileItems.push(
                        <div
                          key={`mobile-glance-${task._agendaType}-${task.id}`}
                          className={`flex gap-2.5 py-2.5 ${task.completed ? 'opacity-50' : ''} cursor-pointer active:bg-white/5 rounded-lg transition-colors`}
                          onClick={() => {
                            setMobileActiveTab('timeline');
                            setTimeout(() => {
                              const el = document.querySelector(`[data-task-id="${task.id}"]`);
                              if (el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                el.classList.add('ring-2', 'ring-blue-400');
                                setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 2000);
                              }
                            }, 150);
                          }}
                        >
                          <div className={`w-1.5 rounded-full flex-shrink-0 ${colorClass}`} style={task.isTaskCalendar ? getTaskCalendarStyle(task, darkMode) : {}}></div>
                          <div className="min-w-0 flex-1">
                            <div className={`text-base font-semibold ${textPrimary} ${task.completed ? 'line-through' : ''} flex items-center gap-1.5`}>
                              {task.isRecurring && <RefreshCw size={13} className="flex-shrink-0 opacity-60" />}
                              <span className="truncate">{renderTitleWithoutTags(task.title)}</span>
                              {hasNotesOrSubtasks(task) && (
                                <button
                                  onMouseDown={() => {
                                    if (isLinkOnlyTask(task)) {
                                      longPressTriggeredRef.current = false;
                                      longPressTimerRef.current = setTimeout(() => {
                                        longPressTriggeredRef.current = true;
                                        setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                      }, 500);
                                    }
                                  }}
                                  onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                  onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                  onTouchStart={(e) => {
                                    e.stopPropagation();
                                    if (isLinkOnlyTask(task)) {
                                      longPressTriggeredRef.current = false;
                                      longPressTimerRef.current = setTimeout(() => {
                                        longPressTriggeredRef.current = true;
                                        setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                      }, 500);
                                    }
                                  }}
                                  onTouchEnd={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isLinkOnlyTask(task)) {
                                      if (!longPressTriggeredRef.current) {
                                        window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                      }
                                      longPressTriggeredRef.current = false;
                                    } else {
                                      setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                    }
                                  }}
                                  className={`notes-toggle-button flex-shrink-0 rounded p-1.5 transition-colors ${darkMode ? 'hover:bg-white/20 text-gray-400' : 'hover:bg-black/10 text-gray-500'}`}
                                  title={isLinkOnlyTask(task) ? getLinkUrl(task) : "Notes & subtasks"}
                                >
                                  {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                </button>
                              )}
                            </div>
                            <div className={`text-sm ${textSecondary} flex items-center gap-1`}>
                              {timeLabel}{relativeLabel ? <>{`, `}<span className={relativeLabel === 'Overdue' ? 'text-orange-500 font-medium' : relativeLabel === 'In Progress' ? 'text-blue-500 font-medium' : ''}>{relativeLabel}</span></> : ''}
                              {relativeLabel === 'In Progress' && focusModeAvailable && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); enterFocusMode(); }}
                                  className="ml-1 p-1.5 rounded text-purple-500 hover:text-purple-400 hover:bg-purple-500/20 transition-colors"
                                  title="Enter Focus Mode"
                                >
                                  <BrainCircuit size={16} className="animate-pulse" />
                                </button>
                              )}
                            </div>
                          </div>
                          {relativeLabel === 'Overdue' && !task.completed && (
                            <div className="flex items-center gap-1 flex-shrink-0 mr-5">
                              {!task.isRecurring && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    pushUndo();
                                    setTasks(prev => prev.filter(t => t.id !== task.id));
                                    const { startTime, date, _agendaType, ...rest } = task;
                                    setUnscheduledTasks(prev => [...prev, { ...rest, priority: rest.priority || 0 }]);
                                    playUISound('slide');
                                    setUndoToast({ message: 'Moved to inbox', actionable: true });
                                  }}
                                  className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'} active:scale-95 transition-transform`}
                                  title="Move to Inbox"
                                >
                                  <Inbox size={14} />
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleComplete(task.id, false); }}
                                className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'} active:scale-95 transition-transform`}
                                title="Mark complete"
                              >
                                <CheckCircle size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                      return mobileItems;
                    })}
                    {/* Now marker after all tasks (when "now" is past the last scheduled task) */}
                    {agendaNowMarker.insertAfterIndex >= todayAgenda.length - 1 && (() => {
                      const hr = currentTime.getHours();
                      const barColor = hr >= 22 ? 'bg-blue-500' : hr >= 19 ? 'bg-green-500' : 'bg-yellow-500';
                      const textColor = hr >= 22 ? 'text-blue-500' : hr >= 19 ? 'text-green-500' : 'text-yellow-600';
                      const subtitle = hr >= 22 ? "Get some rest so you're ready for tomorrow!" : hr >= 19 ? 'Enjoy the evening!' : 'Time to relax or tackle more tasks?';
                      return (
                        <div key="mobile-now-marker-end" className="flex gap-2.5 py-2.5">
                          <div className={`w-1.5 rounded-full flex-shrink-0 ${barColor}`} />
                          <div className="min-w-0 flex-1">
                            <div className={`text-sm font-medium ${textColor}`}>{formatTime(agendaNowMarker.nowTimeStr)}, all done!</div>
                            <div className={`text-xs italic ${textColor} mt-0.5`}>{subtitle}</div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ); })()}
                {/* Routines row */}
                {todayRoutines.length > 0 && (() => {
                  const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
                  const visibleRoutines = todayRoutines.filter(r => {
                    if (String(r.id).startsWith('example-')) return false;
                    if (!r.startTime || r.isAllDay) return true;
                    return (timeToMinutes(r.startTime) + r.duration + 60) > nowMin;
                  });
                  if (visibleRoutines.length === 0) return null;
                  return (
                    <div className={`mt-3 pt-3 border-t ${borderClass} cursor-pointer`} onClick={() => {
                      setMobileActiveTab('routines');
                      setMobileSettingsView('main');
                      setDashboardSelectedChips(todayRoutines.map(r => ({ id: r.id, name: r.name, bucket: r.bucket, startTime: r.startTime || null })));
                      setRoutineAddingToBucket(null);
                      setRoutineNewChipName('');
                    }}>
                      <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${textSecondary}`}>Routines</div>
                      <div className="flex flex-wrap gap-1.5">
                        {[...visibleRoutines].sort((a, b) => {
                          if (a.isAllDay && !b.isAllDay) return -1;
                          if (!a.isAllDay && b.isAllDay) return 1;
                          if (a.startTime && b.startTime) return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
                          return 0;
                        }).map(r => {
                          let timeLabel = '';
                          if (!r.isAllDay && r.startTime) {
                            if (use24HourClock) {
                              timeLabel = r.startTime;
                            } else {
                              const [h, m] = r.startTime.split(':').map(Number);
                              const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                              const ampm = h < 12 ? 'a' : 'p';
                              timeLabel = m === 0 ? `${hour12}${ampm}` : `${hour12}:${String(m).padStart(2, '0')}${ampm}`;
                            }
                          }
                          return (
                            <span key={r.id} className={`rounded-full px-2.5 py-1 text-xs font-medium ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'}`}>
                              {timeLabel && <span className="opacity-70 mr-1">{timeLabel}</span>}{r.name}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Mobile notes panel overlay for dayglance tasks */}
                {expandedNotesTaskId && (() => {
                  const agendaTask = todayAgenda.find(t => t.id === expandedNotesTaskId);
                  if (!agendaTask) return null;
                  const isInbox = agendaTask._agendaType === 'deadline';
                  return (
                    <div className="notes-panel-container fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setExpandedNotesTaskId(null)}>
                      <div className="bg-black/30 absolute inset-0" />
                      <div
                        className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[60vh] overflow-y-auto`}
                        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
                          <div className={`font-medium ${textPrimary} truncate flex-1`}>{agendaTask.title}</div>
                          <button onClick={() => setExpandedNotesTaskId(null)} className={`p-1 rounded-lg ${hoverBg} transition-colors`} aria-label="Close notes">
                            <X size={18} className={textSecondary} />
                          </button>
                        </div>
                        <div className="p-4">
                          <NotesSubtasksPanel
                            task={agendaTask}
                            isInbox={isInbox}
                            darkMode={darkMode}
                            updateTaskNotes={updateTaskNotes}
                            addSubtask={addSubtask}
                            toggleSubtask={toggleSubtask}
                            deleteSubtask={deleteSubtask}
                            updateSubtaskTitle={updateSubtaskTitle}
                            noAutoFocus
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {mobileActiveTab === 'inbox' && (
              <div className={`px-4 py-4 mobile-tab-fade-in`}>
                <div className="space-y-2">
                  {filteredUnscheduledTasks.filter(t => !t.isExample).length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-6">
                      <div className={`relative w-16 h-16 rounded-2xl ${darkMode ? 'bg-emerald-500/15' : 'bg-emerald-50'} flex items-center justify-center mb-4`}>
                        <Inbox size={28} className={`${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
                        {unscheduledTasks.filter(t => !t.isExample).length === 0 && (
                          <Check size={14} className={`absolute -top-1 -right-1 ${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
                        )}
                      </div>
                      <p className={`text-base font-semibold ${textPrimary} mb-1`}>
                        {unscheduledTasks.filter(t => !t.isExample).length === 0
                          ? "Inbox zero"
                          : nonOverdueInboxTasks.filter(t => !t.isExample).length === 0
                            ? "All overdue"
                            : "No matches"}
                      </p>
                      <p className={`text-sm ${textSecondary} text-center mb-5`}>
                        {unscheduledTasks.filter(t => !t.isExample).length === 0
                          ? "Add tasks here to schedule later"
                          : nonOverdueInboxTasks.filter(t => !t.isExample).length === 0
                            ? "All inbox tasks have overdue deadlines"
                            : "No tasks match the current filter"}
                      </p>
                      {unscheduledTasks.filter(t => !t.isExample).length === 0 && (
                        <button
                          onClick={openNewInboxTask}
                          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${darkMode ? 'bg-emerald-500 text-white active:bg-emerald-600' : 'bg-emerald-500 text-white active:bg-emerald-600'} transition-colors`}
                        >
                          <Plus size={16} />
                          Add task
                        </button>
                      )}
                    </div>
                  ) : (
                    filteredUnscheduledTasks.filter(t => !t.isExample).map(task => (
                      <div key={task.id} className="notes-panel-container">
                        <div className={`relative rounded-lg ${showDeadlinePicker === task.id ? '' : 'overflow-hidden'}`}>
                          {/* Swipe action strips - hidden until swipe direction determined */}
                          <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-green-900/80 text-green-300' : 'bg-green-100 text-green-600'} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                            <Calendar size={14} className="mr-1" />Schedule
                          </div>
                          <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                            Edit<Settings size={14} className="ml-1" />
                          </div>
                        <div
                          className={`relative select-none ${task.color} rounded-lg px-3 py-4 shadow-sm ${task.completed ? 'opacity-50' : ''} ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                          onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'inbox')}
                          onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                          onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'inbox')}
                        >
                          {task.isExample && (
                            <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                              Example
                            </span>
                          )}
                          <div className="text-white">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-2 flex-1 min-w-0">
                                <button
                                  onClick={() => toggleComplete(task.id, true)}
                                  className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                >
                                  {task.completed && <Check size={10} strokeWidth={3} />}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div
                                    className={`font-medium text-sm ${task.completed ? 'line-through' : ''}`}
                                    onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      startEditingTask(task, true);
                                    }}
                                  >
                                    {renderTitle(task.title)}
                                  </div>
                                  <div className="text-xs opacity-90 mt-1 flex items-center gap-2">
                                    <span>{task.duration} min</span>
                                    {task.deadline && (
                                      <span className="flex items-center gap-1">
                                        <AlertCircle size={10} />
                                        {formatDeadlineDate(task.deadline)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onMouseDown={() => {
                                    if (isLinkOnlyTask(task)) {
                                      longPressTriggeredRef.current = false;
                                      longPressTimerRef.current = setTimeout(() => {
                                        longPressTriggeredRef.current = true;
                                        setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                      }, 500);
                                    }
                                  }}
                                  onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                  onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isLinkOnlyTask(task)) {
                                      if (!longPressTriggeredRef.current) {
                                        window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                      }
                                      longPressTriggeredRef.current = false;
                                    } else {
                                      setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                    }
                                  }}
                                  className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                >
                                  {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                </button>
                                <div className="deadline-picker-container relative">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowDeadlinePicker(showDeadlinePicker === task.id ? null : task.id);
                                    }}
                                    className={`hover:bg-white/20 rounded p-1 transition-colors ${task.deadline ? 'bg-white/20' : ''}`}
                                    title={task.deadline ? `Deadline: ${formatDeadlineDate(task.deadline)}` : 'Set deadline'}
                                  >
                                    <Calendar size={14} />
                                  </button>
                                  {showDeadlinePicker === task.id && (
                                    <DeadlinePickerPopover
                                      taskId={task.id}
                                      currentDeadline={task.deadline}
                                      onClose={() => setShowDeadlinePicker(null)}
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex justify-end mt-1.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cyclePriority(task.id);
                                }}
                                className="flex gap-0.5 hover:bg-white/20 rounded px-1.5 py-1 transition-colors"
                              >
                                {[0, 1, 2].map(i => (
                                  <span
                                    key={i}
                                    className={`w-2 h-0.5 rounded-full bg-white ${i < (pendingPriorities[task.id] ?? task.priority ?? 0) ? 'opacity-100' : 'opacity-30'}`}
                                  />
                                ))}
                              </button>
                            </div>
                          </div>
                        </div>
                        </div>{/* end swipe wrapper */}
                      </div>
                    ))
                  )}
                </div>

                {/* Mobile notes panel overlay for inbox tasks */}
                {expandedNotesTaskId && (() => {
                  const noteTask = filteredUnscheduledTasks.find(t => t.id === expandedNotesTaskId);
                  if (!noteTask) return null;
                  return (
                    <div className="notes-panel-container fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setExpandedNotesTaskId(null)}>
                      <div className="bg-black/30 absolute inset-0" />
                      <div
                        className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[60vh] overflow-y-auto`}
                        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
                          <div className={`font-medium ${textPrimary} truncate flex-1`}>{noteTask.title}</div>
                          <button onClick={() => setExpandedNotesTaskId(null)} className={`p-1 rounded-lg ${hoverBg} transition-colors`} aria-label="Close notes">
                            <X size={18} className={textSecondary} />
                          </button>
                        </div>
                        <div className="p-4">
                          <NotesSubtasksPanel
                            task={noteTask}
                            isInbox={true}
                            darkMode={darkMode}
                            updateTaskNotes={updateTaskNotes}
                            addSubtask={addSubtask}
                            toggleSubtask={toggleSubtask}
                            deleteSubtask={deleteSubtask}
                            updateSubtaskTitle={updateSubtaskTitle}
                            noAutoFocus
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {mobileActiveTab === 'routines' && (
              <div className={`px-4 py-4 mobile-tab-fade-in`}>
                {(() => {
                  const today = new Date();
                  const todayDayName = getDayName(today);
                  const weekDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
                  const todayIdx = weekDays.indexOf(todayDayName);
                  const rotatedDays = todayIdx >= 0 ? [...weekDays.slice(todayIdx), ...weekDays.slice(0, todayIdx)] : weekDays;
                  const allBuckets = ['everyday', ...rotatedDays];
                  const bucketLabel = (b) => b === 'everyday' ? 'Every Day' : b.charAt(0).toUpperCase() + b.slice(1);
                  const isHighlighted = (b) => b === todayDayName || b === 'everyday';

                  const hasAnyChips = Object.values(routineDefinitions).some(arr => arr.some(c => !String(c.id).startsWith('example-')));

                  return (
                    <div className="space-y-3">
                      {/* Today's selected routine */}
                      <div className={`rounded-lg border-2 border-dashed ${darkMode ? 'border-gray-600' : 'border-gray-300'} p-4`}>
                        <div className={`text-xs font-semibold uppercase tracking-wide mb-3 ${textSecondary} text-center`}>Today's Routine</div>
                        {dashboardSelectedChips.filter(c => !String(c.id).startsWith('example-')).length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 justify-center">
                            {dashboardSelectedChips.filter(c => !String(c.id).startsWith('example-')).map(chip => {
                              const isFocused = routineFocusedChipId === chip.id;
                              return (
                              <div
                                key={chip.id}
                                className={`group relative rounded-full px-3 py-1.5 text-xs font-medium cursor-pointer ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'}`}
                                onClick={() => {
                                  if (isPhone || isTablet) {
                                    if (isFocused) {
                                      setRoutineTimePickerChipId(chip.id);
                                      setRoutineFocusedChipId(null);
                                    } else {
                                      setRoutineFocusedChipId(chip.id);
                                    }
                                  } else {
                                    setRoutineTimePickerChipId(chip.id);
                                  }
                                }}
                              >
                                <span className="flex items-center gap-1">
                                  {chip.name}
                                  {chip.startTime && (
                                    <>
                                      <Clock size={10} className="ml-0.5" />
                                      <span className="opacity-90">{formatTime(chip.startTime)}</span>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDashboardSelectedChips(prev => prev.map(c => c.id === chip.id ? { ...c, startTime: null } : c));
                                        }}
                                        className="hover:opacity-100 opacity-60 transition-opacity"
                                        title="Clear time"
                                      >
                                        <X size={10} />
                                      </button>
                                    </>
                                  )}
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setDashboardSelectedChips(prev => prev.filter(c => c.id !== chip.id)); setRoutineFocusedChipId(null); }}
                                  className={`absolute -top-1.5 -right-1.5 transition-opacity ${darkMode ? 'bg-gray-500 text-white' : 'bg-gray-400 text-white'} rounded-full w-4 h-4 flex items-center justify-center ${
                                    (isPhone || isTablet) ? (isFocused ? 'opacity-100' : 'opacity-0 pointer-events-none') : 'opacity-0 group-hover:opacity-100'
                                  }`}
                                >
                                  <Undo2 size={10} />
                                </button>
                              </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-center py-4">
                            <Sparkles size={28} className={`${textSecondary} mx-auto mb-2 opacity-40`} />
                            <p className={`text-sm ${textSecondary}`}>
                              {hasAnyChips ? 'Tap chips below to add to today' : 'Add routines with the + button below'}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Day buckets */}
                      {allBuckets.map(bucket => {
                        const chips = (routineDefinitions[bucket] || []).filter(c => !String(c.id).startsWith('example-'));
                        return (
                          <div
                            key={bucket}
                            className={`${darkMode ? 'bg-gray-700/50' : 'bg-gray-50'} rounded-lg p-3 ${isHighlighted(bucket) ? (darkMode ? 'ring-2 ring-teal-400 bg-teal-900/20' : 'ring-2 ring-teal-500 bg-teal-50') : ''}`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className={`text-xs font-semibold uppercase tracking-wide ${isHighlighted(bucket) ? 'text-teal-500' : textSecondary}`}>
                                {bucketLabel(bucket)}
                              </span>
                              <button
                                onClick={() => {
                                  setRoutineAddingToBucket(routineAddingToBucket === bucket ? null : bucket);
                                  setRoutineNewChipName('');
                                }}
                                className={`p-0.5 rounded ${hoverBg}`}
                              >
                                <Plus size={14} className={textSecondary} />
                              </button>
                            </div>
                            {routineAddingToBucket === bucket && (
                              <div className="flex gap-1 mb-2">
                                <input
                                  autoFocus
                                  value={routineNewChipName}
                                  onChange={(e) => setRoutineNewChipName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') addRoutineChip(bucket);
                                    if (e.key === 'Escape') { setRoutineAddingToBucket(null); setRoutineNewChipName(''); }
                                  }}
                                  placeholder="Name..."
                                  className={`flex-1 min-w-0 px-2 py-1 text-xs rounded ${darkMode ? 'bg-gray-600 text-white placeholder-gray-400' : 'bg-white text-gray-900 placeholder-gray-400 border border-gray-300'} focus:outline-none focus:ring-1 focus:ring-teal-500`}
                                />
                                <button onClick={() => addRoutineChip(bucket)} className="px-2 py-1 text-xs bg-teal-600 text-white rounded hover:bg-teal-700">Add</button>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-1">
                              {chips.map(chip => {
                                const isSelected = dashboardSelectedChips.some(c => c.id === chip.id);
                                const isFocused = routineFocusedChipId === chip.id;
                                return (
                                  <div
                                    key={chip.id}
                                    onClick={() => {
                                      if (isPhone || isTablet) {
                                        if (isFocused) {
                                          toggleRoutineChipSelection(chip, bucket);
                                          setRoutineFocusedChipId(null);
                                        } else {
                                          setRoutineFocusedChipId(chip.id);
                                        }
                                      } else {
                                        toggleRoutineChipSelection(chip, bucket);
                                      }
                                    }}
                                    className={`group relative rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${
                                      isSelected
                                        ? (darkMode ? 'bg-gray-600 text-gray-400' : 'bg-gray-200 text-gray-400')
                                        : (darkMode ? 'bg-teal-700/80 text-teal-100 hover:bg-teal-600/80' : 'bg-teal-600/80 text-white hover:bg-teal-500/80')
                                    }`}
                                  >
                                    {chip.name}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setRoutineDeleteConfirm({ bucket, chipId: chip.id, chipName: chip.name }); setRoutineFocusedChipId(null); }}
                                      className={`absolute -top-1.5 -right-1.5 transition-opacity bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center ${
                                        (isPhone || isTablet) ? (isFocused ? 'opacity-100' : 'opacity-0 pointer-events-none') : 'opacity-0 group-hover:opacity-100'
                                      }`}
                                    >
                                      <X size={10} />
                                    </button>
                                  </div>
                                );
                              })}
                              {chips.length === 0 && routineAddingToBucket !== bucket && (
                                <span className={`text-xs ${textSecondary} italic`}>No routines</span>
                              )}
                            </div>
                          </div>
                        );
                      })}

                    </div>
                  );
                })()}
              </div>
            )}

            {mobileActiveTab === 'settings' && (
              <div className={`relative overflow-hidden mobile-tab-fade-in`}>
                {/* Main settings view */}
                <div
                  className={`px-4 py-4 space-y-4 transition-transform duration-200 ${mobileSettingsView !== 'main' ? '-translate-x-full' : 'translate-x-0'}`}
                  style={{ display: mobileSettingsView !== 'main' ? 'none' : undefined }}
                >
                  {/* Quick toggles */}
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => setDarkMode(!darkMode)}
                      className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
                    >
                      {darkMode ? <Sun size={24} className="text-amber-400" /> : <Moon size={24} className={textSecondary} />}
                      <span className={`text-xs font-medium ${textPrimary}`}>{darkMode ? 'Light' : 'Dark'}</span>
                    </button>
                    <button
                      onClick={() => setSoundEnabled(!soundEnabled)}
                      className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
                    >
                      {soundEnabled ? <Volume2 size={24} className="text-green-500" /> : <VolumeX size={24} className={textSecondary} />}
                      <span className={`text-xs font-medium ${textPrimary}`}>Sound {soundEnabled ? 'On' : 'Off'}</span>
                    </button>
                    <button
                      onClick={() => setUse24HourClock(!use24HourClock)}
                      className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
                    >
                      <Clock size={24} className={textSecondary} />
                      <span className={`text-xs font-medium ${textPrimary}`}>{use24HourClock ? '24h' : '12h'}</span>
                    </button>
                  </div>

                  {/* Sync buttons */}
                  {(syncUrl || taskCalendarUrl || cloudSyncConfig?.enabled) && (
                    <div className="space-y-2">
                      <h3 className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} px-1`}>Sync</h3>
                      {(syncUrl || taskCalendarUrl) && (
                        <button
                          onClick={() => { if (!isSyncing) syncAll(); }}
                          disabled={isSyncing}
                          className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3 ${isSyncing ? 'opacity-70' : ''}`}
                        >
                          <div className="relative">
                            <RefreshCw size={20} className={`${textSecondary} ${isSyncing ? 'animate-spin' : ''}`} />
                            <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                              isSyncing ? 'bg-blue-500 animate-pulse' : calSyncStatus === 'error' ? 'bg-red-500' : 'bg-green-500'
                            }`} />
                          </div>
                          <span className={`font-medium ${textPrimary}`}>Sync Calendars</span>
                        </button>
                      )}
                      {cloudSyncConfig?.enabled && (
                        <button
                          onClick={() => cloudSyncUpload()}
                          className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
                        >
                          <div className="relative">
                            <Cloud size={20} className={`${textSecondary} ${(cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading') ? 'animate-pulse' : ''}`} />
                            <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                              (cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading') ? 'bg-blue-500 animate-pulse' : cloudSyncStatus === 'error' ? 'bg-red-500' : 'bg-green-500'
                            }`} />
                          </div>
                          <span className={`font-medium ${textPrimary}`}>Cloud Sync</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Stats */}
                  <div className="space-y-2">
                    <h3 className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} px-1`}>Stats</h3>
                    <button
                      onClick={() => setMobileSettingsView('stats')}
                      className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
                    >
                      <TrendingUp size={20} className={textSecondary} />
                      <span className={`font-medium ${textPrimary} flex-1 text-left`}>All Time Summary</span>
                      <ChevronRight size={18} className={textSecondary} />
                    </button>
                  </div>

                  {/* Sub-menu buttons */}
                  <div className="space-y-2">
                    <h3 className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} px-1`}>More</h3>
                    <button
                      onClick={() => setMobileSettingsView('app')}
                      className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
                    >
                      <Settings size={20} className={textSecondary} />
                      <span className={`font-medium ${textPrimary} flex-1 text-left`}>App Settings</span>
                      <ChevronRight size={18} className={textSecondary} />
                    </button>
                    <button
                      onClick={() => setMobileSettingsView('notifications')}
                      className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
                    >
                      <Bell size={20} className={textSecondary} />
                      <span className={`font-medium ${textPrimary} flex-1 text-left`}>Notifications</span>
                      <ChevronRight size={18} className={textSecondary} />
                    </button>
                    <button
                      onClick={() => setMobileSettingsView('backups')}
                      className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
                    >
                      <Save size={20} className={textSecondary} />
                      <span className={`font-medium ${textPrimary} flex-1 text-left`}>Backups</span>
                      <ChevronRight size={18} className={textSecondary} />
                    </button>
                  </div>
                  <div className={`text-center text-[10px] ${textSecondary} opacity-50 pt-2`}>
                    Build: {typeof __BUILD_TIMESTAMP__ !== 'undefined' ? new Date(__BUILD_TIMESTAMP__).toLocaleString() : 'dev'}
                  </div>
                </div>

                {/* Stats sub-view */}
                {mobileSettingsView === 'stats' && (
                  <div className="px-4 py-4 space-y-4 mobile-tab-fade-in">
                    <button
                      onClick={() => setMobileSettingsView('main')}
                      className={`flex items-center gap-2 ${textSecondary} active:opacity-70`}
                    >
                      <ChevronLeft size={18} />
                      <span className="text-sm font-medium">Settings</span>
                    </button>
                    <h2 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
                      <TrendingUp size={20} /> All Time Summary
                    </h2>
                    <div className={`${cardBg} border ${borderClass} rounded-xl p-4`}>
                      <div className={`space-y-3 text-sm ${textSecondary}`}>
                        <div className="flex justify-between">
                          <span>Tasks scheduled</span>
                          <span className={`font-medium ${textPrimary}`}>{allTimeScheduledCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Tasks completed</span>
                          <span className={`font-medium ${textPrimary}`}>
                            {allTimeCompletedCount}
                            {allTimeIncompleteTasks.length > 0 && (
                              <button
                                onClick={() => setShowIncompleteTasks('allTime')}
                                className="ml-1 text-blue-500 active:text-blue-600"
                              >
                                ({allTimeIncompleteTasks.length} incomplete)
                              </button>
                            )}
                          </span>
                        </div>
                        {allTimeInboxCompletedCount > 0 && (
                          <div className="flex justify-between">
                            <span>Inbox tasks done</span>
                            <span className={`font-medium ${textPrimary}`}>{allTimeInboxCompletedCount}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span>Time spent</span>
                          <span className={`font-medium ${textPrimary}`}>{Math.floor((totalCompletedMinutes + allTimeInboxCompletedMinutes) / 60)}h {(totalCompletedMinutes + allTimeInboxCompletedMinutes) % 60}m</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Time planned</span>
                          <span className={`font-medium ${textPrimary}`}>{Math.floor(totalScheduledMinutes / 60)}h {totalScheduledMinutes % 60}m</span>
                        </div>
                        {allTimeFocusMinutes > 0 && (
                          <div className="flex justify-between">
                            <span>Focus time</span>
                            <span className={`font-medium ${textPrimary}`}>{Math.floor(allTimeFocusMinutes / 60)}h {Math.round(allTimeFocusMinutes % 60)}m</span>
                          </div>
                        )}
                        {allTimeScheduledCount > 0 && (
                          <div className={`flex justify-between pt-2 border-t ${borderClass}`}>
                            <span className="font-semibold">Completion rate</span>
                            <span className={`font-bold ${textPrimary}`}>{Math.round(((allTimeCompletedCount + allTimeInboxCompletedCount) / allTimeScheduledCount) * 100)}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* App Settings sub-view */}
                {mobileSettingsView === 'app' && (() => {
                  const currentProvider = cloudSyncConfig?.provider || 'nextcloud';
                  const provider = cloudSyncProviders[currentProvider];
                  return (
                  <div className="px-4 py-4 space-y-4">
                    <button
                      onClick={() => setMobileSettingsView('main')}
                      className={`flex items-center gap-2 ${textSecondary} mb-2`}
                    >
                      <ChevronLeft size={18} />
                      <span className="text-sm font-medium">App Settings</span>
                    </button>

                    {/* Calendar Sync */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <RefreshCw size={16} className={textSecondary} />
                        Calendar Sync
                      </h4>
                      <div>
                        <label className={`block text-sm ${textSecondary} mb-1`}>Calendar URL (iCal/CalDAV)</label>
                        <input
                          type="url"
                          placeholder="https://..."
                          value={syncUrl}
                          onChange={(e) => setSyncUrl(e.target.value)}
                          className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} text-sm`}
                        />
                      </div>
                      <div>
                        <label className={`block text-sm ${textSecondary} mb-1`}>Task Calendar URL</label>
                        <input
                          type="url"
                          placeholder="https://..."
                          value={taskCalendarUrl}
                          onChange={(e) => setTaskCalendarUrl(e.target.value)}
                          className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} text-sm`}
                        />
                      </div>
                      <button
                        onClick={() => syncAll()}
                        disabled={isSyncing || (!syncUrl && !taskCalendarUrl)}
                        className={`px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm ${(!syncUrl && !taskCalendarUrl) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                        {isSyncing ? 'Syncing...' : 'Sync Now'}
                      </button>
                      {calSyncLastSynced && (
                        <p className={`text-xs ${textSecondary}`}>Last synced: {new Date(calSyncLastSynced).toLocaleString()}</p>
                      )}
                    </div>

                    <hr className={borderClass} />

                    {/* Cloud Sync */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Cloud size={16} className={textSecondary} />
                        Cloud Sync
                      </h4>
                      <p className={`${textSecondary} text-xs`}>Sync all your data as a JSON file to your cloud storage.</p>
                      <CloudSyncSettingsForm
                        darkMode={darkMode}
                        textPrimary={textPrimary}
                        textSecondary={textSecondary}
                        borderClass={borderClass}
                        hoverBg={hoverBg}
                        cloudSyncConfig={cloudSyncConfig}
                        setCloudSyncConfig={setCloudSyncConfig}
                        cloudSyncTest={cloudSyncTest}
                        provider={provider}
                        currentProvider={currentProvider}
                        onClose={() => setMobileSettingsView('main')}
                        cloudSyncLastSynced={cloudSyncLastSynced}
                      />
                    </div>

                    <hr className={borderClass} />

                    {/* iCal Import */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Upload size={16} className={textSecondary} />
                        iCal Import
                      </h4>
                      <label className={`cursor-pointer inline-flex items-center gap-2 px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-lg transition-colors text-sm`}>
                        <Upload size={14} className={textSecondary} />
                        Choose .ics file
                        <input type="file" accept=".ics" onChange={(e) => { handleFileUpload(e); setMobileSettingsView('main'); }} className="hidden" />
                      </label>
                    </div>
                  </div>
                  );
                })()}

                {/* Notifications sub-view */}
                {mobileSettingsView === 'notifications' && (
                  <div className="px-4 py-4 space-y-4">
                    <button
                      onClick={() => setMobileSettingsView('main')}
                      className={`flex items-center gap-2 ${textSecondary} mb-2`}
                    >
                      <ChevronLeft size={18} />
                      <span className="text-sm font-medium">Notifications</span>
                    </button>

                    {/* Master toggle */}
                    <label className="flex items-center gap-3 cursor-pointer">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={reminderSettings.enabled}
                          onChange={(e) => setReminderSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                          className="sr-only"
                        />
                        <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.enabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}>
                          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                        </div>
                      </div>
                      <span className={`text-sm ${textPrimary}`}>Enable reminders</span>
                    </label>

                    {reminderSettings.enabled && (
                      <div className="space-y-4">
                        {/* In-app toasts */}
                        <label className="flex items-center gap-3 cursor-pointer">
                          <div className="relative">
                            <input type="checkbox" checked={reminderSettings.inAppToasts !== false} onChange={(e) => setReminderSettings(prev => ({ ...prev, inAppToasts: e.target.checked }))} className="sr-only" />
                            <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.inAppToasts !== false ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}>
                              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.inAppToasts !== false ? 'translate-x-5' : 'translate-x-1'}`} />
                            </div>
                          </div>
                          <span className={`text-sm ${textPrimary}`}>In-app toasts</span>
                        </label>

                        {/* Browser notifications */}
                        <label className="flex items-center gap-3 cursor-pointer">
                          <div className="relative">
                            <input type="checkbox" checked={reminderSettings.browserNotifications} onChange={(e) => {
                              const val = e.target.checked;
                              if (val && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
                              setReminderSettings(prev => ({ ...prev, browserNotifications: val }));
                            }} className="sr-only" />
                            <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.browserNotifications ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}>
                              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.browserNotifications ? 'translate-x-5' : 'translate-x-1'}`} />
                            </div>
                          </div>
                          <div>
                            <span className={`text-sm ${textPrimary}`}>Browser notifications</span>
                            <p className={`text-xs ${textSecondary}`}>
                              {typeof Notification !== 'undefined'
                                ? Notification.permission === 'granted' ? 'Permission granted'
                                : Notification.permission === 'denied' ? 'Permission denied'
                                : 'Will request permission when enabled'
                                : 'Not supported'}
                            </p>
                          </div>
                        </label>

                        {/* Presets */}
                        <div>
                          <p className={`text-xs font-medium ${textSecondary} mb-2`}>Presets</p>
                          <div className="flex gap-2">
                            {[['standard', 'Standard'], ['aggressive', 'Aggressive'], ['minimal', 'Minimal']].map(([key, label]) => (
                              <button
                                key={key}
                                onClick={() => applyReminderPreset(key)}
                                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                                  reminderSettings.preset === key ? 'bg-blue-600 text-white' : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'} ${hoverBg}`
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                            {reminderSettings.preset === 'custom' && (
                              <span className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white">Custom</span>
                            )}
                          </div>
                        </div>

                        {/* Per-category grids */}
                        {[
                          ['calendarEvents', 'Calendar Events'],
                          ['calendarTasks', 'Calendar Tasks'],
                          ['scheduledTasks', 'Scheduled Tasks'],
                          ['recurringTasks', 'Recurring Tasks'],
                        ].map(([catKey, catLabel]) => (
                          <div key={catKey}>
                            <p className={`text-xs font-medium ${textSecondary} mb-1.5`}>{catLabel}</p>
                            <div className="flex gap-1.5 flex-wrap">
                              {[['before15', '-15m'], ['before10', '-10m'], ['before5', '-5m'], ['atStart', 'Start'], ['atEnd', 'End']].map(([field, label]) => (
                                <button
                                  key={field}
                                  onClick={() => updateCategoryReminder(catKey, field, !reminderSettings.categories[catKey]?.[field])}
                                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                                    reminderSettings.categories[catKey]?.[field] ? 'bg-blue-600 text-white' : `${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'} ${hoverBg}`
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}

                        {/* All-day tasks */}
                        <div>
                          <p className={`text-xs font-medium ${textSecondary} mb-1.5`}>All-Day Tasks</p>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={reminderSettings.categories.allDayTasks?.morningReminder ?? true}
                                onChange={(e) => updateCategoryReminder('allDayTasks', 'morningReminder', e.target.checked)}
                                className="rounded border-gray-300"
                              />
                              <span className={`text-xs ${textPrimary}`}>Morning reminder at</span>
                            </label>
                            <button
                              type="button"
                              onClick={() => setShowMorningTimePicker(true)}
                              className={`text-xs px-2 py-1 rounded border ${darkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'}`}
                            >
                              {formatTime(reminderSettings.morningReminderTime)}
                            </button>
                          </div>
                        </div>

                        {/* Weekly Review */}
                        <div className={`border-t ${borderClass} pt-4`}>
                          <div className="flex items-center gap-2 mb-3">
                            <BarChart3 size={16} className="text-purple-500" />
                            <span className={`text-sm font-semibold ${textPrimary}`}>Weekly Review</span>
                          </div>
                          <label className="flex items-center gap-3 cursor-pointer mb-3">
                            <div className="relative">
                              <input type="checkbox" checked={reminderSettings.weeklyReview?.enabled ?? true} onChange={(e) => setReminderSettings(prev => ({ ...prev, weeklyReview: { ...prev.weeklyReview, enabled: e.target.checked } }))} className="sr-only" />
                              <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.weeklyReview?.enabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}>
                                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.weeklyReview?.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                              </div>
                            </div>
                            <span className={`text-sm ${textPrimary}`}>Notify me for weekly review</span>
                          </label>
                          {reminderSettings.weeklyReview?.enabled && (
                            <div className="space-y-3 ml-1">
                              <div>
                                <p className={`text-xs ${textSecondary} mb-1.5`}>Day</p>
                                <div className="flex gap-1 flex-wrap">
                                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => (
                                    <button
                                      key={label}
                                      onClick={() => setReminderSettings(prev => ({ ...prev, weeklyReview: { ...prev.weeklyReview, day: i } }))}
                                      className={`px-2 py-1 text-xs rounded-full transition-colors ${
                                        reminderSettings.weeklyReview.day === i ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className={`text-xs ${textSecondary} mb-1.5`}>Time</p>
                                <button
                                  type="button"
                                  onClick={() => setShowWeeklyReviewTimePicker(true)}
                                  className={`text-xs px-2 py-1 rounded border ${darkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'}`}
                                >
                                  {formatTime(reminderSettings.weeklyReview.time)}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Backups sub-view */}
                {mobileSettingsView === 'backups' && (
                  <div className="px-4 py-4 space-y-4">
                    <button
                      onClick={() => setMobileSettingsView('main')}
                      className={`flex items-center gap-2 ${textSecondary} mb-2`}
                    >
                      <ChevronLeft size={18} />
                      <span className="text-sm font-medium">Backups</span>
                    </button>

                    {/* Export / Restore */}
                    <div className="space-y-3">
                      <button
                        onClick={() => exportBackup()}
                        className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} rounded-lg text-left transition-colors`}
                      >
                        <div className="font-medium flex items-center gap-2">
                          <Upload size={16} className="rotate-180" />
                          Export Backup
                        </div>
                        <div className={`text-sm ${textSecondary}`}>Download all tasks and settings as JSON</div>
                      </button>
                      <label className={`block w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} rounded-lg text-left transition-colors cursor-pointer`}>
                        <div className="font-medium flex items-center gap-2">
                          <Upload size={16} />
                          Restore Backup
                        </div>
                        <div className={`text-sm ${textSecondary}`}>Load data from a backup file</div>
                        <input type="file" accept=".json" onChange={handleBackupFileSelect} className="hidden" />
                      </label>
                    </div>

                    <hr className={borderClass} />

                    {/* Auto-Backup settings inline */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Clock size={16} className={textSecondary} />
                        Auto-Backup
                        {(autoBackupConfig.local.enabled || autoBackupConfig.remote.enabled) && (
                          <span className="ml-auto text-xs px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded">Active</span>
                        )}
                      </h4>
                      <AutoBackupSettingsForm
                        config={autoBackupConfig}
                        setConfig={setAutoBackupConfig}
                        status={autoBackupStatus}
                        darkMode={darkMode}
                        textPrimary={textPrimary}
                        textSecondary={textSecondary}
                        borderClass={borderClass}
                        hoverBg={hoverBg}
                        onRemoteBackupNow={performRemoteBackup}
                      />
                    </div>

                    <hr className={borderClass} />

                    {/* Backup history */}
                    <div className="space-y-3">
                      <button
                        onClick={() => { loadAutoBackupHistory(); }}
                        className={`px-4 py-2 text-sm ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-lg transition-colors`}
                      >
                        Load Backup History
                      </button>
                      {autoBackupHistory.local.length > 0 && (
                        <div>
                          <h4 className={`text-xs font-semibold ${textSecondary} uppercase mb-2`}>Local ({autoBackupHistory.local.length})</h4>
                          <div className="space-y-1">
                            {autoBackupHistory.local.map(b => (
                              <div key={b.id} className={`flex items-center justify-between py-2 px-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-gray-50'}`}>
                                <div className="min-w-0 flex-1">
                                  <p className={`text-sm ${textPrimary} truncate`}>{new Date(b.timestamp).toLocaleString()}</p>
                                  <p className={`text-xs ${textSecondary}`}>{b.frequency}</p>
                                </div>
                                <div className="flex items-center gap-1 ml-2 shrink-0">
                                  <button onClick={() => setAutoBackupRestoreConfirm({ type: 'local', id: b.id, timestamp: b.timestamp })} className={`p-1.5 rounded ${hoverBg}`}><Undo2 size={14} className={textSecondary} /></button>
                                  <button onClick={() => deleteLocalAutoBackup(b.id)} className={`p-1.5 rounded ${hoverBg}`}><Trash2 size={14} className={textSecondary} /></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {autoBackupConfig.remote.enabled && autoBackupHistory.remote.length > 0 && (
                        <div>
                          <h4 className={`text-xs font-semibold ${textSecondary} uppercase mb-2`}>Remote ({autoBackupHistory.remote.length})</h4>
                          <div className="space-y-1">
                            {autoBackupHistory.remote.map(b => (
                              <div key={b.filename} className={`flex items-center justify-between py-2 px-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-gray-50'}`}>
                                <div className="min-w-0 flex-1">
                                  <p className={`text-sm ${textPrimary} truncate`}>{b.lastModified ? new Date(b.lastModified).toLocaleString() : b.filename}</p>
                                </div>
                                <div className="flex items-center gap-1 ml-2 shrink-0">
                                  <button onClick={() => setAutoBackupRestoreConfirm({ type: 'remote', filename: b.filename, timestamp: b.lastModified })} className={`p-1.5 rounded ${hoverBg}`}><Undo2 size={14} className={textSecondary} /></button>
                                  <button onClick={() => deleteRemoteAutoBackup(b.filename)} className={`p-1.5 rounded ${hoverBg}`}><Trash2 size={14} className={textSecondary} /></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* FAB - Floating Action Button */}
          {(mobileActiveTab === 'timeline' || mobileActiveTab === 'inbox') && (
            <button
              onClick={() => mobileActiveTab === 'timeline' ? openNewTaskForm() : openNewInboxTask()}
              className="fixed right-4 z-40 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 active:bg-blue-800 flex items-center justify-center transition-colors"
              style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
            >
              <Plus size={28} />
            </button>
          )}

          {/* Glance tab FABs - stacked on right: Weekly Review (bottom), Daily Stats (above weekly), Recycle Bin (top) */}
          {mobileActiveTab === 'dayglance' && (
            <>
              {/* Daily summary ring FAB */}
              {actualTodayNonImportedTasks.length > 0 && (() => {
                const pct = Math.round(((actualTodayCompletedTasks.length + inboxCompletedTodayCount) / actualTodayNonImportedTasks.length) * 100);
                const ringColor = pct >= 100 ? 'stroke-green-500' : pct >= 50 ? 'stroke-amber-500' : 'stroke-red-500';
                return (
                  <button
                    onClick={() => setShowMobileDailySummary(true)}
                    className={`fixed right-4 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 active:bg-gray-600' : 'bg-white active:bg-gray-100'} border ${borderClass}`}
                    style={{ bottom: 'calc(8.5rem + env(safe-area-inset-bottom, 0px))' }}
                  >
                    <div className="relative w-11 h-11">
                      <svg viewBox="0 0 36 36" className="w-11 h-11 -rotate-90">
                        <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" className={darkMode ? 'stroke-gray-600' : 'stroke-gray-200'} />
                        <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" strokeLinecap="round" className={ringColor}
                          strokeDasharray={`${(pct / 100) * 87.96} 87.96`}
                        />
                      </svg>
                      <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${textPrimary}`}>
                        <ChevronUp size={16} />
                      </span>
                    </div>
                  </button>
                );
              })()}
              {/* Weekly review FAB */}
              <button
                onClick={() => {
                  if (showWeeklyReviewReminder) {
                    weeklyReviewDismissedRef.current = lastWeeklyReviewFiredRef.current;
                    localStorage.setItem('day-planner-weekly-review-dismissed', lastWeeklyReviewFiredRef.current);
                    setShowWeeklyReviewReminder(false);
                  }
                  setShowWeeklyReview(true);
                }}
                className={`fixed right-4 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${showWeeklyReviewReminder ? 'bg-blue-600 text-white active:bg-blue-700' : darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-gray-200 text-gray-600 active:bg-gray-300'}`}
                style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
              >
                <BarChart3 size={22} />
              </button>
              {/* Recycle bin FAB */}
              {recycleBin.filter(t => !t.isExample).length > 0 && (
                <button
                  onClick={() => setShowMobileRecycleBin(true)}
                  className={`fixed right-4 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-gray-200 text-gray-600 active:bg-gray-300'}`}
                  style={{ bottom: 'calc(12.5rem + env(safe-area-inset-bottom, 0px))' }}
                >
                  <div className="relative">
                    <Trash2 size={22} />
                    <span className="absolute -top-2 -right-3 bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
                      {recycleBin.filter(t => !t.isExample).length > 9 ? '9+' : recycleBin.filter(t => !t.isExample).length}
                    </span>
                  </div>
                </button>
              )}
            </>
          )}

          {/* Mobile Recycle Bin Bottom Sheet */}
          {showMobileRecycleBin && (
            <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileRecycleBin(false)}>
              <div className="bg-black/30 absolute inset-0" />
              <div
                className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[70vh] flex flex-col`}
                style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-gray-300'}`} />
                </div>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Trash2 size={18} className={textSecondary} />
                    <span className={`font-semibold ${textPrimary}`}>Recycle Bin</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'}`}>
                      {recycleBin.filter(t => !t.isExample).length}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {recycleBin.filter(t => !t.isExample).length > 0 && (
                      <button
                        onClick={emptyRecycleBin}
                        className="text-xs text-red-500 font-medium px-2 py-1 rounded-lg hover:bg-red-500/5 active:bg-red-500/10 dark:hover:bg-red-500/10 dark:active:bg-red-500/20 transition-colors"
                      >
                        Empty All
                      </button>
                    )}
                    <button
                      onClick={() => setShowMobileRecycleBin(false)}
                      className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-100 hover:bg-gray-200'} transition-colors`}
                      aria-label="Close recycle bin"
                    >
                      <X size={16} className={textSecondary} />
                    </button>
                  </div>
                </div>
                {/* Task list */}
                <div className="overflow-y-auto px-4 pb-2 space-y-2">
                  {recycleBin.filter(t => !t.isExample).length === 0 ? (
                    <p className={`text-sm ${textSecondary} text-center py-8`}>Recycle bin is empty</p>
                  ) : (
                    recycleBin.filter(t => !t.isExample).map(task => (
                      <div
                        key={`mobile-bin-${task.id}`}
                        className={`${task.color} rounded-lg p-3 opacity-60`}
                      >
                        <div className="flex items-start justify-between text-white">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{renderTitle(task.title)}</div>
                            <div className="text-xs opacity-75 mt-1">
                              {task._deletedFrom === 'inbox' ? (
                                <>Inbox • {task.duration}min</>
                              ) : task.startTime ? (
                                <>{formatTime(task.startTime)} • {task.duration}min</>
                              ) : (
                                <>{task.duration}min</>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => { undeleteTask(task.id); if (recycleBin.filter(t => !t.isExample).length <= 1) setShowMobileRecycleBin(false); }}
                              className="bg-white/20 rounded-lg p-1.5 hover:bg-white/25 active:bg-white/30 transition-colors"
                              title="Restore"
                            >
                              <Undo2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Mobile Tag Filter Bottom Sheet */}
          {showMobileTagFilter && (
            <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileTagFilter(false)}>
              <div className="bg-black/30 absolute inset-0" />
              <div
                className={`relative ${cardBg} rounded-t-2xl shadow-xl`}
                style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-gray-300'}`} />
                </div>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Filter size={18} className={textSecondary} />
                    <span className={`font-semibold ${textPrimary}`}>Filter by Tag</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {allTags.every(tag => selectedTags.includes(tag)) ? (
                      <button
                        onClick={clearTagFilter}
                        className="text-sm text-blue-500 hover:text-blue-600 active:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 dark:active:text-blue-200 font-medium transition-colors"
                      >
                        Clear
                      </button>
                    ) : (
                      <button
                        onClick={selectAllTags}
                        className="text-sm text-blue-500 hover:text-blue-600 active:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 dark:active:text-blue-200 font-medium transition-colors"
                      >
                        Select All
                      </button>
                    )}
                    <button
                      onClick={() => setShowMobileTagFilter(false)}
                      className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-100 hover:bg-gray-200'} transition-colors`}
                      aria-label="Close tag filter"
                    >
                      <X size={16} className={textSecondary} />
                    </button>
                  </div>
                </div>
                {/* Tag list */}
                <div className="px-4 pb-4 space-y-1 max-h-[50vh] overflow-y-auto">
                  {allTags.map(tag => {
                    const visibleDateStrs = new Set(visibleDates.map(d => dateToString(d)));
                    const regularCount = tasks.filter(t => !t.imported && visibleDateStrs.has(t.date) && extractTags(t.title).includes(tag)).length;
                    const recurringCount = expandedRecurringTasks.filter(t => visibleDateStrs.has(t.date) && extractTags(t.title).includes(tag)).length;
                    const tagCount = regularCount + recurringCount;
                    if (tagCount === 0) return null;
                    return (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
                          selectedTags.includes(tag)
                            ? darkMode ? 'bg-blue-500/20' : 'bg-blue-50'
                            : darkMode ? 'active:bg-white/5' : 'active:bg-gray-50'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                          selectedTags.includes(tag)
                            ? 'bg-blue-500 border-blue-500'
                            : darkMode ? 'border-gray-600' : 'border-gray-300'
                        }`}>
                          {selectedTags.includes(tag) && <Check size={14} className="text-white" />}
                        </div>
                        <Hash size={14} className={textSecondary} />
                        <span className={`flex-1 text-left text-sm ${textPrimary}`}>{tag}</span>
                        <span className={`text-xs ${textSecondary} tabular-nums`}>{tagCount}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Mobile Daily Summary Bottom Sheet */}
          {showMobileDailySummary && (
            <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileDailySummary(false)}>
              <div className="bg-black/30 absolute inset-0" />
              <div
                className={`relative ${cardBg} rounded-t-2xl shadow-xl`}
                style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-gray-300'}`} />
                </div>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={18} className={textSecondary} />
                    <span className={`font-semibold ${textPrimary}`}>Daily Summary</span>
                  </div>
                  <button
                    onClick={() => setShowMobileDailySummary(false)}
                    className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-100 hover:bg-gray-200'} transition-colors`}
                    aria-label="Close daily summary"
                  >
                    <X size={16} className={textSecondary} />
                  </button>
                </div>
                {/* Stats */}
                <div className="px-4 pb-4">
                  {actualTodayNonImportedTasks.length === 0 ? (
                    <p className={`text-sm ${textSecondary} text-center py-4`}>No tasks scheduled for today</p>
                  ) : (() => {
                    const pct = Math.round(((actualTodayCompletedTasks.length + inboxCompletedTodayCount) / actualTodayNonImportedTasks.length) * 100);
                    const ringColor = pct >= 100 ? 'stroke-green-500' : pct >= 50 ? 'stroke-amber-500' : 'stroke-red-500';
                    return (
                    <>
                      {/* Progress ring + headline */}
                      <div className="flex items-center gap-4 mb-4">
                        <div className="relative w-16 h-16 flex-shrink-0">
                          <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                            <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className={darkMode ? 'stroke-gray-700' : 'stroke-gray-200'} />
                            <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" strokeLinecap="round" className={ringColor}
                              strokeDasharray={`${(pct / 100) * 97.4} 97.4`}
                            />
                          </svg>
                          <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${textPrimary}`}>
                            {pct}%
                          </span>
                        </div>
                        <div>
                          <div className={`text-lg font-bold ${textPrimary}`}>{actualTodayCompletedTasks.length} of {actualTodayNonImportedTasks.length} done</div>
                          {todayIncompleteTasks.length > 0 && (
                            <button
                              onClick={() => { setShowIncompleteTasks('today'); setShowMobileDailySummary(false); }}
                              className="text-sm text-blue-500 active:text-blue-600"
                            >
                              {todayIncompleteTasks.length} incomplete
                            </button>
                          )}
                          {inboxCompletedTodayCount > 0 && (
                            <div className={`text-sm ${textSecondary}`}>+ {inboxCompletedTodayCount} inbox {inboxCompletedTodayCount === 1 ? 'task' : 'tasks'} done</div>
                          )}
                        </div>
                      </div>
                      {/* Stat rows */}
                      <div className={`space-y-3 ${textSecondary}`}>
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2"><Clock size={14} className="text-orange-400" /> Time spent</div>
                          <span className={`font-medium ${textPrimary}`}>{Math.floor((actualTodayCompletedMinutes + inboxCompletedTodayMinutes) / 60)}h {(actualTodayCompletedMinutes + inboxCompletedTodayMinutes) % 60}m</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2"><Clock size={14} className="text-blue-400" /> Time planned</div>
                          <span className={`font-medium ${textPrimary}`}>{Math.floor(actualTodayPlannedMinutes / 60)}h {actualTodayPlannedMinutes % 60}m</span>
                        </div>
                        {actualTodayFocusMinutes > 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2"><BrainCircuit size={14} className="text-purple-400" /> Focus time</div>
                            <span className={`font-medium ${textPrimary}`}>{Math.floor(actualTodayFocusMinutes / 60)}h {Math.round(actualTodayFocusMinutes % 60)}m</span>
                          </div>
                        )}
                      </div>
                    </>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Bottom Tab Bar */}
          <div
            className={`fixed bottom-0 left-0 right-0 z-40 ${cardBg} border-t ${borderClass}`}
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <div className="flex items-center justify-around h-14">
              <button
                onClick={() => {
                  if (mobileActiveTab === 'routines') handleRoutinesDone();
                  setMobileActiveTab('dayglance');
                  setMobileSettingsView('main');
                }}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full ${mobileActiveTab === 'dayglance' ? 'text-blue-500' : textSecondary}`}
              >
                <Eye size={20} />
                <span className="text-[10px] font-medium">Glance</span>
              </button>
              <button
                onClick={() => {
                  if (mobileActiveTab === 'routines') handleRoutinesDone();
                  if (mobileActiveTab !== 'timeline') goToToday();
                  setMobileActiveTab('timeline');
                  setMobileSettingsView('main');
                }}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full ${mobileActiveTab === 'timeline' ? (todayAgenda.some(t => {
                  if (t.completed || t._agendaType !== 'scheduled') return false;
                  const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
                  const [h, m] = (t.startTime || '0:0').split(':').map(Number);
                  return (h * 60 + m + (t.duration || 0)) <= nowMin;
                }) ? 'text-red-500' : 'text-blue-500') : textSecondary}`}
              >
                <div className="relative">
                  <Calendar size={20} />
                  {(() => {
                    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
                    const overdueCount = todayAgenda.filter(t => {
                      if (t.completed || t._agendaType !== 'scheduled') return false;
                      const [h, m] = (t.startTime || '0:0').split(':').map(Number);
                      return (h * 60 + m + (t.duration || 0)) <= nowMin;
                    }).length;
                    return overdueCount > 0 ? (
                      <span className="absolute -top-1.5 -right-2.5 bg-red-600 text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1">
                        {overdueCount > 9 ? '9+' : overdueCount}
                      </span>
                    ) : null;
                  })()}
                </div>
                <span className="text-[10px] font-medium">Timeline</span>
              </button>
              <button
                onClick={() => {
                  if (mobileActiveTab === 'routines') handleRoutinesDone();
                  setMobileActiveTab('inbox');
                  setMobileSettingsView('main');
                }}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative ${mobileActiveTab === 'inbox' ? 'text-blue-500' : textSecondary}`}
              >
                <div className="relative">
                  <Inbox size={20} />
                  {filteredUnscheduledTasks.filter(t => !t.isExample).length > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 bg-blue-600 text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1">
                      {filteredUnscheduledTasks.filter(t => !t.isExample).length}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium">Inbox</span>
              </button>
              <button
                onClick={() => {
                  setMobileActiveTab('routines');
                  setMobileSettingsView('main');
                  setDashboardSelectedChips(todayRoutines.map(r => ({ id: r.id, name: r.name, bucket: r.bucket, startTime: r.startTime || null })));
                  setRoutineAddingToBucket(null);
                  setRoutineNewChipName('');
                }}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full ${mobileActiveTab === 'routines' ? 'text-blue-500' : textSecondary}`}
              >
                <Sparkles size={20} />
                <span className="text-[10px] font-medium">Routines</span>
              </button>
              <button
                onClick={() => {
                  if (mobileActiveTab === 'routines') handleRoutinesDone();
                  setMobileActiveTab('settings');
                }}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full ${mobileActiveTab === 'settings' ? 'text-blue-500' : textSecondary}`}
              >
                <Settings size={20} />
                <span className="text-[10px] font-medium">Settings</span>
              </button>
            </div>
          </div>
        </>
      ) : (
      <>
      {/* Desktop & Tablet Layout */}
      {!isTablet && (
      <div className={`${cardBg} border-b ${borderClass}`}>
        <div className="max-w-[2000px] mx-auto px-6 py-4">
          <div className="flex gap-4">
            {/* Sidebar area - date navigator centered with Today button below */}
            <div className={`${sidebarCollapsed ? 'w-[59px]' : 'w-72'} flex-shrink-0 transition-[width] duration-200 relative`} style={{ height: '76px' }}>
              {/* Collapsed date navigator */}
              <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${sidebarCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <button onClick={() => changeDate(-1)} className={`p-0.5 rounded ${hoverBg}`}>
                  <ChevronLeft size={16} className={textSecondary} />
                </button>
                <button
                  onClick={goToToday}
                  className={`p-1 rounded ${hoverBg}`}
                  title="Go to today"
                >
                  <Calendar size={20} className={textSecondary} />
                </button>
                <button onClick={() => changeDate(1)} className={`p-0.5 rounded ${hoverBg}`}>
                  <ChevronRight size={16} className={textSecondary} />
                </button>
              </div>

              {/* Expanded date navigator */}
              <div className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-200 ${sidebarCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                <div className="flex items-center gap-2 relative">
                    <button onClick={() => changeDate(-1)} className={`p-1 rounded ${hoverBg} flex-shrink-0`}>
                      <ChevronLeft size={20} className={textSecondary} />
                    </button>
                    <button
                      onClick={() => {
                        if (!showMonthView) setViewedMonth(new Date(selectedDate));
                        setShowMonthView(!showMonthView);
                      }}
                      className={`month-view-toggle ${textPrimary} font-bold text-lg hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1 transition-colors cursor-pointer min-w-[220px] text-center`}
                    >
                      {formatDateRange(visibleDates)}
                    </button>
                    <button onClick={() => changeDate(1)} className={`p-1 rounded ${hoverBg} flex-shrink-0`}>
                      <ChevronRight size={20} className={textSecondary} />
                    </button>

                    {/* Month View Popup */}
                    {showMonthView && (
                      <div className={`month-view-container absolute top-full left-1/2 -translate-x-1/2 mt-2 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-4 z-50 min-w-[300px]`}>
                        <div className="flex items-center justify-between mb-3">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); changeViewedMonth(-1); }}
                            className={`p-1 rounded ${hoverBg}`}
                          >
                            <ChevronLeft size={18} className={textSecondary} />
                          </button>
                          <div className={`font-bold ${textPrimary}`}>
                            {viewedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); changeViewedMonth(1); }}
                            className={`p-1 rounded ${hoverBg}`}
                          >
                            <ChevronRight size={18} className={textSecondary} />
                          </button>
                        </div>

                        {/* Day headers */}
                        <div className="grid grid-cols-7 gap-1 mb-2">
                          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                            <div key={day} className={`text-xs font-semibold ${textSecondary} text-center`}>
                              {day}
                            </div>
                          ))}
                        </div>

                        {/* Calendar days */}
                        <div className="grid grid-cols-7 gap-1">
                          {getMonthDays().map((day, index) => {
                            const isDayToday = day && day.toDateString() === new Date().toDateString();
                            const isSelected = day && day.toDateString() === selectedDate.toDateString();
                            const hasTasks = hasTasksOnDate(day);

                            return (
                              <button
                                key={index}
                                onClick={() => day && goToDate(day)}
                                disabled={!day}
                                className={`
                                  h-10 rounded text-sm relative
                                  ${!day ? 'invisible' : ''}
                                  ${isSelected ? 'bg-blue-600 text-white font-bold' : ''}
                                  ${!isSelected && isDayToday ? 'bg-blue-100 dark:bg-blue-900 font-semibold' : ''}
                                  ${!isSelected && !isDayToday ? `${textPrimary} hover:bg-gray-100 dark:hover:bg-gray-700` : ''}
                                  ${!day ? '' : 'cursor-pointer'}
                                `}
                              >
                                {day && day.getDate()}
                                {hasTasks && (
                                  <div className={`absolute bottom-1 left-1/2 transform -translate-x-1/2 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-blue-600'}`} />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                </div>
                <button
                  onClick={goToToday}
                  className="mt-2 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Today
                </button>
              </div>
            </div>
            {/* Calendar area - weather aligned with left edge */}
            <div className="flex-1 flex items-center gap-6">
              {weather && (
                <>
                  {/* Current weather */}
                  <div className={`flex items-center gap-3 px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg`}>
                    <div className="text-2xl">{weather.icon}</div>
                    <div>
                      <div className={`text-lg font-bold ${textPrimary}`}>{weather.temp}°F</div>
                      <div className={`text-xs ${textSecondary}`}>H: {weather.high}° L: {weather.low}°</div>
                    </div>
                  </div>
                  
                  {/* 5-day forecast (hidden in narrow mode) */}
                  {visibleDays > 1 && weather.forecast && weather.forecast.length > 0 && (
                    <div className={`flex items-center gap-2`}>
                      {weather.forecast.map((day, index) => (
                        <div key={index} className={`px-3 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg text-center`}>
                          <div className={`text-xs font-semibold ${textSecondary}`}>{day.day}</div>
                          <div className="text-lg my-1">{day.icon}</div>
                          <div className={`text-xs ${textPrimary}`}>
                            <span className="font-semibold">{day.high}°</span>
                            <span className={`${textSecondary} ml-1`}>{day.low}°</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Rotating Daily Content - shows 2 of 4 content types (widescreen only) */}
              {visibleDays === 3 && (() => {
                const contentItems = [
                  { key: 'dadJoke', icon: '😄', label: 'Dad Joke', content: dailyContent.dadJoke },
                  { key: 'funFact', icon: '💡', label: 'Fun Fact', content: dailyContent.funFact },
                  { key: 'quote', icon: '💬', label: 'Quote', content: dailyContent.quote ? `"${dailyContent.quote.text}" — ${dailyContent.quote.author}` : null },
                  { key: 'history', icon: '📜', label: 'This Day in History', content: dailyContent.history ? `${dailyContent.history.year}: ${dailyContent.history.text}` : null }
                ].filter(item => item.content);

                if (contentItems.length === 0) return null;

                const idx1 = contentRotation % contentItems.length;
                const idx2 = (contentRotation + 1) % contentItems.length;
                const visibleItems = contentItems.length === 1 ? [contentItems[0]] : [contentItems[idx1], contentItems[idx2]];

                return visibleItems.map(item => (
                  <div key={item.key} className={`flex-1 max-w-lg h-[92px] px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg overflow-hidden`}>
                    <div className={`text-xs font-semibold ${textSecondary} mb-1`}>{item.icon} {item.label}</div>
                    <div className={`text-sm ${textPrimary} leading-snug line-clamp-3`}>{item.content}</div>
                  </div>
                ));
              })()}

              <div className="flex items-center gap-1 ml-auto">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        if (isSyncing) return;
                        if (syncUrl || taskCalendarUrl) {
                          syncAll();
                        } else {
                          setShowSettings(true);
                        }
                      }}
                      disabled={isSyncing}
                      className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg} ${isSyncing ? 'opacity-70 cursor-not-allowed' : ''}`}
                      title={isSyncing ? "Syncing..." : ((syncUrl || taskCalendarUrl) ? `Sync calendars${calSyncLastSynced ? ` — last: ${new Date(calSyncLastSynced).toLocaleTimeString()}` : ''}` : "Configure calendar sync")}
                    >
                      <RefreshCw size={18} className={`${textSecondary} ${isSyncing ? 'animate-spin' : ''}`} />
                      {(syncUrl || taskCalendarUrl) && (
                        <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                          isSyncing ? 'bg-blue-500 animate-pulse' :
                          calSyncStatus === 'success' ? 'bg-green-500' :
                          calSyncStatus === 'error' ? 'bg-red-500' :
                          'bg-green-500'
                        }`} />
                      )}
                    </button>
                    <button
                      onClick={() => setShowSettings(true)}
                      className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg}`}
                      title="Settings"
                    >
                      <Settings size={18} className={textSecondary} />
                    </button>
                    <button
                      onClick={() => setDarkMode(!darkMode)}
                      className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg}`}
                      title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                    >
                      {darkMode ? <Sun size={18} className={textSecondary} /> : <Moon size={18} className={textSecondary} />}
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        if (cloudSyncConfig?.enabled) {
                          cloudSyncUpload();
                        } else {
                          setShowSettings(true);
                        }
                      }}
                      className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg}`}
                      title={cloudSyncConfig?.enabled
                        ? (cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading' ? 'Syncing...' : `Cloud sync — last: ${cloudSyncLastSynced ? new Date(cloudSyncLastSynced).toLocaleTimeString() : 'never'}`)
                        : 'Set up cloud sync'}
                    >
                      <Cloud size={18} className={`${textSecondary} ${(cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading') ? 'animate-pulse' : ''}`} />
                      {cloudSyncConfig?.enabled && (
                        <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                          (cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading') ? 'bg-blue-500 animate-pulse' :
                          cloudSyncStatus === 'error' ? 'bg-red-500' :
                          'bg-green-500'
                        }`} />
                      )}
                    </button>
                    <button
                      onClick={() => setShowRemindersSettings(true)}
                      className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg}`}
                      title="Reminders"
                    >
                      <Bell size={18} className={textSecondary} />
                      {activeReminders.length > 0 && (
                        <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} bg-amber-500 animate-pulse`} />
                      )}
                    </button>
                    <button
                      onClick={() => setShowBackupMenu(true)}
                      className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg}`}
                      title="Backup or restore data"
                    >
                      <Save size={18} className={textSecondary} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Tablet header strip */}
      {isTablet && (
        <div className={`${cardBg} border-b ${borderClass} px-4 flex items-center justify-between relative`} style={{ height: '48px' }}>
          <div className="flex items-center">
            <img src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'} alt="dayGLANCE" className="h-10" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-1 pointer-events-auto">
              <button onClick={() => changeDate(-1)} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label="Previous day">
                <ChevronLeft size={20} className={textSecondary} />
              </button>
              <button
                onClick={() => {
                  if (!showMonthView) setViewedMonth(new Date(selectedDate));
                  setShowMonthView(!showMonthView);
                }}
                className={`month-view-toggle ${textPrimary} font-semibold text-base px-2 py-1 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
              >
                {formatDateRange(visibleDates)}
              </button>
              <button onClick={() => changeDate(1)} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label="Next day">
                <ChevronRight size={20} className={textSecondary} />
              </button>
              {dateToString(selectedDate) !== dateToString(new Date()) && (
                <button
                  onClick={goToToday}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded-full hover:bg-blue-700 active:bg-blue-700 transition-colors"
                >
                  Today
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (isSyncing) return;
                if (syncUrl || taskCalendarUrl) {
                  syncAll();
                } else {
                  setShowSettings(true);
                }
              }}
              disabled={isSyncing}
              className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors ${isSyncing ? 'opacity-70' : ''}`}
              title={isSyncing ? "Syncing..." : ((syncUrl || taskCalendarUrl) ? `Sync calendars${calSyncLastSynced ? ` — last: ${new Date(calSyncLastSynced).toLocaleTimeString()}` : ''}` : "Configure calendar sync")}
              aria-label={isSyncing ? "Syncing" : "Sync calendars"}
            >
              <RefreshCw size={18} className={`${textSecondary} ${isSyncing ? 'animate-spin' : ''}`} />
              {(syncUrl || taskCalendarUrl) && (
                <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                  isSyncing ? 'bg-blue-500 animate-pulse' :
                  calSyncStatus === 'success' ? 'bg-green-500' :
                  calSyncStatus === 'error' ? 'bg-red-500' :
                  'bg-green-500'
                }`} />
              )}
            </button>
            <button
              onClick={() => {
                if (cloudSyncConfig?.enabled) {
                  cloudSyncUpload();
                } else {
                  setShowSettings(true);
                }
              }}
              className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
              title={cloudSyncConfig?.enabled
                ? (cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading' ? 'Syncing...' : `Cloud sync — last: ${cloudSyncLastSynced ? new Date(cloudSyncLastSynced).toLocaleTimeString() : 'never'}`)
                : 'Set up cloud sync'}
              aria-label="Cloud sync"
            >
              <Cloud size={18} className={`${textSecondary} ${(cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading') ? 'animate-pulse' : ''}`} />
              {cloudSyncConfig?.enabled && (
                <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                  (cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading') ? 'bg-blue-500 animate-pulse' :
                  cloudSyncStatus === 'error' ? 'bg-red-500' :
                  'bg-green-500'
                }`} />
              )}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
              title="Settings"
              aria-label="Settings"
            >
              <Settings size={18} className={textSecondary} />
            </button>
            <button
              onClick={() => setShowRemindersSettings(true)}
              className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
              title="Reminders"
              aria-label="Reminders"
            >
              <Bell size={18} className={textSecondary} />
              {activeReminders.length > 0 && (
                <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} bg-amber-500 animate-pulse`} />
              )}
            </button>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              {darkMode ? <Sun size={18} className={textSecondary} /> : <Moon size={18} className={textSecondary} />}
            </button>
            <button
              onClick={() => setShowBackupMenu(true)}
              className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
              title="Backup or restore data"
              aria-label="Backup or restore data"
            >
              <Save size={18} className={textSecondary} />
            </button>
          </div>
          {/* Tablet month view popup */}
          {showMonthView && (
            <div className={`month-view-container absolute left-1/2 -translate-x-1/2 top-full mt-1 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-4 z-50 min-w-[300px]`}>
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={(e) => { e.stopPropagation(); changeViewedMonth(-1); }} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label="Previous month">
                  <ChevronLeft size={18} className={textSecondary} />
                </button>
                <div className={`font-bold ${textPrimary}`}>
                  {viewedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </div>
                <button type="button" onClick={(e) => { e.stopPropagation(); changeViewedMonth(1); }} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label="Next month">
                  <ChevronRight size={18} className={textSecondary} />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                  <div key={day} className={`text-xs font-semibold ${textSecondary} text-center`}>{day}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {getMonthDays().map((day, index) => {
                  const isDayToday = day && day.toDateString() === new Date().toDateString();
                  const isSelected = day && day.toDateString() === selectedDate.toDateString();
                  const hasTasks = hasTasksOnDate(day);
                  return (
                    <button
                      key={index}
                      onClick={() => day && goToDate(day)}
                      disabled={!day}
                      className={`h-10 rounded text-sm relative ${!day ? 'invisible' : ''} ${isSelected ? 'bg-blue-600 text-white font-bold' : ''} ${!isSelected && isDayToday ? 'bg-blue-100 dark:bg-blue-900 font-semibold' : ''} ${!isSelected && !isDayToday ? `${textPrimary} active:bg-gray-100 dark:active:bg-gray-700` : ''} ${!day ? '' : 'cursor-pointer'}`}
                    >
                      {day && day.getDate()}
                      {hasTasks && (
                        <div className={`absolute bottom-1 left-1/2 transform -translate-x-1/2 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-blue-600'}`} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content area: sidebar/rail + calendar */}
      <div className={isTablet ? 'flex' : 'max-w-[2000px] mx-auto px-6 py-6'} style={isTablet ? { height: 'calc(100vh - 48px - env(safe-area-inset-top, 0px))' } : undefined}>

        <div className={isTablet ? 'contents' : 'flex gap-4'}>

          {/* Tablet static side panel */}
          {isTablet && (
            <div
              className={`${cardBg} border-r ${borderClass} flex flex-col flex-shrink-0`}
              style={{ width: '320px', height: '100%' }}
            >
              {/* Landscape: tabbed header */}
              {isLandscape && (
                <div className={`flex border-b ${borderClass} flex-shrink-0`}>
                  <button
                    onClick={() => setTabletActiveTab('glance')}
                    className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${tabletActiveTab === 'glance' ? 'text-blue-500 border-b-2 border-blue-500' : textSecondary}`}
                  >
                    <span className="flex items-center justify-center gap-1.5"><Eye size={16} /> Glance</span>
                  </button>
                  <button
                    onClick={() => setTabletActiveTab('inbox')}
                    className={`flex-1 py-3 text-sm font-semibold text-center transition-colors relative ${tabletActiveTab === 'inbox' ? 'text-blue-500 border-b-2 border-blue-500' : textSecondary}`}
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <Inbox size={16} /> Inbox
                      {filteredUnscheduledTasks.filter(t => !t.isExample).length > 0 && (
                        <span className="bg-blue-600 text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1">
                          {filteredUnscheduledTasks.filter(t => !t.isExample).length}
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              )}

              {/* Scrollable content */}
              <div className={`flex-1 overflow-y-auto ${darkMode ? 'dark-scrollbar' : ''}`}>
                {/* Glance section — shown when: portrait (always) or landscape with glance tab active */}
                {(!isLandscape || tabletActiveTab === 'glance') && (
                  <div className="p-4">
                    {/* Portrait: section header */}
                    {!isLandscape && (
                      <h2 className={`font-semibold text-lg ${textPrimary} flex items-center gap-2 mb-4`}>
                        <Eye size={20} className="text-blue-500" /> Glance
                      </h2>
                    )}
                    <div className="space-y-4">
                      {/* Search bar + filter */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setShowSpotlight(true); playUISound('spotlight'); }}
                          className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-gray-400'} transition-colors active:opacity-70`}
                        >
                          <Search size={16} />
                          <span className="text-sm">Search tasks...</span>
                        </button>
                        {allTags.length > 0 && (
                          <button
                            onClick={() => setShowMobileTagFilter(true)}
                            className={`relative flex-shrink-0 px-2.5 self-stretch flex items-center rounded-lg transition-colors ${
                              !allTags.every(tag => selectedTags.includes(tag))
                                ? 'bg-blue-500 text-white'
                                : darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-gray-400'
                            }`}
                          >
                            <Filter size={16} />
                          </button>
                        )}
                      </div>

                      {/* Overdue tasks from past days */}
                      {(() => {
                        const todayStr = getTodayStr();
                        const pastOverdue = getOverdueTasks().filter(t => {
                          if (t._overdueType === 'scheduled') return t.date < todayStr;
                          return true;
                        });
                        if (pastOverdue.length === 0) return null;
                        return (
                          <div className={`rounded-lg border ${darkMode ? 'border-orange-500/40 bg-orange-500/10' : 'border-orange-400/50 bg-orange-50'} overflow-hidden`}>
                            <button
                              onClick={() => toggleSection('overdue')}
                              className="w-full flex items-center justify-between px-3 py-2.5"
                            >
                              <div className="flex items-center gap-2">
                                <AlertTriangle size={15} className="text-orange-500" />
                                <span className="text-sm font-semibold text-orange-500">Overdue</span>
                                <span className={`text-xs px-1.5 py-0.5 rounded-full ${darkMode ? 'bg-orange-500/30 text-orange-300' : 'bg-orange-200 text-orange-700'}`}>
                                  {pastOverdue.length}
                                </span>
                              </div>
                              {minimizedSections.overdue ? <ChevronDown size={16} className="text-orange-500" /> : <ChevronUp size={16} className="text-orange-500" />}
                            </button>
                            {!minimizedSections.overdue && (
                              <div className="px-3 pb-2.5 space-y-1">
                                {pastOverdue.map(task => (
                                  <div
                                    key={`tablet-overdue-${task.id}`}
                                    className={`flex items-center gap-2.5 py-2 px-2 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white/80'}`}
                                  >
                                    <button
                                      onClick={() => toggleComplete(task.id, task._overdueType === 'deadline')}
                                      className={`w-5 h-5 rounded flex-shrink-0 border-2 ${task.completed
                                        ? 'border-orange-400 bg-orange-400'
                                        : darkMode ? 'border-orange-400/60 bg-white/10' : 'border-orange-400/60 bg-white'
                                      } flex items-center justify-center`}
                                    >
                                      {task.completed && <Check size={12} strokeWidth={3} className="text-white" />}
                                    </button>
                                    <div className="flex-1 min-w-0">
                                      <div className={`text-sm font-medium truncate ${task.completed ? 'line-through opacity-50' : textPrimary}`}>
                                        {renderTitle(task.title)}
                                      </div>
                                      <div className={`text-xs ${textSecondary} flex items-center gap-1 mt-0.5`}>
                                        {task._overdueType === 'scheduled' ? (
                                          <><Clock size={10} /> {formatDeadlineDate(task.date)} {!task.isAllDay && `• ${formatTime(task.startTime)}`}</>
                                        ) : (
                                          <><AlertCircle size={10} /> Due: {formatDeadlineDate(task.deadline)}</>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      <button
                                        onClick={() => {
                                          if (task._overdueType === 'scheduled') {
                                            pushUndo();
                                            setTasks(prev => prev.filter(t => t.id !== task.id));
                                            const { startTime, date, duration, _overdueType, ...rest } = task;
                                            setUnscheduledTasks(prev => [...prev, { ...rest, priority: rest.priority || 0 }]);
                                            playUISound('slide');
                                            setUndoToast({ message: 'Moved to inbox', actionable: true });
                                          } else {
                                            clearDeadline(task.id);
                                            playUISound('slide');
                                            setUndoToast({ message: 'Deadline cleared', actionable: true });
                                          }
                                        }}
                                        className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'} active:scale-95 transition-transform`}
                                        title="Move to inbox"
                                      >
                                        <Inbox size={14} />
                                      </button>
                                      <button
                                        onClick={() => moveToRecycleBin(task.id, task._overdueType === 'deadline')}
                                        className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'} active:scale-95 transition-transform`}
                                        title="Move to Recycle Bin"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Today's agenda */}
                      {(() => { const filteredAgenda = filterByTags(todayAgenda); return (
                        <div className="space-y-1.5">
                          {filteredAgenda.length === 0 && (
                            <p className={`text-sm ${textSecondary} text-center py-4`}>No tasks scheduled for today</p>
                          )}
                          {filteredAgenda.flatMap((task, idx) => {
                            const items = [];
                            // Insert "Now" marker (skip when inside a task/event)
                            if (!agendaNowMarker.insideTask) {
                              if (idx === 0 && agendaNowMarker.insertAfterIndex < 0) {
                                const gapH = Math.floor(agendaNowMarker.gapMinutes / 60);
                                const gapM = agendaNowMarker.gapMinutes % 60;
                                const gapStr = gapH > 0 ? `${gapH}h${gapM > 0 ? ` ${gapM}m` : ''}` : `${gapM}m`;
                                items.push(
                                  <div key="tablet-now-marker" className="flex gap-2.5 py-2.5">
                                    <div className="w-1.5 rounded-full flex-shrink-0 bg-red-500" />
                                    <div className="min-w-0 flex-1">
                                      <div className="text-sm font-medium text-red-500">{formatTime(agendaNowMarker.nowTimeStr)}, {gapStr} of free time</div>
                                      {agendaNowMarker.inboxCount > 0 && (
                                        <div className="text-xs italic text-red-500 mt-0.5">Maybe tackle an inbox task?</div>
                                      )}
                                    </div>
                                  </div>
                                );
                              } else if (idx > 0) {
                                const prevTask = filteredAgenda[idx - 1];
                                const prevIdxInFull = todayAgenda.indexOf(prevTask);
                                const curIdxInFull = todayAgenda.indexOf(task);
                                if (prevIdxInFull <= agendaNowMarker.insertAfterIndex && curIdxInFull > agendaNowMarker.insertAfterIndex) {
                                  const gapH = Math.floor(agendaNowMarker.gapMinutes / 60);
                                  const gapM = agendaNowMarker.gapMinutes % 60;
                                  const gapStr = gapH > 0 ? `${gapH}h${gapM > 0 ? ` ${gapM}m` : ''}` : `${gapM}m`;
                                  items.push(
                                    <div key="tablet-now-marker" className="flex gap-2.5 py-2.5">
                                      <div className="w-1.5 rounded-full flex-shrink-0 bg-red-500" />
                                      <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-red-500">{formatTime(agendaNowMarker.nowTimeStr)}, {gapStr} of free time</div>
                                        {agendaNowMarker.inboxCount > 0 && (
                                          <div className="text-xs italic text-red-500 mt-0.5">Maybe tackle an inbox task?</div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                }
                              }
                            }
                            const colorClass = task.color === 'task-calendar' ? '' : task.color;
                            const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
                            let timeLabel = '';
                            let relativeLabel = '';
                            if (task._agendaType === 'allday') {
                              timeLabel = 'ALL DAY';
                            } else if (task._agendaType === 'deadline') {
                              timeLabel = 'DUE TODAY';
                            } else {
                              const [h, m] = (task.startTime || '0:0').split(':').map(Number);
                              const startMin = h * 60 + m;
                              const endMin = startMin + (task.duration || 0);
                              const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
                              const endM = String(endMin % 60).padStart(2, '0');
                              timeLabel = `${formatTime(task.startTime)} – ${formatTime(endH + ':' + endM)}`;
                              const diff = startMin - nowMin;
                              if (diff > 0) {
                                relativeLabel = diff >= 60 ? `in ${Math.floor(diff / 60)}h ${diff % 60 > 0 ? `${diff % 60}m` : ''}` : `in ${diff}m`;
                              } else if (diff === 0) {
                                relativeLabel = 'now';
                              } else if (nowMin < endMin && !task.completed) {
                                relativeLabel = 'In Progress';
                              } else if (nowMin >= endMin && !task.completed) {
                                relativeLabel = 'Overdue';
                              }
                            }
                            items.push(
                              <div
                                key={`tablet-glance-${task._agendaType}-${task.id}`}
                                className={`flex gap-2.5 py-2.5 ${task.completed ? 'opacity-50' : ''} cursor-pointer active:bg-white/5 rounded-lg transition-colors`}
                                onClick={() => {
                                  const el = document.querySelector(`[data-task-id="${task.id}"]`);
                                  if (el) {
                                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    el.classList.add('ring-2', 'ring-blue-400');
                                    setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 2000);
                                  }
                                }}
                              >
                                <div className={`w-1.5 rounded-full flex-shrink-0 ${colorClass}`} style={task.isTaskCalendar ? getTaskCalendarStyle(task, darkMode) : {}}></div>
                                <div className="min-w-0 flex-1">
                                  <div className={`text-sm font-semibold ${textPrimary} ${task.completed ? 'line-through' : ''} flex items-center gap-1.5`}>
                                    {task.isRecurring && <RefreshCw size={13} className="flex-shrink-0 opacity-60" />}
                                    <span className="truncate">{renderTitleWithoutTags(task.title)}</span>
                                  </div>
                                  <div className={`text-sm ${textSecondary} flex items-center gap-1`}>
                                    {timeLabel}{relativeLabel ? <>{`, `}<span className={relativeLabel === 'Overdue' ? 'text-orange-500 font-medium' : relativeLabel === 'In Progress' ? 'text-blue-500 font-medium' : ''}>{relativeLabel}</span></> : ''}
                                    {relativeLabel === 'In Progress' && focusModeAvailable && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); enterFocusMode(); }}
                                        className="ml-1 p-1.5 rounded text-purple-500 active:text-purple-400 active:bg-purple-500/20 transition-colors"
                                        title="Enter Focus Mode"
                                      >
                                        <BrainCircuit size={16} className="animate-pulse" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {relativeLabel === 'Overdue' && !task.completed && (
                                  <div className="flex items-center gap-1 flex-shrink-0 mr-5">
                                    {!task.isRecurring && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          pushUndo();
                                          setTasks(prev => prev.filter(t => t.id !== task.id));
                                          const { startTime, date, _agendaType, ...rest } = task;
                                          setUnscheduledTasks(prev => [...prev, { ...rest, priority: rest.priority || 0 }]);
                                          playUISound('slide');
                                          setUndoToast({ message: 'Moved to inbox', actionable: true });
                                        }}
                                        className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'} active:scale-95 transition-transform`}
                                        title="Move to Inbox"
                                      >
                                        <Inbox size={14} />
                                      </button>
                                    )}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); toggleComplete(task.id, false); }}
                                      className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'} active:scale-95 transition-transform`}
                                      title="Mark complete"
                                    >
                                      <CheckCircle size={14} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                            return items;
                          })}
                          {/* Now marker after all tasks */}
                          {filteredAgenda.length > 0 && agendaNowMarker.insertAfterIndex >= todayAgenda.length - 1 && (() => {
                            const hr = currentTime.getHours();
                            const barColor = hr >= 22 ? 'bg-blue-500' : hr >= 19 ? 'bg-green-500' : 'bg-yellow-500';
                            const textColor = hr >= 22 ? 'text-blue-500' : hr >= 19 ? 'text-green-500' : 'text-yellow-600';
                            const subtitle = hr >= 22 ? "Get some rest so you're ready for tomorrow!" : hr >= 19 ? 'Enjoy the evening!' : 'Time to relax or tackle more tasks?';
                            return (
                              <div key="tablet-now-marker-end" className="flex gap-2.5 py-2.5">
                                <div className={`w-1.5 rounded-full flex-shrink-0 ${barColor}`} />
                                <div className="min-w-0 flex-1">
                                  <div className={`text-sm font-medium ${textColor}`}>{formatTime(agendaNowMarker.nowTimeStr)}, all done!</div>
                                  <div className={`text-xs italic ${textColor} mt-0.5`}>{subtitle}</div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      ); })()}

                      {/* Routines row */}
                      {todayRoutines.length > 0 && (() => {
                        const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
                        const visibleRoutines = todayRoutines.filter(r => {
                          if (String(r.id).startsWith('example-')) return false;
                          if (!r.startTime || r.isAllDay) return true;
                          return (timeToMinutes(r.startTime) + r.duration + 60) > nowMin;
                        });
                        if (visibleRoutines.length === 0) return null;
                        return (
                          <div className={`mt-3 pt-3 border-t ${borderClass} cursor-pointer active:opacity-70 transition-opacity`} onClick={() => openRoutinesDashboard()}>
                            <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${textSecondary}`}>Routines</div>
                            <div className="flex flex-wrap gap-1.5">
                              {[...visibleRoutines].sort((a, b) => {
                                if (a.isAllDay && !b.isAllDay) return -1;
                                if (!a.isAllDay && b.isAllDay) return 1;
                                if (a.startTime && b.startTime) return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
                                return 0;
                              }).map(r => {
                                let timeLabel = '';
                                if (!r.isAllDay && r.startTime) {
                                  if (use24HourClock) {
                                    timeLabel = r.startTime;
                                  } else {
                                    const [h, m] = r.startTime.split(':').map(Number);
                                    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                                    const ampm = h < 12 ? 'a' : 'p';
                                    timeLabel = m === 0 ? `${hour12}${ampm}` : `${hour12}:${String(m).padStart(2, '0')}${ampm}`;
                                  }
                                }
                                return (
                                  <span key={r.id} className={`rounded-full px-2.5 py-1 text-xs font-medium ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'}`}>
                                    {timeLabel && <span className="opacity-70 mr-1">{timeLabel}</span>}{r.name}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                    </div>
                  </div>
                )}

                {/* Inbox section — shown when: portrait (always, below glance) or landscape with inbox tab active */}
                {(!isLandscape || tabletActiveTab === 'inbox') && (
                  <div className={`p-4 ${!isLandscape ? `border-t ${borderClass}` : ''}`}>
                    {/* Inbox header with priority filter */}
                    <div className="flex items-center justify-between mb-4">
                      {!isLandscape ? (
                        <h2 className={`font-semibold text-lg ${textPrimary} flex items-center gap-2`}>
                          <Inbox size={20} className="text-blue-500" /> Inbox
                          {filteredUnscheduledTasks.filter(t => !t.isExample).length > 0 && (
                            <span className="bg-blue-600 text-white text-xs font-bold min-w-[20px] h-5 flex items-center justify-center rounded-full px-1.5">
                              {filteredUnscheduledTasks.filter(t => !t.isExample).length}
                            </span>
                          )}
                        </h2>
                      ) : (
                        <button
                          onClick={openNewInboxTask}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium active:bg-blue-700 transition-colors"
                        >
                          <Plus size={14} />
                          New Inbox Task
                        </button>
                      )}
                      <div className="flex items-center gap-2">
                        {!isLandscape && (
                          <button
                            onClick={openNewInboxTask}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium active:bg-blue-700 transition-colors"
                          >
                            <Plus size={12} />
                            New
                          </button>
                        )}
                        <button
                          onClick={() => { setHideCompletedInbox(prev => !prev); playUISound('click'); }}
                          className={`${hoverBg} rounded px-1.5 py-1.5 transition-colors`}
                          title={hideCompletedInbox ? 'Completed tasks hidden (click to show)' : 'Showing completed tasks (click to hide)'}
                        >
                          <CheckCircle size={14} className={hideCompletedInbox ? (darkMode ? 'text-gray-500' : 'text-gray-400') : (darkMode ? 'text-blue-400' : 'text-blue-500')} />
                        </button>
                        <button
                          onClick={() => { setInboxPriorityFilter(prev => (prev + 1) % 4); playUISound('click'); }}
                          className={`flex gap-0.5 ${hoverBg} rounded px-2 py-1.5 transition-colors`}
                          title={inboxPriorityFilter === 0 ? 'Showing all priorities' : `Showing priority ${inboxPriorityFilter}+`}
                        >
                          {[0, 1, 2].map(i => (
                            <span
                              key={i}
                              className={`w-2.5 h-1 rounded-full ${
                                inboxPriorityFilter === 0
                                  ? `${darkMode ? 'bg-gray-500' : 'bg-gray-400'}`
                                  : i < inboxPriorityFilter
                                    ? 'bg-blue-500'
                                    : `${darkMode ? 'bg-gray-600' : 'bg-gray-300'}`
                              }`}
                            />
                          ))}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {filteredUnscheduledTasks.filter(t => !t.isExample).length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 px-6">
                          <div className={`relative w-16 h-16 rounded-2xl ${darkMode ? 'bg-emerald-500/15' : 'bg-emerald-50'} flex items-center justify-center mb-4`}>
                            <Inbox size={28} className={`${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
                            {unscheduledTasks.filter(t => !t.isExample).length === 0 && (
                              <Check size={14} className={`absolute -top-1 -right-1 ${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
                            )}
                          </div>
                          <p className={`text-base font-semibold ${textPrimary} mb-1`}>
                            {unscheduledTasks.filter(t => !t.isExample).length === 0
                              ? "Inbox zero"
                              : nonOverdueInboxTasks.filter(t => !t.isExample).length === 0
                                ? "All overdue"
                                : "No matches"}
                          </p>
                          <p className={`text-sm ${textSecondary} text-center mb-5`}>
                            {unscheduledTasks.filter(t => !t.isExample).length === 0
                              ? "Add tasks here to schedule later"
                              : nonOverdueInboxTasks.filter(t => !t.isExample).length === 0
                                ? "All inbox tasks have overdue deadlines"
                                : "No tasks match the current filter"}
                          </p>
                          {unscheduledTasks.filter(t => !t.isExample).length === 0 && (
                            <button
                              onClick={openNewInboxTask}
                              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${darkMode ? 'bg-emerald-500 text-white active:bg-emerald-600' : 'bg-emerald-500 text-white active:bg-emerald-600'} transition-colors`}
                            >
                              <Plus size={16} />
                              Add task
                            </button>
                          )}
                        </div>
                      ) : (
                        filteredUnscheduledTasks.filter(t => !t.isExample).map(task => (
                          <div key={task.id} className="notes-panel-container">
                            <div className={`relative rounded-lg ${showDeadlinePicker === task.id ? '' : 'overflow-hidden'}`}>
                              {/* Swipe action strips */}
                              <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-green-900/80 text-green-300' : 'bg-green-100 text-green-600'} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                                <Calendar size={14} className="mr-1" />Schedule
                              </div>
                              <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                                Edit<Settings size={14} className="ml-1" />
                              </div>
                            <div
                              className={`relative select-none ${task.color} rounded-lg px-3 py-4 shadow-sm ${task.completed ? 'opacity-50' : ''} ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                              onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'inbox')}
                              onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                              onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'inbox')}
                            >
                              {task.isExample && (
                                <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                                  Example
                                </span>
                              )}
                              <div className="text-white">
                                <div className="flex items-start justify-between">
                                  <div className="flex items-start gap-2 flex-1 min-w-0">
                                    <button
                                      onClick={() => toggleComplete(task.id, true)}
                                      className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                    >
                                      {task.completed && <Check size={10} strokeWidth={3} />}
                                    </button>
                                    <div className="flex-1 min-w-0">
                                      <div
                                        className={`font-medium text-sm ${task.completed ? 'line-through' : ''}`}
                                        onDoubleClick={(e) => {
                                          e.stopPropagation();
                                          startEditingTask(task, true);
                                        }}
                                      >
                                        {renderTitle(task.title)}
                                      </div>
                                      <div className="text-xs opacity-90 mt-1 flex items-center gap-2">
                                        <span>{task.duration} min</span>
                                        {task.deadline && (
                                          <span className="flex items-center gap-1">
                                            <AlertCircle size={10} />
                                            {formatDeadlineDate(task.deadline)}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <button
                                      onMouseDown={() => {
                                        if (isLinkOnlyTask(task)) {
                                          longPressTriggeredRef.current = false;
                                          longPressTimerRef.current = setTimeout(() => {
                                            longPressTriggeredRef.current = true;
                                            setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                          }, 500);
                                        }
                                      }}
                                      onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                      onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (isLinkOnlyTask(task)) {
                                          if (!longPressTriggeredRef.current) {
                                            window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                          }
                                          longPressTriggeredRef.current = false;
                                        } else {
                                          setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                        }
                                      }}
                                      className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                    >
                                      {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                    </button>
                                    <div className="deadline-picker-container relative">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setShowDeadlinePicker(showDeadlinePicker === task.id ? null : task.id);
                                        }}
                                        className={`hover:bg-white/20 rounded p-1 transition-colors ${task.deadline ? 'bg-white/20' : ''}`}
                                        title={task.deadline ? `Deadline: ${formatDeadlineDate(task.deadline)}` : 'Set deadline'}
                                      >
                                        <Calendar size={14} />
                                      </button>
                                      {showDeadlinePicker === task.id && (
                                        <DeadlinePickerPopover
                                          taskId={task.id}
                                          currentDeadline={task.deadline}
                                          onClose={() => setShowDeadlinePicker(null)}
                                        />
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex justify-end mt-1.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cyclePriority(task.id);
                                    }}
                                    className="flex gap-0.5 hover:bg-white/20 rounded px-1.5 py-1 transition-colors"
                                  >
                                    {[0, 1, 2].map(i => (
                                      <span
                                        key={i}
                                        className={`w-2 h-0.5 rounded-full bg-white ${i < (pendingPriorities[task.id] ?? task.priority ?? 0) ? 'opacity-100' : 'opacity-30'}`}
                                      />
                                    ))}
                                  </button>
                                </div>
                              </div>
                            </div>
                            </div>{/* end swipe wrapper */}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Desktop sidebar */}
          {!isTablet && (
          <div className={`${sidebarCollapsed ? 'w-[59px]' : 'w-72'} flex-shrink-0 transition-[width] duration-200 flex flex-col`} style={{ height: '1168px' }}>
            {sidebarCollapsed ? (
              /* Collapsed sidebar - icon-only buttons */
              <div className="flex flex-col gap-2 flex-1">
                {/* Action buttons - matching expanded view */}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={openNewTaskForm}
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="New Scheduled Task"
                  >
                    <Calendar size={24} />
                  </button>
                  <button
                    onClick={openNewInboxTask}
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="New Inbox Task"
                  >
                    <Inbox size={24} />
                  </button>
                  <button
                    onClick={openRoutinesDashboard}
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="Routines"
                  >
                    <Sparkles size={24} />
                  </button>
                  <button
                    onClick={() => { if (showWeeklyReviewReminder) { weeklyReviewDismissedRef.current = lastWeeklyReviewFiredRef.current; localStorage.setItem('day-planner-weekly-review-dismissed', lastWeeklyReviewFiredRef.current); setShowWeeklyReviewReminder(false); } setShowWeeklyReview(true); }}
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="Weekly Review"
                  >
                    <BarChart3 size={24} />
                  </button>
                  <button
                    onClick={() => { setShowSpotlight(true); playUISound('spotlight'); }}
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="Spotlight Search (Ctrl+K)"
                  >
                    <Search size={24} />
                  </button>
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className="w-[51px] h-[51px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="Expand sidebar"
                  >
                    <ChevronsRight size={24} />
                  </button>
                </div>

                {/* Section icons - clicking expands sidebar */}
                <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} w-[51px] py-2 flex flex-col items-center gap-2`}>
                  {(() => {
                    const todayStr = getTodayStr();
                    const pastOverdue = getOverdueTasks().filter(t => {
                      if (t._overdueType === 'scheduled') return t.date < todayStr;
                      return true;
                    });
                    return pastOverdue.length > 0 ? (
                    <button
                      onClick={() => setSidebarCollapsed(false)}
                      className={`p-2 rounded ${hoverBg} relative`}
                      title="Overdue"
                    >
                      <AlertTriangle size={20} className="text-orange-500" />
                      <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {pastOverdue.length > 9 ? '9+' : pastOverdue.length}
                      </span>
                    </button>
                    ) : null;
                  })()}
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className={`p-2 rounded ${hoverBg} relative`}
                    title="Inbox"
                  >
                    <Inbox size={20} className={textSecondary} />
                    {filteredUnscheduledTasks.length > 0 && (
                      <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {filteredUnscheduledTasks.length > 9 ? '9+' : filteredUnscheduledTasks.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className={`p-2 rounded ${hoverBg}`}
                    title="Tags"
                  >
                    <Hash size={20} className={textSecondary} />
                  </button>
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className={`p-2 rounded ${hoverBg}`}
                    title="Daily Summary"
                  >
                    <BarChart3 size={20} className={textSecondary} />
                  </button>
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className={`p-2 rounded ${hoverBg} relative`}
                    title="Recycle Bin"
                  >
                    <Trash2 size={20} className={textSecondary} />
                    {recycleBin.length > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {recycleBin.length > 9 ? '9+' : recycleBin.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              /* Expanded sidebar - full content */
              <div className="flex-1 min-h-0">
                <div className={`h-full overflow-y-auto w-[calc(100%+14px)] ${darkMode ? 'dark-scrollbar' : ''}`}>
                <div className="w-72">
                <div className={`flex gap-1.5 mb-4`}>
                  {/* Calendar - new scheduled task */}
                  <button
                    onClick={openNewTaskForm}
                    className="w-[45px] h-[45px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="New Scheduled Task"
                  >
                    <Calendar size={22} />
                  </button>
                  {/* Inbox - add to inbox */}
                  <button
                    onClick={openNewInboxTask}
                    className="w-[45px] h-[45px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="New Inbox Task"
                  >
                    <Inbox size={22} />
                  </button>
                  {/* Routines */}
                  <button
                    onClick={openRoutinesDashboard}
                    className="w-[45px] h-[45px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="Routines"
                  >
                    <Sparkles size={22} />
                  </button>
                  {/* Weekly Review */}
                  <button
                    onClick={() => { if (showWeeklyReviewReminder) { weeklyReviewDismissedRef.current = lastWeeklyReviewFiredRef.current; localStorage.setItem('day-planner-weekly-review-dismissed', lastWeeklyReviewFiredRef.current); setShowWeeklyReviewReminder(false); } setShowWeeklyReview(true); }}
                    className="w-[45px] h-[45px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="Weekly Review"
                  >
                    <BarChart3 size={22} />
                  </button>
                  {/* Spotlight Search */}
                  <button
                    onClick={() => { setShowSpotlight(true); playUISound('spotlight'); }}
                    className="w-[45px] h-[45px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="Spotlight Search (Ctrl+K)"
                  >
                    <Search size={22} />
                  </button>
                  {/* Collapse sidebar */}
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="w-[33px] h-[45px] flex items-center justify-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="Collapse sidebar"
                  >
                    <ChevronsLeft size={20} />
                  </button>
                </div>

            {/* Getting Started Checklist */}
            {showOnboarding && (
              <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-4`}>
                <div className="flex flex-col items-start mb-3">
                  <img
                    src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'}
                    alt="dayGLANCE"
                    className="h-9 mb-2"
                  />
                  <p className={`text-sm font-semibold ${textPrimary}`}>Let's start with these steps:</p>
                </div>
                <div className="space-y-2">
                  {gettingStartedItems.map(item => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 text-sm ${item.completed ? textSecondary : textPrimary}`}
                    >
                      <div className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center ${
                        item.completed
                          ? 'bg-green-500 text-white'
                          : `border-2 ${darkMode ? 'border-gray-600' : 'border-gray-300'}`
                      }`}>
                        {item.completed && <Check size={10} strokeWidth={3} />}
                      </div>
                      <span className={item.completed ? 'line-through' : ''}>{item.label}</span>
                    </div>
                  ))}
                </div>
                <div className={`mt-3 text-xs ${textSecondary}`}>
                  {gettingStartedItems.filter(i => i.completed).length} of {gettingStartedItems.length} complete
                </div>
                <button
                  onClick={() => {
                    // Skip persisting these changes (for testing - reload will show onboarding again)
                    skipOnboardingPersist.current = true;
                    // Remove all example tasks
                    setTasks(prev => prev.filter(t => !t.isExample));
                    setUnscheduledTasks(prev => prev.filter(t => !t.isExample));
                    setRecycleBin(prev => prev.filter(t => !t.isExample));
                    setRecurringTasks(prev => prev.filter(t => !t.isExample));
                    setTodayRoutines([]);
                    setRoutineDefinitions({ monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [], everyday: [] });
                    // Mark onboarding as complete (hides Getting Started and ? buttons)
                    setOnboardingComplete(true);
                  }}
                  className="mt-4 w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  I'm Good to Go!
                </button>
              </div>
            )}

            {/* Overdue Tasks Section - only past days (today's overdue shown in dayGLANCE) */}
            {(() => {
              const todayStr = getTodayStr();
              const pastOverdue = getOverdueTasks().filter(t => {
                if (t._overdueType === 'scheduled') return t.date < todayStr;
                return true; // deadline overdue are always from past dates
              });
              if (pastOverdue.length === 0) return null;
              return (
              <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} border-orange-500/50 p-4 mb-4`}>
                <div className={`flex items-center justify-between ${minimizedSections.overdue ? '' : 'mb-4'}`}>
                  <h3 className={`font-semibold text-orange-500 flex items-center gap-2`}>
                    <AlertTriangle size={18} />
                    Overdue
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm text-orange-500`}>{pastOverdue.length}</span>
                    <button
                      onClick={() => toggleSection('overdue')}
                      className={`text-orange-500 hover:text-orange-400 transition-colors`}
                      title={minimizedSections.overdue ? "Expand" : "Minimize"}
                    >
                      {minimizedSections.overdue ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                    </button>
                  </div>
                </div>

                {!minimizedSections.overdue && (
                  <div className="space-y-2">
                    {pastOverdue.map(task => (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(task, 'overdue', e)}
                        onDragEnd={handleDragEnd}
                        className={`${task.color} rounded-lg p-3 cursor-move shadow-sm ${task.completed ? 'opacity-50' : ''} relative border-2 border-orange-500/50`}
                      >
                        <div className="flex items-start justify-between text-white">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <button
                              onClick={() => toggleComplete(task.id, task._overdueType === 'deadline')}
                              className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                            >
                              {task.completed && <Check size={10} strokeWidth={3} />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className={`font-medium text-sm ${task.completed ? 'line-through' : ''}`}>
                                {renderTitle(task.title)}
                              </div>
                              <div className="text-xs opacity-90 mt-1 flex items-center gap-1">
                                {task._overdueType === 'scheduled' ? (
                                  <>
                                    <Clock size={10} />
                                    {task.date} {task.isAllDay ? '' : `• ${formatTime(task.startTime)}`}
                                  </>
                                ) : (
                                  <>
                                    <AlertCircle size={10} />
                                    Due: {formatDeadlineDate(task.deadline)}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-start gap-1 flex-shrink-0">
                            {task._overdueType === 'scheduled' ? (
                              <button
                                onClick={() => {
                                  pushUndo();
                                  setTasks(tasks.filter(t => t.id !== task.id));
                                  const { startTime, date, _overdueType, ...taskWithoutSchedule } = task;
                                  setUnscheduledTasks([...unscheduledTasks, { ...taskWithoutSchedule, priority: taskWithoutSchedule.priority || 0 }]);
                                  playUISound('slide');
                                  setUndoToast({ message: 'Moved to inbox', actionable: true });
                                }}
                                className="hover:bg-white/20 rounded p-1"
                                title="Move to Inbox"
                              >
                                <Inbox size={14} />
                              </button>
                            ) : (
                              <button
                                onClick={() => { clearDeadline(task.id); playUISound('slide'); setUndoToast({ message: 'Deadline cleared', actionable: true }); }}
                                className="hover:bg-white/20 rounded p-1"
                                title="Move to Inbox (clear deadline)"
                              >
                                <Inbox size={14} />
                              </button>
                            )}
                            <button
                              onClick={() => moveToRecycleBin(task.id, task._overdueType === 'deadline')}
                              className="hover:bg-white/20 rounded p-1"
                              title="Move to Recycle Bin"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              );
            })()}

            {/* dayGLANCE Agenda Section */}
            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-4`}>
              <div className={`flex items-center justify-between ${minimizedSections.dayglance ? '' : 'mb-3'}`}>
                <img
                  src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'}
                  alt="dayGLANCE"
                  className="h-9"
                />
                <div className="flex items-center gap-2">
                  {!onboardingComplete && dataLoaded && hasZeroRealTasks && !sectionInfoDismissed.dayglance && (
                    <button
                      onClick={() => setExpandedSectionInfo(expandedSectionInfo === 'dayglance' ? null : 'dayglance')}
                      className={`${expandedSectionInfo === 'dayglance' ? 'text-blue-500' : textSecondary} hover:text-blue-500 transition-colors`}
                      title="How dayGLANCE works"
                    >
                      <HelpCircle size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => toggleSection('dayglance')}
                    className={`${textSecondary} hover:${textPrimary} transition-colors`}
                    title={minimizedSections.dayglance ? "Expand" : "Minimize"}
                  >
                    {minimizedSections.dayglance ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>

              {/* dayGLANCE info popup */}
              {expandedSectionInfo === 'dayglance' && (
                <div className={`mb-3 p-3 rounded-lg ${darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-200'}`}>
                  <div className="flex items-start gap-2">
                    <HelpCircle size={18} className={`flex-shrink-0 mt-0.5 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${darkMode ? 'text-blue-200' : 'text-blue-800'}`}>
                        Your Smart Agenda
                      </p>
                      <ul className={`text-xs mt-1 ${darkMode ? 'text-blue-300/80' : 'text-blue-600'} space-y-1 list-disc list-inside`}>
                        <li>Shows all upcoming tasks and events for today</li>
                        <li>Incomplete past tasks stay visible so nothing slips through</li>
                        <li>Tasks show "In Progress" or "Overdue" status in real time</li>
                        <li>Completed and past calendar events are automatically hidden</li>
                      </ul>
                      <button
                        onClick={() => {
                          setExpandedSectionInfo(null);
                          setSectionInfoDismissed(prev => ({ ...prev, dayglance: true }));
                        }}
                        className={`text-xs mt-2 ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'} underline`}
                      >
                        Got it, don't show again
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {!minimizedSections.dayglance && (
                  <div className="space-y-1">
                    {todayAgenda.flatMap((task, idx) => {
                      const items = [];
                      // Insert "Now" marker at the right position (skip when inside a task/event)
                      if (!agendaNowMarker.insideTask && idx === agendaNowMarker.insertAfterIndex + 1) {
                        const gapH = Math.floor(agendaNowMarker.gapMinutes / 60);
                        const gapM = agendaNowMarker.gapMinutes % 60;
                        const gapStr = gapH > 0 ? `${gapH}h${gapM > 0 ? ` ${gapM}m` : ''}` : `${gapM}m`;
                        items.push(
                          <div key="now-marker" className="flex gap-2 py-1.5">
                            <div className="w-1 rounded-full flex-shrink-0 bg-red-500" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium text-red-500">{formatTime(agendaNowMarker.nowTimeStr)}, {gapStr} of free time</div>
                              {agendaNowMarker.inboxCount > 0 && (
                                <div className="text-[10px] italic text-red-500 mt-0.5">Maybe tackle an inbox task?</div>
                              )}
                            </div>
                          </div>
                        );
                      }
                      return [...items, (() => {
                      const colorClass = task.color === 'task-calendar' ? '' : task.color;
                      const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
                      let timeLabel = '';
                      let relativeLabel = '';
                      if (task._agendaType === 'allday') {
                        timeLabel = 'ALL DAY';
                      } else if (task._agendaType === 'deadline') {
                        timeLabel = 'DUE TODAY';
                      } else {
                        const [h, m] = (task.startTime || '0:0').split(':').map(Number);
                        const startMin = h * 60 + m;
                        const endMin = startMin + (task.duration || 0);
                        const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
                        const endM = String(endMin % 60).padStart(2, '0');
                        timeLabel = `${formatTime(task.startTime)} – ${formatTime(endH + ':' + endM)}`;
                        const diff = startMin - nowMin;
                        if (diff > 0) {
                          relativeLabel = diff >= 60 ? `in ${Math.floor(diff / 60)}h ${diff % 60 > 0 ? `${diff % 60}m` : ''}` : `in ${diff}m`;
                        } else if (diff === 0) {
                          relativeLabel = 'now';
                        } else if (nowMin < endMin && !task.completed) {
                          relativeLabel = 'In Progress';
                        } else if (nowMin >= endMin && !task.completed) {
                          relativeLabel = 'Overdue';
                        }
                      }
                      return (
                        <div
                          key={`${task._agendaType}-${task.id}`}
                          className={`flex gap-2 py-1.5 ${task.completed ? 'opacity-50' : ''}`}
                        >
                          <div className={`w-1 rounded-full flex-shrink-0 ${colorClass}`} style={task.isTaskCalendar ? getTaskCalendarStyle(task, darkMode) : {}}></div>
                          <div className="min-w-0 flex-1">
                            <div className={`text-sm font-semibold ${textPrimary} ${task.completed ? 'line-through' : ''} flex items-center gap-1`}>
                              {task.isRecurring && <RefreshCw size={11} className="flex-shrink-0 opacity-60" />}
                              <span className="truncate">{renderTitleWithoutTags(task.title)}</span>
                              {hasNotesOrSubtasks(task) && (
                                <button
                                  onMouseDown={() => {
                                    if (isLinkOnlyTask(task)) {
                                      longPressTriggeredRef.current = false;
                                      longPressTimerRef.current = setTimeout(() => {
                                        longPressTriggeredRef.current = true;
                                        setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                      }, 500);
                                    }
                                  }}
                                  onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                  onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isLinkOnlyTask(task)) {
                                      if (!longPressTriggeredRef.current) {
                                        window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                      }
                                      longPressTriggeredRef.current = false;
                                    } else {
                                      setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                    }
                                  }}
                                  className={`notes-toggle-button flex-shrink-0 rounded p-0.5 transition-colors ${darkMode ? 'hover:bg-white/20 text-gray-400' : 'hover:bg-black/10 text-gray-500'}`}
                                  title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                                >
                                  {isLinkOnlyTask(task) ? <ExternalLink size={12} /> : hasOnlySubtasks(task) ? <CheckSquare size={12} /> : <FileText size={12} />}
                                </button>
                              )}
                              {relativeLabel === 'Overdue' && !task.completed && (
                                <>
                                  {task.isRecurring ? (
                                    <span
                                      className="flex-shrink-0 p-0.5 text-orange-500"
                                      title="Recurring tasks can't be moved to Inbox"
                                    >
                                      <Ban size={12} />
                                    </span>
                                  ) : (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        pushUndo();
                                        setTasks(prev => prev.filter(t => t.id !== task.id));
                                        const { startTime, date, _agendaType, ...rest } = task;
                                        setUnscheduledTasks(prev => [...prev, { ...rest, priority: rest.priority || 0 }]);
                                        playUISound('slide');
                                        setUndoToast({ message: 'Moved to inbox', actionable: true });
                                      }}
                                      className={`flex-shrink-0 rounded p-0.5 transition-colors text-orange-500 ${darkMode ? 'hover:bg-white/20' : 'hover:bg-black/10'}`}
                                      title="Move to Inbox"
                                    >
                                      <Inbox size={12} />
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleComplete(task.id, false);
                                    }}
                                    className={`flex-shrink-0 rounded p-0.5 transition-colors text-green-500 ${darkMode ? 'hover:bg-white/20' : 'hover:bg-black/10'}`}
                                    title="Mark complete"
                                  >
                                    <CheckCircle size={12} />
                                  </button>
                                </>
                              )}
                            </div>
                            <div className={`text-xs ${textSecondary} flex items-center gap-1`}>
                              {timeLabel}{relativeLabel ? <>{`, `}<span className={relativeLabel === 'Overdue' ? 'text-orange-500 font-medium' : relativeLabel === 'In Progress' ? 'text-blue-500 font-medium' : ''}>{relativeLabel}</span></> : ''}
                              {relativeLabel === 'In Progress' && focusModeAvailable && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); enterFocusMode(); }}
                                  className="ml-1 p-0.5 rounded text-purple-500 hover:text-purple-400 hover:bg-purple-500/20 transition-colors"
                                  title="Enter Focus Mode"
                                >
                                  <BrainCircuit size={14} className="animate-pulse" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                      })()];
                    })}
                    {/* Now marker after all tasks (when "now" is past the last scheduled task) */}
                    {agendaNowMarker.insertAfterIndex >= todayAgenda.length - 1 && (() => {
                      const hr = currentTime.getHours();
                      const barColor = hr >= 22 ? 'bg-blue-500' : hr >= 19 ? 'bg-green-500' : 'bg-yellow-500';
                      const textColor = hr >= 22 ? 'text-blue-500' : hr >= 19 ? 'text-green-500' : 'text-yellow-600';
                      const subtitle = hr >= 22 ? "Get some rest so you're ready for tomorrow!" : hr >= 19 ? 'Enjoy the evening!' : 'Time to relax or tackle more tasks?';
                      return (
                        <div key="now-marker-end" className="flex gap-2 py-1.5">
                          <div className={`w-1 rounded-full flex-shrink-0 ${barColor}`} />
                          <div className="min-w-0 flex-1">
                            <div className={`text-xs font-medium ${textColor}`}>{formatTime(agendaNowMarker.nowTimeStr)}, all done!</div>
                            <div className={`text-[10px] italic ${textColor} mt-0.5`}>{subtitle}</div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
              )}
              {/* Routines row */}
              {!minimizedSections.dayglance && todayRoutines.length > 0 && (() => {
                const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
                const visibleRoutines = todayRoutines.filter(r => {
                  if (!r.startTime || r.isAllDay) return true;
                  return (timeToMinutes(r.startTime) + r.duration + 60) > nowMin;
                });
                if (visibleRoutines.length === 0) return null;
                return (
                <div className={`mt-3 pt-3 border-t ${borderClass} cursor-pointer hover:opacity-80 transition-opacity`} onClick={() => openRoutinesDashboard()}>
                  <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${textSecondary}`}>Routines</div>
                  <div className="flex flex-wrap gap-1">
                    {[...visibleRoutines].sort((a, b) => {
                      // All-day first, then by start time
                      if (a.isAllDay && !b.isAllDay) return -1;
                      if (!a.isAllDay && b.isAllDay) return 1;
                      if (a.startTime && b.startTime) return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
                      return 0;
                    }).map(r => {
                      let timeLabel = '';
                      if (!r.isAllDay && r.startTime) {
                        if (use24HourClock) {
                          timeLabel = r.startTime;
                        } else {
                          const [h, m] = r.startTime.split(':').map(Number);
                          const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                          const ampm = h < 12 ? 'a' : 'p';
                          timeLabel = m === 0 ? `${hour12}${ampm}` : `${hour12}:${String(m).padStart(2, '0')}${ampm}`;
                        }
                      }
                      return (
                        <span key={r.id} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'}`}>
                          {timeLabel && <span className="opacity-70 mr-1">{timeLabel}</span>}{r.name}
                        </span>
                      );
                    })}
                  </div>
                </div>
                );
              })()}
            </div>

            <div
              onDragOver={handleDragOverInbox}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) {
                  setDragOverInbox(false);
                }
              }}
              onDrop={handleDropOnInbox}
              className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-4 transition-colors ${dragOverInbox ? (darkMode ? 'bg-green-900/40 ring-2 ring-inset ring-green-400' : 'bg-green-100 ring-2 ring-inset ring-green-500') : ''}`}
            >
              <div className={`flex items-center justify-between ${minimizedSections.inbox ? '' : 'mb-4'}`}>
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Inbox size={18} />
                  Inbox
                  {!minimizedSections.inbox && nonOverdueInboxTasks.filter(t => !t.deadline).length > 0 && (
                    <>
                      <button
                        onClick={() => { setHideCompletedInbox(prev => !prev); playUISound('click'); }}
                        className={`${hoverBg} rounded px-1 py-0.5 transition-colors ml-1`}
                        title={hideCompletedInbox ? 'Completed tasks hidden (click to show)' : 'Showing completed tasks (click to hide)'}
                      >
                        <CheckCircle size={12} className={hideCompletedInbox ? (darkMode ? 'text-gray-500' : 'text-gray-400') : (darkMode ? 'text-blue-400' : 'text-blue-500')} />
                      </button>
                      <button
                        onClick={() => { setInboxPriorityFilter(prev => (prev + 1) % 4); playUISound('click'); }}
                        className={`flex gap-0.5 ${hoverBg} rounded px-1.5 py-1 transition-colors`}
                        title={inboxPriorityFilter === 0 ? 'Showing all priorities (click to filter)' : `Showing priority ${inboxPriorityFilter}+ (click to change)`}
                      >
                        {[0, 1, 2].map(i => (
                          <span
                            key={i}
                            className={`w-2 h-0.5 rounded-full ${
                              inboxPriorityFilter === 0
                                ? `${darkMode ? 'bg-gray-500' : 'bg-gray-400'}`
                                : i < inboxPriorityFilter
                                  ? 'bg-blue-500'
                                  : `${darkMode ? 'bg-gray-600' : 'bg-gray-300'}`
                            }`}
                          />
                        ))}
                      </button>
                    </>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  {filteredUnscheduledTasks.length > 0 && (
                    <span className={`text-sm ${textSecondary}`}>
                      {filteredUnscheduledTasks.length}
                    </span>
                  )}
                  {!onboardingComplete && dataLoaded && hasZeroRealTasks && (
                    <button
                      onClick={() => setExpandedSectionInfo(expandedSectionInfo === 'inbox' ? null : 'inbox')}
                      className={`${expandedSectionInfo === 'inbox' ? 'text-blue-500' : textSecondary} hover:text-blue-500 transition-colors`}
                      title="How to use Inbox"
                    >
                      <HelpCircle size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => toggleSection('inbox')}
                    className={`${textSecondary} hover:${textPrimary} transition-colors`}
                    title={minimizedSections.inbox ? "Expand" : "Minimize"}
                  >
                    {minimizedSections.inbox ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>

              {/* Inbox info popup */}
              {expandedSectionInfo === 'inbox' && (
                <div className={`mb-3 p-3 rounded-lg ${darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-200'}`}>
                  <div className="flex items-start gap-2">
                    <HelpCircle size={18} className={`flex-shrink-0 mt-0.5 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${darkMode ? 'text-blue-200' : 'text-blue-800'}`}>
                        Inbox Tips
                      </p>
                      <ul className={`text-xs mt-1 ${darkMode ? 'text-blue-300/80' : 'text-blue-600'} space-y-1 list-disc list-inside`}>
                        <li>Drag inbox tasks to the timeline to schedule them</li>
                        <li>Set priorities with the bars icon (filter with the header control)</li>
                        <li>Add deadlines by clicking the calendar icon on an inbox task</li>
                        <li>Add notes or subtasks by clicking the paper icon</li>
                      </ul>
                      <button
                        onClick={() => {
                          setExpandedSectionInfo(null);
                          setSectionInfoDismissed(prev => ({ ...prev, inbox: true }));
                        }}
                        className={`text-xs mt-2 ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'} underline`}
                      >
                        Got it, don't show again
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {!minimizedSections.inbox && (
                <>
                  {/* Priority prompt for unprioritized inbox */}
                  {!priorityPromptDismissed &&
                   nonOverdueInboxTasks.filter(t => !t.deadline).length > 5 &&
                   nonOverdueInboxTasks.filter(t => !t.deadline).every(t => !t.priority || t.priority === 0) && (
                    <div className={`mb-3 p-3 rounded-lg ${darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-200'}`}>
                      <div className="flex items-start gap-2">
                        <AlertCircle size={18} className={`flex-shrink-0 mt-0.5 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${darkMode ? 'text-blue-200' : 'text-blue-800'}`}>
                            Prioritize your inbox
                          </p>
                          <p className={`text-xs mt-1 ${darkMode ? 'text-blue-300/80' : 'text-blue-600'}`}>
                            You have {nonOverdueInboxTasks.filter(t => !t.deadline).length} tasks without priorities.
                            Set priorities (click the bars on each task) then use the filter above to focus on what matters most.
                          </p>
                          <button
                            onClick={() => setPriorityPromptDismissed(true)}
                            className={`text-xs mt-2 ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'} underline`}
                          >
                            Don't show again
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                <div className="space-y-2">
                  {filteredUnscheduledTasks.length === 0 ? (
                    <p className={`text-sm ${textSecondary} text-center py-2`}>
                      {unscheduledTasks.length === 0
                        ? "Drag tasks here to unschedule them"
                        : nonOverdueInboxTasks.length === 0
                          ? "All tasks have overdue deadlines"
                          : "No tasks match current filter"}
                    </p>
                  ) : (
                    filteredUnscheduledTasks.map(task => (
                    <div
                      key={task.id}
                      data-task-id={task.id}
                      className="notes-panel-container"
                    >
                      <div
                        draggable
                        onDragStart={(e) => handleDragStart(task, 'inbox', e)}
                        onDragEnd={handleDragEnd}
                        className={`${task.color} rounded-lg p-3 cursor-move shadow-sm ${task.completed ? 'opacity-50' : ''} relative ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                      >
                        {task.isExample && (
                          <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                            Example
                          </span>
                        )}
                        <div className="flex items-start justify-between text-white">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <button
                              onClick={() => toggleComplete(task.id, true)}
                              className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                            >
                              {task.completed && <Check size={10} strokeWidth={3} />}
                            </button>
                            <div className="flex-1 min-w-0">
                              {editingTaskId === task.id ? (
                                <div className="relative tag-autocomplete-container">
                                  <input
                                    type="text"
                                    value={editingTaskText}
                                    onChange={(e) => handleEditInputChange(e, true)}
                                    onKeyDown={(e) => handleEditKeyDown(e, true)}
                                    onBlur={() => {
                                      // Delay blur to allow click on autocomplete
                                      setTimeout(() => {
                                        if (!showSuggestions) {
                                          saveTaskTitle(true);
                                        }
                                      }, 100);
                                    }}
                                    autoFocus
                                    className="w-full bg-white/20 text-white font-medium text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  {showSuggestions && suggestionContext === 'editing' && (
                                    <SuggestionAutocomplete
                                      suggestions={suggestions}
                                      selectedIndex={selectedSuggestionIndex}
                                      onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, true)}
                                    />
                                  )}
                                </div>
                              ) : (
                                <div
                                  className={`font-medium text-sm ${task.completed ? 'line-through' : ''} cursor-text`}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    startEditingTask(task, true);
                                  }}
                                  title="Double-click to edit"
                                >
                                  {renderTitle(task.title)}
                                </div>
                              )}
                              <div className="text-xs opacity-90 mt-1 flex items-center gap-2">
                                <span>{task.duration} min</span>
                                {task.deadline && (
                                  <span className="flex items-center gap-1">
                                    <AlertCircle size={10} />
                                    {formatDeadlineDate(task.deadline)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <div className="flex items-start gap-1">
                              {/* Notes button - opens link directly if link-only, long press to edit */}
                              <button
                                onMouseDown={() => {
                                  if (isLinkOnlyTask(task)) {
                                    longPressTriggeredRef.current = false;
                                    longPressTimerRef.current = setTimeout(() => {
                                      longPressTriggeredRef.current = true;
                                      setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                    }, 500);
                                  }
                                }}
                                onMouseUp={() => {
                                  if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                }}
                                onMouseLeave={() => {
                                  if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isLinkOnlyTask(task)) {
                                    if (!longPressTriggeredRef.current) {
                                      window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                    }
                                    longPressTriggeredRef.current = false;
                                  } else {
                                    setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                  }
                                }}
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                              >
                                {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                              </button>
                              {/* Deadline picker */}
                              <div className="deadline-picker-container relative">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowDeadlinePicker(showDeadlinePicker === task.id ? null : task.id);
                                  }}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${task.deadline ? 'bg-white/20' : ''}`}
                                  title={task.deadline ? `Deadline: ${formatDeadlineDate(task.deadline)}` : 'Set deadline'}
                                >
                                  <Calendar size={14} />
                                </button>
                                {showDeadlinePicker === task.id && (
                                  <DeadlinePickerPopover
                                    taskId={task.id}
                                    currentDeadline={task.deadline}
                                    onClose={() => setShowDeadlinePicker(null)}
                                  />
                                )}
                              </div>
                              <button
                                onClick={() => openMobileEditTask(task, true)}
                                className="hover:bg-white/20 rounded p-1 transition-colors"
                                title="Edit"
                              >
                                <Pencil size={14} />
                              </button>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cyclePriority(task.id);
                              }}
                              className="flex gap-0.5 hover:bg-white/20 rounded px-2 py-1.5 mt-1 transition-colors"
                              title={['No priority', 'Low priority', 'Medium priority', 'High priority'][pendingPriorities[task.id] ?? task.priority ?? 0]}
                            >
                              {[0, 1, 2].map(i => (
                                <span
                                  key={i}
                                  className={`w-2 h-0.5 rounded-full bg-white ${i < (pendingPriorities[task.id] ?? task.priority ?? 0) ? 'opacity-100' : 'opacity-30'}`}
                                />
                              ))}
                            </button>
                          </div>
                        </div>
                        {/* Notes panel - inline below task */}
                        {expandedNotesTaskId === task.id && (
                          <NotesSubtasksPanel
                            task={task}
                            isInbox={true}
                            darkMode={darkMode}
                            updateTaskNotes={updateTaskNotes}
                            addSubtask={addSubtask}
                            toggleSubtask={toggleSubtask}
                            deleteSubtask={deleteSubtask}
                            updateSubtaskTitle={updateSubtaskTitle}
                          />
                        )}
                      </div>
                    </div>
                  ))
                )}
                </div>
                </>
              )}
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <div className={`flex items-center justify-between ${minimizedSections.tags ? '' : 'mb-4'}`}>
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Hash size={18} />
                  Tags
                </h3>
                <div className="flex items-center gap-2">
                  {!minimizedSections.tags && allTags.length > 0 && (
                    allTags.every(tag => selectedTags.includes(tag)) ? (
                      <button
                        onClick={clearTagFilter}
                        className={`text-xs ${textSecondary} hover:${textPrimary} transition-colors`}
                      >
                        Clear
                      </button>
                    ) : (
                      <button
                        onClick={selectAllTags}
                        className={`text-xs ${textSecondary} hover:${textPrimary} transition-colors`}
                      >
                        Select All
                      </button>
                    )
                  )}
                  {!onboardingComplete && dataLoaded && hasZeroRealTasks && (
                    <button
                      onClick={() => setExpandedSectionInfo(expandedSectionInfo === 'tags' ? null : 'tags')}
                      className={`${expandedSectionInfo === 'tags' ? 'text-blue-500' : textSecondary} hover:text-blue-500 transition-colors`}
                      title="How to use Tags"
                    >
                      <HelpCircle size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => toggleSection('tags')}
                    className={`${textSecondary} hover:${textPrimary} transition-colors`}
                    title={minimizedSections.tags ? "Expand" : "Minimize"}
                  >
                    {minimizedSections.tags ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>

              {/* Tags info popup */}
              {expandedSectionInfo === 'tags' && (
                <div className={`mb-3 p-3 rounded-lg ${darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-200'}`}>
                  <div className="flex items-start gap-2">
                    <HelpCircle size={18} className={`flex-shrink-0 mt-0.5 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${darkMode ? 'text-blue-200' : 'text-blue-800'}`}>
                        Tags Tips
                      </p>
                      <ul className={`text-xs mt-1 ${darkMode ? 'text-blue-300/80' : 'text-blue-600'} space-y-1 list-disc list-inside`}>
                        <li>Add #tags in task titles (e.g., "Meeting #work #urgent")</li>
                        <li>Check or uncheck tags to filter the tasks visible on the timeline</li>
                        <li>Tag counts show incomplete tasks only</li>
                      </ul>
                      <button
                        onClick={() => {
                          setExpandedSectionInfo(null);
                          setSectionInfoDismissed(prev => ({ ...prev, tags: true }));
                        }}
                        className={`text-xs mt-2 ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'} underline`}
                      >
                        Got it, don't show again
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {!minimizedSections.tags && (
                <div className={`text-sm ${textSecondary}`}>
                  {allTags.length === 0 ? (
                    <p className="text-center py-2">Add #tags to task titles</p>
                  ) : (
                    <div className="space-y-1">
                      {allTags.map(tag => {
                        const visibleDateStrs = new Set(visibleDates.map(d => dateToString(d)));
                        const regularCount = tasks.filter(t => !t.imported && visibleDateStrs.has(t.date) && extractTags(t.title).includes(tag)).length;
                        const recurringCount = expandedRecurringTasks.filter(t => visibleDateStrs.has(t.date) && extractTags(t.title).includes(tag)).length;
                        const tagCount = regularCount + recurringCount;
                        if (tagCount === 0) return null;
                        return (
                          <label
                            key={tag}
                            className={`flex items-center gap-2 cursor-pointer hover:${textPrimary} transition-colors`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedTags.includes(tag)}
                              onChange={() => toggleTag(tag)}
                              className="rounded"
                            />
                            <span>{tag} <span className={`text-xs ${textSecondary}`}>({tagCount})</span></span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <div className={`flex items-center justify-between ${minimizedSections.dailySummary ? '' : 'mb-2'}`}>
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <BarChart3 size={18} />
                  Daily Summary
                </h3>
                <button
                  onClick={() => toggleSection('dailySummary')}
                  className={`${textSecondary} hover:${textPrimary} transition-colors`}
                  title={minimizedSections.dailySummary ? "Expand" : "Minimize"}
                >
                  {minimizedSections.dailySummary ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
              </div>
              {!minimizedSections.dailySummary && (
                <div className={`text-sm ${textSecondary} space-y-1`}>
                  <div>{actualTodayNonImportedTasks.length} tasks scheduled</div>
                  <div>
                    {actualTodayCompletedTasks.length} tasks completed
                    {todayIncompleteTasks.length > 0 && (
                      <button
                        onClick={() => setShowIncompleteTasks('today')}
                        className="ml-1 text-blue-500 hover:text-blue-400 hover:underline cursor-pointer"
                      >
                        ({todayIncompleteTasks.length} incomplete)
                      </button>
                    )}
                  </div>
                  {inboxCompletedTodayCount > 0 && (
                    <div>{inboxCompletedTodayCount} inbox {inboxCompletedTodayCount === 1 ? 'task' : 'tasks'} done</div>
                  )}
                  <div>{Math.floor((actualTodayCompletedMinutes + inboxCompletedTodayMinutes) / 60)}h {(actualTodayCompletedMinutes + inboxCompletedTodayMinutes) % 60}m time spent</div>
                  <div>{Math.floor(actualTodayPlannedMinutes / 60)}h {actualTodayPlannedMinutes % 60}m time planned</div>
                  {actualTodayFocusMinutes > 0 && (
                    <div className="flex items-center gap-1"><BrainCircuit size={14} /> {Math.floor(actualTodayFocusMinutes / 60)}h {Math.round(actualTodayFocusMinutes % 60)}m focus time</div>
                  )}
                  {actualTodayNonImportedTasks.length > 0 && (
                    <div className="pt-1">
                      <div className="font-semibold">{Math.round(((actualTodayCompletedTasks.length + inboxCompletedTodayCount) / actualTodayNonImportedTasks.length) * 100)}% completion rate</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <div className={`flex items-center justify-between ${minimizedSections.allTimeSummary ? '' : 'mb-2'}`}>
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <BarChart3 size={18} />
                  All Time Summary
                </h3>
                <button
                  onClick={() => toggleSection('allTimeSummary')}
                  className={`${textSecondary} hover:${textPrimary} transition-colors`}
                  title={minimizedSections.allTimeSummary ? "Expand" : "Minimize"}
                >
                  {minimizedSections.allTimeSummary ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
              </div>
              {!minimizedSections.allTimeSummary && (
                <div className={`text-sm ${textSecondary} space-y-1`}>
                  <div>{allTimeScheduledCount} tasks scheduled</div>
                  <div>
                    {allTimeCompletedCount} tasks completed
                    {allTimeIncompleteTasks.length > 0 && (
                      <button
                        onClick={() => setShowIncompleteTasks('allTime')}
                        className="ml-1 text-blue-500 hover:text-blue-400 hover:underline cursor-pointer"
                      >
                        ({allTimeIncompleteTasks.length} incomplete)
                      </button>
                    )}
                  </div>
                  {allTimeInboxCompletedCount > 0 && (
                    <div>{allTimeInboxCompletedCount} inbox {allTimeInboxCompletedCount === 1 ? 'task' : 'tasks'} done</div>
                  )}
                  <div>{Math.floor((totalCompletedMinutes + allTimeInboxCompletedMinutes) / 60)}h {(totalCompletedMinutes + allTimeInboxCompletedMinutes) % 60}m time spent</div>
                  <div>{Math.floor(totalScheduledMinutes / 60)}h {totalScheduledMinutes % 60}m time planned</div>
                  {allTimeFocusMinutes > 0 && (
                    <div className="flex items-center gap-1"><BrainCircuit size={14} /> {Math.floor(allTimeFocusMinutes / 60)}h {Math.round(allTimeFocusMinutes % 60)}m focus time</div>
                  )}
                  {allTimeScheduledCount > 0 && (
                    <div className="pt-1">
                      <div className="font-semibold">{Math.round(((allTimeCompletedCount + allTimeInboxCompletedCount) / allTimeScheduledCount) * 100)}% completion rate</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div
              onDragOver={handleDragOverRecycleBin}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) {
                  setDragOverRecycleBin(false);
                }
              }}
              onDrop={handleDropOnRecycleBin}
              className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4 transition-colors ${dragOverRecycleBin ? (darkMode ? 'bg-red-900/40 ring-2 ring-inset ring-red-400' : 'bg-red-100 ring-2 ring-inset ring-red-500') : ''}`}
            >
              <div className={`flex items-center justify-between ${minimizedSections.recycleBin ? '' : 'mb-4'}`}>
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Trash2 size={18} />
                  Recycle Bin
                </h3>
                <div className="flex items-center gap-2">
                  {recycleBin.length > 0 && (
                    <span className={`text-sm ${textSecondary}`}>{recycleBin.length}</span>
                  )}
                  {!onboardingComplete && dataLoaded && hasZeroRealTasks && (
                    <button
                      onClick={() => setExpandedSectionInfo(expandedSectionInfo === 'recycleBin' ? null : 'recycleBin')}
                      className={`${expandedSectionInfo === 'recycleBin' ? 'text-blue-500' : textSecondary} hover:text-blue-500 transition-colors`}
                      title="How to use Recycle Bin"
                    >
                      <HelpCircle size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => toggleSection('recycleBin')}
                    className={`${textSecondary} hover:${textPrimary} transition-colors`}
                    title={minimizedSections.recycleBin ? "Expand" : "Minimize"}
                  >
                    {minimizedSections.recycleBin ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>

              {/* Recycle Bin info popup */}
              {expandedSectionInfo === 'recycleBin' && (
                <div className={`mb-3 p-3 rounded-lg ${darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-200'}`}>
                  <div className="flex items-start gap-2">
                    <HelpCircle size={18} className={`flex-shrink-0 mt-0.5 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${darkMode ? 'text-blue-200' : 'text-blue-800'}`}>
                        Recycle Bin Tips
                      </p>
                      <ul className={`text-xs mt-1 ${darkMode ? 'text-blue-300/80' : 'text-blue-600'} space-y-1 list-disc list-inside`}>
                        <li>Deleted tasks are kept in the recycle bin for 30 days</li>
                        <li>Drag tasks back to Inbox or timeline to restore</li>
                        <li>Click the restore icon (↩) on any task to restore it</li>
                        <li>Use "Empty Bin" to permanently delete all items</li>
                      </ul>
                      <button
                        onClick={() => {
                          setExpandedSectionInfo(null);
                          setSectionInfoDismissed(prev => ({ ...prev, recycleBin: true }));
                        }}
                        className={`text-xs mt-2 ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'} underline`}
                      >
                        Got it, don't show again
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {!minimizedSections.recycleBin && (
                <>
                  <div className="space-y-2">
                    {recycleBin.length === 0 ? (
                      <p className={`text-sm ${textSecondary} text-center py-2`}>Drag tasks here to delete them</p>
                    ) : (
                      recycleBin.map(task => (
                        <div
                          key={task.id}
                          data-task-id={"bin-" + task.id}
                          draggable
                          onDragStart={(e) => handleDragStart(task, 'recycleBin', e)}
                          onDragEnd={handleDragEnd}
                          className={`${task.color} rounded-lg p-3 shadow-sm opacity-50 relative cursor-move ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                        >
                          {task.isExample && (
                            <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                              Example
                            </span>
                          )}
                          <div className="flex items-start justify-between text-white">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{renderTitle(task.title)}</div>
                                <div className="text-xs opacity-75 mt-1">
                                  {task._deletedFrom === 'inbox' ? (
                                    <>Inbox • {task.duration}min</>
                                  ) : task.startTime ? (
                                    <>{formatTime(task.startTime)} • {task.duration}min</>
                                  ) : (
                                    <>{task.duration}min</>
                                  )}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => undeleteTask(task.id)}
                              className="hover:bg-white/20 rounded p-1 transition-colors"
                              title="Restore Task"
                            >
                              <Undo2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {recycleBin.length > 0 && (
                    <button
                      onClick={emptyRecycleBin}
                      className={`w-full mt-2 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium`}
                    >
                      Empty Recycle Bin
                    </button>
                  )}
                </>
              )}
            </div>
                </div>
                </div>
              </div>
            )}
          </div>
          )}

          {/* Calendar area — shared between desktop and tablet */}
          <div className="flex-1 min-w-0">
            <div
              ref={calendarRef}
              className={`${cardBg} ${isTablet ? '' : 'rounded-lg shadow-sm'} border ${borderClass} overflow-y-scroll overflow-x-hidden ${darkMode ? 'dark-scrollbar' : ''} relative`}
              style={{ height: isTablet ? '100%' : '1168px', ...(isTablet ? { touchAction: 'manipulation' } : {}) }}
            >
              {/* Date headers row - sticky at top */}
              <div ref={(el) => { stickyHeaderRef.current = el; if (isTablet) mobileDateHeaderRef.current = el; }} className={`flex border-b ${borderClass} sticky top-0 z-20 ${cardBg}`}>
                <div className={`w-16 flex-shrink-0 border-r ${borderClass}`}></div>
                {visibleDates.map((date, idx) => {
                  const isDateToday = dateToString(date) === dateToString(new Date());
                  const dateStr = dateToString(date);
                  const isDragOverThis = dragOverAllDay === dateStr;
                  return (
                    <div
                      key={dateStr}
                      className={`flex-1 py-2 px-3 text-center cursor-pointer hover:bg-opacity-80 transition-colors ${idx > 0 ? `border-l ${borderClass}` : ''} ${isDateToday ? (darkMode ? 'bg-blue-900/30 hover:bg-blue-900/50' : 'bg-blue-50 hover:bg-blue-100') : `${cardBg} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`} ${isDragOverThis ? (darkMode ? 'bg-green-700 ring-2 ring-inset ring-green-400' : 'bg-green-200 ring-2 ring-inset ring-green-500') : ''}`}
                      onClick={() => {
                        setNewTask({
                          title: '',
                          startTime: getNextQuarterHour(),
                          duration: 30,
                          date: dateStr,
                          isAllDay: true
                        });
                        setShowAddTask(true);
                      }}
                      onDragOver={(e) => { e.preventDefault(); if (autoScrollInterval.current) { clearInterval(autoScrollInterval.current); autoScrollInterval.current = null; } }}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        setDragOverAllDay(dateStr);
                        setDragPreviewTime(null);
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget)) {
                          setDragOverAllDay(null);
                        }
                      }}
                      onDrop={(e) => handleDropOnDateHeader(e, date)}
                      title={draggedTask ? "Drop to make all-day task" : "Click to add all-day task"}
                    >
                      <div className={`font-bold ${isDateToday ? 'text-blue-600' : textPrimary}`}>
                        {formatShortDate(date)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* All-day tasks section - sticky below date headers */}
              {(visibleDates.some(date => getTasksForDate(date).some(t => t.isAllDay) || getDeadlineTasksForDate(dateToString(date)).length > 0) || todayRoutines.some(r => r.isAllDay)) && (
                <div ref={(el) => { stickyHeaderRef.current = el; if (isTablet) mobileAllDaySectionRef.current = el; }} className={`flex border-b ${borderClass} sticky top-[41px] z-20 ${cardBg}`}>
                  <div className={`w-16 flex-shrink-0 px-3 py-2 text-xs font-semibold ${textSecondary} border-r ${borderClass}`}>
                    ALL DAY
                  </div>
                  {visibleDates.map((date, idx) => {
                    const dayTasks = getTasksForDate(date).filter(t => t.isAllDay);
                    const dateStr = dateToString(date);
                    const deadlineTasks = getDeadlineTasksForDate(dateStr);
                    const isDragOverThis = dragOverAllDay === dateStr;
                    return (
                      <div
                        key={dateStr}
                        className={`flex-1 p-2 space-y-1 ${idx > 0 ? `border-l ${borderClass}` : ''} ${isDragOverThis || (isTablet && mobileDragPreviewTime === 'all-day') ? (darkMode ? 'bg-green-700/50' : 'bg-green-100') : ''}`}
                        onDragOver={(e) => { e.preventDefault(); if (autoScrollInterval.current) { clearInterval(autoScrollInterval.current); autoScrollInterval.current = null; } }}
                        onDragEnter={(e) => {
                          e.preventDefault();
                          setDragOverAllDay(dateStr);
                          setDragPreviewTime(null);
                        }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget)) {
                            setDragOverAllDay(null);
                          }
                        }}
                        onDrop={(e) => handleDropOnDateHeader(e, date)}
                      >
                        {dayTasks.map((task) => {
                          const isImported = task.imported;
                          const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);

                          // Action buttons for all-day tasks
                          const isRecurringAllDay = typeof task.id === 'string' && task.id.startsWith('recurring-');

                          // Notes button for all-day tasks
                          const AllDayNotesButton = ({ inMenu = false }) => (
                              <button
                                onMouseDown={() => {
                                  if (isLinkOnlyTask(task)) {
                                    longPressTriggeredRef.current = false;
                                    longPressTimerRef.current = setTimeout(() => {
                                      longPressTriggeredRef.current = true;
                                      setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                    }, 500);
                                  }
                                }}
                                onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isLinkOnlyTask(task)) {
                                    if (!longPressTriggeredRef.current) {
                                      window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                    }
                                    longPressTriggeredRef.current = false;
                                  } else {
                                    setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                  }
                                }}
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''} ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                              >
                                {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                {inMenu && <span className="text-xs">{isLinkOnlyTask(task) ? 'Open Link' : 'Notes'}</span>}
                              </button>
                          );

                          const AllDayActionButtons = ({ inMenu = false }) => {
                            if (isRecurringAllDay) {
                              // Recurring all-day: Notes, Edit + Delete (desktop only)
                              return (
                                <>
                                  <AllDayNotesButton inMenu={inMenu} />
                                  {!isTablet && (
                                  <button
                                    onClick={() => openMobileEditTask(task, false)}
                                    className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                    title="Edit"
                                  >
                                    <Pencil size={14} />
                                    {inMenu && <span className="text-xs">Edit</span>}
                                  </button>
                                  )}
                                  {!isTablet && (
                                  <button
                                    onClick={() => moveToRecycleBin(task.id)}
                                    className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                    title="Delete"
                                  >
                                    <Trash2 size={14} />
                                    {inMenu && <span className="text-xs">Delete</span>}
                                  </button>
                                  )}
                                </>
                              );
                            }
                            // Non-recurring all-day: Notes, Postpone (all), Edit + Inbox (desktop only)
                            return (
                              <>
                                <AllDayNotesButton inMenu={inMenu} />
                                <button
                                  onClick={() => postponeTask(task.id)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Postpone to tomorrow"
                                >
                                  <SkipForward size={14} />
                                  {inMenu && <span className="text-xs">Postpone</span>}
                                </button>
                                {!isTablet && (
                                <button
                                  onClick={() => openMobileEditTask(task, false)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Edit"
                                >
                                  <Pencil size={14} />
                                  {inMenu && <span className="text-xs">Edit</span>}
                                </button>
                                )}
                                {!isTablet && (
                                <button
                                  onClick={() => moveToInbox(task.id)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Move to Inbox"
                                >
                                  <Inbox size={14} />
                                  {inMenu && <span className="text-xs">To Inbox</span>}
                                </button>
                                )}
                              </>
                            );
                          };

                          // Width-based layout for all-day tasks (no height concern)
                          const allDayTaskWidth = taskWidths[task.id];
                          const useFullLayout = allDayTaskWidth >= 200;

                          return (
                            <div
                              key={task.id}
                              ref={setTaskRef(task.id)}
                              data-task-id={task.id}
                              draggable={!isImported || task.isTaskCalendar}
                              onDragStart={(e) => (!isImported || task.isTaskCalendar) && handleDragStart(task, 'calendar', e)}
                              onDragEnd={handleDragEnd}
                              onDragOver={(e) => { e.preventDefault(); updateDragAutoScroll(e); }}
                              onDragEnter={(e) => {
                                e.preventDefault();
                                setDragOverAllDay(dateStr);
                                setDragPreviewTime(null);
                              }}
                              onDrop={(e) => handleDropOnDateHeader(e, date)}
                              className={`notes-panel-container relative ${isTablet ? 'rounded-lg overflow-hidden' : ''}`}
                            >
                              {/* Tablet swipe strips */}
                              {isTablet && !isImported && (
                                <>
                                  <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${isRecurringAllDay ? (darkMode ? 'bg-red-900/80 text-red-300' : 'bg-red-100 text-red-600') : (darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600')} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                                    {isRecurringAllDay ? (
                                      <><Trash2 size={14} className="mr-1" />Delete</>
                                    ) : (
                                      <><Inbox size={14} className="mr-1" />Inbox</>
                                    )}
                                  </div>
                                  <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                                    Edit<Settings size={14} className="ml-1" />
                                  </div>
                                </>
                              )}
                              <div
                              {...(isTablet && (!isImported || task.isTaskCalendar) ? {
                                onTouchStart: (e) => handleMobileTaskTouchStart(e, task, 'allday'),
                                onTouchMove: (e) => handleMobileTaskTouchMove(e),
                                onTouchEnd: (e) => handleMobileTaskTouchEnd(e, task.id, 'allday'),
                              } : {})}
                              className={`${!isTablet ? 'notes-panel-container' : ''} ${task.isTaskCalendar ? '' : task.color} rounded-lg shadow-sm ${isImported && !task.isTaskCalendar ? 'cursor-default' : 'cursor-move'} ${task.completed && !task.isTaskCalendar ? 'opacity-50' : ''} relative ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                              style={{ ...(taskCalendarStyle || {}), ...(isTablet ? { touchAction: 'pan-y' } : {}) }}
                            >
                              {task.isExample && (
                                <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                                  Example
                                </span>
                              )}
                              <div className="p-2 text-white">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    {(!isImported || task.isTaskCalendar) && (
                                      <button
                                        onClick={() => toggleComplete(task.id)}
                                        className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                      >
                                        {task.completed && <Check size={10} strokeWidth={3} />}
                                      </button>
                                    )}
                                    <Calendar size={14} className="flex-shrink-0" />
                                    {task.isRecurring && <RefreshCw size={12} className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                                    <div
                                      className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm truncate ${task.completed ? 'line-through' : ''} ${!isImported ? 'cursor-text' : ''}`}
                                      onDoubleClick={(e) => {
                                        if (!isImported) {
                                          e.stopPropagation();
                                          startEditingTask(task, false);
                                        }
                                      }}
                                      title={task.title}
                                    >
                                      {renderTitle(task.title)}
                                    </div>
                                  </div>
                                  {!isImported && (
                                    useFullLayout ? (
                                      // Full layout: show action buttons inline
                                      <div className="flex items-center gap-0.5 flex-shrink-0">
                                        <AllDayActionButtons />
                                      </div>
                                    ) : (
                                      // Compact layout: show overflow menu
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0"
                                      >
                                        <MoreHorizontal size={14} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute top-full right-2 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            <AllDayActionButtons inMenu={true} />
                                          </div>
                                        )}
                                      </button>
                                    )
                                  )}
                                </div>
                              </div>
                              {/* Notes panel for all-day tasks */}
                              {expandedNotesTaskId === task.id && !isImported && (
                                <div className="notes-panel-container">
                                  <NotesSubtasksPanel
                                    task={task}
                                    isInbox={false}
                                    darkMode={darkMode}
                                    updateTaskNotes={updateTaskNotes}
                                    addSubtask={addSubtask}
                                    toggleSubtask={toggleSubtask}
                                    deleteSubtask={deleteSubtask}
                                    updateSubtaskTitle={updateSubtaskTitle}
                                    compact={false}
                                  />
                                </div>
                              )}
                            </div>
                            </div>
                          );
                        })}

                        {/* Deadline tasks from inbox */}
                        {deadlineTasks.map((task) => (
                          <div
                            key={`deadline-${task.id}`}
                            className={`notes-panel-container relative rounded-lg ${showDeadlinePicker === task.id ? '' : 'overflow-hidden'}`}
                          >
                            {/* Swipe action strips */}
                            <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600'} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                              <Inbox size={14} className="mr-1" />Inbox
                            </div>
                            <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                              Edit<Settings size={14} className="ml-1" />
                            </div>
                          <div
                            draggable
                            onDragStart={(e) => handleDragStart(task, 'inbox', e)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => { e.preventDefault(); updateDragAutoScroll(e); }}
                            onDragEnter={(e) => {
                              e.preventDefault();
                              setDragOverAllDay(dateStr);
                              setDragPreviewTime(null);
                            }}
                            onDrop={(e) => handleDropOnDateHeader(e, date)}
                            onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...task, isDeadlineDrag: true }, 'deadline')}
                            onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                            onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'deadline')}
                            className={`${task.color} rounded-lg shadow-sm cursor-move ${task.completed ? 'opacity-50' : 'opacity-90'} relative border-2 border-dashed border-white/60`}
                            style={{ touchAction: 'pan-y' }}
                          >
                            {task.isExample && (
                              <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                                Example
                              </span>
                            )}
                            <div className="p-2 text-white">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <button
                                    onClick={() => toggleComplete(task.id, true)}
                                    className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                  >
                                    {task.completed && <Check size={10} strokeWidth={3} />}
                                  </button>
                                  <AlertCircle size={14} className="flex-shrink-0" />
                                  <div
                                    className={`font-semibold text-sm truncate ${task.completed ? 'line-through' : ''}`}
                                    title={task.title}
                                  >
                                    {renderTitle(task.title)}
                                  </div>
                                </div>
                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                  <button
                                    onMouseDown={() => {
                                      if (isLinkOnlyTask(task)) {
                                        longPressTriggeredRef.current = false;
                                        longPressTimerRef.current = setTimeout(() => {
                                          longPressTriggeredRef.current = true;
                                          setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                        }, 500);
                                      }
                                    }}
                                    onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                    onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isLinkOnlyTask(task)) {
                                        if (!longPressTriggeredRef.current) {
                                          window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                        }
                                        longPressTriggeredRef.current = false;
                                      } else {
                                        setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                      }
                                    }}
                                    className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                    title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                                  >
                                    {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                  </button>
                                  <div className="deadline-picker-container relative">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setShowDeadlinePicker(showDeadlinePicker === task.id ? null : task.id);
                                      }}
                                      className="hover:bg-white/20 rounded p-1 transition-colors bg-white/20"
                                      title={`Deadline: ${formatDeadlineDate(task.deadline)}`}
                                    >
                                      <Calendar size={14} />
                                    </button>
                                    {showDeadlinePicker === task.id && (
                                      <DeadlinePickerPopover
                                        taskId={task.id}
                                        currentDeadline={task.deadline}
                                        onClose={() => setShowDeadlinePicker(null)}
                                      />
                                    )}
                                  </div>
                                  {!isTablet && (
                                    <button
                                      onClick={() => openMobileEditTask(task, true)}
                                      className="hover:bg-white/20 rounded p-1 transition-colors"
                                      title="Edit"
                                    >
                                      <Pencil size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                            {/* Notes panel for deadline tasks */}
                            {expandedNotesTaskId === task.id && (
                              <div className="notes-panel-container">
                                <NotesSubtasksPanel
                                  task={task}
                                  isInbox={true}
                                  darkMode={darkMode}
                                  updateTaskNotes={updateTaskNotes}
                                  addSubtask={addSubtask}
                                  toggleSubtask={toggleSubtask}
                                  deleteSubtask={deleteSubtask}
                                  updateSubtaskTitle={updateSubtaskTitle}
                                />
                              </div>
                            )}
                          </div>
                          </div>
                        ))}

                        {/* Routine pills in all-day (today only) */}
                        {dateToString(date) === dateToString(new Date()) && todayRoutines.filter(r => r.isAllDay).map((routine) => (
                          <div
                            key={`routine-${routine.id}`}
                            draggable
                            onDragStart={(e) => {
                              handleDragStart({ ...routine, duration: routine.duration || 15 }, 'routine', e);
                            }}
                            onDragEnd={handleDragEnd}
                            className={`rounded-full px-3 py-1 text-xs font-medium cursor-move inline-block mr-1 mb-1 ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'}`}
                          >
                            {routine.name}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Main calendar grid */}
              <div
                ref={timeGridRef}
                className="relative"
                onDragLeave={(e) => {
                  // Clear preview when leaving the calendar grid entirely
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setDragPreviewTime(null);
                    setDragPreviewDate(null);
                  }
                }}
              >
                {hours.map((hour, index) => (
                  <div key={hour} className="relative">
                    {/* Main hour row with solid border */}
                    <div className={`flex border-b ${index === 0 ? `border-t` : ''} ${borderClass}`}>
                      <div className={`w-16 flex-shrink-0 px-3 py-1 text-sm ${textSecondary} border-r ${borderClass}`}>
                        {use24HourClock
                          ? `${hour.toString().padStart(2, '0')}:00`
                          : <>{hour === 0 ? 12 : hour > 12 ? hour - 12 : hour}<span className="text-[10px] ml-0.5">{hour >= 12 ? 'PM' : 'AM'}</span></>
                        }
                      </div>
                      {visibleDates.map((date, idx) => (
                        <div
                          key={dateToString(date)}
                          className={`flex-1 relative h-40 calendar-slot ${idx > 0 ? `border-l ${borderClass}` : ''}`}
                          data-date={dateToString(date)}
                          onDragOver={(e) => handleDragOver(e, date)}
                          onDrop={(e) => handleDropOnCalendar(e, date)}
                          onClick={(e) => openNewTaskAtTime(e, date)}
                          onMouseMove={(e) => handleCalendarMouseMove(e, date)}
                          onMouseLeave={handleCalendarMouseLeave}
                        ></div>
                      ))}
                    </div>
                    {/* Half-hour dashed line (no label) */}
                    <div className="absolute left-0 right-0 pointer-events-none" style={{ top: '80px' }}>
                      <div className={`flex border-b border-dashed ${borderClass} opacity-50`}>
                        <div className="w-16 flex-shrink-0"></div>
                        {visibleDates.map((date, idx) => (
                          <div key={dateToString(date)} className={`flex-1 ${idx > 0 ? `border-l ${borderClass}` : ''}`}></div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Task overlay for each day column */}
                <div className="absolute top-0 left-16 right-0 bottom-0 pointer-events-none flex">
                  {visibleDates.map((date, dayIndex) => {
                    const dateStr = dateToString(date);
                    const isDateToday = dateStr === dateToString(new Date());
                    const dayTasks = getTasksForDate(date).filter(t => !t.isAllDay);

                    return (
                      <div
                        key={dateStr}
                        className={`flex-1 relative ${dayIndex > 0 ? `border-l ${borderClass}` : ''}`}
                      >
                        {/* Current time line - only on today */}
                        {isDateToday && (
                          <div
                            ref={currentTimeRef}
                            className="absolute left-0 right-0 pointer-events-none z-10"
                            style={{ top: `${currentTimeTop}px` }}
                          >
                            <div className="flex items-center">
                              <div className="w-2 h-2 bg-red-500 rounded-full -ml-1"></div>
                              <div className="flex-1 h-0.5 bg-red-500"></div>
                            </div>
                          </div>
                        )}

                        {/* Tasks for this day */}
                        {dayTasks.map((task) => {
                          const { top, height } = calculateTaskPosition(task);
                          const isConflicted = conflicts.some(c => c.includes(task.id));
                          const conflictPos = calculateConflictPosition(task, dayTasks);
                          const isImported = task.imported;
                          const isCalendarEvent = isImported && !task.isTaskCalendar;
                          const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);
                          const isPastEvent = isCalendarEvent && isDateToday && (timeToMinutes(task.startTime) + task.duration) <= (new Date().getHours() * 60 + new Date().getMinutes());

                          // Layout tiers for timeline tasks
                          const isMicroHeight = height <= 40;  // 15min tasks
                          const taskWidth = taskWidths[task.id];
                          const isMeasured = taskWidth !== undefined;
                          const isNarrowWidth = taskWidth < 300;

                          const useMicroLayout = isMicroHeight;  // all 15-min tasks (unchanged)
                          const useNarrowLayout = !useMicroLayout && isNarrowWidth;  // 30+ min, squished
                          // Default: wide layout (30+ min, >= 200px)

                          // Action buttons component (reused in different layouts)
                          const isRecurringTask = typeof task.id === 'string' && task.id.startsWith('recurring-');

                          // Notes button (shared across all variants)
                          const NotesButton = ({ inMenu = false }) => (
                              <button
                                onMouseDown={() => {
                                  if (isLinkOnlyTask(task)) {
                                    longPressTriggeredRef.current = false;
                                    longPressTimerRef.current = setTimeout(() => {
                                      longPressTriggeredRef.current = true;
                                      setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                    }, 500);
                                  }
                                }}
                                onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isLinkOnlyTask(task)) {
                                    if (!longPressTriggeredRef.current) {
                                      window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                    }
                                    longPressTriggeredRef.current = false;
                                  } else {
                                    setExpandedNotesTaskId(expandedNotesTaskId === task.id ? null : task.id);
                                  }
                                }}
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''} ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                              >
                                {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                {inMenu && <span className="text-xs">{isLinkOnlyTask(task) ? 'Open Link' : 'Notes'}</span>}
                              </button>
                          );

                          const ActionButtons = ({ inMenu = false }) => {
                            if (isRecurringTask) {
                              // Recurring: Notes (tablet+desktop), Edit + Delete (desktop only)
                              return (
                                <>
                                  <NotesButton inMenu={inMenu} />
                                  {!isTablet && (
                                  <button
                                    onClick={() => openMobileEditTask(task, false)}
                                    className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                    title="Edit"
                                  >
                                    <Pencil size={14} />
                                    {inMenu && <span className="text-xs">Edit</span>}
                                  </button>
                                  )}
                                  {!isTablet && (
                                  <button
                                    onClick={() => moveToRecycleBin(task.id)}
                                    className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                    title="Delete"
                                  >
                                    <Trash2 size={14} />
                                    {inMenu && <span className="text-xs">Delete</span>}
                                  </button>
                                  )}
                                </>
                              );
                            }
                            // Non-recurring: Notes, Postpone (all), Edit + Inbox (desktop only)
                            return (
                              <>
                                <NotesButton inMenu={inMenu} />
                                <button
                                  onClick={() => postponeTask(task.id)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Postpone to tomorrow"
                                >
                                  <SkipForward size={14} />
                                  {inMenu && <span className="text-xs">Postpone</span>}
                                </button>
                                {!isTablet && (
                                <button
                                  onClick={() => openMobileEditTask(task, false)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Edit"
                                >
                                  <Pencil size={14} />
                                  {inMenu && <span className="text-xs">Edit</span>}
                                </button>
                                )}
                                {!isTablet && (
                                <button
                                  onClick={() => moveToInbox(task.id)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Move to Inbox"
                                >
                                  <Inbox size={14} />
                                  {inMenu && <span className="text-xs">To Inbox</span>}
                                </button>
                                )}
                              </>
                            );
                          };

                          return (
                            <div
                              key={task.id}
                              ref={setTaskRef(task.id)}
                              data-task-id={task.id}
                              draggable={!isImported || task.isTaskCalendar}
                              onDragStart={(e) => (!isImported || task.isTaskCalendar) && handleDragStart(task, 'calendar', e)}
                              onDragEnd={handleDragEnd}
                              onDragOver={(e) => handleDragOver(e, date)}
                              onDrop={(e) => handleDropOnCalendar(e, date)}
                              className={`absolute notes-panel-container ${task.isTaskCalendar || isTablet ? '' : task.color} rounded-lg shadow-md pointer-events-auto ${isImported && !task.isTaskCalendar ? 'cursor-default' : 'cursor-move'} ${isConflicted && !task.completed ? 'ring-4 ring-red-500' : ''} ${task.completed && !task.isTaskCalendar || isPastEvent ? 'opacity-50' : ''} ${expandedNotesTaskId === task.id ? 'overflow-visible z-30' : isTablet ? 'overflow-hidden' : ''} ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                              style={{
                                top: `${top}px`,
                                height: `${height}px`,
                                minHeight: useMicroLayout ? '27px' : '39px',
                                left: conflictPos.left,
                                right: conflictPos.right,
                                width: conflictPos.width,
                                visibility: isMeasured ? 'visible' : 'hidden',
                                ...(isTablet ? { touchAction: 'pan-y' } : {}),
                                ...(isTablet ? {} : taskCalendarStyle)
                              }}
                            >
                              {task.isExample && (
                                <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                                  Example
                                </span>
                              )}
                              {/* Tablet swipe strips */}
                              {isTablet && !isImported && (
                                <>
                                  <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${isRecurringTask ? (darkMode ? 'bg-red-900/80 text-red-300' : 'bg-red-100 text-red-600') : (darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600')} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                                    {isRecurringTask ? (
                                      <><Trash2 size={14} className="mr-1" />Delete</>
                                    ) : (
                                      <><Inbox size={14} className="mr-1" />Inbox</>
                                    )}
                                  </div>
                                  <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                                    Edit<Settings size={14} className="ml-1" />
                                  </div>
                                </>
                              )}
                              <div
                              {...(isTablet && (!isImported || task.isTaskCalendar) ? {
                                onTouchStart: (e) => handleMobileTaskTouchStart(e, task, 'timeline'),
                                onTouchMove: (e) => handleMobileTaskTouchMove(e),
                                onTouchEnd: (e) => handleMobileTaskTouchEnd(e, task.id, 'timeline'),
                              } : {})}
                              className={`${useMicroLayout ? 'px-1.5 py-1' : 'p-2'} h-full flex flex-col text-white ${useMicroLayout ? 'justify-center' : ''} rounded-lg relative ${isTablet && !task.isTaskCalendar ? task.color : ''}`}
                              style={{ ...(isTablet ? { touchAction: 'pan-y', ...taskCalendarStyle } : {}) }}
                              >
                                {/* IMPORTED EVENT LAYOUT: Always show time on right with truncated title */}
                                {isImported && !task.isTaskCalendar ? (
                                  <div className="flex items-center justify-between gap-2">
                                    <div
                                      className="font-semibold text-sm leading-tight truncate flex-1 min-w-0"
                                      title={task.title}
                                    >
                                      {renderTitleWithoutTags(task.title)}
                                    </div>
                                    <div className="text-xs opacity-90 whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                                      <Clock size={10} />
                                      {formatTime(task.startTime)} • {task.duration}m
                                    </div>
                                  </div>
                                ) : useMicroLayout && isNarrowWidth ? (
                                  /* MICRO NARROW: ... menu + checkbox + truncated title + tag, single row */
                                  <>
                                    {!isImported && (
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container absolute top-0.5 right-0.5 hover:bg-white/20 rounded p-0.5 transition-colors z-10"
                                      >
                                        <MoreHorizontal size={12} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            <ActionButtons inMenu={true} />
                                          </div>
                                        )}
                                      </button>
                                    )}
                                    <div className="flex items-center gap-1 min-w-0 pr-5">
                                      {(!isImported || task.isTaskCalendar) && (
                                        <button
                                          onClick={() => toggleComplete(task.id)}
                                          className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-3.5 h-3.5 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                        >
                                          {task.completed && <Check size={8} strokeWidth={3} />}
                                        </button>
                                      )}
                                      {task.isRecurring && <RefreshCw size={10} className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                                      <div
                                        className={`flex-1 min-w-0 ${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight truncate ${task.completed ? 'line-through' : ''} ${!isImported ? 'cursor-text' : ''}`}
                                        onDoubleClick={(e) => {
                                          if (!isImported) {
                                            e.stopPropagation();
                                            startEditingTask(task, false);
                                          }
                                        }}
                                        title={task.title}
                                      >
                                        {renderTitleWithoutTags(task.title)}
                                      </div>
                                      {extractTags(task.title).length > 0 && (
                                        <div className="text-xs italic opacity-75 whitespace-nowrap flex-shrink-0">
                                          {extractTags(task.title).map(tag => `#${tag}`).join(' ')}
                                        </div>
                                      )}
                                    </div>
                                  </>
                                ) : useMicroLayout ? (
                                  /* MICRO WIDE: checkbox + truncated title + tag + action buttons, single row */
                                  <div className="flex items-center justify-between gap-1 min-w-0">
                                    <div className="flex items-center gap-1 min-w-0">
                                      {(!isImported || task.isTaskCalendar) && (
                                        <button
                                          onClick={() => toggleComplete(task.id)}
                                          className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-3.5 h-3.5 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                        >
                                          {task.completed && <Check size={8} strokeWidth={3} />}
                                        </button>
                                      )}
                                      {task.isRecurring && <RefreshCw size={10} className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                                      <div className="flex-1 min-w-0">
                                        {editingTaskId === task.id ? (
                                          <div className="relative tag-autocomplete-container">
                                            <input
                                              type="text"
                                              value={editingTaskText}
                                              onChange={(e) => handleEditInputChange(e, false)}
                                              onKeyDown={(e) => handleEditKeyDown(e, false)}
                                              onBlur={() => {
                                                setTimeout(() => {
                                                  if (!showSuggestions) {
                                                    saveTaskTitle(false);
                                                  }
                                                }, 100);
                                              }}
                                              autoFocus
                                              className="w-full bg-white/20 text-white font-semibold text-sm px-1 rounded border border-white/30 outline-none focus:bg-white/30"
                                              onClick={(e) => e.stopPropagation()}
                                            />
                                            {showSuggestions && suggestionContext === 'editing' && (
                                              <SuggestionAutocomplete
                                                suggestions={suggestions}
                                                selectedIndex={selectedSuggestionIndex}
                                                onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, false)}
                                              />
                                            )}
                                          </div>
                                        ) : (
                                          <div
                                            className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight truncate ${task.completed ? 'line-through' : ''} ${!isImported ? 'cursor-text' : ''}`}
                                            onDoubleClick={(e) => {
                                              if (!isImported) {
                                                e.stopPropagation();
                                                startEditingTask(task, false);
                                              }
                                            }}
                                            title={task.title}
                                          >
                                            {renderTitleWithoutTags(task.title)}
                                          </div>
                                        )}
                                      </div>
                                      {extractTags(task.title).length > 0 && (
                                        <div className="text-xs italic opacity-75 whitespace-nowrap flex-shrink-0">
                                          {extractTags(task.title).map(tag => `#${tag}`).join(' ')}
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      {renderTitleWithoutTags(task.title).length <= 20 && (
                                        <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1">
                                          <Clock size={10} />
                                          {formatTime(task.startTime)} • {task.duration}m
                                        </div>
                                      )}
                                      {!isImported && <ActionButtons />}
                                    </div>
                                  </div>
                                ) : useNarrowLayout ? (
                                  /* NARROW LAYOUT (<200px): ... menu, checkbox + title with line-clamp-3, no time */
                                  <>
                                    {!isImported && (
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container absolute top-1 right-1 hover:bg-white/20 rounded p-0.5 transition-colors z-10"
                                      >
                                        <MoreHorizontal size={14} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            <ActionButtons inMenu={true} />
                                          </div>
                                        )}
                                      </button>
                                    )}
                                    <div className="pr-6">
                                      <div className="flex items-start gap-1">
                                        {(!isImported || task.isTaskCalendar) && (
                                          <button
                                            onClick={() => toggleComplete(task.id)}
                                            className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                          >
                                            {task.completed && <Check size={10} strokeWidth={3} />}
                                          </button>
                                        )}
                                        {task.isRecurring && <RefreshCw size={12} className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer mt-0.5" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                                        <div className="flex-1 min-w-0">
                                          {editingTaskId === task.id ? (
                                            <div className="relative tag-autocomplete-container">
                                              <input
                                                type="text"
                                                value={editingTaskText}
                                                onChange={(e) => handleEditInputChange(e, false)}
                                                onKeyDown={(e) => handleEditKeyDown(e, false)}
                                                onBlur={() => {
                                                  setTimeout(() => {
                                                    if (!showSuggestions) {
                                                      saveTaskTitle(false);
                                                    }
                                                  }, 100);
                                                }}
                                                autoFocus
                                                className="w-full bg-white/20 text-white font-semibold text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                                onClick={(e) => e.stopPropagation()}
                                              />
                                              {showSuggestions && suggestionContext === 'editing' && (
                                                <SuggestionAutocomplete
                                                  suggestions={suggestions}
                                                  selectedIndex={selectedSuggestionIndex}
                                                  onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, false)}
                                                />
                                              )}
                                            </div>
                                          ) : (
                                            <div
                                              className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight line-clamp-2 ${task.completed ? 'line-through' : ''} ${!isImported ? 'cursor-text' : ''}`}
                                              onDoubleClick={(e) => {
                                                if (!isImported) {
                                                  e.stopPropagation();
                                                  startEditingTask(task, false);
                                                }
                                              }}
                                              title={task.title}
                                            >
                                              {renderTitleWithoutTags(task.title)}
                                            </div>
                                          )}
                                          {extractTags(task.title).length > 0 && (
                                            <div className="text-xs italic opacity-75 truncate">
                                              {extractTags(task.title).map(tag => `#${tag}`).join(' ')}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  /* WIDE LAYOUT (>=200px): Title+tags row 1 with action buttons, time row 2 */
                                  <>
                                    <div className="flex items-start justify-between gap-1">
                                      <div className="flex items-start gap-1 flex-1 min-w-0">
                                        {(!isImported || task.isTaskCalendar) && (
                                          <button
                                            onClick={() => toggleComplete(task.id)}
                                            className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                          >
                                            {task.completed && <Check size={10} strokeWidth={3} />}
                                          </button>
                                        )}
                                        {task.isRecurring && <RefreshCw size={12} className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer mt-0.5" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                                        <div className="flex-1 min-w-0">
                                          {editingTaskId === task.id ? (
                                            <div className="relative tag-autocomplete-container">
                                              <input
                                                type="text"
                                                value={editingTaskText}
                                                onChange={(e) => handleEditInputChange(e, false)}
                                                onKeyDown={(e) => handleEditKeyDown(e, false)}
                                                onBlur={() => {
                                                  setTimeout(() => {
                                                    if (!showSuggestions) {
                                                      saveTaskTitle(false);
                                                    }
                                                  }, 100);
                                                }}
                                                autoFocus
                                                className="w-full bg-white/20 text-white font-semibold text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                                onClick={(e) => e.stopPropagation()}
                                              />
                                              {showSuggestions && suggestionContext === 'editing' && (
                                                <SuggestionAutocomplete
                                                  suggestions={suggestions}
                                                  selectedIndex={selectedSuggestionIndex}
                                                  onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, false)}
                                                />
                                              )}
                                            </div>
                                          ) : (
                                            <div
                                              className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight line-clamp-2 ${task.completed ? 'line-through' : ''} ${!isImported ? 'cursor-text' : ''}`}
                                              onDoubleClick={(e) => {
                                                if (!isImported) {
                                                  e.stopPropagation();
                                                  startEditingTask(task, false);
                                                }
                                              }}
                                              title={!isImported ? "Double-click to edit" : undefined}
                                            >
                                              {renderTitleWithoutTags(task.title)}
                                            </div>
                                          )}
                                          {extractTags(task.title).length > 0 && (
                                            <div className="text-xs italic opacity-75 truncate">
                                              {extractTags(task.title).map(tag => `#${tag}`).join(' ')}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      {!isImported && (
                                        <div className="flex flex-col items-end flex-shrink-0">
                                          <div className="flex items-start gap-0.5">
                                            <ActionButtons />
                                          </div>
                                          <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1 mt-0.5">
                                            <Clock size={10} />
                                            {formatTime(task.startTime)} • {task.duration}min
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </>
                                )}
                                {/* Resize handle at bottom - solid white for visibility */}
                                {!isImported && (
                                  <div
                                    onMouseDown={(e) => handleResizeStart(task, e)}
                                    className="absolute bottom-0 left-1/3 right-1/3 h-3 cursor-ns-resize hover:bg-white/20 flex items-center justify-center"
                                    style={{ marginBottom: '-4px' }}
                                  >
                                    <div className="w-12 h-1 bg-white rounded-full"></div>
                                  </div>
                                )}
                                {/* Notes panel - floating below task (or above if task ends after 22:00) */}
                                {expandedNotesTaskId === task.id && !isImported && (() => {
                                  const startMin = timeToMinutes(task.startTime || '0:00');
                                  const endMin = startMin + (task.duration || 0);
                                  const showAbove = endMin >= 22 * 60;
                                  return (
                                    <div
                                      className="notes-panel-container absolute left-0 right-0 z-40"
                                      style={showAbove ? { bottom: `${height}px` } : { top: `${height}px` }}
                                    >
                                      <div className={`${task.color} rounded-lg shadow-lg ${showAbove ? 'mb-1' : 'mt-1'}`}>
                                        <NotesSubtasksPanel
                                          task={task}
                                          isInbox={false}
                                          darkMode={darkMode}
                                          updateTaskNotes={updateTaskNotes}
                                          addSubtask={addSubtask}
                                          toggleSubtask={toggleSubtask}
                                          deleteSubtask={deleteSubtask}
                                          updateSubtaskTitle={updateSubtaskTitle}
                                          compact={false}
                                        />
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })}

                        {/* Timeline routine pills (today only) */}
                        {dateStr === dateToString(new Date()) && (() => {
                          const timelineRoutines = todayRoutines.filter(r => !r.isAllDay && r.startTime);
                          if (timelineRoutines.length === 0) return null;

                          // Compute side-by-side columns for overlapping routine chips
                          const routineColumns = [];
                          const sorted = [...timelineRoutines].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
                          sorted.forEach(r => {
                            const rStart = timeToMinutes(r.startTime);
                            const rEnd = rStart + r.duration;
                            let placed = false;
                            for (let c = 0; c < routineColumns.length; c++) {
                              const lastInCol = routineColumns[c][routineColumns[c].length - 1];
                              if (timeToMinutes(lastInCol.startTime) + lastInCol.duration <= rStart) {
                                routineColumns[c].push(r);
                                placed = true;
                                break;
                              }
                            }
                            if (!placed) routineColumns.push([r]);
                          });

                          // Build a map from routine id to its column index
                          const colMap = {};
                          routineColumns.forEach((col, ci) => col.forEach(r => { colMap[r.id] = ci; }));

                          // For each routine, compute how many columns overlap with it
                          const overlapCount = {};
                          timelineRoutines.forEach(r => {
                            const rStart = timeToMinutes(r.startTime);
                            const rEnd = rStart + r.duration;
                            let maxCols = 1;
                            timelineRoutines.forEach(other => {
                              if (other.id === r.id) return;
                              const oStart = timeToMinutes(other.startTime);
                              const oEnd = oStart + other.duration;
                              if (rStart < oEnd && rEnd > oStart) maxCols++;
                            });
                            overlapCount[r.id] = maxCols;
                          });

                          const now = new Date();
                          const nowMinutes = now.getHours() * 60 + now.getMinutes();

                          return timelineRoutines.map(routine => {
                            const { top, height } = calculateTaskPosition(routine);
                            const colIdx = colMap[routine.id];
                            const cols = overlapCount[routine.id];
                            const widthPercent = cols > 1 ? `${100 / cols}%` : '100%';
                            const leftPercent = cols > 1 ? `${(colIdx * 100) / cols}%` : '0%';
                            const endMinutes = timeToMinutes(routine.startTime) + routine.duration;
                            const isPast = endMinutes <= nowMinutes;

                            return (
                              <div
                                key={`routine-tl-${routine.id}`}
                                draggable
                                onDragStart={(e) => handleDragStart({ ...routine }, 'routine', e)}
                                onDragEnd={handleDragEnd}
                                onDragOver={(e) => handleDragOver(e, date)}
                                onDrop={(e) => handleDropOnCalendar(e, date)}
                                className={`absolute pointer-events-auto cursor-move flex items-center justify-center ${isPast ? 'opacity-50' : ''}`}
                                style={{
                                  top: `${top}px`,
                                  height: `${Math.max(height, 27)}px`,
                                  left: `calc(${leftPercent} + 4px)`,
                                  width: `calc(${widthPercent} - 8px)`,
                                }}
                              >
                                {/* Teal cross lines — horizontal + vertical */}
                                <div className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                                <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                                {/* Compact pill label centered */}
                                <span className={`relative rounded-full px-3 py-1 text-xs font-medium ${darkMode ? 'bg-teal-700 text-teal-100' : 'bg-teal-600 text-white'}`}>{routine.name}</span>
                                {/* Desktop: Resize handle (drag) */}
                                {!isTablet && (
                                  <div
                                    className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize flex justify-center items-center"
                                    onMouseDown={(e) => handleRoutineResizeStart(routine, e)}
                                    style={{ marginBottom: '-4px' }}
                                  >
                                    <div className={`w-8 h-1 rounded-full ${darkMode ? 'bg-teal-400/50' : 'bg-teal-500/40'}`}></div>
                                  </div>
                                )}
                                {/* Tablet: Duration edit button */}
                                {isTablet && (
                                  <>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setRoutineDurationEditId(routineDurationEditId === routine.id ? null : routine.id); }}
                                      className={`routine-duration-edit absolute bottom-0 right-0 translate-y-1/2 translate-x-1/4 z-10 rounded-full p-0.5 shadow-md border transition-colors ${darkMode ? 'bg-teal-700 border-teal-500 text-teal-200 active:bg-teal-600' : 'bg-teal-600 border-teal-400 text-white active:bg-teal-500'}`}
                                      aria-label="Edit duration"
                                    >
                                      <GripHorizontal size={12} />
                                    </button>
                                    {routineDurationEditId === routine.id && (
                                      <div
                                        className={`routine-duration-edit absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 ${darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'} border rounded-xl shadow-xl flex items-center gap-1 px-2 py-1.5`}
                                        onClick={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setTodayRoutines(prev => prev.map(r => r.id === routine.id ? { ...r, duration: Math.max(15, r.duration - 15) } : r)); }}
                                          className={`p-1 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700 active:bg-gray-600 text-gray-300' : 'hover:bg-gray-100 active:bg-gray-200 text-gray-600'}`}
                                          aria-label="Decrease duration"
                                        >
                                          <ChevronDown size={16} />
                                        </button>
                                        <span className={`text-xs font-semibold tabular-nums min-w-[3rem] text-center ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                                          {routine.duration}min
                                        </span>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setTodayRoutines(prev => prev.map(r => r.id === routine.id ? { ...r, duration: r.duration + 15 } : r)); }}
                                          className={`p-1 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700 active:bg-gray-600 text-gray-300' : 'hover:bg-gray-100 active:bg-gray-200 text-gray-600'}`}
                                          aria-label="Increase duration"
                                        >
                                          <ChevronUp size={16} />
                                        </button>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          });
                        })()}

                        {/* Hover preview line - shows where a new task would start */}
                        {hoverPreviewTime && !draggedTask && !isResizing && hoverPreviewDate && dateToString(hoverPreviewDate) === dateStr && (
                          <div
                            className="absolute left-0 right-0 pointer-events-none z-30"
                            style={{
                              top: `${minutesToPosition(timeToMinutes(hoverPreviewTime))}px`
                            }}
                          >
                            <div className="absolute left-0 right-12 h-0.5 bg-blue-400/60"></div>
                            <div className="absolute right-1 bg-blue-500/80 text-white text-xs px-1.5 py-0.5 rounded -translate-y-1/2">
                              {formatTime(hoverPreviewTime)}
                            </div>
                          </div>
                        )}

                        {/* Drag preview - only show in the column being dragged over */}
                        {dragPreviewTime && draggedTask && dragPreviewDate && dateToString(dragPreviewDate) === dateStr && (
                          <>
                            {/* Time label above the box */}
                            <div
                              className="absolute left-2 bg-blue-600 text-white px-2 py-1 rounded text-sm font-bold pointer-events-none z-20 shadow-lg"
                              style={{
                                top: `${minutesToPosition(timeToMinutes(dragPreviewTime)) - 30}px`
                              }}
                            >
                              {formatTime(dragPreviewTime)}
                            </div>
                            {/* Preview box */}
                            <div
                              className="absolute left-2 right-2 bg-blue-500/50 border-2 border-blue-500 rounded-lg flex items-center justify-center text-white font-bold text-lg pointer-events-none z-5"
                              style={{
                                top: `${minutesToPosition(timeToMinutes(dragPreviewTime))}px`,
                                height: `${durationToHeight(draggedTask.duration)}px`,
                                minHeight: '39px'
                              }}
                            >
                            </div>
                          </>
                        )}

                        {/* Tablet touch drag preview */}
                        {isTablet && mobileDragPreviewTime && mobileDragPreviewTime !== 'all-day' && mobileDragTaskIdState && (() => {
                          const dragMinutes = timeToMinutes(mobileDragPreviewTime);
                          const dragTop = minutesToPosition(dragMinutes);
                          const originalTask = mobileDragOriginalTask.current;
                          const dragDuration = originalTask?.duration || 30;
                          return (
                            <>
                              <div
                                className="absolute left-2 bg-blue-600 text-white px-2 py-1 rounded text-sm font-bold pointer-events-none z-20 shadow-lg"
                                style={{ top: `${dragTop - 30}px` }}
                              >
                                {formatTime(mobileDragPreviewTime)}
                              </div>
                              <div
                                className="absolute left-2 right-2 bg-blue-500/50 border-2 border-blue-500 rounded-lg pointer-events-none z-5"
                                style={{
                                  top: `${dragTop}px`,
                                  height: `${durationToHeight(dragDuration)}px`,
                                  minHeight: '39px'
                                }}
                              />
                            </>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      {showTimePicker && (
        <ClockTimePicker
          value={newTask.startTime}
          onChange={(time) => setNewTask({ ...newTask, startTime: time })}
          onClose={() => setShowTimePicker(false)}
        />
      )}

      {showDatePicker && (
        <DatePicker
          value={newTask.date}
          onChange={(date) => setNewTask({ ...newTask, date })}
          onClose={() => setShowDatePicker(false)}
        />
      )}

      {deadlinePickerTaskId && (
        <DatePicker
          value={deadlinePickerTaskId === 'newTask'
            ? (newTask.deadline || dateToString(new Date()))
            : (unscheduledTasks.find(t => t.id === deadlinePickerTaskId)?.deadline || dateToString(new Date()))}
          onChange={(date) => {
            if (deadlinePickerTaskId === 'newTask') {
              setNewTask({ ...newTask, deadline: date });
            } else {
              setDeadline(deadlinePickerTaskId, date);
            }
            setDeadlinePickerTaskId(null);
          }}
          onClose={() => setDeadlinePickerTaskId(null)}
        />
      )}

      {showRecurrenceEndDatePicker && (
        <DatePicker
          value={(() => {
            if (showRecurrenceEndDatePicker.source === 'edit') {
              const tmpl = recurringTasks.find(t => t.id === showRecurrenceEndDatePicker.templateId);
              return tmpl?.recurrence?.endDate || dateToString(new Date());
            }
            return newTask.recurrence?.endDate || dateToString(new Date());
          })()}
          onChange={(date) => {
            if (showRecurrenceEndDatePicker.source === 'edit') {
              updateRecurrenceEndCondition(showRecurrenceEndDatePicker.templateId, { endDate: date });
            } else {
              const { maxOccurrences: _m, ...rest } = newTask.recurrence;
              setNewTask({ ...newTask, recurrence: { ...rest, endDate: date } });
            }
            setShowRecurrenceEndDatePicker(null);
          }}
          onClose={() => setShowRecurrenceEndDatePicker(null)}
        />
      )}

      {showEmptyBinConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowEmptyBinConfirm(false); setShowMobileRecycleBin(false); }}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <Trash2 size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Empty Recycle Bin</h3>
            </div>
            <p className={`${textSecondary} mb-6`}>
              Are you sure you want to permanently delete all {recycleBin.length} task{recycleBin.length !== 1 ? 's' : ''} in the recycle bin? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowEmptyBinConfirm(false); setShowMobileRecycleBin(false); }}
                className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg}`}
              >
                Cancel
              </button>
              <button
                onClick={confirmEmptyBin}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}

      {recurringDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRecurringDeleteConfirm(null)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRecurringDeleteConfirm(null); } }} tabIndex={-1} ref={(el) => el && el.focus()}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <RefreshCw size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Delete Recurring Task</h3>
            </div>
            <p className={`${textSecondary} mb-2`}>
              How would you like to delete this recurring task?
            </p>
            <p className={`text-xs ${textSecondary} mb-4`}>
              Note: Recurring tasks are permanently deleted and cannot be restored from the recycle bin.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => deleteRecurringInstance('this')}
                className={`w-full text-left px-4 py-2.5 rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary}`}
              >
                <div className="font-medium">This occurrence</div>
                <div className={`text-xs ${textSecondary}`}>Only skip {recurringDeleteConfirm.dateStr}</div>
              </button>
              <button
                onClick={() => deleteRecurringInstance('future')}
                className={`w-full text-left px-4 py-2.5 rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary}`}
              >
                <div className="font-medium">This and all future</div>
                <div className={`text-xs ${textSecondary}`}>Stop recurring from {recurringDeleteConfirm.dateStr} onward</div>
              </button>
              <button
                onClick={() => deleteRecurringInstance('series')}
                className="w-full text-left px-4 py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                <div className="font-medium">Delete entire series</div>
                <div className="text-xs opacity-75">Remove all occurrences</div>
              </button>
              <button
                onClick={() => setRecurringDeleteConfirm(null)}
                className={`w-full px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg} mt-1`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {editingRecurrenceTaskId && (() => {
        const parts = editingRecurrenceTaskId.split('-');
        const templateId = Number(parts[1]);
        const dateStr = parts.slice(2).join('-');
        const template = recurringTasks.find(t => t.id === templateId);
        if (!template) return null;
        const presets = getRecurrencePresets(dateStr);
        const currentRecurrence = template.recurrence;

        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditingRecurrenceTaskId(null)}>
            <div
              className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                  <RefreshCw size={20} className="text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className={`text-lg font-semibold ${textPrimary}`}>Edit Recurrence</h3>
              </div>
              <p className={`${textSecondary} mb-3 text-sm`}>
                {template.title}
              </p>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => {
                    // Convert recurring task to a regular scheduled task for this date
                    const isCompleted = template.completedDates?.includes(dateStr);
                    const regularTask = {
                      id: Date.now(),
                      title: template.title,
                      startTime: template.startTime,
                      duration: template.duration,
                      color: template.color,
                      completed: isCompleted,
                      isAllDay: template.isAllDay || false,
                      notes: template.notes || '',
                      subtasks: template.subtasks ? JSON.parse(JSON.stringify(template.subtasks)) : [],
                      date: dateStr
                    };
                    setTasks(prev => [...prev, regularTask]);
                    recordDeletedTaskTombstone(templateId);
                    setRecurringTasks(prev => prev.filter(t => t.id !== templateId));
                    setEditingRecurrenceTaskId(null);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} ${textPrimary}`}
                >
                  None (convert to regular task)
                </button>
                <div className={`border-t ${borderClass} my-1`}></div>
                {presets.filter(p => p.value !== null).map((preset, i) => {
                  const { startDate: _s, endDate: _e, maxOccurrences: _m, ...recCore } = currentRecurrence;
                  const isActive = JSON.stringify(recCore) === JSON.stringify(preset.value);
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        const endFields = {};
                        if (currentRecurrence.endDate) endFields.endDate = currentRecurrence.endDate;
                        if (currentRecurrence.maxOccurrences) endFields.maxOccurrences = currentRecurrence.maxOccurrences;
                        updateRecurrencePattern(templateId, dateStr, { ...preset.value, ...endFields });
                      }}
                      className={`w-full text-left px-3 py-2 text-sm rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} ${
                        isActive ? (darkMode ? 'bg-gray-700 text-blue-400' : 'bg-blue-50 text-blue-700') : textPrimary
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {isActive && <Check size={14} className="flex-shrink-0" />}
                        {preset.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className={`mt-3 pt-3 border-t ${borderClass}`}>
                <p className={`text-xs font-medium ${textSecondary} mb-2`}>Ends</p>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => updateRecurrenceEndCondition(templateId, {})}
                    className={`w-full text-left px-3 py-2 text-sm rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} ${
                      !currentRecurrence.endDate && !currentRecurrence.maxOccurrences ? (darkMode ? 'bg-gray-700 text-blue-400' : 'bg-blue-50 text-blue-700') : textPrimary
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {!currentRecurrence.endDate && !currentRecurrence.maxOccurrences && <Check size={14} className="flex-shrink-0" />}
                      Never
                    </span>
                  </button>
                  <button
                    onClick={() => setShowRecurrenceEndDatePicker({ source: 'edit', templateId })}
                    className={`w-full text-left px-3 py-2 text-sm rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} ${
                      currentRecurrence.endDate ? (darkMode ? 'bg-gray-700 text-blue-400' : 'bg-blue-50 text-blue-700') : textPrimary
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {currentRecurrence.endDate && <Check size={14} className="flex-shrink-0" />}
                      On date
                      {currentRecurrence.endDate && <span className="ml-auto text-xs opacity-75">
                        {new Date(currentRecurrence.endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>}
                    </span>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (!currentRecurrence.maxOccurrences) {
                          updateRecurrenceEndCondition(templateId, { maxOccurrences: 10 });
                        }
                      }}
                      className={`flex-1 text-left px-3 py-2 text-sm rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} ${
                        currentRecurrence.maxOccurrences ? (darkMode ? 'bg-gray-700 text-blue-400' : 'bg-blue-50 text-blue-700') : textPrimary
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {currentRecurrence.maxOccurrences && <Check size={14} className="flex-shrink-0" />}
                        After
                      </span>
                    </button>
                    {currentRecurrence.maxOccurrences && (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="1"
                          max="999"
                          value={currentRecurrence.maxOccurrences}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            if (val > 0) updateRecurrenceEndCondition(templateId, { maxOccurrences: val });
                          }}
                          className={`w-16 px-2 py-1 text-sm border ${borderClass} rounded ${darkMode ? 'bg-gray-700 text-white dark-spinner' : 'bg-white'}`}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className={`text-sm ${textSecondary}`}>times</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setEditingRecurrenceTaskId(null)}
                className={`w-full px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg} mt-3`}
              >
                Done
              </button>
            </div>
          </div>
        );
      })()}

      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowImportModal(false); setPendingImportFile(null); }}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Upload size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Import Calendar</h3>
            </div>
            <p className={`${textSecondary} mb-4`}>
              How would you like to import "{pendingImportFile?.name}"?
            </p>
            <div className="mb-4">
              <label className={`block text-sm ${textSecondary} mb-2`}>Event color</label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {[{ name: 'Gray', class: 'bg-gray-600' }, ...colors].map(c => (
                  <button
                    key={c.class}
                    onClick={() => setImportColor(c.class)}
                    className={`w-7 h-7 rounded-full ${c.class} transition-all ${importColor === c.class ? 'ring-2 ring-offset-2 ring-blue-500' + (darkMode ? ' ring-offset-gray-800' : '') : 'hover:scale-110'}`}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => processImportFile(false)}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium">As Calendar Events</div>
                <div className={`text-sm ${textSecondary}`}>Read-only events shown in selected color</div>
              </button>
              <button
                onClick={() => processImportFile(true)}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium">As Task Calendar</div>
                <div className={`text-sm ${textSecondary}`}>Checkable tasks (striped pattern)</div>
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => { setShowImportModal(false); setPendingImportFile(null); }}
                className={`px-4 py-2 ${darkMode ? 'bg-gray-600 hover:bg-gray-500' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-lg transition-colors`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {cloudSyncConflict && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Cloud size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Existing Data Found</h3>
            </div>
            <p className={`${textSecondary} mb-2`}>
              Your cloud server already has synced data. What would you like to do?
            </p>
            <p className={`text-xs ${textSecondary} mb-4`}>
              Last modified: {new Date(cloudSyncConflict.remoteModified).toLocaleString()}
            </p>
            <div className="space-y-2">
              <button
                onClick={async () => {
                  const localData = buildSyncPayload().data;
                  const { data: mergedData, remoteChanged } = mergeSyncData(localData, cloudSyncConflict.remoteData);
                  applyRemoteData(mergedData);
                  const now = new Date().toISOString();
                  localStorage.setItem('day-planner-cloud-sync-local-modified', now);
                  setCloudSyncLastSynced(now);
                  localStorage.setItem('day-planner-cloud-sync-last-synced', now);
                  setCloudSyncConflict(null);
                  cloudSyncInProgressRef.current = false;
                  cloudSyncInitialDoneRef.current = true;
                  if (remoteChanged) {
                    await cloudSyncUpload();
                  } else {
                    setCloudSyncStatus('success');
                    setTimeout(() => setCloudSyncStatus((s) => s === 'success' ? 'idle' : s), 3000);
                  }
                }}
                className={`w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-left transition-colors`}
              >
                <div className="font-medium">Merge both</div>
                <div className="text-sm text-blue-100">Combine local and server data, keeping all tasks</div>
              </button>
              <button
                onClick={() => {
                  applyRemoteData(cloudSyncConflict.remoteData);
                  localStorage.setItem('day-planner-cloud-sync-local-modified', cloudSyncConflict.remoteModified);
                  const now = new Date().toISOString();
                  setCloudSyncLastSynced(now);
                  localStorage.setItem('day-planner-cloud-sync-last-synced', now);
                  setCloudSyncConflict(null);
                  cloudSyncInProgressRef.current = false;
                  cloudSyncInitialDoneRef.current = true;
                  setCloudSyncStatus('success');
                  setTimeout(() => setCloudSyncStatus((s) => s === 'success' ? 'idle' : s), 3000);
                }}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium">Use server data</div>
                <div className={`text-sm ${textSecondary}`}>Replace local data with what's on the server</div>
              </button>
              <button
                onClick={async () => {
                  setCloudSyncConflict(null);
                  cloudSyncInProgressRef.current = false;
                  cloudSyncInitialDoneRef.current = true;
                  const now = new Date().toISOString();
                  localStorage.setItem('day-planner-cloud-sync-last-synced', now);
                  setCloudSyncLastSynced(now);
                  await cloudSyncUpload();
                }}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium">Use local data</div>
                <div className={`text-sm ${textSecondary}`}>Upload current data to the server, replacing what's there</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {showBackupMenu && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowBackupMenu(false)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Save size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Backup & Restore</h3>
            </div>
            <p className={`${textSecondary} mb-4`}>
              Export your data to a file or restore from a previous backup.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => { exportBackup(); setShowBackupMenu(false); }}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium flex items-center gap-2">
                  <Upload size={16} className="rotate-180" />
                  Export Backup
                </div>
                <div className={`text-sm ${textSecondary}`}>Download all tasks and settings as JSON</div>
              </button>
              <label className={`block w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} rounded-lg text-left transition-colors cursor-pointer`}>
                <div className="font-medium flex items-center gap-2">
                  <Upload size={16} />
                  Restore Backup
                </div>
                <div className={`text-sm ${textSecondary}`}>Load data from a backup file</div>
                <input type="file" accept=".json" onChange={handleBackupFileSelect} className="hidden" />
              </label>
              <button
                onClick={() => { setShowBackupMenu(false); setAutoBackupManagerTab('settings'); setShowAutoBackupManager(true); }}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium flex items-center gap-2">
                  <Clock size={16} />
                  Auto-Backup
                  {(autoBackupConfig.local.enabled || autoBackupConfig.remote.enabled) && (
                    <span className="ml-auto text-xs px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded">Active</span>
                  )}
                </div>
                <div className={`text-sm ${textSecondary}`}>Scheduled automatic backups</div>
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowBackupMenu(false)}
                className={`px-4 py-2 ${darkMode ? 'bg-gray-600 hover:bg-gray-500' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-lg transition-colors`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showRestoreConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowRestoreConfirm(false); setPendingBackupFile(null); }}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/30">
                <AlertCircle size={20} className="text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Restore Backup</h3>
            </div>
            <p className={`${textSecondary} mb-2`}>
              Restore from "{pendingBackupFile?.name}"?
            </p>
            <p className={`${textSecondary} mb-6 text-sm`}>
              This will replace all your current tasks, inbox items, recycle bin, and settings with the data from this backup. The page will reload after restoration.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowRestoreConfirm(false); setPendingBackupFile(null); }}
                className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg}`}
              >
                Cancel
              </button>
              <button
                onClick={restoreBackup}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Backup Manager Modal */}
      {showAutoBackupManager && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowAutoBackupManager(false); setAutoBackupRestoreConfirm(null); }}>
          <div
            className={`${cardBg} rounded-lg shadow-xl ${borderClass} border max-w-lg w-full mx-4 max-h-[80vh] flex flex-col`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 pb-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                  <Clock size={20} className="text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className={`text-lg font-semibold ${textPrimary}`}>Auto-Backup</h3>
                <button onClick={() => { setShowAutoBackupManager(false); setAutoBackupRestoreConfirm(null); }} className={`ml-auto p-1 rounded ${hoverBg}`}>
                  <X size={18} className={textSecondary} />
                </button>
              </div>

              {/* Tabs */}
              <div className={`flex border-b ${borderClass}`}>
                <button
                  onClick={() => setAutoBackupManagerTab('settings')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    autoBackupManagerTab === 'settings'
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : `border-transparent ${textSecondary} ${hoverBg}`
                  }`}
                >
                  Settings
                </button>
                <button
                  onClick={() => { setAutoBackupManagerTab('history'); loadAutoBackupHistory(); }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    autoBackupManagerTab === 'history'
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : `border-transparent ${textSecondary} ${hoverBg}`
                  }`}
                >
                  History
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="px-6 pb-6 overflow-y-auto flex-1">
              {autoBackupManagerTab === 'settings' ? (
                <AutoBackupSettingsForm
                  config={autoBackupConfig}
                  setConfig={setAutoBackupConfig}
                  status={autoBackupStatus}
                  darkMode={darkMode}
                  textPrimary={textPrimary}
                  textSecondary={textSecondary}
                  borderClass={borderClass}
                  hoverBg={hoverBg}
                  onRemoteBackupNow={performRemoteBackup}
                />
              ) : (
                <div className="space-y-6">
                  {/* Restore confirmation */}
                  {autoBackupRestoreConfirm && (
                    <div className={`p-4 rounded-lg border ${borderClass} ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'}`}>
                      <p className={`text-sm ${textPrimary} mb-3`}>
                        Restore from this backup? All current data will be replaced and the page will reload.
                      </p>
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setAutoBackupRestoreConfirm(null)}
                          className={`px-3 py-1.5 text-sm rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg}`}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (autoBackupRestoreConfirm.type === 'local') {
                              restoreFromAutoBackup(autoBackupRestoreConfirm.id);
                            } else {
                              restoreFromRemoteBackup(autoBackupRestoreConfirm.filename);
                            }
                          }}
                          className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                        >
                          Restore
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Local Backups */}
                  <div>
                    <h4 className={`font-medium ${textPrimary} mb-2 flex items-center gap-2`}>
                      <Save size={14} />
                      Local Backups ({autoBackupHistory.local.length})
                    </h4>
                    {autoBackupHistory.local.length === 0 ? (
                      <p className={`text-sm ${textSecondary}`}>No local backups yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {autoBackupHistory.local.map(b => (
                          <div key={b.id} className={`flex items-center justify-between py-2 px-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-gray-50'}`}>
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm ${textPrimary} truncate`}>
                                {new Date(b.timestamp).toLocaleString()}
                              </p>
                              <p className={`text-xs ${textSecondary}`}>{b.frequency}</p>
                            </div>
                            <div className="flex items-center gap-1 ml-2 shrink-0">
                              <button
                                onClick={() => setAutoBackupRestoreConfirm({ type: 'local', id: b.id, timestamp: b.timestamp })}
                                className={`p-1.5 rounded ${hoverBg}`}
                                title="Restore"
                              >
                                <Undo2 size={14} className={textSecondary} />
                              </button>
                              <button
                                onClick={() => deleteLocalAutoBackup(b.id)}
                                className={`p-1.5 rounded ${hoverBg}`}
                                title="Delete"
                              >
                                <Trash2 size={14} className={textSecondary} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Remote Backups */}
                  {autoBackupConfig.remote.enabled && (
                    <div>
                      <h4 className={`font-medium ${textPrimary} mb-2 flex items-center gap-2`}>
                        <Cloud size={14} />
                        Remote Backups ({autoBackupHistory.remote.length})
                      </h4>
                      {autoBackupHistory.remote.length === 0 ? (
                        <p className={`text-sm ${textSecondary}`}>No remote backups yet.</p>
                      ) : (
                        <div className="space-y-1">
                          {autoBackupHistory.remote.map(b => (
                            <div key={b.filename} className={`flex items-center justify-between py-2 px-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-gray-50'}`}>
                              <div className="min-w-0 flex-1">
                                <p className={`text-sm ${textPrimary} truncate`}>
                                  {b.lastModified ? new Date(b.lastModified).toLocaleString() : b.filename}
                                </p>
                                <p className={`text-xs ${textSecondary} truncate`}>{b.filename}</p>
                              </div>
                              <div className="flex items-center gap-1 ml-2 shrink-0">
                                <button
                                  onClick={() => setAutoBackupRestoreConfirm({ type: 'remote', filename: b.filename, timestamp: b.lastModified })}
                                  className={`p-1.5 rounded ${hoverBg}`}
                                  title="Restore"
                                >
                                  <Undo2 size={14} className={textSecondary} />
                                </button>
                                <button
                                  onClick={() => deleteRemoteAutoBackup(b.filename)}
                                  className={`p-1.5 rounded ${hoverBg}`}
                                  title="Delete"
                                >
                                  <Trash2 size={14} className={textSecondary} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {syncNotification && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSyncNotification(null)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-2 rounded-full ${
                syncNotification.type === 'success' ? 'bg-green-100 dark:bg-green-900/30' :
                syncNotification.type === 'error' ? 'bg-red-100 dark:bg-red-900/30' :
                'bg-blue-100 dark:bg-blue-900/30'
              }`}>
                {syncNotification.type === 'success' ? (
                  <Check size={20} className="text-green-600 dark:text-green-400" />
                ) : syncNotification.type === 'error' ? (
                  <AlertCircle size={20} className="text-red-600 dark:text-red-400" />
                ) : (
                  <RefreshCw size={20} className="text-blue-600 dark:text-blue-400" />
                )}
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>
                {syncNotification.title ? syncNotification.title :
                 syncNotification.type === 'success' ? 'Sync Complete' :
                 syncNotification.type === 'error' ? 'Sync Failed' : 'Calendar Sync'}
              </h3>
            </div>
            <p className={`${textSecondary} mb-6`}>
              {syncNotification.message}
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setSyncNotification(null)}
                className={`px-4 py-2 ${
                  syncNotification.type === 'success' ? 'bg-green-600 hover:bg-green-700' :
                  syncNotification.type === 'error' ? 'bg-red-600 hover:bg-red-700' :
                  'bg-blue-600 hover:bg-blue-700'
                } text-white rounded-lg`}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo/Redo Toast */}
      {undoToast && (
        <div className={`fixed left-1/2 -translate-x-1/2 z-50 ${undoToast.actionable ? 'pointer-events-auto' : 'pointer-events-none'}`} style={{ bottom: isMobile ? 'calc(5rem + env(safe-area-inset-bottom, 0px))' : '1.5rem' }}>
          <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-800 text-white'}`}>
            <span>{undoToast.message}</span>
            {undoToast.actionable && (
              <button
                onClick={() => { performUndo(); }}
                className="font-semibold text-blue-400 hover:text-blue-300 ml-1"
              >
                Undo
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tablet: Timeline FABs — + (new task) and Routines */}
      {isTablet && (
        <>
          {/* Routines FAB — always visible on timeline */}
          <button
            onClick={openRoutinesDashboard}
            className={`fixed z-40 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-colors ${darkMode ? 'bg-teal-700 text-teal-100 active:bg-teal-600' : 'bg-teal-600 text-white active:bg-teal-700'}`}
            style={{ right: '1rem', bottom: '5.5rem' }}
            title="Routines"
          >
            <Sparkles size={22} />
          </button>
          {/* + New task FAB */}
          <button
            onClick={openNewTaskForm}
            className="fixed z-40 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg active:bg-blue-700 flex items-center justify-center transition-colors"
            style={{ right: '1rem', bottom: '1.5rem' }}
            title="New Scheduled Task"
          >
            <Plus size={28} />
          </button>
          {/* Glance panel FABs: weekly review (bottom), daily summary (middle), recycle bin (top) — only when glance panel is visible (portrait or landscape glance tab) */}
          {(!isLandscape || tabletActiveTab === 'glance') && (<>
          {/* Daily summary ring FAB */}
          {actualTodayNonImportedTasks.length > 0 && (() => {
            const pct = Math.round(((actualTodayCompletedTasks.length + inboxCompletedTodayCount) / actualTodayNonImportedTasks.length) * 100);
            const ringColor = pct >= 100 ? 'stroke-green-500' : pct >= 50 ? 'stroke-amber-500' : 'stroke-red-500';
            return (
              <button
                onClick={() => setShowMobileDailySummary(true)}
                className={`fixed z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 active:bg-gray-600' : 'bg-white active:bg-gray-100'} border ${borderClass}`}
                style={{ left: '248px', bottom: '5.5rem' }}
              >
                <div className="relative w-11 h-11">
                  <svg viewBox="0 0 36 36" className="w-11 h-11 -rotate-90">
                    <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" className={darkMode ? 'stroke-gray-600' : 'stroke-gray-200'} />
                    <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" strokeLinecap="round" className={ringColor}
                      strokeDasharray={`${(pct / 100) * 87.96} 87.96`}
                    />
                  </svg>
                  <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${textPrimary}`}>
                    <ChevronUp size={16} />
                  </span>
                </div>
              </button>
            );
          })()}
          {/* Weekly review FAB */}
          <button
            onClick={() => {
              if (showWeeklyReviewReminder) {
                weeklyReviewDismissedRef.current = lastWeeklyReviewFiredRef.current;
                localStorage.setItem('day-planner-weekly-review-dismissed', lastWeeklyReviewFiredRef.current);
                setShowWeeklyReviewReminder(false);
              }
              setShowWeeklyReview(true);
            }}
            className={`fixed z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${showWeeklyReviewReminder ? 'bg-blue-600 text-white active:bg-blue-700' : darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-gray-200 text-gray-600 active:bg-gray-300'}`}
            style={{ left: '248px', bottom: '1.5rem' }}
          >
            <BarChart3 size={22} />
          </button>
          {/* Recycle bin FAB — only when non-empty, always on top */}
          {recycleBin.filter(t => !t.isExample).length > 0 && (
            <button
              onClick={() => setShowMobileRecycleBin(true)}
              className={`fixed z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-gray-200 text-gray-600 active:bg-gray-300'}`}
              style={{ left: '248px', bottom: '9.5rem' }}
            >
              <div className="relative">
                <Trash2 size={22} />
                <span className="absolute -top-2 -right-3 bg-red-500 text-white text-[10px] font-bold min-w-[16px] h-[16px] flex items-center justify-center rounded-full px-0.5">
                  {recycleBin.filter(t => !t.isExample).length > 9 ? '9+' : recycleBin.filter(t => !t.isExample).length}
                </span>
              </div>
            </button>
          )}
          </>)}
        </>
      )}

      {/* Tablet: Recycle Bin Bottom Sheet */}
      {isTablet && showMobileRecycleBin && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileRecycleBin(false)}>
          <div className="bg-black/30 absolute inset-0" />
          <div
            className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[70vh] flex flex-col`}
            style={{ paddingBottom: '1rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-gray-300'}`} />
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Trash2 size={18} className={textSecondary} />
                <span className={`font-semibold ${textPrimary}`}>Recycle Bin</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'}`}>
                  {recycleBin.filter(t => !t.isExample).length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {recycleBin.filter(t => !t.isExample).length > 0 && (
                  <button onClick={emptyRecycleBin} className="text-xs text-red-500 font-medium px-2 py-1 rounded-lg hover:bg-red-500/5 active:bg-red-500/10 dark:hover:bg-red-500/10 dark:active:bg-red-500/20 transition-colors">Empty All</button>
                )}
                <button onClick={() => setShowMobileRecycleBin(false)} className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-100 hover:bg-gray-200'} transition-colors`} aria-label="Close recycle bin">
                  <X size={16} className={textSecondary} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto px-4 pb-2 space-y-2">
              {recycleBin.filter(t => !t.isExample).length === 0 ? (
                <p className={`text-sm ${textSecondary} text-center py-8`}>Recycle bin is empty</p>
              ) : (
                recycleBin.filter(t => !t.isExample).map(task => (
                  <div key={`tablet-bin-${task.id}`} className={`${task.color} rounded-lg p-3 opacity-60`}>
                    <div className="flex items-start justify-between text-white">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{renderTitle(task.title)}</div>
                        <div className="text-xs opacity-75 mt-1">
                          {task._deletedFrom === 'inbox' ? <>Inbox • {task.duration}min</> : task.startTime ? <>{formatTime(task.startTime)} • {task.duration}min</> : <>{task.duration}min</>}
                        </div>
                      </div>
                      <button onClick={() => { undeleteTask(task.id); if (recycleBin.filter(t => !t.isExample).length <= 1) setShowMobileRecycleBin(false); }} className="bg-white/20 rounded-lg p-1.5 hover:bg-white/25 active:bg-white/30 transition-colors" title="Restore">
                        <Undo2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tablet: Tag Filter Bottom Sheet */}
      {isTablet && showMobileTagFilter && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileTagFilter(false)}>
          <div className="bg-black/30 absolute inset-0" />
          <div
            className={`relative ${cardBg} rounded-t-2xl shadow-xl`}
            style={{ paddingBottom: '1rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-gray-300'}`} />
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Filter size={18} className={textSecondary} />
                <span className={`font-semibold ${textPrimary}`}>Filter by Tag</span>
              </div>
              <div className="flex items-center gap-3">
                {allTags.every(tag => selectedTags.includes(tag)) ? (
                  <button onClick={clearTagFilter} className="text-sm text-blue-500 hover:text-blue-600 active:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 dark:active:text-blue-200 font-medium transition-colors">Clear</button>
                ) : (
                  <button onClick={selectAllTags} className="text-sm text-blue-500 hover:text-blue-600 active:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 dark:active:text-blue-200 font-medium transition-colors">Select All</button>
                )}
                <button onClick={() => setShowMobileTagFilter(false)} className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-100 hover:bg-gray-200'} transition-colors`} aria-label="Close tag filter">
                  <X size={16} className={textSecondary} />
                </button>
              </div>
            </div>
            <div className="px-4 pb-4 space-y-1 max-h-[50vh] overflow-y-auto">
              {allTags.map(tag => {
                const visibleDateStrs = new Set(visibleDates.map(d => dateToString(d)));
                const regularCount = tasks.filter(t => !t.imported && visibleDateStrs.has(t.date) && extractTags(t.title).includes(tag)).length;
                const recurringCount = expandedRecurringTasks.filter(t => visibleDateStrs.has(t.date) && extractTags(t.title).includes(tag)).length;
                const tagCount = regularCount + recurringCount;
                if (tagCount === 0) return null;
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
                      selectedTags.includes(tag)
                        ? darkMode ? 'bg-blue-500/20' : 'bg-blue-50'
                        : darkMode ? 'active:bg-white/5' : 'active:bg-gray-50'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                      selectedTags.includes(tag) ? 'bg-blue-500 border-blue-500' : darkMode ? 'border-gray-600' : 'border-gray-300'
                    }`}>
                      {selectedTags.includes(tag) && <Check size={14} className="text-white" />}
                    </div>
                    <Hash size={14} className={textSecondary} />
                    <span className={`flex-1 text-left text-sm ${textPrimary}`}>{tag}</span>
                    <span className={`text-xs ${textSecondary} tabular-nums`}>{tagCount}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tablet: Daily Summary Bottom Sheet — constrained to side panel width */}
      {isTablet && showMobileDailySummary && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ width: '320px' }} onClick={() => setShowMobileDailySummary(false)}>
          <div className="bg-black/30 absolute inset-0" />
          <div
            className={`relative ${cardBg} rounded-t-2xl shadow-xl`}
            style={{ paddingBottom: '1rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-gray-300'}`} />
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <BarChart3 size={18} className={textSecondary} />
                <span className={`font-semibold ${textPrimary}`}>Daily Summary</span>
              </div>
              <button onClick={() => setShowMobileDailySummary(false)} className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-100 hover:bg-gray-200'} transition-colors`} aria-label="Close daily summary">
                <X size={16} className={textSecondary} />
              </button>
            </div>
            <div className="px-4 pb-4">
              {actualTodayNonImportedTasks.length === 0 ? (
                <p className={`text-sm ${textSecondary} text-center py-4`}>No tasks scheduled for today</p>
              ) : (() => {
                const pct = Math.round(((actualTodayCompletedTasks.length + inboxCompletedTodayCount) / actualTodayNonImportedTasks.length) * 100);
                const ringColor = pct >= 100 ? 'stroke-green-500' : pct >= 50 ? 'stroke-amber-500' : 'stroke-red-500';
                return (
                  <>
                    <div className="flex items-center gap-4 mb-4">
                      <div className="relative w-16 h-16 flex-shrink-0">
                        <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className={darkMode ? 'stroke-gray-700' : 'stroke-gray-200'} />
                          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" strokeLinecap="round" className={ringColor}
                            strokeDasharray={`${(pct / 100) * 97.4} 97.4`}
                          />
                        </svg>
                        <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${textPrimary}`}>{pct}%</span>
                      </div>
                      <div>
                        <div className={`text-lg font-bold ${textPrimary}`}>{actualTodayCompletedTasks.length} of {actualTodayNonImportedTasks.length} done</div>
                        {todayIncompleteTasks.length > 0 && (
                          <button onClick={() => { setShowIncompleteTasks('today'); setShowMobileDailySummary(false); }} className="text-sm text-blue-500 active:text-blue-600">
                            {todayIncompleteTasks.length} incomplete
                          </button>
                        )}
                        {inboxCompletedTodayCount > 0 && (
                          <div className={`text-sm ${textSecondary}`}>+ {inboxCompletedTodayCount} inbox {inboxCompletedTodayCount === 1 ? 'task' : 'tasks'} done</div>
                        )}
                      </div>
                    </div>
                    <div className={`space-y-3 ${textSecondary}`}>
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2"><Clock size={14} className="text-orange-400" /> Time spent</div>
                        <span className={`font-medium ${textPrimary}`}>{Math.floor((actualTodayCompletedMinutes + inboxCompletedTodayMinutes) / 60)}h {(actualTodayCompletedMinutes + inboxCompletedTodayMinutes) % 60}m</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2"><Clock size={14} className="text-blue-400" /> Time planned</div>
                        <span className={`font-medium ${textPrimary}`}>{Math.floor(actualTodayPlannedMinutes / 60)}h {actualTodayPlannedMinutes % 60}m</span>
                      </div>
                      {actualTodayFocusMinutes > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2"><BrainCircuit size={14} className="text-purple-400" /> Focus time</div>
                          <span className={`font-medium ${textPrimary}`}>{Math.floor(actualTodayFocusMinutes / 60)}h {Math.round(actualTodayFocusMinutes % 60)}m</span>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Refocus timeline toast — all form factors */}
      {timelineScrolledAway && (
        <div className="fixed left-1/2 -translate-x-1/2 z-50 pointer-events-auto" style={{ bottom: isMobile ? 'calc(5rem + env(safe-area-inset-bottom, 0px))' : '1.5rem' }}>
          <button
            onClick={() => { setTimelineScrolledAway(false); scrollToCurrentHour(true); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-sm font-medium bg-blue-600 text-white active:bg-blue-700 transition-opacity`}
          >
            <Clock size={14} />
            <span>Refocus timeline</span>
          </button>
        </div>
      )}

      {/* Weekly Review Reminder Toast */}
      {showWeeklyReviewReminder && !showWeeklyReview && (
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
                className={`px-2.5 py-1 text-xs rounded transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reminder Toasts */}
      {activeReminders.length > 0 && (
        <div className={`fixed right-6 z-50 flex flex-col-reverse gap-2 w-64 ${showWeeklyReviewReminder && !showWeeklyReview ? 'bottom-36' : 'bottom-6'}`}>
          {activeReminders.slice(0, 5).map((reminder) => (
            <div
              key={reminder.id}
              className={`w-full ${cardBg} rounded-lg shadow-xl ${borderClass} border p-3 animate-in slide-in-from-right`}
            >
              <div className="flex items-start gap-2">
                <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${reminder.taskColor || 'bg-blue-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${textPrimary}`}>{reminder.taskTitle}</p>
                  <div className="flex items-center gap-2">
                    <p className={`text-xs ${textSecondary}`}>{reminder.message}</p>
                    {reminder.startTime && reminder.type !== 'morning' && (
                      <span className={`text-xs ${textSecondary}`}>{reminder.startTime}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => dismissReminder(reminder.id)}
                  className={`${textSecondary} hover:${textPrimary} flex-shrink-0`}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="flex items-center justify-center gap-2 mt-2">
                {reminder.type === 'end' && !reminder.isCalendarEvent && (
                  <button
                    onClick={() => { toggleComplete(reminder.taskId); dismissReminder(reminder.id); }}
                    className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    Complete
                  </button>
                )}
                {reminder.type !== 'end' && reminder.type !== 'morning' && reminder.startTime && (
                  <button
                    onClick={() => snoozeReminder(reminder)}
                    className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    Snooze 15m
                  </button>
                )}
                <button
                  onClick={() => dismissReminder(reminder.id)}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
          {activeReminders.length > 5 && (
            <p className={`text-xs ${textSecondary} text-right`}>+{activeReminders.length - 5} more</p>
          )}
          {activeReminders.length > 1 && (
            <button
              onClick={dismissAllReminders}
              className={`text-xs ${textSecondary} hover:underline text-right`}
            >
              Dismiss all
            </button>
          )}
        </div>
      )}

      {/* Mobile New/Edit Task Modal */}
      {showAddTask && isMobile && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => { setShowAddTask(false); setShowNewTaskDeadlinePicker(false); setMobileEditingTask(null); setMobileEditIsInbox(false); }}>
          <div className="bg-black/30 absolute inset-0" />
          <div
            className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[85vh] overflow-y-auto`}
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
              <h3 className={`font-semibold ${textPrimary} text-lg`}>
                {mobileEditingTask ? 'Edit Task' : newTask.openInInbox ? 'New Inbox Task' : 'New Scheduled Task'}
              </h3>
              <button onClick={() => { setShowAddTask(false); setShowNewTaskDeadlinePicker(false); setMobileEditingTask(null); setMobileEditIsInbox(false); }} className={`p-1 rounded-lg ${hoverBg}`}>
                <X size={18} className={textSecondary} />
              </button>
            </div>
            <form
              className="p-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (mobileEditingTask) {
                  saveMobileEditTask();
                } else {
                  addTask(!!newTask.openInInbox);
                  setShowNewTaskDeadlinePicker(false);
                }
              }}
            >
              {/* Title */}
              <div>
                <input
                  ref={newTaskInputRef}
                  type="text"
                  placeholder="Task title"
                  value={newTask.title}
                  onChange={handleNewTaskInputChange}
                  autoFocus={!mobileEditingTask && !newTask.title}
                  className={`w-full px-3 py-3 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} text-base`}
                />
              </div>

              {/* Color row */}
              <div>
                <label className={`block text-sm ${textSecondary} mb-2`}>Color</label>
                <div className="flex gap-2 flex-wrap">
                  {colors.map((color) => (
                    <button
                      type="button"
                      key={color.class}
                      onClick={() => setNewTask({ ...newTask, color: color.class })}
                      className={`${color.class} w-8 h-8 rounded-full transition-transform ${(newTask.color || colors[0].class) === color.class ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : ''}`}
                      title={color.name}
                    />
                  ))}
                </div>
              </div>

              {/* Fields grid */}
              {newTask.openInInbox ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Priority</label>
                    <button
                      type="button"
                      onClick={() => setNewTask({ ...newTask, priority: ((newTask.priority || 0) + 1) % 4 })}
                      className={`w-full h-10 px-3 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-white'} flex items-center justify-center gap-1`}
                    >
                      {[1, 2, 3].map((level) => (
                        <div
                          key={level}
                          className={`w-4 h-1 rounded-full ${(newTask.priority || 0) >= level ? 'bg-orange-500' : darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}
                        />
                      ))}
                    </button>
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Deadline</label>
                    <div className="relative deadline-picker-container">
                      <button
                        type="button"
                        onClick={() => setShowNewTaskDeadlinePicker(!showNewTaskDeadlinePicker)}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} flex items-center gap-2`}
                      >
                        <Calendar size={14} className={textSecondary} />
                        {newTask.deadline
                          ? new Date(newTask.deadline + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : 'None'}
                      </button>
                      {showNewTaskDeadlinePicker && (
                        <div className={`absolute bottom-12 left-0 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-2 min-w-[160px] z-20`}>
                          <div className="space-y-1">
                            <button type="button" onClick={() => { setNewTask({ ...newTask, deadline: dateToString(new Date()) }); setShowNewTaskDeadlinePicker(false); }} className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}><Calendar size={14} />Today</button>
                            <button type="button" onClick={() => { const d = new Date(); d.setDate(d.getDate() + 1); setNewTask({ ...newTask, deadline: dateToString(d) }); setShowNewTaskDeadlinePicker(false); }} className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}><Calendar size={14} />Tomorrow</button>
                            <button type="button" onClick={() => { const d = new Date(); d.setDate(d.getDate() + 7); setNewTask({ ...newTask, deadline: dateToString(d) }); setShowNewTaskDeadlinePicker(false); }} className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}><Calendar size={14} />Next week</button>
                            {newTask.deadline && (
                              <>
                                <div className={`border-t ${borderClass} my-1`}></div>
                                <button type="button" onClick={() => { setNewTask({ ...newTask, deadline: null }); setShowNewTaskDeadlinePicker(false); }} className={`w-full text-left px-3 py-2 rounded text-sm text-red-500 ${hoverBg} flex items-center gap-2`}><X size={14} />Clear</button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className={`block text-sm ${textSecondary} mb-1`}>Duration</label>
                    <select
                      value={newTask.duration}
                      onChange={(e) => setNewTask({ ...newTask, duration: parseInt(e.target.value) })}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                    >
                      {durationOptions.map(minutes => (
                        <option key={minutes} value={minutes}>{minutes} min</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Date</label>
                    <button
                      type="button"
                      onClick={() => setShowDatePicker(true)}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                    >
                      {newTask.date ? new Date(newTask.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Select'}
                    </button>
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Time</label>
                    <button
                      type="button"
                      onClick={() => !newTask.isAllDay && setShowTimePicker(true)}
                      disabled={newTask.isAllDay}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.isAllDay ? 'opacity-50' : ''}`}
                    >
                      {newTask.isAllDay ? 'All Day' : formatTime(newTask.startTime)}
                    </button>
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Duration</label>
                    <select
                      value={newTask.duration}
                      onChange={(e) => setNewTask({ ...newTask, duration: parseInt(e.target.value) })}
                      disabled={newTask.isAllDay}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.isAllDay ? 'opacity-50' : ''}`}
                    >
                      {durationOptions.map(minutes => (
                        <option key={minutes} value={minutes}>{minutes} min</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>All Day</label>
                    <label className="flex items-center h-10 cursor-pointer" onClick={(e) => { e.preventDefault(); setNewTask(prev => ({ ...prev, isAllDay: !prev.isAllDay })); }}>
                      <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${newTask.isAllDay ? 'bg-blue-600 border-blue-600' : darkMode ? 'border-gray-500' : 'border-gray-300'}`}>
                        {newTask.isAllDay && <Check size={14} className="text-white" strokeWidth={3} />}
                      </div>
                      <span className={`ml-2 text-sm ${textPrimary}`}>Full day</span>
                    </label>
                  </div>
                  {(<>
                    <div className="col-span-2 relative">
                      <label className={`block text-sm ${textSecondary} mb-1`}>Recurrence</label>
                      <button
                        type="button"
                        onClick={() => setShowRecurrencePicker(!showRecurrencePicker)}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.recurrence ? 'ring-2 ring-blue-500' : ''}`}
                      >
                        {newTask.recurrence ? getRecurrenceLabel(newTask.recurrence) : 'None'}
                      </button>
                      {showRecurrencePicker && (() => {
                        const presets = getRecurrencePresets(newTask.date || dateToString(selectedDate));
                        return (
                          <div className={`absolute bottom-full left-0 mb-1 ${cardBg} rounded-lg shadow-xl z-30 border ${borderClass} min-w-[250px] max-h-[200px] overflow-y-auto`}>
                            {presets.map((preset, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => {
                                  const endFields = {};
                                  if (newTask.recurrence?.endDate) endFields.endDate = newTask.recurrence.endDate;
                                  if (newTask.recurrence?.maxOccurrences) endFields.maxOccurrences = newTask.recurrence.maxOccurrences;
                                  setNewTask({ ...newTask, recurrence: preset.value ? { ...preset.value, ...endFields } : null });
                                  setShowRecurrencePicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} ${textPrimary}`}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    {newTask.recurrence && (
                      <div className="col-span-2">
                        <label className={`block text-xs font-medium ${textSecondary} mb-1`}>Ends</label>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              const { endDate: _e, maxOccurrences: _m, ...rest } = newTask.recurrence;
                              setNewTask({ ...newTask, recurrence: rest });
                            }}
                            className={`px-3 py-1.5 text-sm rounded-lg border ${borderClass} ${
                              !newTask.recurrence.endDate && !newTask.recurrence.maxOccurrences
                                ? 'bg-blue-600 text-white border-blue-600'
                                : `${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`
                            }`}
                          >
                            Never
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowRecurrenceEndDatePicker({ source: 'new' })}
                            className={`px-3 py-1.5 text-sm rounded-lg border ${borderClass} ${
                              newTask.recurrence.endDate
                                ? 'bg-blue-600 text-white border-blue-600'
                                : `${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`
                            }`}
                          >
                            {newTask.recurrence.endDate
                              ? `Until ${new Date(newTask.recurrence.endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                              : 'On date'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!newTask.recurrence.maxOccurrences) {
                                const { endDate: _e, ...rest } = newTask.recurrence;
                                setNewTask({ ...newTask, recurrence: { ...rest, maxOccurrences: 10 } });
                              }
                            }}
                            className={`px-3 py-1.5 text-sm rounded-lg border ${borderClass} ${
                              newTask.recurrence.maxOccurrences
                                ? 'bg-blue-600 text-white border-blue-600'
                                : `${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`
                            }`}
                          >
                            After
                          </button>
                          {newTask.recurrence.maxOccurrences && (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="999"
                                value={newTask.recurrence.maxOccurrences}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value);
                                  if (val > 0) {
                                    const { endDate: _e, ...rest } = newTask.recurrence;
                                    setNewTask({ ...newTask, recurrence: { ...rest, maxOccurrences: val } });
                                  }
                                }}
                                className={`w-16 px-2 py-1 text-sm border ${borderClass} rounded ${darkMode ? 'bg-gray-700 text-white dark-spinner' : 'bg-white'}`}
                              />
                              <span className={`text-sm ${textSecondary}`}>times</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>)}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  {mobileEditingTask ? 'Save Changes' : newTask.openInInbox ? 'Add to Inbox' : 'Add to Schedule'}
                </button>
              </div>

              {/* Delete button for edit mode */}
              {mobileEditingTask && (
                <button
                  type="button"
                  onClick={() => {
                    moveToRecycleBin(mobileEditingTask.id, mobileEditIsInbox);
                    setShowAddTask(false);
                    setMobileEditingTask(null);
                    setMobileEditIsInbox(false);
                  }}
                  className="w-full px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                >
                  Delete Task
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {/* New Task Modal */}
      {showAddTask && !isMobile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowAddTask(false); setShowNewTaskDeadlinePicker(false); setMobileEditingTask(null); }}>
          <form
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (mobileEditingTask) {
                saveMobileEditTask();
              } else {
                const addToInbox = e.nativeEvent.submitter?.dataset.inbox === 'true' || newTask.openInInbox;
                addTask(addToInbox);
              }
              setShowNewTaskDeadlinePicker(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                if (showRecurrencePicker) {
                  setShowRecurrencePicker(false);
                } else if (showNewTaskDeadlinePicker) {
                  setShowNewTaskDeadlinePicker(false);
                } else if (deadlinePickerTaskId) {
                  setDeadlinePickerTaskId(null);
                } else if (showDatePicker) {
                  setShowDatePicker(false);
                } else if (showRecurrenceEndDatePicker) {
                  setShowRecurrenceEndDatePicker(null);
                } else {
                  setShowAddTask(false);
                  setMobileEditingTask(null);
                }
              } else if (e.key === '^' && !newTask.openInInbox) {
                // '^' toggles Full Day for scheduled tasks
                e.preventDefault();
                setNewTask({ ...newTask, isAllDay: !newTask.isAllDay });
              } else if (e.key === ' ' && e.target.tagName !== 'INPUT') {
                // Prevent SPACE from activating buttons
                e.preventDefault();
              }
            }}
          >
            <h3 className={`font-semibold ${textPrimary} mb-4 text-lg`}>
              {mobileEditingTask ? 'Edit Task' : newTask.openInInbox ? 'New Inbox Task' : 'New Scheduled Task'}
            </h3>
            <div className="space-y-4">
              <div className="relative tag-autocomplete-container">
                <input
                  ref={newTaskInputRef}
                  type="text"
                  placeholder={newTask.openInInbox ? "Task title (#tag, $deadline, !priority, %mins)" : "Task title (#tag, @date, ~time, %mins, ^all-day)"}
                  value={newTask.title}
                  onChange={handleNewTaskInputChange}
                  onKeyDown={handleNewTaskInputKeyDown}
                  autoFocus={!(isTablet && mobileEditingTask)}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                />
                {showSuggestions && suggestionContext === 'newTask' && (
                  <SuggestionAutocomplete
                    suggestions={suggestions}
                    selectedIndex={selectedSuggestionIndex}
                    onSelect={applySuggestionForNewTask}
                  />
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {newTask.openInInbox ? (
                  <>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Color</label>
                      <div className="relative color-picker-container">
                        <button
                          type="button"
                          onClick={() => setShowColorPicker(showColorPicker === 'newTask' ? null : 'newTask')}
                          className={`w-full h-10 ${newTask.color || colors[0].class} rounded-lg border ${borderClass}`}
                        />
                        {showColorPicker === 'newTask' && (
                          <div className={`absolute top-12 left-0 ${cardBg} rounded-lg p-2 shadow-xl z-20 border ${borderClass} min-w-[120px]`}>
                            <div className="grid grid-cols-3 gap-1">
                              {colors.map((color) => (
                                <button
                                  type="button"
                                  key={color.class}
                                  onClick={() => {
                                    setNewTask({ ...newTask, color: color.class });
                                    setShowColorPicker(null);
                                  }}
                                  className={`${color.class} w-8 h-8 rounded-full hover:scale-110 transition-transform`}
                                  title={color.name}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Priority</label>
                      <button
                        type="button"
                        onClick={() => setNewTask({ ...newTask, priority: ((newTask.priority || 0) + 1) % 4 })}
                        className={`w-full h-10 px-3 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-white'} flex items-center justify-center gap-1`}
                        title={['No priority', 'Low priority', 'Medium priority', 'High priority'][newTask.priority || 0]}
                      >
                        {[1, 2, 3].map((level) => (
                          <div
                            key={level}
                            className={`w-4 h-1 rounded-full ${(newTask.priority || 0) >= level ? 'bg-orange-500' : darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}
                          />
                        ))}
                      </button>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Deadline</label>
                      <div className="relative deadline-picker-container">
                        <button
                          type="button"
                          onClick={() => setShowNewTaskDeadlinePicker(!showNewTaskDeadlinePicker)}
                          className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} flex items-center gap-2`}
                        >
                          <Calendar size={14} className={textSecondary} />
                          {newTask.deadline
                            ? new Date(newTask.deadline + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : 'None'}
                        </button>
                        {showNewTaskDeadlinePicker && (
                          <div className={`absolute top-12 left-0 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-2 min-w-[160px] z-20`}>
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setNewTask({ ...newTask, deadline: dateToString(new Date()) });
                                  setShowNewTaskDeadlinePicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
                              >
                                <Calendar size={14} />
                                Today
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const tomorrow = new Date();
                                  tomorrow.setDate(tomorrow.getDate() + 1);
                                  setNewTask({ ...newTask, deadline: dateToString(tomorrow) });
                                  setShowNewTaskDeadlinePicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
                              >
                                <Calendar size={14} />
                                Tomorrow
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextWeek = new Date();
                                  nextWeek.setDate(nextWeek.getDate() + 7);
                                  setNewTask({ ...newTask, deadline: dateToString(nextWeek) });
                                  setShowNewTaskDeadlinePicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
                              >
                                <Calendar size={14} />
                                Next week
                              </button>
                              <div className={`border-t ${borderClass} my-1`}></div>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowNewTaskDeadlinePicker(false);
                                  setDeadlinePickerTaskId('newTask');
                                }}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
                              >
                                <Calendar size={14} />
                                Pick date...
                              </button>
                              {newTask.deadline && (
                                <>
                                  <div className={`border-t ${borderClass} my-1`}></div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNewTask({ ...newTask, deadline: null });
                                      setShowNewTaskDeadlinePicker(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded text-sm text-red-500 ${hoverBg} flex items-center gap-2`}
                                  >
                                    <X size={14} />
                                    Clear deadline
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Row 1: Color, Date, Recurrence */}
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Color</label>
                      <div className="relative color-picker-container">
                        <button
                          type="button"
                          onClick={() => setShowColorPicker(showColorPicker === 'newTask' ? null : 'newTask')}
                          className={`w-full h-10 ${newTask.color || colors[0].class} rounded-lg border ${borderClass}`}
                        />
                        {showColorPicker === 'newTask' && (
                          <div className={`absolute top-12 left-0 ${cardBg} rounded-lg p-2 shadow-xl z-20 border ${borderClass} min-w-[120px]`}>
                            <div className="grid grid-cols-3 gap-1">
                              {colors.map((color) => (
                                <button
                                  type="button"
                                  key={color.class}
                                  onClick={() => {
                                    setNewTask({ ...newTask, color: color.class });
                                    setShowColorPicker(null);
                                  }}
                                  className={`${color.class} w-8 h-8 rounded-full hover:scale-110 transition-transform`}
                                  title={color.name}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Date</label>
                      <button
                        type="button"
                        onClick={() => setShowDatePicker(true)}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                      >
                        {newTask.date ? new Date(newTask.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Select'}
                      </button>
                    </div>
                    <div className="relative">
                      <label className={`block text-sm ${textSecondary} mb-1`}>Recurrence</label>
                      <button
                        type="button"
                        onClick={() => setShowRecurrencePicker(!showRecurrencePicker)}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.recurrence ? 'ring-2 ring-blue-500' : ''}`}
                      >
                        {newTask.recurrence ? getRecurrenceLabel(newTask.recurrence) : 'None'}
                      </button>
                      {showRecurrencePicker && (() => {
                        const presets = getRecurrencePresets(newTask.date || dateToString(selectedDate));

                        return (
                          <div className={`absolute top-full left-0 mt-1 ${cardBg} rounded-lg shadow-xl z-30 border ${borderClass} min-w-[250px] max-h-[300px] overflow-y-auto`}>
                            {presets.map((preset, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => {
                                  const endFields = {};
                                  if (newTask.recurrence?.endDate) endFields.endDate = newTask.recurrence.endDate;
                                  if (newTask.recurrence?.maxOccurrences) endFields.maxOccurrences = newTask.recurrence.maxOccurrences;
                                  setNewTask({ ...newTask, recurrence: preset.value ? { ...preset.value, ...endFields } : null });
                                  setShowRecurrencePicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} ${
                                  JSON.stringify(newTask.recurrence) === JSON.stringify(preset.value) ? (darkMode ? 'bg-gray-700' : 'bg-blue-50 text-blue-700') : textPrimary
                                } ${i === 0 ? 'rounded-t-lg' : ''} ${i === presets.length - 1 ? 'rounded-b-lg' : ''}`}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    {newTask.recurrence && (
                      <div className="col-span-full">
                        <label className={`block text-xs font-medium ${textSecondary} mb-1`}>Ends</label>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              const { endDate: _e, maxOccurrences: _m, ...rest } = newTask.recurrence;
                              setNewTask({ ...newTask, recurrence: rest });
                            }}
                            className={`px-3 py-1.5 text-sm rounded-lg border ${borderClass} ${
                              !newTask.recurrence.endDate && !newTask.recurrence.maxOccurrences
                                ? 'bg-blue-600 text-white border-blue-600'
                                : `${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`
                            }`}
                          >
                            Never
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowRecurrenceEndDatePicker({ source: 'new' })}
                            className={`px-3 py-1.5 text-sm rounded-lg border ${borderClass} ${
                              newTask.recurrence.endDate
                                ? 'bg-blue-600 text-white border-blue-600'
                                : `${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`
                            }`}
                          >
                            {newTask.recurrence.endDate
                              ? `Until ${new Date(newTask.recurrence.endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                              : 'On date'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!newTask.recurrence.maxOccurrences) {
                                const { endDate: _e, ...rest } = newTask.recurrence;
                                setNewTask({ ...newTask, recurrence: { ...rest, maxOccurrences: 10 } });
                              }
                            }}
                            className={`px-3 py-1.5 text-sm rounded-lg border ${borderClass} ${
                              newTask.recurrence.maxOccurrences
                                ? 'bg-blue-600 text-white border-blue-600'
                                : `${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`
                            }`}
                          >
                            After
                          </button>
                          {newTask.recurrence.maxOccurrences && (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="999"
                                value={newTask.recurrence.maxOccurrences}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value);
                                  if (val > 0) {
                                    const { endDate: _e, ...rest } = newTask.recurrence;
                                    setNewTask({ ...newTask, recurrence: { ...rest, maxOccurrences: val } });
                                  }
                                }}
                                className={`w-16 px-2 py-1 text-sm border ${borderClass} rounded ${darkMode ? 'bg-gray-700 text-white dark-spinner' : 'bg-white'}`}
                              />
                              <span className={`text-sm ${textSecondary}`}>times</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {/* Row 2: Time, Duration, All Day */}
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Time</label>
                      <button
                        type="button"
                        onClick={() => !newTask.isAllDay && setShowTimePicker(true)}
                        disabled={newTask.isAllDay}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.isAllDay ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {newTask.isAllDay ? 'All Day' : formatTime(newTask.startTime)}
                      </button>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Duration</label>
                      <select
                        value={newTask.duration}
                        onChange={(e) => setNewTask({ ...newTask, duration: parseInt(e.target.value) })}
                        disabled={newTask.isAllDay}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.isAllDay ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {durationOptions.map(minutes => (
                          <option key={minutes} value={minutes}>
                            {minutes} min
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>All Day</label>
                      <div className="flex items-center h-10 cursor-pointer" onClick={() => setNewTask(prev => ({ ...prev, isAllDay: !prev.isAllDay }))}>
                        <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${newTask.isAllDay ? 'bg-blue-600 border-blue-600' : darkMode ? 'border-gray-500' : 'border-gray-300'}`}>
                          {newTask.isAllDay && <Check size={14} className="text-white" strokeWidth={3} />}
                        </div>
                        <span className={`ml-2 text-sm ${textPrimary}`}>Full day</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {mobileEditingTask ? 'Save Changes' : newTask.openInInbox ? 'Add to Inbox' : 'Add to Schedule'}
                </button>
                {mobileEditingTask && (
                  <button
                    type="button"
                    onClick={() => {
                      moveToRecycleBin(mobileEditingTask.id, mobileEditIsInbox);
                      setShowAddTask(false);
                      setMobileEditingTask(null);
                      setMobileEditIsInbox(false);
                    }}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setShowAddTask(false); setShowNewTaskDeadlinePicker(false); setMobileEditingTask(null); }}
                  className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-lg transition-colors`}
                >
                  Cancel
                </button>
              </div>
              {!mobileEditingTask && (
              <div className={`text-xs ${textSecondary} text-center`}>
                <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded`}>Enter</kbd> add to {newTask.openInInbox ? 'inbox' : 'schedule'}
                {' '} • <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded`}>Esc</kbd> cancel
              </div>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Routines Dashboard Modal */}
      {showRoutinesDashboard && (<>
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => handleRoutinesDone()} onKeyDown={(e) => { if ((e.key === 'Escape' || e.key === 'Enter') && !routineAddingToBucket) { e.preventDefault(); handleRoutinesDone(); } }} tabIndex={-1} ref={(el) => { if (el && !routineAddingToBucket) el.focus(); }}>
          <div className={`${cardBg} rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col`} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className={`p-6 border-b ${borderClass}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img
                    src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'}
                    alt="dayGLANCE"
                    className="h-[4.5rem]"
                  />
                  <div>
                    <div className={`text-lg font-bold ${textPrimary}`}>
                      {new Date().toLocaleDateString('en-US', { weekday: 'long' })}, {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                    </div>
                    <div className={`text-sm ${textSecondary}`}>What's in today's routine?</div>
                  </div>
                </div>
                <button onClick={() => setShowRoutinesDashboard(false)} className={`p-2 rounded-lg ${hoverBg}`}>
                  <X size={20} className={textSecondary} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {(() => {
                const today = new Date();
                const todayDayName = getDayName(today);
                const leftBuckets = ['everyday', 'monday', 'tuesday', 'wednesday'];
                const rightBuckets = ['thursday', 'friday', 'saturday', 'sunday'];
                const bucketLabel = (b) => b === 'everyday' ? 'Every Day' : b.charAt(0).toUpperCase() + b.slice(1);
                const isHighlighted = (b) => b === todayDayName || b === 'everyday';

                const renderBucket = (bucket) => {
                  const chips = routineDefinitions[bucket] || [];
                  return (
                    <div
                      key={bucket}
                      className={`${darkMode ? 'bg-gray-700/50' : 'bg-gray-50'} rounded-lg p-3 ${isHighlighted(bucket) ? (darkMode ? 'ring-2 ring-teal-400 bg-teal-900/20' : 'ring-2 ring-teal-500 bg-teal-50') : ''}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-semibold uppercase tracking-wide ${isHighlighted(bucket) ? 'text-teal-500' : textSecondary}`}>
                          {bucketLabel(bucket)}
                        </span>
                        <button
                          onClick={() => {
                            setRoutineAddingToBucket(routineAddingToBucket === bucket ? null : bucket);
                            setRoutineNewChipName('');
                          }}
                          className={`p-0.5 rounded ${hoverBg}`}
                          title="Add routine"
                        >
                          <Plus size={14} className={textSecondary} />
                        </button>
                      </div>
                      {routineAddingToBucket === bucket && (
                        <div className="flex gap-1 mb-2">
                          <input
                            autoFocus
                            value={routineNewChipName}
                            onChange={(e) => setRoutineNewChipName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') addRoutineChip(bucket);
                              if (e.key === 'Escape') { setRoutineAddingToBucket(null); setRoutineNewChipName(''); }
                            }}
                            placeholder="Name..."
                            className={`flex-1 min-w-0 px-2 py-1 text-xs rounded ${darkMode ? 'bg-gray-600 text-white placeholder-gray-400' : 'bg-white text-gray-900 placeholder-gray-400 border border-gray-300'} focus:outline-none focus:ring-1 focus:ring-teal-500`}
                          />
                          <button onClick={() => addRoutineChip(bucket)} className="px-2 py-1 text-xs bg-teal-600 text-white rounded hover:bg-teal-700">Add</button>
                        </div>
                      )}
                      <div className={`flex flex-wrap ${isTablet ? 'gap-1.5' : 'gap-1'}`}>
                        {chips.map(chip => {
                          const isSelected = dashboardSelectedChips.some(c => c.id === chip.id);
                          const isFocused = routineFocusedChipId === chip.id;
                          return (
                            <div
                              key={chip.id}
                              onClick={() => {
                                if (isTablet) {
                                  if (isFocused) {
                                    toggleRoutineChipSelection(chip, bucket);
                                    setRoutineFocusedChipId(null);
                                  } else {
                                    setRoutineFocusedChipId(chip.id);
                                  }
                                } else {
                                  toggleRoutineChipSelection(chip, bucket);
                                }
                              }}
                              className={`group relative rounded-full ${isTablet ? 'px-3.5 py-1.5 text-sm' : 'px-2.5 py-1 text-xs'} font-medium cursor-pointer transition-colors ${
                                isSelected
                                  ? (darkMode ? 'bg-gray-600 text-gray-400' : 'bg-gray-200 text-gray-400')
                                  : (darkMode ? 'bg-teal-700/80 text-teal-100 hover:bg-teal-600/80' : 'bg-teal-600/80 text-white hover:bg-teal-500/80')
                              }`}
                            >
                              {chip.name}
                              <button
                                onClick={(e) => { e.stopPropagation(); setRoutineDeleteConfirm({ bucket, chipId: chip.id, chipName: chip.name }); setRoutineFocusedChipId(null); }}
                                className={`absolute ${isTablet ? '-top-2 -right-2' : '-top-1.5 -right-1.5'} transition-opacity bg-red-500 text-white rounded-full ${isTablet ? 'w-5 h-5' : 'w-4 h-4'} flex items-center justify-center ${
                                  isTablet ? (isFocused ? 'opacity-100' : 'opacity-0 pointer-events-none') : 'opacity-0 group-hover:opacity-100'
                                }`}
                                title="Delete"
                              >
                                <X size={isTablet ? 12 : 10} />
                              </button>
                            </div>
                          );
                        })}
                        {chips.length === 0 && !routineAddingToBucket && (
                          <span className={`text-xs ${textSecondary} italic`}>No routines</span>
                        )}
                      </div>
                    </div>
                  );
                };

                const hasAnyChips = Object.values(routineDefinitions).some(arr => arr.length > 0);

                return (
                  <div className="grid grid-cols-3 gap-4">
                    {/* Left column: Mon/Tue/Wed/Everyday */}
                    <div className="space-y-3">
                      {leftBuckets.map(renderBucket)}
                    </div>

                    {/* Center: selected chips */}
                    <div className={`rounded-lg border-2 border-dashed ${darkMode ? 'border-gray-600' : 'border-gray-300'} p-4 flex flex-col items-center justify-start min-h-[300px]`}>
                      <div className={`text-xs font-semibold uppercase tracking-wide mb-3 ${textSecondary}`}>Today's Routine</div>
                      {dashboardSelectedChips.length > 0 ? (
                        <div className={`flex flex-wrap ${isTablet ? 'gap-2' : 'gap-1.5'} justify-center`}>
                          {dashboardSelectedChips.map(chip => {
                            const isFocused = routineFocusedChipId === chip.id;
                            return (
                            <div
                              key={chip.id}
                              className={`group relative rounded-full ${isTablet ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'} font-medium cursor-pointer ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'}`}
                              onClick={() => {
                                if (isTablet) {
                                  if (isFocused) {
                                    setRoutineTimePickerChipId(chip.id);
                                    setRoutineFocusedChipId(null);
                                  } else {
                                    setRoutineFocusedChipId(chip.id);
                                  }
                                } else {
                                  setRoutineTimePickerChipId(chip.id);
                                }
                              }}
                              title={isTablet ? 'Tap to show options' : 'Click to set time'}
                            >
                              <span className="flex items-center gap-1">
                                {chip.name}
                                {chip.startTime && (
                                  <>
                                    <Clock size={isTablet ? 12 : 10} className="ml-0.5" />
                                    <span className="opacity-90">{formatTime(chip.startTime)}</span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDashboardSelectedChips(prev => prev.map(c => c.id === chip.id ? { ...c, startTime: null } : c));
                                      }}
                                      className="hover:opacity-100 opacity-60 transition-opacity"
                                      title="Clear time"
                                    >
                                      <X size={isTablet ? 12 : 10} />
                                    </button>
                                  </>
                                )}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); setDashboardSelectedChips(prev => prev.filter(c => c.id !== chip.id)); setRoutineFocusedChipId(null); }}
                                className={`absolute ${isTablet ? '-top-2 -right-2' : '-top-1.5 -right-1.5'} transition-opacity rounded-full ${isTablet ? 'w-5 h-5' : 'w-4 h-4'} flex items-center justify-center ${darkMode ? 'bg-gray-500 text-white' : 'bg-gray-400 text-white'} ${
                                  isTablet ? (isFocused ? 'opacity-100' : 'opacity-0 pointer-events-none') : 'opacity-0 group-hover:opacity-100'
                                }`}
                                title="Remove from today"
                              >
                                <Undo2 size={isTablet ? 12 : 10} />
                              </button>
                            </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center">
                          <Sparkles size={32} className={`${textSecondary} mb-3 opacity-40`} />
                          <p className={`text-sm ${textSecondary}`}>
                            {hasAnyChips
                              ? 'Click chips from the day buckets to add them to today\'s routine'
                              : 'Add routine chips to the day buckets using the + button, then click them to select for today'
                            }
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Right column: Thu/Fri/Sat/Sun */}
                    <div className="space-y-3">
                      {rightBuckets.map(renderBucket)}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            <div className={`p-4 border-t ${borderClass} flex justify-end`}>
              <button
                onClick={handleRoutinesDone}
                className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
        {routineTimePickerChipId !== null && (
          <ClockTimePicker
            value={dashboardSelectedChips.find(c => c.id === routineTimePickerChipId)?.startTime || '09:00'}
            onChange={(time) => {
              setDashboardSelectedChips(prev => prev.map(c => c.id === routineTimePickerChipId ? { ...c, startTime: time } : c));
              setRoutineTimePickerChipId(null);
            }}
            onClose={() => setRoutineTimePickerChipId(null)}
          />
        )}
      </>)}

      {/* Routine Delete Confirmation */}
      {routineDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setRoutineDeleteConfirm(null)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <Trash2 size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Delete Routine</h3>
            </div>
            <p className={`${textSecondary} mb-6`}>
              Are you sure you want to delete <strong className={textPrimary}>"{routineDeleteConfirm.chipName}"</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRoutineDeleteConfirm(null)}
                className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg}`}
              >
                Cancel
              </button>
              <button
                onClick={() => { deleteRoutineChip(routineDeleteConfirm.bucket, routineDeleteConfirm.chipId); setRoutineDeleteConfirm(null); }}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Focus Mode Overlay */}
      {showFocusMode && (
        <div className="fixed inset-0 bg-gray-950 z-[70] flex flex-col items-center justify-center overflow-auto">
          {/* Exit button */}
          <button
            onClick={() => exitFocusMode(true)}
            className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors z-10"
          >
            <X size={28} />
          </button>

          {/* Settings view */}
          {focusShowSettings && !focusShowStats && (
            <div className="w-full max-w-md px-6 py-8 flex flex-col items-center gap-6">
              <BrainCircuit size={48} className="text-blue-400" />
              <h1 className="text-2xl font-bold text-white">Focus Mode</h1>

              {/* Interval controls */}
              <div className="w-full space-y-3">
                {[
                  { label: 'Work', value: focusWorkMinutes, set: setFocusWorkMinutes },
                  { label: 'Break', value: focusBreakMinutes, set: setFocusBreakMinutes },
                  { label: 'Long Break', value: focusLongBreakMinutes, set: setFocusLongBreakMinutes },
                ].map(({ label, value, set }) => (
                  <div key={label} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                    <span className="text-gray-300 text-sm">{label}</span>
                    <div className="flex items-center gap-3">
                      <button onClick={() => set(Math.max(1, value - 5))} className="w-8 h-8 rounded-full bg-gray-700 text-white hover:bg-gray-600 flex items-center justify-center text-lg font-bold">-</button>
                      <span className="text-white font-mono w-12 text-center">{value}m</span>
                      <button onClick={() => set(value + 5)} className="w-8 h-8 rounded-full bg-gray-700 text-white hover:bg-gray-600 flex items-center justify-center text-lg font-bold">+</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Task preview */}
              <div className="w-full space-y-2">
                <h3 className="text-sm text-gray-400 font-medium">Tasks in this block</h3>
                {focusBlockTasks.map(task => (
                  <div key={task.id} className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2">
                    <div className={`w-3 h-3 rounded-full ${task.color} flex-shrink-0`} />
                    <span className="text-gray-200 text-sm truncate flex-1">{task.title}</span>
                    <span className="text-gray-500 text-xs">{task.duration}m</span>
                  </div>
                ))}
              </div>

              <button
                onClick={startFocusTimer}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors text-lg"
              >
                Start Focus Session
              </button>
            </div>
          )}

          {/* Main focus view */}
          {!focusShowSettings && !focusShowStats && (
            <div className="w-full max-w-lg px-6 py-8 flex flex-col items-center gap-6">
              {/* Phase indicator */}
              <div className="flex items-center gap-3">
                <span className={`px-4 py-1.5 rounded-full text-sm font-medium ${
                  focusPhase === 'work' ? 'bg-blue-600 text-white' :
                  focusPhase === 'shortBreak' ? 'bg-green-600 text-white' :
                  'bg-purple-600 text-white'
                }`}>
                  {focusPhase === 'work' ? 'Work' : focusPhase === 'shortBreak' ? 'Short Break' : 'Long Break'}
                </span>
                <span className="text-gray-500 text-sm">Cycle {Math.floor(focusCycleCount / 1) + (focusPhase === 'work' ? 1 : 0)} of 4</span>
              </div>

              {/* Countdown */}
              <div className="text-8xl font-mono text-white font-bold tracking-wider">
                {String(Math.floor(focusTimerSeconds / 60)).padStart(2, '0')}:{String(focusTimerSeconds % 60).padStart(2, '0')}
              </div>

              {/* Pause/Resume */}
              <button
                onClick={() => setFocusTimerRunning(prev => !prev)}
                className="w-14 h-14 rounded-full bg-gray-800 hover:bg-gray-700 text-white flex items-center justify-center transition-colors"
              >
                {focusTimerRunning ? <Pause size={24} /> : <Play size={24} />}
              </button>

              {/* Pomodoro cycle dots */}
              <div className="flex gap-3">
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-full transition-all ${
                      i < (focusCycleCount % 4) ? 'bg-blue-500' :
                      i === (focusCycleCount % 4) && focusPhase === 'work' ? 'bg-blue-500 animate-pulse' :
                      'bg-gray-700'
                    }`}
                  />
                ))}
              </div>

              {/* Task cards */}
              <div className="w-full space-y-2 mt-4">
                {focusBlockTasks.map(task => {
                  const isDone = task.completed || focusCompletedTasks.has(task.id);
                  return (
                    <div key={task.id} className={`bg-gray-800 rounded-lg p-3 flex items-start gap-3 transition-opacity ${isDone ? 'opacity-40' : ''}`}>
                      <div className={`w-3 h-3 rounded-full ${task.color} flex-shrink-0 mt-1`} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${isDone ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{task.title}</div>
                        <div className="text-xs text-gray-500">{formatTime(task.startTime)} - {formatTime(minutesToTime(timeToMinutes(task.startTime) + task.duration))}</div>
                        {!isDone && ((task.notes && task.notes.trim()) || (task.subtasks && task.subtasks.length > 0)) && (
                          <div className="mt-2">
                            <NotesSubtasksPanel
                              task={task}
                              isInbox={false}
                              darkMode={true}
                              updateTaskNotes={focusUpdateTaskNotes}
                              addSubtask={focusAddSubtask}
                              toggleSubtask={focusToggleSubtask}
                              deleteSubtask={focusDeleteSubtask}
                              updateSubtaskTitle={focusUpdateSubtaskTitle}
                              compact={false}
                              noAutoFocus
                            />
                          </div>
                        )}
                      </div>
                      {!isDone && (
                        <button
                          onClick={() => focusCompleteTask(task.id)}
                          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg transition-colors flex-shrink-0"
                        >
                          Complete
                        </button>
                      )}
                      {isDone && (
                        <Check size={18} className="text-green-500 flex-shrink-0 mt-0.5" />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Session elapsed time */}
              {focusSessionStart && (
                <div className="text-gray-500 text-sm mt-4">
                  Session: {Math.floor((currentTime - focusSessionStart) / 60000)}m elapsed
                </div>
              )}
            </div>
          )}

          {/* Stats view */}
          {focusShowStats && (
            <div className="w-full max-w-sm px-6 py-8 flex flex-col items-center gap-6">
              <Trophy size={48} className="text-yellow-400" />
              <h1 className="text-2xl font-bold text-white">Session Complete!</h1>

              <div className="w-full space-y-3">
                <div className="flex justify-between bg-gray-800 rounded-lg px-4 py-3">
                  <span className="text-gray-400">Total time</span>
                  <span className="text-white font-medium">{focusSessionStart ? `${Math.floor((currentTime - focusSessionStart) / 60000)}m` : '0m'}</span>
                </div>
                <div className="flex justify-between bg-gray-800 rounded-lg px-4 py-3">
                  <span className="text-gray-400">Tasks completed</span>
                  <span className="text-white font-medium">{focusCompletedTasks.size}</span>
                </div>
                <div className="flex justify-between bg-gray-800 rounded-lg px-4 py-3">
                  <span className="text-gray-400">Pomodoro cycles</span>
                  <span className="text-white font-medium">{focusCycleCount}</span>
                </div>
              </div>

              <button
                onClick={dismissFocusStats}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors text-lg"
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}

      {/* Spotlight Search */}
      {showSpotlight && (
        <div className="fixed inset-0 bg-black/50 z-50 flex justify-center" style={{ paddingTop: isMobile ? '2rem' : '15vh' }} onClick={() => setShowSpotlight(false)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl border ${borderClass} max-w-xl w-full mx-4 h-fit`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search input */}
            <div className={`flex items-center gap-2 px-4 py-3 border-b ${borderClass}`}>
              <Search size={18} className={textSecondary} />
              <input
                ref={spotlightInputRef}
                type="text"
                value={spotlightQuery}
                onChange={(e) => { setSpotlightQuery(e.target.value); setSpotlightSelectedIndex(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSpotlightSelectedIndex(prev => Math.min(prev + 1, Math.min(spotlightResults.length - 1, 19)));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSpotlightSelectedIndex(prev => Math.max(prev - 1, 0));
                  } else if (e.key === 'Enter' && spotlightResults.length > 0) {
                    e.preventDefault();
                    handleSpotlightSelect(spotlightResults[spotlightSelectedIndex]);
                  }
                }}
                placeholder="Search tasks..."
                className={`flex-1 bg-transparent outline-none ${textPrimary} text-sm placeholder:${textSecondary}`}
                autoFocus
              />
              {spotlightQuery && (
                <button onClick={() => { setSpotlightQuery(''); setSpotlightSelectedIndex(0); spotlightInputRef.current?.focus(); }} className={`${textSecondary} hover:${textPrimary}`}>
                  <X size={16} />
                </button>
              )}
              {!isMobile && <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'}`}>Esc</kbd>}
            </div>

            {/* Results */}
            <div className="max-h-[50vh] overflow-y-auto">
              {!spotlightQuery.trim() ? (
                <div className={`px-4 py-8 text-center text-sm ${textSecondary}`}>Type to search across all tasks...</div>
              ) : spotlightResults.length === 0 ? (
                <div className={`px-4 py-8 text-center text-sm ${textSecondary}`}>No results found</div>
              ) : (
                spotlightResults.slice(0, 20).map((result, idx) => {
                  const sourceBadgeColors = darkMode ? {
                    scheduled: 'bg-blue-900/40 text-blue-300',
                    inbox: 'bg-green-900/40 text-green-300',
                    recurring: 'bg-purple-900/40 text-purple-300',
                    deleted: 'bg-red-900/40 text-red-300',
                  } : {
                    scheduled: 'bg-blue-100 text-blue-700',
                    inbox: 'bg-green-100 text-green-700',
                    recurring: 'bg-purple-100 text-purple-700',
                    deleted: 'bg-red-100 text-red-700',
                  };
                  const isSelected = idx === spotlightSelectedIndex;
                  return (
                    <div
                      key={`${result.source}-${result.task.id}-${idx}`}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${isSelected ? (darkMode ? 'bg-gray-700' : 'bg-blue-50') : (darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-50')}`}
                      onClick={() => handleSpotlightSelect(result)}
                      onMouseEnter={() => setSpotlightSelectedIndex(idx)}
                      ref={el => {
                        if (isSelected && el) el.scrollIntoView({ block: 'nearest' });
                      }}
                    >
                      {/* Color dot */}
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${result.task.color || 'bg-blue-500'}`} />
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium truncate ${textPrimary}`}>
                          {result.match.field === 'title'
                            ? highlightMatch(result.task.title, spotlightQuery)
                            : renderTitle(result.task.title)}
                        </div>
                        {result.match.field !== 'title' && (
                          <div className={`text-xs ${textSecondary} truncate mt-0.5`}>
                            <span className="opacity-60">{result.match.field === 'notes' ? 'Notes: ' : result.match.field === 'subtask' ? 'Subtask: ' : result.match.field === 'tag' ? 'Tag: ' : ''}</span>
                            {highlightMatch(result.match.text, spotlightQuery)}
                          </div>
                        )}
                      </div>
                      {/* Date */}
                      {result.date && (
                        <span className={`text-xs ${textSecondary} flex-shrink-0`}>{result.date}</span>
                      )}
                      {/* Source badge */}
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${sourceBadgeColors[result.source]}`}>
                        {result.sourceLabel}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            {spotlightResults.length > 0 && (
              <div className={`flex items-center justify-between px-4 py-2 border-t ${borderClass} text-xs ${textSecondary}`}>
                {!isMobile ? (
                  <div className="flex items-center gap-3">
                    <span><kbd className={`px-1 py-0.5 rounded font-mono ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>↑↓</kbd> navigate</span>
                    <span><kbd className={`px-1 py-0.5 rounded font-mono ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>↵</kbd> open</span>
                  </div>
                ) : <div />}
                <span>{spotlightResults.length} result{spotlightResults.length !== 1 ? 's' : ''}{spotlightResults.length > 20 ? ` (showing 20)` : ''}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (() => {
        const currentProvider = cloudSyncConfig?.provider || 'nextcloud';
        const provider = cloudSyncProviders[currentProvider];
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
            <div
              className={`${cardBg} rounded-lg shadow-xl ${borderClass} border max-w-md lg:max-w-3xl w-full mx-4 max-h-[85vh] overflow-y-auto`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                    <Settings size={20} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className={`text-lg font-semibold ${textPrimary}`}>Settings</h3>
                </div>

                <div className="lg:grid lg:grid-cols-2 lg:gap-6 space-y-6 lg:space-y-0">
                  {/* Left column */}
                  <div className="space-y-6">
                    {/* Clock Format Section */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Clock size={16} className={textSecondary} />
                        Clock Format
                      </h4>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setUse24HourClock(true)}
                          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                            use24HourClock
                              ? 'bg-blue-600 text-white'
                              : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'} ${hoverBg}`
                          }`}
                        >
                          24-hour
                        </button>
                        <button
                          onClick={() => setUse24HourClock(false)}
                          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                            !use24HourClock
                              ? 'bg-blue-600 text-white'
                              : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'} ${hoverBg}`
                          }`}
                        >
                          12-hour
                        </button>
                      </div>
                    </div>

                    <hr className={borderClass} />

                    {/* Sound Section */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Bell size={16} className={textSecondary} />
                        Sound
                      </h4>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={soundEnabled}
                            onChange={(e) => setSoundEnabled(e.target.checked)}
                            className="sr-only"
                          />
                          <div className={`w-10 h-6 rounded-full transition-colors ${soundEnabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}>
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${soundEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                          </div>
                        </div>
                        <span className={`text-sm ${textPrimary}`}>Enable UI sounds</span>
                      </label>
                    </div>

                    {/* Cloud Sync Section - narrow screens only */}
                    <hr className={`${borderClass} lg:hidden`} />
                    <div className="space-y-3 lg:hidden">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Cloud size={16} className={textSecondary} />
                        Cloud Sync
                      </h4>
                      <p className={`${textSecondary} text-xs`}>
                        Sync all your data (tasks, inbox, routines, settings) as a JSON file to your cloud storage.
                      </p>
                      <CloudSyncSettingsForm
                        darkMode={darkMode}
                        textPrimary={textPrimary}
                        textSecondary={textSecondary}
                        borderClass={borderClass}
                        hoverBg={hoverBg}
                        cloudSyncConfig={cloudSyncConfig}
                        setCloudSyncConfig={setCloudSyncConfig}
                        cloudSyncTest={cloudSyncTest}
                        provider={provider}
                        currentProvider={currentProvider}
                        onClose={() => setShowSettings(false)}
                        cloudSyncLastSynced={cloudSyncLastSynced}
                      />
                    </div>

                    <hr className={borderClass} />

                    {/* Calendar Sync Section */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <RefreshCw size={16} className={textSecondary} />
                        Calendar Sync
                      </h4>
                      <div>
                        <label className={`block text-sm ${textSecondary} mb-1`}>
                          Calendar URL (iCal/CalDAV)
                        </label>
                        <input
                          type="url"
                          placeholder="https://nextcloud.example.com/remote.php/dav/calendars/user/calendar-name/?export"
                          value={syncUrl}
                          onChange={(e) => setSyncUrl(e.target.value)}
                          className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} text-sm`}
                        />
                        <p className={`text-xs ${textSecondary} mt-1`}>
                          For Nextcloud: Go to Calendar → Settings → Copy the public link
                        </p>
                      </div>
                      <div>
                        <label className={`block text-sm ${textSecondary} mb-1`}>
                          Task Calendar URL (iCal/CalDAV)
                        </label>
                        <input
                          type="url"
                          placeholder="https://nextcloud.example.com/remote.php/dav/calendars/user/tasks/?export"
                          value={taskCalendarUrl}
                          onChange={(e) => setTaskCalendarUrl(e.target.value)}
                          className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} text-sm`}
                        />
                        <p className={`text-xs ${textSecondary} mt-1`}>
                          Tasks appear with striped pattern; completion state persists across syncs
                        </p>
                      </div>
                      <button
                        onClick={() => syncAll()}
                        disabled={isSyncing || (!syncUrl && !taskCalendarUrl)}
                        className={`px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm ${(!syncUrl && !taskCalendarUrl) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                        {isSyncing ? 'Syncing...' : 'Sync Now'}
                      </button>
                      {calSyncLastSynced && (
                        <p className={`text-xs ${textSecondary}`}>
                          Last synced: {new Date(calSyncLastSynced).toLocaleString()}
                        </p>
                      )}
                    </div>

                    <hr className={borderClass} />

                    {/* iCal Import Section */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Upload size={16} className={textSecondary} />
                        iCal Import
                      </h4>
                      <label className={`cursor-pointer inline-flex items-center gap-2 px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg} text-sm ${textPrimary}`}>
                        <Upload size={14} className={textSecondary} />
                        Choose .ics file
                        <input type="file" accept=".ics" onChange={(e) => { handleFileUpload(e); setShowSettings(false); }} className="hidden" />
                      </label>
                      <p className={`text-xs ${textSecondary}`}>
                        Import events from an iCal (.ics) file
                      </p>
                    </div>
                  </div>

                  {/* Right column - wide screens only */}
                  <div className={`hidden lg:block space-y-6 lg:border-l lg:pl-6 ${borderClass}`}>
                    {/* Cloud Sync Section */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Cloud size={16} className={textSecondary} />
                        Cloud Sync
                      </h4>
                      <p className={`${textSecondary} text-xs`}>
                        Sync all your data (tasks, inbox, routines, settings) as a JSON file to your cloud storage.
                      </p>
                      <CloudSyncSettingsForm
                        darkMode={darkMode}
                        textPrimary={textPrimary}
                        textSecondary={textSecondary}
                        borderClass={borderClass}
                        hoverBg={hoverBg}
                        cloudSyncConfig={cloudSyncConfig}
                        setCloudSyncConfig={setCloudSyncConfig}
                        cloudSyncTest={cloudSyncTest}
                        provider={provider}
                        currentProvider={currentProvider}
                        onClose={() => setShowSettings(false)}
                        cloudSyncLastSynced={cloudSyncLastSynced}
                      />
                    </div>
                  </div>
                </div>

                <div className={`text-center text-[10px] ${textSecondary} opacity-50 mt-4`}>
                  Build: {typeof __BUILD_TIMESTAMP__ !== 'undefined' ? new Date(__BUILD_TIMESTAMP__).toLocaleString() : 'dev'}
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  className={`w-full mt-2 px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Reminders Modal */}
      {showRemindersSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowRemindersSettings(false)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Bell size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Reminders</h3>
            </div>

            {/* Master toggle */}
            <label className="flex items-center gap-3 cursor-pointer mb-4">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={reminderSettings.enabled}
                  onChange={(e) => setReminderSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                  className="sr-only"
                />
                <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.enabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                </div>
              </div>
              <span className={`text-sm ${textPrimary}`}>Enable reminders</span>
            </label>

            {reminderSettings.enabled && (
              <div className="space-y-4">
                {/* In-app toasts toggle */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={reminderSettings.inAppToasts !== false}
                      onChange={(e) => setReminderSettings(prev => ({ ...prev, inAppToasts: e.target.checked }))}
                      className="sr-only"
                    />
                    <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.inAppToasts !== false ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}>
                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.inAppToasts !== false ? 'translate-x-5' : 'translate-x-1'}`} />
                    </div>
                  </div>
                  <span className={`text-sm ${textPrimary}`}>In-app toasts</span>
                </label>

                {/* Browser notifications toggle */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={reminderSettings.browserNotifications}
                      onChange={(e) => {
                        const val = e.target.checked;
                        if (val && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                          Notification.requestPermission();
                        }
                        setReminderSettings(prev => ({ ...prev, browserNotifications: val }));
                      }}
                      className="sr-only"
                    />
                    <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.browserNotifications ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}>
                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.browserNotifications ? 'translate-x-5' : 'translate-x-1'}`} />
                    </div>
                  </div>
                  <div>
                    <span className={`text-sm ${textPrimary}`}>Browser notifications</span>
                    <p className={`text-xs ${textSecondary}`}>
                      {typeof Notification !== 'undefined'
                        ? Notification.permission === 'granted' ? 'Permission granted'
                        : Notification.permission === 'denied' ? 'Permission denied — enable in browser settings'
                        : 'Will request permission when enabled'
                        : 'Not supported in this browser'}
                    </p>
                  </div>
                </label>

                {/* Presets */}
                <div>
                  <p className={`text-xs font-medium ${textSecondary} mb-2`}>Presets</p>
                  <div className="flex gap-2">
                    {[['standard', 'Standard'], ['aggressive', 'Aggressive'], ['minimal', 'Minimal']].map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => applyReminderPreset(key)}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                          reminderSettings.preset === key
                            ? 'bg-blue-600 text-white'
                            : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'} ${hoverBg}`
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    {reminderSettings.preset === 'custom' && (
                      <span className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white">Custom</span>
                    )}
                  </div>
                </div>

                {/* Per-category grids */}
                {[
                  ['calendarEvents', 'Calendar Events'],
                  ['calendarTasks', 'Calendar Tasks'],
                  ['scheduledTasks', 'Scheduled Tasks'],
                  ['recurringTasks', 'Recurring Tasks'],
                ].map(([catKey, catLabel]) => (
                  <div key={catKey}>
                    <p className={`text-xs font-medium ${textSecondary} mb-1.5`}>{catLabel}</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {[
                        ['before15', '-15m'],
                        ['before10', '-10m'],
                        ['before5', '-5m'],
                        ['atStart', 'Start'],
                        ['atEnd', 'End'],
                      ].map(([field, label]) => (
                        <button
                          key={field}
                          onClick={() => updateCategoryReminder(catKey, field, !reminderSettings.categories[catKey]?.[field])}
                          className={`px-2.5 py-1 text-xs rounded transition-colors ${
                            reminderSettings.categories[catKey]?.[field]
                              ? 'bg-blue-600 text-white'
                              : `${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'} ${hoverBg}`
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* All-day tasks */}
                <div>
                  <p className={`text-xs font-medium ${textSecondary} mb-1.5`}>All-Day Tasks</p>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reminderSettings.categories.allDayTasks?.morningReminder ?? true}
                        onChange={(e) => updateCategoryReminder('allDayTasks', 'morningReminder', e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <span className={`text-xs ${textPrimary}`}>Morning reminder at</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowMorningTimePicker(true)}
                      className={`text-xs px-2 py-1 rounded border ${darkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'}`}
                    >
                      {formatTime(reminderSettings.morningReminderTime)}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Weekly Review */}
            <div className={`border-t ${borderClass} mt-4 pt-4`}>
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={16} className="text-purple-500" />
                <span className={`text-sm font-semibold ${textPrimary}`}>Weekly Review</span>
              </div>
              <label className="flex items-center gap-3 cursor-pointer mb-3">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={reminderSettings.weeklyReview?.enabled ?? true}
                    onChange={(e) => setReminderSettings(prev => ({ ...prev, weeklyReview: { ...prev.weeklyReview, enabled: e.target.checked } }))}
                    className="sr-only"
                  />
                  <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.weeklyReview?.enabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.weeklyReview?.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                </div>
                <span className={`text-sm ${textPrimary}`}>Notify me for weekly review</span>
              </label>
              {reminderSettings.weeklyReview?.enabled && (
                <div className="space-y-3 ml-1">
                  <div>
                    <p className={`text-xs ${textSecondary} mb-1.5`}>Day</p>
                    <div className="flex gap-1">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => (
                        <button
                          key={label}
                          onClick={() => setReminderSettings(prev => ({ ...prev, weeklyReview: { ...prev.weeklyReview, day: i } }))}
                          className={`px-2 py-1 text-xs rounded-full transition-colors ${
                            reminderSettings.weeklyReview.day === i
                              ? 'bg-blue-600 text-white'
                              : darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className={`text-xs ${textSecondary} mb-1.5`}>Time</p>
                    <button
                      type="button"
                      onClick={() => setShowWeeklyReviewTimePicker(true)}
                      className={`text-xs px-2 py-1 rounded border ${darkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'}`}
                    >
                      {formatTime(reminderSettings.weeklyReview.time)}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowRemindersSettings(false)}
              className={`w-full mt-6 px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-lg transition-colors text-sm`}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showMorningTimePicker && (
        <ClockTimePicker
          value={reminderSettings.morningReminderTime}
          onChange={(time) => setReminderSettings(prev => ({ ...prev, morningReminderTime: time }))}
          onClose={() => setShowMorningTimePicker(false)}
        />
      )}

      {showWeeklyReviewTimePicker && (
        <ClockTimePicker
          value={reminderSettings.weeklyReview?.time || '19:00'}
          onChange={(time) => setReminderSettings(prev => ({ ...prev, weeklyReview: { ...prev.weeklyReview, time } }))}
          onClose={() => setShowWeeklyReviewTimePicker(false)}
        />
      )}

      {/* Incomplete Tasks Modal */}
      {showIncompleteTasks && (() => {
        const isDaily = showIncompleteTasks === 'today';
        const items = isDaily ? todayIncompleteTasks : allTimeIncompleteTasks;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowIncompleteTasks(null)} onKeyDown={(e) => { if (e.key === 'Escape') setShowIncompleteTasks(null); }} tabIndex={-1} ref={el => el && el.focus()}>
            <div
              className={`${cardBg} rounded-lg shadow-xl ${borderClass} border max-w-md w-full mx-4 flex flex-col`}
              style={{ maxHeight: '70vh' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
                <div>
                  <h2 className={`text-lg font-bold ${textPrimary}`}>Incomplete Tasks</h2>
                  <p className={`text-xs ${textSecondary}`}>{isDaily ? 'Today' : 'All Time'} — {items.length} task{items.length !== 1 ? 's' : ''}</p>
                </div>
                <button onClick={() => setShowIncompleteTasks(null)} className={`${textSecondary} hover:${textPrimary}`}>
                  <X size={20} />
                </button>
              </div>
              <div className="overflow-y-auto p-4">
                {items.length === 0 ? (
                  <p className={`text-center ${textSecondary} py-6`}>All tasks completed!</p>
                ) : (
                  <div className="space-y-2">
                    {items.map(task => (
                      <button
                        key={task.id}
                        className={`w-full flex items-center gap-3 p-2 rounded text-left cursor-pointer ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'} transition-colors`}
                        onClick={() => {
                          if (isMobile) {
                            if (task.date) {
                              setSelectedDate(new Date(task.date + 'T12:00:00'));
                            }
                            setShowIncompleteTasks(null);
                            setShowMobileDailySummary(false);
                            setMobileActiveTab('timeline');
                            setTimeout(() => {
                              const el = document.querySelector(`[data-task-id="${task.id}"]`);
                              if (el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                el.classList.add('ring-2', 'ring-blue-400');
                                setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 2000);
                              }
                            }, 200);
                          } else {
                            if (task.date) {
                              setSelectedDate(new Date(task.date + 'T12:00:00'));
                            }
                            if (task.startTime && calendarRef.current) {
                              setTimeout(() => {
                                const minutes = timeToMinutes(task.startTime);
                                const hourHeight = timeGridRef.current?.children?.[1]?.offsetHeight || 161;
                                const scrollPosition = Math.max(0, (minutes / 60 - 1) * hourHeight);
                                calendarRef.current.scrollTo({ top: scrollPosition, behavior: 'smooth' });
                              }, 150);
                            }
                            setShowIncompleteTasks(null);
                          }
                        }}
                      >
                        <span className={`w-3 h-3 rounded-full flex-shrink-0 ${task.color || 'bg-blue-500'}`} />
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm ${textPrimary} truncate`}>{task.title}</div>
                          <div className={`text-xs ${textSecondary}`}>
                            {isDaily
                              ? (task.startTime ? formatTime(task.startTime) : 'All day')
                              : [task.date && new Date(task.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), task.startTime && formatTime(task.startTime)].filter(Boolean).join(' · ') || 'No date'}
                          </div>
                        </div>
                        <ChevronRight size={14} className={`${textSecondary} flex-shrink-0 opacity-40`} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className={`p-4 border-t ${borderClass}`}>
                <button
                  onClick={() => setShowIncompleteTasks(null)}
                  className={`w-full px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-lg transition-colors text-sm`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Keyboard Shortcut Cheat Sheet */}
      {showShortcutHelp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowShortcutHelp(false)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-bold ${textPrimary}`}>Keyboard Shortcuts</h2>
              <button onClick={() => setShowShortcutHelp(false)} className={`${textSecondary} hover:${textPrimary}`}>
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
              <div>
                <h3 className={`text-xs font-semibold uppercase ${textSecondary} mb-2`}>Navigation</h3>
                {[
                  ['T', 'Go to today'],
                  ['\u2190 / \u2192', 'Previous / next day'],
                  ['M', 'Toggle month view'],
                ].map(([key, desc]) => (
                  <div key={key} className={`flex items-center justify-between py-1 ${textSecondary}`}>
                    <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}>{key}</kbd>
                    <span className="text-sm ml-2 text-right flex-1">{desc}</span>
                  </div>
                ))}
                <h3 className={`text-xs font-semibold uppercase ${textSecondary} mt-3 mb-2`}>Create</h3>
                {[
                  ['N', 'New scheduled task'],
                  ['I', 'New inbox task'],
                  ['R', 'Routines dashboard'],
                ].map(([key, desc]) => (
                  <div key={key} className={`flex items-center justify-between py-1 ${textSecondary}`}>
                    <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}>{key}</kbd>
                    <span className="text-sm ml-2 text-right flex-1">{desc}</span>
                  </div>
                ))}
                <h3 className={`text-xs font-semibold uppercase ${textSecondary} mt-3 mb-2`}>Edit</h3>
                {(() => {
                  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
                  return [
                    [isMac ? '\u2318Z' : 'Ctrl+Z', 'Undo'],
                    [isMac ? '\u2318\u21E7Z' : 'Ctrl+Y', 'Redo'],
                  ];
                })().map(([key, desc]) => (
                  <div key={key} className={`flex items-center justify-between py-1 ${textSecondary}`}>
                    <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}>{key}</kbd>
                    <span className="text-sm ml-2 text-right flex-1">{desc}</span>
                  </div>
                ))}
                <h3 className={`text-xs font-semibold uppercase ${textSecondary} mt-3 mb-2`}>App</h3>
                {(() => {
                  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
                  return [
                    [isMac ? '⌘K' : 'Ctrl+K', 'Search tasks'],
                    ['F', 'Focus mode'],
                    ['D', 'Toggle dark mode'],
                    ['B', 'Backup menu'],
                    [',', 'Collapse sidebar'],
                    ['.', 'Expand sidebar'],
                    ['?', 'This help'],
                  ];
                })().map(([key, desc]) => (
                  <div key={key} className={`flex items-center justify-between py-1 ${textSecondary}`}>
                    <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}>{key}</kbd>
                    <span className="text-sm ml-2 text-right flex-1">{desc}</span>
                  </div>
                ))}
              </div>
              <div>
                <h3 className={`text-xs font-semibold uppercase ${textSecondary} mb-2`}>Task Entry Shortcuts</h3>
                <p className={`text-xs ${textSecondary} mb-2`}>Type in the task title field:</p>
                {[
                  ['#', 'Add tag'],
                  ['@', 'Set date'],
                  ['~', 'Set time'],
                  ['%', 'Duration (mins)'],
                  ['!', 'Priority (! !! !!!)'],
                  ['^', 'Toggle all-day'],
                  ['$', 'Deadline (inbox)'],
                ].map(([key, desc]) => (
                  <div key={key} className={`flex items-center justify-between py-1 ${textSecondary}`}>
                    <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}>{key}</kbd>
                    <span className="text-sm ml-2 text-right flex-1">{desc}</span>
                  </div>
                ))}
                <h3 className={`text-xs font-semibold uppercase ${textSecondary} mt-3 mb-2`}>Task Entry Suggestions</h3>
                <p className={`text-xs ${textSecondary} mb-2`}>Interacting with suggestions:</p>
                {[
                  ['Tab / Space', 'Accept'],
                  ['\u2191 / \u2193', 'Navigate suggestions'],
                  ['Enter', 'Submit task'],
                  ['Esc', 'Close / cancel'],
                ].map(([key, desc]) => (
                  <div key={key} className={`flex items-center justify-between py-1 ${textSecondary}`}>
                    <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}>{key}</kbd>
                    <span className="text-sm ml-2 text-right flex-1">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={`mt-4 pt-3 border-t ${borderClass} text-center`}>
              <span className={`text-xs ${textSecondary}`}>Press <kbd className={`px-1 py-0.5 rounded text-xs font-mono ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}>?</kbd> or <kbd className={`px-1 py-0.5 rounded text-xs font-mono ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}>Esc</kbd> to close</span>
            </div>
          </div>
        </div>
      )}

      {/* Weekly Review Modal */}
      {showWeeklyReview && (() => {
        // Compute rolling 7-day boundaries
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Past 7 days: 6 days ago through today
        const pastStart = new Date(today);
        pastStart.setDate(pastStart.getDate() - 6);

        // Next 7 days: tomorrow through 7 days from now
        const nextStart = new Date(today);
        nextStart.setDate(nextStart.getDate() + 1);
        const nextEnd = new Date(today);
        nextEnd.setDate(nextEnd.getDate() + 7);

        const pastWeekDates = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(pastStart);
          d.setDate(d.getDate() + i);
          pastWeekDates.push(dateToString(d));
        }
        const nextWeekDates = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(nextStart);
          d.setDate(d.getDate() + i);
          nextWeekDates.push(dateToString(d));
        }

        const pastStartStr = pastWeekDates[0];
        const pastEndStr = pastWeekDates[6];
        const nextStartStr = nextWeekDates[0];
        const nextEndStr = nextWeekDates[6];

        // Helper to identify today's tasks that haven't started yet
        const todayStr = dateToString(today);
        const actualNow = new Date();
        const actualNowMin = actualNow.getHours() * 60 + actualNow.getMinutes();
        const isFutureToday = (date, startTime) => {
          if (date !== todayStr) return false;
          if (!startTime) return false;
          const [h, m] = startTime.split(':').map(Number);
          return h * 60 + m > actualNowMin;
        };

        // Past week stats - regular tasks (exclude future today tasks)
        const pastRegular = tasks.filter(t => !t.imported && pastWeekDates.includes(t.date) && !isFutureToday(t.date, t.startTime));
        const pastRegularCompleted = pastRegular.filter(t => t.completed);

        // Past week stats - recurring tasks
        let pastRecurringScheduled = 0;
        let pastRecurringCompleted = 0;
        const pastRecurringIncomplete = [];
        recurringTasks.forEach(t => {
          const occurrences = getOccurrencesInRange(t, pastStartStr, pastEndStr)
            .filter(ds => !isFutureToday(ds, t.exceptions?.[ds]?.startTime || t.startTime));
          pastRecurringScheduled += occurrences.length;
          occurrences.forEach(ds => {
            const completed = (t.completedDates || []).includes(ds);
            if (completed) {
              pastRecurringCompleted++;
            } else {
              pastRecurringIncomplete.push({
                id: `recurring-${t.id}-${ds}`,
                title: t.title,
                date: ds,
                startTime: t.exceptions?.[ds]?.startTime || t.startTime,
                color: t.color,
                duration: t.duration || 0,
                isRecurring: true,
              });
            }
          });
        });

        const pastScheduled = pastRegular.length + pastRecurringScheduled;
        const pastCompleted = pastRegularCompleted.length + pastRecurringCompleted;
        const pastCompletionRate = pastScheduled > 0 ? Math.round((pastCompleted / pastScheduled) * 100) : 0;

        // Time stats
        const pastTimeSpent = pastRegularCompleted.reduce((sum, t) => sum + (t.duration || 0), 0)
          + recurringTasks.reduce((sum, t) => {
            const occs = getOccurrencesInRange(t, pastStartStr, pastEndStr)
              .filter(ds => !isFutureToday(ds, t.exceptions?.[ds]?.startTime || t.startTime));
            return sum + occs.filter(ds => (t.completedDates || []).includes(ds)).length * (t.duration || 0);
          }, 0);
        const pastTimePlanned = pastRegular.reduce((sum, t) => sum + (t.duration || 0), 0)
          + recurringTasks.reduce((sum, t) => {
            return sum + getOccurrencesInRange(t, pastStartStr, pastEndStr)
              .filter(ds => !isFutureToday(ds, t.exceptions?.[ds]?.startTime || t.startTime)).length * (t.duration || 0);
          }, 0);
        const pastFocusMinutes = pastRegularCompleted.filter(t => t.tags && t.tags.includes('focus')).reduce((sum, t) => sum + (t.duration || 0), 0);

        // Best day
        const dayCompletions = {};
        pastRegularCompleted.forEach(t => {
          dayCompletions[t.date] = (dayCompletions[t.date] || 0) + 1;
        });
        recurringTasks.forEach(t => {
          const occs = getOccurrencesInRange(t, pastStartStr, pastEndStr)
            .filter(ds => !isFutureToday(ds, t.exceptions?.[ds]?.startTime || t.startTime));
          occs.forEach(ds => {
            if ((t.completedDates || []).includes(ds)) {
              dayCompletions[ds] = (dayCompletions[ds] || 0) + 1;
            }
          });
        });
        let bestDay = null;
        let bestDayCount = 0;
        Object.entries(dayCompletions).forEach(([ds, count]) => {
          if (count > bestDayCount) {
            bestDay = ds;
            bestDayCount = count;
          }
        });
        const bestDayName = bestDay ? new Date(bestDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }) : null;

        // Incomplete list (future-today tasks already excluded from pastRegular/pastRecurringIncomplete)
        const pastIncomplete = [
          ...pastRegular.filter(t => !t.completed).map(t => ({ ...t, isRecurring: false })),
          ...pastRecurringIncomplete,
        ].sort((a, b) => a.date.localeCompare(b.date));

        // Next week stats - regular tasks
        const nextRegular = tasks.filter(t => !t.imported && nextWeekDates.includes(t.date));
        const nextImported = tasks.filter(t => t.imported && nextWeekDates.includes(t.date));

        let nextRecurringCount = 0;
        let nextRecurringMinutes = 0;
        recurringTasks.forEach(t => {
          const occs = getOccurrencesInRange(t, nextStartStr, nextEndStr);
          nextRecurringCount += occs.length;
          nextRecurringMinutes += occs.length * (t.duration || 0);
        });

        const nextScheduled = nextRegular.length + nextRecurringCount;
        const nextPlannedMinutes = nextRegular.reduce((sum, t) => sum + (t.duration || 0), 0) + nextRecurringMinutes;

        // Day load map
        const dayLoad = {};
        nextWeekDates.forEach(ds => { dayLoad[ds] = { count: 0, totalMinutes: 0 }; });
        nextRegular.forEach(t => {
          if (dayLoad[t.date]) {
            dayLoad[t.date].count++;
            dayLoad[t.date].totalMinutes += (t.duration || 0);
          }
        });
        nextImported.forEach(t => {
          if (dayLoad[t.date]) {
            dayLoad[t.date].count++;
            dayLoad[t.date].totalMinutes += (t.duration || 0);
          }
        });
        recurringTasks.forEach(t => {
          const occs = getOccurrencesInRange(t, nextStartStr, nextEndStr);
          occs.forEach(ds => {
            if (dayLoad[ds]) {
              dayLoad[ds].count++;
              dayLoad[ds].totalMinutes += (t.duration || 0);
            }
          });
        });

        // Busiest day
        let busiestDay = null;
        let busiestMinutes = 0;
        Object.entries(dayLoad).forEach(([ds, load]) => {
          if (load.totalMinutes > busiestMinutes) {
            busiestDay = ds;
            busiestMinutes = load.totalMinutes;
          }
        });
        const busiestDayName = busiestDay ? new Date(busiestDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }) : null;

        // Open days (< 60 min of commitments)
        const openDays = nextWeekDates.filter(ds => dayLoad[ds].totalMinutes < 60);
        const openDayNames = openDays.map(ds => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }));

        // Format date range
        const formatRange = (start, end) => {
          const s = new Date(start + 'T12:00:00');
          const e = new Date(end + 'T12:00:00');
          const sMonth = s.toLocaleDateString('en-US', { month: 'short' });
          const eMonth = e.toLocaleDateString('en-US', { month: 'short' });
          if (sMonth === eMonth) {
            return `${sMonth} ${s.getDate()} \u2014 ${e.getDate()}, ${s.getFullYear()}`;
          }
          return `${sMonth} ${s.getDate()} \u2014 ${eMonth} ${e.getDate()}, ${e.getFullYear()}`;
        };

        const formatMinutes = (min) => {
          const h = Math.floor(min / 60);
          const m = min % 60;
          if (h === 0) return `${m}m`;
          if (m === 0) return `${h}h`;
          return `${h}h ${m}m`;
        };

        const StatCard = ({ value, label, icon }) => (
          <div className={`${darkMode ? 'bg-gray-700/50' : 'bg-gray-50'} rounded-lg p-3`}>
            <div className={`text-xl font-bold ${textPrimary} flex items-center gap-1.5`}>
              {icon}
              {value}
            </div>
            <div className={`text-xs ${textSecondary} mt-0.5`}>{label}</div>
          </div>
        );

        return (isMobile || isTablet) ? (
          <div className="fixed inset-0 z-50 flex flex-col justify-end" style={isTablet ? { width: '320px' } : undefined} onClick={() => { setShowWeeklyReview(false); setMobileReviewPage(0); }}>
            <div className="bg-black/30 absolute inset-0" />
            <div
              className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[85vh] flex flex-col`}
              style={{ paddingBottom: isTablet ? '1rem' : 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-gray-300'}`} />
              </div>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <BarChart3 size={18} className={textSecondary} />
                  <span className={`font-semibold ${textPrimary}`}>Weekly Review</span>
                </div>
                <button
                  onClick={() => { setShowWeeklyReview(false); setMobileReviewPage(0); }}
                  className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-100 hover:bg-gray-200'} transition-colors`}
                  aria-label="Close weekly review"
                >
                  <X size={16} className={textSecondary} />
                </button>
              </div>

              {/* Swipeable cards */}
              <div
                ref={reviewScrollRef}
                className="flex-1 flex overflow-x-auto overflow-y-hidden review-carousel"
                style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                onScroll={(e) => {
                  const page = Math.round(e.target.scrollLeft / e.target.clientWidth);
                  if (page !== mobileReviewPage) setMobileReviewPage(page);
                }}
              >
                {/* Card 1: Past 7 Days */}
                <div className="flex-shrink-0 w-full h-full overflow-y-auto px-4 pb-4" style={{ scrollSnapAlign: 'start' }}>
                  <h3 className={`text-xs font-semibold uppercase ${textSecondary} tracking-wider mb-1`}>Past 7 Days</h3>
                  <p className={`text-xs ${textSecondary} mb-4`}>{formatRange(pastStartStr, pastEndStr)}</p>

                  {pastScheduled === 0 ? (
                    <p className={`text-sm ${textSecondary} italic`}>No tasks were scheduled in the past 7 days</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <StatCard value={`${pastCompleted}/${pastScheduled}`} label="Tasks done" icon={<CheckSquare size={16} className="text-green-400" />} />
                        <StatCard value={`${pastCompletionRate}%`} label="Completion" icon={<Target size={16} className="text-blue-400" />} />
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <StatCard value={formatMinutes(pastTimeSpent)} label="Time spent" icon={<Clock size={16} className="text-orange-400" />} />
                        <StatCard value={formatMinutes(pastFocusMinutes)} label="Focus time" icon={<BrainCircuit size={16} className="text-purple-400" />} />
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <StatCard value={`${pastRecurringCompleted}/${pastRecurringScheduled}`} label="Recurring" icon={<RefreshCw size={14} className="text-blue-400" />} />
                        {bestDayName && (
                          <StatCard value={bestDayName} label={`Best day (${bestDayCount})`} icon={<Trophy size={16} className="text-yellow-400" />} />
                        )}
                      </div>
                    </>
                  )}

                  {/* Incomplete list */}
                  {pastIncomplete.length > 0 && (
                    <div className={`rounded-lg border ${darkMode ? 'border-red-800 bg-red-900/20' : 'border-red-200 bg-red-50'} p-3`}>
                      <div className={`flex items-center gap-2 ${darkMode ? 'text-red-300' : 'text-red-700'} font-bold text-sm mb-2`}>
                        <AlertCircle size={16} />
                        {pastIncomplete.length} incomplete
                      </div>
                      <div className="max-h-40 overflow-y-auto -mx-1">
                        {pastIncomplete.map((task) => (
                          <button
                            key={task.id}
                            className={`w-full flex items-center gap-3 px-2 py-1.5 rounded text-left ${darkMode ? 'active:bg-red-900/40' : 'active:bg-red-100/60'} transition-colors`}
                            onClick={() => {
                              const d = new Date(task.date + 'T12:00:00');
                              setSelectedDate(d);
                              setShowWeeklyReview(false);
                              setMobileReviewPage(0);
                            }}
                          >
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${task.color || 'bg-blue-500'}`} />
                            <span className={`text-xs ${darkMode ? 'text-red-200' : 'text-red-900'} truncate flex-1`}>{task.title}</span>
                            <span className={`text-xs ${darkMode ? 'text-red-400' : 'text-red-500'} flex-shrink-0`}>
                              {new Date(task.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Card 2: Next 7 Days */}
                <div className="flex-shrink-0 w-full h-full overflow-y-auto px-4 pb-4" style={{ scrollSnapAlign: 'start' }}>
                  <h3 className={`text-xs font-semibold uppercase ${textSecondary} tracking-wider mb-1`}>Next 7 Days</h3>
                  <p className={`text-xs ${textSecondary} mb-4`}>{formatRange(nextStartStr, nextEndStr)}</p>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <StatCard value={nextScheduled} label="Scheduled" icon={<CalendarDays size={16} className="text-blue-400" />} />
                    <StatCard value={formatMinutes(nextPlannedMinutes)} label="Planned" icon={<Clock size={16} className="text-orange-400" />} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {busiestDayName && busiestMinutes > 0 && (
                      <StatCard value={busiestDayName} label="Busiest" icon={<Zap size={16} className="text-amber-400" />} />
                    )}
                    {nextRecurringCount > 0 && (
                      <StatCard value={nextRecurringCount} label="Recurring" icon={<RefreshCw size={14} className="text-blue-400" />} />
                    )}
                  </div>

                  {/* Open days nudge */}
                  {openDays.length > 0 && (
                    <div className={`rounded-lg border ${darkMode ? 'border-green-800 bg-green-900/20' : 'border-green-200 bg-green-50'} p-3`}>
                      <div className={`flex items-center gap-2 ${darkMode ? 'text-green-300' : 'text-green-700'} font-medium text-sm`}>
                        <Sparkles size={16} />
                        {openDayNames.join(', ')} {openDays.length === 1 ? 'is' : 'are'} open for deep work.
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Dot indicators */}
              <div className="flex justify-center gap-2 py-3">
                {[0, 1].map(i => (
                  <button
                    key={i}
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${mobileReviewPage === i ? 'bg-blue-500' : darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}
                    onClick={() => {
                      reviewScrollRef.current?.scrollTo({ left: i * reviewScrollRef.current.clientWidth, behavior: 'smooth' });
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowWeeklyReview(false)}>
            <div
              className={`${cardBg} rounded-xl shadow-2xl ${borderClass} border max-w-2xl w-full mx-4 flex flex-col`}
              style={{ maxHeight: '90vh' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="overflow-y-auto p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <img
                      src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'}
                      alt="dayGLANCE"
                      className="h-[4.5rem]"
                    />
                    <div>
                      <h2 className={`text-xl font-bold ${textPrimary}`}>Weekly Review</h2>
                      <p className={`text-sm ${textSecondary}`}>{formatRange(pastStartStr, pastEndStr)}</p>
                    </div>
                  </div>
                  <button onClick={() => setShowWeeklyReview(false)} className={`${textSecondary} hover:${textPrimary}`}>
                    <X size={20} />
                  </button>
                </div>

                {/* LAST WEEK */}
                <h3 className={`text-xs font-semibold uppercase ${textSecondary} tracking-wider mb-3`}>Past 7 Days</h3>

                {pastScheduled === 0 ? (
                  <p className={`text-sm ${textSecondary} mb-5 italic`}>No tasks were scheduled in the past 7 days</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <StatCard value={`${pastCompleted}/${pastScheduled}`} label="Tasks done" icon={<CheckSquare size={16} className="text-green-400" />} />
                      <StatCard value={`${pastCompletionRate}%`} label="Completion" icon={<Target size={16} className="text-blue-400" />} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <StatCard value={formatMinutes(pastTimeSpent)} label="Time spent" icon={<Clock size={16} className="text-orange-400" />} />
                      <StatCard value={formatMinutes(pastFocusMinutes)} label="Focus time" icon={<BrainCircuit size={16} className="text-purple-400" />} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <StatCard value={`${pastRecurringCompleted}/${pastRecurringScheduled}`} label="Recurring" icon={<RefreshCw size={14} className="text-blue-400" />} />
                      {bestDayName && (
                        <StatCard value={bestDayName} label={`Best day (${bestDayCount})`} icon={<Trophy size={16} className="text-yellow-400" />} />
                      )}
                    </div>
                  </>
                )}

                {/* Incomplete list */}
                {pastIncomplete.length > 0 && (
                  <div className={`rounded-lg border ${darkMode ? 'border-red-800 bg-red-900/20' : 'border-red-200 bg-red-50'} p-3 mb-5`}>
                    <div className={`flex items-center gap-2 ${darkMode ? 'text-red-300' : 'text-red-700'} font-bold text-sm mb-2`}>
                      <AlertCircle size={16} />
                      {pastIncomplete.length} incomplete task{pastIncomplete.length !== 1 ? 's' : ''}
                    </div>
                    <div className="max-h-40 overflow-y-auto -mx-1">
                      {pastIncomplete.map((task) => (
                        <button
                          key={task.id}
                          className={`w-full flex items-center gap-3 px-2 py-1.5 rounded text-left ${darkMode ? 'hover:bg-red-900/40' : 'hover:bg-red-100/60'} transition-colors`}
                          onClick={() => {
                            const d = new Date(task.date + 'T12:00:00');
                            setSelectedDate(d);
                            setShowWeeklyReview(false);
                          }}
                        >
                          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${task.color || 'bg-blue-500'}`} />
                          <span className={`text-xs ${darkMode ? 'text-red-200' : 'text-red-900'} truncate flex-1`}>{task.title}</span>
                          <span className={`text-xs ${darkMode ? 'text-red-400' : 'text-red-500'} flex-shrink-0`}>
                            {new Date(task.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            {task.startTime ? ` \u00b7 ${formatTime(task.startTime)}` : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Divider */}
                <div className={`border-t ${borderClass} my-5`} />

                {/* WEEK AHEAD */}
                <h3 className={`text-xs font-semibold uppercase ${textSecondary} tracking-wider mb-0.5`}>Next 7 Days</h3>
                <p className={`text-sm ${textSecondary} mb-3`}>{formatRange(nextStartStr, nextEndStr)}</p>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <StatCard value={nextScheduled} label="Scheduled" icon={<CalendarDays size={16} className="text-blue-400" />} />
                  <StatCard value={formatMinutes(nextPlannedMinutes)} label="Planned" icon={<Clock size={16} className="text-orange-400" />} />
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {busiestDayName && busiestMinutes > 0 && (
                    <StatCard value={busiestDayName} label="Busiest" icon={<Zap size={16} className="text-amber-400" />} />
                  )}
                  {nextRecurringCount > 0 && (
                    <StatCard value={nextRecurringCount} label="Recurring" icon={<RefreshCw size={14} className="text-blue-400" />} />
                  )}
                </div>

                {/* Open days nudge */}
                {openDays.length > 0 && (
                  <div className={`rounded-lg border ${darkMode ? 'border-green-800 bg-green-900/20' : 'border-green-200 bg-green-50'} p-3 mb-2`}>
                    <div className={`flex items-center gap-2 ${darkMode ? 'text-green-300' : 'text-green-700'} font-medium text-sm`}>
                      <Sparkles size={16} />
                      {openDayNames.join(', ')} {openDays.length === 1 ? 'is' : 'are'} open. {openDays.length === 1 ? 'That would be a great day' : 'Those would be great days'} for deep work or planning.
                    </div>
                  </div>
                )}
              </div>

              {/* Done button */}
              <div className={`p-4 border-t ${borderClass}`}>
                <button
                  onClick={() => setShowWeeklyReview(false)}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Mobile Routine Time Picker (outside routines dashboard modal) */}
      {isMobile && routineTimePickerChipId !== null && !showRoutinesDashboard && (
        <ClockTimePicker
          value={dashboardSelectedChips.find(c => c.id === routineTimePickerChipId)?.startTime || '09:00'}
          onChange={(time) => {
            setDashboardSelectedChips(prev => prev.map(c => c.id === routineTimePickerChipId ? { ...c, startTime: time } : c));
            setRoutineTimePickerChipId(null);
          }}
          onClose={() => setRoutineTimePickerChipId(null)}
        />
      )}

      {/* Welcome Modal for New Users */}
      {showWelcome && isMobile && (
        <div className={`fixed inset-0 z-50 flex flex-col ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          {/* Progress dots */}
          <div className="flex justify-center gap-2 pt-6 pb-4">
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${i === mobileWelcomeStep ? 'bg-blue-500' : (darkMode ? 'bg-gray-600' : 'bg-gray-300')}`}
              />
            ))}
          </div>

          {/* Carousel content */}
          <div className="flex-1 flex flex-col items-center justify-center px-8 overflow-y-auto">
            {mobileWelcomeStep === 0 && (
              <div className="text-center">
                <img
                  src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'}
                  alt="dayGLANCE"
                  className="h-24 mx-auto mb-6"
                />
                <h1 className={`text-2xl font-bold ${textPrimary} mb-2`}>Welcome to dayGLANCE</h1>
                <p className={`${textSecondary}`}>Your minimalist day planner</p>
              </div>
            )}
            {mobileWelcomeStep === 1 && (
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Eye size={32} className="text-blue-500" />
                </div>
                <h2 className={`text-xl font-bold ${textPrimary} mb-2`}>Glance</h2>
                <ul className={`${textSecondary} text-sm text-center space-y-2 max-w-xs mx-auto list-none`}>
                  <li>Your <strong className={textPrimary}>smart agenda</strong> — see <strong className={textPrimary}>overdue</strong>, <strong className={textPrimary}>in-progress</strong>, <strong className={textPrimary}>upcoming</strong> tasks and your <strong className={textPrimary}>daily routine</strong> in real time</li>
                  <li>Track your progress with <strong className={textPrimary}>daily</strong> and <strong className={textPrimary}>all-time summaries</strong> <BarChart3 size={14} className="inline mx-0.5" /></li>
                  <li><strong className={textPrimary}>Search</strong> <Search size={14} className="inline mx-0.5" /> across all your tasks and events, and filter your day by <strong className={textPrimary}>#tags</strong> <Filter size={14} className="inline mx-0.5" /></li>
                  <li>Deleted something by mistake? Restore it from the <strong className={textPrimary}>Recycle Bin</strong> <Trash2 size={14} className="inline mx-0.5" /></li>
                  <li>Tap <strong className={textPrimary}>Focus Mode</strong> <BrainCircuit size={14} className="inline mx-0.5" /> on an in-progress task for a distraction-free deep work session with a Pomodoro timer</li>
                </ul>
              </div>
            )}
            {mobileWelcomeStep === 2 && (
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Calendar size={32} className="text-blue-500" />
                </div>
                <h2 className={`text-xl font-bold ${textPrimary} mb-2`}>Timeline</h2>
                <ul className={`${textSecondary} text-sm text-center space-y-2 max-w-xs mx-auto list-none`}>
                  <li>Swipe a task <strong className={textPrimary}>right</strong> to move it to inbox</li>
                  <li>Swipe a task <strong className={textPrimary}>left</strong> to edit it</li>
                  <li><strong className={textPrimary}>Long-press</strong> and drag to reschedule a task</li>
                  <li>Tap the <strong className={textPrimary}>+</strong> button to add a new task</li>
                </ul>
              </div>
            )}
            {mobileWelcomeStep === 3 && (
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Inbox size={32} className="text-blue-500" />
                </div>
                <h2 className={`text-xl font-bold ${textPrimary} mb-2`}>Inbox</h2>
                <ul className={`${textSecondary} text-sm text-center space-y-2 max-w-xs mx-auto list-none`}>
                  <li>Swipe a task <strong className={textPrimary}>right</strong> to schedule it</li>
                  <li>Swipe a task <strong className={textPrimary}>left</strong> to edit it</li>
                  <li>Tap the <strong className={textPrimary}>+</strong> button to add a new inbox task</li>
                  <li>Use the <strong className={textPrimary}>priority filter</strong> to focus on what matters</li>
                </ul>
              </div>
            )}
            {mobileWelcomeStep === 4 && (
              <div className="text-center">
                <div className="w-16 h-16 bg-teal-100 dark:bg-teal-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Sparkles size={32} className="text-teal-500" />
                </div>
                <h2 className={`text-xl font-bold ${textPrimary} mb-2`}>Routines</h2>
                <ul className={`${textSecondary} text-sm text-center space-y-2 max-w-xs mx-auto list-none`}>
                  <li>Create <strong className={textPrimary}>daily habits</strong> for each day of the week</li>
                  <li>Tap chips to <strong className={textPrimary}>add routines</strong> to today's timeline</li>
                  <li>Set a <strong className={textPrimary}>time</strong> to see routines on the timeline</li>
                </ul>
              </div>
            )}
            {mobileWelcomeStep === 5 && (
              <div className="text-center">
                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Settings size={32} className={textSecondary} />
                </div>
                <h2 className={`text-xl font-bold ${textPrimary} mb-2`}>Settings</h2>
                <ul className={`${textSecondary} text-sm text-center space-y-2 max-w-xs mx-auto list-none`}>
                  <li><strong className={textPrimary}>Quick toggles</strong> for common settings</li>
                  <li><strong className={textPrimary}>Sync</strong> your calendars</li>
                  <li>Set up <strong className={textPrimary}>cloud sync</strong> between devices</li>
                  <li><strong className={textPrimary}>Backup</strong> and restore your data</li>
                </ul>
              </div>
            )}
            {mobileWelcomeStep === 6 && (
              <div className="text-center">
                <img
                  src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'}
                  alt="dayGLANCE"
                  className="h-20 mx-auto mb-6"
                />
                <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>You're All Set!</h2>
                <div className="space-y-3 w-full max-w-xs mx-auto">
                  <button
                    onClick={() => setShowWelcome(false)}
                    className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium transition-colors"
                  >
                    Just Get Started
                  </button>
                  <button
                    onClick={() => { setShowWelcome(false); setShowSettings(true); }}
                    className={`w-full px-6 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-xl font-medium flex items-center justify-center gap-2 transition-colors`}
                  >
                    <Cloud size={18} /> Set Up Cloud Sync
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between px-6 py-6">
            <button
              onClick={() => setShowWelcome(false)}
              className={`text-sm ${textSecondary} px-3 py-2`}
            >
              Skip
            </button>
            <div className="flex gap-3">
              {mobileWelcomeStep > 0 && (
                <button
                  onClick={() => setMobileWelcomeStep(s => s - 1)}
                  className={`p-2 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}
                >
                  <ChevronLeft size={20} className={textSecondary} />
                </button>
              )}
              {mobileWelcomeStep < 6 && (
                <button
                  onClick={() => setMobileWelcomeStep(s => s + 1)}
                  className="p-2 rounded-full bg-blue-600"
                >
                  <ChevronRight size={20} className="text-white" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {showWelcome && !isMobile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div
            className={`${cardBg} rounded-xl shadow-xl ${borderClass} border max-w-lg w-full mx-4 flex flex-col`}
            style={{ height: 'min(540px, 85vh)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Progress dots */}
            <div className="flex justify-center gap-2 pt-5 pb-3">
              {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
                <button
                  key={i}
                  onClick={() => setDesktopWelcomeStep(i)}
                  className={`w-2 h-2 rounded-full transition-colors ${i === desktopWelcomeStep ? 'bg-blue-500' : (darkMode ? 'bg-gray-600' : 'bg-gray-300')}`}
                />
              ))}
            </div>

            {/* Carousel content */}
            <div className="flex-1 flex flex-col items-center justify-center px-8 overflow-hidden">
              {desktopWelcomeStep === 0 && (
                <div className="text-center">
                  <img
                    src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'}
                    alt="dayGLANCE"
                    className="h-24 mx-auto mb-6"
                  />
                  <h1 className={`text-2xl font-bold ${textPrimary} mb-2`}>Welcome to dayGLANCE</h1>
                  <p className={`${textSecondary}`}>Your minimalist day planner</p>
                  <p className={`${textSecondary} text-sm mt-4`}>Let's take a quick tour of the key features.</p>
                </div>
              )}
              {desktopWelcomeStep === 1 && (
                <div className="text-center w-full max-w-sm">
                  <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                    <Plus size={32} className="text-blue-500" />
                  </div>
                  <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>Adding Tasks</h2>
                  <div className={`text-sm ${textSecondary} space-y-3 text-left`}>
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center flex-shrink-0">
                        <Calendar size={16} />
                      </span>
                      <span><strong className={textPrimary}>Scheduled</strong> — tasks with a specific time</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center flex-shrink-0">
                        <Inbox size={16} />
                      </span>
                      <span><strong className={textPrimary}>Inbox</strong> — tasks to organize later</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center flex-shrink-0">
                        <Sparkles size={16} />
                      </span>
                      <span><strong className={textPrimary}>Routines</strong> — daily rituals like exercise or journaling</span>
                    </div>
                  </div>
                </div>
              )}
              {desktopWelcomeStep === 2 && (
                <div className="text-center w-full max-w-sm">
                  <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                    <GripVertical size={32} className="text-blue-500" />
                  </div>
                  <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>Interacting with Tasks</h2>
                  <ul className={`text-sm ${textSecondary} space-y-2 text-left list-none`}>
                    <li>Click on the <strong className={textPrimary}>timeline</strong> to add a task at that time</li>
                    <li>Click on the <strong className={textPrimary}>date header</strong> to add an all-day task</li>
                    <li>Drag tasks from Inbox to timeline to <strong className={textPrimary}>schedule</strong> them</li>
                    <li>Drag the bottom edge of a task to <strong className={textPrimary}>resize</strong> its duration</li>
                    <li>Set tasks to <strong className={textPrimary}>repeat</strong> daily, weekly, monthly, or yearly</li>
                    <li>Double-click a task title to <strong className={textPrimary}>edit</strong> it or add <strong className={textPrimary}>tags</strong></li>
                    <li>Drag tasks to Recycle Bin to <strong className={textPrimary}>delete</strong> them</li>
                    <li>Use <strong className={textPrimary}>Focus Mode</strong> <BrainCircuit size={14} className="inline mx-0.5" /> for distraction-free deep work with a Pomodoro timer</li>
                  </ul>
                </div>
              )}
              {desktopWelcomeStep === 3 && (
                <div className="text-center w-full max-w-sm">
                  <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                    <Search size={32} className="text-blue-500" />
                  </div>
                  <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>Spotlight Search & Weekly Review</h2>
                  <div className={`text-sm ${textSecondary} space-y-4 text-left`}>
                    <div className="flex items-start gap-3">
                      <span className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Search size={16} />
                      </span>
                      <span>Press <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded text-xs font-mono`}>Ctrl+K</kbd> to instantly search all your tasks, jump to any date, or find tasks by tag.</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <BarChart3 size={16} />
                      </span>
                      <span>Click <BarChart3 size={14} className="inline mx-0.5" /> in the sidebar to review your week — see completion stats, reflect on wins, and plan ahead.</span>
                    </div>
                  </div>
                </div>
              )}
              {desktopWelcomeStep === 4 && (
                <div className="text-center w-full max-w-sm">
                  <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                    <Zap size={32} className="text-amber-500" />
                  </div>
                  <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>Keyboard Shortcuts</h2>
                  <div className={`text-sm ${textSecondary} space-y-2`}>
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
                      <span>New scheduled task</span>
                      <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} rounded text-xs font-mono ${textPrimary}`}>N</kbd>
                    </div>
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
                      <span>New inbox task</span>
                      <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} rounded text-xs font-mono ${textPrimary}`}>I</kbd>
                    </div>
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
                      <span>Jump to today</span>
                      <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} rounded text-xs font-mono ${textPrimary}`}>T</kbd>
                    </div>
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
                      <span>Undo / Redo</span>
                      <span className="flex gap-1">
                        <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} rounded text-xs font-mono ${textPrimary}`}>Ctrl+Z</kbd>
                        <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} rounded text-xs font-mono ${textPrimary}`}>Ctrl+Shift+Z</kbd>
                      </span>
                    </div>
                    <p className={`text-xs ${textSecondary} mt-3`}>Press <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} rounded text-xs font-mono`}>?</kbd> at any time to see all available shortcuts.</p>
                  </div>
                </div>
              )}
              {desktopWelcomeStep === 5 && (
                <div className="text-center w-full max-w-sm">
                  <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                    <CalendarDays size={32} className="text-blue-500" />
                  </div>
                  <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>Sync Your Calendars</h2>
                  <ul className={`text-sm ${textSecondary} text-left space-y-2 list-none`}>
                    <li>Click <Settings size={14} className="inline mx-0.5" /> in the top bar to open <strong className={textPrimary}>Settings</strong></li>
                    <li>Add <strong className={textPrimary}>CalDAV</strong> calendar URLs to sync events and reminders</li>
                    <li>Import <strong className={textPrimary}>iCal (.ics)</strong> files to bring in existing events</li>
                    <li>Calendar sync is <strong className={textPrimary}>one-way</strong> — events are imported into dayGLANCE for viewing but changes are not pushed back to the source calendar</li>
                  </ul>
                </div>
              )}
              {desktopWelcomeStep === 6 && (
                <div className="text-center w-full max-w-sm">
                  <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-5">
                    <Settings size={32} className={textSecondary} />
                  </div>
                  <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>App Settings</h2>
                  <div className={`text-sm ${textSecondary} space-y-2 text-left`}>
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                        <Settings size={16} className={textPrimary} />
                      </span>
                      <span><strong className={textPrimary}>Settings</strong> — calendar sync, iCal import, clock format, and sounds</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                        {darkMode ? <Sun size={16} className={textPrimary} /> : <Moon size={16} className={textPrimary} />}
                      </span>
                      <span><strong className={textPrimary}>Dark / Light mode</strong> — toggle your preferred theme</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                        <Cloud size={16} className={textPrimary} />
                      </span>
                      <span><strong className={textPrimary}>Cloud Sync</strong> — sync your data across devices via WebDAV</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                        <Bell size={16} className={textPrimary} />
                      </span>
                      <span><strong className={textPrimary}>Reminders</strong> — get notified before tasks start</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                        <Save size={16} className={textPrimary} />
                      </span>
                      <span><strong className={textPrimary}>Backup & Restore</strong> — export or import as JSON</span>
                    </div>
                    <p className="text-xs opacity-75 mt-2">Your data is stored locally in your browser. Use backup or cloud sync to transfer between devices.</p>
                  </div>
                </div>
              )}
              {desktopWelcomeStep === 7 && (
                <div className="text-center">
                  <img
                    src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'}
                    alt="dayGLANCE"
                    className="h-20 mx-auto mb-6"
                  />
                  <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>You're All Set!</h2>
                  <div className="space-y-3 w-full max-w-xs mx-auto">
                    <button
                      onClick={() => { setShowWelcome(false); setDesktopWelcomeStep(0); }}
                      className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium transition-colors"
                    >
                      Just Get Started
                    </button>
                    <button
                      onClick={() => { setShowWelcome(false); setDesktopWelcomeStep(0); setShowSettings(true); }}
                      className={`w-full px-6 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-xl font-medium flex items-center justify-center gap-2 transition-colors`}
                    >
                      <Cloud size={18} /> Set Up Cloud Sync
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between px-6 py-4">
              <button
                onClick={() => { setShowWelcome(false); setDesktopWelcomeStep(0); }}
                className={`text-sm ${textSecondary} px-3 py-2 hover:${textPrimary} transition-colors`}
              >
                Skip
              </button>
              <div className="flex gap-3">
                {desktopWelcomeStep > 0 && (
                  <button
                    onClick={() => setDesktopWelcomeStep(s => s - 1)}
                    className={`p-2 rounded-full ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} transition-colors`}
                  >
                    <ChevronLeft size={20} className={textSecondary} />
                  </button>
                )}
                {desktopWelcomeStep < 7 && (
                  <button
                    onClick={() => setDesktopWelcomeStep(s => s + 1)}
                    className="p-2 rounded-full bg-blue-600 hover:bg-blue-700 transition-colors"
                  >
                    <ChevronRight size={20} className="text-white" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DayPlanner;