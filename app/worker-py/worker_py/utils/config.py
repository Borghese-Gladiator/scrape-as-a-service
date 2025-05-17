import json
from pathlib import Path

#==================
#  KAFKA
#==================
KAFKA_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent.parent.parent / "config" / "kafka.json"
with open(KAFKA_CONFIG_PATH) as f:
    KAFKA_SETTINGS = json.load(f)

# Kafka Topics
KAFKA_TOPIC_MAP = KAFKA_SETTINGS["TOPIC_MAP"]

# Broker settings
KAFKA_URL = KAFKA_SETTINGS["BROKER"]["HOST"] + ":" + str(KAFKA_SETTINGS["BROKER"]["PORT"])
KAFKA_CLIENT_ID = KAFKA_SETTINGS["CLIENT_ID"]

#==================
#  MINIO
#==================
MINIO_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent.parent.parent / "config" / "minio.json"
with open(MINIO_CONFIG_PATH) as f:
    minio_settings = json.load(f)

# buckets
MINIO_BUCKET_NAME = minio_settings["BUCKET_NAME"]

# MinIO settings
MINIO_ENDPOINT = minio_settings["MINIO_ENDPOINT"]
MINIO_ACCESS_KEY = minio_settings["MINIO_ACCESS_KEY"]
MINIO_SECRET_KEY = minio_settings["MINIO_SECRET_KEY"]
MINIO_SECURE = minio_settings["MINIO_SECURE"]

#==================
#  REDIS
#==================
REDIS_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent.parent.parent / "config" / "redis.json"
with open(REDIS_CONFIG_PATH) as f:
    redis_settings = json.load(f)

# Redis settings
REDIS_HOST = redis_settings["REDIS_HOST"]
REDIS_PORT = redis_settings["REDIS_PORT"]
REDIS_PASSWORD = redis_settings["REDIS_PASSWORD"]
REDIS_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}"

# Redis channels
REDIS_CHANNEL_MAP_INPUT = redis_settings["CHANNEL_MAP_INPUT"]
REDIS_CHANNEL_OUTPUT = redis_settings["CHANNEL_OUTPUT"]

