import pytest

import region_map as rm


@pytest.mark.parametrize(
    "city,region",
    [
        ("Groningen", "Noord"),
        ("  Utrecht ", "Midden"),
        ("Amsterdam", "Noord-West"),
        ("Zwolle", "Oost"),
        ("Rotterdam", "Zuid-West"),
        ("Eindhoven", "Zuid"),
        ("Atlantis", "Onbekend"),
        ("", "Onbekend"),
        (None, "Onbekend"),
    ],
)
def test_region_for_city(city, region):
    assert rm.region_for_city(city) == region


def test_every_city_belongs_to_exactly_one_region():
    all_cities = [city for cities in rm.REGION_CITIES.values() for city in cities]

    assert len(all_cities) == len(set(all_cities)) == len(rm.CITY_TO_REGION)
