import argparse
import ipaddress
import os

from waitress import serve

from bakery_pos.app import create_app
from bakery_pos.config import Settings


def main() -> None:
    settings = Settings.from_environment()
    parser = argparse.ArgumentParser(description="Run the local Bakery POS server.")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    arguments = parser.parse_args()

    is_loopback_address = False
    try:
        is_loopback_address = ipaddress.ip_address(arguments.host).is_loopback
    except ValueError:
        pass
    is_loopback = arguments.host.lower() == "localhost" or is_loopback_address
    access_token = os.environ.get("BAKERY_POS_ACCESS_TOKEN")
    if not is_loopback and not access_token:
        parser.error("Set BAKERY_POS_ACCESS_TOKEN before exposing the app on the local network.")
    if not 1 <= arguments.port <= 65535:
        parser.error("Port must be between 1 and 65535.")

    settings = Settings(
        database_path=settings.database_path,
        host=arguments.host,
        port=arguments.port,
        access_token=access_token or settings.access_token,
        spreadsheet_id=settings.spreadsheet_id,
        google_credentials_path=settings.google_credentials_path,
    )
    app = create_app(settings)
    print(f"Bakery POS listening on http://{arguments.host}:{arguments.port}")
    serve(app, host=arguments.host, port=arguments.port)
