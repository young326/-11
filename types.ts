
// Data models for the application

export enum LinkType {
  Real = 'Real',
  Virtual = 'Virtual', // Dashed line
  Wavy = 'Wavy' // Usually implies wait/buffer, technically standard AOD uses dashed for virtual
}

export interface Annotation {
  id: string;
  type: 'text' | 'icon';
  content: string; // text content or icon name
  x: number;
  y: number;
  style?: {
    color?: string;
    fontSize?: number;
    backgroundColor?: string;
  };
}

export interface Task {
  id: string;
  name: string;
  duration: number; // in days
  predecessors: string[]; // IDs of preceding tasks
  type: LinkType;
  zone?: string; // Partition/Zone
  description?: string;
  parentId?: string; // For hierarchical grouping
  
  // Calculated fields for Critical Path Method (CPM)
  earlyStart?: number;
  earlyFinish?: number;
  lateStart?: number;
  lateFinish?: number;
  totalFloat?: number;
  isCritical?: boolean;
}

export interface Project {
  id: string;
  name: string;
  lastModified: number;
  tasks: Task[];
  annotations?: Annotation[]; // Added annotations support
  description?: string;
}

export interface NetworkNode {
  id: number;
  x?: number;
  y?: number;
  time?: number; // Logical time for X-axis
}

export interface NetworkLink {
  source: number; // Node ID
  target: number; // Node ID
  task: Task;
}

export interface AnalysisResult {
  criticalPath: string[];
  suggestions: string;
  estimatedDuration: number;
}
