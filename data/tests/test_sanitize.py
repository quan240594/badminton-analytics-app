from sanitize import MAX_STRING_LEN, clean_json_value


def test_strips_control_characters_but_keeps_ordinary_whitespace():
    assert clean_json_value("a\x00b\x1bc\n\t d") == "abc\n\t d"


def test_truncates_long_strings_to_max_len():
    assert len(clean_json_value("x" * (MAX_STRING_LEN + 50))) == MAX_STRING_LEN
    assert clean_json_value("abcdef", max_len=3) == "abc"


def test_recurses_into_dicts_and_lists_including_keys():
    dirty = {"k\x00ey": ["v\x00al", {"n": 1}], "n": None}
    assert clean_json_value(dirty) == {"key": ["val", {"n": 1}], "n": None}


def test_non_string_scalars_pass_through():
    assert clean_json_value(3.5) == 3.5
    assert clean_json_value(True) is True
