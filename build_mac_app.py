#!/usr/bin/env python3
"""
Buduje natywną aplikację macOS: `AI Live Monitor.app`
- generuje wektorowo-ostry plik ikony AppIcon.icns (OLED Stage FOH waveform)
- tworzy strukturę .app z uprawnieniami mikrofonu i sieci lokalnej w Info.plist
- podpina launcher pod .venv/bin/python desktop_app.py
"""
import os
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

PROJECT_ROOT = Path(__file__).resolve().parent
APP_NAME = "AI Live Monitor"
APP_BUNDLE = PROJECT_ROOT / f"{APP_NAME}.app"


def generate_app_icon_icns(dest_icns: Path):
    size = 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # 1. Zaokrąglone tło squircle (ciemny OLED obsidian)
    mask = Image.new("L", (size, size), 0)
    mdraw = ImageDraw.Draw(mask)
    pad = 84
    mdraw.rounded_rectangle([pad, pad, size - pad, size - pad], radius=210, fill=255)

    bg = Image.new("RGBA", (size, size), (7, 10, 16, 255))
    bg_draw = ImageDraw.Draw(bg)

    # Subtelny pionowy gradient od granatu do czystej czerni OLED
    for y in range(pad, size - pad):
        t = (y - pad) / float(size - 2 * pad)
        r = int(14 * (1 - t) + 4 * t)
        g = int(19 * (1 - t) + 5 * t)
        b = int(30 * (1 - t) + 8 * t)
        bg_draw.line([(pad, y), (size - pad, y)], fill=(r, g, b, 255))

    # Cienka jasna krawędź ramki
    bg_draw.rounded_rectangle(
        [pad + 2, pad + 2, size - pad - 2, size - pad - 2],
        radius=208,
        outline=(0, 212, 255, 70),
        width=6,
    )

    img.paste(bg, (0, 0), mask)

    # 2. Warstwa poświaty (glow) pod falami dźwiękowymi
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)

    bars = [
        # (x_center, height, color)
        (264, 210, (0, 212, 255, 255)),
        (360, 390, (0, 212, 255, 255)),
        (456, 560, (0, 230, 118, 255)),
        (552, 460, (0, 212, 255, 255)),
        (648, 310, (255, 171, 0, 255)),
        (744, 190, (255, 23, 68, 255)),
    ]
    bar_w = 56
    cy = size // 2 + 12

    for cx, h, col in bars:
        x0, x1 = cx - bar_w // 2, cx + bar_w // 2
        y0, y1 = cy - h // 2, cy + h // 2
        gdraw.rounded_rectangle([x0, y0, x1, y1], radius=28, fill=col)

    glow_blurred = glow.filter(ImageFilter.GaussianBlur(radius=28))
    img = Image.alpha_composite(img, glow_blurred)
    img = Image.alpha_composite(img, glow)

    # 3. Mała świecąca dioda LIVE w prawym górnym rogu
    led_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ldraw = ImageDraw.Draw(led_layer)
    lx, ly, lr = size - pad - 115, pad + 110, 24
    ldraw.ellipse([lx - lr - 14, ly - lr - 14, lx + lr + 14, ly + lr + 14], fill=(0, 230, 118, 120))
    led_layer = led_layer.filter(ImageFilter.GaussianBlur(radius=12))
    img = Image.alpha_composite(img, led_layer)

    top_draw = ImageDraw.Draw(img)
    top_draw.ellipse([lx - lr, ly - lr, lx + lr, ly + lr], fill=(0, 230, 118, 255))

    # Bezpośredni zapis wielorozdzielczego pliku Apple ICNS przez Pillow
    img.save(
        dest_icns,
        format="ICNS",
        sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)],
    )


def build_bundle():
    if APP_BUNDLE.exists():
        shutil.rmtree(APP_BUNDLE)

    contents = APP_BUNDLE / "Contents"
    macos_dir = contents / "MacOS"
    res_dir = contents / "Resources"
    macos_dir.mkdir(parents=True)
    res_dir.mkdir(parents=True)

    # 1. Ikona .icns
    icns_path = res_dir / "AppIcon.icns"
    generate_app_icon_icns(icns_path)

    # 2. Info.plist z opisem uprawnień mikrofonu i sieci lokalnej
    plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>pl</string>
    <key>CFBundleDisplayName</key>
    <string>{APP_NAME}</string>
    <key>CFBundleExecutable</key>
    <string>{APP_NAME}</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>pro.class.ailivemonitor</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>{APP_NAME}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSMicrophoneUsageDescription</key>
    <string>AI Live Monitor potrzebuje dostępu do mikrofonu i wejść miksera audio (CoreAudio), aby w czasie rzeczywistym rozpoznawać prośby muzyków ze sceny.</string>
    <key>NSDocumentsFolderUsageDescription</key>
    <string>AI Live Monitor odczytuje konfigurację sceny i pliki projektu z folderu Dokumenty.</string>
    <key>NSLocalNetworkUsageDescription</key>
    <string>AI Live Monitor udostępnia zdalny podgląd sceniczny (/tablet) urządzeniom w sieci lokalnej Wi-Fi.</string>
</dict>
</plist>
"""
    (contents / "Info.plist").write_text(plist_content, encoding="utf-8")

    # 3. Natywny binarny launcher Mach-O (kompilowany przez clang) — wymagany przez macOS TCC
    # do prawidłowego wyświetlania systemowych zgód na Mikrofon i Dokumenty!
    venv_python = str(PROJECT_ROOT / ".venv" / "bin" / "python")
    desktop_script = str(PROJECT_ROOT / "desktop_app.py")
    project_root_str = str(PROJECT_ROOT)
    launcher_path = macos_dir / APP_NAME

    c_source = f"""
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

int main(int argc, char *argv[]) {{
    const char *home = getenv("HOME");
    if (home) {{
        char log_dir[1024];
        char log_path[1024];
        snprintf(log_dir, sizeof(log_dir), "%s/Library/Logs", home);
        mkdir(log_dir, 0755);
        snprintf(log_path, sizeof(log_path), "%s/Library/Logs/AILiveMonitor.log", home);
        int fd = open(log_path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
        if (fd >= 0) {{
            dup2(fd, STDOUT_FILENO);
            dup2(fd, STDERR_FILENO);
            close(fd);
        }}
    }}

    setenv("PATH", "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", 1);
    setenv("PYTHONUNBUFFERED", "1", 1);
    chdir("{project_root_str}");

    char *args[] = {{
        "{venv_python}",
        "{desktop_script}",
        NULL
    }};
    execv("{venv_python}", args);
    perror("execv failed");
    return 1;
}}
"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".c", delete=False) as tf:
        tf.write(c_source)
        c_file = tf.name

    try:
        subprocess.run(
            ["clang", "-O2", c_file, "-o", str(launcher_path)],
            check=True,
        )
    finally:
        os.unlink(c_file)

    # 4. Podpisanie ad-hoc (wymagane przez macOS Apple Silicon dla aplikacji .app)
    subprocess.run(
        ["codesign", "--force", "--deep", "--sign", "-", str(APP_BUNDLE)],
        check=True,
    )

    print(f"Zbudowano i podpisano aplikację macOS: {APP_BUNDLE}")


if __name__ == "__main__":
    build_bundle()
