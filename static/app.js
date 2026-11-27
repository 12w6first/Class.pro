// ==================== State ====================
let ws = null;
let channels = [];
let messages = [];
let activeFilter = 'all';
let availableDevices = [];
let modalChannels = [];

// Multi-Channel Backend Capture State
let listenStatus = {
    listening: false,
    device_name: '',
    device_channels: 0,
    active_channel_ids: [],
    unavailable_channel_ids: [],
    muted_channel_ids: [],
    model_name: 'medium',
    model_state: 'unloaded',
    vad_threshold_db: -38.0,
    error: null,
};

// ==================== DOM Elements ====================
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

// Feed Drawer Elements
const feedDrawer = document.getElementById('feed-drawer');
const feedOverlay = document.getElementById('feed-overlay');
const btnOpenFeed = document.getElementById('btn-open-feed');
const btnCloseFeed = document.getElementById('btn-close-feed');
const feedBadge = document.getElementById('feed-badge');

// FOH Dock Elements
const btnMasterMic = document.getElementById('btn-master-mic');
const masterMicText = document.getElementById('master-mic-text');
const masterMicDot = document.getElementById('master-mic-dot');
const liveMicBanner = document.getElementById('live-mic-banner');
const liveVuFill = document.getElementById('live-vu-fill');
const liveVuDb = document.getElementById('live-vu-db');
const liveTranscriptionPreview = document.getElementById('live-transcription-preview');
const micErrorHint = document.getElementById('mic-error-hint');
const activeMicChannelLabel = document.getElementById('active-mic-channel-label');
const sttModelPill = document.getElementById('stt-model-pill');
const whisperModelSelect = document.getElementById('whisper-model-select');
const vadSlider = document.getElementById('vad-slider');
const vadValue = document.getElementById('vad-value');
const btnLiveMode = document.getElementById('btn-live-mode');
const urgentFlashOverlay = document.getElementById('urgent-flash-overlay');

// Routing Modal & Mixer Toolbar Elements
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
const sceneSelect = document.getElementById('scene-select');
const btnLoadScene = document.getElementById('btn-load-scene');
const btnDeleteScene = document.getElementById('btn-delete-scene');
const sceneNameInput = document.getElementById('scene-name-input');
const btnSaveScene = document.getElementById('btn-save-scene');

// Tablet Modal Elements
const tabletModal = document.getElementById('tablet-modal');
const btnOpenTabletModal = document.getElementById('btn-open-tablet-modal');
const btnCloseTabletModal = document.getElementById('btn-close-tablet-modal');
const tabletUrlLink = document.getElementById('tablet-url-link');
const tabletQrImg = document.getElementById('tablet-qr-img');
const tabletOpenBtn = document.getElementById('tablet-open-btn');

// ==================== Live Mode & Urgent Stage Flash ====================
function applyLiveMode(enabled) {
    document.body.classList.toggle('live-mode', !!enabled);
    if (btnLiveMode) btnLiveMode.classList.toggle('active', !!enabled);
    try {
        localStorage.setItem('aiLiveMonitor_liveMode', enabled ? '1' : '0');
    } catch (e) {}
}

if (btnLiveMode) {
    btnLiveMode.addEventListener('click', () => {
        applyLiveMode(!document.body.classList.contains('live-mode'));
    });
}

function triggerUrgentFlash() {
    if (!urgentFlashOverlay) return;
    urgentFlashOverlay.classList.remove('flash-active');
    void urgentFlashOverlay.offsetWidth; // reset animation
    urgentFlashOverlay.classList.add('flash-active');
}

// ==================== Digital Clock ====================
function updateClock() {
    const now = new Date();
    if (digitalClock) digitalClock.innerText = now.toTimeString().split(' ')[0];
}
setInterval(updateClock, 1000);
updateClock();

// ==================== Feed Drawer ====================
function openFeedDrawer() {
    if (!feedDrawer) return;
    feedDrawer.classList.add('open');
    if (feedOverlay) feedOverlay.classList.remove('hidden');
    if (btnOpenFeed) btnOpenFeed.classList.add('active-feed');
}
window.openFeedDrawer = openFeedDrawer;

function closeFeedDrawer() {
    if (!feedDrawer) return;
    feedDrawer.classList.remove('open');
    if (feedOverlay) feedOverlay.classList.add('hidden');
    if (btnOpenFeed) btnOpenFeed.classList.remove('active-feed');
}

function toggleFeedDrawer() {
    if (feedDrawer && feedDrawer.classList.contains('open')) closeFeedDrawer();
    else openFeedDrawer();
}

if (btnOpenFeed) btnOpenFeed.addEventListener('click', toggleFeedDrawer);
if (btnCloseFeed) btnCloseFeed.addEventListener('click', closeFeedDrawer);
if (feedOverlay) feedOverlay.addEventListener('click', closeFeedDrawer);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && feedDrawer && feedDrawer.classList.contains('open')) {
        closeFeedDrawer();
    }
});

function isEngineerRelevant(m) {
    if (!m) return false;
    if (m.priority === 'urgent') return true;
    if (m.action_type && m.action_type !== 'info') return true;
    return highlightAudioKeywords(m.raw_text).hasAudio;
}

function updateFeedBadge() {
    if (!feedBadge) return;
    const fohCount = messages.filter(m => isEngineerRelevant(m)).length;
    if (fohCount > 0) {
        feedBadge.innerText = fohCount;
        feedBadge.classList.remove('hidden');
    } else {
        feedBadge.innerText = '0';
        feedBadge.classList.add('hidden');
    }
}

// ==================== WebSocket Connection ====================
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
        if (data.listen_status) {
            applyListenStatus(data.listen_status);
        }
        renderChannels();
        renderMessages();
        updateFeedBadge();
        updateCustomSelect();
    } else if (type === 'new_message') {
        messages.unshift(data);
        renderChannels();
        renderMessages();
        updateFeedBadge();
        if (data.priority === 'urgent') {
            triggerUrgentFlash();
        }
        if (liveTranscriptionPreview && data.raw_text) {
            const { html } = highlightAudioKeywords(data.raw_text);
            liveTranscriptionPreview.innerHTML = `[CH ${String(data.channel_id).padStart(2, '0')} ${data.musician}]: „${html}”`;
            liveTranscriptionPreview.classList.add('active-speaking');
        }
    } else if (type === 'channel_update') {
        channels = data;
        renderChannels();
        updateCustomSelect();
    } else if (type === 'resolve_message') {
        const target = messages.find(m => m.id === data.id);
        if (target) target.resolved = true;
        renderChannels();
        renderMessages();
        updateFeedBadge();
    } else if (type === 'clear_all') {
        messages = [];
        renderChannels();
        renderMessages();
        updateFeedBadge();
    } else if (type === 'listen_status') {
        applyListenStatus(data);
        renderChannels();
    } else if (type === 'vu_levels') {
        applyVuLevels(data);
    } else if (type === 'channel_speaking') {
        applyChannelSpeaking(data);
    }
}

// ==================== Multi-Channel Backend Control ====================
function showMicError(msgHtml) {
    if (micErrorHint) {
        micErrorHint.innerHTML = msgHtml;
        micErrorHint.classList.remove('hidden');
    }
}

function hideMicError() {
    if (micErrorHint) micErrorHint.classList.add('hidden');
}

function applyListenStatus(st) {
    if (!st) return;
    listenStatus = st;

    const active = !!st.listening;
    if (active) {
        btnMasterMic.classList.add('listening');
        masterMicText.innerText = 'NASŁUCH AKTYWNY (STOP)';
        liveMicBanner.classList.add('active-listening');
        btnToggleMic.classList.add('recording');
        micText.innerText = 'Nasłuch ON';
    } else {
        btnMasterMic.classList.remove('listening');
        masterMicText.innerText = 'NASŁUCH WSZYSTKICH TORÓW (START)';
        liveMicBanner.classList.remove('active-listening');
        btnToggleMic.classList.remove('recording');
        micText.innerText = 'Mikrofon';
        if (liveVuFill) liveVuFill.style.width = '0%';
        if (liveVuDb) liveVuDb.innerText = 'OFF';
    }

    // Model Whisper dropdown + status pill
    if (whisperModelSelect && st.model_name) {
        whisperModelSelect.value = st.model_name;
    }
    if (sttModelPill) {
        sttModelPill.classList.remove('ready', 'loading', 'error');
        if (st.model_state === 'loading') {
            sttModelPill.innerText = 'ŁADOWANIE...';
            sttModelPill.classList.add('loading');
        } else if (st.model_state === 'ready') {
            sttModelPill.innerText = 'GOTOWY';
            sttModelPill.classList.add('ready');
        } else if (st.model_state === 'error') {
            sttModelPill.innerText = 'BŁĄD';
            sttModelPill.classList.add('error');
        } else {
            sttModelPill.innerText = 'IDLE';
        }
    }

    // Active channels summary
    if (activeMicChannelLabel) {
        if (active) {
            const activeCount = (st.active_channel_ids || []).length;
            activeMicChannelLabel.innerText = `${activeCount}/${channels.length} TORÓW • ${st.device_channels || 0} CH`;
        } else {
            activeMicChannelLabel.innerText = 'WYŁĄCZONY';
        }
    }

    // VAD slider sync
    if (typeof st.vad_threshold_db === 'number') {
        if (vadSlider) vadSlider.value = String(Math.round(st.vad_threshold_db));
        if (vadValue) vadValue.innerText = `${Math.round(st.vad_threshold_db)} dB`;
    }

    // Status message
    if (st.error) {
        showMicError(`<strong>Błąd nasłuchu wielokanałowego:</strong> ${st.error}`);
    } else if (st.model_error) {
        showMicError(`<strong>Błąd modelu Whisper:</strong> ${st.model_error}`);
    } else {
        hideMicError();
    }

    if (liveTranscriptionPreview && !active) {
        liveTranscriptionPreview.innerText = 'Wybierz interfejs/mikser i kliknij START — nasłuch wszystkich torów równolegle.';
        liveTranscriptionPreview.classList.remove('active-speaking');
    } else if (liveTranscriptionPreview && active && !liveTranscriptionPreview.classList.contains('active-speaking')) {
        liveTranscriptionPreview.innerText = `Nasłuch równoległy na '${st.device_name}' (${st.device_channels} ch) — mów na dowolnym podpiętym wejściu...`;
    }
}

function applyVuLevels(data) {
    if (!data) return;

    // Master VU bar
    const masterPct = data.master_pct || 0;
    const masterDb = data.master_db ?? -80;
    if (liveVuFill) liveVuFill.style.width = `${masterPct}%`;
    if (liveVuDb) liveVuDb.innerText = masterPct > 2 ? `${Math.round(masterDb)} dB` : '-inf dB';

    // Per-channel 4-LED OLED VU meters (all hardware inputs simultaneously!)
    const chMap = data.channels || {};
    Object.entries(chMap).forEach(([chId, info]) => {
        const chMeter = document.getElementById(`channel-meter-${chId}`);
        if (!chMeter) return;
        const bars = chMeter.querySelectorAll('.meter-bar');
        if (bars.length < 4) return;
        const pct = info.available && !info.muted ? (info.pct || 0) : 0;
        bars[0].className = pct > 8 ? 'meter-bar active-green' : 'meter-bar';
        bars[1].className = pct > 32 ? 'meter-bar active-green' : 'meter-bar';
        bars[2].className = pct > 62 ? 'meter-bar active-yellow' : 'meter-bar';
        bars[3].className = pct > 85 ? 'meter-bar active-red' : 'meter-bar';
    });
}

function applyChannelSpeaking(ev) {
    if (!ev) return;
    const cardSpeech = document.getElementById(`card-speech-${ev.channel_id}`);
    if (!cardSpeech) return;
    const textEl = cardSpeech.querySelector('.card-speech-text');
    const badgeEl = cardSpeech.querySelector('.transcript-badge');

    cardSpeech.classList.remove('is-speaking', 'is-transcribing');

    if (ev.state === 'speaking') {
        cardSpeech.classList.remove('hidden');
        cardSpeech.classList.add('is-speaking');
        if (badgeEl) badgeEl.innerText = 'MÓWI';
        if (textEl) textEl.innerText = 'Wykryto głos na wejściu — nagrywanie wypowiedzi...';
    } else if (ev.state === 'transcribing') {
        cardSpeech.classList.remove('hidden');
        cardSpeech.classList.add('is-transcribing');
        if (badgeEl) badgeEl.innerText = 'AI STT';
        if (textEl) textEl.innerText = 'Whisper analizuje wypowiedź muzyka...';
    } else {
        cardSpeech.classList.add('hidden');
    }
}

async function toggleMasterListening() {
    hideMicError();
    if (listenStatus.listening) {
        try {
            const res = await fetch('/api/listen/stop', { method: 'POST' });
            const st = await res.json();
            applyListenStatus(st);
            renderChannels();
        } catch (e) {
            showMicError(`Błąd zatrzymywania nasłuchu: ${e.message}`);
        }
    } else {
        const chosenDevice = (directDeviceSelect && directDeviceSelect.value) || null;
        const vadDb = vadSlider ? parseFloat(vadSlider.value) : -38.0;
        if (masterMicText) masterMicText.innerText = 'URUCHAMIANIE...';
        try {
            const res = await fetch('/api/listen/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_name: chosenDevice,
                    vad_threshold_db: vadDb,
                }),
            });
            const st = await res.json();
            applyListenStatus(st);
            renderChannels();
        } catch (e) {
            showMicError(`Błąd uruchamiania nasłuchu wielokanałowego: ${e.message}`);
            applyListenStatus({ ...listenStatus, listening: false });
        }
    }
}

window.toggleChannelMute = async function(channelId) {
    const isMuted = (listenStatus.muted_channel_ids || []).includes(channelId);
    try {
        const res = await fetch('/api/listen/mute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel_id: channelId, muted: !isMuted }),
        });
        const st = await res.json();
        applyListenStatus(st);
        renderChannels();
    } catch (e) {
        console.error('Błąd wyciszania toru:', e);
    }
};

if (btnMasterMic) btnMasterMic.addEventListener('click', toggleMasterListening);
if (btnToggleMic) btnToggleMic.addEventListener('click', toggleMasterListening);

if (whisperModelSelect) {
    whisperModelSelect.addEventListener('change', async () => {
        const modelName = whisperModelSelect.value;
        try {
            const res = await fetch('/api/listen/model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_name: modelName }),
            });
            if (res.ok) {
                const st = await res.json();
                applyListenStatus(st);
            }
        } catch (e) {
            console.error('Błąd zmiany modelu Whisper:', e);
        }
    });
}

if (vadSlider) {
    vadSlider.addEventListener('input', () => {
        if (vadValue) vadValue.innerText = `${vadSlider.value} dB`;
    });
    vadSlider.addEventListener('change', async () => {
        const val = parseFloat(vadSlider.value);
        try {
            await fetch('/api/listen/vad', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ threshold_db: val }),
            });
        } catch (e) {
            console.error('Błąd aktualizacji VAD:', e);
        }
    });
}

// ==================== Audio / Instrument Keyword Highlighting ====================
const AUDIO_INSTRUMENT_PATTERNS = [
    /\b(?:bas|basu|basem|basie|basowa|gitara|gitarę|gitary|gitarze|wiosło|akustyk|elektryk)\b/gi,
    /\b(?:stopa|stopę|stopy|stopie|kick|werbel|werbla|werblem|snare)\b/gi,
    /\b(?:perkusja|perkusji|perkusję|bębny|bębnów|tomy|tomów|talerze|talerzy|hi-?hat|blachy|blach)\b/gi,
    /\b(?:klawisz|klawisze|klawisza|klawiszy|piano|pianino|pianina|synth|syntezator)\b/gi,
    /\b(?:wokal|wokalu|wokalem|wokalowi|wokalist[a-zęóąśłżźćń]*|głos|głosu|śpiew|chór[a-zęóąśłżźćń]*|mikrofon[a-zęóąśłżźćń]*|talkback)\b/gi,
    /\b(?:skrzypce|dęciaki|trąbka|saksofon)\b/gi,
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

// ==================== Render Full-Width Monitor Strips ====================
function getCurrentDeviceChannelsLimit() {
    if (listenStatus.listening && listenStatus.device_channels > 0) {
        return listenStatus.device_channels;
    }
    const chosen = (directDeviceSelect && directDeviceSelect.value) || '';
    const found = availableDevices.find(d => d.name === chosen);
    return found ? found.channels : 0;
}

function renderChannels() {
    if (!channelsContainer) return;
    channelsContainer.innerHTML = '';
    if (activeChannelsCount) {
        activeChannelsCount.innerText = `${channels.length} INSTRUMENTÓW`;
    }

    const devChLimit = getCurrentDeviceChannelsLimit();
    const mutedIds = listenStatus.muted_channel_ids || [];

    channels.forEach(ch => {
        const strip = document.createElement('div');
        const chMsgs = messages.filter(m => m.channel_id === ch.id);
        const latestMsg = chMsgs[0] || null;
        const latestIsUrgent = latestMsg && latestMsg.priority === 'urgent';
        const latestIsFoh = latestMsg && isEngineerRelevant(latestMsg);

        strip.className = `channel-strip-wide ${latestIsUrgent ? 'has-urgent' : (latestIsFoh ? 'has-alert' : '')}`;
        strip.id = `channel-card-${ch.id}`;
        strip.style.borderLeftColor = ch.color || '#3b82f6';

        const hwIn = ch.hardware_channel || ch.id;
        const chNum = String(ch.id).padStart(2, '0');
        const hwNum = String(hwIn).padStart(2, '0');
        const isMuted = mutedIds.includes(ch.id);
        const isHwAvailable = devChLimit === 0 || hwIn <= devChLimit;

        // Czyste wyświetlanie co muzyk mówi — bez zadań; ważne dla realizatora mocno wyróżnione
        let statusContentHtml = '';
        if (chMsgs.length > 0) {
            statusContentHtml = `<div class="strip-requests-list">` + chMsgs.slice(0, 2).map(m => {
                const { html: highlighted, hasAudio } = highlightAudioKeywords(m.raw_text);
                const relevant = m.priority === 'urgent' || (m.action_type && m.action_type !== 'info') || hasAudio;
                const isUrgent = m.priority === 'urgent';
                const itemCls = isUrgent ? 'is-urgent' : (relevant ? '' : 'is-casual');
                const roleBadge = isUrgent
                    ? `<span class="strip-urgent-pill">PILNE</span>`
                    : (relevant ? `<span class="strip-foh-pill">DLA REALIZATORA</span>` : '');
                const actionBadge = (relevant && m.action_type && m.action_type !== 'info')
                    ? `<span class="tag-action tag-${m.action_type}">${m.action_display}</span>`
                    : '';
                const summaryHint = (relevant && m.action_type && m.action_type !== 'info')
                    ? `<span class="strip-req-summary">${m.summary}</span>`
                    : '';

                return `
                    <div class="strip-req-item ${itemCls}">
                        <div class="strip-req-main">
                            <div class="strip-speech-big">„${highlighted}”</div>
                            <div class="strip-req-top">
                                ${roleBadge}
                                ${actionBadge}
                                ${summaryHint}
                                <span class="strip-req-time">${m.timestamp}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('') + `</div>`;
        } else {
            statusContentHtml = `
                <div class="strip-status-box">
                    <span class="strip-ok-text"><span class="ok-dot"></span>Cisza na torze — nasłuch gotowy</span>
                </div>
            `;
        }

        // Przycisk statusu nasłuchu dla tego fizycznego wejścia
        let micCtrlBtnHtml = '';
        if (!isHwAvailable) {
            micCtrlBtnHtml = `
                <button type="button" class="btn-strip-talk is-unavailable" disabled title="Wybrane urządzenie ma tylko ${devChLimit} wejść — zmień wejście w Krosownicy lub podepnij mikser wielokanałowy">
                    BRAK IN ${hwNum} (MAX ${devChLimit})
                </button>
            `;
        } else if (isMuted) {
            micCtrlBtnHtml = `
                <button type="button" class="btn-strip-talk is-muted" onclick="toggleChannelMute(${ch.id})" title="Kliknij aby wznowić nasłuch STT na tym torze">
                    WYCISZONY (IN ${hwNum})
                </button>
            `;
        } else if (listenStatus.listening) {
            micCtrlBtnHtml = `
                <button type="button" class="btn-strip-talk selected-mic" onclick="toggleChannelMute(${ch.id})" title="Aktywny równoległy nasłuch z wejścia IN ${hwNum} — kliknij aby wyciszyć">
                    ● NASŁUCH IN ${hwNum}
                </button>
            `;
        } else {
            micCtrlBtnHtml = `
                <button type="button" class="btn-strip-talk" onclick="toggleChannelMute(${ch.id})" title="Tor gotowy do nasłuchu z IN ${hwNum} — kliknij aby wyciszyć">
                    GOTOWY • IN ${hwNum}
                </button>
            `;
        }

        strip.innerHTML = `
            <div class="strip-col-identity">
                <span class="strip-ch-id" style="background: ${ch.color}">CH ${chNum}</span>
                <div class="strip-names">
                    <div class="strip-instrument-name">${ch.name}</div>
                    <div class="strip-meta-line">
                        <span class="strip-hw-pill" title="Fizyczne wejście miksera">IN ${hwNum}</span>
                        <span class="strip-role-title">${ch.role}</span>
                    </div>
                </div>
            </div>

            <div class="strip-col-meters" id="channel-meter-${ch.id}">
                <span class="meter-title">SIGNAL VU</span>
                <div class="strip-meter-bar">
                    <div class="meter-bar"></div>
                    <div class="meter-bar"></div>
                    <div class="meter-bar"></div>
                    <div class="meter-bar"></div>
                </div>
            </div>

            <div class="strip-col-status">
                ${statusContentHtml}
                <div class="card-live-speech hidden" id="card-speech-${ch.id}">
                    <span class="transcript-badge">MÓWI</span>
                    <span class="card-speech-text"></span>
                </div>
            </div>

            <div class="strip-col-actions">
                ${micCtrlBtnHtml}
            </div>
        `;
        channelsContainer.appendChild(strip);
    });
}

// ==================== Render Messages Feed Drawer ====================
function renderMessages() {
    if (!messagesContainer) return;
    messagesContainer.innerHTML = '';

    const filtered = messages.filter(m => {
        if (activeFilter === 'foh') return isEngineerRelevant(m);
        if (activeFilter === 'urgent') return m.priority === 'urgent';
        return true;
    });

    if (filtered.length === 0) {
        messagesContainer.innerHTML = `
            <div class="empty-feed">
                <div class="radar-scan"></div>
                <p>Brak wypowiedzi w tej kategorii</p>
                <small>Nasłuchiwanie mikrofonów na scenie...</small>
            </div>
        `;
        return;
    }

    filtered.forEach(m => {
        const item = document.createElement('div');
        const { html: highlightedSpeech, hasAudio } = highlightAudioKeywords(m.raw_text);
        const relevant = m.priority === 'urgent' || (m.action_type && m.action_type !== 'info') || hasAudio;
        const chColor = getChannelColor(m.channel_id);
        const hwIn = getChannelHw(m.channel_id);

        item.className = `msg-card columnar-msg ${m.priority === 'urgent' ? 'urgent' : (relevant ? 'sound-alert-card' : '')}`;

        item.innerHTML = `
            <div class="columnar-header">
                <div class="col-musician">
                    <span class="musician-circle" style="background:${chColor}"></span>
                    <strong class="musician-name">${m.musician}</strong>
                    <span class="ch-badge">CH ${String(m.channel_id).padStart(2, '0')} • IN ${String(hwIn).padStart(2, '0')}</span>
                </div>
                <div class="col-badges">
                    ${m.priority === 'urgent'
                        ? '<span class="strip-urgent-pill">PILNE</span>'
                        : (relevant ? '<span class="strip-foh-pill">DLA REALIZATORA</span>' : '')}
                    <span class="col-time">${m.timestamp}</span>
                </div>
            </div>

            <div class="columnar-speech-box">
                <div class="speech-quote-mark">„</div>
                <div class="speech-text">${highlightedSpeech}</div>
            </div>

            ${relevant && m.action_type && m.action_type !== 'info' ? `
                <div class="columnar-footer">
                    <div class="col-intent">
                        <span class="tag-action tag-${m.action_type}">${m.action_display}</span>
                        <span class="intent-summary-text">${m.summary}</span>
                    </div>
                </div>
            ` : ''}
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

document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        activeFilter = e.target.dataset.filter;
        renderMessages();
    });
});

// ==================== Presets & Custom Simulation ====================
function updateCustomSelect() {
    if (!customSelect) return;
    const prevVal = customSelect.value;
    customSelect.innerHTML = '';
    channels.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch.id;
        opt.innerText = `CH ${String(ch.id).padStart(2, '0')}: ${ch.name} (IN ${ch.hardware_channel || ch.id})`;
        if (String(ch.id) === prevVal) opt.selected = true;
        customSelect.appendChild(opt);
    });
}

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

if (customForm) {
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
}

if (btnClearAll) {
    btnClearAll.addEventListener('click', async () => {
        if (confirm('Czy na pewno wyczyścić wszystkie zgłoszenia z pulpitu?')) {
            await fetch('/api/clear', { method: 'POST' });
        }
    });
}

// ==================== Routing Modal & Connected Devices ====================
function openRoutingModal() {
    routingModal.classList.remove('hidden');
    loadDevicesAndRouting();
    loadScenesList();
}

async function loadScenesList() {
    if (!sceneSelect) return;
    try {
        const res = await fetch('/api/scenes');
        const scenes = await res.json();
        sceneSelect.innerHTML = '';
        if (!scenes || scenes.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.innerText = 'Brak zapisanych scen — wpisz nazwę poniżej';
            sceneSelect.appendChild(opt);
        } else {
            scenes.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.name;
                opt.innerText = `${s.name} (${s.channels_count} ch • ${s.audio_device || 'domyślne'})`;
                sceneSelect.appendChild(opt);
            });
        }
    } catch (e) {
        console.error('Błąd ładowania scen:', e);
    }
}

function collectModalRoutingChannels() {
    const rows = routingRowsContainer.querySelectorAll('tr');
    const updated = [];
    rows.forEach((tr, i) => {
        const id = modalChannels[i].id;
        const name = tr.querySelector('.ch-name').value.trim();
        const role = tr.querySelector('.ch-role').value.trim();
        const hwInput = parseInt(tr.querySelector('.ch-input').value);
        const color = tr.querySelector('.ch-color').value;
        updated.push({
            id,
            name: name || `CH ${id}`,
            role: role || 'Wykonawca',
            hardware_channel: hwInput,
            color,
            active: true
        });
    });
    return updated;
}

if (btnSaveScene) {
    btnSaveScene.addEventListener('click', async () => {
        const name = (sceneNameInput ? sceneNameInput.value : '').trim();
        if (!name) {
            alert('Wpisz nazwę sceny (np. "Midas MR18 – Koncert").');
            if (sceneNameInput) sceneNameInput.focus();
            return;
        }
        try {
            const res = await fetch('/api/scenes/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    audio_device: deviceSelect ? deviceSelect.value : '',
                    channels: collectModalRoutingChannels(),
                }),
            });
            if (res.ok) {
                if (sceneNameInput) sceneNameInput.value = '';
                await loadScenesList();
                if (sceneSelect) sceneSelect.value = name;
            }
        } catch (e) {
            console.error('Błąd zapisu sceny:', e);
        }
    });
}

if (btnLoadScene) {
    btnLoadScene.addEventListener('click', async () => {
        const name = sceneSelect ? sceneSelect.value : '';
        if (!name) return;
        try {
            const res = await fetch('/api/scenes/load', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (res.ok) {
                await loadDevicesAndRouting();
                closeRoutingModal();
            }
        } catch (e) {
            console.error('Błąd wczytywania sceny:', e);
        }
    });
}

if (btnDeleteScene) {
    btnDeleteScene.addEventListener('click', async () => {
        const name = sceneSelect ? sceneSelect.value : '';
        if (!name) return;
        if (!confirm(`Usunąć zapisaną scenę "${name}"?`)) return;
        try {
            await fetch(`/api/scenes/${encodeURIComponent(name)}`, { method: 'DELETE' });
            await loadScenesList();
        } catch (e) {
            console.error('Błąd usuwania sceny:', e);
        }
    });
}

function closeRoutingModal() {
    routingModal.classList.add('hidden');
}

async function loadDevicesAndRouting() {
    try {
        const devRes = await fetch('/api/audio-devices');
        const devices = await devRes.json();
        availableDevices = devices;

        if (deviceSelect) deviceSelect.innerHTML = '';
        if (directDeviceSelect) directDeviceSelect.innerHTML = '';

        if (devices.length === 0) {
            [deviceSelect, directDeviceSelect].forEach(sel => {
                if (!sel) return;
                const opt = document.createElement('option');
                opt.value = '';
                opt.innerText = 'Brak podłączonych wejść audio';
                sel.appendChild(opt);
            });
        } else {
            devices.forEach(d => {
                const defaultTag = d.is_default ? ' • domyślne' : '';
                const label = `${d.name} (${d.channels} ch${defaultTag})`;
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
        }

        const cfgRes = await fetch('/api/config/routing');
        const cfg = await cfgRes.json();

        const connectedNames = devices.map(d => d.name);
        const preferredDevice = connectedNames.includes(cfg.default_device)
            ? cfg.default_device
            : (devices.find(d => d.is_default)?.name || devices[0]?.name || '');

        if (preferredDevice) {
            if (deviceSelect) deviceSelect.value = preferredDevice;
            if (directDeviceSelect) directDeviceSelect.value = preferredDevice;
        }

        modalChannels = JSON.parse(JSON.stringify(cfg.channels || []));

        if (deviceSelect) {
            deviceSelect.removeEventListener('change', renderRoutingRows);
            deviceSelect.addEventListener('change', renderRoutingRows);
        }

        renderRoutingRows();
        renderChannels();
    } catch (e) {
        console.error('Błąd ładowania krosownicy:', e);
        if (routingRowsContainer) {
            routingRowsContainer.innerHTML = `<tr><td colspan="6" style="color:#ef4444;padding:16px;">Błąd ładowania konfiguracji routingu.</td></tr>`;
        }
    }
}

function getSelectedDeviceChannelsCount(devName) {
    const found = availableDevices.find(d => d.name === devName);
    if (found && found.channels > 0) return found.channels;
    return 18;
}

function renderRoutingRows() {
    if (!routingRowsContainer) return;
    routingRowsContainer.innerHTML = '';
    const selectedDevName = (deviceSelect ? deviceSelect.value : '') || '';
    const isMidas = selectedDevName.toLowerCase().includes('mr18')
        || selectedDevName.toLowerCase().includes('midas')
        || selectedDevName.toLowerCase().includes('xr18');
    // Pozwól przypisać kanały 1..max(device_ch, najwyższy już przypisany) żeby nie gubić mapowania gdy mikser jest chwilowo odpięty
    const devCh = getSelectedDeviceChannelsCount(selectedDevName);
    const maxAssigned = modalChannels.reduce((acc, c) => Math.max(acc, c.hardware_channel || c.id), 1);
    const maxChannels = Math.max(devCh, maxAssigned);

    modalChannels.forEach((ch, idx) => {
        const tr = document.createElement('tr');
        const currentHw = ch.hardware_channel || ch.id;

        let inputOptions = '';
        for (let i = 1; i <= maxChannels; i++) {
            const selected = currentHw === i ? 'selected' : '';
            const outOfRange = i > devCh ? ' (poza aktualnym urządzeniem)' : '';
            let label = '';
            if (isMidas && i <= 18) {
                if (i <= 16) label = `Midas IN ${String(i).padStart(2, '0')} – Mic/Line ${i}`;
                else if (i === 17) label = `Midas IN 17 – Aux L`;
                else if (i === 18) label = `Midas IN 18 – Aux R`;
            } else {
                label = `Input ${String(i).padStart(2, '0')}${outOfRange}`;
            }
            inputOptions += `<option value="${i}" ${selected}>${label}</option>`;
        }

        tr.innerHTML = `
            <td><strong style="font-family:var(--font-mono);color:#94a3b8">CH ${String(ch.id).padStart(2, '0')}</strong></td>
            <td><input type="text" class="table-input ch-name" value="${ch.name}" placeholder="Nazwa instrumentu"></td>
            <td><input type="text" class="table-input ch-role" value="${ch.role}" placeholder="Rola sceniczna"></td>
            <td><select class="table-input ch-input">${inputOptions}</select></td>
            <td style="text-align: center;"><input type="color" class="color-picker-input ch-color" value="${ch.color || '#3b82f6'}"></td>
            <td><button type="button" class="btn-del-row" title="Usuń kanał" onclick="removeRoutingRow(${idx})">&times;</button></td>
        `;
        routingRowsContainer.appendChild(tr);
    });
}

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
            renderChannels();
        } catch (err) {
            console.error(err);
        }
    });
}

if (btnQuickPatchbay) btnQuickPatchbay.addEventListener('click', openRoutingModal);

window.removeRoutingRow = function(index) {
    modalChannels.splice(index, 1);
    renderRoutingRows();
};

if (btnAddChannel) {
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
}

if (btnSaveRouting) {
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
                id,
                name: name || `CH ${id}`,
                role: role || 'Wykonawca',
                hardware_channel: hwInput,
                color,
                active: true
            });
        });

        const payload = {
            audio_device: deviceSelect.value,
            channels: updated
        };

        try {
            btnSaveRouting.innerText = 'Zapisywanie...';
            btnSaveRouting.disabled = true;
            const res = await fetch('/api/config/routing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                btnSaveRouting.innerText = 'Zapisano!';
                setTimeout(() => {
                    btnSaveRouting.innerText = 'Zapisz krosownicę (Routing)';
                    btnSaveRouting.disabled = false;
                    closeRoutingModal();
                }, 600);
            } else {
                const err = await res.json().catch(() => ({}));
                alert(`Błąd zapisu routingu: ${err.detail || res.status}`);
                btnSaveRouting.innerText = 'Zapisz krosownicę (Routing)';
                btnSaveRouting.disabled = false;
            }
        } catch (e) {
            console.error('Błąd zapisywania routingu:', e);
            alert('Nie udało się połączyć z serwerem.');
            btnSaveRouting.innerText = 'Zapisz krosownicę (Routing)';
            btnSaveRouting.disabled = false;
        }
    });
}

if (btnOpenRouting) btnOpenRouting.addEventListener('click', openRoutingModal);
if (btnCloseModal) btnCloseModal.addEventListener('click', closeRoutingModal);
if (btnCancelRouting) btnCancelRouting.addEventListener('click', closeRoutingModal);

// ==================== Tablet Modal Logic ====================
async function openTabletModal() {
    tabletModal.classList.remove('hidden');
    try {
        const res = await fetch('/api/info');
        const info = await res.json();
        const fullUrl = info.tablet_url || `${window.location.origin}/tablet`;

        tabletUrlLink.innerText = fullUrl;
        tabletUrlLink.href = fullUrl;
        if (tabletOpenBtn) tabletOpenBtn.href = fullUrl;

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

// ==================== Init ====================
window.addEventListener('DOMContentLoaded', () => {
    try {
        applyLiveMode(localStorage.getItem('aiLiveMonitor_liveMode') === '1');
    } catch (e) {}
    connectWebSocket();
    loadPresets();
    loadDevicesAndRouting();

    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => {
            loadDevicesAndRouting();
        });
    }
});
