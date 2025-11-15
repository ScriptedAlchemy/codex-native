use tokio::sync::mpsc::UnboundedSender;

use crate::app_event::AppEvent;
use crate::session_log;

#[derive(Clone, Debug)]
pub(crate) struct AppEventSender {
    pub app_event_tx: UnboundedSender<AppEvent>,
}

impl AppEventSender {
    pub(crate) fn new(app_event_tx: UnboundedSender<AppEvent>) -> Self {
        Self { app_event_tx }
    }

    /// Send an event to the app event channel. If it fails, we swallow the
    /// error and log it.
    pub(crate) fn send(&self, event: AppEvent) {
        // Record inbound events for high-fidelity session replay.
        // Avoid double-logging Ops; those are logged at the point of submission.
        if !matches!(event, AppEvent::CodexOp(_)) {
            session_log::log_inbound_app_event(&event);
        }
        if self.app_event_tx.is_closed() {
            tracing::debug!("dropping app event because channel is closed");
            return;
        }
        if let Err(e) = self.app_event_tx.send(event) {
            tracing::debug!("dropping app event because channel is closed: {e}");
        }
    }
}
