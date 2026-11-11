//! `mantelmesh-cli commands` lists the commands; `mantelmesh-cli run script.json --out file`
//! runs a script (a JSON list of {"command", "params"}) and writes the result: .mmesh, .glb,
//! .obj, .stl or a .png render by the output's extension.

use base64::Engine as _;
use mantelmesh_engine::Session;
use serde_json::{Value, json};
use std::process::ExitCode;

fn main() -> ExitCode {
    match run(std::env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("mantelmesh-cli: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    let mut s = Session::new();
    match args.first().map(String::as_str) {
        Some("commands") => {
            let list = s.execute("engine.commands", &json!({})).map_err(|e| e.0)?;
            println!("{}", serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?);
            Ok(())
        }
        Some("run") => {
            let script = args.get(1).ok_or("run needs a script file")?;
            let out = match (args.get(2).map(String::as_str), args.get(3)) {
                (Some("--out"), Some(path)) => Some(path.clone()),
                (None, _) => None,
                _ => return Err("usage: run <script.json> [--out <file>]".into()),
            };
            let text = std::fs::read_to_string(script).map_err(|e| format!("{script}: {e}"))?;
            let steps: Vec<Value> = serde_json::from_str(&text).map_err(|e| format!("{script}: {e}"))?;
            for (i, step) in steps.iter().enumerate() {
                let name = step
                    .get("command")
                    .and_then(Value::as_str)
                    .ok_or(format!("step {}: no command", i + 1))?;
                let result = s
                    .execute(name, step.get("params").unwrap_or(&Value::Null))
                    .map_err(|e| format!("step {} ({name}): {}", i + 1, e.0))?;
                eprintln!("{name}: {}", result.to_string().chars().take(160).collect::<String>());
            }
            if let Some(path) = out {
                let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
                let result = match ext.as_str() {
                    "mmesh" => s.execute("document.save", &json!({})),
                    "glb" | "obj" | "stl" => s.execute("document.export", &json!({ "format": ext })),
                    "png" => s.execute("document.render", &json!({})),
                    _ => return Err("--out must end in .mmesh, .glb, .obj, .stl or .png".into()),
                }
                .map_err(|e| e.0)?;
                let b64 = result["dataBase64"].as_str().unwrap_or_default();
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .map_err(|e| e.to_string())?;
                std::fs::write(&path, &bytes).map_err(|e| format!("{path}: {e}"))?;
                eprintln!("wrote {path} ({} bytes)", bytes.len());
            }
            Ok(())
        }
        _ => Err("usage: mantelmesh-cli commands | run <script.json> [--out <file>]".into()),
    }
}
