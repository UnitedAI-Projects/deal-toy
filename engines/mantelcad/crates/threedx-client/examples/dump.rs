//! Prints what the 3Dconnexion driver reports: `cargo run -p mantelcad-3dx-client --example dump`.
//! The driver sends nothing to a program that is not in an app bundle, so only `DeviceAdded` shows here;
//! use MantelCAD's own `.app` to see the cap move.

fn main() {
    if let Err(error) = mantelcad_3dx_client::start(
        "MantelCAD dump",
        |event| println!("{event:?}"),
        |connected| {
            if let Err(error) = connected {
                eprintln!("{error}");
            }
        },
    ) {
        eprintln!("{error}");
        return;
    }
    std::thread::sleep(std::time::Duration::from_secs(60));
}
