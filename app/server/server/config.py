import json
from enum import Enum
from pathlib import Path

#==================
#  KAFKA
#==================

# Broker settings
KAFKA_URL = "localhost:9092"
KAFKA_CLIENT_ID = "my-server-admin"

# Kafka Topics
KAFKA_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent.parent / "config" / "kafka_topics.json"

with open(KAFKA_CONFIG_PATH) as f:
    kafka_topics = json.load(f)
KAFKA_TOPIC_MAP = kafka_topics

class ScrapeTopic(Enum):
    API = KAFKA_TOPIC_MAP["SCRAPE_API_TOPIC"]
    WEBDRIVER = KAFKA_TOPIC_MAP["SCRAPE_WEBDRIVER_TOPIC"]
    HTML = KAFKA_TOPIC_MAP["SCRAPE_HTML_TOPIC"]

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
