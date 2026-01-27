import React, { useState, useEffect, useRef } from 'react';
import { Plus, Clock, X, ChevronLeft, ChevronRight, Moon, Sun, Upload, Inbox, AlertCircle, Calendar, Check, RefreshCw, Palette, CalendarPlus } from 'lucide-react';

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
  const durationOptions = Array.from({ length: 9 }, (_, i) => (i + 1) * 15);

  useEffect(() => {
    loadData();
    fetchWeather();
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
        currentTimeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [selectedDate]);

  useEffect(() => {
    saveData();
    checkConflicts();
  }, [tasks, unscheduledTasks, darkMode, syncUrl]);

  const loadData = () => {
    try {
      const tasksData = localStorage.getItem('day-planner-tasks');
      const unscheduledData = localStorage.getItem('day-planner-unscheduled');
      const darkModeData = localStorage.getItem('day-planner-darkmode');
      const syncUrlData = localStorage.getItem('day-planner-sync-url');
      
      if (tasksData) setTasks(JSON.parse(tasksData));
      if (unscheduledData) setUnscheduledTasks(JSON.parse(unscheduledData));
      if (darkModeData) setDarkMode(JSON.parse(darkModeData));
      if (syncUrlData) setSyncUrl(JSON.parse(syncUrlData));
    } catch (error) {
      console.log('No existing data found');
    }
  };

  const saveData = () => {
    try {
      localStorage.setItem('day-planner-tasks', JSON.stringify(tasks));
      localStorage.setItem('day-planner-unscheduled', JSON.stringify(unscheduledTasks));
      localStorage.setItem('day-planner-darkmode', JSON.stringify(darkMode));
      localStorage.setItem('day-planner-sync-url', JSON.stringify(syncUrl));
    } catch (error) {
      console.error('Error saving:', error);
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
    
    return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  };

  const fetchWeather = async () => {
    try {
      const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=39.7392&longitude=-104.9903&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America%2FDenver&forecast_days=1');
      const data = await response.json();
      
      if (data.current && data.daily) {
        setWeather({
          temp: Math.round(data.current.temperature_2m),
          icon: getWeatherIcon(data.current.weather_code),
          high: Math.round(data.daily.temperature_2m_max[0]),
          low: Math.round(data.daily.temperature_2m_min[0])
        });
      }
    } catch (error) {
      console.error('Weather error:', error);
    }
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
    return hours.toString().padStart(2, '0') + ':' + mins.toString().padStart(2, '0');
  };

  const dateToString = (date) => {
    return date.toISOString().split('T')[0];
  };

  const checkConflicts = () => {
    const dateStr = dateToString(selectedDate);
    const todayTasks = tasks.filter(t => t.date === dateStr && !t.isAllDay);
    const newConflicts = [];

    for (let i = 0; i < todayTasks.length; i++) {
      for (let j = i + 1; j < todayTasks.length; j++) {
        const task1 = todayTasks[i];
        const task2 = todayTasks[j];
        const start1 = timeToMinutes(task1.startTime);
        const end1 = start1 + task1.duration;
        const start2 = timeToMinutes(task2.startTime);
        const end2 = start2 + task2.duration;

        if (start1 < end2 && end1 > start2) {
          if (!newConflicts.find(c => c.includes(task1.id) && c.includes(task2.id))) {
            newConflicts.push([task1.id, task2.id]);
          }
        }
      }
    }
    setConflicts(newConflicts);
  };

  const getConflictingTasks = (task, allTasks) => {
    if (task.isAllDay) return [];
    const start = timeToMinutes(task.startTime);
    const end = start + task.duration;
    
    return allTasks.filter(t => {
      if (t.id === task.id || t.isAllDay) return false;
      const tStart = timeToMinutes(t.startTime);
      const tEnd = tStart + t.duration;
      return start < tEnd && end > tStart;
    });
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
      left: leftPercent + '%',
      right: 'auto',
      width: (widthPercent - 1) + '%'
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
        setUnscheduledTasks([...unscheduledTasks, task]);
      } else {
        setTasks([...tasks, {
          ...task,
          startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
          date: newTask.date || dateToString(selectedDate)
        }]);
      }
      
      setNewTask({ title: '', startTime: getNextQuarterHour(), duration: 60, date: dateToString(selectedDate), isAllDay: false });
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

  const deleteTask = (id, fromInbox = false) => {
    if (fromInbox) {
      setUnscheduledTasks(unscheduledTasks.filter(task => task.id !== id));
    } else {
      setTasks(tasks.filter(task => task.id !== id));
    }
  };

  const formatDate = (date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return days[date.getDay()] + ', ' + months[date.getMonth()] + ' ' + date.getDate();
  };

  const changeDate = (days) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + days);
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  const openNewTaskForm = () => {
    setNewTask({ 
      title: '', 
      startTime: getNextQuarterHour(), 
      duration: 60,
      date: dateToString(selectedDate),
      isAllDay: false
    });
    setShowAddTask(true);
  };

  const openNewInboxTask = () => {
    setNewTask({ 
      title: '', 
      startTime: getNextQuarterHour(), 
      duration: 60,
      date: dateToString(selectedDate),
      isAllDay: false,
      openInInbox: true
    });
    setShowAddTask(true);
  };

  const calculateTaskPosition = (task) => {
    const startMinutes = timeToMinutes(task.startTime);
    const startHour = Math.floor(startMinutes / 60);
    const minutesIntoHour = startMinutes % 60;
    const top = (startHour - 7) * 80 + (minutesIntoHour / 60) * 80;
    const height = (task.duration / 60) * 80;
    return { top, height };
  };

  const todayTasks = tasks.filter(t => t.date === dateToString(selectedDate));
  const hasConflicts = conflicts.length > 0;
  const allCompletedTasks = tasks.filter(t => t.completed);
  const totalCompletedMinutes = allCompletedTasks.reduce((sum, task) => sum + task.duration, 0);
  const totalScheduledMinutes = tasks.reduce((sum, task) => sum + task.duration, 0);
  const isToday = dateToString(selectedDate) === dateToString(new Date());
  const currentTimeTop = ((currentTime.getHours() - 7) * 80) + ((currentTime.getMinutes() / 60) * 80);
  const showCurrentTimeLine = isToday && currentTime.getHours() >= 7 && currentTime.getHours() < 23;
  const bgClass = darkMode ? 'bg-gray-900' : 'bg-gray-50';
  const cardBg = darkMode ? 'bg-gray-800' : 'bg-white';
  const borderClass = darkMode ? 'border-gray-700' : 'border-gray-200';
  const textPrimary = darkMode ? 'text-gray-100' : 'text-gray-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-gray-600';
  const hoverBg = darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100';

  return (
    <div className={bgClass + ' min-h-screen'}>
      <div className={cardBg + ' border-b ' + borderClass + ' px-6 py-4'}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className={'text-2xl font-bold ' + textPrimary}>Here's what your day looks like!</h1>
            <div className="flex items-center gap-6 mt-2">
              <div className="flex items-center gap-2">
                <button onClick={() => changeDate(-1)} className={'p-1 rounded ' + hoverBg}>
                  <ChevronLeft size={20} className={textSecondary} />
                </button>
                <span className={textPrimary + ' font-bold text-xl min-w-[220px] text-center'}>{formatDate(selectedDate)}</span>
                <button onClick={() => changeDate(1)} className={'p-1 rounded ' + hoverBg}>
                  <ChevronRight size={20} className={textSecondary} />
                </button>
              </div>
              <button onClick={goToToday} className={'px-3 py-1 text-sm ' + (darkMode ? 'bg-gray-700' : 'bg-gray-200') + ' ' + textPrimary + ' rounded ' + hoverBg}>
                Today
              </button>
              {weather && (
                <div className={'flex items-center gap-3 px-4 py-2 ' + (darkMode ? 'bg-gray-700' : 'bg-gray-100') + ' rounded-lg'}>
                  <div className="text-2xl">{weather.icon}</div>
                  <div>
                    <div className={'text-lg font-bold ' + textPrimary}>{weather.temp}°F</div>
                    <div className={'text-xs ' + textSecondary}>H: {weather.high}° L: {weather.low}°</div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setDarkMode(!darkMode)} className={'p-2 rounded-lg ' + hoverBg}>
              {darkMode ? <Sun size={20} className={textSecondary} /> : <Moon size={20} className={textSecondary} />}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-3">
            <div className="flex gap-2 mb-4">
              <button onClick={openNewTaskForm} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                <CalendarPlus size={18} />
                <span className="font-medium">Schedule</span>
              </button>
              <button onClick={openNewInboxTask} className={'flex-1 flex items-center justify-center gap-2 px-4 py-3 ' + (darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300') + ' ' + textPrimary + ' rounded-lg'}>
                <Plus size={18} />
                <span className="font-medium">Inbox</span>
              </button>
            </div>

            <div className={cardBg + ' rounded-lg shadow-sm border ' + borderClass + ' p-4 mb-4'}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={'font-semibold ' + textPrimary + ' flex items-center gap-2'}>
                  <Inbox size={18} />
                  Inbox
                </h3>
                <span className={'text-sm ' + textSecondary}>{unscheduledTasks.length}</span>
              </div>
              <div className={'space-y-2 ' + (unscheduledTasks.length === 0 ? 'min-h-[100px] flex items-center justify-center' : '')}>
                {unscheduledTasks.length === 0 ? (
                  <p className={'text-sm ' + textSecondary + ' text-center'}>No tasks in inbox</p>
                ) : (
                  unscheduledTasks.map(task => (
                    <div key={task.id} className={task.color + ' rounded-lg p-3 shadow-sm ' + (task.completed ? 'opacity-50' : '')}>
                      <div className="flex items-start justify-between text-white">
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          <button onClick={() => toggleComplete(task.id, true)} className={'mt-0.5 rounded flex-shrink-0 ' + (task.completed ? 'bg-white/40' : 'bg-white/20') + ' border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30'}>
                            {task.completed && <Check size={10} strokeWidth={3} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className={'font-medium text-sm ' + (task.completed ? 'line-through' : '')}>{task.title}</div>
                            <div className="text-xs opacity-90 mt-1">{task.duration} min</div>
                          </div>
                        </div>
                        <button onClick={() => deleteTask(task.id, true)} className="hover:bg-white/20 rounded p-1 flex-shrink-0">
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {hasConflicts && (
              <div className={cardBg + ' rounded-lg shadow-sm border border-orange-500 p-4 mt-4'}>
                <div className="flex items-start gap-2 text-orange-600">
                  <AlertCircle size={18} className="mt-0.5" />
                  <div>
                    <div className="font-semibold text-sm">Time Conflicts</div>
                    <div className="text-xs mt-1">You have {conflicts.length} overlapping tasks</div>
                  </div>
                </div>
              </div>
            )}

            <div className={cardBg + ' rounded-lg shadow-sm border ' + borderClass + ' p-4 mt-4'}>
              <h3 className={'font-semibold ' + textPrimary + ' mb-2'}>Today's Summary</h3>
              <div className={'text-sm ' + textSecondary + ' space-y-1'}>
                <div>{todayTasks.length} tasks scheduled</div>
                <div>{todayTasks.reduce((sum, task) => sum + task.duration, 0)} minutes planned</div>
                <div>{unscheduledTasks.length} tasks in inbox</div>
              </div>
            </div>

            <div className={cardBg + ' rounded-lg shadow-sm border ' + borderClass + ' p-4 mt-4'}>
              <h3 className={'font-semibold ' + textPrimary + ' mb-3'}>All Time Summary</h3>
              <div className={'text-sm ' + textSecondary + ' space-y-2'}>
                <div className="flex justify-between">
                  <span>Total tasks:</span>
                  <span className={textPrimary}>{tasks.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Completed:</span>
                  <span className={textPrimary}>{allCompletedTasks.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Time spent:</span>
                  <span className={textPrimary}>{Math.floor(totalCompletedMinutes / 60)}h {totalCompletedMinutes % 60}m</span>
                </div>
                <div className="flex justify-between">
                  <span>Total planned:</span>
                  <span className={textPrimary}>{Math.floor(totalScheduledMinutes / 60)}h {totalScheduledMinutes % 60}m</span>
                </div>
                {tasks.length > 0 && (
                  <div className={'pt-2 border-t ' + (darkMode ? 'border-gray-700' : 'border-gray-200')}>
                    <div className="flex justify-between font-semibold">
                      <span>Completion:</span>
                      <span className={textPrimary}>{Math.round((allCompletedTasks.length / tasks.length) * 100)}%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="col-span-9">
            {showAddTask && (
              <div className={cardBg + ' rounded-lg shadow-sm border ' + borderClass + ' p-4 mb-6'}>
                <h3 className={'font-semibold ' + textPrimary + ' mb-4'}>New Task</h3>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Task title"
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    className={'w-full px-3 py-2 border ' + borderClass + ' rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ' + (darkMode ? 'bg-gray-700 text-white' : 'bg-white')}
                  />
                  <div className="flex gap-2">
                    <button onClick={() => addTask(newTask.openInInbox || false)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                      {newTask.openInInbox ? 'Add to Inbox' : 'Add to Schedule'}
                    </button>
                    {!newTask.openInInbox && (
                      <button onClick={() => addTask(true)} className={'px-4 py-2 ' + (darkMode ? 'bg-gray-700' : 'bg-gray-200') + ' ' + textPrimary + ' rounded-lg ' + hoverBg}>
                        Add to Inbox
                      </button>
                    )}
                    <button onClick={() => setShowAddTask(false)} className={'px-4 py-2 ' + (darkMode ? 'bg-gray-700' : 'bg-gray-200') + ' ' + textPrimary + ' rounded-lg ' + hoverBg}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className={cardBg + ' rounded-lg shadow-sm border ' + borderClass + ' overflow-hidden'}>
              <div ref={calendarRef} className="relative overflow-y-auto max-h-[calc(100vh-300px)]">
                {hours.map((hour) => (
                  <div key={hour} className={'flex border-b ' + borderClass}>
                    <div className={'w-20 flex-shrink-0 py-2 px-3 text-sm ' + textSecondary + ' border-r ' + borderClass}>
                      {hour.toString().padStart(2, '0')}:00
                    </div>
                    <div className="flex-1 relative h-20"></div>
                  </div>
                ))}

                <div className="absolute top-0 left-20 right-0 bottom-0 pointer-events-none">
                  {showCurrentTimeLine && (
                    <div ref={currentTimeRef} className="absolute left-0 right-0 pointer-events-none z-10" style={{ top: `${currentTimeTop}px` }}>
                      <div className="flex items-center">
                        <div className="w-2 h-2 bg-red-500 rounded-full -ml-1"></div>
                        <div className="flex-1 h-0.5 bg-red-500"></div>
                      </div>
                    </div>
                  )}

                  {todayTasks.map((task) => {
                    if (task.isAllDay) return null;
                    const pos = calculateTaskPosition(task);
                    const conflictPos = calculateConflictPosition(task, todayTasks);
                    const isConflicted = conflicts.some(c => c.includes(task.id));
                    
                    return (
                      <div
                        key={task.id}
                        className={task.color + ' rounded-lg shadow-md pointer-events-auto ' + (isConflicted ? 'ring-2 ring-orange-500 ' : '') + (task.completed ? 'opacity-50' : '')}
                        style={{ 
                          position: 'absolute',
                          top: `${pos.top}px`, 
                          height: `${pos.height}px`, 
                          minHeight: '40px',
                          left: conflictPos.left,
                          right: conflictPos.right,
                          width: conflictPos.width
                        }}
                      >
                        <div className="p-2 h-full flex flex-col text-white">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              <button onClick={() => toggleComplete(task.id)} className={'mt-0.5 rounded flex-shrink-0 ' + (task.completed ? 'bg-white/40' : 'bg-white/20') + ' border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30'}>
                                {task.completed && <Check size={10} strokeWidth={3} />}
                              </button>
                              <div className="flex-1 min-w-0">
                                <div className={'font-semibold text-base leading-tight ' + (task.completed ? 'line-through' : '')}>{task.title}</div>
                                <div className="text-xs opacity-90 flex items-center gap-1 mt-1">
                                  <Clock size={12} />
                                  {task.startTime} • {task.duration}min
                                </div>
                              </div>
                            </div>
                            <button onClick={() => deleteTask(task.id)} className="hover:bg-white/20 rounded p-1">
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DayPlanner; Confirm
            </button>
          </div>
        </div>
      </div>
    );
  };

  const todayTasks = tasks.filter(t => t.date === dateToString(selectedDate));
  const hasConflicts = conflicts.length > 0;

  // Calculate all-time stats
  const allCompletedTasks = tasks.filter(t => t.completed);
  const totalCompletedMinutes = allCompletedTasks.reduce((sum, task) => sum + task.duration, 0);
  const totalScheduledMinutes = tasks.reduce((sum, task) => sum + task.duration, 0);

  const isToday = dateToString(selectedDate) === dateToString(new Date());
  const currentTimeMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const currentTimeTop = ((currentTime.getHours() - 7) * 80) + ((currentTime.getMinutes() / 60) * 80);
  const showCurrentTimeLine = isToday && currentTime.getHours() >= 7 && currentTime.getHours() < 23;

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
          <div>
            <h1 className={`text-2xl font-bold ${textPrimary}`}>Hey Jason, here's what your day looks like.</h1>
            <div className="flex items-center gap-6 mt-2">
              <div className="flex items-center gap-2">
                <button onClick={() => changeDate(-1)} className={`p-1 rounded ${hoverBg}`}>
                  <ChevronLeft size={20} className={textSecondary} />
                </button>
                <span className={`${textPrimary} font-bold text-xl min-w-[220px] text-center`}>{formatDate(selectedDate)}</span>
                <button onClick={() => changeDate(1)} className={`p-1 rounded ${hoverBg}`}>
                  <ChevronRight size={20} className={textSecondary} />
                </button>
              </div>
              <button
                onClick={goToToday}
                className={`px-3 py-1 text-sm ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} ${textPrimary} rounded ${hoverBg}`}
              >
                Today
              </button>
              {weather && (
                <div className={`flex items-center gap-3 px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg`}>
                  <div className="text-2xl">{weather.icon}</div>
                  <div>
                    <div className={`text-lg font-bold ${textPrimary}`}>{weather.temp}°F</div>
                    <div className={`text-xs ${textSecondary}`}>H: {weather.high}° L: {weather.low}°</div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSyncSettings(!showSyncSettings)}
              className={`px-3 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg} flex items-center gap-2`}
            >
              <RefreshCw size={18} className={textSecondary} />
              <span className={`text-sm ${textPrimary}`}>Sync</span>
            </button>
            <label className={`cursor-pointer px-3 py-2 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg ${hoverBg} flex items-center gap-2`}>
              <Upload size={18} className={textSecondary} />
              <span className={`text-sm ${textPrimary}`}>Import iCal</span>
              <input type="file" accept=".ics" onChange={handleFileUpload} className="hidden" />
            </label>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 rounded-lg ${hoverBg}`}
            >
              {darkMode ? <Sun size={20} className={textSecondary} /> : <Moon size={20} className={textSecondary} />}
            </button>
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
                <CalendarPlus size={18} />
                <span className="font-medium">Schedule</span>
              </button>
              <button
                onClick={openNewInboxTask}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} ${textPrimary} rounded-lg transition-colors`}
                title="Add to Inbox"
              >
                <Plus size={18} />
                <span className="font-medium">Inbox</span>
              </button>
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mb-4`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Inbox size={18} />
                  Inbox
                </h3>
                <span className={`text-sm ${textSecondary}`}>{unscheduledTasks.length}</span>
              </div>
              
              <div
                onDragOver={handleDragOver}
                onDrop={handleDropOnInbox}
                className={`space-y-2 ${unscheduledTasks.length === 0 ? 'min-h-[100px] flex items-center justify-center' : ''}`}
              >
                {unscheduledTasks.length === 0 ? (
                  <p className={`text-sm ${textSecondary} text-center`}>Drag tasks here to unschedule them</p>
                ) : (
                  unscheduledTasks.map(task => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => handleDragStart(task, 'inbox')}
                      className={`${task.color} rounded-lg p-3 cursor-move shadow-sm ${task.completed ? 'opacity-50' : ''} relative`}
                    >
                      {showColorPicker === task.id && (
                        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-2 z-20 shadow-xl border border-gray-200 dark:border-gray-700">
                          <div className="grid grid-cols-3 gap-1">
                            {colors.map((color) => (
                              <button
                                key={color.class}
                                onClick={() => changeTaskColor(task.id, color.class, true)}
                                className={`${color.class} w-8 h-8 rounded-full hover:scale-110 transition-transform ${task.color === color.class ? 'ring-2 ring-offset-2 ring-white' : ''}`}
                                title={color.name}
                              />
                            ))}
                          </div>
                        </div>
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
                            <div className={`font-medium text-sm ${task.completed ? 'line-through' : ''}`}>{task.title}</div>
                            <div className="text-xs opacity-90 mt-1">{task.duration} min</div>
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
                            onClick={() => deleteTask(task.id, true)}
                            className="hover:bg-white/20 rounded p-1"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {hasConflicts && (
              <div className={`${cardBg} rounded-lg shadow-sm border border-orange-500 p-4 mt-4`}>
                <div className="flex items-start gap-2 text-orange-600">
                  <AlertCircle size={18} className="mt-0.5" />
                  <div>
                    <div className="font-semibold text-sm">Time Conflicts</div>
                    <div className="text-xs mt-1">You have {conflicts.length} overlapping task{conflicts.length > 1 ? 's' : ''}</div>
                  </div>
                </div>
              </div>
            )}

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <h3 className={`font-semibold ${textPrimary} mb-2`}>Today's Summary</h3>
              <div className={`text-sm ${textSecondary} space-y-1`}>
                <div>{todayTasks.length} tasks scheduled</div>
                <div>{todayTasks.reduce((sum, task) => sum + task.duration, 0)} minutes planned</div>
                <div>{unscheduledTasks.length} tasks in inbox</div>
              </div>
            </div>

            <div className={`${cardBg} rounded-lg shadow-sm border ${borderClass} p-4 mt-4`}>
              <h3 className={`font-semibold ${textPrimary} mb-3`}>All Time Summary</h3>
              <div className={`text-sm ${textSecondary} space-y-2`}>
                <div className="flex justify-between">
                  <span>Total tasks:</span>
                  <span className={textPrimary}>{tasks.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Completed:</span>
                  <span className={textPrimary}>{allCompletedTasks.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Time spent:</span>
                  <span className={textPrimary}>{Math.floor(totalCompletedMinutes / 60)}h {totalCompletedMinutes % 60}m</span>
                </div>
                <div className="flex justify-between">
                  <span>Total planned:</span>
                  <span className={textPrimary}>{Math.floor(totalScheduledMinutes / 60)}h {totalScheduledMinutes % 60}m</span>
                </div>
                {tasks.length > 0 && (
                  <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between font-semibold">
                      <span>Completion:</span>
                      <span className={textPrimary}>{Math.round((allCompletedTasks.length / tasks.length) * 100)}%</span>
                    </div>
                  </div>
                )}
              </div>
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
                      <label className={`block text-sm ${textSecondary} mb-1`}>Color</label>
                      <div className="relative">
                        <button
                          onClick={() => setShowColorPicker('newTask')}
                          className={`w-full h-10 ${newTask.color || colors[0].class} rounded-lg border ${borderClass}`}
                        />
                        {showColorPicker === 'newTask' && (
                          <div className={`absolute top-12 left-0 ${cardBg} rounded-lg p-2 shadow-xl z-20 border ${borderClass}`}>
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
                  </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Duration</label>
                      <select
                        value={newTask.duration}
                        onChange={(e) => setNewTask({ ...newTask, duration: parseInt(e.target.value) })}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                      >
                        {durationOptions.map(minutes => (
                          <option key={minutes} value={minutes}>
                            {minutes} min
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Color</label>
                      <div className="relative">
                        <button
                          onClick={() => setShowColorPicker('newTask')}
                          className={`w-full h-10 ${newTask.color || colors[0].class} rounded-lg border ${borderClass}`}
                        />
                        {showColorPicker === 'newTask' && (
                          <div className={`absolute top-12 left-0 ${cardBg} rounded-lg p-2 shadow-xl z-20 border ${borderClass}`}>
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
              <div
                ref={calendarRef}
                onDragOver={handleDragOver}
                onDrop={handleDropOnCalendar}
                onClick={openNewTaskAtTime}
                className="relative overflow-y-auto max-h-[calc(100vh-300px)]"
              >
                {hours.map((hour) => (
                  <div key={hour} className={`flex border-b ${borderClass}`}>
                    <div className={`w-20 flex-shrink-0 py-2 px-3 text-sm ${textSecondary} border-r ${borderClass}`}>
                      {hour.toString().padStart(2, '0')}:00
                    </div>
                    <div className="flex-1 relative h-20 calendar-slot"></div>
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

                  {todayTasks.map((task) => {
                    const { top, height } = calculateTaskPosition(task);
                    const isConflicted = conflicts.some(c => c.includes(task.id));
                    const conflictPos = calculateConflictPosition(task, todayTasks);
                    const isVeryShort = height < 50;
                    
                    // All-day events appear at the top
                    if (task.isAllDay) {
                      return (
                        <div
                          key={task.id}
                          className={`absolute left-2 right-2 ${task.color} rounded-lg shadow-md pointer-events-auto px-3 py-2 ${task.completed ? 'opacity-50' : ''}`}
                          style={{ top: '-40px', height: '32px' }}
                        >
                          <div className="flex items-center justify-between text-white h-full">
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
                      );
                    }
                    
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
                  
                  {/* Drag preview */}
                  {dragPreviewTime && draggedTask && (
                    <div className="absolute left-2 right-2 bg-blue-500/30 border-2 border-blue-500 border-dashed rounded-lg flex items-center justify-center text-white font-bold text-lg pointer-events-none"
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