import json
from typing import List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from src.audio_engine import AudioEngine
from src.models import SimulateRequest, SpeechInput, ResolveRequest, SaveRoutingRequest

app = FastAPI(title="AI Live Monitor Assistant", version="1.0.0")
engine = AudioEngine()

# Statyczne pliki (HTML/CSS/JS)
app.mount("/static", StaticFiles(directory="static"), name="static")

active_connections: List[WebSocket] = []

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
                "messages": [msg.model_dump() for msg in engine.messages[:30]]
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
