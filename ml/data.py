"""Data ingestion and local caching module for historical stock OHLCV."""

import os
import warnings
from pathlib import Path
from typing import Dict, List, Tuple
import pandas as pd
import yfinance as yf

from ml.config import DATA_DIR, START_DATE, END_DATE, TICKERS

warnings.filterwarnings("ignore", category=FutureWarning)


def clean_ticker_name(ticker: str) -> str:
    """Normalize ticker string for filesystem usage."""
    return ticker.replace(".NS", "").replace("^", "").strip().upper()


def download_symbol_data(
    symbol: str,
    start_date: str = START_DATE,
    end_date: str = END_DATE,
    cache_dir: Path = DATA_DIR,
    force_download: bool = False,
) -> pd.DataFrame:
    """Download daily OHLCV for a symbol or load from local cache."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"{symbol}.csv"

    if not force_download and cache_file.exists():
        df = pd.read_csv(cache_file, parse_dates=["Date"], index_col="Date")
        if not df.empty:
            return df

    # Download from Yahoo Finance
    raw_df = yf.download(symbol, start=start_date, end=end_date, progress=False)
    if raw_df is None or raw_df.empty:
        raise ValueError(f"No market data retrieved from Yahoo Finance for symbol: {symbol}")

    # Flatten MultiIndex columns if present in newer yfinance versions
    if isinstance(raw_df.columns, pd.MultiIndex):
        raw_df.columns = [col[0] for col in raw_df.columns]

    # Keep standard OHLCV columns
    required_cols = ["Open", "High", "Low", "Close", "Volume"]
    available_cols = [c for c in required_cols if c in raw_df.columns]
    df = raw_df[available_cols].copy()

    # Ensure index is datetime and sorted chronologically
    df.index = pd.to_datetime(df.index)
    df.sort_index(inplace=True)

    # Forward fill then backward fill any missing values
    df = df.ffill().bfill()

    # Cache locally to gitignored ml/data/
    df.to_csv(cache_file)
    return df


def load_all_data(
    tickers: List[str] = TICKERS,
    start_date: str = START_DATE,
    end_date: str = END_DATE,
    cache_dir: Path = DATA_DIR,
    force_download: bool = False,
) -> Tuple[Dict[str, pd.DataFrame], Dict[str, dict]]:
    """Download and return DataFrames and metadata summary for all specified tickers."""
    data_dict = {}
    metadata = {}

    for sym in tickers:
        df = download_symbol_data(
            symbol=sym,
            start_date=start_date,
            end_date=end_date,
            cache_dir=cache_dir,
            force_download=force_download,
        )
        data_dict[sym] = df
        metadata[sym] = {
            "symbol": sym,
            "rows": int(len(df)),
            "start_date": df.index[0].strftime("%Y-%m-%d"),
            "end_date": df.index[-1].strftime("%Y-%m-%d"),
            "null_count": int(df.isnull().sum().sum()),
        }

    return data_dict, metadata


def load_dataset_summary(
    tickers: List[str] = TICKERS,
    cache_dir: Path = DATA_DIR,
) -> Dict[str, dict]:
    """Retrieve metadata summary for cached market datasets."""
    _, metadata = load_all_data(tickers=tickers, cache_dir=cache_dir)
    return metadata

