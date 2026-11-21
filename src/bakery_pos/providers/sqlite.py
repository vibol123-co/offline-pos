from datetime import datetime, timezone
import uuid
from typing import Any

from bakery_pos.database import Database


SYNC_TABLES = {
    "Products": "products",
    "ProductPrices": "product_prices",
    "AddOns": "add_ons",
    "AddOnPrices": "add_on_prices",
    "Orders": "orders",
    "OrderItems": "order_items",
    "OrderStatusHistory": "order_status_history",
    "Payments": "payments",
    "Settings": "settings",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


class SQLiteProvider:
    def __init__(self, database: Database):
        self.database = database

    @staticmethod
    def _row_dict(row: Any) -> dict[str, Any]:
        return dict(row)

    @staticmethod
    def _prices(connection: Any, table: str, id_column: str, record_id: str) -> dict[str, int]:
        rows = connection.execute(
            f"SELECT currency, amount_minor FROM {table} WHERE {id_column} = ?",
            (record_id,),
        )
        return {row["currency"]: row["amount_minor"] for row in rows}

    def list_products(self) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            products = connection.execute(
                "SELECT * FROM products ORDER BY name COLLATE NOCASE"
            ).fetchall()
            return [
                {**self._row_dict(row), "prices": self._prices(
                    connection, "product_prices", "product_id", row["id"]
                )}
                for row in products
            ]

    def get_product(self, product_id: str) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
            if row is None:
                return None
            return {
                **self._row_dict(row),
                "prices": self._prices(connection, "product_prices", "product_id", product_id),
            }

    def create_product(self, product: dict[str, Any], prices: dict[str, int]) -> str:
        with self.database.connect() as connection:
            with connection:
                connection.execute(
                    """
                    INSERT INTO products(
                        id, name, category, active, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        product["id"],
                        product["name"],
                        product["category"],
                        product["active"],
                        product["created_at"],
                        product["updated_at"],
                    ),
                )
                connection.executemany(
                    "INSERT INTO product_prices(product_id, currency, amount_minor) "
                    "VALUES (?, ?, ?)",
                    [(product["id"], currency, amount) for currency, amount in prices.items()],
                )
                self._enqueue(connection, "product", product["id"], "upsert", product["created_at"])
        return product["id"]

    def list_add_ons(self) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            add_ons = connection.execute(
                "SELECT * FROM add_ons ORDER BY name COLLATE NOCASE"
            ).fetchall()
            return [
                {**self._row_dict(row), "prices": self._prices(
                    connection, "add_on_prices", "add_on_id", row["id"]
                )}
                for row in add_ons
            ]

    def get_add_on(self, add_on_id: str) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute("SELECT * FROM add_ons WHERE id = ?", (add_on_id,)).fetchone()
            if row is None:
                return None
            return {
                **self._row_dict(row),
                "prices": self._prices(connection, "add_on_prices", "add_on_id", add_on_id),
            }

    def create_add_on(self, add_on: dict[str, Any], prices: dict[str, int]) -> str:
        with self.database.connect() as connection:
            with connection:
                connection.execute(
                    "INSERT INTO add_ons(id, name, active, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (
                        add_on["id"],
                        add_on["name"],
                        add_on["active"],
                        add_on["created_at"],
                        add_on["updated_at"],
                    ),
                )
                connection.executemany(
                    "INSERT INTO add_on_prices(add_on_id, currency, amount_minor) "
                    "VALUES (?, ?, ?)",
                    [(add_on["id"], currency, amount) for currency, amount in prices.items()],
                )
                self._enqueue(connection, "add_on", add_on["id"], "upsert", add_on["created_at"])
        return add_on["id"]

    def create_order(
        self,
        order: dict[str, Any],
        items: list[dict[str, Any]],
        payment: dict[str, Any] | None,
    ) -> str:
        with self.database.connect() as connection:
            with connection:
                connection.execute(
                    """
                    INSERT INTO orders(
                        id, order_number, customer_name, customer_phone, order_type,
                        order_channel, fulfillment_method, pickup_at, status, currency,
                        subtotal_minor, discount_minor, tax_minor, total_minor, notes,
                        custom_details_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        order["id"],
                        order["order_number"],
                        order["customer_name"],
                        order["customer_phone"],
                        order["order_type"],
                        order["order_channel"],
                        order["fulfillment_method"],
                        order["pickup_at"],
                        order["status"],
                        order["currency"],
                        order["subtotal_minor"],
                        order["discount_minor"],
                        order["tax_minor"],
                        order["total_minor"],
                        order["notes"],
                        order["custom_details_json"],
                        order["created_at"],
                        order["updated_at"],
                    ),
                )
                connection.execute(
                    "INSERT INTO order_status_history(id, order_id, status, changed_at) "
                    "VALUES (?, ?, ?, ?)",
                    (
                        str(uuid.uuid4()),
                        order["id"],
                        order["status"],
                        order["created_at"],
                    ),
                )
                connection.executemany(
                    """
                    INSERT INTO order_items(
                        id, order_id, item_type, product_id, add_on_id, name_snapshot,
                        variant, quantity, unit_price_minor, line_total_minor
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            item["id"],
                            order["id"],
                            item["item_type"],
                            item["product_id"],
                            item["add_on_id"],
                            item["name_snapshot"],
                            item["variant"],
                            item["quantity"],
                            item["unit_price_minor"],
                            item["line_total_minor"],
                        )
                        for item in items
                    ],
                )
                if payment is not None:
                    connection.execute(
                        """
                        INSERT INTO payments(
                            id, order_id, amount_minor, currency, method, status,
                            paid_at, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            payment["id"],
                            order["id"],
                            payment["amount_minor"],
                            payment["currency"],
                            payment["method"],
                            payment["status"],
                            payment["paid_at"],
                            payment["created_at"],
                        ),
                    )
                    self._enqueue(
                        connection, "payment", payment["id"], "upsert", payment["created_at"]
                    )
                self._enqueue(connection, "order", order["id"], "upsert", order["created_at"])
        return order["id"]

    def create_payment(self, payment: dict[str, Any]) -> None:
        with self.database.connect() as connection:
            with connection:
                connection.execute(
                    """
                    INSERT INTO payments(
                        id, order_id, amount_minor, currency, method, status,
                        paid_at, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        payment["id"],
                        payment["order_id"],
                        payment["amount_minor"],
                        payment["currency"],
                        payment["method"],
                        payment["status"],
                        payment["paid_at"],
                        payment["created_at"],
                    ),
                )
                self._enqueue(
                    connection, "payment", payment["id"], "upsert", payment["created_at"]
                )

    def list_orders(self) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM orders ORDER BY created_at DESC LIMIT 500"
            ).fetchall()
            return [self._load_order(connection, row) for row in rows]

    def get_order(self, order_id: str) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
            return None if row is None else self._load_order(connection, row)

    def update_order_status(self, order_id: str, status: str) -> bool:
        now = utc_now()
        with self.database.connect() as connection:
            with connection:
                current = connection.execute(
                    "SELECT status FROM orders WHERE id = ?", (order_id,)
                ).fetchone()
                if current is None:
                    return False
                if current["status"] == status:
                    return True
                result = connection.execute(
                    "UPDATE orders SET status = ?, updated_at = ? WHERE id = ?",
                    (status, now, order_id),
                )
                if result.rowcount:
                    connection.execute(
                        "INSERT INTO order_status_history(id, order_id, status, changed_at) "
                        "VALUES (?, ?, ?, ?)",
                        (str(uuid.uuid4()), order_id, status, now),
                    )
                    self._enqueue(connection, "order", order_id, "upsert", now)
                return result.rowcount > 0

    def get_sync_snapshot(self) -> dict[str, list[dict[str, Any]]]:
        with self.database.connect() as connection:
            return {
                sheet_name: [
                    self._row_dict(row)
                    for row in connection.execute(f"SELECT * FROM {table} ORDER BY rowid")
                ]
                for sheet_name, table in SYNC_TABLES.items()
            }

    def get_sync_status(self) -> dict[str, Any]:
        with self.database.connect() as connection:
            pending = connection.execute(
                "SELECT COUNT(*) AS count FROM sync_outbox WHERE synced_at IS NULL"
            ).fetchone()["count"]
            latest = connection.execute(
                "SELECT status, completed_at, error_message FROM sync_runs "
                "ORDER BY started_at DESC LIMIT 1"
            ).fetchone()
            return {
                "pending_changes": pending,
                "last_status": None if latest is None else latest["status"],
                "last_completed_at": None if latest is None else latest["completed_at"],
                "last_error": "" if latest is None else latest["error_message"],
            }

    def record_sync_started(self, run_id: str, started_at: str) -> None:
        with self.database.connect() as connection:
            with connection:
                connection.execute(
                    "INSERT INTO sync_runs(id, status, started_at) VALUES (?, 'running', ?)",
                    (run_id, started_at),
                )

    def mark_sync_succeeded(self, started_at: str, completed_at: str) -> None:
        with self.database.connect() as connection:
            with connection:
                connection.execute(
                    "UPDATE sync_outbox SET synced_at = ? "
                    "WHERE synced_at IS NULL AND created_at <= ?",
                    (completed_at, started_at),
                )
                connection.execute(
                    "UPDATE sync_runs SET status = 'succeeded', completed_at = ?, "
                    "error_message = '' WHERE status = 'running' AND started_at = ?",
                    (completed_at, started_at),
                )

    def mark_sync_failed(self, run_id: str, completed_at: str, error_message: str) -> None:
        with self.database.connect() as connection:
            with connection:
                connection.execute(
                    "UPDATE sync_runs SET status = 'failed', completed_at = ?, "
                    "error_message = ? WHERE id = ?",
                    (completed_at, error_message[:1000], run_id),
                )

    @staticmethod
    def _enqueue(
        connection: Any, entity_type: str, entity_id: str, operation: str, created_at: str
    ) -> None:
        connection.execute(
            "INSERT INTO sync_outbox(id, entity_type, entity_id, operation, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), entity_type, entity_id, operation, created_at),
        )

    @staticmethod
    def _load_order(connection: Any, row: Any) -> dict[str, Any]:
        order = dict(row)
        order["amount_paid_minor"] = connection.execute(
            "SELECT COALESCE(SUM(amount_minor), 0) AS amount "
            "FROM payments WHERE order_id = ? AND status = 'completed'",
            (order["id"],),
        ).fetchone()["amount"]
        order["balance_due_minor"] = max(
            order["total_minor"] - order["amount_paid_minor"], 0
        )
        order["items"] = [
            dict(item)
            for item in connection.execute(
                "SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid", (order["id"],)
            )
        ]
        order["payments"] = [
            dict(payment)
            for payment in connection.execute(
                "SELECT * FROM payments WHERE order_id = ? ORDER BY paid_at", (order["id"],)
            )
        ]
        order["status_history"] = [
            dict(status)
            for status in connection.execute(
                "SELECT status, changed_at FROM order_status_history "
                "WHERE order_id = ? ORDER BY changed_at, rowid",
                (order["id"],),
            )
        ]
        return order
