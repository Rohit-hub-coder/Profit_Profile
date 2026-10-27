"""Keras dual-output LSTM architecture for return regression and direction classification."""

import os
import random
import numpy as np
import tensorflow as tf
import keras
from keras import layers

from ml.config import RANDOM_SEED


def set_all_seeds(seed: int = RANDOM_SEED):
    """Seed Python, NumPy, and TensorFlow for deterministic reproducibility."""
    random.seed(seed)
    np.random.seed(seed)
    tf.random.set_seed(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)


def build_lstm_model(
    input_shape: tuple,
    units: int = 32,
    num_layers: int = 1,
    dropout_rate: float = 0.2,
    learning_rate: float = 0.001,
) -> keras.Model:
    """
    Build dual-output multi-task LSTM network.
    
    Outputs:
    - direction: sigmoid activation in [0, 1] for next-day direction probability.
    - return: linear activation for next-day log return forecast.
    """
    inputs = keras.Input(shape=input_shape, name="market_sequence")

    if num_layers == 1:
        x = layers.LSTM(units, return_sequences=False, name="lstm_1")(inputs)
        x = layers.Dropout(dropout_rate, name="dropout_1")(x)
    else:
        x = layers.LSTM(units, return_sequences=True, name="lstm_1")(inputs)
        x = layers.Dropout(dropout_rate, name="dropout_1")(x)
        x = layers.LSTM(max(16, units // 2), return_sequences=False, name="lstm_2")(x)
        x = layers.Dropout(dropout_rate, name="dropout_2")(x)

    shared_dense = layers.Dense(16, activation="relu", name="shared_dense")(x)

    # Classification output (direction probability)
    direction_out = layers.Dense(1, activation="sigmoid", name="direction")(shared_dense)

    # Regression output (predicted next-day log return)
    return_out = layers.Dense(1, activation="linear", name="return")(shared_dense)

    model = keras.Model(inputs=inputs, outputs=[direction_out, return_out], name="lstm_stock_forecaster")

    # Dual-task loss configuration: balanced scale
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=learning_rate),
        loss={
            "direction": "binary_crossentropy",
            "return": "mean_squared_error",
        },
        loss_weights={
            "direction": 1.0,
            "return": 50.0,
        },
        metrics={
            "direction": ["accuracy"],
            "return": ["mae"],
        },
    )

    return model
