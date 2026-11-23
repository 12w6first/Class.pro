// State
let ws = null;
let channels = [];
let messages = [];
let activeFilter = 'all';

// Audio & Speech State
let recognition = null;
let audioContext = null;
let analyser = null;
let micStream = null;
let isListening = false;
let selectedMicChannelId = 1; // Default to CH 1 (Wokal Główny, mapped to Input 1)

// DOM Elements
const wsIndicator = document.getElementById('ws-indicator');
const wsStatusText = document.getElementById('ws-status-text');
const digitalClock = document.getElementById('digital-clock');
const channelsContainer = document.getElementById('channels-container');
const messagesContainer = document.getElementById('messages-container');
const presetsContainer = document.getElementById('presets-container');
const customSelect = document.getElementById('custom-channel-select');
const customForm = document.getElementById('custom-test-form');
const customInput = document.getElementById('custom-text-input');
const btnToggleMic = document.getElementById('btn-toggle-mic');
const micText = document.getElementById('mic-text');
const btnClearAll = document.getElementById('btn-clear-all');
const activeChannelsCount = document.getElementById('active-channels-count');

// Master Mic Banner Elements
const btnMasterMic = document.getElementById('btn-master-mic');
const masterMicText = document.getElementById('master-mic-text');
const masterMicDot = document.getElementById('master-mic-dot');
const liveMicBanner = document.getElementById('live-mic-banner');
const liveVuFill = document.getElementById('live-vu-fill');
const liveVuDb = document.getElementById('live-vu-db');
const liveTranscriptionPreview = document.getElementById('live-transcription-preview');
const micErrorHint = document.getElementById('mic-error-hint');
const activeMicChannelLabel = document.getElementById('active-mic-channel-label');

// Digital Clock
function updateClock() {
    const now = new Date();
    digitalClock.innerText = now.toTimeString().split(' ')[0];
}
setInterval(updateClock, 1000);
updateClock();

// WebSocket Connection
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        wsIndicator.className = 'pulse-dot online';
        wsStatusText.innerText = 'POŁĄCZONO Z MIKSEREM';
    };

    ws.onclose = () => {
        wsIndicator.className = 'pulse-dot';
        wsStatusText.innerText = 'ROZŁĄCZONO (RECONNECT...)';
        setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => {
        console.error('WS Error:', err);
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleWsMessage(msg);
        } catch (e) {
            console.error('Błąd parsowania WS:', e);
        }
    };
}

function handleWsMessage(payload) {
    const { type, data } = payload;

    if (type === 'init') {
        channels = data.channels || [];
        messages = data.messages || [];
        renderChannels();
        renderMessages();
        updateCustomSelect();
        updateMicTargetLabel();
    } else if (type === 'new_message') {
        messages.unshift(data);
        renderMessages();
    } else if (type === 'channel_update') {
        channels = data;
        renderChannels();
        updateMicTargetLabel();
    } else if (type === 'resolve_message') {
        const target = messages.find(m => m.id === data.id);
        if (target) target.resolved = true;
        renderMessages();
    } else if (type === 'clear_all') {
        messages = [];
        renderMessages();
    }
}

// Select active mic channel
window.selectMicChannel = function(channelId) {
    selectedMicChannelId = channelId;
    renderChannels();
    updateMicTargetLabel();
    if (customSelect) customSelect.value = channelId;
};

function updateMicTargetLabel() {
    if (!activeMicChannelLabel) return;
    const ch = channels.find(c => c.id === selectedMicChannelId);
    if (ch) {
        activeMicChannelLabel.innerText = `CH 0${ch.id} (${ch.name} - Wejście IN ${ch.hardware_channel || ch.id})`;
    } else {
        activeMicChannelLabel.innerText = `CH 0${selectedMicChannelId}`;
    }
}

// Render Channels (Instrument pod instrumentem szeroko)
function renderChannels() {
    if (!channelsContainer) return;
    channelsContainer.innerHTML = '';
    activeChannelsCount.innerText = `${channels.length} INSTRUMENTÓW AKTYWNYCH`;

    channels.forEach(ch => {
        const strip = document.createElement('div');
        const hasUrgent = messages.some(m => m.channel_id === ch.id && !m.resolved && m.priority === 'urgent');
        const hasAlert = ch.active_requests_count > 0;

        strip.className = `channel-strip-wide ${hasUrgent ? 'has-urgent' : (hasAlert ? 'has-alert' : '')}`;
        strip.id = `channel-card-${ch.id}`;
        strip.style.borderLeftColor = ch.color || '#3b82f6';

        const lastMsgText = ch.last_message || 'Brak aktywnych uwag / Wszystko OK';
        const lastTime = ch.last_timestamp ? `<small style="color:#64748b;margin-left:8px;">(${ch.last_timestamp})</small>` : '';
        const isMicActiveHere = selectedMicChannelId === ch.id;
        const hwIn = ch.hardware_channel || ch.id;

        strip.innerHTML = `
            <!-- Kolumna 1: ID & Instrument -->
            <div class="strip-col-identity">
                <span class="strip-ch-id" style="background: ${ch.color}">CH 0${ch.id}</span>
                <div class="strip-names">
                    <div class="strip-instrument-name">${ch.name}</div>
                    <div class="strip-role-title">${ch.role}</div>
                </div>
            </div>

            <!-- Kolumna 2: Przypisane wejście Midas MR18 -->
            <div class="strip-col-routing">
                <span class="routing-label">WEJŚCIE MIKSERA:</span>
                <span class="strip-hw-badge" title="Fizyczny tor na Midas MR18">
                    🎛️ Midas IN ${hwIn}
                </span>
            </div>

            <!-- Kolumna 3: Poziom VU na żywo -->
            <div class="strip-col-meters" id="channel-meter-${ch.id}">
                <span class="meter-title">POZIOM VU</span>
                <div class="strip-meter-bar">
                    <div class="meter-bar active-green"></div>
                    <div class="meter-bar active-green"></div>
                    <div class="meter-bar ${hasAlert ? 'active-yellow' : ''}"></div>
                    <div class="meter-bar ${hasUrgent ? 'active-red' : ''}"></div>
                </div>
            </div>

            <!-- Kolumna 4: Ostatnia uwaga / mowa na żywo -->
            <div class="strip-col-status">
                <span class="status-label">AKTUALNY STAN:</span>
                <div class="strip-status-box" style="border-left-color: ${ch.color}">
                    <span style="overflow:hidden;text-overflow:ellipsis;">${lastMsgText}</span>
                    ${lastTime}
                </div>
                <div class="card-live-speech hidden" id="card-speech-${ch.id}">
                    <span>💬 Mówi na żywo:</span>
                    <span class="card-speech-text"></span>
                </div>
            </div>

            <!-- Kolumna 5: Akcje & Przypisanie mikrofonu -->
            <div class="strip-col-actions">
                <span class="channel-req-count ${ch.active_requests_count > 0 ? 'active-count' : ''}">
                    ${ch.active_requests_count} ${ch.active_requests_count === 1 ? 'prośba' : 'próśb'}
                </span>
                <button type="button" class="btn-strip-talk ${isMicActiveHere ? 'selected-mic' : ''}" onclick="selectMicChannel(${ch.id})">
                    ${isMicActiveHere ? '● Nasłuch aktywny' : '🎙️ Mów jako ten kanał'}
                </button>
            </div>
        `;
        channelsContainer.appendChild(strip);
    });
}

// ==================== Audio / Instrument Keyword Detection & Highlighting ====================
const AUDIO_INSTRUMENT_PATTERNS = [
    // Instrumenty
    /\b(?:bas|basu|basem|basie|basowa|gitara|gitarę|gitary|gitarze|wiosło|akustyk|elektryk)\b/gi,
    /\b(?:stopa|stopę|stopy|stopie|kick|werbel|werbla|werblem|snare)\b/gi,
    /\b(?:perkusja|perkusji|perkusję|bębny|bębnów|tomy|tomów|talerze|talerzy|hi-?hat|blachy|blach)\b/gi,
    /\b(?:klawisz|klawisze|klawisza|klawiszy|piano|pianino|pianina|synth|syntezator)\b/gi,
    /\b(?:wokal|wokalu|wokalem|wokalowi|wokalist[a-zęóąśłżźćń]*|głos|głosu|śpiew|chór[a-zęóąśłżźćń]*|mikrofon[a-zęóąśłżźćń]*|talkback)\b/gi,
    /\b(?:skrzypce|dęciaki|trąbka|saksofon)\b/gi,

    // Dźwięk / Odsłuch / Pasmo / Efekty
    /\b(?:dźwięk[a-zęóąśłżźćń]*|odsłuch[a-zęóąśłżźćń]*|monitor[a-zęóąśłżźćń]*|ucho|uchu|uszy|uszach|douszn[a-zęóąśłżźćń]*|iem|słuchawk[a-zęóąśłżźćń]*)\b/gi,
    /\b(?:góra|górę|góry|górze|sopran|treble|kłuje|syczy|ostre|piecze)\b/gi,
    /\b(?:dół|dołu|dołem|low|basowe|dudni|muli|buczy)\b/gi,
    /\b(?:środek|środka|mid|pasmo|eq|korekcja|filtr)\b/gi,
    /\b(?:pogłos[a-zęóąśłżźćń]*|reverb[a-zęóąśłżźćń]*|delay[a-zęóąśłżźćń]*|echo|efekt[a-zęóąśłżźćń]*|fx)\b/gi,
    /\b(?:klik[a-zęóąśłżźćń]*|metronom[a-zęóąśłżźćń]*|tempo)\b/gi,
    /\b(?:głośniej|ciszej|pogłoś[a-zęóąśłżźćń]*|podgłoś[a-zęóąśłżźćń]*|przycisz[a-zęóąśłżźćń]*|ścisz[a-zęóąśłżźćń]*|ściśnij|podbij[a-zęóąśłżźćń]*|zdejmij|ujmij|dorzuć)\b/gi,
    /\b(?:za głośno|za cicho|nie słysz[a-zęóąśłżźćń]*)\b/gi,
    /\b(?:decybel[a-zęóąśłżźćń]*|db|gain|fader|suwak|poziom|volume)\b/gi,
    /\b(?:sprzęg[a-zęóąśłżźćń]*|piszcz[a-zęóąśłżźćń]*|pisk|przester[a-zęóąśłżźćń]*|charcz[a-zęóąśłżźćń]*|trzeszcz[a-zęóąśłżźćń]*|hucz[a-zęóąśłżźćń]*|szum)\b/gi
];

function highlightAudioKeywords(text) {
    if (!text) return { html: '', hasAudio: false };
    let hasAudio = false;
    let safeText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    for (const regex of AUDIO_INSTRUMENT_PATTERNS) {
        regex.lastIndex = 0;
        if (regex.test(safeText)) {
            hasAudio = true;
            regex.lastIndex = 0;
            safeText = safeText.replace(regex, (match) => `<span class="highlight-audio-red">${match}</span>`);
        }
    }
    return { html: safeText, hasAudio };
}

// Render Messages Feed (Kolumna pod kolumną)
function renderMessages() {
    if (!messagesContainer) return;
    messagesContainer.innerHTML = '';

    const filtered = messages.filter(m => {
        if (activeFilter === 'pending') return !m.resolved;
        if (activeFilter === 'urgent') return m.priority === 'urgent' && !m.resolved;
        if (activeFilter === 'resolved') return m.resolved;
        return true;
    });

    if (filtered.length === 0) {
        messagesContainer.innerHTML = `
            <div class="empty-feed">
                <div class="radar-scan"></div>
                <p>Brak zgłoszeń w tej kategorii</p>
                <small>Nasłuchiwanie kanałów talkback i odsłuchów</small>
            </div>
        `;
        return;
    }

    filtered.forEach(m => {
        const item = document.createElement('div');
        const { html: highlightedSpeech, hasAudio } = highlightAudioKeywords(m.raw_text);
        const chColor = getChannelColor(m.channel_id);
        const hwIn = getChannelHw(m.channel_id);

        item.className = `msg-card columnar-msg ${hasAudio ? 'sound-alert-card' : ''} ${m.priority === 'urgent' ? 'urgent' : 'normal'} ${m.resolved ? 'resolved' : ''}`;

        item.innerHTML = `
            <div class="columnar-header">
                <div class="col-musician">
                    <span class="musician-circle" style="background:${chColor}"></span>
                    <strong class="musician-name">${m.musician}</strong>
                    <span class="ch-badge">CH 0${m.channel_id} (IN ${hwIn})</span>
                </div>
                <div class="col-badges">
                    ${hasAudio ? '<span class="badge-sound-red">🔴 DŹWIĘK / INSTRUMENT</span>' : ''}
                    <span class="col-time">${m.timestamp}</span>
                </div>
            </div>

            <div class="columnar-speech-box">
                <div class="speech-quote-mark">“</div>
                <div class="speech-text">${highlightedSpeech}</div>
            </div>

            <div class="columnar-footer">
                <div class="col-intent">
                    <span class="tag-action tag-${m.action_type}">${m.action_display}</span>
                    <span class="intent-summary-text">${m.summary}</span>
                </div>
                <div class="col-action">
                    ${m.resolved
                        ? '<span class="resolved-indicator">✓ ZROBIONE</span>'
                        : `<button class="btn-resolve" onclick="resolveMessage('${m.id}')">✓ Oznacz jako zrobione</button>`
                    }
                </div>
            </div>
        `;
        messagesContainer.appendChild(item);
    });
}

function getChannelHw(channelId) {
    const ch = channels.find(c => c.id === channelId);
    return ch ? (ch.hardware_channel || ch.id) : channelId;
}

function getChannelColor(channelId) {
    const ch = channels.find(c => c.id === channelId);
    return ch ? ch.color : '#3b82f6';
}

// Resolve Message
window.resolveMessage = async function(messageId) {
    try {
        await fetch('/api/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_id: messageId })
        });
    } catch (e) {
        console.error('Błąd oznaczania:', e);
    }
};

// Filter Tabs
document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        activeFilter = e.target.dataset.filter;
        renderMessages();
    });
});

// Update Channel Select Dropdown
function updateCustomSelect() {
    if (!customSelect) return;
    customSelect.innerHTML = '';
    channels.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch.id;
        opt.innerText = `CH ${ch.id}: ${ch.name} (IN ${ch.hardware_channel || ch.id})`;
        if (ch.id === selectedMicChannelId) opt.selected = true;
        customSelect.appendChild(opt);
    });
}

// Load Presets
async function loadPresets() {
    try {
        const res = await fetch('/api/presets');
        const presets = await res.json();
        presetsContainer.innerHTML = '';

        presets.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'preset-btn';
            btn.innerText = p.title;
            btn.addEventListener('click', async () => {
                await fetch('/api/simulate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel_id: p.channel_id, text: p.text })
                });
            });
            presetsContainer.appendChild(btn);
        });
    } catch (e) {
        console.error('Błąd ładowania presetów:', e);
    }
}

// Custom Test Form
customForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const chId = parseInt(customSelect.value);
    const text = customInput.value.trim();
    if (!text) return;

    try {
        await fetch('/api/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel_id: chId, text })
        });
        customInput.value = '';
    } catch (err) {
        console.error('Błąd wysyłania:', err);
    }
});

// Clear All
btnClearAll.addEventListener('click', async () => {
    if (confirm('Czy na pewno wyczyścić wszystkie zgłoszenia z pulpitu?')) {
        await fetch('/api/clear', { method: 'POST' });
    }
});

// ==================== Live Microphone & AudioContext Engine ====================

// ---- Detekcja przeglądarki ----
function detectBrowser() {
    const ua = navigator.userAgent;
    // Brave ma własny navigator.brave (asynchroniczny), sprawdzamy też UA
    if (typeof navigator.brave !== 'undefined') return 'brave';
    if (ua.includes('Brave')) return 'brave';
    if (ua.includes('Edg/')) return 'edge';
    if (ua.includes('Chrome') && !ua.includes('Brave')) return 'chrome';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'safari';
    if (ua.includes('Firefox')) return 'firefox';
    return 'unknown';
}

// ---- Server-side STT przez MediaRecorder (fallback gdy Web Speech API niedostępne) ----
let mediaRecorder = null;
let audioChunks = [];
let serverSttActive = false;

async function startServerStt() {
    if (!micStream) return;
    serverSttActive = true;
    audioChunks = [];

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : 'audio/ogg';

    try {
        mediaRecorder = new MediaRecorder(micStream, { mimeType });
    } catch (e) {
        console.error('[ServerSTT] Nie można utworzyć MediaRecorder:', e);
        return;
    }

    mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
        if (!serverSttActive || audioChunks.length === 0) return;
        const blob = new Blob(audioChunks, { type: mimeType });
        audioChunks = [];

        liveTranscriptionPreview.innerText = '⏳ Transkrypcja serwerowa (Whisper)…';

        try {
            const form = new FormData();
            form.append('audio', blob, 'speech.webm');
            form.append('channel_id', String(selectedMicChannelId));

            const res = await fetch('/api/transcribe', { method: 'POST', body: form });
            if (res.ok) {
                const data = await res.json();
                if (data.text && data.text.trim().length > 0) {
                    const { html } = highlightAudioKeywords(data.text);
                    liveTranscriptionPreview.innerHTML = `"${html}"`;
                    liveTranscriptionPreview.classList.add('active-speaking');
                } else {
                    liveTranscriptionPreview.innerText = '(brak mowy w nagraniu – mów bliżej mikrofonu)';
                }
            } else if (res.status === 503) {
                hideMicError();
                showMicError(`
                    <strong>Tryb serwerowy (Whisper) niedostępny.</strong><br>
                    Aktywuj instalując: <code style="background:#1e293b;padding:2px 6px;border-radius:4px;">pip install openai-whisper</code> i zrestartuj serwer.<br>
                    <strong>Teraz możesz wpisać tekst ręcznie</strong> w polu „Wyślij na mikser" poniżej.
                `);
            }
        } catch (err) {
            console.error('[ServerSTT] Błąd wysyłania audio:', err);
        }

        // Nagraj kolejny chunk jeśli nadal aktywny
        if (serverSttActive && isListening) {
            startNextSttChunk();
        }
    };

    startNextSttChunk();
}

function startNextSttChunk() {
    if (!mediaRecorder || !serverSttActive || !isListening) return;
    audioChunks = [];
    try {
        mediaRecorder.start();
        setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        }, 4000);
    } catch (e) {
        console.error('[ServerSTT] startNextChunk error:', e);
    }
}

function stopServerStt() {
    serverSttActive = false;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch (e) {}
    }
    mediaRecorder = null;
    audioChunks = [];
}

function showMicError(msgHtml) {
    if (micErrorHint) {
        micErrorHint.innerHTML = msgHtml;
        micErrorHint.classList.remove('hidden');
    }
}

function hideMicError() {
    if (micErrorHint) {
        micErrorHint.classList.add('hidden');
    }
}

async function toggleMasterListening() {
    if (isListening) {
        stopMasterListening();
    } else {
        await startMasterListening();
    }
}

async function startMasterListening() {
    hideMicError();

    try {
        // 1. Dostęp do mikrofonu (Web Audio API)
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: true
            }
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        const source = audioContext.createMediaStreamSource(micStream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        isListening = true;
        updateListeningUI(true);

        // Pętla odczytu głośności i animacji wskaźników VU w 60fps
        function updateVolumeLoop() {
            if (!isListening) return;
            analyser.getByteFrequencyData(dataArray);

            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const avg = sum / dataArray.length;
            const volPercent = Math.min(100, Math.round((avg / 120) * 100));

            // Główny wskaźnik VU na banerze
            if (liveVuFill) liveVuFill.style.width = `${volPercent}%`;
            if (liveVuDb) liveVuDb.innerText = volPercent > 3 ? `${Math.round(volPercent * 0.6 - 42)} dB` : '-inf dB';

            // Wskaźnik VU na kafelku wybranego kanału (np. CH 1)
            const chMeter = document.getElementById(`channel-meter-${selectedMicChannelId}`);
            if (chMeter) {
                const bars = chMeter.querySelectorAll('.meter-bar');
                if (bars.length >= 4) {
                    bars[0].className = volPercent > 4 ? 'meter-bar active-green' : 'meter-bar';
                    bars[1].className = volPercent > 25 ? 'meter-bar active-green' : 'meter-bar';
                    bars[2].className = volPercent > 55 ? 'meter-bar active-yellow' : 'meter-bar';
                    bars[3].className = volPercent > 80 ? 'meter-bar active-red' : 'meter-bar';
                }
            }

            requestAnimationFrame(updateVolumeLoop);
        }
        updateVolumeLoop();

        // 2. Start Speech Recognition
        startSpeechEngine();

    } catch (err) {
        console.error('Błąd pobierania audio z mikrofonu:', err);
        showMicError(`Błąd dostępu do mikrofonu: ${err.message}. Upewnij się, że zezwoliłeś przeglądarce na używanie mikrofonu.`);
        updateListeningUI(false);
    }
}

function stopMasterListening() {
    isListening = false;
    updateListeningUI(false);

    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
        audioContext = null;
    }
    if (recognition) {
        try { recognition.abort(); } catch (e) {}
        recognition = null;
    }

    if (liveVuFill) liveVuFill.style.width = '0%';
    if (liveVuDb) liveVuDb.innerText = 'OFF';
}

function updateListeningUI(active) {
    if (active) {
        btnMasterMic.classList.add('listening');
        masterMicText.innerText = '🔴 NASŁUCH AKTYWNY (MÓW TERAZ DO MIKROFONU)';
        liveMicBanner.classList.add('active-listening');
        btnToggleMic.classList.add('recording');
        micText.innerText = 'Nasłuch aktywny';
        liveTranscriptionPreview.innerText = 'Słucham... powiedz np. "Daj mi więcej basu w odsłuchu" lub "Podetnij górę"';
        liveTranscriptionPreview.classList.add('active-speaking');
    } else {
        btnMasterMic.classList.remove('listening');
        masterMicText.innerText = '🎙️ ROZPOCZNIJ CIĄGŁY NASŁUCH MIKROFONU (INPUT 1)';
        liveMicBanner.classList.remove('active-listening');
        btnToggleMic.classList.remove('recording');
        micText.innerText = 'Mikrofon na żywo';
        liveTranscriptionPreview.innerText = 'Nasłuch wyłączony. Kliknij przycisk powyżej, aby włączyć nasłuch.';
        liveTranscriptionPreview.classList.remove('active-speaking');
    }
}

function startSpeechEngine() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showMicError('Twoja przeglądarka nie obsługuje API Web Speech. Zalecana przeglądarka do mowy: <strong>Google Chrome</strong> / <strong>Edge</strong>.');
        return;
    }

    try {
        if (recognition) {
            try { recognition.abort(); } catch (e) {}
        }

        recognition = new SpeechRecognition();
        recognition.lang = 'pl-PL';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onstart = () => {
            console.log('[Speech] Silnik rozpoznawania mowy aktywny');
        };

        recognition.onresult = async (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const part = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += part;
                } else {
                    interimTranscript += part;
                }
            }

            const currentSpeech = (finalTranscript || interimTranscript).trim();

            if (currentSpeech.length > 0) {
                const { html: highlightedLive } = highlightAudioKeywords(currentSpeech);

                // Pokazuj na żywo na banerze z czerwonym wyróżnieniem instrumentów/dźwięku
                liveTranscriptionPreview.innerHTML = `“${highlightedLive}”`;
                liveTranscriptionPreview.classList.add('active-speaking');

                // Pokazuj na żywo na kafelku wybranego kanału (CH 1 / Input 1)
                const cardSpeech = document.getElementById(`card-speech-${selectedMicChannelId}`);
                if (cardSpeech) {
                    cardSpeech.classList.remove('hidden');
                    const textEl = cardSpeech.querySelector('.card-speech-text');
                    if (textEl) textEl.innerHTML = `“${highlightedLive}”`;
                }
            }

            // Gdy zdanie jest sfinalizowane, wyślij do analizy intencji AI w backendzie!
            if (finalTranscript && finalTranscript.trim().length > 0) {
                console.log('[Speech] Wykryto sfinalizowaną mowę:', finalTranscript);
                try {
                    await fetch('/api/speech', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            channel_id: selectedMicChannelId,
                            text: finalTranscript.trim(),
                            confidence: 1.0
                        })
                    });
                } catch (e) {
                    console.error('Błąd przesyłania mowy do API:', e);
                }

                // Wyczyść dymek na kafelku po 3 sekundach
                setTimeout(() => {
                    const cardSpeech = document.getElementById(`card-speech-${selectedMicChannelId}`);
                    if (cardSpeech) cardSpeech.classList.add('hidden');
                }, 3000);
            }
        };

        recognition.onerror = (e) => {
            console.warn('[Speech Error]', e.error);
            if (e.error === 'not-allowed') {
                showMicError('Brak uprawnień do mikrofonu w przeglądarce. Zezwól na dostęp w pasku adresu.');
            } else if (e.error === 'network') {
                showMicError(`
                    <strong>Uwaga (Brave Browser):</strong> W przeglądarce Brave rozpoznawanie mowy Google bywa domyślnie zablokowane.<br>
                    Aby to włączyć: wpisz w pasku adresu <strong>brave://settings/privacy</strong> i zaznacz opcję <em>"Używaj usług rozpoznawania mowy Google"</em>, lub otwórz tę stronę w <strong>Google Chrome / Safari</strong>.
                `);
            }
        };

        recognition.onend = () => {
            console.log('[Speech] Recognition ended');
            // Automatyczny restart w trybie ciągłym
            if (isListening) {
                setTimeout(() => {
                    if (isListening) {
                        try { recognition.start(); } catch (err) {}
                    }
                }, 300);
            }
        };

        recognition.start();

    } catch (err) {
        console.error('Błąd inicjalizacji rozpoznawania mowy:', err);
    }
}

btnMasterMic.addEventListener('click', toggleMasterListening);
btnToggleMic.addEventListener('click', toggleMasterListening);

// ==================== Routing Modal & Mixer Toolbar Logic ====================
const routingModal = document.getElementById('routing-modal');
const btnOpenRouting = document.getElementById('btn-open-routing');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelRouting = document.getElementById('btn-cancel-routing');
const btnSaveRouting = document.getElementById('btn-save-routing');
const btnAddChannel = document.getElementById('btn-add-channel');
const deviceSelect = document.getElementById('device-select');
const routingRowsContainer = document.getElementById('routing-rows-container');
const directDeviceSelect = document.getElementById('direct-device-select');
const btnQuickPatchbay = document.getElementById('btn-quick-patchbay');

let modalChannels = [];

function openRoutingModal() {
    routingModal.classList.remove('hidden');
    loadDevicesAndRouting();
}

function closeRoutingModal() {
    routingModal.classList.add('hidden');
}

async function loadDevicesAndRouting() {
    try {
        const devRes = await fetch('/api/audio-devices');
        let devices = await devRes.json();

        // Sprawdź czy Safari ma wykryte fizyczne wejścia USB
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            try {
                const browserDevs = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = browserDevs.filter(d => d.kind === 'audioinput' && d.label);
                audioInputs.forEach(bd => {
                    if (!devices.some(d => d.name.toLowerCase().includes(bd.label.toLowerCase()))) {
                        devices.unshift({
                            name: bd.label,
                            channels: bd.label.toLowerCase().includes('mr18') ? 18 : 2,
                            is_default: false
                        });
                    }
                });
            } catch (err) {}
        }

        // Aktualizuj dropdowny w modalu oraz w pasku głównym
        if (deviceSelect) deviceSelect.innerHTML = '';
        if (directDeviceSelect) directDeviceSelect.innerHTML = '';

        devices.forEach(d => {
            const isMr18 = d.name.toLowerCase().includes('mr18');
            const icon = isMr18 ? '🎛️ ' : '🎙️ ';
            const label = `${icon}${d.name} (${d.channels} ch)`;

            if (deviceSelect) {
                const opt1 = document.createElement('option');
                opt1.value = d.name;
                opt1.innerText = label;
                deviceSelect.appendChild(opt1);
            }
            if (directDeviceSelect) {
                const opt2 = document.createElement('option');
                opt2.value = d.name;
                opt2.innerText = label;
                directDeviceSelect.appendChild(opt2);
            }
        });

        const cfgRes = await fetch('/api/config/routing');
        const cfg = await cfgRes.json();

        // Ustaw urządzenie PRZED renderowaniem wierszy (ważna kolejność!)
        if (cfg.default_device) {
            if (deviceSelect) deviceSelect.value = cfg.default_device;
            if (directDeviceSelect) directDeviceSelect.value = cfg.default_device;
        }

        modalChannels = JSON.parse(JSON.stringify(cfg.channels || []));

        // Odśwież wiersze gdy urządzenie w modalu się zmienia
        if (deviceSelect) {
            deviceSelect.removeEventListener('change', renderRoutingRows);
            deviceSelect.addEventListener('change', renderRoutingRows);
        }

        renderRoutingRows();
    } catch (e) {
        console.error('Błąd ładowania krosownicy:', e);
        routingRowsContainer.innerHTML = `<tr><td colspan="6" style="color:#ef4444;padding:16px;">Błąd ładowania konfiguracji routingu. Sprawdź konsolę.</td></tr>`;
    }
}

function renderRoutingRows() {
    routingRowsContainer.innerHTML = '';
    const selectedDevName = (deviceSelect ? deviceSelect.value : '') || '';
    const isMidas = selectedDevName.toLowerCase().includes('mr18')
        || selectedDevName.toLowerCase().includes('midas')
        || selectedDevName.toLowerCase().includes('xr18');
    const isBehringer = selectedDevName.toLowerCase().includes('x32') || selectedDevName.toLowerCase().includes('m32');
    const isDante = selectedDevName.toLowerCase().includes('dante');
    const maxChannels = isMidas ? 18 : (isBehringer || isDante) ? 32 : 32;

    modalChannels.forEach((ch, idx) => {
        const tr = document.createElement('tr');

        let inputOptions = '';
        for (let i = 1; i <= maxChannels; i++) {
            const hwCh = ch.hardware_channel || ch.id;
            const selected = hwCh === i ? 'selected' : '';
            let label = '';
            if (isMidas) {
                if (i <= 16) label = `Midas IN ${String(i).padStart(2,'0')} – Mic/Line ${i}`;
                else if (i === 17) label = `Midas IN 17 – Aux L`;
                else if (i === 18) label = `Midas IN 18 – Aux R`;
            } else {
                label = `Input ${String(i).padStart(2,'0')}`;
            }
            inputOptions += `<option value="${i}" ${selected}>${label}</option>`;
        }

        tr.innerHTML = `
            <td><strong style="font-family:var(--font-mono);color:#94a3b8">CH ${ch.id}</strong></td>
            <td>
                <input type="text" class="table-input ch-name" value="${ch.name}" placeholder="Nazwa instrumentu">
            </td>
            <td>
                <input type="text" class="table-input ch-role" value="${ch.role}" placeholder="Rola sceniczna">
            </td>
            <td>
                <select class="table-input ch-input">
                    ${inputOptions}
                </select>
            </td>
            <td style="text-align: center;">
                <input type="color" class="color-picker-input ch-color" value="${ch.color || '#3b82f6'}">
            </td>
            <td>
                <button type="button" class="btn-del-row" title="Usuń kanał" onclick="removeRoutingRow(${idx})">&times;</button>
            </td>
        `;
        routingRowsContainer.appendChild(tr);
    });
}

// Zmiana urządzenia w pasku głównym
if (directDeviceSelect) {
    directDeviceSelect.addEventListener('change', async () => {
        const chosen = directDeviceSelect.value;
        if (deviceSelect) deviceSelect.value = chosen;
        try {
            await fetch('/api/config/routing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audio_device: chosen,
                    channels: channels.map(c => ({
                        id: c.id,
                        name: c.name,
                        role: c.role,
                        hardware_channel: c.hardware_channel || c.id,
                        color: c.color,
                        active: c.active
                    }))
                })
            });
        } catch (err) {
            console.error(err);
        }
    });
}

if (btnQuickPatchbay) {
    btnQuickPatchbay.addEventListener('click', openRoutingModal);
}

window.removeRoutingRow = function(index) {
    modalChannels.splice(index, 1);
    renderRoutingRows();
};

btnAddChannel.addEventListener('click', () => {
    const nextId = modalChannels.length > 0 ? Math.max(...modalChannels.map(c => c.id)) + 1 : 1;
    modalChannels.push({
        id: nextId,
        name: `Nowy Muzyk (CH ${nextId})`,
        role: 'Instrument / Wokal',
        hardware_channel: nextId <= 32 ? nextId : 1,
        color: '#f59e0b',
        active: true
    });
    renderRoutingRows();
});

btnSaveRouting.addEventListener('click', async () => {
    const rows = routingRowsContainer.querySelectorAll('tr');
    const updated = [];

    rows.forEach((tr, i) => {
        const id = modalChannels[i].id;
        const name = tr.querySelector('.ch-name').value.trim();
        const role = tr.querySelector('.ch-role').value.trim();
        const hwInput = parseInt(tr.querySelector('.ch-input').value);
        const color = tr.querySelector('.ch-color').value;

        updated.push({
            id: id,
            name: name || `CH ${id}`,
            role: role || 'Wykonawca',
            hardware_channel: hwInput,
            color: color,
            active: true
        });
    });

    const payload = {
        audio_device: deviceSelect.value,
        channels: updated
    };

    try {
        btnSaveRouting.innerText = '⏳ Zapisywanie...';
        btnSaveRouting.disabled = true;
        const res = await fetch('/api/config/routing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            btnSaveRouting.innerText = '✅ Zapisano!';
            setTimeout(() => {
                btnSaveRouting.innerText = 'Zapisz krosownicę (Routing)';
                btnSaveRouting.disabled = false;
                closeRoutingModal();
            }, 800);
        } else {
            const err = await res.json().catch(() => ({}));
            alert(`Błąd zapisu routingu: ${err.detail || res.status}`);
            btnSaveRouting.innerText = 'Zapisz krosownicę (Routing)';
            btnSaveRouting.disabled = false;
        }
    } catch (e) {
        console.error('Błąd zapisywania routingu:', e);
        alert('Nie udało się połączyć z serwerem. Sprawdź czy serwer działa.');
        btnSaveRouting.innerText = 'Zapisz krosownicę (Routing)';
        btnSaveRouting.disabled = false;
    }
});

btnOpenRouting.addEventListener('click', openRoutingModal);
btnCloseModal.addEventListener('click', closeRoutingModal);
btnCancelRouting.addEventListener('click', closeRoutingModal);

// ==================== Tablet Modal Logic ====================
const tabletModal = document.getElementById('tablet-modal');
const btnOpenTabletModal = document.getElementById('btn-open-tablet-modal');
const btnCloseTabletModal = document.getElementById('btn-close-tablet-modal');
const tabletUrlLink = document.getElementById('tablet-url-link');
const tabletQrImg = document.getElementById('tablet-qr-img');
const tabletOpenBtn = document.getElementById('tablet-open-btn');

async function openTabletModal() {
    tabletModal.classList.remove('hidden');
    try {
        const res = await fetch('/api/info');
        const info = await res.json();
        const fullUrl = info.tablet_url || `${window.location.origin}/tablet`;

        tabletUrlLink.innerText = fullUrl;
        tabletUrlLink.href = fullUrl;
        if (tabletOpenBtn) tabletOpenBtn.href = fullUrl;

        // QR kod do łatwego skanowania aparatem telefonu/tabletu
        tabletQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(fullUrl)}`;
    } catch (e) {
        const fallbackUrl = `${window.location.origin}/tablet`;
        tabletUrlLink.innerText = fallbackUrl;
        tabletUrlLink.href = fallbackUrl;
    }
}

function closeTabletModal() {
    tabletModal.classList.add('hidden');
}

if (btnOpenTabletModal) btnOpenTabletModal.addEventListener('click', openTabletModal);
if (btnCloseTabletModal) btnCloseTabletModal.addEventListener('click', closeTabletModal);

// Init
window.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
    loadPresets();
    loadDevicesAndRouting();
});
