use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() {
  napi_build::setup();
  if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("linux") {
    return;
  }

  if let Err(err) = build_linux_sandbox() {
    panic!("failed to build codex-linux-sandbox artifact: {err}");
  }
}

fn build_linux_sandbox() -> Result<(), Box<dyn std::error::Error>> {
  let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
  let workspace_root = manifest_dir.join("../../codex-rs").canonicalize()?;
  let out_dir = PathBuf::from(env::var("OUT_DIR")?);
  let target = env::var("TARGET")?;
  let cargo = env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());

  let target_dir = out_dir.join("codex-linux-sandbox-target");
  fs::create_dir_all(&target_dir)?;

  let status = Command::new(cargo)
    .current_dir(&workspace_root)
    .env("CARGO_TARGET_DIR", &target_dir)
    .args([
      "build",
      "--release",
      "--bin",
      "codex-linux-sandbox",
      "--target",
      &target,
    ])
    .status()?;

  if !status.success() {
    return Err("cargo build for codex-linux-sandbox failed".into());
  }

  let binary_name = if target.contains("windows") {
    "codex-linux-sandbox.exe"
  } else {
    "codex-linux-sandbox"
  };

  let built_path = target_dir.join(&target).join("release").join(binary_name);

  if !built_path.exists() {
    return Err(format!("expected sandbox binary at {built_path:?}").into());
  }

  let dest = out_dir.join(binary_name);
  fs::copy(&built_path, &dest)?;

  println!("cargo:rustc-env=CODEX_LINUX_SANDBOX_BIN={}", dest.display());
  println!(
    "cargo:rerun-if-changed={}",
    workspace_root.join("linux-sandbox/src").display()
  );

  Ok(())
}
