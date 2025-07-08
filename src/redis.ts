import { Container, getContainer } from "@cloudflare/containers";
import { env, RpcTarget } from "cloudflare:workers"
import { createClient, RedisClientType } from 'redis';
import { CloudflareSocketBridge } from './socket-bridge';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1000; // 1 second

// Server-side RPC stub that handles the actual Redis client
class RedisRpcClient extends RpcTarget {
  constructor(private redisClient: RedisClientType) {
    super();
  }

  // Generic call function that can invoke any method on the Redis client with proper typing
  call<K extends keyof RedisClientType>(
    functionName: K,
    ...args: RedisClientType[K] extends (...args: infer P) => any ? P : never
  ): RedisClientType[K] extends (...args: any[]) => infer R ? R : never {
    const method = this.redisClient[functionName];
    if (typeof method === 'function') {
      return (method as any).apply(this.redisClient, args);
    }
    throw new Error(`Method ${String(functionName)} is not a function on Redis client`);
  }
}

// Client-side wrapper that provides direct method calls with full type completion
function createRedisClientWrapper(rpcStub: Rpc.Stub<RedisRpcClient>): RedisClientType {
  // Create a base object with common properties to avoid Proxy interference
  const baseObject = {
    // TODO: Add any non-function properties that should not be proxied
    // This would be any functions that don't have serializable arguments/return values
  };

  return new Proxy(baseObject as RedisClientType, {
    get(target, prop: string | symbol) {
      // Handle built-in properties and methods that should not be proxied
      if (typeof prop === 'symbol' || 
          prop === 'then' || 
          prop === 'catch' || 
          prop === 'finally' ||
          prop === 'constructor' ||
          prop === 'valueOf' ||
          prop === 'toString' ||
          prop === 'toJSON') {
        return (target as any)[prop];
      }

      if (typeof prop === 'string') {
        // Return a function that calls the RPC stub for Redis methods
        return (...args: any[]) => {
          // @ts-ignore Ignore invalid types here, this still works
          return rpcStub.call(prop as keyof RedisClientType, ...args);
        };
      }
      
      return undefined;
    },
    has(target, prop) {
      // This helps with 'in' operator checks
      return true;
    }
  });
}

export class RedisContainer extends Container<Env> {
  _client: RedisRpcClient | undefined;
  // Time before container sleeps due to inactivity (default: 30s)
  sleepAfter = "2m";
  // Environment variables passed to the container
  envVars = {

  };
  autoStart = false;
  
  get client(): RedisRpcClient {
    if (!this._client) {
      throw new Error("Client hasn't been initialized!");
    }
    // Return a client-side wrapper that provides direct method calls
    return this._client;
  }

  async init() {
    if (this._client) {
      return
    }

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
          if (!this.ctx.container?.running) {
            console.log("Container is not running, starting...")
            this.ctx.container?.start();
          }
          console.log(`Attempting to connect to Redis... (Attempt ${i + 1}/${MAX_RETRIES})`);
          
          // Get the Cloudflare socket
          const cfSocket = this.ctx.container?.getTcpPort(6379).connect("10.0.0.1:6379");
          if (!cfSocket) {
            throw new Error("Container TCP port 6379 is not available. Failed to get socket");
          }

          await cfSocket.opened

          // Create a Node.js compatible socket bridge
          const nodeSocket = new CloudflareSocketBridge(cfSocket);

          
          // Wait for the socket to be ready
          await new Promise<void>((resolve, reject) => {
            nodeSocket.once('connect', resolve);
            nodeSocket.once('error', reject);
            // Add a timeout to prevent hanging
            setTimeout(() => reject(new Error('Socket connection timeout')), 2000);
          });

          console.log('Socket bridge connected successfully');

          // Create Redis client with the bridged socket
          const client = createClient({
            socket: {
              socket: nodeSocket,
              connectTimeout: 2000,
              reconnectStrategy: false,
              tls: true,
            }
          });

          // Set up error handling for the Redis client BEFORE connecting
          let clientError: Error | null = null;
          client.on('error', (err) => {
            console.error('Redis Client Error:', err);
            clientError = err;
          });

          // Also listen for socket errors after Redis client creation
          nodeSocket.on('error', (err) => {
            console.error('Socket Bridge Error after Redis client creation:', err);
            clientError = err;
          });

          console.log('Connecting to Redis...');
          
          // Try to connect with a timeout and error checking
          await Promise.race([
            client.connect(),
            new Promise<void>((_, reject) => {
              // Check for errors periodically during connection
              const errorCheckInterval = setInterval(() => {
                if (clientError) {
                  clearInterval(errorCheckInterval);
                  reject(clientError);
                }
                
                // Also check socket bridge for errors
                if (nodeSocket.hasErrors && nodeSocket.hasErrors()) {
                  clearInterval(errorCheckInterval);
                  const socketError = nodeSocket.getLastError && nodeSocket.getLastError();
                  reject(socketError || new Error('Socket bridge encountered an error'));
                }
              }, 100);
              
              // Timeout after 5 seconds
              setTimeout(() => {
                clearInterval(errorCheckInterval);
                reject(new Error('Redis connection timeout'));
              }, 5000);
            })
          ]);
          
          // Final check for any errors that occurred during connection
          if (clientError) {
            throw clientError;
          }
          
          console.log('Successfully connected to Redis!');

          // Create the RPC client wrapper
          this._client = new RedisRpcClient(client as RedisClientType);
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
  }

  static async get(env: Env, key?: string): Promise<RedisClientType> {
    const redis = getContainer<RedisContainer>(env.RedisContainer, key);
    await redis.init()
    return createRedisClientWrapper(await redis.client);
  }
}