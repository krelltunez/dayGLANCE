import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Clock, X, GripVertical, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Moon, Sun, Upload, Inbox, AlertCircle, Calendar, Check, RefreshCw, Palette, CalendarPlus, Trash2, Undo2, BarChart3, SkipForward, Hash } from 'lucide-react';

const DayPlanner = () => {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return today;
  });
  const [tasks, setTasks] = useState([]);
  const [unscheduledTasks, setUnscheduledTasks] = useState([]);
  const [recycleBin, setRecycleBin] = useState([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', startTime: '09:00', duration: 30 });
  const [draggedTask, setDraggedTask] = useState(null);
  const [dragSource, setDragSource] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [minimizedSections, setMinimizedSections] = useState(() => {
    const saved = localStorage.getItem('minimizedSections');
    return saved ? JSON.parse(saved) : {
      inbox: false,
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
  const [pendingPriorities, setPendingPriorities] = useState({});
  const [showSyncSettings, setShowSyncSettings] = useState(false);
  const [syncUrl, setSyncUrl] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showMonthView, setShowMonthView] = useState(false);
  const [viewedMonth, setViewedMonth] = useState(() => new Date());
  const [showEmptyBinConfirm, setShowEmptyBinConfirm] = useState(false);
  const [syncNotification, setSyncNotification] = useState(null); // { type: 'success' | 'error' | 'info', message: string }
  const [isSyncing, setIsSyncing] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTaskText, setEditingTaskText] = useState('');
  const [weather, setWeather] = useState(null);
  // TODO: Re-enable stocks and news later
  // const [stocks, setStocks] = useState(null);
  // const [news, setNews] = useState(null);
  const [dragPreviewTime, setDragPreviewTime] = useState(null);
  const calendarRef = useRef(null);
  const currentTimeRef = useRef(null);
  const priorityTimeouts = useRef({});

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
  const durationOptions = Array.from({ length: 9 }, (_, i) => (i + 1) * 15); // 15 to 120 minutes

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

  useEffect(() => {
    loadData();
    fetchWeather(); // FIX 1: Call fetchWeather on mount
    // TODO: Re-enable stocks and news later
    // fetchStocks();
    // fetchNews();
  }, []);

  // Close month view when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showMonthView && !e.target.closest('.month-view-container')) {
        setShowMonthView(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMonthView]);

  // Persist darkMode to localStorage
  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
  }, [darkMode]);

  // Persist minimizedSections to localStorage
  useEffect(() => {
    localStorage.setItem('minimizedSections', JSON.stringify(minimizedSections));
  }, [minimizedSections]);

  // Persist selectedTags to localStorage
  useEffect(() => {
    localStorage.setItem('day-planner-selected-tags', JSON.stringify(selectedTags));
  }, [selectedTags]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  // Auto-sync calendar every 15 minutes when syncUrl is configured
  useEffect(() => {
    if (!syncUrl) return;

    const syncTimer = setInterval(() => {
      syncWithCalendar({ silent: true });
    }, 15 * 60 * 1000); // 15 minutes

    return () => clearInterval(syncTimer);
  }, [syncUrl]);

  useEffect(() => {
    const isToday = dateToString(selectedDate) === dateToString(new Date());
    if (isToday && calendarRef.current) {
      setTimeout(() => {
        const currentHour = new Date().getHours();
        // Scroll to show 2 hours before current time (each hour is 160px tall)
        const scrollPosition = Math.max(0, (currentHour - 2) * 160);
        calendarRef.current.scrollTop = scrollPosition;
      }, 100);
    }
  }, [selectedDate]);

  useEffect(() => {
    saveData();
    checkConflicts();
  }, [tasks, unscheduledTasks, recycleBin]);

  const loadData = () => {
    try {
      const tasksData = localStorage.getItem('day-planner-tasks');
      const unscheduledData = localStorage.getItem('day-planner-unscheduled');
      const recycleBinData = localStorage.getItem('day-planner-recycle-bin');
      const darkModeData = localStorage.getItem('day-planner-darkmode');
      const syncUrlData = localStorage.getItem('day-planner-sync-url');
      
      if (tasksData) {
        setTasks(JSON.parse(tasksData));
      }
      if (unscheduledData) {
        setUnscheduledTasks(JSON.parse(unscheduledData));
      }
      if (recycleBinData) {
        setRecycleBin(JSON.parse(recycleBinData));
      }
      if (darkModeData) {
        setDarkMode(JSON.parse(darkModeData));
      }
      if (syncUrlData) {
        setSyncUrl(JSON.parse(syncUrlData));
      }
    } catch (error) {
      console.log('No existing data found, starting fresh');
    }
  };

  const saveData = () => {
    try {
      localStorage.setItem('day-planner-tasks', JSON.stringify(tasks));
      localStorage.setItem('day-planner-unscheduled', JSON.stringify(unscheduledTasks));
      localStorage.setItem('day-planner-recycle-bin', JSON.stringify(recycleBin));
      localStorage.setItem('day-planner-darkmode', JSON.stringify(darkMode));
      localStorage.setItem('day-planner-sync-url', JSON.stringify(syncUrl));
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
        console.log('Weather codes received:', {
          current: data.current.weather_code,
          daily: data.daily.weather_code
        });
        
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

  // TODO: Re-enable stocks and news later
  /*
  const fetchStocks = async () => {
    try {
      // Using Alpha Vantage API for real-time stock data
      const API_KEY = 'TMIZYNJ5MZP7VXCT';
      const symbols = [
        { symbol: 'FCNTX', name: 'FCNTX', fallback: { price: '--', change: '--', changePercent: '--' } },
        { symbol: 'FXAIX', name: 'FXAIX', fallback: { price: '--', change: '--', changePercent: '--' } },
        { symbol: 'QQQ', name: 'QQQ', fallback: { price: '--', change: '--', changePercent: '--' } },
        { symbol: 'NVDA', name: 'NVDA', fallback: { price: '--', change: '--', changePercent: '--' } }
      ];
      
      const stockData = [];
      
      for (const stock of symbols) {
        try {
          const response = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${stock.symbol}&apikey=${API_KEY}`);
          const data = await response.json();
          
          console.log(`Stock ${stock.symbol} response:`, data); // Debug logging
          
          if (data['Global Quote'] && Object.keys(data['Global Quote']).length > 0) {
            const quote = data['Global Quote'];
            const priceStr = quote['05. price'];
            const changeStr = quote['09. change'];
            const changePercentStr = quote['10. change percent'];
            
            if (priceStr && changeStr && changePercentStr) {
              const price = parseFloat(priceStr);
              const change = parseFloat(changeStr);
              const changePercent = parseFloat(changePercentStr.replace('%', ''));
              
              stockData.push({
                symbol: stock.name,
                price: price.toFixed(2),
                change: change.toFixed(2),
                changePercent: changePercent.toFixed(2),
                isPositive: change >= 0
              });
              console.log(`Successfully fetched ${stock.symbol}`);
            } else {
              // Use fallback for this stock
              console.warn(`Incomplete data for ${stock.symbol}, using fallback`);
              stockData.push({
                symbol: stock.name,
                price: stock.fallback.price,
                change: stock.fallback.change,
                changePercent: stock.fallback.changePercent,
                isPositive: stock.fallback.change.startsWith('+')
              });
            }
          } else if (data['Note']) {
            console.warn(`API rate limit for ${stock.symbol}, using fallback`);
            // Use fallback for this stock
            stockData.push({
              symbol: stock.name,
              price: stock.fallback.price,
              change: stock.fallback.change,
              changePercent: stock.fallback.changePercent,
              isPositive: stock.fallback.change.startsWith('+')
            });
          } else {
            // Use fallback for this stock
            console.warn(`No data for ${stock.symbol}, using fallback`);
            stockData.push({
              symbol: stock.name,
              price: stock.fallback.price,
              change: stock.fallback.change,
              changePercent: stock.fallback.changePercent,
              isPositive: stock.fallback.change.startsWith('+')
            });
          }
        } catch (err) {
          console.error(`Failed to fetch ${stock.symbol}:`, err);
          // Use fallback for this stock
          stockData.push({
            symbol: stock.name,
            price: stock.fallback.price,
            change: stock.fallback.change,
            changePercent: stock.fallback.changePercent,
            isPositive: stock.fallback.change.startsWith('+')
          });
        }
        
        // Alpha Vantage rate limit: delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Always set all 4 stocks
      setStocks(stockData);
    } catch (error) {
      console.error('Failed to fetch stocks:', error);
      // Show blanks on error
      setStocks([
        { symbol: 'FCNTX', price: '--', change: '--', changePercent: '--', isPositive: true },
        { symbol: 'FXAIX', price: '--', change: '--', changePercent: '--', isPositive: true },
        { symbol: 'QQQ', price: '--', change: '--', changePercent: '--', isPositive: true },
        { symbol: 'NVDA', price: '--', change: '--', changePercent: '--', isPositive: true }
      ]);
    }
  };

  const fetchNews = async () => {
    try {
      // Using GNews API for real news headlines (browser-friendly, no CORS issues)
      const API_KEY = '986dcee6f5e6dcefb4665a5cc090d20a';
      const url = `https://gnews.io/api/v4/top-headlines?country=us&max=3&apikey=${API_KEY}`;
      
      console.log('Fetching news from:', url);
      const response = await fetch(url);
      console.log('News response status:', response.status);
      
      const data = await response.json();
      console.log('GNews API full response:', data);
      
      if (data.errors) {
        console.error('GNews API error:', data.errors);
        throw new Error(JSON.stringify(data.errors));
      }
      
      if (data.articles && data.articles.length > 0) {
        console.log('Successfully got', data.articles.length, 'articles');
        setNews(data.articles.slice(0, 3).map(article => ({
          title: article.title
        })));
        return;
      }
      
      // Fallback if API fails
      console.warn('No articles returned from GNews API, using fallback. Response was:', data);
      setNews([
        { title: 'News not available at this time' },
        { title: 'News not available at this time' },
        { title: 'News not available at this time' }
      ]);
    } catch (error) {
      console.error('Failed to fetch news:', error);
      // Fallback on error
      setNews([
        { title: 'News not available at this time' },
        { title: 'News not available at this time' },
        { title: 'News not available at this time' }
      ]);
    }
  };
  */

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

  const checkConflicts = () => {
    const dateStr = dateToString(selectedDate);
    const todayTasks = tasks.filter(t => t.date === dateStr && !t.isAllDay); // Exclude all-day tasks
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

  const cyclePriority = (taskId) => {
    const task = unscheduledTasks.find(t => t.id === taskId);
    const currentPriority = pendingPriorities[taskId] ?? task?.priority ?? 0;
    const newPriority = (currentPriority + 1) % 4;

    // Update visual immediately
    setPendingPriorities(prev => ({ ...prev, [taskId]: newPriority }));

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
    const conflicting = getConflictingTasks(task, allTasks);
    if (conflicting.length === 0) return { left: 2, right: 2, width: null };
    
    const allConflicted = [task, ...conflicting].sort((a, b) => a.id - b.id);
    const index = allConflicted.findIndex(t => t.id === task.id);
    const total = allConflicted.length;
    
    const widthPercent = 100 / total;
    const leftPercent = widthPercent * index;
    
    return {
      left: `calc(${leftPercent}% + 0.25rem)`,
      right: 'auto',
      width: `calc(${widthPercent}% - 0.5rem)`
    };
  };

  const addTask = (toInbox = false) => {
    if (newTask.title.trim()) {
      const task = {
        id: Date.now(),
        title: newTask.title,
        duration: newTask.duration,
        color: newTask.color || colors[0].class,
        completed: false,
        isAllDay: newTask.isAllDay || false
      };

      if (toInbox) {
        setUnscheduledTasks([...unscheduledTasks, { ...task, priority: 0 }]);
      } else {
        setTasks([...tasks, {
          ...task,
          startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
          date: newTask.date || dateToString(selectedDate)
        }]);
      }
      
      setNewTask({ title: '', startTime: getNextQuarterHour(), duration: 30, date: dateToString(selectedDate), isAllDay: false });
      setShowAddTask(false);
    }
  };

  const changeTaskColor = (taskId, newColor, fromInbox = false) => {
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
  };

  const toggleComplete = (id, fromInbox = false) => {
    if (fromInbox) {
      setUnscheduledTasks(unscheduledTasks.map(task => 
        task.id === id ? { ...task, completed: !task.completed } : task
      ));
    } else {
      setTasks(tasks.map(task => 
        task.id === id ? { ...task, completed: !task.completed } : task
      ));
    }
  };

  const postponeTask = (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task || !task.startTime) return; // Only postpone scheduled tasks
    
    // Calculate next day's date
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);
    
    // Update the task with the new date (same time)
    setTasks(tasks.map(t => 
      t.id === id ? { ...t, date: nextDay.toISOString().split('T')[0] } : t
    ));
  };

  const moveToInbox = (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    // Remove scheduling info and move to inbox
    const unscheduledTask = {
      ...task,
      startTime: null,
      date: null,
      isAllDay: false
    };

    setTasks(tasks.filter(t => t.id !== id));
    setUnscheduledTasks([...unscheduledTasks, unscheduledTask]);
  };

  const startEditingTask = (task, isInbox = false) => {
    if (task.imported) return; // Don't allow editing imported tasks
    setEditingTaskId(task.id);
    setEditingTaskText(task.title);
  };

  const saveTaskTitle = (isInbox = false) => {
    if (!editingTaskId || !editingTaskText.trim()) {
      cancelEditingTask();
      return;
    }

    if (isInbox) {
      setUnscheduledTasks(unscheduledTasks.map(t =>
        t.id === editingTaskId ? { ...t, title: editingTaskText.trim() } : t
      ));
    } else {
      setTasks(tasks.map(t =>
        t.id === editingTaskId ? { ...t, title: editingTaskText.trim() } : t
      ));
    }

    setEditingTaskId(null);
    setEditingTaskText('');
  };

  const cancelEditingTask = () => {
    setEditingTaskId(null);
    setEditingTaskText('');
  };

  const handleEditKeyDown = (e, isInbox = false) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTaskTitle(isInbox);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingTask();
    }
  };

  const moveToRecycleBin = (id, fromInbox = false) => {
    const task = fromInbox 
      ? unscheduledTasks.find(t => t.id === id)
      : tasks.find(t => t.id === id);
    
    if (task) {
      // Store original location with the task
      const taskWithMeta = {
        ...task,
        _deletedFrom: fromInbox ? 'inbox' : 'calendar'
      };
      setRecycleBin([...recycleBin, taskWithMeta]);
      if (fromInbox) {
        setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== id));
      } else {
        setTasks(tasks.filter(t => t.id !== id));
      }
    }
  };

  const undeleteTask = (id) => {
    const task = recycleBin.find(t => t.id === id);
    if (task) {
      const { _deletedFrom, ...cleanTask } = task; // Remove metadata
      
      if (_deletedFrom === 'inbox') {
        setUnscheduledTasks([...unscheduledTasks, cleanTask]);
      } else {
        setTasks([...tasks, cleanTask]);
      }
      
      setRecycleBin(recycleBin.filter(t => t.id !== id));
    }
  };

  const emptyRecycleBin = () => {
    setShowEmptyBinConfirm(true);
  };

  const confirmEmptyBin = () => {
    setRecycleBin([]);
    setShowEmptyBinConfirm(false);
  };

  const formatDate = (date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  const changeDate = (days) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + days);
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
    const dateStr = date.toISOString().split('T')[0];
    return tasks.some(task => task.date === dateStr);
  };

  const openNewTaskForm = () => {
    setNewTask({ 
      title: '', 
      startTime: getNextQuarterHour(), 
      duration: 30,
      date: dateToString(selectedDate),
      isAllDay: false
    });
    setShowAddTask(true);
  };

  const openNewInboxTask = () => {
    setNewTask({ 
      title: '', 
      startTime: getNextQuarterHour(), 
      duration: 30,
      date: dateToString(selectedDate),
      isAllDay: false,
      openInInbox: true
    });
    setShowAddTask(true);
  };

  const openNewTaskAtTime = (e) => {
    // Only trigger if clicking on the empty calendar area, not on tasks
    if (e.target.classList.contains('calendar-slot')) {
      const rect = calendarRef.current.getBoundingClientRect();
      const scrollTop = calendarRef.current.scrollTop;
      const y = e.clientY - rect.top + scrollTop;
      
      const totalMinutesFromTop = (y / 160) * 60;
      const clickHours = Math.floor(totalMinutesFromTop / 60) + firstHour;
      const minutes = Math.round((totalMinutesFromTop % 60) / 15) * 15;
      const totalMinutes = Math.max(0, Math.min(23 * 60 + 45, clickHours * 60 + minutes));
      const clickedTime = minutesToTime(totalMinutes);
      
      setNewTask({ 
        title: '', 
        startTime: clickedTime, 
        duration: 30,
        date: dateToString(selectedDate),
        isAllDay: false
      });
      setShowAddTask(true);
    }
  };

  const calculateTaskPosition = (task) => {
    const startMinutes = timeToMinutes(task.startTime);
    const startHour = Math.floor(startMinutes / 60);
    const minutesIntoHour = startMinutes % 60;
    // 160px per hour + 1px border per hour above this one
    const top = startHour * 160 + startHour + (minutesIntoHour * 160 / 60);
    const height = (task.duration * 160 / 60);
    return { top, height };
  };

  const handleDragStart = (task, source, e) => {
    setDraggedTask(task);
    setDragSource(source);
    setDragPreviewTime(null);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    // Show preview time while dragging
    if (draggedTask && e.currentTarget === calendarRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const scrollTop = e.currentTarget.scrollTop;
      const y = e.clientY - rect.top + scrollTop;
      
      // Calculate total minutes from the top of the calendar
      const totalMinutesFromTop = (y / 160) * 60;
      
      // Round to nearest 15 minutes FIRST, then calculate hours
      const totalMinutesRounded = Math.round(totalMinutesFromTop / 15) * 15;
      const hours = Math.floor(totalMinutesRounded / 60);
      const minutes = totalMinutesRounded % 60;
      
      const dragHours = hours + firstHour;
      const totalMinutes = Math.max(0, Math.min(24 * 60 - draggedTask.duration, dragHours * 60 + minutes));
      setDragPreviewTime(minutesToTime(totalMinutes));
    }
  };

  const handleDropOnCalendar = (e) => {
    e.preventDefault();
    if (!draggedTask) return;

    const calendarElement = e.currentTarget;
    const rect = calendarElement.getBoundingClientRect();
    
    // Get the scroll position of the calendar container
    const scrollTop = calendarElement.scrollTop;
    
    // Calculate position relative to the top of the scrollable content
    const y = e.clientY - rect.top + scrollTop;
    
    // Calculate total minutes from the top of the calendar
    const totalMinutesFromTop = (y / 160) * 60;
    
    // Round to nearest 15 minutes FIRST, then calculate hours
    const totalMinutesRounded = Math.round(totalMinutesFromTop / 15) * 15;
    const hours = Math.floor(totalMinutesRounded / 60);
    const minutes = totalMinutesRounded % 60;
    
    const dropHours = hours + firstHour;
    
    // Ensure time is within bounds
    const totalMinutes = Math.max(0, Math.min(24 * 60 - draggedTask.duration, dropHours * 60 + minutes));
    const startTime = minutesToTime(totalMinutes);

    if (dragSource === 'inbox') {
      setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
      const { priority, ...taskWithoutPriority } = draggedTask;
      setTasks([...tasks, {
        ...taskWithoutPriority,
        startTime,
        date: dateToString(selectedDate)
      }]);
    } else if (dragSource === 'calendar') {
      setTasks(tasks.map(t => 
        t.id === draggedTask.id 
          ? { ...t, startTime, date: dateToString(selectedDate) }
          : t
      ));
    } else if (dragSource === 'recycleBin') {
      // Remove metadata and add to calendar
      const { _deletedFrom, ...cleanTask } = draggedTask;
      setRecycleBin(recycleBin.filter(t => t.id !== draggedTask.id));
      setTasks([...tasks, {
        ...cleanTask,
        startTime,
        date: dateToString(selectedDate)
      }]);
    }

    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
  };

  const handleDropOnInbox = (e) => {
    e.preventDefault();
    if (!draggedTask) return;
    
    // Only allow calendar and recycle bin tasks to be moved to inbox
    if (dragSource !== 'calendar' && dragSource !== 'recycleBin') return;

    if (dragSource === 'calendar') {
      setTasks(tasks.filter(t => t.id !== draggedTask.id));
      const { startTime, date, ...taskWithoutSchedule } = draggedTask;
      setUnscheduledTasks([...unscheduledTasks, taskWithoutSchedule]);
    } else if (dragSource === 'recycleBin') {
      setRecycleBin(recycleBin.filter(t => t.id !== draggedTask.id));
      const { _deletedFrom, startTime, date, ...taskWithoutSchedule } = draggedTask;
      setUnscheduledTasks([...unscheduledTasks, taskWithoutSchedule]);
    }
    
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
  };

  const handleDropOnRecycleBin = (e) => {
    e.preventDefault();
    if (!draggedTask) return;

    // Add to recycle bin with metadata about where it came from
    const taskWithMeta = {
      ...draggedTask,
      _deletedFrom: dragSource === 'inbox' ? 'inbox' : 'calendar'
    };
    setRecycleBin([...recycleBin, taskWithMeta]);
    
    // Remove from original location
    if (dragSource === 'inbox') {
      setUnscheduledTasks(unscheduledTasks.filter(t => t.id !== draggedTask.id));
    } else if (dragSource === 'calendar') {
      setTasks(tasks.filter(t => t.id !== draggedTask.id));
    }
    
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
  };

  const handleResizeStart = (task, e) => {
    e.stopPropagation();
    e.preventDefault();
    
    const startY = e.clientY;
    const startDuration = task.duration;
    
    const handleMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const deltaMinutes = Math.round((deltaY / 80) * 60 / 15) * 15;
      const newDuration = Math.max(15, startDuration + deltaMinutes);
      
      setTasks(prevTasks => prevTasks.map(t => 
        t.id === task.id ? { ...t, duration: newDuration } : t
      ));
    };
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const parseICS = (icsContent) => {
    const lines = icsContent.split('\n').map(line => line.trim());
    const events = [];
    let currentEvent = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line === 'BEGIN:VEVENT') {
        currentEvent = {};
      } else if (line === 'END:VEVENT' && currentEvent) {
        if (currentEvent.summary && currentEvent.dtstart) {
          events.push(currentEvent);
        }
        currentEvent = null;
      } else if (currentEvent) {
        if (line.startsWith('SUMMARY:')) {
          currentEvent.summary = line.substring(8);
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
        } else if (line.startsWith('UID:')) {
          currentEvent.uid = line.substring(4);
        }
      }
    }

    return events;
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

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const icsContent = event.target.result;
      const events = parseICS(icsContent);

      const importedTasks = events.map(event => {
        const startDate = parseDatetime(event.dtstart);
        const endDate = event.dtend ? parseDatetime(event.dtend) : new Date(startDate.getTime() + 60 * 60 * 1000);
        const duration = Math.round((endDate - startDate) / (1000 * 60));

        // Detect all-day events: either explicitly marked, or starts at midnight and lasts 24+ hours
        const isAllDay = event.isAllDay ||
          (startDate.getHours() === 0 && startDate.getMinutes() === 0 && duration >= 1440);

        return {
          id: event.uid || `imported-${Date.now()}-${Math.random()}`,
          icalUid: event.uid,
          title: event.summary,
          startTime: `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`,
          duration: isAllDay ? 60 : (duration > 0 ? duration : 60),
          date: dateToString(startDate),
          color: 'bg-gray-600',
          completed: false,
          imported: true,
          isAllDay: isAllDay
        };
      });

      // Remove old imported events and add the fresh ones
      const nonImportedTasks = tasks.filter(t => !t.imported);
      setTasks([...nonImportedTasks, ...importedTasks]);
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const syncWithCalendar = async ({ silent = false } = {}) => {
    if (!syncUrl) {
      if (!silent) setSyncNotification({ type: 'info', message: 'Please enter a calendar URL in sync settings' });
      return;
    }

    setIsSyncing(true);
    try {
      // Use proxy to bypass CORS restrictions
      // Note: URL is not encoded because nginx's $arg_url doesn't auto-decode
      const proxyUrl = `/api/calendar-proxy/?url=${syncUrl}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Failed to fetch calendar');

      const icsContent = await response.text();
      const events = parseICS(icsContent);

      const importedTasks = events.map(event => {
        const startDate = parseDatetime(event.dtstart);
        const endDate = event.dtend ? parseDatetime(event.dtend) : new Date(startDate.getTime() + 60 * 60 * 1000);
        const duration = Math.round((endDate - startDate) / (1000 * 60));

        // Detect all-day events: either explicitly marked, or starts at midnight and lasts 24+ hours
        const isAllDay = event.isAllDay ||
          (startDate.getHours() === 0 && startDate.getMinutes() === 0 && duration >= 1440);

        return {
          id: event.uid || `imported-${Date.now()}-${Math.random()}`,
          icalUid: event.uid,
          title: event.summary,
          startTime: `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`,
          duration: isAllDay ? 60 : (duration > 0 ? duration : 60),
          date: dateToString(startDate),
          color: 'bg-gray-600',
          completed: false,
          imported: true,
          isAllDay: isAllDay
        };
      });

      // Remove old imported events and add the fresh ones
      const nonImportedTasks = tasks.filter(t => !t.imported);
      setTasks([...nonImportedTasks, ...importedTasks]);
      if (!silent) setSyncNotification({ type: 'success', message: `Synced ${importedTasks.length} events from calendar` });
    } catch (error) {
      if (!silent) setSyncNotification({ type: 'error', message: 'Failed to sync with calendar. Make sure the URL is correct and publicly accessible.' });
      console.error('Sync error:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const ClockTimePicker = ({ value, onChange, onClose }) => {
    const [selectedHour, setSelectedHour] = useState(parseInt(value.split(':')[0]));
    const [selectedMinute, setSelectedMinute] = useState(parseInt(value.split(':')[1]));
    const [mode, setMode] = useState('hour');

    const handleConfirm = () => {
      const timeStr = `${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`;
      onChange(timeStr);
      onClose();
    };

    const renderClock = () => {
      const numbers = mode === 'hour' ? Array.from({ length: 24 }, (_, i) => i) : [0, 15, 30, 45];
      const radius = 100;
      const centerX = 120;
      const centerY = 120;

      return (
        <div className="relative" style={{ width: '240px', height: '240px' }}>
          <svg width="240" height="240" className="absolute top-0 left-0">
            <circle cx={centerX} cy={centerY} r={radius} fill="none" stroke={darkMode ? '#374151' : '#e5e7eb'} strokeWidth="2" />
            
            {/* Selected time indicator */}
            {mode === 'hour' && (
              <line
                x1={centerX}
                y1={centerY}
                x2={centerX + radius * Math.sin((selectedHour * 15) * Math.PI / 180)}
                y2={centerY - radius * Math.cos((selectedHour * 15) * Math.PI / 180)}
                stroke="#3b82f6"
                strokeWidth="2"
              />
            )}
            {mode === 'minute' && (
              <line
                x1={centerX}
                y1={centerY}
                x2={centerX + radius * Math.sin((selectedMinute * 6) * Math.PI / 180)}
                y2={centerY - radius * Math.cos((selectedMinute * 6) * Math.PI / 180)}
                stroke="#3b82f6"
                strokeWidth="2"
              />
            )}
            
            {/* Center dot */}
            <circle cx={centerX} cy={centerY} r="4" fill="#3b82f6" />
          </svg>

          {numbers.map((num) => {
            const angle = mode === 'hour' ? (num * 15 - 90) : (num * 6 - 90);
            const x = centerX + radius * Math.cos(angle * Math.PI / 180);
            const y = centerY + radius * Math.sin(angle * Math.PI / 180);
            const isSelected = mode === 'hour' ? num === selectedHour : num === selectedMinute;

            return (
              <button
                key={num}
                onClick={() => {
                  if (mode === 'hour') {
                    setSelectedHour(num);
                    setMode('minute');
                  } else {
                    setSelectedMinute(num);
                  }
                }}
                className={`absolute w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                  isSelected 
                    ? 'bg-blue-600 text-white' 
                    : darkMode 
                      ? 'hover:bg-gray-700 text-gray-300' 
                      : 'hover:bg-gray-200 text-gray-700'
                }`}
                style={{
                  left: `${x - 20}px`,
                  top: `${y - 20}px`,
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
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
        <div 
          className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className={`text-lg font-semibold ${textPrimary}`}>Select Time</h3>
            <button onClick={onClose} className={`p-1 rounded ${hoverBg}`}>
              <X size={20} className={textSecondary} />
            </button>
          </div>

          <div className="flex justify-center mb-4">
            <div className="flex gap-2 items-center">
              <button
                onClick={() => setMode('hour')}
                className={`text-3xl font-bold px-3 py-1 rounded ${
                  mode === 'hour' ? 'bg-blue-600 text-white' : textSecondary
                }`}
              >
                {selectedHour.toString().padStart(2, '0')}
              </button>
              <span className={`text-3xl ${textPrimary}`}>:</span>
              <button
                onClick={() => setMode('minute')}
                className={`text-3xl font-bold px-3 py-1 rounded ${
                  mode === 'minute' ? 'bg-blue-600 text-white' : textSecondary
                }`}
              >
                {selectedMinute.toString().padStart(2, '0')}
              </button>
            </div>
          </div>

          <div className="flex justify-center mb-4">
            {renderClock()}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} ${hoverBg}`}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
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
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
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

  // Extract all unique tags from all tasks
  const allTags = useMemo(() => {
    const tagSet = new Set();
    [...tasks, ...unscheduledTasks].forEach(task => {
      extractTags(task.title).forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [tasks, unscheduledTasks]);

  // Auto-select new tags when they appear
  useEffect(() => {
    const newTags = allTags.filter(tag => !selectedTags.includes(tag));
    if (newTags.length > 0) {
      setSelectedTags(prev => [...prev, ...newTags]);
    }
  }, [allTags]);

  // Filter tasks by selected tags (OR logic - show tasks matching ANY selected tag)
  // Tasks with no tags are always shown (they can't be filtered by tags)
  const filterByTags = (taskList) => {
    if (selectedTags.length === 0) return taskList;
    return taskList.filter(task => {
      const taskTags = extractTags(task.title);
      // Always show tasks with no tags (like imported events)
      if (taskTags.length === 0) return true;
      return selectedTags.some(tag => taskTags.includes(tag));
    });
  };

  const filteredUnscheduledTasks = filterByTags(unscheduledTasks)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const filteredTodayTasks = filterByTags(todayTasks);

  // Calculate all-time stats (excluding imported events)
  const nonImportedTasks = tasks.filter(t => !t.imported);
  const todayNonImportedTasks = todayTasks.filter(t => !t.imported);
  const allCompletedTasks = nonImportedTasks.filter(t => t.completed);
  const totalCompletedMinutes = allCompletedTasks.reduce((sum, task) => sum + task.duration, 0);
  const totalScheduledMinutes = nonImportedTasks.reduce((sum, task) => sum + task.duration, 0);

  const isToday = dateToString(selectedDate) === dateToString(new Date());
  const currentTimeMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const currentHour = currentTime.getHours();
  const currentTimeTop = currentHour * 160 + currentHour + (currentTime.getMinutes() * 160 / 60);
  const showCurrentTimeLine = isToday;

  const bgClass = darkMode ? 'bg-gray-900' : 'bg-gray-50';
  const cardBg = darkMode ? 'bg-gray-800' : 'bg-white';
  const borderClass = darkMode ? 'border-gray-700' : 'border-gray-200';
  const textPrimary = darkMode ? 'text-gray-100' : 'text-gray-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-gray-600';
  const hoverBg = darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100';

  return (
    <div className={`min-h-screen ${bgClass}`}>
      <div className={`${cardBg} border-b ${borderClass} px-6 py-4`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex-1">
            <h1 className={`text-2xl font-bold ${textPrimary}`}>&nbsp;&nbsp;Here's what your day looks like!</h1>
            <div className="flex items-center gap-6 mt-2">
              <div className="flex items-center gap-2 relative">
                <button onClick={() => changeDate(-1)} className={`p-1 rounded ${hoverBg}`}>
                  <ChevronLeft size={20} className={textSecondary} />
                </button>
                <button
                  onClick={() => {
                    if (!showMonthView) setViewedMonth(new Date(selectedDate));
                    setShowMonthView(!showMonthView);
                  }}
                  className={`${textPrimary} font-bold text-xl min-w-[220px] text-center hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1 transition-colors cursor-pointer`}
                >
                  {formatDate(selectedDate)}
                </button>
                <button onClick={() => changeDate(1)} className={`p-1 rounded ${hoverBg}`}>
                  <ChevronRight size={20} className={textSecondary} />
                </button>
                
                {/* Month View Popup */}
                {showMonthView && (
                  <div className={`month-view-container absolute top-full left-0 mt-2 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-4 z-50 min-w-[300px]`}>
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
                        const isToday = day && day.toDateString() === new Date().toDateString();
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
                              ${!isSelected && isToday ? 'bg-blue-100 dark:bg-blue-900 font-semibold' : ''}
                              ${!isSelected && !isToday ? `${textPrimary} hover:bg-gray-100 dark:hover:bg-gray-700` : ''}
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
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Today
              </button>
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
                  
                  {/* 5-day forecast */}
                  {weather.forecast && weather.forecast.length > 0 && (
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

              <div className="flex items-center gap-3 ml-auto">
                <div className="flex flex-col gap-1 items-start">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => !isSyncing && (syncUrl ? syncWithCalendar() : setShowSyncSettings(true))}
                      disabled={isSyncing}
                      className={`px-3 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg} flex items-center gap-2 ${isSyncing ? 'opacity-70 cursor-not-allowed' : ''}`}
                      title={isSyncing ? "Syncing..." : (syncUrl ? "Sync now" : "Configure calendar sync")}
                    >
                      <RefreshCw size={18} className={`${textSecondary} ${isSyncing ? 'animate-spin' : ''}`} />
                      <span className={`text-sm ${textPrimary}`}>{isSyncing ? 'Syncing...' : 'Sync'}</span>
                    </button>
                    {syncUrl && (
                      <button
                        onClick={() => setShowSyncSettings(!showSyncSettings)}
                        className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg}`}
                        title="Sync settings"
                      >
                        <Calendar size={18} className={textSecondary} />
                      </button>
                    )}
                  </div>
                  <label className={`cursor-pointer px-3 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg} flex items-center gap-2 whitespace-nowrap`}>
                    <Upload size={18} className={textSecondary} />
                    <span className={`text-sm ${textPrimary}`}>Import iCal</span>
                    <input type="file" accept=".ics" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
                <button
                  onClick={() => setDarkMode(!darkMode)}
                  className={`p-2 rounded-lg ${hoverBg}`}
                >
                  {darkMode ? <Sun size={20} className={textSecondary} /> : <Moon size={20} className={textSecondary} />}
                </button>
              </div>
              
              {/* TODO: Re-enable stocks and news later */}
              {/* Stock widgets */}
              {/* stocks && (
                <div className={`flex items-center gap-2`}>
                  {stocks.map((stock, index) => (
                    <div key={index} className={`px-3 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg`}>
                      <div className={`text-xs font-semibold ${textPrimary}`}>{stock.symbol}</div>
                      <div className={`text-sm font-bold ${textPrimary}`}>${stock.price}</div>
                      <div className={`text-xs ${stock.isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {stock.isPositive ? '▲' : '▼'} {stock.changePercent}%
                      </div>
                    </div>
                  ))}
                </div>
              ) */}
            </div>
            
            {/* News headlines row */}
            {/* news && (
              <div className={`flex items-center gap-2 mt-2`}>
                <div className="flex gap-2 overflow-x-auto flex-1">
                  {news.map((item, index) => (
                    <div
                      key={index}
                      className={`px-3 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg whitespace-nowrap`}
                    >
                      <span className={`text-xs ${textPrimary}`}>{item.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) */}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {showSyncSettings && (
          <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-6`}>
            <h3 className={`font-semibold ${textPrimary} mb-4`}>Calendar Sync Settings</h3>
            <div className="space-y-3">
              <div>
                <label className={`block text-sm ${textSecondary} mb-2`}>
                  Calendar URL (iCal/CalDAV)
                </label>
                <input
                  type="url"
                  placeholder="https://nextcloud.example.com/remote.php/dav/calendars/user/calendar-name/?export"
                  value={syncUrl}
                  onChange={(e) => setSyncUrl(e.target.value)}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                />
                <p className={`text-xs ${textSecondary} mt-2`}>
                  For Nextcloud: Go to Calendar → Settings → Copy the public link for your calendar
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={syncWithCalendar}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                >
                  <RefreshCw size={16} />
                  Sync Now
                </button>
                <button
                  onClick={() => setShowSyncSettings(false)}
                  className={`px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} rounded-lg ${hoverBg}`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-3">
            <div className={`flex gap-2 mb-4`}>
              <button
                onClick={openNewTaskForm}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                title="New Scheduled Task"
              >
                <svg width="20" height="20" viewBox="0 0 26 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {/* Calendar body - moved further left */}
                  <rect x="1" y="5" width="16" height="16" rx="2" ry="2"/>
                  <line x1="13" y1="3" x2="13" y2="7"/>
                  <line x1="5" y1="3" x2="5" y2="7"/>
                  <line x1="1" y1="10" x2="17" y2="10"/>
                  {/* Plus sign - stays where it is */}
                  <line x1="21" y1="1" x2="21" y2="6" stroke="white" strokeWidth="2.5"/>
                  <line x1="18.5" y1="3.5" x2="23.5" y2="3.5" stroke="white" strokeWidth="2.5"/>
                </svg>
                <span className="font-medium">Schedule</span>
              </button>
              <button
                onClick={openNewInboxTask}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                title="Add to Inbox"
              >
                <svg width="20" height="20" viewBox="0 0 26 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {/* Inbox body - moved left, not truncated */}
                  <path d="M3.45 6.11L0 13v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 12.76 5H4.24a2 2 0 0 0-1.79 1.11z"/>
                  <polyline points="18 13 13 13 11 16 7 16 5 13 0 13"/>
                  {/* Plus sign - positioned to fit in viewBox */}
                  <line x1="21" y1="1" x2="21" y2="6" stroke="white" strokeWidth="2.5"/>
                  <line x1="18.5" y1="3.5" x2="23.5" y2="3.5" stroke="white" strokeWidth="2.5"/>
                </svg>
                <span className="font-medium">Inbox</span>
              </button>
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-4`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Inbox size={18} />
                  Inbox
                </h3>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${textSecondary}`}>{unscheduledTasks.length}</span>
                  <button
                    onClick={() => toggleSection('inbox')}
                    className={`${textSecondary} hover:${textPrimary} transition-colors`}
                    title={minimizedSections.inbox ? "Expand" : "Minimize"}
                  >
                    {minimizedSections.inbox ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>
              
              {!minimizedSections.inbox && (
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDropOnInbox}
                  className={`space-y-2 ${filteredUnscheduledTasks.length === 0 ? 'min-h-[100px] flex items-center justify-center' : ''}`}
                >
                  {filteredUnscheduledTasks.length === 0 ? (
                    <p className={`text-sm ${textSecondary} text-center`}>
                      {unscheduledTasks.length === 0
                        ? "Drag tasks here to unschedule them"
                        : "No tasks match selected tags"}
                    </p>
                  ) : (
                    filteredUnscheduledTasks.map(task => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleDragStart(task, 'inbox', e)}
                      className={`${task.color} rounded-lg p-3 cursor-move shadow-sm ${task.completed ? 'opacity-50' : ''} relative`}
                    >
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
                              <input
                                type="text"
                                value={editingTaskText}
                                onChange={(e) => setEditingTaskText(e.target.value)}
                                onKeyDown={(e) => handleEditKeyDown(e, true)}
                                onBlur={() => saveTaskTitle(true)}
                                autoFocus
                                className="w-full bg-white/20 text-white font-medium text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                onClick={(e) => e.stopPropagation()}
                              />
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
                            <div className="text-xs opacity-90 mt-1">{task.duration} min</div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <div className="flex items-start gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowColorPicker(showColorPicker === task.id ? null : task.id);
                              }}
                              className="hover:bg-white/20 rounded p-1 transition-colors relative"
                            >
                              <Palette size={14} />
                              {showColorPicker === task.id && (
                                <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-20 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[120px]">
                                  <div className="grid grid-cols-3 gap-1">
                                    {colors.map((color) => (
                                      <button
                                        key={color.class}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          changeTaskColor(task.id, color.class, true);
                                        }}
                                        className={`${color.class} w-8 h-8 rounded-full hover:scale-110 transition-transform ${task.color === color.class ? 'ring-2 ring-offset-2 ring-white' : ''}`}
                                        title={color.name}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </button>
                            <button
                              onClick={() => moveToRecycleBin(task.id, true)}
                              className="hover:bg-white/20 rounded p-1"
                              title="Move to Recycle Bin"
                            >
                              <Trash2 size={14} />
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
                    </div>
                  ))
                )}
                </div>
              )}
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Hash size={18} />
                  Tags
                </h3>
                <div className="flex items-center gap-2">
                  {selectedTags.length > 0 && (
                    <button
                      onClick={clearTagFilter}
                      className={`text-xs ${textSecondary} hover:${textPrimary} transition-colors`}
                    >
                      Clear
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
              {!minimizedSections.tags && (
                <div className={`text-sm ${textSecondary}`}>
                  {allTags.length === 0 ? (
                    <p className="text-center py-2">Add #tags to task titles</p>
                  ) : (
                    <div className="space-y-1">
                      {allTags.map(tag => (
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
                          <span>{tag}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <div className="flex items-center justify-between mb-2">
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
                    <div>{todayNonImportedTasks.length} tasks scheduled</div>
                  <div>{todayNonImportedTasks.reduce((sum, task) => sum + task.duration, 0)} minutes planned</div>
                  <div>{unscheduledTasks.length} tasks in inbox</div>
                </div>
              )}
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <div className="flex items-center justify-between mb-3">
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
                  <div>{nonImportedTasks.length} total tasks</div>
                  <div>{allCompletedTasks.length} completed</div>
                  <div>{Math.floor(totalCompletedMinutes / 60)}h {totalCompletedMinutes % 60}m time spent</div>
                  <div>{Math.floor(totalScheduledMinutes / 60)}h {totalScheduledMinutes % 60}m total planned</div>
                  {nonImportedTasks.length > 0 && (
                    <div className="pt-1">
                      <div className="font-semibold">{Math.round((allCompletedTasks.length / nonImportedTasks.length) * 100)}% completion rate</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Trash2 size={18} />
                  Recycle Bin
                </h3>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${textSecondary}`}>{recycleBin.length}</span>
                  <button
                    onClick={() => toggleSection('recycleBin')}
                    className={`${textSecondary} hover:${textPrimary} transition-colors`}
                    title={minimizedSections.recycleBin ? "Expand" : "Minimize"}
                  >
                    {minimizedSections.recycleBin ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>
              
              {!minimizedSections.recycleBin && (
                <>
                  <div
                    onDragOver={handleDragOver}
                    onDrop={handleDropOnRecycleBin}
                    className={`space-y-2 mb-3 ${recycleBin.length === 0 ? 'min-h-[100px] flex items-center justify-center' : ''}`}
                  >
                    {recycleBin.length === 0 ? (
                      <p className={`text-sm ${textSecondary} text-center`}>Drag tasks here to delete them</p>
                    ) : (
                      recycleBin.map(task => (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={(e) => handleDragStart(task, 'recycleBin', e)}
                          className={`${task.color} rounded-lg p-3 shadow-sm opacity-50 relative cursor-move`}
                        >
                          <div className="flex items-start justify-between text-white">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">{renderTitle(task.title)}</div>
                                <div className="text-xs opacity-75 mt-1">
                                  {task._deletedFrom === 'inbox' ? (
                                    <>Inbox • {task.duration}min</>
                                  ) : task.startTime ? (
                                    <>{task.startTime} • {task.duration}min</>
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
                      className={`w-full px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium`}
                    >
                      Empty Recycle Bin
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="col-span-9">
            {showAddTask && (
              <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-6`}>
                <h3 className={`font-semibold ${textPrimary} mb-4`}>New Task</h3>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Task title"
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                  />
                  <div className="grid grid-cols-6 gap-3">
                    {!newTask.openInInbox && (
                      <>
                        <div>
                          <label className={`block text-sm ${textSecondary} mb-1`}>Date</label>
                          <button
                            onClick={() => setShowDatePicker(true)}
                            className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                          >
                            {newTask.date ? new Date(newTask.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Select'}
                          </button>
                        </div>
                        <div>
                          <label className={`block text-sm ${textSecondary} mb-1`}>Time</label>
                          <button
                            onClick={() => !newTask.isAllDay && setShowTimePicker(true)}
                            disabled={newTask.isAllDay}
                            className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.isAllDay ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            {newTask.isAllDay ? 'All Day' : newTask.startTime}
                          </button>
                        </div>
                      </>
                    )}
                    <div className={newTask.openInInbox ? 'col-span-3' : ''}>
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
                    <div className={newTask.openInInbox ? 'col-span-3' : ''}>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Color</label>
                      <div className="relative">
                        <button
                          onClick={() => setShowColorPicker('newTask')}
                          className={`w-full h-10 ${newTask.color || colors[0].class} rounded-lg border ${borderClass}`}
                        />
                        {showColorPicker === 'newTask' && (
                          <div className={`absolute top-12 left-0 ${cardBg} rounded-lg p-2 shadow-xl z-20 border ${borderClass} min-w-[120px]`}>
                            <div className="grid grid-cols-3 gap-1">
                              {colors.map((color) => (
                                <button
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
                    {!newTask.openInInbox && (
                      <div className="col-span-2">
                        <label className={`block text-sm ${textSecondary} mb-1`}>All Day Event</label>
                        <label className="flex items-center h-10 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newTask.isAllDay}
                            onChange={(e) => setNewTask({ ...newTask, isAllDay: e.target.checked })}
                            className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                          />
                          <span className={`ml-2 text-sm ${textPrimary}`}>Full day reminder</span>
                        </label>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => addTask(newTask.openInInbox || false)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      {newTask.openInInbox ? 'Add to Inbox' : 'Add to Schedule'}
                    </button>
                    {!newTask.openInInbox && (
                      <button
                        onClick={() => addTask(true)}
                        className={`px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} rounded-lg ${hoverBg}`}
                      >
                        Add to Inbox
                      </button>
                    )}
                    <button
                      onClick={() => setShowAddTask(false)}
                      className={`px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} rounded-lg ${hoverBg}`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} overflow-hidden`}>
              {/* FIX 3: All-day tasks section at the top */}
              {filteredTodayTasks.filter(t => t.isAllDay).length > 0 && (
                <div className={`border-b ${borderClass} p-2 ${cardBg}`}>
                  <div className={`text-xs font-semibold ${textSecondary} mb-2 px-2`}>ALL DAY</div>
                  <div className="space-y-2">
                    {filteredTodayTasks.filter(t => t.isAllDay).map((task) => {
                      const isImported = task.imported;
                      return (
                        <div
                          key={task.id}
                          draggable={!isImported}
                          onDragStart={(e) => !isImported && handleDragStart(task, 'calendar', e)}
                          className={`${task.color} rounded-lg shadow-sm ${isImported ? 'cursor-default' : 'cursor-move'} ${task.completed ? 'opacity-50' : ''} relative`}
                        >
                          <div className="p-2 text-white">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                {!isImported && (
                                  <button
                                    onClick={() => toggleComplete(task.id)}
                                    className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                  >
                                    {task.completed && <Check size={10} strokeWidth={3} />}
                                  </button>
                                )}
                                <Calendar size={14} className="flex-shrink-0" />
                                {editingTaskId === task.id ? (
                                  <input
                                    type="text"
                                    value={editingTaskText}
                                    onChange={(e) => setEditingTaskText(e.target.value)}
                                    onKeyDown={(e) => handleEditKeyDown(e, false)}
                                    onBlur={() => saveTaskTitle(false)}
                                    autoFocus
                                    className="flex-1 bg-white/20 text-white font-semibold text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  <div
                                    className={`font-semibold text-sm truncate ${task.completed ? 'line-through' : ''} ${!isImported ? 'cursor-text' : ''}`}
                                    onDoubleClick={(e) => {
                                      if (!isImported) {
                                        e.stopPropagation();
                                        startEditingTask(task, false);
                                      }
                                    }}
                                    title={!isImported ? "Double-click to edit" : undefined}
                                  >
                                    {renderTitle(task.title)}
                                  </div>
                                )}
                              </div>
                              {!isImported && (
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <button
                                    onClick={() => postponeTask(task.id)}
                                    className="hover:bg-white/20 rounded p-1 transition-colors"
                                    title="Postpone to tomorrow"
                                  >
                                    <SkipForward size={14} />
                                  </button>
                                  <button
                                    onClick={() => moveToInbox(task.id)}
                                    className="hover:bg-white/20 rounded p-1 transition-colors"
                                    title="Move to Inbox"
                                  >
                                    <Inbox size={14} />
                                  </button>
                                  <button
                                    onClick={() => setShowColorPicker(showColorPicker === task.id ? null : task.id)}
                                    className="hover:bg-white/20 rounded p-1 transition-colors relative"
                                  >
                                    <Palette size={14} />
                                    {showColorPicker === task.id && (
                                      <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-20 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[120px]">
                                        <div className="grid grid-cols-3 gap-1">
                                          {colors.map((color) => (
                                            <button
                                              key={color.class}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                changeTaskColor(task.id, color.class, false);
                                              }}
                                              className={`${color.class} w-8 h-8 rounded-full hover:scale-110 transition-transform ${task.color === color.class ? 'ring-2 ring-offset-2 ring-white' : ''}`}
                                              title={color.name}
                                            />
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </button>
                                  <button
                                    onClick={() => moveToRecycleBin(task.id)}
                                    className="hover:bg-white/20 rounded p-1 transition-colors"
                                    title="Move to Recycle Bin"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div
                ref={calendarRef}
                onDragOver={handleDragOver}
                onDrop={handleDropOnCalendar}
                onClick={openNewTaskAtTime}
                className={`relative overflow-y-auto ${darkMode ? 'dark-scrollbar' : ''}`}
                style={{ height: '1120px' }}
              >
                {hours.map((hour, index) => (
                  <div key={hour} className="relative">
                    {/* Main hour row with solid border */}
                    <div className={`flex border-b ${index === 0 ? `border-t` : ''} ${borderClass}`}>
                      <div className={`w-20 flex-shrink-0 px-3 text-sm ${textSecondary} border-r ${borderClass} flex items-center`}>
                        {hour.toString().padStart(2, '0')}:00
                      </div>
                      <div className="flex-1 relative h-40 calendar-slot"></div>
                    </div>
                    {/* Half-hour dashed line (no label) */}
                    <div className="absolute left-0 right-0 pointer-events-none" style={{ top: '80px' }}>
                      <div className={`flex border-b border-dashed ${borderClass} opacity-50`}>
                        <div className="w-20 flex-shrink-0"></div>
                        <div className="flex-1"></div>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="absolute top-0 left-20 right-0 bottom-0 pointer-events-none">
                  {showCurrentTimeLine && (
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

                  {filteredTodayTasks.filter(t => !t.isAllDay).map((task) => {
                    const { top, height } = calculateTaskPosition(task);
                    const isConflicted = conflicts.some(c => c.includes(task.id));
                    const conflictPos = calculateConflictPosition(task, filteredTodayTasks.filter(t => !t.isAllDay));
                    const isVeryShort = height < 20;
                    const isImported = task.imported;

                    return (
                      <div
                        key={task.id}
                        draggable={!isImported}
                        onDragStart={(e) => !isImported && handleDragStart(task, 'calendar', e)}
                        className={`absolute ${task.color} rounded-lg shadow-md pointer-events-auto ${isImported ? 'cursor-default' : 'cursor-move'} ${isConflicted ? 'ring-4 ring-red-500' : ''} ${task.completed ? 'opacity-50' : ''} overflow-visible`}
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          minHeight: '40px',
                          left: conflictPos.left,
                          right: conflictPos.right,
                          width: conflictPos.width
                        }}
                      >
                        <div className={`p-2 h-full flex flex-col text-white ${isVeryShort ? 'justify-center' : 'justify-between'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              {!isImported && (
                                <button
                                  onClick={() => toggleComplete(task.id)}
                                  className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                >
                                  {task.completed && <Check size={10} strokeWidth={3} />}
                                </button>
                              )}
                              <div className="flex-1 min-w-0">
                                {editingTaskId === task.id ? (
                                  <input
                                    type="text"
                                    value={editingTaskText}
                                    onChange={(e) => setEditingTaskText(e.target.value)}
                                    onKeyDown={(e) => handleEditKeyDown(e, false)}
                                    onBlur={() => saveTaskTitle(false)}
                                    autoFocus
                                    className="w-full bg-white/20 text-white font-semibold text-base px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  <div
                                    className={`font-semibold text-base leading-tight ${task.completed ? 'line-through' : ''} ${!isImported ? 'cursor-text' : ''}`}
                                    onDoubleClick={(e) => {
                                      if (!isImported) {
                                        e.stopPropagation();
                                        startEditingTask(task, false);
                                      }
                                    }}
                                    title={!isImported ? "Double-click to edit" : undefined}
                                  >
                                    {renderTitle(task.title)}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-start gap-1 flex-shrink-0">
                              <div className="text-xs opacity-90 whitespace-nowrap mr-1 mt-0.5 flex items-center gap-1">
                                <Clock size={12} />
                                {task.startTime} • {task.duration}min
                              </div>
                              {!isImported && (
                                <>
                                  <button
                                    onClick={() => postponeTask(task.id)}
                                    className="hover:bg-white/20 rounded p-1 transition-colors"
                                    title="Postpone to tomorrow"
                                  >
                                    <SkipForward size={14} />
                                  </button>
                                  <button
                                    onClick={() => moveToInbox(task.id)}
                                    className="hover:bg-white/20 rounded p-1 transition-colors"
                                    title="Move to Inbox"
                                  >
                                    <Inbox size={14} />
                                  </button>
                                  <button
                                    onClick={() => setShowColorPicker(showColorPicker === task.id ? null : task.id)}
                                    className="hover:bg-white/20 rounded p-1 transition-colors relative"
                                  >
                                    <Palette size={14} />
                                    {showColorPicker === task.id && (
                                      <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-20 shadow-xl border border-gray-200 dark:border-gray-700 min-w-[120px]">
                                        <div className="grid grid-cols-3 gap-1">
                                          {colors.map((color) => (
                                            <button
                                              key={color.class}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                changeTaskColor(task.id, color.class, false);
                                              }}
                                              className={`${color.class} w-8 h-8 rounded-full hover:scale-110 transition-transform ${task.color === color.class ? 'ring-2 ring-offset-2 ring-white' : ''}`}
                                              title={color.name}
                                            />
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </button>
                                  <button
                                    onClick={() => moveToRecycleBin(task.id)}
                                    className="hover:bg-white/20 rounded p-1 transition-colors"
                                    title="Move to Recycle Bin"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          {/* Resize handle at bottom - solid white for visibility */}
                          {!isVeryShort && !isImported && (
                            <div
                              onMouseDown={(e) => handleResizeStart(task, e)}
                              className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize hover:bg-white/20 flex items-center justify-center"
                              style={{ marginBottom: '-4px' }}
                            >
                              <div className="w-8 h-1 bg-white rounded-full"></div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  
                  {/* Drag preview - more visible with time display */}
                  {dragPreviewTime && draggedTask && (
                    <>
                      {/* Time label above the box */}
                      <div 
                        className="absolute left-2 bg-blue-600 text-white px-2 py-1 rounded text-sm font-bold pointer-events-none z-20 shadow-lg"
                        style={{
                          top: `${(Math.floor(timeToMinutes(dragPreviewTime) / 60) * 161) + (timeToMinutes(dragPreviewTime) % 60 * 160 / 60) - 30}px`
                        }}
                      >
                        {dragPreviewTime}
                      </div>
                      {/* Preview box */}
                      <div 
                        className="absolute left-2 right-2 bg-blue-500/50 border-2 border-blue-500 rounded-lg flex items-center justify-center text-white font-bold text-lg pointer-events-none z-5"
                        style={{
                          top: `${(Math.floor(timeToMinutes(dragPreviewTime) / 60) * 161) + (timeToMinutes(dragPreviewTime) % 60 * 160 / 60)}px`,
                          height: `${draggedTask.duration * 160 / 60}px`,
                          minHeight: '40px'
                        }}
                      >
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

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

      {showEmptyBinConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowEmptyBinConfirm(false)}>
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
                onClick={() => setShowEmptyBinConfirm(false)}
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
                {syncNotification.type === 'success' ? 'Sync Complete' :
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
    </div>
  );
};

export default DayPlanner;