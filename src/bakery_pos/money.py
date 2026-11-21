from decimal import Decimal, InvalidOperation

from bakery_pos.errors import ValidationError


CURRENCY_EXPONENTS = {"USD": 2, "KHR": 0}


def to_minor_units(value: object, currency: str) -> int:
    if currency not in CURRENCY_EXPONENTS:
        raise ValidationError(f"Unsupported currency: {currency}")
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValidationError("Amount must be a valid number.") from None
    if not amount.is_finite() or amount < 0:
        raise ValidationError("Amount must be a non-negative finite number.")

    exponent = CURRENCY_EXPONENTS[currency]
    factor = Decimal(10) ** exponent
    if amount * factor != (amount * factor).to_integral_value():
        raise ValidationError(f"{currency} amounts support at most {exponent} decimal places.")
    return int(amount * factor)


def from_minor_units(amount_minor: int, currency: str) -> str:
    if currency not in CURRENCY_EXPONENTS:
        raise ValidationError(f"Unsupported currency: {currency}")
    exponent = CURRENCY_EXPONENTS[currency]
    amount = Decimal(amount_minor) / (Decimal(10) ** exponent)
    return f"{amount:.{exponent}f}"
