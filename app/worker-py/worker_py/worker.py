import asyncio
from app.io.redis_consumer import listen_to_redis
from app.io.kafka_consumer import listen_to_kafka

async def main():
    await asyncio.gather(
        listen_to_redis(),
        listen_to_kafka(),
    )

def start_worker():
    asyncio.run(main())
