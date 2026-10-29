"""Model training, validation hyperparameter selection, test evaluation, and metrics export."""

import json
import platform
import time
import numpy as np
import tensorflow as tf
from pathlib import Path
from typing import Dict, Any

from ml.config import (
    ARTIFACTS_DIR,
    RANDOM_SEED,
    TICKERS,
    WINDOW_SIZE,
)
from ml.data import load_all_data
from ml.features import compute_features
from ml.split import split_and_prepare_dataset
from ml.baselines import (
    MajorityClassBaseline,
    PersistenceBaseline,
    LinearBaselines,
    ZeroReturnBaseline,
)
from ml.model import build_lstm_model, set_all_seeds
from ml.evaluate import (
    compute_directional_metrics,
    compute_return_metrics,
    compute_bootstrap_ci,
    run_toy_backtest,
)


def tune_hyperparameters(
    X_train: np.ndarray,
    y_train_dir: np.ndarray,
    y_train_ret: np.ndarray,
    X_val: np.ndarray,
    y_val_dir: np.ndarray,
    y_val_ret: np.ndarray,
) -> Dict[str, Any]:
    """
    Evaluate small grid of hyperparameters strictly on the validation set.
    """
    grid = [
        {"units": 32, "num_layers": 1, "learning_rate": 0.001, "dropout_rate": 0.2},
        {"units": 48, "num_layers": 1, "learning_rate": 0.0005, "dropout_rate": 0.2},
    ]

    best_val_loss = float("inf")
    best_params = grid[0]

    input_shape = (X_train.shape[1], X_train.shape[2])

    for params in grid:
        set_all_seeds(RANDOM_SEED)
        model = build_lstm_model(
            input_shape=input_shape,
            units=params["units"],
            num_layers=params["num_layers"],
            dropout_rate=params["dropout_rate"],
            learning_rate=params["learning_rate"],
        )

        history = model.fit(
            X_train,
            {"direction": y_train_dir, "return": y_train_ret},
            validation_data=(X_val, {"direction": y_val_dir, "return": y_val_ret}),
            epochs=5,
            batch_size=128,
            verbose=0,
        )

        min_val_loss = min(history.history["val_loss"])
        if min_val_loss < best_val_loss:
            best_val_loss = min_val_loss
            best_params = params

    return best_params


def train_and_evaluate() -> Dict[str, Any]:
    """Execute complete end-to-end training and evaluation pipeline."""
    start_time = time.time()
    set_all_seeds(RANDOM_SEED)

    # 1. Ingest and cache data
    print("Ingesting historical market data for tickers...")
    raw_dfs, metadata = load_all_data(tickers=TICKERS)

    # 2. Compute technical features
    print("Computing technical indicators with zero lookahead...")
    feature_dfs = {}
    for sym, df in raw_dfs.items():
        feature_dfs[sym] = compute_features(df)

    # 3. Chronological split & sliding window creation
    print("Partitioning chronologically (70/15/15) and fitting scaler on train only...")
    (
        (X_train, y_train_dir, y_train_ret),
        (X_val, y_val_dir, y_val_ret),
        (X_test, y_test_dir, y_test_ret),
        per_symbol_test,
        scaler,
        (train_cutoff, val_cutoff),
    ) = split_and_prepare_dataset(feature_dfs, window_size=WINDOW_SIZE)

    # 4. Hyperparameter tuning on validation set only
    print("Evaluating hyperparameter grid on validation set...")
    best_params = tune_hyperparameters(
        X_train, y_train_dir, y_train_ret, X_val, y_val_dir, y_val_ret
    )

    # 5. Train final model with EarlyStopping on validation loss
    print(f"Training final LSTM model with best parameters: {best_params}...")
    set_all_seeds(RANDOM_SEED)
    input_shape = (X_train.shape[1], X_train.shape[2])
    model = build_lstm_model(
        input_shape=input_shape,
        units=best_params["units"],
        num_layers=best_params["num_layers"],
        dropout_rate=best_params["dropout_rate"],
        learning_rate=best_params["learning_rate"],
    )

    early_stopping = tf.keras.callbacks.EarlyStopping(
        monitor="val_loss",
        patience=5,
        restore_best_weights=True,
    )

    train_history = model.fit(
        X_train,
        {"direction": y_train_dir, "return": y_train_ret},
        validation_data=(X_val, {"direction": y_val_dir, "return": y_val_ret}),
        epochs=15,
        batch_size=128,
        callbacks=[early_stopping],
        verbose=1,
    )

    # Save trained model artifact
    model_save_path = ARTIFACTS_DIR / "model.keras"
    model.save(model_save_path)
    print(f"Model saved to {model_save_path}")

    # 6. Fit Baselines on Training Set
    print("Fitting baseline models on training set...")
    maj_baseline = MajorityClassBaseline()
    maj_baseline.fit(y_train_dir)

    pers_baseline = PersistenceBaseline(log_return_feature_idx=0)

    lin_baseline = LinearBaselines(random_state=RANDOM_SEED)
    lin_baseline.fit(X_train, y_train_dir, y_train_ret)

    zero_ret_baseline = ZeroReturnBaseline()

    # 7. Evaluate on Test Set strictly once
    print("Evaluating on test set...")
    n_test = len(y_test_dir)

    # LSTM Test predictions
    lstm_prob, lstm_ret = model.predict(X_test, verbose=0)
    lstm_prob = lstm_prob.ravel()
    lstm_ret = lstm_ret.ravel()
    lstm_pred_dir = (lstm_prob >= 0.5).astype(np.int32)
    lstm_up_count = int(np.sum(lstm_pred_dir == 1))
    lstm_up_share = round(float(lstm_up_count / n_test * 100.0), 2)

    # Baselines Test predictions
    maj_preds, maj_probs = maj_baseline.predict(n_test)
    pers_preds, pers_probs = pers_baseline.predict(X_test)
    lin_dir_preds, lin_dir_probs, lin_ret_preds = lin_baseline.predict(X_test)
    zero_ret_preds = zero_ret_baseline.predict(n_test)

    # Reconstruct test closes for price MAPE calculation
    all_test_closes = np.concatenate([v[3] for v in per_symbol_test.values()])

    # Compute Overall Directional Metrics
    lstm_dir_metrics = compute_directional_metrics(y_test_dir, lstm_pred_dir, lstm_prob)
    maj_dir_metrics = compute_directional_metrics(y_test_dir, maj_preds, maj_probs)
    pers_dir_metrics = compute_directional_metrics(y_test_dir, pers_preds, pers_probs)
    lin_dir_metrics = compute_directional_metrics(y_test_dir, lin_dir_preds, lin_dir_probs)

    # Compute Overall Return Metrics
    lstm_ret_metrics = compute_return_metrics(y_test_ret, lstm_ret, all_test_closes)
    zero_ret_metrics = compute_return_metrics(y_test_ret, zero_ret_preds, all_test_closes)
    lin_ret_metrics = compute_return_metrics(y_test_ret, lin_ret_preds, all_test_closes)

    # Compute 95% Bootstrap CI for LSTM Directional Accuracy
    ci_lower, ci_upper = compute_bootstrap_ci(y_test_dir, lstm_pred_dir, n_bootstraps=1000)

    # Baseline comparison summary
    comparison = {
        "beats_majority_baseline": bool(lstm_dir_metrics["accuracy"] > maj_dir_metrics["accuracy"]),
        "beats_persistence_baseline": bool(lstm_dir_metrics["accuracy"] > pers_dir_metrics["accuracy"]),
        "beats_linear_baseline": bool(lstm_dir_metrics["accuracy"] > lin_dir_metrics["accuracy"]),
        "beats_zero_return_rmse": bool(lstm_ret_metrics["rmse"] < zero_ret_metrics["rmse"]),
        "within_confidence_interval": {
            "majority": bool(ci_lower <= maj_dir_metrics["accuracy"] <= ci_upper),
            "persistence": bool(ci_lower <= pers_dir_metrics["accuracy"] <= ci_upper),
            "logistic_regression": bool(ci_lower <= lin_dir_metrics["accuracy"] <= ci_upper),
        },
    }

    # Per-symbol evaluation
    per_symbol_results = {}
    for sym, (X_s, yd_s, yr_s, c_s) in per_symbol_test.items():
        if len(yd_s) == 0:
            continue
        p_prob, p_ret = model.predict(X_s, verbose=0)
        p_dir = (p_prob.ravel() >= 0.5).astype(np.int32)
        s_dir_metrics = compute_directional_metrics(yd_s, p_dir)
        s_ret_metrics = compute_return_metrics(yr_s, p_ret.ravel(), c_s)
        s_ci_lower, s_ci_upper = compute_bootstrap_ci(yd_s, p_dir, n_bootstraps=500)
        s_backtest = run_toy_backtest(yr_s, p_dir)

        per_symbol_results[sym] = {
            "test_samples": int(len(yd_s)),
            "directional_accuracy": round(s_dir_metrics["accuracy"] * 100.0, 2),
            "ci_95": [round(s_ci_lower * 100.0, 2), round(s_ci_upper * 100.0, 2)],
            "f1": round(s_dir_metrics["f1"], 4),
            "rmse": round(s_ret_metrics["rmse"], 6),
            "mae": round(s_ret_metrics["mae"], 6),
            "price_mape_percent": round(s_ret_metrics["price_mape_percent"], 2),
            "toy_backtest": s_backtest,
        }

    # Toy Backtest on total test set
    overall_backtest = run_toy_backtest(y_test_ret, lstm_pred_dir)

    elapsed_time = round(time.time() - start_time, 2)

    # Compile complete metrics document
    metrics_payload = {
        "metadata": {
            "execution_date": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "elapsed_seconds": elapsed_time,
            "platform": platform.platform(),
            "processor": platform.processor(),
            "python_version": platform.python_version(),
            "tensorflow_version": tf.__version__,
            "tickers_count": len(TICKERS),
            "tickers": TICKERS,
            "train_samples": int(len(y_train_dir)),
            "val_samples": int(len(y_val_dir)),
            "test_samples": int(len(y_test_dir)),
            "train_cutoff_date": train_cutoff,
            "val_cutoff_date": val_cutoff,
            "window_size": WINDOW_SIZE,
            "best_hyperparameters": best_params,
        },
        "overall_test_metrics": {
            "lstm": {
                "directional_accuracy": round(lstm_dir_metrics["accuracy"] * 100.0, 2),
                "ci_95": [round(ci_lower * 100.0, 2), round(ci_upper * 100.0, 2)],
                "precision": round(lstm_dir_metrics["precision"], 4),
                "recall": round(lstm_dir_metrics["recall"], 4),
                "f1": round(lstm_dir_metrics["f1"], 4),
                "rmse": round(lstm_ret_metrics["rmse"], 6),
                "mae": round(lstm_ret_metrics["mae"], 6),
                "price_mape_percent": round(lstm_ret_metrics["price_mape_percent"], 2),
                "up_prediction_count": lstm_up_count,
                "up_prediction_share_percent": lstm_up_share,
            },
            "baselines": {
                "majority_class": {
                    "directional_accuracy": round(maj_dir_metrics["accuracy"] * 100.0, 2),
                    "f1": round(maj_dir_metrics["f1"], 4),
                },
                "persistence": {
                    "directional_accuracy": round(pers_dir_metrics["accuracy"] * 100.0, 2),
                    "f1": round(pers_dir_metrics["f1"], 4),
                },
                "logistic_regression": {
                    "directional_accuracy": round(lin_dir_metrics["accuracy"] * 100.0, 2),
                    "f1": round(lin_dir_metrics["f1"], 4),
                },
                "ridge_regression": {
                    "rmse": round(lin_ret_metrics["rmse"], 6),
                    "mae": round(lin_ret_metrics["mae"], 6),
                    "price_mape_percent": round(lin_ret_metrics["price_mape_percent"], 2),
                },
                "zero_return": {
                    "rmse": round(zero_ret_metrics["rmse"], 6),
                    "mae": round(zero_ret_metrics["mae"], 6),
                    "price_mape_percent": round(zero_ret_metrics["price_mape_percent"], 2),
                },
            },
            "comparison": comparison,
            "toy_backtest": overall_backtest,
        },
        "per_symbol_metrics": per_symbol_results,
        "symbol_data_summary": metadata,
    }

    # Save to ml/artifacts/metrics.json
    metrics_path = ARTIFACTS_DIR / "metrics.json"
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics_payload, f, indent=2)

    print(f"Metrics saved to {metrics_path}")
    return metrics_payload


if __name__ == "__main__":
    train_and_evaluate()
