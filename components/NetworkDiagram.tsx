
import React, { useEffect, useRef, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { Task, LinkType, Annotation } from '../types';
import { ZoomIn, ZoomOut, Download, Type, BoxSelect, Settings, Calendar, MousePointer2, Layers, Flag, AlertTriangle, Star, CheckCircle, Edit3, X, Undo, Redo, Save, Image as ImageIcon, FileText, Code, FileCode, Globe } from 'lucide-react';
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

// Custom palette for zones
const ZONE_COLORS = [
  '#2563eb', // Blue
  '#059669', // Emerald
  '#d97706', // Amber
  '#7c3aed', // Violet
  '#db2777', // Pink
  '#0891b2', // Cyan
  '#4f46e5', // Indigo
  '#ea580c', // Orange
  '#65a30d', // Lime
  '#be185d', // Rose
];

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
  const [showExportMenu, setShowExportMenu] = useState(false);

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

    const zones: string[] = Array.from<string>(new Set(_tasks.map(t => t.zone || '默认区域'))).sort();
    
    const layoutData: { task: Task; laneIndex: number; globalRowIndex: number; zone: string }[] = [];
    let currentGlobalRow = 0;
    const zoneMeta: { name: string; startRow: number; rowCount: number; endRow: number; color: string }[] = [];
    
    const taskLaneMap = new Map<string, number>();

    zones.forEach((zone, index) => {
      const zoneTasks = _tasks.filter(t => (t.zone || '默认区域') === zone);
      zoneTasks.sort((a, b) => (a.earlyStart || 0) - (b.earlyStart || 0) || a.id.localeCompare(b.id));

      const lanes: number[] = [];
      const zoneStartRow = currentGlobalRow;

      zoneTasks.forEach(task => {
        let assignedLane = -1;
        
        // Try to align with predecessor
        const directPred = task.predecessors
             .map(pid => taskMap.get(pid))
             .find(p => p && (p.zone || '默认区域') === zone && Math.abs((p.earlyFinish || 0) - (task.earlyStart || 0)) < 0.01);
        
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
      zoneMeta.push({ 
        name: zone, 
        startRow: zoneStartRow, 
        rowCount, 
        endRow: zoneStartRow + rowCount,
        color: ZONE_COLORS[index % ZONE_COLORS.length]
      });
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
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const start = new Date(projectStartDate);
    start.setHours(0,0,0,0);
    date.setHours(0,0,0,0);
    const diffTime = date.getTime() - start.getTime();
    return Math.round(diffTime / (1000 * 3600 * 24));
  };

  const generateDrawioContent = () => {
     const totalDays = processedData.projectDuration + 5; // Buffer
     
     // --- Adaptive Scaling Calculation ---
     const ROW_HEIGHT = STYLES.taskHeight;
     const unitRatio = 9/16;
     let calculatedPx = ROW_HEIGHT * unitRatio;
     if (totalDays > 100) calculatedPx = 25;
     else if (totalDays < 30) calculatedPx = 40;
     
     const rawPx = Math.max(25, Math.min(45, calculatedPx));
     const PX_PER_DAY = Math.max(3, Math.floor(rawPx / 10));
     
     const HEADER_HEIGHT = 60;
     const START_X = 40; // Left Margin

     const totalWidth = START_X + totalDays * PX_PER_DAY + 100;
     const totalHeight = HEADER_HEIGHT + processedData.totalRows * ROW_HEIGHT + 50;

     // OPTIMIZATION: Default to A3 Landscape size (1654 x 1169 px)
     const pageW = 1654;
     const pageH = 1169;
     
     // Helper for coordinates
     const getX = (day: number) => START_X + day * PX_PER_DAY;
     const getY = (globalRow: number) => HEADER_HEIGHT + globalRow * ROW_HEIGHT + ROW_HEIGHT / 2;
     
     let xml = '<mxfile host="Electron" modified="' + new Date().toISOString() + '" agent="IntelliPlan" etag="1" version="21.6.8" type="device">';
     xml += '<diagram id="diagram-1" name="Page-1">';
     xml += `<mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageW}" pageHeight="${pageH}" math="0" shadow="0">`;
     xml += '<root>';
     xml += '<mxCell id="0" />';
     xml += '<mxCell id="1" parent="0" />';
     
     // 1. Draw Time Ruler (Header)
     // Backgrounds
     xml += `<mxCell id="header-bg-year" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#f1f5f9;strokeColor=#e2e8f0;" vertex="1" parent="1">`;
     xml += `<mxGeometry x="0" y="0" width="${totalWidth}" height="20" as="geometry" /></mxCell>`;
     xml += `<mxCell id="header-bg-month" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#e2e8f0;" vertex="1" parent="1">`;
     xml += `<mxGeometry x="0" y="20" width="${totalWidth}" height="20" as="geometry" /></mxCell>`;
     xml += `<mxCell id="header-bg-day" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#f8fafc;strokeColor=#e2e8f0;" vertex="1" parent="1">`;
     xml += `<mxGeometry x="0" y="40" width="${totalWidth}" height="20" as="geometry" /></mxCell>`;

     // Ticks & Labels (Optimized for Month as smallest unit)
     for (let i = 0; i <= totalDays; i++) {
        const d = addDays(projectStartDate, i);
        const x = getX(i);
        
        if (d.getDate() === 1 || i === 0) {
             xml += `<mxCell id="lbl-month-${i}" value="${d.getMonth() + 1}月" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=10;fontColor=#475569;" vertex="1" parent="1">`;
             xml += `<mxGeometry x="${x + 2}" y="20" width="40" height="20" as="geometry" /></mxCell>`;
             
             xml += `<mxCell id="sep-month-${i}" value="" style="endArrow=none;html=1;strokeColor=#cbd5e1;strokeWidth=1;" edge="1" parent="1">`;
             xml += `<mxGeometry width="50" height="50" relative="1" as="geometry"><mxPoint x="${x}" y="20" as="sourcePoint" /><mxPoint x="${x}" y="40" as="targetPoint" /></mxGeometry></mxCell>`;
             
             xml += `<mxCell id="grid-month-${i}" value="" style="endArrow=none;html=1;strokeColor=#cbd5e1;strokeWidth=1;dashed=1;" edge="1" parent="1">`;
             xml += `<mxGeometry width="50" height="50" relative="1" as="geometry"><mxPoint x="${x}" y="${HEADER_HEIGHT}" as="sourcePoint" /><mxPoint x="${x}" y="${totalHeight}" as="targetPoint" /></mxGeometry></mxCell>`;
        }
        
        if ((d.getMonth() === 0 && d.getDate() === 1) || i === 0) {
             xml += `<mxCell id="lbl-year-${i}" value="${d.getFullYear()}年" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=10;fontColor=#64748b;fontStyle=1" vertex="1" parent="1">`;
             xml += `<mxGeometry x="${x + 2}" y="0" width="60" height="20" as="geometry" /></mxCell>`;
        }
     }

     // 2. Zones (Swimlanes)
     processedData.zoneMeta.forEach((zone, i) => {
        const yPos = HEADER_HEIGHT + zone.startRow * ROW_HEIGHT;
        const h = zone.rowCount * ROW_HEIGHT;
        const bgColor = (i % 2 === 0) ? '#ffffff' : '#f8fafc'; // Alternating Color

        // Header style with bgColor and specific font color
        xml += `<mxCell id="zone-${i}" value="${zone.name}" style="swimlane;startSize=20;horizontal=0;childLayout=flowLayout;flowOrientation=west;resizable=0;interFold=1;html=1;whiteSpace=wrap;fillColor=${bgColor};fontColor=${zone.color};fontStyle=1;dashed=1;strokeColor=#cbd5e1;" vertex="1" parent="1">`;
        xml += `<mxGeometry x="0" y="${yPos}" width="${totalWidth}" height="${h}" as="geometry" />`;
        xml += `</mxCell>`;
        
        // Inner white area for swimlane (using same background color)
        xml += `<mxCell id="zone-bg-${i}" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${bgColor};strokeColor=none;" vertex="1" parent="zone-${i}">`;
        xml += `<mxGeometry x="20" y="0" width="${totalWidth-20}" height="${h}" as="geometry" /></mxCell>`;
     });

     // Map for node IDs to ensure connectivity
     const nodeMap = new Map<string, string>(); 
     let nodeIdCounter = 1000;
     
     // Helper: Create Node
     const getOrCreateNodeId = (dayIndex: number, globalRow: number, type: 'circle'|'diamond') => {
        const x = getX(dayIndex);
        const y = getY(globalRow);
        
        const key = `${x.toFixed(1)},${y.toFixed(1)}`;
        if (nodeMap.has(key)) return nodeMap.get(key);
        
        const id = `node-${nodeIdCounter++}`;
        nodeMap.set(key, id);
        
        const isDiamond = type === 'diamond';
        const style = isDiamond
           ? "rhombus;whiteSpace=nowrap;html=1;fillColor=#ef4444;strokeColor=#ef4444;" 
           : "ellipse;whiteSpace=nowrap;html=1;aspect=fixed;fillColor=#ffffff;strokeColor=#000000;";
        
        const dateStr = d3.timeFormat("%m-%d")(addDays(projectStartDate, dayIndex > 0 ? dayIndex - 1 : 0));
        const size = 13;
        
        xml += `<mxCell id="${id}" value="${dateStr}" style="${style}verticalLabelPosition=bottom;verticalAlign=top;fontSize=9;fontColor=#64748b;" vertex="1" parent="1">`;
        xml += `<mxGeometry x="${x - size/2}" y="${y - size/2}" width="${size}" height="${size}" as="geometry" />`;
        xml += `</mxCell>`;
        return id;
     };

     // 3. Draw Tasks
     processedData.tasks.forEach(item => {
        const task = item.task;
        const isMilestone = task.type === LinkType.Wavy;
        const startDay = task.earlyStart || 0;
        const endDay = task.earlyFinish || 0;
        
        const effectiveEndDay = isMilestone ? startDay : endDay;
        
        const startNodeId = getOrCreateNodeId(startDay, item.globalRowIndex, 'circle');
        const endNodeId = getOrCreateNodeId(effectiveEndDay, item.globalRowIndex, isMilestone ? 'diamond' : 'circle');
        
        if (!isMilestone) {
            const edgeId = `task-${task.id}`;
            const color = task.isCritical ? "#ef4444" : "#000000";
            const width = task.isCritical ? 2 : 1;
            const isVirtual = task.type === LinkType.Virtual;

            let style = `endArrow=classic;html=1;strokeColor=${color};strokeWidth=${width};edgeStyle=none;rounded=0;orthogonalLoop=1;jettySize=auto;endSize=4;`;
            if (isVirtual) {
                style += "dashed=1;dashPattern=5 5;";
            }

            xml += `<mxCell id="${edgeId}" value="${task.name}" style="${style}verticalAlign=bottom;labelBackgroundColor=none;" edge="1" parent="1" source="${startNodeId}" target="${endNodeId}">`;
            xml += `<mxGeometry width="50" height="50" relative="1" as="geometry">`;
            xml += `<mxPoint x="${getX(startDay)}" y="${getY(item.globalRowIndex)}" as="sourcePoint" />`;
            xml += `<mxPoint x="${getX(endDay)}" y="${getY(item.globalRowIndex)}" as="targetPoint" />`;
            xml += `<mxPoint as="offset" y="-2" />`; 
            xml += `</mxGeometry>`;
            xml += `</mxCell>`;

            xml += `<mxCell id="${edgeId}-dur" value="${task.duration}d" style="edgeLabel;html=1;align=center;verticalAlign=top;resizable=0;points=[];labelBackgroundColor=none;fontColor=#64748b;fontSize=10;" vertex="1" connectable="0" parent="${edgeId}">`;
            xml += `<mxGeometry x="0" y="0" relative="1" as="geometry">`;
            xml += `<mxPoint as="offset" y="2" />`;
            xml += `</mxGeometry>`;
            xml += `</mxCell>`;
        } else {
            const mx = getX(startDay);
            const my = getY(item.globalRowIndex);
            xml += `<mxCell id="lbl-ms-${task.id}" value="${task.name}" style="text;html=1;align=center;verticalAlign=middle;resizable=0;points=[];autosize=1;strokeColor=none;fillColor=none;fontStyle=1;fontColor=${task.isCritical?'#ef4444':'#000000'}" vertex="1" parent="1">`;
            xml += `<mxGeometry x="${mx - 50}" y="${my - 30}" width="100" height="20" as="geometry" />`;
            xml += `</mxCell>`;
        }
        
        task.predecessors.forEach(pid => {
            const predItem = processedData.tasks.find(t => t.task.id === pid);
            if (predItem) {
                const predEndDay = predItem.task.earlyFinish || 0;
                const pNodeId = getOrCreateNodeId(predEndDay, predItem.globalRowIndex, predItem.task.type === LinkType.Wavy ? 'diamond' : 'circle');
                
                const gap = startDay - predEndDay;
                
                const x1 = getX(predEndDay);
                const y1 = getY(predItem.globalRowIndex);
                const x2 = getX(startDay);
                const y2 = getY(item.globalRowIndex);

                if (gap > 0) {
                     const turnNodeId = getOrCreateNodeId(startDay, predItem.globalRowIndex, 'circle');
                     
                     const floatId = `float-${pid}-${task.id}`;
                     const floatStyle = "endArrow=none;html=1;strokeColor=#64748b;dashed=1;dashPattern=1 2;strokeWidth=1;edgeStyle=none;rounded=0;"; 
                     
                     xml += `<mxCell id="${floatId}" value="" style="${floatStyle}" edge="1" parent="1" source="${pNodeId}" target="${turnNodeId}">`;
                     xml += `<mxGeometry relative="1" as="geometry"><mxPoint x="${x1}" y="${y1}" as="sourcePoint" /><mxPoint x="${x2}" y="${y1}" as="targetPoint" /></mxGeometry>`;
                     xml += `</mxCell>`;
                     
                     if (Math.abs(y1 - y2) > 1) {
                         const depId = `dep-${pid}-${task.id}`;
                         const depStyle = "endArrow=classic;html=1;dashed=1;strokeColor=#94a3b8;strokeWidth=1;edgeStyle=none;rounded=0;endSize=4;";
                         
                         xml += `<mxCell id="${depId}" value="" style="${depStyle}" edge="1" parent="1" source="${turnNodeId}" target="${startNodeId}">`;
                         xml += `<mxGeometry relative="1" as="geometry"><mxPoint x="${x2}" y="${y1}" as="sourcePoint" /><mxPoint x="${x2}" y="${y2}" as="targetPoint" /></mxGeometry>`;
                         xml += `</mxCell>`;
                     }

                } else {
                     if (Math.abs(y1 - y2) > 1) {
                         const depId = `dep-${pid}-${task.id}`;
                         const depStyle = "endArrow=classic;html=1;dashed=1;strokeColor=#94a3b8;strokeWidth=1;edgeStyle=none;rounded=0;endSize=4;";
                         
                         xml += `<mxCell id="${depId}" value="" style="${depStyle}" edge="1" parent="1" source="${pNodeId}" target="${startNodeId}">`;
                         xml += `<mxGeometry relative="1" as="geometry"><mxPoint x="${x1}" y="${y1}" as="sourcePoint" /><mxPoint x="${x2}" y="${y2}" as="targetPoint" /></mxGeometry>`;
                         xml += `</mxCell>`;
                     }
                }
            }
        });

     });

     xml += '</root></mxGraphModel></diagram></mxfile>';
     return xml;
  };

  const handleExport = async (type: 'pdf' | 'png' | 'svg' | 'drawio' | 'html') => {
    setShowExportMenu(false);
    if (!containerRef.current || !svgRef.current) return;
    
    const fileName = `network-plan-${new Date().getTime()}`;

    try {
        if (type === 'png' || type === 'pdf') {
            const canvas = await html2canvas(containerRef.current, { scale: 2, backgroundColor: '#ffffff' });
            const imgData = canvas.toDataURL('image/png');
            
            if (type === 'png') {
                const link = document.createElement('a');
                link.download = `${fileName}.png`;
                link.href = imgData;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] });
                pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
                pdf.save(`${fileName}.pdf`);
            }
        } else if (type === 'svg') {
             // Basic serialization
             const svgData = new XMLSerializer().serializeToString(svgRef.current);
             // Ensure namespace is present
             const svgWithNs = svgData.includes('xmlns') ? svgData : svgData.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
             const header = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>';
             const blob = new Blob([header + svgWithNs], { type: "image/svg+xml;charset=utf-8" });
             const url = URL.createObjectURL(blob);
             const link = document.createElement('a');
             link.href = url;
             link.download = `${fileName}.svg`;
             document.body.appendChild(link);
             link.click();
             document.body.removeChild(link);
        } else if (type === 'html') {
             const svgData = new XMLSerializer().serializeToString(svgRef.current);
             const htmlContent = `
               <!DOCTYPE html>
               <html lang="zh-CN">
               <head>
                 <meta charset="UTF-8">
                 <title>网络计划导出 - ${fileName}</title>
                 <style>
                    body { margin: 0; padding: 20px; font-family: sans-serif; background: #f8fafc; }
                    .container { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); overflow: auto; }
                    h1 { font-size: 18px; color: #334155; margin-bottom: 10px; }
                 </style>
               </head>
               <body>
                 <div class="container">
                   <h1>工程网络计划图</h1>
                   ${svgData}
                 </div>
               </body>
               </html>
             `;
             const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
             const url = URL.createObjectURL(blob);
             const link = document.createElement('a');
             link.href = url;
             link.download = `${fileName}.html`;
             document.body.appendChild(link);
             link.click();
             document.body.removeChild(link);
        } else if (type === 'drawio') {
             const xmlContent = generateDrawioContent();
             const blob = new Blob([xmlContent], { type: "text/xml;charset=utf-8" });
             const url = URL.createObjectURL(blob);
             const link = document.createElement('a');
             link.href = url;
             link.download = `${fileName}.drawio`;
             document.body.appendChild(link);
             link.click();
             document.body.removeChild(link);
        }
    } catch (e) {
        console.error("Export failed", e);
        alert("导出失败，请重试");
    }
  };

  // D3 Render logic...
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || dimensions.width === 0) return;

    const width = dimensions.width;
    const height = dimensions.height;
    
    const svg = d3.select(svgRef.current);

    svg.selectAll("*").remove();

    // Defs: Markers
    const defs = svg.append("defs");
    
    // Critical Arrow (Red) - Reduced size
    defs.append("marker")
      .attr("id", "arrow-critical")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 10) 
      .attr("refY", 5)
      .attr("markerWidth", 6) // Decreased from 8
      .attr("markerHeight", 3) // Decreased from 4
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", STYLES.criticalColor);

    // Dependency Arrow (Gray Dashed Line Endpoint) - Updated for visibility
    defs.append("marker")
      .attr("id", "arrow-dependency")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 10) 
      .attr("refY", 5)
      .attr("markerWidth", 6)
      .attr("markerHeight", 4)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", "#64748b"); // Slate 500

    // Dynamic Markers for Zones
    processedData.zoneMeta.forEach((zone, i) => {
      const zoneId = `arrow-zone-${i}`;
      defs.append("marker")
        .attr("id", zoneId)
        .attr("viewBox", "0 0 10 10")
        .attr("refX", 10)
        .attr("refY", 5)
        .attr("markerWidth", 8)
        .attr("markerHeight", 4)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M 0 0 L 10 5 L 0 10 z")
        .attr("fill", zone.color);
    });

    const initialXScale = d3.scaleTime()
      .domain([projectStartDate, addDays(projectStartDate, processedData.projectDuration + 15)])
      .range([120, width - 50]);

    const rowHeight = STYLES.taskHeight;
    const contentHeight = Math.max(height, processedData.totalRows * rowHeight + 100);
    
    const mainGroup = svg.append("g");
    const bgGroup = mainGroup.append("g").attr("class", "bg-layer"); // Added BG layer
    const gridGroup = mainGroup.append("g").attr("class", "grid-layer");
    const zoneGroup = mainGroup.append("g").attr("class", "zone-layer");
    const linkGroup = mainGroup.append("g").attr("class", "link-layer");
    const nodeGroup = mainGroup.append("g").attr("class", "node-layer");
    const textGroup = mainGroup.append("g").attr("class", "text-layer");
    const annotationGroup = mainGroup.append("g").attr("class", "annotation-layer");

    const taskCoords = new Map<string, { startX: number, endX: number, y: number, task: Task, isMilestone: boolean }>();

    const draw = (currentXScale: d3.ScaleTime<number, number>) => {
      // Clear all
      bgGroup.selectAll("*").remove();
      gridGroup.selectAll("*").remove();
      zoneGroup.selectAll("*").remove();
      linkGroup.selectAll("*").remove();
      nodeGroup.selectAll("*").remove();
      textGroup.selectAll("*").remove();
      annotationGroup.selectAll("*").remove();

      // Grid
      const xAxisTicks = currentXScale.ticks(width / 100);
      
      gridGroup.selectAll(".v-grid")
        .data(xAxisTicks).enter().append("line")
        .attr("x1", d => currentXScale(d)).attr("x2", d => currentXScale(d))
        .attr("y1", 0).attr("y2", contentHeight)
        .attr("stroke", STYLES.gridColor).attr("stroke-width", 1).attr("stroke-opacity", STYLES.gridOpacity)
        .attr("stroke-dasharray", "4,4"); // Dot-dash line

      // Time Ruler (3 Rows: Year, Month, Day)
      gridGroup.append("rect").attr("x", 0).attr("y", 0).attr("width", width * 5).attr("height", 20).attr("fill", "#f1f5f9").attr("stroke", "#e2e8f0");
      gridGroup.append("rect").attr("x", 0).attr("y", 20).attr("width", width * 5).attr("height", 20).attr("fill", "#fff").attr("stroke", "#e2e8f0");
      gridGroup.append("rect").attr("x", 0).attr("y", 40).attr("width", width * 5).attr("height", 20).attr("fill", "#f8fafc").attr("stroke", "#e2e8f0");

      const tickFormatYear = d3.timeFormat("%Y年");
      const tickFormatMonth = d3.timeFormat("%m月");
      const tickFormatDay = d3.timeFormat("%d");

      // Generate ticks based on visibility
      const domain = currentXScale.domain();
      const days = d3.timeDay.range(domain[0], domain[1], 1);
      const months = d3.timeMonth.range(domain[0], domain[1], 1);
      const years = d3.timeYear.range(domain[0], domain[1], 1);

      // Draw Years
      gridGroup.selectAll(".tick-year")
        .data(years).enter().append("text")
        .attr("x", d => Math.max(120, currentXScale(d))).attr("y", 14)
        .attr("text-anchor", "start").attr("font-size", 10).attr("fill", "#64748b").attr("font-weight", "bold")
        .text(d => tickFormatYear(d));

      // Draw Months
      gridGroup.selectAll(".tick-month")
        .data(months).enter().append("text")
        .attr("x", d => {
            const x = currentXScale(d);
            return x < 120 ? -1000 : x + 5; 
        }).attr("y", 34)
        .attr("text-anchor", "start").attr("font-size", 10).attr("fill", "#475569")
        .text(d => tickFormatMonth(d));
        
      // Draw Months separator
      gridGroup.selectAll(".sep-month")
        .data(months).enter().append("line")
        .attr("x1", d => currentXScale(d)).attr("x2", d => currentXScale(d))
        .attr("y1", 20).attr("y2", 40).attr("stroke", "#e2e8f0");

      // Draw Days
      const daysWidth = currentXScale(addDays(domain[0], 1)) - currentXScale(domain[0]);
      if (daysWidth > 15) {
        gridGroup.selectAll(".tick-day")
            .data(days).enter().append("text")
            .attr("x", d => currentXScale(d) + daysWidth/2).attr("y", 54)
            .attr("text-anchor", "middle").attr("font-size", 9).attr("fill", "#94a3b8")
            .text(d => tickFormatDay(d));
            
        gridGroup.selectAll(".sep-day")
            .data(days).enter().append("line")
            .attr("x1", d => currentXScale(d)).attr("x2", d => currentXScale(d))
            .attr("y1", 40).attr("y2", 60).attr("stroke", "#f1f5f9");
      }

      // Draw Zones Backgrounds & Labels
      processedData.zoneMeta.forEach((zone, i) => {
        const yPos = zone.startRow * rowHeight + 60; 
        const h = zone.rowCount * rowHeight;
        
        // Alternating Color
        const bgColor = (i % 2 === 0) ? '#ffffff' : '#f8fafc';

        // 1. Full Width Background
        bgGroup.append("rect")
            .attr("x", 0)
            .attr("y", yPos)
            .attr("width", width * 5)
            .attr("height", h)
            .attr("fill", bgColor)
            .attr("stroke", "none");

        // 2. Zone Separator
        gridGroup.append("line").attr("x1", 0).attr("x2", width * 5)
          .attr("y1", yPos + h).attr("y2", yPos + h)
          .attr("stroke", STYLES.zoneBorder).attr("stroke-width", 1)
          .attr("stroke-dasharray", "5,5");

        // 3. Zone Label (Left)
        const zoneLabelGroup = zoneGroup.append("g").attr("transform", `translate(0, ${yPos})`);
        
        // Box background matches row background
        zoneLabelGroup.append("rect").attr("width", 120).attr("height", h).attr("fill", bgColor).attr("stroke", STYLES.zoneBorder);
        
        // Color strip
        zoneLabelGroup.append("rect").attr("width", 5).attr("height", h).attr("fill", zone.color);

        // Text
        zoneLabelGroup.append("text").attr("x", 62).attr("y", h/2).attr("text-anchor", "middle").attr("dominant-baseline", "middle")
          .attr("font-size", 14).attr("font-weight", "bold").attr("fill", zone.color).text(zone.name);
      });

      // Calculate Coords
      taskCoords.clear();
      processedData.tasks.forEach(item => {
        const isMilestone = item.task.type === LinkType.Wavy; // Wavy is mapped to Milestone
        const startDate = addDays(projectStartDate, item.task.earlyStart || 0);
        const endDate = addDays(projectStartDate, item.task.earlyFinish || 0);
        
        let startX = currentXScale(startDate);
        const endX = currentXScale(endDate);
        const y = (item.globalRowIndex * rowHeight) + 60 + (rowHeight / 2); // +60 for header
        
        // For Milestone, visually collapse start and end to the same point (usually the milestone date)
        if (isMilestone) {
            startX = endX;
        }

        taskCoords.set(item.task.id, { startX, endX, y, task: item.task, isMilestone });
      });

      const getNodeKey = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
      const uniqueNodes = new Map<string, {x: number, y: number, dayIndex: number, type: 'circle' | 'diamond', task?: Task}>();

      processedData.tasks.forEach(item => {
        const coords = taskCoords.get(item.task.id);
        if (!coords) return;
        const { startX, endX, y, task, isMilestone } = coords;
        const isCritical = item.task.isCritical;
        
        // Determine Color: Critical ? Red : Zone Color
        const zoneIndex = processedData.zoneMeta.findIndex(z => z.name === task.zone);
        const zoneColor = zoneIndex >= 0 ? processedData.zoneMeta[zoneIndex].color : STYLES.normalColor;
        const color = isCritical ? STYLES.criticalColor : zoneColor;
        
        const r = STYLES.nodeRadius;

        // If it's a milestone, we DO NOT draw the line or the duration
        if (isMilestone) {
             // Draw Task Name above the diamond (since line is gone)
             const foWidth = 120;
             const foX = startX - foWidth/2;
             
             const fo = textGroup.append("foreignObject")
               .attr("x", foX)
               .attr("y", y - 55) // Above - Increased height offset from 40 to 55 to avoid overlap
               .attr("width", foWidth)
               .attr("height", 40)
               .style("overflow", "visible")
               .style("pointer-events", "none");

             fo.append("xhtml:div")
               .style("display", "flex")
               .style("flex-direction", "column")
               .style("justify-content", "flex-end")
               .style("align-items", "center")
               .style("height", "100%")
               .style("text-align", "center")
               .style("font-size", "11px")
               .style("font-weight", "normal") // CHANGED: Bold to Normal
               .style("line-height", "1.1")
               .style("color", color) 
               .style("pointer-events", "all") 
               .html(`<span class="cursor-pointer hover:scale-105 transition-all select-none px-1 break-words w-full">${task.name}</span>`)
               .on("click", () => setEditingTask(task));

             // Note: Milestone Duration is not displayed as per requirement
        } else {
             // Standard Task Drawing
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
                  d3.select(this).attr("stroke-width", isCritical ? 2 : 1.5).attr("cursor", "grab");
                  const dx = event.x - initialClickX;
                  const dy = event.y - initialClickY;
                  
                  // Vertical Drag: Move Zone
                  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > rowHeight/2) {
                    const newRowIndex = Math.floor(((y + dy) - 60) / rowHeight);
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
                    draw(currentXScale); // Reset if no change
                  } 
                  // Horizontal Drag: Change Duration
                  else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
                      const timeSpan = currentXScale.invert(arrowStartX + dx).getTime() - currentXScale.invert(arrowStartX).getTime();
                      const diffDays = Math.round(timeSpan / (1000 * 3600 * 24));
                      
                      if (diffDays !== 0) {
                        const newDuration = Math.max(1, task.duration + diffDays);
                        if (newDuration !== task.duration && onUpdateTasks) {
                             onUpdateTasks(tasks.map(t => t.id === task.id ? { ...t, duration: newDuration } : t));
                             return;
                        }
                      }
                      draw(currentXScale); // Reset if no change
                  } else {
                      draw(currentXScale); // Reset position
                  }
               });

             // Determine Marker URL
             const markerUrl = isCritical ? "url(#arrow-critical)" : `url(#arrow-zone-${zoneIndex})`;

             const isVirtual = task.type === LinkType.Virtual;

             // Draw Task Arrow (Horizontal)
             const line = linkGroup.append("line")
               .attr("x1", arrowStartX).attr("y1", y)
               .attr("x2", arrowEndX).attr("y2", y)
               .attr("stroke", color)
               .attr("stroke-width", isVirtual ? 1 : (isCritical ? 2 : 1.5)) // CHANGED: Reduced width for virtual
               .attr("marker-end", markerUrl)
               .attr("cursor", "grab")
               .on("click", () => setEditingTask(task))
               .call(dragArrow);
             
             // Apply dashed style if virtual
             if (isVirtual) {
               line.attr("stroke-dasharray", "5,5");
             }

             // Task Name
             const taskVisualWidth = Math.max(0, arrowEndX - arrowStartX);
             const foWidth = Math.max(40, taskVisualWidth); 
             const foX = arrowStartX;
             
             const fo = textGroup.append("foreignObject")
                .attr("x", foX)
                .attr("y", y - 45) // Above the line
                .attr("width", foWidth)
                .attr("height", 40)
                .style("overflow", "visible")
                .style("pointer-events", "none"); 

             fo.append("xhtml:div")
                .style("display", "flex")
                .style("flex-direction", "column")
                .style("justify-content", "flex-end")
                .style("align-items", "center")
                .style("height", "100%")
                .style("text-align", "center")
                .style("font-size", "11px")
                .style("font-weight", "normal") // CHANGED: Bold to Normal
                .style("line-height", "1.1")
                .style("color", color) 
                .style("pointer-events", "all") 
                .html(`<span class="cursor-pointer hover:font-bold hover:scale-105 transition-all select-none px-1 break-words w-full">${task.name}</span>`)
                .on("click", () => setEditingTask(task));
             
             // Duration Text below
             textGroup.append("text").attr("x", (startX + endX)/2).attr("y", y + 14).attr("text-anchor", "middle")
               .attr("font-size", 10).attr("fill", "#64748b").text(task.duration + "d").attr("cursor", "pointer").on("click", () => setEditingTask(task));
        }

        // Collect Nodes
        const startKey = getNodeKey(startX, y);
        const endKey = getNodeKey(endX, y);
        
        if (isMilestone) {
            const existing = uniqueNodes.get(endKey);
            uniqueNodes.set(endKey, { 
                x: endX, 
                y, 
                dayIndex: task.earlyFinish || 0,
                type: 'diamond',
                task: task 
            });
        } else {
            const sNode = uniqueNodes.get(startKey);
            if (!sNode || sNode.type !== 'diamond') {
                 uniqueNodes.set(startKey, { x: startX, y, dayIndex: task.earlyStart || 0, type: 'circle' });
            }
            const eNode = uniqueNodes.get(endKey);
            if (!eNode || eNode.type !== 'diamond') {
                 uniqueNodes.set(endKey, { x: endX, y, dayIndex: task.earlyFinish || 0, type: 'circle' });
            }
        }
      });

      // Draw Dependencies (Fixed Logic)
      processedData.tasks.forEach(item => {
        const task = item.task;
        const coords = taskCoords.get(task.id);
        if(!coords) return;
        
        const { startX: cX, y: cY } = coords;
        const r = STYLES.nodeRadius;

        task.predecessors.forEach(pid => {
          const pred = taskCoords.get(pid);
          if (pred) {
            const { endX: pX, y: pY } = pred;
            
            const gapDays = Math.round((task.earlyStart || 0) - (processedData.rawTasks.get(pid)?.earlyFinish || 0));

            let vY1 = pY; 
            let vY2 = cY;
            if (cY > pY) { vY1 += r; vY2 -= r; }
            else if (cY < pY) { vY1 -= r; vY2 += r; }
            
            // 1. Free Float (Wave)
            if (gapDays > 0) {
              const midX = cX; 
              const width = midX - pX;
              let pathData = `M ${pX + r} ${pY}`;
              const waveSegmentWidth = 10;
              const numSegments = Math.floor(width / waveSegmentWidth);
              
              for (let i = 0; i < numSegments; i++) {
                 pathData += ` q 2.5 -4 5 0 t 5 0`; 
              }
              const remainingX = (pX + r + numSegments * waveSegmentWidth);
              if (remainingX < midX) {
                  pathData += ` L ${midX} ${pY}`;
              }

              linkGroup.append("path")
                .attr("d", pathData)
                .attr("fill", "none")
                .attr("stroke", "#64748b") 
                .attr("stroke-width", 1);
              
              linkGroup.append("line")
                 .attr("x1", midX).attr("y1", pY + (cY > pY ? r : -r))
                 .attr("x2", cX).attr("y2", vY2) 
                 .attr("stroke", "#64748b")
                 .attr("stroke-dasharray", "3,3")
                 .attr("marker-end", "url(#arrow-dependency)");
                
              const turnKey = getNodeKey(midX, pY);
              if (!uniqueNodes.has(turnKey)) {
                 uniqueNodes.set(turnKey, { x: midX, y: pY, dayIndex: task.earlyStart || 0, type: 'circle' });
              }
            } 
            // 2. Direct Dependency (Vertical Dashed)
            else {
               if (Math.abs(pY - cY) > r * 2) {
                   linkGroup.append("line")
                     .attr("x1", pX).attr("y1", vY1)
                     .attr("x2", pX).attr("y2", vY2)
                     .attr("stroke", "#64748b")
                     .attr("stroke-width", 1) 
                     .attr("stroke-dasharray", "3,3")
                     .attr("marker-end", "url(#arrow-dependency)");
               }
            }
          }
        });
      });

      // Draw Nodes from uniqueNodes map
      uniqueNodes.forEach((node) => {
        if (node.type === 'diamond') {
             nodeGroup.append("path")
                .attr("transform", `translate(${node.x}, ${node.y})`)
                .attr("d", d3.symbol().type(d3.symbolDiamond).size(100)()) 
                .attr("fill", "#ffffff") // CHANGED: STYLES.criticalColor to #ffffff (No fill)
                .attr("stroke", STYLES.criticalColor);
        } else {
             nodeGroup.append("circle")
                .attr("cx", node.x).attr("cy", node.y)
                .attr("r", STYLES.nodeRadius)
                .attr("fill", "#fff")
                .attr("stroke", "#000");
        }

        const displayDayIndex = node.dayIndex > 0 ? node.dayIndex - 1 : 0;
        const dateStr = d3.timeFormat("%m-%d")(addDays(projectStartDate, displayDayIndex));

        nodeGroup.append("text").attr("x", node.x).attr("y", node.y + 18)
          .attr("text-anchor", "middle").attr("font-size", 9).attr("fill", "#64748b").text(dateStr);
      });

      // Annotations
      annotationGroup.selectAll("*").remove();
      const safeAnnotations = Array.isArray(annotations) ? annotations : [];
      safeAnnotations.forEach(ann => {
        const g = annotationGroup.append("g")
          .attr("transform", `translate(${ann.x}, ${ann.y})`)
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
        bgGroup.attr("transform", `translate(0, ${yOffset})`); // Sync BG move
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
        
        <div className="relative">
            <button 
                onClick={() => setShowExportMenu(!showExportMenu)} 
                className="p-1 flex items-center gap-1 text-xs bg-cyan-600 text-white px-3 py-1 rounded hover:bg-cyan-700 shadow-sm transition"
            >
              <Download size={14}/> 导出
            </button>
            
            {showExportMenu && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)}></div>
                    <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 shadow-xl rounded-md overflow-hidden z-50 w-44 flex flex-col animate-in fade-in zoom-in-95 duration-100">
                        <button onClick={() => handleExport('png')} className="text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-cyan-600 flex items-center gap-2 transition-colors border-b border-slate-50">
                            <ImageIcon size={14} className="text-purple-500"/> 
                            <span>图片 (PNG)</span>
                        </button>
                        <button onClick={() => handleExport('pdf')} className="text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-cyan-600 flex items-center gap-2 transition-colors border-b border-slate-50">
                            <FileText size={14} className="text-red-500"/> 
                            <span>文档 (PDF)</span>
                        </button>
                         <button onClick={() => handleExport('svg')} className="text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-cyan-600 flex items-center gap-2 transition-colors border-b border-slate-50">
                            <Code size={14} className="text-orange-500"/> 
                            <span>矢量图 (SVG)</span>
                        </button>
                         <button onClick={() => handleExport('drawio')} className="text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-cyan-600 flex items-center gap-2 transition-colors border-b border-slate-50">
                            <FileCode size={14} className="text-blue-500"/> 
                            <span>Draw.io (XML)</span>
                        </button>
                        <button onClick={() => handleExport('html')} className="text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-cyan-600 flex items-center gap-2 transition-colors">
                            <Globe size={14} className="text-emerald-500"/> 
                            <span>网页 (HTML)</span>
                        </button>
                    </div>
                </>
            )}
        </div>
      </div>

      <div ref={containerRef} className={`flex-1 overflow-hidden relative bg-slate-50 ${activeTool === 'select' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}>
        <svg ref={svgRef} className="w-full h-full block"></svg>
        <div ref={tooltipRef} className="absolute pointer-events-none bg-white/95 p-3 rounded shadow-xl border border-slate-200 z-50 opacity-0 transition-opacity duration-150 text-sm min-w-[180px] backdrop-blur text-left" style={{ top: 0, left: 0 }} />
      </div>

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
                     <label className="block text-xs font-bold text-slate-500 mb-1">区域</label>
                     <input className="w-full border border-slate-300 rounded p-2 text-sm" value={editingTask.zone||''} onChange={e => setEditingTask({...editingTask, zone: e.target.value})} list="zones" />
                     <datalist id="zones">
                       {processedData.zoneMeta.map(z => <option key={z.name} value={z.name} />)}
                     </datalist>
                   </div>
                   <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1">类型</label>
                       <select className="w-full border border-slate-300 rounded p-2 text-sm bg-white" value={editingTask.type} onChange={e => setEditingTask({...editingTask, type: e.target.value as LinkType})}>
                           <option value={LinkType.Real}>实工作</option>
                           <option value={LinkType.Virtual}>虚工作 (等待/缓冲)</option>
                           <option value={LinkType.Wavy}>里程碑</option>
                       </select>
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">父工作代号</label>
                        <input className="w-full border border-slate-300 rounded p-2 text-sm" value={editingTask.parentId || ''} placeholder="可选，用于分组" onChange={e => setEditingTask({...editingTask, parentId: e.target.value || undefined})} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">紧前工作</label>
                        <input className="w-full border border-slate-300 rounded p-2 text-sm" value={editingTask.predecessors.join(',')} onChange={e => setEditingTask({...editingTask, predecessors: e.target.value.split(',').filter(x=>x)})} />
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">备注/描述</label>
                    <textarea className="w-full border border-slate-300 rounded p-2 text-sm h-20 resize-none focus:ring-2 focus:ring-blue-500 outline-none" 
                      value={editingTask.description || ''} 
                      onChange={e => setEditingTask({...editingTask, description: e.target.value})} 
                      placeholder="输入工作备注或详细描述..."
                    />
                </div>
             </div>
             <div className="p-4 border-t bg-slate-50 rounded-b-lg flex justify-end gap-2">
                <button onClick={() => setEditingTask(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded transition">取消</button>
                <button onClick={() => { onUpdateTasks && onUpdateTasks(tasks.map(t => t.id === editingTask.id ? editingTask : t)); setEditingTask(null); }} className="bg-blue-600 text-white px-6 py-2 rounded text-sm hover:bg-blue-700 shadow-md transition font-medium flex items-center gap-2">
                  <Save size={16} /> 保存修改
                </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NetworkDiagram;
