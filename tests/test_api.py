import tempfile
import unittest
from pathlib import Path

from bakery_pos.app import create_app
from bakery_pos.config import Settings
from bakery_pos.data_service import DataService
from bakery_pos.database import Database
from bakery_pos.providers.sqlite import SQLiteProvider


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.settings = Settings(
            database_path=Path(self.temporary_directory.name) / "bakery.sqlite3",
            host="127.0.0.1",
            port=8000,
            access_token=None,
            spreadsheet_id=None,
            google_credentials_path=None,
        )
        database = Database(self.settings.database_path)
        database.initialize()
        self.service = DataService(SQLiteProvider(database))
        app = create_app(settings=self.settings, data_service=self.service)
        app.config.update(TESTING=True)
        self.client = app.test_client()

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_create_and_cancel_order_keeps_history(self):
        response = self.client.post(
            "/api/orders",
            json={
                "currency": "USD",
                "items": [
                    {
                        "item_type": "custom",
                        "name": "Sourdough loaf",
                        "quantity": 1,
                        "unit_price": "6.25",
                    }
                ],
            },
        )
        self.assertEqual(response.status_code, 201)
        order = response.get_json()

        cancelled = self.client.delete(f"/api/orders/{order['id']}")

        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.get_json()["status"], "cancelled")
        self.assertEqual(len(self.client.get("/api/orders").get_json()), 1)

    def test_invalid_payload_returns_json_error(self):
        response = self.client.post("/api/orders", json={"items": []})

        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.get_json())

    def test_network_api_requires_configured_token(self):
        settings = Settings(
            database_path=self.settings.database_path,
            host="0.0.0.0",
            port=8000,
            access_token="test-token",
            spreadsheet_id=None,
            google_credentials_path=None,
        )
        app = create_app(settings=settings, data_service=self.service)
        app.config.update(TESTING=True)
        client = app.test_client()

        self.assertEqual(client.get("/api/health").status_code, 401)
        self.assertEqual(
            client.get("/api/health", headers={"Authorization": "Bearer test-token"}).status_code,
            200,
        )


if __name__ == "__main__":
    unittest.main()
