import hmac
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import BadRequest

from bakery_pos.config import PROJECT_ROOT, Settings
from bakery_pos.data_service import DataService
from bakery_pos.database import Database
from bakery_pos.errors import ConfigurationError, NotFoundError, SyncError, ValidationError
from bakery_pos.providers.google_sheets import GoogleSheetsSyncProvider
from bakery_pos.providers.sqlite import SQLiteProvider


def create_app(
    settings: Settings | None = None,
    data_service: DataService | None = None,
    sheets_sync: Any | None = None,
) -> Flask:
    settings = settings or Settings.from_environment()
    if data_service is None:
        database = Database(settings.database_path)
        database.initialize()
        provider = SQLiteProvider(database)
        if bool(settings.spreadsheet_id) != bool(settings.google_credentials_path):
            raise ConfigurationError(
                "Set both GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_APPLICATION_CREDENTIALS "
                "to enable Google Sheets sync."
            )
        if sheets_sync is None and settings.spreadsheet_id and settings.google_credentials_path:
            sheets_sync = GoogleSheetsSyncProvider(
                settings.spreadsheet_id,
                str(settings.google_credentials_path),
            )
        data_service = DataService(provider, sheets_sync)

    app = Flask(__name__)
    app.config["DATA_SERVICE"] = data_service
    app.config["SETTINGS"] = settings

    @app.before_request
    def require_api_token() -> Any:
        if not request.path.startswith("/api/") or not settings.access_token:
            return None
        authorization = request.headers.get("Authorization", "")
        scheme, _, supplied_token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not hmac.compare_digest(
            supplied_token, settings.access_token
        ):
            return jsonify({"error": "A valid access token is required."}), 401
        return None

    @app.errorhandler(ValidationError)
    def handle_validation_error(error: ValidationError) -> tuple[Any, int]:
        return jsonify({"error": str(error)}), 400

    @app.errorhandler(NotFoundError)
    def handle_not_found(error: NotFoundError) -> tuple[Any, int]:
        return jsonify({"error": str(error)}), 404

    @app.errorhandler(ConfigurationError)
    def handle_configuration_error(error: ConfigurationError) -> tuple[Any, int]:
        return jsonify({"error": str(error)}), 503

    @app.errorhandler(SyncError)
    def handle_sync_error(error: SyncError) -> tuple[Any, int]:
        return jsonify({"error": str(error)}), 502

    @app.errorhandler(BadRequest)
    def handle_bad_request(error: BadRequest) -> tuple[Any, int]:
        return jsonify({"error": "Request body must be valid JSON."}), 400

    @app.get("/")
    def index() -> Any:
        return send_from_directory(PROJECT_ROOT, "index.html")

    @app.get("/assets/<path:asset_path>")
    def assets(asset_path: str) -> Any:
        return send_from_directory(Path(PROJECT_ROOT) / "assets", asset_path)

    @app.get("/api/health")
    def health() -> Any:
        return jsonify(
            {
                "status": "ok",
                "database": "sqlite",
                "currencies": ["USD", "KHR"],
                "google_sheets_configured": data_service.sheets_sync is not None,
            }
        )

    @app.get("/api/products")
    def list_products() -> Any:
        return jsonify(data_service.list_products())

    @app.post("/api/products")
    def create_product() -> Any:
        return jsonify(data_service.create_product(_json_body())), 201

    @app.get("/api/add-ons")
    def list_add_ons() -> Any:
        return jsonify(data_service.list_add_ons())

    @app.post("/api/add-ons")
    def create_add_on() -> Any:
        return jsonify(data_service.create_add_on(_json_body())), 201

    @app.get("/api/orders")
    def list_orders() -> Any:
        return jsonify(data_service.list_orders())

    @app.post("/api/orders")
    def create_order() -> Any:
        return jsonify(data_service.create_order(_json_body())), 201

    @app.get("/api/orders/<order_id>")
    def get_order(order_id: str) -> Any:
        return jsonify(data_service.get_order(order_id))

    @app.patch("/api/orders/<order_id>/status")
    def update_order_status(order_id: str) -> Any:
        payload = _json_body()
        return jsonify(data_service.update_order_status(order_id, payload.get("status")))

    @app.post("/api/orders/<order_id>/payments")
    def record_payment(order_id: str) -> Any:
        return jsonify(data_service.record_payment(order_id, _json_body())), 201

    @app.delete("/api/orders/<order_id>")
    def cancel_order(order_id: str) -> Any:
        return jsonify(data_service.delete_order(order_id))

    @app.get("/api/sync/status")
    def sync_status() -> Any:
        return jsonify(
            {
                **data_service.get_sync_status(),
                "google_sheets_configured": data_service.sheets_sync is not None,
            }
        )

    @app.post("/api/sync/sheets")
    def sync_sheets() -> Any:
        return jsonify(data_service.sync_to_sheets())

    return app


def _json_body() -> dict[str, Any]:
    payload = request.get_json()
    if not isinstance(payload, dict):
        raise ValidationError("Request body must be a JSON object.")
    return payload
