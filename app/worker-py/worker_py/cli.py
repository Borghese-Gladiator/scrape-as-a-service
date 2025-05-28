from typing import Any

import typer

from worker_py.clients.redis_client import RedisClient
from worker_py.clients.kafka_client import KafkaClient
from worker_py.clients.minio_client import MinioClient
from worker_py.scrapers.base_scraper import BaseScraper
from worker_py.scrapers.api_scraper import ApiScraper
from worker_py.scrapers.html_scraper import HtmlScraper
from worker_py.scrapers.webdriver_scraper import WebdriverScraper
from worker_py.utils.config import (
    REDIS_CHANNEL_MAP_INPUT,
    KAFKA_TOPIC_MAP,
)
from worker_py.utils.constants import (
    REDIS_OUTPUT_SORTED_SET,
    get_redis_consumer_name,
)

#==================
#   CONSTANTS
#==================
app = typer.Typer()
minio_client = MinioClient()

REDIS_CHANNEL_API = REDIS_CHANNEL_MAP_INPUT["API"]
REDIS_CHANNEL_HTML = REDIS_CHANNEL_MAP_INPUT["HTML"]
REDIS_CHANNEL_WEBDRIVER = REDIS_CHANNEL_MAP_INPUT["WEBDRIVER"]
REDIS_CHANNELS = [
    REDIS_CHANNEL_API,
    REDIS_CHANNEL_HTML,
    REDIS_CHANNEL_WEBDRIVER,
]

KAFKA_TOPIC_API = KAFKA_TOPIC_MAP["API"]
KAFKA_TOPIC_HTML = KAFKA_TOPIC_MAP["HTML"]
KAFKA_TOPIC_WEBDRIVER = KAFKA_TOPIC_MAP["WEBDRIVER"]
KAFKA_TOPICS = [
    KAFKA_TOPIC_API,
    KAFKA_TOPIC_HTML,
    KAFKA_TOPIC_WEBDRIVER,
]

#==================
#   UTILS
#==================

# REDIS
def redis_build_scraper_from_channel_name(channel_name) -> BaseScraper:
    """
    Get the scraper type from the Redis channel name. Singleton pattern prevents multiple instances of the same scraper.
    """
    return {
        REDIS_CHANNEL_MAP_INPUT["API"]: ApiScraper,
        REDIS_CHANNEL_MAP_INPUT["HTML"]: HtmlScraper,
        REDIS_CHANNEL_MAP_INPUT["WEBDRIVER"]: WebDriverScraper,
    }[channel_name]

# KAFKA
def kafka_build_scraper_from_topic_name(topic_name) -> BaseScraper:
    """
    Get the scraper type from the Kafka topic name. Singleton pattern prevents multiple instances of the same scraper.
    """
    return {
        KAFKA_TOPIC_MAP["API"]: ApiScraper,
        KAFKA_TOPIC_MAP["HTML"]: HtmlScraper,
        KAFKA_TOPIC_MAP["WEBDRIVER"]: WebDriverScraper,
    }[topic_name]


#==================
#   MAIN
#==================
def scrape(kafka_topics: list[str], redis_channels: list[str], consumer_group_name: str = "scrape-all"):
    kafka_client = KafkaClient(
        topic_list=kafka_topics,
        group_name=consumer_group_name,
    )
    for topic, scrape_task in kafka_client.stream_read_protobuf():
        scraper = kafka_build_scraper_from_topic_name(topic)
        resp = scraper.scrape(scrape_task)
        minio_client.upload(scrape_task.job_id, resp)
    
    redis_client = RedisClient(
        channel_list=redis_channels,
        group_name=consumer_group_name,
        consumer_name=get_redis_consumer_name(),
    )
    channel_to_scrape_tasks_map = redis_client.stream_read()
    for channel, scrape_tasks in channel_to_scrape_tasks_map.items():
        scraper = redis_build_scraper_from_channel_name(channel)
        for scrape_task in scrape_tasks:
            resp = scraper.scrape(scrape_task)
            minio_client.upload(scrape_task.job_id, resp)
    
    # send task_complete event to sorted set
    redis_client.zadd(
        REDIS_OUTPUT_SORTED_SET,
        {scrape_task.job_id: scrape_task.timestamp},
    )

@app.command()
def scrape_all():
    """
    Continuously run all scraping tasks (API, HTML, and WebDriver)
    """
    CONSUMER_GROUP_NAME = "scrape-all"
    scrape(
        kafka_topics=KAFKA_TOPICS,
        redis_channels=REDIS_CHANNELS,
        consumer_group_name=CONSUMER_GROUP_NAME,
    )

@app.command()
def scrape_webdriver():
    """
    Continuously Webdriver scraping tasks (Selenium Webdriver)
    """
    CONSUMER_GROUP_NAME = "scrape-webdriver"
    scrape(
        kafka_topics=[KAFKA_TOPIC_WEBDRIVER],
        redis_channels=[REDIS_CHANNEL_WEBDRIVER],
        consumer_group_name=CONSUMER_GROUP_NAME,
    )
    
@app.command()
def scrape_non_webdriver():
    """
    Continuously run API or HTML scraping tasks (no webdrriver infrastructure)
    """
    CONSUMER_GROUP_NAME = "scrape-non-webdriver"
    scrape(
        kafka_topics=[KAFKA_TOPIC_API, KAFKA_TOPIC_HTML],
        redis_channels=[REDIS_CHANNEL_API, REDIS_CHANNEL_HTML],
        consumer_group_name=CONSUMER_GROUP_NAME,
    )

@app.command()
def scrape_api():
    """
    Scrape a website using API
    """
    CONSUMER_GROUP_NAME = "scrape-api"
    scrape(
        kafka_topics=[KAFKA_TOPIC_API],
        redis_channels=[REDIS_CHANNEL_API],
        consumer_group_name=CONSUMER_GROUP_NAME,
    )

@app.command()
def scrape_html():
    """
    Scrape a website using API
    """
    CONSUMER_GROUP_NAME = "scrape-html"
    scrape(
        kafka_topics=[KAFKA_TOPIC_HTML],
        redis_channels=[REDIS_CHANNEL_HTML],
        consumer_group_name=CONSUMER_GROUP_NAME,
    )

if __name__ == "__main__":
    app()