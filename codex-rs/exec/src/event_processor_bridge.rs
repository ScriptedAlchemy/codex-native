use crate::event_processor::CodexStatus;
use crate::event_processor::EventProcessor;
use crate::event_processor_with_jsonl_output::EventProcessorWithJsonOutput;
use crate::exec_events::ThreadEvent;
use codex_core::config::Config;
use codex_core::protocol::Event;
use codex_core::protocol::EventMsg;
use codex_core::protocol::SessionConfiguredEvent;
use codex_core::protocol::TaskCompleteEvent;
use std::path::PathBuf;

struct CallbackEventProcessor {
    mapper: EventProcessorWithJsonOutput,
    callback: Box<dyn FnMut(ThreadEvent) + Send>,
}

impl CallbackEventProcessor {
    fn new(
        callback: Box<dyn FnMut(ThreadEvent) + Send>,
        last_message_file: Option<PathBuf>,
    ) -> Self {
        Self {
            mapper: EventProcessorWithJsonOutput::new(last_message_file),
            callback,
        }
    }
}

impl EventProcessor for CallbackEventProcessor {
    fn print_config_summary(
        &mut self,
        _config: &Config,
        _prompt: &str,
        ev: &SessionConfiguredEvent,
    ) {
        let _ = self.process_event(Event {
            id: "".to_string(),
            msg: EventMsg::SessionConfigured(ev.clone()),
        });
    }

    fn process_event(&mut self, event: Event) -> CodexStatus {
        let aggregated = self.mapper.collect_thread_events(&event);
        for e in aggregated {
            (self.callback)(e);
        }

        let Event { msg, .. } = event;
        if let EventMsg::TaskComplete(TaskCompleteEvent { .. }) = msg {
            CodexStatus::InitiateShutdown
        } else {
            CodexStatus::Running
        }
    }
}

pub fn callback_event_processor(
    callback: Box<dyn FnMut(ThreadEvent) + Send>,
    last_message_file: Option<PathBuf>,
) -> Box<dyn EventProcessor> {
    Box::new(CallbackEventProcessor::new(callback, last_message_file))
}
