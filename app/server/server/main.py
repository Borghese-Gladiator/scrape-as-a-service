from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from uuid_extensions import uuid7str

from server.utils.config import (
    REDIS_CHANNEL_OUTPUT,
)
from server.clients.kafka_client import KafkaClient
from server.clients.redis_client import RedisClient
from server.utils.constants import HTTPMethodEnum, ScrapeType, get_kafka_topic_input, get_redis_channel_input
from proto_gen import scrape_task_pb2

#==================
#   UTILS
#==================
# Pydantic models

class BaseScrape(BaseModel):
    url: str
    headers: dict[str, str]
    scrape_type: ScrapeType

class UserScrapeAPI(BaseScrape):
    method: HTTPMethodEnum
    body: dict[str, str]
    scrape_type: ScrapeType = Field(default=ScrapeType.API)

class UserScrapeHTML(BaseScrape):
    scrape_type: ScrapeType = Field(default=ScrapeType.HTML)

class UserScrapeWebdriver(BaseScrape):
    url: str
    headers: dict[str, str]
    scrape_type: ScrapeType = Field(default=ScrapeType.WEBDRIVER)

#==================
#   CONSTANTS
#==================
app = FastAPI()
kafka_client = KafkaClient()
redis_client = RedisClient()

#==================
#   MAIN
#==================
@app.get("/scrape")
def enqueue(scrape_input: UserScrapeAPI | UserScrapeHTML | UserScrapeWebdriver):
    job_id = uuid7str()
    topic = get_kafka_topic_input(scrape_input.scrape_type)
    channel = get_redis_channel_input(scrape_input.scrape_type)
    print("START")

    # Build payload
    value = scrape_input.model_dump()
    value["job_id"] = job_id
    del value["scrape_type"]
    
    try:
        kafka_client.stream(
            topic=topic,
            key=None,
            value=value,
        )
        redis_client.stream_add_scrape_task(
            channel,
            raw_dict=value,
        )
        return {
            "job_id": job_id,
            "message": "Task enqueued",
            "topic": topic,
            "channel": channel,
            "scrape_type": scrape_input.scrape_type,
        }
    except TypeError as e:
        raise HTTPException(status_code=400, detail=f"ERROR: Failed to Serialize to ProtoBuf for passed event: {str(value)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ERROR: {str(e)}")

@app.get("/poll/{job_id}")
def status(job_id: str):
    """
    Get status of job and get data if possible
    """
    channel = REDIS_CHANNEL_OUTPUT
    try:
        redis_message: Any | None = redis_client.search(channel, job_id)
        if redis_message:
            return {"message": "Data from Redis", "data": redis_message}
        return {"message": "Results not yet available"}
    except Exception as e:
        return {"error": str(e)}

@app.get("/health")
def health():
    return {
        "status": "ok",
        "kafka": f"Is Kafka running and accepting connections? {kafka_client.ping()}",
        "redis": f"Is Redis running and accepting connections? {redis_client.ping()}",
    }

"""
SIMPLE EXAMPLE
Generated ChatGPT code
"""
# Pydantic model for the data
class Item(BaseModel):
    name: str
    description: str = ""
    price: float

# In-memory storage
items: Dict[int, Item] = {}
current_id = 0

@app.get("/")
def read_root():
    return {"message": "Welcome to the FastAPI app!"}

@app.get("/items")
def get_all_items():
    return {"items": items}

@app.get("/items/{item_id}")
def get_item(item_id: int):
    if item_id not in items:
        raise HTTPException(status_code=404, detail="Item not found")
    return items[item_id]

@app.post("/items", status_code=201)
def create_item(item: Item):
    global current_id
    items[current_id] = item
    current_id += 1
    return {"id": current_id - 1, "item": item}

@app.put("/items/{item_id}")
def update_item(item_id: int, item: Item):
    if item_id not in items:
        raise HTTPException(status_code=404, detail="Item not found")
    items[item_id] = item
    return {"message": "Item updated", "item": item}

@app.patch("/items/{item_id}")
def patch_item(item_id: int, item: Item):
    if item_id not in items:
        raise HTTPException(status_code=404, detail="Item not found")
    stored_item = items[item_id]
    updated_item = stored_item.copy(update=item.dict(exclude_unset=True))
    items[item_id] = updated_item
    return {"message": "Item partially updated", "item": updated_item}

@app.delete("/items/{item_id}")
def delete_item(item_id: int):
    if item_id not in items:
        raise HTTPException(status_code=404, detail="Item not found")
    deleted_item = items.pop(item_id)
    return {"message": "Item deleted", "item": deleted_item}
