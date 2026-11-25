# Apps Script setup

The approved deployment uses GitHub Pages for the POS interface and an Apps Script **API executable** for data operations. It does not use Apps Script HTML Service or `google.script.run`.

Follow [DEPLOYMENT.md](./DEPLOYMENT.md) for the ordered setup steps, including the separate owner-only backup project, Google Cloud/OAuth requirements, staff spreadsheet access, and GitHub Pages configuration. Do not deploy the updated POS API project until the replacement backup trigger has been verified.
