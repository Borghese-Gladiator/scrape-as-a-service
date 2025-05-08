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
CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "kafka_topics.json"

with open(CONFIG_PATH) as f:
    kafka_topics = json.load(f)
KAFKA_TOPIC_MAP = kafka_topics["SCRAPE_TASKS_TOPIC"]

class ScrapeTopic(Enum):
    API = KAFKA_TOPIC_MAP["SCRAPE_API_TOPIC"]
    WEBDRIVER = KAFKA_TOPIC_MAP["SCRAPE_WEBDRIVER_TOPIC"]
    HTML = KAFKA_TOPIC_MAP["SCRAPE_HTML_TOPIC"]
