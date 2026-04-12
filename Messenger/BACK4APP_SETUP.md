# Back4App Setup

1. Open your Back4App app dashboard.
2. Create a PostgreSQL database (Back4App Database).
3. Copy the connection string from Back4App.
4. In project root, create `.env` file based on `.env.example`.
5. Put your real connection string:

   `DATABASE_URL=postgresql+psycopg2://...`

6. Install dependencies:

   `py -m pip install -r requirements.txt`

7. Start server:

   `py main.py`

8. On first start, SQLAlchemy will create missing tables automatically.

## Notes

- Keep `sslmode=require` in the connection string.
- Do not commit real credentials to git.
- If Back4App gives plain `postgres://...`, you can convert it to:
  `postgresql+psycopg2://...`
