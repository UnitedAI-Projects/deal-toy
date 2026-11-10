"""AppRun puts a `mantelcad-cli` wrapper on PATH (~/.local/bin) and the wrapper runs the bundled CLI."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class AppRunCli(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.appdir = self.tmp / "app" / "AppDir"
        (self.appdir / "usr/bin").mkdir(parents=True)
        (self.appdir / "usr/share/applications").mkdir(parents=True)
        shutil.copy(ROOT / "packaging/linux/AppRun", self.appdir / "AppRun")
        (self.appdir / "usr/share/applications/com.ichen27.mantelcad.desktop").write_text("[Desktop Entry]\nExec=mantelcad\n")
        for name in ("mantelcad", "mantelcad-cli"):
            p = self.appdir / "usr/bin" / name
            p.write_text(f"#!/bin/sh\necho {name} \"$@\"\n")
            p.chmod(0o755)
        # The AppImage file: running it runs AppRun, as the runtime does.
        self.image = self.tmp / "My App" / "MantelCAD.AppImage"
        self.image.parent.mkdir()
        self.image.write_text(f'#!/bin/sh\nexec "{self.appdir}/AppRun" "$@"\n')
        self.image.chmod(0o755)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.env = {"PATH": os.environ["PATH"], "HOME": str(self.home), "APPIMAGE": str(self.image)}
        self.wrapper = self.home / ".local/bin/mantelcad-cli"

    def run_apprun(self, *args, **extra):
        env = {**self.env, **extra}
        return subprocess.run([str(self.appdir / "AppRun"), *args], env=env, capture_output=True, text=True, check=True).stdout.strip()

    def test_wrapper_runs_the_bundled_cli(self):
        self.assertEqual(self.run_apprun("a"), "mantelcad a")
        self.assertTrue(self.wrapper.is_file())
        out = subprocess.run([str(self.wrapper), "mcp", "setup"], env=self.env, capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(out, "mantelcad-cli mcp setup")

    def test_wrapper_follows_a_moved_appimage(self):
        self.run_apprun()
        moved = self.tmp / "moved.AppImage"
        shutil.move(self.image, moved)
        self.env["APPIMAGE"] = str(moved)
        self.run_apprun()
        self.assertIn(str(moved), self.wrapper.read_text())

    def test_a_file_that_is_not_ours_is_left_alone(self):
        self.wrapper.parent.mkdir(parents=True)
        self.wrapper.write_text("#!/bin/sh\necho mine\n")
        self.run_apprun()
        self.assertEqual(self.wrapper.read_text(), "#!/bin/sh\necho mine\n")
        other = self.home / ".local/bin/mantelcad-cli"
        other.unlink()
        other.symlink_to("/bin/true")
        self.run_apprun()
        self.assertTrue(other.is_symlink())

    def test_upstream_entries_and_icons_are_preserved(self):
        apps = self.home / ".local/share/applications"
        apps.mkdir(parents=True)
        icons = self.home / ".local/share/icons/hicolor/256x256/apps"
        icons.mkdir(parents=True)
        for old in ("ai.storyteller.solidcraft", "ai.storyteller.solvecraft"):
            (apps / f"{old}.desktop").write_text(f'[Desktop Entry]\nExec="/old/MantelCAD.AppImage" %F\nIcon={old}\n')
            (icons / f"{old}.png").write_text("png")
        # An entry this script did not write (a package's, Exec on PATH) is left alone.
        (apps / "ai.storyteller.other.desktop").write_text("[Desktop Entry]\nExec=other\nIcon=ai.storyteller.other\n")
        self.run_apprun()
        self.assertTrue((apps / "com.ichen27.mantelcad.desktop").is_file())
        for old in ("ai.storyteller.solidcraft", "ai.storyteller.solvecraft"):
            self.assertTrue((apps / f"{old}.desktop").is_file())
            self.assertEqual((icons / f"{old}.png").read_text(), "png")
        self.assertTrue((apps / "ai.storyteller.other.desktop").is_file())

    def test_upstream_cli_commands_are_preserved(self):
        commands = self.home / ".local/bin"
        commands.mkdir(parents=True)
        for name in ("solidcraft-cli", "solvecraft-cli"):
            (commands / name).write_text("#!/bin/sh\\necho upstream\\n")
        self.run_apprun()
        for name in ("solidcraft-cli", "solvecraft-cli"):
            self.assertEqual((commands / name).read_text(), "#!/bin/sh\\necho upstream\\n")

    def test_opt_out_installs_nothing(self):
        self.run_apprun(MANTELCAD_NO_DESKTOP_INTEGRATION="1")
        self.assertFalse(self.wrapper.exists())

    def test_desktop_entry_icon_is_an_absolute_png_path(self):
        # Ship a hicolor mark so AppRun can copy it and point Icon= at the install (#10673).
        src = self.appdir / "usr/share/icons/hicolor/256x256/apps"
        src.mkdir(parents=True)
        (src / "com.ichen27.mantelcad.png").write_bytes(b"\x89PNG\r\n\x1a\n")
        (self.appdir / "usr/share/applications/com.ichen27.mantelcad.desktop").write_text(
            "[Desktop Entry]\nExec=mantelcad\nIcon=com.ichen27.mantelcad\n"
        )
        self.run_apprun()
        desk = (self.home / ".local/share/applications/com.ichen27.mantelcad.desktop").read_text()
        installed = self.home / ".local/share/icons/hicolor/256x256/apps/com.ichen27.mantelcad.png"
        self.assertTrue(installed.is_file())
        self.assertIn(f"Icon={installed}", desk)
        self.assertNotIn("Icon=com.ichen27.mantelcad\n", desk)


if __name__ == "__main__":
    unittest.main()
