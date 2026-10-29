"""Tests for feature engineering, zero-lookahead safety, and target generation."""

import numpy as np
import pandas as pd
import pytest

from ml.features import FEATURE_COLS, compute_features, calculate_rsi, calculate_macd


def create_synthetic_ohlcv(n_days: int = 100, seed: int = 42) -> pd.DataFrame:
    """Generate synthetic OHLCV dataframe with a datetime index."""
    rng = np.random.RandomState(seed)
    dates = pd.date_range("2020-01-01", periods=n_days, freq="B")
    
    # Random walk for close prices
    returns = rng.normal(0.0005, 0.015, size=n_days)
    close = 100.0 * np.exp(np.cumsum(returns))
    high = close * (1.0 + np.abs(rng.normal(0, 0.005, size=n_days)))
    low = close * (1.0 - np.abs(rng.normal(0, 0.005, size=n_days)))
    open_p = (high + low) / 2.0
    volume = rng.uniform(100_000, 1_000_000, size=n_days)
    
    df = pd.DataFrame(
        {
            "Open": open_p,
            "High": high,
            "Low": low,
            "Close": close,
            "Volume": volume,
        },
        index=dates,
    )
    return df


def test_feature_cols_exist_and_no_nans_after_warmup():
    df = create_synthetic_ohlcv(100)
    feat_df = compute_features(df)
    
    # Check all feature columns exist
    for col in FEATURE_COLS:
        assert col in feat_df.columns, f"Missing feature column: {col}"
    
    assert "target_return" in feat_df.columns
    assert "target_direction" in feat_df.columns
    
    # Warmup period drops initial NaNs; verify no NaNs remain in clean feature rows
    assert not feat_df[FEATURE_COLS].isna().any().any()
    assert not feat_df[["target_return", "target_direction"]].isna().any().any()


def test_shift_leakage_safety():
    """
    Shift Test: Feature values at time t must NEVER depend on market data at t + 1 or beyond.
    
    If we perturb prices at day k, feature values for all days t < k must remain strictly identical.
    """
    df_orig = create_synthetic_ohlcv(120, seed=123)
    feat_orig = compute_features(df_orig)
    
    perturb_idx = 80
    df_perturbed = df_orig.copy()
    # Drastically perturb price and volume at and after perturb_idx
    df_perturbed.iloc[perturb_idx:, df_perturbed.columns.get_loc("Close")] *= 2.5
    df_perturbed.iloc[perturb_idx:, df_perturbed.columns.get_loc("High")] *= 2.5
    df_perturbed.iloc[perturb_idx:, df_perturbed.columns.get_loc("Low")] *= 2.5
    df_perturbed.iloc[perturb_idx:, df_perturbed.columns.get_loc("Volume")] *= 5.0
    
    feat_perturbed = compute_features(df_perturbed)
    
    # Common dates before perturb_idx
    dates_before = df_orig.index[:perturb_idx]
    common_dates = [d for d in dates_before if d in feat_orig.index and d in feat_perturbed.index]
    
    for col in FEATURE_COLS:
        np.testing.assert_allclose(
            feat_orig.loc[common_dates, col].values,
            feat_perturbed.loc[common_dates, col].values,
            err_msg=f"Lookahead leakage detected in feature '{col}' before perturbation date!",
            rtol=1e-7,
            atol=1e-7,
        )


def test_rsi_bounds():
    """RSI must be bounded between 0 and 100."""
    df = create_synthetic_ohlcv(80)
    rsi = calculate_rsi(df["Close"], period=14).dropna()
    assert (rsi >= 0.0).all() and (rsi <= 100.0).all()


def test_target_generation():
    """Verify target_return and target_direction match t+1 future value."""
    df = create_synthetic_ohlcv(60)
    feat_df = compute_features(df)
    
    for i in range(len(feat_df) - 1):
        curr_date = feat_df.index[i]
        next_date = feat_df.index[i + 1]
        
        c_curr = df.loc[curr_date, "Close"]
        c_next = df.loc[next_date, "Close"]
        expected_ret = np.log(c_next / c_curr)
        expected_dir = 1 if expected_ret > 0 else 0
        
        actual_ret = feat_df.loc[curr_date, "target_return"]
        actual_dir = feat_df.loc[curr_date, "target_direction"]
        
        assert np.isclose(actual_ret, expected_ret, atol=1e-6)
        assert actual_dir == expected_dir


def test_zero_volume_numerical_stability():
    """
    Verify volume_change remains numerically stable and finite when volume is zero or near zero.
    
    Prevents division by zero or near-zero denominators (e.g. 1e-8) that produce ~1e15 values,
    which previously destabilized linear Ridge regression baselines across 30-day sliding windows.
    """
    df = create_synthetic_ohlcv(60)
    # Inject zero-volume day followed by typical trading volume
    df.iloc[25, df.columns.get_loc("Volume")] = 0.0
    df.iloc[26, df.columns.get_loc("Volume")] = 250_000.0

    feat_df = compute_features(df)
    vol_chg = feat_df["volume_change"].dropna()

    assert np.isfinite(vol_chg).all(), "volume_change contains non-finite values"
    assert (vol_chg.abs() <= 10.0).all(), f"volume_change exceeded safe bounds: max {vol_chg.abs().max()}"

