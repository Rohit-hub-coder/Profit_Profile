"""Tests for evaluation metrics, confidence intervals, baselines, and toy backtest."""

import numpy as np
import pytest

from ml.baselines import (
    MajorityClassBaseline,
    PersistenceBaseline,
    ZeroReturnBaseline,
    LinearBaselines,
)
from ml.evaluate import (
    compute_directional_metrics,
    compute_return_metrics,
    compute_bootstrap_ci,
    run_toy_backtest,
)


def test_directional_metrics_exact():
    y_true = np.array([1, 0, 1, 1, 0, 0])
    y_pred = np.array([1, 0, 1, 0, 0, 1])
    # Matches: indices 0, 1, 2, 4 -> 4/6 = 0.6667
    metrics = compute_directional_metrics(y_true, y_pred)

    assert np.isclose(metrics["accuracy"], 4.0 / 6.0)
    # TP = 2 (idx 0, 2), FP = 1 (idx 5), FN = 1 (idx 3), TN = 2 (idx 1, 4)
    # Precision = 2 / 3
    assert np.isclose(metrics["precision"], 2.0 / 3.0)
    # Recall = 2 / 3
    assert np.isclose(metrics["recall"], 2.0 / 3.0)
    # F1 = 2/3
    assert np.isclose(metrics["f1"], 2.0 / 3.0)


def test_return_metrics_exact():
    y_true = np.array([0.02, -0.01, 0.03])
    y_pred = np.array([0.01, -0.01, 0.01])
    # Errors: [0.01, 0.0, 0.02]
    # Squared errors: [0.0001, 0.0, 0.0004] -> mean = 0.0005/3 = 0.00016667 -> sqrt = ~0.0129099
    # MAE: (0.01 + 0.0 + 0.02) / 3 = 0.01
    closes = np.array([100.0, 100.0, 100.0])

    metrics = compute_return_metrics(y_true, y_pred, closes)

    assert np.isclose(metrics["mae"], 0.01)
    assert np.isclose(metrics["rmse"], np.sqrt(0.0005 / 3.0))
    assert metrics["price_mape_percent"] > 0.0


def test_bootstrap_ci_bounds():
    rng = np.random.RandomState(42)
    y_true = rng.binomial(1, 0.5, size=200)
    y_pred = rng.binomial(1, 0.5, size=200)

    point_acc = np.mean(y_true == y_pred)
    ci_lower, ci_upper = compute_bootstrap_ci(y_true, y_pred, n_bootstraps=500, seed=42)

    assert 0.0 <= ci_lower <= ci_upper <= 1.0
    assert ci_lower <= point_acc <= ci_upper


def test_majority_class_baseline():
    baseline = MajorityClassBaseline()
    y_train = np.array([1, 1, 1, 0])  # Majority is 1
    baseline.fit(y_train)

    preds, probs = baseline.predict(5)
    assert len(preds) == 5
    assert (preds == 1).all()
    assert np.isclose(baseline.prob, 0.75)


def test_persistence_baseline():
    baseline = PersistenceBaseline(log_return_feature_idx=0)
    # X shape: (3 samples, 5 window_size, 2 features)
    X = np.zeros((3, 5, 2))
    # Feature 0 at time t (last step in window):
    X[0, -1, 0] = 0.01   # Up
    X[1, -1, 0] = -0.02  # Down
    X[2, -1, 0] = 0.0    # Flat (not > 0 -> 0)

    preds, probs = baseline.predict(X)
    np.testing.assert_array_equal(preds, [1, 0, 0])


def test_zero_return_baseline():
    baseline = ZeroReturnBaseline()
    preds = baseline.predict(10)
    assert len(preds) == 10
    assert (preds == 0.0).all()


def test_toy_backtest():
    actual_returns = np.array([0.02, -0.01, 0.03, -0.02])
    predicted_directions = np.array([1, 0, 1, 0])  # Perfectly predicted
    # Long on up days (+0.02, +0.03), short on down days (-(-0.01)=+0.01, -(-0.02)=+0.02)
    res = run_toy_backtest(actual_returns, predicted_directions, fee_bps=0.0)

    assert res["strategy_cumulative_return_percent"] > 0.0


def test_linear_ridge_baseline_stability():
    """
    Ensure Ridge return predictions remain stable, well-conditioned, and comparable
    to the zero-return baseline on stationary feature data without explosive outliers.
    """
    rng = np.random.RandomState(42)
    n_samples, window_size, n_features = 200, 30, 14
    X_train = rng.normal(0, 1, size=(n_samples, window_size, n_features)).astype(np.float32)
    y_train_dir = rng.binomial(1, 0.5, size=n_samples).astype(np.float32)
    y_train_ret = rng.normal(0.0005, 0.015, size=n_samples).astype(np.float32)

    X_test = rng.normal(0, 1, size=(50, window_size, n_features)).astype(np.float32)
    y_test_ret = rng.normal(0.0005, 0.015, size=50).astype(np.float32)

    baselines = LinearBaselines(random_state=42)
    baselines.fit(X_train, y_train_dir, y_train_ret)
    _, _, ret_preds = baselines.predict(X_test)

    zero_rmse = np.sqrt(np.mean(y_test_ret**2))
    ridge_rmse = np.sqrt(np.mean((y_test_ret - ret_preds)**2))

    # Ridge RMSE should be comparable to zero return (within 2x on stationary gaussian noise)
    # and must never explode to 4.5x due to unhandled numerical outliers
    assert ridge_rmse < 2.0 * zero_rmse, f"Ridge RMSE exploded: {ridge_rmse} vs Zero-return {zero_rmse}"
    assert np.isfinite(ret_preds).all()

