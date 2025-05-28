import logging
import random
import time

import undetected_chromedriver as uc

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from proto_gen import scrape_task_pb2
from .base_scraper import BaseScraper

#==================
#   CONSTANTS
#==================
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

#==================
#   MAIN
#==================
class WebdriverScraper(BaseScraper):
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super(WebdriverScraper, cls).__new__(cls)
        return cls._instance

    def __init__(self):
        if hasattr(self, "initialized") and self.initialized:
            return
        self.driver = None
        self.initialized = True

    def _init_driver(self, proxy=None, headless=False):
        options = uc.ChromeOptions()
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-infobars")
        options.add_argument("--start-maximized")
        options.add_argument("--incognito")
        if proxy:
            options.add_argument(f'--proxy-server={proxy}')
        self.driver = uc.Chrome(options=options, headless=headless)
        logger.info("WebDriver initialized.")

    def _human_delay(self, min_sec=1.2, max_sec=3.5):
        delay = random.uniform(min_sec, max_sec)
        logger.debug(f"Sleeping for {delay:.2f} seconds")
        time.sleep(delay)

    def _human_typing(self, element, text):
        for char in text:
            element.send_keys(char)
            time.sleep(random.uniform(0.05, 0.25))  # simulate typing

    def _human_cursor(self, element):
        try:
            self.driver.execute_script(
                "arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", element
            )
            self._human_delay(0.5, 1.5)
        except Exception as e:
            logger.warning(f"Could not scroll to element: {e}")

    def load_page(self, url, proxy=None, headless=False, wait_for="body", timeout=15):
        if self.driver is None:
            self._init_driver(proxy=proxy, headless=headless)

        logger.info(f"Loading page: {url}")
        self.driver.get(url)

        try:
            WebDriverWait(self.driver, timeout).until(
                EC.presence_of_element_located((By.TAG_NAME, wait_for))
            )
            logger.success("Page loaded successfully.")
        except Exception as e:
            logger.error(f"Timeout waiting for page: {e}")
            return None

        self._human_delay(2, 5)
        return self.driver.page_source

    def input_text(self, selector: str, text: str, by=By.CSS_SELECTOR):
        try:
            element = self.driver.find_element(by, selector)
            self._human_cursor(element)
            self._human_typing(element, text)
        except Exception as e:
            logger.error(f"Failed to input text: {e}")

    def click(self, selector: str, by=By.CSS_SELECTOR):
        try:
            element = self.driver.find_element(by, selector)
            self._human_cursor(element)
            self._human_delay()
            element.click()
        except Exception as e:
            logger.error(f"Failed to click element: {e}")

    def quit(self):
        if self.driver:
            self.driver.quit()
            self.driver = None
            logger.info("WebDriver session ended.")
