"""Tests verifying scaler fitting strictly on training partitions."""

import numpy as np
import pandas as pd
import pytest
from sklearn.preprocessing import StandardScaler

from ml.features import FEATURE_COLS, compute_features
from ml.split import split_and_prepare_dataset
from ml.tests.test_features import create_synthetic_ohlcv


def test_scaler_not_fitted_on_val_or_test(tmp_path):
    """
    Ensure StandardScaler is fitted exclusively on train data.
    If validation or test data had different distributions, scaler params must reflect train only.
    """
    df1 = compute_features(create_synthetic_ohlcv(200, seed=42))
    df2 = compute_features(create_synthetic_ohlcv(200, seed=99))
    feature_dict = {"S1": df1, "S2": df2}

    (
        (X_train, y_train_dir, y_train_ret),
        (X_val, y_val_dir, y_val_ret),
        (X_test, y_test_dir, y_test_ret),
        per_symbol_test,
        scaler,
        (train_cutoff, val_cutoff),
    ) = split_and_prepare_dataset(feature_dict, window_size=15, artifacts_dir=tmp_path)

    # Reconstruct train features manually
    train_features = []
    for df in feature_dict.values():
        t_rows = df.loc[df.index < train_cutoff, FEATURE_COLS].values
        if len(t_rows) > 0:
            train_features.append(t_rows)
    expected_train_matrix = np.vstack(train_features)

    # Reconstruct entire features (including val and test)
    all_features = np.vstack([df[FEATURE_COLS].values for df in feature_dict.values()])

    scaler_train_only = StandardScaler().fit(expected_train_matrix)
    scaler_leaked = StandardScaler().fit(all_features)

    # Scaler must match train-only fit
    np.testing.assert_allclose(scaler.mean_, scaler_train_only.mean_, rtol=1e-5, atol=1e-5)
    np.testing.assert_allclose(scaler.scale_, scaler_train_only.scale_, rtol=1e-5, atol=1e-5)

    # Scaler should differ from leaked scaler
    assert not np.allclose(scaler.mean_, scaler_leaked.mean_, rtol=1e-3, atol=1e-3)
