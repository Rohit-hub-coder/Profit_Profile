"""Evaluation metrics, bootstrap confidence intervals, and toy backtest logic."""

import numpy as np
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
from typing import Dict, Tuple, Optional

from ml.config import RANDOM_SEED


def compute_directional_metrics(
    y_true: np.ndarray, y_pred: np.ndarray, y_prob: Optional[np.ndarray] = None
) -> Dict[str, float]:
    """Compute directional classification metrics."""
    acc = float(accuracy_score(y_true, y_pred))
    prec = float(precision_score(y_true, y_pred, zero_division=0))
    rec = float(recall_score(y_true, y_pred, zero_division=0))
    f1 = float(f1_score(y_true, y_pred, zero_division=0))

    return {
        "accuracy": acc,
        "precision": prec,
        "recall": rec,
        "f1": f1,
    }


def compute_return_metrics(
    y_true_ret: np.ndarray, y_pred_ret: np.ndarray, closes: Optional[np.ndarray] = None
) -> Dict[str, float]:
    """
    Compute regression metrics on next-day log return and next-day price.
    
    Price MAPE uses P_{t+1} = P_t * exp(return) to avoid zero-division instability.
    """
    err = y_true_ret - y_pred_ret
    rmse = float(np.sqrt(np.mean(err**2)))
    mae = float(np.mean(np.abs(err)))

    metrics = {
        "rmse": rmse,
        "mae": mae,
    }

    if closes is not None and len(closes) == len(y_true_ret):
        actual_price = closes * np.exp(np.clip(y_true_ret, -1.0, 1.0))
        pred_price = closes * np.exp(np.clip(y_pred_ret, -1.0, 1.0))
        price_mape = float(np.mean(np.abs((actual_price - pred_price) / actual_price)) * 100.0)
        metrics["price_mape_percent"] = price_mape
    else:
        metrics["price_mape_percent"] = 0.0

    return metrics


def compute_bootstrap_ci(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    n_bootstraps: int = 1000,
    confidence_level: float = 0.95,
    seed: int = RANDOM_SEED,
) -> Tuple[float, float]:
    """
    Compute empirical bootstrap confidence interval for directional accuracy.
    """
    rng = np.random.RandomState(seed)
    n = len(y_true)
    if n == 0:
        return 0.0, 0.0

    boot_accuracies = []
    for _ in range(n_bootstraps):
        sample_indices = rng.randint(0, n, size=n)
        sample_true = y_true[sample_indices]
        sample_pred = y_pred[sample_indices]
        boot_accuracies.append(np.mean(sample_true == sample_pred))

    alpha = (1.0 - confidence_level) / 2.0
    ci_lower = float(np.percentile(boot_accuracies, alpha * 100.0))
    ci_upper = float(np.percentile(boot_accuracies, (1.0 - alpha) * 100.0))
    return ci_lower, ci_upper


def run_toy_backtest(
    actual_returns: np.ndarray,
    predicted_directions: np.ndarray,
    fee_bps: float = 5.0,
) -> Dict[str, float]:
    """
    Toy long/short strategy backtest with transaction costs.
    
    Rule:
    - Long (+1) if predicted_direction == 1, Short (-1) if predicted_direction == 0.
    - Transaction fee deducted on each position flip.
    - Disclaimed as an educational toy evaluation, not trading advice.
    """
    n = len(actual_returns)
    if n == 0:
        return {"strategy_cumulative_return": 0.0, "buy_and_hold_return": 0.0}

    positions = np.where(predicted_directions == 1, 1.0, -1.0)
    fee_rate = fee_bps / 10000.0

    # Position turnover
    turnover = np.abs(np.diff(positions, prepend=positions[0]))
    fees = turnover * fee_rate

    # Strategy daily returns
    strategy_returns = positions * actual_returns - fees
    strat_cum = float(np.prod(1.0 + strategy_returns) - 1.0)
    bnh_cum = float(np.prod(1.0 + actual_returns) - 1.0)

    return {
        "strategy_cumulative_return_percent": round(strat_cum * 100.0, 2),
        "buy_and_hold_return_percent": round(bnh_cum * 100.0, 2),
        "fee_per_trade_bps": fee_bps,
    }
