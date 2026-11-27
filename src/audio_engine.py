import os
import json
import yaml
import asyncio
import subprocess
from typing import Dict, List, Optional, Callable, Any
from src.models import ChannelInfo, StageMessage, IntentResult, AudioDeviceItem, ChannelRoutingUpdate
from src.intent_analyzer import IntentAnalyzer
from src.multichannel_stt import MultiChannelSTTEngine

class AudioEngine:
    def __init__(self, config_path: str = "config.yaml"):
        self.config_path = config_path
        self.default_device: str = "Mikrofon (MacBook Pro)"
        self.whisper_model: str = "medium"
        self.whisper_language: str = "pl"
        self.vad_threshold_db: float = -38.0
        self.channels: Dict[int, ChannelInfo] = {}
        self.messages: List[StageMessage] = []
        self.analyzer = IntentAnalyzer()
        self.subscribers: List[Callable[[Dict[str, Any]], Any]] = []
        self.load_config()
        self.stt = MultiChannelSTTEngine(
            model_name=self.whisper_model,
            language=self.whisper_language,
            vad_threshold_db=self.vad_threshold_db,
            on_transcription=self.process_utterance,
            on_event=self.broadcast,
        )
        self.stt.sync_channels(self.channels)

    def load_config(self):
        if not os.path.exists(self.config_path):
            return

        with open(self.config_path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}

        stage_cfg = cfg.get("stage", {})
        self.default_device = stage_cfg.get("default_device", "Mikrofon (MacBook Pro)")
        stage_channels = stage_cfg.get("channels", [])

        engine_cfg = cfg.get("engine", {})
        self.whisper_model = engine_cfg.get("whisper_model", "medium")
        self.whisper_language = engine_cfg.get("whisper_language", "pl")
        self.vad_threshold_db = float(engine_cfg.get("vad_threshold_db", -38.0))

        self.channels.clear()
        for ch in stage_channels:
            self.channels[ch["id"]] = ChannelInfo(
                id=ch["id"],
                name=ch["name"],
                role=ch["role"],
                hardware_channel=ch.get("hardware_channel", ch["id"]),
                audio_device=ch.get("audio_device", self.default_device),
                color=ch.get("color", "#3b82f6"),
                active=ch.get("active", True),
                active_requests_count=0
            )

    def save_config(self):
        """Zapisuje bieżącą krosownicę, kanały oraz ustawienia silnika (GATE, Whisper) do config.yaml"""
        if not os.path.exists(self.config_path):
            cfg = {}
        else:
            with open(self.config_path, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}

        if "stage" not in cfg:
            cfg["stage"] = {}
        if "engine" not in cfg:
            cfg["engine"] = {}

        cfg["stage"]["default_device"] = self.default_device
        cfg["stage"]["channels"] = [
            {
                "id": ch.id,
                "name": ch.name,
                "role": ch.role,
                "hardware_channel": ch.hardware_channel,
                "color": ch.color,
                "active": ch.active
            }
            for ch in self.channels.values()
        ]
        cfg["engine"]["whisper_model"] = self.whisper_model
        cfg["engine"]["whisper_language"] = self.whisper_language
        cfg["engine"]["vad_threshold_db"] = round(float(self.vad_threshold_db), 1)

        with open(self.config_path, "w", encoding="utf-8") as f:
            yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)

    # ==================== Zarządzanie Scenami / Presetami Krosownicy ====================

    def _read_raw_config(self) -> Dict[str, Any]:
        if not os.path.exists(self.config_path):
            return {}
        with open(self.config_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def _write_raw_config(self, cfg: Dict[str, Any]):
        with open(self.config_path, "w", encoding="utf-8") as f:
            yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)

    def list_scenes(self) -> List[Dict[str, Any]]:
        cfg = self._read_raw_config()
        scenes_map = cfg.get("scenes", {}) or {}
        result = []
        for name, data in scenes_map.items():
            result.append({
                "name": name,
                "audio_device": data.get("audio_device", ""),
                "channels_count": len(data.get("channels", [])),
                "channels": data.get("channels", []),
            })
        return result

    def save_scene(self, name: str, audio_device: str, channels_data: List[ChannelRoutingUpdate]) -> List[Dict[str, Any]]:
        clean_name = name.strip()
        if not clean_name:
            raise ValueError("Nazwa sceny nie może być pusta.")
        cfg = self._read_raw_config()
        if "scenes" not in cfg or not isinstance(cfg["scenes"], dict):
            cfg["scenes"] = {}
        cfg["scenes"][clean_name] = {
            "audio_device": audio_device,
            "channels": [
                {
                    "id": ch.id,
                    "name": ch.name,
                    "role": ch.role,
                    "hardware_channel": ch.hardware_channel,
                    "color": ch.color,
                    "active": ch.active,
                }
                for ch in channels_data
            ],
        }
        self._write_raw_config(cfg)
        return self.list_scenes()

    async def load_scene(self, name: str) -> Dict[str, Any]:
        cfg = self._read_raw_config()
        scenes_map = cfg.get("scenes", {}) or {}
        scene = scenes_map.get(name)
        if not scene:
            raise KeyError(f"Scena '{name}' nie istnieje.")
        ch_updates = [
            ChannelRoutingUpdate(
                id=int(ch["id"]),
                name=str(ch["name"]),
                role=str(ch.get("role", "Wykonawca")),
                hardware_channel=int(ch.get("hardware_channel", ch["id"])),
                color=str(ch.get("color", "#3b82f6")),
                active=bool(ch.get("active", True)),
            )
            for ch in scene.get("channels", [])
        ]
        device = str(scene.get("audio_device") or self.default_device)
        await self.update_routing(device, ch_updates)
        return {
            "name": name,
            "default_device": self.default_device,
            "channels": [c.model_dump() for c in self.channels.values()],
        }

    def delete_scene(self, name: str) -> List[Dict[str, Any]]:
        cfg = self._read_raw_config()
        scenes_map = cfg.get("scenes", {}) or {}
        if name in scenes_map:
            del scenes_map[name]
            cfg["scenes"] = scenes_map
            self._write_raw_config(cfg)
        return self.list_scenes()

    def detect_audio_devices(self) -> List[AudioDeviceItem]:
        """
        Wykrywa WYŁĄCZNIE realnie podłączone urządzenia wejściowe audio:
        1) PortAudio/CoreAudio przez sounddevice (wspiera hot-plug USB i dokładną liczbę kanałów)
        2) Fallback na `system_profiler SPAudioDataType -json`.
        """
        # 1. PortAudio (sounddevice)
        pa_devices = self.stt.query_connected_input_devices() if hasattr(self, "stt") else []
        if pa_devices:
            return [
                AudioDeviceItem(
                    name=d["name"],
                    channels=int(d["channels"]),
                    is_default=bool(d["is_default"]),
                )
                for d in pa_devices
            ]

        # 2. Fallback: system_profiler JSON
        devices: List[AudioDeviceItem] = []
        try:
            res = subprocess.run(
                ["system_profiler", "SPAudioDataType", "-json"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if res.returncode == 0 and res.stdout.strip():
                data = json.loads(res.stdout)
                for section in data.get("SPAudioDataType", []):
                    for item in section.get("_items", []):
                        in_channels = item.get("coreaudio_device_input")
                        if not in_channels or int(in_channels) <= 0:
                            continue

                        name_clean = str(item.get("_name", "")).strip()
                        if not name_clean:
                            continue

                        is_default = item.get("coreaudio_default_audio_input_device") == "spaudio_yes"
                        devices.append(AudioDeviceItem(
                            name=name_clean,
                            channels=int(in_channels),
                            is_default=is_default
                        ))
        except Exception as e:
            print(f"[Device Detection Warning] {e}")

        devices.sort(key=lambda d: (not d.is_default, d.name.lower()))
        return devices

    async def start_listening(self, device_name: Optional[str] = None, vad_threshold_db: Optional[float] = None) -> Dict[str, Any]:
        target_device = device_name or self.default_device
        if device_name:
            self.default_device = device_name
        return await self.stt.start(
            channels=self.channels,
            device_name=target_device,
            vad_threshold_db=vad_threshold_db,
        )

    async def stop_listening(self) -> Dict[str, Any]:
        return await self.stt.stop()

    def get_listen_status(self) -> Dict[str, Any]:
        return self.stt.get_status()

    def set_vad_threshold(self, threshold_db: float) -> Dict[str, Any]:
        self.vad_threshold_db = float(threshold_db)
        self.stt.set_vad_threshold(threshold_db)
        self.save_config()
        return self.stt.get_status()

    def set_whisper_model(self, model_name: str) -> Dict[str, Any]:
        self.stt.set_model_name(model_name)
        self.whisper_model = self.stt.model_name
        self.save_config()
        return self.stt.get_status()

    def set_channel_muted(self, channel_id: int, muted: bool) -> Dict[str, Any]:
        self.stt.set_channel_muted(channel_id, muted)
        return self.stt.get_status()

    async def update_routing(self, default_device: str, channels_data: List[ChannelRoutingUpdate]):
        prev_device = self.default_device
        self.default_device = default_device

        new_channels: Dict[int, ChannelInfo] = {}
        for item in channels_data:
            existing = self.channels.get(item.id)
            new_channels[item.id] = ChannelInfo(
                id=item.id,
                name=item.name,
                role=item.role,
                hardware_channel=item.hardware_channel,
                audio_device=default_device,
                color=item.color,
                active=item.active,
                active_requests_count=existing.active_requests_count if existing else 0,
                last_message=existing.last_message if existing else None,
                last_timestamp=existing.last_timestamp if existing else None
            )

        self.channels = new_channels
        self.save_config()
        self.stt.sync_channels(self.channels)

        # Jeśli trwa nasłuch i zmieniono urządzenie wejściowe, przełącz strumień automatycznie
        if self.stt.get_status().get("listening") and prev_device != default_device:
            await self.stt.start(channels=self.channels, device_name=default_device)
        else:
            await self.broadcast("listen_status", self.stt.get_status())

        # Wyślij powiadomienie do podłączonych klientów
        await self.broadcast("channel_update", [ch.model_dump() for ch in self.channels.values()])

    def subscribe(self, callback: Callable[[Dict[str, Any]], Any]):
        self.subscribers.append(callback)

    def unsubscribe(self, callback: Callable[[Dict[str, Any]], Any]):
        if callback in self.subscribers:
            self.subscribers.remove(callback)

    async def broadcast(self, event_type: str, data: Any):
        payload = {"type": event_type, "data": data}
        for sub in list(self.subscribers):
            try:
                res = sub(payload)
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                print(f"[Broadcast Error] {e}")

    def get_channel(self, channel_id: int) -> Optional[ChannelInfo]:
        return self.channels.get(channel_id)

    async def process_utterance(self, channel_id: int, text: str) -> StageMessage:
        """
        Główna metoda przetwarzania wypowiedzi z danego kanału (od miksera lub z mikrofonu).
        """
        channel = self.channels.get(channel_id)
        musician_name = channel.name if channel else f"Kanał #{channel_id}"

        # Analiza intencji przez AI
        intent: IntentResult = self.analyzer.analyze(musician_name, text)

        msg = StageMessage(
            channel_id=channel_id,
            musician=musician_name,
            raw_text=text,
            element=intent.element,
            action_display=intent.action_display,
            action_type=intent.action_type,
            priority=intent.priority,
            summary=intent.summary
        )

        self.messages.insert(0, msg)

        # Aktualizacja stanu kanału
        if channel:
            channel.active_requests_count += 1
            channel.last_message = intent.summary
            channel.last_timestamp = msg.timestamp

        # Wyślij powiadomienie do podłączonych paneli realizatora w czasie rzeczywistym
        await self.broadcast("new_message", msg.model_dump())
        await self.broadcast("channel_update", [ch.model_dump() for ch in self.channels.values()])

        return msg

    async def resolve_message(self, message_id: str) -> bool:
        for msg in self.messages:
            if msg.id == message_id:
                if not msg.resolved:
                    msg.resolved = True
                    # Zmniejsz licznik aktywnych próśb kanału
                    ch = self.channels.get(msg.channel_id)
                    if ch and ch.active_requests_count > 0:
                        ch.active_requests_count -= 1
                    await self.broadcast("resolve_message", {"id": message_id})
                    await self.broadcast("channel_update", [c.model_dump() for c in self.channels.values()])
                return True
        return False

    async def clear_all(self):
        self.messages.clear()
        for ch in self.channels.values():
            ch.active_requests_count = 0
            ch.last_message = None
            ch.last_timestamp = None
        await self.broadcast("clear_all", {})
        await self.broadcast("channel_update", [c.model_dump() for c in self.channels.values()])
