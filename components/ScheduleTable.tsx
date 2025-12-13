
import React, { useState, useRef } from 'react';
import { Task, LinkType } from '../types';
import { Plus, Trash, AlertCircle, Link as LinkIcon, X, CheckSquare, Square, Folder, CornerDownRight, FileSpreadsheet, Download, Upload, ExternalLink } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ScheduleTableProps {
  tasks: Task[];
  onUpdateTask: (task: Task) => void;
  onAddTask: () => void;
  onDeleteTask: (id: string) => void;
  onReplaceTasks: (tasks: Task[]) => void;
  projectStartDate: Date;
}

const ScheduleTable: React.FC<ScheduleTableProps> = ({ tasks, onUpdateTask, onAddTask, onDeleteTask, onReplaceTasks, projectStartDate }) => {
  const [linkModalTaskId, setLinkModalTaskId] = useState<string | null>(null);
  const [isWpsModalOpen, setIsWpsModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const togglePredecessor = (targetTask: Task, predId: string) => {
    const currentPreds = targetTask.predecessors || [];
    let newPreds;
    if (currentPreds.includes(predId)) {
      newPreds = currentPreds.filter(id => id !== predId);
    } else {
      newPreds = [...currentPreds, predId];
    }
    onUpdateTask({ ...targetTask, predecessors: newPreds });
  };

  const editingTask = tasks.find(t => t.id === linkModalTaskId);

  // Date Utilities (Robust Local Time)
  const formatDateForInput = (offset?: number) => {
    if (offset === undefined) return '';
    // Construct local date from project start (midnight)
    const start = new Date(projectStartDate);
    start.setHours(0,0,0,0);
    
    const d = new Date(start);
    d.setDate(d.getDate() + offset);
    
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const getDaysFromDateStr = (dateStr: string) => {
    // Parse input string "YYYY-MM-DD" directly to avoid UTC issues
    const [y, m, d] = dateStr.split('-').map(Number);
    const target = new Date(y, m - 1, d); // Local Midnight
    
    const start = new Date(projectStartDate);
    start.setHours(0,0,0,0); // Local Midnight

    const diffTime = target.getTime() - start.getTime();
    return Math.round(diffTime / (1000 * 3600 * 24));
  };

  const handleStartChange = (task: Task, dateStr: string) => {
    if (!dateStr) {
      // If cleared, remove the constraint
      const { constraintDate, ...rest } = task;
      onUpdateTask(rest);
      return;
    }
    const newStart = getDaysFromDateStr(dateStr);
    // Setting start date explicitly acts as a Constraint (SNET)
    onUpdateTask({ ...task, constraintDate: newStart });
  };

  const handleEndChange = (task: Task, dateStr: string) => {
    if (!dateStr) return;
    const selectedDateOffset = getDaysFromDateStr(dateStr);
    
    // Use the calculated earlyStart (which is robust from CPM pass)
    const currentStart = task.earlyStart || 0;
    
    // Calculate new duration. 
    // Selected Date is Inclusive. 
    // Example: Start Day 0. Select Day 0 as end. Duration should be 1.
    // Duration = (Selected - Start) + 1
    const newDuration = Math.max(0, (selectedDateOffset - currentStart) + 1);
    
    onUpdateTask({ ...task, duration: newDuration });
  };

  const handlePredecessorsTextChange = (task: Task, text: string) => {
    // Split by comma, space, or Chinese comma
    const preds = text.split(/[,，\s]+/).filter(id => id.trim() !== '');
    onUpdateTask({ ...task, predecessors: preds });
  };

  const handleTypeChange = (task: Task, newType: LinkType) => {
    // If switching to Milestone (Wavy), default duration to 1 if not already
    let updates: Partial<Task> = { type: newType };
    if (newType === LinkType.Wavy) {
      updates.duration = 1;
    }
    onUpdateTask({ ...task, ...updates });
  };

  const handleKeyDown = (e: React.KeyboardEvent, task: Task) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      // Indent: make child (simple visual hierarchy logic could be adding parentId)
      const idx = tasks.findIndex(t => t.id === task.id);
      if (idx > 0) {
        onUpdateTask({ ...task, parentId: tasks[idx-1].id });
      }
    } else if (e.key === 'Backspace' && (e.target as HTMLInputElement).selectionStart === 0) {
      // Outdent
      if (task.parentId) {
         onUpdateTask({ ...task, parentId: undefined });
      }
    }
  };

  // --- WPS / Excel Import/Export Logic ---
  const typeMap: Record<string, string> = {
     [LinkType.Real]: "实工作",
     [LinkType.Virtual]: "虚工作",
     [LinkType.Wavy]: "里程碑"
  };
  const reverseTypeMap: Record<string, LinkType> = {
      "实工作": LinkType.Real,
      "虚工作": LinkType.Virtual,
      "里程碑": LinkType.Wavy
  };

  const handleDownloadExcel = () => {
     const data = tasks.map(t => ({
         "代号": t.id,
         "工作名称": t.name,
         "工期": t.duration,
         "区域": t.zone || "",
         "类型": typeMap[t.type] || "实工作",
         "紧前工作": t.predecessors ? t.predecessors.join(',') : "",
         "备注": t.description || "",
         // Informational columns (Not necessarily imported back unless logic changes)
         "开始时间(参考)": formatDateForInput(t.earlyStart),
         "结束时间(参考)": formatDateForInput(t.earlyFinish ? t.earlyFinish - 1 : t.earlyStart)
     }));

     const ws = XLSX.utils.json_to_sheet(data);
     
     // Set column widths
     ws['!cols'] = [
         { wch: 10 }, // ID
         { wch: 30 }, // Name
         { wch: 8 },  // Duration
         { wch: 15 }, // Zone
         { wch: 10 }, // Type
         { wch: 20 }, // Predecessors
         { wch: 20 }, // Desc
         { wch: 15 }, // Start
         { wch: 15 }, // End
     ];

     const wb = XLSX.utils.book_new();
     XLSX.utils.book_append_sheet(wb, ws, "进度计划");
     XLSX.writeFile(wb, `Schedule_${new Date().toLocaleDateString().replace(/\//g,'-')}.xlsx`);
  };

  const handleUploadExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
          const data = await file.arrayBuffer();
          const workbook = XLSX.read(data);
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          // Use raw: false to try to get formatted string for dates if possible
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false });

          if (!Array.isArray(jsonData) || jsonData.length === 0) {
              alert("文件内容为空或格式不正确");
              return;
          }

          // Helper to find value from potential columns (Case-insensitive, trimmed)
          const findVal = (row: any, candidates: string[]): string => {
             const keys = Object.keys(row);
             for (const candidate of candidates) {
                 const found = keys.find(k => k.trim().toLowerCase() === candidate.toLowerCase());
                 if (found) return String(row[found] || "");
             }
             return "";
          };

          const newTasks: Task[] = jsonData.map((row: any) => {
              const id = findVal(row, ["代号", "ID", "编号", "Code"]) || Math.random().toString(36).substr(2, 5);
              const name = findVal(row, ["工作名称", "名称", "Task Name", "Name"]) || "未命名";
              let duration = parseInt(findVal(row, ["工期", "Duration", "Days", "持续时间"])) || 0;
              const zone = findVal(row, ["区域", "分区", "Zone", "Area"]);
              
              let typeStr = findVal(row, ["类型", "Type"]);
              if (!typeStr) typeStr = "实工作";
              const type = reverseTypeMap[typeStr] || LinkType.Real;
              
              const predsRaw = findVal(row, ["紧前工作", "Predecessors", "前置任务"]);
              const predecessors = predsRaw.split(/[,，\s]+/).filter((s: string) => s.trim() !== "");
              
              const desc = findVal(row, ["备注", "Description", "Notes"]);

              // Enhanced Date Parsing
              const parseDate = (str: string) => {
                 if (!str) return null;
                 let s = str.trim();
                 if (!s) return null;
                 
                 // Handle Excel serial number strings (unlikely with raw:false but possible)
                 if (/^\d{5}$/.test(s)) {
                     // Simple heuristic for excel date serials (e.g. 45000)
                     const date = XLSX.SSF.parse_date_code(Number(s));
                     if (date) return new Date(date.y, date.m - 1, date.d);
                 }

                 // Handle Chinese YYYY年MM月DD日
                 s = s.replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
                 // Normalize separators
                 s = s.replace(/\//g, '-').replace(/\./g, '-');
                 
                 // Try manual parse for YYYY-MM-DD (most reliable)
                 const parts = s.split('-');
                 if (parts.length === 3) {
                     const y = parseInt(parts[0]);
                     const m = parseInt(parts[1]) - 1;
                     const d = parseInt(parts[2]);
                     if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                         // Heuristic: If first part > 1900, it's YMD
                         if (y > 1900) return new Date(y, m, d);
                         // If last part > 1900, it's DMY or MDY. Assume MDY if ambiguous or just use Date parser
                     }
                 }
                 
                 // Fallback to JS parsing (replace dashes with slashes for Local Time heuristic)
                 const d = new Date(s.replace(/-/g, '/'));
                 return isNaN(d.getTime()) ? null : d;
              };

              const startStr = findVal(row, ["开始时间(参考)", "开始时间", "开始日期", "开始", "Start", "Start Date"]);
              const endStr = findVal(row, ["结束时间(参考)", "结束时间", "结束日期", "结束", "完成时间", "完成", "End", "End Date", "Finish"]);
              
              let constraintDate: number | undefined = undefined;
              
              const startObj = parseDate(startStr);
              const endObj = parseDate(endStr);

              // Calculate Constraint based on Project Start Date
              if (startObj) {
                  startObj.setHours(0,0,0,0);
                  const anchor = new Date(projectStartDate);
                  anchor.setHours(0,0,0,0);
                  const diff = startObj.getTime() - anchor.getTime();
                  constraintDate = Math.round(diff / (1000 * 3600 * 24));
              }
              
              // If Start and End are present, recalculate duration to correct any mismatch
              if (startObj && endObj) {
                  endObj.setHours(0,0,0,0);
                  const diff = endObj.getTime() - startObj.getTime();
                  const calcDur = Math.round(diff / (1000 * 3600 * 24)) + 1;
                  if (calcDur >= 0) duration = calcDur;
              }

              return {
                  id,
                  name,
                  duration: type === LinkType.Wavy ? 0 : duration, 
                  type,
                  zone,
                  predecessors,
                  description: desc,
                  constraintDate 
              };
          });

          onReplaceTasks(newTasks);
          setIsWpsModalOpen(false);
          alert(`成功导入 ${newTasks.length} 项工作任务`);

      } catch (err) {
          console.error(err);
          alert("导入失败，请确保文件格式正确 (Excel .xlsx)");
      } finally {
          if (fileInputRef.current) fileInputRef.current.value = "";
      }
  };

  return (
    <div className="h-full flex flex-col bg-white relative">
      <div className="flex items-center justify-between p-2 bg-slate-100 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-700 text-sm">工程进度计划表</h3>
            <div className="h-4 w-px bg-slate-300 mx-1"></div>
            <button 
                onClick={() => setIsWpsModalOpen(true)}
                className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded hover:bg-emerald-100 transition-colors"
                title="导出到WPS编辑，或导入WPS文件"
            >
                <FileSpreadsheet size={12} /> WPS 表格编辑
            </button>
        </div>
        <button 
          onClick={onAddTask}
          className="flex items-center gap-1 text-xs bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700"
        >
          <Plus size={12} /> 新建工作
        </button>
      </div>
      
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs text-left border-collapse min-w-[750px] border border-slate-200">
          <thead className="sticky top-0 bg-slate-50 z-10 shadow-sm text-slate-700">
            <tr>
              <th className="p-1 border border-slate-300 font-semibold w-12 text-center bg-slate-100">代号</th>
              <th className="p-1 border border-slate-300 font-semibold w-24 bg-slate-100">区域</th>
              <th className="p-1 border border-slate-300 font-semibold w-40 bg-slate-100">工作名称</th>
              <th className="p-1 border border-slate-300 font-semibold w-12 text-center bg-slate-100">工期</th>
              <th className="p-1 border border-slate-300 font-semibold w-20 bg-slate-100">类型</th>
              <th className="p-1 border border-slate-300 font-semibold w-32 bg-slate-100">紧前工作</th>
              <th className="p-1 border border-slate-300 font-semibold w-28 bg-slate-100">开始</th>
              <th className="p-1 border border-slate-300 font-semibold w-28 bg-slate-100">结束</th>
              <th className="p-1 border border-slate-300 font-semibold w-10 text-center bg-slate-100">操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task, index) => {
              // Calculate inclusive end date for display
              // If duration > 0, end date is (start + duration - 1)
              // If duration == 0, end date is same as start
              const displayEndOffset = (task.earlyFinish || 0) > (task.earlyStart || 0) 
                 ? (task.earlyFinish || 0) - 1 
                 : (task.earlyFinish || 0);

              const rowClass = index % 2 === 0 ? "bg-white" : "bg-slate-50/50";

              return (
              <tr key={task.id} className={`${rowClass} hover:bg-blue-50/30 group ${task.isCritical ? 'bg-red-50/30' : ''}`}>
                <td className="p-0 border border-slate-300 h-8">
                  <input 
                    type="text" 
                    value={task.id}
                    onChange={(e) => onUpdateTask({ ...task, id: e.target.value })}
                    className="w-full h-full bg-transparent px-1 text-center outline-none focus:bg-blue-50 focus:shadow-inner"
                  />
                </td>
                <td className="p-0 border border-slate-300 h-8">
                  <input 
                    type="text" 
                    value={task.zone || ''}
                    placeholder=""
                    onChange={(e) => onUpdateTask({ ...task, zone: e.target.value })}
                    className="w-full h-full bg-transparent px-1 outline-none focus:bg-blue-50 text-slate-600"
                  />
                </td>
                <td className="p-0 border border-slate-300 h-8">
                  <div className="flex items-center h-full" style={{ paddingLeft: task.parentId ? 20 : 4 }}>
                    {task.parentId ? <CornerDownRight size={12} className="text-slate-400 mr-1 shrink-0" /> : <Folder size={12} className="text-blue-300 mr-1 shrink-0 opacity-50" />}
                    <input 
                      type="text" 
                      value={task.name}
                      onKeyDown={(e) => handleKeyDown(e, task)}
                      onChange={(e) => onUpdateTask({ ...task, name: e.target.value })}
                      className="w-full h-full bg-transparent outline-none focus:bg-blue-50 font-medium text-slate-700"
                    />
                  </div>
                </td>
                <td className="p-0 border border-slate-300 h-8">
                  <input 
                    type="number" 
                    min="0"
                    value={task.duration}
                    onChange={(e) => onUpdateTask({ ...task, duration: parseInt(e.target.value) || 0 })}
                    className="w-full h-full bg-transparent px-1 text-center outline-none focus:bg-blue-50"
                  />
                </td>
                <td className="p-0 border border-slate-300 h-8">
                  <select 
                    value={task.type}
                    onChange={(e) => handleTypeChange(task, e.target.value as LinkType)}
                    className="w-full h-full bg-transparent text-xs outline-none px-1 cursor-pointer text-slate-600 border-none appearance-none"
                  >
                    <option value={LinkType.Real}>实工作</option>
                    <option value={LinkType.Virtual}>虚工作</option>
                    <option value={LinkType.Wavy}>里程碑</option>
                  </select>
                </td>
                <td className="p-0 border border-slate-300 h-8 relative group/pred">
                   <input 
                      type="text"
                      value={task.predecessors.join(',')}
                      onChange={(e) => handlePredecessorsTextChange(task, e.target.value)}
                      className="w-full h-full bg-transparent px-1 outline-none focus:bg-blue-50 text-slate-600 text-[11px]"
                   />
                   <button 
                      onClick={() => setLinkModalTaskId(task.id)}
                      className="opacity-0 group-hover/pred:opacity-100 absolute right-0 top-0 bottom-0 bg-slate-100 hover:bg-blue-100 text-slate-400 hover:text-blue-600 px-1 border-l border-slate-200"
                      title="选择紧前工作"
                   >
                      <LinkIcon size={12} />
                   </button>
                </td>
                <td className="p-0 border border-slate-300 h-8">
                  <input 
                    type="date" 
                    value={formatDateForInput(task.earlyStart)}
                    onChange={(e) => handleStartChange(task, e.target.value)}
                    className="w-full h-full bg-transparent px-1 outline-none focus:bg-blue-50 text-xs text-slate-600 font-mono"
                  />
                </td>
                <td className="p-0 border border-slate-300 h-8">
                  <input 
                    type="date" 
                    value={formatDateForInput(displayEndOffset)}
                    onChange={(e) => handleEndChange(task, e.target.value)}
                    className="w-full h-full bg-transparent px-1 outline-none focus:bg-blue-50 text-xs text-slate-600 font-mono"
                  />
                </td>
                <td className="p-0 border border-slate-300 h-8 text-center bg-white">
                  <button onClick={() => onDeleteTask(task.id)} className="text-slate-300 hover:text-red-500 transition-colors h-full w-full flex items-center justify-center" title="删除工作">
                    <Trash size={13} />
                  </button>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-slate-400 text-sm">
            <AlertCircle className="mb-2" size={20} />
            <span>暂无工作任务，请点击“新建工作”或使用“粘贴导入”功能。</span>
          </div>
        )}
      </div>

      {/* WPS / Excel Modal */}
      {isWpsModalOpen && (
          <div className="absolute inset-0 z-50 bg-slate-900/10 backdrop-blur-[2px] flex items-center justify-center p-4">
              <div className="bg-white rounded-lg shadow-2xl border border-slate-200 w-full max-w-md flex flex-col animate-in fade-in zoom-in duration-200">
                  <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/80 rounded-t-lg">
                      <h4 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                          <FileSpreadsheet size={18} className="text-emerald-600"/>
                          在 WPS / Excel 中编辑
                      </h4>
                      <button onClick={() => setIsWpsModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                          <X size={18} />
                      </button>
                  </div>
                  
                  <div className="p-6 space-y-6">
                      {/* Step 1 */}
                      <div className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</div>
                          <div className="flex-1">
                              <h5 className="text-sm font-bold text-slate-700 mb-1">下载进度计划表</h5>
                              <p className="text-xs text-slate-500 mb-2">将当前工程数据导出为 Excel 文件 (.xlsx)。</p>
                              <button 
                                  onClick={handleDownloadExcel}
                                  className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded text-xs hover:bg-slate-50 hover:text-blue-600 transition shadow-sm"
                              >
                                  <Download size={14}/> 下载文件
                              </button>
                          </div>
                      </div>

                      {/* Step 2 */}
                      <div className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</div>
                          <div className="flex-1">
                              <h5 className="text-sm font-bold text-slate-700 mb-1">使用 WPS / Excel 编辑</h5>
                              <p className="text-xs text-slate-500">打开下载的文件，修改代号、名称、工期、区域或紧前工作关系。修改完成后请保存。</p>
                          </div>
                      </div>

                      {/* Step 3 */}
                      <div className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</div>
                          <div className="flex-1">
                              <h5 className="text-sm font-bold text-slate-700 mb-1">上传修改后的文件</h5>
                              <p className="text-xs text-slate-500 mb-2">重新上传文件以更新系统中的进度计划。</p>
                              <div 
                                  onClick={() => fileInputRef.current?.click()}
                                  className="border-2 border-dashed border-slate-300 rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition group"
                              >
                                  <Upload size={24} className="text-slate-400 group-hover:text-emerald-500 mb-1"/>
                                  <span className="text-xs text-slate-500 group-hover:text-emerald-600">点击上传或拖拽文件至此</span>
                                  <input 
                                      type="file" 
                                      ref={fileInputRef} 
                                      className="hidden" 
                                      accept=".xlsx,.xls" 
                                      onChange={handleUploadExcel}
                                  />
                              </div>
                          </div>
                      </div>
                  </div>
                  
                  <div className="p-4 border-t border-slate-100 bg-slate-50/50 rounded-b-lg flex justify-center">
                     <p className="text-[10px] text-slate-400">提示：修改代号或紧前工作时，请确保逻辑闭合，避免循环引用。</p>
                  </div>
              </div>
          </div>
      )}

      {/* Link Modal */}
      {linkModalTaskId && editingTask && (
        <div className="absolute inset-0 z-50 bg-slate-900/10 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl border border-slate-200 w-full max-w-sm flex flex-col max-h-[80%] animate-in fade-in zoom-in duration-200 ring-1 ring-slate-900/5">
            <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-lg">
              <h4 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                <LinkIcon size={14} className="text-blue-500"/>
                设置紧前工作: <span className="text-blue-700">{editingTask.name}</span>
              </h4>
              <button onClick={() => setLinkModalTaskId(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X size={16} />
              </button>
            </div>
            
            <div className="p-2 flex-1 overflow-y-auto">
              <div className="text-xs text-slate-500 mb-2 px-1">请勾选此工作的前置任务（依赖关系）：</div>
              {tasks.filter(t => t.id !== editingTask.id).map(t => {
                 const isSelected = editingTask.predecessors.includes(t.id);
                 return (
                   <div 
                    key={t.id} 
                    onClick={() => togglePredecessor(editingTask, t.id)}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer mb-1 border transition-all ${
                      isSelected 
                        ? 'bg-blue-50 border-blue-200 shadow-sm' 
                        : 'hover:bg-slate-50 border-transparent text-slate-500'
                    }`}
                   >
                     {isSelected ? 
                       <CheckSquare size={16} className="text-blue-600" /> : 
                       <Square size={16} className="text-slate-300" />
                     }
                     <div className="flex-1 overflow-hidden">
                       <div className="font-medium text-xs truncate">
                         <span className="inline-block bg-slate-200 rounded px-1.5 py-0.5 mr-1.5 text-[10px] text-slate-600 font-mono">{t.id}</span>
                         {t.name}
                       </div>
                       <div className="text-[10px] text-slate-400 mt-0.5 flex gap-2">
                         <span>工期: {t.duration}天</span>
                         {t.zone && <span>分区: {t.zone}</span>}
                       </div>
                     </div>
                   </div>
                 );
              })}
              {tasks.length <= 1 && <div className="text-center text-slate-400 text-xs py-8">暂无其他任务可选</div>}
            </div>

            <div className="p-3 border-t border-slate-100 flex justify-end bg-slate-50/50 rounded-b-lg">
              <button 
                onClick={() => setLinkModalTaskId(null)}
                className="bg-blue-600 text-white text-xs px-4 py-2 rounded shadow hover:bg-blue-700 transition-colors font-medium"
              >
                完成设置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleTable;
