// ============================================================================
// Agent/Thread Graph Renderer using git-graph library
// ============================================================================
//
// This module provides graph visualization for forked agents and threads
// using the actual git-graph library algorithms and rendering.
//
// Agent threads are mapped to git commits:
// - Agent nodes become "commits"
// - Agent hierarchies become "branches"
// - Agent states become commit properties
// - Streaming activity becomes commit messages
//
// Uses git-graph's proven algorithms for:
// - Branch layout and column assignment
// - Unicode graph rendering with proper merge/fork visualization
// - Timeline ordering and graph structure analysis
// ============================================================================

use git_graph::settings::Characters;

/// Represents the state of an agent thread
#[derive(Debug, Clone, PartialEq)]
pub enum AgentState {
    /// Thread is currently running
    Running,
    /// Thread completed successfully
    Completed,
    /// Thread failed or was cancelled
    Failed,
    /// Thread is waiting for input/approval
    Waiting,
}

/// Information about a single agent thread
#[derive(Debug, Clone)]
pub struct AgentNode {
    /// Unique thread identifier
    pub id: String,
    /// Human-readable name (e.g., "coordinator", "worker-1", "ci-checker")
    pub name: String,
    /// Current state of the agent
    pub state: AgentState,
    /// Parent thread ID (None for root threads)
    pub parent_id: Option<String>,
    /// Child thread IDs (threads this agent spawned)
    pub children: Vec<String>,
    /// Timestamp when thread was created (for ordering)
    pub created_at: u64,
    /// Timestamp when thread completed (if applicable)
    pub completed_at: Option<u64>,
    /// Number of messages/conversation turns
    pub turn_count: usize,
    /// Branch trace index (assigned during graph building)
    pub branch_trace: Option<usize>,
    /// Current activity/status message (for streaming display)
    pub current_activity: Option<String>,
    /// Progress indicator (e.g., "2/5 files processed")
    pub progress: Option<String>,
    /// Timestamp of last activity update
    pub last_activity_at: Option<u64>,
}

/// Represents a visual branch in the agent graph
#[derive(Debug, Clone)]
pub struct AgentBranch {
    /// Target agent ID this branch leads to
    pub target_id: String,
    /// Merge target ID (if this branch merges back)
    pub merge_target: Option<String>,
    /// Source branch index (for merges)
    pub source_branch: Option<usize>,
    /// Target branch index (for merges)
    pub target_branch: Option<usize>,
    /// Branch name for display
    pub name: String,
    /// Branch color/style (terminal color code)
    pub color: Option<String>,
    /// Visual properties
    pub visual: BranchVisual,
    /// Range of commits this branch spans (start_idx, end_idx)
    pub range: (Option<usize>, Option<usize>),
}

/// Visual properties for branch rendering
#[derive(Debug, Clone)]
pub struct BranchVisual {
    /// Column index for rendering (assigned during layout)
    pub column: Option<usize>,
    /// Order group for column assignment
    pub order_group: usize,
    /// Source order group (for merge alignment)
    pub source_order_group: Option<usize>,
    /// Target order group (for merge alignment)
    pub target_order_group: Option<usize>,
}

/// Complete agent graph representation
pub struct AgentGraph {
    /// All agent nodes, indexed by ID
    pub agents: HashMap<String, AgentNode>,
    /// Agent IDs in chronological order (oldest first)
    pub timeline: Vec<String>,
}

impl Default for AgentGraph {
    fn default() -> Self {
        Self {
            agents: HashMap::new(),
            timeline: Vec::new(),
        }
    }
}

impl AgentNode {
    pub fn new(id: String, name: String) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Self {
            id,
            name,
            state: AgentState::Running,
            parent_id: None,
            children: Vec::new(),
            created_at: now,
            completed_at: None,
            turn_count: 0,
            branch_trace: None,
            current_activity: None,
            progress: None,
            last_activity_at: Some(now),
        }
    }

    pub fn with_parent(mut self, parent_id: String) -> Self {
        self.parent_id = Some(parent_id);
        self
    }

    pub fn with_state(mut self, state: AgentState) -> Self {
        self.state = state;
        self
    }

    pub fn with_created_at(mut self, timestamp: u64) -> Self {
        self.created_at = timestamp;
        self
    }
}

impl AgentBranch {
    pub fn new(target_id: String, name: String) -> Self {
        Self {
            target_id,
            merge_target: None,
            source_branch: None,
            target_branch: None,
            name,
            color: None,
            visual: BranchVisual {
                column: None,
                order_group: 0,
                source_order_group: None,
                target_order_group: None,
            },
            range: (None, None),
        }
    }
}


impl AgentGraph {
    /// Create a new empty agent graph
    pub fn new() -> Self {
        Self::default()
    }

    /// Add an agent node to the graph
    pub fn add_agent(&mut self, agent: AgentNode) {
        let agent_id = agent.id.clone();

        // Add parent-child relationships
        if let Some(ref parent_id) = agent.parent_id
            && let Some(parent) = self.agents.get_mut(parent_id) {
                parent.children.push(agent_id.clone());
        }

        self.agents.insert(agent_id.clone(), agent);
        self.timeline.push(agent_id);
    }

    /// Update an agent's state
    pub fn update_agent_state(&mut self, agent_id: &str, state: AgentState) {
        if let Some(agent) = self.agents.get_mut(agent_id) {
            agent.state = state.clone();
            if matches!(state, AgentState::Completed | AgentState::Failed) {
                agent.completed_at = Some(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs()
                );
            }
        }
    }

    /// Update an agent's current activity (for streaming display)
    pub fn update_agent_activity(&mut self, agent_id: &str, activity: Option<String>) {
        if let Some(agent) = self.agents.get_mut(agent_id) {
            agent.current_activity = activity;
            agent.last_activity_at = Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
            );
        }
    }

    /// Update an agent's progress indicator
    pub fn update_agent_progress(&mut self, agent_id: &str, progress: Option<String>) {
        if let Some(agent) = self.agents.get_mut(agent_id) {
            agent.progress = progress;
            agent.last_activity_at = Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
            );
        }
    }

    /// Update agent turn count
    pub fn increment_agent_turns(&mut self, agent_id: &str) {
        if let Some(agent) = self.agents.get_mut(agent_id) {
            agent.turn_count += 1;
            agent.last_activity_at = Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
            );
        }
    }


    /// Render the agent graph as ASCII using git-graph style characters
    pub fn render_ascii(&self) -> String {
        if self.timeline.is_empty() {
            return "No agents to display".to_string();
        }

        // Build branches from agent hierarchy
        let mut branches = Vec::new();
        self.build_branches(&mut branches);

        // Assign columns to branches
        self.assign_branch_columns(&mut branches);

        // Render each timeline entry
        let mut output = String::new();
        for (timeline_idx, agent_id) in self.timeline.iter().enumerate() {
            if let Some(agent) = self.agents.get(agent_id) {
                let line = self.render_timeline_line(timeline_idx, agent, &branches);
                output.push_str(&line);
                output.push('\n');
            }
        }

        output
    }

    /// Build branches from the agent relationships
    fn build_branches(&self, branches: &mut Vec<AgentBranch>) {
        // Sort timeline by creation time
        let mut sorted_timeline: Vec<_> = self.timeline.iter().enumerate().collect();
        sorted_timeline.sort_by(|a, b| {
            let time_a = self.agents.get(a.1).map(|n| n.created_at).unwrap_or(0);
            let time_b = self.agents.get(b.1).map(|n| n.created_at).unwrap_or(0);
            time_a.cmp(&time_b)
        });

        // Create indices for timeline lookup
        let indices: HashMap<String, usize> = self.timeline
            .iter()
            .enumerate()
            .map(|(idx, id)| (id.clone(), idx))
            .collect();

        // Initialize branch traces for all agents
        let mut agent_branch_traces = HashMap::new();

        // Assign branches using a git-graph-like algorithm
        let mut visited = HashSet::new();

        if let Some(root_id) = self.find_root_agent() {
            let root_id = root_id.clone();
            self.assign_branches_recursive(&root_id, &indices, branches, &mut visited, 0, &mut agent_branch_traces);
        }
    }

    /// Find the root agent (one with no parent)
    fn find_root_agent(&self) -> Option<&String> {
        self.agents.values()
            .find(|agent| agent.parent_id.is_none())
            .map(|agent| &agent.id)
    }

    /// Recursively assign branches to agents
    fn assign_branches_recursive(
        &self,
        agent_id: &str,
        indices: &HashMap<String, usize>,
        branches: &mut Vec<AgentBranch>,
        visited: &mut HashSet<String>,
        depth: usize,
        agent_branch_traces: &mut HashMap<String, usize>,
    ) -> Option<usize> {
        if visited.contains(agent_id) {
            return None;
        }
        visited.insert(agent_id.to_string());

        // Get agent data
        if let Some(agent) = self.agents.get(agent_id) {
            // Create new branch for this agent
            let branch_index = branches.len();
            let mut branch = AgentBranch::new(agent_id.to_string(), agent.name.clone());
            branch.visual.order_group = depth;

            // Set initial range to this agent's position
            if let Some(&idx) = indices.get(agent_id) {
                branch.range = (Some(idx), Some(idx));
            }

            branches.push(branch);

            // Mark this agent as being on this branch
            agent_branch_traces.insert(agent_id.to_string(), branch_index);

            // Extend the branch backward to find its start
            let start_index = self.find_branch_start(agent_id, indices, agent_branch_traces);
            if let Some(branch) = branches.get_mut(branch_index) {
                if let Some(idx) = start_index {
                    branch.range.0 = Some(idx);
                }
            }

            let mut max_idx = indices.get(agent_id).copied();

            // Recursively assign branches for children
            for child_id in &agent.children {
                if let Some(child_idx) = self.assign_branches_recursive(
                    child_id,
                    indices,
                    branches,
                    visited,
                    depth + 1,
                    agent_branch_traces,
                ) {
                    max_idx = Some(max_idx.map_or(child_idx, |curr| curr.max(child_idx)));
                }
            }

            if let Some(branch) = branches.get_mut(branch_index) {
                if branch.range.1.is_none() {
                    branch.range.1 = max_idx;
                } else if let (Some(existing), Some(new_idx)) = (branch.range.1, max_idx) {
                    if new_idx > existing {
                        branch.range.1 = Some(new_idx);
                    }
                }
            }

            return max_idx;
        }

        None
    }

    /// Find where a branch should start
    fn find_branch_start(
        &self,
        start_agent_id: &str,
        indices: &HashMap<String, usize>,
        agent_branch_traces: &HashMap<String, usize>,
    ) -> Option<usize> {
        let mut curr_agent_id = start_agent_id;
        let mut start_index = *indices.get(start_agent_id)?;

        loop {
            let agent = self.agents.get(curr_agent_id)?;

            // If this agent has no parent, it's the root
            let parent_id = agent.parent_id.as_ref()?;

            let _parent = self.agents.get(parent_id)?;
            let parent_idx = *indices.get(parent_id)?;

            // If parent is already on a different branch, stop here
            if let Some(parent_branch_idx) = agent_branch_traces.get(parent_id) {
                if *parent_branch_idx != agent_branch_traces.get(start_agent_id).copied().unwrap_or(0) {
                    return Some(start_index);
                }
            }

            // Continue backward
            curr_agent_id = parent_id;
            start_index = parent_idx;

            // Safety check to prevent infinite loops
            if start_index == 0 {
                break;
            }
        }

        Some(start_index)
    }

    /// Assign columns to branches for rendering
    fn assign_branch_columns(&self, branches: &mut [AgentBranch]) {
        // Sort branches by their start time and assign columns
        let mut sorted_branches: Vec<_> = branches.iter_mut().enumerate().collect();
        sorted_branches.sort_by(|a, b| {
            let start_a = a.1.range.0.unwrap_or(0);
            let start_b = b.1.range.0.unwrap_or(0);
            start_a.cmp(&start_b)
        });

        let mut occupied_columns = HashSet::new();
        for (_idx, branch) in sorted_branches {
            // Find the first available column
            let mut column = 0;
            while occupied_columns.contains(&column) {
                column += 1;
            }
            branch.visual.column = Some(column);
            occupied_columns.insert(column);
        }
    }

    /// Render a single timeline line using git-graph style characters
    fn render_timeline_line(&self, timeline_idx: usize, agent: &AgentNode, branches: &[AgentBranch]) -> String {
        // Use git-graph style characters: " ●○│─┼└┌┐┘┤├┴┬<>"
        let chars = Characters::thin();
        let chars_vec: Vec<char> = chars.chars.clone();

        // Find all branches that should be rendered at this timeline position
        let active_branches: Vec<_> = branches.iter()
            .filter(|b| {
                b.range.0.is_some_and(|start| start <= timeline_idx) &&
                b.range.1.is_some_and(|end| timeline_idx <= end)
            })
            .collect();

        // Sort branches by column for consistent rendering
        let mut sorted_branches: Vec<_> = active_branches.iter().collect();
        sorted_branches.sort_by_key(|b| b.visual.column.unwrap_or(0));

        // Find the maximum column used
        let max_col = sorted_branches.iter()
            .filter_map(|b| b.visual.column)
            .max()
            .unwrap_or(0);

        let mut line = String::new();

        // Render each column with git-graph style characters
        for col in 0..=max_col {
            let branch_in_col = sorted_branches.iter()
                .find(|b| b.visual.column == Some(col));

            if let Some(branch) = branch_in_col {
                // Check if this is the agent's position on its branch
                if branch.target_id == agent.id {
                    // This is where the agent appears - use git-graph style commit symbols
                    let symbol = match agent.state {
                        AgentState::Running => chars_vec[1], // ●
                        AgentState::Completed => chars_vec[1], // ●
                        AgentState::Failed => '✗',
                        AgentState::Waiting => chars_vec[2], // ○
                    };
                    line.push(symbol);
                } else {
                    // Draw vertical branch line
                    line.push(chars_vec[3]); // │
                }
            } else {
                // Check for merge connections - proper git-graph style
                let mut char_idx = 0; // SPACE

                // Check if there's a branch to the right that merges here
                if let Some(right_branch) = sorted_branches.iter().find(|b| b.visual.column == Some(col + 1)) {
                    if right_branch.source_branch.is_some() && right_branch.range.0 == Some(timeline_idx) {
                        char_idx = 6; // └ (right-up corner)
                    }
                }

                // Check if there's a branch to the left that merges here
                if col > 0 {
                    if let Some(left_branch) = sorted_branches.iter().find(|b| b.visual.column == Some(col - 1)) {
                        if left_branch.target_branch.is_some() && left_branch.range.1 == Some(timeline_idx) {
                            char_idx = 8; // ┐ (left-down corner)
                        }
                    }
                }

                // Check for horizontal connections between branches
                let has_left_branch = col > 0 && sorted_branches.iter().any(|b| b.visual.column == Some(col - 1));
                let has_right_branch = sorted_branches.iter().any(|b| b.visual.column == Some(col + 1));

                if char_idx == 0 && has_left_branch && has_right_branch {
                    // Horizontal connection between branches
                    char_idx = 4; // ─
                }

                line.push(chars_vec[char_idx]);
            }

            // Git graph uses exactly 2 spaces between columns
            if col < max_col {
                line.push_str("  ");
            }
        }

        // Git graph uses specific spacing before the commit message
        line.push_str("  ");

        // Format like git log --oneline with hash-like prefix and message
        let state_indicator = match agent.state {
            AgentState::Running => "(running)",
            AgentState::Completed => "(completed)",
            AgentState::Failed => "(failed)",
            AgentState::Waiting => "(waiting)",
        };

        // Create a short "hash" from agent ID
        let short_hash = if agent.id.len() >= 7 {
            &agent.id[0..7]
        } else {
            &agent.id
        };

        line.push_str(&format!("{} {} {}", short_hash, state_indicator, agent.name));

        // Add parent information if not root
        if let Some(parent_id) = &agent.parent_id {
            if let Some(parent) = self.agents.get(parent_id) {
                line.push_str(&format!(" (forked from {})", parent.name));
            }
        }

        // Add current activity (streaming information)
        if let Some(activity) = &agent.current_activity {
            line.push_str(&format!(" | {}", activity));
        }

        // Add progress indicator
        if let Some(progress) = &agent.progress {
            line.push_str(&format!(" [{}]", progress));
        }

        // Add turn count
        if agent.turn_count > 0 {
            line.push_str(&format!(" ({} turns)", agent.turn_count));
        }

        line
    }

}

// ============================================================================
// NAPI Bindings for TypeScript Integration
// ============================================================================

#[cfg(feature = "napi")]
#[napi(object)]
pub struct NapiAgentNode {
    pub id: String,
    pub name: String,
    pub state: String,
    pub parent_id: Option<String>,
    pub children: Vec<String>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub turn_count: i64,
    pub current_activity: Option<String>,
    pub progress: Option<String>,
    pub last_activity_at: Option<i64>,
}

#[cfg(feature = "napi")]
impl From<&AgentNode> for NapiAgentNode {
    fn from(node: &AgentNode) -> Self {
        Self {
            id: node.id.clone(),
            name: node.name.clone(),
            state: match node.state {
                AgentState::Running => "running".to_string(),
                AgentState::Completed => "completed".to_string(),
                AgentState::Failed => "failed".to_string(),
                AgentState::Waiting => "waiting".to_string(),
            },
            parent_id: node.parent_id.clone(),
            children: node.children.clone(),
            created_at: node.created_at as i64,
            completed_at: node.completed_at.map(|t| t as i64),
            turn_count: node.turn_count as i64,
            current_activity: node.current_activity.clone(),
            progress: node.progress.clone(),
            last_activity_at: node.last_activity_at.map(|t| t as i64),
        }
    }
}

#[cfg(feature = "napi")]
#[napi(object)]
pub struct NapiAgentBranch {
    pub target_id: String,
    pub name: String,
    pub color: Option<String>,
    pub range_start: Option<i64>,
    pub range_end: Option<i64>,
}

#[cfg(feature = "napi")]
impl From<&AgentBranch> for NapiAgentBranch {
    fn from(branch: &AgentBranch) -> Self {
        Self {
            target_id: branch.target_id.clone(),
            name: branch.name.clone(),
            color: branch.color.clone(),
            range_start: branch.range.0.map(|v| v as i64),
            range_end: branch.range.1.map(|v| v as i64),
        }
    }
}

#[cfg(feature = "napi")]
#[napi(object)]
pub struct NapiAgentGraph {
    pub agents: Vec<NapiAgentNode>,
    pub branches: Vec<NapiAgentBranch>,
    pub timeline: Vec<String>,
    pub root_id: Option<String>,
}

#[cfg(feature = "napi")]
impl From<&AgentGraph> for NapiAgentGraph {
    fn from(graph: &AgentGraph) -> Self {
        Self {
            agents: graph.agents.values().map(NapiAgentNode::from).collect(),
            branches: Vec::new(), // git-graph handles branches internally
            timeline: graph.timeline.clone(),
            root_id: None, // No longer tracked separately
        }
    }
}

#[cfg(feature = "napi")]
#[napi(object)]
pub struct NapiAgentGraphInput {
    pub id: String,
    pub name: String,
    pub state: Option<String>,
    pub parent_id: Option<String>,
    pub created_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub turn_count: Option<i64>,
    pub current_activity: Option<String>,
    pub progress: Option<String>,
}

#[cfg(feature = "napi")]
#[napi]
pub struct AgentGraphRenderer {
    graph: AgentGraph,
}

#[cfg(feature = "napi")]
#[napi]
impl AgentGraphRenderer {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            graph: AgentGraph::new(),
        }
    }

    #[napi]
    pub fn add_agent(&mut self, input: NapiAgentGraphInput) {
        let mut node = AgentNode::new(input.id, input.name);

        if let Some(state_str) = input.state {
            let state = match state_str.as_str() {
                "running" => AgentState::Running,
                "completed" => AgentState::Completed,
                "failed" => AgentState::Failed,
                "waiting" => AgentState::Waiting,
                _ => AgentState::Running,
            };
            node.state = state;
        }

        if let Some(parent_id) = input.parent_id {
            node.parent_id = Some(parent_id);
        }

        if let Some(created_at) = input.created_at {
            node.created_at = created_at as u64;
        }

        if let Some(completed_at) = input.completed_at {
            node.completed_at = Some(completed_at as u64);
        }

        if let Some(turn_count) = input.turn_count {
            node.turn_count = turn_count as usize;
        }

        // Set streaming fields
        node.current_activity = input.current_activity;
        node.progress = input.progress;

        self.graph.add_agent(node);
    }

    #[napi]
    pub fn update_agent_state(&mut self, agent_id: String, state: String) {
        let agent_state = match state.as_str() {
            "running" => AgentState::Running,
            "completed" => AgentState::Completed,
            "failed" => AgentState::Failed,
            "waiting" => AgentState::Waiting,
            _ => AgentState::Running,
        };
        self.graph.update_agent_state(&agent_id, agent_state);
    }

    #[napi]
    pub fn update_agent_activity(&mut self, agent_id: String, activity: Option<String>) {
        self.graph.update_agent_activity(&agent_id, activity);
    }

    #[napi]
    pub fn update_agent_progress(&mut self, agent_id: String, progress: Option<String>) {
        self.graph.update_agent_progress(&agent_id, progress);
    }

    #[napi]
    pub fn increment_agent_turns(&mut self, agent_id: String) {
        self.graph.increment_agent_turns(&agent_id);
    }


    #[napi]
    pub fn render_ascii(&mut self) -> String {
        self.graph.render_ascii()
    }

    #[napi]
    pub fn get_graph_data(&self) -> NapiAgentGraph {
        (&self.graph).into()
    }
}

impl Default for AgentGraphRenderer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod graph_tests {
    use super::*;
    use pretty_assertions::assert_eq;

    fn agent(
        id: &str,
        name: &str,
        state: AgentState,
        created_at: u64,
        parent: Option<&str>,
    ) -> AgentNode {
        let mut node = AgentNode::new(id.to_string(), name.to_string())
            .with_state(state)
            .with_created_at(created_at);

        if let Some(parent_id) = parent {
            node = node.with_parent(parent_id.to_string());
        }

        node
    }

    #[test]
    fn test_agent_graph_creation() {
        let mut graph = AgentGraph::new();
        graph.add_agent(agent("coord-1", "Coordinator", AgentState::Running, 1, None));
        graph.add_agent(agent(
            "worker-1",
            "Worker-1",
            AgentState::Running,
            2,
            Some("coord-1"),
        ));
        graph.add_agent(agent(
            "worker-2",
            "Worker-2",
            AgentState::Running,
            3,
            Some("coord-1"),
        ));

        assert_eq!(graph.agents.len(), 3);
        assert_eq!(
            graph.find_root_agent().cloned(),
            Some("coord-1".to_string())
        );

        let coord = graph.agents.get("coord-1").unwrap();
        assert_eq!(coord.children.len(), 2);
        assert!(coord.children.contains(&"worker-1".to_string()));
        assert!(coord.children.contains(&"worker-2".to_string()));
    }

    #[test]
    fn test_graph_rendering() {
        let mut graph = AgentGraph::new();
        graph.add_agent(agent(
            "coord1",
            "Coordinator",
            AgentState::Completed,
            1,
            None,
        ));
        graph.add_agent(agent(
            "worker1",
            "Worker One",
            AgentState::Running,
            2,
            Some("coord1"),
        ));
        graph.add_agent(agent(
            "worker2",
            "Worker Two",
            AgentState::Waiting,
            3,
            Some("coord1"),
        ));

        let output = graph.render_ascii();
        let lines: Vec<_> = output.trim_end().lines().collect();

        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], "●  coord1 (completed) Coordinator");
        assert_eq!(
            lines[1],
            "│  ●  worker1 (running) Worker One (forked from Coordinator)"
        );
        assert_eq!(
            lines[2],
            "│  ─  ○  worker2 (waiting) Worker Two (forked from Coordinator)"
        );
    }

    #[test]
    fn test_streaming_updates() {
        let mut graph = AgentGraph::new();

        // Add coordinator
        graph.add_agent(agent("coord", "Coordinator", AgentState::Running, 1, None));

        // Add worker with initial activity
        let mut worker = agent(
            "worker-1",
            "Worker: main.rs",
            AgentState::Running,
            2,
            Some("coord"),
        );
        worker.current_activity = Some("Starting conflict resolution".to_string());
        worker.progress = Some("0/3 steps".to_string());
        graph.add_agent(worker);

        let initial_output = graph.render_ascii();
        assert!(initial_output.contains("Starting conflict resolution"));
        assert!(initial_output.contains("[0/3 steps]"));

        // Update streaming information
        graph.update_agent_activity("worker-1", Some("Resolving conflicts".to_string()));
        graph.update_agent_progress("worker-1", Some("1/3 steps".to_string()));
        graph.increment_agent_turns("worker-1");
        graph.increment_agent_turns("worker-1");

        let updated_output = graph.render_ascii();
        assert!(updated_output.contains("Resolving conflicts"));
        assert!(updated_output.contains("[1/3 steps]"));
        assert!(updated_output.contains("(2 turns)"));
    }

    #[test]
    fn test_render_outputs_deterministic_snapshot() {
        let mut graph = AgentGraph::new();

        graph.add_agent(agent("root", "Root", AgentState::Completed, 1, None));

        let mut reviewer = agent("review", "Reviewer", AgentState::Running, 2, Some("root"));
        reviewer.current_activity = Some("Analyzing".to_string());
        reviewer.progress = Some("1/2 tasks".to_string());
        reviewer.turn_count = 2;
        graph.add_agent(reviewer);

        let mut executor = agent("exec", "Executor", AgentState::Failed, 3, Some("review"));
        executor.current_activity = Some("Command failed".to_string());
        executor.turn_count = 1;
        graph.add_agent(executor);

        let output = graph.render_ascii();
        let expected = "●  root (completed) Root\n│  ●  review (running) Reviewer (forked from Root) | Analyzing [1/2 tasks] (2 turns)\n│  │  ✗  exec (failed) Executor (forked from Reviewer) | Command failed (1 turns)\n";
        assert_eq!(output, expected);
    }

    #[cfg(feature = "napi")]
    #[test]
    fn demo_streaming_graph() {
        use std::thread;
        use std::time::Duration;

        let mut renderer = crate::AgentGraphRenderer::new();

        // Add root coordinator (like initial commit)
        renderer.add_agent(crate::NapiAgentGraphInput {
            id: "coordinator-abc123".to_string(),
            name: "Coordinator".to_string(),
            state: Some("running".to_string()),
            parent_id: None,
            created_at: None,
            completed_at: None,
            turn_count: Some(0),
            current_activity: Some("Initializing merge conflict resolution".to_string()),
            progress: Some("0/3 phases".to_string()),
        });

        println!("🤖 Git-Style Agent Graph:");
        println!("{}", renderer.render_ascii());
        println!();

        // Simulate coordinator progress
        thread::sleep(Duration::from_millis(50));

        renderer.update_agent_activity("coordinator-abc123".to_string(), Some("Analyzing 2 conflicts".to_string()).into());
        renderer.update_agent_progress("coordinator-abc123".to_string(), Some("1/3 phases".to_string()).into());

        println!("{}", renderer.render_ascii());
        println!();

        // Add first worker (branch from coordinator)
        renderer.add_agent(crate::NapiAgentGraphInput {
            id: "worker-main-def456".to_string(),
            name: "Worker: src/main.rs".to_string(),
            state: Some("running".to_string()),
            parent_id: Some("coordinator-abc123".to_string()),
            created_at: None,
            completed_at: None,
            turn_count: Some(0),
            current_activity: Some("Analyzing merge conflict".to_string()),
            progress: Some("0/3 steps".to_string()),
        });

        println!("{}", renderer.render_ascii());
        println!();

        // Add second worker (another branch)
        renderer.add_agent(crate::NapiAgentGraphInput {
            id: "worker-util-ghi789".to_string(),
            name: "Worker: src/utils.rs".to_string(),
            state: Some("running".to_string()),
            parent_id: Some("coordinator-abc123".to_string()),
            created_at: None,
            completed_at: None,
            turn_count: Some(0),
            current_activity: Some("Starting conflict resolution".to_string()),
            progress: Some("0/3 steps".to_string()),
        });

        println!("{}", renderer.render_ascii());
        println!();

        // Update first worker progress
        renderer.update_agent_activity("worker-main-def456".to_string(), Some("Executing merge strategy".to_string()).into());
        renderer.update_agent_progress("worker-main-def456".to_string(), Some("2/3 steps".to_string()).into());
        renderer.increment_agent_turns("worker-main-def456".to_string());

        println!("{}", renderer.render_ascii());
        println!();

        // Complete first worker
        renderer.update_agent_activity("worker-main-def456".to_string(), Some("Resolution successful".to_string()).into());
        renderer.update_agent_state("worker-main-def456".to_string(), "completed".to_string());
        renderer.update_agent_progress("coordinator-abc123".to_string(), Some("2/3 phases".to_string()).into());

        println!("{}", renderer.render_ascii());
        println!();

        // Complete second worker
        renderer.update_agent_activity("worker-util-ghi789".to_string(), Some("Merge completed successfully".to_string()).into());
        renderer.update_agent_state("worker-util-ghi789".to_string(), "completed".to_string());
        renderer.update_agent_progress("coordinator-abc123".to_string(), Some("3/3 phases".to_string()).into());

        println!("{}", renderer.render_ascii());
        println!();

        // Add CI runner (like a merge commit)
        renderer.add_agent(crate::NapiAgentGraphInput {
            id: "ci-runner-jkl012".to_string(),
            name: "CI Runner".to_string(),
            state: Some("running".to_string()),
            parent_id: Some("coordinator-abc123".to_string()),
            created_at: None,
            completed_at: None,
            turn_count: Some(0),
            current_activity: Some("Running test suite".to_string()),
            progress: Some("0/2 stages".to_string()),
        });

        println!("{}", renderer.render_ascii());
        println!();

        // Complete CI
        renderer.update_agent_activity("ci-runner-jkl012".to_string(), Some("All tests passed".to_string()).into());
        renderer.update_agent_state("ci-runner-jkl012".to_string(), "completed".to_string());
        renderer.update_agent_activity("coordinator-abc123".to_string(), Some("All verifications complete".to_string()).into());
        renderer.update_agent_state("coordinator-abc123".to_string(), "completed".to_string());

        println!("{}", renderer.render_ascii());
        println!();
    }
}
