import json
import socket
from typing import List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from src.audio_engine import AudioEngine
from src.models import (
    SimulateRequest,
    SpeechInput,
    ResolveRequest,
    SaveRoutingRequest,
    StartListenRequest,
    VadUpdateRequest,
    ChannelMuteRequest,
    ModelChangeRequest,
    SaveSceneRequest,
    LoadSceneRequest,
)

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

app = FastAPI(title="AI Live Monitor Assistant", version="1.0.0")
engine = AudioEngine()

@app.middleware("http")
async def disable_static_cache(request, call_next):
    response = await call_next(request)
    if request.url.path in ("/", "/tablet") or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Statyczne pliki (HTML/CSS/JS)
app.mount("/static", StaticFiles(directory="static"), name="static")

active_connections: List[WebSocket] = []
app.state.port = 8000

async def close_all_websockets():
    """Rozłącza wszystkich klientów (pulpit + tablety) przy zamykaniu aplikacji."""
    for ws in list(active_connections):
        try:
            await ws.close(code=1001, reason="Aplikacja AI Live Monitor została zamknięta")
        except Exception:
            pass
    active_connections.clear()

@app.on_event("shutdown")
async def on_server_shutdown():
    engine.stt.force_shutdown()
    await close_all_websockets()

async def ws_broadcast(payload: dict):
    data_str = json.dumps(payload, ensure_ascii=False)
    for ws in list(active_connections):
        try:
            await ws.send_text(data_str)
        except Exception:
            if ws in active_connections:
                active_connections.remove(ws)

engine.subscribe(ws_broadcast)

@app.get("/")
async def get_index():
    return FileResponse("static/index.html")

@app.get("/tablet")
async def get_tablet():
    return FileResponse("static/tablet.html")

@app.get("/api/info")
async def get_info():
    ip = get_local_ip()
    port = getattr(app.state, "port", 8000)
    return {
        "local_ip": ip,
        "port": port,
        "tablet_url": f"http://{ip}:{port}/tablet"
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        # Prześlij obecny stan od razu po podłączeniu
        initial_state = {
            "type": "init",
            "data": {
                "channels": [ch.model_dump() for ch in engine.channels.values()],
                "messages": [msg.model_dump() for msg in engine.messages[:30]],
                "listen_status": engine.get_listen_status(),
            }
        }
        await websocket.send_text(json.dumps(initial_state, ensure_ascii=False))

        while True:
            # Utrzymuj połączenie i nasłuchuj ewentualnych komend z klienta
            raw_data = await websocket.receive_text()
            try:
                data = json.loads(raw_data)
                cmd = data.get("action")
                if cmd == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except Exception:
                pass
    except WebSocketDisconnect:
        if websocket in active_connections:
            active_connections.remove(websocket)

@app.get("/api/audio-devices")
async def get_audio_devices():
    return [d.model_dump() for d in engine.detect_audio_devices()]

@app.get("/api/listen/status")
async def get_listen_status():
    return engine.get_listen_status()

@app.post("/api/listen/start")
async def start_listening(req: StartListenRequest = StartListenRequest()):
    return await engine.start_listening(
        device_name=req.device_name,
        vad_threshold_db=req.vad_threshold_db,
    )

@app.post("/api/listen/stop")
async def stop_listening():
    return await engine.stop_listening()

@app.post("/api/listen/vad")
async def update_vad(req: VadUpdateRequest):
    return engine.set_vad_threshold(req.threshold_db)

@app.post("/api/listen/mute")
async def mute_channel(req: ChannelMuteRequest):
    return engine.set_channel_muted(req.channel_id, req.muted)

@app.post("/api/listen/model")
async def change_whisper_model(req: ModelChangeRequest):
    try:
        status = engine.set_whisper_model(req.model_name)
        await engine.broadcast("listen_status", status)
        return status
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/scenes")
async def get_scenes():
    return engine.list_scenes()

@app.post("/api/scenes/save")
async def save_scene(req: SaveSceneRequest):
    try:
        scenes = engine.save_scene(req.name, req.audio_device, req.channels)
        return {"status": "ok", "scenes": scenes}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/scenes/load")
async def load_scene(req: LoadSceneRequest):
    try:
        result = await engine.load_scene(req.name)
        return {"status": "ok", **result}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.delete("/api/scenes/{scene_name}")
async def delete_scene(scene_name: str):
    scenes = engine.delete_scene(scene_name)
    return {"status": "ok", "scenes": scenes}

@app.get("/api/config/routing")
async def get_routing():
    return {
        "default_device": engine.default_device,
        "channels": [ch.model_dump() for ch in engine.channels.values()]
    }

@app.post("/api/config/routing")
async def save_routing(req: SaveRoutingRequest):
    await engine.update_routing(req.audio_device, req.channels)
    return {"status": "ok", "message": "Routing zaktualizowany"}

@app.get("/api/channels")
async def get_channels():
    return [ch.model_dump() for ch in engine.channels.values()]

@app.get("/api/messages")
async def get_messages():
    return [msg.model_dump() for msg in engine.messages]

@app.post("/api/simulate")
async def simulate_input(req: SimulateRequest):
    msg = await engine.process_utterance(req.channel_id, req.text)
    return {"status": "ok", "message": msg.model_dump()}

@app.post("/api/speech")
async def speech_input(req: SpeechInput):
    msg = await engine.process_utterance(req.channel_id, req.text)
    return {"status": "ok", "message": msg.model_dump()}

@app.post("/api/resolve")
async def resolve_message(req: ResolveRequest):
    success = await engine.resolve_message(req.message_id)
    if not success:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"status": "ok", "message_id": req.message_id}

@app.post("/api/clear")
async def clear_all():
    await engine.clear_all()
    return {"status": "ok"}

@app.get("/api/presets")
async def get_presets():
    """
    Gotowe realistyczne scenariusze wypowiedzi scenicznych do testów i demonstracji.
    """
    return [
        {
            "channel_id": 3,
            "title": "🥁 Perkusista ➔ Więcej basu",
            "text": "Ej, pogłośnij mi ten bas w odsłuchu, bo nic nie słyszę z tyłu!"
        },
        {
            "channel_id": 1,
            "title": "🎤 Wokal ➔ Korekcja góry (High-Cut)",
            "text": "Piecze w uszach, podetnij mi trochę górę na wokalu i daj odrobinę pogłosu."
        },
        {
            "channel_id": 4,
            "title": "🎸 Basista ➔ Za głośna stopa",
            "text": "Za głośno mam stopę w monitorze, zdejmij ze 2 decybele."
        },
        {
            "channel_id": 6,
            "title": "🎹 Klawisze ➔ Klik / Metronom",
            "text": "Nie słyszę metronomu, podbij klik w dousznych!"
        },
        {
            "channel_id": 2,
            "title": "⚠️ Chórek ➔ Sprzężenie (PILNE)",
            "text": "Piszczy i sprzęga w monitorze odsłuchowym, szybko ścisz!"
        }
    ]
