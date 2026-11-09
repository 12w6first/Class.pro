import os
import yaml
import asyncio
from typing import Dict, List, Optional, Callable, Any
from src.models import ChannelInfo, StageMessage, IntentResult
from src.intent_analyzer import IntentAnalyzer

import os
import yaml
import asyncio
import subprocess
import re
from typing import Dict, List, Optional, Callable, Any
from src.models import ChannelInfo, StageMessage, IntentResult, AudioDeviceItem, ChannelRoutingUpdate
from src.intent_analyzer import IntentAnalyzer

class AudioEngine:
    def __init__(self, config_path: str = "config.yaml"):
        self.config_path = config_path
        self.default_device: str = "Mikrofon (MacBook Pro)"
        self.channels: Dict[int, ChannelInfo] = {}
        self.messages: List[StageMessage] = []
        self.analyzer = IntentAnalyzer()
        self.subscribers: List[Callable[[Dict[str, Any]], Any]] = []
        self.load_config()

    def load_config(self):
        if not os.path.exists(self.config_path):
            return

        with open(self.config_path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)

        stage_cfg = cfg.get("stage", {})
        self.default_device = stage_cfg.get("default_device", "Mikrofon (MacBook Pro)")
        stage_channels = stage_cfg.get("channels", [])

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
        """Zapisuje bieżącą krosownicę i kanały do config.yaml"""
        if not os.path.exists(self.config_path):
            return

        with open(self.config_path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}

        if "stage" not in cfg:
            cfg["stage"] = {}

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

        with open(self.config_path, "w", encoding="utf-8") as f:
            yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)

    def detect_audio_devices(self) -> List[AudioDeviceItem]:
        """
        Wykrywa urządzenia audio w systemie macOS (CoreAudio)
        oraz dodaje standardowe interfejsy mikserów koncertowych.
        """
        devices: List[AudioDeviceItem] = []

        try:
            res = subprocess.run(
                ["system_profiler", "SPAudioDataType"],
                capture_output=True,
                text=True,
                timeout=3
            )
            output = res.stdout

            # Parse device sections
            # Każde urządzenie ma wcięcie i nazwę z dwukropkiem, np. "Mikrofon (MacBook Pro):"
            matches = re.findall(r"^\s{8}([A-Za-z0-9_(). -]+):\s*$", output, re.MULTILINE)
            for name in matches:
                name_clean = name.strip()
                if "output" in name_clean.lower() and "input" not in name_clean.lower():
                    continue

                # Sprawdź czy to urządzenie wejściowe
                # Znajdź blok urządzenia
                block_match = re.search(re.escape(name) + r":(.*?)(?=\n\s{8}[A-Za-z0-9]|\Z)", output, re.DOTALL)
                if block_match:
                    block_text = block_match.group(1)
                    in_channels_match = re.search(r"Input Channels:\s*(\d+)", block_text)
                    is_default = "Default Input Device: Yes" in block_text

                    if in_channels_match:
                        channels_count = int(in_channels_match.group(1))
                        devices.append(AudioDeviceItem(
                            name=name_clean,
                            channels=channels_count,
                            is_default=is_default
                        ))
        except Exception as e:
            print(f"[Device Detection Warning] {e}")

        # Jeśli nie wykryto nic lub do testów scenicznych, dodaj popularne interfejsy cyfrowych konsolet
        known_virtual = [
            AudioDeviceItem(name="USB Audio CODEC (Behringer X32 / Midas M32 - 32ch)", channels=32, is_default=False),
            AudioDeviceItem(name="Dante Virtual Soundcard (64ch)", channels=64, is_default=False),
            AudioDeviceItem(name="Allen & Heath USB Audio (SQ / Qu - 32ch)", channels=32, is_default=False),
        ]

        existing_names = {d.name for d in devices}
        for kv in known_virtual:
            if kv.name not in existing_names:
                devices.append(kv)

        if not devices:
            devices.append(AudioDeviceItem(name="Mikrofon (MacBook Pro)", channels=1, is_default=True))

        return devices

    async def update_routing(self, default_device: str, channels_data: List[ChannelRoutingUpdate]):
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
