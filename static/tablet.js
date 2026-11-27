// ==================== State ====================
let ws = null;
let channels = [];
let messages = [];
let activeView = 'stage'; // stage | foh | history
let speakingStates = {}; // channel_id -> 'speaking' | 'transcribing' | 'idle'

// ==================== DOM Elements ====================
const wsIndicator = document.getElementById('ws-indicator');
const wsStatus = document.getElementById('ws-status');
const tabletClock = document.getElementById('tablet-clock');
const stageView = document.getElementById('tablet-stage-view');
const feedView = document.getElementById('tablet-feed-view');
const urgentFlashOverlay = document.getElementById('urgent-flash-overlay');

function triggerUrgentFlash() {
    if (!urgentFlashOverlay) return;
    urgentFlashOverlay.classList.remove('flash-active');
    void urgentFlashOverlay.offsetWidth;
    urgentFlashOverlay.classList.add('flash-active');
}

// ==================== Clock ====================
function updateClock() {
    const now = new Date();
    if (tabletClock) tabletClock.innerText = now.toTimeString().split(' ')[0];
}
setInterval(updateClock, 1000);
updateClock();

// ==================== Audio Keyword Highlighting ====================
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

function isEngineerRelevant(m) {
    if (!m) return false;
    if (m.priority === 'urgent') return true;
    if (m.action_type && m.action_type !== 'info') return true;
    return highlightAudioKeywords(m.raw_text).hasAudio;
}

// ==================== WebSocket Connection ====================
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        wsIndicator.className = 'pulse-indicator online';
        wsStatus.innerText = 'POŁĄCZONO NA ŻYWO';
    };

    ws.onclose = () => {
        wsIndicator.className = 'pulse-indicator';
        wsStatus.innerText = 'ROZŁĄCZONO — PONAWIAM...';
        setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => {
        console.error('WS Error:', err);
    };

    ws.onmessage = (event) => {
        try {
            handleWsMessage(JSON.parse(event.data));
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
        renderCurrentView();
    } else if (type === 'new_message') {
        messages.unshift(data);
        renderCurrentView();
        if (data.priority === 'urgent') {
            triggerUrgentFlash();
        }
        if (navigator.vibrate && isEngineerRelevant(data)) {
            navigator.vibrate(data.priority === 'urgent' ? [100, 50, 100] : 50);
        }
    } else if (type === 'channel_update') {
        channels = data;
        renderCurrentView();
    } else if (type === 'clear_all') {
        messages = [];
        renderCurrentView();
    } else if (type === 'channel_speaking') {
        if (data && data.channel_id != null) {
            speakingStates[data.channel_id] = data.state || 'idle';
            renderStageView();
        }
    }
}

// ==================== Render Views ====================
function renderCurrentView() {
    if (activeView === 'stage') {
        stageView.classList.remove('hidden');
        feedView.classList.add('hidden');
        renderStageView();
    } else {
        stageView.classList.add('hidden');
        feedView.classList.remove('hidden');
        renderFeedView();
    }
}

function renderStageView() {
    if (!stageView) return;
    stageView.innerHTML = '';

    channels.forEach(ch => {
        const chMsgs = messages.filter(m => m.channel_id === ch.id);
        const latest = chMsgs[0] || null;
        const latestUrgent = latest && latest.priority === 'urgent';
        const latestFoh = latest && isEngineerRelevant(latest);
        const spState = speakingStates[ch.id] || 'idle';

        const card = document.createElement('div');
        card.className = `stage-ch-card ${latestUrgent ? 'is-urgent' : (latestFoh ? 'is-foh' : '')}`;
        card.style.borderLeftColor = ch.color || '#3b82f6';

        const liveBadgeHtml = spState === 'speaking'
            ? `<span class="stage-live-pill speaking">● MÓWI NA ŻYWO</span>`
            : (spState === 'transcribing' ? `<span class="stage-live-pill transcribing">⏳ AI STT...</span>` : '');

        let speechHtml = '';
        if (chMsgs.length > 0) {
            speechHtml = `<div class="stage-speech-list">` + chMsgs.slice(0, 2).map(m => {
                const { html: highlighted, hasAudio } = highlightAudioKeywords(m.raw_text);
                const relevant = m.priority === 'urgent' || (m.action_type && m.action_type !== 'info') || hasAudio;
                const isUrgent = m.priority === 'urgent';
                const boxCls = isUrgent ? 'urgent-highlight' : (relevant ? 'foh-highlight' : 'casual');

                return `
                    <div class="stage-speech-box ${boxCls}">
                        <div class="stage-speech-text">„${highlighted}”</div>
                        <div class="stage-speech-meta">
                            ${isUrgent ? '<span class="urgent-pill">PILNE</span>' : (relevant ? '<span class="foh-pill">DLA REALIZATORA</span>' : '')}
                            ${relevant && m.action_type && m.action_type !== 'info'
                                ? `<span class="action-pill pill-${m.action_type}">${m.action_display}</span>`
                                : ''}
                            <span class="stage-speech-time">${m.timestamp}</span>
                        </div>
                    </div>
                `;
            }).join('') + `</div>`;
        } else {
            speechHtml = `<div class="stage-silent">Cisza na torze...</div>`;
        }

        card.innerHTML = `
            <div class="stage-ch-top">
                <div class="stage-ch-id-group">
                    <span class="stage-ch-badge" style="background:${ch.color || '#3b82f6'}">CH ${String(ch.id).padStart(2, '0')}</span>
                    <span class="stage-ch-name">${ch.name}</span>
                    <span class="stage-ch-in">IN ${String(ch.hardware_channel || ch.id).padStart(2, '0')}</span>
                    <span class="stage-ch-role">${ch.role}</span>
                </div>
                ${liveBadgeHtml}
            </div>
            ${speechHtml}
        `;
        stageView.appendChild(card);
    });
}

function renderFeedView() {
    if (!feedView) return;
    feedView.innerHTML = '';

    const list = activeView === 'foh'
        ? messages.filter(m => isEngineerRelevant(m))
        : messages;

    if (list.length === 0) {
        feedView.innerHTML = `
            <div class="tablet-empty-state">
                <h3>Brak wypowiedzi</h3>
                <p>${activeView === 'foh'
                    ? 'Żaden muzyk nie zgłaszał jeszcze uwag dla realizatora.'
                    : 'Oczekiwanie na rozmowy z mikrofonów scenicznych...'}</p>
            </div>
        `;
        return;
    }

    list.forEach(m => {
        const { html: highlighted, hasAudio } = highlightAudioKeywords(m.raw_text);
        const relevant = m.priority === 'urgent' || (m.action_type && m.action_type !== 'info') || hasAudio;
        const isUrgent = m.priority === 'urgent';
        const chColor = getChannelColor(m.channel_id);
        const hwIn = getChannelHw(m.channel_id);

        const card = document.createElement('div');
        card.className = `tablet-card ${isUrgent ? 'urgent' : (relevant ? 'foh-highlight' : 'casual')}`;

        card.innerHTML = `
            <div class="card-meta-row">
                <div class="musician-tag">
                    <span class="musician-dot" style="background:${chColor}"></span>
                    <span>${m.musician}</span>
                    <span class="stage-ch-in">CH ${String(m.channel_id).padStart(2, '0')} • IN ${String(hwIn).padStart(2, '0')}</span>
                </div>
                <span class="card-time">${m.timestamp}</span>
            </div>

            <div class="card-speech-main">„${highlighted}”</div>

            ${relevant ? `
                <div class="card-intent-row">
                    ${isUrgent ? '<span class="urgent-pill">PILNE</span>' : '<span class="foh-pill">DLA REALIZATORA</span>'}
                    ${m.action_type && m.action_type !== 'info'
                        ? `<span class="action-pill pill-${m.action_type}">${m.action_display}</span>`
                        : ''}
                </div>
            ` : ''}
        `;
        feedView.appendChild(card);
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

// ==================== View Switcher ====================
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        activeView = e.target.dataset.view;
        renderCurrentView();
    });
});

// ==================== Init ====================
window.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
});
