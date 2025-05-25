# worker-py
`worker-py` is a Python worker service for the Scrape as a Service platform. It is responsible for processing scrape jobs from both Redis streams and Kafka topics, executing the scrape (API, HTML, or WEBDRIVER), saving results to Minio object storage, and publishing job completion notifications.

## Features & How It Works

- run scrape jobs (HTML, API, Webdriver)
- build structured data via LLM
- save both raw and structured data to Minio
---
- **Job Ingestion**: Reads scrape jobs from Redis streams and Kafka topics. Listens to configured sources for new scrape tasks.
- **Flexible Scraping**: Supports scraping API endpoints, HTML pages, and browser-based (WEBDRIVER) content. Depending on the job type, performs the appropriate scraping logic (API request, HTML fetch, or browser automation).
- **Result Storage**: Saves raw and processed scrape results to Minio, organizing them by job and type.
- **Completion Notification**: Publishes job completion (by `job_id`) to a Redis Sorted Set for downstream consumers. Adds an entry to signal that the job has finished, including the `job_id` and result location.

## Local Setup
Steps
- `poetry install`
- `Invoke-Expression (poetry env activate)` OR `eval $(poetry env activate)`
- `python main.py`

<details>
<summary>Methodology</summary>

Bootstrap
- `poetry init`
- `poetry add typer`
- VSCode - select Python interpreter using path from `poetry env info`
- `Invoke-Expression (poetry env activate)`
- `python`

Features
- create CLI w/ commands
  - scrape_all (WEBDRIVER + API + HTML)
  - scrape_webdriver
  - scrape_nonwebdriver (API + HTML)
  - scrape_api
  - scrape_html
- implement Redis/Kafka read from stream
- implement scraping
  - BaseScraper
  - ApiScraper
  - HtmlScraper
  - WebdriverScraper
- implement Minio upload to bucket
- implement Redis send task_complete event to sorted set


<details>
<summary>Feature Testing</summary>

LRU_CACHE Consumer Group Name generation
```python
from functools import lru_cache
import uuid
print(f"worker-{uuid.uuid4().hex[:8]}")
print(f"worker-{uuid.uuid4().hex[:8]}")
print(f"worker-{uuid.uuid4().hex[:8]}")

@lru_cache(maxsize=1)
def get_name():
    return f"worker-{uuid.uuid4().hex[:8]}"

print(get_name())
print(get_name())
print(get_name())
```

KAFKA consume from stream
```python
#============================
#   ENQUEUE scrape tasks
#============================
# **Run this code inside server venv**
# create topics
from server.clients.kafka_client import KafkaAdminClient
from server.utils.config import KAFKA_TOPIC_MAP
from kafka import KafkaAdminClient
admin_client = KafkaAdminClient(
    bootstrap_servers=KAFKA_URL,
    client_id='test'
)
admin_client.create_topics([NewTopic(name=topic, num_partitions=1, replication_factor=1) for topic in KAFKA_TOPIC_MAP.values()])

# produce tasks
from kafka import KafkaProducer
producer = KafkaProducer(bootstrap_servers="localhost:9092")
for topic in KAFKA_TOPIC_MAP.values():
    for _ in range(10):
        producer.send(topic, b'some_message_bytes')

#===========================
#   CONSUME from stream
#===========================
# **Run this code inside worker-py venv**
from worker_py.clients.kafka_client import KafkaClient
from worker_py.utils.config import (
    KAFKA_TOPIC_MAP,
)

KAFKA_TOPICS = list(KAFKA_TOPIC_MAP.values())
CONSUMER_GROUP_NAME = "scrape-all"
kafka_client = KafkaClient(
    topic_list=KAFKA_TOPICS,
    group_name=CONSUMER_GROUP_NAME,
)
print(kafka_client.ping())
print()
proto: ScrapeTask = next(kafka_client.stream_read_protobuf())  # fails since can't deserialize above message
print(proto)
raw = next(kafka_client.stream_read_raw())
print(raw)
record_json = next(kafka_client.stream_read_json())
print(record_json)
print()
```


REDIS consume from stream
```python
#============================
#   ENQUEUE scrape tasks
#============================
# **Run this code inside server venv**
from server.clients.redis_client import RedisClient
from server.utils.config import REDIS_CHANNEL_MAP_INPUT
client = RedisClient()

for channel in REDIS_CHANNEL_MAP_INPUT.values():
    for _ in range(10):
        client.stream_add(channel, {"task_id": "xyz456", "url": "https://stream.com"})

#===========================
#   CONSUME from stream
#===========================
# **Run this code inside worker-py venv**
# REDIS CONSUME
from worker_py.clients.redis_client import RedisClient
from worker_py.utils.config import (
    REDIS_CHANNEL_MAP_INPUT,
)
from worker_py.utils.constants import (
    get_redis_consumer_name,
)

redis_channels = list(REDIS_CHANNEL_MAP_INPUT.values())
consumer_group_name = "scrape-all"
redis_client = RedisClient(
    channel_list=redis_channels,
    group_name=consumer_group_name,
    consumer_name=get_redis_consumer_name(),
)
print(redis_client.ping())
print()

for channel, message in redis_client.stream_read_str():
    print(channel)
    print(message)
```

Generator Typing
```python
# Generator[yield_type, send_type, return_type]
def stream_read_json(self) -> Generator[tuple[str, Any], None, None]:
    pass
```

</details>
</details>

