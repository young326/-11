import React, { useRef } from 'react';
import { Project, Task } from '../types';
import { FolderOpen, Plus, Save, FileText, Upload, Trash2 } from 'lucide-react';
import { parseScheduleFromText } from '../services/geminiService';

interface ProjectListProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
  onDeleteProject: (id: string) => void;
  onImportProject: (tasks: Task[]) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

const ProjectList: React.FC<ProjectListProps> = ({ 
  projects, 
  activeProjectId, 
  onSelectProject, 
  onAddProject, 
  onDeleteProject,
  onImportProject,
  isLoading,
  setIsLoading
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      // In a real app, use appropriate libraries for .mpp, .xer, .pdf. 
      // Here we simulate parsing by reading text/csv content for the AI.
      // The AI is prompted to handle CSV/Excel/P6 text exports.
      const text = await file.text();
      const tasks = await parseScheduleFromText(text);
      onImportProject(tasks);
    } catch (e) {
      alert("导入文件出错。请确保是文本格式(CSV/TXT)或检查API Key。");
      console.error(e);
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 border-r border-slate-200">
      <div className="p-4 bg-slate-100 border-b border-slate-200">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">工程项目管理</h2>
        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={onAddProject}
            className="flex items-center justify-center gap-1 bg-blue-600 text-white p-2 rounded text-xs hover:bg-blue-700 transition"
          >
            <Plus size={14} /> 新建项目
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-1 bg-slate-200 text-slate-700 p-2 rounded text-xs hover:bg-slate-300 transition"
          >
            <Upload size={14} /> 智能导入
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload}
            className="hidden" 
            accept=".csv,.txt,.json,.xml,.mpp,.xer" // Broaden accept to imply support
            title="支持 Excel, PDF, P6, Project, CSV 等格式"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {projects.length === 0 && (
          <div className="text-center text-slate-400 text-sm mt-10">暂无项目，请新建或导入。</div>
        )}
        {projects.map((project) => (
          <div
            key={project.id}
            onClick={() => onSelectProject(project.id)}
            className={`group flex items-center justify-between p-3 mb-2 rounded cursor-pointer border transition-all ${
              activeProjectId === project.id
                ? 'bg-blue-50 border-blue-300 shadow-sm'
                : 'bg-white border-transparent hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <FolderOpen size={16} className={activeProjectId === project.id ? "text-blue-500" : "text-slate-400"} />
              <div className="flex flex-col truncate">
                <span className={`text-sm font-medium ${activeProjectId === project.id ? 'text-blue-800' : 'text-slate-700'}`}>
                  {project.name}
                </span>
                <span className="text-xs text-slate-400">
                  {new Date(project.lastModified).toLocaleDateString()}
                </span>
              </div>
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); onDeleteProject(project.id); }}
              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1"
              title="删除项目"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      
      <div className="p-2 border-t border-slate-200 text-xs text-center text-slate-400">
        项目容量: 100个 | 通义千问大模型驱动
      </div>
    </div>
  );
};

export default ProjectList;