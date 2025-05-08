import json
from pathlib import Path

#==================
#  MINIO
#==================
MINIO_ENDPOINT = "localhost:9000"
MINIO_ACCESS_KEY = "minioadmin"
MINIO_SECRET_KEY = "minioadmin"
MINIO_SECURE = False

# Buckets
MINIO_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent.parent / "config" / "minio.json"
with open(MINIO_CONFIG_PATH) as f:
    minio_settings = json.load(f)
MINIO_BUCKET_NAME = minio_settings["BUCKET_NAME"]
