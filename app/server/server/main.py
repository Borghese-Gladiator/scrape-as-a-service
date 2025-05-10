from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict

from server.config import ScrapeTopic
from server.utils.kafka_client import KafkaClient


#==================
#   UTILS
#==================
# Pydantic model
class KafkaMessage(BaseModel):
    key: str
    value: str
    job_type: ScrapeTopic

#==================
#   CONSTANTS
#==================
app = FastAPI()
kafka_client = KafkaClient()

@app.get("/scrape")
def enqueue(message: KafkaMessage):
    """
    Enqueues a Scrape Task
    """
    try:
        kafka_client.enqueue_scrape_task(
            key=message.key,
            value=message.value,
        )
        return {"status": "Message produced", "key": message.key, "value": message.value}
    except Exception as e:
        return {"error": str(e)}
@app.get("/dequeue")
def dequeue():
    """
    Dequeue a task from the queue.
    """
    return {"message": "Task dequeued"}
@app.get("/status")
def status():
    """
    Get the status of the queue.
    """
    return {"message": "Queue status"}
@app.get("/health")
def health():
    """
    Check the health of the queue.
    """
    return {"message": "Queue is healthy"}


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
def delete_item(ite+m_id: int):
    if item_id not in items:
        raise HTTPException(status_code=404, detail="Item not found")
    deleted_item = items.pop(item_id)
    return {"message": "Item deleted", "item": deleted_item}

