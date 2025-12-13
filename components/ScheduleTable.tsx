
import React, { useState } from 'react';
import { Task, LinkType } from '../types';
import { Plus, Trash, AlertCircle, Link as LinkIcon, X, CheckSquare, Square, Folder, CornerDownRight } from 'lucide-react';

interface ScheduleTableProps {
  tasks: Task[];
  onUpdateTask: (task: Task) => void;
  onAddTask: () => void;
  onDeleteTask: (id: string) => void;
  projectStartDate: Date;
}

const ScheduleTable: React.FC<ScheduleTableProps> = ({ tasks, onUpdateTask, onAddTask, onDeleteTask, projectStartDate }) => {
  const [linkModalTaskId, setLinkModalTaskId] = useState<string | null>(null);

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

  return (
    <div className="h-full flex flex-col bg-white relative">
      <div className="flex items-center justify-between p-2 bg-slate-100 border-b border-slate-200 shrink-0">
        <h3 className="font-bold text-slate-700 text-sm">工程进度计划表</h3>
        <button 
          onClick={onAddTask}
          className="flex items-center gap-1 text-xs bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700"
        >
          <Plus size={12} /> 新建工作
        </button>
      </div>
      
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs text-left border-collapse min-w-[750px]">
          <thead className="sticky top-0 bg-slate-50 z-10 shadow-sm text-slate-700">
            <tr>
              <th className="p-2 border-b border-slate-200 font-semibold w-12 text-center">代号</th>
              <th className="p-2 border-b border-slate-200 font-semibold w-24">工区</th>
              <th className="p-2 border-b border-slate-200 font-semibold w-40">工作名称</th>
              <th className="p-2 border-b border-slate-200 font-semibold w-12 text-center">工期</th>
              <th className="p-2 border-b border-slate-200 font-semibold w-20">类型</th>
              <th className="p-2 border-b border-slate-200 font-semibold w-32">紧前工作</th>
              <th className="p-2 border-b border-slate-200 font-semibold w-28">开始</th>
              <th className="p-2 border-b border-slate-200 font-semibold w-28">结束</th>
              <th className="p-2 border-b border-slate-200 font-semibold w-10 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              // Calculate inclusive end date for display
              // If duration > 0, end date is (start + duration - 1)
              // If duration == 0, end date is same as start
              const displayEndOffset = (task.earlyFinish || 0) > (task.earlyStart || 0) 
                 ? (task.earlyFinish || 0) - 1 
                 : (task.earlyFinish || 0);

              return (
              <tr key={task.id} className={`hover:bg-slate-50 border-b border-slate-100 group ${task.isCritical ? 'bg-red-50/50' : ''}`}>
                <td className="p-1">
                  <input 
                    type="text" 
                    value={task.id}
                    onChange={(e) => onUpdateTask({ ...task, id: e.target.value })}
                    className="w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-1 truncate text-center transition-colors"
                  />
                </td>
                <td className="p-1">
                  <input 
                    type="text" 
                    value={task.zone || ''}
                    placeholder="请输入工区"
                    onChange={(e) => onUpdateTask({ ...task, zone: e.target.value })}
                    className="w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-1 truncate transition-colors text-slate-600"
                  />
                </td>
                <td className="p-1">
                  <div className="flex items-center" style={{ paddingLeft: task.parentId ? 20 : 0 }}>
                    {task.parentId ? <CornerDownRight size={12} className="text-slate-400 mr-1 shrink-0" /> : <Folder size={12} className="text-blue-300 mr-1 shrink-0 opacity-50" />}
                    <input 
                      type="text" 
                      value={task.name}
                      onKeyDown={(e) => handleKeyDown(e, task)}
                      onChange={(e) => onUpdateTask({ ...task, name: e.target.value })}
                      className="w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-1 truncate font-medium text-slate-700 transition-colors"
                    />
                  </div>
                </td>
                <td className="p-1">
                  <input 
                    type="number" 
                    min="0"
                    value={task.duration}
                    onChange={(e) => onUpdateTask({ ...task, duration: parseInt(e.target.value) || 0 })}
                    className="w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-1 text-center transition-colors"
                  />
                </td>
                <td className="p-1">
                  <select 
                    value={task.type}
                    onChange={(e) => handleTypeChange(task, e.target.value as LinkType)}
                    className="w-full bg-transparent text-xs focus:ring-blue-500 border-none px-0 cursor-pointer text-slate-600"
                  >
                    <option value={LinkType.Real}>实工作</option>
                    <option value={LinkType.Virtual}>虚工作</option>
                    <option value={LinkType.Wavy}>里程碑</option>
                  </select>
                </td>
                <td className="p-1">
                   <div className="flex items-center gap-1 group/pred relative">
                     <input 
                        type="text"
                        value={task.predecessors.join(',')}
                        onChange={(e) => handlePredecessorsTextChange(task, e.target.value)}
                        placeholder="无"
                        className="w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-1 truncate transition-colors text-slate-600 text-[11px]"
                     />
                     <button 
                        onClick={() => setLinkModalTaskId(task.id)}
                        className="opacity-0 group-hover/pred:opacity-100 absolute right-0 top-1/2 -translate-y-1/2 bg-slate-100 hover:bg-blue-100 text-slate-400 hover:text-blue-600 p-0.5 rounded border border-slate-200 transition-all"
                        title="选择紧前工作"
                     >
                        <LinkIcon size={10} />
                     </button>
                   </div>
                </td>
                <td className="p-1">
                  <input 
                    type="date" 
                    value={formatDateForInput(task.earlyStart)}
                    onChange={(e) => handleStartChange(task, e.target.value)}
                    className="w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-1 text-xs text-slate-600 font-mono"
                  />
                </td>
                <td className="p-1">
                  <input 
                    type="date" 
                    value={formatDateForInput(displayEndOffset)}
                    onChange={(e) => handleEndChange(task, e.target.value)}
                    className="w-full bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-1 text-xs text-slate-600 font-mono"
                  />
                </td>
                <td className="p-1 text-center">
                  <button onClick={() => onDeleteTask(task.id)} className="text-slate-300 hover:text-red-500 transition-colors" title="删除工作">
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
            <span>暂无工作任务，请点击“新建工作”或从左侧导入。</span>
          </div>
        )}
      </div>

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
