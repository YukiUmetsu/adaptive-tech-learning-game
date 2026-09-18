//! Writes the OpenAPI document to stdout.
//!
//! ```bash
//! cargo run -p adaptive-learn-api --bin export-openapi > web/openapi.json
//! ```

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let document = adaptive_learn_api::openapi::openapi();
    println!("{}", serde_json::to_string_pretty(&document)?);
    Ok(())
}
