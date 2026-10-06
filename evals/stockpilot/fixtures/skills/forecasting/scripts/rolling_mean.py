#!/usr/bin/env python3
# Copyright 2026 Anthropic PBC
# SPDX-License-Identifier: Apache-2.0
# Adapted (path only) from Code with Claude 2026 "agent-decomposition" workshop,
# .claude/skills/forecasting/rolling_mean.py, commit 0b445c70eccfe3814f7cbdcec59d5a8102e391f8.
# See evals/stockpilot/PROVENANCE.md and ATTRIBUTION.md.
"""Path-A forecast: rolling 14-day mean for a single steady SKU.

Usage: python3 rolling_mean.py SKU-0057 14
Output: one JSON line {forecast_qty, confidence, method, flags}
"""
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "..", "..", "data", "sales_history.csv")

sku = sys.argv[1]
horizon = int(sys.argv[2]) if len(sys.argv) > 2 else 14

with open(DATA, newline="") as f:
    hist = [int(r["units_sold"]) for r in csv.DictReader(f) if r["sku"] == sku]
recent = hist[-14:] if len(hist) >= 14 else hist
mean = sum(recent) / max(len(recent), 1)

print(json.dumps({
    "sku": sku,
    "forecast_qty": round(mean * horizon),
    "confidence": 0.85 if len(recent) >= 14 else 0.6,
    "method": "rolling_mean_14d",
    "flags": [] if len(recent) >= 14 else ["short_history"],
}))
