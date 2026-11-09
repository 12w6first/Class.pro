import socket
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def main():
    port = 8000
    host = "0.0.0.0"
    local_ip = get_local_ip()

    print("\n" + "=" * 65)
    print(" 🎛️  AI LIVE MONITOR ASSISTANT - AKUSTYCZNY ASYSTENT SCENICZNY")
    print("=" * 65)
    print(f" ▶ Pulpit realizatora (Lokalnie na MacBooku):  http://localhost:{port}")
    print(f" ▶ Podgląd sceniczny (Tablet / Telefon / LAN): http://{local_ip}:{port}")
    print("=" * 65)
    print(" Naciśnij Ctrl+C, aby zatrzymać serwer.\n")

    uvicorn.run("src.server:app", host=host, port=port, reload=True)

if __name__ == "__main__":
    main()
