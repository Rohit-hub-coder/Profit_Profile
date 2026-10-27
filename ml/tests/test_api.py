"""Unit tests for FastAPI stock prediction microservice."""

import pytest
from fastapi.testclient import TestClient

from ml.api.main import app, CACHE


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["model_loaded"] is True
    assert "timestamp" in data


def test_metrics_endpoint(client):
    response = client.get("/metrics")
    assert response.status_code == 200
    data = response.json()
    assert "metadata" in data
    assert "overall_test_metrics" in data
    assert "lstm" in data["overall_test_metrics"]
    assert "baselines" in data["overall_test_metrics"]


def test_predict_invalid_symbol(client):
    response = client.get("/predict?symbol=UNKNOWN_TICKER")
    assert response.status_code == 400
    assert "not supported" in response.json()["detail"]


def test_predict_valid_symbol_and_caching(client):
    # Clear cache before testing
    CACHE.clear()

    # First request: computes prediction (or loads from fallback cache)
    resp1 = client.get("/predict?symbol=RELIANCE")
    assert resp1.status_code == 200
    data1 = resp1.json()

    assert data1["symbol"] == "RELIANCE.NS"
    assert data1["predicted_direction"] in ["UP", "DOWN"]
    assert 0.0 <= data1["direction_probability"] <= 1.0
    assert data1["last_price"] > 0
    assert data1["predicted_price"] > 0
    assert len(data1["historical_dates"]) > 0
    assert len(data1["historical_prices"]) == len(data1["historical_dates"])
    assert "Educational forecast only" in data1["disclaimer"]
    assert data1["cached"] is False

    # Second request: must hit 15-minute in-memory cache
    resp2 = client.get("/predict?symbol=RELIANCE")
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["cached"] is True
    assert data2["predicted_direction"] == data1["predicted_direction"]
    assert data2["predicted_price"] == data1["predicted_price"]
