import tempfile
import unittest
from pathlib import Path

from bakery_pos.data_service import DataService
from bakery_pos.database import Database
from bakery_pos.errors import SyncError, ValidationError
from bakery_pos.providers.sqlite import SQLiteProvider


class FailingSheetsSync:
    def sync(self, snapshot):
        raise SyncError("Sheets temporarily unavailable.")


class RecordingSheetsSync:
    def __init__(self):
        self.snapshot = None

    def sync(self, snapshot):
        self.snapshot = snapshot


class DataServiceTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        database = Database(Path(self.temporary_directory.name) / "bakery.sqlite3")
        database.initialize()
        self.provider = SQLiteProvider(database)
        self.service = DataService(self.provider)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_database_schema_initialization_is_idempotent(self):
        database = Database(Path(self.temporary_directory.name) / "bakery.sqlite3")

        database.initialize()
        database.initialize()

        self.assertEqual(database.version(), 2)

    def test_orders_survive_reopening_database(self):
        order = self.service.create_order(
            {
                "items": [
                    {
                        "item_type": "custom",
                        "name": "Baguette",
                        "quantity": 2,
                        "unit_price": "1.25",
                    }
                ]
            }
        )
        reopened_database = Database(self.provider.database.path)
        reopened_database.initialize()
        reopened_service = DataService(SQLiteProvider(reopened_database))

        self.assertEqual(reopened_service.get_order(order["id"])["total"], "2.50")

    def test_product_and_order_use_currency_specific_minor_units(self):
        product = self.service.create_product(
            {
                "name": "Birthday cake",
                "prices": {"USD": "12.50", "KHR": "50000"},
            }
        )

        order = self.service.create_order(
            {
                "currency": "USD",
                "items": [
                    {
                        "item_type": "product",
                        "product_id": product["id"],
                        "quantity": 2,
                    }
                ],
                "paid_amount": "5.00",
            }
        )

        self.assertEqual(product["prices"], {"USD": "12.50", "KHR": "50000"})
        self.assertEqual(order["subtotal"], "25.00")
        self.assertEqual(order["total"], "25.00")
        self.assertEqual(order["payments"][0]["amount"], "5.00")
        self.assertEqual(order["amount_paid"], "5.00")
        self.assertEqual(order["balance_due"], "20.00")
        self.assertEqual(order["items"][0]["unit_price"], "12.50")
        updated = self.service.record_payment(
            order["id"], {"amount": "20.00", "method": "cash"}
        )
        self.assertEqual(updated["amount_paid"], "25.00")
        self.assertEqual(updated["balance_due"], "0.00")
        with self.assertRaises(ValidationError):
            self.service.record_payment(
                order["id"], {"amount": "0.01", "method": "cash"}
            )

    def test_grab_defaults_to_delivery_and_completed_orders_are_retained(self):
        order = self.service.create_order(
            {
                "order_channel": "grab",
                "currency": "KHR",
                "items": [
                    {
                        "item_type": "custom",
                        "name": "Cookie box",
                        "quantity": 1,
                        "unit_price": "10000",
                    }
                ],
            }
        )

        self.assertEqual(order["fulfillment_method"], "delivery")
        self.service.update_order_status(order["id"], "preparing")
        self.service.update_order_status(order["id"], "ready")
        updated = self.service.update_order_status(order["id"], "completed")
        self.assertEqual(updated["status"], "completed")
        self.assertEqual(
            [entry["status"] for entry in updated["status_history"]],
            ["new", "preparing", "ready", "completed"],
        )
        self.assertEqual(len(self.service.list_orders()), 1)

        with self.assertRaises(ValidationError):
            self.service.update_order_status(order["id"], "preparing")

    def test_walk_in_cannot_be_recorded_as_delivery(self):
        with self.assertRaises(ValidationError):
            self.service.create_order(
                {
                    "order_channel": "walk_in",
                    "fulfillment_method": "delivery",
                    "items": [
                        {
                            "item_type": "custom",
                            "name": "Bread",
                            "quantity": 1,
                            "unit_price": "1.00",
                        }
                    ],
                }
            )

    def test_khr_rejects_fractional_riel_values(self):
        with self.assertRaises(ValidationError):
            self.service.create_order(
                {
                    "currency": "KHR",
                    "items": [
                        {
                            "item_type": "custom",
                            "name": "Bread",
                            "quantity": 1,
                            "unit_price": "1000.50",
                        }
                    ],
                }
            )

    def test_sheets_failure_keeps_local_changes_pending(self):
        product = self.service.create_product(
            {"name": "Croissant", "prices": {"USD": "2.00"}}
        )
        service = DataService(self.provider, FailingSheetsSync())

        with self.assertRaises(SyncError):
            service.sync_to_sheets()

        status = service.get_sync_status()
        self.assertGreater(status["pending_changes"], 0)
        self.assertEqual(status["last_status"], "failed")
        self.assertTrue(product["id"])

    def test_successful_sheet_sync_clears_pending_changes(self):
        self.service.create_add_on(
            {"name": "Gift box", "prices": {"USD": "1.50", "KHR": "6000"}}
        )
        sheets = RecordingSheetsSync()
        service = DataService(self.provider, sheets)

        status = service.sync_to_sheets()

        self.assertEqual(status["pending_changes"], 0)
        self.assertEqual(status["last_status"], "succeeded")
        self.assertIn("AddOns", sheets.snapshot)
        self.assertIn("AddOnPrices", sheets.snapshot)
        self.assertIn("OrderStatusHistory", sheets.snapshot)


if __name__ == "__main__":
    unittest.main()
