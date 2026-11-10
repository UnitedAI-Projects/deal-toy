//! MantelDocs releases are opened in the browser. The upstream self-installer assumes
//! ArtCraft package identities and must not be used by this independent fork.

use crate::CadApp;

const RELEASES_URL: &str = "https://github.com/ichen27/manteldocs/releases";

#[derive(Default)]
pub struct Runtime {
    requested: bool,
}

pub fn check_now(app: &mut CadApp) {
    app.updates_rt.requested = true;
}

pub fn tick(app: &mut CadApp, ctx: &egui::Context) {
    if std::mem::take(&mut app.updates_rt.requested) {
        ctx.open_url(egui::OpenUrl::new_tab(RELEASES_URL));
        app.session.echo("MantelDocs releases opened in your browser. Sign in to GitHub to view private downloads.");
    }
}

pub fn show(_app: &mut CadApp, _ctx: &egui::Context) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn releases_belong_to_manteldocs_and_do_not_auto_check() {
        assert_eq!(RELEASES_URL, "https://github.com/ichen27/manteldocs/releases");
        assert!(!Runtime::default().requested);
    }
}
