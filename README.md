# 🎛️ AI Live Monitor Assistant (Asystent Komunikacji Scenicznej)

> **Inteligentny system wspomagający realizatora dźwięku (FOH / Monitory) poprzez automatyczne nasłuchiwanie, transkrypcję mowy i ekstrakcję intencji muzyków w czasie rzeczywistym.**

Projekt realizowany w ramach przedmiotu **Wprowadzenie do sztucznej inteligencji** (Technologie Komputerowe, Wydział Fizyki UAM, prowadzący: dr Wojciech Czart) zgodnie z metodyką **Agent-First**.

---

## 📌 Problem i Motywacja

Podczas koncertów na żywo i prób muzycznych realizator dźwięku (monitorowiec / FOH) odpowiada za równoczesne miksowanie brzmienia oraz kontrolowanie odsłuchów dla wielu wykonawców (wokalistów, perkusisty, basisty, itp.). Muzycy często zwracają się do realizatora przez mikrofony odsłuchowe (talkback) lub bezpośrednio do mikrofonów wokalowych z prośbami typu:
* *„Pogłośnij mi ten bas w odsłuchu!”*
* *„Podetnij mi trochę górę na wokalu, bo kłuje w uszach”*
* *„Za głośno mam stopę w monitorze”*
* *„Piszczy i sprzęga w dousznych, szybko ścisz!”*

Ciągłe manualne podsłuchiwanie (PFL/Solo) każdego z kilkunastu torów bywa męczące i odciąga uwagę od miksu. **AI Live Monitor Assistant** rozwiązuje ten problem:
1. Pobiera sygnały z poszczególnych kanałów miksera.
2. Transkrybuje mowę (Speech-to-Text).
3. Za pomocą reguł agentowych i modeli językowych natychmiast wyciąga **kluczową intencję** (Kto mówi? Jaki instrument/element? Jaka akcja: +dB, -dB, EQ, Reverb? Jaki priorytet?).
4. Wyświetla czytelne kafelki i powiadomienia na ekranie realizatora (laptop, tablet lub telefon) w czasie rzeczywistym.

---

## 🏗️ Architektura Systemu

```
                      ┌────────────────────────────────────────┐
                      │     Cyfrowy Mikser / Mikrofon         │
                      │  (Wokal 1, Wokal 2, Perkusista...)     │
                      └──────────────────┬─────────────────────┘
                                         │  Strumień audio / mowa
                                         ▼
                      ┌────────────────────────────────────────┐
                      │         Python Backend (FastAPI)       │
                      │ ────────────────────────────────────── │
                      │  1. Audio Engine (wielokanałowość)     │
                      │  2. STT Engine (transkrypcja mowy)     │
                      │  3. Intent Analyzer (agent NLP/LLM)    │
                      └──────────────────┬─────────────────────┘
                                         │  WebSocket (JSON events)
                                         ▼
                      ┌────────────────────────────────────────┐
                      │    Pulpit Realizatora (HTML/CSS/JS)    │
                      │ ────────────────────────────────────── │
                      │  • Ciemny panel sceniczny (Dark-Mode)  │
                      │  • Dynamiczne kafelki kanałów muzyków  │
                      │  • Dziennik zgłoszeń z priorytetami    │
                      │  • Obsługa mikrofonu na żywo (Web Mic) │
                      │  • Szybkie presety testowe 1-Click     │
                      └────────────────────────────────────────┘
```

---

## 🚀 Jak uruchomić aplikację?

### 1. Wymagania wstępne
* Python 3.9+ na systemie macOS / Linux / Windows

### 2. Utworzenie wirtualnego środowiska i instalacja
```bash
# Wejdź do katalogu projektu
cd Class.pro

# Aktywuj wirtualne środowisko (jeśli już istnieje)
source .venv/bin/activate

# Zainstaluj zależności
pip install -r requirements.txt
```

### 3. Uruchomienie serwera
```bash
python run.py
```
Po uruchomieniu serwer wyświetli adresy:
* **Lokalnie na MacBooku:** `http://localhost:8000`
* **Zdalnie na tablecie / telefonie w tej samej sieci Wi-Fi:** `http://<TWOJE-IP>:8000`

---

## 🎯 Główne Funkcjonalności

* **Pulpit Sceniczny w Dark-Mode:** Przystosowany do pracy w ciemnych warunkach koncertowych i klubowych o wysokim kontraście.
* **Wielokanałowość (Channel Routing):** Każdy kanał miksera ma przypisanego muzyka, kolor identyfikacyjny, wskaźniki VU i licznik aktywnych próśb.
* **Rozpoznawanie Intencji Scenicznych (Intent NLP):**
  * Zmiany głośności (`volume_up`, `volume_down`)
  * Korekcja pasma (`eq_high_cut`, `eq_low_cut`)
  * Efekty (`reverb_add`, delay)
  * Kontrola metronomu/kliku i odsłuchu ogólnego
  * Wykrywanie sytuacji awaryjnych (`urgent` – np. sprzężenia akustyczne)
* **Wsparcie dla Mikrofonu na Żywo (Web Speech API):** Wystarczy kliknąć przycisk *„Mikrofon na żywo”* w przeglądarce i powiedzieć prośbę w języku polskim – system natychmiast ją przetworzy i wyświetli na pulpicie.
* **Panel Testów Scenicznych (1-Click Presets):** Pozwala na błyskawiczne zaprezentowanie działania systemu bez podłączania fizycznej konsolety koncertowej.
* **Obsługa potknięć / Oznaczanie zgłoszeń:** Przycisk *„Oznacz jako zrobione”* pozwala realizatorowi płynnie czyścić kolejkę wykonanych zadań.

---

## 🧪 Testy Weryfikacyjne

W projekcie znajduje się zestaw testów jednostkowych weryfikujących poprawność klasyfikacji intencji oraz cyklu życia komunikatów:
```bash
python tests/test_engine.py
```

---

## 👨‍💻 Informacje o Autorze

* **Identyfikator (Feliks):** `12w6tk1`
* **E-mail:** `12w6tk1@felix.fizyka.amu.edu.pl`
* **Kierunek:** Technologie Komputerowe (Wydział Fizyki UAM)
* **Profil studenta:** [student_profile.md](student_profile.md)
