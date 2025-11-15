/**
 * Git-style ASCII Graph Renderer
 *
 * Creates ASCII visualizations of directed acyclic graphs (DAGs) similar to git log --graph.
 * Supports branching, merging, and parallel execution visualization.
 */

export interface GraphNode {
  id: string;
  label: string;
  parents?: string[];  // Parent node IDs (for dependencies/merges)
  column?: number;     // Assigned column for rendering
  row?: number;        // Row index in the output
  metadata?: Record<string, any>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type?: 'straight' | 'merge' | 'fork';
}

export interface RenderOptions {
  style?: 'unicode' | 'ascii';
  compact?: boolean;
  showLabels?: boolean;
  maxLabelWidth?: number;
  colors?: boolean;
}

// ASCII characters for graph rendering
const ASCII_CHARS = {
  commit: '*',
  vertical: '|',
  horizontalLeft: '-',
  horizontalRight: '-',
  branchDown: '\\',
  branchUp: '/',
  branchLeft: '/',
  branchRight: '\\',
  merge: '+',
  cross: 'x',
  teeLeft: '+',
  teeRight: '+',
  teeUp: '+',
  teeDown: '+',
  space: ' ',
} as const;

// Unicode characters for prettier rendering
const UNICODE_CHARS = {
  commit: '●',
  vertical: '│',
  horizontalLeft: '─',
  horizontalRight: '─',
  branchDown: '╮',  // Box drawing light arc down and left
  branchUp: '╯',    // Box drawing light arc up and left
  branchLeft: '╰',  // Box drawing light arc up and right
  branchRight: '╭', // Box drawing light arc down and right
  merge: '┼',
  cross: '┼',
  teeLeft: '┤',
  teeRight: '├',
  teeUp: '┴',
  teeDown: '┬',
  space: ' ',
} as const;

type CharSet = typeof ASCII_CHARS | typeof UNICODE_CHARS;

export class GitGraphRenderer {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private nodeOrder: string[] = [];
  private columns: Map<string, number> = new Map();
  private maxColumn: number = 0;
  private chars: CharSet;

  constructor(private options: RenderOptions = {}) {
    this.chars = options.style === 'unicode' ? UNICODE_CHARS : ASCII_CHARS;
  }

  /**
   * Add a node to the graph
   */
  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.nodeOrder.includes(node.id)) {
      this.nodeOrder.push(node.id);
    }

    // Add edges based on parent relationships
    if (node.parents) {
      for (const parentId of node.parents) {
        this.addEdge({ from: parentId, to: node.id });
      }
    }
  }

  /**
   * Add an edge between nodes
   */
  addEdge(edge: GraphEdge): void {
    // Avoid duplicate edges
    const exists = this.edges.some(e => e.from === edge.from && e.to === edge.to);
    if (!exists) {
      this.edges.push(edge);
    }
  }

  /**
   * Assign columns to nodes using a greedy algorithm
   */
  private assignColumns(): void {
    this.columns.clear();
    this.maxColumn = 0;

    // Track active lanes similar to git log graph rendering. Each entry reserves a
    // column for a future commit (usually a parent of the current row).
    const activeLanes: Array<string | null> = [];

    for (let row = 0; row < this.nodeOrder.length; row++) {
      const nodeId = this.nodeOrder[row]!;
      const node = this.nodes.get(nodeId)!;
      if (!node) {
        continue;
      }
      node.row = row;

      // Attempt to reuse an existing lane that already references this node.
      let laneIndex = activeLanes.findIndex((lane) => lane === nodeId);
      if (laneIndex === -1) {
        // Reuse a free lane before creating a new column to keep the graph compact.
        laneIndex = activeLanes.findIndex((lane) => lane === null);
        if (laneIndex === -1) {
          laneIndex = activeLanes.length;
          activeLanes.push(nodeId);
        } else {
          activeLanes[laneIndex] = nodeId;
        }
      }

      this.columns.set(nodeId, laneIndex);
      node.column = laneIndex;
      this.maxColumn = Math.max(this.maxColumn, laneIndex);

      const parents = node.parents ?? [];
      if (parents.length === 0) {
        // No parents – the branch ends here. Mark the lane as free.
        activeLanes[laneIndex] = null;
        continue;
      }

      // Reserve the current lane for the primary parent and allocate additional
      // lanes for secondary parents. This mirrors git-graph's behaviour where
      // the first parent continues straight down and additional parents branch
      // off to neighbouring columns.
      activeLanes[laneIndex] = parents[0]!;

      for (let i = 1; i < parents.length; i++) {
        const parentId = parents[i]!;
        let targetLane = activeLanes.findIndex((lane) => lane === null);
        if (targetLane === -1) {
          targetLane = activeLanes.length;
          activeLanes.push(parentId);
        } else {
          activeLanes[targetLane] = parentId;
        }
        this.maxColumn = Math.max(this.maxColumn, targetLane);
      }
    }

    // Trim trailing empty lanes to avoid rendering unnecessary whitespace.
    while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop();
    }
    this.maxColumn = Math.max(this.maxColumn, activeLanes.length - 1);
  }

  /**
   * Render the graph as ASCII art
   */
  render(): string {
    if (this.nodes.size === 0) {
      return 'Empty graph';
    }

    // Assign columns to nodes
    this.assignColumns();

    const lines: string[] = [];
    const columnWidth = 2; // Space between columns

    for (let row = 0; row < this.nodeOrder.length; row++) {
      const nodeId = this.nodeOrder[row]!;
      const node = this.nodes.get(nodeId)!;
      const nodeColumn = this.columns.get(nodeId)!;

      // Add merge/branch lines before the node if needed
      const mergeLines = this.renderConnectionLines(row);
      if (mergeLines.length > 0 && !this.options.compact) {
        lines.push(...mergeLines);
      }

      // Build the graph line with the commit node
      let graphLine = '';
      for (let col = 0; col <= this.maxColumn; col++) {
        if (col === nodeColumn) {
          graphLine += this.chars.commit;
        } else {
          // Check if there's a vertical line at this column
          const hasVertical = this.hasVerticalAt(row, col);
          graphLine += hasVertical ? this.chars.vertical : this.chars.space;
        }

        // Add spacing between columns
        if (col < this.maxColumn) {
          graphLine += this.chars.space.repeat(columnWidth - 1);
        }
      }

      // Add node label if enabled
      if (this.options.showLabels !== false) {
        const label = this.truncateLabel(node.label);
        graphLine += '  ' + label;
      }

      lines.push(graphLine);
    }

    return lines.join('\n');
  }

  /**
   * Check if there should be a vertical line at a given position
   */
  private hasVerticalAt(row: number, column: number): boolean {
    // Check if any edge passes through this position
    for (const edge of this.edges) {
      const fromNode = this.nodes.get(edge.from);
      const toNode = this.nodes.get(edge.to);

      if (!fromNode || !toNode) continue;

      const fromRow = fromNode.row!;
      const toRow = toNode.row!;
      const fromCol = fromNode.column!;
      const toCol = toNode.column!;

      // Straight vertical line
      if (fromCol === column && toCol === column) {
        if (row > fromRow && row < toRow) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Render connection lines (branches/merges) before a node
   */
  private renderConnectionLines(row: number): string[] {
    if (row === 0) return []; // First node has no parents

    const lines: string[] = [];
    const nodeId = this.nodeOrder[row]!;
    const node = this.nodes.get(nodeId)!;
    const nodeCol = node.column!;

    // Find edges coming INTO this node (from parents)
    const incomingEdges = this.edges.filter(e => e.to === nodeId);
    if (incomingEdges.length === 0) return lines;

    // Build a connection line showing branches/merges
    let connectionLine = '';

    for (let col = 0; col <= this.maxColumn; col++) {
      // Check if this column has a parent connection
      let hasParent = false;
      let parentCol = -1;

      for (const edge of incomingEdges) {
        const parentNode = this.nodes.get(edge.from);
        if (parentNode && parentNode.column === col) {
          hasParent = true;
          parentCol = col;
          break;
        }
      }

      if (col === nodeCol) {
        // This is the target column
        if (hasParent) {
          // Straight line from parent above
          connectionLine += this.chars.vertical;
        } else if (incomingEdges.length > 0) {
          // Check if we have branches coming from left or right
          const hasLeftBranch = incomingEdges.some(e => {
            const p = this.nodes.get(e.from);
            return p && p.column! < nodeCol;
          });
          const hasRightBranch = incomingEdges.some(e => {
            const p = this.nodes.get(e.from);
            return p && p.column! > nodeCol;
          });

          if (hasLeftBranch && hasRightBranch) {
            connectionLine += this.chars.merge;
          } else if (hasLeftBranch) {
            connectionLine += this.chars.branchLeft;
          } else if (hasRightBranch) {
            connectionLine += this.chars.branchRight;
          } else {
            connectionLine += this.chars.space;
          }
        } else {
          connectionLine += this.hasVerticalAt(row - 0.5, col) ? this.chars.vertical : this.chars.space;
        }
      } else if (hasParent) {
        // Parent column
        if (parentCol < nodeCol) {
          // Parent is to the left, draw right branch
          connectionLine += this.chars.branchRight;
        } else {
          // Parent is to the right, draw left branch
          connectionLine += this.chars.branchLeft;
        }
      } else {
        // Check if we're between a parent and the target
        let onPath = false;
        for (const edge of incomingEdges) {
          const parentNode = this.nodes.get(edge.from);
          if (parentNode) {
            const pCol = parentNode.column!;
            if ((pCol < col && col < nodeCol) || (nodeCol < col && col < pCol)) {
              onPath = true;
              break;
            }
          }
        }

        if (onPath) {
          connectionLine += this.chars.horizontalLeft;
        } else {
          // Check for vertical pass-through
          connectionLine += this.hasVerticalAt(row - 0.5, col) ? this.chars.vertical : this.chars.space;
        }
      }

      if (col < this.maxColumn) {
        connectionLine += this.chars.space;
      }
    }

    if (connectionLine.trim().length > 0) {
      lines.push(connectionLine);
    }

    return lines;
  }

  /**
   * Truncate label to fit within maxLabelWidth
   */
  private truncateLabel(label: string): string {
    const maxWidth = this.options.maxLabelWidth || 40;
    if (label.length <= maxWidth) {
      return label;
    }
    return label.substring(0, maxWidth - 3) + '...';
  }

  /**
   * Clear all nodes and edges
   */
  clear(): void {
    this.nodes.clear();
    this.edges = [];
    this.nodeOrder = [];
    this.columns.clear();
    this.maxColumn = 0;
  }

  /**
   * Get a simple stats summary
   */
  getStats(): { nodes: number; edges: number; maxColumn: number } {
    return {
      nodes: this.nodes.size,
      edges: this.edges.length,
      maxColumn: this.maxColumn,
    };
  }
}

/**
 * Helper function to create a graph from a simple tree structure
 */
export function createGraphFromTree(tree: Record<string, string[]>, labels?: Record<string, string>): GitGraphRenderer {
  const renderer = new GitGraphRenderer({ showLabels: true });

  // Add all nodes first
  for (const [id, children] of Object.entries(tree)) {
    renderer.addNode({
      id,
      label: labels?.[id] ?? id,
    });
  }

  // Add edges based on relationships
  for (const [parentId, children] of Object.entries(tree)) {
    for (const childId of children) {
      renderer.addNode({
        id: childId,
        label: labels?.[childId] ?? childId,
        parents: [parentId],
      });
    }
  }

  return renderer;
}
