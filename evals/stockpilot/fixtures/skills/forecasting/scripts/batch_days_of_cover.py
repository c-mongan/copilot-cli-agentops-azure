#!/usr/bin/env python3
# Copyright 2026 Anthropic PBC
# SPDX-License-Identifier: Apache-2.0
# Adapted (path only) from Code with Claude 2026 "agent-decomposition" workshop,
# .claude/skills/forecasting/batch_days_of_cover.py, commit 0b445c70eccfe3814f7cbdcec59d5a8102e391f8.
# See evals/stockpilot/PROVENANCE.md and ATTRIBUTION.md.
"""Days-of-cover for every SKU, ranked by urgency. The F1 sweep helper.

Reads stock_levels.csv + sales_history.csv + products.csv, computes
days_of_cover = on_hand / avg_daily_sales for each SKU, prints the
top-N most urgent as JSON. Replaces many individual stock-level /
sales-velocity lookups for a sweep task.

Usage: python3 batch_days_of_cover.py [top_n]
"""
import csv
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "..", "..", "data")
top_n = int(sys.argv[1]) if len(sys.argv) > 1 else 20

with open(os.path.join(DATA, "products.csv"), newline="") as f:
    products = {r["sku"]: r for r in csv.DictReader(f)}

latest = ""
with open(os.path.join(DATA, "stock_levels.csv"), newline="") as f:
    for r in csv.DictReader(f):
        if r["date"] > latest:
            latest = r["date"]

on_hand = defaultdict(int)
with open(os.path.join(DATA, "stock_levels.csv"), newline="") as f:
    for r in csv.DictReader(f):
        if r["date"] == latest:
            on_hand[r["sku"]] += int(r["on_hand"])

sales = defaultdict(list)
with open(os.path.join(DATA, "sales_history.csv"), newline="") as f:
    for r in csv.DictReader(f):
        sales[r["sku"]].append(int(r["units_sold"]))

rows = []
for sku, p in products.items():
    ads = sum(sales[sku][-14:]) / max(len(sales[sku][-14:]), 1)
    cover = on_hand[sku] / ads if ads > 0 else 999
    rows.append({
        "sku": sku,
        "name": p["name"],
        "on_hand": on_hand[sku],
        "reorder_point": int(p["reorder_point"]),
        "avg_daily_sales": round(ads, 2),
        "days_of_cover": round(cover, 1),
        "below_reorder": on_hand[sku] < int(p["reorder_point"]),
    })

rows.sort(key=lambda r: r["days_of_cover"])
print(json.dumps(rows[:top_n], indent=2))
