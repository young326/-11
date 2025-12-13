
import { GoogleGenAI, Type } from "@google/genai";
import { Task, LinkType, AnalysisResult } from "../types";

// Initialize Gemini Client
// Note: In a real production app, API keys should be handled via backend proxy.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

// Helper: Wait function for backoff
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Wrapper for API calls with retry logic
async function generateContentWithRetry(model: string, contents: string, config: any, retries = 3) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config
      });
      return response;
    } catch (error: any) {
      console.warn(`Gemini API attempt ${i + 1} failed:`, error);
      lastError = error;
      // If it's a client error (4xx), maybe don't retry? 
      // But for "Rpc failed" (often network/timeout), we should retry.
      if (i < retries - 1) {
        await wait(1000 * Math.pow(2, i)); // 1s, 2s, 4s
      }
    }
  }
  throw lastError;
}

// 1. Intelligent Parsing of Schedule Files/Text
export const parseScheduleFromText = async (textContext: string): Promise<{ tasks: Task[], projectStartDate: number } | null> => {
  try {
    const prompt = `你是一位拥有20年经验的工程造价与进度管理专家。
      请对用户上传的工程计划数据进行深度分析、清洗和逻辑重构。

      任务目标：将非结构化或半结构化的表格数据（通常是 Excel 复制粘贴的文本，含制表符或逗号）转换为符合 CPM（关键路径法）计算的双代号网络图数据。

      输入数据内容（JSON/表格/文本）：
      ${textContext.substring(0, 4000)}

      请严格按照以下步骤进行思维链处理：

      1. **识别列含义**：
         - 寻找代表“工作名称”、“工期/持续时间”、“开始时间”、“完成时间”、“紧前工作/前置任务”、“区域/分区”的列。
         - 注意：输入可能是直接从 Excel 粘贴的，包含 Tab 分隔符或换行符。请智能识别行与列的对应关系。
      
      2. **提取日期与工期**：
         - **非常重要**：请提取“开始时间”和“完成时间”的原始字符串（格式标准化为 YYYY-MM-DD）。
         - 如果提供了“工期”，直接使用。如果没有，可以在代码中后续计算。
      
      3. **智能逻辑推断**：
         - **情况A：数据中有“紧前工作”列** -> 清洗数据（去除括号、处理分隔符），直接映射。
         - **情况B：数据中无“紧前工作”列** -> 根据时间线**反推**逻辑关系：
            - 规则：如果 Task A 的“完成时间”等于或略小于 Task B 的“开始时间”，且属于同一工序/区域，则 A 是 B 的紧前工作。
            - 确保网络图尽量闭合。

      4. **数据标准化**：
         - **ID**：如果原数据有编号则使用，否则生成 10, 20... 格式。
         - **Type**：默认为 "Real"。
         - **Zone**：根据内容推断区域，默认为“主体工程”。

      输出要求：
      - 返回严格的 JSON 数组。
      - 不要包含 Markdown 代码块标记。
      `;

    const response = await generateContentWithRetry(
      "gemini-2.5-flash",
      prompt,
      {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: "唯一工作代号" },
              name: { type: Type.STRING, description: "工作名称" },
              duration: { type: Type.NUMBER, description: "工期(天)" },
              startDate: { type: Type.STRING, description: "开始日期 YYYY-MM-DD" },
              endDate: { type: Type.STRING, description: "结束日期 YYYY-MM-DD" },
              predecessors: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "紧前工作ID列表"
              },
              zone: { type: Type.STRING, description: "区域/分区" },
              type: { type: Type.STRING, enum: ["Real", "Virtual"], description: "工作类型" }
            },
            required: ["id", "name", "predecessors", "type"]
          }
        }
      }
    );

    let jsonString = response?.text || "[]";
    
    // Robust Sanitization
    if (jsonString.includes("```")) {
      jsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
    }
    
    const rawTasks = JSON.parse(jsonString);
    
    // --- Post Processing for Dates ---
    // Find the earliest start date in the imported set to use as "Day 0"
    let minDateTimestamp = Infinity;
    
    // Robust Local Date Parsing to avoid UTC shifts
    const parseDate = (str: string) => {
      if(!str) return null;
      // Handle "YYYY/MM/DD", "YYYY-MM-DD", "YYYY.MM.DD"
      const cleaned = str.replace(/[\/\.]/g, '-');
      const parts = cleaned.split('-');
      
      if (parts.length === 3) {
         const y = parseInt(parts[0]);
         const m = parseInt(parts[1]) - 1; // Month is 0-indexed
         const d = parseInt(parts[2]);
         if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
            return new Date(y, m, d); // Local Midnight
         }
      }
      
      // Fallback
      const d = new Date(cleaned);
      if (isNaN(d.getTime())) return null;
      d.setHours(0,0,0,0);
      return d;
    };

    rawTasks.forEach((t: any) => {
      const d = parseDate(t.startDate);
      if (d && d.getTime() < minDateTimestamp) {
        minDateTimestamp = d.getTime();
      }
    });

    // If no valid dates found, fallback to today (0 offset)
    if (minDateTimestamp === Infinity) {
      minDateTimestamp = new Date().setHours(0,0,0,0);
    }

    const tasks = rawTasks.map((t: any) => {
        // Calculate offset days for constraint
        let constraintDate = undefined;
        let duration = Number(t.duration);

        const start = parseDate(t.startDate);
        const end = parseDate(t.endDate);

        if (start) {
          const diff = start.getTime() - minDateTimestamp;
          constraintDate = Math.round(diff / (1000 * 60 * 60 * 24));
        }

        // Auto-calculate duration if missing
        if ((!duration || duration <= 0) && start && end) {
          const diff = end.getTime() - start.getTime();
          duration = Math.round(diff / (1000 * 60 * 60 * 24)) + 1; // Inclusive
        }

        return {
          id: String(t.id || Math.random().toString(36).substr(2, 5)),
          name: String(t.name || "未命名工作"),
          duration: duration || 1,
          constraintDate: constraintDate,
          predecessors: Array.isArray(t.predecessors) ? t.predecessors.map(String) : [],
          type: t.type === "Virtual" ? LinkType.Virtual : LinkType.Real,
          zone: t.zone || "主体工程"
        };
    });

    return { tasks, projectStartDate: minDateTimestamp };

  } catch (error) {
    console.error("Gemini Parse Error:", error);
    // Return null to signal failure
    return null; 
  }
};

// 2. Network Analysis & Suggestions
export const analyzeScheduleWithAI = async (tasks: Task[], criticalPath: string[], duration: number): Promise<string> => {
  try {
    const taskSummary = tasks.map(t => `ID:${t.id} ${t.name} (${t.duration}天) -> 下游:[${t.predecessors.join(',')}]`).join('\n');
    
    const prompt = `作为工程进度控制专家，请根据《工程网络计划技术规程》JGJ/T121-2015 分析以下计划。
      
      【项目概况】
      总工期: ${duration} 天
      关键线路: ${criticalPath.join(' -> ')}
      
      【任务详情】
      ${taskSummary.substring(0, 4000)}
      
      【输出要求】
      请用简练的中文输出以下几点（支持Markdown）：
      1. 🚩 **风险预警**：指出关键路径上最容易延误的节点。
      2. 💡 **优化建议**：如何压缩工期？哪里有自由时差可以利用？
      3. 🔍 **逻辑诊断**：是否存在逻辑断档或不合理的并行施工？
      4. 📊 **综合评分**：0-10分。
      `;

    const response = await generateContentWithRetry(
      "gemini-2.5-flash",
      prompt,
      {}
    );

    return response?.text || "AI 正在思考中，请稍后...";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "分析服务暂时不可用，请检查网络连接或 API Key 设置。";
  }
};
