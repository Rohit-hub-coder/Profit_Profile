"""Benchmark baseline models for time series financial forecasting."""

import numpy as np
from sklearn.linear_model import LogisticRegression, Ridge
from typing import Dict, Tuple

from ml.config import RANDOM_SEED


class MajorityClassBaseline:
    """Baseline predicting the most frequent direction class from the training set."""

    def __init__(self):
        self.majority_class = 1
        self.prob = 0.5

    def fit(self, y_train_dir: np.ndarray):
        up_count = np.sum(y_train_dir == 1)
        total = len(y_train_dir)
        self.prob = float(up_count / total) if total > 0 else 0.5
        self.majority_class = 1 if self.prob >= 0.5 else 0

    def predict(self, n_samples: int) -> Tuple[np.ndarray, np.ndarray]:
        preds = np.full(n_samples, self.majority_class, dtype=np.int32)
        probs = np.full(n_samples, self.prob, dtype=np.float32)
        return preds, probs


class PersistenceBaseline:
    """
    Baseline predicting next-day direction equals today's direction.
    
    Uses log_return feature at the most recent time step in the window.
    """

    def __init__(self, log_return_feature_idx: int = 0):
        self.feature_idx = log_return_feature_idx

    def predict(self, X: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        # X shape: (samples, window_size, features)
        # Last time step is index -1
        last_log_ret = X[:, -1, self.feature_idx]
        preds = (last_log_ret > 0.0).astype(np.int32)
        probs = np.where(preds == 1, 0.75, 0.25).astype(np.float32)
        return preds, probs


class ZeroReturnBaseline:
    """Baseline predicting exactly zero return for regression."""

    def predict(self, n_samples: int) -> np.ndarray:
        return np.zeros(n_samples, dtype=np.float32)


class LinearBaselines:
    """Logistic Regression for direction and Ridge Regression for returns."""

    def __init__(self, random_state: int = RANDOM_SEED):
        self.clf = LogisticRegression(C=1.0, max_iter=1000, random_state=random_state)
        self.reg = Ridge(alpha=100.0, random_state=random_state)

    def fit(self, X_train: np.ndarray, y_train_dir: np.ndarray, y_train_ret: np.ndarray):
        # Flatten (samples, window, features) -> (samples, window * features)
        n_samples = X_train.shape[0]
        X_flat = X_train.reshape(n_samples, -1)
        self.clf.fit(X_flat, y_train_dir)
        self.reg.fit(X_flat, y_train_ret)

    def predict(self, X_test: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        n_samples = X_test.shape[0]
        X_flat = X_test.reshape(n_samples, -1)
        dir_preds = self.clf.predict(X_flat)
        dir_probs = self.clf.predict_proba(X_flat)[:, 1]
        raw_ret = self.reg.predict(X_flat)
        ret_preds = np.clip(raw_ret, -0.2, 0.2)
        return dir_preds, dir_probs, ret_preds
