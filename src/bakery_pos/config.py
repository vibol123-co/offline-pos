from dataclasses import dataclass
import os
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    database_path: Path
    host: str
    port: int
    access_token: str | None
    spreadsheet_id: str | None
    google_credentials_path: Path | None

    @classmethod
    def from_environment(cls) -> "Settings":
        load_dotenv(PROJECT_ROOT / ".env")
        database_path = Path(
            os.environ.get("BAKERY_POS_DB_PATH")
            or PROJECT_ROOT / "data" / "bakery_pos.sqlite3"
        )
        credentials = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        return cls(
            database_path=database_path,
            host=os.environ.get("BAKERY_POS_HOST", "127.0.0.1"),
            port=int(os.environ.get("BAKERY_POS_PORT", "8000")),
            access_token=os.environ.get("BAKERY_POS_ACCESS_TOKEN") or None,
            spreadsheet_id=os.environ.get("GOOGLE_SHEETS_SPREADSHEET_ID") or None,
            google_credentials_path=Path(credentials) if credentials else None,
        )
