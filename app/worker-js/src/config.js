import * as fs from 'fs';
import * as path from 'path';

//==================
//  KAFKA
//==================

// Broker settings
export const KAFKA_URL = "localhost:9092"
export const KAFKA_CLIENT_ID = "my-server-admin"

// Kafka Topics
const CONFIG_PATH = path.resolve(__dirname, "../../config/kafka_topics.json");
const KAFKA_TOPIC_MAP = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

export const ScrapeTopic = Object.freeze({
  API: KAFKA_TOPIC_MAP.SCRAPE_API_TOPIC,
  WEBDRIVER: KAFKA_TOPIC_MAP.SCRAPE_WEBDRIVER_TOPIC,
  HTML: KAFKA_TOPIC_MAP.SCRAPE_HTML_TOPIC
});
