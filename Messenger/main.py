# main.py
"""
Run the full messenger stack with one command:
    python main.py
"""

import uvicorn
from dotenv import load_dotenv
import os


if __name__ == "__main__":
    load_dotenv()
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("backend.main:asgi_app", host="0.0.0.0", port=port, reload=False)
