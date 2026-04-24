# checkout-prepare test matrix

PoS: https://apps.test.1stdigital.tech/prism/configs/payment-settings
Gateway: https://prism-gw.test.1stdigital.tech

**Assumptions (PoS config):**
- Supported assets: FDUSD, USDC, EURC
- Multiple chains enabled
- Amount: 15.00 (standard units)

## Matrix

| # | Currency | Cross-currency | FX buffer | Status | Accepts |
|---|----------|---------------|-----------|--------|---------|
| 1 | USD | OFF | 0 | 200 | peg only (FDUSD + USDC) |
| 2 | EUR | OFF | 0 | 200 | peg only (EURC) |
| 3 | HKD | OFF | 0 | 503 | none |
| 4 | USD | ON | 0 | 200 | all tokens (EURC + FDUSD + USDC) |
| 5 | EUR | ON | 0 | 200 | all tokens (EURC + FDUSD + USDC) |
| 6 | HKD | ON | 0 | 200 | all tokens (EURC + FDUSD + USDC) |
| 7 | USD | ON | 50 | 200 | all tokens, buffered |
| 8 | EUR | ON | 50 | 200 | all tokens, buffered |
| 9 | HKD | ON | 50 | 200 | all tokens, buffered |
| 10 | USD | OFF | 50 | 200 | peg only, buffered |
| 11 | EUR | OFF | 50 | 200 | peg only, buffered |
| 12 | HKD | OFF | 50 | 503 | none |

All 12 cases verified on 2026-04-24.
