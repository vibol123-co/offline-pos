from typing import Any

from bakery_pos.errors import ConfigurationError, SyncError


SHEET_COLUMNS = {
    "Products": (
        "id", "name", "category", "active", "created_at", "updated_at",
    ),
    "ProductPrices": ("product_id", "currency", "amount_minor"),
    "AddOns": ("id", "name", "active", "created_at", "updated_at"),
    "AddOnPrices": ("add_on_id", "currency", "amount_minor"),
    "Orders": (
        "id", "order_number", "customer_name", "customer_phone", "order_type",
        "order_channel", "fulfillment_method", "pickup_at", "status", "currency",
        "subtotal_minor", "discount_minor", "tax_minor", "total_minor", "notes",
        "custom_details_json", "created_at", "updated_at",
    ),
    "OrderItems": (
        "id", "order_id", "item_type", "product_id", "add_on_id", "name_snapshot",
        "variant", "quantity", "unit_price_minor", "line_total_minor",
    ),
    "OrderStatusHistory": ("id", "order_id", "status", "changed_at"),
    "Payments": (
        "id", "order_id", "amount_minor", "currency", "method", "status",
        "paid_at", "created_at",
    ),
    "Settings": ("key", "value", "updated_at"),
}


class GoogleSheetsSyncProvider:
    """One-way, idempotent snapshot sync from the local database to a dedicated spreadsheet."""

    def __init__(self, spreadsheet_id: str, credentials_path: str):
        if not spreadsheet_id or not credentials_path:
            raise ConfigurationError("Google Sheets requires a spreadsheet ID and credentials file.")
        self.spreadsheet_id = spreadsheet_id
        self.credentials_path = credentials_path

    def sync(self, snapshot: dict[str, list[dict[str, Any]]]) -> None:
        try:
            from httplib2.error import HttpLib2Error
            from google.auth.exceptions import GoogleAuthError
            from google.oauth2.service_account import Credentials
            from googleapiclient.discovery import build
            from googleapiclient.errors import HttpError
        except ImportError as error:
            raise ConfigurationError(
                'Install the optional Google Sheets dependencies with: pip install -e ".[sheets]"'
            ) from error

        try:
            credentials = Credentials.from_service_account_file(
                self.credentials_path,
                scopes=["https://www.googleapis.com/auth/spreadsheets"],
            )
            service = build("sheets", "v4", credentials=credentials, cache_discovery=False)
            self._ensure_tabs(service)
            for title, columns in SHEET_COLUMNS.items():
                values = [list(columns)]
                values.extend(
                    [self._cell_value(row.get(column)) for column in columns]
                    for row in snapshot.get(title, [])
                )
                self._replace_tab(service, title, values)
        except (OSError, ValueError, GoogleAuthError, HttpError, HttpLib2Error) as error:
            raise SyncError(f"Google Sheets sync failed: {error}") from error

    def _ensure_tabs(self, service: Any) -> None:
        spreadsheet = service.spreadsheets().get(
            spreadsheetId=self.spreadsheet_id,
            fields="sheets.properties.title",
        ).execute()
        existing = {
            sheet["properties"]["title"]
            for sheet in spreadsheet.get("sheets", [])
        }
        missing = [title for title in SHEET_COLUMNS if title not in existing]
        if missing:
            service.spreadsheets().batchUpdate(
                spreadsheetId=self.spreadsheet_id,
                body={
                    "requests": [
                        {"addSheet": {"properties": {"title": title}}}
                        for title in missing
                    ]
                },
            ).execute()

    def _replace_tab(self, service: Any, title: str, values: list[list[Any]]) -> None:
        quoted_title = f"'{title}'"
        service.spreadsheets().values().clear(
            spreadsheetId=self.spreadsheet_id,
            range=f"{quoted_title}!A:Z",
            body={},
        ).execute()
        service.spreadsheets().values().update(
            spreadsheetId=self.spreadsheet_id,
            range=f"{quoted_title}!A1",
            valueInputOption="RAW",
            body={"values": values},
        ).execute()

    @staticmethod
    def _cell_value(value: Any) -> Any:
        if value is None:
            return ""
        if isinstance(value, (str, int, float, bool)):
            return value
        return str(value)
