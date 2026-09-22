import pytest


@pytest.fixture(autouse=True)
def deterministic_notification_worker(monkeypatch):
    # API tests drive delivery explicitly; browser tests exercise the real worker.
    from backend import notifications
    monkeypatch.setattr(notifications, 'start_worker', lambda: None)
