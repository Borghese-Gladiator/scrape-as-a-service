import requests
from bs4 import BeautifulSoup
from app.io.storage import save_result
from app.utils import notify_completion

async def process_job(job: dict):
    job_id = job["job_id"]
    job_type = job["job_type"]
    url = job["url"]

    if job_type == "API":
        result = requests.get(url).json()
    elif job_type == "HTML":
        html = requests.get(url).text
        result = BeautifulSoup(html, "html.parser").prettify()
    elif job_type == "WEBDRIVER":
        from selenium import webdriver
        with webdriver.Chrome() as driver:
            driver.get(url)
            result = driver.page_source
    else:
        result = {"error": "Unknown job type"}

    path = f"{job_id}/{job_type.lower()}_result.json"
    save_result(path, result)

    await notify_completion(job_id, path)
