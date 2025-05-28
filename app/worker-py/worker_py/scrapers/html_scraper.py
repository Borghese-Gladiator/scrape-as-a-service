from typing import Any

import requests
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_fixed, retry_if_exception_type

from proto_gen import scrape_task_pb2
from .base_scraper import BaseScraper


class HtmlScraper(BaseScraper):
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_fixed(2),
        retry=retry_if_exception_type(requests.exceptions.RequestException)
    )
    def scrape(self, task: scrape_task_pb2.ScrapeTask) -> Any:
        print(f"[{task.job_id}] Starting HTML scrape: {task.url}")
        response = requests.get(
            task.url,
            headers=dict(task.headers),
            params=dict(task.params),
            timeout=10
        )
        response.raise_for_status()
        print(f"[{task.job_id}] HTML scrape successful")
        return BeautifulSoup(response.text, 'html.parser')