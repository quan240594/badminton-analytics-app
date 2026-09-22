"""Best-effort Dutch city -> region mapping (Bondscompetitie has no official
'region' field; this groups clubs by province into 6 broad regions). Not
authoritative - correct entries here if a club's actual competition region
differs from its geographic province grouping.
"""

# Each region is a tuple of city names (as they appear in club addresses).
REGION_CITIES: dict[str, tuple[str, ...]] = {
    "Noord": (
        "Groningen", "Stadskanaal", "Veendam", "Zuidhorn", "Hoogkerk",
        "Drachten", "Heerenveen", "Leeuwarden",
        "Assen", "Coevorden", "Hoogeveen", "Meppel", "Nijeveen",
    ),
    "Noord-West": (
        "Almere", "Dronten", "Emmeloord", "Lelystad", "Zeewolde",
        "Amstelveen", "Amsterdam", "Badhoevedorp", "Beverwijk", "Bussum",
        "Den Helder", "De Rijp", "Diemen", "Grootebroek", "Haarlem",
        "Heemskerk", "Heerhugowaard", "Heiloo", "Hilversum", "Hoofddorp",
        "Hoogkarspel", "Hoorn", "Huizen", "IJmuiden", "Krommenie",
        "Kudelstaart", "Nieuwe Niedorp", "Purmerend", "Uithoorn", "Weesp",
        "Wognum", "Wormer", "Hem",
    ),
    "Midden": (
        "Baarn", "Bilthoven", "Bunnik", "Bunschoten", "Doorn", "Harmelen",
        "Houten", "IJsselstein", "Leusden", "Loosdrecht", "Mijdrecht",
        "Nieuwegein", "Soest", "Utrecht", "Veenendaal", "Vianen", "Vleuten",
        "Wijk bij Duurstede", "Woerden", "Zeist",
    ),
    "Oost": (
        "Almelo", "Dalfsen", "Dedemsvaart", "Deventer", "Enschede", "Enter",
        "Goor", "Hardenberg", "Hasselt", "Hengelo (ov)", "Holten", "Kampen",
        "Nijverdal", "Olst", "Ommen", "Raalte", "Schalkhaar", "Vroomshoop",
        "Wierden", "Zwolle",
        "Apeldoorn", "Arnhem", "Barneveld", "Beuningen", "Culemborg", "Didam",
        "Doetinchem", "Druten", "Duiven", "Eerbeek", "Elst", "Epe", "Ede",
        "Gaanderen", "Geesteren", "Gendt", "Groenlo", "Groesbeek",
        "Harderwijk", "Heerde", "Lent", "Lochem", "Nijmegen", "Nunspeet",
        "Oosterwolde", "Rheden", "Silvolde", "Steenderen", "Ulft",
        "Varsseveld", "Wageningen", "Wijchen", "Winterswijk", "Zetten",
        "Zutphen",
    ),
    "Zuid-West": (
        "'s-Gravenzande", "Alphen a/d Rijn", "Barendrecht", "Bergambacht",
        "Berkel en Rodenrijs", "Bleskensgraaf", "Bodegraven", "Brielle",
        "Capelle a/d Ijssel", "Delft", "Den Haag", "Dordrecht", "Gorinchem",
        "Gouda", "Hardinxveld-Giessendam", "Hendrik Ido Ambacht", "Hillegom",
        "Hoogvliet", "Krimpen a/d Lek", "Kwintsheul", "Leerdam", "Leiden",
        "Leiderdorp", "Leidschendam", "Lekkerkerk", "Maasdam", "Maassluis",
        "Monster", "Naaldwijk", "Nieuwerkerk a/d IJssel", "Noordwijk",
        "Noordwijkerhout", "Nootdorp", "Ouderkerk", "Ouderkerk a/d IJssel",
        "Pijnacker", "Ridderkerk", "Rijpwetering", "Rijswijk", "Rotterdam",
        "Rozenburg", "Sassenheim", "Schiedam", "Schipluiden", "Schoonhoven",
        "Sliedrecht", "Spijkenisse", "Ter Aar", "Valkenburg ZH", "Voorburg",
        "Voorhout", "Voorschoten", "Waddinxveen", "Wateringen", "Zoetermeer",
        "Zwijndrecht",
        "Goes", "Heinkenszand", "Hulst", "Kats", "Kruiningen",
        "Oost-Souburg", "Sluis", "Terneuzen", "Tholen",
    ),
    "Zuid": (
        "Bavel", "Bergen op Zoom", "Best", "Boxmeer", "Cuijk", "Dongen",
        "Eindhoven", "Geldrop", "Gilze", "Hoeven", "Lieshout", "Lith",
        "Nuenen", "Oirschot", "Oosterhout (N-Br)", "Oss", "Ossendrecht",
        "Prinsenbeek", "Rijen", "Roosendaal", "Sint-Michielsgestel",
        "Steenbergen", "Tilburg", "Veghel", "Veldhoven", "Werkendam",
        "Zevenbergen", "s-Hertogenbosch",
        "Bocholtz", "Echt", "Gulpen", "Hoensbroek", "Maastricht", "Reuver",
        "Roosteren", "Sevenum", "Sittard", "Stein", "Tegelen", "Venray",
    ),
}

CITY_TO_REGION: dict[str, str] = {city: region for region, cities in REGION_CITIES.items() for city in cities}


def region_for_city(city: str | None) -> str:
    if not city:
        return "Onbekend"
    return CITY_TO_REGION.get(city.strip(), "Onbekend")
