import pytest

from safe_path import DATA_DIR, safe_path


def test_relative_path_resolves_inside_data_dir():
    assert safe_path("cookie.txt") == DATA_DIR / "cookie.txt"


def test_absolute_path_inside_data_dir_is_allowed(tmp_path):
    assert safe_path(DATA_DIR / "x.json", base=DATA_DIR) == DATA_DIR / "x.json"


def test_base_directory_itself_is_allowed():
    assert safe_path(".") == DATA_DIR


@pytest.mark.parametrize("bad", ["../secrets.txt", "/etc/passwd", "pages/../../x"])
def test_escaping_paths_are_rejected(bad):
    with pytest.raises(ValueError, match="outside"):
        safe_path(bad)
