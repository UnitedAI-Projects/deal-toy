//! The MantelMesh interface. Every button runs an engine command, so what a person does here is
//! exactly what the CLI, a control channel or an agent can do.

use crate::camera::Orbit;
use crate::gl::{Geometry, Renderer, geometry};
use crate::pick::pick;
use base64::Engine as _;
use egui::{Color32, PointerButton, RichText, Sense, Vec2};
use mantelmesh_doc::PRESETS;
use mantelmesh_engine::Session;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

/// Where saves go: the page hosting MantelMesh (Mantel), or a download.
pub trait Host {
    fn save(&self, name: &str, bytes: &[u8]);
    fn dirty(&self, dirty: bool);
}

pub struct MeshApp {
    pub session: Session,
    pub name: String,
    pub object: Option<u32>,
    pub faces: BTreeSet<u32>,
    pub camera: Orbit,
    pub status: String,
    pub error: String,
    host: Option<Box<dyn Host>>,
    saved_history: usize,
    dirty_reported: bool,
    extrude: f64,
    inset: f64,
    offset: [f64; 3],
    factor: f64,
    angle: f64,
    merge: f64,
    renderer: Arc<Mutex<Option<Renderer>>>,
    geometry: Arc<Mutex<Geometry>>,
    /// Bumped on every change to the scene, so the viewport rebuilds only when it must.
    rev: u64,
    built: Option<(u64, Option<u32>, Vec<u32>)>,
}

impl Default for MeshApp {
    fn default() -> Self {
        Self::new(None)
    }
}

fn decode(v: &Value) -> Vec<u8> {
    v["dataBase64"]
        .as_str()
        .and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok())
        .unwrap_or_default()
}

impl MeshApp {
    pub fn new(host: Option<Box<dyn Host>>) -> Self {
        Self {
            session: Session::new(),
            name: "Concept".into(),
            object: None,
            faces: BTreeSet::new(),
            camera: Orbit::default(),
            status: "Add a shape to start".into(),
            error: String::new(),
            host,
            saved_history: 0,
            dirty_reported: false,
            extrude: 10.0,
            inset: 0.2,
            offset: [0.0, 0.0, 10.0],
            factor: 0.8,
            angle: 15.0,
            merge: 0.01,
            renderer: Arc::default(),
            geometry: Arc::default(),
            rev: 0,
            built: None,
        }
    }

    /// Runs a command and shows its outcome. Returns its result on success.
    pub fn run(&mut self, command: &str, params: Value) -> Option<Value> {
        match self.session.execute(command, &params) {
            Ok(v) => {
                self.rev += 1;
                self.error.clear();
                self.status = command.to_string();
                Some(v)
            }
            Err(e) => {
                self.error = e.0;
                None
            }
        }
    }

    fn history(&self) -> usize {
        self.session.journal.labels().len()
    }
    pub fn is_dirty(&self) -> bool {
        self.history() != self.saved_history
    }

    /// Opens a file the host or the person handed in: .mmesh replaces the scene, .obj adds to it.
    pub fn open_file(&mut self, name: &str, bytes: &[u8]) {
        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
        let lower = name.to_lowercase();
        let ok = if lower.ends_with(".obj") {
            self.run("document.import", json!({ "dataBase64": data })).is_some()
        } else if lower.ends_with(".mmesh") {
            self.run("document.open", json!({ "dataBase64": data })).is_some()
        } else {
            self.error = format!("MantelMesh opens .mmesh and .obj files, not {name}");
            false
        };
        if ok {
            self.name = name
                .rsplit_once('.')
                .map(|(b, _)| b.to_string())
                .unwrap_or_else(|| name.to_string());
            self.object = None;
            self.faces.clear();
            self.session.journal = Default::default();
            self.saved_history = 0;
            self.frame_all();
            self.status = format!("Opened {name}");
        }
    }

    pub fn frame_all(&mut self) {
        if let Some((lo, hi)) = self.session.doc.bounds() {
            self.camera.frame(lo, hi);
        }
    }

    /// Saves the scene and a card render: to the host when there is one.
    pub fn save(&mut self) {
        let Some(doc) = self.run("document.save", json!({})) else {
            return;
        };
        let png = self.run("document.render", json!({ "width": 800, "height": 600 }));
        let Some(host) = &self.host else {
            self.error = "Saving needs Mantel (or Export to download)".into();
            return;
        };
        host.save(&format!("{}.mmesh", self.name), &decode(&doc));
        if let Some(png) = png {
            host.save(&format!("{}.png", self.name), &decode(&png));
        }
        self.saved_history = self.history();
        self.status = format!("Saved {}.mmesh", self.name);
    }

    fn export(&mut self, format: &str) {
        let r = if format == "png" {
            self.run("document.render", json!({ "width": 1600, "height": 1200 }))
        } else {
            self.run("document.export", json!({ "format": format }))
        };
        if let (Some(r), Some(host)) = (r, &self.host) {
            host.save(&format!("{}.{format}", self.name), &decode(&r));
            self.status = format!("Exported {}.{format}", self.name);
        }
    }

    fn report_dirty(&mut self) {
        let d = self.is_dirty();
        if d != self.dirty_reported {
            self.dirty_reported = d;
            if let Some(h) = &self.host {
                h.dirty(d);
            }
        }
    }

    fn face_list(&self) -> Vec<u32> {
        self.faces.iter().copied().collect()
    }

    fn after_mesh_edit(&mut self, result: Option<Value>) {
        if let Some(r) = result {
            // An operation that made faces selects them, so extrude → scale chains naturally.
            if let Some(made) = r["result"]["faces"].as_array() {
                self.faces = made.iter().filter_map(Value::as_u64).map(|f| f as u32).collect();
            }
            let check = &r["check"];
            let bad = ["non_manifold_edges", "inconsistent_edges", "degenerate_faces"]
                .iter()
                .filter(|k| check[**k].as_array().is_some_and(|a| !a.is_empty()))
                .count();
            if bad > 0 {
                self.status = "Edited; the mesh check found problems (see Check)".into();
            }
        }
    }

    pub fn ui(&mut self, ui: &mut egui::Ui) {
        egui::Panel::top("bar").show(ui, |ui| self.top_bar(ui));
        egui::Panel::left("outliner")
            .default_size(220.0)
            .min_size(180.0)
            .show(ui, |ui| self.outliner(ui));
        egui::Panel::right("properties")
            .default_size(290.0)
            .min_size(260.0)
            .show(ui, |ui| self.properties(ui));
        egui::CentralPanel::no_frame().show(ui, |ui| self.viewport(ui));
        self.report_dirty();
    }

    fn top_bar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.label(RichText::new("MantelMesh").strong());
            ui.add(egui::TextEdit::singleline(&mut self.name).desired_width(140.0));
            if ui.button("New").clicked() {
                self.rev += 1;
                self.session = Session::new();
                self.object = None;
                self.faces.clear();
                self.saved_history = 0;
            }
            if ui.add_enabled(self.host.is_some(), egui::Button::new("Save")).clicked() {
                self.save();
            }
            for f in ["glb", "stl", "obj", "png"] {
                if ui
                    .add_enabled(
                        self.host.is_some(),
                        egui::Button::new(format!("Export {}", f.to_uppercase())),
                    )
                    .clicked()
                {
                    self.export(f);
                }
            }
            ui.separator();
            if ui.button("Undo").clicked()
                || ui.input(|i| i.modifiers.command && !i.modifiers.shift && i.key_pressed(egui::Key::Z))
            {
                self.run("edit.undo", json!({}));
            }
            if ui.button("Redo").clicked()
                || ui.input(|i| i.modifiers.command && i.modifiers.shift && i.key_pressed(egui::Key::Z))
            {
                self.run("edit.redo", json!({}));
            }
            ui.separator();
            if self.error.is_empty() {
                ui.label(RichText::new(&self.status).weak());
            } else {
                ui.label(RichText::new(&self.error).color(Color32::from_rgb(217, 58, 50)));
            }
            if self.is_dirty() {
                ui.label(RichText::new("● unsaved").weak());
            }
        });
    }

    fn outliner(&mut self, ui: &mut egui::Ui) {
        ui.heading("Add");
        ui.horizontal_wrapped(|ui| {
            for (label, shape) in [
                ("Box", "box"),
                ("Cylinder", "cylinder"),
                ("Sphere", "sphere"),
                ("Plane", "plane"),
            ] {
                if ui.button(label).clicked()
                    && let Some(r) = self.run("object.add", json!({ "shape": shape, "name": label }))
                {
                    self.object = r["object"].as_u64().map(|x| x as u32);
                    self.faces.clear();
                    if self.session.doc.objects.len() == 1 {
                        self.frame_all();
                    }
                }
            }
        });
        ui.separator();
        ui.heading("Objects");
        let rows: Vec<(u32, String, bool)> = self
            .session
            .doc
            .objects
            .iter()
            .map(|o| (o.id, o.name.clone(), o.visible))
            .collect();
        if rows.is_empty() {
            ui.label(RichText::new("Nothing yet").weak());
        }
        for (id, name, visible) in rows {
            ui.horizontal(|ui| {
                if ui.selectable_label(self.object == Some(id), &name).clicked() {
                    self.object = Some(id);
                    self.faces.clear();
                }
                if ui.small_button(if visible { "hide" } else { "show" }).clicked()
                    && let Some(o) = self.session.doc.get_mut(id)
                {
                    o.visible = !o.visible;
                    self.rev += 1;
                }
            });
        }
        ui.separator();
        if ui.button("Frame all").clicked() {
            self.frame_all();
        }
        ui.label(
            RichText::new("Drag: orbit · right-drag: pan · scroll: zoom · click: select a face · shift-click: add")
                .weak()
                .small(),
        );
    }

    fn properties(&mut self, ui: &mut egui::Ui) {
        let Some(id) = self.object.filter(|id| self.session.doc.get(*id).is_some()) else {
            ui.label(RichText::new("Select an object").weak());
            return;
        };
        let Some(o) = self.session.doc.get(id).cloned() else {
            return;
        };
        ui.heading(&o.name);
        let mut name = o.name.clone();
        if ui.text_edit_singleline(&mut name).lost_focus() && name != o.name {
            self.run("object.rename", json!({ "object": id, "name": name }));
        }
        ui.label(format!(
            "{} vertices · {} faces",
            o.mesh.positions.len(),
            o.mesh.faces.len()
        ));
        ui.collapsing("Placement", |ui| {
            let mut t = o.transform.clone();
            let mut changed = false;
            for (label, v, speed) in [
                ("Position mm", &mut t.translation, 1.0),
                ("Rotation °", &mut t.rotation_deg, 1.0),
                ("Scale", &mut t.scale, 0.01),
            ] {
                ui.horizontal(|ui| {
                    ui.label(label);
                    for c in v.iter_mut() {
                        changed |= ui.add(egui::DragValue::new(c).speed(speed)).changed();
                    }
                });
            }
            if changed {
                self.run(
                    "object.transform",
                    json!({ "object": id, "translation": t.translation, "rotation": t.rotation_deg, "scale": t.scale }),
                );
            }
        });
        ui.horizontal(|ui| {
            ui.label("Material");
            egui::ComboBox::from_id_salt("material")
                .selected_text(o.material.name.clone())
                .show_ui(ui, |ui| {
                    for p in PRESETS {
                        if ui.selectable_label(false, *p).clicked() {
                            self.run("object.material", json!({ "object": id, "preset": p }));
                        }
                    }
                });
        });
        ui.separator();
        ui.heading(format!("Faces ({} selected)", self.faces.len()));
        let has = !self.faces.is_empty();
        ui.horizontal(|ui| {
            ui.add(egui::DragValue::new(&mut self.extrude).speed(0.5).suffix(" mm"));
            if ui.add_enabled(has, egui::Button::new("Extrude")).clicked() {
                let r = self.run(
                    "mesh.extrude",
                    json!({ "object": id, "faces": self.face_list(), "distance": self.extrude }),
                );
                self.after_mesh_edit(r);
            }
        });
        ui.horizontal(|ui| {
            ui.add(egui::DragValue::new(&mut self.inset).speed(0.01).range(0.01..=0.99));
            if ui.add_enabled(has, egui::Button::new("Inset")).clicked() {
                let r = self.run(
                    "mesh.inset",
                    json!({ "object": id, "faces": self.face_list(), "amount": self.inset }),
                );
                self.after_mesh_edit(r);
            }
        });
        ui.horizontal(|ui| {
            for c in self.offset.iter_mut() {
                ui.add(egui::DragValue::new(c).speed(0.5));
            }
            if ui.add_enabled(has, egui::Button::new("Move")).clicked() {
                let r = self.run(
                    "mesh.move",
                    json!({ "object": id, "faces": self.face_list(), "offset": self.offset }),
                );
                self.after_mesh_edit(r);
            }
        });
        ui.horizontal(|ui| {
            ui.add(egui::DragValue::new(&mut self.factor).speed(0.01).range(0.01..=100.0));
            if ui.add_enabled(has, egui::Button::new("Scale")).clicked() {
                let r = self.run("mesh.scale", json!({ "object": id, "faces": self.face_list(), "factor": [self.factor, self.factor, self.factor] }));
                self.after_mesh_edit(r);
            }
        });
        ui.horizontal(|ui| {
            ui.add(egui::DragValue::new(&mut self.angle).speed(1.0).suffix("°"));
            if ui.add_enabled(has, egui::Button::new("Rotate about Z")).clicked() {
                let r = self.run(
                    "mesh.rotate",
                    json!({ "object": id, "faces": self.face_list(), "axis": [0, 0, 1], "degrees": self.angle }),
                );
                self.after_mesh_edit(r);
            }
        });
        ui.horizontal(|ui| {
            if ui.add_enabled(has, egui::Button::new("Flip")).clicked() {
                self.run("mesh.flip", json!({ "object": id, "faces": self.face_list() }));
            }
            if ui.add_enabled(has, egui::Button::new("Delete faces")).clicked()
                && self
                    .run("mesh.delete", json!({ "object": id, "faces": self.face_list() }))
                    .is_some()
            {
                self.faces.clear();
            }
        });
        ui.horizontal(|ui| {
            ui.add(
                egui::DragValue::new(&mut self.merge)
                    .speed(0.01)
                    .range(0.0001..=100.0)
                    .suffix(" mm"),
            );
            if ui.button("Merge by distance").clicked() {
                self.run("mesh.merge", json!({ "object": id, "distance": self.merge }));
                self.faces.clear();
            }
        });
        ui.separator();
        let check = o.mesh.check();
        if check.is_closed_solid() {
            ui.label(RichText::new("✓ Closed, manifold, consistently wound").color(Color32::from_rgb(15, 159, 110)));
        } else {
            for (label, n) in [
                ("non-manifold edges", check.non_manifold_edges.len()),
                ("open edges", check.boundary_edges.len()),
                ("flipped neighbours", check.inconsistent_edges.len()),
                ("degenerate faces", check.degenerate_faces.len()),
            ] {
                if n > 0 {
                    ui.label(RichText::new(format!("{n} {label}")).color(Color32::from_rgb(183, 121, 31)));
                }
            }
        }
        ui.separator();
        if ui.button("Delete object").clicked() && self.run("object.delete", json!({ "object": id })).is_some() {
            self.object = None;
            self.faces.clear();
        }
    }

    fn viewport(&mut self, ui: &mut egui::Ui) {
        let size = ui.available_size().max(Vec2::splat(10.0));
        let (rect, response) = ui.allocate_exact_size(size, Sense::click_and_drag());
        ui.painter().rect_filled(rect, 0.0, Color32::from_rgb(241, 241, 238));
        if response.dragged_by(PointerButton::Primary) {
            let d = response.drag_delta();
            self.camera.orbit(d.x as f64, d.y as f64);
        }
        if response.dragged_by(PointerButton::Secondary) || response.dragged_by(PointerButton::Middle) {
            let d = response.drag_delta();
            self.camera.pan(d.x as f64, d.y as f64, rect.height() as f64);
        }
        if response.hovered() {
            let scroll = ui.input(|i| i.smooth_scroll_delta.y);
            if scroll != 0.0 {
                self.camera.zoom(scroll as f64);
            }
        }
        if response.clicked()
            && let Some(p) = response.interact_pointer_pos()
        {
            let (o, d) = self.camera.ray(
                (p.x - rect.left()) as f64,
                (p.y - rect.top()) as f64,
                rect.width() as f64,
                rect.height() as f64,
            );
            let shift = ui.input(|i| i.modifiers.shift);
            match pick(&self.session.doc, o, d) {
                Some((obj, face, _)) => {
                    if self.object != Some(obj) || !shift {
                        self.faces.clear();
                    }
                    self.object = Some(obj);
                    if !self.faces.remove(&face) {
                        self.faces.insert(face);
                    }
                }
                None if !shift => self.faces.clear(),
                None => {}
            }
        }
        // Rebuild what the GPU draws only when the scene or selection changed.
        let key = (self.rev, self.object, self.face_list());
        if self.built.as_ref() != Some(&key) {
            let sel = self.object.map(|o| (o, &self.faces));
            if let Ok(mut g) = self.geometry.lock() {
                *g = geometry(&self.session.doc, sel, 200.0);
            }
            self.built = Some(key);
        }
        let mvp = self.camera.matrix((rect.width() / rect.height().max(1.0)) as f64);
        let renderer = self.renderer.clone();
        let geometry = self.geometry.clone();
        let callback = egui_glow::CallbackFn::new(move |_info, painter| {
            let gl = painter.gl();
            let Ok(mut r) = renderer.lock() else { return };
            if r.is_none() {
                match Renderer::new(gl) {
                    Ok(made) => *r = Some(made),
                    Err(e) => {
                        log_error(&e);
                        return;
                    }
                }
            }
            if let (Some(r), Ok(g)) = (r.as_ref(), geometry.lock()) {
                r.paint(gl, &mvp, &g);
            }
        });
        ui.painter().add(egui::PaintCallback {
            rect,
            callback: Arc::new(callback),
        });
        if self.session.doc.objects.is_empty() {
            ui.painter().text(
                rect.center(),
                egui::Align2::CENTER_CENTER,
                "Add a box, cylinder, sphere or plane to start",
                egui::FontId::proportional(15.0),
                Color32::from_gray(120),
            );
        }
    }
}

fn log_error(e: &str) {
    // The viewport can't draw; the panels still work. Visible in the browser console.
    eprintln!("MantelMesh viewport: {e}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    struct Saves(Rc<RefCell<Vec<String>>>);
    impl Host for Saves {
        fn save(&self, name: &str, bytes: &[u8]) {
            self.0.borrow_mut().push(format!("{name}:{}", bytes.len()));
        }
        fn dirty(&self, _: bool) {}
    }

    #[test]
    fn saving_sends_the_scene_and_a_render_to_the_host_and_clears_dirty() {
        let log = Rc::new(RefCell::new(vec![]));
        let mut app = MeshApp::new(Some(Box::new(Saves(log.clone()))));
        app.run("object.add", json!({ "shape": "box" }));
        assert!(app.is_dirty());
        app.save();
        assert!(!app.is_dirty());
        let saved = log.borrow();
        assert!(
            saved[0].starts_with("Concept.mmesh:") && saved[1].starts_with("Concept.png:"),
            "{saved:?}"
        );
    }

    #[test]
    fn opening_a_saved_file_restores_it_and_refuses_others() {
        let mut a = MeshApp::new(None);
        a.run("object.add", json!({ "shape": "sphere" }));
        let doc = decode(&a.run("document.save", json!({})).unwrap_or_default());
        let mut b = MeshApp::new(None);
        b.open_file("Harbor.mmesh", &doc);
        assert_eq!(b.error, "");
        assert_eq!(b.session.doc, a.session.doc);
        assert_eq!(b.name, "Harbor");
        assert!(!b.is_dirty());
        b.open_file("logo.svg", b"<svg/>");
        assert!(b.error.contains("opens .mmesh and .obj"));
    }

    #[test]
    fn an_extrude_selects_what_it_made() {
        let mut app = MeshApp::new(None);
        app.run("object.add", json!({ "shape": "box" }));
        let r = app.run("mesh.extrude", json!({ "object": 1, "faces": [1], "distance": 5 }));
        app.after_mesh_edit(r);
        assert_eq!(app.faces.len(), 5);
    }
}
