// Modular TUI Components for JavaScript
// ============================================================================
// This module exposes individual TUI components that can be composed
// from JavaScript to create custom terminal interfaces.
// ============================================================================

// Note: This file is included via include!() in lib.rs, so it shares the same namespace
// and doesn't need its own imports

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color as RataColor, Style};
use ratatui::widgets::{Block, Borders, Paragraph, List, ListItem, Widget};
use ratatui::buffer::Buffer as RatatuiBuffer;

// Component Types
// ============================================================================

#[napi]
pub enum WidgetType {
  Text,
  Chat,
  Terminal,
  ProgressBar,
  StatusLine,
  Table,
  FileTree,
  Markdown,
}

#[napi]
pub enum LayoutType {
  Split,
  Tabs,
  Grid,
  Stack,
}

#[napi(object)]
pub struct Dimensions {
  pub width: u16,
  pub height: u16,
  pub x: u16,
  pub y: u16,
}

// Base Component Trait
// ============================================================================

#[allow(dead_code)]
trait Component: Send + Sync {
  fn render(&self, area: Rect, buf: &mut RatatuiBuffer);
  fn handle_event(&mut self, event: ComponentEvent) -> napi::Result<()>;
  fn get_id(&self) -> String;
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
enum ComponentEvent {
  KeyPress(String), // Changed from KeyCode to String for simplicity
  Resize(u16, u16),
  Message(String),
  Data(serde_json::Value),
}

// TUI Application
// ============================================================================

#[napi]
pub struct TuiApp {
  inner: Arc<Mutex<TuiAppInner>>,
}

#[allow(dead_code)]
struct TuiAppInner {
  components: HashMap<String, Box<dyn Component>>,
  layout: Option<Box<dyn Component>>,
  terminal: Option<ratatui::Terminal<ratatui::backend::CrosstermBackend<std::io::Stdout>>>,
}

#[allow(dead_code)]
enum AppEvent {
  AddComponent(String, Box<dyn Component>),
  RemoveComponent(String),
  UpdateComponent(String, serde_json::Value),
  Quit,
}

#[napi]
impl TuiApp {
  #[napi(constructor)]
  pub fn new(_title: Option<String>, _width: Option<u16>, _height: Option<u16>) -> napi::Result<Self> {
    Ok(Self {
      inner: Arc::new(Mutex::new(TuiAppInner {
        components: HashMap::new(),
        layout: None,
        terminal: None,
      })),
    })
  }

  #[napi]
  pub fn add_component(&mut self, id: String, component_type: WidgetType) -> napi::Result<()> {
    let component = create_component(&id, component_type)?;
    let mut inner = self.inner.lock().unwrap();
    inner.components.insert(id, component);
    Ok(())
  }

  #[napi]
  pub fn start_terminal(&mut self) -> napi::Result<()> {
    // Initialize terminal
    let backend = ratatui::backend::CrosstermBackend::new(std::io::stdout());
    let terminal = ratatui::Terminal::new(backend)
      .map_err(|e| napi::Error::from_reason(format!("Failed to create terminal: {}", e)))?;

    {
      let mut inner = self.inner.lock().unwrap();
      inner.terminal = Some(terminal);
    }

    Ok(())
  }

  #[napi]
  pub fn stop_terminal(&mut self) -> napi::Result<()> {
    let mut inner = self.inner.lock().unwrap();
    inner.terminal = None;
    Ok(())
  }

  #[allow(dead_code)]
  fn render(&mut self) -> napi::Result<()> {
    // For now, just a placeholder implementation
    // Real implementation would properly handle the borrow checker
    Ok(())
  }
}

// Agent View Component
// ============================================================================

#[napi]
pub struct AgentView {
  inner: Arc<Mutex<AgentViewInner>>,
}

#[allow(dead_code)]
struct AgentViewInner {
  thread_id: String,
  messages: Vec<String>,
  status: String,
  output_buffer: Vec<String>,
}

#[napi]
impl AgentView {
  #[napi(constructor)]
  pub fn new(thread_id: String, _title: Option<String>) -> napi::Result<Self> {
    Ok(Self {
      inner: Arc::new(Mutex::new(AgentViewInner {
        thread_id,
        messages: Vec::new(),
        status: "Ready".to_string(),
        output_buffer: Vec::new(),
      })),
    })
  }

  #[napi]
  pub fn send_message(&mut self, message: String) -> napi::Result<()> {
    let mut inner = self.inner.lock().unwrap();
    inner.messages.push(format!("> {}", message));
    Ok(())
  }

  #[napi]
  pub fn receive_message(&mut self, message: String) -> napi::Result<()> {
    let mut inner = self.inner.lock().unwrap();
    inner.messages.push(format!("< {}", message));
    Ok(())
  }

  #[napi]
  pub fn update_status(&mut self, status: String) -> napi::Result<()> {
    let mut inner = self.inner.lock().unwrap();
    inner.status = status;
    Ok(())
  }

  #[napi]
  pub fn append_output(&mut self, output: String) -> napi::Result<()> {
    let mut inner = self.inner.lock().unwrap();
    inner.output_buffer.push(output);
    Ok(())
  }
}

impl Component for AgentView {
  fn render(&self, area: Rect, buf: &mut RatatuiBuffer) {
    let inner = self.inner.lock().unwrap();

    // Create layout
    let chunks = Layout::default()
      .direction(Direction::Vertical)
      .constraints([
        Constraint::Length(1),  // Status line
        Constraint::Min(5),      // Messages
        Constraint::Length(5),  // Output
      ])
      .split(area);

    // Render status line
    let status = Paragraph::new(format!("Thread: {} | Status: {}",
      inner.thread_id, inner.status))
      .style(Style::default().fg(RataColor::Cyan))
      .block(Block::default().borders(Borders::BOTTOM));
    Widget::render(status, chunks[0], buf);

    // Render messages
    let messages: Vec<ListItem> = inner.messages
      .iter()
      .map(|m| ListItem::new(m.as_str()))
      .collect();
    let messages_list = List::new(messages)
      .block(Block::default().borders(Borders::ALL).title("Chat"));
    Widget::render(messages_list, chunks[1], buf);

    // Render output
    let output = inner.output_buffer.join("\n");
    let output_widget = Paragraph::new(output)
      .block(Block::default().borders(Borders::ALL).title("Output"));
    Widget::render(output_widget, chunks[2], buf);
  }

  fn handle_event(&mut self, _event: ComponentEvent) -> napi::Result<()> {
    Ok(())
  }

  fn get_id(&self) -> String {
    self.inner.lock().unwrap().thread_id.clone()
  }
}

// Status Board Component
// ============================================================================

#[napi]
pub struct StatusBoard {
  inner: Arc<Mutex<StatusBoardInner>>,
}

#[allow(dead_code)]
struct StatusBoardInner {
  tiles: Vec<StatusTile>,
  layout: LayoutType,
}

#[allow(dead_code)]
struct StatusTile {
  id: String,
  title: String,
  value: String,
  tile_type: StatusTileType,
}

#[allow(dead_code)]
enum StatusTileType {
  Text,
  Progress(f64),
  Chart(Vec<f64>),
}

#[napi]
impl StatusBoard {
  #[napi(constructor)]
  pub fn new(layout: Option<String>) -> napi::Result<Self> {
    let layout_type = match layout.as_deref() {
      Some("grid") => LayoutType::Grid,
      Some("stack") => LayoutType::Stack,
      _ => LayoutType::Grid,
    };

    Ok(Self {
      inner: Arc::new(Mutex::new(StatusBoardInner {
        tiles: Vec::new(),
        layout: layout_type,
      })),
    })
  }

  #[napi]
  pub fn add_text_tile(&mut self, id: String, title: String, value: String) -> napi::Result<()> {
    let mut inner = self.inner.lock().unwrap();
    inner.tiles.push(StatusTile {
      id,
      title,
      value,
      tile_type: StatusTileType::Text,
    });
    Ok(())
  }

  #[napi]
  pub fn add_progress_tile(&mut self, id: String, title: String, value: f64) -> napi::Result<()> {
    let mut inner = self.inner.lock().unwrap();
    inner.tiles.push(StatusTile {
      id,
      title,
      value: format!("{:.1}%", value * 100.0),
      tile_type: StatusTileType::Progress(value),
    });
    Ok(())
  }

  #[napi]
  pub fn update_tile(&mut self, id: String, value: String) -> napi::Result<()> {
    let mut inner = self.inner.lock().unwrap();
    if let Some(tile) = inner.tiles.iter_mut().find(|t| t.id == id) {
      tile.value = value;
    }
    Ok(())
  }
}

// Agent Orchestrator
// ============================================================================

#[napi]
pub struct AgentOrchestrator {
  agents: Arc<Mutex<HashMap<String, AgentView>>>,
  layout: Arc<Mutex<OrchestratorLayout>>,
}

struct OrchestratorLayout {
  active_agent: Option<String>,
  view_mode: ViewMode,
}

enum ViewMode {
  Single,
  Split,
  Grid,
  Tabs,
}

#[napi]
impl AgentOrchestrator {
  #[napi(constructor)]
  pub fn new() -> napi::Result<Self> {
    Ok(Self {
      agents: Arc::new(Mutex::new(HashMap::new())),
      layout: Arc::new(Mutex::new(OrchestratorLayout {
        active_agent: None,
        view_mode: ViewMode::Tabs,
      })),
    })
  }

  #[napi]
  pub fn add_agent(&mut self, id: String, config: AgentConfig) -> napi::Result<()> {
    let agent = AgentView::new(id.clone(), Some(config.name))?;
    let mut agents = self.agents.lock().unwrap();
    agents.insert(id.clone(), agent);

    let mut layout = self.layout.lock().unwrap();
    if layout.active_agent.is_none() {
      layout.active_agent = Some(id);
    }

    Ok(())
  }

  #[napi]
  pub fn remove_agent(&mut self, id: String) -> napi::Result<()> {
    let mut agents = self.agents.lock().unwrap();
    agents.remove(&id);
    Ok(())
  }

  #[napi]
  pub fn set_view_mode(&mut self, mode: String) -> napi::Result<()> {
    let mut layout = self.layout.lock().unwrap();
    layout.view_mode = match mode.as_str() {
      "single" => ViewMode::Single,
      "split" => ViewMode::Split,
      "grid" => ViewMode::Grid,
      "tabs" => ViewMode::Tabs,
      _ => ViewMode::Tabs,
    };
    Ok(())
  }

  #[napi]
  pub fn switch_to_agent(&mut self, id: String) -> napi::Result<()> {
    let mut layout = self.layout.lock().unwrap();
    layout.active_agent = Some(id);
    Ok(())
  }
}

#[napi(object)]
pub struct AgentConfig {
  pub name: String,
  pub model: Option<String>,
  pub task: Option<String>,
}

// Helper Functions
// ============================================================================

fn create_component(id: &str, widget_type: WidgetType) -> napi::Result<Box<dyn Component>> {
  match widget_type {
    WidgetType::Chat => {
      Ok(Box::new(AgentView::new(id.to_string(), None)?))
    }
    _ => Err(napi::Error::from_reason("Widget type not yet implemented")),
  }
}

// Layout Manager
// ============================================================================

#[napi]
pub struct LayoutManager {
  root: Arc<Mutex<LayoutNode>>,
}

#[allow(dead_code)]
enum LayoutNode {
  Split {
    orientation: Direction,
    ratio: f32,
    left: Box<LayoutNode>,
    right: Box<LayoutNode>,
  },
  Tabs {
    tabs: Vec<Tab>,
    active: usize,
  },
  Widget {
    id: String,
  },
}

#[allow(dead_code)]
struct Tab {
  id: String,
  title: String,
  content: LayoutNode,
}

#[napi]
impl LayoutManager {
  #[napi(constructor)]
  pub fn new() -> napi::Result<Self> {
    Ok(Self {
      root: Arc::new(Mutex::new(LayoutNode::Widget {
        id: "root".to_string(),
      })),
    })
  }

  #[napi]
  pub fn set_split(
    &mut self,
    orientation: String,
    ratio: f64,
    left_id: String,
    right_id: String,
  ) -> napi::Result<()> {
    let dir = match orientation.as_str() {
      "horizontal" => Direction::Horizontal,
      "vertical" => Direction::Vertical,
      _ => Direction::Horizontal,
    };

    let mut root = self.root.lock().unwrap();
    *root = LayoutNode::Split {
      orientation: dir,
      ratio: ratio as f32,
      left: Box::new(LayoutNode::Widget { id: left_id }),
      right: Box::new(LayoutNode::Widget { id: right_id }),
    };

    Ok(())
  }
}
