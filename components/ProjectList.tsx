
import React, { useRef, useState } from 'react';
import { Project, Task } from '../types';
import { FolderOpen, Plus, Save, Upload, Trash2, Undo, Redo, FileSpreadsheet, CloudUpload, Download } from 'lucide-react';
import { parseScheduleFromText } from '../services/geminiService';
import * as XLSX from 'xlsx';

interface ProjectListProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
  onDeleteProject: (id: string) => void;
  onImportProject: (tasks: Task[], startDate?: number) => void;
  onRenameProject: (id: string, newName: string) => void;
  onSaveProject: () => void;
  onSaveToServer: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isLoading: boolean;
  isSaving: boolean;
  setIsLoading: (loading: boolean) => void;
}

const ProjectList: React.FC<ProjectListProps> = ({ 
  projects, 
  activeProjectId, 
  onSelectProject, 
  onAddProject, 
  onDeleteProject,
  onImportProject,
  onRenameProject,
  onSaveProject,
  onSaveToServer,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  isLoading,
  isSaving,
  setIsLoading
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      let text = '';
      
      // Handle Excel files
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Use sheet_to_json to get a structured object array
        // CRITICAL FIX: raw: false ensures dates come out as strings (e.g., "2024-01-01") not numbers (e.g., 45321)
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
          defval: "",
          raw: false, 
          dateNF: 'yyyy-mm-dd' 
        });
        
        // CRITICAL FIX: Limit the number of rows to prevent "Rpc failed" (Payload too large) errors.
        // Reduced to 30 rows to be safe for XHR limits.
        const limitedData = (jsonData as any[]).slice(0, 30);
        
        text = JSON.stringify(limitedData, null, 2);
      } else {
        // Handle text based files (CSV, TXT, XML, etc.)
        const rawText = await file.text();
        // Limit raw text length. Reduced to 5000 chars.
        text = rawText.substring(0, 5000);
      }

      if (!text || text.trim().length === 0) {
        throw new Error("文件内容为空");
      }

      // Call AI Service
      const result = await parseScheduleFromText(text);
      
      if (result && result.tasks && result.tasks.length > 0) {
        onImportProject(result.tasks, result.projectStartDate);
      } else {
        alert("未能识别出有效的工作任务，请检查文件格式。");
      }
    } catch (e) {
      alert("导入失败：请检查网络连接或文件内容。AI服务可能暂时繁忙。");
      console.error(e);
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startEditing = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation(); // Prevent selection when starting edit
    setEditingId(project.id);
    setEditName(project.name);
  };

  const saveEdit = () => {
    if (editingId && editName.trim()) {
      onRenameProject(editingId, editName.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 border-r border-slate-200">
      <div className="p-4 bg-slate-100 border-b border-slate-200 space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">工程项目管理</h2>
          <div className="flex gap-1">
             <button 
              onClick={onUndo} 
              disabled={!canUndo}
              className="p-1.5 rounded text-slate-500 hover:bg-white hover:text-blue-600 disabled:opacity-30 transition"
              title="撤销 (Ctrl+Z)"
            >
              <Undo size={14} />
            </button>
            <button 
              onClick={onRedo} 
              disabled={!canRedo}
              className="p-1.5 rounded text-slate-500 hover:bg-white hover:text-blue-600 disabled:opacity-30 transition"
              title="重做 (Ctrl+Shift+Z)"
            >
              <Redo size={14} />
            </button>
            <div className="w-px h-4 bg-slate-300 mx-1 self-center"></div>
             <button 
              onClick={onSaveToServer} 
              disabled={isSaving}
              className={`p-1.5 rounded transition ${isSaving ? 'text-blue-400 animate-pulse' : 'text-slate-500 hover:bg-white hover:text-blue-600'}`}
              title="保存到服务器"
            >
              <CloudUpload size={14} />
            </button>
             <button 
              onClick={onSaveProject} 
              className="p-1.5 rounded text-slate-500 hover:bg-white hover:text-blue-600 transition"
              title="导出项目 (JSON)"
            >
              <Download size={14} />
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={onAddProject}
            className="flex items-center justify-center gap-1 bg-blue-600 text-white p-2 rounded text-xs hover:bg-blue-700 transition shadow-sm"
          >
            <Plus size={14} /> 新建项目
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-1 bg-emerald-600 text-white p-2 rounded text-xs hover:bg-emerald-700 transition shadow-sm"
          >
            <FileSpreadsheet size={14} /> 智能导入表格
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload}
            className="hidden" 
            accept=".xlsx,.xls,.csv,.txt" 
            title="支持 Excel 自动识别"
          />
        </div>
        <div className="text-[10px] text-slate-400 text-center leading-tight">
          支持上传 Excel 文件，AI 将自动识别时间与逻辑
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
            className={`group flex items-center justify-between p-3 mb-2 rounded cursor-pointer border transition-all select-none ${
              activeProjectId === project.id
                ? 'bg-blue-50 border-blue-300 shadow-sm'
                : 'bg-white border-transparent hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-3 overflow-hidden flex-1">
              <FolderOpen size={16} className={`shrink-0 ${activeProjectId === project.id ? "text-blue-500" : "text-slate-400"}`} />
              <div className="flex flex-col truncate flex-1">
                {editingId === project.id ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={saveEdit}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    className="text-sm font-medium border border-blue-400 rounded px-1 py-0.5 outline-none -ml-1 w-full"
                  />
                ) : (
                  <span 
                    className={`text-sm font-medium truncate ${activeProjectId === project.id ? 'text-blue-800' : 'text-slate-700'}`}
                    onDoubleClick={(e) => startEditing(e, project)}
                    title="双击重命名"
                  >
                    {project.name}
                  </span>
                )}
                <span className="text-xs text-slate-400">
                  {new Date(project.lastModified).toLocaleDateString()}
                </span>
              </div>
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); onDeleteProject(project.id); }}
              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1 transition-opacity"
              title="删除项目"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      
      <div className="p-2 border-t border-slate-200 text-xs text-center text-slate-400">
        双击项目名称可重命名
      </div>
    </div>
  );
};

export default ProjectList;
