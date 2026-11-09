import re
from typing import Dict, Any, Optional
from src.models import IntentResult

class IntentAnalyzer:
    """
    Inteligentny analizator intencji wypowiedzi scenicznych.
    Wyciąga z wypowiedzi muzyka: instrument/element, żądaną akcję oraz priorytet.
    Działa w 100% lokalnie i bez opóźnień (zero latency).
    """

    ELEMENT_PATTERNS = {
        "Stopa (Kick)": [r"stop[ęaey]", r"kick"],
        "Werbel (Snare)": [r"werb[el|la|elowi|lem]", r"snare"],
        "Bas": [r"bas[usiem]?", r"bas[a-z]*", r"gitara basowa"],
        "Wokal własny": [r"mój wokal", r"mnie w odsłuchu", r"mój głos", r"siebie nie słyszę", r"siebie w uchu"],
        "Wokal główny / drugi": [r"wokal[a-z]*", r"śpiew", r"chór[a-z]*"],
        "Gitara": [r"gitar[ęaye]", r"wiosło", r"akustyk", r"elektryk"],
        "Klawisze / Syntezator": [r"klawisz[a-z]*", r"pian[o|ina]?", r"syntezator"],
        "Klik / Metronom": [r"klik[a-z]*", r"metronom[a-z]*", r"tempo"],
        "Odsłuch ogólny": [r"odsłuch[a-z]*", r"monitor[a-z]*", r"w uchu", r"w uszach", r"iem", r"mikser"],
        "Pogłos (Reverb/Delay)": [r"reverb[a-z]*", r"pogłos[a-z]*", r"delay", r"echo"],
        "Korekcja EQ": [r"gór[a-z]*", r"dół", r"dołu", r"środek", r"pasmo", r"kłuje", r"syczy", r"muli"]
    }

    ACTION_PATTERNS = {
        "volume_up": {
            "display": "Pogłośnić (+dB)",
            "patterns": [
                r"więcej", r"pogłoś[a-z]*", r"daj mi", r"podnieś", r"podbij[a-z]*",
                r"głośniej", r"za cicho", r"nie słysz[ęe]", r"dorzuć", r"podciągnij"
            ]
        },
        "volume_down": {
            "display": "Przyciszyć (-dB)",
            "patterns": [
                r"mniej", r"ścisz[a-z]*", r"przycisz[a-z]*", r"za głośno", r"ujmij",
                r"zdejmij", r"ogłuchn[ęe]", r"za mocno", r"ciszej"
            ]
        },
        "eq_high_cut": {
            "display": "Podciąć górę (High-Cut)",
            "patterns": [
                r"podetnij gór[ęe]", r"mniej góry", r"za ostro", r"kłuje", r"syczy",
                r"piecze w uszach", r"za jasn[yo]"
            ]
        },
        "eq_low_cut": {
            "display": "Zdjąć dół / bas (Low-Cut)",
            "patterns": [
                r"zdejmij dół", r"mniej dołu", r"muli", r"buczy", r"za dużo basu w wokalu"
            ]
        },
        "reverb_add": {
            "display": "Dodać pogłos (Reverb/Delay)",
            "patterns": [
                r"daj.*(reverb|pogłos|efekt)", r"więcej.*(reverbu|pogłosu)", r"dorzuć.*pogłos"
            ]
        },
        "mute_or_cut": {
            "display": "Wyciszyć / Wyłączyć",
            "patterns": [
                r"wyłącz", r"zmutuj", r"odłącz", r"nie chcę"
            ]
        }
    }

    URGENT_PATTERNS = [
        r"sprzęga", r"sprzężenie", r"piszczy", r"zaraz ogłuchn[ęe]",
        r"bol[ąi] uszy", r"przester", r"trzeszczy", r"pilne", r"szybko", r"natychmiast"
    ]

    def analyze(self, musician_name: str, text: str) -> IntentResult:
        """
        Przetwarza surowy tekst transkrypcji i zwraca obiekt IntentResult.
        """
        clean_text = text.lower().strip()

        # 1. Wykrywanie priorytetu
        priority = "normal"
        for urgent_re in self.URGENT_PATTERNS:
            if re.search(urgent_re, clean_text):
                priority = "urgent"
                break

        # 2. Wykrywanie elementu / instrumentu
        detected_element = "Ogólne / Miks"
        for element_name, patterns in self.ELEMENT_PATTERNS.items():
            for pat in patterns:
                if re.search(r"\b" + pat, clean_text):
                    detected_element = element_name
                    break
            if detected_element != "Ogólne / Miks":
                break

        # 3. Wykrywanie żądanej akcji
        detected_action_type = "info"
        detected_action_display = "Komunikat / Pytanie"

        for action_type, meta in self.ACTION_PATTERNS.items():
            matched = False
            for pat in meta["patterns"]:
                if re.search(r"\b" + pat, clean_text):
                    detected_action_type = action_type
                    detected_action_display = meta["display"]
                    matched = True
                    break
            if matched:
                break

        # Specjalna logika kontekstowa
        if detected_element == "Ogólne / Miks" and detected_action_type != "info":
            detected_element = f"Odsłuch ({musician_name})"

        # Generowanie zwięzłego podsumowania dla realizatora FOH/Monitory
        if detected_action_type == "volume_up":
            summary = f"Chce WIĘCEJ: {detected_element}"
        elif detected_action_type == "volume_down":
            summary = f"Chce MNIEJ: {detected_element}"
        elif "eq" in detected_action_type:
            summary = f"Korekcja EQ: {detected_action_display} na {detected_element}"
        elif detected_action_type == "reverb_add":
            summary = f"Dodać efekt: {detected_element}"
        elif detected_action_type == "mute_or_cut":
            summary = f"Wyłączyć: {detected_element}"
        else:
            summary = f"{detected_element}: {text[:45]}..."

        return IntentResult(
            musician=musician_name,
            element=detected_element,
            action_display=detected_action_display,
            action_type=detected_action_type,
            priority=priority,
            summary=summary
        )
