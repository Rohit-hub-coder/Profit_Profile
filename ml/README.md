# Educational Machine Learning Forecasting Module

> [!IMPORTANT]
> **DISCLAIMER: NOT INVESTMENT ADVICE**  
> This machine learning module is created solely for **educational, experimental, and scientific benchmark purposes**. It does not constitute financial, investment, or trading advice, and must not be used to execute real-world financial transactions. Financial markets are stochastic, non-stationary, and adaptive; historical patterns do not guarantee future performance.

---

## 1. Problem Formulation

The goal of this module is to rigorously evaluate whether standard deep sequence models—specifically a dual-output Long Short-Term Memory (LSTM) network—can extract predictive signals for next-day stock price behavior from daily technical indicators on liquid Indian equities (National Stock Exchange - NSE).

For each trading day $t$, given a lookback window of $W = 30$ historical trading days of technical features:
1. **Direction Classification**: Predict the probability that the next day's closing price will exceed today's price:
   $$\hat{y}^{dir}_{t+1} = \mathbb{P}(Close_{t+1} > Close_t) \in [0, 1]$$
2. **Return Regression**: Predict the next-day continuous log return:
   $$\hat{y}^{ret}_{t+1} = \ln\left(\frac{Close_{t+1}}{Close_t}\right)$$

---

## 2. Dataset & Universe Selection

### Selected Universe (12 Liquid NIFTY Symbols)
The universe is derived from the portfolio holdings and positions mock data in Profit Profile, mapped to Yahoo Finance NSE tickers (`.NS`):

| Ticker | Company Name | Sector | Date Range | Total Rows | Missing Values |
| :--- | :--- | :--- | :---: | :---: | :---: |
| `RELIANCE.NS` | Reliance Industries Ltd | Energy / Conglomerate | 2016-01-01 to 2026-10-23 | 2,670 | 0 |
| `TCS.NS` | Tata Consultancy Services Ltd | IT Services | 2016-01-01 to 2026-10-23 | 2,670 | 0 |
| `INFY.NS` | Infosys Ltd | IT Services | 2016-01-01 to 2026-10-23 | 2,670 | 0 |
| `HDFCBANK.NS` | HDFC Bank Ltd | Banking & Financials | 2016-01-01 to 2026-10-23 | 2,670 | 0 |
| `HINDUNILVR.NS` | Hindustan Unilever Ltd | FMCG | 2016-01-01 to 2026-10-23 | 2,670 | 0 |
| `ITC.NS` | ITC Ltd | FMCG / Diversified | 2016-01-01 to 2026-10-23 | 2,670 | 0 |
| `SBIN.NS` | State Bank of India | Banking & Financials | 2016-01-01 to 2026-10-23 | 2,670 | 0 |
| `BHARTIARTL.NS` | Bharti Airtel Ltd | Telecommunications | 2016-01-01 to 2026-10-23 | 2,670 | 0 |
| `TATAPOWER.NS` | Tata Power Co Ltd | Utilities / Power | 2016-01-01 to 2026-10-23 | 2,670 | 0 |
| `WIPRO.NS` | Wipro Ltd | IT Services | 2016-01-01 to 2026-10-23 | 2,670 | 0 |
| `M&M.NS` | Mahindra & Mahindra Ltd | Automobile | 2016-01-01 to 2026-10-23 | 2,670 | 0 |
| `ONGC.NS` | Oil & Natural Gas Corp Ltd | Oil & Gas | 2016-01-01 to 2026-10-23 | 2,670 | 0 |

### Dropped Symbols & Coverage Policy
The following instruments from the dashboard mock holdings and positions data have **no forecast** and are deliberately excluded from model training:
- `SGBMAY29`: Sovereign Gold Bond tranche maturing May 2029. A government debt instrument, not an equity security. It lacks continuous daily equity OHLCV volume on NSE.
- `KPITTECH`: Demerged and relisted in April 2019 (only 7.5 years of continuous history, failing the $\ge 8$-year liquidity criterion).
- `QUICKHEAL`: Small-cap software company with substantially lower liquidity and wider bid-ask spreads compared to NIFTY-50 large caps.
- `EVEREADY`: Small-cap mock position excluded from the top 12 liquid large-cap universe.
- `JUBLFOOD`: Portfolio holding not included in the pre-registered 12 liquid NIFTY benchmark equities.
- `HUL`: Alternate name for `HINDUNILVR` (Hindustan Unilever).

#### What the Forecast Panel Shows for Unsupported Holdings
In the dashboard Forecast panel (`/forecast`), these instruments are cleanly categorized in the stock selector under **"Other Portfolio Holdings (No Forecast)"**. When selected, the component displays a dedicated, clear informational alert (blue `#e3f2fd` notice explaining the exact reason why that specific security lacks a forecast, e.g. gold bond or corporate demerger), rather than an error banner or failed state.

---

## 3. Feature Engineering & Zero-Lookahead Protocol

All features are strictly computed using historical information up to index $t$ only, preventing lookahead leakage:

1. `log_return`: Continuous daily log return $\ln(Close_t / Close_{t-1})$.
2. `rolling_mean_5`, `rolling_mean_10`, `rolling_mean_20`: Rolling arithmetic mean of log returns.
3. `rolling_std_5`, `rolling_std_10`, `rolling_std_20`: Rolling sample standard deviation of log returns.
4. `momentum`: 10-day price momentum $(Close_t - Close_{t-10}) / Close_{t-10}$.
5. `rsi_14`: 14-day Relative Strength Index computed using exponential moving averages.
6. `macd`, `macd_signal`, `macd_hist`: Moving Average Convergence Divergence with fast=12, slow=26, signal=9.
7. `volume_change`: One-day relative change in trading volume $(Volume_t - Volume_{t-1}) / Volume_{t-1}$.
8. `volatility_20`: 20-day rolling standard deviation of daily percentage price returns.

Verification tests in `ml/tests/test_features.py` enforce via perturbation checks that altering prices at $t+1$ has zero impact on feature values at $t$.

---

## 4. Chronological Splitting & Scaler Isolation

Data is split strictly chronologically across all 12 tickers to prevent temporal leakage:

```text
[----------------- Train (70%) -----------------][--- Val (15%) ---][--- Test (15%) ---]
2016-01-01                              2023-08-02         2025-03-12       2026-10-23
(StandardScaler fit here ONLY)          (Model Tuning)     (One-time Final Test)
```

- **Train partition**: 2016-01-01 to 2023-08-02 (21,900 sliding window samples)
- **Validation partition**: 2023-08-02 to 2025-03-12 (4,416 sliding window samples)
- **Test partition**: 2025-03-12 to 2026-10-23 (4,428 sliding window samples)

The `StandardScaler` is fit **exclusively on the training partition**. Sliding windows ($W = 30$) are constructed strictly within each partition without crossing cutoff boundaries.

---

## 5. Model Architecture & Baselines

### Dual-Head LSTM Architecture
- **Input**: $(B, 30, 14)$
- **LSTM Layer**: 32 units, CPU-optimized
- **Regularization**: Dropout ($p = 0.2$)
- **Shared Dense**: 16 units with ReLU activation
- **Direction Output**: 1 unit with Sigmoid activation (Binary Crossentropy loss)
- **Return Output**: 1 unit with Linear activation (MSE loss)
- **Composite Loss**: $L = L_{direction} + 50 \cdot L_{return}$
- **Optimizer**: Adam with learning rate $\eta = 0.001$
- **EarlyStopping**: Monitored on validation loss with patience of 5 epochs

### Baseline Benchmarks
1. **Majority Class Baseline**: Always predicts the majority class observed in the training set (Class 1).
2. **Persistence Baseline**: Predicts that tomorrow's return direction will match today's return sign ($\mathbb{I}(r_t > 0)$).
3. **Logistic Regression**: Standard L2-regularized logistic regression fit on flattened 30-day window features.
4. **Ridge Regression**: Linear regression with L2 penalty ($\alpha = 100.0$) fit on flattened features.
5. **Zero-Return Baseline**: Always predicts an expected next-day return of 0.0.

---

## 6. Experimental Results

> [!NOTE]
> Every number in the table below is directly extracted from the measured evaluation output recorded in [`ml/artifacts/metrics.json`](file:///c:/Users/Rohit/Desktop/Profit_Profile/ml/artifacts/metrics.json).

### Overall Test Set Performance (4,428 Test Samples)

| Model | Directional Accuracy (%) | 95% Bootstrap CI (%) | Precision | Recall | F1 Score | Return RMSE | Return MAE | Price MAPE (%) | Predicted UP Share (%) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **LSTM Network (Dual-Head)** | **47.49%** | **[45.98%, 48.92%]** | **0.4752** | **0.9948** | **0.6431** | **0.015254** | **0.010816** | **1.08%** | **99.57%** (4,409 / 4,428) |
| **Majority Class Baseline** | **47.56%** | - | 0.4756 | 1.0000 | **0.6446** | - | - | - | **100.00%** |
| **Persistence Baseline** | **49.32%** | - | 0.4758 | 0.4332 | **0.4535** | - | - | - | 49.30% |
| **Logistic Regression** | **49.55%** | - | 0.4849 | 0.5830 | **0.5295** | - | - | - | 57.18% |
| **Ridge Regression** | - | - | - | - | - | **0.014619** | **0.010542** | **1.06%** | - |
| **Zero-Return Baseline** | - | - | - | - | - | **0.014428** | **0.010353** | **1.04%** | - |

### Benchmark Comparison
- **Beats Majority Baseline**: ❌ False (LSTM: 47.49% vs Majority: 47.56%)
- **Beats Persistence Baseline**: ❌ False (LSTM: 47.49% vs Persistence: 49.32%)
- **Beats Logistic Regression**: ❌ False (LSTM: 47.49% vs Logistic: 49.55%)
- **Beats Zero-Return RMSE**: ❌ False (LSTM RMSE: 0.015254 vs Zero-Return: 0.014428)
- **Within 95% Bootstrap CI**: The majority baseline (47.56%) falls cleanly inside the LSTM 95% confidence interval `[45.98%, 48.92%]`.

### Detailed Model Behavior Analysis

#### 1. Pre-Registered LSTM Collapse
The dual-head LSTM model predicted "UP" for **99.57%** of test samples (4,409 out of 4,428) and therefore behaves like the majority-class baseline. Because the directional output probabilities cluster closely around $\hat{p} \approx 0.516$ (ranging strictly between 0.479 and 0.552), the binary classification head learned that predicting the unconditional empirical positive class minimizes cross-entropy loss under high market stochasticity. This was the pre-registered, untuned result, reported faithfully without post-hoc hyperparameter searching on the test split.

#### 2. Ridge Regression Investigation & Bug Resolution
Initial evaluations recorded an inflated Ridge return RMSE of 0.064987 (approx 4.5x higher than the zero-return baseline of 0.014428). Investigation into feature inputs identified a numerical denominator bug in `ml/features.py`: on zero-volume days (such as Diwali Muhurat sessions, market holidays, or data dropouts), computing `(volume - volume.shift(1)) / (volume.shift(1) + 1e-8)` resulted in dividing typical share volumes (~32 million shares) by $10^{-8}$, producing an unphysical feature value of $3.27 \times 10^{15}$. Because 30-day sliding windows span 30 time steps, this single outlier corrupted 30 consecutive feature vectors. In linear Ridge regression, evaluating unconstrained linear combinations over these contaminated vectors produced raw predictions on the order of $\pm 10^{12}$ that clipped to $\pm 0.20$, heavily penalizing test RMSE.

After patching `volume_change` to forward-fill previous valid trading volume and clip extreme spikes, the Ridge baseline achieved a return RMSE of **0.014619** (MAE **0.010542**, Price MAPE **1.06%**). This now cleanly matches the zero-return baseline (**0.014428**), differing by just 1.3% as expected from regularized linear shrinkage towards zero on financial return series. Two unit tests were added to permanently guard against regressions: `test_zero_volume_numerical_stability` (in `ml/tests/test_features.py`) and `test_linear_ridge_baseline_stability` (in `ml/tests/test_metrics.py`).

---

## 7. Honest Scientific Discussion

### Why does the LSTM fail to outperform simple baselines?
1. **Weak-Form Efficient Market Hypothesis (EMH)**: These empirical findings are **consistent with** the Weak-Form Efficient Market Hypothesis, in which highly liquid large-cap equities (NIFTY-50) incorporate publicly available historical price and volume information almost instantaneously. Daily continuous returns exhibit near-zero serial autocorrelation ($\rho_1 \approx 0$). However, this result alone does not prove market efficiency.
2. **Extremely Low Signal-to-Noise Ratio**: Daily financial returns are dominated by stochastic noise, market sentiment, and macroeconomic events that are absent from historical OHLCV series. Deep sequence models tend to memorize sample noise unless constrained by strong structural priors.
3. **Methodological Rigor**: By preventing lookahead leakage and fitting all scalers strictly on the training partition, no artificial predictive advantage was introduced.

### Practical Engineering Takeaways
- Naive baselines (like majority class or zero return) must always be reported in time series machine learning.
- An honest report documenting that a complex model fails to beat a simple baseline is vastly superior to inflated claims resulting from lookahead leakage.

---

## 8. Limitations

1. **Information Horizon**: The model only ingests daily OHLCV bars. Real market participants utilize intraday limit order book depth, news sentiment, corporate earnings, and cross-asset flow.
2. **Regime Non-Stationarity**: Macroeconomic interest rate cycles and volatility regimes shift significantly over a 10-year period.
3. **Toy Backtest**: The included backtest assumes frictionless executions (5 bps transaction fee) and instantaneous market-on-close fills without slippage, market impact, or exchange taxes (STT).

---

## 9. Reproduction Guide

### Environment Setup
```bash
# From project root
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r ml/requirements.txt
```

### Run Tests
```bash
python -m pytest ml/tests -v
```

### Retrain Model & Regenerate Metrics
```bash
python -m ml.train
```

### Launch Interactive Jupyter Notebook
```bash
jupyter notebook ml/notebooks/forecasting.ipynb
```
