import React from 'react';
import { Task, LinkType } from '../types';
import { Plus, Trash, AlertCircle } from 'lucide-react';

interface ScheduleTableProps {
  tasks: Task[];
  onUpdateTask: (task: Task) => void;
  onAddTask: () => void;
  onDeleteTask: (id: string) => void;
}

const ScheduleTable: React.FC<ScheduleTableProps> = ({ tasks, onUpdateTask, onAddTask, onDeleteTask }) => {
  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center justify-between p-2 bg-slate-100 border-b border-slate-200">
        <h3 className="font-bold text-slate-700 text-sm">工程进度计划表</h3>
        <button 
          onClick={onAddTask}
          className="flex items-center gap-1 text-xs bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700"
        >
          <Plus size={12} /> 新建工作
        </button>
      </div>
      
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs text-left border-collapse">
          <thead className="sticky top-0 bg-slate-50 z-10 shadow-sm">
            <tr>
              <th className="p-2 border-b border-slate-200 font-semibold text-slate-600 w-12">代号</th>
              <th className="p-2 border-b border-slate-200 font-semibold text-slate-600">工作名称</th>
              <th className="p-2 border-b border-slate-200 font-semibold text-slate-600 w-16">工期(天)</th>
              <th className="p-2 border-b border-slate-200 font-semibold text-slate-600 w-24">工作类型</th>
              <th className="p-2 border-b border-slate-200 font-semibold text-slate-600">紧前工作</th>
              <th className="p-2 border-b border-slate-200 font-semibold text-slate-600 w-24">最早开始/完成</th>
              <th className="p-2 border-b border-slate-200 font-semibold text-slate-600 w-24">最迟开始/完成</th>
              <th className="p-2 border-b border-slate-200 font-semibold text-slate-600 w-10">操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} className={`hover:bg-slate-50 border-b border-slate-100 ${task.isCritical ? 'bg-red-50' : ''}`}>
                <td className="p-1">
                  <input 
                    type="text" 
                    value={task.id}
                    onChange={(e) => onUpdateTask({ ...task, id: e.target.value })}
                    className="w-full bg-transparent border-none focus:ring-1 focus:ring-blue-500 rounded px-1"
                  />
                </td>
                <td className="p-1">
                  <input 
                    type="text" 
                    value={task.name}
                    onChange={(e) => onUpdateTask({ ...task, name: e.target.value })}
                    className="w-full bg-transparent border-none focus:ring-1 focus:ring-blue-500 rounded px-1"
                  />
                </td>
                <td className="p-1">
                  <input 
                    type="number" 
                    min="0"
                    value={task.duration}
                    onChange={(e) => onUpdateTask({ ...task, duration: parseInt(e.target.value) || 0 })}
                    className="w-full bg-transparent border-none focus:ring-1 focus:ring-blue-500 rounded px-1"
                  />
                </td>
                <td className="p-1">
                  <select 
                    value={task.type}
                    onChange={(e) => onUpdateTask({ ...task, type: e.target.value as LinkType })}
                    className="w-full bg-transparent text-xs focus:ring-blue-500 border-none"
                  >
                    <option value={LinkType.Real}>实工作</option>
                    <option value={LinkType.Virtual}>虚工作</option>
                    <option value={LinkType.Wavy}>里程碑</option>
                  </select>
                </td>
                <td className="p-1">
                  <input 
                    type="text" 
                    value={task.predecessors.join(',')}
                    onChange={(e) => onUpdateTask({ ...task, predecessors: e.target.value.split(',').map(s => s.trim()).filter(s => s) })}
                    placeholder="如: A, B"
                    className="w-full bg-transparent border-none focus:ring-1 focus:ring-blue-500 rounded px-1"
                  />
                </td>
                <td className="p-2 text-slate-500 font-mono">
                  {task.earlyStart !== undefined ? `${task.earlyStart} - ${task.earlyFinish}` : '-'}
                </td>
                <td className="p-2 text-slate-500 font-mono">
                  {task.lateStart !== undefined ? `${task.lateStart} - ${task.lateFinish}` : '-'}
                </td>
                <td className="p-1 text-center">
                  <button onClick={() => onDeleteTask(task.id)} className="text-slate-400 hover:text-red-500" title="删除工作">
                    <Trash size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-20 text-slate-400 text-sm">
            <AlertCircle className="mb-1" size={16} />
            暂无工作任务，请点击新建或导入计划。
          </div>
        )}
      </div>
    </div>
  );
};

export default ScheduleTable;