"""Tests for LSTM model architecture and dual-head outputs."""

import numpy as np
import pytest

from ml.model import build_lstm_model


def test_model_architecture_and_shapes():
    window_size = 20
    n_features = 14
    input_shape = (window_size, n_features)

    model = build_lstm_model(
        input_shape=input_shape,
        units=16,
        num_layers=1,
        dropout_rate=0.1,
        learning_rate=0.001,
    )

    dummy_input = np.zeros((4, window_size, n_features), dtype=np.float32)
    dir_pred, ret_pred = model(dummy_input)

    assert dir_pred.shape == (4, 1)
    assert ret_pred.shape == (4, 1)

    # Sigmoid output must be in [0, 1]
    assert (dir_pred.numpy() >= 0.0).all() and (dir_pred.numpy() <= 1.0).all()
