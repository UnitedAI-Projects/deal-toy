//! Windows only: embed the app icon and version info into `manteldocs.exe`. Elsewhere a no-op.

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../../assets/app-icon/manteldocs.ico");
    println!("cargo:rerun-if-env-changed=MANTELDOCS_REQUIRE_WINRES");
    println!("cargo:rerun-if-env-changed=MANTELDOCS_BUILD_SHA");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let mut res = winresource::WindowsResource::new();
    if std::path::Path::new("../../assets/app-icon/manteldocs.ico").exists() {
        res.set_icon("../../assets/app-icon/manteldocs.ico");
    }
    res.set("ProductName", "MantelDocs")
        .set("FileDescription", "MantelDocs computer-aided design")
        .set("CompanyName", "ichen27")
        .set("LegalCopyright", "Copyright (c) 2026 ArtCraft Team and the CADCraft contributors. MIT OR Apache-2.0.")
        .set("OriginalFilename", "manteldocs.exe")
        .set("InternalName", "manteldocs");
    if let Err(e) = res.compile() {
        if std::env::var_os("MANTELDOCS_REQUIRE_WINRES").is_some() {
            eprintln!("embedding Windows resources failed: {e}");
            std::process::exit(1);
        }
        println!("cargo:warning=manteldocs.exe built without icon/version resources: {e}");
    }
}
