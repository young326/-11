import React, { useState } from 'react';
import { analyzeScheduleWithAI } from '../services/geminiService';
import { Task } from '../types';
import { Sparkles, X, MessageSquare, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface AIAssistantProps {
  tasks: Task[];
  criticalPath: string[];
  projectDuration: number;
}

const AIAssistant: React.FC<AIAssistantProps> = ({ tasks, criticalPath, projectDuration }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [analysis, setAnalysis] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    setLoading(true);
    const result = await analyzeScheduleWithAI(tasks, criticalPath, projectDuration);
    setAnalysis(result);
    setLoading(false);
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-full shadow-lg z-50 flex items-center gap-2 transition-transform hover:scale-105"
      >
        <Sparkles size={20} />
        <span className="font-medium pr-1">AI 助手</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[500px] bg-white rounded-lg shadow-2xl border border-slate-200 z-50 flex flex-col">
      <div className="p-3 bg-indigo-600 text-white rounded-t-lg flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Sparkles size={18} />
          <span className="font-bold text-sm">IntelliPlan 智能助手</span>
        </div>
        <button onClick={() => setIsOpen(false)} className="hover:bg-indigo-500 rounded p-1">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 p-4 overflow-y-auto bg-slate-50 text-sm text-slate-700">
        {!analysis && !loading && (
          <div className="text-center mt-10 text-slate-400">
            <MessageSquare className="mx-auto mb-2 opacity-50" size={32} />
            <p>准备好分析您的进度计划。</p>
            <p className="text-xs mt-2">我可以基于 JGJ/T121-2015 规范识别风险、关键路径并提出优化建议。</p>
          </div>
        )}
        
        {loading && (
          <div className="flex flex-col items-center justify-center h-full text-indigo-600">
            <Loader2 className="animate-spin mb-2" size={24} />
            <span>思考中...</span>
          </div>
        )}

        {analysis && (
          <div className="prose prose-sm max-w-none prose-indigo">
             {/* Note: In a real app, import react-markdown properly. Using a simple text dump for now if lib missing, 
                 but configured purely for text display in this constrained environment */}
             <div className="whitespace-pre-wrap">{analysis}</div> 
          </div>
        )}
      </div>

      <div className="p-3 border-t border-slate-200 bg-white rounded-b-lg">
        <button 
          onClick={handleAnalyze}
          disabled={loading || tasks.length === 0}
          className="w-full bg-indigo-100 text-indigo-700 hover:bg-indigo-200 font-medium py-2 rounded transition flex justify-center items-center gap-2 disabled:opacity-50"
        >
          {loading ? "分析中..." : "生成评估建议"}
        </button>
      </div>
    </div>
  );
};

export default AIAssistant;