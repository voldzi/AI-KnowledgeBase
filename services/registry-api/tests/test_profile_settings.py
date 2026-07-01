from fastapi.testclient import TestClient


def test_user_can_get_default_profile_settings(client: TestClient, reader_headers: dict[str, str]) -> None:
    response = client.get("/api/v1/user-profiles/me/settings", headers=reader_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["subject_id"] == "user_reader"
    assert body["settings"] == {"core": {}, "apps": {}}
    assert body["roles"] == ["reader"]


def test_user_can_update_own_profile_settings(client: TestClient, reader_headers: dict[str, str]) -> None:
    response = client.put(
        "/api/v1/user-profiles/me/settings",
        headers=reader_headers,
        json={
            "settings": {
                "core": {
                    "language": "en",
                    "theme": "dark",
                    "displayName": "Reader One",
                },
                "apps": {
                    "akb": {
                        "settingsMode": "sidebar",
                    }
                },
            }
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["settings"]["core"]["language"] == "en"
    assert body["settings"]["core"]["theme"] == "dark"
    assert body["settings"]["apps"]["akb"]["settingsMode"] == "sidebar"
    assert body["roles"] == ["reader"]

    fetched = client.get("/api/v1/user-profiles/me/settings", headers=reader_headers)
    assert fetched.status_code == 200
    assert fetched.json()["settings"] == body["settings"]


def test_profile_settings_are_scoped_to_subject(client: TestClient) -> None:
    first_headers = {"X-AKL-Subject": "user_one", "X-AKL-Roles": "reader"}
    second_headers = {"X-AKL-Subject": "user_two", "X-AKL-Roles": "reader"}

    stored = client.put(
        "/api/v1/user-profiles/me/settings",
        headers=first_headers,
        json={"settings": {"core": {"language": "en"}, "apps": {"akb": {"settingsMode": "fullscreen"}}}},
    )
    assert stored.status_code == 200, stored.text

    other = client.get("/api/v1/user-profiles/me/settings", headers=second_headers)
    assert other.status_code == 200
    assert other.json()["settings"] == {"core": {}, "apps": {}}


def test_saved_profile_settings_do_not_override_rbac_roles(client: TestClient) -> None:
    headers = {"X-AKL-Subject": "user_reader", "X-AKL-Roles": "reader"}
    response = client.put(
        "/api/v1/user-profiles/me/settings",
        headers=headers,
        json={"settings": {"core": {"role": "admin"}, "apps": {}}},
    )

    assert response.status_code == 200
    assert response.json()["roles"] == ["reader"]
    assert "role" not in response.json()["settings"]["core"]
