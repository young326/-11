
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Project, Task, LinkType, Annotation } from './types';
import ProjectList from './components/ProjectList';
import ScheduleTable from './components/ScheduleTable';
import NetworkDiagram from './components/NetworkDiagram';
import AIAssistant from './components/AIAssistant';
import { Undo, Redo } from 'lucide-react';

const App: React.FC = () => {
  // --- Initial Data ---
  const initialProject: Project = { 
    id: '1', 
    name: 'XX机场航站区安装施工总进度计划', 
    lastModified: Date.now(),
    annotations: [], 
    tasks: [
      // 一工区
      { id: '10', name: '施工准备', duration: 20, predecessors: [], type: LinkType.Real, zone: '一工区' },
      { id: '20', name: '测量放线', duration: 92, predecessors: ['10'], type: LinkType.Real, zone: '一工区' },
      { id: '30', name: '切槽配管1', duration: 30, predecessors: ['20'], type: LinkType.Real, zone: '一工区' },
      { id: '40', name: '灯箱安装1', duration: 90, predecessors: ['30'], type: LinkType.Real, zone: '一工区' },
      { id: '50', name: '电缆敷设及接头制作', duration: 100, predecessors: ['40'], type: LinkType.Real, zone: '一工区' },
      { id: '60', name: '弱电系统受压', duration: 30, predecessors: ['50'], type: LinkType.Real, zone: '一工区' },
      { id: '70', name: '灯具安装', duration: 30, predecessors: ['60'], type: LinkType.Real, zone: '一工区' },
      
      // 二工区
      { id: '80', name: '测量放线', duration: 32, predecessors: ['10'], type: LinkType.Real, zone: '二工区' },
      { id: '90', name: '切槽配管', duration: 233, predecessors: ['80'], type: LinkType.Real, zone: '二工区' },
      { id: '100', name: '灯箱安装', duration: 125, predecessors: ['90'], type: LinkType.Real, zone: '二工区' },
      { id: '110', name: '电缆敷设', duration: 100, predecessors: ['100'], type: LinkType.Real, zone: '二工区' },
      
      // 三工区
      { id: '120', name: '高杆灯基础施工', duration: 42, predecessors: ['10'], type: LinkType.Real, zone: '三工区' },
      { id: '130', name: '高杆灯立及安装', duration: 44, predecessors: ['120'], type: LinkType.Real, zone: '三工区' },
      { id: '140', name: '切槽配管', duration: 202, predecessors: ['130'], type: LinkType.Real, zone: '三工区' },
      { id: '150', name: '配电亭安装', duration: 47, predecessors: ['140'], type: LinkType.Real, zone: '三工区' },
      
      // 四工区 - 关键路径部分
      { id: '200', name: '主体结构及装饰', duration: 76, predecessors: ['10'], type: LinkType.Real, zone: '四工区' },
      { id: '210', name: '机电管线安装', duration: 112, predecessors: ['200'], type: LinkType.Real, zone: '四工区' },
      { id: '220', name: '机电设备安装及调试', duration: 60, predecessors: ['210'], type: LinkType.Real, zone: '四工区' },
      { id: '230', name: '助航灯光设备调试', duration: 59, predecessors: ['220'], type: LinkType.Real, zone: '四工区' },
      { id: '240', name: '竣工验收', duration: 5, predecessors: ['70', '110', '150', '230'], type: LinkType.Wavy, zone: '四工区' },
    ] 
  };

  // --- State with History for Undo/Redo ---
  const [history, setHistory] = useState<Project[][]>([[initialProject]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  
  const projects = history[historyIndex];
  const [activeProjectId, setActiveProjectId] = useState<string>('1');

  // Layout State for 3 columns
  const [leftWidth, setLeftWidth] = useState(240); // Project List
  const [middleWidth, setMiddleWidth] = useState(400); // Schedule Table
  
  const [isLoading, setIsLoading] = useState(false);
  
  // Analysis State (calculated by NetworkDiagram)
  const [currentCriticalPath, setCurrentCriticalPath] = useState<string[]>([]);
  const [projectDuration, setProjectDuration] = useState(0);

  // --- Shared Config ---
  const projectStartDate = useMemo(() => {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() - 2); 
    return d;
  }, []);

  // --- Helpers ---
  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0];

  // Helper: Calculate CPM (Critical Path Method)
  // We perform this here so the ScheduleTable can display calculated dates
  const calculatedTasks = useMemo(() => {
    const _tasks = JSON.parse(JSON.stringify(activeProject.tasks)) as Task[];
    const taskMap = new Map(_tasks.map(t => [t.id, t]));

    // Forward Pass
    let changed = true;
    while(changed) {
      changed = false;
      _tasks.forEach(task => {
        let maxES = 0;
        if (task.predecessors.length > 0) {
          task.predecessors.forEach(pid => {
            const p = taskMap.get(pid);
            if (p && p.earlyFinish !== undefined) {
              maxES = Math.max(maxES, p.earlyFinish);
            }
          });
        }
        if (task.earlyStart !== maxES) {
          task.earlyStart = maxES;
          task.earlyFinish = maxES + task.duration;
          changed = true;
        }
      });
    }

    const pDuration = Math.max(..._tasks.map(t => t.earlyFinish || 0), 0);

    // Backward Pass
    _tasks.forEach(t => { 
      t.lateFinish = pDuration; 
      t.lateStart = pDuration - t.duration; 
    });
    
    changed = true;
    while(changed) {
      changed = false;
      _tasks.forEach(task => {
        const successors = _tasks.filter(t => t.predecessors.includes(task.id));
        if (successors.length > 0) {
          const minLS = Math.min(...successors.map(s => s.lateStart || pDuration));
          if (task.lateFinish !== minLS) {
            task.lateFinish = minLS;
            task.lateStart = minLS - task.duration;
            changed = true;
          }
        }
      });
    }

    _tasks.forEach(t => {
      const totalFloat = (t.lateStart || 0) - (t.earlyStart || 0);
      t.totalFloat = totalFloat;
      t.isCritical = totalFloat === 0;
    });

    return _tasks;
  }, [activeProject.tasks]);


  const updateProjectsWithHistory = (newProjects: Project[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newProjects);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        e.preventDefault();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        handleRedo();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);

  const handleUpdateTasks = (newTasks: Task[]) => {
    const updatedProjects = projects.map(p => 
      p.id === activeProjectId ? { ...p, tasks: newTasks, lastModified: Date.now() } : p
    );
    updateProjectsWithHistory(updatedProjects);
  };

  const handleTaskUpdate = (updatedTask: Task) => {
    // We must find the task in the original array, not the calculated one
    const newTasks = activeProject.tasks.map(t => t.id === updatedTask.id ? updatedTask : t);
    handleUpdateTasks(newTasks);
  };

  const handleAddTask = () => {
    const newTask: Task = {
      id: (Math.max(...activeProject.tasks.map(t => parseInt(t.id) || 0), 0) + 10).toString(),
      name: '新工作项',
      duration: 1,
      predecessors: [],
      type: LinkType.Real,
      zone: '一工区'
    };
    handleUpdateTasks([...activeProject.tasks, newTask]);
  };

  const handleDeleteTask = (id: string) => {
    handleUpdateTasks(activeProject.tasks.filter(t => t.id !== id));
  };

  const handleAddProject = () => {
    const newProject: Project = {
      id: crypto.randomUUID(),
      name: '新建工程项目',
      lastModified: Date.now(),
      tasks: [],
      annotations: []
    };
    const updatedProjects = [...projects, newProject];
    updateProjectsWithHistory(updatedProjects);
    setActiveProjectId(newProject.id);
  };

  const handleDeleteProject = (id: string) => {
    const newProjects = projects.filter(p => p.id !== id);
    updateProjectsWithHistory(newProjects);
    if (activeProjectId === id && newProjects.length > 0) {
      setActiveProjectId(newProjects[0].id);
    }
  };

  const handleImportProject = (importedTasks: Task[]) => {
    const newProject: Project = {
      id: crypto.randomUUID(),
      name: '导入的工程 ' + new Date().toLocaleTimeString(),
      lastModified: Date.now(),
      tasks: importedTasks,
      annotations: []
    };
    const updatedProjects = [...projects, newProject];
    updateProjectsWithHistory(updatedProjects);
    setActiveProjectId(newProject.id);
  };

  const handleUpdateAnnotations = (newAnnotations: Annotation[]) => {
    const updatedProjects = projects.map(p => 
      p.id === activeProjectId ? { ...p, annotations: newAnnotations, lastModified: Date.now() } : p
    );
    updateProjectsWithHistory(updatedProjects);
  };

  const startResizingLeft = useCallback((mouseDownEvent: React.MouseEvent) => {
    const startX = mouseDownEvent.clientX;
    const startWidth = leftWidth;
    const doDrag = (dragEvent: MouseEvent) => {
      setLeftWidth(Math.max(150, Math.min(400, startWidth + dragEvent.clientX - startX)));
    };
    const stopDrag = () => {
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    };
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  }, [leftWidth]);

  const startResizingMiddle = useCallback((mouseDownEvent: React.MouseEvent) => {
    const startX = mouseDownEvent.clientX;
    const startWidth = middleWidth;
    const doDrag = (dragEvent: MouseEvent) => {
      setMiddleWidth(Math.max(300, Math.min(800, startWidth + dragEvent.clientX - startX)));
    };
    const stopDrag = () => {
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    };
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  }, [middleWidth]);

  return (
    <div className="flex h-screen w-screen overflow-hidden text-slate-800 font-sans">
      {isLoading && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center text-white flex-col">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white mb-4"></div>
          <p>AI模型正在智能识别与计算...</p>
        </div>
      )}

      {/* 1. Project List Panel */}
      <div style={{ width: leftWidth }} className="flex-shrink-0 relative h-full">
        <ProjectList 
          projects={projects} 
          activeProjectId={activeProjectId} 
          onSelectProject={setActiveProjectId}
          onAddProject={handleAddProject}
          onDeleteProject={handleDeleteProject}
          onImportProject={handleImportProject}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
        />
        <div 
          className="resize-handle-h absolute top-0 right-0 h-full w-1 hover:bg-blue-400 z-10"
          onMouseDown={startResizingLeft}
        ></div>
      </div>

      {/* 2. Schedule Table Panel */}
      <div style={{ width: middleWidth }} className="flex-shrink-0 relative h-full flex flex-col border-r border-slate-200">
         <ScheduleTable 
            tasks={calculatedTasks} 
            onUpdateTask={handleTaskUpdate} 
            onAddTask={handleAddTask}
            onDeleteTask={handleDeleteTask}
            projectStartDate={projectStartDate}
          />
         <div 
          className="resize-handle-h absolute top-0 right-0 h-full w-1 hover:bg-blue-400 z-10"
          onMouseDown={startResizingMiddle}
        ></div>
      </div>

      {/* 3. Network Diagram Panel */}
      <div className="flex-1 flex flex-col h-full min-w-0 bg-slate-50 relative">
          <div className="absolute top-2 right-4 flex gap-2 z-20">
            <button 
              onClick={handleUndo} 
              disabled={historyIndex === 0}
              className="p-1.5 bg-white rounded shadow border border-slate-200 hover:bg-slate-100 disabled:opacity-50 text-slate-600"
              title="撤销 (Ctrl+Z)"
            >
              <Undo size={16} />
            </button>
            <button 
              onClick={handleRedo} 
              disabled={historyIndex === history.length - 1}
              className="p-1.5 bg-white rounded shadow border border-slate-200 hover:bg-slate-100 disabled:opacity-50 text-slate-600"
              title="重做 (Ctrl+Shift+Z)"
            >
              <Redo size={16} />
            </button>
          </div>
          <NetworkDiagram 
            tasks={calculatedTasks}
            annotations={activeProject.annotations || []} 
            onUpdateTasks={handleUpdateTasks}
            onUpdateAnnotations={handleUpdateAnnotations}
            projectStartDate={projectStartDate}
            onUpdateAnalysis={(path, duration) => {
              setCurrentCriticalPath(path);
              setProjectDuration(duration);
            }} 
          />
      </div>

      <AIAssistant 
        tasks={calculatedTasks} 
        criticalPath={currentCriticalPath}
        projectDuration={projectDuration}
      />
    </div>
  );
};

export default App;
