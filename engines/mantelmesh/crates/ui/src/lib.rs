#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
//! MantelMesh's interface over the command engine: the egui panels, an orbit camera, face picking
//! and a WebGL2 viewport. The web app (apps/mantelmesh-web) runs it in eframe and connects it to
//! the page hosting it.

pub mod app;
pub mod camera;
pub mod gl;
pub mod pick;

pub use app::{Host, MeshApp};
