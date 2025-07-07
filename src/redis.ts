import { Container, getContainer } from "@cloudflare/containers";
import { env, RpcTarget } from "cloudflare:workers"

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1000; // 1 second

// Create a custom connector that uses your Cloudflare socket
class Redis extends RpcTarget {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private textEncoder = new TextEncoder();
  private textDecoder = new TextDecoder();

  constructor(protected options: { cfSocket: Socket }) {
    super();
    this.writer = this.options.cfSocket.writable.getWriter();
    this.reader = this.options.cfSocket.readable.getReader();
  }

  private encodeCommand(command: string, ...args: (string | number)[]) {
    let resp = `*${1 + args.length}\r\n`;
    resp += `$${command.length}\r\n${command}\r\n`;
    args.forEach(arg => {
      const argStr = String(arg);
      resp += `$${argStr.length}\r\n${argStr}\r\n`;
    });
    return this.textEncoder.encode(resp);
  }

  private async readResponse(): Promise<string> {
    const { value } = await this.reader.read();
    if (!value) {
      throw new Error("Empty response from Redis");
    }
    return this.textDecoder.decode(value);
  }

  async connect() {
    // Use HELLO 3 for RESP3 handshake. "HELLO 4" is not a valid command.
    await this.writer.write(this.encodeCommand("HELLO", 3));
    
    const response = await this.readResponse();

    // A successful HELLO response is a map (starts with '%').
    // If the server is older, it may respond with an error.
    if (response.startsWith('%')) {
      return; // Success
    }

    // Fallback to PING for older Redis versions that don't support HELLO.
    if (response.startsWith('-ERR unknown command')) {
      const pingResponse = await this.ping();
      if (pingResponse === 'PONG') {
        return; // Success with PING
      }
    }

    throw new Error(`Redis handshake failed. Unexpected response: ${response}`);
  }

  async ping() {
    await this.writer.write(this.encodeCommand("PING"));
    const response = await this.readResponse();
    if (response === "+PONG\r\n" || response === "$4\r\nPONG\r\n") {
      return "Redis: PONG";
    }
    throw new Error(`Unexpected PING response: ${response}`);
  }
}

export class RedisContainer extends Container<Env> {
  _client: Redis | undefined;
  // Time before container sleeps due to inactivity (default: 30s)
  sleepAfter = "2m";
  // Environment variables passed to the container
  envVars = {

  };
  autoStart = false;
  
  get client(): Redis {
    if (!this._client) {
      this.init()
      if (!this._client) {
        throw new Error("Failed to connect to Redis container");
      }
    }
    return this._client;
  }

  init() {
    if (this._client) {
      return
    }

    this.ctx.blockConcurrencyWhile(async () => {
      for (let i = 0; i < MAX_RETRIES; i++) {
        try {
          if (!this.ctx.container?.running) {
            console.log("Container is not running, starting...")
            this.ctx.container?.start();
          }
          console.log(`Attempting to connect to Redis... (Attempt ${i + 1}/${MAX_RETRIES})`);

          const cfSocket = await this.ctx.container?.getTcpPort(6379).connect("10.0.0.1:6379");
          if (!cfSocket) {
            throw new Error("Container TCP port 6379 is not available. Failed to get socket");
          }
          
          await cfSocket.opened

          this._client = new Redis({ cfSocket });
          await this._client.connect();
          return; // Exit on success
        } catch (error) {
          console.error(`Error connecting to Redis instance (attempt ${i + 1}):`, error);
          if (i < MAX_RETRIES - 1) {
            console.log(`Retrying in ${RETRY_DELAY_MS / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          } else {
            console.error("All connection attempts to Redis failed.");
          }
        }
      }
    })
  }

  static async get(env: Env, key?: string): Promise<Rpc.Stub<Redis>> {
    const redis = getContainer<RedisContainer>(env.RedisContainer, key);
    await redis.init()
    return redis.client;
  }
}
