// State
let ws = null;
let channels = [];
let messages = [];
let activeFilter = 'pending'; // Domyślnie na tablecie pokazujemy tylko to, co jest DO ZROBIENIA

// DOM Elements
const wsIndicator = document.getElementById('ws-indicator');
const wsStatus = document.getElementById('ws-status');
const tabletClock = document.getElementById('tablet-clock');
const pendingCount = document.getElementById('pending-count');
const pendingCounter = document.getElementById('pending-counter');
const tabletChannelsStrip = document.getElementById('tablet-channels-strip');
const tabletCardsContainer = document.getElementById('tablet-cards-container');

// Digital Clock
function updateClock() {
    const now = new Date();
    tabletClock.innerText = now.toTimeString().split(' ')[0];
}
setInterval(updateClock, 1000);
updateClock();

// WebSocket Connection
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        wsIndicator.className = 'pulse-indicator online';
        wsStatus.innerText = 'POŁĄCZONO Z MACBOOKIEM';
    };

    ws.onclose = () => {
        wsIndicator.className = 'pulse-indicator';
        wsStatus.innerText = 'ROZŁĄCZONO (RECONNECT...)';
        setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => {
        console.error('WS Error:', err);
    };

    ws.onmessage = (event) => {
        try {
            const payload = JSON.parse(event.data);
            handleWsMessage(payload);
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
        renderStrip();
        renderCards();
        updatePendingCounter();
    } else if (type === 'new_message') {
        messages.unshift(data);
        renderCards();
        updatePendingCounter();
        // Lekka wibracja na telefonie/tablecie przy nowej prośbie ze sceny!
        if (navigator.vibrate) {
            navigator.vibrate(data.priority === 'urgent' ? [100, 50, 100] : 60);
        }
    } else if (type === 'channel_update') {
        channels = data;
        renderStrip();
        updatePendingCounter();
    } else if (type === 'resolve_message') {
        const target = messages.find(m => m.id === data.id);
        if (target) target.resolved = true;
        renderCards();
        updatePendingCounter();
    } else if (type === 'clear_all') {
        messages = [];
        renderCards();
        updatePendingCounter();
    }
}

// Update Pending Counter
function updatePendingCounter() {
    const pending = messages.filter(m => !m.resolved);
    const hasUrgent = pending.some(m => m.priority === 'urgent');

    pendingCount.innerText = pending.length;
    if (hasUrgent) {
        pendingCounter.classList.add('has-urgent');
    } else {
        pendingCounter.classList.remove('has-urgent');
    }
}

// Render Top Channels Strip
function renderStrip() {
    if (!tabletChannelsStrip) return;
    tabletChannelsStrip.innerHTML = '';

    channels.forEach(ch => {
        const card = document.createElement('div');
        const hasUrgent = messages.some(m => m.channel_id === ch.id && !m.resolved && m.priority === 'urgent');
        const hasAlert = ch.active_requests_count > 0;

        card.className = `strip-card ${hasUrgent ? 'has-urgent' : (hasAlert ? 'has-alert' : '')}`;
        card.style.borderLeftColor = ch.color || '#3b82f6';

        const statusText = ch.last_message || 'OK / Bez uwag';

        card.innerHTML = `
            <div class="strip-card-top">
                <span class="strip-card-name">${ch.name}</span>
                <span class="strip-card-hw">IN ${ch.hardware_channel || ch.id}</span>
            </div>
            <div class="strip-card-status ${hasAlert ? 'alert-text' : ''}">
                ${hasAlert ? `⚠️ ${statusText}` : statusText}
            </div>
        `;
        tabletChannelsStrip.appendChild(card);
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

// Render Action Cards
function renderCards() {
    if (!tabletCardsContainer) return;
    tabletCardsContainer.innerHTML = '';

    const filtered = messages.filter(m => {
        if (activeFilter === 'pending') return !m.resolved;
        if (activeFilter === 'urgent') return m.priority === 'urgent' && !m.resolved;
        if (activeFilter === 'resolved') return m.resolved;
        return true;
    });

    if (filtered.length === 0) {
        tabletCardsContainer.innerHTML = `
            <div class="tablet-empty-state">
                <div class="empty-icon">✓</div>
                <h3>Wszystko na bieżąco!</h3>
                <p>Brak oczekujących próśb od wokalistów i muzyków.</p>
                <small>Nasłuch na żywo z MacBooka jest aktywny...</small>
            </div>
        `;
        return;
    }

    filtered.forEach(m => {
        const card = document.createElement('div');
        const { html: highlightedSpeech, hasAudio } = highlightAudioKeywords(m.raw_text);
        const chColor = getChannelColor(m.channel_id);
        const hwIn = getChannelHw(m.channel_id);

        card.id = `tablet-card-${m.id}`;
        card.className = `tablet-card ${hasAudio ? 'sound-alert-card' : ''} ${m.priority === 'urgent' ? 'urgent' : 'normal'} ${m.resolved ? 'resolved' : ''}`;

        card.innerHTML = `
            <div class="card-meta-row">
                <div class="musician-tag">
                    <span class="musician-dot" style="background:${chColor}"></span>
                    <span>${m.musician}</span>
                    <span style="font-size:0.75rem;font-family:var(--font-mono);color:var(--text-muted);font-weight:normal">(CH 0${m.channel_id} • IN ${hwIn})</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    ${hasAudio ? '<span class="badge-sound-red">🔴 DŹWIĘK / INSTRUMENT</span>' : ''}
                    <span class="card-time">${m.timestamp}</span>
                </div>
            </div>

            <div class="card-intent-highlight">
                <span>${m.summary}</span>
                <span class="action-pill pill-${m.action_type}">${m.action_display}</span>
            </div>

            <div class="card-quote">
                “${highlightedSpeech}”
            </div>

            ${m.resolved
                ? '<div class="btn-touch-resolved">✓ ZAŁATWIONE</div>'
                : `<button class="btn-touch-resolve" onclick="resolveMessage('${m.id}')">
                    <span>✓</span> OZNACZ JAKO ZROBIONE
                   </button>`
            }
        `;
        tabletCardsContainer.appendChild(card);
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
    // Dotykowa wibracja
    if (navigator.vibrate) {
        navigator.vibrate(40);
    }

    // Natychmiastowy feedback wizualny
    const cardEl = document.getElementById(`tablet-card-${messageId}`);
    if (cardEl) {
        cardEl.classList.add('resolved');
        const btn = cardEl.querySelector('.btn-touch-resolve');
        if (btn) {
            btn.outerHTML = '<div class="btn-touch-resolved">✓ ZAŁATWIONE</div>';
        }
    }

    try {
        await fetch('/api/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_id: messageId })
        });
    } catch (e) {
        console.error('Błąd oznaczania zadania:', e);
    }
};

// Filter Buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        activeFilter = e.target.dataset.filter;
        renderCards();
    });
});

// Init
window.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
});
