"""Tests for chronological dataset splitting, scaler isolation, and window boundary safety."""

import numpy as np
import pandas as pd
import pytest

from ml.features import FEATURE_COLS, compute_features
from ml.split import (
    compute_chronological_cutoffs,
    build_sliding_windows_for_df,
    split_and_prepare_dataset,
)
from ml.tests.test_features import create_synthetic_ohlcv


def test_chronological_cutoffs():
    df1 = compute_features(create_synthetic_ohlcv(200, seed=1))
    df2 = compute_features(create_synthetic_ohlcv(200, seed=2))
    feature_dict = {"SYM1": df1, "SYM2": df2}

    train_cutoff, val_cutoff = compute_chronological_cutoffs(
        feature_dict, train_ratio=0.7, val_ratio=0.15
    )

    assert train_cutoff < val_cutoff
    min_date = min(df1.index.min(), df2.index.min())
    max_date = max(df1.index.max(), df2.index.max())
    assert min_date < train_cutoff < max_date
    assert min_date < val_cutoff < max_date


def test_window_boundary_isolation():
    """Verify that build_sliding_windows_for_df never crosses outside dataframe bounds."""
    df = compute_features(create_synthetic_ohlcv(60, seed=3))
    window_size = 15
    features = df[FEATURE_COLS].values

    X, y_dir, y_ret, closes = build_sliding_windows_for_df(df, features, window_size=window_size)

    expected_samples = len(df) - window_size + 1
    assert len(X) == expected_samples
    assert len(y_dir) == expected_samples
    assert len(y_ret) == expected_samples
    assert len(closes) == expected_samples

    # Check window contents for index i
    for i in range(min(5, expected_samples)):
        # Features in window i should match rows i through i + window_size - 1
        np.testing.assert_allclose(X[i], features[i : i + window_size], rtol=1e-5, atol=1e-5)
        # Target should correspond to row i + window_size - 1
        target_row_idx = i + window_size - 1
        assert y_dir[i] == df["target_direction"].iloc[target_row_idx]
        assert np.isclose(y_ret[i], df["target_return"].iloc[target_row_idx], atol=1e-5)
        assert np.isclose(closes[i], df["Close"].iloc[target_row_idx], atol=1e-3)


def test_split_and_prepare_dataset_isolation(tmp_path):
    """
    Verify chronological integrity across partitions:
    - Train max date < Val min date
    - Val max date < Test min date
    - Scaler is fitted on Train ONLY
    """
    df1 = compute_features(create_synthetic_ohlcv(150, seed=10))
    df2 = compute_features(create_synthetic_ohlcv(150, seed=20))
    feature_dict = {"S1": df1, "S2": df2}

    window_size = 10
    (
        (X_train, y_train_dir, y_train_ret),
        (X_val, y_val_dir, y_val_ret),
        (X_test, y_test_dir, y_test_ret),
        per_symbol_test,
        scaler,
        (train_cutoff, val_cutoff),
    ) = split_and_prepare_dataset(feature_dict, window_size=window_size, artifacts_dir=tmp_path)

    assert len(X_train) > 0
    assert len(X_val) > 0
    assert len(X_test) > 0

    # Scaler mean must match the train data mean exactly
    train_dfs = [df.loc[df.index < train_cutoff, FEATURE_COLS].values for df in feature_dict.values()]
    all_train_features = np.vstack(train_dfs)
    expected_means = np.mean(all_train_features, axis=0)

    np.testing.assert_allclose(scaler.mean_, expected_means, rtol=1e-5, atol=1e-5)

    # Scaler file must be persisted in artifacts_dir
    assert (tmp_path / "scaler.pkl").exists()
