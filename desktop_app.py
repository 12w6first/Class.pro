from __future__ import annotations

import atexit
import os
import signal
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path

# Upewnij się, że katalog główny projektu jest w sys.path i CWD
PROJECT_ROOT = Path(__file__).resolve().parent
os.chdir(PROJECT_ROOT)
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import uvicorn
import webview
from src.server import app, engine, get_local_ip


def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.25)
        return s.connect_ex(("127.0.0.1", port)) == 0


def pick_free_port(preferred: int = 8000) -> int:
    """
    Zawsze wybiera wolny port dla wbudowanego serwera tej instancji aplikacji
    (preferuje 8000, żeby adres /tablet był stały).
    Dzięki temu zamknięcie aplikacji ZAWSZE wyłącza jej serwer, audio, Whispera i /tablet.
    """
    if not is_port_in_use(preferred):
        return preferred
    for candidate in range(preferred + 1, preferred + 50):
        if not is_port_in_use(candidate):
            return candidate
    return preferred


def wait_for_server(port: int, timeout: float = 15.0) -> bool:
    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{port}/api/info"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=0.5) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.12)
    return False


class EmbeddedServer:
    """
    Wbudowany serwer FastAPI + WebSocket dla okna desktopowego ORAZ zdalnego tabletu (/tablet).
    Nasłuchuje na 0.0.0.0:<port>, więc od razu po uruchomieniu aplikacji tablet/telefon w tej samej
    sieci Wi-Fi łączy się pod http://<IP-MacBooka>:<port>/tablet.
    Przy zamknięciu aplikacji natychmiast zamyka CoreAudio, Whispera, WebSockety i zwalnia port.
    """

    def __init__(self, host: str = "0.0.0.0", port: int = 8000):
        self.host = host
        self.port = port
        self._stopped = False
        self._stop_lock = threading.Lock()
        app.state.port = port

        self.config = uvicorn.Config(
            app,
            host=host,
            port=port,
            log_level="info",
            access_log=False,
            timeout_graceful_shutdown=1,
        )
        self.server = uvicorn.Server(self.config)
        # Uvicorn nie powinien nadpisywać handlerów sygnałów w wątku pobocznym
        self.server.install_signal_handlers = lambda: None
        self.thread: threading.Thread | None = None

    def start(self):
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()

    def stop(self):
        with self._stop_lock:
            if self._stopped:
                return
            self._stopped = True

        print("[DesktopApp] Zamykanie aplikacji — wyłączam audio, Whispera i serwer tabletu...")

        # 1. Natychmiast zamknij strumień CoreAudio i wątek Whisper
        try:
            engine.stt.force_shutdown()
        except Exception as e:
            print(f"[DesktopApp] Błąd zamykania STT: {e}")

        # 2. Zamknij serwer Uvicorn (wywoła też on_server_shutdown -> zamknie WebSockety tabletu)
        self.server.should_exit = True
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)

        print("[DesktopApp] Wszystkie usługi zatrzymane.")


def main():
    port = pick_free_port(8000)
    local_ip = get_local_ip()

    embedded = EmbeddedServer(host="0.0.0.0", port=port)
    embedded.start()

    if not wait_for_server(port, timeout=15.0):
        print("[DesktopApp] Błąd: serwer nie wystartował w czasie 15s.")
        embedded.stop()
        os._exit(1)

    print(f"[DesktopApp] Pulpit FOH:    http://127.0.0.1:{port}")
    print(f"[DesktopApp] Serwer Tablet: http://{local_ip}:{port}/tablet")

    # Gwarancja pełnego sprzątania przy każdym sposobie zamknięcia (X, Cmd+Q, SIGTERM, SIGINT)
    def shutdown_and_exit(*_args):
        embedded.stop()
        os._exit(0)

    atexit.register(embedded.stop)
    signal.signal(signal.SIGTERM, shutdown_and_exit)
    signal.signal(signal.SIGINT, shutdown_and_exit)

    window = webview.create_window(
        title=f"AI Live Monitor — FOH Stage Console  •  Tablet: http://{local_ip}:{port}/tablet",
        url=f"http://127.0.0.1:{port}",
        width=1440,
        height=900,
        min_size=(1024, 680),
        resizable=True,
        background_color="#040508",
        text_select=True,
    )

    window.events.closed += lambda: embedded.stop()

    try:
        webview.start(debug=False)
    finally:
        # Po zamknięciu okna wymuś pełne wyjście procesu — zero wiszących wątków w tle!
        embedded.stop()
        os._exit(0)


if __name__ == "__main__":
    main()
