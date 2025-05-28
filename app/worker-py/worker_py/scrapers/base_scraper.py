from abc import ABC, abstractmethod
from typing import Any

from threading import Lock

from proto_gen import scrape_task_pb2


#===================
#   UTILS
#===================
class SingletonMeta(type):
    _instances = {}
    _lock: Lock = Lock()

    def __call__(cls, *args, **kwargs):
        with cls._lock:
            if cls not in cls._instances:
                instance = super().__call__(*args, **kwargs)
                cls._instances[cls] = instance
        return cls._instances[cls]

#===================
#   MAIN
#===================
class BaseScraper(ABC, metaclass=SingletonMeta):
    @abstractmethod
    def scrape(self, task: scrape_task_pb2.ScrapeTask) -> Any:
        pass