//! MantelMesh in the browser. Hosted by Mantel (`?host=parent`), files open from the project and
//! saves go back to it through the Craft host bridge; on its own, saves download.

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    eprintln!("mantelmesh-web is the browser build: run `trunk build --release` in apps/mantelmesh-web");
}

#[cfg(target_arch = "wasm32")]
fn main() {
    web::start();
}

#[cfg(target_arch = "wasm32")]
mod web {
    use craft_web_host::web::{FileData, Host as Bridge, Message};
    use mantelmesh_ui::{Host, MeshApp};
    use std::cell::RefCell;
    use std::rc::Rc;
    use wasm_bindgen::JsCast;

    type Inbox = Rc<RefCell<Vec<(String, Vec<u8>)>>>;
    type Saved = Rc<RefCell<Vec<String>>>;

    struct Hosted(Rc<Bridge>);
    impl Host for Hosted {
        fn save(&self, name: &str, bytes: &[u8], id: Option<&str>) -> Result<bool, String> {
            self.0.post_save(name, bytes, id, false)?;
            Ok(false)
        }
        fn dirty(&self, dirty: bool) {
            self.0.post_dirty(dirty);
        }
    }

    /// Standalone: saves become downloads.
    struct Download;
    impl Host for Download {
        fn save(&self, name: &str, bytes: &[u8], _: Option<&str>) -> Result<bool, String> {
            download(name, bytes).ok_or_else(|| "Could not start the download".to_string())?;
            Ok(true)
        }
        fn dirty(&self, _: bool) {}
    }
    fn download(name: &str, bytes: &[u8]) -> Option<()> {
        let array = js_sys::Array::of1(&js_sys::Uint8Array::from(bytes).into());
        let blob = web_sys::Blob::new_with_u8_array_sequence(&array).ok()?;
        let url = web_sys::Url::create_object_url_with_blob(&blob).ok()?;
        let a: web_sys::HtmlAnchorElement = web_sys::window()?
            .document()?
            .create_element("a")
            .ok()?
            .dyn_into()
            .ok()?;
        a.set_href(&url);
        a.set_download(name);
        a.click();
        web_sys::Url::revoke_object_url(&url).ok()
    }

    struct App {
        inner: MeshApp,
        inbox: Inbox,
        saved: Saved,
    }
    impl eframe::App for App {
        fn ui(&mut self, ui: &mut eframe::egui::Ui, _frame: &mut eframe::Frame) {
            let files: Vec<_> = self.inbox.borrow_mut().drain(..).collect();
            for (name, bytes) in files {
                self.inner.open_file(&name, &bytes);
            }
            for id in self.saved.borrow_mut().drain(..) {
                self.inner.saved(&id);
            }
            self.inner.ui(ui);
        }
    }

    pub fn start() {
        wasm_bindgen_futures::spawn_local(async {
            let Some(document) = web_sys::window().and_then(|w| w.document()) else {
                return;
            };
            let Some(canvas) = document.get_element_by_id("mantelmesh_canvas") else {
                return;
            };
            let inbox: Inbox = Rc::default();
            let saved: Saved = Rc::default();
            let bridge = Bridge::connect("mantelmesh", &canvas).map(Rc::new);
            let host: Box<dyn Host> = match &bridge {
                Some(b) => {
                    let (b2, inbox2) = (b.clone(), inbox.clone());
                    let saved2 = saved.clone();
                    b.listen(move |m| {
                        if let Message::Saved { id } = m {
                            saved2.borrow_mut().push(id);
                        } else if let Message::Open { name, data } = m {
                            let (inbox, b) = (inbox2.clone(), b2.clone());
                            wasm_bindgen_futures::spawn_local(async move {
                                match read(data).await {
                                    Some(bytes) => inbox.borrow_mut().push((name, bytes)),
                                    None => {
                                        let _ = b.post_failed("MantelMesh couldn't read the file", None);
                                    }
                                }
                            });
                        }
                    });
                    Box::new(Hosted(b.clone()))
                }
                None => Box::new(Download),
            };
            let Ok(canvas) = canvas.dyn_into::<web_sys::HtmlCanvasElement>() else {
                return;
            };
            let options = eframe::WebOptions {
                renderer: eframe::Renderer::Glow,
                depth_buffer: 24,
                ..Default::default()
            };
            let app_inbox = inbox.clone();
            let started = eframe::WebRunner::new()
                .start(
                    canvas,
                    options,
                    Box::new(move |_cc| {
                        Ok(Box::new(App {
                            inner: MeshApp::new(Some(host)),
                            inbox: app_inbox,
                            saved,
                        }))
                    }),
                )
                .await;
            if let Some(loading) = document.get_element_by_id("mantelmesh_loading") {
                loading.remove();
            }
            match (started, &bridge) {
                (Ok(()), Some(b)) => {
                    let _ = b.post_ready(env!("CARGO_PKG_VERSION"), false);
                }
                (Err(e), Some(b)) => {
                    let _ = b.post_failed(&format!("{e:?}"), None);
                }
                (Err(e), None) => web_sys::console::error_1(&e),
                _ => {}
            }
        });
    }

    async fn read(data: FileData) -> Option<Vec<u8>> {
        // Concept files are small; anything over 200 MB is refused rather than copied.
        if data.size() > 200.0 * 1024.0 * 1024.0 {
            return None;
        }
        match data {
            FileData::Bytes(array) => Some(array.to_vec()),
            FileData::Blob(blob) => {
                let buffer = wasm_bindgen_futures::JsFuture::from(blob.array_buffer()).await.ok()?;
                Some(js_sys::Uint8Array::new(&buffer).to_vec())
            }
        }
    }
}
