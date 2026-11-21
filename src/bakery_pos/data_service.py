from datetime import datetime, timezone
import json
import uuid
from typing import Any

from bakery_pos.errors import ConfigurationError, NotFoundError, SyncError, ValidationError
from bakery_pos.money import CURRENCY_EXPONENTS, from_minor_units, to_minor_units
from bakery_pos.providers.base import StorageProvider
from bakery_pos.providers.sqlite import utc_now


ORDER_TYPES = {"walk_in", "advance", "custom_cake"}
ORDER_CHANNELS = {"walk_in", "grab", "other"}
FULFILLMENT_METHODS = {"pickup", "delivery"}
ORDER_STATUSES = {"new", "preparing", "ready", "completed", "cancelled"}
PAYMENT_METHODS = {"cash", "card_terminal", "other"}
STATUS_TRANSITIONS = {
    "new": {"preparing", "ready", "cancelled"},
    "preparing": {"ready", "cancelled"},
    "ready": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


class DataService:
    def __init__(self, provider: StorageProvider, sheets_sync: Any | None = None):
        self.provider = provider
        self.sheets_sync = sheets_sync

    def list_products(self) -> list[dict[str, Any]]:
        return [self._format_catalog_record(row) for row in self.provider.list_products()]

    def create_product(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = self._required_text(payload, "name", max_length=120)
        category = self._optional_text(payload, "category", max_length=80)
        prices = self._parse_prices(payload.get("prices"))

        now = utc_now()
        product = {
            "id": str(uuid.uuid4()),
            "name": name,
            "category": category,
            "active": 1,
            "created_at": now,
            "updated_at": now,
        }
        product_id = self.provider.create_product(product, prices)
        return self._format_catalog_record(self.provider.get_product(product_id))

    def list_add_ons(self) -> list[dict[str, Any]]:
        return [self._format_catalog_record(row) for row in self.provider.list_add_ons()]

    def create_add_on(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = self._required_text(payload, "name", max_length=120)
        prices = self._parse_prices(payload.get("prices"))
        now = utc_now()
        add_on = {
            "id": str(uuid.uuid4()),
            "name": name,
            "active": 1,
            "created_at": now,
            "updated_at": now,
        }
        add_on_id = self.provider.create_add_on(add_on, prices)
        return self._format_catalog_record(self.provider.get_add_on(add_on_id))

    def list_orders(self) -> list[dict[str, Any]]:
        return [self._format_order(order) for order in self.provider.list_orders()]

    def get_order(self, order_id: str) -> dict[str, Any]:
        order = self.provider.get_order(order_id)
        if order is None:
            raise NotFoundError("Order not found.")
        return self._format_order(order)

    def create_order(self, payload: dict[str, Any]) -> dict[str, Any]:
        currency = self._currency(payload.get("currency", "USD"))
        raw_items = payload.get("items")
        if not isinstance(raw_items, list) or not raw_items:
            raise ValidationError("An order must contain at least one item.")
        items = [self._prepare_order_item(item, currency) for item in raw_items]
        subtotal = sum(item["line_total_minor"] for item in items)
        discount = to_minor_units(payload.get("discount", "0"), currency)
        tax = to_minor_units(payload.get("tax", "0"), currency)
        if discount > subtotal:
            raise ValidationError("Discount cannot exceed the item subtotal.")

        channel = self._choice(
            payload.get("order_channel", "walk_in"), ORDER_CHANNELS, "order_channel"
        )
        fulfillment = payload.get(
            "fulfillment_method", "delivery" if channel == "grab" else "pickup"
        )
        fulfillment = self._choice(fulfillment, FULFILLMENT_METHODS, "fulfillment_method")
        expected_fulfillment = {"walk_in": "pickup", "grab": "delivery"}.get(channel)
        if expected_fulfillment and fulfillment != expected_fulfillment:
            raise ValidationError(
                f"{channel} orders must use {expected_fulfillment} fulfillment."
            )
        order_type = self._choice(
            payload.get("order_type", "walk_in"), ORDER_TYPES, "order_type"
        )

        total = subtotal - discount + tax
        paid = to_minor_units(payload.get("paid_amount", "0"), currency)
        if paid > total:
            raise ValidationError("paid_amount cannot exceed the order total.")
        now = utc_now()
        order_id = str(uuid.uuid4())
        order = {
            "id": order_id,
            "order_number": f"BP-{datetime.now(timezone.utc):%Y%m%d}-{uuid.uuid4().hex[:6].upper()}",
            "customer_name": self._optional_text(payload, "customer_name", max_length=120),
            "customer_phone": self._optional_text(payload, "customer_phone", max_length=40),
            "order_type": order_type,
            "order_channel": channel,
            "fulfillment_method": fulfillment,
            "pickup_at": self._pickup_time(payload.get("pickup_at")),
            "status": "new",
            "currency": currency,
            "subtotal_minor": subtotal,
            "discount_minor": discount,
            "tax_minor": tax,
            "total_minor": total,
            "notes": self._optional_text(payload, "notes", max_length=2000),
            "custom_details_json": self._custom_details(payload.get("custom_details", {})),
            "created_at": now,
            "updated_at": now,
        }
        payment = None
        if paid:
            method = self._choice(
                payload.get("payment_method", "cash"), PAYMENT_METHODS, "payment_method"
            )
            payment = {
                "id": str(uuid.uuid4()),
                "amount_minor": paid,
                "currency": currency,
                "method": method,
                "status": "completed",
                "paid_at": now,
                "created_at": now,
            }
        self.provider.create_order(order, items, payment)
        return self.get_order(order_id)

    def update_order_status(self, order_id: str, status: str) -> dict[str, Any]:
        status = self._choice(status, ORDER_STATUSES, "status")
        current = self.provider.get_order(order_id)
        if current is None:
            raise NotFoundError("Order not found.")
        if status == current["status"]:
            return self._format_order(current)
        if status not in STATUS_TRANSITIONS[current["status"]]:
            raise ValidationError(
                f"An order cannot move from {current['status']} to {status}."
            )
        if not self.provider.update_order_status(order_id, status):
            raise NotFoundError("Order not found.")
        return self.get_order(order_id)

    def delete_order(self, order_id: str) -> dict[str, Any]:
        return self.update_order_status(order_id, "cancelled")

    def record_payment(self, order_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        order = self.provider.get_order(order_id)
        if order is None:
            raise NotFoundError("Order not found.")
        if order["status"] == "cancelled":
            raise ValidationError("A cancelled order cannot receive a payment.")
        currency = self._currency(payload.get("currency", order["currency"]))
        if currency != order["currency"]:
            raise ValidationError("Payment currency must match the order currency.")
        amount = to_minor_units(payload.get("amount"), currency)
        if amount == 0:
            raise ValidationError("Payment amount must be greater than zero.")
        if amount > order["balance_due_minor"]:
            raise ValidationError("Payment cannot exceed the remaining order balance.")
        method = self._choice(
            payload.get("method", "cash"), PAYMENT_METHODS, "method"
        )
        now = utc_now()
        self.provider.create_payment(
            {
                "id": str(uuid.uuid4()),
                "order_id": order_id,
                "amount_minor": amount,
                "currency": currency,
                "method": method,
                "status": "completed",
                "paid_at": now,
                "created_at": now,
            }
        )
        return self.get_order(order_id)

    def get_sync_status(self) -> dict[str, Any]:
        return self.provider.get_sync_status()

    def sync_to_sheets(self) -> dict[str, Any]:
        if self.sheets_sync is None:
            raise ConfigurationError("Google Sheets sync is not configured.")
        run_id = str(uuid.uuid4())
        started_at = utc_now()
        self.provider.record_sync_started(run_id, started_at)
        try:
            self.sheets_sync.sync(self.provider.get_sync_snapshot())
        except (ConfigurationError, SyncError) as error:
            completed_at = utc_now()
            self.provider.mark_sync_failed(run_id, completed_at, str(error))
            raise
        completed_at = utc_now()
        self.provider.mark_sync_succeeded(started_at, completed_at)
        return self.provider.get_sync_status()

    def _prepare_order_item(self, item: Any, currency: str) -> dict[str, Any]:
        if not isinstance(item, dict):
            raise ValidationError("Each order item must be an object.")
        quantity = item.get("quantity")
        if not isinstance(quantity, int) or isinstance(quantity, bool) or quantity < 1:
            raise ValidationError("Each item quantity must be a positive whole number.")
        if quantity > 10000:
            raise ValidationError("Item quantity cannot exceed 10000.")

        item_type = item.get("item_type", "custom")
        product_id = None
        add_on_id = None
        variant = self._optional_text(item, "variant", max_length=80)
        if item_type == "product":
            product_id = self._required_text(item, "product_id", max_length=80)
            product = self.provider.get_product(product_id)
            if product is None or not product["active"]:
                raise ValidationError("The selected product is missing or inactive.")
            price = product["prices"].get(currency)
            if price is None:
                raise ValidationError(f"The selected product has no {currency} price.")
            name = product["name"]
        elif item_type == "add_on":
            add_on_id = self._required_text(item, "add_on_id", max_length=80)
            add_on = self.provider.get_add_on(add_on_id)
            if add_on is None or not add_on["active"]:
                raise ValidationError("The selected add-on is missing or inactive.")
            price = add_on["prices"].get(currency)
            if price is None:
                raise ValidationError(f"The selected add-on has no {currency} price.")
            name = add_on["name"]
        elif item_type == "custom":
            name = self._required_text(item, "name", max_length=160)
            price = to_minor_units(item.get("unit_price"), currency)
        else:
            raise ValidationError("item_type must be product, add_on, or custom.")

        return {
            "id": str(uuid.uuid4()),
            "item_type": item_type,
            "product_id": product_id,
            "add_on_id": add_on_id,
            "name_snapshot": name,
            "variant": variant,
            "quantity": quantity,
            "unit_price_minor": price,
            "line_total_minor": price * quantity,
        }

    @staticmethod
    def _format_catalog_record(record: dict[str, Any] | None) -> dict[str, Any]:
        if record is None:
            raise NotFoundError("Catalog record not found after saving.")
        result = {key: value for key, value in record.items() if key != "prices"}
        result["prices"] = {
            currency: from_minor_units(amount, currency)
            for currency, amount in record["prices"].items()
        }
        return result

    @staticmethod
    def _format_order(order: dict[str, Any]) -> dict[str, Any]:
        currency = order["currency"]
        result = dict(order)
        for field in ("subtotal", "discount", "tax", "total"):
            result[field] = from_minor_units(result.pop(f"{field}_minor"), currency)
        result["amount_paid"] = from_minor_units(result.pop("amount_paid_minor"), currency)
        result["balance_due"] = from_minor_units(result.pop("balance_due_minor"), currency)
        result["custom_details"] = json.loads(result.pop("custom_details_json"))
        for item in result["items"]:
            item["unit_price"] = from_minor_units(item.pop("unit_price_minor"), currency)
            item["line_total"] = from_minor_units(item.pop("line_total_minor"), currency)
        for payment in result["payments"]:
            payment["amount"] = from_minor_units(payment.pop("amount_minor"), payment["currency"])
        return result

    @staticmethod
    def _parse_prices(value: Any) -> dict[str, int]:
        if not isinstance(value, dict) or not value:
            raise ValidationError("prices must include at least one USD or KHR price.")
        prices = {}
        for currency, amount in value.items():
            normalized = DataService._currency(currency)
            prices[normalized] = to_minor_units(amount, normalized)
        return prices

    @staticmethod
    def _currency(value: Any) -> str:
        if not isinstance(value, str) or value not in CURRENCY_EXPONENTS:
            raise ValidationError("currency must be USD or KHR.")
        return value

    @staticmethod
    def _choice(value: Any, choices: set[str], field: str) -> str:
        if not isinstance(value, str) or value not in choices:
            allowed = ", ".join(sorted(choices))
            raise ValidationError(f"{field} must be one of: {allowed}.")
        return value

    @staticmethod
    def _required_text(payload: dict[str, Any], key: str, max_length: int) -> str:
        value = payload.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValidationError(f"{key} is required.")
        value = value.strip()
        if len(value) > max_length:
            raise ValidationError(f"{key} cannot exceed {max_length} characters.")
        return value

    @staticmethod
    def _optional_text(payload: dict[str, Any], key: str, max_length: int) -> str:
        value = payload.get(key, "")
        if value is None:
            return ""
        if not isinstance(value, str):
            raise ValidationError(f"{key} must be text.")
        value = value.strip()
        if len(value) > max_length:
            raise ValidationError(f"{key} cannot exceed {max_length} characters.")
        return value

    @staticmethod
    def _custom_details(value: Any) -> str:
        if not isinstance(value, dict):
            raise ValidationError("custom_details must be a JSON object.")
        try:
            result = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        except (TypeError, ValueError):
            raise ValidationError("custom_details must contain valid JSON values.") from None
        if len(result) > 4000:
            raise ValidationError("custom_details cannot exceed 4000 characters.")
        return result

    @staticmethod
    def _pickup_time(value: Any) -> str:
        raw = DataService._optional_text({"pickup_at": value}, "pickup_at", max_length=40)
        if not raw:
            return ""
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            raise ValidationError("pickup_at must be an ISO 8601 date-time.") from None
        if parsed.utcoffset() is None:
            raise ValidationError("pickup_at must include a timezone.")
        return parsed.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
