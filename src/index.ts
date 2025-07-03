import { Container, loadBalance, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";
import { env } from "cloudflare:workers"
import { createClient } from "redis";
export class Redis extends Container {
  // Port the container listens on (default: 8080)
  defaultPort = 2000;
  // Time before container sleeps due to inactivity (default: 30s)
  sleepAfter = "2m";
  // Environment variables passed to the container
  envVars = {
    MESSAGE: "I was passed in via the container class!",
    CLOUDFLARED_TUNNEL_TOKEN: env.CLOUDFLARED_TUNNEL_TOKEN
  };

  // Optional lifecycle hooks
  override onStart() {
    console.log("Container successfully started");
  }
  override onStop() {
    console.log("Container successfully shut down");
  }

  override onError(error: unknown) {
    console.log("Container error:", error);
  }
}

// Create Hono app with proper typing for Cloudflare Workers
const app = new Hono<{
  Bindings: { Redis: DurableObjectNamespace<Redis> };
}>();

// Home route with available endpoints
app.get("/", (c) => {
  return c.text(
    "Available endpoints:\n" +
      "GET /metrics - Start the db container",
  );
});

// Get a single container instance (singleton pattern)
app.get("/metrics", async (c) => {
  const container = getContainer(c.env.Redis);
  await container.startAndWaitForPorts(1234);
  //console.log(await container.fetch("http://container:1234/metrics"))
  return c.text("ok");
});

// Get a single container instance (singleton pattern)
app.get("/stop", async (c) => {
  const container = getContainer(c.env.Redis);
  await container.stop();
  return c.text("Container stopped");
});

export default app;
