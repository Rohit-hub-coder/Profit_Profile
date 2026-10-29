"""Strict chronological train/val/test splitting and sliding window construction."""

from pathlib import Path
from typing import Dict, List, Tuple
import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

from ml.config import (
    ARTIFACTS_DIR,
    TEST_RATIO,
    TRAIN_RATIO,
    VAL_RATIO,
    WINDOW_SIZE,
)
from ml.features import FEATURE_COLS


def compute_chronological_cutoffs(
    feature_dict: Dict[str, pd.DataFrame],
    train_ratio: float = TRAIN_RATIO,
    val_ratio: float = VAL_RATIO,
) -> Tuple[pd.Timestamp, pd.Timestamp]:
    """Find globally consistent chronological boundary timestamps across all tickers."""
    all_dates = set()
    for df in feature_dict.values():
        all_dates.update(df.index)

    sorted_dates = sorted(list(all_dates))
    total_dates = len(sorted_dates)

    train_idx = int(total_dates * train_ratio)
    val_idx = int(total_dates * (train_ratio + val_ratio))

    train_cutoff = sorted_dates[train_idx]
    val_cutoff = sorted_dates[val_idx]

    return train_cutoff, val_cutoff


def build_sliding_windows_for_df(
    df: pd.DataFrame,
    scaled_features: np.ndarray,
    window_size: int = WINDOW_SIZE,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Construct sliding windows strictly within a single partition.
    
    Guarantees windows never cross partition boundaries.
    """
    n_rows = len(df)
    if n_rows < window_size:
        return (
            np.empty((0, window_size, scaled_features.shape[1])),
            np.empty((0,)),
            np.empty((0,)),
            np.empty((0,)),
        )

    num_samples = n_rows - window_size + 1
    X = np.zeros((num_samples, window_size, scaled_features.shape[1]), dtype=np.float32)
    y_dir = np.zeros(num_samples, dtype=np.float32)
    y_ret = np.zeros(num_samples, dtype=np.float32)
    closes = np.zeros(num_samples, dtype=np.float32)

    raw_y_dir = df["target_direction"].values
    raw_y_ret = df["target_return"].values
    raw_close = df["Close"].values

    for i in range(num_samples):
        # Window of length window_size from i to i + window_size
        X[i] = scaled_features[i : i + window_size]
        # Target associated with the last time step t in the window (t = i + window_size - 1)
        y_dir[i] = raw_y_dir[i + window_size - 1]
        y_ret[i] = raw_y_ret[i + window_size - 1]
        closes[i] = raw_close[i + window_size - 1]

    return X, y_dir, y_ret, closes


def split_and_prepare_dataset(
    feature_dict: Dict[str, pd.DataFrame],
    window_size: int = WINDOW_SIZE,
    artifacts_dir: Path = ARTIFACTS_DIR,
) -> Tuple[
    Tuple[np.ndarray, np.ndarray, np.ndarray],
    Tuple[np.ndarray, np.ndarray, np.ndarray],
    Tuple[np.ndarray, np.ndarray, np.ndarray],
    Dict[str, Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]],
    StandardScaler,
    Tuple[str, str],
]:
    """
    Split data chronologically, fit scaler on train only, and build sliding windows.
    
    Returns:
    - (X_train, y_train_dir, y_train_ret)
    - (X_val, y_val_dir, y_val_ret)
    - (X_test, y_test_dir, y_test_ret)
    - per_symbol_test: {sym: (X_test_sym, y_test_dir_sym, y_test_ret_sym, test_closes)}
    - scaler: fitted StandardScaler instance
    - (train_cutoff_str, val_cutoff_str)
    """
    train_cutoff, val_cutoff = compute_chronological_cutoffs(feature_dict)

    # 1. Split each ticker's DataFrame into train, val, test
    train_dfs = {}
    val_dfs = {}
    test_dfs = {}

    for sym, df in feature_dict.items():
        train_dfs[sym] = df.loc[df.index < train_cutoff].copy()
        val_dfs[sym] = df.loc[(df.index >= train_cutoff) & (df.index < val_cutoff)].copy()
        test_dfs[sym] = df.loc[df.index >= val_cutoff].copy()

    # 2. Fit scaler strictly on training set feature rows
    all_train_features = []
    for df in train_dfs.values():
        if not df.empty:
            all_train_features.append(df[FEATURE_COLS].values)

    combined_train_features = np.vstack(all_train_features)
    scaler = StandardScaler()
    scaler.fit(combined_train_features)

    # Persist scaler artifact
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(scaler, artifacts_dir / "scaler.pkl")

    # 3. Create sliding windows per partition without boundary crossing
    X_train_list, y_train_dir_list, y_train_ret_list = [], [], []
    X_val_list, y_val_dir_list, y_val_ret_list = [], [], []
    X_test_list, y_test_dir_list, y_test_ret_list = [], [], []
    per_symbol_test = {}

    for sym in feature_dict.keys():
        # Train partition
        t_df = train_dfs[sym]
        if len(t_df) >= window_size:
            scaled_t = scaler.transform(t_df[FEATURE_COLS].values)
            X_t, yd_t, yr_t, _ = build_sliding_windows_for_df(t_df, scaled_t, window_size)
            X_train_list.append(X_t)
            y_train_dir_list.append(yd_t)
            y_train_ret_list.append(yr_t)

        # Validation partition
        v_df = val_dfs[sym]
        if len(v_df) >= window_size:
            scaled_v = scaler.transform(v_df[FEATURE_COLS].values)
            X_v, yd_v, yr_v, _ = build_sliding_windows_for_df(v_df, scaled_v, window_size)
            X_val_list.append(X_v)
            y_val_dir_list.append(yd_v)
            y_val_ret_list.append(yr_v)

        # Test partition
        s_df = test_dfs[sym]
        if len(s_df) >= window_size:
            scaled_s = scaler.transform(s_df[FEATURE_COLS].values)
            X_s, yd_s, yr_s, c_s = build_sliding_windows_for_df(s_df, scaled_s, window_size)
            X_test_list.append(X_s)
            y_test_dir_list.append(yd_s)
            y_test_ret_list.append(yr_s)
            per_symbol_test[sym] = (X_s, yd_s, yr_s, c_s)

    # Concatenate windows
    X_train = np.concatenate(X_train_list, axis=0)
    y_train_dir = np.concatenate(y_train_dir_list, axis=0)
    y_train_ret = np.concatenate(y_train_ret_list, axis=0)

    X_val = np.concatenate(X_val_list, axis=0)
    y_val_dir = np.concatenate(y_val_dir_list, axis=0)
    y_val_ret = np.concatenate(y_val_ret_list, axis=0)

    X_test = np.concatenate(X_test_list, axis=0)
    y_test_dir = np.concatenate(y_test_dir_list, axis=0)
    y_test_ret = np.concatenate(y_test_ret_list, axis=0)

    cutoff_info = (
        train_cutoff.strftime("%Y-%m-%d"),
        val_cutoff.strftime("%Y-%m-%d"),
    )

    return (
        (X_train, y_train_dir, y_train_ret),
        (X_val, y_val_dir, y_val_ret),
        (X_test, y_test_dir, y_test_ret),
        per_symbol_test,
        scaler,
        cutoff_info,
    )
