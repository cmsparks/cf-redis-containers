import { Hono } from "hono";
import { RedisContainer } from "./redis";

export { RedisContainer }

// Create Hono app with proper typing for Cloudflare Workers
const app = new Hono<{
  Bindings: Env;
}>();

// Home route with available endpoints
app.get("/", (c) => {
  return c.text(
    "Available endpoints:\n" +
      "GET /ping - Ping the redis container",
  );
});

// Get a single container instance (singleton pattern)
app.get("/ping", async (c) => {
  const redis = await RedisContainer.get(c.env, "redis-shard-key");
  return c.text(await redis.ping());
});

export default app;
