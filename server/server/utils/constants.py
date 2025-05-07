from enum import Enum

class ScrapeTopic(Enum):
    API = "scrape.api.requests"
    WEBDRIVER = "scrape.browser.webdriver"
    HTML = "scrape.browser.html"
