#!/usr/bin/env python3
"""Build the root module locally and in the manual release workflow."""

import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_FILES = (
    "module.prop", "skip_mount", "customize.sh", "control.sh", "action.sh",
    "webroot/index.html", "webroot/style.css", "webroot/app.js",
    "webroot/i18n.js", "webroot/host-bridge.js", "webroot/config.json",
    "webroot/assets/sim-flat.png",
    "webroot/icons/forward.svg", "webroot/icons/home.svg",
    "webroot/icons/preferences.svg", "webroot/icons/reload.svg",
    "webroot/icons/selected.svg", "webroot/icons/sim.svg",
)
TEXT_SUFFIXES = {".sh", ".prop", ".html", ".js", ".css", ".json", ".svg"}
MAGISK_URL = "https://raw.githubusercontent.com/topjohnwu/Magisk/35fd230938444cdff4d581d7d026872fa247e3b5"
MAGISK_FILES = (
    ("scripts/module_installer.sh", "update-binary", "bcf4b1d9913f3af17755569c853e0b5a75b8005f6a18eb3f86dadcc0e968c29d"),
    ("LICENSE", "LICENSE-Magisk", "589ed823e9a84c56feb95ac58e7cf384626b9cbf4fda2a907bc36e103de1bad2"),
)


def release_version(value):
    if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", value):
        raise argparse.ArgumentTypeError("Use a version such as 1.0.0, without a v prefix.")
    return value


def main():
    props = dict(line.split("=", 1) for line in (ROOT / "module/module.prop").read_text(encoding="utf-8").splitlines() if "=" in line)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", type=release_version, default=props["version"])
    parser.add_argument("--version-code", type=int, default=int(props["versionCode"]))
    args = parser.parse_args()
    if not 1 <= args.version_code <= 2147483647:
        parser.error("version-code must be between 1 and 2147483647.")

    sdk_root = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if not sdk_root:
        parser.error("Set ANDROID_HOME or ANDROID_SDK_ROOT to the Android SDK directory.")
    sdk = Path(sdk_root).resolve()
    android_jar = sdk / "platforms/android-35/android.jar"
    d8 = sdk / "build-tools/35.0.0" / ("d8.bat" if os.name == "nt" else "d8")
    javac, jar = shutil.which("javac"), shutil.which("jar")
    if not javac or not jar:
        parser.error("Add a JDK's javac and jar to PATH.")
    for required in (android_jar, d8, ROOT / "LICENSE", *(ROOT / "module" / name for name in RUNTIME_FILES)):
        if not required.is_file():
            parser.error(f"Missing build input: {required}")

    (ROOT / "build").mkdir(exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="module-", dir=ROOT / "build"))
    classes, dex = work / "classes", work / "dex"
    classes.mkdir()
    dex.mkdir()
    class_jar, bridge = work / "classes.jar", work / "bridge.jar"
    sources = [ROOT / "src/com/yuhao7370/crosssim" / name for name in ("RootBridge.java", "ModuleBridge.java")]
    subprocess.run([javac, "-encoding", "UTF-8", "-source", "8", "-target", "8", "-bootclasspath", str(android_jar), "-d", str(classes), *map(str, sources)], check=True)
    subprocess.run([jar, "cf", str(class_jar), "-C", str(classes), "com"], check=True)
    subprocess.run([str(d8), "--lib", str(android_jar), "--min-api", "31", "--output", str(dex), str(class_jar)], check=True)
    subprocess.run([jar, "cfM", str(bridge), "-C", str(dex), "classes.dex"], check=True)
    with zipfile.ZipFile(bridge) as archive:
        if archive.namelist() != ["classes.dex"] or not archive.read("classes.dex").startswith(b"dex\n"):
            raise RuntimeError("bridge.jar must contain only classes.dex.")

    contents = {}
    for name in RUNTIME_FILES:
        source = ROOT / "module" / name
        data = source.read_bytes()
        if source.suffix in TEXT_SUFFIXES:
            data = data.decode("utf-8-sig").replace("\r\n", "\n").encode("utf-8")
        contents[name] = data

    # Set release metadata in the package, leaving the checkout untouched.
    metadata = contents["module.prop"].decode("utf-8")
    for key, value in (("version", args.version), ("versionCode", args.version_code)):
        metadata, count = re.subn(rf"(?m)^{key}=.*$", f"{key}={value}", metadata)
        if count != 1:
            raise RuntimeError(f"Expected one {key} field in module.prop.")
    contents["module.prop"] = metadata.encode("utf-8")
    html = contents["webroot/index.html"].decode("utf-8")
    for element in ("footer", "p"):
        previous = f"<{element}>{props['version']}</{element}>"
        if html.count(previous) != 1:
            raise RuntimeError(f"Expected one version label in {element}.")
        html = html.replace(previous, f"<{element}>{args.version}</{element}>")
    contents["webroot/index.html"] = html.encode("utf-8")
    contents["bridge.jar"] = bridge.read_bytes()
    contents["LICENSE"] = (ROOT / "LICENSE").read_bytes()

    meta = "META-INF/com/google/android"
    for upstream_path, name, expected_hash in MAGISK_FILES:
        with urllib.request.urlopen(f"{MAGISK_URL}/{upstream_path}", timeout=30) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != expected_hash:
            raise RuntimeError(f"Unexpected Magisk {name} hash.")
        contents[f"{meta}/{name}"] = data
    contents[f"{meta}/updater-script"] = b"#MAGISK\n"

    filename = f"Cross-SIM-{args.version}.zip"
    temporary_zip = work / filename
    with zipfile.ZipFile(temporary_zip, "w") as archive:
        for name, data in contents.items():
            entry = zipfile.ZipInfo(name)
            entry.create_system = 3
            entry.compress_type = zipfile.ZIP_DEFLATED
            mode = 0o100755 if name.endswith(".sh") or name.endswith("/update-binary") else 0o100644
            entry.external_attr = mode << 16
            archive.writestr(entry, data)
    with zipfile.ZipFile(temporary_zip) as archive:
        if set(archive.namelist()) != set(contents) or archive.testzip() is not None:
            raise RuntimeError("Module ZIP verification failed.")

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    output = dist / filename
    temporary_zip.replace(output)
    shutil.copyfile(bridge, dist / "bridge.jar")
    checksum = hashlib.sha256(output.read_bytes()).hexdigest()
    (dist / f"{filename}.sha256").write_text(f"{checksum}  {filename}\n", encoding="utf-8", newline="\n")
    print(f"Built {output.name} (versionCode {args.version_code}, {len(contents)} files)")
    print(f"SHA256: {checksum}")


if __name__ == "__main__":
    main()
