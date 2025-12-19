use crate::skills::SkillLoadOutcome;
use crate::user_instructions::SkillInstructions;
use codex_protocol::models::ResponseItem;
use codex_protocol::user_input::UserInput;
use std::collections::HashSet;
use tokio::fs;

#[derive(Debug, Default)]
pub(crate) struct SkillInjections {
    pub(crate) items: Vec<ResponseItem>,
    pub(crate) warnings: Vec<String>,
}

pub(crate) async fn build_skill_injections(
    inputs: &[UserInput],
    skills: Option<&SkillLoadOutcome>,
) -> SkillInjections {
    if inputs.is_empty() {
        return SkillInjections::default();
    }

    let inline_skill_names: HashSet<String> = inputs
        .iter()
        .filter_map(|input| match input {
            UserInput::SkillInline { name, .. } => Some(name.clone()),
            _ => None,
        })
        .collect();

    let mut result = SkillInjections::default();
    let mut seen: HashSet<String> = HashSet::new();

    for input in inputs {
        match input {
            UserInput::SkillInline { name, contents } => {
                if seen.insert(name.clone()) {
                    result.items.push(ResponseItem::from(SkillInstructions {
                        name: name.clone(),
                        path: "(inline)".to_string(),
                        contents: contents.clone(),
                    }));
                }
            }
            UserInput::Skill { name, path } => {
                if inline_skill_names.contains(name) || !seen.insert(name.clone()) {
                    continue;
                }

                let Some(outcome) = skills else {
                    continue;
                };

                let Some(skill) = outcome
                    .skills
                    .iter()
                    .find(|skill| skill.name == *name && skill.path == *path)
                else {
                    continue;
                };

                match fs::read_to_string(&skill.path).await {
                    Ok(contents) => {
                        result.items.push(ResponseItem::from(SkillInstructions {
                            name: skill.name.clone(),
                            path: skill.path.to_string_lossy().into_owned(),
                            contents,
                        }));
                    }
                    Err(err) => {
                        let name = &skill.name;
                        let path = skill.path.display();
                        result
                            .warnings
                            .push(format!("Failed to load skill {name} at {path}: {err:#}"));
                    }
                }
            }
            _ => {}
        }
    }

    if result.items.is_empty() && result.warnings.is_empty() {
        SkillInjections::default()
    } else {
        result
    }
}
