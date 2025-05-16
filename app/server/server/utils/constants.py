from enum import Enum

from .config import (
    KAFKA_TOPIC_MAP,
    REDIS_CHANNEL_MAP_INPUT,
)

class HTTPMethodEnum(Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    DELETE = "DELETE"
    PATCH = "PATCH"

class ScrapeType(Enum):
    API = "API"
    HTML = "HTML"
    WEBDRIVER = "WEBDRIVER"


def get_kafka_topic_input(scrape_type: ScrapeType) -> str:
    return KAFKA_TOPIC_MAP[scrape_type.value]
def get_redis_channel_input(scrape_type: ScrapeType) -> str:
    return REDIS_CHANNEL_MAP_INPUT[scrape_type.value]
