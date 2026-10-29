"""FastAPI microservice for stock forecasting model inference and metrics."""

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Suppress TensorFlow logging
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
import tensorflow as tf

from ml.config import ARTIFACTS_DIR, DATA_DIR, TICKERS, WINDOW_SIZE
from ml.features import FEATURE_COLS, compute_features

EDUCATIONAL_DISCLAIMER: str = (
    "Educational forecast only — not financial advice. Financial markets are stochastic "
    "and unpredictable; this deep sequence model is an academic benchmark."
)

CACHE_TTL_SECONDS: int = 900  # 15 minutes
CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}

# Global handles
MODEL: Optional[tf.keras.Model] = None
SCALER: Optional[Any] = None
METRICS_DATA: Optional[Dict[str, Any]] = None


def load_artifacts():
    """Load trained model, scaler, and metrics artifacts."""
    global MODEL, SCALER, METRICS_DATA

    model_path = ARTIFACTS_DIR / "model.keras"
    scaler_path = ARTIFACTS_DIR / "scaler.pkl"
    metrics_path = ARTIFACTS_DIR / "metrics.json"

    if model_path.exists():
        MODEL = tf.keras.models.load_model(model_path)
    if scaler_path.exists():
        SCALER = joblib.load(scaler_path)
    if metrics_path.exists():
        with open(metrics_path, "r", encoding="utf-8") as f:
            METRICS_DATA = json.load(f)


# Initialize artifacts on module import
load_artifacts()

app = FastAPI(
    title="Profit Profile ML Forecasting Service",
    description="Educational stock prediction service powered by a dual-output LSTM model.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: str = Field(..., example="ok")
    model_loaded: bool = Field(..., example=True)
    timestamp: str = Field(..., example="2026-10-28T04:00:00Z")


class PredictionResponse(BaseModel):
    symbol: str = Field(..., example="RELIANCE.NS")
    last_price: float = Field(..., example=2500.50)
    predicted_direction: str = Field(..., example="UP")
    direction_probability: float = Field(..., example=0.5234)
    predicted_return: float = Field(..., example=0.0045)
    predicted_price: float = Field(..., example=2511.78)
    confidence_score: float = Field(..., example=0.0468)
    historical_dates: List[str] = Field(..., description="Last 60 trading dates")
    historical_prices: List[float] = Field(..., description="Last 60 closing prices")
    cached: bool = Field(..., example=False)
    disclaimer: str = Field(default=EDUCATIONAL_DISCLAIMER)
    timestamp: str = Field(..., example="2026-10-28T04:00:00Z")


def normalize_symbol(raw_symbol: str) -> str:
    """Normalize input symbol to matching NSE ticker symbol."""
    sym = raw_symbol.strip().upper()
    if not sym.endswith(".NS"):
        sym = f"{sym}.NS"
    return sym


def fetch_symbol_recent_data(symbol: str) -> pd.DataFrame:
    """
    Fetch recent daily OHLCV data for inference.
    
    Tries live Yahoo Finance download first; falls back to cached dataset if offline or throttled.
    """
    try:
        raw_df = yf.download(symbol, period="6mo", interval="1d", progress=False)
        if raw_df is not None and not raw_df.empty:
            if isinstance(raw_df.columns, pd.MultiIndex):
                raw_df.columns = [col[0] for col in raw_df.columns]
            required_cols = ["Open", "High", "Low", "Close", "Volume"]
            available = [c for c in required_cols if c in raw_df.columns]
            df = raw_df[available].copy()
            df.index = pd.to_datetime(df.index)
            df.sort_index(inplace=True)
            df = df.ffill().bfill()
            if len(df) >= 45:
                return df
    except Exception:
        pass

    # Fallback to local cached historical CSV
    local_csv = DATA_DIR / f"{symbol}.csv"
    if local_csv.exists():
        df = pd.read_csv(local_csv, parse_dates=["Date"], index_col="Date")
        df.sort_index(inplace=True)
        return df.ffill().bfill()

    raise HTTPException(
        status_code=502,
        detail=f"Unable to retrieve market data for symbol '{symbol}' from upstream source or cache.",
    )


@app.get("/health", response_model=HealthResponse)
def health():
    """Health check endpoint confirming model status and timestamp."""
    now_utc = datetime.now(timezone.utc).isoformat()
    return HealthResponse(
        status="ok",
        model_loaded=(MODEL is not None and SCALER is not None),
        timestamp=now_utc,
    )


@app.get("/metrics")
def get_metrics():
    """Return trained model evaluation metrics, baselines, and test statistics."""
    if METRICS_DATA is None:
        raise HTTPException(
            status_code=503,
            detail="Evaluation metrics are not currently available.",
        )
    return METRICS_DATA


@app.get("/predict", response_model=PredictionResponse)
def predict(
    symbol: str = Query(..., description="Stock symbol, e.g. RELIANCE, TCS, or RELIANCE.NS"),
    refresh: bool = Query(False, description="Bypass 15-minute in-memory cache"),
):
    """
    Generate next-day stock directional and return forecast using the trained LSTM model.
    """
    if MODEL is None or SCALER is None:
        raise HTTPException(
            status_code=503,
            detail="Forecasting model is currently not loaded.",
        )

    norm_symbol = normalize_symbol(symbol)
    if norm_symbol not in TICKERS:
        raise HTTPException(
            status_code=400,
            detail=f"Symbol '{symbol}' is not supported. Supported symbols: {TICKERS}",
        )

    now = time.time()
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Check in-memory 15-minute cache
    if not refresh and norm_symbol in CACHE:
        cached_time, cached_payload = CACHE[norm_symbol]
        if (now - cached_time) < CACHE_TTL_SECONDS:
            resp = dict(cached_payload)
            resp["cached"] = True
            return PredictionResponse(**resp)

    # 2. Ingest recent OHLCV data
    df = fetch_symbol_recent_data(norm_symbol)

    # 3. Compute zero-lookahead technical indicators
    feat_df = compute_features(df)
    if len(feat_df) < WINDOW_SIZE:
        raise HTTPException(
            status_code=422,
            detail=f"Insufficient clean trading history ({len(feat_df)} rows) for 30-day window inference.",
        )

    # 4. Extract last 30 trading days of features
    last_window_raw = feat_df[FEATURE_COLS].iloc[-WINDOW_SIZE:].values
    # Scale using scaler fitted exclusively on training set
    last_window_scaled = SCALER.transform(last_window_raw)
    input_tensor = np.expand_dims(last_window_scaled, axis=0).astype(np.float32)

    # 5. Model Inference
    dir_output, ret_output = MODEL.predict(input_tensor, verbose=0)
    prob = float(dir_output[0][0])
    pred_ret = float(ret_output[0][0])

    pred_dir = "UP" if prob >= 0.5 else "DOWN"
    # Confidence score: deviation from uninformative 0.5 (scaled 0 to 1)
    confidence = float(abs(prob - 0.5) * 2.0)

    last_price = float(df["Close"].iloc[-1])
    predicted_price = float(last_price * np.exp(pred_ret))

    # Historical 60-day price trend for dashboard chart
    hist_subset = df.iloc[-60:]
    hist_dates = [d.strftime("%Y-%m-%d") for d in hist_subset.index]
    hist_prices = [round(float(p), 2) for p in hist_subset["Close"].values]

    payload = {
        "symbol": norm_symbol,
        "last_price": round(last_price, 2),
        "predicted_direction": pred_dir,
        "direction_probability": round(prob, 4),
        "predicted_return": round(pred_ret, 6),
        "predicted_price": round(predicted_price, 2),
        "confidence_score": round(confidence, 4),
        "historical_dates": hist_dates,
        "historical_prices": hist_prices,
        "cached": False,
        "disclaimer": EDUCATIONAL_DISCLAIMER,
        "timestamp": now_iso,
    }

    # Save to 15-minute in-memory cache
    CACHE[norm_symbol] = (now, payload)

    return PredictionResponse(**payload)
