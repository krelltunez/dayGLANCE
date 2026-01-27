import React, { useState, useEffect, useRef } from 'react';
import { Plus, Clock, X, GripVertical, ChevronLeft, ChevronRight, Moon, Sun, Upload, Inbox, AlertCircle, Calendar, Check, RefreshCw, Palette, CalendarPlus } from 'lucide-react';

const DayPlanner = () => {
  const [darkMode, setDarkMode] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [tasks, setTasks] = useState([]);
  const [unscheduledTasks, setUnscheduledTasks] = useState([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', startTime: '09:00', duration: 60 });
  const [draggedTask, setDraggedTask] = useState(null);
  const [dragSource, setDragSource] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [showSyncSettings, setShowSyncSettings] = useState(false);
  const [syncUrl, setSyncUrl] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [weather, setWeather] = useState(null);
  const [dragPreviewTime, setDragPreviewTime] = useState(null);
  const calendarRef = useRef(null);
  const currentTimeRef = useRef(null);

  const hours = Array.from({ length: 17 }, (_, i) => i + 7);
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

  useEffect(() => {
    loadData();
    fetchWeather(); // FIX 1: Call fetchWeather on mount
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const isToday = dateToString(selectedDate) === dateToString(new Date());
    if (isToday && currentTimeRef.current) {
      setTimeout(() => {
        currentTimeRef.current.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }, 100);
    }
  }, [selectedDate]);

  useEffect(() => {
    saveData();
    checkConflicts();
  }, [tasks, unscheduledTasks]);

  const loadData = () => {
    try {
      const tasksData = localStorage.getItem('day-planner-tasks');
      const unscheduledData = localStorage.getItem('day-planner-unscheduled');
      const darkModeData = localStorage.getItem('day-planner-darkmode');
      const syncUrlData = localStorage.getItem('day-planner-sync-url');
      
      if (tasksData) {
        setTasks(JSON.parse(tasksData));
      }
      if (unscheduledData) {
        setUnscheduledTasks(JSON.parse(unscheduledData));
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
      // Denver coordinates: 39.7392, -104.9903
      const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=39.7392&longitude=-104.9903&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America%2FDenver&forecast_days=1');
      const data = await response.json();
      
      if (data.current && data.daily) {
        setWeather({
          temp: Math.round(data.current.temperature_2m),
          condition: getWeatherCondition(data.current.weather_code),
          icon: getWeatherIcon(data.current.weather_code),
          high: Math.round(data.daily.temperature_2m_max[0]),
          low: Math.round(data.daily.temperature_2m_min[0])
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
        low: '--'
      });
    }
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
    if (code === 0) return '☀️';
    if ([1, 2].includes(code)) return '⛅';
    if (code === 3) return '☁️';
    if ([45, 48].includes(code)) return '🌫️';
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return '🌧️';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️';
    if ([95, 96, 99].includes(code)) return '⛈️';
    return '☁️';
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
    return date.toISOString().split('T')[0];
  };

  const addTask = () => {
    if (!newTask.title.trim()) return;
    
    const task = {
      id: Date.now(),
      title: newTask.title,
      startTime: newTask.startTime,
      duration: newTask.duration,
      date: newTask.date || dateToString(selectedDate),
      color: 'bg-blue-500',
      completed: false,
      allDay: newTask.allDay || false
    };

    setTasks([...tasks, task]);
    setNewTask({ title: '', startTime: getNextQuarterHour(), duration: 60 });
    setShowAddTask(false);
  };

  const addUnscheduledTask = (title) => {
    if (!title.trim()) return;
    
    const task = {
      id: Date.now(),
      title: title,
      color: 'bg-blue-500',
      completed: false
    };

    setUnscheduledTasks([...unscheduledTasks, task]);
  };

  const deleteTask = (taskId) => {
    setTasks(tasks.filter(task => task.id !== taskId));
    setUnscheduledTasks(unscheduledTasks.filter(task => task.id !== taskId));
  };

  const toggleComplete = (taskId) => {
    setTasks(tasks.map(task => 
      task.id === taskId ? { ...task, completed: !task.completed } : task
    ));
    setUnscheduledTasks(unscheduledTasks.map(task => 
      task.id === taskId ? { ...task, completed: !task.completed } : task
    ));
  };

  const changeTaskColor = (taskId, color, isUnscheduled) => {
    if (isUnscheduled) {
      setUnscheduledTasks(unscheduledTasks.map(task =>
        task.id === taskId ? { ...task, color } : task
      ));
    } else {
      setTasks(tasks.map(task =>
        task.id === taskId ? { ...task, color } : task
      ));
    }
    setShowColorPicker(null);
  };

  const handleDragStart = (task, source, e) => {
    setDraggedTask(task);
    setDragSource(source);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    
    if (!draggedTask || !calendarRef.current) return;
    
    const rect = calendarRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top + calendarRef.current.scrollTop;
    const minutesFromTop = Math.floor((y / 80) * 60);
    const totalMinutes = 7 * 60 + minutesFromTop;
    const roundedMinutes = Math.round(totalMinutes / 15) * 15;
    const newTime = minutesToTime(roundedMinutes);
    
    setDragPreviewTime(newTime);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    
    if (!draggedTask || !calendarRef.current) return;
    
    const rect = calendarRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top + calendarRef.current.scrollTop;
    const minutesFromTop = Math.floor((y / 80) * 60);
    const totalMinutes = 7 * 60 + minutesFromTop;
    const roundedMinutes = Math.round(totalMinutes / 15) * 15;
    const newTime = minutesToTime(roundedMinutes);
    
    if (dragSource === 'unscheduled') {
      setUnscheduledTasks(unscheduledTasks.filter(task => task.id !== draggedTask.id));
      setTasks([...tasks, {
        ...draggedTask,
        startTime: newTime,
        duration: 60,
        date: dateToString(selectedDate)
      }]);
    } else {
      setTasks(tasks.map(task =>
        task.id === draggedTask.id
          ? { ...task, startTime: newTime, date: dateToString(selectedDate), allDay: false }
          : task
      ));
    }
    
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
  };

  const handleResizeStart = (task, e) => {
    e.stopPropagation();
    e.preventDefault();
    
    const startY = e.clientY;
    const startDuration = task.duration;
    
    const handleMouseMove = (e) => {
      const deltaY = e.clientY - startY;
      const deltaMinutes = Math.round((deltaY / 80) * 60 / 15) * 15;
      const newDuration = Math.max(15, startDuration + deltaMinutes);
      
      setTasks(tasks.map(t =>
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

  const checkConflicts = () => {
    const newConflicts = [];
    const scheduledTasks = tasks.filter(task => !task.allDay);
    
    for (let i = 0; i < scheduledTasks.length; i++) {
      for (let j = i + 1; j < scheduledTasks.length; j++) {
        const task1 = scheduledTasks[i];
        const task2 = scheduledTasks[j];
        
        if (task1.date === task2.date) {
          const start1 = timeToMinutes(task1.startTime);
          const end1 = start1 + task1.duration;
          const start2 = timeToMinutes(task2.startTime);
          const end2 = start2 + task2.duration;
          
          if ((start1 < end2 && end1 > start2)) {
            if (!newConflicts.some(c => c.includes(task1.id))) {
              newConflicts.push([task1.id, task2.id]);
            }
          }
        }
      }
    }
    
    setConflicts(newConflicts);
  };

  const getConflictPosition = (task) => {
    const conflictGroup = conflicts.find(c => c.includes(task.id));
    if (!conflictGroup) return { left: '2px', right: '2px', width: 'auto' };
    
    const index = conflictGroup.indexOf(task.id);
    const total = conflictGroup.length;
    const widthPercent = 100 / total;
    
    return {
      left: `${index * widthPercent}%`,
      width: `${widthPercent}%`,
      right: 'auto'
    };
  };

  const changeDate = (days) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + days);
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  const uploadFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.tasks) setTasks(data.tasks);
        if (data.unscheduledTasks) setUnscheduledTasks(data.unscheduledTasks);
      } catch (error) {
        alert('Invalid file format');
      }
    };
    reader.readAsText(file);
  };

  const downloadData = () => {
    const data = {
      tasks,
      unscheduledTasks,
      exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `day-planner-${dateToString(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const syncWithUrl = async () => {
    if (!syncUrl) return;
    
    try {
      const response = await fetch(syncUrl);
      const data = await response.json();
      
      if (data.tasks) setTasks(data.tasks);
      if (data.unscheduledTasks) setUnscheduledTasks(data.unscheduledTasks);
      
      alert('Sync successful!');
    } catch (error) {
      alert('Sync failed. Please check the URL.');
    }
  };

  const formatDate = (date) => {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  };

  const isToday = dateToString(selectedDate) === dateToString(new Date());
  const todayTasks = tasks.filter(task => task.date === dateToString(selectedDate));
  const allDayTasks = todayTasks.filter(task => task.allDay);
  const scheduledTasks = todayTasks.filter(task => !task.allDay);

  // FIX 2: Add DatePicker component
  const DatePicker = ({ value, onChange, onClose }) => {
    const [selectedMonth, setSelectedMonth] = useState(new Date(selectedDate));
    
    const getDaysInMonth = (date) => {
      const year = date.getFullYear();
      const month = date.getMonth();
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
    
    const days = getDaysInMonth(selectedMonth);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
        <div className={`${darkMode ? 'bg-gray-800 text-white' : 'bg-white'} rounded-lg p-6 shadow-xl max-w-sm w-full mx-4`} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1))}
              className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
            >
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-lg font-bold">
              {monthNames[selectedMonth.getMonth()]} {selectedMonth.getFullYear()}
            </h3>
            <button
              onClick={() => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1))}
              className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
            >
              <ChevronRight size={20} />
            </button>
          </div>
          
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
              <div key={day} className="text-center text-sm font-semibold p-2">
                {day}
              </div>
            ))}
          </div>
          
          <div className="grid grid-cols-7 gap-1">
            {days.map((day, index) => (
              <button
                key={index}
                onClick={() => {
                  if (day) {
                    onChange(dateToString(day));
                    onClose();
                  }
                }}
                disabled={!day}
                className={`p-2 text-center rounded-lg ${
                  !day ? 'invisible' :
                  dateToString(day) === dateToString(selectedDate) ? 'bg-blue-500 text-white font-bold' :
                  dateToString(day) === dateToString(new Date()) ? 'bg-blue-100 dark:bg-blue-900 font-semibold' :
                  darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                }`}
              >
                {day ? day.getDate() : ''}
              </button>
            ))}
          </div>
          
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {
                onChange(dateToString(new Date()));
                onClose();
              }}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              Today
            </button>
            <button
              onClick={onClose}
              className={`flex-1 px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  const ClockTimePicker = ({ value, onChange, onClose }) => {
    const [hours, setHours] = useState(parseInt(value.split(':')[0]));
    const [minutes, setMinutes] = useState(parseInt(value.split(':')[1]));
    const [isPM, setIsPM] = useState(parseInt(value.split(':')[0]) >= 12);

    const handleConfirm = () => {
      let hour24 = isPM ? (hours === 12 ? 12 : hours + 12) : (hours === 12 ? 0 : hours);
      const timeString = `${hour24.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      onChange(timeString);
      onClose();
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
        <div className={`${darkMode ? 'bg-gray-800 text-white' : 'bg-white'} rounded-lg p-6 shadow-xl`} onClick={(e) => e.stopPropagation()}>
          <h3 className="text-lg font-bold mb-4">Select Time</h3>
          
          <div className="flex items-center gap-4 mb-6">
            <div className="flex flex-col items-center">
              <button
                onClick={() => setHours(h => h === 12 ? 1 : h + 1)}
                className={`p-2 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                <ChevronLeft className="rotate-90" size={20} />
              </button>
              <div className="text-4xl font-bold w-20 text-center">
                {hours.toString().padStart(2, '0')}
              </div>
              <button
                onClick={() => setHours(h => h === 1 ? 12 : h - 1)}
                className={`p-2 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                <ChevronLeft className="-rotate-90" size={20} />
              </button>
            </div>
            
            <div className="text-4xl font-bold">:</div>
            
            <div className="flex flex-col items-center">
              <button
                onClick={() => setMinutes(m => (m + 15) % 60)}
                className={`p-2 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                <ChevronLeft className="rotate-90" size={20} />
              </button>
              <div className="text-4xl font-bold w-20 text-center">
                {minutes.toString().padStart(2, '0')}
              </div>
              <button
                onClick={() => setMinutes(m => m === 0 ? 45 : m - 15)}
                className={`p-2 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                <ChevronLeft className="-rotate-90" size={20} />
              </button>
            </div>
            
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setIsPM(false)}
                className={`px-4 py-2 rounded ${!isPM ? 'bg-blue-500 text-white' : darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}
              >
                AM
              </button>
              <button
                onClick={() => setIsPM(true)}
                className={`px-4 py-2 rounded ${isPM ? 'bg-blue-500 text-white' : darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}
              >
                PM
              </button>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              Confirm
            </button>
            <button
              onClick={onClose}
              className={`flex-1 px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} shadow-sm border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold">Day Planner</h1>
              <button
                onClick={goToToday}
                className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Today
              </button>
            </div>
            
            <div className="flex items-center gap-2">
              {weather && (
                <div className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-100'} flex items-center gap-3`}>
                  <div className="text-2xl">{weather.icon}</div>
                  <div>
                    <div className="font-bold text-lg">{weather.temp}°F</div>
                    <div className="text-xs opacity-75">{weather.condition}</div>
                    <div className="text-xs opacity-75">H: {weather.high}° L: {weather.low}°</div>
                  </div>
                  <button
                    onClick={fetchWeather}
                    className={`p-1 rounded ${darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-200'}`}
                    title="Refresh weather"
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
              )}
              
              <button
                onClick={() => setShowSyncSettings(!showSyncSettings)}
                className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                <Upload size={20} />
              </button>
              
              <button
                onClick={() => setDarkMode(!darkMode)}
                className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                {darkMode ? <Sun size={20} /> : <Moon size={20} />}
              </button>
            </div>
          </div>

          {showSyncSettings && (
            <div className={`p-4 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-100'} space-y-3`}>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={syncUrl}
                  onChange={(e) => setSyncUrl(e.target.value)}
                  placeholder="Enter sync URL (JSON endpoint)"
                  className={`flex-1 px-3 py-2 rounded ${darkMode ? 'bg-gray-600 text-white' : 'bg-white'} border ${darkMode ? 'border-gray-500' : 'border-gray-300'}`}
                />
                <button
                  onClick={syncWithUrl}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Sync
                </button>
              </div>
              
              <div className="flex gap-2">
                <label className="flex-1 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 cursor-pointer text-center">
                  Import File
                  <input type="file" accept=".json" onChange={uploadFile} className="hidden" />
                </label>
                <button
                  onClick={downloadData}
                  className="flex-1 px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
                >
                  Export Data
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => changeDate(-1)}
                className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                <ChevronLeft size={20} />
              </button>
              
              <div className="text-center">
                <div className="text-xl font-semibold">{formatDate(selectedDate)}</div>
                {isToday && <div className="text-sm text-blue-500">Today</div>}
              </div>
              
              <button
                onClick={() => changeDate(1)}
                className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                <ChevronRight size={20} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {conflicts.length > 0 && (
                <div className="flex items-center gap-2 text-orange-500 bg-orange-500/10 px-3 py-1 rounded">
                  <AlertCircle size={16} />
                  <span className="text-sm">{conflicts.length} conflict{conflicts.length > 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-4">
            {/* Add Task Button */}
            <button
              onClick={() => setShowAddTask(!showAddTask)}
              className="w-full px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center justify-center gap-2 font-semibold"
            >
              <Plus size={20} />
              Add Task
            </button>

            {/* Add Task Form */}
            {showAddTask && (
              <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg p-4 shadow-md space-y-3`}>
                <input
                  type="text"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  placeholder="Task title"
                  className={`w-full px-3 py-2 rounded ${darkMode ? 'bg-gray-700 text-white' : 'bg-gray-50'} border ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}
                  onKeyPress={(e) => e.key === 'Enter' && addTask()}
                />

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="allDay"
                    checked={newTask.allDay || false}
                    onChange={(e) => setNewTask({ ...newTask, allDay: e.target.checked })}
                    className="rounded"
                  />
                  <label htmlFor="allDay" className="text-sm">All-day task</label>
                </div>

                {!newTask.allDay && (
                  <>
                    <div className="relative">
                      <button
                        onClick={() => setShowTimePicker(!showTimePicker)}
                        className={`w-full px-3 py-2 rounded ${darkMode ? 'bg-gray-700 text-white' : 'bg-gray-50'} border ${darkMode ? 'border-gray-600' : 'border-gray-200'} flex items-center gap-2`}
                      >
                        <Clock size={16} />
                        <span>{newTask.startTime}</span>
                      </button>
                    </div>

                    <select
                      value={newTask.duration}
                      onChange={(e) => setNewTask({ ...newTask, duration: parseInt(e.target.value) })}
                      className={`w-full px-3 py-2 rounded ${darkMode ? 'bg-gray-700 text-white' : 'bg-gray-50'} border ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}
                    >
                      {durationOptions.map(duration => (
                        <option key={duration} value={duration}>
                          {duration} minutes
                        </option>
                      ))}
                    </select>
                  </>
                )}

                <div className="relative">
                  <button
                    onClick={() => setShowDatePicker(!showDatePicker)}
                    className={`w-full px-3 py-2 rounded ${darkMode ? 'bg-gray-700 text-white' : 'bg-gray-50'} border ${darkMode ? 'border-gray-600' : 'border-gray-200'} flex items-center gap-2`}
                  >
                    <CalendarPlus size={16} />
                    <span>{newTask.date ? new Date(newTask.date).toLocaleDateString() : formatDate(selectedDate)}</span>
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={addTask}
                    className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setShowAddTask(false)}
                    className={`flex-1 px-4 py-2 rounded ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Unscheduled Tasks */}
            <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg p-4 shadow-md`}>
              <div className="flex items-center gap-2 mb-3">
                <Inbox size={18} />
                <h2 className="font-semibold">Unscheduled</h2>
              </div>
              
              <div className="space-y-2">
                {unscheduledTasks.map(task => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(task, 'unscheduled', e)}
                    className={`${task.color} rounded-lg p-3 shadow-sm cursor-move text-white ${task.completed ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <button
                          onClick={() => toggleComplete(task.id)}
                          className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-5 h-5 flex items-center justify-center hover:bg-white/30 transition-colors`}
                        >
                          {task.completed && <Check size={12} strokeWidth={3} />}
                        </button>
                        <GripVertical size={16} className="flex-shrink-0 opacity-50" />
                        <div className={`font-medium truncate ${task.completed ? 'line-through' : ''}`}>
                          {task.title}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => setShowColorPicker(showColorPicker === task.id ? null : task.id)}
                          className="hover:bg-white/20 rounded p-1 transition-colors relative"
                        >
                          <Palette size={14} />
                          {showColorPicker === task.id && (
                            <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-20 shadow-xl border border-gray-200 dark:border-gray-700">
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
                          onClick={() => deleteTask(task.id)}
                          className="hover:bg-white/20 rounded p-1 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                
                <input
                  type="text"
                  placeholder="+ Add unscheduled task"
                  className={`w-full px-3 py-2 rounded ${darkMode ? 'bg-gray-700 text-white placeholder-gray-400' : 'bg-gray-50 placeholder-gray-500'} border ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      addUnscheduledTask(e.target.value);
                      e.target.value = '';
                    }
                  }}
                />
              </div>
            </div>
          </div>

          {/* Calendar */}
          <div className="lg:col-span-3">
            <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-md overflow-hidden`}>
              <div
                ref={calendarRef}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragLeave={handleDragEnd}
                className="overflow-y-auto"
                style={{ height: 'calc(100vh - 300px)', minHeight: '600px' }}
              >
                {/* FIX 3: Add all-day tasks section at the top */}
                {allDayTasks.length > 0 && (
                  <div className={`sticky top-0 z-10 ${darkMode ? 'bg-gray-800' : 'bg-white'} border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'} p-2`}>
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 px-2">ALL DAY</div>
                    <div className="space-y-2">
                      {allDayTasks.map(task => {
                        const isConflicted = conflicts.some(c => c.includes(task.id));
                        return (
                          <div
                            key={task.id}
                            draggable
                            onDragStart={(e) => handleDragStart(task, 'calendar', e)}
                            className={`${task.color} rounded-lg shadow-sm cursor-move ${isConflicted ? 'ring-2 ring-orange-500' : ''} ${task.completed ? 'opacity-50' : ''}`}
                          >
                            <div className="p-2 text-white">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <button
                                    onClick={() => toggleComplete(task.id)}
                                    className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                  >
                                    {task.completed && <Check size={10} strokeWidth={3} />}
                                  </button>
                                  <Calendar size={14} className="flex-shrink-0" />
                                  <div className={`font-semibold text-sm truncate ${task.completed ? 'line-through' : ''}`}>
                                    {task.title}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <button
                                    onClick={() => setShowColorPicker(showColorPicker === task.id ? null : task.id)}
                                    className="hover:bg-white/20 rounded p-1 transition-colors relative"
                                  >
                                    <Palette size={14} />
                                    {showColorPicker === task.id && (
                                      <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-20 shadow-xl border border-gray-200 dark:border-gray-700">
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
                                    onClick={() => deleteTask(task.id)}
                                    className="hover:bg-white/20 rounded p-1 transition-colors"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="relative">
                  {hours.map(hour => {
                    const hourTime = `${hour.toString().padStart(2, '0')}:00`;
                    const currentHour = currentTime.getHours();
                    const currentMinutes = currentTime.getMinutes();
                    const isCurrentHour = isToday && hour === currentHour;
                    const currentTimePosition = ((currentHour - 7) * 60 + currentMinutes) / 60 * 80;

                    return (
                      <div key={hour} className="relative" style={{ height: '80px' }}>
                        <div className={`absolute left-0 top-0 w-16 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} pr-2 text-right`}>
                          {hour > 12 ? `${hour - 12}:00 PM` : hour === 12 ? '12:00 PM' : `${hour}:00 AM`}
                        </div>
                        <div className={`absolute left-16 right-0 top-0 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}></div>
                        
                        {/* Current time indicator */}
                        {isCurrentHour && (
                          <div
                            ref={currentTimeRef}
                            className="absolute left-16 right-0 flex items-center pointer-events-none z-30"
                            style={{ top: `${(currentMinutes / 60) * 80}px` }}
                          >
                            <div className="w-3 h-3 bg-red-500 rounded-full -ml-1.5"></div>
                            <div className="flex-1 h-0.5 bg-red-500"></div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Tasks */}
                  <div className="absolute left-16 right-0 top-0 bottom-0 pointer-events-none">
                    {scheduledTasks.map(task => {
                      const startMinutes = timeToMinutes(task.startTime);
                      const top = ((startMinutes - 7 * 60) / 60) * 80;
                      const height = (task.duration / 60) * 80;
                      const isConflicted = conflicts.some(c => c.includes(task.id));
                      const conflictPos = getConflictPosition(task);
                      const isVeryShort = task.duration < 45;

                      return (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={(e) => handleDragStart(task, 'calendar', e)}
                          className={`absolute ${task.color} rounded-lg shadow-md pointer-events-auto cursor-move ${isConflicted ? 'ring-2 ring-orange-500' : ''} ${task.completed ? 'opacity-50' : ''} overflow-visible`}
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
                                <button
                                  onClick={() => toggleComplete(task.id)}
                                  className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                >
                                  {task.completed && <Check size={10} strokeWidth={3} />}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <div className={`font-semibold text-base leading-tight ${task.completed ? 'line-through' : ''} ${isVeryShort ? 'truncate' : ''}`}>
                                      {task.title}
                                    </div>
                                    {isVeryShort && (
                                      <div className="text-xs opacity-75 whitespace-nowrap flex-shrink-0">
                                        {task.startTime} • {task.duration}min
                                      </div>
                                    )}
                                  </div>
                                  {!isVeryShort && (
                                    <div className="text-xs opacity-90 flex items-center gap-1 mt-1">
                                      <Clock size={12} />
                                      {task.startTime} • {task.duration}min
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-start gap-1 flex-shrink-0">
                                <button
                                  onClick={() => setShowColorPicker(showColorPicker === task.id ? null : task.id)}
                                  className="hover:bg-white/20 rounded p-1 transition-colors relative"
                                >
                                  <Palette size={14} />
                                  {showColorPicker === task.id && (
                                    <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-20 shadow-xl border border-gray-200 dark:border-gray-700">
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
                                  onClick={() => deleteTask(task.id)}
                                  className="hover:bg-white/20 rounded p-1 transition-colors"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                            {/* Resize handle at bottom */}
                            {!isVeryShort && (
                              <div
                                onMouseDown={(e) => handleResizeStart(task, e)}
                                className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize hover:bg-white/20 flex items-center justify-center"
                                style={{ marginBottom: '-4px' }}
                              >
                                <div className="w-8 h-1 bg-white/50 rounded-full"></div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    
                    {/* FIX 4: Drag preview with lower z-index than time indicator */}
                    {dragPreviewTime && draggedTask && (
                      <div className="absolute left-2 right-2 bg-blue-500/30 border-2 border-blue-500 border-dashed rounded-lg flex items-center justify-center text-white font-bold text-lg pointer-events-none z-20"
                        style={{
                          top: `${((timeToMinutes(dragPreviewTime) - 7 * 60) / 60) * 80}px`,
                          height: `${(draggedTask.duration / 60) * 80}px`,
                          minHeight: '40px'
                        }}
                      >
                        {dragPreviewTime}
                      </div>
                    )}
                  </div>
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
    </div>
  );
};

export default DayPlanner;
