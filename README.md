# Domain Task Portal

A free web dashboard over the department's master Google Sheet. Each mentor signs in with Google
and sees only the students assigned to them; the HOD sees everything, with charts.

Built to read the existing sheet as it already is — mixed header rows, mentor UIDs instead of
emails, and a different status column on every tab. No restructuring required.

GitHub Pages + Google Apps Script + Google Sheets + Google Sign-In. Zero cost.

**Setup: read [SETUP.md](SETUP.md).** Two values in `config.js`, two in `apps-script/Code.gs`,
and one column of emails in the sheet.
