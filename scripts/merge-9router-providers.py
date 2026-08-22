#!/usr/bin/env python3
"""Merge provider connections from a 9router backup JSON into the local Vela
SQLite DB — PROVIDERS ONLY.

This deliberately mirrors Vela's importDb() connection mapping (src/lib/db/
repos/sqlite/backupRepo.js): the fixed columns (id, provider, authType, name,
email, priority, isActive, createdAt, updatedAt) are written to their columns,
and EVERYTHING ELSE on the backup connection object (accessToken, apiKey,
refreshToken, modelLock_*, providerSpecificData, testStatus, errorCode, ...)
becomes the `data` JSON blob.

It touches ONLY providerConnections. No API keys, no settings, no combos, no
usage history, no kv — the caller's explicit scope.

Usage:
    python scripts/merge-9router-providers.py <backup.json>
"""

import json
import sqlite3
import sys
from pathlib import Path

FIXED_COLUMNS = (
    "id", "provider", "authType", "name", "email", "priority",
    "isActive", "createdAt", "updatedAt",
)


def main():
    if len(sys.argv) != 2:
        print("usage: merge-9router-providers.py <backup.json>", file=sys.stderr)
        sys.exit(2)

    backup_path = Path(sys.argv[1])
    if not backup_path.exists():
        print(f"backup not found: {backup_path}", file=sys.stderr)
        sys.exit(1)

    import os
    db_path = os.path.join(
        os.environ.get("APPDATA", ""), "9router", "db", "data.sqlite"
    )
    if not os.path.exists(db_path):
        print(f"local Vela DB not found at {db_path}", file=sys.stderr)
        sys.exit(1)

    with open(backup_path, encoding="utf-8") as f:
        data = json.load(f)
    conns = data.get("providerConnections", [])
    if not isinstance(conns, list) or not conns:
        print("no providerConnections array in backup", file=sys.stderr)
        sys.exit(1)

    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    cur = db.cursor()

    before = cur.execute("SELECT COUNT(*) FROM providerConnections").fetchone()[0]

    upserted = 0
    inserted = 0
    existing_ids = {
        r[0] for r in cur.execute("SELECT id FROM providerConnections").fetchall()
    }

    for c in conns:
        cid = c.get("id")
        if not cid:
            continue
        fixed = {k: c.get(k) for k in FIXED_COLUMNS}
        data_blob = {k: v for k, v in c.items() if k not in FIXED_COLUMNS}
        was_new = cid not in existing_ids

        cur.execute(
            """INSERT OR REPLACE INTO providerConnections
               (id, provider, authType, name, email, priority, isActive,
                data, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                cid,
                fixed["provider"],
                fixed.get("authType") or "oauth",
                fixed.get("name") or None,
                fixed.get("email") or None,
                fixed.get("priority") or None,
                0 if fixed.get("isActive") is False else 1,
                json.dumps(data_blob, ensure_ascii=False),
                fixed.get("createdAt") or __import__("datetime").datetime.now(
                    __import__("datetime").timezone.utc
                ).isoformat(),
                fixed.get("updatedAt") or __import__("datetime").datetime.now(
                    __import__("datetime").timezone.utc
                ).isoformat(),
            ),
        )
        upserted += 1
        if was_new:
            inserted += 1
            existing_ids.add(cid)

    db.commit()
    after = cur.execute("SELECT COUNT(*) FROM providerConnections").fetchone()[0]

    from collections import Counter
    added_providers = Counter(
        c.get("provider", "?") for c in conns if c.get("id")
    )
    db.close()

    print(f"DB: {db_path}")
    print(f"connections before: {before}")
    print(f"upserted from backup: {upserted}")
    print(f"  of which brand-new ids: {inserted}")
    print(f"connections after: {after}")
    print("providers added (by backup):")
    for p, n in added_providers.most_common():
        print(f"  {p}: {n}")
    print("DONE — only providerConnections was touched.")


if __name__ == "__main__":
    main()
