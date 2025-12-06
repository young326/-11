import React, { useState, useCallback } from 'react';
import { Project, Task, LinkType } from './types';
import ProjectList from './components/ProjectList';
import ScheduleTable from './components/ScheduleTable';
import NetworkDiagram from './components/NetworkDiagram';
import AIAssistant from './components/AIAssistant';

const App: React.FC = () => {
  // --- State ---
  const [projects, setProjects] = useState<Project[]>([
    { 
      id: '1', 
      name: 'XX机场航站区安装施工总进度计划', 
      lastModified: Date.now(), 
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
    }
  ]);
  const [activeProjectId, setActiveProjectId] = useState<string>('1');
  const [leftWidth, setLeftWidth] = useState(260);
  const [bottomHeight, setBottomHeight] = useState(300);
  const [isLoading, setIsLoading] = useState(false);
  
  // Analysis State
  const [currentCriticalPath, setCurrentCriticalPath] = useState<string[]>([]);
  const [projectDuration, setProjectDuration] = useState(0);

  // --- Handlers ---
  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0];

  const handleUpdateTasks = (newTasks: Task[]) => {
    setProjects(prev => prev.map(p => 
      p.id === activeProjectId ? { ...p, tasks: newTasks, lastModified: Date.now() } : p
    ));
  };

  const handleTaskUpdate = (updatedTask: Task) => {
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
      tasks: []
    };
    setProjects([...projects, newProject]);
    setActiveProjectId(newProject.id);
  };

  const handleDeleteProject = (id: string) => {
    const newProjects = projects.filter(p => p.id !== id);
    setProjects(newProjects);
    if (activeProjectId === id && newProjects.length > 0) {
      setActiveProjectId(newProjects[0].id);
    }
  };

  const handleImportProject = (importedTasks: Task[]) => {
    const newProject: Project = {
      id: crypto.randomUUID(),
      name: '导入的工程 ' + new Date().toLocaleTimeString(),
      lastModified: Date.now(),
      tasks: importedTasks
    };
    setProjects([...projects, newProject]);
    setActiveProjectId(newProject.id);
  };

  // --- Resizing Logic ---
  const startResizingLeft = useCallback((mouseDownEvent: React.MouseEvent) => {
    const startX = mouseDownEvent.clientX;
    const startWidth = leftWidth;
    const doDrag = (dragEvent: MouseEvent) => {
      setLeftWidth(Math.max(200, Math.min(600, startWidth + dragEvent.clientX - startX)));
    };
    const stopDrag = () => {
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    };
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  }, [leftWidth]);

  const startResizingBottom = useCallback((mouseDownEvent: React.MouseEvent) => {
    const startY = mouseDownEvent.clientY;
    const startHeight = bottomHeight;
    const doDrag = (dragEvent: MouseEvent) => {
      setBottomHeight(Math.max(150, Math.min(800, startHeight - (dragEvent.clientY - startY))));
    };
    const stopDrag = () => {
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    };
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  }, [bottomHeight]);

  return (
    <div className="flex h-screen w-screen overflow-hidden text-slate-800 font-sans">
      {isLoading && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center text-white flex-col">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white mb-4"></div>
          <p>AI模型正在智能识别与计算...</p>
        </div>
      )}

      <div style={{ width: leftWidth }} className="flex-shrink-0 relative">
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

      <div className="flex-1 flex flex-col h-full min-w-0">
        <div className="flex-1 relative min-h-0 bg-slate-50">
          <NetworkDiagram 
            tasks={activeProject.tasks} 
            onUpdateAnalysis={(path, duration) => {
              setCurrentCriticalPath(path);
              setProjectDuration(duration);
            }} 
          />
        </div>

        <div 
          className="resize-handle-v w-full h-1 hover:bg-blue-400 z-10"
          onMouseDown={startResizingBottom}
        ></div>

        <div style={{ height: bottomHeight }} className="flex-shrink-0 min-h-0 border-t border-slate-200">
          <ScheduleTable 
            tasks={activeProject.tasks} 
            onUpdateTask={handleTaskUpdate} 
            onAddTask={handleAddTask}
            onDeleteTask={handleDeleteTask}
          />
        </div>
      </div>

      <AIAssistant 
        tasks={activeProject.tasks} 
        criticalPath={currentCriticalPath}
        projectDuration={projectDuration}
      />
    </div>
  );
};

export default App;
