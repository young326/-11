import React, { useEffect, useRef, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { Task, LinkType } from '../types';
import { ZoomIn, ZoomOut, Download, Type, BoxSelect, Settings, Calendar, MousePointer2, Layers } from 'lucide-react';

interface NetworkDiagramProps {
  tasks: Task[];
  onUpdateAnalysis: (criticalPath: string[], duration: number) => void;
}

type ViewMode = 'day' | 'month' | 'year';

// 样式常量，参考提供的工程图片
const STYLES = {
  gridColor: '#06b6d4', // 青色网格线
  gridOpacity: 0.3,
  zoneBg: '#f8fafc',
  zoneBorder: '#94a3b8',
  taskHeight: 40, // 每个泳道的高度
  nodeRadius: 5,
  criticalColor: '#ef4444', // 红色
  normalColor: '#1e293b',  // 深色
  fontFamily: '"Microsoft YaHei", sans-serif',
};

const NetworkDiagram: React.FC<NetworkDiagramProps> = ({ tasks, onUpdateAnalysis }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // --- 1. 数据处理与 CPM 计算 ---
  const processedData = useMemo(() => {
    // 深拷贝任务数据
    const _tasks = JSON.parse(JSON.stringify(tasks)) as Task[];
    const taskMap = new Map(_tasks.map(t => [t.id, t]));

    // 1.1 前推法 (Forward Pass) - 计算最早开始/完成时间
    // 假设项目从第0天开始
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

    const projectDuration = Math.max(..._tasks.map(t => t.earlyFinish || 0), 0);

    // 1.2 后推法 (Backward Pass) - 计算最迟时间
    _tasks.forEach(t => { 
      t.lateFinish = projectDuration; 
      t.lateStart = projectDuration - t.duration; 
    });
    
    changed = true;
    while(changed) {
      changed = false;
      _tasks.forEach(task => {
        // 找到所有紧后工作
        const successors = _tasks.filter(t => t.predecessors.includes(task.id));
        if (successors.length > 0) {
          const minLS = Math.min(...successors.map(s => s.lateStart || projectDuration));
          if (task.lateFinish !== minLS) {
            task.lateFinish = minLS;
            task.lateStart = minLS - task.duration;
            changed = true;
          }
        }
      });
    }

    // 1.3 识别关键路径
    const criticalPathIds: string[] = [];
    _tasks.forEach(t => {
      const totalFloat = (t.lateStart || 0) - (t.earlyStart || 0);
      t.totalFloat = totalFloat;
      t.isCritical = totalFloat === 0;
      if (t.isCritical) criticalPathIds.push(t.id);
    });

    // 异步通知父组件分析结果
    setTimeout(() => onUpdateAnalysis(criticalPathIds, projectDuration), 0);

    // 1.4 泳道布局算法 (Lane Layout)
    // 按分区(Zone)分组
    const zones = Array.from(new Set(_tasks.map(t => t.zone || '默认分区'))).sort();
    
    // 为每个任务分配 Y 轴层级 (Track Index)
    // 简单的贪心算法：在同一分区内，如果时间不重叠，复用层级
    const layoutData: { task: Task; laneIndex: number; globalRowIndex: number; zone: string }[] = [];
    let currentGlobalRow = 0;
    const zoneMeta: { name: string; startRow: number; rowCount: number }[] = [];

    zones.forEach(zone => {
      const zoneTasks = _tasks.filter(t => (t.zone || '默认分区') === zone);
      // 按最早开始时间排序
      zoneTasks.sort((a, b) => (a.earlyStart || 0) - (b.earlyStart || 0));

      const lanes: number[] = []; // 存储每条泳道的当前结束时间
      const zoneStartRow = currentGlobalRow;

      zoneTasks.forEach(task => {
        let assignedLane = -1;
        // 尝试找到一个空闲的泳道
        for (let i = 0; i < lanes.length; i++) {
          // 加一点间隔(1天)以避免视觉拥挤
          if (lanes[i] + 0.5 <= (task.earlyStart || 0)) {
            assignedLane = i;
            lanes[i] = task.earlyFinish || 0;
            break;
          }
        }
        // 如果没找到，新开一条泳道
        if (assignedLane === -1) {
          assignedLane = lanes.length;
          lanes.push(task.earlyFinish || 0);
        }

        layoutData.push({
          task,
          laneIndex: assignedLane,
          globalRowIndex: zoneStartRow + assignedLane,
          zone
        });
      });

      const rowCount = Math.max(lanes.length, 3); // 每个分区至少预留3行高度
      currentGlobalRow += rowCount;
      zoneMeta.push({ name: zone, startRow: zoneStartRow, rowCount });
    });

    return { tasks: layoutData, projectDuration, zoneMeta, totalRows: currentGlobalRow, rawTasks: taskMap };
  }, [tasks]);

  // --- 辅助函数：日期计算 ---
  const projectStartDate = useMemo(() => {
    const d = new Date();
    d.setHours(0,0,0,0);
    // 稍微把开始时间往前调一点，留白
    d.setDate(d.getDate() - 2); 
    return d;
  }, []);

  const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  // --- D3 渲染逻辑 ---
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    
    const svg = d3.select(svgRef.current);
    const tooltip = d3.select(tooltipRef.current);

    svg.selectAll("*").remove();

    // 1. 定义箭头标记 (Markers)
    const defs = svg.append("defs");
    
    // 实心箭头 (普通)
    defs.append("marker")
      .attr("id", "arrow-normal")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", STYLES.normalColor);

    // 实心箭头 (关键)
    defs.append("marker")
      .attr("id", "arrow-critical")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", STYLES.criticalColor);

    // 2. 比例尺设置
    // X轴：时间
    // 为了让图表有那种“蓝图”的感觉，我们需要根据视图模式动态调整范围
    const initialXScale = d3.scaleTime()
      .domain([projectStartDate, addDays(projectStartDate, processedData.projectDuration + 15)])
      .range([120, width - 50]); // 左侧预留 120px 给分区表头

    // Y轴：基于行号
    const rowHeight = STYLES.taskHeight;
    const contentHeight = Math.max(height, processedData.totalRows * rowHeight + 100);
    
    // 主容器
    const mainGroup = svg.append("g");
    
    // 背景层 (Grid)
    const gridGroup = mainGroup.append("g").attr("class", "grid-layer");
    // 连线层 (Links/Arrows)
    const linkGroup = mainGroup.append("g").attr("class", "link-layer");
    // 节点层 (Nodes)
    const nodeGroup = mainGroup.append("g").attr("class", "node-layer");
    // 文本层
    const textGroup = mainGroup.append("g").attr("class", "text-layer");
    // 左侧分区栏 (固定在左侧，不随X轴移动，但随Y轴移动)
    // 这里我们先把它放在 mainGroup 里，之后在 zoom 事件里特殊处理它的 transform
    const zoneGroup = mainGroup.append("g").attr("class", "zone-layer");

    // 渲染函数
    const draw = (currentXScale: d3.ScaleTime<number, number>) => {
      // --- A. 绘制背景网格 ---
      gridGroup.selectAll("*").remove();
      
      const xAxisTicks = currentXScale.ticks(width / 80); // 根据宽度动态调整刻度密度
      
      // 垂直网格线 (青色)
      gridGroup.selectAll(".v-grid")
        .data(xAxisTicks)
        .enter()
        .append("line")
        .attr("class", "v-grid")
        .attr("x1", d => currentXScale(d))
        .attr("x2", d => currentXScale(d))
        .attr("y1", 0)
        .attr("y2", contentHeight)
        .attr("stroke", STYLES.gridColor)
        .attr("stroke-width", 1)
        .attr("stroke-opacity", STYLES.gridOpacity);

      // 顶部时间轴文字
      gridGroup.selectAll(".grid-label")
        .data(xAxisTicks)
        .enter()
        .append("text")
        .attr("class", "grid-label")
        .attr("x", d => currentXScale(d))
        .attr("y", 20)
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("fill", STYLES.gridColor)
        .text(d => {
          if (viewMode === 'year') return d3.timeFormat("%Y")(d);
          if (viewMode === 'month') return d3.timeFormat("%m/%d")(d);
          return d3.timeFormat("%d")(d); // 日视图显示日期
        });
      
      // 时间轴底线
      gridGroup.append("line")
        .attr("x1", 0)
        .attr("x2", width * 2) // 足够长
        .attr("y1", 30)
        .attr("y2", 30)
        .attr("stroke", STYLES.gridColor)
        .attr("stroke-width", 2);

      // --- B. 绘制分区 (Zones) ---
      zoneGroup.selectAll("*").remove();
      
      processedData.zoneMeta.forEach((zone, i) => {
        const yPos = zone.startRow * rowHeight + 30; // +30 是顶部偏移
        const h = zone.rowCount * rowHeight;
        
        // 分区背景带 (交替颜色)
        /*
        gridGroup.append("rect")
           .attr("x", 0)
           .attr("y", yPos)
           .attr("width", width * 5) // Make it wide
           .attr("height", h)
           .attr("fill", i % 2 === 0 ? "white" : "#fafafa")
           .attr("opacity", 0.5);
        */

        // 分区水平分割线
        gridGroup.append("line")
           .attr("x1", 0)
           .attr("x2", width * 5)
           .attr("y1", yPos + h)
           .attr("y2", yPos + h)
           .attr("stroke", STYLES.zoneBorder)
           .attr("stroke-width", 1);

        // 左侧标题块 (在 zoneGroup 中绘制，稍后通过 transform 固定 X)
        const zoneLabelGroup = zoneGroup.append("g")
          .attr("transform", `translate(0, ${yPos})`);
        
        // 侧边栏背景
        zoneLabelGroup.append("rect")
          .attr("width", 120)
          .attr("height", h)
          .attr("fill", "white") // 遮挡网格
          .attr("stroke", STYLES.zoneBorder);

        // 竖排文字
        const labelText = zoneLabelGroup.append("text")
          .attr("x", 60)
          .attr("y", h / 2)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("font-size", 14)
          .attr("font-weight", "bold")
          .attr("fill", STYLES.gridColor)
          //.attr("writing-mode", "tb") // SVG writing-mode 兼容性有时不好，这里用 glyphs 或旋转
          .attr("transform", `rotate(0, 60, ${h/2})`); // 保持横向或根据需求旋转
        
        labelText.text(zone.name);
      });

      // --- C. 绘制任务箭线与逻辑关系 ---
      linkGroup.selectAll("*").remove();
      nodeGroup.selectAll("*").remove();
      textGroup.selectAll("*").remove();

      // 先创建一个 Map 方便查找任务的坐标
      // Task Coordinates: { taskId: { startX, endX, y } }
      const taskCoords = new Map<string, { startX: number, endX: number, y: number }>();

      processedData.tasks.forEach(item => {
        // 修正：我们需要把相对天数转为 Date 对象给 Scale 用
        const startDate = addDays(projectStartDate, item.task.earlyStart || 0);
        const endDate = addDays(projectStartDate, item.task.earlyFinish || 0);
        
        const startX = currentXScale(startDate);
        const endX = currentXScale(endDate);
        const y = (item.globalRowIndex * rowHeight) + 30 + (rowHeight / 2); // 居中于行

        taskCoords.set(item.task.id, { startX, endX, y });
      });

      processedData.tasks.forEach(item => {
        const coords = taskCoords.get(item.task.id);
        if (!coords) return;
        const { startX, endX, y } = coords;
        const isCritical = item.task.isCritical;
        const color = isCritical ? STYLES.criticalColor : STYLES.normalColor;
        const strokeWidth = isCritical ? 2.5 : 1.5;

        // 1. 绘制任务实线 (Task Arrow)
        // 样式：水平实线
        const taskPath = linkGroup.append("line")
          .attr("x1", startX)
          .attr("y1", y)
          .attr("x2", endX)
          .attr("y2", y)
          .attr("stroke", color)
          .attr("stroke-width", strokeWidth)
          .attr("marker-end", isCritical ? "url(#arrow-critical)" : "url(#arrow-normal)");

        // 交互事件
        taskPath
          .on("mouseover", (event) => {
             d3.select(event.target).attr("stroke-width", 4);
             tooltip.style("opacity", 1);
             const t = item.task;
             tooltip.html(`
               <div class="font-bold border-b pb-1 mb-1">${t.name}</div>
               <div class="text-xs text-slate-600">
                 <div>工期: ${t.duration}天</div>
                 <div>开始: ${t.earlyStart} | 完成: ${t.earlyFinish}</div>
                 <div>分区: ${t.zone}</div>
               </div>
             `);
          })
          .on("mousemove", (event) => {
             tooltip.style("left", (event.pageX + 10) + "px").style("top", (event.pageY + 10) + "px");
          })
          .on("mouseout", (event) => {
             d3.select(event.target).attr("stroke-width", strokeWidth);
             tooltip.style("opacity", 0);
          });

        // 2. 绘制节点 (Nodes)
        // 起点圆圈
        nodeGroup.append("circle")
          .attr("cx", startX)
          .attr("cy", y)
          .attr("r", STYLES.nodeRadius)
          .attr("fill", "white")
          .attr("stroke", "black")
          .attr("stroke-width", 1);
        
        // 终点圆圈 (在箭头处，为了美观，有些风格会画，有些不画，图片里似乎有小白圈)
        // 如果我们用了 marker-end，其实不用画终点圈，除非是为了连接下一条线。
        // 时标图中，节点通常位于箭尾和箭头处。
        nodeGroup.append("circle")
          .attr("cx", endX)
          .attr("cy", y)
          .attr("r", STYLES.nodeRadius) // 稍微小一点让箭头露出来? 或者在箭头前
          .attr("fill", "white")
          .attr("stroke", "black")
          .attr("stroke-width", 1);


        // 3. 绘制文字 (Text)
        // 名称在上方
        textGroup.append("text")
          .attr("x", (startX + endX) / 2)
          .attr("y", y - 8)
          .attr("text-anchor", "middle")
          .attr("font-size", 11)
          .attr("font-weight", "bold")
          .attr("fill", color)
          .text(item.task.name);
        
        // 工期在下方
        textGroup.append("text")
          .attr("x", (startX + endX) / 2)
          .attr("y", y + 14)
          .attr("text-anchor", "middle")
          .attr("font-size", 10)
          .attr("fill", "#64748b") // 灰色
          .text(item.task.duration);

        // 4. 绘制逻辑关系连线 (Dependencies)
        // 从紧前工作的 End 连到 当前工作的 Start
        item.task.predecessors.forEach(pid => {
          const predCoords = taskCoords.get(pid);
          if (predCoords) {
            // 逻辑线通常是虚线
            // 路径：前置End -> 垂直 -> 当前Start
            // 如果前置End X < 当前Start X (存在自由时差)，画波形线或水平虚线
            // 图片风格：垂直虚线连接不同泳道
            
            const pX = predCoords.endX;
            const pY = predCoords.y;
            const cX = startX;
            const cY = y;
            
            let pathD = "";
            
            // 简单的正交路由
            // 1. 从前置结束点出发
            // 2. 垂直移动到当前工作Y轴 (如果在不同行)
            // 3. 水平移动到当前工作开始点 (如果有时间差)
            
            // 检查是否有时间间隔 (Free Float)
            // 在时标网络图中，时间间隔用波形线表示，这里简化为虚线
            
            if (Math.abs(pY - cY) < 1 && Math.abs(pX - cX) < 1) {
              // 同一行且时间连续，不需要线(节点重合)
            } else {
               // 逻辑线颜色
               // 如果是关键路径的一部分，应该是红色？通常逻辑虚线是黑色的，除非是关键虚工作
               // 这里简化处理
               
               // 绘制逻辑: M pX, pY -> L pX, cY -> L cX, cY
               // 先垂直，后水平
               pathD = `M ${pX},${pY} L ${pX},${cY} L ${cX},${cY}`;
               
               linkGroup.append("path")
                 .attr("d", pathD)
                 .attr("fill", "none")
                 .attr("stroke", "#94a3b8") // 浅灰色逻辑线
                 .attr("stroke-width", 1)
                 .attr("stroke-dasharray", "3,3") // 虚线
                 .attr("marker-end", "url(#arrow-normal)"); // 加上箭头指示方向
            }
          }
        });

      });
    };

    // Zoom Behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on("zoom", (event) => {
        const transform = event.transform;
        
        // Rescale X
        const newXScale = transform.rescaleX(initialXScale);
        
        // 关键：固定左侧分区栏的 X 位置，只允许 Y 轴平移
        // zoneGroup 是在 mainGroup 里的，mainGroup 会被整体 transform 吗？
        // 不，我们在 draw 里重绘内容，或者在这里移动 group。
        // 更好的方式是：mainGroup 负责 Y 平移，X 缩放通过重绘实现。
        
        // 重绘所有基于时间的内容
        draw(newXScale);
        
        // 平移整个内容层 (Y轴)
        // transform.x 对于时标图来说应该是平移时间轴，我们已经在 rescaleX 处理了
        // 但是我们需要处理 Y 轴的滚动 (通过 transform.y)
        // 实际上 d3.zoom 会同时改变 x 和 y。
        
        // 为了实现：
        // 1. X轴拖动 -> 时间平移
        // 2. Y轴拖动 -> 上下滚动查看不同分区
        
        // 对于 gridGroup, linkGroup, nodeGroup, textGroup:
        // X位置由 newXScale 决定 (包含了 transform.x 和 k)
        // Y位置需要加上 transform.y
        
        const yOffset = transform.y;
        
        // 应用 Y 偏移到所有组
        gridGroup.attr("transform", `translate(0, ${yOffset})`);
        linkGroup.attr("transform", `translate(0, ${yOffset})`);
        nodeGroup.attr("transform", `translate(0, ${yOffset})`);
        textGroup.attr("transform", `translate(0, ${yOffset})`);
        
        // 左侧栏：X轴固定为0 (不受 transform.x 影响)，Y轴随动
        // 因为我们在 draw() 里没有用 scale 算左侧栏位置，而是固定画的
        // 所以这里只要平移 Y
        zoneGroup.attr("transform", `translate(0, ${yOffset})`);

      });

    svg.call(zoom);
    zoomBehaviorRef.current = zoom;
    
    // 初始缩放位置，留出左边距
    svg.call(zoom.transform, d3.zoomIdentity.translate(0, 0));

    // Initial Draw
    draw(initialXScale);

  }, [processedData, projectStartDate, viewMode]);

  // View Switch Effect
  useEffect(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    const svg = d3.select(svgRef.current);
    
    // 调整缩放级别以适应视图
    let k = 1;
    if (viewMode === 'month') k = 0.5;
    if (viewMode === 'year') k = 0.1;
    
    svg.transition().duration(500).call(
      zoomBehaviorRef.current.transform, 
      d3.zoomIdentity.scale(k)
    );
  }, [viewMode]);

  return (
    <div className="h-full flex flex-col bg-slate-50 relative border-l border-slate-200">
      {/* 工具栏 */}
      <div className="h-10 border-b border-slate-200 bg-white flex items-center px-4 gap-3 shadow-sm z-10 shrink-0">
        <div className="flex items-center gap-2 text-slate-700">
          <Layers size={16} className="text-cyan-600"/>
          <span className="font-bold text-sm">时标网络计划</span>
        </div>
        
        <div className="h-4 w-px bg-slate-300 mx-2"></div>
        
        <div className="flex bg-slate-100 rounded p-0.5 border border-slate-200">
          {(['year', 'month', 'day'] as ViewMode[]).map(m => (
            <button 
              key={m}
              onClick={() => setViewMode(m)}
              className={`px-3 py-1 text-xs rounded transition-all ${
                viewMode === m 
                ? 'bg-white text-cyan-700 shadow-sm font-bold ring-1 ring-slate-200' 
                : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {{year: '年视图', month: '月视图', day: '日视图'}[m]}
            </button>
          ))}
        </div>

        <div className="flex-1"></div>
        
        <div className="flex items-center gap-4 text-xs text-slate-500 mr-2">
           <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-slate-800"></div>实工作</div>
           <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-slate-400 border-b border-dashed"></div>虚工作</div>
           <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-red-500"></div>关键路径</div>
        </div>

        <button 
          className="p-1 flex items-center gap-1 text-xs bg-cyan-600 text-white px-3 py-1 rounded hover:bg-cyan-700 shadow-sm transition"
        >
          <Download size={14}/> 导出图纸
        </button>
      </div>

      {/* 绘图区 */}
      <div ref={containerRef} className="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing bg-slate-50">
        <svg ref={svgRef} className="w-full h-full block"></svg>
        <div 
          ref={tooltipRef}
          className="absolute pointer-events-none bg-white/95 p-3 rounded shadow-xl border border-slate-200 z-50 opacity-0 transition-opacity duration-150 text-sm min-w-[180px] backdrop-blur text-left"
          style={{ top: 0, left: 0 }}
        />
      </div>
    </div>
  );
};

export default NetworkDiagram;
