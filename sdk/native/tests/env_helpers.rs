use codex_native::*;
use pretty_assertions::assert_eq;

#[test]
fn test_env_overrides_sets_and_restores_vars() {
  let test_key = "CODEX_TEST_VAR_UNIQUE_123";
  unsafe { std::env::remove_var(test_key) };

  {
    let _guard = EnvOverrides::apply(vec![(test_key, Some("test_value".to_string()), true)]);
    assert_eq!(std::env::var(test_key).ok(), Some("test_value".to_string()));
  }

  assert_eq!(std::env::var(test_key).ok(), None);
}

#[test]
fn test_env_overrides_restores_previous_value() {
  let test_key = "CODEX_TEST_VAR_PREV_456";
  unsafe { std::env::set_var(test_key, "original") };

  {
    let _guard = EnvOverrides::apply(vec![(test_key, Some("new_value".to_string()), true)]);
    assert_eq!(std::env::var(test_key).ok(), Some("new_value".to_string()));
  }

  assert_eq!(std::env::var(test_key).ok(), Some("original".to_string()));
  unsafe { std::env::remove_var(test_key) };
}

#[test]
fn test_env_overrides_removes_when_none_and_force() {
  let test_key = "CODEX_TEST_VAR_REMOVE_789";
  unsafe { std::env::set_var(test_key, "to_be_removed") };

  {
    let _guard = EnvOverrides::apply(vec![(test_key, None, true)]);
    assert_eq!(std::env::var(test_key).ok(), None);
  }

  assert_eq!(
    std::env::var(test_key).ok(),
    Some("to_be_removed".to_string())
  );
  unsafe { std::env::remove_var(test_key) };
}

#[test]
fn test_env_overrides_multiple_vars() {
  let key1 = "CODEX_TEST_MULTI_1";
  let key2 = "CODEX_TEST_MULTI_2";
  unsafe {
    std::env::remove_var(key1);
    std::env::remove_var(key2);
  }

  {
    let _guard = EnvOverrides::apply(vec![
      (key1, Some("value1".to_string()), true),
      (key2, Some("value2".to_string()), true),
    ]);
    assert_eq!(std::env::var(key1).ok(), Some("value1".to_string()));
    assert_eq!(std::env::var(key2).ok(), Some("value2".to_string()));
  }

  assert_eq!(std::env::var(key1).ok(), None);
  assert_eq!(std::env::var(key2).ok(), None);
}

#[test]
fn test_env_overrides_skip_when_not_forced_and_none() {
  let test_key = "CODEX_TEST_VAR_SKIP";
  unsafe { std::env::set_var(test_key, "original") };

  {
    let _guard = EnvOverrides::apply(vec![(test_key, None, false)]);
    assert_eq!(std::env::var(test_key).ok(), Some("original".to_string()));
  }

  assert_eq!(std::env::var(test_key).ok(), Some("original".to_string()));
  unsafe { std::env::remove_var(test_key) };
}
