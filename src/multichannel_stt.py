import asyncio
import collections
import math
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Dict, List, Optional, Tuple

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore

try:
    import sounddevice as sd
except ImportError:
    sd = None  # type: ignore


ACOUSTIC_PROMPT_PL = (
    "Prośba muzyka ze sceny do realizatora dźwięku: pogłośnij, ścisz, więcej, mniej, "
    "bas, gitara, stopa, werbel, perkusja, klawisze, wokal, chórek, odsłuch, monitor, "
    "ucho, douszne, klik, metronom, pogłos, reverb, delay, podetnij górę, zdejmij dół, "
    "sprzęga, piszczy, przester, decybele."
)

# Typowe halucynacje Whispera na ciszy / szumie scenicznym
HALLUCINATION_PHRASES = {
    "dziękuję",
    "dziękuję.",
    "dziękuję za uwagę",
    "dziękuję za uwagę.",
    "dziękujemy",
    "dziękujemy.",
    "napisy stworzone przez",
    "subskrybuj",
    "subskrybuj mój kanał",
    "do zobaczenia",
    "do zobaczenia.",
    "cześć",
    "thanks for watching",
    "thank you",
    "...",
    ".",
}


def resample_to_16k(audio: "np.ndarray", orig_sr: int) -> "np.ndarray":
    """Szybki resampling mono float32 do 16000 Hz bez zewnętrznych zależności (scipy)."""
    if orig_sr == 16000 or len(audio) == 0:
        return audio.astype(np.float32, copy=False)

    # Czysta decymacja dla częstych wielokrotności (np. 48000 Hz -> 16000 Hz z filtrem uśredniającym)
    if orig_sr % 16000 == 0:
        factor = orig_sr // 16000
        trim = (len(audio) // factor) * factor
        if trim == 0:
            return np.zeros(0, dtype=np.float32)
        return audio[:trim].reshape(-1, factor).mean(axis=1).astype(np.float32)

    target_len = int(round(len(audio) * 16000.0 / float(orig_sr)))
    if target_len <= 0:
        return np.zeros(0, dtype=np.float32)
    x_old = np.linspace(0.0, 1.0, num=len(audio), endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=target_len, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.float32)


def is_hallucination(text: str) -> bool:
    cleaned = text.strip().lower()
    if len(cleaned) < 2:
        return True
    if cleaned in HALLUCINATION_PHRASES:
        return True
    for phrase in ("napisy stworzone", "tłumaczenie:", "amara.org", "subskrybuj"):
        if phrase in cleaned:
            return True
    return False


@dataclass
class ChannelCaptureState:
    channel_id: int
    musician_name: str
    hardware_channel: int  # 1-indexed (np. Input 1..18 na Midas MR18)
    available: bool = True
    muted: bool = False
    is_speaking: bool = False
    is_transcribing: bool = False
    speech_duration: float = 0.0
    silence_duration: float = 0.0
    last_db: float = -80.0
    last_pct: int = 0
    pre_roll: Any = field(default_factory=lambda: collections.deque(maxlen=6))
    speech_chunks: List[Any] = field(default_factory=list)


class MultiChannelSTTEngine:
    """
    Prawdziwy wielokanałowy silnik nasłuchu CoreAudio (sounddevice) + lokalny Whisper (faster-whisper).
    Otwiera JEDEN wielokanałowy strumień na wybranym interfejsie (np. 18 kanałów z Midas MR18),
    rozdziela go na poszczególne fizyczne wejścia (Input 1, 2, 3...) i dla każdego kanału osobno:
    - liczy wskaźnik VU (dB / %)
    - wykrywa mowę (VAD/Gate + pre-roll)
    - transkrybuje wypowiedź lokalnie w języku polskim i przekazuje do IntentAnalyzer.
    """

    def __init__(
        self,
        model_name: str = "medium",
        language: str = "pl",
        vad_threshold_db: float = -38.0,
        on_transcription: Optional[Callable[[int, str], Coroutine[Any, Any, Any]]] = None,
        on_event: Optional[Callable[[str, Any], Coroutine[Any, Any, Any]]] = None,
    ):
        self.model_name = model_name
        self.language = language
        self.vad_threshold_db = float(vad_threshold_db)
        self.on_transcription = on_transcription
        self.on_event = on_event

        # Parametry bramki VAD
        self.silence_hang_sec = 0.85
        self.min_speech_sec = 0.45
        self.max_speech_sec = 9.0
        self.block_duration_sec = 0.064  # ~64 ms na blok

        # Stan strumienia
        self._lock = threading.Lock()
        self._stream: Any = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._vu_task: Optional[asyncio.Task] = None
        self._listening: bool = False
        self._device_name: str = ""
        self._device_index: Optional[int] = None
        self._device_channels: int = 0
        self._sample_rate: int = 48000
        self._last_error: Optional[str] = None

        # Kanały mapowane na fizyczne wejścia
        self._channel_states: Dict[int, ChannelCaptureState] = {}
        self._muted_channels: set = set()

        # Kolejka i wątek roboczy Whisper STT
        self._stt_queue: "queue.Queue[Optional[Tuple[int, Any, int]]]" = queue.Queue(maxsize=32)
        self._stt_thread: Optional[threading.Thread] = None
        self._whisper_model: Any = None
        self._model_state: str = "unloaded"  # unloaded | loading | ready | error
        self._model_error: Optional[str] = None
        self._model_lock = threading.Lock()

    # ==================== Wykrywanie podpiętych urządzeń (PortAudio / CoreAudio) ====================

    def query_connected_input_devices(self) -> List[Dict[str, Any]]:
        """
        Zwraca wyłącznie fizycznie/systemowo dostępne urządzenia wejściowe z PortAudio (CoreAudio).
        Jeśli nie trwa aktywny nasłuch, odświeża listę PortAudio, aby widzieć nowo podpięte miksery USB!
        """
        if sd is None:
            return []

        devices_out: List[Dict[str, Any]] = []
        try:
            # Odśwież PortAudio tylko gdy strumień nie jest otwarty (wykrywa hot-plug USB!)
            if not self._listening:
                try:
                    sd._terminate()
                    sd._initialize()
                except Exception:
                    pass

            all_devs = sd.query_devices()
            default_in_idx = None
            try:
                default_pair = sd.default.device
                if isinstance(default_pair, (list, tuple)):
                    default_in_idx = default_pair[0]
                else:
                    default_in_idx = default_pair
            except Exception:
                pass

            for idx, dev in enumerate(all_devs):
                max_in = int(dev.get("max_input_channels", 0))
                if max_in <= 0:
                    continue
                name = str(dev.get("name", "")).strip()
                if not name:
                    continue
                devices_out.append({
                    "index": idx,
                    "name": name,
                    "channels": max_in,
                    "samplerate": int(dev.get("default_samplerate", 48000)),
                    "is_default": (idx == default_in_idx),
                })
        except Exception as e:
            print(f"[MultiChannelSTT] Błąd query_devices: {e}")

        devices_out.sort(key=lambda d: (not d["is_default"], d["name"].lower()))
        return devices_out

    def _resolve_device(self, preferred_name: Optional[str]) -> Optional[Dict[str, Any]]:
        devs = self.query_connected_input_devices()
        if not devs:
            return None
        if preferred_name:
            target = preferred_name.strip().lower()
            for d in devs:
                if d["name"].lower() == target:
                    return d
            for d in devs:
                if target in d["name"].lower() or d["name"].lower() in target:
                    return d
        for d in devs:
            if d["is_default"]:
                return d
        return devs[0]

    # ==================== Status i konfiguracja na żywo ====================

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            active_ids = [
                ch_id for ch_id, st in self._channel_states.items()
                if st.available and not st.muted
            ]
            unavailable_ids = [
                ch_id for ch_id, st in self._channel_states.items()
                if not st.available
            ]
            muted_ids = sorted(self._muted_channels)
            return {
                "listening": self._listening,
                "device_name": self._device_name,
                "device_channels": self._device_channels,
                "sample_rate": self._sample_rate,
                "active_channel_ids": active_ids,
                "unavailable_channel_ids": unavailable_ids,
                "muted_channel_ids": muted_ids,
                "model_name": self.model_name,
                "model_state": self._model_state,
                "model_error": self._model_error,
                "vad_threshold_db": self.vad_threshold_db,
                "error": self._last_error,
                "deps_ready": (sd is not None and np is not None),
            }

    def set_vad_threshold(self, threshold_db: float):
        self.vad_threshold_db = max(-65.0, min(-10.0, float(threshold_db)))
        self._emit_threadsafe("listen_status", self.get_status())

    def set_model_name(self, model_name: str):
        allowed = {"base", "small", "medium"}
        clean = (model_name or "").strip().lower()
        if clean not in allowed:
            raise ValueError(f"Nieobsługiwany model Whisper: {model_name}")
        if clean == self.model_name and self._model_state != "error":
            return
        with self._model_lock:
            self.model_name = clean
            self._whisper_model = None
            self._model_state = "unloaded"
            self._model_error = None
        self._emit_threadsafe("listen_status", self.get_status())
        # Jeśli nasłuch już trwa, przeładuj nowy model w tle natychmiast
        if self._listening:
            threading.Thread(target=self._load_whisper_model, daemon=True).start()

    def set_channel_muted(self, channel_id: int, muted: bool):
        with self._lock:
            if muted:
                self._muted_channels.add(channel_id)
            else:
                self._muted_channels.discard(channel_id)
            st = self._channel_states.get(channel_id)
            if st:
                st.muted = muted
                if muted:
                    st.is_speaking = False
                    st.speech_chunks.clear()
                    st.speech_duration = 0.0
                    st.silence_duration = 0.0
        self._emit_threadsafe("listen_status", self.get_status())

    def sync_channels(self, channels: Dict[int, Any]):
        """Aktualizuje mapowanie kanałów scenicznych -> fizyczne wejścia bez przerywania strumienia."""
        with self._lock:
            new_states: Dict[int, ChannelCaptureState] = {}
            for ch_id, ch in channels.items():
                hw = int(getattr(ch, "hardware_channel", ch_id))
                name = str(getattr(ch, "name", f"CH {ch_id}"))
                prev = self._channel_states.get(ch_id)
                available = (1 <= hw <= self._device_channels) if self._device_channels > 0 else False
                muted = ch_id in self._muted_channels
                if prev and prev.hardware_channel == hw:
                    prev.musician_name = name
                    prev.available = available
                    prev.muted = muted
                    new_states[ch_id] = prev
                else:
                    new_states[ch_id] = ChannelCaptureState(
                        channel_id=ch_id,
                        musician_name=name,
                        hardware_channel=hw,
                        available=available,
                        muted=muted,
                    )
            self._channel_states = new_states

    # ==================== Start / Stop wielokanałowego nasłuchu ====================

    async def start(
        self,
        channels: Dict[int, Any],
        device_name: Optional[str] = None,
        vad_threshold_db: Optional[float] = None,
    ) -> Dict[str, Any]:
        if sd is None or np is None:
            self._last_error = "Brak bibliotek sounddevice / numpy. Zainstaluj je przez pip."
            await self._emit_async("listen_status", self.get_status())
            return self.get_status()

        if vad_threshold_db is not None:
            self.vad_threshold_db = max(-65.0, min(-10.0, float(vad_threshold_db)))

        # Jeśli już działa, najpierw czysto zatrzymaj
        if self._listening:
            await self.stop()

        self._loop = asyncio.get_running_loop()
        self._last_error = None

        dev = self._resolve_device(device_name)
        if not dev:
            self._last_error = "Nie wykryto żadnego podpiętego urządzenia wejściowego audio."
            await self._emit_async("listen_status", self.get_status())
            return self.get_status()

        self._device_index = dev["index"]
        self._device_name = dev["name"]
        self._device_channels = int(dev["channels"])
        self._sample_rate = int(dev["samplerate"]) or 48000

        self.sync_channels(channels)

        # Uruchom wątek roboczy Whisper (załaduje model w tle, nie blokując startu audio/VU!)
        self._ensure_stt_worker()

        blocksize = max(512, int(self._sample_rate * self.block_duration_sec))
        try:
            self._stream = sd.InputStream(
                device=self._device_index,
                channels=self._device_channels,
                samplerate=self._sample_rate,
                blocksize=blocksize,
                dtype="float32",
                callback=self._audio_callback,
            )
            self._stream.start()
            self._listening = True
            print(
                f"[MultiChannelSTT] START: '{self._device_name}' "
                f"({self._device_channels} ch @ {self._sample_rate} Hz, VAD={self.vad_threshold_db} dB)"
            )
        except Exception as e:
            self._last_error = f"Nie można otworzyć urządzenia '{self._device_name}': {e}"
            self._listening = False
            self._stream = None
            print(f"[MultiChannelSTT] Błąd startu strumienia: {e}")
            await self._emit_async("listen_status", self.get_status())
            return self.get_status()

        # Uruchom pętlę wysyłania żywych poziomów VU przez WebSocket (~12 Hz)
        self._vu_task = asyncio.create_task(self._vu_broadcast_loop())
        await self._emit_async("listen_status", self.get_status())
        return self.get_status()

    async def stop(self) -> Dict[str, Any]:
        self._listening = False

        if self._vu_task:
            self._vu_task.cancel()
            try:
                await self._vu_task
            except asyncio.CancelledError:
                pass
            self._vu_task = None

        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception as e:
                print(f"[MultiChannelSTT] Błąd zamykania strumienia: {e}")
            self._stream = None

        with self._lock:
            for st in self._channel_states.values():
                st.is_speaking = False
                st.speech_chunks.clear()
                st.speech_duration = 0.0
                st.silence_duration = 0.0
                st.last_db = -80.0
                st.last_pct = 0

        status = self.get_status()
        await self._emit_async("listen_status", status)
        await self._emit_async("vu_levels", {"master_db": -80.0, "master_pct": 0, "channels": {}})
        print("[MultiChannelSTT] STOP")
        return status

    def force_shutdown(self):
        """
        Synchroniczne, bezpieczne zamknięcie wszystkich zasobów audio i wątku Whisper
        wywoływane przy zamykaniu aplikacji macOS (działa niezależnie od pętli asyncio).
        """
        self._listening = False

        if self._vu_task and self._loop and not self._loop.is_closed():
            try:
                self._loop.call_soon_threadsafe(self._vu_task.cancel)
            except Exception:
                pass
            self._vu_task = None

        if self._stream is not None:
            try:
                self._stream.abort()
                self._stream.close()
            except Exception:
                pass
            self._stream = None

        # Zakończ wątek roboczy Whisper (sentinel None)
        try:
            while not self._stt_queue.empty():
                try:
                    self._stt_queue.get_nowait()
                except queue.Empty:
                    break
            self._stt_queue.put_nowait(None)
        except Exception:
            pass

        if self._stt_thread and self._stt_thread.is_alive():
            self._stt_thread.join(timeout=1.0)
        print("[MultiChannelSTT] FORCE SHUTDOWN COMPLETE")

    # ==================== Callback audio w czasie rzeczywistym ====================

    def _audio_callback(self, indata: "np.ndarray", frames: int, time_info: Any, status: Any):
        if not self._listening or indata is None:
            return

        block_dur = frames / float(self._sample_rate)
        num_in_ch = indata.shape[1] if indata.ndim > 1 else 1
        threshold_db = self.vad_threshold_db
        to_enqueue: List[Tuple[int, Any, int]] = []
        speaking_events: List[Dict[str, Any]] = []

        with self._lock:
            for st in self._channel_states.values():
                hw_idx = st.hardware_channel - 1
                if hw_idx < 0 or hw_idx >= num_in_ch:
                    st.available = False
                    st.last_db = -80.0
                    st.last_pct = 0
                    continue

                st.available = True
                sig = indata[:, hw_idx] if indata.ndim > 1 else indata

                # RMS i przeliczenie na dB + procent na mierniku VU
                rms = float(np.sqrt(np.mean(sig * sig) + 1e-12))
                db = 20.0 * math.log10(max(rms, 1e-6))
                pct = int(max(0.0, min(100.0, (db + 60.0) / 56.0 * 100.0)))
                st.last_db = round(db, 1)
                st.last_pct = pct

                if st.muted:
                    continue

                chunk_copy = sig.copy()

                if db >= threshold_db:
                    if not st.is_speaking:
                        st.is_speaking = True
                        st.speech_duration = 0.0
                        st.silence_duration = 0.0
                        st.speech_chunks = list(st.pre_roll)
                        st.speech_chunks.append(chunk_copy)
                        speaking_events.append({
                            "channel_id": st.channel_id,
                            "speaking": True,
                            "state": "speaking",
                        })
                    else:
                        st.speech_chunks.append(chunk_copy)
                        st.silence_duration = 0.0
                    st.speech_duration += block_dur

                    # Wymuś transkrypcję jeśli ktoś mówi ciągle > max_speech_sec
                    if st.speech_duration >= self.max_speech_sec:
                        audio_full = np.concatenate(st.speech_chunks)
                        st.speech_chunks = []
                        st.is_speaking = False
                        st.speech_duration = 0.0
                        st.silence_duration = 0.0
                        st.is_transcribing = True
                        to_enqueue.append((st.channel_id, audio_full, self._sample_rate))
                        speaking_events.append({
                            "channel_id": st.channel_id,
                            "speaking": True,
                            "state": "transcribing",
                        })
                else:
                    if st.is_speaking:
                        st.speech_chunks.append(chunk_copy)
                        st.silence_duration += block_dur
                        st.speech_duration += block_dur

                        if st.silence_duration >= self.silence_hang_sec:
                            valid_speech = (st.speech_duration - st.silence_duration) >= self.min_speech_sec
                            if valid_speech and st.speech_chunks:
                                audio_full = np.concatenate(st.speech_chunks)
                                st.is_transcribing = True
                                to_enqueue.append((st.channel_id, audio_full, self._sample_rate))
                                speaking_events.append({
                                    "channel_id": st.channel_id,
                                    "speaking": True,
                                    "state": "transcribing",
                                })
                            else:
                                speaking_events.append({
                                    "channel_id": st.channel_id,
                                    "speaking": False,
                                    "state": "idle",
                                })
                            st.speech_chunks = []
                            st.is_speaking = False
                            st.speech_duration = 0.0
                            st.silence_duration = 0.0
                    else:
                        st.pre_roll.append(chunk_copy)

        for item in to_enqueue:
            try:
                self._stt_queue.put_nowait(item)
            except queue.Full:
                print(f"[MultiChannelSTT] Kolejka STT pełna — pominięto próbkę CH {item[0]}")

        for ev in speaking_events:
            self._emit_threadsafe("channel_speaking", ev)

    # ==================== Pętla rozsyłania poziomów VU ====================

    async def _vu_broadcast_loop(self):
        try:
            while self._listening:
                ch_levels: Dict[str, Any] = {}
                max_db = -80.0
                max_pct = 0

                with self._lock:
                    for ch_id, st in self._channel_states.items():
                        ch_levels[str(ch_id)] = {
                            "db": st.last_db,
                            "pct": st.last_pct,
                            "speaking": st.is_speaking,
                            "transcribing": st.is_transcribing,
                            "available": st.available,
                            "muted": st.muted,
                        }
                        if st.available and st.last_pct > max_pct:
                            max_pct = st.last_pct
                            max_db = st.last_db

                await self._emit_async("vu_levels", {
                    "master_db": max_db,
                    "master_pct": max_pct,
                    "channels": ch_levels,
                })
                await asyncio.sleep(0.08)
        except asyncio.CancelledError:
            pass

    # ==================== Wątek roboczy lokalnego Whisper STT ====================

    def _ensure_stt_worker(self):
        if self._stt_thread is None or not self._stt_thread.is_alive():
            self._stt_thread = threading.Thread(target=self._stt_worker_loop, daemon=True)
            self._stt_thread.start()

    def _load_whisper_model(self):
        with self._model_lock:
            if self._whisper_model is not None:
                return self._whisper_model
            self._model_state = "loading"
            self._model_error = None
            self._emit_threadsafe("listen_status", self.get_status())
            try:
                from faster_whisper import WhisperModel
                print(f"[Whisper] Ładowanie modelu '{self.model_name}' (int8, CPU)...")
                t0 = time.time()
                self._whisper_model = WhisperModel(
                    self.model_name,
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=4,
                )
                self._model_state = "ready"
                print(f"[Whisper] Model '{self.model_name}' gotowy w {time.time() - t0:.1f}s!")
            except Exception as e:
                self._model_state = "error"
                self._model_error = str(e)
                print(f"[Whisper] Błąd ładowania modelu: {e}")
            self._emit_threadsafe("listen_status", self.get_status())
            return self._whisper_model

    def _stt_worker_loop(self):
        # Załaduj model od razu przy pierwszym starcie nasłuchu
        model = self._load_whisper_model()

        while True:
            item = self._stt_queue.get()
            if item is None:
                break

            channel_id, raw_audio, orig_sr = item
            try:
                model = self._whisper_model
                if model is None:
                    model = self._load_whisper_model()
                if model is None:
                    continue

                audio_16k = resample_to_16k(raw_audio, orig_sr)
                if len(audio_16k) < int(16000 * 0.3):
                    continue

                segments, _info = model.transcribe(
                    audio_16k,
                    language=self.language,
                    beam_size=3,
                    vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 350},
                    initial_prompt=ACOUSTIC_PROMPT_PL,
                    condition_on_previous_text=False,
                )
                text = " ".join(seg.text.strip() for seg in segments).strip()

                if text and not is_hallucination(text):
                    print(f"[Whisper CH {channel_id:02d}] -> {text}")
                    if self.on_transcription and self._loop and not self._loop.is_closed():
                        asyncio.run_coroutine_threadsafe(
                            self.on_transcription(channel_id, text),
                            self._loop,
                        )
            except Exception as e:
                print(f"[Whisper Error CH {channel_id}] {e}")
            finally:
                with self._lock:
                    st = self._channel_states.get(channel_id)
                    if st:
                        st.is_transcribing = False
                self._emit_threadsafe("channel_speaking", {
                    "channel_id": channel_id,
                    "speaking": False,
                    "state": "idle",
                })
                self._stt_queue.task_done()

    # ==================== Pomocniki eventowe ====================

    async def _emit_async(self, event_type: str, data: Any):
        if self.on_event:
            try:
                await self.on_event(event_type, data)
            except Exception as e:
                print(f"[MultiChannelSTT Emit Error] {e}")

    def _emit_threadsafe(self, event_type: str, data: Any):
        if self.on_event and self._loop and not self._loop.is_closed():
            try:
                asyncio.run_coroutine_threadsafe(self.on_event(event_type, data), self._loop)
            except Exception:
                pass
