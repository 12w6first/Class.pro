from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
import uuid

class ChannelInfo(BaseModel):
    id: int
    name: str
    role: str
    hardware_channel: int = 1  # Fizyczne wejście na mikserze (Input 1..32)
    audio_device: str = "Domyślny interfejs / mikser"
    color: str = "#3b82f6"
    active: bool = True
    active_requests_count: int = 0
    last_message: Optional[str] = None
    last_timestamp: Optional[str] = None

class AudioDeviceItem(BaseModel):
    name: str
    channels: int
    is_default: bool = False

class ChannelRoutingUpdate(BaseModel):
    id: int
    name: str
    role: str
    hardware_channel: int
    color: str = "#3b82f6"
    active: bool = True

class SaveRoutingRequest(BaseModel):
    audio_device: str
    channels: List[ChannelRoutingUpdate]

class IntentResult(BaseModel):
    musician: str
    element: str
    action_display: str
    action_type: str  # volume_up, volume_down, eq_tweak, reverb_fx, click_metronome, info
    priority: str = "normal"  # normal, urgent, info
    summary: str

class StageMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    channel_id: int
    musician: str
    raw_text: str
    element: str
    action_display: str
    action_type: str
    priority: str
    summary: str
    timestamp: str = Field(default_factory=lambda: datetime.now().strftime("%H:%M:%S"))
    resolved: bool = False

class SimulateRequest(BaseModel):
    channel_id: int
    text: str

class SpeechInput(BaseModel):
    channel_id: int
    text: str
    confidence: Optional[float] = 1.0

class ResolveRequest(BaseModel):
    message_id: str
