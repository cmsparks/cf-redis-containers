import { Hono } from "hono";
import { RedisContainer } from "./redis";
import indexHtml from "./index.html";

export { RedisContainer }

// Create Hono app with proper typing for Cloudflare Workers
const app = new Hono<{
  Bindings: Env;
}>();

// Home route with interactive interface
app.get("/", (c) => {
  return c.html(indexHtml);
});

// Ping endpoint with shard
app.get("/:shard/ping", async (c) => {
  const shard = c.req.param('shard');
  const redis = await RedisContainer.get(c.env, shard);
  return c.text(await redis.ping());
});

// Get counter value with shard
app.get("/:shard/:id/counter", async (c) => {
  const shard = c.req.param('shard');
  const id = c.req.param('id');
  const redis = await RedisContainer.get(c.env, shard);
  
  try {
    const value = await redis.get(`counter:${id}`);
    return c.text(value || '0');
  } catch (error) {
    console.error('Error getting counter:', error);
    return c.text('Error getting counter', 500);
  }
});

// Increment counter with shard
app.post("/:shard/:id/counter", async (c) => {
  const shard = c.req.param('shard');
  const id = c.req.param('id');
  const redis = await RedisContainer.get(c.env, shard);
  
  try {
    const newValue = await redis.incr(`counter:${id}`);
    return c.text(newValue.toString());
  } catch (error) {
    console.error('Error incrementing counter:', error);
    return c.text('Error incrementing counter', 500);
  }
});

export default app;
