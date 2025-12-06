import React, { useEffect, useRef, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { Task, LinkType, Annotation } from '../types';
import { ZoomIn, ZoomOut, Download, Type, BoxSelect, Settings, Calendar, MousePointer2, Layers, Flag, AlertTriangle, Star, CheckCircle } from 'lucide-react';

interface NetworkDiagramProps {
  tasks: Task[];
  annotations?: Annotation[]; // Made optional but handled
  onUpdateTasks?: (tasks: Task[]) => void;
  onUpdateAnnotations?: (annotations: Annotation[]) => void;
  onUpdateAnalysis: (criticalPath: string[], duration: number) => void;
}

type ViewMode = 'day' | 'month' | 'year';

// 样式常量
const STYLES = {
  gridColor: '#06b6d4', 
  gridOpacity: 0.3,
  zoneBg: '#f8fafc',
  zoneBorder: '#94a3b8',
  taskHeight: 50, // Increased for better drag target
  nodeRadius: 6,
  criticalColor: '#ef4444',
  normalColor: '#1e293b',
  fontFamily: '"Microsoft YaHei", sans-serif',
};

const NetworkDiagram: React.FC<NetworkDiagramProps> = ({ 
  tasks, 
  annotations = [], 
  onUpdateTasks,
  onUpdateAnnotations,
  onUpdateAnalysis 
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [activeTool, setActiveTool] = useState<'select' | 'text' | 'flag' | 'alert' | 'star' | 'check'>('select');

  // --- 0. Resize Observer ---
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // --- 1. 数据处理与 CPM 计算 ---
  const processedData = useMemo(() => {
    const _tasks = JSON.parse(JSON.stringify(tasks)) as Task[];
    const taskMap = new Map(_tasks.map(t => [t.id, t]));

    // Forward Pass
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

    // Backward Pass
    _tasks.forEach(t => { 
      t.lateFinish = projectDuration; 
      t.lateStart = projectDuration - t.duration; 
    });
    
    changed = true;
    while(changed) {
      changed = false;
      _tasks.forEach(task => {
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

    const criticalPathIds: string[] = [];
    _tasks.forEach(t => {
      const totalFloat = (t.lateStart || 0) - (t.earlyStart || 0);
      t.totalFloat = totalFloat;
      t.isCritical = totalFloat === 0;
      if (t.isCritical) criticalPathIds.push(t.id);
    });

    setTimeout(() => onUpdateAnalysis(criticalPathIds, projectDuration), 0);

    // Zone Layout
    const zones = Array.from(new Set(_tasks.map(t => t.zone || '默认分区'))).sort();
    
    const layoutData: { task: Task; laneIndex: number; globalRowIndex: number; zone: string }[] = [];
    let currentGlobalRow = 0;
    const zoneMeta: { name: string; startRow: number; rowCount: number; endRow: number }[] = [];
    
    // Map to track which lane a task was assigned to, to try and align successors
    const taskLaneMap = new Map<string, number>();

    zones.forEach(zone => {
      const zoneTasks = _tasks.filter(t => (t.zone || '默认分区') === zone);
      // Sort primarily by Early Start to process in time order
      // Secondary sort by ID to keep deterministic
      zoneTasks.sort((a, b) => (a.earlyStart || 0) - (b.earlyStart || 0) || a.id.localeCompare(b.id));

      const lanes: number[] = [];
      const zoneStartRow = currentGlobalRow;

      zoneTasks.forEach(task => {
        let assignedLane = -1;

        // Strategy: Try to place in the same lane as a direct predecessor (Gap=0) to form a continuous line
        // This helps merge the end node of pred and start node of current task into one visual node
        const directPred = task.predecessors
             .map(pid => taskMap.get(pid))
             .find(p => p && (p.zone || '默认分区') === zone && Math.abs((p.earlyFinish || 0) - (task.earlyStart || 0)) < 0.01);
        
        if (directPred) {
            const predLane = taskLaneMap.get(directPred.id);
            // Check if that lane is free (time <= current start, allowing tiny float overlap)
            if (predLane !== undefined && (lanes[predLane] || 0) <= (task.earlyStart || 0) + 0.1) {
                assignedLane = predLane;
            }
        }

        // Fallback: First Fit
        if (assignedLane === -1) {
            for (let i = 0; i < lanes.length; i++) {
              if ((lanes[i] || 0) <= (task.earlyStart || 0) + 0.1) {
                assignedLane = i;
                break;
              }
            }
        }

        // New Lane
        if (assignedLane === -1) {
          assignedLane = lanes.length;
          lanes.push(0);
        }
        
        // Update lane end time
        lanes[assignedLane] = task.earlyFinish || 0;
        taskLaneMap.set(task.id, assignedLane);

        layoutData.push({
          task,
          laneIndex: assignedLane,
          globalRowIndex: zoneStartRow + assignedLane,
          zone
        });
      });

      const rowCount = Math.max(lanes.length, 3);
      currentGlobalRow += rowCount;
      zoneMeta.push({ name: zone, startRow: zoneStartRow, rowCount, endRow: zoneStartRow + rowCount });
    });

    return { tasks: layoutData, projectDuration, zoneMeta, totalRows: currentGlobalRow, rawTasks: taskMap };
  }, [tasks]);

  const projectStartDate = useMemo(() => {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() - 2); 
    return d;
  }, []);

  const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  // --- D3 渲染与交互 ---
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || dimensions.width === 0) return;

    const width = dimensions.width;
    const height = dimensions.height;
    
    const svg = d3.select(svgRef.current);
    const tooltip = d3.select(tooltipRef.current);

    svg.selectAll("*").remove();

    // Definitions
    const defs = svg.append("defs");
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

    const initialXScale = d3.scaleTime()
      .domain([projectStartDate, addDays(projectStartDate, processedData.projectDuration + 15)])
      .range([120, width - 50]);

    const rowHeight = STYLES.taskHeight;
    const contentHeight = Math.max(height, processedData.totalRows * rowHeight + 100);
    
    // Layers
    const mainGroup = svg.append("g");
    const gridGroup = mainGroup.append("g").attr("class", "grid-layer");
    const zoneGroup = mainGroup.append("g").attr("class", "zone-layer");
    const linkGroup = mainGroup.append("g").attr("class", "link-layer");
    const nodeGroup = mainGroup.append("g").attr("class", "node-layer");
    const textGroup = mainGroup.append("g").attr("class", "text-layer");
    const annotationGroup = mainGroup.append("g").attr("class", "annotation-layer");

    const taskCoords = new Map<string, { startX: number, endX: number, y: number, task: Task }>();

    // Main Draw Function
    const draw = (currentXScale: d3.ScaleTime<number, number>) => {
      // 1. Grid
      gridGroup.selectAll("*").remove();
      const xAxisTicks = currentXScale.ticks(width / 80);
      gridGroup.selectAll(".v-grid")
        .data(xAxisTicks).enter().append("line")
        .attr("x1", d => currentXScale(d)).attr("x2", d => currentXScale(d))
        .attr("y1", 0).attr("y2", contentHeight)
        .attr("stroke", STYLES.gridColor).attr("stroke-width", 1).attr("stroke-opacity", STYLES.gridOpacity);

      gridGroup.selectAll(".grid-label")
        .data(xAxisTicks).enter().append("text")
        .attr("x", d => currentXScale(d)).attr("y", 20)
        .attr("text-anchor", "middle").attr("font-size", 10).attr("fill", STYLES.gridColor)
        .text(d => viewMode === 'year' ? d3.timeFormat("%Y")(d) : viewMode === 'month' ? d3.timeFormat("%m/%d")(d) : d3.timeFormat("%d")(d));

      // 2. Zones
      zoneGroup.selectAll("*").remove();
      processedData.zoneMeta.forEach((zone) => {
        const yPos = zone.startRow * rowHeight + 30;
        const h = zone.rowCount * rowHeight;
        
        gridGroup.append("line").attr("x1", 0).attr("x2", width * 5)
          .attr("y1", yPos + h).attr("y2", yPos + h)
          .attr("stroke", STYLES.zoneBorder).attr("stroke-width", 1);

        const zoneLabelGroup = zoneGroup.append("g").attr("transform", `translate(0, ${yPos})`);
        zoneLabelGroup.append("rect").attr("width", 120).attr("height", h).attr("fill", "white").attr("stroke", STYLES.zoneBorder);
        zoneLabelGroup.append("text").attr("x", 60).attr("y", h/2).attr("text-anchor", "middle").attr("dominant-baseline", "middle")
          .attr("font-size", 14).attr("font-weight", "bold").attr("fill", STYLES.gridColor).text(zone.name);
      });

      // 3. Tasks Logic (Calculate Coords)
      taskCoords.clear();
      processedData.tasks.forEach(item => {
        const startDate = addDays(projectStartDate, item.task.earlyStart || 0);
        const endDate = addDays(projectStartDate, item.task.earlyFinish || 0);
        const startX = currentXScale(startDate);
        const endX = currentXScale(endDate);
        const y = (item.globalRowIndex * rowHeight) + 30 + (rowHeight / 2);
        taskCoords.set(item.task.id, { startX, endX, y, task: item.task });
      });

      // 4. Draw Links & Nodes
      linkGroup.selectAll("*").remove();
      nodeGroup.selectAll("*").remove();
      textGroup.selectAll("*").remove();

      // Helper to generate unique node ID for deduplication
      const getNodeKey = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
      const uniqueNodes = new Map<string, {x: number, y: number, dateStr: string}>();

      processedData.tasks.forEach(item => {
        const coords = taskCoords.get(item.task.id);
        if (!coords) return;
        const { startX, endX, y, task } = coords;
        const isCritical = item.task.isCritical;
        const color = isCritical ? STYLES.criticalColor : STYLES.normalColor;

        // --- Drag Behavior for Task Arrow ---
        let initialClickX = 0;
        let initialClickY = 0;

        const dragArrow = d3.drag<SVGLineElement, unknown>()
          .on("start", function(event) { 
             d3.select(this).attr("stroke-width", 4).attr("cursor", "grabbing");
             initialClickX = event.x;
             initialClickY = event.y;
          })
          .on("drag", function(event) {
             const dx = event.x - initialClickX;
             const dy = event.y - initialClickY;
             // Visual feedback only
             d3.select(this)
               .attr("x1", startX + dx)
               .attr("x2", endX + dx)
               .attr("y1", y + dy)
               .attr("y2", y + dy);
          })
          .on("end", function(event) {
             d3.select(this).attr("stroke-width", isCritical ? 2.5 : 1.5).attr("cursor", "grab");
             
             const dx = event.x - initialClickX;
             const dy = event.y - initialClickY;

             // 1. Check Zone Change (Vertical Drag Dominant)
             if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > rowHeight/2) {
               const newRowIndex = Math.floor(((y + dy) - 30) / rowHeight);
               
               // Find which zone this row belongs to
               let newZone = task.zone;
               for (const z of processedData.zoneMeta) {
                 if (newRowIndex >= z.startRow && newRowIndex < z.endRow) {
                   newZone = z.name;
                   break;
                 }
               }

               if (newZone && newZone !== task.zone && onUpdateTasks) {
                 const updatedTasks = tasks.map(t => t.id === task.id ? { ...t, zone: newZone } : t);
                 onUpdateTasks(updatedTasks);
                 return;
               }
             } 
             // 2. Check Duration Change (Horizontal Drag Dominant)
             else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
                 // Convert pixels to days
                 const startDateVal = currentXScale.invert(startX);
                 const endDateVal = currentXScale.invert(startX + dx);
                 const diffTime = endDateVal.getTime() - startDateVal.getTime();
                 const diffDays = Math.round(diffTime / (1000 * 3600 * 24));
                 
                 if (diffDays !== 0) {
                   const newDuration = Math.max(1, task.duration + diffDays);
                   if (newDuration !== task.duration && onUpdateTasks) {
                      const updatedTasks = tasks.map(t => t.id === task.id ? { ...t, duration: newDuration } : t);
                      onUpdateTasks(updatedTasks);
                      return;
                   }
                 }
             }

             // Redraw to reset position if no valid change detected
             draw(currentXScale); 
          });

        // Draw Task Arrow
        const arrow = linkGroup.append("line")
          .attr("x1", startX).attr("y1", y)
          .attr("x2", endX).attr("y2", y)
          .attr("stroke", color).attr("stroke-width", isCritical ? 2.5 : 1.5)
          .attr("marker-end", isCritical ? "url(#arrow-critical)" : "url(#arrow-normal)")
          .attr("cursor", "grab")
          .call(dragArrow);

        // Tooltip events
        arrow.on("mouseover", (e) => {
             tooltip.style("opacity", 1).html(`<div class="font-bold">${task.name}</div><div>工期: ${task.duration}天</div><div>分区: ${task.zone}</div>`);
          }).on("mousemove", (e) => tooltip.style("left", (e.pageX+10)+"px").style("top", (e.pageY+10)+"px"))
          .on("mouseout", () => tooltip.style("opacity", 0));

        // Draw Text
        textGroup.append("text").attr("x", (startX + endX)/2).attr("y", y - 8).attr("text-anchor", "middle")
          .attr("font-size", 11).attr("fill", color).text(task.name);
        textGroup.append("text").attr("x", (startX + endX)/2).attr("y", y + 14).attr("text-anchor", "middle")
          .attr("font-size", 10).attr("fill", "#64748b").text(task.duration);

        // Collect Nodes
        const startKey = getNodeKey(startX, y);
        const endKey = getNodeKey(endX, y);
        
        if (!uniqueNodes.has(startKey)) uniqueNodes.set(startKey, { x: startX, y, dateStr: d3.timeFormat("%m-%d")(addDays(projectStartDate, task.earlyStart||0)) });
        
        // The End Node of this task is the 'active' handle for changing duration
        // We store the task ID with the end node to identify what to update on drag
        if (!uniqueNodes.has(endKey)) {
           uniqueNodes.set(endKey, { x: endX, y, dateStr: d3.timeFormat("%m-%d")(addDays(projectStartDate, task.earlyFinish||0)) });
        }

        // Draw Dependencies (Logic lines)
        task.predecessors.forEach(pid => {
          const pred = taskCoords.get(pid);
          if (pred) {
            const pX = pred.endX;
            const pY = pred.y;
            const cX = startX;
            const cY = y;
            const gap = task.earlyStart! - (processedData.rawTasks.get(pid)?.earlyFinish || 0);

            if (gap > 0) {
              // Wavy Line for Free Float
              const midX = cX; 
              // Simple wavy path approx
              const waves = Math.floor((midX - pX) / 10);
              let d = `M ${pX} ${pY}`;
              for(let i=0; i<waves; i++) {
                d += ` q 5 -3 10 0`; // simple quadratic bezier wave
              }
              d += ` L ${midX} ${pY}`; // finish line
              
              linkGroup.append("path").attr("d", d).attr("fill", "none").attr("stroke", "#94a3b8").attr("stroke-width", 1);
              linkGroup.append("line").attr("x1", midX).attr("y1", pY).attr("x2", cX).attr("y2", cY) // Vertical drop
                .attr("stroke", "#94a3b8").attr("stroke-dasharray", "3,3");
                
              // Node at turn
              const turnKey = getNodeKey(midX, pY);
              uniqueNodes.set(turnKey, { x: midX, y: pY, dateStr: d3.timeFormat("%m-%d")(addDays(projectStartDate, task.earlyStart||0)) });
            } else {
              // Vertical Line
              if (Math.abs(pY - cY) > 1) {
                 linkGroup.append("line").attr("x1", pX).attr("y1", pY).attr("x2", cX).attr("y2", cY)
                   .attr("stroke", "#94a3b8").attr("stroke-width", 1).attr("stroke-dasharray", "3,3");
              }
            }
          }
        });
      });

      // 5. Draw Unique Nodes with Drag for Duration
      uniqueNodes.forEach((node, key) => {
        // Determine which tasks end at this node to update their duration
        const endingTasks = processedData.tasks.filter(t => {
           const coords = taskCoords.get(t.task.id);
           return coords && getNodeKey(coords.endX, coords.y) === key;
        });

        const dragNode = d3.drag<SVGCircleElement, unknown>()
          .on("start", function() { d3.select(this).attr("r", 8).attr("fill", "orange"); })
          .on("drag", function(e) { d3.select(this).attr("cx", e.x); })
          .on("end", function(e) {
             d3.select(this).attr("r", STYLES.nodeRadius).attr("fill", "white");
             
             if (endingTasks.length > 0 && onUpdateTasks) {
               // Calculate new date based on x position
               const newDate = currentXScale.invert(e.x);
               // Diff in days
               const oldDate = addDays(projectStartDate, endingTasks[0].task.earlyFinish || 0);
               const diffTime = newDate.getTime() - oldDate.getTime();
               const diffDays = Math.round(diffTime / (1000 * 3600 * 24));
               
               if (diffDays !== 0) {
                 const updatedTasks = tasks.map(t => {
                   if (endingTasks.find(et => et.task.id === t.id)) {
                     const newDuration = Math.max(1, t.duration + diffDays);
                     return { ...t, duration: newDuration };
                   }
                   return t;
                 });
                 onUpdateTasks(updatedTasks);
               } else {
                 draw(currentXScale); // snap back
               }
             }
          });

        const circle = nodeGroup.append("circle")
          .attr("cx", node.x).attr("cy", node.y)
          .attr("r", STYLES.nodeRadius)
          .attr("fill", "white").attr("stroke", "black").attr("stroke-width", 1);
        
        if (endingTasks.length > 0) {
           circle.attr("cursor", "ew-resize").call(dragNode);
        }

        // Date Label
        nodeGroup.append("text").attr("x", node.x).attr("y", node.y + 18)
          .attr("text-anchor", "middle").attr("font-size", 9).attr("fill", "#64748b").text(node.dateStr);
      });

      // 6. Annotations
      annotationGroup.selectAll("*").remove();
      // Ensure annotations is always an array to fix "undefined is not an object" error
      const safeAnnotations = Array.isArray(annotations) ? annotations : [];
      
      safeAnnotations.forEach(ann => {
        const g = annotationGroup.append("g")
          .attr("transform", `translate(${ann.x}, ${ann.y})`)
          .attr("cursor", "move");
        
        // Drag behavior for annotations
        const dragAnnotation = d3.drag<SVGGElement, unknown>()
          .on("drag", function(e) {
            d3.select(this).attr("transform", `translate(${e.x}, ${e.y})`);
          })
          .on("end", function(e) {
             if (onUpdateAnnotations) {
               const updated = safeAnnotations.map(a => a.id === ann.id ? { ...a, x: e.x, y: e.y } : a);
               onUpdateAnnotations(updated);
             }
          });
        
        g.call(dragAnnotation);

        if (ann.type === 'text') {
          g.append("text").text(ann.content).attr("font-size", 14).attr("fill", "#333");
          g.append("rect").attr("x", -5).attr("y", -15).attr("width", ann.content.length * 10 + 10).attr("height", 20)
            .attr("fill", "transparent").attr("stroke", "#ccc").attr("stroke-dasharray", "2,2").style("opacity", 0.5);
        } else {
          // Render icons simply
          g.append("circle").attr("r", 15).attr("fill", "yellow").attr("stroke", "orange");
          g.append("text").text(ann.content === 'flag' ? '🚩' : ann.content === 'star' ? '⭐' : '⚠️')
            .attr("text-anchor", "middle").attr("dy", 5);
        }

        // Delete on right click
        g.on("contextmenu", (e) => {
          e.preventDefault();
          if (onUpdateAnnotations) {
             const updated = safeAnnotations.filter(a => a.id !== ann.id);
             onUpdateAnnotations(updated);
          }
        });
      });
    };

    // Zoom setup
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on("zoom", (event) => {
        const newXScale = event.transform.rescaleX(initialXScale);
        draw(newXScale);
        const yOffset = event.transform.y;
        gridGroup.attr("transform", `translate(0, ${yOffset})`);
        linkGroup.attr("transform", `translate(0, ${yOffset})`);
        nodeGroup.attr("transform", `translate(0, ${yOffset})`);
        textGroup.attr("transform", `translate(0, ${yOffset})`);
        zoneGroup.attr("transform", `translate(0, ${yOffset})`);
        annotationGroup.attr("transform", `translate(0, ${yOffset})`);
      });

    svg.call(zoom);
    zoomBehaviorRef.current = zoom;
    svg.call(zoom.transform, d3.zoomIdentity.translate(0, 0));
    draw(initialXScale);

    // Click on canvas to add annotation
    svg.on("click", (event) => {
      if (activeTool !== 'select' && onUpdateAnnotations) {
         const [x, y] = d3.pointer(event);
         const transform = d3.zoomTransform(svg.node()!);
         
         const newAnn: Annotation = {
           id: crypto.randomUUID(),
           type: activeTool === 'text' ? 'text' : 'icon',
           content: activeTool === 'text' ? '新批注' : activeTool,
           x: (x - transform.x) / transform.k,
           y: y - transform.y
         };
         
         const currentAnnotations = Array.isArray(annotations) ? annotations : [];
         onUpdateAnnotations([...currentAnnotations, newAnn]);
         setActiveTool('select');
      }
    });

  }, [processedData, projectStartDate, viewMode, dimensions, annotations, activeTool]); // Dependencies

  // View Switch
  useEffect(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    const svg = d3.select(svgRef.current);
    let k = 1;
    if (viewMode === 'month') k = 0.5;
    if (viewMode === 'year') k = 0.1;
    svg.transition().duration(500).call(zoomBehaviorRef.current.transform, d3.zoomIdentity.scale(k));
  }, [viewMode]);

  return (
    <div className="h-full flex flex-col bg-slate-50 relative border-l border-slate-200">
      {/* Toolbar */}
      <div className="h-10 border-b border-slate-200 bg-white flex items-center px-4 gap-3 shadow-sm z-10 shrink-0">
        <div className="flex items-center gap-2 text-slate-700">
          <Layers size={16} className="text-cyan-600"/>
          <span className="font-bold text-sm">时标网络计划</span>
        </div>
        <div className="h-4 w-px bg-slate-300 mx-2"></div>
        <div className="flex bg-slate-100 rounded p-0.5 border border-slate-200">
          {(['year', 'month', 'day'] as ViewMode[]).map(m => (
            <button key={m} onClick={() => setViewMode(m)} className={`px-3 py-1 text-xs rounded transition-all ${viewMode === m ? 'bg-white text-cyan-700 shadow-sm font-bold ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>
              {{year: '年', month: '月', day: '日'}[m]}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-slate-300 mx-2"></div>
        <div className="flex gap-1">
           <button onClick={() => setActiveTool('text')} className={`p-1.5 rounded ${activeTool === 'text' ? 'bg-blue-100 text-blue-600' : 'text-slate-500 hover:bg-slate-100'}`} title="插入文本"><Type size={14}/></button>
           <button onClick={() => setActiveTool('flag')} className={`p-1.5 rounded ${activeTool === 'flag' ? 'bg-blue-100 text-blue-600' : 'text-slate-500 hover:bg-slate-100'}`} title="插入旗帜"><Flag size={14}/></button>
           <button onClick={() => setActiveTool('alert')} className={`p-1.5 rounded ${activeTool === 'alert' ? 'bg-blue-100 text-blue-600' : 'text-slate-500 hover:bg-slate-100'}`} title="插入警告"><AlertTriangle size={14}/></button>
           <button onClick={() => setActiveTool('star')} className={`p-1.5 rounded ${activeTool === 'star' ? 'bg-blue-100 text-blue-600' : 'text-slate-500 hover:bg-slate-100'}`} title="插入标记"><Star size={14}/></button>
        </div>
        <div className="flex-1"></div>
        <button className="p-1 flex items-center gap-1 text-xs bg-cyan-600 text-white px-3 py-1 rounded hover:bg-cyan-700 shadow-sm transition">
          <Download size={14}/> 导出
        </button>
      </div>

      <div ref={containerRef} className={`flex-1 overflow-hidden relative bg-slate-50 ${activeTool === 'select' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}>
        <svg ref={svgRef} className="w-full h-full block"></svg>
        <div ref={tooltipRef} className="absolute pointer-events-none bg-white/95 p-3 rounded shadow-xl border border-slate-200 z-50 opacity-0 transition-opacity duration-150 text-sm min-w-[180px] backdrop-blur text-left" style={{ top: 0, left: 0 }} />
      </div>
    </div>
  );
};

export default NetworkDiagram;