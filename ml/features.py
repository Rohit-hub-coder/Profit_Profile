"""Feature engineering module ensuring zero lookahead leakage."""

import numpy as np
import pandas as pd
from typing import List, Tuple

FEATURE_COLS: List[str] = [
    "log_return",
    "rolling_mean_5",
    "rolling_std_5",
    "rolling_mean_10",
    "rolling_std_10",
    "rolling_mean_20",
    "rolling_std_20",
    "momentum",
    "rsi_14",
    "macd",
    "macd_signal",
    "macd_hist",
    "volume_change",
    "volatility_20",
]


def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Calculate Relative Strength Index (RSI) using exponential moving average."""
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)

    # Use exponential moving average with alpha = 1 / period
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / (avg_loss + 1e-10)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    return rsi


def calculate_macd(
    series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """Calculate MACD line, signal line, and MACD histogram."""
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute predictive technical indicators and next-day forecast targets.
    
    Guarantees:
    - Every feature at index t uses market data from index <= t only.
    - target_return and target_direction represent day t+1 values (future).
    """
    data = df.copy()
    close = data["Close"]
    volume = data["Volume"]

    # 1. Log returns
    data["log_return"] = np.log(close / close.shift(1))

    # 2. Rolling mean & std of returns across multiple horizons (5, 10, 20 days)
    data["rolling_mean_5"] = data["log_return"].rolling(window=5).mean()
    data["rolling_std_5"] = data["log_return"].rolling(window=5).std()

    data["rolling_mean_10"] = data["log_return"].rolling(window=10).mean()
    data["rolling_std_10"] = data["log_return"].rolling(window=10).std()

    data["rolling_mean_20"] = data["log_return"].rolling(window=20).mean()
    data["rolling_std_20"] = data["log_return"].rolling(window=20).std()

    # 3. Momentum (10-day percentage price change)
    data["momentum"] = (close - close.shift(10)) / (close.shift(10) + 1e-10)

    # 4. RSI (14 days)
    data["rsi_14"] = calculate_rsi(close, period=14)

    # 5. MACD (12, 26, 9)
    macd_line, signal_line, hist = calculate_macd(close, fast=12, slow=26, signal=9)
    data["macd"] = macd_line
    data["macd_signal"] = signal_line
    data["macd_hist"] = hist

    # 6. Volume change
    data["volume_change"] = (volume - volume.shift(1)) / (volume.shift(1) + 1e-8)

    # 7. Volatility (20-day rolling standard deviation of simple returns)
    simple_ret = close.pct_change()
    data["volatility_20"] = simple_ret.rolling(window=20).std()

    # Targets for day t+1:
    # Next-day log return: ln(Close_{t+1} / Close_t)
    data["target_return"] = data["log_return"].shift(-1)

    # Next-day direction: 1 if target_return > 0 else 0
    data["target_direction"] = (data["target_return"] > 0.0).astype(int)

    # Drop warm-up periods (NaNs from rolling windows) and the final row (where target_return is NaN)
    cleaned = data.dropna().copy()
    return cleaned
