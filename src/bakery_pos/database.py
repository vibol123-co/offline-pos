from contextlib import contextmanager
from pathlib import Path
import sqlite3
from typing import Iterator


SCHEMA_VERSION = 2

MIGRATION_1 = """
CREATE TABLE products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE product_prices (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    currency TEXT NOT NULL CHECK (currency IN ('USD', 'KHR')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    PRIMARY KEY (product_id, currency)
);

CREATE TABLE add_ons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE add_on_prices (
    add_on_id TEXT NOT NULL REFERENCES add_ons(id) ON DELETE CASCADE,
    currency TEXT NOT NULL CHECK (currency IN ('USD', 'KHR')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    PRIMARY KEY (add_on_id, currency)
);

CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    order_type TEXT NOT NULL CHECK (order_type IN ('walk_in', 'advance', 'custom_cake')),
    order_channel TEXT NOT NULL CHECK (order_channel IN ('walk_in', 'grab', 'other')),
    fulfillment_method TEXT NOT NULL CHECK (fulfillment_method IN ('pickup', 'delivery')),
    pickup_at TEXT,
    status TEXT NOT NULL CHECK (
        status IN ('new', 'preparing', 'ready', 'completed', 'cancelled')
    ),
    currency TEXT NOT NULL CHECK (currency IN ('USD', 'KHR')),
    subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
    discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
    tax_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
    notes TEXT NOT NULL DEFAULT '',
    custom_details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX orders_created_at_idx ON orders(created_at);
CREATE INDEX orders_status_pickup_idx ON orders(status, pickup_at);

CREATE TABLE order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('product', 'add_on', 'custom')),
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    add_on_id TEXT REFERENCES add_ons(id) ON DELETE SET NULL,
    name_snapshot TEXT NOT NULL,
    variant TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
    line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0)
);

CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL CHECK (currency IN ('USD', 'KHR')),
    method TEXT NOT NULL CHECK (method IN ('cash', 'card_terminal', 'other')),
    status TEXT NOT NULL CHECK (status IN ('completed', 'refunded', 'void')),
    paid_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE sync_outbox (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
    created_at TEXT NOT NULL,
    synced_at TEXT
);

CREATE INDEX sync_outbox_pending_idx ON sync_outbox(synced_at, created_at);

CREATE TABLE sync_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error_message TEXT NOT NULL DEFAULT ''
);
"""

MIGRATION_2 = """
CREATE TABLE order_status_history (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (
        status IN ('new', 'preparing', 'ready', 'completed', 'cancelled')
    ),
    changed_at TEXT NOT NULL
);

CREATE INDEX order_status_history_order_idx
    ON order_status_history(order_id, changed_at);

INSERT INTO order_status_history(id, order_id, status, changed_at)
SELECT lower(hex(randomblob(16))), id, status, updated_at
FROM orders;
"""

MIGRATIONS = {1: MIGRATION_1, 2: MIGRATION_2}


class Database:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        try:
            yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                )
                """
            )
            applied = {
                row["version"]
                for row in connection.execute("SELECT version FROM schema_migrations")
            }
            latest = max(applied, default=0)
            if latest > SCHEMA_VERSION:
                raise RuntimeError(
                    f"Database schema version {latest} is newer than supported version "
                    f"{SCHEMA_VERSION}."
                )
            for version in range(latest + 1, SCHEMA_VERSION + 1):
                migration = MIGRATIONS.get(version)
                if migration is None:
                    raise RuntimeError(f"No database migration is defined for version {version}.")
                settings_seed = ""
                if version == 1:
                    settings_seed = """
                    INSERT OR IGNORE INTO settings(key, value, updated_at)
                    VALUES
                        ('supported_currencies', '["USD","KHR"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                        ('default_currency', 'USD', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
                    """
                connection.executescript(
                    f"""
                    BEGIN IMMEDIATE;
                    {migration}
                    INSERT INTO schema_migrations(version, applied_at)
                    VALUES ({version}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
                    {settings_seed}
                    COMMIT;
                    """
                )
            connection.commit()

    def version(self) -> int:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations"
            ).fetchone()
            return int(row["version"])
