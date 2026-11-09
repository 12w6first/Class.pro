import asyncio
import sys
from src.intent_analyzer import IntentAnalyzer
from src.audio_engine import AudioEngine

def test_intent_analyzer():
    analyzer = IntentAnalyzer()

    # Test 1: Perkusista chce bas
    res1 = analyzer.analyze("Perkusista", "Ej, pogłośnij mi ten bas w odsłuchu, bo nic nie słyszę z tyłu!")
    assert res1.action_type == "volume_up", f"Expected volume_up, got {res1.action_type}"
    assert "Bas" in res1.element, f"Expected Bas, got {res1.element}"
    assert res1.priority == "normal"
    print("✓ Test 1: Perkusista -> Bas (PASS)")

    # Test 2: Wokalista chce podciąć górę i dodać pogłos
    res2 = analyzer.analyze("Wokal Główny", "Piecze w uszach, podetnij mi trochę górę na wokalu i daj odrobinę pogłosu.")
    assert "Wokal" in res2.element
    assert res2.action_type == "eq_high_cut"
    assert "High-Cut" in res2.action_display
    print("✓ Test 2: Wokal -> EQ High-Cut (PASS)")

    # Test 3: Pilny alarm (sprzężenie)
    res3 = analyzer.analyze("Chórek", "Piszczy i sprzęga w monitorze odsłuchowym, szybko ścisz!")
    assert res3.priority == "urgent", f"Expected urgent, got {res3.priority}"
    assert res3.action_type == "volume_down"
    print("✓ Test 3: Chórek -> Sprzężenie / Urgent (PASS)")

async def test_audio_engine():
    engine = AudioEngine()
    assert len(engine.channels) >= 6, "Expected at least 6 stage channels"

    msg = await engine.process_utterance(3, "Daj mi więcej basu!")
    assert msg.channel_id == 3
    assert msg.musician == "Perkusista"
    assert engine.channels[3].active_requests_count == 1

    # Resolve message
    resolved = await engine.resolve_message(msg.id)
    assert resolved is True
    assert engine.channels[3].active_requests_count == 0
    print("✓ Test 4: AudioEngine lifecycle & resolve (PASS)")

    # Test 5: Wykrywanie urządzeń i routing
    devices = engine.detect_audio_devices()
    assert len(devices) > 0
    print(f"✓ Test 5: Wykryto {len(devices)} urządzeń audio (PASS)")

def main():
    print("Uruchamianie testów weryfikacyjnych...")
    test_intent_analyzer()
    asyncio.run(test_audio_engine())
    print("\n🎉 Wszystkie testy przeszły pomyślnie!")

if __name__ == "__main__":
    main()
