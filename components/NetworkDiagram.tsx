
import React, { useEffect, useRef, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { Task, LinkType, Annotation } from '../types';
import { ZoomIn, ZoomOut, Download, Type, BoxSelect, Settings, Calendar, MousePointer2, Layers, Flag, AlertTriangle, Star, CheckCircle, Edit3, X, Undo, Redo, Save, Image as ImageIcon, FileText } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface NetworkDiagramProps {
  tasks: Task[];
  annotations?: Annotation[]; 
  onUpdateTasks?: (tasks: Task[]) => void;
  onUpdateAnnotations?: (annotations: Annotation[]) => void;
  onUpdateAnalysis: (criticalPath: string[], duration: number) => void;
  projectStartDate: Date;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

type ViewMode = 'day' | 'month' | 'year';

const STYLES = {
  gridColor: '#94a3b8', 
  gridOpacity: 0.2,
  zoneBg: '#f8fafc',
  zoneBorder: '#cbd5e1',
  taskHeight: 50,
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
  onUpdateAnalysis,
  projectStartDate,
  onUndo,
  onRedo,
  canUndo,
  canRedo
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [activeTool, setActiveTool] = useState<'select' | 'text' | 'flag' | 'alert' | 'star' | 'check'>('select');
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Export State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'pdf' | 'png'>('pdf');
  const [includeAnnotations, setIncludeAnnotations] = useState(true);

  // Resize Observer
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

  // Process Data
  const processedData = useMemo(() => {
    const _tasks = tasks; 
    const taskMap = new Map(_tasks.map(t => [t.id, t]));

    const projectDuration = Math.max(..._tasks.map(t => t.earlyFinish || 0), 0);
    const criticalPathIds = _tasks.filter(t => t.isCritical).map(t => t.id);

    setTimeout(() => onUpdateAnalysis(criticalPathIds, projectDuration), 0);

    const zones: string[] = Array.from<string>(new Set(_tasks.map(t => t.zone || '默认分区'))).sort();
    
    const layoutData: { task: Task; laneIndex: number; globalRowIndex: number; zone: string }[] = [];
    let currentGlobalRow = 0;
    const zoneMeta: { name: string; startRow: number; rowCount: number; endRow: number }[] = [];
    
    const taskLaneMap = new Map<string, number>();

    zones.forEach(zone => {
      const zoneTasks = _tasks.filter(t => (t.zone || '默认分区') === zone);
      zoneTasks.sort((a, b) => (a.earlyStart || 0) - (b.earlyStart || 0) || a.id.localeCompare(b.id));

      const lanes: number[] = [];
      const zoneStartRow = currentGlobalRow;

      zoneTasks.forEach(task => {
        let assignedLane = -1;
        
        // Try to align with predecessor
        const directPred = task.predecessors
             .map(pid => taskMap.get(pid))
             .find(p => p && (p.zone || '默认分区') === zone && Math.abs((p.earlyFinish || 0) - (task.earlyStart || 0)) < 0.01);
        
        if (directPred) {
            const predLane = taskLaneMap.get(directPred.id);
            if (predLane !== undefined && (lanes[predLane] || 0) <= (task.earlyStart || 0) + 0.1) {
                assignedLane = predLane;
            }
        }

        if (assignedLane === -1) {
            for (let i = 0; i < lanes.length; i++) {
              if ((lanes[i] || 0) <= (task.earlyStart || 0) + 0.1) {
                assignedLane = i;
                break;
              }
            }
        }

        if (assignedLane === -1) {
          assignedLane = lanes.length;
          lanes.push(0);
        }
        
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

  const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  const formatDateStr = (days: number) => {
    const d = addDays(projectStartDate, days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const parseDateStr = (dateStr: string) => {
    const d = new Date(dateStr);
    const start = new Date(projectStartDate);
    const diffTime = d.getTime() - start.getTime();
    return Math.round(diffTime / (1000 * 3600 * 24));
  };

  const executeExport = async () => {
    if (!containerRef.current || !svgRef.current) return;
    
    // Toggle annotation visibility
    const annotationLayer = d3.select(svgRef.current).select(".annotation-layer");
    const originalDisplay = annotationLayer.style("display");
    
    if (!includeAnnotations) {
        annotationLayer.style("display", "none");
    }

    try {
        const canvas = await html2canvas(containerRef.current, { scale: 2, useCORS: true });
        
        if (exportFormat === 'pdf') {
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] });
            pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save(`IntelliPlan-Network-${new Date().toISOString().split('T')[0]}.pdf`);
        } else {
            const link = document.createElement('a');
            link.download = `IntelliPlan-Network-${new Date().toISOString().split('T')[0]}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }
    } catch (e) {
        console.error("Export failed", e);
        alert("导出失败，请重试");
    } finally {
        if (!includeAnnotations) {
            annotationLayer.style("display", originalDisplay);
        }
        setShowExportModal(false);
    }
  };

  // D3 Render
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || dimensions.width === 0) return;

    const width = dimensions.width;
    const height = dimensions.height;
    
    const svg = d3.select(svgRef.current);

    svg.selectAll("*").remove();

    // Defs: Markers
    const defs = svg.append("defs");
    
    // Updated Arrow Size
    defs.append("marker")
      .attr("id", "arrow-normal")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 10)
      .attr("refY", 5)
      .attr("markerWidth", 8)
      .attr("markerHeight", 4)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", STYLES.normalColor);

    defs.append("marker")
      .attr("id", "arrow-critical")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 10) 
      .attr("refY", 5)
      .attr("markerWidth", 8)
      .attr("markerHeight", 4)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", STYLES.criticalColor);

    const initialXScale = d3.scaleTime()
      .domain([projectStartDate, addDays(projectStartDate, processedData.projectDuration + 15)])
      .range([120, width - 50]);

    const rowHeight = STYLES.taskHeight;
    const contentHeight = Math.max(height, processedData.totalRows * rowHeight + 100);
    
    const mainGroup = svg.append("g");
    const gridGroup = mainGroup.append("g").attr("class", "grid-layer");
    const zoneGroup = mainGroup.append("g").attr("class", "zone-layer");
    const linkGroup = mainGroup.append("g").attr("class", "link-layer");
    const nodeGroup = mainGroup.append("g").attr("class", "node-layer");
    const textGroup = mainGroup.append("g").attr("class", "text-layer");
    const annotationGroup = mainGroup.append("g").attr("class", "annotation-layer");

    const taskCoords = new Map<string, { startX: number, endX: number, y: number, task: Task }>();

    const draw = (currentXScale: d3.ScaleTime<number, number>) => {
      // Grid
      gridGroup.selectAll("*").remove();
      const xAxisTicks = currentXScale.ticks(width / 80);
      gridGroup.selectAll(".v-grid")
        .data(xAxisTicks).enter().append("line")
        .attr("x1", d => currentXScale(d)).attr("x2", d => currentXScale(d))
        .attr("y1", 0).attr("y2", contentHeight)
        .attr("stroke", STYLES.gridColor).attr("stroke-width", 1).attr("stroke-opacity", STYLES.gridOpacity)
        .attr("stroke-dasharray", "4,4");

      gridGroup.selectAll(".grid-label")
        .data(xAxisTicks).enter().append("text")
        .attr("x", d => currentXScale(d)).attr("y", 20)
        .attr("text-anchor", "middle").attr("font-size", 10).attr("fill", "#64748b")
        .text(d => viewMode === 'year' ? d3.timeFormat("%Y年")(d) : viewMode === 'month' ? d3.timeFormat("%Y年%m月")(d) : d3.timeFormat("%Y-%m-%d")(d));

      // Zones
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
          .attr("font-size", 14).attr("font-weight", "bold").attr("fill", "#475569").text(zone.name);
      });

      // Calculate Coords
      taskCoords.clear();
      processedData.tasks.forEach(item => {
        const startDate = addDays(projectStartDate, item.task.earlyStart || 0);
        const endDate = addDays(projectStartDate, item.task.earlyFinish || 0);
        const startX = currentXScale(startDate);
        const endX = currentXScale(endDate);
        const y = (item.globalRowIndex * rowHeight) + 30 + (rowHeight / 2);
        taskCoords.set(item.task.id, { startX, endX, y, task: item.task });
      });

      linkGroup.selectAll("*").remove();
      nodeGroup.selectAll("*").remove();
      textGroup.selectAll("*").remove();

      const getNodeKey = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
      const uniqueNodes = new Map<string, {x: number, y: number, dateStr: string}>();

      processedData.tasks.forEach(item => {
        const coords = taskCoords.get(item.task.id);
        if (!coords) return;
        const { startX, endX, y, task } = coords;
        const isCritical = item.task.isCritical;
        const color = isCritical ? STYLES.criticalColor : STYLES.normalColor;
        const r = STYLES.nodeRadius;

        const arrowStartX = startX + r;
        const arrowEndX = endX - r;

        // Drag Behavior
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
             d3.select(this)
               .attr("x1", arrowStartX + dx)
               .attr("x2", arrowEndX + dx)
               .attr("y1", y + dy)
               .attr("y2", y + dy);
          })
          .on("end", function(event) {
             d3.select(this).attr("stroke-width", isCritical ? 2.5 : 1.5).attr("cursor", "grab");
             const dx = event.x - initialClickX;
             const dy = event.y - initialClickY;
             
             if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > rowHeight/2) {
               const newRowIndex = Math.floor(((y + dy) - 30) / rowHeight);
               let newZone = task.zone;
               for (const z of processedData.zoneMeta) {
                 if (newRowIndex >= z.startRow && newRowIndex < z.endRow) {
                   newZone = z.name;
                   break;
                 }
               }
               if (newZone && newZone !== task.zone && onUpdateTasks) {
                 onUpdateTasks(tasks.map(t => t.id === task.id ? { ...t, zone: newZone } : t));
                 return;
               }
             } 
             else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
                 const startDateVal = currentXScale.invert(startX);
                 const endDateVal = currentXScale.invert(startX + dx);
                 const diffTime = endDateVal.getTime() - startDateVal.getTime();
                 const diffDays = Math.round(diffTime / (1000 * 3600 * 24));
                 if (diffDays !== 0) {
                   const newDuration = Math.max(1, task.duration + diffDays);
                   onUpdateTasks && onUpdateTasks(tasks.map(t => t.id === task.id ? { ...t, duration: newDuration } : t));
                   return;
                 }
             }
             draw(currentXScale); 
          });

        // Draw Task Arrow (Horizontal)
        linkGroup.append("line")
          .attr("x1", arrowStartX).attr("y1", y)
          .attr("x2", arrowEndX).attr("y2", y)
          .attr("stroke", color).attr("stroke-width", isCritical ? 2.5 : 1.5)
          .attr("marker-end", isCritical ? "url(#arrow-critical)" : "url(#arrow-normal)")
          .attr("cursor", "grab")
          .on("click", () => setEditingTask(task))
          .call(dragArrow);

        // ForeignObject for wrapping text
        const textWidth = Math.max(100, Math.abs(arrowEndX - arrowStartX) + 40);
        const fo = textGroup.append("foreignObject")
           .attr("x", arrowStartX - 20)
           .attr("y", y - 45)
           .attr("width", textWidth)
           .attr("height", 40)
           .style("overflow", "visible");

        fo.append("xhtml:div")
           .style("display", "flex")
           .style("flex-direction", "column")
           .style("justify-content", "flex-end")
           .style("align-items", "center")
           .style("height", "100%")
           .style("text-align", "center")
           .style("font-size", "11px")
           .style("line-height", "1.1")
           .style("color", color)
           .style("pointer-events", "all") 
           .html(`<span class="cursor-pointer hover:font-bold hover:scale-105 transition-all select-none bg-white/60 px-1 rounded shadow-sm border border-transparent hover:border-slate-200">${task.name}</span>`);
        
        fo.on("click", (event) => {
           event.stopPropagation();
           setEditingTask(task);
        });
           
        // Duration Text below
        textGroup.append("text").attr("x", (startX + endX)/2).attr("y", y + 14).attr("text-anchor", "middle")
          .attr("font-size", 10).attr("fill", "#64748b").text(task.duration).attr("cursor", "pointer").on("click", () => setEditingTask(task));

        const startKey = getNodeKey(startX, y);
        const endKey = getNodeKey(endX, y);
        
        if (!uniqueNodes.has(startKey)) uniqueNodes.set(startKey, { x: startX, y, dateStr: d3.timeFormat("%m-%d")(addDays(projectStartDate, task.earlyStart||0)) });
        if (!uniqueNodes.has(endKey)) uniqueNodes.set(endKey, { x: endX, y, dateStr: d3.timeFormat("%m-%d")(addDays(projectStartDate, task.earlyFinish||0)) });

        // Draw Predecessors
        task.predecessors.forEach(pid => {
          const pred = taskCoords.get(pid);
          if (pred) {
            const pX = pred.endX;
            const pY = pred.y;
            const cX = startX;
            const cY = y;
            const gap = task.earlyStart! - (processedData.rawTasks.get(pid)?.earlyFinish || 0);

            let vY1 = pY; 
            let vY2 = cY;
            if (cY > pY) { vY1 += r; vY2 -= r; }
            else if (cY < pY) { vY1 -= r; vY2 += r; }
            else { vY1 += r; vY2 += r; } 

            if (gap > 0) {
              const midX = cX; 
              const waves = Math.floor((midX - pX) / 10);
              let d = `M ${pX + r} ${pY}`;
              for(let i=0; i<waves; i++) {
                d += ` q 5 -3 10 0`; 
              }
              d += ` L ${midX} ${pY}`;
              
              linkGroup.append("path").attr("d", d).attr("fill", "none").attr("stroke", "#94a3b8").attr("stroke-width", 1).attr("stroke-dasharray", "3,3");
              linkGroup.append("line").attr("x1", midX).attr("y1", pY + (cY > pY ? r : -r)).attr("x2", cX).attr("y2", vY2) 
                .attr("stroke", "#94a3b8").attr("stroke-dasharray", "3,3");
                
              const turnKey = getNodeKey(midX, pY);
              uniqueNodes.set(turnKey, { x: midX, y: pY, dateStr: d3.timeFormat("%m-%d")(addDays(projectStartDate, task.earlyStart||0)) });
            } else {
              if (Math.abs(pY - cY) > 1) {
                 linkGroup.append("line").attr("x1", pX).attr("y1", vY1).attr("x2", cX).attr("y2", vY2)
                   .attr("stroke", "#94a3b8").attr("stroke-width", 1).attr("stroke-dasharray", "3,3");
              }
            }
          }
        });
      });

      // Nodes
      uniqueNodes.forEach((node, key) => {
        const r = STYLES.nodeRadius;
        const endingTasks = processedData.tasks.filter(t => {
           const coords = taskCoords.get(t.task.id);
           return coords && getNodeKey(coords.endX, coords.y) === key;
        });

        const dragNode = d3.drag<SVGCircleElement, unknown>()
          .on("start", function() { d3.select(this).attr("r", 8).attr("fill", "orange"); })
          .on("drag", function(e) { d3.select(this).attr("cx", e.x); })
          .on("end", function(e) {
             d3.select(this).attr("r", r).attr("fill", "white");
             if (endingTasks.length > 0 && onUpdateTasks) {
               const newDate = currentXScale.invert(e.x);
               const oldDate = addDays(projectStartDate, endingTasks[0].task.earlyFinish || 0);
               const diffTime = newDate.getTime() - oldDate.getTime();
               const diffDays = Math.round(diffTime / (1000 * 3600 * 24));
               if (diffDays !== 0) {
                 onUpdateTasks(tasks.map(t => endingTasks.find(et => et.task.id === t.id) ? { ...t, duration: Math.max(1, t.duration + diffDays) } : t));
               } else {
                 draw(currentXScale);
               }
             }
          });

        const circle = nodeGroup.append("circle")
          .attr("cx", node.x).attr("cy", node.y)
          .attr("r", r)
          .attr("fill", "white").attr("stroke", "black").attr("stroke-width", 1);
        
        if (endingTasks.length > 0) {
           circle.attr("cursor", "ew-resize").call(dragNode);
        }

        nodeGroup.append("text").attr("x", node.x).attr("y", node.y + 18)
          .attr("text-anchor", "middle").attr("font-size", 9).attr("fill", "#64748b").text(node.dateStr);
      });

      // Annotations
      annotationGroup.selectAll("*").remove();
      const safeAnnotations = Array.isArray(annotations) ? annotations : [];
      safeAnnotations.forEach(ann => {
        const g = annotationGroup.append("g")
          .attr("transform", `translate(${ann.x}, ${ann.y})`)
          .attr("class", "annotation-group")
          .attr("cursor", "move");
        
        const dragAnn = d3.drag<SVGGElement, unknown>()
          .on("drag", function(e) { d3.select(this).attr("transform", `translate(${e.x}, ${e.y})`); })
          .on("end", function(e) {
             onUpdateAnnotations && onUpdateAnnotations(safeAnnotations.map(a => a.id === ann.id ? { ...a, x: e.x, y: e.y } : a));
          });
        g.call(dragAnn);

        if (ann.type === 'text') {
          if (editingAnnotationId === ann.id) {
             g.append("foreignObject").attr("width", 200).attr("height", 40).attr("x", -10).attr("y", -20)
              .append("xhtml:input")
              .style("width", "100%").style("background", "white").style("border", "1px solid blue").style("outline", "none")
              .attr("value", ann.content)
              .on("blur", function(e: any) {
                  onUpdateAnnotations && onUpdateAnnotations(safeAnnotations.map(a => a.id === ann.id ? { ...a, content: e.target.value } : a));
                  setEditingAnnotationId(null);
              })
              .on("keydown", function(e: any) {
                 if (e.key === 'Enter') {
                    onUpdateAnnotations && onUpdateAnnotations(safeAnnotations.map(a => a.id === ann.id ? { ...a, content: e.target.value } : a));
                    setEditingAnnotationId(null);
                 }
              })
              .each(function() { (this as HTMLInputElement).focus(); });
          } else {
            g.append("text").text(ann.content).attr("font-size", 14).attr("fill", "#333");
            g.append("rect").attr("x", -5).attr("y", -15).attr("width", ann.content.length * 10 + 10).attr("height", 20)
              .attr("fill", "transparent").attr("stroke", "transparent")
              .on("dblclick", () => setEditingAnnotationId(ann.id));
          }
        } else {
          g.append("circle").attr("r", 15).attr("fill", "yellow").attr("stroke", "orange");
          g.append("text").text(ann.content === 'flag' ? '🚩' : ann.content === 'star' ? '⭐' : '⚠️')
            .attr("text-anchor", "middle").attr("dy", 5);
        }
        g.on("contextmenu", (e) => { e.preventDefault(); onUpdateAnnotations && onUpdateAnnotations(safeAnnotations.filter(a => a.id !== ann.id)); });
      });
    };

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

    svg.on("click", (event) => {
      if (activeTool !== 'select' && onUpdateAnnotations) {
         const [x, y] = d3.pointer(event);
         const transform = d3.zoomTransform(svg.node()!);
         const newAnn: Annotation = {
           id: crypto.randomUUID(), type: activeTool === 'text' ? 'text' : 'icon',
           content: activeTool === 'text' ? '双击编辑' : activeTool,
           x: (x - transform.x) / transform.k, y: y - transform.y
         };
         onUpdateAnnotations([...(Array.isArray(annotations) ? annotations : []), newAnn]);
         setActiveTool('select');
      }
    });

  }, [processedData, projectStartDate, viewMode, dimensions, annotations, activeTool, editingAnnotationId]);

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
        <div className="h-4 w-px bg-slate-300 mx-2"></div>
        <div className="flex gap-1">
          <button 
            onClick={onUndo} 
            disabled={!canUndo}
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
            title="撤销 (Ctrl+Z)"
          >
            <Undo size={14} />
          </button>
          <button 
            onClick={onRedo} 
            disabled={!canRedo}
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
            title="重做 (Ctrl+Shift+Z)"
          >
            <Redo size={14} />
          </button>
        </div>
        <div className="flex-1"></div>
        <button onClick={() => setShowExportModal(true)} className="p-1 flex items-center gap-1 text-xs bg-cyan-600 text-white px-3 py-1 rounded hover:bg-cyan-700 shadow-sm transition">
          <Download size={14}/> 导出
        </button>
      </div>

      <div ref={containerRef} className={`flex-1 overflow-hidden relative bg-slate-50 ${activeTool === 'select' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}>
        <svg ref={svgRef} className="w-full h-full block"></svg>
        <div ref={tooltipRef} className="absolute pointer-events-none bg-white/95 p-3 rounded shadow-xl border border-slate-200 z-50 opacity-0 transition-opacity duration-150 text-sm min-w-[180px] backdrop-blur text-left" style={{ top: 0, left: 0 }} />
      </div>

      {showExportModal && (
        <div className="absolute inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl border border-slate-200 w-full max-w-sm flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-lg">
              <h4 className="font-bold text-slate-700 flex items-center gap-2"><Download size={18} className="text-cyan-600"/> 导出图纸设置</h4>
              <button onClick={() => setShowExportModal(false)} className="text-slate-400 hover:text-slate-600 transition"><X size={20}/></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-600 mb-2">导出格式</label>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => setExportFormat('pdf')}
                    className={`flex items-center justify-center gap-2 p-3 rounded border text-sm font-medium transition ${exportFormat === 'pdf' ? 'border-cyan-500 bg-cyan-50 text-cyan-700' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <FileText size={18} /> PDF 文档
                  </button>
                  <button 
                    onClick={() => setExportFormat('png')}
                    className={`flex items-center justify-center gap-2 p-3 rounded border text-sm font-medium transition ${exportFormat === 'png' ? 'border-cyan-500 bg-cyan-50 text-cyan-700' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <ImageIcon size={18} /> PNG 图片
                  </button>
                </div>
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded border border-slate-100">
                <input 
                  type="checkbox" 
                  id="includeAnnotations" 
                  checked={includeAnnotations} 
                  onChange={(e) => setIncludeAnnotations(e.target.checked)}
                  className="w-4 h-4 text-cyan-600 rounded focus:ring-cyan-500"
                />
                <label htmlFor="includeAnnotations" className="text-sm text-slate-700 cursor-pointer select-none font-medium">包含文本和图标批注</label>
              </div>
            </div>
            <div className="p-4 border-t bg-slate-50 rounded-b-lg flex justify-end gap-2">
              <button onClick={() => setShowExportModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded transition">取消</button>
              <button onClick={executeExport} className="bg-cyan-600 text-white px-6 py-2 rounded text-sm hover:bg-cyan-700 shadow-md transition font-medium">
                确认导出
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTask && (
        <div className="absolute inset-0 z-50 bg-slate-900/20 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl border border-slate-200 w-full max-w-lg flex flex-col animate-in fade-in zoom-in duration-200">
             <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-lg">
                <h4 className="font-bold text-slate-700 flex items-center gap-2 text-lg"><Edit3 size={18} className="text-blue-600"/> 编辑工作属性</h4>
                <button onClick={() => setEditingTask(null)} className="text-slate-400 hover:text-slate-600 transition"><X size={20}/></button>
             </div>
             <div className="p-5 grid gap-4 overflow-y-auto max-h-[70vh]">
                <div className="grid grid-cols-4 gap-4">
                   <div className="col-span-1">
                      <label className="block text-xs font-bold text-slate-500 mb-1">代号</label>
                      <input className="w-full border border-slate-300 rounded p-2 text-sm bg-slate-100 text-slate-500 cursor-not-allowed" value={editingTask.id} disabled title="代号不可修改" />
                   </div>
                   <div className="col-span-3">
                      <label className="block text-xs font-bold text-slate-500 mb-1">工作名称</label>
                      <input className="w-full border border-slate-300 rounded p-2 text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none" 
                        value={editingTask.name} 
                        onChange={e => setEditingTask({...editingTask, name: e.target.value})} 
                        placeholder="请输入工作名称"
                      />
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-md border border-slate-200">
                   <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1">开始日期 (约束)</label>
                     <input type="date" className="w-full border border-slate-300 rounded p-1.5 text-sm" 
                       value={formatDateStr(editingTask.earlyStart || 0)} 
                       onChange={e => {
                         const days = parseDateStr(e.target.value);
                         setEditingTask({...editingTask, constraintDate: days});
                       }} 
                     />
                     <div className="text-[10px] text-slate-400 mt-1">设置此项将限制最早开始时间</div>
                   </div>
                   <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1">完成日期 (自动调整工期)</label>
                     <input type="date" className="w-full border border-slate-300 rounded p-1.5 text-sm" 
                       value={formatDateStr(editingTask.earlyFinish || 0)} 
                       onChange={e => {
                         const endDays = parseDateStr(e.target.value);
                         const duration = Math.max(0, endDays - (editingTask.earlyStart || 0));
                         setEditingTask({...editingTask, duration});
                       }} 
                     />
                     <div className="text-[10px] text-slate-400 mt-1">修改完成日期会改变工期</div>
                   </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                   <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1">工期 (天)</label>
                     <input type="number" className="w-full border border-slate-300 rounded p-2 text-sm" value={editingTask.duration} onChange={e => setEditingTask({...editingTask, duration: parseInt(e.target.value)||0})} />
                   </div>
                   <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1">工区</label>
                     <input className="w-full border border-slate-300 rounded p-2 text-sm" value={editingTask.zone||''} onChange={e => setEditingTask({...editingTask, zone: e.target.value})} list="zones" />