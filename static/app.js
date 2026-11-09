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

// Render Channels
function renderChannels() {
    if (!channelsContainer) return;
    channelsContainer.innerHTML = '';
    activeChannelsCount.innerText = `${channels.length} KANAŁÓW AKTYWNYCH`;

    channels.forEach(ch => {
        const card = document.createElement('div');
        const hasUrgent = messages.some(m => m.channel_id === ch.id && !m.resolved && m.priority === 'urgent');
        const hasAlert = ch.active_requests_count > 0;

        card.className = `channel-card ${hasUrgent ? 'has-urgent' : (hasAlert ? 'has-alert' : '')}`;
        card.id = `channel-card-${ch.id}`;

        const lastMsgText = ch.last_message || 'Brak aktywnych uwag';
        const lastTime = ch.last_timestamp ? `<small style="float:right;color:#64748b">${ch.last_timestamp}</small>` : '';
        const isMicActiveHere = selectedMicChannelId === ch.id;

        card.innerHTML = `
            <div class="channel-top">
                <div style="display: flex; align-items: center;">
                    <span class="channel-id-badge" style="background: ${ch.color}">CH 0${ch.id}</span>
                    <span class="channel-hw-badge" title="Fizyczne wejście miksera">IN ${ch.hardware_channel || ch.id}</span>
                </div>
                <span class="channel-req-count ${ch.active_requests_count > 0 ? 'active-count' : ''}">
                    ${ch.active_requests_count} ${ch.active_requests_count === 1 ? 'prośba' : 'próśb'}
                </span>
            </div>
            <div class="channel-name">${ch.name}</div>
            <div class="channel-role">${ch.role}</div>
            <div class="channel-meters" id="channel-meter-${ch.id}">
                <div class="meter-bar active-green"></div>
                <div class="meter-bar active-green"></div>
                <div class="meter-bar ${hasAlert ? 'active-yellow' : ''}"></div>
                <div class="meter-bar ${hasUrgent ? 'active-red' : ''}"></div>
            </div>
            <div class="channel-last-msg" style="border-left-color: ${ch.color}">
                <div style="width: 100%">
                    <div>${lastMsgText}</div>
                    ${lastTime}
                </div>
            </div>
            <div class="card-live-speech hidden" id="card-speech-${ch.id}">
                <span>💬</span>
                <span class="card-speech-text">Mówi...</span>
            </div>
            <button type="button" class="btn-card-talk ${isMicActiveHere ? 'selected-mic' : ''}" onclick="selectMicChannel(${ch.id})">
                ${isMicActiveHere ? '● Mikrofon aktywny na tym wejściu' : '🎙️ Przypisz mikrofon do tego wejścia'}
            </button>
        `;
        channelsContainer.appendChild(card);
    });
}

// Render Messages Feed
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
        item.className = `msg-card ${m.priority === 'urgent' ? 'urgent' : 'normal'} ${m.resolved ? 'resolved' : ''}`;

        item.innerHTML = `
            <div class="msg-header">
                <span class="msg-musician">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${getChannelColor(m.channel_id)}"></span>
                    ${m.musician} (CH ${m.channel_id})
                </span>
                <span class="msg-time">${m.timestamp}</span>
            </div>
            <div class="msg-summary">
                <span>${m.summary}</span>
                <span class="tag-action tag-${m.action_type}">${m.action_display}</span>
            </div>
            <div class="msg-raw">"${m.raw_text}"</div>
            <div class="msg-footer">
                <span class="msg-element-badge">Element: <strong>${m.element}</strong></span>
                ${m.resolved
                    ? '<span class="resolved-indicator">✓ ZROBIONE</span>'
                    : `<button class="btn-resolve" onclick="resolveMessage('${m.id}')">✓ Oznacz jako zrobione</button>`
                }
            </div>
        `;
        messagesContainer.appendChild(item);
    });
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
                // Pokazuj na żywo na banerze
                liveTranscriptionPreview.innerText = `"${currentSpeech}"`;
                liveTranscriptionPreview.classList.add('active-speaking');

                // Pokazuj na żywo na kafelku wybranego kanału (CH 1 / Input 1)
                const cardSpeech = document.getElementById(`card-speech-${selectedMicChannelId}`);
                if (cardSpeech) {
                    cardSpeech.classList.remove('hidden');
                    const textEl = cardSpeech.querySelector('.card-speech-text');
                    if (textEl) textEl.innerText = `"${currentSpeech}"`;
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

// ==================== Routing Modal Logic ====================
const routingModal = document.getElementById('routing-modal');
const btnOpenRouting = document.getElementById('btn-open-routing');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelRouting = document.getElementById('btn-cancel-routing');
const btnSaveRouting = document.getElementById('btn-save-routing');
const btnAddChannel = document.getElementById('btn-add-channel');
const deviceSelect = document.getElementById('device-select');
const routingRowsContainer = document.getElementById('routing-rows-container');

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
        const devices = await devRes.json();

        deviceSelect.innerHTML = '';
        devices.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.name;
            opt.innerText = `${d.name} (${d.channels} ch)`;
            deviceSelect.appendChild(opt);
        });

        const cfgRes = await fetch('/api/config/routing');
        const cfg = await cfgRes.json();

        if (cfg.default_device) {
            deviceSelect.value = cfg.default_device;
        }

        modalChannels = JSON.parse(JSON.stringify(cfg.channels || []));
        renderRoutingRows();
    } catch (e) {
        console.error('Błąd ładowania krosownicy:', e);
    }
}

function renderRoutingRows() {
    routingRowsContainer.innerHTML = '';

    modalChannels.forEach((ch, idx) => {
        const tr = document.createElement('tr');

        let inputOptions = '';
        for (let i = 1; i <= 32; i++) {
            const selected = (ch.hardware_channel || ch.id) === i ? 'selected' : '';
            inputOptions += `<option value="${i}" ${selected}>Input ${i} (Fizyczne In ${i})</option>`;
        }

        tr.innerHTML = `
            <td><strong style="font-family:var(--font-mono);color:#94a3b8">CH ${ch.id}</strong></td>
            <td>
                <input type="text" class="table-input ch-name" value="${ch.name}" placeholder="Nazwa muzyka">
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
        btnSaveRouting.innerText = 'Zapisywanie...';
        const res = await fetch('/api/config/routing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            closeRoutingModal();
        }
    } catch (e) {
        console.error('Błąd zapisywania routingu:', e);
        alert('Nie udało się zapisać krosownicy.');
    } finally {
        btnSaveRouting.innerText = 'Zapisz krosownicę (Routing)';
    }
});

btnOpenRouting.addEventListener('click', openRoutingModal);
btnCloseModal.addEventListener('click', closeRoutingModal);
btnCancelRouting.addEventListener('click', closeRoutingModal);

// Init
window.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
    loadPresets();
});
