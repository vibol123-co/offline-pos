import argparse
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "apps_script"
OUTPUT = ROOT / "site"


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the static Bakery POS GitHub Pages site.")
    parser.add_argument("--require-config", action="store_true")
    args = parser.parse_args()

    client_id = os.environ.get("POS_GOOGLE_OAUTH_CLIENT_ID", "").strip()
    deployment_id = os.environ.get("POS_API_EXECUTION_DEPLOYMENT_ID", "").strip()
    if args.require_config and (not client_id or not deployment_id):
        parser.error(
            "Set POS_GOOGLE_OAUTH_CLIENT_ID and POS_API_EXECUTION_DEPLOYMENT_ID before building."
        )

    page = (SOURCE / "index.html").read_text(encoding="utf-8")
    styles = (SOURCE / "Styles.html").read_text(encoding="utf-8")
    client = (SOURCE / "Client.html").read_text(encoding="utf-8")
    page = page.replace('<?!= include("Styles"); ?>', styles)
    page = page.replace('<?!= include("Client"); ?>', client)
    if "<?!=" in page:
        raise SystemExit("Unresolved Apps Script template directive in GitHub Pages HTML.")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "index.html").write_text(page, encoding="utf-8")
    config = {
        "oauthClientId": client_id,
        "apiDeploymentId": deployment_id,
    }
    (OUTPUT / "config.js").write_text(
        "window.BAKERY_POS_CONFIG = " + json.dumps(config, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    (OUTPUT / ".nojekyll").write_text("", encoding="utf-8")


if __name__ == "__main__":
    main()
