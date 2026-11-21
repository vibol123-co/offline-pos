class BakeryPOSError(Exception):
    """Base class for expected application errors."""


class ValidationError(BakeryPOSError):
    """Raised when an input does not satisfy a business rule."""


class NotFoundError(BakeryPOSError):
    """Raised when a requested record does not exist."""


class ConfigurationError(BakeryPOSError):
    """Raised when an optional integration is not configured."""


class SyncError(BakeryPOSError):
    """Raised when an external data synchronization fails."""
