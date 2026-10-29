"""Configuration parameters and paths for the ML forecasting module."""

import os
from pathlib import Path

# Base Paths
ML_DIR = Path(__file__).resolve().parent
DATA_DIR = ML_DIR / "data"
ARTIFACTS_DIR = ML_DIR / "artifacts"
NOTEBOOKS_DIR = ML_DIR / "notebooks"

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
NOTEBOOKS_DIR.mkdir(parents=True, exist_ok=True)

# Selected liquid NIFTY symbols from portfolio/watchlist with >= 8 years history
TICKERS = [
    "RELIANCE.NS",
    "TCS.NS",
    "INFY.NS",
    "HDFCBANK.NS",
    "HINDUNILVR.NS",
    "ITC.NS",
    "SBIN.NS",
    "BHARTIARTL.NS",
    "TATAPOWER.NS",
    "WIPRO.NS",
    "M&M.NS",
    "ONGC.NS",
]

# Historical data range (10+ years of daily OHLCV)
START_DATE = "2016-01-01"
END_DATE = "2026-10-25"

# Sliding window sequence length (trading days)
WINDOW_SIZE = 30

# Chronological split proportions
TRAIN_RATIO = 0.70
VAL_RATIO = 0.15
TEST_RATIO = 0.15

# Global reproducibility seed
RANDOM_SEED = 42

# Environment flags for TensorFlow CPU execution
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
