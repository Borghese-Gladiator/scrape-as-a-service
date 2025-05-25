class BaseScraper:
    def __init__(self, url: str):
        self.url = url

    def consume_kafka(self):
        raise NotImplementedError("Subclasses should implement this method.")
    def consume_redis(self):
        
    def scrape(self):
        raise NotImplementedError("Subclasses should implement this method.")