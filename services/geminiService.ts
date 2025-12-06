import { GoogleGenAI, Type } from "@google/genai";
import { Task, LinkType, AnalysisResult } from "../types";

// Initialize Gemini Client
// Note: In a real production app, API keys should be handled via backend proxy.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

// 1. Intelligent Parsing of Schedule Files/Text
export const parseScheduleFromText = async (textContext: string): Promise<Task[]> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `你是一位专业的工程进度计划编制专家。
      请分析以下代表工程项目计划的文本（内容可能来自CSV、Excel、Project、P6等导出数据）。
      请提取任务（工作）、工期（持续时间）和紧前工作（依赖关系）。
      
      规则：
      - 如果未指定工期，默认设为 1 天。
      - 如果未指定紧前工作，若逻辑合理则按列表顺序假设，否则设为无。
      - 识别任务类型：是实际施工的“Real”（实工作）还是仅表示逻辑关系的“Virtual”（虚工作，工期通常为0）。
      - 严格返回 JSON 格式数据。
      
      输入文本：
      ${textContext.substring(0, 30000)}`, // Limit context
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: "唯一工作代号 (如 A, 1, 101)" },
              name: { type: Type.STRING, description: "工作名称 (请确保是中文)" },
              duration: { type: Type.NUMBER, description: "持续时间 (天)" },
              predecessors: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "紧前工作代号列表"
              },
              zone: { type: Type.STRING, description: "施工分区" },
              type: { type: Type.STRING, enum: ["Real", "Virtual"], description: "Real(实工作) 或 Virtual(虚工作)" }
            },
            required: ["id", "name", "duration", "predecessors", "type"]
          }
        }
      }
    });

    const rawTasks = JSON.parse(response.text || "[]");
    
    // Map to our internal type safely
    return rawTasks.map((t: any) => ({
        id: t.id,
        name: t.name,
        duration: t.duration,
        predecessors: t.predecessors,
        type: t.type === "Virtual" ? LinkType.Virtual : LinkType.Real,
        zone: t.zone || "主体工程"
    }));

  } catch (error) {
    console.error("Gemini Parse Error:", error);
    throw new Error("AI智能识别失败。请检查API Key或文件内容格式是否清晰。");
  }
};

// 2. Network Analysis & Suggestions
export const analyzeScheduleWithAI = async (tasks: Task[], criticalPath: string[], duration: number): Promise<string> => {
  try {
    const taskSummary = tasks.map(t => `代号:${t.id} 名称:${t.name} (工期:${t.duration}天) [紧前:${t.predecessors.join(',')}]`).join('\n');
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `请分析以下建筑工程网络进度计划。
      
      项目总工期: ${duration} 天。
      关键路径(Critical Path): ${criticalPath.join(' -> ')}。
      
      工作任务列表:
      ${taskSummary}
      
      请依据《工程网络计划技术规程》JGJ/T121-2015，使用简体中文提供专业的工程评估建议。
      
      输出内容必须包含：
      1. **关键路径风险评估**：分析关键节点是否存在延误风险。
      2. **工期优化建议**：如何通过调整资源或逻辑关系缩短工期。
      3. **逻辑检查**：检查是否存在潜在的逻辑错误（如断路、死循环等）。
      4. **总体评价**：对当前计划的可行性给出评分（1-10分）和简述。
      `,
    });

    return response.text || "未能生成分析结果。";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "AI 分析服务当前不可用，请检查网络或API设置。";
  }
};